package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyHeader(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/api?x=1", nil)
	req.Header.Set("Authorization", "Bearer caller")
	req.Header.Set("X-Api-Key", "caller-override")
	auth := UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real-key"}}
	auth.Apply(req)
	if got := req.Header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization still present: %q", got)
	}
	if got := req.Header.Get("X-Api-Key"); got != "real-key" {
		t.Fatalf("X-Api-Key = %q", got)
	}
}

func TestApplyMultiSlot(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/api?apikey=bad", nil)
	req.Header.Set("Authorization", "Bearer caller")
	req.Header.Set("X-Api-Key", "bad")
	auth := UpstreamAuth{
		Header: &HeaderAuth{Name: "X-Api-Key", Secret: "h"},
		Query:  &QueryAuth{Name: "apikey", Secret: "q"},
		Authz:  &AuthzAuth{Kind: AuthzBearer, Secret: "b"},
	}
	auth.Apply(req)
	if req.Header.Get("X-Api-Key") != "h" {
		t.Fatalf("header=%q", req.Header.Get("X-Api-Key"))
	}
	if req.URL.Query().Get("apikey") != "q" {
		t.Fatalf("query=%q", req.URL.Query().Get("apikey"))
	}
	if req.Header.Get("Authorization") != "Bearer b" {
		t.Fatalf("authz=%q", req.Header.Get("Authorization"))
	}
}

func TestApplyBearer(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/", nil)
	req.Header.Set("Authorization", "Bearer caller")
	auth := UpstreamAuth{Authz: &AuthzAuth{Kind: AuthzBearer, Secret: "tok"}}
	auth.Apply(req)
	if got := req.Header.Get("Authorization"); got != "Bearer tok" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestApplyBasic(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/", nil)
	req.Header.Set("Authorization", "Bearer caller")
	auth := UpstreamAuth{Authz: &AuthzAuth{Kind: AuthzBasic, Username: "u", Secret: "p"}}
	auth.Apply(req)
	u, p, ok := req.BasicAuth()
	if !ok || u != "u" || p != "p" {
		t.Fatalf("basic auth = %v %q %q", ok, u, p)
	}
}

func TestApplyQueryStripsOverride(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/api?apikey=caller&keep=1", nil)
	req.Header.Set("Authorization", "Bearer caller")
	auth := UpstreamAuth{Query: &QueryAuth{Name: "apikey", Secret: "real"}}
	auth.Apply(req)
	if got := req.Header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization still present")
	}
	q := req.URL.Query()
	if q.Get("apikey") != "real" {
		t.Fatalf("apikey = %q", q.Get("apikey"))
	}
	if q.Get("keep") != "1" {
		t.Fatalf("keep lost")
	}
}

func TestApplyNone(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/", nil)
	req.Header.Set("Authorization", "Bearer caller")
	UpstreamAuth{}.Apply(req)
	if req.Header.Get("Authorization") != "" {
		t.Fatal("Authorization not stripped")
	}
}

func TestApplyWebsocketUpgradeRequest(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/ws", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Authorization", "Bearer caller")
	req.Header.Set("X-Api-Key", "bad")
	auth := UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "good"}}
	auth.Apply(req)
	if req.Header.Get("X-Api-Key") != "good" {
		t.Fatal("ws upgrade missing injected auth")
	}
	if req.Header.Get("Authorization") != "" {
		t.Fatal("caller token leaked on ws")
	}
}

func TestRedactURL(t *testing.T) {
	u, _ := url.Parse("http://host/api?apikey=secret&x=1")
	got := redactURL(u, "apikey")
	if strings.Contains(got, "secret") {
		t.Fatalf("secret leaked: %s", got)
	}
	if !strings.Contains(got, "REDACTED") {
		t.Fatalf("expected REDACTED: %s", got)
	}
}

func TestValidateHeaderForbidden(t *testing.T) {
	a := UpstreamAuth{Header: &HeaderAuth{Name: "Host", Secret: "x"}}
	if err := a.Validate(true); err == nil {
		t.Fatal("expected error")
	}
}

func TestMigrateLegacyJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	legacy := `[{"name":"sonarr","url":"http://192.168.1.10:8989","apiKey":"k","keyHeader":"X-Api-Key","token":"t","enabled":true}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, ok := store.Get("sonarr")
	if !ok {
		t.Fatal("missing")
	}
	if svc.Auth.Header == nil || svc.Auth.Header.Name != "X-Api-Key" || svc.Auth.Header.Secret != "k" {
		t.Fatalf("auth=%+v", svc.Auth)
	}
}

func TestMigrateLegacyTypeField(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	legacy := `[{"name":"s","url":"http://127.0.0.1:9","auth":{"type":"query","name":"apikey","secret":"sek"},"token":"tok","enabled":true}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("s")
	if svc.Auth.Query == nil || svc.Auth.Query.Secret != "sek" {
		t.Fatalf("auth=%+v", svc.Auth)
	}
}

func TestMigrateEmptyKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	legacy := `[{"name":"x","url":"http://127.0.0.1:9","token":"t","enabled":true}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("x")
	if !svc.Auth.IsNone() {
		t.Fatalf("got %+v", svc.Auth)
	}
}

func TestMergeAuthKeepsSecret(t *testing.T) {
	cur := UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "keep-me"}}
	in := UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: ""}}
	out, err := mergeAuth(cur, in)
	if err != nil {
		t.Fatal(err)
	}
	if out.Header == nil || out.Header.Secret != "keep-me" {
		t.Fatalf("secret = %+v", out.Header)
	}
}

func TestAccessUpstreamAnySlot(t *testing.T) {
	var sawKey, sawQ, sawAuth string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawKey = r.Header.Get("X-Api-Key")
		sawQ = r.URL.Query().Get("apikey")
		sawAuth = r.Header.Get("Authorization")
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	svc, err := store.Create(Service{
		Name: "multi", URL: up.URL, Access: AccessUpstream, Enabled: true,
		Auth: UpstreamAuth{
			Header: &HeaderAuth{Name: "X-Api-Key", Secret: "h-secret"},
			Query:  &QueryAuth{Name: "apikey", Secret: "q-secret"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	// Header alone authorizes
	req, _ := http.NewRequest("GET", ps.URL+"/p/multi/", nil)
	req.Header.Set("X-Api-Key", "h-secret")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("header auth status %d", res.StatusCode)
	}
	if sawKey != "h-secret" || sawQ != "q-secret" {
		t.Fatalf("upstream saw key=%q q=%q (both should be injected)", sawKey, sawQ)
	}

	// Query alone authorizes
	res, err = http.Get(ps.URL + "/p/multi/?apikey=q-secret")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("query auth status %d", res.StatusCode)
	}

	// Postern token in header shape
	req, _ = http.NewRequest("GET", ps.URL+"/p/multi/", nil)
	req.Header.Set("X-Api-Key", svc.Token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("token-as-header status %d", res.StatusCode)
	}
	if sawAuth != "" {
		t.Fatalf("unexpected authz %q", sawAuth)
	}

	// Wrong value 401
	req, _ = http.NewRequest("GET", ps.URL+"/p/multi/", nil)
	req.Header.Set("X-Api-Key", "nope")
	res, _ = http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}
}

func TestAccessUpstreamRejectsNoneAuth(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, err := store.Create(Service{
		Name: "x", URL: "http://127.0.0.1:9", Access: AccessUpstream,
		Auth: UpstreamAuth{}, Enabled: true,
	})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestAuthorizeCallerEmptyTokenFailClosed(t *testing.T) {
	svc := Service{Name: "empty", Token: "", Access: AccessPostern, Enabled: true}
	req := httptest.NewRequest("GET", "http://postern/p/empty/", nil)
	if AuthorizeCaller(svc, req) {
		t.Fatal("empty token must not authorize unauthenticated caller")
	}
}

func TestPathIsOpenPrefixAndRegex(t *testing.T) {
	svc := Service{OpenPaths: []OpenPath{
		{Match: OpenMatchPrefix, Path: "/health"},
		{Match: OpenMatchRegex, Path: `^/hooks/[^/]+$`},
	}}
	if !PathIsOpen(svc, "/health") || !PathIsOpen(svc, "/health/live") {
		t.Fatal("prefix should match")
	}
	if PathIsOpen(svc, "/api/health") {
		t.Fatal("prefix must be at start")
	}
	if !PathIsOpen(svc, "/hooks/abc") {
		t.Fatal("regex should match")
	}
	if PathIsOpen(svc, "/hooks/abc/extra") {
		t.Fatal("anchored regex should not match extra segment")
	}
}

func TestOpenPathBypassStillInjectsUpstream(t *testing.T) {
	var sawKey string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawKey = r.Header.Get("X-Api-Key")
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Create(Service{
		Name: "open", URL: up.URL, Enabled: true,
		Auth:      UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real-key"}},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/health"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	res, err := http.Get(ps.URL + "/p/open/health")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("open path status %d", res.StatusCode)
	}
	if sawKey != "real-key" {
		t.Fatalf("upstream key = %q", sawKey)
	}
}

func TestOpenPathRejectsBareSlashAndBadRegex(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, err := store.Create(Service{
		Name: "bad", URL: "http://127.0.0.1:9", Enabled: true,
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/"}},
	})
	if err == nil {
		t.Fatal("expected reject bare /")
	}
	_, err = store.Create(Service{
		Name: "badre", URL: "http://127.0.0.1:9", Enabled: true,
		OpenPaths: []OpenPath{{Match: OpenMatchRegex, Path: "(unclosed"}},
	})
	if err == nil {
		t.Fatal("expected reject bad regex")
	}
}

func TestOpenStoreFillsEmptyToken(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	raw := `[{"name":"s","url":"http://127.0.0.1:9","auth":{},"token":"","enabled":true}]`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, ok := store.Get("s")
	if !ok || svc.Token == "" {
		t.Fatal("expected regenerated token")
	}
}
