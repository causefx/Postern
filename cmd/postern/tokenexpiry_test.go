package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newExpiryStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "d.json")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	return store, path
}

func bearerReq(secret string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/p/one/x", nil)
	req.SetPathValue("name", "one")
	req.SetPathValue("rest", "x")
	req.Header.Set("Authorization", "Bearer "+secret)
	return req
}

func TestTokenExpiredBoundary(t *testing.T) {
	at := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	tok := CallerToken{ExpiresAt: at}
	if tok.Expired(at.Add(-time.Nanosecond)) {
		t.Fatal("expired before the deadline")
	}
	if !tok.Expired(at) {
		t.Fatal("not expired at the deadline")
	}
	if !tok.Expired(at.Add(time.Hour)) {
		t.Fatal("not expired after the deadline")
	}
	if (CallerToken{}).Expired(at) {
		t.Fatal("a token without an expiry must never expire")
	}
}

func TestResolveCallerExpiredAndPausedReasons(t *testing.T) {
	at := time.Date(2030, 1, 2, 3, 4, 5, 0, time.UTC)
	svc := Service{
		Name: "one", Enabled: true,
		Tokens: []CallerToken{
			{ID: "a", Name: "phone", Secret: "s-phone", ExpiresAt: at},
			{ID: "b", Name: "laptop", Secret: "s-laptop", Paused: true, ExpiresAt: at.Add(-time.Hour)},
			{ID: "c", Name: "forever", Secret: "s-forever"},
		},
	}
	cases := []struct {
		secret  string
		now     time.Time
		allowed bool
		reason  string
		id      string
	}{
		{"s-phone", at.Add(-time.Second), true, "", "a"},
		{"s-phone", at, false, "expired", "a"},
		{"s-laptop", at, false, "paused", "b"}, // paused wins over expired
		{"s-forever", at.Add(100 * 365 * 24 * time.Hour), true, "", "c"},
		{"nope", at, false, "", ""},
	}
	for _, c := range cases {
		got := resolveCaller(svc, bearerReq(c.secret), c.now)
		if got.Allowed != c.allowed || got.Reason != c.reason || got.ID != c.id {
			t.Errorf("%s at %v: %+v", c.secret, c.now, got)
		}
	}
}

func TestExpiredTokenInUpstreamMode(t *testing.T) {
	past := time.Now().Add(-time.Minute)
	svc := Service{
		Name: "s", Enabled: true, Access: AccessUpstream,
		Tokens: []CallerToken{{ID: "a", Name: "phone", Secret: "pst", ExpiresAt: past}},
		Auth:   UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "real"}},
	}
	req := httptest.NewRequest(http.MethodGet, "/p/s/x", nil)
	req.Header.Set("X-Api-Key", "pst")
	if got := resolveCaller(svc, req, time.Now()); got.Allowed || got.Reason != "expired" || got.Name != "phone" {
		t.Fatalf("expired token in upstream mode: %+v", got)
	}
	req.Header.Set("X-Api-Key", "real")
	if got := resolveCaller(svc, req, time.Now()); !got.Allowed || got.Name != "upstream" {
		t.Fatalf("real upstream key must still work: %+v", got)
	}
}

func TestProxyRefusesExpiredToken(t *testing.T) {
	hits := 0
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusNoContent)
	}))
	defer up.Close()

	store, _ := newExpiryStore(t)
	_, err := store.Create(Service{
		Name: "one", URL: up.URL, Enabled: true,
		Tokens: []CallerToken{
			{Name: "old", Secret: "secret-old", ExpiresAt: time.Now().Add(-time.Hour)},
			{Name: "new", Secret: "secret-new", ExpiresAt: time.Now().Add(time.Hour)},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("one")
	app := &App{store: store, activity: newActivityLog(), usage: openTokenUsage("")}

	rec := httptest.NewRecorder()
	app.proxy(rec, bearerReq("secret-old"))
	body, _ := io.ReadAll(rec.Body)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(string(body), "token expired") {
		t.Fatalf("expired: %d %s", rec.Code, body)
	}
	if hits != 0 {
		t.Fatal("an expired token reached the upstream")
	}
	events := app.activity.list("one")
	if len(events) != 1 || events[0].Who != "old" || events[0].Reason != "expired" || events[0].Status != http.StatusUnauthorized {
		t.Fatalf("activity %+v", events)
	}
	if _, _, _, who := app.activity.summary("one"); who != "old · expired" {
		t.Fatalf("summary who %q", who)
	}
	if !app.usage.lastUsed(svc.Tokens[0].ID).IsZero() {
		t.Fatal("a refused token must not count as used")
	}

	rec = httptest.NewRecorder()
	app.proxy(rec, bearerReq("secret-new"))
	if rec.Code != http.StatusNoContent || hits != 1 {
		t.Fatalf("unexpired token: %d hits %d", rec.Code, hits)
	}
	if app.usage.lastUsed(svc.Tokens[1].ID).IsZero() {
		t.Fatal("a successful call must record last used")
	}
}

func TestSetTokenExpiryPersistsAndSurvivesRotate(t *testing.T) {
	store, path := newExpiryStore(t)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("one")
	id := svc.Tokens[0].ID

	raw, _ := os.ReadFile(path)
	if strings.Contains(string(raw), "expiresAt") {
		t.Fatal("a token with no expiry must not write expiresAt")
	}

	if _, err := store.SetTokenExpiry("one", id, time.Now().Add(-time.Minute)); err == nil {
		t.Fatal("a past expiry must be refused")
	}
	if _, err := store.SetTokenExpiry("one", "missing", time.Now().Add(time.Hour)); err == nil {
		t.Fatal("an unknown token must be refused")
	}

	at := time.Now().Add(48 * time.Hour).UTC().Truncate(time.Second)
	if _, err := store.SetTokenExpiry("one", id, at); err != nil {
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
	if !got.Tokens[0].ExpiresAt.Equal(at) {
		t.Fatalf("expiry after rotate and reload = %v, want %v", got.Tokens[0].ExpiresAt, at)
	}

	cleared, err := reopened.SetTokenExpiry("one", id, time.Time{})
	if err != nil || !cleared.Tokens[0].ExpiresAt.IsZero() {
		t.Fatalf("clear: %+v %v", cleared.Tokens[0], err)
	}
	raw, _ = os.ReadFile(path)
	if strings.Contains(string(raw), "expiresAt") {
		t.Fatal("clearing must drop expiresAt from the file")
	}
}

func patchTokenReq(app *App, service, id, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/admin/api/services/"+service+"/tokens/"+id, strings.NewReader(body))
	req.SetPathValue("name", service)
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	app.patchToken(rec, req)
	return rec
}

func TestPatchTokenExpiryAPI(t *testing.T) {
	store, path := newExpiryStore(t)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	svc, _ := store.Get("one")
	id := svc.Tokens[0].ID
	app := &App{store: store, audit: newAuditLog(path + ".audit"), usage: openTokenUsage("")}

	for name, body := range map[string]string{
		"empty body":  `{}`,
		"bad format":  `{"expiresAt":"tomorrow"}`,
		"past":        `{"expiresAt":"2001-01-01T00:00:00Z"}`,
		"not json":    `nope`,
		"wrong types": `{"expiresAt":5}`,
	} {
		if rec := patchTokenReq(app, "one", id, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d body %s", name, rec.Code, rec.Body)
		}
	}
	if rec := patchTokenReq(app, "one", "missing", `{"expiresAt":"2999-01-01T00:00:00Z"}`); rec.Code != http.StatusNotFound {
		t.Errorf("unknown token: %d", rec.Code)
	}
	if rec := patchTokenReq(app, "nope", id, `{"expiresAt":"2999-01-01T00:00:00Z"}`); rec.Code != http.StatusNotFound {
		t.Errorf("unknown service: %d", rec.Code)
	}

	rec := patchTokenReq(app, "one", id, `{"expiresAt":"2999-01-01T00:00:00Z"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set: %d %s", rec.Code, rec.Body)
	}
	var v view
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	if v.Tokens[0].ExpiresAt.Year() != 2999 || v.Tokens[0].Expired {
		t.Fatalf("view token %+v", v.Tokens[0])
	}

	rec = patchTokenReq(app, "one", id, `{"paused":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("pause still works: %d %s", rec.Code, rec.Body)
	}
	cur, _ := store.Get("one")
	if !cur.Tokens[0].Paused || cur.Tokens[0].ExpiresAt.IsZero() {
		t.Fatalf("pausing must not drop the expiry: %+v", cur.Tokens[0])
	}

	rec = patchTokenReq(app, "one", id, `{"expiresAt":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body)
	}
	cur, _ = store.Get("one")
	if !cur.Tokens[0].ExpiresAt.IsZero() {
		t.Fatal("empty string must clear the expiry")
	}

	audit := app.audit.list()
	var sawSet, sawClear bool
	for _, ev := range audit {
		if ev.Action != "token_expiry" {
			continue
		}
		if strings.HasPrefix(ev.Expires, "2999") {
			sawSet = true
		}
		if ev.Expires == "" {
			sawClear = true
		}
	}
	if !sawSet || !sawClear {
		t.Fatalf("audit missing expiry events: %+v", audit)
	}
}

func TestViewMarksExpiredAndLastUsed(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	svc := Service{
		Name: "one", URL: "http://x", Enabled: true,
		Token: "a",
		Tokens: []CallerToken{
			{ID: "t1", Name: "old", Secret: "a", ExpiresAt: past},
			{ID: "t2", Name: "fresh", Secret: "b"},
		},
	}
	usage := openTokenUsage("")
	used := time.Now().Add(-time.Minute).UTC()
	usage.touch("t2", used)
	app := &App{usage: usage}
	v := app.present(svc, "http://h")
	if !v.Tokens[0].Expired || !v.Tokens[0].ExpiresAt.Equal(past) {
		t.Fatalf("expired view %+v", v.Tokens[0])
	}
	if v.Tokens[1].Expired || !v.Tokens[1].LastUsedAt.Equal(used) || !v.Tokens[0].LastUsedAt.IsZero() {
		t.Fatalf("last used view %+v", v.Tokens)
	}
	b, _ := json.Marshal(v.Tokens[1])
	if strings.Contains(string(b), "expiresAt") {
		t.Fatalf("a token with no expiry must omit expiresAt: %s", b)
	}
}

func TestTokenUsagePersistsAndForgets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "d.json.usage")
	u := openTokenUsage(path)
	at := time.Date(2030, 5, 6, 7, 8, 9, 0, time.UTC)
	u.touch("a", at)
	u.touch("b", at.Add(time.Hour))
	u.touch("", at) // ignored
	u.flush()

	again := openTokenUsage(path)
	if !again.lastUsed("a").Equal(at) || !again.lastUsed("b").Equal(at.Add(time.Hour)) {
		t.Fatalf("reload lost entries: %v", again.last)
	}
	if len(again.last) != 2 {
		t.Fatalf("empty id was stored: %v", again.last)
	}
	again.forget("a", "unknown")
	if !openTokenUsage(path).lastUsed("a").IsZero() {
		t.Fatal("forget did not persist")
	}
	if openTokenUsage(path).lastUsed("b").IsZero() {
		t.Fatal("forget removed the wrong token")
	}
}

func TestTokenUsageSurvivesBadFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "d.json.usage")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	u := openTokenUsage(path)
	u.touch("a", time.Now())
	if u.lastUsed("a").IsZero() {
		t.Fatal("a corrupt file must start empty, not break tracking")
	}
	var nilUsage *tokenUsage
	nilUsage.touch("a", time.Now()) // must not panic
	if !nilUsage.lastUsed("a").IsZero() {
		t.Fatal("nil usage must report never")
	}
	nilUsage.forget("a")
}
