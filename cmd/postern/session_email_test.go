package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSessionKeepsOIDCEmail(t *testing.T) {
	s := newSessionStore("secret")
	raw, err := s.createFromOIDC(true, "dev@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !s.valid(raw) || !s.viaOIDC(raw) || !s.remember(raw) {
		t.Fatal("session lost its flags")
	}
	if got := s.email(raw); got != "dev@example.com" {
		t.Fatalf("email %q", got)
	}
	refreshed, err := s.refresh(raw)
	if err != nil || s.email(refreshed) != "dev@example.com" || !s.viaOIDC(refreshed) {
		t.Fatal("refresh dropped the email")
	}

	// The address is signed with the rest of the cookie.
	parts := strings.Split(raw, ".")
	parts[3] = "61" + parts[3][2:]
	if s.valid(strings.Join(parts, ".")) {
		t.Fatal("tampered email accepted")
	}
}

func TestSessionWithoutEmail(t *testing.T) {
	s := newSessionStore("secret")
	for name, mk := range map[string]func() (string, error){
		"password":      func() (string, error) { return s.create(false) },
		"oidc no mail":  func() (string, error) { return s.createFromOIDC(false, "") },
		"oidc bad mail": func() (string, error) { return s.createFromOIDC(false, "not an address") },
	} {
		raw, err := mk()
		if err != nil || !s.valid(raw) || s.email(raw) != "" {
			t.Fatalf("%s: raw=%q err=%v email=%q", name, raw, err, s.email(raw))
		}
	}
	if s.email("junk") != "" {
		t.Fatal("email for an invalid cookie")
	}
}

func TestMetaReportsEmail(t *testing.T) {
	app := &App{sessions: newSessionStore("secret"), store: &Store{}}
	raw, _ := app.sessions.createFromOIDC(false, "dev@example.com")
	req := httptest.NewRequest(http.MethodGet, "/admin/api/meta", nil)
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: raw})
	rec := httptest.NewRecorder()
	app.meta(rec, req)
	if !strings.Contains(rec.Body.String(), `"email":"dev@example.com"`) {
		t.Fatalf("meta %s", rec.Body.String())
	}
	plain := httptest.NewRecorder()
	app.meta(plain, httptest.NewRequest(http.MethodGet, "/admin/api/meta", nil))
	if !strings.Contains(plain.Body.String(), `"email":""`) {
		t.Fatalf("meta without session %s", plain.Body.String())
	}
}
