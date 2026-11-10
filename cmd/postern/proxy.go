package main

import (
	"context"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

type proxyHop struct {
	name   string
	rest   string
	target *url.URL
	gate   *CallerGate
	auth   UpstreamAuth
}

type proxyCtxKey struct{}

func (a *App) reverseProxy() *httputil.ReverseProxy {
	a.proxyOnce.Do(func() {
		a.proxyRP = &httputil.ReverseProxy{
			Rewrite:       rewriteProxy,
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
	hop.auth.Apply(pr.Out)
}

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
	hop := proxyHop{
		name:   svc.Name,
		rest:   rest,
		target: target,
		gate:   svc.Gate,
		auth:   svc.Auth,
	}
	ctx := context.WithValue(r.Context(), proxyCtxKey{}, hop)
	a.reverseProxy().ServeHTTP(w, r.WithContext(ctx))
}
