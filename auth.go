package main

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

type AuthType string

const (
	AuthNone   AuthType = "none"
	AuthHeader AuthType = "header"
	AuthQuery  AuthType = "query"
	AuthBearer AuthType = "bearer"
	AuthBasic  AuthType = "basic"
)

// AccessMode chooses how callers authenticate to Postern before the proxy runs.
type AccessMode string

const (
	// AccessPostern requires the Postern-issued caller token (Bearer / X-Proxy-Token / ?token=).
	AccessPostern AccessMode = "postern"
	// AccessUpstream requires the same credential shape as upstream auth (header, query, bearer, or basic).
	AccessUpstream AccessMode = "upstream"
)

func normalizeAccess(m AccessMode) AccessMode {
	if m == AccessUpstream {
		return AccessUpstream
	}
	return AccessPostern
}

// UpstreamAuth is the credential Postern injects on every outbound request.
type UpstreamAuth struct {
	Type     AuthType `json:"type"`
	Name     string   `json:"name,omitempty"`
	Username string   `json:"username,omitempty"`
	Secret   string   `json:"secret,omitempty"`
}

// AuthView is the secret-free shape returned by the admin API.
type AuthView struct {
	Type      AuthType `json:"type"`
	Name      string   `json:"name,omitempty"`
	Username  string   `json:"username,omitempty"`
	HasSecret bool     `json:"hasSecret"`
}

func (a UpstreamAuth) View() AuthView {
	return AuthView{
		Type:      a.Type,
		Name:      a.Name,
		Username:  a.Username,
		HasSecret: a.Secret != "",
	}
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

// Validate checks auth for create (requireSecret=true) or update.
// On update, an empty Secret is allowed when keepOK is true (caller merges later).
func (a *UpstreamAuth) Validate(requireSecret bool) error {
	errs := FieldError{}
	switch a.Type {
	case AuthNone, "":
		a.Type = AuthNone
		a.Name, a.Username, a.Secret = "", "", ""
		return nil
	case AuthHeader:
		if a.Name == "" {
			errs["auth.name"] = "header name is required"
		} else if !headerNameRe.MatchString(a.Name) {
			errs["auth.name"] = "invalid header name"
		} else if forbiddenHeaders[strings.ToLower(a.Name)] {
			errs["auth.name"] = "header name is not allowed"
		}
		if requireSecret && a.Secret == "" {
			errs["auth.secret"] = "API key is required"
		}
	case AuthQuery:
		if a.Name == "" {
			errs["auth.name"] = "parameter name is required"
		} else if strings.ContainsAny(a.Name, "&=#? \t\r\n") {
			errs["auth.name"] = "parameter name cannot contain &, =, #, ?, or whitespace"
		}
		a.Username = ""
		if requireSecret && a.Secret == "" {
			errs["auth.secret"] = "value is required"
		}
	case AuthBearer:
		a.Name, a.Username = "", ""
		if requireSecret && a.Secret == "" {
			errs["auth.secret"] = "token is required"
		}
	case AuthBasic:
		a.Name = ""
		if a.Username == "" {
			errs["auth.username"] = "username is required"
		} else if strings.Contains(a.Username, ":") {
			errs["auth.username"] = "username cannot contain ':'"
		}
		if requireSecret && a.Secret == "" {
			errs["auth.secret"] = "password is required"
		}
	default:
		errs["auth.type"] = "unknown auth type"
	}
	if len(errs) > 0 {
		return errs
	}
	return nil
}

// Apply strips the caller's Postern credential and any caller-supplied copy of
// the upstream credential, then injects the stored one.
func (a UpstreamAuth) Apply(out *http.Request) {
	out.Header.Del("Authorization")
	out.Header.Del("X-Proxy-Token")

	switch a.Type {
	case AuthHeader:
		if a.Name != "" {
			out.Header.Del(a.Name)
			if a.Secret != "" {
				out.Header.Set(a.Name, a.Secret)
			}
		}
	case AuthBearer:
		if a.Secret != "" {
			out.Header.Set("Authorization", "Bearer "+a.Secret)
		}
	case AuthBasic:
		if a.Username != "" || a.Secret != "" {
			out.SetBasicAuth(a.Username, a.Secret)
		}
	case AuthQuery:
		q := out.URL.Query()
		if a.Name != "" {
			q.Del(a.Name)
			if a.Secret != "" {
				q.Set(a.Name, a.Secret)
			}
		}
		out.URL.RawQuery = q.Encode()
	case AuthNone:
		// nothing to add
	}
}

// StripCallerQuery removes the Postern caller token query param (and leaves
// other query params for Apply to handle).
func StripCallerQuery(q url.Values) {
	q.Del("token")
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

// migrateLegacy fills Auth from old apiKey/keyHeader fields when auth.type is empty.
func migrateLegacy(apiKey, keyHeader string) UpstreamAuth {
	if apiKey == "" {
		return UpstreamAuth{Type: AuthNone}
	}
	if keyHeader == "" {
		keyHeader = "X-Api-Key"
	}
	return UpstreamAuth{Type: AuthHeader, Name: keyHeader, Secret: apiKey}
}

func mergeAuth(cur, in UpstreamAuth) (UpstreamAuth, error) {
	out := in
	if out.Type == "" {
		out.Type = cur.Type
	}
	if out.Secret == "" {
		out.Secret = cur.Secret
	}
	requireSecret := out.Secret == "" && out.Type != AuthNone
	if err := out.Validate(requireSecret); err != nil {
		return out, err
	}
	if out.Type == AuthNone {
		out.Name, out.Username, out.Secret = "", "", ""
	}
	return out, nil
}

func authNeedsSecret(t AuthType) bool {
	return t != AuthNone && t != ""
}

func secretEq(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// presentedSecret returns the credential value callers sent in the upstream
// auth shape (header value, query value, bearer token, or basic password).
func (a UpstreamAuth) presentedSecret(r *http.Request) (val string, ok bool) {
	switch a.Type {
	case AuthHeader:
		if a.Name == "" {
			return "", false
		}
		v := r.Header.Get(a.Name)
		return v, v != ""
	case AuthQuery:
		if a.Name == "" {
			return "", false
		}
		v := r.URL.Query().Get(a.Name)
		return v, v != ""
	case AuthBearer:
		h := r.Header.Get("Authorization")
		if !strings.HasPrefix(h, "Bearer ") {
			return "", false
		}
		v := strings.TrimPrefix(h, "Bearer ")
		return v, v != ""
	case AuthBasic:
		u, p, ok := r.BasicAuth()
		if !ok || a.Username == "" || !secretEq(u, a.Username) {
			return "", false
		}
		return p, p != ""
	default:
		return "", false
	}
}

// AuthorizeCaller checks the service access mode against the incoming request.
// AccessUpstream accepts the upstream-shaped credential when its value matches
// either the stored upstream secret or the Postern-issued token.
func AuthorizeCaller(svc Service, r *http.Request) bool {
	switch normalizeAccess(svc.Access) {
	case AccessUpstream:
		presented, ok := svc.Auth.presentedSecret(r)
		if !ok {
			return false
		}
		return secretEq(presented, svc.Auth.Secret) || secretEq(presented, svc.Token)
	default:
		return secretEq(callerToken(r), svc.Token)
	}
}

var errNotFound = errors.New("not found")
