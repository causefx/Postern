package main

import (
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"postern/web"
)

var iconFiles = map[string]string{
	"/favicon.ico":                "image/x-icon",
	"/favicon.svg":                "image/svg+xml",
	"/favicon-adaptive.svg":       "image/svg+xml",
	"/favicon-16x16.png":          "image/png",
	"/favicon-32x32.png":          "image/png",
	"/apple-touch-icon.png":       "image/png",
	"/android-chrome-192x192.png": "image/png",
	"/android-chrome-512x512.png": "image/png",
	"/maskable-192x192.png":       "image/png",
	"/maskable-512x512.png":       "image/png",
	"/safari-pinned-tab.svg":      "image/svg+xml",
	"/site.webmanifest":           "application/manifest+json",
}

type App struct {
	store     *Store
	sessions  *sessionStore
	logins    *loginLimiter
	activity  *activityLog
	hits      *proxyLimiter
	audit     *auditLog
	adminPass string
	oidc      *oidcClient
	// staticDir, when set (POSTERN_DEV), serves UI assets from disk instead of embed.
	staticDir string

	proxyOnce sync.Once
	proxyRP   *httputil.ReverseProxy
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
	dataPath := env("POSTERN_DATA", "data/postern-data.json")
	if len(os.Args) > 1 && os.Args[1] == "check" {
		os.Exit(checkMain(dataPath))
	}
	store, err := OpenStore(dataPath)
	if err != nil {
		log.Fatal(err)
	}
	app := &App{
		store:     store,
		sessions:  newSessionStore(os.Getenv("ADMIN_PASSWORD")),
		logins:    newLoginLimiter(),
		activity:  openActivityLog(dataPath+".activity", store.ActivityLimit()),
		hits:      configuredProxyLimiter(store.RateLimit()),
		audit:     newAuditLog(dataPath + ".audit"),
		adminPass: os.Getenv("ADMIN_PASSWORD"),
	}
	app.audit.setLimit(store.AuditLimit())
	if app.adminPass == "" {
		app.adminPass = newToken()[:16]
		log.Printf("ADMIN_PASSWORD not set; generated one for this run: %s", app.adminPass)
		app.sessions = newSessionStore(app.adminPass)
	}
	app.oidc = loadOIDC()
	if envTruthy("POSTERN_DEV") {
		dir, err := filepath.Abs("web")
		if err != nil {
			log.Fatal(err)
		}
		if st, err := os.Stat(dir); err != nil || !st.IsDir() {
			log.Fatalf("POSTERN_DEV: web dir not found at %s (run from repo root)", dir)
		}
		app.staticDir = dir
		log.Printf("POSTERN_DEV: serving UI from %s (hard-refresh; run npm run dev:css for Tailwind)", dir)
	}
	log.Printf("postern %s", Version)

	proxyMux := http.NewServeMux()
	proxyMux.HandleFunc("/p/{name}/{rest...}", app.proxy)

	adminMux := http.NewServeMux()
	adminMux.HandleFunc("GET /admin/login", app.loginPage)
	adminMux.HandleFunc("GET /admin/api/login", app.loginOptions)
	adminMux.HandleFunc("POST /admin/api/login", app.login)
	adminMux.HandleFunc("GET /admin/oidc/start", app.oidcStart)
	adminMux.HandleFunc("GET /admin/oidc/callback", app.oidcCallback)
	adminMux.HandleFunc("GET /admin/oidc/done", app.oidcDone)
	adminMux.HandleFunc("POST /admin/api/logout", app.logout)
	adminMux.HandleFunc("GET /admin/{$}", app.ui)
	adminMux.HandleFunc("GET /admin/app.css", app.css)

	var jsHandler http.Handler
	var fontsHandler http.Handler
	if app.staticDir != "" {
		jsHandler = http.FileServer(http.Dir(filepath.Join(app.staticDir, "js")))
		fontsHandler = http.FileServer(http.Dir(filepath.Join(app.staticDir, "fonts")))
	} else {
		jsRoot, err := fs.Sub(web.JS, "js")
		if err != nil {
			log.Fatal(err)
		}
		fontsRoot, err := fs.Sub(web.Fonts, "fonts")
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
	adminMux.HandleFunc("GET /admin/api/settings", app.getSettings)
	adminMux.HandleFunc("PUT /admin/api/settings", app.putSettings)
	adminMux.HandleFunc("GET /admin/api/audit", app.listAudit)
	adminMux.HandleFunc("GET /admin/api/services", app.listServices)
	adminMux.HandleFunc("POST /admin/api/services", app.createService)
	adminMux.HandleFunc("POST /admin/api/services/test", app.testConnection)
	adminMux.HandleFunc("PUT /admin/api/services/{name}", app.updateService)
	adminMux.HandleFunc("PATCH /admin/api/services/{name}", app.patchService)
	adminMux.HandleFunc("POST /admin/api/services/{name}/duplicate", app.duplicateService)
	adminMux.HandleFunc("POST /admin/api/services/{name}/rotate", app.rotateService)
	adminMux.HandleFunc("POST /admin/api/services/{name}/tokens", app.addToken)
	adminMux.HandleFunc("POST /admin/api/services/{name}/tokens/{id}/rotate", app.rotateToken)
	adminMux.HandleFunc("PATCH /admin/api/services/{name}/tokens/{id}", app.patchToken)
	adminMux.HandleFunc("DELETE /admin/api/services/{name}/tokens/{id}", app.deleteToken)
	adminMux.HandleFunc("GET /admin/api/services/{name}/activity", app.serviceActivity)
	adminMux.HandleFunc("DELETE /admin/api/services/{name}/activity", app.clearActivity)
	adminMux.HandleFunc("DELETE /admin/api/services/{name}", app.deleteService)
	adminMux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})
	app.mountIcons(adminMux)
	app.mountIcons(proxyMux)

	proxyAddr := env("LISTEN", ":8080")
	adminAddr := os.Getenv("ADMIN_LISTEN")

	if adminAddr == "" {
		proxyMux.Handle("/admin/", app.adminAuth(adminMux))
		proxyMux.Handle("/{$}", adminMux)
		log.Printf("listening on %s (proxy at /p/<name>/..., UI at /admin/)", proxyAddr)
		log.Fatal(newServer(proxyAddr, withHealth(proxyMux)).ListenAndServe())
	}

	go func() {
		log.Printf("admin UI on %s/admin/", adminAddr)
		log.Fatal(newServer(adminAddr, withHealth(app.adminAuth(adminMux))).ListenAndServe())
	}()
	log.Printf("proxy on %s (/p/<name>/...)", proxyAddr)
	log.Fatal(newServer(proxyAddr, withHealth(proxyMux)).ListenAndServe())
}

func healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte("ok\n"))
}

// withHealth serves GET /healthz with no auth, in front of either listener.
func withHealth(next http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz)
	mux.Handle("/", next)
	return mux
}

func checkMain(path string) int {
	problems, err := CheckFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		return 1
	}
	if len(problems) > 0 {
		for _, p := range problems {
			fmt.Fprintf(os.Stderr, "%s\n", p)
		}
		return 1
	}
	fmt.Println("ok")
	return 0
}

func newServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}
