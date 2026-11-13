package main

import (
	"context"
	"crypto/tls"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

var (
	proxyDialTimeout   = 10 * time.Second
	proxyTLSHandshake  = 10 * time.Second
	proxyHeaderTimeout = 60 * time.Second
	proxyIdleTimeout   = 90 * time.Second
)

type proxyHop struct {
	name   string
	rest   string
	target *url.URL
	gate   *CallerGate
	auth   UpstreamAuth
}

type proxyCtxKey struct{}

func proxyTransport() *http.Transport {
	return &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   proxyDialTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       proxyIdleTimeout,
		TLSHandshakeTimeout:   proxyTLSHandshake,
		ResponseHeaderTimeout: proxyHeaderTimeout,
		ExpectContinueTimeout: time.Second,
		TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
	}
}

func (a *App) reverseProxy() *httputil.ReverseProxy {
	a.proxyOnce.Do(func() {
		a.proxyRP = &httputil.ReverseProxy{
			Rewrite:       rewriteProxy,
			Transport:     proxyTransport(),
			FlushInterval: -1,
			ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
				name := ""
				if hop, ok := r.Context().Value(proxyCtxKey{}).(proxyHop); ok {
					name = hop.name
				}
				log.Printf("proxy %s: %v", name, err)
				http.Error(w, "upstream unavailable", http.StatusBadGateway)
			},
		}
	})
	return a.proxyRP
}

func rewriteProxy(pr *httputil.ProxyRequest) {
	hop, _ := pr.In.Context().Value(proxyCtxKey{}).(proxyHop)
	pr.Out.URL.Path = hop.rest
	pr.Out.URL.RawPath = ""
	pr.SetURL(hop.target)
	pr.Out.URL.RawQuery = pr.In.URL.RawQuery
	hop.gate.Strip(pr.Out)
	pr.Out.Header.Del("Cookie")
	hop.auth.Apply(pr.Out)
}

func (a *App) proxy(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	svc, ok := a.store.Get(name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	rest := "/" + r.PathValue("rest")
	path := activityPath(rest, r, svc)
	// Paths are matched here and then forwarded unchanged, so a path that only means something else
	// after the upstream resolves "." and ".." could slip past an open path or a token scope.
	if hasDotSegment(rest) {
		a.noteActivity(name, r.Method, path, "rejected", http.StatusBadRequest)
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	if a.hits != nil {
		ip := clientIP(r)
		if ok, first := a.hits.check(name, ip); !ok {
			if first {
				log.Printf("rate limit: %s went over %d requests per %s to %q (further refusals in this window are not logged)", ip, a.hits.limit(), proxyRateWindow, name)
			}
			a.noteActivity(name, r.Method, path, "limited", http.StatusTooManyRequests)
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
	}
	if !svc.Enabled {
		a.noteActivity(name, r.Method, path, "off", http.StatusForbidden)
		http.Error(w, "service disabled", http.StatusForbidden)
		return
	}
	if PathIsOpen(svc, rest) {
		a.serveUpstream(w, r, svc, rest, path, "open")
		return
	}
	caller := resolveCaller(svc, r, time.Now())
	if !caller.Allowed {
		switch caller.Reason {
		case "paused":
			a.noteCaller(name, r.Method, path, caller.Name, "paused", http.StatusForbidden)
			http.Error(w, "token paused", http.StatusForbidden)
		case "expired":
			a.noteCaller(name, r.Method, path, caller.Name, "expired", http.StatusUnauthorized)
			http.Error(w, "token expired", http.StatusUnauthorized)
		default:
			a.noteActivity(name, r.Method, path, "rejected", http.StatusUnauthorized)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	if !caller.Scope.Allows(r.Method, rest) {
		a.noteCaller(name, r.Method, path, caller.Name, "scope", http.StatusForbidden)
		http.Error(w, "token scope", http.StatusForbidden)
		return
	}
	a.usage.touch(caller.ID, time.Now())
	a.serveUpstream(w, r, svc, rest, path, caller.Name)
}

func (a *App) serveUpstream(w http.ResponseWriter, r *http.Request, svc Service, rest, path, who string) {
	target, err := url.Parse(svc.URL)
	if err != nil {
		a.noteActivity(svc.Name, r.Method, path, who, http.StatusInternalServerError)
		http.Error(w, "bad upstream", http.StatusInternalServerError)
		return
	}
	hop := proxyHop{
		name:   svc.Name,
		rest:   rest,
		target: target,
		gate:   svc.Gate,
		auth:   svc.Auth,
	}
	ctx := context.WithValue(r.Context(), proxyCtxKey{}, hop)
	sw := &statusWriter{ResponseWriter: w}
	a.reverseProxy().ServeHTTP(sw, r.WithContext(ctx))
	code := sw.code
	if code == 0 {
		code = http.StatusOK
	}
	a.noteActivity(svc.Name, r.Method, path, who, code)
}

func activityPath(rest string, r *http.Request, svc Service) string {
	q := r.URL.Query()
	redact := func(name string) {
		if name != "" && q.Has(name) {
			q.Set(name, "REDACTED")
		}
	}
	redact("token")
	redact(defaultGateQuery)
	if svc.Gate != nil && svc.Gate.Query != nil {
		redact(svc.Gate.Query.Name)
	}
	if svc.Auth.Query != nil {
		redact(svc.Auth.Query.Name)
	}
	enc := q.Encode()
	if enc == "" {
		return rest
	}
	return rest + "?" + enc
}

// hasDotSegment reports whether a proxied path contains a "." or ".." segment, written plainly or
// percent-encoded (rest is already decoded). A backslash counts as a separator because some upstreams
// treat it like one.
func hasDotSegment(rest string) bool {
	for _, seg := range strings.Split(strings.ReplaceAll(rest, "\\", "/"), "/") {
		if seg == "." || seg == ".." {
			return true
		}
	}
	return false
}
