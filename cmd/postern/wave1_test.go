package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProxyDisabledUnknownAndHeaderTimeout(t *testing.T) {
	hung := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	defer hung.Close()

	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(Service{Name: "off", URL: hung.URL, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(Service{
		Name: "slow", URL: hung.URL, Enabled: true,
		OpenPaths: []OpenPath{{Match: OpenMatchPrefix, Path: "/wait"}},
	}); err != nil {
		t.Fatal(err)
	}
	app := &App{store: store, activity: newActivityLog()}
	mux := http.NewServeMux()
	mux.HandleFunc("/p/{name}/{rest...}", app.proxy)
	ps := httptest.NewServer(mux)
	defer ps.Close()

	res, err := http.Get(ps.URL + "/p/missing/x")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown status %d", res.StatusCode)
	}

	res, err = http.Get(ps.URL + "/p/off/x")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden || !strings.Contains(string(body), "service disabled") {
		t.Fatalf("disabled status %d body %q", res.StatusCode, body)
	}
	events := app.activity.list("off")
	if len(events) != 1 || events[0].Who != "off" || events[0].Status != http.StatusForbidden {
		t.Fatalf("disabled activity %+v", events)
	}

	old := proxyHeaderTimeout
	proxyHeaderTimeout = 200 * time.Millisecond
	t.Cleanup(func() { proxyHeaderTimeout = old })
	client := &http.Client{Timeout: 3 * time.Second}
	res, err = client.Get(ps.URL + "/p/slow/wait")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadGateway {
		t.Fatalf("header timeout status %d", res.StatusCode)
	}
	slow := app.activity.list("slow")
	if len(slow) != 1 || slow[0].Who != "open" || slow[0].Status != http.StatusBadGateway {
		t.Fatalf("timeout activity %+v", slow)
	}
}

func TestActivityRedactsSecretsAndCaps(t *testing.T) {
	svc := Service{
		Gate: &CallerGate{Query: &GateQuery{Name: "gate"}},
		Auth: UpstreamAuth{Query: &QueryAuth{Name: "key", Secret: "upstream"}},
	}
	r := httptest.NewRequest(http.MethodGet, "/p/one/x?token=sekrit&gate=hidden&key=up&keep=1", nil)
	path := activityPath("/x", r, svc)
	if strings.Contains(path, "sekrit") || strings.Contains(path, "hidden") || strings.Contains(path, "up") {
		t.Fatalf("secret leaked in %s", path)
	}
	if !strings.Contains(path, "token=REDACTED") || !strings.Contains(path, "keep=1") {
		t.Fatalf("path %s", path)
	}

	log := newActivityLog()
	for i := 0; i < defaultActivityLimit+5; i++ {
		log.add("one", activityEvent{Method: "GET", Path: "/x", Status: 200, Who: "open"})
	}
	if got := len(log.list("one")); got != defaultActivityLimit {
		t.Fatalf("ring len %d", got)
	}
}

func TestActivityPersistsAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json.activity")
	log := openActivityLog(path, 20)
	log.add("sonarr", activityEvent{Method: "GET", Path: "/api?token=REDACTED", Status: 204, Who: "default"})
	log.add("sonarr", activityEvent{Method: "GET", Path: "/api", Status: 401, Who: "rejected"})

	again := openActivityLog(path, 20)
	events := again.list("sonarr")
	if len(events) != 2 || events[1].Status != 401 || events[1].Who != "rejected" {
		t.Fatalf("reloaded %+v", events)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "sekrit") {
		t.Fatalf("activity file %s", b)
	}
	again.forget("sonarr")
	if len(openActivityLog(path, 20).list("sonarr")) != 0 {
		t.Fatal("forget did not persist")
	}
}

func TestClearActivityDropsOneService(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "d.json")
	raw := `{"services":[{"name":"one","url":"http://127.0.0.1:9","token":"abc","enabled":true}]}`
	if err := os.WriteFile(data, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	st, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: st, activity: newActivityLog()}
	app.activity.add("one", activityEvent{Method: "GET", Path: "/x", Status: 200, Who: "open"})
	app.activity.add("two", activityEvent{Method: "GET", Path: "/y", Status: 204, Who: "default"})
	req := httptest.NewRequest(http.MethodDelete, "/admin/api/services/one/activity", nil)
	req.SetPathValue("name", "one")
	rec := httptest.NewRecorder()
	app.clearActivity(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d", rec.Code)
	}
	if len(app.activity.list("one")) != 0 || len(app.activity.list("two")) != 1 {
		t.Fatalf("one %d two %d", len(app.activity.list("one")), len(app.activity.list("two")))
	}
}

func TestLegacyTokenMigratesAndNamedTokens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	raw := `[
	  {
	    "name": "legacy",
	    "url": "http://example.com",
	    "token": "legacy-secret",
	    "enabled": true,
	    "gate": {"header": {"name": "X-Custom"}},
	    "auth": {}
	  }
	]`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	svc, ok := store.Get("legacy")
	if !ok || len(svc.Tokens) != 1 || svc.Tokens[0].Name != "default" || svc.Tokens[0].Secret != "legacy-secret" || svc.Token != "legacy-secret" {
		t.Fatalf("migrated %+v", svc)
	}
	if svc.Gate == nil || svc.Gate.Header == nil || svc.Gate.Header.Name != "X-Custom" {
		t.Fatalf("gate dropped %+v", svc.Gate)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(saved), `"secret": "legacy-secret"`) || !strings.Contains(string(saved), `"token": "legacy-secret"`) {
		t.Fatalf("file %s", saved)
	}

	second, err := store.AddToken("legacy", "phone")
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Tokens) != 2 || second.Tokens[1].Name != "phone" || second.Token != "legacy-secret" {
		t.Fatalf("added %+v", second)
	}
	phone := second.Tokens[1].Secret
	rotated, err := store.RotateToken("legacy")
	if err != nil {
		t.Fatal(err)
	}
	if rotated.Tokens[0].Secret == "legacy-secret" || rotated.Tokens[1].Secret != phone || rotated.Token != rotated.Tokens[0].Secret {
		t.Fatalf("rotate default %+v", rotated)
	}
	byID, err := store.RotateTokenID("legacy", rotated.Tokens[1].ID)
	if err != nil || byID.Tokens[1].Secret == phone || byID.Tokens[0].Secret != rotated.Tokens[0].Secret {
		t.Fatalf("rotate id %+v %v", byID, err)
	}
	req := httptest.NewRequest(http.MethodGet, "/p/legacy/x", nil)
	req.Header.Set("X-Custom", byID.Tokens[0].Secret)
	if who, ok := identifyCaller(byID, req); !ok || who != "default" {
		t.Fatalf("default token who %q ok %v", who, ok)
	}
	req.Header.Set("X-Custom", byID.Tokens[1].Secret)
	if who, ok := identifyCaller(byID, req); !ok || who != "phone" {
		t.Fatalf("phone token who %q ok %v", who, ok)
	}
	updated, err := store.Update("legacy", Service{URL: "http://example.com/v2", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if updated.URL != "http://example.com/v2" || len(updated.Tokens) != 2 || updated.Tokens[0].Secret != byID.Tokens[0].Secret {
		t.Fatalf("update replaced tokens %+v", updated)
	}
	if _, err := store.DeleteToken("legacy", updated.Tokens[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DeleteToken("legacy", updated.Tokens[1].ID); err == nil {
		t.Fatal("deleted the last token")
	}
	cur, _ := store.Get("legacy")
	for len(cur.Tokens) < maxCallerTokens {
		cur, err = store.AddToken("legacy", "t")
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.AddToken("legacy", "overflow"); err == nil {
		t.Fatal("accepted a 9th token")
	}

	req = httptest.NewRequest(http.MethodGet, "/p/legacy/x", nil)
	req.Header.Set("X-Proxy-Token", cur.Tokens[1].Secret)
	if who, ok := identifyCaller(cur, req); !ok || who != cur.Tokens[1].Name {
		t.Fatalf("second token who %q ok %v", who, ok)
	}
	req.Header.Set("X-Proxy-Token", "nope")
	if _, ok := identifyCaller(cur, req); ok {
		t.Fatal("wrong token accepted")
	}
}

func TestSessionHMACSurvivesRestart(t *testing.T) {
	a := newSessionStore("secret")
	raw, err := a.create(true)
	if err != nil {
		t.Fatal(err)
	}
	if !a.valid(raw) || !a.remember(raw) {
		t.Fatal("fresh cookie rejected")
	}
	restarted := newSessionStore("secret")
	if !restarted.valid(raw) || !restarted.remember(raw) {
		t.Fatal("same password did not keep the session")
	}
	if newSessionStore("other").valid(raw) {
		t.Fatal("different password accepted the cookie")
	}
	bad := raw[:len(raw)-1] + "0"
	if bad == raw {
		bad = raw[:len(raw)-1] + "1"
	}
	if a.valid(bad) {
		t.Fatal("bad mac accepted")
	}
	short, err := a.create(false)
	if err != nil || a.remember(short) {
		t.Fatal("short session looked like remember")
	}
	expired := a.seal(time.Now().Add(-time.Second), sessionTTLShort, false)
	if a.valid(expired) {
		t.Fatal("expired cookie accepted")
	}
}

func TestActivityLimitStoredInDataFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "d.json")
	raw := `[{"name":"one","url":"http://127.0.0.1:9","token":"abc","enabled":true,"auth":{}}]`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if store.ActivityLimit() != defaultActivityLimit {
		t.Fatalf("default limit %d", store.ActivityLimit())
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(saved), `"activityLimit": 20`) || !strings.Contains(string(saved), `"rateLimit": 120`) || !strings.Contains(string(saved), `"auditLimit": 100`) || !strings.HasPrefix(strings.TrimSpace(string(saved)), "{") {
		t.Fatalf("migrated file %s", saved)
	}

	custom := filepath.Join(dir, "custom.json")
	body := `{
	  "settings": {"activityLimit": 4},
	  "services": [{"name":"one","url":"http://127.0.0.1:9","token":"abc","tokens":[{"id":"id1","name":"default","secret":"abc"}],"enabled":true,"auth":{}}]
	}`
	if err := os.WriteFile(custom, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err = OpenStore(custom)
	if err != nil {
		t.Fatal(err)
	}
	if store.ActivityLimit() != 4 {
		t.Fatalf("limit %d", store.ActivityLimit())
	}
	if _, err := store.Update("one", Service{URL: "http://127.0.0.1:9/v2", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := OpenStore(custom)
	if err != nil || reloaded.ActivityLimit() != 4 || reloaded.RateLimit() != defaultRateLimit || reloaded.AuditLimit() != defaultAuditLimit {
		t.Fatalf("limit after save %d %v", reloaded.ActivityLimit(), err)
	}

	log := openActivityLog(custom+".activity", store.ActivityLimit())
	for i := 0; i < 6; i++ {
		log.add("one", activityEvent{Method: "GET", Path: "/x", Status: 200, Who: "open"})
	}
	if got := len(log.list("one")); got != 4 {
		t.Fatalf("ring %d", got)
	}
	if got := len(openActivityLog(custom+".activity", 4).list("one")); got != 4 {
		t.Fatalf("reloaded ring %d", got)
	}

	bad := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(bad, []byte(`{"settings":{"activityLimit":5000},"services":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	problems, err := CheckFile(bad)
	if err != nil || len(problems) != 1 || !strings.Contains(problems[0], "activityLimit") {
		t.Fatalf("check %v %v", problems, err)
	}
}

func TestPausedTokenRefusesUntilResumed(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	withPhone, err := store.AddToken("one", "phone")
	if err != nil {
		t.Fatal(err)
	}
	phone := withPhone.Tokens[1]
	paused, err := store.SetTokenPaused("one", phone.ID, true)
	if err != nil || !paused.Tokens[1].Paused || paused.Tokens[0].Paused {
		t.Fatalf("pause %+v %v", paused.Tokens, err)
	}
	rotated, err := store.RotateTokenID("one", phone.ID)
	if err != nil || !rotated.Tokens[1].Paused || rotated.Tokens[1].Secret == phone.Secret {
		t.Fatalf("rotate kept pause %+v %v", rotated.Tokens[1], err)
	}
	again, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	saved, ok := again.Get("one")
	if !ok || !saved.Tokens[1].Paused {
		t.Fatal("pause did not persist")
	}

	app := &App{store: store, activity: newActivityLog()}
	req := httptest.NewRequest(http.MethodGet, "/p/one/x", nil)
	req.SetPathValue("name", "one")
	req.SetPathValue("rest", "x")
	req.Header.Set("Authorization", "Bearer "+rotated.Tokens[1].Secret)
	rec := httptest.NewRecorder()
	app.proxy(rec, req)
	body, _ := io.ReadAll(rec.Body)
	if rec.Code != http.StatusForbidden || !strings.Contains(string(body), "token paused") {
		t.Fatalf("paused status %d body %s", rec.Code, body)
	}
	events := app.activity.list("one")
	if len(events) != 1 || events[0].Who != "phone" || events[0].Reason != "paused" || events[0].Status != http.StatusForbidden {
		t.Fatalf("activity %+v", events)
	}
	if _, _, _, who := app.activity.summary("one"); who != "phone · paused" {
		t.Fatalf("summary who %q", who)
	}

	req.Header.Set("Authorization", "Bearer "+rotated.Tokens[0].Secret)
	if who, ok := identifyCaller(rotated, req); !ok || who != rotated.Tokens[0].Name {
		t.Fatalf("active sibling who %q ok %v", who, ok)
	}
	if _, err := store.SetTokenPaused("one", phone.ID, false); err != nil {
		t.Fatal(err)
	}
	resumed, _ := store.Get("one")
	req.Header.Set("Authorization", "Bearer "+resumed.Tokens[1].Secret)
	if who, ok := identifyCaller(resumed, req); !ok || who != "phone" {
		t.Fatalf("resumed who %q ok %v", who, ok)
	}

	up := Service{
		Name: "s", Enabled: true, Access: AccessUpstream,
		Tokens: []CallerToken{{Name: "phone", Secret: "pst", Paused: true}},
		Auth:   UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real"}},
	}
	upReq := httptest.NewRequest(http.MethodGet, "/p/s/x", nil)
	upReq.Header.Set("X-Api-Key", "pst")
	if who, ok := identifyCaller(up, upReq); ok || who != "phone" {
		t.Fatalf("upstream token who %q ok %v", who, ok)
	}
	upReq.Header.Set("X-Api-Key", "real")
	if who, ok := identifyCaller(up, upReq); !ok || who != "upstream" {
		t.Fatalf("real secret who %q ok %v", who, ok)
	}
}

// identifyCaller keeps the older (name, allowed) shape for these tests.
func identifyCaller(svc Service, r *http.Request) (string, bool) {
	c := resolveCaller(svc, r, time.Now())
	return c.Name, c.Allowed
}
