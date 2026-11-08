package main

import (
	"encoding/json"
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
	auth := UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: "real-key"}
	auth.Apply(req)
	if got := req.Header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization still present: %q", got)
	}
	if got := req.Header.Get("X-Api-Key"); got != "real-key" {
		t.Fatalf("X-Api-Key = %q", got)
	}
}

func TestApplyBearer(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/", nil)
	req.Header.Set("Authorization", "Bearer caller")
	auth := UpstreamAuth{Type: AuthBearer, Secret: "tok"}
	auth.Apply(req)
	if got := req.Header.Get("Authorization"); got != "Bearer tok" {
		t.Fatalf("Authorization = %q", got)
	}
}

func TestApplyBasic(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/", nil)
	req.Header.Set("Authorization", "Bearer caller")
	auth := UpstreamAuth{Type: AuthBasic, Username: "u", Secret: "p"}
	auth.Apply(req)
	u, p, ok := req.BasicAuth()
	if !ok || u != "u" || p != "p" {
		t.Fatalf("basic auth = %v %q %q", ok, u, p)
	}
}

func TestApplyQueryStripsOverride(t *testing.T) {
	req := httptest.NewRequest("GET", "http://upstream/api?apikey=caller&keep=1", nil)
	req.Header.Set("Authorization", "Bearer caller")
	auth := UpstreamAuth{Type: AuthQuery, Name: "apikey", Secret: "real"}
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
	UpstreamAuth{Type: AuthNone}.Apply(req)
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
	auth := UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: "good"}
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
	a := UpstreamAuth{Type: AuthHeader, Name: "Host", Secret: "x"}
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
	if svc.Auth.Type != AuthHeader || svc.Auth.Name != "X-Api-Key" || svc.Auth.Secret != "k" {
		t.Fatalf("auth = %+v", svc.Auth)
	}
	// next save writes new shape
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var list []map[string]any
	if err := json.Unmarshal(b, &list); err != nil {
		t.Fatal(err)
	}
	if _, has := list[0]["apiKey"]; has {
		t.Fatal("legacy apiKey still written")
	}
	auth := list[0]["auth"].(map[string]any)
	if auth["type"] != "header" || auth["secret"] != "k" {
		t.Fatalf("saved auth = %#v", auth)
	}
}

func TestMigrateLegacyEmptyKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")
	legacy := `[{"name":"x","url":"http://h/","apiKey":"","keyHeader":"X-Api-Key","token":"t","enabled":true}]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("x")
	if svc.Auth.Type != AuthNone {
		t.Fatalf("got %v", svc.Auth.Type)
	}
}

func TestProxyInjectsAuth(t *testing.T) {
	var sawAuth, sawKey string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization")
		sawKey = r.Header.Get("X-Api-Key")
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	svc, err := store.Create(Service{
		Name: "s", URL: up.URL,
		Auth: UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: "upstream-secret"},
		Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	req, _ := http.NewRequest("GET", ps.URL+"/p/s/status", nil)
	req.Header.Set("Authorization", "Bearer "+svc.Token)
	req.Header.Set("X-Api-Key", "caller-try")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if sawAuth != "" {
		t.Fatalf("caller auth leaked: %q", sawAuth)
	}
	if sawKey != "upstream-secret" {
		t.Fatalf("key = %q", sawKey)
	}
}

func TestMergeAuthKeepsSecret(t *testing.T) {
	cur := UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: "keep-me"}
	in := UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: ""}
	out, err := mergeAuth(cur, in)
	if err != nil {
		t.Fatal(err)
	}
	if out.Secret != "keep-me" {
		t.Fatalf("secret = %q", out.Secret)
	}
}

func TestAccessUpstreamHeader(t *testing.T) {
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
		Name: "s", URL: up.URL, Access: AccessUpstream,
		Auth:    UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: "real-key"},
		Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	// Postern bearer alone must fail
	req, _ := http.NewRequest("GET", ps.URL+"/p/s/", nil)
	req.Header.Set("Authorization", "Bearer nope")
	res, _ := http.DefaultClient.Do(req)
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without upstream key, got %d", res.StatusCode)
	}

	// Matching upstream header (real key) is accepted; stored key is injected
	req, _ = http.NewRequest("GET", ps.URL+"/p/s/", nil)
	req.Header.Set("X-Api-Key", "real-key")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", res.StatusCode)
	}
	if sawKey != "real-key" {
		t.Fatalf("upstream saw %q", sawKey)
	}

	svc, _ := store.Get("s")
	// Postern token presented as the upstream header is also accepted
	req, _ = http.NewRequest("GET", ps.URL+"/p/s/", nil)
	req.Header.Set("X-Api-Key", svc.Token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("postern-token-as-header status %d", res.StatusCode)
	}
	if sawKey != "real-key" {
		t.Fatalf("upstream must get stored key, got %q", sawKey)
	}
}

func TestAccessUpstreamQuery(t *testing.T) {
	var sawQ string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawQ = r.URL.Query().Get("apikey")
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, err := store.Create(Service{
		Name: "sab", URL: up.URL, Access: AccessUpstream,
		Auth:    UpstreamAuth{Type: AuthQuery, Name: "apikey", Secret: "sab-secret"},
		Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	res, err := http.Get(ps.URL + "/p/sab/?apikey=sab-secret&other=1")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d", res.StatusCode)
	}
	if sawQ != "sab-secret" {
		t.Fatalf("apikey = %q", sawQ)
	}
}

func TestAccessUpstreamRejectsNoneAuth(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, err := store.Create(Service{
		Name: "x", URL: "http://127.0.0.1:9", Access: AccessUpstream,
		Auth: UpstreamAuth{Type: AuthNone}, Enabled: true,
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
	req.Header.Set("Authorization", "Bearer ")
	if AuthorizeCaller(svc, req) {
		t.Fatal("empty bearer must not authorize empty token")
	}
}

func TestAuthorizeCallerRejectsEmptyCallerToken(t *testing.T) {
	svc := Service{Name: "s", Token: "abc", Access: AccessPostern, Enabled: true}
	req := httptest.NewRequest("GET", "http://postern/p/s/", nil)
	if AuthorizeCaller(svc, req) {
		t.Fatal("missing caller token must fail")
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
	if PathIsOpen(svc, "/other") {
		t.Fatal("unlisted path must not be open")
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
		Auth:      UpstreamAuth{Type: AuthHeader, Name: "X-Api-Key", Secret: "real-key"},
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

	// Open path: no caller token
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

	// Non-open path still requires auth
	res, err = http.Get(ps.URL + "/p/open/api/data")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", res.StatusCode)
	}
}

func TestOpenPathRejectsBareSlashAndBadRegex(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, err := store.Create(Service{
		Name: "bad", URL: "http://127.0.0.1:9", Enabled: true,
		Auth:      UpstreamAuth{Type: AuthNone},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/"}},
	})
	if err == nil {
		t.Fatal("expected reject bare /")
	}
	_, err = store.Create(Service{
		Name: "badre", URL: "http://127.0.0.1:9", Enabled: true,
		Auth:      UpstreamAuth{Type: AuthNone},
		OpenPaths: []OpenPath{{Match: OpenMatchRegex, Path: "(unclosed"}},
	})
	if err == nil {
		t.Fatal("expected reject bad regex")
	}
}

func TestOpenStoreFillsEmptyToken(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	raw := `[{"name":"s","url":"http://127.0.0.1:9","auth":{"type":"none"},"token":"","enabled":true}]`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, ok := store.Get("s")
	if !ok {
		t.Fatal("missing service")
	}
	if svc.Token == "" {
		t.Fatal("expected regenerated token")
	}
	// Persisted
	store2, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc2, _ := store2.Get("s")
	if svc2.Token != svc.Token {
		t.Fatalf("token not persisted: %q vs %q", svc.Token, svc2.Token)
	}
}
