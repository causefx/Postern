package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log"
	"net/url"
	"os"
	"sync"
	"time"
)

// auditMaxBytes is the size at which the current log is renamed to path+".1".
// One previous file is kept. auditLimit also caps how many lines are kept.
var auditMaxBytes int64 = 1 << 20

const (
	defaultAuditLimit = 100
	maxAuditLimit     = 5000
)

func normalizeAuditLimit(n int) int {
	if n <= 0 {
		return defaultAuditLimit
	}
	if n > maxAuditLimit {
		return maxAuditLimit
	}
	return n
}

// auditEvent is one admin change. It never carries a secret or a query string.
type auditEvent struct {
	Time          time.Time `json:"time"`
	Action        string    `json:"action"`
	Service       string    `json:"service"`
	From          string    `json:"from,omitempty"`
	URL           string    `json:"url,omitempty"`
	Token         string    `json:"token,omitempty"`
	Enabled       *bool     `json:"enabled,omitempty"`
	Rate          *int      `json:"rate,omitempty"`
	Activity      *int      `json:"activity,omitempty"`
	Audit         *int      `json:"audit,omitempty"`
	PasswordLogin *bool     `json:"passwordLogin,omitempty"`
	// Embed summarises the embedding setting after a change: "off", "any site" or "2 sites".
	Embed  *string `json:"embed,omitempty"`
	Paused *bool   `json:"paused,omitempty"`
	// Expires is the token expiry set by token_expiry. Empty means cleared.
	Expires string `json:"expires,omitempty"`
	// Scope summarises the limit set by token_scope, such as "GET, HEAD · 2 paths". Empty means
	// the limit was removed. It never carries a secret.
	Scope string `json:"scope,omitempty"`
}

type auditLog struct {
	mu    sync.Mutex
	path  string
	limit int
}

func newAuditLog(path string) *auditLog {
	return &auditLog{path: path, limit: defaultAuditLimit}
}

// setLimit keeps at most n lines and drops older ones.
func (l *auditLog) setLimit(n int) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.limit = normalizeAuditLimit(n)
	l.trimLocked()
}

// list returns the kept entries, newest first.
func (l *auditLog) list() []auditEvent {
	if l == nil || l.path == "" {
		return []auditEvent{}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	evs := readAuditFile(l.path)
	n := l.limit
	if n <= 0 {
		n = defaultAuditLimit
	}
	if len(evs) > n {
		evs = evs[len(evs)-n:]
	}
	for i, j := 0, len(evs)-1; i < j; i, j = i+1, j-1 {
		evs[i], evs[j] = evs[j], evs[i]
	}
	return evs
}

func (a *App) record(ev auditEvent) {
	if a == nil || a.audit == nil {
		return
	}
	if err := a.audit.append(ev); err != nil {
		log.Printf("audit: %v", err)
	}
}

func (l *auditLog) append(ev auditEvent) error {
	if l == nil || l.path == "" {
		return nil
	}
	if ev.Time.IsZero() {
		ev.Time = time.Now().UTC()
	}
	ev.URL = auditURL(ev.URL)
	line, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	line = append(line, '\n')
	l.mu.Lock()
	defer l.mu.Unlock()
	f, err := os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	if st.Size()+int64(len(line)) > auditMaxBytes {
		if err := f.Close(); err != nil {
			return err
		}
		if err := rotateAudit(l.path); err != nil {
			return err
		}
		f, err = os.OpenFile(l.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
	}
	_, err = f.Write(line)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	l.trimLocked()
	return nil
}

// trimLocked keeps the newest l.limit lines. The caller holds l.mu.
func (l *auditLog) trimLocked() {
	if l == nil || l.path == "" || l.limit <= 0 {
		return
	}
	evs := readAuditFile(l.path)
	if len(evs) <= l.limit {
		return
	}
	evs = evs[len(evs)-l.limit:]
	var buf bytes.Buffer
	for _, ev := range evs {
		line, err := json.Marshal(ev)
		if err != nil {
			continue
		}
		buf.Write(line)
		buf.WriteByte('\n')
	}
	tmp := l.path + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o600); err != nil {
		log.Printf("audit: %v", err)
		return
	}
	if err := os.Rename(tmp, l.path); err != nil {
		log.Printf("audit: %v", err)
	}
}

func readAuditFile(path string) []auditEvent {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []auditEvent
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var ev auditEvent
		if json.Unmarshal(line, &ev) != nil || ev.Action == "" {
			continue
		}
		out = append(out, ev)
	}
	return out
}

func rotateAudit(path string) error {
	prev := path + ".1"
	_ = os.Remove(prev)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return os.Rename(path, prev)
}

// auditURL drops userinfo, query, and fragment so a logged URL cannot carry a secret.
func auditURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}
