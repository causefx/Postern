package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	oidcCookieName = "postern_oidc"
	oidcCookieTTL  = 10 * time.Minute
	oidcSkew       = 2 * time.Minute
	oidcCacheTTL   = time.Hour
)

// oidcClient signs the admin in through an OpenID Connect provider such as Pocket ID.
// A successful login gets the same session cookie as the admin password.
type oidcClient struct {
	issuer       string
	clientID     string
	clientSecret string
	redirect     string
	label        string
	scopes       string
	emails       map[string]bool
	groups       map[string]bool
	http         *http.Client

	mu    sync.Mutex
	doc   *oidcDoc
	docAt time.Time
	keys  map[string]oidcKey
	keyAt time.Time
}

type oidcDoc struct {
	Issuer                string   `json:"issuer"`
	AuthorizationEndpoint string   `json:"authorization_endpoint"`
	TokenEndpoint         string   `json:"token_endpoint"`
	JWKSURI               string   `json:"jwks_uri"`
	AuthMethods           []string `json:"token_endpoint_auth_methods_supported"`
}

type oidcKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

type idClaims struct {
	Iss           string          `json:"iss"`
	Sub           string          `json:"sub"`
	Aud           json.RawMessage `json:"aud"`
	Exp           int64           `json:"exp"`
	Iat           int64           `json:"iat"`
	Nbf           int64           `json:"nbf"`
	Nonce         string          `json:"nonce"`
	Email         string          `json:"email"`
	EmailVerified json.RawMessage `json:"email_verified"`
	Groups        json.RawMessage `json:"groups"`
}

type oidcPending struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Remember bool   `json:"r"`
	Exp      int64  `json:"e"`
	Popup    bool   `json:"p,omitempty"`
	Back     bool   `json:"b,omitempty"`
}

func loadOIDC() *oidcClient {
	issuer := strings.TrimSpace(os.Getenv("POSTERN_OIDC_ISSUER"))
	clientID := strings.TrimSpace(os.Getenv("POSTERN_OIDC_CLIENT_ID"))
	if issuer == "" && clientID == "" {
		return nil
	}
	if issuer == "" || clientID == "" {
		log.Fatal("POSTERN_OIDC_ISSUER and POSTERN_OIDC_CLIENT_ID must both be set")
	}
	if _, err := oidcDiscoveryURL(issuer); err != nil {
		log.Fatalf("POSTERN_OIDC_ISSUER: %v", err)
	}
	label := strings.TrimSpace(os.Getenv("POSTERN_OIDC_LABEL"))
	if label == "" {
		label = "Sign in with SSO"
	}
	scopes := strings.TrimSpace(os.Getenv("POSTERN_OIDC_SCOPES"))
	if scopes == "" {
		scopes = "openid email profile groups"
	}
	c := &oidcClient{
		issuer:       issuer,
		clientID:     clientID,
		clientSecret: os.Getenv("POSTERN_OIDC_CLIENT_SECRET"),
		redirect:     strings.TrimSpace(os.Getenv("POSTERN_OIDC_REDIRECT")),
		label:        label,
		scopes:       scopes,
		emails:       splitSet(os.Getenv("POSTERN_OIDC_EMAIL"), true),
		groups:       splitSet(os.Getenv("POSTERN_OIDC_GROUP"), false),
		http:         &http.Client{Timeout: 10 * time.Second},
	}
	where := "the admin host + /admin/oidc/callback"
	if c.redirect != "" {
		where = c.redirect
	}
	log.Printf("oidc enabled (%s); register this callback in the provider: %s", label, where)
	return c
}

func splitSet(raw string, lower bool) map[string]bool {
	out := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if lower {
			part = strings.ToLower(part)
		}
		out[part] = true
	}
	return out
}

func oidcDiscoveryURL(issuer string) (string, error) {
	u, err := url.Parse(issuer)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return "", errors.New("must be an http(s) URL")
	}
	path := strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(path, "/.well-known/openid-configuration") {
		u.Path = path + "/.well-known/openid-configuration"
	}
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func (a *App) loginOptions(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"oidc": a.oidc != nil, "password": a.passwordAllowed()}
	if a.oidc != nil {
		out["label"] = a.oidc.label
	}
	writeJSON(w, 200, out)
}

func (a *App) oidcStart(w http.ResponseWriter, r *http.Request) {
	if a.oidc == nil {
		http.NotFound(w, r)
		return
	}
	if a.logins.blocked(clientIP(r)) {
		oidcFail(w, r, "locked")
		return
	}
	doc, err := a.oidc.discovery()
	if err != nil {
		log.Printf("oidc discovery: %v", err)
		oidcFail(w, r, "failed")
		return
	}
	pending := oidcPending{
		State:    randToken(),
		Nonce:    randToken(),
		Verifier: randToken(),
		Remember: r.URL.Query().Get("remember") != "0",
		Exp:      time.Now().Add(oidcCookieTTL).Unix(),
		Popup:    r.URL.Query().Get("popup") == "1",
		Back:     r.URL.Query().Get("return") == "settings",
	}
	redirect := a.oidc.callbackURL(r)
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", a.oidc.clientID)
	q.Set("redirect_uri", redirect)
	q.Set("scope", a.oidc.scopes)
	q.Set("state", pending.State)
	q.Set("nonce", pending.Nonce)
	q.Set("code_challenge", pkceChallenge(pending.Verifier))
	q.Set("code_challenge_method", "S256")
	setOIDCCookie(w, r, a.sessions.key, pending)
	http.Redirect(w, r, doc.AuthorizationEndpoint+"?"+q.Encode(), http.StatusFound)
}

func (a *App) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if a.oidc == nil {
		http.NotFound(w, r)
		return
	}
	clearOIDCCookie(w, r)
	if a.logins.blocked(clientIP(r)) {
		oidcFail(w, r, "locked")
		return
	}
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		if len(errCode) > 80 {
			errCode = errCode[:80]
		}
		log.Printf("oidc provider returned %s", errCode)
		if errCode == "access_denied" {
			oidcFail(w, r, "denied")
			return
		}
		oidcFail(w, r, "failed")
		return
	}
	pending, ok := readOIDCCookie(r, a.sessions.key)
	if !ok || subtle.ConstantTimeCompare([]byte(pending.State), []byte(r.URL.Query().Get("state"))) != 1 {
		a.logins.failure(clientIP(r))
		oidcFail(w, r, "state")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		oidcFail(w, r, "failed")
		return
	}
	raw, err := a.oidc.exchange(code, pending.Verifier, a.oidc.callbackURL(r))
	if err != nil {
		log.Printf("oidc token: %v", err)
		a.logins.failure(clientIP(r))
		oidcFail(w, r, "failed")
		return
	}
	claims, err := a.oidc.verify(raw, pending.Nonce)
	if err != nil {
		log.Printf("oidc id token: %v", err)
		a.logins.failure(clientIP(r))
		oidcFail(w, r, "failed")
		return
	}
	if !a.oidc.allowed(claims) {
		log.Printf("oidc: account %s is not allowed", claims.Sub)
		a.logins.failure(clientIP(r))
		oidcFail(w, r, "allow")
		return
	}
	id, err := a.sessions.createFromOIDC(pending.Remember, claims.Email)
	if err != nil {
		oidcFail(w, r, "failed")
		return
	}
	a.logins.success(clientIP(r))
	setSessionCookie(w, r, id, pending.Remember)
	dest := "/admin/"
	if pending.Popup {
		dest = "/admin/oidc/done"
	} else if pending.Back {
		dest = "/admin/?settings=1"
	}
	http.Redirect(w, r, dest, http.StatusFound)
}

func (a *App) oidcDone(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(`<!doctype html>
<meta charset="utf-8">
<title>Signed in · Postern</title>
<p>Signed in. You can close this window.</p>
<script>
if (window.opener) {
  window.opener.postMessage({ type: "postern-oidc" }, location.origin);
  window.close();
} else {
  location.replace("/admin/?settings=1");
}
</script>
`))
}

func oidcFail(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/admin/login?error="+url.QueryEscape(code), http.StatusFound)
}

func (c *oidcClient) callbackURL(r *http.Request) string {
	if c.redirect != "" {
		return c.redirect
	}
	scheme := "http"
	if isHTTPS(r) {
		scheme = "https"
	}
	return scheme + "://" + r.Host + "/admin/oidc/callback"
}

func (c *oidcClient) discovery() (*oidcDoc, error) {
	c.mu.Lock()
	if c.doc != nil && time.Since(c.docAt) < oidcCacheTTL {
		doc := c.doc
		c.mu.Unlock()
		return doc, nil
	}
	c.mu.Unlock()

	rawURL, err := oidcDiscoveryURL(c.issuer)
	if err != nil {
		return nil, err
	}
	body, err := c.getJSON(rawURL)
	if err != nil {
		return nil, err
	}
	var doc oidcDoc
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	if doc.AuthorizationEndpoint == "" || doc.TokenEndpoint == "" || doc.JWKSURI == "" || doc.Issuer == "" {
		return nil, errors.New("discovery document is missing endpoints")
	}
	base, err := configuredIssuer(c.issuer)
	if err != nil || !sameIssuer(doc.Issuer, base) {
		return nil, fmt.Errorf("discovery issuer %s does not match %s", doc.Issuer, c.issuer)
	}
	c.mu.Lock()
	c.doc = &doc
	c.docAt = time.Now()
	c.mu.Unlock()
	return &doc, nil
}

func configuredIssuer(issuer string) (string, error) {
	u, err := url.Parse(issuer)
	if err != nil {
		return "", err
	}
	u.Path = strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/.well-known/openid-configuration")
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/"), nil
}

func sameIssuer(a, b string) bool {
	return strings.TrimRight(a, "/") == strings.TrimRight(b, "/")
}

func (c *oidcClient) exchange(code, verifier, redirect string) (string, error) {
	doc, err := c.discovery()
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirect)
	form.Set("client_id", c.clientID)
	form.Set("code_verifier", verifier)
	req, err := http.NewRequest(http.MethodPost, doc.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if c.clientSecret != "" && !prefersPost(doc.AuthMethods) {
		req.SetBasicAuth(url.QueryEscape(c.clientID), url.QueryEscape(c.clientSecret))
	} else if c.clientSecret != "" {
		form.Set("client_secret", c.clientSecret)
		req.Body = io.NopCloser(strings.NewReader(form.Encode()))
		req.ContentLength = int64(len(form.Encode()))
	}
	res, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", err
	}
	var tok struct {
		IDToken string `json:"id_token"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", err
	}
	if res.StatusCode != 200 || tok.IDToken == "" {
		if tok.Error == "" {
			tok.Error = res.Status
		}
		return "", errors.New(tok.Error)
	}
	return tok.IDToken, nil
}

func prefersPost(methods []string) bool {
	post, basic := false, false
	for _, m := range methods {
		switch m {
		case "client_secret_post":
			post = true
		case "client_secret_basic":
			basic = true
		}
	}
	return post && !basic
}

func (c *oidcClient) verify(token, nonce string) (idClaims, error) {
	var none idClaims
	keys, err := c.jwks()
	if err != nil {
		return none, err
	}
	claims, err := verifyIDToken(token, keys)
	if err != nil {
		// A rotated key may not be in the cache yet.
		c.mu.Lock()
		c.keyAt = time.Time{}
		c.mu.Unlock()
		keys, err = c.jwks()
		if err != nil {
			return none, err
		}
		claims, err = verifyIDToken(token, keys)
		if err != nil {
			return none, err
		}
	}
	doc, err := c.discovery()
	if err != nil {
		return none, err
	}
	if !sameIssuer(claims.Iss, doc.Issuer) {
		return none, errors.New("issuer mismatch")
	}
	if !audOK(claims.Aud, c.clientID) {
		return none, errors.New("audience mismatch")
	}
	if subtle.ConstantTimeCompare([]byte(claims.Nonce), []byte(nonce)) != 1 {
		return none, errors.New("nonce mismatch")
	}
	now := time.Now()
	if claims.Exp == 0 || now.After(time.Unix(claims.Exp, 0).Add(oidcSkew)) {
		return none, errors.New("token expired")
	}
	if claims.Iat > 0 && time.Unix(claims.Iat, 0).After(now.Add(oidcSkew)) {
		return none, errors.New("token issued in the future")
	}
	if claims.Nbf > 0 && now.Add(oidcSkew).Before(time.Unix(claims.Nbf, 0)) {
		return none, errors.New("token not valid yet")
	}
	return claims, nil
}

func (c *oidcClient) allowed(claims idClaims) bool {
	if len(c.emails) > 0 {
		email := strings.ToLower(strings.TrimSpace(claims.Email))
		if !c.emails[email] || emailVerifiedFalse(claims.EmailVerified) {
			return false
		}
	}
	if len(c.groups) == 0 {
		return true
	}
	for _, g := range groupList(claims.Groups) {
		if c.groups[g] {
			return true
		}
	}
	return false
}

func emailVerifiedFalse(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return !b
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.EqualFold(s, "false")
	}
	return false
}

func groupList(raw json.RawMessage) []string {
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		return list
	}
	var one string
	if json.Unmarshal(raw, &one) == nil && one != "" {
		return []string{one}
	}
	return nil
}

func audOK(raw json.RawMessage, clientID string) bool {
	var one string
	if json.Unmarshal(raw, &one) == nil {
		return one == clientID
	}
	var many []string
	if json.Unmarshal(raw, &many) == nil {
		for _, item := range many {
			if item == clientID {
				return true
			}
		}
	}
	return false
}

func (c *oidcClient) jwks() (map[string]oidcKey, error) {
	c.mu.Lock()
	if c.keys != nil && time.Since(c.keyAt) < oidcCacheTTL {
		keys := c.keys
		c.mu.Unlock()
		return keys, nil
	}
	c.mu.Unlock()
	doc, err := c.discovery()
	if err != nil {
		return nil, err
	}
	body, err := c.getJSON(doc.JWKSURI)
	if err != nil {
		return nil, err
	}
	var set struct {
		Keys []oidcKey `json:"keys"`
	}
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, err
	}
	keys := map[string]oidcKey{}
	for _, k := range set.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		if k.Kid == "" {
			continue
		}
		keys[k.Kid] = k
	}
	if len(keys) == 0 {
		return nil, errors.New("no signing keys")
	}
	c.mu.Lock()
	c.keys = keys
	c.keyAt = time.Now()
	c.mu.Unlock()
	return keys, nil
}

func (c *oidcClient) getJSON(rawURL string) ([]byte, error) {
	res, err := c.http.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("%s returned %s", rawURL, res.Status)
	}
	return body, nil
}

func verifyIDToken(token string, keys map[string]oidcKey) (idClaims, error) {
	var claims idClaims
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims, errors.New("malformed token")
	}
	headRaw, err := decodeB64(parts[0])
	if err != nil {
		return claims, err
	}
	var head struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headRaw, &head); err != nil {
		return claims, err
	}
	key, ok := keys[head.Kid]
	if !ok {
		return claims, errors.New("unknown signing key")
	}
	sig, err := decodeB64(parts[2])
	if err != nil {
		return claims, err
	}
	input := []byte(parts[0] + "." + parts[1])
	if err := verifySignature(head.Alg, key, input, sig); err != nil {
		return claims, err
	}
	payload, err := decodeB64(parts[1])
	if err != nil {
		return claims, err
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return claims, err
	}
	return claims, nil
}

func verifySignature(alg string, key oidcKey, input, sig []byte) error {
	switch alg {
	case "RS256":
		return verifyRS256(key, input, sig)
	case "ES256":
		return verifyES256(key, input, sig)
	case "EdDSA":
		return verifyEdDSA(key, input, sig)
	default:
		return fmt.Errorf("unsupported alg %s", alg)
	}
}

func verifyRS256(key oidcKey, input, sig []byte) error {
	if key.Kty != "" && key.Kty != "RSA" {
		return errors.New("key type is not RSA")
	}
	n, err := decodeB64(key.N)
	if err != nil {
		return err
	}
	eBytes, err := decodeB64(key.E)
	if err != nil {
		return err
	}
	e := 0
	for _, b := range eBytes {
		e = e<<8 | int(b)
	}
	if e < 2 {
		return errors.New("bad exponent")
	}
	pub := &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: e}
	sum := sha256.Sum256(input)
	return rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig)
}

func verifyES256(key oidcKey, input, sig []byte) error {
	if key.Crv != "" && key.Crv != "P-256" {
		return errors.New("unsupported curve")
	}
	if len(sig) != 64 {
		return errors.New("bad signature length")
	}
	x, err := decodeB64(key.X)
	if err != nil {
		return err
	}
	y, err := decodeB64(key.Y)
	if err != nil {
		return err
	}
	pub := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
	sum := sha256.Sum256(input)
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(pub, sum[:], r, s) {
		return errors.New("bad signature")
	}
	return nil
}

func verifyEdDSA(key oidcKey, input, sig []byte) error {
	if key.Crv != "" && key.Crv != "Ed25519" {
		return errors.New("unsupported curve")
	}
	raw, err := decodeB64(key.X)
	if err != nil {
		return err
	}
	if len(raw) != ed25519.PublicKeySize || !ed25519.Verify(ed25519.PublicKey(raw), input, sig) {
		return errors.New("bad signature")
	}
	return nil
}

func decodeB64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
}

func randToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func setOIDCCookie(w http.ResponseWriter, r *http.Request, key []byte, pending oidcPending) {
	raw, _ := json.Marshal(pending)
	mac := hmac.New(sha256.New, key)
	mac.Write(raw)
	value := base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	http.SetCookie(w, &http.Cookie{
		Name:     oidcCookieName,
		Value:    value,
		Path:     "/admin/oidc",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
		MaxAge:   int(oidcCookieTTL.Seconds()),
	})
}

func readOIDCCookie(r *http.Request, key []byte) (oidcPending, bool) {
	var pending oidcPending
	c, err := r.Cookie(oidcCookieName)
	if err != nil {
		return pending, false
	}
	payload, mac, ok := strings.Cut(c.Value, ".")
	if !ok {
		return pending, false
	}
	raw, err := decodeB64(payload)
	if err != nil {
		return pending, false
	}
	got, err := decodeB64(mac)
	if err != nil || len(got) != sha256.Size {
		return pending, false
	}
	expect := hmac.New(sha256.New, key)
	expect.Write(raw)
	if !hmac.Equal(got, expect.Sum(nil)) {
		return pending, false
	}
	if json.Unmarshal(raw, &pending) != nil || time.Now().Unix() > pending.Exp {
		return pending, false
	}
	if pending.State == "" || pending.Nonce == "" || pending.Verifier == "" {
		return pending, false
	}
	return pending, true
}

func clearOIDCCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     oidcCookieName,
		Value:    "",
		Path:     "/admin/oidc",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   isHTTPS(r),
		MaxAge:   -1,
	})
}
