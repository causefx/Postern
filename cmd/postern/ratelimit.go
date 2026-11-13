package main

import (
	"log"
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

const proxyLimitSweep = 4096

var (
	proxyRateMax    = defaultRateLimit
	proxyRateWindow = time.Minute
)

const (
	defaultRateLimit = 120
	maxRateLimit     = 10000
)

// proxyLimiter counts requests per service and client IP. The shape matches
// the login limiter: a mutex, a map, and a time window. Open paths count.
// Admin routes never call it.
type proxyLimiter struct {
	mu         sync.Mutex
	max        int
	configured bool
	by         map[string]*proxyWindow
}

type proxyWindow struct {
	n      int
	start  time.Time
	warned bool // the limit was logged for this window already
}

func newProxyLimiter(max int) *proxyLimiter {
	l := &proxyLimiter{by: map[string]*proxyWindow{}}
	if max > 0 {
		l.configured = true
		l.max = max
		if l.max > maxRateLimit {
			l.max = maxRateLimit
		}
	}
	return l
}

// configuredProxyLimiter applies a stored limit. Zero means the limit is off.
func configuredProxyLimiter(max int) *proxyLimiter {
	l := newProxyLimiter(0)
	l.setMax(normalizeRateLimit(max))
	return l
}

// normalizeRateLimit clamps a stored limit. Negative values become the default.
// Zero means off. Values above the cap clamp to the cap.
func normalizeRateLimit(n int) int {
	if n < 0 {
		return defaultRateLimit
	}
	if n > maxRateLimit {
		return maxRateLimit
	}
	return n
}

func (l *proxyLimiter) setMax(n int) {
	if l == nil {
		return
	}
	n = normalizeRateLimit(n)
	l.mu.Lock()
	l.configured = true
	l.max = n
	l.mu.Unlock()
}

// allow reports whether this request is inside the current window.
func (l *proxyLimiter) allow(service, ip string) bool {
	ok, _ := l.check(service, ip)
	return ok
}

// limit is the number of requests one client may make to one service per window, 0 when off.
func (l *proxyLimiter) limit() int {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.maxLocked()
}

func (l *proxyLimiter) maxLocked() int {
	if l.configured {
		return l.max
	}
	if proxyRateMax > 0 {
		return proxyRateMax
	}
	return defaultRateLimit
}

// check is allow, plus whether this is the first refusal in the client's current window. That is
// the one the caller should log, so a client hammering a closed door is one line, not thousands.
func (l *proxyLimiter) check(service, ip string) (ok, firstRefusal bool) {
	if l == nil || service == "" {
		return true, false
	}
	now := time.Now()
	key := service + "\n" + ip
	l.mu.Lock()
	defer l.mu.Unlock()
	max := l.maxLocked()
	if max == 0 {
		return true, false
	}
	if len(l.by) > proxyLimitSweep {
		for k, w := range l.by {
			if now.Sub(w.start) >= proxyRateWindow {
				delete(l.by, k)
			}
		}
	}
	w := l.by[key]
	if w == nil || now.Sub(w.start) >= proxyRateWindow {
		l.by[key] = &proxyWindow{n: 1, start: now}
		return true, false
	}
	if w.n >= max {
		first := !w.warned
		w.warned = true
		return false, first
	}
	w.n++
	return true, false
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
		log.Printf("login: %s is locked out for %s after %d failed attempts", ip, loginLockFor, loginMaxFails)
	}
}
