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

// Service is one upstream (e.g. Sonarr) exposed through Postern.
type Service struct {
	Name      string `json:"name"`      // route slug: /p/<name>/...
	URL       string `json:"url"`       // upstream base URL, e.g. http://192.168.1.10:8989
	APIKey    string `json:"apiKey"`    // injected server-side, never sent to clients
	KeyHeader string `json:"keyHeader"` // header carrying the key, default X-Api-Key
	Token     string `json:"token"`     // token callers must present to Postern
	Enabled   bool   `json:"enabled"`
}

var nameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

func (s *Service) validate() error {
	if !nameRe.MatchString(s.Name) {
		return errors.New("name must be 1-32 chars: a-z, 0-9, dash")
	}
	u, err := url.Parse(s.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("url must be a valid http(s) URL")
	}
	if s.KeyHeader == "" {
		s.KeyHeader = "X-Api-Key"
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
	var list []Service
	if err := json.Unmarshal(b, &list); err != nil {
		return nil, err
	}
	for _, svc := range list {
		s.data[svc.Name] = svc
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
	if err := svc.validate(); err != nil {
		return svc, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.data[svc.Name]; exists {
		return svc, errors.New("a service with that name already exists")
	}
	svc.Token = newToken()
	s.data[svc.Name] = svc
	return svc, s.saveLocked()
}

// Update patches an existing service. Empty APIKey keeps the stored key.
func (s *Store) Update(name string, in Service, regenToken bool) (Service, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.data[name]
	if !ok {
		return cur, errors.New("not found")
	}
	cur.URL = strings.TrimRight(strings.TrimSpace(in.URL), "/")
	cur.Enabled = in.Enabled
	if in.KeyHeader != "" {
		cur.KeyHeader = in.KeyHeader
	}
	if in.APIKey != "" {
		cur.APIKey = in.APIKey
	}
	if regenToken {
		cur.Token = newToken()
	}
	if err := cur.validate(); err != nil {
		return cur, err
	}
	s.data[name] = cur
	return cur, s.saveLocked()
}

func (s *Store) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.data[name]; !ok {
		return errors.New("not found")
	}
	delete(s.data, name)
	return s.saveLocked()
}
