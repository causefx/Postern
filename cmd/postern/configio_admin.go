package main

import (
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
