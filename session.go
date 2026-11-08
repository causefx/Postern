package main

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

const (
	sessionCookie      = "postern_session"
	sessionTTLRemember = 7 * 24 * time.Hour
	sessionTTLShort    = 12 * time.Hour
)

type session struct {
	exp time.Time
	ttl time.Duration
}

type sessionStore struct {
	mu   sync.Mutex
	byID map[string]session
}

func newSessionStore() *sessionStore {
	return &sessionStore{byID: map[string]session{}}
}

func (s *sessionStore) create(remember bool) (id string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", err
	}
	ttl := sessionTTLShort
	if remember {
		ttl = sessionTTLRemember
	}
	id = hex.EncodeToString(b)
	s.mu.Lock()
	s.byID[id] = session{exp: time.Now().Add(ttl), ttl: ttl}
	s.mu.Unlock()
	return id, nil
}

func (s *sessionStore) valid(id string) bool {
	if id == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.byID[id]
	if !ok {
		return false
	}
	if time.Now().After(sess.exp) {
		delete(s.byID, id)
		return false
	}
	// sliding expiry
	sess.exp = time.Now().Add(sess.ttl)
	s.byID[id] = sess
	return true
}

func (s *sessionStore) revoke(id string) {
	s.mu.Lock()
	delete(s.byID, id)
	s.mu.Unlock()
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, id string, remember bool) {
	c := &http.Cookie{
		Name:     sessionCookie,
		Value:    id,
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
