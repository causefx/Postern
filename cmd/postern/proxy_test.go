package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestProxyReusesReverseProxyAndInjectsAuth(t *testing.T) {
	var hits int
	var saw []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		saw = append(saw, r.Header.Get("X-Api-Key"))
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Create(Service{
		Name: "one", URL: up.URL, Enabled: true,
		Auth:      UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real-key"}},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/ok"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	for i := 0; i < 2; i++ {
		res, err := http.Get(ps.URL + "/p/one/ok")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNoContent {
			t.Fatalf("status %d", res.StatusCode)
		}
	}
	if hits != 2 {
		t.Fatalf("upstream hits = %d", hits)
	}
	if saw[0] != "real-key" || saw[1] != "real-key" {
		t.Fatalf("injected keys = %v", saw)
	}
	first := app.proxyRP
	if first == nil {
		t.Fatal("reverse proxy was not cached")
	}
	if app.reverseProxy() != first {
		t.Fatal("second lookup built a new ReverseProxy")
	}
}
