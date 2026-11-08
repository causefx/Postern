package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestLoginLimiterLockout(t *testing.T) {
	l := newLoginLimiter()
	ip := "203.0.113.9"
	for i := 0; i < loginMaxFails-1; i++ {
		l.failure(ip)
		if l.blocked(ip) {
			t.Fatalf("blocked too early at fail %d", i+1)
		}
	}
	l.failure(ip)
	if !l.blocked(ip) {
		t.Fatal("expected lockout after max fails")
	}
	l.success(ip)
	if l.blocked(ip) {
		t.Fatal("success should clear lockout")
	}
}

func TestLoginLimiterExpiry(t *testing.T) {
	l := newLoginLimiter()
	ip := "198.51.100.2"
	l.mu.Lock()
	l.byIP[ip] = &loginAttempt{lockUntil: time.Now().Add(-time.Second)}
	l.mu.Unlock()
	if l.blocked(ip) {
		t.Fatal("expired lock should clear")
	}
}

func TestClientIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "192.0.2.1:54321"
	if got := clientIP(req); got != "192.0.2.1" {
		t.Fatalf("clientIP=%q", got)
	}
}

func TestLoginHandlerRateLimit(t *testing.T) {
	app := &App{
		sessions:  newSessionStore(),
		logins:    newLoginLimiter(),
		adminPass: "secret",
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /admin/api/login", app.login)

	body := `{"password":"wrong"}`
	for i := 0; i < loginMaxFails; i++ {
		req := httptest.NewRequest("POST", "/admin/api/login", strings.NewReader(body))
		req.RemoteAddr = "192.0.2.50:1"
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("fail %d: status %d", i+1, rec.Code)
		}
	}
	req := httptest.NewRequest("POST", "/admin/api/login", strings.NewReader(body))
	req.RemoteAddr = "192.0.2.50:1"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
}
