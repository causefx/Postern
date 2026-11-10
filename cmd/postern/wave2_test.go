package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProxyRateLimitCountsOpenPaths(t *testing.T) {
	lim := newProxyLimiter(2)
	if !lim.allow("one", "10.0.0.1") || !lim.allow("one", "10.0.0.1") || lim.allow("one", "10.0.0.1") {
		t.Fatal("configured rate limit did not stop the third request")
	}
	if !lim.allow("one", "10.0.0.2") {
		t.Fatal("rate limit applied to a different client")
	}
	var hits int
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("Cookie") != "" {
			t.Errorf("upstream saw cookie %q", r.Header.Get("Cookie"))
		}
		if r.Header.Get("X-Api-Key") != "real-key" {
			t.Errorf("upstream key %q", r.Header.Get("X-Api-Key"))
		}
		w.WriteHeader(204)
	}))
	defer up.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(Service{
		Name: "one", URL: up.URL, Enabled: true,
		Auth:      UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real-key"}},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/ok"}},
	}); err != nil {
		t.Fatal(err)
	}
	app := &App{store: store, activity: newActivityLog(), hits: newProxyLimiter(0)}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	old := proxyRateMax
	proxyRateMax = 1
	t.Cleanup(func() { proxyRateMax = old })

	client := ps.Client()
	for i := 0; i < 2; i++ {
		res, err := client.Get(ps.URL + "/p/missing/x")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("unknown status %d", res.StatusCode)
		}
	}

	req, _ := http.NewRequest(http.MethodGet, ps.URL+"/p/one/ok", nil)
	req.Header.Set("Cookie", "session=sekrit")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("first status %d", res.StatusCode)
	}

	res, err = client.Get(ps.URL + "/p/one/ok")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusTooManyRequests || len(strings.TrimSpace(string(body))) != 0 {
		t.Fatalf("limited status %d body %q", res.StatusCode, body)
	}
	if hits != 1 {
		t.Fatalf("upstream hits %d", hits)
	}
	events := app.activity.list("one")
	if len(events) != 2 || events[1].Who != "limited" || events[1].Status != http.StatusTooManyRequests {
		t.Fatalf("activity %+v", events)
	}
	count, status, _ := app.activity.summary("one")
	if count != 2 || status != http.StatusTooManyRequests {
		t.Fatalf("summary %d %d", count, status)
	}
}

func TestHealthzSkipsAuth(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	ps := httptest.NewServer(withHealth(inner))
	defer ps.Close()

	res, err := http.Get(ps.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusOK || string(body) != "ok\n" {
		t.Fatalf("health %d %q", res.StatusCode, body)
	}
	res, err = http.Get(ps.URL + "/admin/")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("admin status %d", res.StatusCode)
	}
}

func TestAuditOmitsSecretsAndRotates(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json.audit")
	log := newAuditLog(path)
	err := log.append(auditEvent{
		Action:  "create",
		Service: "one",
		URL:     "http://user:sekrit@example.com/api?token=sekrit",
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "sekrit") || !strings.Contains(string(b), "http://example.com/api") {
		t.Fatalf("audit line %s", b)
	}

	old := auditMaxBytes
	auditMaxBytes = 100
	t.Cleanup(func() { auditMaxBytes = old })
	for i := 0; i < 8; i++ {
		if err := log.append(auditEvent{Action: "enable", Service: "one"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatal(err)
	}
	cur, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(cur)) > auditMaxBytes {
		t.Fatalf("current audit %d bytes", len(cur))
	}
}

func TestDuplicateAndCheck(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(Service{
		Name: "one", URL: "http://127.0.0.1:9", Enabled: false,
		Auth:      UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real-key"}},
		Gate:      &CallerGate{Header: &GateHeader{Name: "X-Custom"}},
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/health"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.Create(Service{
		Name: "badre", URL: "http://127.0.0.1:9", Enabled: true,
		OpenPaths: []OpenPath{{Match: OpenMatchRegex, Path: "/hooks/.*"}},
	})
	if err == nil || !strings.Contains(err.Error(), "regex must start with ^") {
		t.Fatalf("unanchored regex err %v", err)
	}

	dup, err := store.Duplicate("one", "two")
	if err != nil {
		t.Fatal(err)
	}
	if dup.Name != "two" || dup.Enabled || dup.Token == "" || dup.Token == created.Token || len(dup.Tokens) != 1 {
		t.Fatalf("dup %+v", dup)
	}
	if dup.Auth.Header == nil || dup.Auth.Header.Secret != "real-key" || dup.Auth.Header == created.Auth.Header {
		t.Fatal("auth was not copied onto its own slot")
	}
	dup.Auth.Header.Secret = "changed"
	src, _ := store.Get("one")
	if src.Auth.Header.Secret != "real-key" {
		t.Fatal("duplicate shares the source auth")
	}
	if dup.Gate == nil || dup.Gate.Header.Name != "X-Custom" || len(dup.OpenPaths) != 1 {
		t.Fatalf("setup %+v gate %+v", dup.OpenPaths, dup.Gate)
	}
	auto, err := store.Duplicate("one", "")
	if err != nil || auto.Name != "one-2" {
		t.Fatalf("auto name %q %v", auto.Name, err)
	}
	if _, err := store.Duplicate("one", "two"); err == nil {
		t.Fatal("accepted a duplicate name")
	}

	problems, err := CheckFile(path)
	if err != nil || len(problems) != 0 {
		t.Fatalf("check %v %v", problems, err)
	}

	bad := filepath.Join(dir, "bad.json")
	raw := `[{"name":"wide","url":"http://127.0.0.1:9","enabled":true,"openPaths":[{"match":"regex","path":"/hooks/.*"}]}]`
	if err := os.WriteFile(bad, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	problems, err = CheckFile(bad)
	if err != nil || len(problems) != 1 || !strings.Contains(problems[0], "regex must start with ^") {
		t.Fatalf("check problems %v %v", problems, err)
	}
	if _, err := os.Stat(bad); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(bad)
	if string(after) != raw {
		t.Fatal("check rewrote the file")
	}

	app := &App{store: store, audit: newAuditLog(path + ".audit")}
	req := httptest.NewRequest(http.MethodPost, "/admin/api/services/one/duplicate", strings.NewReader(`{"name":"three"}`))
	req.SetPathValue("name", "one")
	rec := httptest.NewRecorder()
	app.duplicateService(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("duplicate status %d %s", rec.Code, rec.Body.String())
	}
	logged, err := os.ReadFile(path + ".audit")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(logged), "real-key") || !strings.Contains(string(logged), `"action":"duplicate"`) {
		t.Fatalf("audit %s", logged)
	}
}

func TestSettingsSaveAppliesLive(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	log := openActivityLog(path+".activity", store.ActivityLimit())
	hits := configuredProxyLimiter(store.RateLimit())
	app := &App{store: store, activity: log, hits: hits, audit: newAuditLog(path + ".audit")}

	req := httptest.NewRequest(http.MethodPut, "/admin/api/settings", strings.NewReader(`{"activityLimit":3,"rateLimit":0,"auditLimit":100}`))
	rec := httptest.NewRecorder()
	app.putSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save %d %s", rec.Code, rec.Body.String())
	}
	if store.ActivityLimit() != 3 || store.RateLimit() != 0 {
		t.Fatalf("stored %d %d", store.ActivityLimit(), store.RateLimit())
	}
	for i := 0; i < 5; i++ {
		if !hits.allow("one", "10.0.0.8") {
			t.Fatal("rate limit stayed on")
		}
	}
	hits.setMax(1)
	if !hits.allow("one", "10.0.0.9") || hits.allow("one", "10.0.0.9") {
		t.Fatal("setMax did not turn the limit back on")
	}
	for i := 0; i < 5; i++ {
		log.add("one", activityEvent{Method: "GET", Path: "/x", Status: 200, Who: "open"})
	}
	if got := len(log.list("one")); got != 3 {
		t.Fatalf("trimmed ring %d", got)
	}
	reloaded, err := OpenStore(path)
	if err != nil || reloaded.ActivityLimit() != 3 || reloaded.RateLimit() != 0 {
		t.Fatalf("reload %v %d %d", err, reloaded.ActivityLimit(), reloaded.RateLimit())
	}

	bad := httptest.NewRecorder()
	app.putSettings(bad, httptest.NewRequest(http.MethodPut, "/admin/api/settings", strings.NewReader(`{"activityLimit":0,"rateLimit":120}`)))
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("reject %d", bad.Code)
	}

	off := filepath.Join(dir, "off.json")
	if err := os.WriteFile(off, []byte(`{"settings":{"activityLimit":20,"rateLimit":0},"services":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	problems, err := CheckFile(off)
	if err != nil || len(problems) != 0 {
		t.Fatalf("check off %v %v", problems, err)
	}
	huge := filepath.Join(dir, "huge.json")
	if err := os.WriteFile(huge, []byte(`{"settings":{"rateLimit":10001},"services":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	problems, err = CheckFile(huge)
	if err != nil || len(problems) != 1 || !strings.Contains(problems[0], "rateLimit") {
		t.Fatalf("check huge %v %v", problems, err)
	}
}

func TestAuditLimitKeepsNewest(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json.audit")
	log := newAuditLog(path)
	log.setLimit(2)
	for _, action := range []string{"create", "update", "delete"} {
		if err := log.append(auditEvent{Action: action, Service: "sonarr"}); err != nil {
			t.Fatal(err)
		}
	}
	got := log.list()
	if len(got) != 2 || got[0].Action != "delete" || got[1].Action != "update" {
		t.Fatalf("newest %v", got)
	}
	raw, err := os.ReadFile(path)
	if err != nil || strings.Contains(string(raw), "create") {
		t.Fatalf("file %s %v", raw, err)
	}
}
