package main

import (
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	loginMaxFails = 5
	loginLockFor  = time.Minute
)

type loginAttempt struct {
	fails     int
	lockUntil time.Time
}

type loginLimiter struct {
	mu   sync.Mutex
	byIP map[string]*loginAttempt
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{byIP: map[string]*loginAttempt{}}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// blocked reports whether this IP is currently locked out.
func (l *loginLimiter) blocked(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.byIP[ip]
	if a == nil {
		return false
	}
	if time.Now().Before(a.lockUntil) {
		return true
	}
	if !a.lockUntil.IsZero() && time.Now().After(a.lockUntil) {
		// Lock expired — reset so a fresh streak is required.
		delete(l.byIP, ip)
	}
	return false
}

func (l *loginLimiter) success(ip string) {
	l.mu.Lock()
	delete(l.byIP, ip)
	l.mu.Unlock()
}

func (l *loginLimiter) failure(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.byIP[ip]
	if a == nil {
		a = &loginAttempt{}
		l.byIP[ip] = a
	}
	a.fails++
	if a.fails >= loginMaxFails {
		a.lockUntil = time.Now().Add(loginLockFor)
		a.fails = 0
	}
}
