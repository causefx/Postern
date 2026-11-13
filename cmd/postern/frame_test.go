package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeEmbedOrigins(t *testing.T) {
	got, err := normalizeEmbedOrigins([]string{
		" HTTPS://Dash.Example.com/ ",
		"http://192.168.1.10:8080",
		"https://*.example.org",
		"https://dash.example.com", // duplicate of the first once cleaned
		"",
		"http://[::1]:3000",
		"https://localhost",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"https://dash.example.com",
		"http://192.168.1.10:8080",
		"https://*.example.org",
		"http://[::1]:3000",
		"https://localhost",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %v, want %v", got, want)
	}

	if got, err := normalizeEmbedOrigins(nil); err != nil || len(got) != 0 {
		t.Fatalf("empty list: %v %v", got, err)
	}
	if got, err := normalizeEmbedOrigins([]string{"*"}); err != nil || len(got) != 1 || got[0] != "*" {
		t.Fatalf("any site: %v %v", got, err)
	}
}

func TestNormalizeEmbedOriginsRefusesAnythingThatIsNotASite(t *testing.T) {
	for _, bad := range []string{
		"dash.example.com",                        // no scheme
		"//dash.example.com",                      // no scheme
		"ftp://dash.example.com",                  // wrong scheme
		"javascript:alert(1)",                     // not a site at all
		"data:text/html,x",                        // ditto
		"https://",                                // no host
		"https://dash.example.com/path",           // a path
		"https://dash.example.com?x=1",            // a query
		"https://dash.example.com#frag",           // a fragment
		"https://user:pw@dash.example.com",        // credentials
		"https://dash.example.com:abc",            // bad port
		"https://*",                               // wildcard without a domain
		"https://da*sh.example.com",               // wildcard in the middle
		"https://*.*.example.com",                 // two wildcards
		"https://dash.example.com; script-src *",  // a second directive
		"https://dash.example.com, https://b.com", // two sites in one entry
		"https://dash example.com",                // space
		"https://dash.example.com\nhttps://b.com",
		"https://a.com'",
		strings.Repeat("a", maxEmbedOriginLen+1),
	} {
		_, err := normalizeEmbedOrigins([]string{bad})
		fe, ok := err.(FieldError)
		if !ok {
			t.Errorf("%q was accepted (err=%v)", bad, err)
			continue
		}
		if _, has := fe["embedOrigins"]; !has {
			t.Errorf("%q: error %v is not under embedOrigins", bad, fe)
		}
	}

	many := make([]string, maxEmbedOrigins+1)
	for i := range many {
		many[i] = "https://s" + string(rune('a'+i)) + ".example.com"
	}
	if _, err := normalizeEmbedOrigins(many); err == nil {
		t.Fatal("more sites than the limit were accepted")
	}
}

func TestContentSecurityPolicy(t *testing.T) {
	off := contentSecurityPolicy(nil)
	for _, want := range []string{
		"default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'",
		"base-uri 'none'", "form-action 'self'", "connect-src 'self'", "frame-ancestors 'none'",
	} {
		if !strings.Contains(off, want) {
			t.Errorf("default policy is missing %q:\n%s", want, off)
		}
	}
	for _, never := range []string{"unsafe-inline", "unsafe-eval", "*"} {
		if strings.Contains(off, never) {
			t.Errorf("default policy contains %q:\n%s", never, off)
		}
	}

	on := contentSecurityPolicy([]string{"https://dash.example.com", "http://192.168.1.10:8080"})
	if !strings.HasSuffix(on, "frame-ancestors 'self' https://dash.example.com http://192.168.1.10:8080") {
		t.Fatalf("policy with sites:\n%s", on)
	}
	if strings.Contains(on, "frame-ancestors 'none'") {
		t.Fatal("embedding is on but frames are still blocked")
	}
	// Only frame-ancestors changes with the setting.
	if strings.Split(on, "frame-ancestors")[0] != strings.Split(off, "frame-ancestors")[0] {
		t.Fatal("the setting changed more than frame-ancestors")
	}

	if any := contentSecurityPolicy([]string{"https://a.example.com", "*"}); !strings.HasSuffix(any, "frame-ancestors *") {
		t.Fatalf("any site:\n%s", any)
	}
}

func headersApp(t *testing.T, embed ...string) *App {
	t.Helper()
	store, _ := newExpiryStore(t)
	if len(embed) > 0 {
		s := defaultSettings()
		s.EmbedOrigins = embed
		if _, err := store.UpdateSettings(s); err != nil {
			t.Fatal(err)
		}
	}
	return &App{store: store}
}

func serveWithHeaders(app *App, path string) *httptest.ResponseRecorder {
	h := app.securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("hello"))
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	return rec
}

func TestSecurityHeadersBlockFramingByDefault(t *testing.T) {
	rec := serveWithHeaders(headersApp(t), "/admin/")
	h := rec.Header()
	if h.Get("X-Frame-Options") != "DENY" {
		t.Errorf("X-Frame-Options = %q", h.Get("X-Frame-Options"))
	}
	if !strings.Contains(h.Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Errorf("CSP = %q", h.Get("Content-Security-Policy"))
	}
	if h.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("nosniff = %q", h.Get("X-Content-Type-Options"))
	}
	if h.Get("Referrer-Policy") != "same-origin" {
		t.Errorf("Referrer-Policy = %q", h.Get("Referrer-Policy"))
	}
	if !strings.Contains(h.Get("Permissions-Policy"), "camera=()") {
		t.Errorf("Permissions-Policy = %q", h.Get("Permissions-Policy"))
	}
	if rec.Body.String() != "hello" || h.Get("Content-Type") != "text/plain" {
		t.Fatal("the handler's own response was changed")
	}
}

func TestSecurityHeadersAllowListedSites(t *testing.T) {
	rec := serveWithHeaders(headersApp(t, "https://dash.example.com"), "/admin/api/meta")
	h := rec.Header()
	if got := h.Get("X-Frame-Options"); got != "" {
		t.Fatalf("X-Frame-Options %q would block the allowed site", got)
	}
	if !strings.HasSuffix(h.Get("Content-Security-Policy"), "frame-ancestors 'self' https://dash.example.com") {
		t.Fatalf("CSP = %q", h.Get("Content-Security-Policy"))
	}
	// Everything else stays on.
	if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Referrer-Policy") == "" {
		t.Fatal("the other headers were dropped")
	}
}

func TestSecurityHeadersFollowTheSettingWithoutARestart(t *testing.T) {
	app := headersApp(t)
	if serveWithHeaders(app, "/").Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("blocked by default")
	}
	s := defaultSettings()
	s.EmbedOrigins = []string{"https://dash.example.com"}
	if _, err := app.store.UpdateSettings(s); err != nil {
		t.Fatal(err)
	}
	if serveWithHeaders(app, "/").Header().Get("X-Frame-Options") != "" {
		t.Fatal("the setting did not take effect")
	}
	s.EmbedOrigins = nil
	if _, err := app.store.UpdateSettings(s); err != nil {
		t.Fatal(err)
	}
	if serveWithHeaders(app, "/").Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("turning it off did not take effect")
	}
	// A nil app still protects.
	var none *App
	if serveWithHeaders(none, "/").Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("no app, no protection")
	}
}

func putSettingsBody(app *App, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPut, "/admin/api/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	app.putSettings(rec, req)
	return rec
}

func TestPutSettingsEmbedOrigins(t *testing.T) {
	store, path := newExpiryStore(t)
	app := &App{store: store, audit: newAuditLog(path + ".audit")}
	base := `"activityLimit":20,"rateLimit":120,"auditLimit":100`

	rec := putSettingsBody(app, `{`+base+`,"embedOrigins":[" https://Dash.example.com/ ","http://192.168.1.10:8080"]}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"embedOrigins":["https://dash.example.com","http://192.168.1.10:8080"]`) {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	if got := store.EmbedOrigins(); len(got) != 2 || got[0] != "https://dash.example.com" {
		t.Fatalf("stored %v", got)
	}
	raw, _ := os.ReadFile(filepath.Join(filepath.Dir(path), settingsFileName))
	if !strings.Contains(string(raw), `"embedOrigins": [`) || !strings.Contains(string(raw), "https://dash.example.com") {
		t.Fatalf("settings file:\n%s", raw)
	}

	evs := app.audit.list()
	if len(evs) != 1 || evs[0].Action != "settings" || evs[0].Embed == nil || *evs[0].Embed != "2 sites" {
		t.Fatalf("audit %+v", evs)
	}

	// Leaving the key out keeps the list; the same list again writes no audit entry.
	if rec = putSettingsBody(app, `{`+base+`}`); rec.Code != http.StatusOK || len(store.EmbedOrigins()) != 2 {
		t.Fatalf("absent key: %d %s", rec.Code, rec.Body.String())
	}
	if len(app.audit.list()) != 1 {
		t.Fatal("an unchanged save was logged")
	}

	// A bad entry is refused and the earlier list stays.
	rec = putSettingsBody(app, `{`+base+`,"embedOrigins":["https://ok.example.com","not a site"]}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"embedOrigins"`) {
		t.Fatalf("bad entry: %d %s", rec.Code, rec.Body.String())
	}
	if got := store.EmbedOrigins(); len(got) != 2 || got[0] != "https://dash.example.com" {
		t.Fatalf("a refused save changed the list: %v", got)
	}

	// An empty list turns it off.
	if rec = putSettingsBody(app, `{`+base+`,"embedOrigins":[]}`); rec.Code != http.StatusOK || len(store.EmbedOrigins()) != 0 {
		t.Fatalf("off: %d %s", rec.Code, rec.Body.String())
	}
	if evs = app.audit.list(); len(evs) != 2 || evs[0].Embed == nil || *evs[0].Embed != "off" {
		t.Fatalf("audit after off %+v", evs)
	}

	// Any site.
	if rec = putSettingsBody(app, `{`+base+`,"embedOrigins":["*"]}`); rec.Code != http.StatusOK {
		t.Fatalf("any: %d %s", rec.Code, rec.Body.String())
	}
	if evs = app.audit.list(); *evs[0].Embed != "any site" {
		t.Fatalf("audit for any site %+v", evs[0])
	}
}

func TestGetSettingsListsEmbedOrigins(t *testing.T) {
	app := headersApp(t, "https://dash.example.com")
	rec := httptest.NewRecorder()
	app.getSettings(rec, httptest.NewRequest("GET", "/admin/api/settings", nil))
	if !strings.Contains(rec.Body.String(), `"embedOrigins":["https://dash.example.com"]`) {
		t.Fatalf("%s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"defaults":{`) || !strings.Contains(rec.Body.String(), `"embedOrigins":[]`) {
		t.Fatalf("defaults missing embedOrigins: %s", rec.Body.String())
	}
	none := headersApp(t)
	rec = httptest.NewRecorder()
	none.getSettings(rec, httptest.NewRequest("GET", "/admin/api/settings", nil))
	if !strings.Contains(rec.Body.String(), `"embedOrigins":[]`) {
		t.Fatalf("an unset list must be [] not null: %s", rec.Body.String())
	}
}

func TestEmbedOriginsInAHandEditedFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	settings := filepath.Join(dir, settingsFileName)

	// Old files without the key load and are not rewritten just to add it.
	old := "{\n  \"activityLimit\": 20,\n  \"rateLimit\": 120,\n  \"auditLimit\": 100,\n  \"passwordLogin\": true\n}\n"
	if err := os.WriteFile(settings, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(store.EmbedOrigins()) != 0 {
		t.Fatal("embedding must default to off")
	}
	if b, _ := os.ReadFile(settings); string(b) != old {
		t.Fatalf("an older settings file was rewritten:\n%s", b)
	}

	// Entries are cleaned on load.
	cleaned := "{\n  \"activityLimit\": 20,\n  \"rateLimit\": 120,\n  \"auditLimit\": 100,\n  \"passwordLogin\": true,\n  \"embedOrigins\": [\"https://Dash.Example.com/\"]\n}\n"
	if err := os.WriteFile(settings, []byte(cleaned), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err = OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := store.EmbedOrigins(); len(got) != 1 || got[0] != "https://dash.example.com" {
		t.Fatalf("loaded %v", got)
	}

	// A bad entry turns embedding off instead of guessing, and the check names it.
	bad := strings.Replace(cleaned, `"https://Dash.Example.com/"`, `"https://ok.example.com", "nope"`, 1)
	if err := os.WriteFile(settings, []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	f, _, err := readSettingsFile(settings)
	if err != nil {
		t.Fatal(err)
	}
	problems := f.problems()
	if len(problems) != 1 || !strings.Contains(problems[0], "embedOrigins") || !strings.Contains(problems[0], "nope") {
		t.Fatalf("problems = %v", problems)
	}
	if s, _ := f.resolve(); len(s.EmbedOrigins) != 0 {
		t.Fatalf("a bad entry left embedding on: %v", s.EmbedOrigins)
	}
}

func TestSessionCookieSameSiteFollowsEmbedding(t *testing.T) {
	prev := secureMode
	t.Cleanup(func() { secureMode = prev })

	cookieFor := func(app *App, https bool) *http.Cookie {
		if https {
			secureMode = 1
		} else {
			secureMode = 0
		}
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "http://x/admin/", nil)
		setSessionCookie(rec, req, "abc", true, app.sessionSameSite(req))
		c := rec.Result().Cookies()
		if len(c) != 1 {
			t.Fatalf("cookies %+v", c)
		}
		return c[0]
	}

	off := headersApp(t)
	on := headersApp(t, "https://dash.example.com")

	if c := cookieFor(off, true); c.SameSite != http.SameSiteLaxMode || !c.Secure {
		t.Fatalf("embedding off: %+v", c)
	}
	if c := cookieFor(on, true); c.SameSite != http.SameSiteNoneMode || !c.Secure {
		t.Fatalf("embedding on, HTTPS: want SameSite=None; Secure, got %+v", c)
	}
	// None without Secure is rejected by browsers, so plain HTTP keeps Lax.
	if c := cookieFor(on, false); c.SameSite != http.SameSiteLaxMode || c.Secure {
		t.Fatalf("embedding on, HTTP: %+v", c)
	}
	var none *App
	if c := cookieFor(none, true); c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("nil app: %+v", c)
	}
}
