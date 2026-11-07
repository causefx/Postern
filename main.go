package main

import (
	"crypto/subtle"
	"embed"
	"encoding/json"
	"html/template"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

//go:generate npm run build:css

//go:embed static/*.html static/components/*.html
var pageFS embed.FS

//go:embed static/app.css
var appCSS []byte

//go:embed static/admin.js
var adminJS []byte

var pages = template.Must(template.ParseFS(pageFS, "static/*.html", "static/components/*.html"))

type App struct {
	store     *Store
	adminUser string
	adminPass string
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
	app := &App{store: store, adminUser: env("ADMIN_USER", "admin"), adminPass: os.Getenv("ADMIN_PASSWORD")}
	if app.adminPass == "" {
		app.adminPass = newToken()[:16]
		log.Printf("ADMIN_PASSWORD not set; generated one for this run: %s", app.adminPass)
	}

	proxyMux := http.NewServeMux()
	proxyMux.HandleFunc("/p/{name}/{rest...}", app.proxy)

	adminMux := http.NewServeMux()
	adminMux.HandleFunc("GET /admin/{$}", app.ui)
	adminMux.HandleFunc("GET /admin/app.css", app.css)
	adminMux.HandleFunc("GET /admin/admin.js", app.script)
	adminMux.HandleFunc("GET /admin/api/services", app.listServices)
	adminMux.HandleFunc("POST /admin/api/services", app.createService)
	adminMux.HandleFunc("PUT /admin/api/services/{name}", app.updateService)
	adminMux.HandleFunc("DELETE /admin/api/services/{name}", app.deleteService)
	adminMux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})

	proxyAddr := env("LISTEN", ":8080")
	adminAddr := os.Getenv("ADMIN_LISTEN") // optional: separate (e.g. LAN-only) port for the UI

	if adminAddr == "" {
		// Single port: serve both. Simple, but the login page is internet-reachable.
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
		// No Read/WriteTimeout: would break large downloads and websockets.
	}
}

func eq(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }

// ---------- admin ----------

func (a *App) adminAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || !eq(u, a.adminUser) || !eq(p, a.adminPass) {
			w.Header().Set("WWW-Authenticate", `Basic realm="postern admin"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		// CSRF guard: browsers resend Basic creds cross-site, but can't add
		// custom headers without a CORS preflight (which we never allow).
		if r.Method != http.MethodGet && r.Header.Get("X-Postern-Admin") != "1" {
			http.Error(w, "missing X-Postern-Admin header", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *App) ui(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if err := pages.ExecuteTemplate(w, "index.html", nil); err != nil {
		log.Printf("admin ui: %v", err)
	}
}

func (a *App) script(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(adminJS)
}

func (a *App) css(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(appCSS)
}

// view hides the upstream API key from the browser.
type view struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	KeyHeader string `json:"keyHeader"`
	HasKey    bool   `json:"hasKey"`
	Token     string `json:"token"`
	Enabled   bool   `json:"enabled"`
}

func toView(s Service) view {
	return view{s.Name, s.URL, s.KeyHeader, s.APIKey != "", s.Token, s.Enabled}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (a *App) listServices(w http.ResponseWriter, r *http.Request) {
	out := []view{}
	for _, s := range a.store.List() {
		out = append(out, toView(s))
	}
	writeJSON(w, 200, out)
}

type input struct {
	Service
	RegenToken bool `json:"regenToken"`
}

func decode(r *http.Request) (input, error) {
	var in input
	r.Body = http.MaxBytesReader(nil, r.Body, 1<<16)
	return in, json.NewDecoder(r.Body).Decode(&in)
}

func (a *App) createService(w http.ResponseWriter, r *http.Request) {
	in, err := decode(r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	in.Enabled = true
	svc, err := a.store.Create(in.Service)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, toView(svc))
}

func (a *App) updateService(w http.ResponseWriter, r *http.Request) {
	in, err := decode(r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	svc, err := a.store.Update(r.PathValue("name"), in.Service, in.RegenToken)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, toView(svc))
}

func (a *App) deleteService(w http.ResponseWriter, r *http.Request) {
	if err := a.store.Delete(r.PathValue("name")); err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- proxy ----------

func callerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if t := r.Header.Get("X-Proxy-Token"); t != "" {
		return t
	}
	return r.URL.Query().Get("token")
}

func (a *App) proxy(w http.ResponseWriter, r *http.Request) {
	svc, ok := a.store.Get(r.PathValue("name"))
	if !ok || !svc.Enabled {
		http.NotFound(w, r)
		return
	}
	if !eq(callerToken(r), svc.Token) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	target, err := url.Parse(svc.URL)
	if err != nil {
		http.Error(w, "bad upstream", http.StatusInternalServerError)
		return
	}
	rest := "/" + r.PathValue("rest")

	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Path = rest
			pr.Out.URL.RawPath = ""
			pr.SetURL(target) // joins target path + rest, sets Host

			q := pr.In.URL.Query()
			q.Del("token")
			q.Del("apikey") // never let callers supply their own upstream key
			pr.Out.URL.RawQuery = q.Encode()

			pr.Out.Header.Del("Authorization")
			pr.Out.Header.Del("X-Proxy-Token")
			pr.Out.Header.Del("X-Api-Key")
			pr.Out.Header.Del(svc.KeyHeader)
			if svc.APIKey != "" {
				pr.Out.Header.Set(svc.KeyHeader, svc.APIKey)
			}
		},
		FlushInterval: -1, // stream immediately (SignalR / event streams)
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("proxy %s: %v", svc.Name, err)
			http.Error(w, "upstream unavailable", http.StatusBadGateway)
		},
	}
	rp.ServeHTTP(w, r)
}
