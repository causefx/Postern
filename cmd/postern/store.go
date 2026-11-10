package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// OpenPath is a path rule that skips Postern caller auth (upstream credential still injected).
type OpenPath struct {
	Match string `json:"match"` // "prefix" | "regex"
	Path  string `json:"path"`
}

const (
	OpenMatchPrefix = "prefix"
	OpenMatchRegex  = "regex"
	maxOpenPaths    = 20
	maxOpenPathLen  = 200
)

// Service is one upstream exposed through Postern.
type Service struct {
	Name      string        `json:"name"`
	URL       string        `json:"url"`
	Auth      UpstreamAuth  `json:"auth"`
	Access    AccessMode    `json:"access,omitempty"` // postern (default) | upstream
	Gate      *CallerGate   `json:"gate,omitempty"`   // nil = default Postern-token places
	OpenPaths []OpenPath    `json:"openPaths,omitempty"`
	Token     string        `json:"token"`
	Tokens    []CallerToken `json:"tokens,omitempty"`
	Enabled   bool          `json:"enabled"`
}

// CallerToken is one named secret a caller may present.
type CallerToken struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

const maxCallerTokens = 8

// legacyService is used only when reading old configs that store apiKey/keyHeader.
type legacyService struct {
	Name      string          `json:"name"`
	URL       string          `json:"url"`
	Auth      json.RawMessage `json:"auth"`
	Access    AccessMode      `json:"access"`
	Gate      *CallerGate     `json:"gate,omitempty"`
	OpenPaths []OpenPath      `json:"openPaths"`
	APIKey    string          `json:"apiKey"`
	KeyHeader string          `json:"keyHeader"`
	Token     string          `json:"token"`
	Tokens    []CallerToken   `json:"tokens,omitempty"`
	Enabled   bool            `json:"enabled"`
}

var nameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

func (s *Service) validate(requireAuthSecret bool) error {
	if !nameRe.MatchString(s.Name) {
		return errors.New("name must be 1-32 chars: a-z, 0-9, dash")
	}
	u, err := url.Parse(s.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("url must be a valid http(s) URL")
	}
	s.Access = normalizeAccess(s.Access)
	if err := s.Auth.Validate(requireAuthSecret); err != nil {
		return err
	}
	if s.Access == AccessUpstream && s.Auth.IsNone() {
		return FieldError{"access": "upstream access requires at least one upstream auth method"}
	}
	if s.Gate != nil {
		if err := s.Gate.Validate(); err != nil {
			return err
		}
		s.Gate = s.Gate.Normalize()
	}
	// Gate only applies to postern access; clear when using upstream shapes.
	if s.Access == AccessUpstream {
		s.Gate = nil
	}
	normalized, err := normalizeOpenPaths(s.OpenPaths)
	if err != nil {
		return err
	}
	s.OpenPaths = normalized
	return nil
}

func normalizeOpenPaths(in []OpenPath) ([]OpenPath, error) {
	if len(in) == 0 {
		return nil, nil
	}
	if len(in) > maxOpenPaths {
		return nil, FieldError{"openPaths": "at most 20 open paths"}
	}
	out := make([]OpenPath, 0, len(in))
	for i, raw := range in {
		key := "openPaths." + strconv.Itoa(i)
		match := strings.ToLower(strings.TrimSpace(raw.Match))
		if match == "" {
			match = OpenMatchPrefix
		}
		path := strings.TrimSpace(raw.Path)
		if path == "" {
			return nil, FieldError{key + ".path": "path is required"}
		}
		if len(path) > maxOpenPathLen {
			return nil, FieldError{key + ".path": "path is too long"}
		}
		switch match {
		case OpenMatchPrefix:
			if !strings.HasPrefix(path, "/") {
				return nil, FieldError{key + ".path": "prefix must start with /"}
			}
			if path == "/" {
				return nil, FieldError{key + ".path": "prefix / would open the whole service"}
			}
		case OpenMatchRegex:
			if !strings.HasPrefix(path, "^") {
				return nil, FieldError{key + ".path": "regex must start with ^"}
			}
			if _, err := regexp.Compile(path); err != nil {
				return nil, FieldError{key + ".path": "invalid regex: " + err.Error()}
			}
		default:
			return nil, FieldError{key + ".match": "match must be prefix or regex"}
		}
		out = append(out, OpenPath{Match: match, Path: path})
	}
	return out, nil
}

func newToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

type Store struct {
	mu       sync.RWMutex
	path     string
	settings Settings
	data     map[string]Service
}

// Settings is the non-secret configuration stored with the services.
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

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, data: map[string]Service{}, settings: defaultSettings()}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	settings, raw, dirty, err := decodeStore(b)
	if err != nil {
		return nil, err
	}
	s.settings = settings
	for _, leg := range raw {
		svc, migrated, err := serviceFromLegacy(leg)
		if err != nil {
			return nil, err
		}
		if migrated {
			dirty = true
		}
		if svc.normalizeTokens() {
			dirty = true
		}
		s.data[svc.Name] = svc
	}
	if dirty {
		s.mu.Lock()
		err := s.saveLocked()
		s.mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
	return s, nil
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

// UpdateSettings stores both limits and leaves the previous values in place if the save fails.
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
	prev := s.settings
	s.settings = next
	if err := s.saveLocked(); err != nil {
		s.settings = prev
		return Settings{}, err
	}
	return s.settings, nil
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

func defaultSettings() Settings {
	return Settings{
		ActivityLimit: defaultActivityLimit,
		RateLimit:     defaultRateLimit,
		AuditLimit:    defaultAuditLimit,
		PasswordLogin: true,
	}
}

// decodeStore reads either a bare service array or {"settings","services"}.
// dirty means the next save should rewrite the file so the setting is stored.
func decodeStore(b []byte) (Settings, []legacyService, bool, error) {
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 {
		return defaultSettings(), nil, false, nil
	}
	if trimmed[0] == '[' {
		var raw []legacyService
		if err := json.Unmarshal(trimmed, &raw); err != nil {
			return Settings{}, nil, false, err
		}
		return defaultSettings(), raw, true, nil
	}
	var doc struct {
		Settings struct {
			ActivityLimit *int  `json:"activityLimit"`
			RateLimit     *int  `json:"rateLimit"`
			AuditLimit    *int  `json:"auditLimit"`
			PasswordLogin *bool `json:"passwordLogin"`
		} `json:"settings"`
		Services []legacyService `json:"services"`
	}
	if err := json.Unmarshal(trimmed, &doc); err != nil {
		return Settings{}, nil, false, err
	}
	settings := defaultSettings()
	dirty := false
	if doc.Settings.ActivityLimit == nil {
		dirty = true
	} else if n := normalizeActivityLimit(*doc.Settings.ActivityLimit); n != *doc.Settings.ActivityLimit {
		settings.ActivityLimit = n
		dirty = true
	} else {
		settings.ActivityLimit = n
	}
	if doc.Settings.RateLimit == nil {
		dirty = true
	} else if n := normalizeRateLimit(*doc.Settings.RateLimit); n != *doc.Settings.RateLimit {
		settings.RateLimit = n
		dirty = true
	} else {
		settings.RateLimit = n
	}
	if doc.Settings.AuditLimit == nil {
		dirty = true
	} else if n := normalizeAuditLimit(*doc.Settings.AuditLimit); n != *doc.Settings.AuditLimit {
		settings.AuditLimit = n
		dirty = true
	} else {
		settings.AuditLimit = n
	}
	if doc.Settings.PasswordLogin != nil {
		settings.PasswordLogin = *doc.Settings.PasswordLogin
	}
	return settings, doc.Services, dirty, nil
}

// saveLocked must be called with s.mu held. Writes atomically, owner-only.
func (s *Store) saveLocked() error {
	list := make([]Service, 0, len(s.data))
	for _, v := range s.data {
		list = append(list, v)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	doc := struct {
		Settings Settings  `json:"settings"`
		Services []Service `json:"services"`
	}{
		Settings: Settings{
			ActivityLimit: normalizeActivityLimit(s.settings.ActivityLimit),
			RateLimit:     normalizeRateLimit(s.settings.RateLimit),
			AuditLimit:    normalizeAuditLimit(s.settings.AuditLimit),
			PasswordLogin: s.settings.PasswordLogin,
		},
		Services: list,
	}
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	for _, v := range list {
		if v.Token == "" || len(v.Tokens) == 0 {
			return errors.New("refusing to persist service with empty token")
		}
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) Get(name string) (Service, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.data[name]
	return v, ok
}

func (s *Store) List() []Service {
	s.mu.RLock()
	defer s.mu.RUnlock()
	list := make([]Service, 0, len(s.data))
	for _, v := range s.data {
		list = append(list, v)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	return list
}

func (s *Store) Create(svc Service) (Service, error) {
	svc.Name = strings.ToLower(strings.TrimSpace(svc.Name))
	svc.URL = strings.TrimRight(strings.TrimSpace(svc.URL), "/")
	svc.Access = normalizeAccess(svc.Access)
	if err := svc.validate(authNeedsSecret(svc.Auth)); err != nil {
		return svc, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data[svc.Name]; exists {
		return svc, errors.New("a service with that name already exists")
	}
	svc.Gate = svc.Gate.Normalize()
	svc.normalizeTokens()
	s.data[svc.Name] = svc
	if err := s.saveLocked(); err != nil {
		delete(s.data, svc.Name)
		return svc, err
	}
	return svc, nil
}

// Duplicate copies the upstream setup onto a new name with one fresh caller token.
// An empty newName picks the next free "<name>-N".
func (s *Store) Duplicate(name, newName string) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.data[name]
	if !ok {
		return Service{}, errNotFound
	}
	newName = strings.ToLower(strings.TrimSpace(newName))
	if newName == "" {
		var err error
		newName, err = nextCopyName(s.data, src.Name)
		if err != nil {
			return Service{}, err
		}
	}
	dup := Service{
		Name:      newName,
		URL:       src.URL,
		Auth:      cloneAuth(src.Auth),
		Access:    src.Access,
		Gate:      cloneGate(src.Gate),
		OpenPaths: append([]OpenPath(nil), src.OpenPaths...),
		Enabled:   src.Enabled,
	}
	if err := dup.validate(false); err != nil {
		return Service{}, err
	}
	if _, exists := s.data[dup.Name]; exists {
		return Service{}, FieldError{"name": "a service with that name already exists"}
	}
	dup.normalizeTokens()
	s.data[dup.Name] = dup
	if err := s.saveLocked(); err != nil {
		delete(s.data, dup.Name)
		return Service{}, err
	}
	return dup, nil
}

// CheckFile reads a data file and reports problems. It does not rewrite the file.
func CheckFile(path string) ([]string, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("data file not found: %s", path)
	}
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		return []string{"file is empty"}, nil
	}
	_, raw, _, err := decodeStore(b)
	if err != nil {
		return nil, fmt.Errorf("invalid json: %s", err)
	}
	var problems []string
	if msg := activityLimitProblem(b); msg != "" {
		problems = append(problems, msg)
	}
	if msg := rateLimitProblem(b); msg != "" {
		problems = append(problems, msg)
	}
	if msg := auditLimitProblem(b); msg != "" {
		problems = append(problems, msg)
	}
	seen := map[string]bool{}
	for i, leg := range raw {
		label := strings.TrimSpace(leg.Name)
		if label == "" {
			label = fmt.Sprintf("service %d", i)
		}
		svc, _, err := serviceFromLegacy(leg)
		if err != nil {
			problems = append(problems, label+": "+err.Error())
			continue
		}
		svc.OpenPaths = leg.OpenPaths
		if svc.Name != "" && seen[svc.Name] {
			problems = append(problems, label+": duplicate name")
		}
		if svc.Name != "" {
			seen[svc.Name] = true
		}
		if err := svc.validate(false); err != nil {
			problems = append(problems, label+": "+err.Error())
		}
	}
	return problems, nil
}

func activityLimitProblem(b []byte) string {
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return ""
	}
	var doc struct {
		Settings struct {
			ActivityLimit *int `json:"activityLimit"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(trimmed, &doc); err != nil || doc.Settings.ActivityLimit == nil {
		return ""
	}
	n := *doc.Settings.ActivityLimit
	if n < 1 || n > maxActivityLimit {
		return fmt.Sprintf("settings.activityLimit must be from 1 to %d", maxActivityLimit)
	}
	return ""
}

func rateLimitProblem(b []byte) string {
	n, ok := settingsInt(b, "rateLimit")
	if !ok {
		return ""
	}
	if n < 0 || n > maxRateLimit {
		return fmt.Sprintf("settings.rateLimit must be 0 or from 1 to %d", maxRateLimit)
	}
	return ""
}

func auditLimitProblem(b []byte) string {
	n, ok := settingsInt(b, "auditLimit")
	if !ok {
		return ""
	}
	if n < 1 || n > maxAuditLimit {
		return fmt.Sprintf("settings.auditLimit must be from 1 to %d", maxAuditLimit)
	}
	return ""
}

func settingsInt(b []byte, field string) (int, bool) {
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return 0, false
	}
	var doc struct {
		Settings map[string]*int `json:"settings"`
	}
	if err := json.Unmarshal(trimmed, &doc); err != nil || doc.Settings[field] == nil {
		return 0, false
	}
	return *doc.Settings[field], true
}

// serviceFromLegacy converts one stored record. Invalid open paths are dropped
// so a bad rule cannot publish the service; CheckFile validates the raw list.
// migrated is true when a legacy apiKey was folded into a slot.
func serviceFromLegacy(leg legacyService) (Service, bool, error) {
	svc := Service{
		Name:      leg.Name,
		URL:       leg.URL,
		Access:    normalizeAccess(leg.Access),
		Gate:      leg.Gate,
		OpenPaths: leg.OpenPaths,
		Token:     leg.Token,
		Tokens:    leg.Tokens,
		Enabled:   leg.Enabled,
	}
	if paths, err := normalizeOpenPaths(svc.OpenPaths); err == nil {
		svc.OpenPaths = paths
	} else {
		svc.OpenPaths = nil
	}
	if len(leg.Auth) > 0 && string(leg.Auth) != "null" {
		var auth UpstreamAuth
		if err := json.Unmarshal(leg.Auth, &auth); err != nil {
			return svc, false, err
		}
		svc.Auth = auth
	}
	migrated := false
	if svc.Auth.IsNone() && leg.APIKey != "" {
		svc.Auth = migrateLegacy(leg.APIKey, leg.KeyHeader)
		migrated = true
	}
	return svc, migrated, nil
}

func nextCopyName(data map[string]Service, base string) (string, error) {
	for n := 2; n < 1000; n++ {
		suffix := "-" + strconv.Itoa(n)
		stem := base
		if len(stem)+len(suffix) > 32 {
			stem = strings.TrimRight(stem[:32-len(suffix)], "-")
		}
		candidate := stem + suffix
		if !nameRe.MatchString(candidate) {
			continue
		}
		if _, exists := data[candidate]; exists {
			continue
		}
		return candidate, nil
	}
	return "", FieldError{"name": "could not choose a new name"}
}

func cloneAuth(a UpstreamAuth) UpstreamAuth {
	var out UpstreamAuth
	if a.Header != nil {
		h := *a.Header
		out.Header = &h
	}
	if a.Query != nil {
		q := *a.Query
		out.Query = &q
	}
	if a.Authz != nil {
		z := *a.Authz
		out.Authz = &z
	}
	return out
}

func cloneGate(g *CallerGate) *CallerGate {
	if g == nil {
		return nil
	}
	out := *g
	if g.Header != nil {
		h := *g.Header
		out.Header = &h
	}
	if g.Query != nil {
		q := *g.Query
		out.Query = &q
	}
	return &out
}

// Update patches an existing service. Empty auth.secret keeps the stored secret.
// If in.Name is set and differs from name, the service is renamed (token preserved).
func (s *Store) Update(name string, in Service) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[name]
	if !ok {
		return cur, errNotFound
	}
	prev := cur
	newName := strings.ToLower(strings.TrimSpace(in.Name))
	if newName == "" {
		newName = name
	}
	if newName != name {
		if !nameRe.MatchString(newName) {
			return cur, FieldError{"name": "name must be 1-32 chars: a-z, 0-9, dash"}
		}
		if _, exists := s.data[newName]; exists {
			return cur, FieldError{"name": "a service with that name already exists"}
		}
	}
	cur.Name = newName
	cur.URL = strings.TrimRight(strings.TrimSpace(in.URL), "/")
	if u, err := url.Parse(cur.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return prev, errors.New("url must be a valid http(s) URL")
	}
	cur.Enabled = in.Enabled
	if in.Access != "" {
		cur.Access = normalizeAccess(in.Access)
	}
	auth, err := mergeAuth(cur.Auth, in.Auth)
	if err != nil {
		return prev, err
	}
	cur.Auth = auth
	cur.Gate = in.Gate
	// Form always sends openPaths; replace the whole list (nil/empty clears).
	cur.OpenPaths = in.OpenPaths
	if err := cur.validate(false); err != nil {
		return prev, err
	}
	if newName != name {
		delete(s.data, name)
	}
	s.data[newName] = cur
	if err := s.saveLocked(); err != nil {
		delete(s.data, newName)
		s.data[name] = prev
		return prev, err
	}
	return cur, nil
}

func (s *Store) SetEnabled(name string, enabled bool) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[name]
	if !ok {
		return cur, errNotFound
	}
	prev := cur
	cur.Enabled = enabled
	s.data[name] = cur
	if err := s.saveLocked(); err != nil {
		s.data[name] = prev
		return prev, err
	}
	return cur, nil
}

func (s *Store) RotateToken(name string) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[name]
	if !ok {
		return cur, errNotFound
	}
	id := ""
	for _, t := range cur.Tokens {
		if t.Name == "default" {
			id = t.ID
			break
		}
	}
	if id == "" && len(cur.Tokens) > 0 {
		id = cur.Tokens[0].ID
	}
	return s.rotateLocked(name, id)
}

func (s *Store) AddToken(serviceName, label string) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[serviceName]
	if !ok {
		return cur, errNotFound
	}
	if len(cur.Tokens) >= maxCallerTokens {
		return cur, FieldError{"tokens": "at most 8 caller tokens"}
	}
	label, err := cleanTokenName(label)
	if err != nil {
		return cur, err
	}
	prev := cur
	cur.Tokens = append(cloneTokens(cur.Tokens), CallerToken{ID: newTokenID(), Name: label, Secret: newToken()})
	cur.syncTokenField()
	s.data[serviceName] = cur
	if err := s.saveLocked(); err != nil {
		s.data[serviceName] = prev
		return prev, err
	}
	return cur, nil
}

func (s *Store) RotateTokenID(serviceName, id string) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rotateLocked(serviceName, id)
}

func (s *Store) rotateLocked(serviceName, id string) (Service, error) {
	cur, ok := s.data[serviceName]
	if !ok {
		return cur, errNotFound
	}
	prev := cur
	cur.Tokens = cloneTokens(cur.Tokens)
	found := false
	for i := range cur.Tokens {
		if cur.Tokens[i].ID == id {
			cur.Tokens[i].Secret = newToken()
			found = true
			break
		}
	}
	if !found {
		return prev, errNotFound
	}
	cur.syncTokenField()
	s.data[serviceName] = cur
	if err := s.saveLocked(); err != nil {
		s.data[serviceName] = prev
		return prev, err
	}
	return cur, nil
}

func (s *Store) DeleteToken(serviceName, id string) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[serviceName]
	if !ok {
		return cur, errNotFound
	}
	if len(cur.Tokens) <= 1 {
		return cur, FieldError{"tokens": "a service needs at least one caller token"}
	}
	prev := cur
	next := make([]CallerToken, 0, len(cur.Tokens)-1)
	found := false
	for _, t := range cur.Tokens {
		if t.ID == id {
			found = true
			continue
		}
		next = append(next, t)
	}
	if !found {
		return prev, errNotFound
	}
	cur.Tokens = next
	cur.syncTokenField()
	s.data[serviceName] = cur
	if err := s.saveLocked(); err != nil {
		s.data[serviceName] = prev
		return prev, err
	}
	return cur, nil
}

// normalizeTokens fills a legacy single token into tokens[0] named default.
// It reports whether the in-memory service changed and should be saved.
func (s *Service) normalizeTokens() bool {
	changed := false
	if len(s.Tokens) == 0 {
		secret := s.Token
		if secret == "" {
			secret = newToken()
		}
		s.Tokens = []CallerToken{{ID: newTokenID(), Name: "default", Secret: secret}}
		changed = true
	}
	for i := range s.Tokens {
		if s.Tokens[i].ID == "" {
			s.Tokens[i].ID = newTokenID()
			changed = true
		}
		name := strings.TrimSpace(s.Tokens[i].Name)
		if name == "" {
			name = "default"
			changed = true
		}
		s.Tokens[i].Name = name
		if s.Tokens[i].Secret == "" {
			s.Tokens[i].Secret = newToken()
			changed = true
		}
	}
	if s.Token != s.Tokens[0].Secret {
		s.Token = s.Tokens[0].Secret
		changed = true
	}
	return changed
}

func (s *Service) syncTokenField() {
	if len(s.Tokens) > 0 {
		s.Token = s.Tokens[0].Secret
	}
}

func cloneTokens(in []CallerToken) []CallerToken {
	out := make([]CallerToken, len(in))
	copy(out, in)
	return out
}

func newTokenID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

var tokenNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$`)

func cleanTokenName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "token"
	}
	if !tokenNameRe.MatchString(name) {
		return "", FieldError{"tokens": "name must be 1-32 letters, numbers, spaces, dot, dash, or underscore"}
	}
	return name, nil
}

func (s *Store) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	prev, ok := s.data[name]
	if !ok {
		return errNotFound
	}
	delete(s.data, name)
	if err := s.saveLocked(); err != nil {
		s.data[name] = prev
		return err
	}
	return nil
}
