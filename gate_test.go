package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestCallerGateDefaultAcceptsTrio(t *testing.T) {
	svc := Service{Name: "s", Token: "pst_secret", Access: AccessPostern, Enabled: true}

	req, _ := http.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer pst_secret")
	if !AuthorizeCaller(svc, req) {
		t.Fatal("bearer should authorize")
	}

	req, _ = http.NewRequest("GET", "http://x/", nil)
	req.Header.Set("X-Proxy-Token", "pst_secret")
	if !AuthorizeCaller(svc, req) {
		t.Fatal("X-Proxy-Token should authorize")
	}

	req, _ = http.NewRequest("GET", "http://x/?token=pst_secret", nil)
	if !AuthorizeCaller(svc, req) {
		t.Fatal("query token should authorize")
	}
}

func TestCallerGateExplicitOnlyEnabledPlaces(t *testing.T) {
	svc := Service{
		Name: "s", Token: "pst_secret", Access: AccessPostern, Enabled: true,
		Gate: &CallerGate{Header: &GateHeader{Name: "X-Api-Key"}},
	}

	req, _ := http.NewRequest("GET", "http://x/", nil)
	req.Header.Set("Authorization", "Bearer pst_secret")
	if AuthorizeCaller(svc, req) {
		t.Fatal("bearer should not authorize when only header gate enabled")
	}

	req, _ = http.NewRequest("GET", "http://x/", nil)
	req.Header.Set("X-Api-Key", "pst_secret")
	if !AuthorizeCaller(svc, req) {
		t.Fatal("configured header should authorize")
	}

	req, _ = http.NewRequest("GET", "http://x/?token=pst_secret", nil)
	if AuthorizeCaller(svc, req) {
		t.Fatal("default query should not authorize when not enabled")
	}
}

func TestCallerGateEmptyRejected(t *testing.T) {
	g := &CallerGate{}
	err := g.Validate()
	var fe FieldError
	if !errors.As(err, &fe) || fe["gate"] == "" {
		t.Fatalf("expected gate field error, got %v", err)
	}
}

func TestCallerGateNormalizeDefaultToNil(t *testing.T) {
	g := &CallerGate{
		Bearer: true,
		Header: &GateHeader{Name: "X-Proxy-Token"},
		Query:  &GateQuery{Name: "token"},
	}
	if g.Normalize() != nil {
		t.Fatal("default shape should normalize to nil")
	}
}

func TestCallerGateStripCustomQuery(t *testing.T) {
	req := httptest.NewRequest("GET", "http://up/api?apikey=pst_secret&keep=1", nil)
	req.Header.Set("Authorization", "Bearer pst_secret")
	req.Header.Set("X-Custom", "pst_secret")
	gate := &CallerGate{
		Bearer: true,
		Header: &GateHeader{Name: "X-Custom"},
		Query:  &GateQuery{Name: "apikey"},
	}
	gate.Strip(req)
	if req.Header.Get("Authorization") != "" || req.Header.Get("X-Custom") != "" {
		t.Fatalf("headers not stripped: auth=%q custom=%q", req.Header.Get("Authorization"), req.Header.Get("X-Custom"))
	}
	if req.URL.Query().Get("apikey") != "" {
		t.Fatal("gate query not stripped")
	}
	if req.URL.Query().Get("keep") != "1" {
		t.Fatal("unrelated query should remain")
	}
}

func TestCreateRejectsEmptyGate(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, err := store.Create(Service{
		Name: "g", URL: "http://127.0.0.1:9", Enabled: true,
		Gate: &CallerGate{},
	})
	if err == nil {
		t.Fatal("expected empty gate error")
	}
}

func TestCallerGateProxyOnlyConfiguredPlace(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	svc, err := store.Create(Service{
		Name: "gated", URL: up.URL, Enabled: true, Access: AccessPostern,
		Gate: &CallerGate{Bearer: true},
		Auth: UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "up"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	req, _ := http.NewRequest("GET", ps.URL+"/p/gated/", nil)
	req.Header.Set("X-Proxy-Token", svc.Token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for disabled place, got %d", res.StatusCode)
	}

	req, _ = http.NewRequest("GET", ps.URL+"/p/gated/", nil)
	req.Header.Set("Authorization", "Bearer "+svc.Token)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", res.StatusCode)
	}
}
