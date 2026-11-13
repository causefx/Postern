package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	defaultActivityLimit = 20
	maxActivityLimit     = 1000
)

type activityEvent struct {
	Time   time.Time `json:"time"`
	Method string    `json:"method"`
	Path   string    `json:"path"`
	Status int       `json:"status"`
	Who    string    `json:"who"`
	Reason string    `json:"reason,omitempty"`
}

type activityLog struct {
	mu    sync.Mutex
	path  string
	limit int
	by    map[string][]activityEvent
}

func newActivityLog() *activityLog {
	return &activityLog{by: map[string][]activityEvent{}}
}

// openActivityLog loads the persisted ring beside the data file. limit is how
// many events each service keeps; zero uses the default. A missing or
// unreadable file starts empty so a bad activity file cannot stop the server.
func openActivityLog(path string, limit int) *activityLog {
	l := newActivityLog()
	l.path = path
	l.limit = normalizeActivityLimit(limit)
	b, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("activity: %v", err)
		}
		return l
	}
	var by map[string][]activityEvent
	if err := json.Unmarshal(b, &by); err != nil {
		log.Printf("activity: %v", err)
		return l
	}
	if by == nil {
		by = map[string][]activityEvent{}
	}
	l.by = by
	l.mu.Lock()
	trimmed := l.trimLocked()
	if trimmed {
		l.saveLocked()
	}
	l.mu.Unlock()
	return l
}

func normalizeActivityLimit(n int) int {
	if n <= 0 {
		return defaultActivityLimit
	}
	if n > maxActivityLimit {
		return maxActivityLimit
	}
	return n
}

// setLimit applies a new cap and trims stored events down to it.
func (l *activityLog) setLimit(n int) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.limit = normalizeActivityLimit(n)
	if l.trimLocked() {
		l.saveLocked()
	}
}

func (l *activityLog) cap() int {
	if l == nil || l.limit <= 0 {
		return defaultActivityLimit
	}
	return l.limit
}

// trimLocked drops events past the cap. The caller holds l.mu.
func (l *activityLog) trimLocked() bool {
	n := l.cap()
	changed := false
	for name, list := range l.by {
		if len(list) > n {
			l.by[name] = append([]activityEvent(nil), list[len(list)-n:]...)
			changed = true
		}
	}
	return changed
}

func (l *activityLog) add(name string, ev activityEvent) {
	if l == nil || name == "" {
		return
	}
	if ev.Time.IsZero() {
		ev.Time = time.Now().UTC()
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	list := append(l.by[name], ev)
	if len(list) > l.cap() {
		list = list[len(list)-l.cap():]
	}
	l.by[name] = list
	l.saveLocked()
}

func (l *activityLog) list(name string) []activityEvent {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	src := l.by[name]
	out := make([]activityEvent, len(src))
	copy(out, src)
	return out
}

// summary is the ring length plus the newest status, time, and caller.
// who is the token name, or open, rejected, off, limited, or upstream.
// A paused or expired token keeps its name and sets reason to match.
// It is empty when the service has no recorded requests.
func (l *activityLog) summary(name string) (count, status int, last time.Time, who string) {
	if l == nil || name == "" {
		return 0, 0, time.Time{}, ""
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	src := l.by[name]
	if len(src) == 0 {
		return 0, 0, time.Time{}, ""
	}
	lastEv := src[len(src)-1]
	who = lastEv.Who
	if (lastEv.Reason == "paused" || lastEv.Reason == "expired") && who != "" && who != "paused" {
		who += " · " + lastEv.Reason
	}
	return len(src), lastEv.Status, lastEv.Time, who
}

func (l *activityLog) forget(name string) {
	if l == nil || name == "" {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if _, ok := l.by[name]; !ok {
		return
	}
	delete(l.by, name)
	l.saveLocked()
}

func (l *activityLog) rename(oldName, newName string) {
	if l == nil || oldName == "" || newName == "" || oldName == newName {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	list, ok := l.by[oldName]
	if !ok {
		return
	}
	delete(l.by, oldName)
	l.by[newName] = list
	l.saveLocked()
}

// saveLocked writes the ring atomically. The caller holds l.mu. An empty path
// keeps tests in memory. Failures are logged and do not affect the proxy.
func (l *activityLog) saveLocked() {
	if l.path == "" {
		return
	}
	b, err := json.MarshalIndent(l.by, "", "  ")
	if err != nil {
		log.Printf("activity: %v", err)
		return
	}
	b = append(b, '\n')
	if dir := filepath.Dir(l.path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Printf("activity: %v", err)
			return
		}
	}
	tmp := l.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Printf("activity: %v", err)
		return
	}
	if err := os.Rename(tmp, l.path); err != nil {
		log.Printf("activity: %v", err)
	}
}

func (a *App) noteActivity(name, method, path, who string, status int) {
	a.noteCaller(name, method, path, who, "", status)
}

func (a *App) noteCaller(name, method, path, who, reason string, status int) {
	if a == nil || a.activity == nil {
		return
	}
	a.activity.add(name, activityEvent{
		Time:   time.Now().UTC(),
		Method: method,
		Path:   path,
		Status: status,
		Who:    who,
		Reason: reason,
	})
}

// statusWriter records the status ReverseProxy writes, and still flushes and hijacks.
type statusWriter struct {
	http.ResponseWriter
	code int
}

func (s *statusWriter) WriteHeader(code int) {
	if s.code == 0 {
		s.code = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusWriter) Write(b []byte) (int, error) {
	if s.code == 0 {
		s.code = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

func (s *statusWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijack not supported")
	}
	return h.Hijack()
}

func (s *statusWriter) Unwrap() http.ResponseWriter { return s.ResponseWriter }
