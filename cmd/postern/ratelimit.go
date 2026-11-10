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
	n     int
	start time.Time
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
	if l == nil || service == "" {
		return true
	}
	now := time.Now()
	key := service + "\n" + ip
	l.mu.Lock()
	defer l.mu.Unlock()
	max := defaultRateLimit
	if l.configured {
		max = l.max
	} else if proxyRateMax > 0 {
		max = proxyRateMax
	}
	if max == 0 {
		return true
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
		return true
	}
	if w.n >= max {
		return false
	}
	w.n++
	return true
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
