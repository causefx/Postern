package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeApp serves canned pages by path and records every request it gets.
type fakeApp struct {
	mu     sync.Mutex
	seen   []*http.Request
	routes map[string]func(w http.ResponseWriter, r *http.Request)
}

func (f *fakeApp) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.seen = append(f.seen, r.Clone(context.Background()))
	f.mu.Unlock()
	key := r.URL.Path
	if r.URL.RawQuery != "" {
		key += "?" + r.URL.RawQuery
	}
	if h, ok := f.routes[key]; ok {
		h(w, r)
		return
	}
	if h, ok := f.routes[r.URL.Path]; ok {
		h(w, r)
		return
	}
	http.NotFound(w, r)
}

func page(body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(body))
	}
}

func jsonBody(body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}
}

func detectAt(t *testing.T, routes map[string]func(http.ResponseWriter, *http.Request), basePath string) (*Detection, *fakeApp) {
	t.Helper()
	f := &fakeApp{routes: routes}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	app := &App{}
	body := strings.NewReader(`{"url":"` + srv.URL + basePath + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/admin/api/services/detect", body)
	rec := httptest.NewRecorder()
	app.detectService(rec, req)
	if rec.Code != 200 {
		t.Fatalf("detect: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Detected *Detection `json:"detected"`
	}
	decodeRec(t, rec, &out)
	return out.Detected, f
}

func TestDetectApps(t *testing.T) {
	plexHeader := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Plex-Protocol", "1.0")
		w.WriteHeader(401)
	}
	cases := []struct {
		name    string
		routes  map[string]func(http.ResponseWriter, *http.Request)
		app     string
		version string
	}{
		{"sonarr shell", map[string]func(http.ResponseWriter, *http.Request){
			"/": page(`<html><head><title>Sonarr</title></head><script>window.Sonarr = { urlBase: '' }</script></html>`),
		}, "sonarr", ""},
		{"radarr login page", map[string]func(http.ResponseWriter, *http.Request){
			"/":      func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "/login", http.StatusFound) },
			"/login": page(`<html><head><title>Login - Radarr</title></head></html>`),
		}, "radarr", ""},
		{"jellyfin with version", map[string]func(http.ResponseWriter, *http.Request){
			"/":                   page(`<!DOCTYPE html><html><head><title>Jellyfin</title></head></html>`),
			"/System/Info/Public": jsonBody(`{"ProductName":"Jellyfin Server","Version":"10.10.3","Id":"x"}`),
		}, "jellyfin", "10.10.3"},
		{"emby by probe only", map[string]func(http.ResponseWriter, *http.Request){
			"/System/Info/Public": jsonBody(`{"ProductName":"Emby Server","Version":"4.8.10.0"}`),
		}, "emby", "4.8.10.0"},
		{"plex by header", map[string]func(http.ResponseWriter, *http.Request){
			"/":         plexHeader,
			"/identity": page(`<?xml version="1.0"?><MediaContainer size="0" claimed="1" machineIdentifier="abc" version="1.41.3.9314-a0bfb8370"></MediaContainer>`),
		}, "plex", "1.41.3"},
		{"sabnzbd by probe", map[string]func(http.ResponseWriter, *http.Request){
			"/api?mode=version&output=json": jsonBody(`{"version":"4.3.3"}`),
		}, "sabnzbd", "4.3.3"},
		{"jellyseerr title beats overseerr", map[string]func(http.ResponseWriter, *http.Request){
			"/":              page(`<html><head><title>Jellyseerr</title></head></html>`),
			"/api/v1/status": jsonBody(`{"version":"2.1.0","commitTag":"local"}`),
		}, "jellyseerr", "2.1.0"},
		{"home assistant", map[string]func(http.ResponseWriter, *http.Request){
			"/": page(`<html><head><title>Home Assistant</title></head><body><home-assistant-main></home-assistant-main></body></html>`),
		}, "homeassistant", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d, _ := detectAt(t, c.routes, "")
			if d == nil {
				t.Fatalf("nothing detected, want %s", c.app)
			}
			if d.App != c.app || d.Version != c.version {
				t.Fatalf("got %+v, want app %s version %q", d, c.app, c.version)
			}
		})
	}
}

func TestDetectUnknownAndLookalikes(t *testing.T) {
	d, _ := detectAt(t, map[string]func(http.ResponseWriter, *http.Request){
		"/": page(`<html><head><title>My NAS</title></head></html>`),
		// Another app's /api must not pass for SABnzbd's version call.
		"/api":           jsonBody(`{"version":"1.0","current":"v3"}`),
		"/api/v1/status": jsonBody(`{"version":"1.0"}`),
	}, "")
	if d != nil {
		t.Fatalf("detected %+v on an unknown app", d)
	}
}

func TestDetectUnderBasePath(t *testing.T) {
	d, f := detectAt(t, map[string]func(http.ResponseWriter, *http.Request){
		"/jf/System/Info/Public": jsonBody(`{"ProductName":"Jellyfin Server","Version":"10.9.0"}`),
	}, "/jf")
	if d == nil || d.App != "jellyfin" {
		t.Fatalf("got %+v", d)
	}
	for _, r := range f.seen {
		if !strings.HasPrefix(r.URL.Path, "/jf") {
			t.Errorf("probe left the base path: %s", r.URL.Path)
		}
	}
}

// Probes go only to the address typed, with no credential, and never follow a redirect elsewhere.
func TestDetectProbesStayHomeAndCarryNoKey(t *testing.T) {
	other := &fakeApp{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/System/Info/Public": jsonBody(`{"ProductName":"Jellyfin Server","Version":"1"}`),
	}}
	elsewhere := httptest.NewServer(other)
	defer elsewhere.Close()

	d, f := detectAt(t, map[string]func(http.ResponseWriter, *http.Request){
		"/System/Info/Public": func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, elsewhere.URL+"/System/Info/Public", http.StatusFound)
		},
	}, "")
	if d != nil {
		t.Fatalf("followed a redirect to another host: %+v", d)
	}
	if len(other.seen) != 0 {
		t.Fatalf("another host got %d requests", len(other.seen))
	}
	for _, r := range f.seen {
		if r.Header.Get("X-Api-Key") != "" || r.Header.Get("Authorization") != "" || r.URL.Query().Get("apikey") != "" {
			t.Errorf("probe %s carried a credential", r.URL)
		}
	}
}

func TestTestConnectionReportsDetection(t *testing.T) {
	var keyed sync.Map
	f := &fakeApp{routes: map[string]func(http.ResponseWriter, *http.Request){
		"/": func(w http.ResponseWriter, r *http.Request) {
			keyed.Store(r.URL.Path, r.Header.Get("X-Api-Key"))
			page(`<title>Sonarr</title>`)(w, r)
		},
	}}
	srv := httptest.NewServer(f)
	defer srv.Close()
	app := &App{store: newMemStore(t)}
	body := `{"url":"` + srv.URL + `","auth":{"header":{"name":"X-Api-Key","secret":"k"}}}`
	rec := httptest.NewRecorder()
	app.testConnection(rec, httptest.NewRequest(http.MethodPost, "/admin/api/services/test", strings.NewReader(body)))
	var out struct {
		OK       bool       `json:"ok"`
		Detected *Detection `json:"detected"`
	}
	decodeRec(t, rec, &out)
	if !out.OK || out.Detected == nil || out.Detected.App != "sonarr" {
		t.Fatalf("got %s", rec.Body.String())
	}
	if v, _ := keyed.Load("/"); v != "k" {
		t.Fatalf("the test request itself should still carry the key, got %v", v)
	}
}

func TestCleanVersion(t *testing.T) {
	for in, want := range map[string]string{
		"v4.0.9":                "4.0.9",
		"10.10.3":               "10.10.3",
		"<script>":              "",
		strings.Repeat("1", 41): "",
	} {
		if got := cleanVersion(in); got != want {
			t.Errorf("cleanVersion(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestProbeGetResolvesUnderBase(t *testing.T) {
	base, _ := url.Parse("http://h:1/sub")
	var got string
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		got = r.URL.String()
		return &http.Response{StatusCode: 404, Body: http.NoBody, Request: r}, nil
	})}
	probeGet(context.Background(), client, base, "api?mode=version&output=json")
	if got != "http://h:1/sub/api?mode=version&output=json" {
		t.Fatalf("probe url = %s", got)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDialErrorKind(t *testing.T) {
	get := func(c *http.Client, u string) error {
		res, err := c.Get(u)
		if err == nil {
			res.Body.Close()
		}
		return err
	}
	client := &http.Client{Timeout: 3 * time.Second}

	// Refused: a port that was just listening and is now closed.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	if k := dialErrorKind(get(client, "http://"+addr)); k != "refused" {
		t.Errorf("closed port: %q", k)
	}

	// Not trusted: a test TLS server with its own certificate.
	tlsSrv := httptest.NewTLSServer(http.NotFoundHandler())
	defer tlsSrv.Close()
	if k := dialErrorKind(get(client, tlsSrv.URL)); k != "tls" {
		t.Errorf("untrusted certificate: %q", k)
	}

	// Timeout: a server that never answers within the client's time.
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	defer slow.Close()
	if k := dialErrorKind(get(&http.Client{Timeout: 50 * time.Millisecond}, slow.URL)); k != "timeout" {
		t.Errorf("slow server: %q", k)
	}

	// Not found: .invalid never resolves.
	if k := dialErrorKind(get(client, "http://postern-test.invalid")); k != "dns" {
		t.Errorf("unknown host: %q", k)
	}
}
