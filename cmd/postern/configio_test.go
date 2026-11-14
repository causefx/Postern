package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

const (
	sonarrKey = "sonarr-upstream-key-1234"
	radarrKey = "radarr-upstream-key-5678"
)

// configFixture is a store with three services that cover every field an export carries.
func configFixture(t *testing.T) (*Store, string) {
	t.Helper()
	store, path := newExpiryStore(t)
	mk := func(svc Service) Service {
		got, err := store.Create(svc)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	mk(Service{
		Name: "sonarr", URL: "https://sonarr.example.com", Enabled: true,
		Auth:      UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: sonarrKey}},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/ping"}},
	})
	mk(Service{
		Name: "radarr", URL: "http://192.168.1.10:7878", Enabled: false,
		Auth: UpstreamAuth{Query: &QueryAuth{Name: "apikey", Secret: radarrKey}, Authz: &AuthzAuth{Kind: AuthzBasic, Username: "bob", Secret: "basic-password-99"}},
		Gate: &CallerGate{Bearer: true, Header: &GateHeader{Name: "X-Caller"}},
	})
	mk(Service{Name: "plain", URL: "http://plain.local", Enabled: true})

	svc, _ := store.Get("sonarr")
	if _, err := store.AddToken("sonarr", "phone"); err != nil {
		t.Fatal(err)
	}
	svc, _ = store.Get("sonarr")
	phone := svc.Tokens[1]
	if _, err := store.SetTokenScope("sonarr", phone.ID, &TokenScope{Methods: []string{"GET"}, Paths: []OpenPath{{Match: OpenMatchPrefix, Path: "/api"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetTokenPaused("sonarr", phone.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetTokenExpiry("sonarr", phone.ID, time.Now().Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}
	return store, path
}

func marshalConfig(t *testing.T, doc configFile) []byte {
	t.Helper()
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestExportRedactedCarriesNoSecret(t *testing.T) {
	store, _ := configFixture(t)
	doc, stats := store.ExportConfig(false, time.Now())
	raw := string(marshalConfig(t, doc))

	if !doc.Redacted || doc.Version != configFormat || len(doc.Services) != 3 || stats.Secrets != 0 {
		t.Fatalf("doc %+v stats %+v", doc, stats)
	}
	secrets := []string{sonarrKey, radarrKey, "basic-password-99"}
	for _, svc := range store.List() {
		for _, tok := range svc.Tokens {
			secrets = append(secrets, tok.Secret, tok.ID)
		}
	}
	for _, s := range secrets {
		if strings.Contains(raw, s) {
			t.Fatalf("a redacted export contains %q:\n%s", s, raw)
		}
	}
	// The slot is still there, empty, so a person editing the file sees where the key goes.
	if !strings.Contains(raw, `"auth":{"header":{"name":"X-Api-Key","secret":""}}`) {
		t.Fatalf("redacted export should keep empty secret slots:\n%s", raw)
	}
	// Names, scope, pause and expiry survive.
	if !strings.Contains(raw, `"name":"phone"`) || !strings.Contains(raw, `"paused":true`) || !strings.Contains(raw, `"expiresAt"`) || !strings.Contains(raw, `"methods":["GET"]`) {
		t.Fatalf("token settings missing:\n%s", raw)
	}
}

func TestExportFullCarriesEverything(t *testing.T) {
	store, _ := configFixture(t)
	doc, stats := store.ExportConfig(true, time.Now())
	raw := string(marshalConfig(t, doc))
	if doc.Redacted {
		t.Fatal("a full export is not redacted")
	}
	// 3 upstream keys + basic password on radarr = 3 slots with secrets... plus 4 tokens.
	for _, s := range []string{sonarrKey, radarrKey, "basic-password-99"} {
		if !strings.Contains(raw, s) {
			t.Fatalf("full export is missing %q", s)
		}
	}
	for _, svc := range store.List() {
		for _, tok := range svc.Tokens {
			if !strings.Contains(raw, tok.Secret) || !strings.Contains(raw, tok.ID) {
				t.Fatalf("full export is missing token %s", tok.Name)
			}
		}
	}
	if stats.Services != 3 || stats.Secrets != 3+4 {
		t.Fatalf("stats %+v, want 3 services and 7 secrets", stats)
	}
}

func sameService(t *testing.T, got, want Service) {
	t.Helper()
	g, _ := json.Marshal(got)
	w, _ := json.Marshal(want)
	if string(g) != string(w) {
		t.Fatalf("service differs\n got %s\nwant %s", g, w)
	}
}

func TestFullBackupRoundTrip(t *testing.T) {
	src, _ := configFixture(t)
	doc, _ := src.ExportConfig(true, time.Now())
	// Through the wire format, as the browser sends it.
	parsed, err := parseConfig(marshalConfig(t, doc))
	if err != nil {
		t.Fatal(err)
	}

	dst, path := newExpiryStore(t)
	out, err := dst.ImportConfig(parsed, false, false)
	if err != nil || !out.Applied || out.Counts.Create != 3 {
		t.Fatalf("import: %+v %v", out, err)
	}
	for _, want := range src.List() {
		got, ok := dst.Get(want.Name)
		if !ok {
			t.Fatalf("%s was not imported", want.Name)
		}
		sameService(t, got, want)
	}

	// It was saved, and the saved file loads.
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range src.List() {
		got, _ := reopened.Get(want.Name)
		sameService(t, got, want)
	}
}

func TestRedactedImportNeedsTheKeysBack(t *testing.T) {
	src, _ := configFixture(t)
	doc, _ := src.ExportConfig(false, time.Now())

	dst, path := newExpiryStore(t)
	before, _ := os.ReadFile(path)
	out, err := dst.ImportConfig(doc, false, true)
	if err != errImportHasErrors {
		t.Fatalf("dry run err = %v, want errImportHasErrors", err)
	}
	byName := map[string]importResult{}
	for _, r := range out.Results {
		byName[r.Name] = r
	}
	if r := byName["sonarr"]; r.Action != importError || !strings.Contains(r.Errors["auth.header.secret"], "the file is redacted") {
		t.Fatalf("sonarr: %+v", r)
	}
	if r := byName["radarr"]; r.Action != importError || r.Errors["auth.query.secret"] == "" || r.Errors["auth.authz.secret"] == "" {
		t.Fatalf("radarr should report every missing key: %+v", r)
	}
	if r := byName["plain"]; r.Action != importCreate {
		t.Fatalf("a service with no upstream key needs nothing: %+v", r)
	}

	// A real import is refused as a whole: "plain" was fine, but nothing is written.
	if _, err := dst.ImportConfig(doc, false, false); err != errImportHasErrors {
		t.Fatalf("import err = %v", err)
	}
	if len(dst.List()) != 0 {
		t.Fatal("an import with errors must write nothing")
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("an import with errors must not touch the data file")
	}

	// Fill the keys in, as a person editing the file would, and it goes through with new tokens.
	for i := range doc.Services {
		cs := &doc.Services[i]
		if cs.Auth.Header != nil {
			cs.Auth.Header.Secret = "filled-in-header-key"
		}
		if cs.Auth.Query != nil {
			cs.Auth.Query.Secret = "filled-in-query-key"
		}
		if cs.Auth.Authz != nil {
			cs.Auth.Authz.Secret = "filled-in-basic-pw"
		}
	}
	out, err = dst.ImportConfig(doc, false, false)
	if err != nil || !out.Applied || out.Counts.Create != 3 {
		t.Fatalf("filled import: %+v %v", out, err)
	}
	got, _ := dst.Get("sonarr")
	orig, _ := src.Get("sonarr")
	if got.Auth.Header.Secret != "filled-in-header-key" {
		t.Fatalf("upstream key %q", got.Auth.Header.Secret)
	}
	if len(got.Tokens) != 2 || got.Tokens[0].Name != orig.Tokens[0].Name || got.Tokens[1].Name != "phone" {
		t.Fatalf("token names %+v", got.Tokens)
	}
	for i, tok := range got.Tokens {
		if tok.Secret == orig.Tokens[i].Secret || tok.ID == orig.Tokens[i].ID {
			t.Fatalf("a redacted import must mint a new secret and id for %s", tok.Name)
		}
		if len(tok.Secret) != 48 {
			t.Fatalf("minted secret %q", tok.Secret)
		}
	}
	if got.Tokens[1].Scope == nil || !got.Tokens[1].Paused || got.Tokens[1].ExpiresAt.IsZero() {
		t.Fatalf("scope, pause and expiry must come across: %+v", got.Tokens[1])
	}
	if got.Token != got.Tokens[0].Secret {
		t.Fatal("the legacy token field must follow the first token")
	}
}

func TestRedactedOverwriteKeepsKeysAndMatchingTokens(t *testing.T) {
	store, _ := configFixture(t)
	before, _ := store.Get("sonarr")
	doc, _ := store.ExportConfig(false, time.Now())

	// Edit the file: change the URL, rename the "phone" token to "tablet", and keep the first one.
	for i := range doc.Services {
		cs := &doc.Services[i]
		if cs.Name != "sonarr" {
			continue
		}
		cs.URL = "https://new.example.com/"
		cs.Tokens[1].Name = "tablet"
	}

	// Without overwrite everything is skipped.
	out, err := store.ImportConfig(doc, false, false)
	if err != errNothingToImport || out.Counts.Skip != 3 {
		t.Fatalf("no overwrite: %+v %v", out, err)
	}

	out, err = store.ImportConfig(doc, true, false)
	if err != nil || !out.Applied || out.Counts.Overwrite != 3 {
		t.Fatalf("overwrite: %+v %v", out, err)
	}
	after, _ := store.Get("sonarr")
	if after.URL != "https://new.example.com" {
		t.Fatalf("url %q", after.URL)
	}
	if after.Auth.Header.Secret != sonarrKey {
		t.Fatal("the upstream key is kept when the file has none")
	}
	if after.Tokens[0].ID != before.Tokens[0].ID || after.Tokens[0].Secret != before.Tokens[0].Secret {
		t.Fatal("a token with the same name keeps its id and secret, so callers keep working")
	}
	if after.Tokens[1].Name != "tablet" || after.Tokens[1].Secret == before.Tokens[1].Secret || after.Tokens[1].ID == before.Tokens[1].ID {
		t.Fatalf("a renamed token is a new token: %+v", after.Tokens[1])
	}
	if len(out.Removed) != 1 || out.Removed[0] != before.Tokens[1].ID {
		t.Fatalf("removed ids %v, want the old phone token", out.Removed)
	}
}

func TestImportSkipsExistingAndDryRunWritesNothing(t *testing.T) {
	store, path := configFixture(t)
	doc := configFile{Version: 1, Services: []configService{
		{Name: "sonarr", URL: "http://x.example.com"},
		{Name: "fresh", URL: "http://fresh.example.com"},
	}}
	before, _ := os.ReadFile(path)

	out, err := store.ImportConfig(doc, false, true)
	if err != nil || out.Applied || out.Counts.Skip != 1 || out.Counts.Create != 1 {
		t.Fatalf("dry run: %+v %v", out, err)
	}
	if out.Results[0].Action != importSkip || out.Results[0].Reason != "exists" || out.Results[1].Action != importCreate {
		t.Fatalf("results %+v", out.Results)
	}
	if after, _ := os.ReadFile(path); string(before) != string(after) {
		t.Fatal("a dry run must not write")
	}
	if _, ok := store.Get("fresh"); ok {
		t.Fatal("a dry run must not add the service")
	}

	out, err = store.ImportConfig(doc, false, false)
	if err != nil || !out.Applied {
		t.Fatalf("import: %+v %v", out, err)
	}
	if got, _ := store.Get("sonarr"); got.URL != "https://sonarr.example.com" {
		t.Fatal("a skipped service must stay as it was")
	}
	fresh, ok := store.Get("fresh")
	if !ok || len(fresh.Tokens) != 1 || fresh.Tokens[0].Name != "default" || !fresh.Enabled {
		t.Fatalf("a service with no tokens gets a default one, and is on unless the file says so: %+v", fresh)
	}
}

func TestImportReportsEveryProblem(t *testing.T) {
	store, _ := newExpiryStore(t)
	manyTokens := make([]configToken, maxCallerTokens+1)
	for i := range manyTokens {
		manyTokens[i] = configToken{Name: "t"}
	}
	doc := configFile{Version: 1, Services: []configService{
		{Name: "Bad Name", URL: "http://ok.example.com"},
		{Name: "twice", URL: "http://a.example.com"},
		{Name: "twice", URL: "http://b.example.com"},
		{Name: "no-scheme", URL: "readarr:8787/"},
		{Name: "short-secret", URL: "http://a.example.com", Tokens: []configToken{{Name: "x", Secret: "short"}}},
		{Name: "spaces", URL: "http://a.example.com", Tokens: []configToken{{Name: "x", Secret: "has a space in it 12345"}}},
		{Name: "same-secret", URL: "http://a.example.com", Tokens: []configToken{{Name: "a", Secret: "0123456789abcdef"}, {Name: "b", Secret: "0123456789abcdef"}}},
		{Name: "too-many", URL: "http://a.example.com", Tokens: manyTokens},
		{Name: "bad-scope", URL: "http://a.example.com", Tokens: []configToken{{Name: "x", Scope: &TokenScope{Paths: []OpenPath{{Match: OpenMatchRegex, Path: "/nope"}}}}}},
		{Name: "bad-paths", URL: "http://a.example.com", OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/"}}},
		{Name: "bad-gate", URL: "http://a.example.com", Gate: &CallerGate{}},
		{Name: "upstream-no-auth", URL: "http://a.example.com", Access: AccessUpstream},
		{Name: "bad-header", URL: "http://a.example.com", Auth: configAuth{Header: &configHeader{Name: "Host", Secret: "abc"}}},
	}}
	out, err := store.ImportConfig(doc, false, true)
	if err != errImportHasErrors {
		t.Fatalf("err = %v", err)
	}
	want := map[string]string{
		"Bad Name":         "name",
		"twice":            "", // the first is fine, the second is the duplicate (checked below)
		"no-scheme":        "url",
		"short-secret":     "tokens.0.secret",
		"spaces":           "tokens.0.secret",
		"same-secret":      "tokens.1.secret",
		"too-many":         "tokens",
		"bad-scope":        "tokens.0.scope.paths.0.path",
		"bad-paths":        "openPaths.0.path",
		"bad-gate":         "gate",
		"upstream-no-auth": "access",
		"bad-header":       "auth.header.name",
	}
	seenTwice := 0
	for _, r := range out.Results {
		if r.Name == "twice" {
			seenTwice++
			if seenTwice == 1 && r.Action != importCreate {
				t.Fatalf("first twice: %+v", r)
			}
			if seenTwice == 2 && (r.Action != importError || r.Errors["name"] == "") {
				t.Fatalf("second twice: %+v", r)
			}
			continue
		}
		key, ok := want[r.Name]
		if !ok {
			// "Bad Name" is lower-cased to "bad name", and still invalid.
			key = want["Bad Name"]
		}
		if r.Action != importError || r.Errors[key] == "" {
			t.Errorf("%s: want an error under %q, got %+v", r.Name, key, r)
		}
	}
	if len(store.List()) != 0 {
		t.Fatal("nothing may be written")
	}
}

func TestParseConfig(t *testing.T) {
	good := `{"version":1,"exported":"2026-11-13T16:11:00Z","redacted":true,"services":[{"name":"a","url":"http://a.example.com"}]}`
	doc, err := parseConfig([]byte(good))
	if err != nil || !doc.Redacted || len(doc.Services) != 1 {
		t.Fatalf("good file: %+v %v", doc, err)
	}
	cases := map[string]struct{ in, msg string }{
		"not json":        {`{"version":`, "not valid JSON"},
		"extra content":   {good + ` {}`, "extra content"},
		"unknown field":   {`{"version":1,"services":[{"name":"a","url":"http://a","openPath":[]}]}`, "openPath"},
		"no version":      {`{"services":[{"name":"a","url":"http://a"}]}`, "no version"},
		"newer version":   {`{"version":2,"services":[{"name":"a","url":"http://a"}]}`, "newer Postern"},
		"no services":     {`{"version":1,"services":[]}`, "no services"},
		"wrong shape":     {`[]`, "does not look like"},
		"services string": {`{"version":1,"services":"x"}`, "does not look like"},
	}
	for name, c := range cases {
		if _, err := parseConfig([]byte(c.in)); err == nil || !strings.Contains(err.Error(), c.msg) {
			t.Errorf("%s: err = %v, want it to mention %q", name, err, c.msg)
		}
	}
}

func configApp(t *testing.T, store *Store) *App {
	t.Helper()
	return &App{store: store, usage: openTokenUsage(""), audit: newAuditLog(t.TempDir() + "/audit.jsonl")}
}

func postConfig(h http.HandlerFunc, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/admin/api/x", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestExportEndpoint(t *testing.T) {
	store, _ := configFixture(t)
	app := configApp(t, store)

	if rec := postConfig(app.exportConfig, `{"mode":"nope"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad mode: %d", rec.Code)
	}
	rec := postConfig(app.exportConfig, `{"mode":"full"}`)
	if rec.Code != http.StatusBadRequest || strings.Contains(rec.Body.String(), sonarrKey) {
		t.Fatalf("full without confirm: %d %s", rec.Code, rec.Body.String())
	}
	if len(app.audit.list()) != 0 {
		t.Fatal("a refused export must not be logged")
	}

	rec = postConfig(app.exportConfig, `{"mode":"redacted"}`)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), sonarrKey) || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("redacted: %d %s", rec.Code, rec.Body.String())
	}
	if len(app.audit.list()) != 0 {
		t.Fatal("a redacted export holds no secret and is not logged")
	}

	rec = postConfig(app.exportConfig, `{"mode":"full","confirm":true}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), sonarrKey) || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("full: %d %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		File     configFile `json:"file"`
		Services int        `json:"services"`
		Secrets  int        `json:"secrets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Services != 3 || resp.Secrets != 7 || resp.File.Redacted {
		t.Fatalf("response %+v", resp)
	}
	evs := app.audit.list()
	if len(evs) != 1 || evs[0].Action != "export" || evs[0].Mode != "full" || evs[0].Detail != "3 services, 7 secrets" {
		t.Fatalf("audit %+v", evs)
	}
	line, _ := json.Marshal(evs[0])
	if strings.Contains(string(line), sonarrKey) {
		t.Fatal("the audit entry carries a secret")
	}
}

func TestImportEndpoint(t *testing.T) {
	src, _ := configFixture(t)
	full, _ := src.ExportConfig(true, time.Now())
	body := func(doc configFile, overwrite, dry bool) string {
		b, _ := json.Marshal(map[string]any{"config": json.RawMessage(marshalConfig(t, doc)), "overwrite": overwrite, "dryRun": dry})
		return string(b)
	}

	dst, _ := newExpiryStore(t)
	app := configApp(t, dst)

	// Dry run: counts and rows, nothing written, nothing logged.
	rec := postConfig(app.importConfig, body(full, false, true))
	if rec.Code != http.StatusOK {
		t.Fatalf("dry run: %d %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Redacted bool           `json:"redacted"`
		Services int            `json:"services"`
		DryRun   bool           `json:"dryRun"`
		Applied  bool           `json:"applied"`
		Counts   importCounts   `json:"counts"`
		Results  []importResult `json:"results"`
		Error    string         `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Redacted || resp.Services != 3 || !resp.DryRun || resp.Applied || resp.Counts.Create != 3 || len(resp.Results) != 3 {
		t.Fatalf("dry run body %+v", resp)
	}
	if len(dst.List()) != 0 || len(app.audit.list()) != 0 {
		t.Fatal("a dry run must write and log nothing")
	}

	// A dry run with problems is still a 200 that reports them.
	redacted, _ := src.ExportConfig(false, time.Now())
	rec = postConfig(app.importConfig, body(redacted, false, true))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"error":2`) {
		t.Fatalf("dry run with errors: %d %s", rec.Code, rec.Body.String())
	}
	// A real import with problems is a 400 that carries the same rows, and writes nothing.
	rec = postConfig(app.importConfig, body(redacted, false, false))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "the file is redacted") || len(dst.List()) != 0 {
		t.Fatalf("import with errors: %d %s", rec.Code, rec.Body.String())
	}

	// The real thing.
	rec = postConfig(app.importConfig, body(full, false, false))
	if rec.Code != http.StatusOK || len(dst.List()) != 3 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	evs := app.audit.list()
	if len(evs) != 1 || evs[0].Action != "import" || evs[0].Mode != "full" || evs[0].Detail != "3 created" {
		t.Fatalf("audit %+v", evs)
	}
	line, _ := json.Marshal(evs[0])
	if strings.Contains(string(line), sonarrKey) {
		t.Fatal("the audit entry carries a secret")
	}

	// Again with nothing new: refused, not logged twice.
	rec = postConfig(app.importConfig, body(full, false, false))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "nothing to import") || len(app.audit.list()) != 1 {
		t.Fatalf("second import: %d %s", rec.Code, rec.Body.String())
	}

	// Bad input.
	for name, in := range map[string]string{
		"not json":       `nope`,
		"no config":      `{}`,
		"null config":    `{"config":null}`,
		"not a config":   `{"config":{"hello":"world"}}`,
		"empty services": `{"config":{"version":1,"services":[]}}`,
	} {
		if rec := postConfig(app.importConfig, in); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
}

func TestImportEndpointTooLarge(t *testing.T) {
	store, _ := newExpiryStore(t)
	app := configApp(t, store)
	big := `{"config":"` + strings.Repeat("a", maxImportBytes+10) + `"}`
	if rec := postConfig(app.importConfig, big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body: %d", rec.Code)
	}
}

func TestImportedTokenIDsNeverCollide(t *testing.T) {
	src, _ := configFixture(t)
	full, _ := src.ExportConfig(true, time.Now())

	// Import the same backup under new names into a store that already holds the original ids.
	for i := range full.Services {
		full.Services[i].Name += "-copy"
	}
	out, err := src.ImportConfig(full, false, false)
	if err != nil || out.Counts.Create != 3 {
		t.Fatalf("%+v %v", out, err)
	}
	seen := map[string]string{}
	for _, svc := range src.List() {
		for _, tok := range svc.Tokens {
			if who, dup := seen[tok.ID]; dup {
				t.Fatalf("token id %s is on both %s and %s", tok.ID, who, svc.Name)
			}
			seen[tok.ID] = svc.Name
		}
	}
	if len(seen) != 8 {
		t.Fatalf("expected 8 distinct token ids, got %d", len(seen))
	}
}
