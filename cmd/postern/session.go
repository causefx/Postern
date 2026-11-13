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
	return s.issue(sessionInfo{Remember: remember})
}

// createFromOIDC starts a session for a person who signed in through the identity provider. The
// email, when the provider sent one, is kept in the cookie so the admin UI can show who is signed in.
func (s *sessionStore) createFromOIDC(remember bool, email string) (string, error) {
	return s.issue(sessionInfo{Remember: remember, OIDC: true, Email: cleanEmail(email)})
}

func (s *sessionStore) refresh(raw string) (string, error) {
	info, ok := s.read(raw)
	if !ok {
		return "", errSession
	}
	return s.issue(info)
}

// sessionInfo is what a valid cookie says about the session.
type sessionInfo struct {
	Remember bool
	OIDC     bool
	Email    string
}

const maxSessionEmail = 254

// cleanEmail drops anything that is not a plausible address, so an odd claim never ends up in a cookie.
func cleanEmail(email string) string {
	email = strings.TrimSpace(email)
	if email == "" || len(email) > maxSessionEmail || strings.ContainsAny(email, " \t\r\n<>\"") || !strings.Contains(email, "@") {
		return ""
	}
	return email
}

func (s *sessionStore) issue(info sessionInfo) (string, error) {
	ttl := sessionTTLShort
	if info.Remember {
		ttl = sessionTTLRemember
	}
	return s.seal(time.Now().Add(ttl), ttl, info.OIDC, info.Email), nil
}

func (s *sessionStore) seal(exp time.Time, ttl time.Duration, oidc bool, email string) string {
	flag := "p"
	if oidc {
		flag = "o"
	}
	payload := strconv.FormatInt(exp.Unix(), 10) + "." + strconv.Itoa(int(ttl.Seconds())) + "." + flag
	if email != "" {
		// Hex keeps the address free of dots, which separate the cookie's fields.
		payload += "." + hex.EncodeToString([]byte(email))
	}
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(payload))
	return payload + "." + hex.EncodeToString(mac.Sum(nil))
}

func (s *sessionStore) valid(raw string) bool {
	_, ok := s.read(raw)
	return ok
}

func (s *sessionStore) remember(raw string) bool {
	info, ok := s.read(raw)
	return ok && info.Remember
}

func (s *sessionStore) viaOIDC(raw string) bool {
	info, ok := s.read(raw)
	return ok && info.OIDC
}

// email is the address the person signed in with, or "" for a password session.
func (s *sessionStore) email(raw string) string {
	info, ok := s.read(raw)
	if !ok {
		return ""
	}
	return info.Email
}

func (s *sessionStore) read(raw string) (sessionInfo, bool) {
	var info sessionInfo
	parts := strings.Split(raw, ".")
	var payload, macHex string
	switch len(parts) {
	case 3:
		// Cookies issued before the sign-in method was stored.
		payload = parts[0] + "." + parts[1]
		macHex = parts[2]
	case 4, 5:
		if parts[2] != "p" && parts[2] != "o" {
			return info, false
		}
		n := len(parts) - 1
		payload = strings.Join(parts[:n], ".")
		macHex = parts[n]
		info.OIDC = parts[2] == "o"
		if len(parts) == 5 {
			b, err := hex.DecodeString(parts[3])
			if err != nil || cleanEmail(string(b)) != string(b) {
				return info, false
			}
			info.Email = string(b)
		}
	default:
		return info, false
	}
	mac, err := hex.DecodeString(macHex)
	if err != nil || len(mac) != sha256.Size {
		return info, false
	}
	expect := hmac.New(sha256.New, s.key)
	expect.Write([]byte(payload))
	if !hmac.Equal(mac, expect.Sum(nil)) {
		return info, false
	}
	expUnix, err1 := strconv.ParseInt(parts[0], 10, 64)
	ttlSec, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || ttlSec <= 0 {
		return info, false
	}
	if time.Now().Unix() > expUnix {
		return info, false
	}
	info.Remember = ttlSec >= int(sessionTTLRemember.Seconds())
	return info, true
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
