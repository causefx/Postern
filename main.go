package main

import (
	"bytes"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:generate npm run build:css

//go:embed static/index.html
var indexHTML []byte

//go:embed static/login.html
var loginHTML []byte

//go:embed static/app.css
var appCSS []byte

//go:embed static/js
var jsFS embed.FS

//go:embed static/fonts
var fontsFS embed.FS

type App struct {
	store     *Store
	sessions  *sessionStore
	logins    *loginLimiter
	adminPass string
	// staticDir, when set (POSTERN_DEV), serves UI assets from disk instead of embed.
	staticDir string
}

func envTruthy(k string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(k))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	store, err := OpenStore(env("POSTERN_DATA", "data/postern-data.json"))
	if err != nil {
		log.Fatal(err)
	}
	app := &App{
		store:     store,
		sessions:  newSessionStore(),
		logins:    newLoginLimiter(),
		adminPass: os.Getenv("ADMIN_PASSWORD"),
	}
	if app.adminPass == "" {
		app.adminPass = newToken()[:16]
		log.Printf("ADMIN_PASSWORD not set; generated one for this run: %s", app.adminPass)
	}
	if envTruthy("POSTERN_DEV") {
		dir, err := filepath.Abs("static")
		if err != nil {
			log.Fatal(err)
		}
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			log.Fatalf("POSTERN_DEV: static dir not found at %s (run from repo root)", dir)
		}
		app.staticDir = dir
		log.Printf("POSTERN_DEV: serving UI from %s (hard-refresh; run npm run dev:css for Tailwind)", dir)
	}
	log.Printf("postern %s", Version)

	proxyMux := http.NewServeMux()
	proxyMux.HandleFunc("/p/{name}/{rest...}", app.proxy)

	adminMux := http.NewServeMux()
	adminMux.HandleFunc("GET /admin/login", app.loginPage)
	adminMux.HandleFunc("POST /admin/api/login", app.login)
	adminMux.HandleFunc("POST /admin/api/logout", app.logout)
	adminMux.HandleFunc("GET /admin/{$}", app.ui)
	adminMux.HandleFunc("GET /admin/app.css", app.css)

	var jsHandler http.Handler
	var fontsHandler http.Handler
	if app.staticDir != "" {
		jsHandler = http.FileServer(http.Dir(filepath.Join(app.staticDir, "js")))
		fontsHandler = http.FileServer(http.Dir(filepath.Join(app.staticDir, "fonts")))
	} else {
		jsRoot, err := fs.Sub(jsFS, "static/js")
		if err != nil {
			log.Fatal(err)
		}
		fontsRoot, err := fs.Sub(fontsFS, "static/fonts")
		if err != nil {
			log.Fatal(err)
		}
		jsHandler = http.FileServer(http.FS(jsRoot))
		fontsHandler = http.FileServer(http.FS(fontsRoot))
	}
	// no-store: ES module graphs are easy to serve stale after image upgrades
	adminMux.Handle("GET /admin/js/", http.StripPrefix("/admin/js/", noStore(jsHandler)))
	adminMux.Handle("GET /admin/fonts/", http.StripPrefix("/admin/fonts/", fontsHandler))

	adminMux.HandleFunc("GET /admin/api/meta", app.meta)
	adminMux.HandleFunc("GET /admin/api/services", app.listServices)
	adminMux.HandleFunc("POST /admin/api/services", app.createService)
	adminMux.HandleFunc("POST /admin/api/services/test", app.testConnection)
	adminMux.HandleFunc("PUT /admin/api/services/{name}", app.updateService)
	adminMux.HandleFunc("PATCH /admin/api/services/{name}", app.patchService)
	adminMux.HandleFunc("POST /admin/api/services/{name}/rotate", app.rotateService)
	adminMux.HandleFunc("DELETE /admin/api/services/{name}", app.deleteService)
	adminMux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})

	proxyAddr := env("LISTEN", ":8080")
	adminAddr := os.Getenv("ADMIN_LISTEN")

	if adminAddr == "" {
		proxyMux.Handle("/admin/", app.adminAuth(adminMux))
		proxyMux.Handle("/{$}", adminMux)
		log.Printf("listening on %s (proxy at /p/<name>/..., UI at /admin/)", proxyAddr)
		log.Fatal(newServer(proxyAddr, proxyMux).ListenAndServe())
	}

	go func() {
		log.Printf("admin UI on %s/admin/", adminAddr)
		log.Fatal(newServer(adminAddr, app.adminAuth(adminMux)).ListenAndServe())
	}()
	log.Printf("proxy on %s (/p/<name>/...)", proxyAddr)
	log.Fatal(newServer(proxyAddr, proxyMux).ListenAndServe())
}

func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
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
	b, err := a.staticFile("login.html", loginHTML)
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
	b, err := a.staticFile("index.html", indexHTML)
	if err != nil {
		http.Error(w, "ui unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(withVersion(b))
}

func (a *App) css(w http.ResponseWriter, r *http.Request) {
	b, err := a.staticFile("app.css", appCSS)
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

// ---------- proxy ----------

func (a *App) proxy(w http.ResponseWriter, r *http.Request) {
	svc, ok := a.store.Get(r.PathValue("name"))
	if !ok || !svc.Enabled {
		http.NotFound(w, r)
		return
	}
	rest := "/" + r.PathValue("rest")
	if !PathIsOpen(svc, rest) && !AuthorizeCaller(svc, r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	target, err := url.Parse(svc.URL)
	if err != nil {
		http.Error(w, "bad upstream", http.StatusInternalServerError)
		return
	}
	auth := svc.Auth

	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Path = rest
			pr.Out.URL.RawPath = ""
			pr.SetURL(target)

			pr.Out.URL.RawQuery = pr.In.URL.RawQuery
			svc.Gate.Strip(pr.Out)
			auth.Apply(pr.Out)
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("proxy %s: %v", svc.Name, err)
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}
