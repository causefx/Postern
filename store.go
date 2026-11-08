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
	"strings"
	"sync"
)

// Service is one upstream exposed through Postern.
type Service struct {
	Name    string       `json:"name"`
	URL     string       `json:"url"`
	Auth    UpstreamAuth `json:"auth"`
	Access  AccessMode   `json:"access,omitempty"` // postern (default) | upstream
	Token   string       `json:"token"`
	Enabled bool         `json:"enabled"`
}

// legacyService is used only when reading old configs that store apiKey/keyHeader.
type legacyService struct {
	Name      string          `json:"name"`
	URL       string          `json:"url"`
	Auth      json.RawMessage `json:"auth"`
	Access    AccessMode      `json:"access"`
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
	if s.Access == AccessUpstream && s.Auth.Type == AuthNone {
		return FieldError{"access": "upstream access requires an upstream auth method (header, query, bearer, or basic)"}
	}
	return nil
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
	migrated := false
	for _, leg := range raw {
		svc := Service{
			Name:    leg.Name,
			URL:     leg.URL,
			Access:  normalizeAccess(leg.Access),
			Token:   leg.Token,
			Enabled: leg.Enabled,
		}
		if len(leg.Auth) > 0 && string(leg.Auth) != "null" {
			var auth UpstreamAuth
			if err := json.Unmarshal(leg.Auth, &auth); err != nil {
				return nil, err
			}
			svc.Auth = auth
		}
		if svc.Auth.Type == "" {
			svc.Auth = migrateLegacy(leg.APIKey, leg.KeyHeader)
			migrated = true
		}
		s.data[svc.Name] = svc
	}
	if migrated {
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
	if svc.Auth.Type == "" {
		svc.Auth.Type = AuthNone
	}
	svc.Access = normalizeAccess(svc.Access)
	if err := svc.validate(authNeedsSecret(svc.Auth.Type)); err != nil {
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
func (s *Store) Update(name string, in Service) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[name]
	if !ok {
		return cur, errNotFound
	}
	cur.URL = strings.TrimRight(strings.TrimSpace(in.URL), "/")
	if u, err := url.Parse(cur.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return cur, errors.New("url must be a valid http(s) URL")
	}
	cur.Enabled = in.Enabled
	if in.Access != "" {
		cur.Access = normalizeAccess(in.Access)
	}
	auth, err := mergeAuth(cur.Auth, in.Auth)
	if err != nil {
		return cur, err
	}
	cur.Auth = auth
	if err := cur.validate(false); err != nil {
		return cur, err
	}
	prev := s.data[name]
	s.data[name] = cur
	if err := s.saveLocked(); err != nil {
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
