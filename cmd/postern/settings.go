package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// settingsFileName is the settings file kept beside the data file.
const settingsFileName = "postern-settings.json"

// Settings is the non-secret configuration. It lives in its own file, apart
// from the services, so it stays readable and hand-editable even when the
// data file holding the secrets is encrypted.
type Settings struct {
	// ActivityLimit is how many recent requests each service keeps.
	ActivityLimit int `json:"activityLimit"`
	// RateLimit is how many proxy requests one client IP may make to one service per minute.
	// Zero turns the limit off.
	RateLimit int `json:"rateLimit"`
	// AuditLimit is how many admin changes the activity list keeps.
	AuditLimit int `json:"auditLimit"`
	// PasswordLogin allows the admin password. It stays on unless OIDC is configured.
	PasswordLogin bool `json:"passwordLogin"`
}

func defaultSettings() Settings {
	return Settings{
		ActivityLimit: defaultActivityLimit,
		RateLimit:     defaultRateLimit,
		AuditLimit:    defaultAuditLimit,
		PasswordLogin: true,
	}
}

// settingsFile is a settings document as written by hand or by an older
// version, where any key may be missing.
type settingsFile struct {
	ActivityLimit *int  `json:"activityLimit"`
	RateLimit     *int  `json:"rateLimit"`
	AuditLimit    *int  `json:"auditLimit"`
	PasswordLogin *bool `json:"passwordLogin"`
}

// resolve fills missing keys with defaults and pulls out-of-range numbers
// back into range. changed reports that the result differs from the document,
// so the file should be written again.
func (f settingsFile) resolve() (s Settings, changed bool) {
	s = defaultSettings()
	pick := func(p *int, norm func(int) int, dst *int) {
		if p == nil {
			changed = true
			return
		}
		n := norm(*p)
		if n != *p {
			changed = true
		}
		*dst = n
	}
	pick(f.ActivityLimit, normalizeActivityLimit, &s.ActivityLimit)
	pick(f.RateLimit, normalizeRateLimit, &s.RateLimit)
	pick(f.AuditLimit, normalizeAuditLimit, &s.AuditLimit)
	if f.PasswordLogin == nil {
		changed = true
	} else {
		s.PasswordLogin = *f.PasswordLogin
	}
	return s, changed
}

// problems lists values that are present but out of range. Missing keys are
// fine: they take their defaults.
func (f settingsFile) problems() []string {
	var out []string
	if f.ActivityLimit != nil && (*f.ActivityLimit < 1 || *f.ActivityLimit > maxActivityLimit) {
		out = append(out, fmt.Sprintf("settings.activityLimit must be from 1 to %d", maxActivityLimit))
	}
	if f.RateLimit != nil && (*f.RateLimit < 0 || *f.RateLimit > maxRateLimit) {
		out = append(out, fmt.Sprintf("settings.rateLimit must be 0 or from 1 to %d", maxRateLimit))
	}
	if f.AuditLimit != nil && (*f.AuditLimit < 1 || *f.AuditLimit > maxAuditLimit) {
		out = append(out, fmt.Sprintf("settings.auditLimit must be from 1 to %d", maxAuditLimit))
	}
	return out
}

// settingsPathFor is where settings live: POSTERN_SETTINGS if set, otherwise
// postern-settings.json in the same directory as the data file.
func settingsPathFor(dataPath string) string {
	if p := strings.TrimSpace(os.Getenv("POSTERN_SETTINGS")); p != "" {
		return p
	}
	return filepath.Join(filepath.Dir(dataPath), settingsFileName)
}

// readSettingsFile loads a settings file. exists is false when there is none.
// A file that is not valid JSON is an error: carrying on with defaults would
// let the next save overwrite what the person wrote.
func readSettingsFile(path string) (f settingsFile, exists bool, err error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return settingsFile{}, false, nil
	}
	if err != nil {
		return settingsFile{}, false, err
	}
	if len(bytes.TrimSpace(b)) == 0 {
		return settingsFile{}, true, nil
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return settingsFile{}, true, fmt.Errorf("settings file %s: invalid json: %w", path, err)
	}
	return f, true, nil
}

// writeSettingsFile writes atomically, owner-only. An empty path keeps
// settings in memory only.
func writeSettingsFile(path string, s Settings) error {
	if path == "" {
		return nil
	}
	b, err := json.MarshalIndent(Settings{
		ActivityLimit: normalizeActivityLimit(s.ActivityLimit),
		RateLimit:     normalizeRateLimit(s.RateLimit),
		AuditLimit:    normalizeAuditLimit(s.AuditLimit),
		PasswordLogin: s.PasswordLogin,
	}, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if dir := filepath.Dir(path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ActivityLimit is how many recent requests each service keeps.
func (s *Store) ActivityLimit() int {
	if s == nil {
		return defaultActivityLimit
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return normalizeActivityLimit(s.settings.ActivityLimit)
}

// RateLimit is how many proxy requests one client IP may make to one service per minute.
// Zero means the limit is off.
func (s *Store) RateLimit() int {
	if s == nil {
		return defaultRateLimit
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return normalizeRateLimit(s.settings.RateLimit)
}

// AuditLimit is how many admin changes the activity list keeps.
func (s *Store) AuditLimit() int {
	if s == nil {
		return defaultAuditLimit
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return normalizeAuditLimit(s.settings.AuditLimit)
}

// PasswordLogin reports whether the stored setting allows the admin password.
// OIDC must also be configured before a false value takes effect.
func (s *Store) PasswordLogin() bool {
	if s == nil {
		return true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.PasswordLogin
}

// UpdateSettings writes the settings file and leaves the previous values in
// place if the save fails. It never touches the data file.
func (s *Store) UpdateSettings(next Settings) (Settings, error) {
	if s == nil {
		return Settings{}, errors.New("no store")
	}
	next = Settings{
		ActivityLimit: normalizeActivityLimit(next.ActivityLimit),
		RateLimit:     normalizeRateLimit(next.RateLimit),
		AuditLimit:    normalizeAuditLimit(next.AuditLimit),
		PasswordLogin: next.PasswordLogin,
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeSettingsFile(s.settingsPath, next); err != nil {
		return Settings{}, err
	}
	s.settings = next
	return s.settings, nil
}
