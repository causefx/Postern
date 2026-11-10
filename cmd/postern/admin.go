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
	case p == "/admin/api/login" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		return true
	case (p == "/admin/oidc/start" || p == "/admin/oidc/callback" || p == "/admin/oidc/done") && r.Method == http.MethodGet:
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
		raw := sessionID(r)
		if refreshed, err := a.sessions.refresh(raw); err == nil {
			setSessionCookie(w, r, refreshed, a.sessions.remember(raw))
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
	w.Write(a.withLoginOptions(withVersion(b)))
}

func (a *App) withLoginOptions(b []byte) []byte {
	label := ""
	if a.oidc != nil {
		label = a.oidc.label
	}
	opts, err := json.Marshal(map[string]any{
		"oidc":     a.oidc != nil,
		"password": a.passwordAllowed(),
		"label":    label,
	})
	if err != nil {
		opts = []byte(`{"oidc":false,"password":true}`)
	}
	return bytes.ReplaceAll(b, []byte("{{LOGIN_OPTIONS}}"), opts)
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
	if !a.passwordAllowed() {
		writeErr(w, http.StatusForbidden, "Password sign-in is off. Use the identity provider.")
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

func (a *App) passwordAllowed() bool {
	if a == nil || a.oidc == nil || a.store == nil || a.store.PasswordLogin() {
		return true
	}
	return false
}

func (a *App) settingsPayload(s Settings, r *http.Request) map[string]any {
	label := ""
	if a.oidc != nil {
		label = a.oidc.label
	}
	return map[string]any{
		"activityLimit": s.ActivityLimit,
		"rateLimit":     s.RateLimit,
		"auditLimit":    s.AuditLimit,
		"passwordLogin": s.PasswordLogin,
		"oidc":          a.oidc != nil,
		"oidcLabel":     label,
		"oidcSession":   a.sessions != nil && a.sessions.viaOIDC(sessionID(r)),
		"defaults": map[string]any{
			"activityLimit": defaultActivityLimit,
			"rateLimit":     defaultRateLimit,
			"auditLimit":    defaultAuditLimit,
			"passwordLogin": true,
		},
		"maxActivity": maxActivityLimit,
		"maxRate":     maxRateLimit,
		"maxAudit":    maxAuditLimit,
	}
}

func (a *App) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, a.settingsPayload(Settings{
		ActivityLimit: a.store.ActivityLimit(),
		RateLimit:     a.store.RateLimit(),
		AuditLimit:    a.store.AuditLimit(),
		PasswordLogin: a.store.PasswordLogin(),
	}, r))
}

func (a *App) putSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ActivityLimit int   `json:"activityLimit"`
		RateLimit     int   `json:"rateLimit"`
		AuditLimit    int   `json:"auditLimit"`
		PasswordLogin *bool `json:"passwordLogin"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(&in); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if in.ActivityLimit < 1 || in.ActivityLimit > maxActivityLimit {
		writeErr(w, 400, fmt.Sprintf("activityLimit must be from 1 to %d", maxActivityLimit))
		return
	}
	if in.RateLimit < 0 || in.RateLimit > maxRateLimit {
		writeErr(w, 400, fmt.Sprintf("rateLimit must be 0 or from 1 to %d", maxRateLimit))
		return
	}
	if in.AuditLimit < 1 || in.AuditLimit > maxAuditLimit {
		writeErr(w, 400, fmt.Sprintf("auditLimit must be from 1 to %d", maxAuditLimit))
		return
	}
	passwordLogin := true
	if a.store != nil {
		passwordLogin = a.store.PasswordLogin()
	}
	if in.PasswordLogin != nil {
		passwordLogin = *in.PasswordLogin
	}
	if !passwordLogin && a.oidc == nil {
		writeErr(w, 400, "Configure OIDC before turning the admin password off")
		return
	}
	if !passwordLogin && (a.sessions == nil || !a.sessions.viaOIDC(sessionID(r))) {
		writeErr(w, 400, "Sign in with the identity provider before turning the admin password off")
		return
	}
	prev := Settings{
		ActivityLimit: a.store.ActivityLimit(),
		RateLimit:     a.store.RateLimit(),
		AuditLimit:    a.store.AuditLimit(),
		PasswordLogin: a.store.PasswordLogin(),
	}
	saved, err := a.store.UpdateSettings(Settings{
		ActivityLimit: in.ActivityLimit,
		RateLimit:     in.RateLimit,
		AuditLimit:    in.AuditLimit,
		PasswordLogin: passwordLogin,
	})
	if err != nil {
		writeErr(w, 500, "could not save settings")
		return
	}
	if a.hits != nil {
		a.hits.setMax(saved.RateLimit)
	}
	if a.activity != nil {
		a.activity.setLimit(saved.ActivityLimit)
	}
	if a.audit != nil {
		a.audit.setLimit(saved.AuditLimit)
	}
	if ev := settingsChanges(prev, saved); ev.Action != "" {
		a.record(ev)
	}
	writeJSON(w, 200, a.settingsPayload(saved, r))
}

// settingsChanges records only the fields that differ. An unchanged save writes nothing.
func settingsChanges(prev, saved Settings) auditEvent {
	ev := auditEvent{Action: "settings"}
	if saved.RateLimit != prev.RateLimit {
		n := saved.RateLimit
		ev.Rate = &n
	}
	if saved.ActivityLimit != prev.ActivityLimit {
		n := saved.ActivityLimit
		ev.Activity = &n
	}
	if saved.AuditLimit != prev.AuditLimit {
		n := saved.AuditLimit
		ev.Audit = &n
	}
	if saved.PasswordLogin != prev.PasswordLogin {
		on := saved.PasswordLogin
		ev.PasswordLogin = &on
	}
	if ev.Rate == nil && ev.Activity == nil && ev.Audit == nil && ev.PasswordLogin == nil {
		return auditEvent{}
	}
	return ev
}

func (a *App) listAudit(w http.ResponseWriter, r *http.Request) {
	entries := []auditEvent{}
	if a.audit != nil {
		entries = a.audit.list()
	}
	writeJSON(w, 200, map[string]any{
		"limit":   a.store.AuditLimit(),
		"entries": entries,
	})
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
	Tokens     []tokenView `json:"tokens"`
	Enabled    bool        `json:"enabled"`
	PublicBase string      `json:"publicBase"`
	Requests   int         `json:"requests,omitempty"`
	LastStatus int         `json:"lastStatus,omitempty"`
	LastSeen   time.Time   `json:"lastSeen,omitempty"`
	LastWho    string      `json:"lastWho,omitempty"`
}

type tokenView struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

func toView(s Service, origin string) view {
	tokens := make([]tokenView, 0, len(s.Tokens))
	for _, t := range s.Tokens {
		tokens = append(tokens, tokenView{ID: t.ID, Name: t.Name, Secret: t.Secret})
	}
	return view{
		Name:       s.Name,
		URL:        s.URL,
		Auth:       s.Auth.View(),
		Access:     normalizeAccess(s.Access),
		Gate:       s.Gate,
		OpenPaths:  s.OpenPaths,
		Token:      s.Token,
		Tokens:     tokens,
		Enabled:    s.Enabled,
		PublicBase: strings.TrimRight(origin, "/") + "/p/" + s.Name + "/",
	}
}

func (a *App) present(s Service, origin string) view {
	v := toView(s, origin)
	if a != nil && a.activity != nil {
		v.Requests, v.LastStatus, v.LastSeen, v.LastWho = a.activity.summary(s.Name)
	}
	return v
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
		out = append(out, a.present(s, origin))
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
	a.record(auditEvent{Action: "create", Service: svc.Name, URL: svc.URL})
	writeJSON(w, 201, a.present(svc, requestOrigin(r)))
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
	ev := auditEvent{Action: "update", Service: svc.Name, URL: svc.URL}
	if prev := r.PathValue("name"); prev != svc.Name {
		ev.From = prev
		a.activity.rename(prev, svc.Name)
	}
	a.record(ev)
	writeJSON(w, 200, a.present(svc, requestOrigin(r)))
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
	enabled := svc.Enabled
	a.record(auditEvent{Action: "enable", Service: svc.Name, Enabled: &enabled})
	writeJSON(w, 200, a.present(svc, requestOrigin(r)))
}

func (a *App) rotateService(w http.ResponseWriter, r *http.Request) {
	svc, err := a.store.RotateToken(r.PathValue("name"))
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	a.record(auditEvent{Action: "rotate", Service: svc.Name, Token: tokenLabel(svc.Tokens, "")})
	writeJSON(w, 200, a.present(svc, requestOrigin(r)))
}

func (a *App) addToken(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Name string `json:"name"`
	}](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	svc, err := a.store.AddToken(r.PathValue("name"), in.Name)
	if err != nil {
		if errors.Is(err, errNotFound) {
			writeErr(w, 404, "not found")
			return
		}
		writeFieldErr(w, err)
		return
	}
	added := ""
	if n := len(svc.Tokens); n > 0 {
		added = svc.Tokens[n-1].Name
	}
	a.record(auditEvent{Action: "token_add", Service: svc.Name, Token: added})
	writeJSON(w, 201, a.present(svc, requestOrigin(r)))
}

func (a *App) rotateToken(w http.ResponseWriter, r *http.Request) {
	svc, err := a.store.RotateTokenID(r.PathValue("name"), r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, "not found")
		return
	}
	a.record(auditEvent{Action: "rotate", Service: svc.Name, Token: tokenLabel(svc.Tokens, r.PathValue("id"))})
	writeJSON(w, 200, a.present(svc, requestOrigin(r)))
}

func (a *App) deleteToken(w http.ResponseWriter, r *http.Request) {
	label := r.PathValue("id")
	if cur, ok := a.store.Get(r.PathValue("name")); ok {
		label = tokenLabel(cur.Tokens, r.PathValue("id"))
	}
	svc, err := a.store.DeleteToken(r.PathValue("name"), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, errNotFound) {
			writeErr(w, 404, "not found")
			return
		}
		writeFieldErr(w, err)
		return
	}
	a.record(auditEvent{Action: "token_revoke", Service: svc.Name, Token: label})
	writeJSON(w, 200, a.present(svc, requestOrigin(r)))
}

func (a *App) serviceActivity(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, ok := a.store.Get(name); !ok {
		writeErr(w, 404, "not found")
		return
	}
	events := []activityEvent{}
	if a.activity != nil {
		events = a.activity.list(name)
	}
	writeJSON(w, 200, events)
}

func (a *App) duplicateService(w http.ResponseWriter, r *http.Request) {
	in, err := decodeJSON[struct {
		Name string `json:"name"`
	}](r)
	if err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	src := r.PathValue("name")
	svc, err := a.store.Duplicate(src, in.Name)
	if err != nil {
		if errors.Is(err, errNotFound) {
			writeErr(w, 404, "not found")
			return
		}
		writeFieldErr(w, err)
		return
	}
	a.record(auditEvent{Action: "duplicate", Service: svc.Name, From: src, URL: svc.URL})
	writeJSON(w, 201, a.present(svc, requestOrigin(r)))
}

func (a *App) deleteService(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := a.store.Delete(name); err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	a.record(auditEvent{Action: "delete", Service: name})
	a.activity.forget(name)
	w.WriteHeader(http.StatusNoContent)
}

func tokenLabel(tokens []CallerToken, id string) string {
	if id == "" {
		for _, t := range tokens {
			if t.Name == "default" {
				return t.Name
			}
		}
		if len(tokens) > 0 {
			return tokens[0].Name
		}
		return "default"
	}
	for _, t := range tokens {
		if t.ID == id {
			return t.Name
		}
	}
	return id
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
