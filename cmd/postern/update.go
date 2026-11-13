package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Update checking. Postern asks GitHub which releases exist and compares them
// with its own Version. It only reports: it never downloads or replaces
// anything. One request lists the recent releases, so the same answer carries
// the notes for every version the user is behind.
//
// The request is a plain GET to the public GitHub API with a generic
// User-Agent. Nothing about this instance is sent. POSTERN_UPDATE_CHECK=off
// turns it off.

const (
	releasesAPI  = "https://api.github.com/repos/causefx/Postern/releases?per_page=30"
	releasesPage = "https://github.com/causefx/Postern/releases"
	imageName    = "ghcr.io/causefx/postern"

	updateEvery  = 24 * time.Hour
	updateRetry  = time.Hour
	updateMinGap = 30 * time.Second
	updateFirst  = 5 * time.Second
	// updateKeep is how many newer releases are returned with their notes.
	updateKeep    = 20
	updateBodyMax = 8000
	releasesFetch = 30
)

type semver struct{ major, minor, patch int }

// parseVersion reads "1.2.3" or "v1.2.3". Anything else, including pre-release
// tags and "dev", is not a release version.
func parseVersion(s string) (semver, bool) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return semver{}, false
	}
	var n [3]int
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 || p != strconv.Itoa(v) {
			return semver{}, false
		}
		n[i] = v
	}
	return semver{n[0], n[1], n[2]}, true
}

func (a semver) less(b semver) bool {
	if a.major != b.major {
		return a.major < b.major
	}
	if a.minor != b.minor {
		return a.minor < b.minor
	}
	return a.patch < b.patch
}

// releaseNote is one release as the admin UI shows it. Body is the release
// notes markdown from GitHub.
type releaseNote struct {
	Version string `json:"version"`
	Date    string `json:"date,omitempty"`
	URL     string `json:"url"`
	Body    string `json:"body"`
}

// updateStatus is what the admin API returns.
type updateStatus struct {
	// Enabled is false when checking is off or this is a development build;
	// Reason says which ("off" or "dev").
	Enabled   bool      `json:"enabled"`
	Reason    string    `json:"reason,omitempty"`
	Current   string    `json:"current"`
	Latest    string    `json:"latest,omitempty"`
	Available bool      `json:"available"`
	CheckedAt time.Time `json:"checkedAt,omitzero"`
	// Error is the last check's failure. Latest and Releases keep the last good answer.
	Error string `json:"error,omitempty"`
	// Container is true when running in a container image, so the UI tells the
	// user to pull a new image rather than download a binary.
	Container   bool          `json:"container"`
	Image       string        `json:"image"`
	ReleasesURL string        `json:"releasesUrl"`
	Releases    []releaseNote `json:"releases"`
	// More means there are older unseen releases than the list holds.
	More bool `json:"more,omitempty"`
}

type updateChecker struct {
	current   string
	cur       semver
	disabled  string // "", "off" or "dev"
	container bool
	url       string
	client    *http.Client

	mu        sync.Mutex
	lastTry   time.Time
	checkedAt time.Time
	latest    string
	releases  []releaseNote
	more      bool
	err       string
}

// updateCheckOff reports whether POSTERN_UPDATE_CHECK turns checking off.
func updateCheckOff() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("POSTERN_UPDATE_CHECK"))) {
	case "off", "0", "false", "no", "disabled":
		return true
	}
	return false
}

// inContainer reports whether the process runs in a container image. The
// image sets POSTERN_CONTAINER; the marker files cover Docker and Podman runs
// of other images.
func inContainer() bool {
	if envTruthy("POSTERN_CONTAINER") {
		return true
	}
	for _, p := range []string{"/.dockerenv", "/run/.containerenv"} {
		if _, err := os.Stat(p); err == nil {
			return true
		}
	}
	return false
}

func newUpdateChecker(current string, off bool) *updateChecker {
	u := &updateChecker{
		current:   current,
		url:       releasesAPI,
		client:    &http.Client{Timeout: 10 * time.Second},
		container: inContainer(),
	}
	cur, ok := parseVersion(current)
	u.cur = cur
	switch {
	case off:
		u.disabled = "off"
	case !ok:
		u.disabled = "dev"
	}
	return u
}

func (u *updateChecker) enabled() bool { return u != nil && u.disabled == "" }

// Status returns the cached answer. It never touches the network.
func (u *updateChecker) Status() updateStatus {
	if u == nil {
		return updateStatus{Reason: "off", Releases: []releaseNote{}, ReleasesURL: releasesPage, Image: imageName}
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	st := updateStatus{
		Enabled:     u.disabled == "",
		Reason:      u.disabled,
		Current:     u.current,
		Latest:      u.latest,
		CheckedAt:   u.checkedAt,
		Error:       u.err,
		Container:   u.container,
		Image:       imageName,
		ReleasesURL: releasesPage,
		Releases:    append([]releaseNote{}, u.releases...),
		More:        u.more,
	}
	if v, ok := parseVersion(u.latest); ok && u.cur.less(v) {
		st.Available = true
	}
	return st
}

// Refresh asks GitHub for the releases. Calls closer together than
// updateMinGap are ignored, so a button cannot burn through GitHub's
// unauthenticated rate limit.
func (u *updateChecker) Refresh(ctx context.Context) {
	if !u.enabled() {
		return
	}
	u.mu.Lock()
	if time.Since(u.lastTry) < updateMinGap {
		u.mu.Unlock()
		return
	}
	u.lastTry = time.Now()
	u.mu.Unlock()

	raw, err := u.fetch(ctx)
	u.mu.Lock()
	defer u.mu.Unlock()
	if err != nil {
		u.err = err.Error()
		return
	}
	u.err = ""
	u.checkedAt = time.Now().UTC()
	u.latest, u.releases, u.more = pickReleases(raw, u.cur)
}

type ghRelease struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	Body        string `json:"body"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

func (u *updateChecker) fetch(ctx context.Context) ([]ghRelease, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "postern-update-check")
	res, err := u.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach GitHub: %w", err)
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusForbidden || res.StatusCode == http.StatusTooManyRequests:
		return nil, fmt.Errorf("GitHub is rate limiting update checks (HTTP %d); try again later", res.StatusCode)
	case res.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("GitHub answered HTTP %d", res.StatusCode)
	}
	var out []ghRelease
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("unreadable answer from GitHub: %w", err)
	}
	return out, nil
}

// pickReleases keeps real releases newer than cur, newest first, and reports
// the newest version overall. more is true when releases older than the
// fetched page may also be newer than cur.
func pickReleases(raw []ghRelease, cur semver) (latest string, newer []releaseNote, more bool) {
	type item struct {
		v    semver
		note releaseNote
	}
	var all []item
	for _, r := range raw {
		if r.Draft || r.Prerelease {
			continue
		}
		v, ok := parseVersion(r.TagName)
		if !ok {
			continue
		}
		all = append(all, item{v: v, note: releaseNote{
			Version: fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch),
			Date:    r.PublishedAt,
			URL:     r.HTMLURL,
			Body:    clipBody(r.Body),
		}})
	}
	sort.Slice(all, func(i, j int) bool { return all[j].v.less(all[i].v) })
	if len(all) == 0 {
		return "", []releaseNote{}, false
	}
	latest = all[0].note.Version
	newer = []releaseNote{}
	for _, it := range all {
		if cur.less(it.v) {
			newer = append(newer, it.note)
		}
	}
	// Every release on the page is newer than we are, and the page was full:
	// there may be more beyond it.
	more = len(newer) > updateKeep || (len(raw) >= releasesFetch && len(newer) == len(all))
	if len(newer) > updateKeep {
		newer = newer[:updateKeep]
	}
	return latest, newer, more
}

func clipBody(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if len(s) <= updateBodyMax {
		return s
	}
	s = s[:updateBodyMax]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s + "\n…"
}

// run checks shortly after start and then daily, retrying sooner after a failure.
func (u *updateChecker) run(ctx context.Context) {
	if !u.enabled() {
		return
	}
	wait := updateFirst
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		u.Refresh(ctx)
		u.mu.Lock()
		failed := u.err != ""
		u.mu.Unlock()
		wait = updateEvery
		if failed {
			wait = updateRetry
		}
	}
}

func (a *App) getUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, a.updates.Status())
}

// checkUpdate runs a check now and returns the result.
func (a *App) checkUpdate(w http.ResponseWriter, r *http.Request) {
	if !a.updates.enabled() {
		writeErr(w, 409, "update checks are off")
		return
	}
	a.updates.Refresh(r.Context())
	writeJSON(w, 200, a.updates.Status())
}
