package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// Every folder in apps/ must pass. This is the test to run after adding an app.
func TestEmbeddedAppsAreValid(t *testing.T) {
	reg, err := embeddedApps()
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.apps) < 16 {
		t.Fatalf("only %d apps loaded", len(reg.apps))
	}
	for _, a := range reg.apps {
		if b, err := reg.iconSVG(a.ID); err != nil || len(b) == 0 {
			t.Errorf("%s: icon: %v", a.ID, err)
		}
	}
	var out struct {
		Apps []map[string]any `json:"apps"`
	}
	if err := json.Unmarshal(reg.browser, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Apps) != len(reg.apps) {
		t.Fatalf("browser list: %d apps, want %d", len(out.Apps), len(reg.apps))
	}
	for _, a := range out.Apps {
		if _, leaked := a["match"]; leaked {
			t.Fatal("match rules must stay on the server")
		}
	}
}

// validApp is an app.json that passes; cases change one thing in it.
func validApp(extra string) string {
	return `{"label":"Demo","auth":{"header":"X-Api-Key"},"keyHint":"Settings","match":{"title":["demo"]},"icon":{"source":"lic"}` + extra + `}`
}

func appFS(files map[string]string) fstest.MapFS {
	fsys := fstest.MapFS{
		"LICENSES/lic.txt": {Data: []byte("licence")},
		"demo/icon.svg":    {Data: []byte(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>`)},
		"demo/app.json":    {Data: []byte(validApp(""))},
	}
	for name, body := range files {
		if body == "" {
			delete(fsys, name)
			continue
		}
		fsys[name] = &fstest.MapFile{Data: []byte(body)}
	}
	return fsys
}

func TestAppValidation(t *testing.T) {
	if _, err := loadApps(appFS(nil)); err != nil {
		t.Fatalf("the valid fixture fails: %v", err)
	}
	cases := []struct {
		name  string
		files map[string]string
		want  string
	}{
		{"bad folder name", map[string]string{"Demo_App/app.json": validApp("")}, "folder names are app ids"},
		{"no app.json", map[string]string{"demo/app.json": ""}, "app.json is missing"},
		{"unknown field", map[string]string{"demo/app.json": validApp(`,"colour":"red"`)}, "unknown field"},
		{"no auth", map[string]string{"demo/app.json": strings.Replace(validApp(""), `"auth":{"header":"X-Api-Key"},`, ``, 1)}, "auth is required"},
		{"null auth without note", map[string]string{"demo/app.json": strings.Replace(validApp(""), `{"header":"X-Api-Key"}`, `null`, 1)}, "needs a note"},
		{"empty auth", map[string]string{"demo/app.json": strings.Replace(validApp(""), `{"header":"X-Api-Key"}`, `{}`, 1)}, "at least one of header"},
		{"bad header name", map[string]string{"demo/app.json": strings.Replace(validApp(""), `X-Api-Key`, `X Api Key`, 1)}, "not a header name"},
		{"bad authz", map[string]string{"demo/app.json": strings.Replace(validApp(""), `{"header":"X-Api-Key"}`, `{"authz":"digest"}`, 1)}, "bearer or basic"},
		{"unknown auth field", map[string]string{"demo/app.json": strings.Replace(validApp(""), `{"header":"X-Api-Key"}`, `{"cookie":"sid"}`, 1)}, "unknown field"},
		{"upper-case title", map[string]string{"demo/app.json": strings.Replace(validApp(""), `["demo"]`, `["Demo"]`, 1)}, "lower case"},
		{"short body marker", map[string]string{"demo/app.json": strings.Replace(validApp(""), `"title":["demo"]`, `"body":["abc"]`, 1)}, "6-100 characters"},
		{"absolute probe", map[string]string{"demo/app.json": validApp(`,"probe":{"path":"/status","text":["ok"]}`)}, "must be relative"},
		{"probe to another host", map[string]string{"demo/app.json": validApp(`,"probe":{"path":"http://evil/x","text":["ok"]}`)}, "not an address"},
		{"probe with no check", map[string]string{"demo/app.json": validApp(`,"probe":{"path":"status"}`)}, "at least one check"},
		{"two json ops", map[string]string{"demo/app.json": validApp(`,"probe":{"path":"s","json":{"a":{"equals":"x","present":true}}}`)}, "exactly one of contains"},
		{"bad version regex", map[string]string{"demo/app.json": validApp(`,"probe":{"path":"s","text":["x"],"version":{"regex":"("}}`)}, "probe.version.regex"},
		{"version regex without group", map[string]string{"demo/app.json": validApp(`,"probe":{"path":"s","text":["x"],"version":{"regex":"v[0-9]+"}}`)}, "needs a group"},
		{"no licence", map[string]string{"LICENSES/lic.txt": ""}, "has no LICENSES/lic.txt"},
		{"no icon", map[string]string{"demo/icon.svg": ""}, "icon.svg is missing"},
		{"not an svg", map[string]string{"demo/icon.svg": "\x89PNG...."}, "must be an SVG"},
		{"script in icon", map[string]string{"demo/icon.svg": `<svg><script>alert(1)</script></svg>`}, "may not use"},
		{"handler in icon", map[string]string{"demo/icon.svg": `<svg onload="alert(1)"></svg>`}, "may not use"},
		{"external link in icon", map[string]string{"demo/icon.svg": `<svg><image href="https://x/y.png"/></svg>`}, "may not use"},
		{"doctype in icon", map[string]string{"demo/icon.svg": `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "b">]><svg/>`}, "must be an SVG"},
		{"huge icon", map[string]string{"demo/icon.svg": "<svg>" + strings.Repeat(" ", maxAppIconBytes) + "</svg>"}, "keep it under"},
		{"same rules twice", map[string]string{"twin/app.json": validApp(""), "twin/icon.svg": `<svg/>`}, "cannot be told apart"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := loadApps(appFS(c.files))
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("err = %v, want it to mention %q", err, c.want)
			}
		})
	}
}

func TestDiscoverIsCapped(t *testing.T) {
	files := map[string]string{"demo/app.json": ""}
	for i := 0; i <= maxDiscoverPaths; i++ {
		id := fmt.Sprintf("app%d", i)
		files[id+"/app.json"] = strings.Replace(validApp(fmt.Sprintf(`,"probe":{"path":"p%d","discover":true,"text":["x"]}`, i)), `["demo"]`, `["`+id+`"]`, 1)
		files[id+"/icon.svg"] = `<svg/>`
	}
	if _, err := loadApps(appFS(files)); err == nil || !strings.Contains(err.Error(), "discover set") {
		t.Fatalf("err = %v", err)
	}
}

func TestMatchPageScoring(t *testing.T) {
	reg, err := embeddedApps()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		title, body, header, want string
	}{
		// Whole words only: Jellyseerr's page is not Jellyfin's.
		{"Jellyseerr", "", "", "jellyseerr"},
		{"Jellyfin", "", "", "jellyfin"},
		{"Login - Radarr", "", "", "radarr"},
		{"My Emby-style page", "", "", "emby"},
		{"Embyx", "", "", ""},
		// A body marker beats a title that names another app.
		{"Radarr", "window.Sonarr = {}", "", "sonarr"},
		// A header beats both.
		{"Sonarr", "", "X-Plex-Protocol", "plex"},
		{"Welcome", "", "", ""},
	}
	for _, c := range cases {
		h := http.Header{}
		if c.header != "" {
			h.Set(c.header, "1")
		}
		page := []byte("<html><head><title>" + c.title + "</title></head><body>" + c.body + "</body></html>")
		got := ""
		if a := reg.matchPage(h, page); a != nil {
			got = a.ID
		}
		if got != c.want {
			t.Errorf("title %q body %q header %q: got %q, want %q", c.title, c.body, c.header, got, c.want)
		}
	}
}

func TestWordIn(t *testing.T) {
	for _, c := range []struct {
		s, w string
		want bool
	}{
		{"jellyfin", "jellyfin", true},
		{"login - jellyfin", "jellyfin", true},
		{"jellyfin-web", "jellyfin", true},
		{"jellyfinx", "jellyfin", false},
		{"myjellyfin", "jellyfin", false},
		{"home assistant", "home assistant", true},
		{"emby emby2 emby", "emby", true},
		{"émby", "mby", false},
	} {
		if got := wordIn(c.s, c.w); got != c.want {
			t.Errorf("wordIn(%q, %q) = %v", c.s, c.w, got)
		}
	}
}

func TestAdminPageCarriesAppList(t *testing.T) {
	app := &App{}
	rec := httptest.NewRecorder()
	app.ui(rec, httptest.NewRequest(http.MethodGet, "/admin/", nil))
	body := rec.Body.String()
	start := strings.Index(body, `<script type="application/json" id="postern-apps">`)
	if start < 0 || strings.Contains(body, "{{APPS}}") {
		t.Fatal("the app list is not in the page")
	}
	rest := body[start+len(`<script type="application/json" id="postern-apps">`):]
	raw := rest[:strings.Index(rest, "</script>")]
	var out struct {
		Apps []struct {
			ID string `json:"id"`
		} `json:"apps"`
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil || len(out.Apps) == 0 {
		t.Fatalf("app list: %v (%d apps)", err, len(out.Apps))
	}
}

// The browser gets each app's auth as written, and null for an app whose key cannot be sent.
func TestBrowserListCarriesAuth(t *testing.T) {
	reg, err := embeddedApps()
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Apps []struct {
			ID   string   `json:"id"`
			Auth *appAuth `json:"auth"`
		} `json:"apps"`
	}
	if err := json.Unmarshal(reg.browser, &out); err != nil {
		t.Fatal(err)
	}
	auth := map[string]*appAuth{}
	for _, a := range out.Apps {
		auth[a.ID] = a.Auth
	}
	if s := auth["sonarr"]; s == nil || s.Header != "X-Api-Key" || s.Query != "apikey" || s.Authz != "" {
		t.Fatalf("sonarr: %+v", s)
	}
	if h := auth["homeassistant"]; h == nil || h.Authz != "bearer" {
		t.Fatalf("home assistant: %+v", h)
	}
	if q, ok := auth["qbittorrent"]; !ok || q != nil {
		t.Fatalf("qbittorrent: %+v (listed %v)", q, ok)
	}
}
