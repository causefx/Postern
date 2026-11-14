package main

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOIDCLogin(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var idp *httptest.Server
	var challenge, nonce string
	var email = "ada@example.com"
	idp = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(oidcDoc{
				Issuer:                idp.URL,
				AuthorizationEndpoint: idp.URL + "/authorize",
				TokenEndpoint:         idp.URL + "/token",
				JWKSURI:               idp.URL + "/jwks",
				AuthMethods:           []string{"client_secret_basic"},
			})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []oidcKey{rsaJWK("k1", &key.PublicKey)}})
		case "/token":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse form: %v", err)
			}
			user, pass, ok := r.BasicAuth()
			if !ok || user != "postern" || pass != "sekrit" {
				http.Error(w, "unauthorized", 401)
				return
			}
			if r.Form.Get("redirect_uri") != "http://admin.example/admin/oidc/callback" {
				http.Error(w, "redirect", 400)
				return
			}
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
				http.Error(w, "pkce", 400)
				return
			}
			token := signRS256(key, "k1", map[string]any{
				"iss":            idp.URL,
				"aud":            "postern",
				"sub":            "user-1",
				"nonce":          nonce,
				"email":          email,
				"email_verified": true,
				"groups":         []string{"admins"},
				"exp":            time.Now().Add(time.Hour).Unix(),
				"iat":            time.Now().Unix(),
			})
			_ = json.NewEncoder(w).Encode(map[string]string{"id_token": token})
		default:
			http.NotFound(w, r)
		}
	}))
	defer idp.Close()

	app := &App{
		sessions: newSessionStore("secret"),
		logins:   newLoginLimiter(),
		oidc: &oidcClient{
			issuer:       idp.URL,
			clientID:     "postern",
			clientSecret: "sekrit",
			scopes:       "openid email profile groups",
			emails:       map[string]bool{"ada@example.com": true},
			groups:       map[string]bool{"admins": true},
			http:         idp.Client(),
		},
	}

	loc, cookie := startOIDC(t, app)
	q := mustQuery(t, loc)
	if q.Get("code_challenge_method") != "S256" || !strings.Contains(q.Get("scope"), "groups") {
		t.Fatalf("authorize query: %s", loc)
	}
	challenge = q.Get("code_challenge")
	nonce = pendingNonce(t, app, cookie)

	res := finishOIDC(app, cookie, q.Get("state"))
	if res.Code != http.StatusFound || res.Header().Get("Location") != "/admin/" {
		t.Fatalf("callback %d %s", res.Code, res.Header().Get("Location"))
	}
	if !app.sessions.valid(sessionCookieValue(res)) {
		t.Fatal("session cookie was not issued")
	}

	email = "bob@example.com"
	loc, cookie = startOIDC(t, app)
	q = mustQuery(t, loc)
	challenge = q.Get("code_challenge")
	nonce = pendingNonce(t, app, cookie)
	res = finishOIDC(app, cookie, q.Get("state"))
	if res.Code != http.StatusFound || !strings.Contains(res.Header().Get("Location"), "error=allow") {
		t.Fatalf("denied callback %d %s", res.Code, res.Header().Get("Location"))
	}
}

func TestPasswordLoginRequiresOIDCSession(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	sessions := newSessionStore("secret")
	app := &App{
		store:     store,
		sessions:  sessions,
		logins:    newLoginLimiter(),
		adminPass: "secret",
		oidc:      &oidcClient{label: "SSO"},
		audit:     newAuditLog(filepath.Join(dir, "d.json.audit")),
	}
	body := `{"activityLimit":20,"rateLimit":120,"auditLimit":100,"passwordLogin":false}`
	password, err := sessions.create(true)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/admin/api/settings", strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: password})
	rec := httptest.NewRecorder()
	app.putSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("password session %d %s", rec.Code, rec.Body.String())
	}

	oidcSession, err := sessions.createFromOIDC(true, "")
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := sessions.refresh(oidcSession)
	if err != nil || !sessions.viaOIDC(refreshed) {
		t.Fatal("refresh dropped the oidc flag")
	}
	req = httptest.NewRequest(http.MethodPut, "/admin/api/settings", strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: sessionCookie, Value: oidcSession})
	rec = httptest.NewRecorder()
	app.putSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("oidc session %d %s", rec.Code, rec.Body.String())
	}
	if store.PasswordLogin() {
		t.Fatal("password login stayed on")
	}
	logged := app.audit.list()
	if len(logged) != 1 || logged[0].PasswordLogin == nil || *logged[0].PasswordLogin || logged[0].Rate != nil || logged[0].Activity != nil || logged[0].Audit != nil {
		t.Fatalf("audit did not record only password off: %+v", logged)
	}

	loginReq := httptest.NewRequest(http.MethodPost, "/admin/api/login", strings.NewReader(`{"password":"secret"}`))
	loginRec := httptest.NewRecorder()
	app.login(loginRec, loginReq)
	if loginRec.Code != http.StatusForbidden {
		t.Fatalf("password login %d %s", loginRec.Code, loginRec.Body.String())
	}
	page := httptest.NewRecorder()
	app.loginPage(page, httptest.NewRequest(http.MethodGet, "/admin/login", nil))
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), `"password":false`) || strings.Contains(page.Body.String(), "{{LOGIN_OPTIONS}}") {
		t.Fatalf("login page %d %s", page.Code, page.Body.String())
	}

	app.oidc = nil
	loginRec = httptest.NewRecorder()
	app.login(loginRec, httptest.NewRequest(http.MethodPost, "/admin/api/login", strings.NewReader(`{"password":"secret"}`)))
	if loginRec.Code != http.StatusOK {
		t.Fatalf("password without oidc %d %s", loginRec.Code, loginRec.Body.String())
	}
}

func TestOIDCSignatures(t *testing.T) {
	t.Run("es256", func(t *testing.T) {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		xb, yb := make([]byte, 32), make([]byte, 32)
		key.X.FillBytes(xb)
		key.Y.FillBytes(yb)
		jwk := oidcKey{Kty: "EC", Kid: "ec", Crv: "P-256", X: base64.RawURLEncoding.EncodeToString(xb), Y: base64.RawURLEncoding.EncodeToString(yb)}
		token := signES256(t, key, "ec", map[string]any{"sub": "s"})
		if _, err := verifyIDToken(token, map[string]oidcKey{"ec": jwk}); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("eddsa", func(t *testing.T) {
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		jwk := oidcKey{Kty: "OKP", Kid: "ed", Crv: "Ed25519", X: base64.RawURLEncoding.EncodeToString(pub)}
		token := signRaw("EdDSA", "ed", priv, map[string]any{"sub": "s"}, func(input []byte) []byte {
			return ed25519.Sign(priv, input)
		})
		if _, err := verifyIDToken(token, map[string]oidcKey{"ed": jwk}); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("bad signature", func(t *testing.T) {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatal(err)
		}
		token := signRS256(key, "k1", map[string]any{"sub": "s"})
		// Change the signature itself. Swapping the last characters is not enough: the final
		// base64 character of a 256-byte signature carries only 2 bits, so about 1 time in 256 the
		// "tampered" text decodes to the very same signature, and accepting it is correct.
		parts := strings.Split(token, ".")
		sig, err := base64.RawURLEncoding.DecodeString(parts[2])
		if err != nil {
			t.Fatal(err)
		}
		sig[0] ^= 0xff
		parts[2] = base64.RawURLEncoding.EncodeToString(sig)
		token = strings.Join(parts, ".")
		if _, err := verifyIDToken(token, map[string]oidcKey{"k1": rsaJWK("k1", &key.PublicKey)}); err == nil {
			t.Fatal("tampered token was accepted")
		}
	})
}

func startOIDC(t *testing.T, app *App) (string, *http.Cookie) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/admin/oidc/start?remember=0", nil)
	req.Host = "admin.example"
	res := httptest.NewRecorder()
	app.oidcStart(res, req)
	if res.Code != http.StatusFound {
		t.Fatalf("start %d", res.Code)
	}
	var cookie *http.Cookie
	for _, c := range res.Result().Cookies() {
		if c.Name == oidcCookieName {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("missing oidc cookie")
	}
	return res.Header().Get("Location"), cookie
}

func finishOIDC(app *App, cookie *http.Cookie, state string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/admin/oidc/callback?code=abc&state="+url.QueryEscape(state), nil)
	req.Host = "admin.example"
	req.AddCookie(cookie)
	res := httptest.NewRecorder()
	app.oidcCallback(res, req)
	return res
}

func mustQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query()
}

func pendingNonce(t *testing.T, app *App, cookie *http.Cookie) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/admin/oidc/callback", nil)
	req.AddCookie(cookie)
	pending, ok := readOIDCCookie(req, app.sessions.key)
	if !ok {
		t.Fatal("cookie did not verify")
	}
	return pending.Nonce
}

func sessionCookieValue(res *httptest.ResponseRecorder) string {
	for _, c := range res.Result().Cookies() {
		if c.Name == sessionCookie {
			return c.Value
		}
	}
	return ""
}

func rsaJWK(kid string, pub *rsa.PublicKey) oidcKey {
	return oidcKey{
		Kty: "RSA",
		Kid: kid,
		Alg: "RS256",
		N:   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
		E:   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
	}
}

func signRS256(key *rsa.PrivateKey, kid string, claims any) string {
	return signRaw("RS256", kid, key, claims, func(input []byte) []byte {
		sum := sha256.Sum256(input)
		sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
		if err != nil {
			panic(err)
		}
		return sig
	})
}

func signES256(t *testing.T, key *ecdsa.PrivateKey, kid string, claims any) string {
	t.Helper()
	return signRaw("ES256", kid, key, claims, func(input []byte) []byte {
		sum := sha256.Sum256(input)
		r, s, err := ecdsa.Sign(rand.Reader, key, sum[:])
		if err != nil {
			t.Fatal(err)
		}
		rb, sb := make([]byte, 32), make([]byte, 32)
		return append(r.FillBytes(rb), s.FillBytes(sb)...)
	})
}

func signRaw(alg, kid string, _ any, claims any, sign func([]byte) []byte) string {
	head, _ := json.Marshal(map[string]string{"alg": alg, "kid": kid})
	payload, _ := json.Marshal(claims)
	body := base64.RawURLEncoding.EncodeToString(head) + "." + base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(sign([]byte(body)))
}
