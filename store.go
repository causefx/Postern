package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
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
	Name      string       `json:"name"`
	URL       string       `json:"url"`
	Auth      UpstreamAuth `json:"auth"`
	Access    AccessMode   `json:"access,omitempty"` // postern (default) | upstream
	OpenPaths []OpenPath   `json:"openPaths,omitempty"`
	Token     string       `json:"token"`
	Enabled   bool         `json:"enabled"`
}

// legacyService is used only when reading old configs that store apiKey/keyHeader.
type legacyService struct {
	Name      string          `json:"name"`
	URL       string          `json:"url"`
	Auth      json.RawMessage `json:"auth"`
	Access    AccessMode      `json:"access"`
	OpenPaths []OpenPath      `json:"openPaths"`
	APIKey    string          `json:"apiKey"`
	KeyHeader string          `json:"keyHeader"`
	Token     string          `json:"token"`
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
	mu   sync.RWMutex
	path string
	data map[string]Service
}

func OpenStore(path string) (*Store, error) {
	s := &Store{path: path, data: map[string]Service{}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	var raw []legacyService
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	dirty := false
	for _, leg := range raw {
		svc := Service{
			Name:      leg.Name,
			URL:       leg.URL,
			Access:    normalizeAccess(leg.Access),
			OpenPaths: leg.OpenPaths,
			Token:     leg.Token,
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
				return nil, err
			}
			svc.Auth = auth
		}
		if svc.Auth.IsNone() && leg.APIKey != "" {
			svc.Auth = migrateLegacy(leg.APIKey, leg.KeyHeader)
			dirty = true
		}
		if svc.Token == "" {
			svc.Token = newToken()
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

// saveLocked must be called with s.mu held. Writes atomically, owner-only.
func (s *Store) saveLocked() error {
	list := make([]Service, 0, len(s.data))
	for _, v := range s.data {
		list = append(list, v)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if dir := filepath.Dir(s.path); dir != "." {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	for _, v := range list {
		if v.Token == "" {
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
	svc.Token = newToken()
	s.data[svc.Name] = svc
	if err := s.saveLocked(); err != nil {
		delete(s.data, svc.Name)
		return svc, err
	}
	return svc, nil
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
	prev := cur
	cur.Token = newToken()
	s.data[name] = cur
	if err := s.saveLocked(); err != nil {
		s.data[name] = prev
		return prev, err
	}
	return cur, nil
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
