package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// usageFlushDelay is how long a first use waits before the file is written,
// so a busy token costs at most one write per interval.
const usageFlushDelay = 30 * time.Second

// tokenUsage remembers when each caller token last authenticated. It is
// keyed by token ID, so renaming a service needs no migration. It lives beside
// the data file rather than in it, because the data file holds secrets and
// should not be rewritten on every request.
type tokenUsage struct {
	mu    sync.Mutex
	path  string
	last  map[string]time.Time
	timer *time.Timer
}

// openTokenUsage loads the sidecar. A missing or unreadable file starts empty
// so a bad usage file cannot stop the server. An empty path keeps it in memory.
func openTokenUsage(path string) *tokenUsage {
	u := &tokenUsage{path: path, last: map[string]time.Time{}}
	if path == "" {
		return u
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("usage: %v", err)
		}
		return u
	}
	var m map[string]time.Time
	if err := json.Unmarshal(b, &m); err != nil {
		log.Printf("usage: %v", err)
		return u
	}
	if m != nil {
		u.last = m
	}
	return u
}

// touch records a successful use now. Calls with no ID are ignored.
func (u *tokenUsage) touch(id string, now time.Time) {
	if u == nil || id == "" {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.last[id] = now.UTC()
	if u.path != "" && u.timer == nil {
		u.timer = time.AfterFunc(usageFlushDelay, u.flush)
	}
}

// lastUsed returns the last successful use, or the zero time.
func (u *tokenUsage) lastUsed(id string) time.Time {
	if u == nil || id == "" {
		return time.Time{}
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.last[id]
}

// forget drops tokens that no longer exist.
func (u *tokenUsage) forget(ids ...string) {
	if u == nil {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	changed := false
	for _, id := range ids {
		if _, ok := u.last[id]; ok {
			delete(u.last, id)
			changed = true
		}
	}
	if changed {
		u.saveLocked()
	}
}

func (u *tokenUsage) flush() {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.timer = nil
	u.saveLocked()
}

// saveLocked writes the file atomically. Failures are logged and never affect
// the proxy.
func (u *tokenUsage) saveLocked() {
	if u.path == "" {
		return
	}
	b, err := json.MarshalIndent(u.last, "", "  ")
	if err != nil {
		log.Printf("usage: %v", err)
		return
	}
	b = append(b, '\n')
	if dir := filepath.Dir(u.path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Printf("usage: %v", err)
			return
		}
	}
	tmp := u.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		log.Printf("usage: %v", err)
		return
	}
	if err := os.Rename(tmp, u.path); err != nil {
		log.Printf("usage: %v", err)
	}
}
