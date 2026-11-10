package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	sessionCookie      = "postern_session"
	sessionTTLRemember = 7 * 24 * time.Hour
	sessionTTLShort    = 12 * time.Hour
)

var errSession = errors.New("session")

// sessionStore issues HMAC cookies. The key comes from ADMIN_PASSWORD, so a
// restart keeps sessions and changing the password signs everyone out.
type sessionStore struct {
	key []byte
}

func newSessionStore(password string) *sessionStore {
	sum := sha256.Sum256([]byte("postern-session-v1\n" + password))
	return &sessionStore{key: sum[:]}
}

func (s *sessionStore) create(remember bool) (string, error) {
	return s.issue(remember, false)
}

func (s *sessionStore) createFromOIDC(remember bool) (string, error) {
	return s.issue(remember, true)
}

func (s *sessionStore) refresh(raw string) (string, error) {
	ok, remember, oidc := s.parse(raw)
	if !ok {
		return "", errSession
	}
	return s.issue(remember, oidc)
}

func (s *sessionStore) issue(remember, oidc bool) (string, error) {
	ttl := sessionTTLShort
	if remember {
		ttl = sessionTTLRemember
	}
	return s.seal(time.Now().Add(ttl), ttl, oidc), nil
}

func (s *sessionStore) seal(exp time.Time, ttl time.Duration, oidc bool) string {
	flag := "p"
	if oidc {
		flag = "o"
	}
	payload := strconv.FormatInt(exp.Unix(), 10) + "." + strconv.Itoa(int(ttl.Seconds())) + "." + flag
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(payload))
	return payload + "." + hex.EncodeToString(mac.Sum(nil))
}

func (s *sessionStore) valid(raw string) bool {
	ok, _, _ := s.parse(raw)
	return ok
}

func (s *sessionStore) remember(raw string) bool {
	ok, remember, _ := s.parse(raw)
	return ok && remember
}

func (s *sessionStore) viaOIDC(raw string) bool {
	ok, _, oidc := s.parse(raw)
	return ok && oidc
}

func (s *sessionStore) parse(raw string) (ok bool, remember bool, oidc bool) {
	parts := strings.Split(raw, ".")
	var payload, macHex string
	switch len(parts) {
	case 3:
		// Cookies issued before the sign-in method was stored.
		payload = parts[0] + "." + parts[1]
		macHex = parts[2]
	case 4:
		if parts[2] != "p" && parts[2] != "o" {
			return false, false, false
		}
		payload = parts[0] + "." + parts[1] + "." + parts[2]
		macHex = parts[3]
		oidc = parts[2] == "o"
	default:
		return false, false, false
	}
	mac, err := hex.DecodeString(macHex)
	if err != nil || len(mac) != sha256.Size {
		return false, false, false
	}
	expect := hmac.New(sha256.New, s.key)
	expect.Write([]byte(payload))
	if !hmac.Equal(mac, expect.Sum(nil)) {
		return false, false, false
	}
	expUnix, err1 := strconv.ParseInt(parts[0], 10, 64)
	ttlSec, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || ttlSec <= 0 {
		return false, false, false
	}
	if time.Now().Unix() > expUnix {
		return false, false, false
	}
	return true, ttlSec >= int(sessionTTLRemember.Seconds()), oidc
}

func (s *sessionStore) revoke(string) {}

func setSessionCookie(w http.ResponseWriter, r *http.Request, value string, remember bool) {
	c := &http.Cookie{
		Name:     sessionCookie,
		Value:    value,
		Path:     "/admin",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
	}
	if remember {
		c.MaxAge = int(sessionTTLRemember.Seconds())
	}
	http.SetCookie(w, c)
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/admin",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
		MaxAge:   -1,
	})
}

func sessionID(r *http.Request) string {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return ""
	}
	return c.Value
}
