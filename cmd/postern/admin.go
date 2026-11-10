package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"postern/web"
)

func (a *App) mountIcons(mux *http.ServeMux) {
	for path := range iconFiles {
		p := path
		mux.HandleFunc("GET "+p, a.serveIcon)
	}
}

func (a *App) serveIcon(w http.ResponseWriter, r *http.Request) {
	ctype, ok := iconFiles[r.URL.Path]
	if !ok {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	var b []byte
	var err error
	if a.staticDir != "" {
		b, err = os.ReadFile(filepath.Join(a.staticDir, "icons", name))
	} else {
		b, err = web.Icons.ReadFile("icons/" + name)
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	w.Write(b)
}

func eq(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

// ---------- admin ----------

func adminPublic(r *http.Request) bool {
	p := r.URL.Path
	switch {
	case p == "/admin/login":
		return true
	case p == "/admin/api/login" && r.Method == http.MethodPost:
		return true
	case p == "/admin/app.css":
		return true
	case strings.HasPrefix(p, "/admin/fonts/"):
		return true
	case strings.HasPrefix(p, "/admin/js/"):
		// Login page loads ES modules before a session exists.
		return true
	default:
		if _, ok := iconFiles[p]; ok {
			return true
		}
		return false
	}
}

func (a *App) adminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if adminPublic(r) {
			next.ServeHTTP(w, r)
			return
		}
		if !a.sessions.valid(sessionID(r)) {
			if wantsHTML(r) {
				http.Redirect(w, r, "/admin/login", http.StatusFound)
				return
			}
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if r.Method != http.MethodGet && r.Header.Get("X-Postern-Admin") != "1" {
			http.Error(w, "missing X-Postern-Admin header", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func wantsHTML(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "text/html") || accept == "" || r.URL.Path == "/admin/" || r.URL.Path == "/admin"
}

func (a *App) loginPage(w http.ResponseWriter, r *http.Request) {
	if a.sessions.valid(sessionID(r)) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
		return
	}
	b, err := a.staticFile("login.html", web.LoginHTML)
	if err != nil {
		http.Error(w, "login page unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(withVersion(b))
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if a.logins.blocked(ip) {
		writeErr(w, http.StatusTooManyRequests, "too many failed attempts; try again in a minute")
		return
	}
	in, err := decodeJSON[struct {
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if !eq(in.Password, a.adminPass) {
		time.Sleep(200 * time.Millisecond)
		a.logins.failure(ip)
		writeErr(w, 401, "That password isn't right. Try again.")
		return
	}
	id, err := a.sessions.create(in.Remember)
	if err != nil {
		writeErr(w, 500, "could not create session")
		return
	}
	a.logins.success(ip)
	setSessionCookie(w, r, id, in.Remember)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	a.sessions.revoke(sessionID(r))
	clearSessionCookie(w, r)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// Cloudflare respects this even when "Cache Everything" is on.
		w.Header().Set("CDN-Cache-Control", "no-store")
		w.Header().Set("Cloudflare-CDN-Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func withVersion(b []byte) []byte {
	return bytes.ReplaceAll(b, []byte("{{VERSION}}"), []byte(Version))
}

func (a *App) staticFile(name string, embedded []byte) ([]byte, error) {
	if a.staticDir == "" {
		return embedded, nil
	}
	return os.ReadFile(filepath.Join(a.staticDir, name))
}

func (a *App) ui(w http.ResponseWriter, r *http.Request) {
	b, err := a.staticFile("index.html", web.IndexHTML)
	if err != nil {
		http.Error(w, "ui unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(withVersion(b))
}

func (a *App) css(w http.ResponseWriter, r *http.Request) {
	b, err := a.staticFile("app.css", web.AppCSS)
	if err != nil {
		http.Error(w, "css unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}

func (a *App) meta(w http.ResponseWriter, r *http.Request) {
	secure := isHTTPS(r)
	scheme := "http"
	if secure {
		scheme = "https"
	}
	writeJSON(w, 200, map[string]any{
		"version":      Version,
		"secure":       secure,
		"listen":       r.Host,
		"publicOrigin": scheme + "://" + r.Host,
	})
}

// view hides the upstream secret from the browser.
type view struct {
	Name       string      `json:"name"`
	URL        string      `json:"url"`
	Auth       AuthView    `json:"auth"`
	Access     AccessMode  `json:"access"`
	Gate       *CallerGate `json:"gate,omitempty"`
	OpenPaths  []OpenPath  `json:"openPaths,omitempty"`
	Token      string      `json:"token"`
	Enabled    bool        `json:"enabled"`
	PublicBase string      `json:"publicBase"`
}

func toView(s Service, origin string) view {
	return view{
		Name:       s.Name,
		URL:        s.URL,
		Auth:       s.Auth.View(),
		Access:     normalizeAccess(s.Access),
		Gate:       s.Gate,
		OpenPaths:  s.OpenPaths,
		Token:      s.Token,
		Enabled:    s.Enabled,
		PublicBase: strings.TrimRight(origin, "/") + "/p/" + s.Name + "/",
	}
}

func requestOrigin(r *http.Request) string {
	scheme := "http"
	if isHTTPS(r) {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func writeFieldErr(w http.ResponseWriter, err error) {
	var fe FieldError
	if errors.As(err, &fe) {
		writeJSON(w, 400, map[string]any{"error": err.Error(), "errors": fe})
		return
	}
	writeErr(w, 400, err.Error())
}

func (a *App) listServices(w http.ResponseWriter, r *http.Request) {
	origin := requestOrigin(r)
	out := []view{}
	for _, s := range a.store.List() {
		out = append(out, toView(s, origin))
	}
	writeJSON(w, 200, out)
}

type serviceInput struct {
	Name      string       `json:"name"`
	URL       string       `json:"url"`
	Auth      UpstreamAuth `json:"auth"`
	Access    AccessMode   `json:"access"`
	Gate      *CallerGate  `json:"gate"`
	OpenPaths []OpenPath   `json:"openPaths"`
	Enabled   *bool        `json:"enabled"`
}

func decodeJSON[T any](r *http.Request) (T, error) {
	var in T
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<16)
	return in, json.NewDecoder(r.Body).Decode(&in)
}

func (a *App) createService(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[serviceInput](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	svc, err := a.store.Create(Service{
		Name: in.Name, URL: in.URL, Auth: in.Auth, Access: in.Access,
		Gate: in.Gate, OpenPaths: in.OpenPaths, Enabled: enabled,
	})
	if err != nil {
		writeFieldErr(w, err)
		return
	}
	writeJSON(w, 201, toView(svc, requestOrigin(r)))
}

func (a *App) updateService(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[serviceInput](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	svc, err := a.store.Update(r.PathValue("name"), Service{
		Name: in.Name, URL: in.URL, Auth: in.Auth, Access: in.Access,
		Gate: in.Gate, OpenPaths: in.OpenPaths, Enabled: enabled,
	})
	if err != nil {
		if errors.Is(err, errNotFound) {
			writeErr(w, 404, "not found")
			return
		}
		writeFieldErr(w, err)
		return
	}
	writeJSON(w, 200, toView(svc, requestOrigin(r)))
}

func (a *App) patchService(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Enabled *bool `json:"enabled"`
	}](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if in.Enabled == nil {
		writeErr(w, 400, "enabled required")
		return
	}
	svc, err := a.store.SetEnabled(r.PathValue("name"), *in.Enabled)
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	writeJSON(w, 200, toView(svc, requestOrigin(r)))
}

func (a *App) rotateService(w http.ResponseWriter, r *http.Request) {
	svc, err := a.store.RotateToken(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	writeJSON(w, 200, toView(svc, requestOrigin(r)))
}

func (a *App) deleteService(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Delete(r.PathValue("name")); err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type testInput struct {
	URL  string       `json:"url"`
	Auth UpstreamAuth `json:"auth"`
	Name string       `json:"name"` // optional: load stored secret when editing
}

func (a *App) testConnection(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[testInput](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	auth := in.Auth
	if in.Name != "" {
		if cur, ok := a.store.Get(in.Name); ok {
			merged, merr := mergeAuth(cur.Auth, auth)
			if merr == nil {
				auth = merged
			}
		}
	}
	if err := auth.Validate(authNeedsSecret(auth)); err != nil {
		writeFieldErr(w, err)
		return
	}
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(in.URL), "/"))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		writeErr(w, 400, "url must be a valid http(s) URL")
		return
	}

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	auth.Apply(req)

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("stopped after 3 redirects")
			}
			return nil
		},
	}
	start := time.Now()
	res, err := client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		writeJSON(w, 200, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	res.Body.Close()

	msg := map[string]any{"ok": true, "status": res.StatusCode, "latencyMs": latency}
	if res.StatusCode == 401 || res.StatusCode == 403 {
		msg["ok"] = true
		msg["warning"] = fmt.Sprintf("Reached the service, but it rejected the credential (HTTP %d)", res.StatusCode)
		msg["authRejected"] = true
	}
	writeJSON(w, 200, msg)
}
