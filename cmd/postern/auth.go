package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// AccessMode chooses how callers authenticate to Postern before the proxy runs.
type AccessMode string

const (
	// AccessPostern requires the Postern-issued caller token (Bearer / X-Proxy-Token / ?token= by default).
	AccessPostern AccessMode = "postern"
	// AccessUpstream accepts any enabled upstream auth shape (header, query, or authz).
	AccessUpstream AccessMode = "upstream"

	defaultGateHeader = "X-Proxy-Token"
	defaultGateQuery  = "token"
)

// GateHeader is a caller-gate header place (name only; value is the Postern token).
type GateHeader struct {
	Name string `json:"name"`
}

// GateQuery is a caller-gate query place (name only; value is the Postern token).
type GateQuery struct {
	Name string `json:"name"`
}

// CallerGate is where callers may present the Postern token when access=postern.
// Nil means the default trio: Bearer + X-Proxy-Token + ?token=.
type CallerGate struct {
	Bearer bool        `json:"bearer,omitempty"`
	Header *GateHeader `json:"header,omitempty"`
	Query  *GateQuery  `json:"query,omitempty"`
}

func (g *CallerGate) IsEmpty() bool {
	return g == nil || (!g.Bearer && g.Header == nil && g.Query == nil)
}

// MatchesDefault reports the classic Bearer + X-Proxy-Token + ?token= shape.
func (g *CallerGate) MatchesDefault() bool {
	if g == nil {
		return true
	}
	if !g.Bearer || g.Header == nil || g.Query == nil {
		return false
	}
	h := strings.TrimSpace(g.Header.Name)
	q := strings.TrimSpace(g.Query.Name)
	if h == "" {
		h = defaultGateHeader
	}
	if q == "" {
		q = defaultGateQuery
	}
	return strings.EqualFold(h, defaultGateHeader) && q == defaultGateQuery
}

// Normalize returns nil for empty/default gates; otherwise a cleaned copy.
func (g *CallerGate) Normalize() *CallerGate {
	if g.IsEmpty() || g.MatchesDefault() {
		return nil
	}
	out := &CallerGate{Bearer: g.Bearer}
	if g.Header != nil {
		name := strings.TrimSpace(g.Header.Name)
		if name == "" {
			name = defaultGateHeader
		}
		out.Header = &GateHeader{Name: name}
	}
	if g.Query != nil {
		name := strings.TrimSpace(g.Query.Name)
		if name == "" {
			name = defaultGateQuery
		}
		out.Query = &GateQuery{Name: name}
	}
	return out
}

func (g *CallerGate) Validate() error {
	if g == nil {
		return nil
	}
	if g.IsEmpty() {
		return FieldError{"gate": "enable at least one caller gate method"}
	}
	errs := FieldError{}
	if g.Header != nil {
		name := strings.TrimSpace(g.Header.Name)
		if name == "" {
			name = defaultGateHeader
		}
		if !headerNameRe.MatchString(name) {
			errs["gate.header.name"] = "invalid header name"
		} else if forbiddenHeaders[strings.ToLower(name)] {
			errs["gate.header.name"] = "header name is not allowed"
		} else {
			g.Header.Name = name
		}
	}
	if g.Query != nil {
		name := strings.TrimSpace(g.Query.Name)
		if name == "" {
			name = defaultGateQuery
		}
		if name == "" {
			errs["gate.query.name"] = "parameter name is required"
		} else {
			g.Query.Name = name
		}
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// Authorize checks whether the request presents svcToken in any enabled gate place.
func (g *CallerGate) Authorize(r *http.Request, svcToken string) bool {
	if svcToken == "" {
		return false
	}
	if g.IsEmpty() {
		got := callerToken(r)
		return got != "" && secretEq(got, svcToken)
	}
	if g.Bearer {
		h := r.Header.Get("Authorization")
		if strings.HasPrefix(h, "Bearer ") && secretEq(strings.TrimPrefix(h, "Bearer "), svcToken) {
			return true
		}
	}
	if g.Header != nil {
		name := g.Header.Name
		if name == "" {
			name = defaultGateHeader
		}
		if secretEq(r.Header.Get(name), svcToken) {
			return true
		}
	}
	if g.Query != nil {
		name := g.Query.Name
		if name == "" {
			name = defaultGateQuery
		}
		if secretEq(r.URL.Query().Get(name), svcToken) {
			return true
		}
	}
	return false
}

// Strip removes caller-gate credentials from the outbound request.
func (g *CallerGate) Strip(out *http.Request) {
	out.Header.Del("Authorization")
	out.Header.Del("X-Proxy-Token")
	q := out.URL.Query()
	q.Del("token")
	if g != nil {
		if g.Header != nil && g.Header.Name != "" {
			out.Header.Del(g.Header.Name)
		}
		if g.Query != nil && g.Query.Name != "" {
			q.Del(g.Query.Name)
		}
	}
	out.URL.RawQuery = q.Encode()
}

func normalizeAccess(m AccessMode) AccessMode {
	if m == AccessUpstream {
		return AccessUpstream
	}
	return AccessPostern
}

type AuthzKind string

const (
	AuthzBearer AuthzKind = "bearer"
	AuthzBasic  AuthzKind = "basic"
)

// HeaderAuth is an HTTP request-header credential slot.
type HeaderAuth struct {
	Name   string `json:"name"`
	Secret string `json:"secret,omitempty"`
}

// QueryAuth is a URL query-parameter credential slot.
type QueryAuth struct {
	Name   string `json:"name"`
	Secret string `json:"secret,omitempty"`
}

// AuthzAuth is the Authorization header slot (Bearer XOR Basic).
type AuthzAuth struct {
	Kind     AuthzKind `json:"kind"`
	Username string    `json:"username,omitempty"`
	Secret   string    `json:"secret,omitempty"`
}

// UpstreamAuth is the set of credentials Postern injects on every outbound request.
// Nil slots are off; multiple slots may be enabled at once.
type UpstreamAuth struct {
	Header *HeaderAuth `json:"header,omitempty"`
	Query  *QueryAuth  `json:"query,omitempty"`
	Authz  *AuthzAuth  `json:"authz,omitempty"`
}

// AuthView is the secret-free shape returned by the admin API.
type AuthView struct {
	Header *HeaderAuthView `json:"header,omitempty"`
	Query  *QueryAuthView  `json:"query,omitempty"`
	Authz  *AuthzAuthView  `json:"authz,omitempty"`
}

type HeaderAuthView struct {
	Name      string `json:"name"`
	HasSecret bool   `json:"hasSecret"`
}

type QueryAuthView struct {
	Name      string `json:"name"`
	HasSecret bool   `json:"hasSecret"`
}

type AuthzAuthView struct {
	Kind      AuthzKind `json:"kind"`
	Username  string    `json:"username,omitempty"`
	HasSecret bool      `json:"hasSecret"`
}

func (a UpstreamAuth) View() AuthView {
	v := AuthView{}
	if a.Header != nil {
		v.Header = &HeaderAuthView{Name: a.Header.Name, HasSecret: a.Header.Secret != ""}
	}
	if a.Query != nil {
		v.Query = &QueryAuthView{Name: a.Query.Name, HasSecret: a.Query.Secret != ""}
	}
	if a.Authz != nil {
		v.Authz = &AuthzAuthView{Kind: a.Authz.Kind, Username: a.Authz.Username, HasSecret: a.Authz.Secret != ""}
	}
	return v
}

func (a UpstreamAuth) IsNone() bool {
	return a.Header == nil && a.Query == nil && a.Authz == nil
}

var headerNameRe = regexp.MustCompile(`^[!#$%&'*+.^_|~0-9A-Za-z-]+$`)

var forbiddenHeaders = map[string]bool{
	"host": true, "content-length": true, "transfer-encoding": true,
	"connection": true, "upgrade": true,
}

// FieldError is a map of field path -> message for form inline errors.
type FieldError map[string]string

func (e FieldError) Error() string {
	for k, v := range e {
		return k + ": " + v
	}
	return "validation error"
}

// UnmarshalJSON accepts the multi-slot shape or legacy {type,name,username,secret}.
func (a *UpstreamAuth) UnmarshalJSON(b []byte) error {
	type raw struct {
		Header *HeaderAuth `json:"header"`
		Query  *QueryAuth  `json:"query"`
		Authz  *AuthzAuth  `json:"authz"`
		Type   string      `json:"type"`
		Name   string      `json:"name"`
		User   string      `json:"username"`
		Secret string      `json:"secret"`
	}
	var r raw
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	if r.Header != nil || r.Query != nil || r.Authz != nil {
		a.Header, a.Query, a.Authz = r.Header, r.Query, r.Authz
		return nil
	}
	if r.Type != "" {
		*a = legacyTypeToSlots(r.Type, r.Name, r.User, r.Secret)
		return nil
	}
	a.Header, a.Query, a.Authz = nil, nil, nil
	return nil
}

func legacyTypeToSlots(typ, name, user, secret string) UpstreamAuth {
	switch strings.ToLower(typ) {
	case "header":
		if name == "" {
			name = "X-Api-Key"
		}
		return UpstreamAuth{Header: &HeaderAuth{Name: name, Secret: secret}}
	case "query":
		if name == "" {
			name = "apikey"
		}
		return UpstreamAuth{Query: &QueryAuth{Name: name, Secret: secret}}
	case "bearer":
		return UpstreamAuth{Authz: &AuthzAuth{Kind: AuthzBearer, Secret: secret}}
	case "basic":
		return UpstreamAuth{Authz: &AuthzAuth{Kind: AuthzBasic, Username: user, Secret: secret}}
	default:
		return UpstreamAuth{}
	}
}

// Validate checks auth for create (requireSecret=true) or update (after merge).
func (a *UpstreamAuth) Validate(requireSecret bool) error {
	errs := FieldError{}
	if a.Header != nil {
		h := a.Header
		if h.Name == "" {
			errs["auth.header.name"] = "header name is required"
		} else if !headerNameRe.MatchString(h.Name) {
			errs["auth.header.name"] = "invalid header name"
		} else if forbiddenHeaders[strings.ToLower(h.Name)] {
			errs["auth.header.name"] = "header name is not allowed"
		}
		if requireSecret && h.Secret == "" {
			errs["auth.header.secret"] = "API key is required"
		}
	}
	if a.Query != nil {
		q := a.Query
		if q.Name == "" {
			errs["auth.query.name"] = "parameter name is required"
		} else if strings.ContainsAny(q.Name, "&=#? \t\r\n") {
			errs["auth.query.name"] = "parameter name cannot contain &, =, #, ?, or whitespace"
		}
		if requireSecret && q.Secret == "" {
			errs["auth.query.secret"] = "value is required"
		}
	}
	if a.Authz != nil {
		z := a.Authz
		switch z.Kind {
		case AuthzBearer:
			z.Username = ""
			if requireSecret && z.Secret == "" {
				errs["auth.authz.secret"] = "token is required"
			}
		case AuthzBasic:
			if z.Username == "" {
				errs["auth.authz.username"] = "username is required"
			} else if strings.Contains(z.Username, ":") {
				errs["auth.authz.username"] = "username cannot contain ':'"
			}
			if requireSecret && z.Secret == "" {
				errs["auth.authz.secret"] = "password is required"
			}
		default:
			errs["auth.authz.kind"] = "kind must be bearer or basic"
		}
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// Apply strips caller credentials and injects every enabled upstream slot.
func (a UpstreamAuth) Apply(out *http.Request) {
	out.Header.Del("Authorization")
	out.Header.Del("X-Proxy-Token")

	if a.Header != nil && a.Header.Name != "" {
		out.Header.Del(a.Header.Name)
	}
	if a.Query != nil && a.Query.Name != "" {
		q := out.URL.Query()
		q.Del(a.Query.Name)
		out.URL.RawQuery = q.Encode()
	}

	if a.Header != nil && a.Header.Name != "" && a.Header.Secret != "" {
		out.Header.Set(a.Header.Name, a.Header.Secret)
	}
	if a.Query != nil && a.Query.Name != "" && a.Query.Secret != "" {
		q := out.URL.Query()
		q.Set(a.Query.Name, a.Query.Secret)
		out.URL.RawQuery = q.Encode()
	}
	if a.Authz != nil {
		switch a.Authz.Kind {
		case AuthzBearer:
			if a.Authz.Secret != "" {
				out.Header.Set("Authorization", "Bearer "+a.Authz.Secret)
			}
		case AuthzBasic:
			if a.Authz.Username != "" || a.Authz.Secret != "" {
				out.SetBasicAuth(a.Authz.Username, a.Authz.Secret)
			}
		}
	}
}

// StripCallerQuery removes the Postern caller token query param.
func StripCallerQuery(q url.Values) {
	q.Del("token")
}

// callerToken reads the Postern token from the default trio of places.
func callerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if t := r.Header.Get(defaultGateHeader); t != "" {
		return t
	}
	return r.URL.Query().Get(defaultGateQuery)
}

// redactURL returns a copy of u with the named query param value replaced.
func redactURL(u *url.URL, paramName string) string {
	if u == nil {
		return ""
	}
	cp := *u
	q := cp.Query()
	if paramName != "" && q.Has(paramName) {
		q.Set(paramName, "REDACTED")
		cp.RawQuery = q.Encode()
	}
	return cp.String()
}

func (a UpstreamAuth) queryParamName() string {
	if a.Query != nil {
		return a.Query.Name
	}
	return ""
}

// migrateLegacy fills Auth from old apiKey/keyHeader fields.
func migrateLegacy(apiKey, keyHeader string) UpstreamAuth {
	if apiKey == "" {
		return UpstreamAuth{}
	}
	if keyHeader == "" {
		keyHeader = "X-Api-Key"
	}
	return UpstreamAuth{Header: &HeaderAuth{Name: keyHeader, Secret: apiKey}}
}

// mergeAuth applies an update: nil slots clear; empty secrets keep the previous value.
func mergeAuth(cur, in UpstreamAuth) (UpstreamAuth, error) {
	out := UpstreamAuth{}
	if in.Header != nil {
		h := *in.Header
		if h.Secret == "" && cur.Header != nil {
			h.Secret = cur.Header.Secret
		}
		out.Header = &h
	}
	if in.Query != nil {
		q := *in.Query
		if q.Secret == "" && cur.Query != nil {
			q.Secret = cur.Query.Secret
		}
		out.Query = &q
	}
	if in.Authz != nil {
		z := *in.Authz
		if z.Secret == "" && cur.Authz != nil {
			z.Secret = cur.Authz.Secret
		}
		out.Authz = &z
	}
	requireSecret := false
	if out.Header != nil && out.Header.Secret == "" {
		requireSecret = true
	}
	if out.Query != nil && out.Query.Secret == "" {
		requireSecret = true
	}
	if out.Authz != nil && out.Authz.Secret == "" {
		requireSecret = true
	}
	if err := out.Validate(requireSecret); err != nil {
		return out, err
	}
	return out, nil
}

func authNeedsSecret(a UpstreamAuth) bool {
	return !a.IsNone()
}

func secretEq(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func matchSecret(presented, stored, token string) bool {
	if presented == "" {
		return false
	}
	if stored != "" && secretEq(presented, stored) {
		return true
	}
	if token != "" && secretEq(presented, token) {
		return true
	}
	return false
}

// authorizeUpstream returns true if any enabled slot matches the request.
func (a UpstreamAuth) authorizeUpstream(r *http.Request, token string) bool {
	if a.Header != nil && a.Header.Name != "" {
		if matchSecret(r.Header.Get(a.Header.Name), a.Header.Secret, token) {
			return true
		}
	}
	if a.Query != nil && a.Query.Name != "" {
		if matchSecret(r.URL.Query().Get(a.Query.Name), a.Query.Secret, token) {
			return true
		}
	}
	if a.Authz != nil {
		switch a.Authz.Kind {
		case AuthzBearer:
			h := r.Header.Get("Authorization")
			if strings.HasPrefix(h, "Bearer ") {
				if matchSecret(strings.TrimPrefix(h, "Bearer "), a.Authz.Secret, token) {
					return true
				}
			}
		case AuthzBasic:
			u, p, ok := r.BasicAuth()
			if ok && a.Authz.Username != "" && secretEq(u, a.Authz.Username) {
				if matchSecret(p, a.Authz.Secret, token) {
					return true
				}
			}
		}
	}
	return false
}

// PathIsOpen reports whether the proxied path skips Postern caller auth.
func PathIsOpen(svc Service, path string) bool {
	if path == "" {
		path = "/"
	} else if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	for _, rule := range svc.OpenPaths {
		switch rule.Match {
		case OpenMatchRegex:
			re, err := regexp.Compile(rule.Path)
			if err != nil {
				continue
			}
			if re.MatchString(path) {
				return true
			}
		default:
			if rule.Path != "" && rule.Path != "/" && strings.HasPrefix(path, rule.Path) {
				return true
			}
		}
	}
	return false
}

// AuthorizeCaller checks the service access mode against the incoming request.
func AuthorizeCaller(svc Service, r *http.Request) bool {
	return resolveCaller(svc, r, time.Now()).Allowed
}

// callerResult is the outcome of matching a request to a caller.
type callerResult struct {
	ID      string // token ID; empty for a real upstream key or an unsaved legacy token
	Name    string // token name, "upstream" for a real upstream key, empty if nothing matched
	Allowed bool
	Reason  string // why a recognised token was refused: "paused" or "expired"
}

func judgeToken(tok CallerToken, now time.Time) callerResult {
	res := callerResult{ID: tok.ID, Name: tok.Name}
	switch {
	case tok.Paused:
		res.Reason = "paused"
	case tok.Expired(now):
		res.Reason = "expired"
	default:
		res.Allowed = true
	}
	return res
}

// resolveCaller reports which named token matched, or "upstream" when the
// real upstream secret was presented in upstream-access mode.
func resolveCaller(svc Service, r *http.Request, now time.Time) callerResult {
	if len(svc.Tokens) == 0 && svc.Token != "" {
		svc.Tokens = []CallerToken{{Name: "default", Secret: svc.Token}}
	}
	switch normalizeAccess(svc.Access) {
	case AccessUpstream:
		return resolveUpstream(svc, r, now)
	default:
		for _, presented := range presentedCallerValues(svc, r) {
			if tok, ok := tokenBySecret(svc, presented); ok {
				return judgeToken(tok, now)
			}
		}
		return callerResult{}
	}
}

func tokenBySecret(svc Service, presented string) (CallerToken, bool) {
	if presented == "" {
		return CallerToken{}, false
	}
	var found CallerToken
	ok := false
	for _, t := range svc.Tokens {
		if t.Secret != "" && secretEq(presented, t.Secret) {
			found = t
			ok = true
		}
	}
	if !ok && svc.Token != "" && secretEq(presented, svc.Token) {
		return CallerToken{Name: "default", Secret: svc.Token}, true
	}
	return found, ok
}

func presentedCallerValues(svc Service, r *http.Request) []string {
	var out []string
	add := func(s string) {
		if s != "" {
			out = append(out, s)
		}
	}
	g := svc.Gate
	if g == nil || g.IsEmpty() {
		add(callerToken(r))
		return out
	}
	if g.Bearer {
		h := r.Header.Get("Authorization")
		if strings.HasPrefix(h, "Bearer ") {
			add(strings.TrimPrefix(h, "Bearer "))
		}
	}
	if g.Header != nil {
		name := g.Header.Name
		if name == "" {
			name = defaultGateHeader
		}
		add(r.Header.Get(name))
	}
	if g.Query != nil {
		name := g.Query.Name
		if name == "" {
			name = defaultGateQuery
		}
		add(r.URL.Query().Get(name))
	}
	return out
}

func resolveUpstream(svc Service, r *http.Request, now time.Time) callerResult {
	for _, presented := range upstreamPresented(svc, r) {
		if tok, ok := tokenBySecret(svc, presented); ok {
			return judgeToken(tok, now)
		}
	}
	if svc.Auth.authorizeUpstream(r, "") {
		return callerResult{Name: "upstream", Allowed: true}
	}
	return callerResult{}
}

func upstreamPresented(svc Service, r *http.Request) []string {
	var out []string
	a := svc.Auth
	if a.Header != nil && a.Header.Name != "" {
		if v := r.Header.Get(a.Header.Name); v != "" {
			out = append(out, v)
		}
	}
	if a.Query != nil && a.Query.Name != "" {
		if v := r.URL.Query().Get(a.Query.Name); v != "" {
			out = append(out, v)
		}
	}
	if a.Authz != nil {
		switch a.Authz.Kind {
		case AuthzBearer:
			h := r.Header.Get("Authorization")
			if strings.HasPrefix(h, "Bearer ") {
				out = append(out, strings.TrimPrefix(h, "Bearer "))
			}
		case AuthzBasic:
			if _, p, ok := r.BasicAuth(); ok && p != "" {
				out = append(out, p)
			}
		}
	}
	return out
}

var errNotFound = errors.New("not found")
