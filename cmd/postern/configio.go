package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Config export and import. The file is a versioned copy of the services: the same fields the data
// file keeps, minus the legacy single token, plus a header that says whether the secrets are in it.
//
//	{ "version": 1, "exported": "2026-11-13T16:11:00Z", "redacted": true, "services": [ ... ] }
//
// A redacted file carries no secret. Upstream keys are written as empty strings and caller tokens
// are left out, so importing it asks for the keys again and mints new tokens. A full file carries
// every secret in plain text and is as sensitive as an unencrypted data file.

const (
	configFormat      = 1
	maxImportServices = 200
	// maxImportBytes caps the request body. A service is a couple of kilobytes at most. The screen
	// refuses files over 1 MB; this leaves room for the request around them.
	maxImportBytes = 2 << 20

	minTokenSecret = 16
	maxTokenSecret = 200
)

var tokenIDRe = regexp.MustCompile(`^[0-9a-f]{16}$`)

// configHeader, configQuery and configAuthz are the upstream credential slots as they appear in the
// file. The secret is always written, empty when redacted, so a person editing the file can see
// where the key goes.
type configHeader struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

type configQuery struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

type configAuthz struct {
	Kind     AuthzKind `json:"kind"`
	Username string    `json:"username,omitempty"`
	Secret   string    `json:"secret"`
}

type configAuth struct {
	Header *configHeader `json:"header,omitempty"`
	Query  *configQuery  `json:"query,omitempty"`
	Authz  *configAuthz  `json:"authz,omitempty"`
}

func (c configAuth) upstream() UpstreamAuth {
	var out UpstreamAuth
	if c.Header != nil {
		out.Header = &HeaderAuth{Name: c.Header.Name, Secret: c.Header.Secret}
	}
	if c.Query != nil {
		out.Query = &QueryAuth{Name: c.Query.Name, Secret: c.Query.Secret}
	}
	if c.Authz != nil {
		out.Authz = &AuthzAuth{Kind: c.Authz.Kind, Username: c.Authz.Username, Secret: c.Authz.Secret}
	}
	return out
}

func configAuthFrom(a UpstreamAuth, full bool) (configAuth, int) {
	var out configAuth
	n := 0
	keep := func(secret string) string {
		if secret == "" {
			return ""
		}
		if !full {
			return ""
		}
		n++
		return secret
	}
	if a.Header != nil {
		out.Header = &configHeader{Name: a.Header.Name, Secret: keep(a.Header.Secret)}
	}
	if a.Query != nil {
		out.Query = &configQuery{Name: a.Query.Name, Secret: keep(a.Query.Secret)}
	}
	if a.Authz != nil {
		out.Authz = &configAuthz{Kind: a.Authz.Kind, Username: a.Authz.Username, Secret: keep(a.Authz.Secret)}
	}
	return out, n
}

// configToken is one caller token. A redacted file has no id and no secret: ids and secrets are
// created on import, or kept from the service already there.
type configToken struct {
	ID        string      `json:"id,omitempty"`
	Name      string      `json:"name"`
	Secret    string      `json:"secret,omitempty"`
	Paused    bool        `json:"paused,omitempty"`
	ExpiresAt time.Time   `json:"expiresAt,omitzero"`
	Scope     *TokenScope `json:"scope,omitempty"`
}

type configService struct {
	Name      string        `json:"name"`
	URL       string        `json:"url"`
	Enabled   *bool         `json:"enabled,omitempty"`
	Access    AccessMode    `json:"access,omitempty"`
	Auth      configAuth    `json:"auth"`
	Gate      *CallerGate   `json:"gate,omitempty"`
	OpenPaths []OpenPath    `json:"openPaths,omitempty"`
	Tokens    []configToken `json:"tokens,omitempty"`
}

type configFile struct {
	Version  int             `json:"version"`
	Exported time.Time       `json:"exported"`
	Redacted bool            `json:"redacted"`
	Services []configService `json:"services"`
}

// configStats says what an export holds, for the screen that offers it.
type configStats struct {
	Services int `json:"services"`
	Secrets  int `json:"secrets"`
}

// ExportConfig copies every service into a config file. With full false no secret is written.
func (s *Store) ExportConfig(full bool, now time.Time) (configFile, configStats) {
	list := s.List()
	doc := configFile{
		Version:  configFormat,
		Exported: now.UTC().Truncate(time.Second),
		Redacted: !full,
		Services: make([]configService, 0, len(list)),
	}
	stats := configStats{Services: len(list)}
	for _, svc := range list {
		enabled := svc.Enabled
		auth, n := configAuthFrom(svc.Auth, full)
		stats.Secrets += n
		cs := configService{
			Name:      svc.Name,
			URL:       svc.URL,
			Enabled:   &enabled,
			Access:    normalizeAccess(svc.Access),
			Auth:      auth,
			Gate:      cloneGate(svc.Gate),
			OpenPaths: append([]OpenPath(nil), svc.OpenPaths...),
		}
		for _, t := range svc.Tokens {
			ct := configToken{Name: t.Name, Paused: t.Paused, ExpiresAt: t.ExpiresAt, Scope: cloneScope(t.Scope)}
			if full {
				ct.ID = t.ID
				ct.Secret = t.Secret
				stats.Secrets++
			}
			cs.Tokens = append(cs.Tokens, ct)
		}
		doc.Services = append(doc.Services, cs)
	}
	return doc, stats
}

func cloneScope(sc *TokenScope) *TokenScope {
	if sc == nil {
		return nil
	}
	return &TokenScope{
		Methods: append([]string(nil), sc.Methods...),
		Paths:   append([]OpenPath(nil), sc.Paths...),
	}
}

// parseConfig reads an uploaded config file. Unknown fields are refused so a misspelt key is
// reported instead of silently dropped.
func parseConfig(raw []byte) (configFile, error) {
	var doc configFile
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		var syn *json.SyntaxError
		if errors.As(err, &syn) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
			return doc, errors.New("The file is not valid JSON: " + err.Error())
		}
		return doc, errors.New("This does not look like a Postern config file: " + err.Error())
	}
	if dec.More() {
		return doc, errors.New("The file has extra content after the config")
	}
	switch {
	case doc.Version == 0:
		return doc, errors.New("This does not look like a Postern config file: it has no version")
	case doc.Version > configFormat:
		return doc, fmt.Errorf("This file was made by a newer Postern (format %d). Update Postern to import it", doc.Version)
	case doc.Version < 0:
		return doc, errors.New("This does not look like a Postern config file: the version is not valid")
	}
	if len(doc.Services) == 0 {
		return doc, errors.New("The file has no services")
	}
	if len(doc.Services) > maxImportServices {
		return doc, fmt.Errorf("The file has more than %d services", maxImportServices)
	}
	return doc, nil
}

// What an import does with one service.
const (
	importCreate    = "create"
	importOverwrite = "overwrite"
	importSkip      = "skip"
	importError     = "error"
)

type importResult struct {
	Name   string            `json:"name"`
	URL    string            `json:"url,omitempty"`
	Action string            `json:"action"`
	Reason string            `json:"reason,omitempty"`
	Errors map[string]string `json:"errors,omitempty"`
}

type importCounts struct {
	Create    int `json:"create"`
	Overwrite int `json:"overwrite"`
	Skip      int `json:"skip"`
	Error     int `json:"error"`
}

// importOutcome is the answer to a dry run or an import.
type importOutcome struct {
	Results []importResult
	Counts  importCounts
	// Applied is true when the services were written.
	Applied bool
	// Removed lists caller token ids that no longer exist after an overwrite.
	Removed []string
}

var (
	errNothingToImport = errors.New("nothing to import: every service in the file already exists")
	errImportHasErrors = errors.New("fix the errors in the file; nothing is imported unless every service passes")
)

// ImportConfig checks a config file against the current services and, unless dryRun is set and
// every service passes, writes them all in one save. Without overwrite a service whose name is
// taken is skipped. Any error stops the whole import and nothing is written.
func (s *Store) ImportConfig(doc configFile, overwrite, dryRun bool) (importOutcome, error) {
	if dryRun {
		s.mu.RLock()
		defer s.mu.RUnlock()
	} else {
		s.mu.Lock()
		defer s.mu.Unlock()
	}
	results, built, removed := s.planImport(doc, overwrite)
	out := importOutcome{Results: results}
	for _, r := range results {
		switch r.Action {
		case importCreate:
			out.Counts.Create++
		case importOverwrite:
			out.Counts.Overwrite++
		case importSkip:
			out.Counts.Skip++
		default:
			out.Counts.Error++
		}
	}
	if out.Counts.Error > 0 {
		return out, errImportHasErrors
	}
	if dryRun {
		return out, nil
	}
	if len(built) == 0 {
		return out, errNothingToImport
	}
	prev := maps.Clone(s.data)
	for _, svc := range built {
		s.data[svc.Name] = svc
	}
	if err := s.saveLocked(); err != nil {
		s.data = prev
		return out, err
	}
	out.Applied = true
	out.Removed = removed
	return out, nil
}

// planImport decides what to do with each service in the file. It changes nothing; the caller
// holds s.mu. built holds the services to write, in file order.
func (s *Store) planImport(doc configFile, overwrite bool) (results []importResult, built []Service, removed []string) {
	// Which service owns each token id now, so an id from the file is only reused when it is free.
	owner := map[string]string{}
	for name, svc := range s.data {
		for _, t := range svc.Tokens {
			owner[t.ID] = name
		}
	}
	seen := map[string]bool{}
	for i, cs := range doc.Services {
		name := strings.ToLower(strings.TrimSpace(cs.Name))
		res := importResult{Name: name, URL: displayURL(cs.URL)}
		if name == "" {
			res.Name = fmt.Sprintf("service %d", i+1)
		}
		fail := func(errs FieldError) {
			res.Action = importError
			res.Errors = errs
			results = append(results, res)
		}

		if !nameRe.MatchString(name) {
			fail(FieldError{"name": "name must be 1-32 chars: a-z, 0-9, dash"})
			continue
		}
		if seen[name] {
			fail(FieldError{"name": "this name appears more than once in the file"})
			continue
		}
		seen[name] = true

		cur, exists := s.data[name]
		if exists && !overwrite {
			res.Action = importSkip
			res.Reason = "exists"
			results = append(results, res)
			continue
		}

		svc, errs := buildImported(cs, cur, exists, doc.Redacted, owner)
		if len(errs) > 0 {
			fail(errs)
			continue
		}
		res.URL = displayURL(svc.URL)
		res.Action = importCreate
		if exists {
			res.Action = importOverwrite
			keep := map[string]bool{}
			for _, t := range svc.Tokens {
				keep[t.ID] = true
			}
			for _, t := range cur.Tokens {
				if !keep[t.ID] {
					removed = append(removed, t.ID)
				}
			}
		}
		// Claim the ids so a later service in the same file cannot take them.
		for _, t := range svc.Tokens {
			owner[t.ID] = name
		}
		results = append(results, res)
		built = append(built, svc)
	}
	sort.Strings(removed)
	return results, built, removed
}

// displayURL is the address without its scheme, as the import list shows it.
func displayURL(raw string) string {
	u := strings.TrimSpace(raw)
	u = strings.TrimPrefix(strings.TrimPrefix(u, "https://"), "http://")
	return strings.TrimRight(u, "/")
}

// buildImported turns one file entry into a service, or reports every problem with it. cur is the
// service being replaced when exists is set; its upstream keys and caller tokens are kept wherever
// the file has none of its own.
func buildImported(cs configService, cur Service, exists, redacted bool, owner map[string]string) (Service, FieldError) {
	errs := FieldError{}
	add := func(err error) {
		if err == nil {
			return
		}
		var fe FieldError
		if errors.As(err, &fe) {
			maps.Copy(errs, fe)
			return
		}
		errs["file"] = err.Error()
	}

	svc := Service{Name: strings.ToLower(strings.TrimSpace(cs.Name)), Enabled: true}
	if cs.Enabled != nil {
		svc.Enabled = *cs.Enabled
	}
	svc.URL = strings.TrimRight(strings.TrimSpace(cs.URL), "/")
	if !validUpstreamURL(svc.URL) {
		errs["url"] = "must start with http:// or https:// and include a host"
	}
	svc.Access = normalizeAccess(cs.Access)

	// Upstream credentials. A slot the file leaves empty keeps the key already on the service.
	in := cs.Auth.upstream()
	if exists {
		merged, err := mergeAuth(cur.Auth, in)
		add(err)
		svc.Auth = merged
	} else {
		svc.Auth = in
		add(svc.Auth.Validate(authNeedsSecret(svc.Auth)))
	}
	if redacted {
		for k, v := range errs {
			if strings.HasSuffix(k, ".secret") {
				errs[k] = v + " — the file is redacted, add it to the file"
			}
		}
	}
	if svc.Access == AccessUpstream && svc.Auth.IsNone() {
		errs["access"] = "upstream access requires at least one upstream auth method"
	}

	if cs.Gate != nil && svc.Access != AccessUpstream {
		gate := *cs.Gate
		if gate.Header != nil {
			h := *gate.Header
			gate.Header = &h
		}
		if gate.Query != nil {
			q := *gate.Query
			gate.Query = &q
		}
		if err := gate.Validate(); err != nil {
			add(err)
		} else {
			svc.Gate = gate.Normalize()
		}
	}

	paths, err := normalizeOpenPaths(cs.OpenPaths)
	add(err)
	svc.OpenPaths = paths

	svc.Tokens = importTokens(cs.Tokens, cur, exists, owner, errs)

	if len(errs) > 0 {
		return Service{}, errs
	}
	svc.syncTokenField()
	return svc, nil
}

func validUpstreamURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// importTokens builds the caller tokens. A token named like one on the service being replaced keeps
// that token's id and, when the file has no secret of its own, its secret. Everything else is new.
func importTokens(in []configToken, cur Service, exists bool, owner map[string]string, errs FieldError) []CallerToken {
	if len(in) == 0 {
		if exists && len(cur.Tokens) > 0 {
			return cloneTokens(cur.Tokens)
		}
		return []CallerToken{{ID: freeTokenID("", owner), Name: "default", Secret: newToken()}}
	}
	if len(in) > maxCallerTokens {
		errs["tokens"] = "at most 8 caller tokens"
		return nil
	}
	byName := map[string]CallerToken{}
	if exists {
		for _, t := range cur.Tokens {
			if _, dup := byName[t.Name]; !dup {
				byName[t.Name] = t
			}
		}
	}
	out := make([]CallerToken, 0, len(in))
	secrets := map[string]bool{}
	for i, t := range in {
		key := fmt.Sprintf("tokens.%d.", i)
		name := strings.TrimSpace(t.Name)
		if name == "" {
			name = "default"
		}
		if !tokenNameRe.MatchString(name) {
			errs[key+"name"] = "name must be 1-32 letters, numbers, spaces, dot, dash, or underscore"
			continue
		}
		scope, err := normalizeScope(t.Scope)
		if err != nil {
			var fe FieldError
			if errors.As(err, &fe) {
				for k, v := range fe {
					errs[key+k] = v
				}
			} else {
				errs[key+"scope"] = err.Error()
			}
			continue
		}
		tok := CallerToken{Name: name, Paused: t.Paused, ExpiresAt: t.ExpiresAt.UTC(), Scope: scope}
		match, matched := byName[name]
		if matched {
			delete(byName, name)
		}
		switch {
		case t.Secret != "":
			if msg := checkTokenSecret(t.Secret); msg != "" {
				errs[key+"secret"] = msg
				continue
			}
			tok.Secret = t.Secret
		case matched:
			tok.Secret = match.Secret
		default:
			tok.Secret = newToken()
		}
		if secrets[tok.Secret] {
			errs[key+"secret"] = "another token on this service has the same secret"
			continue
		}
		secrets[tok.Secret] = true
		if matched {
			tok.ID = match.ID
		} else {
			tok.ID = freeTokenID(t.ID, owner)
			// Reserve it so two tokens in one file cannot share an id.
			owner[tok.ID] = cur.Name
		}
		out = append(out, tok)
	}
	return out
}

// freeTokenID returns want when it is a well-formed id nobody owns, and a new id otherwise.
func freeTokenID(want string, owner map[string]string) string {
	if tokenIDRe.MatchString(want) {
		if _, taken := owner[want]; !taken {
			return want
		}
	}
	for {
		id := newTokenID()
		if _, taken := owner[id]; !taken {
			return id
		}
	}
}

// checkTokenSecret returns what is wrong with a caller token secret written in a file, or "".
func checkTokenSecret(s string) string {
	if len(s) < minTokenSecret {
		return fmt.Sprintf("must be at least %d characters; leave it out to make a new one", minTokenSecret)
	}
	if len(s) > maxTokenSecret {
		return fmt.Sprintf("must be at most %d characters", maxTokenSecret)
	}
	for _, r := range s {
		if r <= ' ' || r > '~' {
			return "can only use visible ASCII characters, no spaces"
		}
	}
	return ""
}
