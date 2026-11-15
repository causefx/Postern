package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// exportConfig returns the services as a config file. A redacted file needs nothing more. A full
// file holds every secret in plain text, so the request must say it knows that, and the export is
// written to the admin log. It is a POST so the admin header guard applies, and it is never cached.
func (a *App) exportConfig(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Mode    string `json:"mode"`
		Confirm bool   `json:"confirm"`
	}](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	var full bool
	switch in.Mode {
	case "redacted":
	case "full":
		full = true
	default:
		writeErr(w, 400, "mode must be redacted or full")
		return
	}
	if full && !in.Confirm {
		writeErr(w, 400, "confirm that the file will contain every secret in plain text")
		return
	}
	doc, stats := a.store.ExportConfig(full, time.Now())
	a.attachIcons(&doc)
	if full {
		a.record(auditEvent{
			Action: "export",
			Mode:   "full",
			Detail: fmt.Sprintf("%s, %s", plural(stats.Services, "service"), plural(stats.Secrets, "secret")),
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{
		"file":     doc,
		"services": stats.Services,
		"secrets":  stats.Secrets,
	})
}

// importConfig checks a config file, and unless dryRun is set writes every service in it. Nothing
// is written unless all of them pass.
func (a *App) importConfig(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBytes)
	var in struct {
		Config    json.RawMessage `json:"config"`
		Overwrite bool            `json:"overwrite"`
		DryRun    bool            `json:"dryRun"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, http.StatusRequestEntityTooLarge, "That file is too large to import")
			return
		}
		writeErr(w, 400, "bad json")
		return
	}
	if len(in.Config) == 0 || string(in.Config) == "null" {
		writeErr(w, 400, "config is required")
		return
	}
	doc, err := parseConfig(in.Config)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	icons, err := a.resolveImportIcons(&doc)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	if !in.DryRun {
		for _, b := range icons {
			if _, err := a.icons.save(b); err != nil {
				writeErr(w, 500, "could not save the icons in the file")
				return
			}
		}
	}

	out, err := a.store.ImportConfig(doc, in.Overwrite, in.DryRun)
	body := map[string]any{
		"redacted": doc.Redacted,
		"exported": doc.Exported,
		"services": len(doc.Services),
		"dryRun":   in.DryRun,
		"applied":  out.Applied,
		"counts":   out.Counts,
		"results":  out.Results,
	}
	switch {
	case err == nil:
	case errors.Is(err, errImportHasErrors) && in.DryRun:
		// A dry run reports problems; it is not itself a failure.
	case errors.Is(err, errImportHasErrors), errors.Is(err, errNothingToImport):
		body["error"] = err.Error()
		writeJSON(w, 400, body)
		return
	default:
		writeErr(w, 500, "could not save the imported services")
		return
	}

	if out.Applied {
		a.usage.forget(out.Removed...)
		mode := "full"
		if doc.Redacted {
			mode = "redacted"
		}
		a.record(auditEvent{Action: "import", Mode: mode, Detail: importDetail(out.Counts)})
		a.sweepIcons()
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, body)
}

// importDetail is a short, secret-free line for the admin log, such as "2 created, 1 overwritten".
func importDetail(c importCounts) string {
	switch {
	case c.Create > 0 && c.Overwrite > 0:
		return fmt.Sprintf("%d created, %d overwritten", c.Create, c.Overwrite)
	case c.Overwrite > 0:
		return fmt.Sprintf("%d overwritten", c.Overwrite)
	default:
		return fmt.Sprintf("%d created", c.Create)
	}
}

func plural(n int, word string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

// attachIcons copies the uploaded icons the exported services use into the file. A service whose
// icon file has gone missing is exported without one.
func (a *App) attachIcons(doc *configFile) {
	for i := range doc.Services {
		cs := &doc.Services[i]
		if cs.Icon == nil {
			continue
		}
		name := *cs.Icon
		if _, done := doc.Icons[name]; done {
			continue
		}
		b, err := a.icons.read(name)
		if err != nil {
			cs.Icon = nil
			continue
		}
		if doc.Icons == nil {
			doc.Icons = map[string]string{}
		}
		doc.Icons[name] = base64.StdEncoding.EncodeToString(b)
	}
}

// resolveImportIcons checks the icons carried in an import file and returns the ones to store.
// Each is renamed after its own contents, and the services follow the new name, so an edited file
// cannot store an image under another image's name. A service pointing at an icon that is neither
// in the file nor already stored loses the icon rather than failing the import: icons are only
// decoration.
func (a *App) resolveImportIcons(doc *configFile) ([][]byte, error) {
	if len(doc.Icons) > maxImportIcons {
		return nil, fmt.Errorf("The file has more than %d icons", maxImportIcons)
	}
	rename := map[string]string{}
	var blobs [][]byte
	for name, enc := range doc.Icons {
		b, err := base64.StdEncoding.DecodeString(enc)
		if err != nil {
			return nil, fmt.Errorf("Icon %q in the file is not valid base64", name)
		}
		ext, err := checkIcon(b)
		if err != nil {
			return nil, fmt.Errorf("Icon %q in the file cannot be used: %v", name, err)
		}
		rename[name] = iconName(b, ext)
		blobs = append(blobs, b)
	}
	for i := range doc.Services {
		cs := &doc.Services[i]
		if cs.Icon == nil || *cs.Icon == "" {
			continue
		}
		if to, ok := rename[*cs.Icon]; ok {
			cs.Icon = &to
			continue
		}
		if !a.icons.exists(*cs.Icon) {
			none := ""
			cs.Icon = &none
		}
	}
	return blobs, nil
}
