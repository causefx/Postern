package main

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Embedding: whether other sites may show the admin UI in a frame.
//
// By default nothing may (frame-ancestors 'none' and X-Frame-Options: DENY), which stops
// clickjacking: a hostile page laying an invisible copy of the admin UI under its own buttons. Some
// people want the UI inside a dashboard such as Organizr or Homepage, so the embedOrigins setting
// names the sites allowed to do that.

const (
	maxEmbedOrigins   = 10
	maxEmbedOriginLen = 200
)

// embedHost is one CSP host-source: a name with an optional leading "*." wildcard, or a bracketed
// IPv6 literal. Everything is checked against this before it can reach a header, so a value can never
// add a directive of its own.
var embedHost = regexp.MustCompile(`^(?:(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])$`)

// normalizeEmbedOrigins checks and cleans the list of sites allowed to embed the admin UI. Each
// entry is "*" (any site) or an origin: http or https, a host (a leading "*." matches subdomains),
// and an optional port. A trailing slash is dropped, case is folded and duplicates are removed.
// Nothing at all is fine and means embedding is off.
func normalizeEmbedOrigins(in []string) ([]string, error) {
	var out []string
	seen := map[string]bool{}
	for _, raw := range in {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		o, err := normalizeEmbedOrigin(raw)
		if err != nil {
			return nil, err
		}
		if seen[o] {
			continue
		}
		seen[o] = true
		out = append(out, o)
	}
	if len(out) > maxEmbedOrigins {
		return nil, FieldError{"embedOrigins": fmt.Sprintf("at most %d sites", maxEmbedOrigins)}
	}
	return out, nil
}

func normalizeEmbedOrigin(raw string) (string, error) {
	bad := func(why string) (string, error) {
		return "", FieldError{"embedOrigins": fmt.Sprintf("%q %s", raw, why)}
	}
	if raw == "*" {
		return "*", nil
	}
	if len(raw) > maxEmbedOriginLen {
		return bad("is too long")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return bad("is not a site like https://dash.example.com")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return bad("must start with http:// or https://")
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return bad("must be just a site (scheme, host and optional port), without a path")
	}
	host := strings.ToLower(u.Hostname())
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if !embedHost.MatchString(host) {
		return bad("is not a valid host")
	}
	if port := u.Port(); port != "" {
		for _, c := range port {
			if c < '0' || c > '9' {
				return bad("has an invalid port")
			}
		}
		host += ":" + port
	}
	return scheme + "://" + host, nil
}

// embedSummary describes the setting for the admin log: "off", "any site", or "2 sites".
func embedSummary(origins []string) string {
	switch len(origins) {
	case 0:
		return "off"
	case 1:
		if origins[0] == "*" {
			return "any site"
		}
		return "1 site"
	}
	for _, o := range origins {
		if o == "*" {
			return "any site"
		}
	}
	return fmt.Sprintf("%d sites", len(origins))
}

// contentSecurityPolicy is the policy sent with the admin UI. The UI is plain modules and one
// stylesheet from the same origin, so nothing outside 'self' is needed. frame-ancestors is the only
// part that changes, with the embedOrigins setting.
func contentSecurityPolicy(embed []string) string {
	ancestors := "'none'"
	if len(embed) > 0 {
		ancestors = "'self'"
		for _, o := range embed {
			if o == "*" {
				ancestors = "*"
				break
			}
			ancestors += " " + o
		}
	}
	return "default-src 'self'; " +
		"script-src 'self'; " +
		"style-src 'self'; " +
		"img-src 'self' data:; " +
		"font-src 'self'; " +
		"connect-src 'self'; " +
		"object-src 'none'; " +
		"base-uri 'none'; " +
		"form-action 'self'; " +
		"frame-ancestors " + ancestors
}

// securityHeaders adds the browser protections to every admin response. It never wraps the proxy
// routes: what an upstream sends is the upstream's business.
//
// X-Frame-Options is only sent while embedding is off. It cannot name sites, so alongside an
// allowed list it would block the very sites the list permits.
func (a *App) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var embed []string
		if a != nil && a.store != nil {
			embed = a.store.EmbedOrigins()
		}
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy(embed))
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		if len(embed) == 0 {
			h.Set("X-Frame-Options", "DENY")
		}
		next.ServeHTTP(w, r)
	})
}

// sessionSameSite is the SameSite mode for the session cookie. Lax keeps it out of cross-site
// requests, which is what we want, but a page framed by another site is a cross-site request and
// would never see its session. When embedding is allowed and the connection is HTTPS (None needs
// Secure), the cookie is None so the framed UI can sign in. A framing site on the same domain as
// Postern works either way, because SameSite is about the registrable domain, not the origin.
func (a *App) sessionSameSite(r *http.Request) http.SameSite {
	if a != nil && a.store != nil && len(a.store.EmbedOrigins()) > 0 && isHTTPS(r) {
		return http.SameSiteNoneMode
	}
	return http.SameSiteLaxMode
}
