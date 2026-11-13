package main

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseSecureMode(t *testing.T) {
	cases := map[string]int{
		"":        -1,
		"1":       1,
		"true":    1,
		"YES":     1,
		"0":       0,
		"false":   0,
		"off":     0,
		"garbage": -1,
	}
	for in, want := range cases {
		if got := parseSecureMode(in); got != want {
			t.Fatalf("parseSecureMode(%q)=%d want %d", in, got, want)
		}
	}
}

func TestIsHTTPSModes(t *testing.T) {
	plain := httptest.NewRequest("GET", "http://x/", nil)
	plain.Header.Set("X-Forwarded-Proto", "https") // must be ignored in auto mode

	tlsReq := httptest.NewRequest("GET", "https://x/", nil)
	tlsReq.TLS = &tls.ConnectionState{}

	prev := secureMode
	t.Cleanup(func() { secureMode = prev })

	secureMode = -1
	if isHTTPS(plain) {
		t.Fatal("auto mode must not trust X-Forwarded-Proto")
	}
	if !isHTTPS(tlsReq) {
		t.Fatal("auto mode should treat direct TLS as https")
	}

	secureMode = 1
	if !isHTTPS(plain) {
		t.Fatal("POSTERN_SECURE=1 should force https")
	}

	secureMode = 0
	if isHTTPS(tlsReq) {
		t.Fatal("POSTERN_SECURE=0 should force http even with TLS")
	}
}

func TestSetSessionCookieRespectsSecureMode(t *testing.T) {
	prev := secureMode
	t.Cleanup(func() { secureMode = prev })

	secureMode = 1
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "http://x/admin/", nil)
	setSessionCookie(rec, req, "abc", true, http.SameSiteLaxMode)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].Secure {
		t.Fatalf("expected Secure cookie, got %+v", cookies)
	}
}
