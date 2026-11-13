package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseVersion(t *testing.T) {
	good := map[string]semver{"1.2.3": {1, 2, 3}, "v0.10.0": {0, 10, 0}, " v2.0.1 ": {2, 0, 1}}
	for in, want := range good {
		got, ok := parseVersion(in)
		if !ok || got != want {
			t.Errorf("%q: got %v %v", in, got, ok)
		}
	}
	for _, in := range []string{"", "dev", "1.2", "1.2.3.4", "1.2.3-rc1", "1.x.3", "v", "01.2.3", "-1.2.3", "1.2.3+build"} {
		if _, ok := parseVersion(in); ok {
			t.Errorf("%q should not parse", in)
		}
	}
}

func TestSemverOrdersNumerically(t *testing.T) {
	// 0.10.0 is newer than 0.9.0, though it sorts lower as text.
	a, _ := parseVersion("0.9.0")
	b, _ := parseVersion("0.10.0")
	if !a.less(b) || b.less(a) || a.less(a) {
		t.Fatal("0.9.0 must be older than 0.10.0")
	}
}

func rel(tag, body string) ghRelease {
	return ghRelease{TagName: tag, HTMLURL: "https://example.test/" + tag, Body: body, PublishedAt: "2026-11-13T10:00:00Z"}
}

func TestPickReleasesNewestFirstAndSkipsNoise(t *testing.T) {
	cur, _ := parseVersion("0.8.0")
	draft := rel("v1.0.0", "draft")
	draft.Draft = true
	pre := rel("v0.9.5", "pre")
	pre.Prerelease = true
	raw := []ghRelease{
		rel("v0.8.0", "current"),
		rel("v0.10.0", "ten"),
		rel("v0.9.0", "nine"),
		draft,
		pre,
		rel("not-a-version", "junk"),
		rel("v0.7.0", "old"),
	}
	latest, newer, more := pickReleases(raw, cur)
	if latest != "0.10.0" {
		t.Fatalf("latest %q", latest)
	}
	if len(newer) != 2 || newer[0].Version != "0.10.0" || newer[1].Version != "0.9.0" {
		t.Fatalf("newer %+v", newer)
	}
	if more {
		t.Fatal("a short page cannot have more")
	}
}

func TestPickReleasesUpToDate(t *testing.T) {
	cur, _ := parseVersion("0.9.0")
	latest, newer, more := pickReleases([]ghRelease{rel("v0.9.0", ""), rel("v0.8.0", "")}, cur)
	if latest != "0.9.0" || len(newer) != 0 || more || newer == nil {
		t.Fatalf("latest %q newer %v more %v", latest, newer, more)
	}
}

func TestPickReleasesCapsAndFlagsMore(t *testing.T) {
	cur, _ := parseVersion("0.0.1")
	var raw []ghRelease
	for i := 1; i <= releasesFetch; i++ {
		raw = append(raw, rel("v1."+strings.Repeat("1", 1)+"."+itoa(i), ""))
	}
	_, newer, more := pickReleases(raw, cur)
	if len(newer) != updateKeep || !more {
		t.Fatalf("len %d more %v", len(newer), more)
	}
	if newer[0].Version != "1.1.30" {
		t.Fatalf("newest first, got %s", newer[0].Version)
	}
	// A full page that reaches back to the current version has nothing hidden.
	cur2, _ := parseVersion("1.1.29")
	_, _, more2 := pickReleases(raw, cur2)
	if more2 {
		t.Fatal("page reaches current version; nothing is hidden")
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestClipBody(t *testing.T) {
	long := strings.Repeat("é", updateBodyMax) // 2 bytes each, so the cut can land mid-rune
	got := clipBody(long)
	if len(got) > updateBodyMax+8 || !strings.HasSuffix(got, "…") {
		t.Fatalf("len %d", len(got))
	}
	if strings.ContainsRune(got, '�') {
		t.Fatal("cut inside a rune")
	}
	if clipBody("a\r\nb") != "a\nb" {
		t.Fatal("CRLF not normalised")
	}
}

func githubStub(t *testing.T, status int, body any, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits != nil {
			hits.Add(1)
		}
		if r.Header.Get("User-Agent") != "postern-update-check" {
			t.Errorf("User-Agent %q", r.Header.Get("User-Agent"))
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Errorf("credentials leaked to GitHub: %v", r.Header)
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestRefreshReportsAvailableUpdate(t *testing.T) {
	srv := githubStub(t, 200, []ghRelease{rel("v0.10.0", "## ten"), rel("v0.9.0", "## nine"), rel("v0.8.0", "## eight")}, nil)
	u := newUpdateChecker("0.8.0", false)
	u.url = srv.URL
	u.Refresh(context.Background())
	st := u.Status()
	if !st.Enabled || !st.Available || st.Latest != "0.10.0" || st.Error != "" || st.CheckedAt.IsZero() {
		t.Fatalf("%+v", st)
	}
	if len(st.Releases) != 2 || st.Releases[1].Body != "## nine" {
		t.Fatalf("releases %+v", st.Releases)
	}
	if st.ReleasesURL == "" || st.Image == "" {
		t.Fatalf("links %+v", st)
	}
}

func TestRefreshUpToDate(t *testing.T) {
	srv := githubStub(t, 200, []ghRelease{rel("v0.9.0", "x")}, nil)
	u := newUpdateChecker("0.9.0", false)
	u.url = srv.URL
	u.Refresh(context.Background())
	st := u.Status()
	if st.Available || st.Latest != "0.9.0" || len(st.Releases) != 0 {
		t.Fatalf("%+v", st)
	}
}

func TestRefreshFailureKeepsLastGoodAnswer(t *testing.T) {
	good := githubStub(t, 200, []ghRelease{rel("v0.9.0", "nine")}, nil)
	u := newUpdateChecker("0.8.0", false)
	u.url = good.URL
	u.Refresh(context.Background())

	bad := githubStub(t, 500, map[string]string{"message": "boom"}, nil)
	u.url = bad.URL
	u.lastTry = time.Time{} // let the second call through the rate guard
	u.Refresh(context.Background())
	st := u.Status()
	if st.Error == "" || !strings.Contains(st.Error, "500") {
		t.Fatalf("error %q", st.Error)
	}
	if !st.Available || st.Latest != "0.9.0" || len(st.Releases) != 1 {
		t.Fatalf("lost the last good answer: %+v", st)
	}
}

func TestRefreshRateLimitedMessage(t *testing.T) {
	srv := githubStub(t, 403, map[string]string{"message": "rate limit"}, nil)
	u := newUpdateChecker("0.8.0", false)
	u.url = srv.URL
	u.Refresh(context.Background())
	if e := u.Status().Error; !strings.Contains(e, "rate limiting") {
		t.Fatalf("error %q", e)
	}
}

func TestRefreshUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	u := newUpdateChecker("0.8.0", false)
	u.url = url
	u.Refresh(context.Background())
	if e := u.Status().Error; !strings.Contains(e, "could not reach GitHub") {
		t.Fatalf("error %q", e)
	}
}

func TestRefreshMinGap(t *testing.T) {
	var hits atomic.Int32
	srv := githubStub(t, 200, []ghRelease{rel("v0.9.0", "")}, &hits)
	u := newUpdateChecker("0.8.0", false)
	u.url = srv.URL
	for i := 0; i < 5; i++ {
		u.Refresh(context.Background())
	}
	if hits.Load() != 1 {
		t.Fatalf("%d requests; checks closer than %s must be ignored", hits.Load(), updateMinGap)
	}
}

func TestDisabledNeverCallsOut(t *testing.T) {
	var hits atomic.Int32
	srv := githubStub(t, 200, []ghRelease{rel("v9.9.9", "")}, &hits)
	for name, tc := range map[string]struct {
		version string
		off     bool
		reason  string
	}{
		"off": {"0.8.0", true, "off"},
		"dev": {"dev", false, "dev"},
	} {
		u := newUpdateChecker(tc.version, tc.off)
		u.url = srv.URL
		u.Refresh(context.Background())
		st := u.Status()
		if st.Enabled || st.Reason != tc.reason || st.Available {
			t.Fatalf("%s: %+v", name, st)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("%d requests while disabled", hits.Load())
	}
	// A nil checker (tests build App without one) is just "off".
	var none *updateChecker
	if st := none.Status(); st.Enabled || st.Releases == nil {
		t.Fatalf("nil checker: %+v", st)
	}
	none.Refresh(context.Background())
}

func TestUpdateCheckOffEnv(t *testing.T) {
	for v, want := range map[string]bool{"": false, "on": false, "off": true, "OFF": true, "0": true, "false": true, " no ": true, "disabled": true} {
		t.Setenv("POSTERN_UPDATE_CHECK", v)
		if got := updateCheckOff(); got != want {
			t.Errorf("%q: got %v want %v", v, got, want)
		}
	}
}

func TestInContainerEnv(t *testing.T) {
	t.Setenv("POSTERN_CONTAINER", "1")
	if !inContainer() {
		t.Fatal("POSTERN_CONTAINER=1 not honoured")
	}
}

func TestUpdateHandlers(t *testing.T) {
	srv := githubStub(t, 200, []ghRelease{rel("v0.9.0", "nine")}, nil)
	u := newUpdateChecker("0.8.0", false)
	u.url = srv.URL
	app := &App{updates: u}

	rec := httptest.NewRecorder()
	app.getUpdate(rec, httptest.NewRequest(http.MethodGet, "/admin/api/update", nil))
	var st updateStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || rec.Code != 200 {
		t.Fatalf("%d %v", rec.Code, err)
	}
	if st.Available || st.Releases == nil {
		t.Fatalf("GET must not trigger a check: %+v", st)
	}

	rec = httptest.NewRecorder()
	app.checkUpdate(rec, httptest.NewRequest(http.MethodPost, "/admin/api/update/check", nil))
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || rec.Code != 200 || !st.Available || st.Latest != "0.9.0" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}

	off := &App{updates: newUpdateChecker("0.8.0", true)}
	rec = httptest.NewRecorder()
	off.checkUpdate(rec, httptest.NewRequest(http.MethodPost, "/admin/api/update/check", nil))
	if rec.Code != http.StatusConflict {
		t.Fatalf("off: status %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	(&App{}).checkUpdate(rec, httptest.NewRequest(http.MethodPost, "/admin/api/update/check", nil))
	if rec.Code != http.StatusConflict {
		t.Fatalf("nil: status %d", rec.Code)
	}
}
