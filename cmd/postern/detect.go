package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// App detection. Given an upstream address, work out which app answers there so the screen can
// suggest how it takes its key. What each app looks like is data in apps/<id>/app.json; this file is
// the engine that reads it.
//
//  1. Passive: score every app against the page the address already returns (its headers, the
//     strings in it, and its <title>). The best score wins. Most apps are recognised here.
//  2. Active: only when nothing matched, ask the few paths apps mark "discover" (at most
//     maxDiscoverPaths, each once, at the same time) and run every app's probe on that path
//     against the answer.
//
// Once an app is known, its probe (if it has one) is asked for the version. Probes never carry the
// upstream credential and never follow a redirect to another host.

// Detection is what an address turned out to be.
type Detection struct {
	App     string `json:"app"`
	Label   string `json:"label"`
	Version string `json:"version,omitempty"`
}

// detectBodyLimit is how much of a page is read to look for markers. App shells put their title
// and boot script near the top.
const detectBodyLimit = 64 << 10

// Scores for the passive pass. A header or an exact string is specific to one app; a title can be
// shared ("Login"), so it counts for less, and a title that is exactly the app's name beats one that
// only contains it.
const (
	scoreHeader     = 100
	scoreBody       = 80
	scoreTitleExact = 60
	scoreTitleWord  = 40
)

var titleRe = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

// matchPage is the passive pass: the best-scoring app for a page already fetched, or nil.
func (r *appRegistry) matchPage(h http.Header, body []byte) *appDef {
	title := ""
	if m := titleRe.FindSubmatch(body); m != nil {
		title = strings.ToLower(strings.Join(strings.Fields(string(m[1])), " "))
	}
	page := string(body)
	var best *appDef
	bestScore := 0
	for _, a := range r.apps {
		score := 0
		if a.header != "" && h != nil && h.Get(a.header) != "" {
			score = max(score, scoreHeader)
		}
		for _, s := range a.bodies {
			if strings.Contains(page, s) {
				score = max(score, scoreBody)
			}
		}
		if title != "" {
			for _, t := range a.titles {
				switch {
				case title == t:
					score = max(score, scoreTitleExact)
				case wordIn(title, t):
					score = max(score, scoreTitleWord)
				}
			}
		}
		// Apps are sorted by id, so a tie goes to the same app every time.
		if score > bestScore {
			best, bestScore = a, score
		}
	}
	return best
}

// fingerprint names the app behind base. h and body are the response base already gave (up to
// detectBodyLimit bytes); both may be empty, and then only the active pass runs.
func (r *appRegistry) fingerprint(ctx context.Context, base *url.URL, h http.Header, body []byte) *Detection {
	client := probeClient(base)
	if a := r.matchPage(h, body); a != nil {
		d := &Detection{App: a.ID, Label: a.Label}
		if a.probe != nil {
			if b, ok := probeGet(ctx, client, base, a.probe.Path); ok {
				if v, ok := a.check(b); ok {
					d.Version = v
				}
			}
		}
		return d
	}

	answers := make([][]byte, len(r.discover))
	var wg sync.WaitGroup
	for i, p := range r.discover {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if b, ok := probeGet(ctx, client, base, p); ok {
				answers[i] = b
			}
		}()
	}
	wg.Wait()
	for i, p := range r.discover {
		if answers[i] == nil {
			continue
		}
		for _, a := range r.apps {
			if a.probe == nil || !a.probe.Discover || a.probe.Path != p {
				continue
			}
			if v, ok := a.check(answers[i]); ok {
				return &Detection{App: a.ID, Label: a.Label, Version: v}
			}
		}
	}
	return nil
}

// check runs the app's probe checks on an answer and returns the version it reports, if any.
func (a *appDef) check(b []byte) (string, bool) {
	p := a.probe
	var obj map[string]json.RawMessage
	needJSON := len(p.JSON) > 0 || len(p.JSONKeys) > 0 || (p.Version != nil && p.Version.JSON != "")
	if needJSON {
		if json.Unmarshal(b, &obj) != nil {
			return "", false
		}
	}
	for field, op := range p.JSON {
		raw, ok := obj[field]
		if !ok {
			return "", false
		}
		if op.Present != nil {
			continue
		}
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return "", false
		}
		if op.Contains != nil && !strings.Contains(s, *op.Contains) {
			return "", false
		}
		if op.Equals != nil && s != *op.Equals {
			return "", false
		}
	}
	if len(p.JSONKeys) > 0 {
		if len(obj) != len(p.JSONKeys) {
			return "", false
		}
		for _, k := range p.JSONKeys {
			if _, ok := obj[k]; !ok {
				return "", false
			}
		}
	}
	for _, t := range p.Text {
		if !strings.Contains(string(b), t) {
			return "", false
		}
	}
	version := ""
	switch {
	case p.Version == nil:
	case p.Version.JSON != "":
		var s string
		if json.Unmarshal(obj[p.Version.JSON], &s) == nil {
			version = cleanVersion(s)
		}
	case a.version != nil:
		if m := a.version.FindSubmatch(b); m != nil {
			version = cleanVersion(string(m[1]))
		}
	}
	return version, true
}

// probeClient follows at most three redirects, and only on base's own host, so a probe can never
// be sent somewhere the person did not type.
func probeClient(base *url.URL) *http.Client {
	return &http.Client{
		Timeout: 3 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("stopped after 3 redirects")
			}
			if req.URL.Host != base.Host {
				return errors.New("redirect to another host")
			}
			return nil
		},
	}
}

// probeGet fetches base + path (path may carry a query) with no credential. It reports the body
// only for a 2xx answer.
func probeGet(ctx context.Context, client *http.Client, base *url.URL, path string) ([]byte, bool) {
	ref, err := url.Parse(strings.TrimPrefix(path, "/"))
	if err != nil {
		return nil, false
	}
	dir := *base
	if !strings.HasSuffix(dir.Path, "/") {
		dir.Path += "/"
	}
	dir.RawQuery = ""
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dir.ResolveReference(ref).String(), nil)
	if err != nil {
		return nil, false
	}
	req.Header.Set("Accept", "application/json, application/xml;q=0.9, */*;q=0.5")
	res, err := client.Do(req)
	if err != nil {
		return nil, false
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, false
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, detectBodyLimit))
	if err != nil {
		return nil, false
	}
	return b, true
}

var versionRe = regexp.MustCompile(`^[0-9A-Za-z.+_-]{1,40}$`)

// cleanVersion keeps a version only when it looks like one, since it is shown on the screen.
func cleanVersion(v string) string {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if !versionRe.MatchString(v) {
		return ""
	}
	return v
}

// detectService answers POST /admin/api/services/detect with {"url": "..."}. It needs no key, so
// the screen can ask as soon as an address is typed. The answer is {"detected": null} when the
// app is not one Postern knows, or the address does not answer.
func (a *App) detectService(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		URL string `json:"url"`
	}](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(in.URL), "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		writeErr(w, 400, "url must be a valid http(s) URL")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()

	var (
		header http.Header
		body   []byte
	)
	if req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil); err == nil {
		if res, err := probeClient(u).Do(req); err == nil {
			header = res.Header
			body, _ = io.ReadAll(io.LimitReader(res.Body, detectBodyLimit))
			res.Body.Close()
		}
	}
	writeJSON(w, 200, map[string]any{"detected": a.appReg().fingerprint(ctx, u, header, body)})
}

// dialErrorKind sorts a failed request into what the screen can explain: "timeout", "refused",
// "dns", "tls", "redirect", or "other". It goes by the error's type, not its text, which differs
// between operating systems.
func dialErrorKind(err error) string {
	var (
		dnsErr  *net.DNSError
		certErr *tls.CertificateVerificationError
		authErr x509.UnknownAuthorityError
		hostErr x509.HostnameError
		invalid x509.CertificateInvalidError
		netErr  net.Error
		errno   syscall.Errno
		urlErr  *url.Error
	)
	switch {
	case errors.As(err, &dnsErr):
		return "dns"
	case errors.As(err, &certErr), errors.As(err, &authErr), errors.As(err, &hostErr), errors.As(err, &invalid):
		return "tls"
	case errors.As(err, &netErr) && netErr.Timeout():
		return "timeout"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused"
	// Windows reports a refused connection as WSAECONNREFUSED.
	case errors.As(err, &errno) && errno == 10061:
		return "refused"
	case errors.As(err, &urlErr) && strings.Contains(urlErr.Err.Error(), "redirect"):
		return "redirect"
	}
	return "other"
}
