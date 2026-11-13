package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestScopeAllows(t *testing.T) {
	prefix := func(p string) OpenPath { return OpenPath{Match: OpenMatchPrefix, Path: p} }
	regex := func(p string) OpenPath { return OpenPath{Match: OpenMatchRegex, Path: p} }
	cases := []struct {
		name   string
		scope  *TokenScope
		method string
		path   string
		want   bool
	}{
		{"nil scope allows everything", nil, "DELETE", "/anything", true},
		{"empty scope allows everything", &TokenScope{}, "DELETE", "/anything", true},
		{"method listed", &TokenScope{Methods: []string{"GET", "HEAD"}}, "GET", "/x", true},
		{"method not listed", &TokenScope{Methods: []string{"GET", "HEAD"}}, "POST", "/x", false},
		{"method match ignores case", &TokenScope{Methods: []string{"GET"}}, "get", "/x", true},
		{"methods only means any path", &TokenScope{Methods: []string{"GET"}}, "GET", "/deep/path", true},
		{"prefix matches itself", &TokenScope{Paths: []OpenPath{prefix("/api/v3/series")}}, "POST", "/api/v3/series", true},
		{"prefix matches below", &TokenScope{Paths: []OpenPath{prefix("/api/v3/series")}}, "GET", "/api/v3/series/12", true},
		{"prefix does not match a sibling", &TokenScope{Paths: []OpenPath{prefix("/api/v3/series")}}, "GET", "/api/v3/system/status", false},
		{"paths only means any method", &TokenScope{Paths: []OpenPath{prefix("/a")}}, "DELETE", "/a/b", true},
		{"regex match", &TokenScope{Paths: []OpenPath{regex(`^/items/[0-9]+$`)}}, "GET", "/items/42", true},
		{"regex anchored", &TokenScope{Paths: []OpenPath{regex(`^/items/[0-9]+$`)}}, "GET", "/items/42/edit", false},
		{"any listed path is enough", &TokenScope{Paths: []OpenPath{prefix("/a"), prefix("/b")}}, "GET", "/b/c", true},
		{"method and path both must fit", &TokenScope{Methods: []string{"GET"}, Paths: []OpenPath{prefix("/a")}}, "POST", "/a", false},
		{"method and path both fit", &TokenScope{Methods: []string{"GET"}, Paths: []OpenPath{prefix("/a")}}, "GET", "/a/x", true},
		{"missing leading slash is added", &TokenScope{Paths: []OpenPath{prefix("/a")}}, "GET", "a/x", true},
	}
	for _, c := range cases {
		if got := c.scope.Allows(c.method, c.path); got != c.want {
			t.Errorf("%s: Allows(%s, %s) = %v, want %v", c.name, c.method, c.path, got, c.want)
		}
	}
}

func TestNormalizeScope(t *testing.T) {
	got, err := normalizeScope(&TokenScope{Methods: []string{" post ", "get", "GET", "head"}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got.Methods, ",") != "GET,HEAD,POST" {
		t.Fatalf("methods %v: want upper-cased, de-duplicated and in fixed order", got.Methods)
	}

	for name, in := range map[string]*TokenScope{
		"nil":          nil,
		"empty":        {},
		"empty lists":  {Methods: []string{}, Paths: []OpenPath{}},
		"blank method": nil,
	} {
		if s, err := normalizeScope(in); s != nil || err != nil {
			t.Errorf("%s: want nil scope, got %+v %v", name, s, err)
		}
	}

	bad := []struct {
		name string
		in   *TokenScope
		key  string
	}{
		{"unknown method", &TokenScope{Methods: []string{"GET", "TRACE"}}, "scope.methods"},
		{"blank method", &TokenScope{Methods: []string{" "}}, "scope.methods"},
		{"relative prefix", &TokenScope{Paths: []OpenPath{{Match: OpenMatchPrefix, Path: "api"}}}, "scope.paths.0.path"},
		{"root prefix", &TokenScope{Paths: []OpenPath{{Match: OpenMatchPrefix, Path: "/"}}}, "scope.paths.0.path"},
		{"unanchored regex", &TokenScope{Paths: []OpenPath{{Match: OpenMatchRegex, Path: "/x"}}}, "scope.paths.0.path"},
		{"broken regex", &TokenScope{Paths: []OpenPath{{Match: OpenMatchRegex, Path: "^("}}}, "scope.paths.0.path"},
		{"unknown match kind", &TokenScope{Paths: []OpenPath{{Match: "glob", Path: "/x"}}}, "scope.paths.0.match"},
		{"empty path", &TokenScope{Paths: []OpenPath{{Match: OpenMatchPrefix, Path: " "}}}, "scope.paths.0.path"},
		{"second path is the bad one", &TokenScope{Paths: []OpenPath{{Path: "/ok"}, {Path: "nope"}}}, "scope.paths.1.path"},
	}
	for _, c := range bad {
		_, err := normalizeScope(c.in)
		fe, ok := err.(FieldError)
		if !ok {
			t.Errorf("%s: want a FieldError, got %v", c.name, err)
			continue
		}
		if _, has := fe[c.key]; !has {
			t.Errorf("%s: error %v is not under %s", c.name, fe, c.key)
		}
	}

	many := &TokenScope{}
	for i := 0; i <= maxScopePaths; i++ {
		many.Paths = append(many.Paths, OpenPath{Match: OpenMatchPrefix, Path: "/p"})
	}
	if _, err := normalizeScope(many); err == nil {
		t.Fatal("more than the limit of paths must be refused")
	}

	// A default match kind is prefix, like open paths.
	s, err := normalizeScope(&TokenScope{Paths: []OpenPath{{Path: "/a"}}})
	if err != nil || s.Paths[0].Match != OpenMatchPrefix {
		t.Fatalf("default match: %+v %v", s, err)
	}
}

func TestScopeSummary(t *testing.T) {
	cases := []struct {
		scope *TokenScope
		want  string
	}{
		{nil, ""},
		{&TokenScope{}, ""},
		{&TokenScope{Methods: []string{"GET", "HEAD"}}, "GET, HEAD"},
		{&TokenScope{Paths: []OpenPath{{Path: "/a"}}}, "1 path"},
		{&TokenScope{Methods: []string{"GET"}, Paths: []OpenPath{{Path: "/a"}, {Path: "/b"}}}, "GET · 2 paths"},
	}
	for _, c := range cases {
		if got := c.scope.Summary(); got != c.want {
			t.Errorf("Summary(%+v) = %q, want %q", c.scope, got, c.want)
		}
	}
}

func TestSetTokenScopePersistsAndSurvivesRotate(t *testing.T) {
	store, path := newExpiryStore(t)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("one")
	id := svc.Tokens[0].ID

	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), `"scope"`) {
		t.Fatal("a token with no scope must not write a scope")
	}

	if _, err := store.SetTokenScope("one", "missing", &TokenScope{Methods: []string{"GET"}}); err == nil {
		t.Fatal("an unknown token must be refused")
	}
	if _, err := store.SetTokenScope("one", id, &TokenScope{Methods: []string{"TRACE"}}); err == nil {
		t.Fatal("an invalid scope must be refused")
	}
	if cur, _ := store.Get("one"); cur.Tokens[0].Scope != nil {
		t.Fatal("a refused scope must leave the token as it was")
	}

	want := &TokenScope{Methods: []string{"GET", "HEAD"}, Paths: []OpenPath{{Match: OpenMatchPrefix, Path: "/api/v3/series"}}}
	if _, err := store.SetTokenScope("one", id, want); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RotateTokenID("one", id); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := reopened.Get("one")
	sc := got.Tokens[0].Scope
	if sc == nil || strings.Join(sc.Methods, ",") != "GET,HEAD" || len(sc.Paths) != 1 || sc.Paths[0].Path != "/api/v3/series" {
		t.Fatalf("scope after rotate and reload = %+v", sc)
	}

	cleared, err := reopened.SetTokenScope("one", id, &TokenScope{})
	if err != nil || cleared.Tokens[0].Scope != nil {
		t.Fatalf("an empty scope must clear: %+v %v", cleared.Tokens[0].Scope, err)
	}
	raw, _ = os.ReadFile(path)
	if strings.Contains(string(raw), `"scope"`) {
		t.Fatal("clearing must drop the scope from the file")
	}
}

func TestOldFilesWithoutScopeStillLoad(t *testing.T) {
	store, path := newExpiryStore(t)
	raw := `[{"name":"one","url":"http://127.0.0.1:9","enabled":true,"auth":{},"tokens":[{"id":"a","name":"phone","secret":"s"}]}]`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = store
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, _ := reopened.Get("one")
	if svc.Tokens[0].Scope != nil || !svc.Tokens[0].Scope.Allows("DELETE", "/x") {
		t.Fatal("a token from before scopes must stay unrestricted")
	}
}

func TestResolveCallerCarriesScope(t *testing.T) {
	scope := &TokenScope{Methods: []string{"GET"}}
	svc := Service{
		Name: "one", Enabled: true,
		Tokens: []CallerToken{
			{ID: "a", Name: "ro", Secret: "s-ro", Scope: scope},
			{ID: "b", Name: "full", Secret: "s-full"},
			{ID: "c", Name: "paused", Secret: "s-paused", Paused: true, Scope: scope},
		},
	}
	if got := resolveCaller(svc, bearerReq("s-ro"), time.Now()); !got.Allowed || got.Scope != scope {
		t.Fatalf("scoped token: %+v", got)
	}
	if got := resolveCaller(svc, bearerReq("s-full"), time.Now()); !got.Allowed || got.Scope != nil {
		t.Fatalf("unscoped token: %+v", got)
	}
	if got := resolveCaller(svc, bearerReq("s-paused"), time.Now()); got.Allowed || got.Reason != "paused" {
		t.Fatalf("paused must still win over scope: %+v", got)
	}
}

// scopedProxy serves a service with three tokens through the real mux, so the path the scope sees
// is the path the router hands the proxy.
func scopedProxy(t *testing.T, access AccessMode) (*App, *httptest.Server, *[]string, Service) {
	t.Helper()
	var reached []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = append(reached, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(up.Close)

	store, _ := newExpiryStore(t)
	_, err := store.Create(Service{
		Name: "one", URL: up.URL, Enabled: true, Access: access,
		Auth: UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real-key"}},
		Tokens: []CallerToken{
			{Name: "reader", Secret: "s-reader", Scope: &TokenScope{
				Methods: []string{"GET", "HEAD"},
				Paths:   []OpenPath{{Match: OpenMatchPrefix, Path: "/api/v3/series"}},
			}},
			{Name: "writer", Secret: "s-writer", Scope: &TokenScope{Methods: []string{"POST"}}},
			{Name: "full", Secret: "s-full"},
		},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/ping"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store, activity: newActivityLog(), usage: openTokenUsage("")}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	t.Cleanup(ps.Close)
	svc, _ := store.Get("one")
	return app, ps, &reached, svc
}

func doProxy(t *testing.T, ps *httptest.Server, method, path, bearer string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, ps.URL+path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	// Do not follow redirects: a cleaned-path redirect must be visible, not silently retried.
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func TestProxyEnforcesScope(t *testing.T) {
	app, ps, reached, svc := scopedProxy(t, AccessPostern)

	// Inside the scope.
	if code, _ := doProxy(t, ps, "GET", "/p/one/api/v3/series", "s-reader"); code != http.StatusNoContent {
		t.Fatalf("in scope: %d", code)
	}
	if code, _ := doProxy(t, ps, "HEAD", "/p/one/api/v3/series/9", "s-reader"); code != http.StatusNoContent {
		t.Fatalf("in scope below the prefix: %d", code)
	}
	if len(*reached) != 2 {
		t.Fatalf("upstream saw %v", *reached)
	}
	readerID := svc.Tokens[0].ID
	if app.usage.lastUsed(readerID).IsZero() {
		t.Fatal("an allowed call must record last used")
	}

	// Outside the scope: wrong method, wrong path.
	before := len(*reached)
	for _, c := range []struct{ method, path, token string }{
		{"POST", "/p/one/api/v3/series", "s-reader"},
		{"DELETE", "/p/one/api/v3/series/9", "s-reader"},
		{"GET", "/p/one/api/v3/system/status", "s-reader"},
		{"GET", "/p/one/", "s-reader"},
		{"GET", "/p/one/anything", "s-writer"},
	} {
		code, body := doProxy(t, ps, c.method, c.path, c.token)
		if code != http.StatusForbidden || !strings.Contains(body, "token scope") {
			t.Errorf("%s %s with %s: %d %q, want 403 token scope", c.method, c.path, c.token, code, body)
		}
	}
	if len(*reached) != before {
		t.Fatalf("a refused request reached the upstream: %v", (*reached)[before:])
	}

	// Methods-only and unscoped tokens.
	if code, _ := doProxy(t, ps, "POST", "/p/one/any/path", "s-writer"); code != http.StatusNoContent {
		t.Fatalf("methods-only token on any path: %d", code)
	}
	if code, _ := doProxy(t, ps, "DELETE", "/p/one/any/path", "s-full"); code != http.StatusNoContent {
		t.Fatalf("unscoped token: %d", code)
	}

	// The activity log names the token and the reason, and a refusal does not count as use.
	var scoped []activityEvent
	for _, ev := range app.activity.list("one") {
		if ev.Reason == "scope" {
			scoped = append(scoped, ev)
		}
	}
	if len(scoped) != 5 {
		t.Fatalf("scope refusals logged = %d, want 5: %+v", len(scoped), scoped)
	}
	for _, ev := range scoped {
		if ev.Status != http.StatusForbidden || (ev.Who != "reader" && ev.Who != "writer") {
			t.Fatalf("scope event %+v", ev)
		}
	}
	writerID := svc.Tokens[1].ID
	if app.usage.lastUsed(writerID).IsZero() {
		t.Fatal("the writer made one allowed call")
	}
}

func TestScopeRefusalDoesNotCountAsUse(t *testing.T) {
	app, ps, _, svc := scopedProxy(t, AccessPostern)
	if code, _ := doProxy(t, ps, "GET", "/p/one/nope", "s-reader"); code != http.StatusForbidden {
		t.Fatalf("status %d", code)
	}
	if !app.usage.lastUsed(svc.Tokens[0].ID).IsZero() {
		t.Fatal("a call refused by scope must not update last used")
	}
}

func TestScopeCannotBeEscapedWithDotSegments(t *testing.T) {
	_, ps, reached, _ := scopedProxy(t, AccessPostern)
	for _, p := range []string{
		"/p/one/api/v3/series/../system/status",
		"/p/one/api/v3/series/%2e%2e/system/status",
		"/p/one/api/v3/series/%2E%2E/system/status",
		"/p/one/api/v3/series/..%2fsystem/status",
		"/p/one/api/v3/series/..%5csystem/status",
		"/p/one/api/v3/series/./../../admin",
		"/p/one//api/v3/series",
	} {
		if code, _ := doProxy(t, ps, "GET", p, "s-reader"); code == http.StatusNoContent {
			t.Errorf("%s reached the upstream", p)
		}
	}
	for _, line := range *reached {
		t.Errorf("upstream received %q", line)
	}
}

func TestDotSegmentsAreRefusedEvenOnOpenPaths(t *testing.T) {
	_, ps, reached, _ := scopedProxy(t, AccessPostern)
	// /ping is an open path, so a request under it needs no token; it must not be able to walk out.
	code, body := doProxy(t, ps, "GET", "/p/one/ping/%2e%2e/admin", "")
	if code != http.StatusBadRequest || !strings.Contains(body, "bad path") {
		t.Fatalf("open path escape: %d %q", code, body)
	}
	if len(*reached) != 0 {
		t.Fatalf("upstream received %v", *reached)
	}
}

func TestHasDotSegment(t *testing.T) {
	for rest, want := range map[string]bool{
		"/":              false,
		"/api/v3/series": false,
		"/a..b/c":        false,
		"/file.":         false,
		"/.hidden":       false,
		"/...":           false,
		"/..":            true,
		"/.":             true,
		"/a/../b":        true,
		"/a/./b":         true,
		"/a/b/..":        true,
		`/a\..\b`:        true,
		"/a/..%2fb":      false, // still encoded here; the router decodes it before the proxy sees it
		"/a/.%2e/b":      false,
	} {
		if got := hasDotSegment(rest); got != want {
			t.Errorf("hasDotSegment(%q) = %v, want %v", rest, got, want)
		}
	}
}

func TestScopeDoesNotApplyToOpenPathsOrRealUpstreamKey(t *testing.T) {
	_, ps, _, _ := scopedProxy(t, AccessPostern)
	// An open path skips the token check, so no token and no scope are involved.
	if code, _ := doProxy(t, ps, "GET", "/p/one/ping", ""); code != http.StatusNoContent {
		t.Fatalf("open path: %d", code)
	}

	// Upstream-key mode: the scoped token is limited, the real upstream key is not a token.
	_, ups, _, _ := scopedProxy(t, AccessUpstream)
	req, _ := http.NewRequest("DELETE", ups.URL+"/p/one/anything", nil)
	req.Header.Set("X-Api-Key", "real-key")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("real upstream key in upstream mode: %d", res.StatusCode)
	}
	req, _ = http.NewRequest("DELETE", ups.URL+"/p/one/anything", nil)
	req.Header.Set("X-Api-Key", "s-reader")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("scoped token in upstream mode: %d, want 403", res.StatusCode)
	}
}

func TestPatchTokenScope(t *testing.T) {
	store, _ := newExpiryStore(t)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("one")
	id := svc.Tokens[0].ID
	dir := t.TempDir()
	app := &App{store: store, usage: openTokenUsage(""), audit: newAuditLog(dir + "/audit.jsonl")}

	// Nothing to change.
	if rec := patchTokenReq(app, "one", id, `{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty patch: %d %s", rec.Code, rec.Body.String())
	}

	// Set.
	rec := patchTokenReq(app, "one", id, `{"scope":{"methods":["head","get"],"paths":[{"match":"prefix","path":"/api/v3/series"}]}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set: %d %s", rec.Code, rec.Body.String())
	}
	var v view
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	sc := v.Tokens[0].Scope
	if sc == nil || strings.Join(sc.Methods, ",") != "GET,HEAD" || len(sc.Paths) != 1 {
		t.Fatalf("view scope %+v", sc)
	}

	// The audit log records a summary and no secret.
	evs := app.audit.list()
	if len(evs) != 1 || evs[0].Action != "token_scope" || evs[0].Scope != "GET, HEAD · 1 path" || evs[0].Token != svc.Tokens[0].Name {
		t.Fatalf("audit %+v", evs)
	}
	line, _ := json.Marshal(evs[0])
	if strings.Contains(string(line), svc.Tokens[0].Secret) {
		t.Fatal("the audit entry carries a secret")
	}

	// A field error names the field the form should mark.
	rec = patchTokenReq(app, "one", id, `{"scope":{"methods":["GET"],"paths":[{"match":"regex","path":"/nope"}]}}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "scope.paths.0.path") {
		t.Fatalf("invalid scope: %d %s", rec.Code, rec.Body.String())
	}
	rec = patchTokenReq(app, "one", id, `{"scope":"GET"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("scope that is not an object: %d %s", rec.Code, rec.Body.String())
	}
	if cur, _ := store.Get("one"); cur.Tokens[0].Scope == nil {
		t.Fatal("a refused change must keep the earlier scope")
	}

	// Combined with a pause, both apply.
	rec = patchTokenReq(app, "one", id, `{"paused":true,"scope":{"methods":["POST"]}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("combined: %d %s", rec.Code, rec.Body.String())
	}
	cur, _ := store.Get("one")
	if !cur.Tokens[0].Paused || strings.Join(cur.Tokens[0].Scope.Methods, ",") != "POST" {
		t.Fatalf("combined result %+v", cur.Tokens[0])
	}

	// null and an empty object both remove it, and a pause alone leaves it alone.
	if rec = patchTokenReq(app, "one", id, `{"paused":false}`); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	if cur, _ = store.Get("one"); cur.Tokens[0].Scope == nil {
		t.Fatal("a patch without scope must not clear it")
	}
	if rec = patchTokenReq(app, "one", id, `{"scope":null}`); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	if cur, _ = store.Get("one"); cur.Tokens[0].Scope != nil {
		t.Fatal("null must clear the scope")
	}
	patchTokenReq(app, "one", id, `{"scope":{"methods":["GET"]}}`)
	if rec = patchTokenReq(app, "one", id, `{"scope":{}}`); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}
	if cur, _ = store.Get("one"); cur.Tokens[0].Scope != nil {
		t.Fatal("an empty scope must clear it")
	}
	last := app.audit.list()[0]
	if last.Action != "token_scope" || last.Scope != "" {
		t.Fatalf("clearing is logged with an empty summary: %+v", last)
	}
}
