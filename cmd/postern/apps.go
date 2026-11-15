package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	appdata "postern/apps"
)

// The apps Postern knows live in apps/<id>/ (see apps/README.md). This file loads them, checks
// them, and builds what detection and the browser need. A problem in any folder is reported with the
// folder's name; the server refuses to start with one, and the tests fail on one.

const (
	maxAppIconBytes  = 64 << 10
	maxDiscoverPaths = 6
)

var (
	appHeaderRe = regexp.MustCompile(`^[A-Za-z0-9-]{2,60}$`)
	sourceIDRe  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	// Things an icon must not contain. Icons are shown through <img>, where script does not run,
	// but one opened on its own should be just as harmless, and these have no place in a logo.
	svgForbidden = []*regexp.Regexp{
		regexp.MustCompile(`(?i)<\s*script`),
		regexp.MustCompile(`(?i)<\s*foreignObject`),
		regexp.MustCompile(`(?i)<!\s*(DOCTYPE|ENTITY)`),
		regexp.MustCompile(`(?i)\son[a-z]+\s*=`),
		regexp.MustCompile(`(?i)href\s*=\s*["']\s*(?:[a-z][a-z0-9+.-]*:|//)`),
		regexp.MustCompile(`(?i)url\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|//)`),
	}
)

// appFile is apps/<id>/app.json as written.
type appFile struct {
	Schema string `json:"$schema"`
	Label  string `json:"label"`
	// Auth is required: an object, or null for an app whose key Postern cannot send.
	Auth    json.RawMessage `json:"auth"`
	KeyHint string          `json:"keyHint"`
	Note    string          `json:"note"`
	Match   appMatchRules   `json:"match"`
	Probe   *appProbeDef    `json:"probe"`
	Icon    struct {
		Source string `json:"source"`
	} `json:"icon"`
}

type appMatchRules struct {
	Title  []string `json:"title"`
	Body   []string `json:"body"`
	Header string   `json:"header"`
}

type appProbeDef struct {
	Path     string                 `json:"path"`
	Discover bool                   `json:"discover"`
	JSON     map[string]jsonFieldOp `json:"json"`
	JSONKeys []string               `json:"jsonKeys"`
	Text     []string               `json:"text"`
	Version  *appVersionRule        `json:"version"`
}

type jsonFieldOp struct {
	Contains *string `json:"contains"`
	Equals   *string `json:"equals"`
	Present  *bool   `json:"present"`
}

type appVersionRule struct {
	JSON  string `json:"json"`
	Regex string `json:"regex"`
}

// appAuth is how an app takes its key: a header name, a URL parameter name, an Authorization
// scheme, or several of them (the *arr apps take the key either way).
type appAuth struct {
	Header string `json:"header,omitempty"`
	Query  string `json:"query,omitempty"`
	Authz  string `json:"authz,omitempty"`
}

// appDef is one checked app, ready for detection.
type appDef struct {
	ID    string
	Label string
	// Auth is nil for an app whose key Postern cannot send.
	Auth    *appAuth
	KeyHint string
	Note    string
	titles  []string
	bodies  []string
	header  string
	probe   *appProbeDef
	version *regexp.Regexp
}

// appRegistry is every app, checked.
type appRegistry struct {
	apps []*appDef
	byID map[string]*appDef
	// discover is each path the active pass may ask, in a fixed order.
	discover []string
	// browser is the list the admin page gets, as JSON.
	browser []byte
	icons   fs.FS
}

// loadApps reads and checks every app in fsys, which is laid out like the apps/ folder. It reports
// every problem it finds, not only the first.
func loadApps(fsys fs.FS) (*appRegistry, error) {
	var problems []string
	fail := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	reg := &appRegistry{byID: map[string]*appDef{}, icons: fsys}

	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return nil, err
	}
	seenRules := map[string]string{}
	discover := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() || e.Name() == "LICENSES" {
			continue
		}
		id := e.Name()
		if !appIDRe.MatchString(id) {
			fail("%s/: folder names are app ids: 1-32 chars, a-z, 0-9, dash", id)
			continue
		}
		app, errs := loadApp(fsys, id)
		for _, msg := range errs {
			fail("%s: %s", id, msg)
		}
		if app == nil {
			continue
		}
		if key := app.ruleKey(); key != "" {
			if other, dup := seenRules[key]; dup {
				fail("%s: its match rules are the same as %s's, so the two cannot be told apart", id, other)
			} else {
				seenRules[key] = id
			}
		}
		if app.probe != nil && app.probe.Discover {
			discover[app.probe.Path] = true
		}
		reg.apps = append(reg.apps, app)
		reg.byID[id] = app
	}
	for p := range discover {
		reg.discover = append(reg.discover, p)
	}
	sort.Strings(reg.discover)
	if len(reg.discover) > maxDiscoverPaths {
		fail("apps: %d different probe paths have discover set (%s); at most %d may, because each is a request to every address typed",
			len(reg.discover), strings.Join(reg.discover, ", "), maxDiscoverPaths)
	}
	if len(problems) > 0 {
		return nil, errors.New("apps folder: " + strings.Join(problems, "\n  "))
	}

	sort.Slice(reg.apps, func(i, j int) bool { return reg.apps[i].ID < reg.apps[j].ID })
	reg.browser, err = reg.browserJSON()
	if err != nil {
		return nil, err
	}
	return reg, nil
}

func loadApp(fsys fs.FS, id string) (*appDef, []string) {
	var errs []string
	fail := func(format string, args ...any) { errs = append(errs, fmt.Sprintf(format, args...)) }

	b, err := fs.ReadFile(fsys, path.Join(id, "app.json"))
	if err != nil {
		return nil, []string{"app.json is missing"}
	}
	var f appFile
	if err := decodeStrict(b, &f); err != nil {
		return nil, []string{"app.json: " + err.Error()}
	}

	app := &appDef{ID: id, Label: strings.TrimSpace(f.Label), KeyHint: f.KeyHint, Note: f.Note, probe: f.Probe}
	if app.Label == "" || len(app.Label) > 40 {
		fail("label is required, at most 40 characters")
	}
	switch raw := strings.TrimSpace(string(f.Auth)); {
	case raw == "":
		fail(`auth is required: how the app takes its key, or null when Postern cannot send it`)
	case raw == "null":
		if strings.TrimSpace(f.Note) == "" {
			fail(`"auth": null needs a note that says why the key cannot be sent`)
		}
	default:
		var auth appAuth
		if err := decodeStrict(f.Auth, &auth); err != nil {
			fail("auth: %v", err)
			break
		}
		for _, msg := range checkAppAuth(auth) {
			fail("auth: %s", msg)
		}
		app.Auth = &auth
	}
	if len(f.KeyHint) > 200 || len(f.Note) > 200 {
		fail("keyHint and note are at most 200 characters")
	}

	for _, t := range f.Match.Title {
		if len(t) < 2 || len(t) > 60 || t != strings.ToLower(t) || strings.TrimSpace(t) != t {
			fail("match.title %q must be 2-60 characters, lower case, with no outer spaces", t)
			continue
		}
		app.titles = append(app.titles, t)
	}
	for _, s := range f.Match.Body {
		if len(s) < 6 || len(s) > 100 {
			fail("match.body %q must be 6-100 characters, so it does not match other apps' pages", s)
			continue
		}
		app.bodies = append(app.bodies, s)
	}
	if h := f.Match.Header; h != "" {
		if !appHeaderRe.MatchString(h) {
			fail("match.header %q is not a header name", h)
		}
		app.header = h
	}

	if p := f.Probe; p != nil {
		u, perr := url.Parse(p.Path)
		switch {
		case p.Path == "" || strings.HasPrefix(p.Path, "/") || strings.Contains(p.Path, "..") || strings.ContainsAny(p.Path, " \t\r\n"):
			fail("probe.path %q must be relative, with no leading slash, spaces or ..", p.Path)
		case perr != nil || u.Scheme != "" || u.Host != "":
			fail("probe.path %q must be a path, not an address", p.Path)
		}
		if len(p.JSON) == 0 && len(p.JSONKeys) == 0 && len(p.Text) == 0 {
			fail("probe needs at least one check: json, jsonKeys or text")
		}
		for field, op := range p.JSON {
			n := 0
			if op.Contains != nil {
				n++
				if *op.Contains == "" {
					fail("probe.json.%s.contains is empty", field)
				}
			}
			if op.Equals != nil {
				n++
			}
			if op.Present != nil {
				n++
				if !*op.Present {
					fail("probe.json.%s.present can only be true", field)
				}
			}
			if n != 1 {
				fail("probe.json.%s needs exactly one of contains, equals and present", field)
			}
		}
		for _, t := range p.Text {
			if t == "" {
				fail("probe.text has an empty string")
			}
		}
		if v := p.Version; v != nil {
			switch {
			case (v.JSON == "") == (v.Regex == ""):
				fail("probe.version needs exactly one of json and regex")
			case v.Regex != "":
				re, rerr := regexp.Compile(v.Regex)
				if rerr != nil {
					fail("probe.version.regex: %v", rerr)
				} else if re.NumSubexp() < 1 {
					fail("probe.version.regex needs a group around the version")
				} else {
					app.version = re
				}
			}
		}
	}

	if !sourceIDRe.MatchString(f.Icon.Source) {
		fail("icon.source must name a licence in LICENSES/")
	} else if _, err := fs.Stat(fsys, path.Join("LICENSES", f.Icon.Source+".txt")); err != nil {
		fail("icon.source %q has no LICENSES/%s.txt", f.Icon.Source, f.Icon.Source)
	}
	if msg := checkAppIcon(fsys, id); msg != "" {
		fail("%s", msg)
	}
	return app, errs
}

// checkAppAuth returns what is wrong with an app's auth.
func checkAppAuth(a appAuth) []string {
	var errs []string
	if a.Header == "" && a.Query == "" && a.Authz == "" {
		errs = append(errs, "give at least one of header, query and authz")
	}
	if a.Header != "" && !appHeaderRe.MatchString(a.Header) {
		errs = append(errs, fmt.Sprintf("header %q is not a header name", a.Header))
	}
	if a.Query != "" && !appHeaderRe.MatchString(a.Query) {
		errs = append(errs, fmt.Sprintf("query %q must be letters, digits and dashes", a.Query))
	}
	if a.Authz != "" && a.Authz != "bearer" && a.Authz != "basic" {
		errs = append(errs, "authz must be bearer or basic")
	}
	return errs
}

// checkAppIcon returns what is wrong with apps/<id>/icon.svg, or "".
func checkAppIcon(fsys fs.FS, id string) string {
	b, err := fs.ReadFile(fsys, path.Join(id, "icon.svg"))
	if err != nil {
		return "icon.svg is missing"
	}
	if len(b) > maxAppIconBytes {
		return fmt.Sprintf("icon.svg is %d KB; keep it under %d KB (run npm run icons:optimize)", len(b)>>10, maxAppIconBytes>>10)
	}
	head := bytes.TrimSpace(b)
	if bytes.HasPrefix(head, []byte("<?xml")) {
		if end := bytes.Index(head, []byte("?>")); end >= 0 {
			head = bytes.TrimSpace(head[end+2:])
		}
	}
	if !bytes.HasPrefix(head, []byte("<svg")) {
		return "icon.svg must be an SVG that starts with <svg"
	}
	for _, re := range svgForbidden {
		if m := re.Find(b); m != nil {
			return fmt.Sprintf("icon.svg contains %q, which icons may not use", strings.TrimSpace(string(m)))
		}
	}
	return ""
}

// ruleKey is the app's match rules in a fixed form, to find two apps that cannot be told apart.
func (a *appDef) ruleKey() string {
	t := append([]string(nil), a.titles...)
	b := append([]string(nil), a.bodies...)
	sort.Strings(t)
	sort.Strings(b)
	var probe string
	if a.probe != nil {
		p := *a.probe
		p.Version = nil
		p.Discover = false
		pb, _ := json.Marshal(p)
		probe = string(pb)
	}
	if len(t) == 0 && len(b) == 0 && a.header == "" && probe == "" {
		return ""
	}
	k, _ := json.Marshal([]any{t, b, strings.ToLower(a.header), probe})
	return string(k)
}

// decodeStrict decodes one JSON value and refuses unknown fields, so a misspelt key is reported.
func decodeStrict(b []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("extra content after the JSON value")
	}
	return nil
}

// browserJSON is what the admin page needs: each app's label, how it takes its key, and hints.
// Match rules stay on the server. json.Marshal escapes < > &, so it is safe inside a <script>.
func (r *appRegistry) browserJSON() ([]byte, error) {
	type browserApp struct {
		ID      string   `json:"id"`
		Label   string   `json:"label"`
		Auth    *appAuth `json:"auth"`
		KeyHint string   `json:"keyHint,omitempty"`
		Note    string   `json:"note,omitempty"`
	}
	out := struct {
		Apps []browserApp `json:"apps"`
	}{Apps: []browserApp{}}
	for _, a := range r.apps {
		out.Apps = append(out.Apps, browserApp{ID: a.ID, Label: a.Label, Auth: a.Auth, KeyHint: a.KeyHint, Note: a.Note})
	}
	sort.SliceStable(out.Apps, func(i, j int) bool {
		return strings.ToLower(out.Apps[i].Label) < strings.ToLower(out.Apps[j].Label)
	})
	return json.Marshal(out)
}

// iconSVG returns the icon of a known app.
func (r *appRegistry) iconSVG(id string) ([]byte, error) {
	if _, ok := r.byID[id]; !ok {
		return nil, fs.ErrNotExist
	}
	return fs.ReadFile(r.icons, path.Join(id, "icon.svg"))
}

var (
	builtinAppsOnce sync.Once
	builtinApps     *appRegistry
	builtinAppsErr  error
)

// embeddedApps is the registry built into the binary. The tests check it loads.
func embeddedApps() (*appRegistry, error) {
	builtinAppsOnce.Do(func() {
		builtinApps, builtinAppsErr = loadApps(appdata.FS)
	})
	return builtinApps, builtinAppsErr
}

// appReg is the App's registry, or the built-in one for an App made without one (tests).
func (a *App) appReg() *appRegistry {
	if a != nil && a.apps != nil {
		return a.apps
	}
	reg, err := embeddedApps()
	if err != nil {
		panic(err)
	}
	return reg
}

// wordIn reports whether word appears in s with no letter or digit right before or after it.
func wordIn(s, word string) bool {
	for i := 0; ; {
		j := strings.Index(s[i:], word)
		if j < 0 {
			return false
		}
		start, end := i+j, i+j+len(word)
		before := start == 0 || !isWordRune(lastRune(s[:start]))
		after := end == len(s) || !isWordRune(firstRune(s[end:]))
		if before && after {
			return true
		}
		i = start + 1
	}
}

func isWordRune(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }

func firstRune(s string) rune {
	r, _ := utf8.DecodeRuneInString(s)
	return r
}

func lastRune(s string) rune {
	r, _ := utf8.DecodeLastRuneInString(s)
	return r
}
