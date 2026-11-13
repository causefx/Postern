package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func init() {
	// Keep the suite fast; TestDefaultIterationsAreStrong pins the real value.
	kdfIterations = 1000
}

const testPass = "correct horse battery staple"

func TestDefaultIterationsAreStrong(t *testing.T) {
	if defaultKDFIterations < 600_000 {
		t.Fatalf("PBKDF2 iterations fell to %d", defaultKDFIterations)
	}
}

// A file written by an earlier build must keep opening. If this fails, the
// format changed in a way that would lock people out of their data.
func TestKnownEnvelopeStillDecodes(t *testing.T) {
	const fixed = `{
  "postern": "enc",
  "v": 1,
  "kdf": "pbkdf2-sha256",
  "iter": 1000,
  "salt": "MDEyMzQ1Njc4OWFiY2RlZg==",
  "nonce": "9jtncQsEGZ1P0jho",
  "ct": "ZuaZzfjmi4QHAYWXJBEWQF3veRyo84o9Dh3qXbM7oQ=="
}
`
	plain, encrypted, err := newFileCodec(testPass).Decode([]byte(fixed))
	if err != nil || !encrypted || string(plain) != `{"services":[]}` {
		t.Fatalf("known vector: %q %v %v", plain, encrypted, err)
	}
}

func TestEnvelopeRoundTripAndFreshNonce(t *testing.T) {
	c := newFileCodec(testPass)
	plain := []byte(`{"services":[{"name":"one","token":"SECRET-TOKEN-1"}]}`)
	a, err := c.Encode(plain)
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.Encode(plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(a, []byte("SECRET-TOKEN-1")) || bytes.Contains(a, []byte(`"services"`)) {
		t.Fatalf("plaintext leaked into the envelope:\n%s", a)
	}
	if !isEncrypted(a) {
		t.Fatal("not recognised as encrypted")
	}
	var ea, eb envelope
	if json.Unmarshal(a, &ea) != nil || json.Unmarshal(b, &eb) != nil {
		t.Fatal("envelope is not JSON")
	}
	if ea.Nonce == eb.Nonce || ea.CT == eb.CT {
		t.Fatal("two saves reused a nonce")
	}
	if ea.Salt != eb.Salt {
		t.Fatal("the salt must stay put within one process")
	}
	got, encrypted, err := newFileCodec(testPass).Decode(b)
	if err != nil || !encrypted || !bytes.Equal(got, plain) {
		t.Fatalf("round trip: %q %v %v", got, encrypted, err)
	}
}

func TestPlaintextPassesThroughDecode(t *testing.T) {
	plain := []byte(`{"services":[]}`)
	for _, c := range []*fileCodec{nil, newFileCodec(testPass)} {
		got, encrypted, err := c.Decode(plain)
		if err != nil || encrypted || !bytes.Equal(got, plain) {
			t.Fatalf("plain file changed: %q %v %v", got, encrypted, err)
		}
	}
	// Not JSON at all is still "not encrypted"; decodeStore reports it later.
	if isEncrypted([]byte("not json")) || isEncrypted(nil) {
		t.Fatal("garbage was taken for an envelope")
	}
}

func TestWrongKeyAndMissingKey(t *testing.T) {
	sealed, err := newFileCodec(testPass).Encode([]byte(`{"services":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := newFileCodec("a different key").Decode(sealed); !errors.Is(err, errWrongKey) {
		t.Fatalf("wrong key: %v", err)
	}
	var none *fileCodec
	if _, encrypted, err := none.Decode(sealed); !errors.Is(err, errKeyRequired) || !encrypted {
		t.Fatalf("no key: %v", err)
	}
}

// mutate rewrites one field of an envelope and returns the new file.
func mutate(t *testing.T, sealed []byte, edit func(*envelope)) []byte {
	t.Helper()
	var env envelope
	if err := json.Unmarshal(sealed, &env); err != nil {
		t.Fatal(err)
	}
	edit(&env)
	out, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestTamperingIsDetected(t *testing.T) {
	sealed, err := newFileCodec(testPass).Encode([]byte(`{"services":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	flip := func(s string) string {
		raw, _ := base64.StdEncoding.DecodeString(s)
		raw[len(raw)-1] ^= 0x01
		return base64.StdEncoding.EncodeToString(raw)
	}
	cases := map[string]func(*envelope){
		"ciphertext": func(e *envelope) { e.CT = flip(e.CT) },
		"nonce":      func(e *envelope) { e.Nonce = flip(e.Nonce) },
		"salt":       func(e *envelope) { e.Salt = flip(e.Salt) },
		"iterations": func(e *envelope) { e.Iter++ },
	}
	for name, edit := range cases {
		if _, _, err := newFileCodec(testPass).Decode(mutate(t, sealed, edit)); !errors.Is(err, errWrongKey) {
			t.Errorf("%s: tampering was not caught: %v", name, err)
		}
	}
}

func TestDamagedHeadersAreRejectedNotTried(t *testing.T) {
	sealed, _ := newFileCodec(testPass).Encode([]byte(`{}`))
	cases := map[string]func(*envelope){
		"version":    func(e *envelope) { e.V = 2 },
		"kdf":        func(e *envelope) { e.KDF = "md5" },
		"zero iter":  func(e *envelope) { e.Iter = 0 },
		"huge iter":  func(e *envelope) { e.Iter = maxKDFIterations + 1 },
		"short salt": func(e *envelope) { e.Salt = base64.StdEncoding.EncodeToString([]byte("short")) },
		"bad nonce":  func(e *envelope) { e.Nonce = "!!!" },
		"short ct":   func(e *envelope) { e.CT = base64.StdEncoding.EncodeToString([]byte("tiny")) },
	}
	for name, edit := range cases {
		_, encrypted, err := newFileCodec(testPass).Decode(mutate(t, sealed, edit))
		if err == nil || !encrypted || errors.Is(err, errWrongKey) || !strings.Contains(err.Error(), "damaged") {
			t.Errorf("%s: want a 'damaged' error, got %v", name, err)
		}
	}
}

func TestKeyFromEnv(t *testing.T) {
	t.Setenv("T_KEY", "")
	t.Setenv("T_KEY_FILE", "")
	if _, ok, err := keyFromEnv("T_KEY"); ok || err != nil {
		t.Fatalf("nothing set: %v %v", ok, err)
	}
	t.Setenv("T_KEY", "   ")
	if _, ok, _ := keyFromEnv("T_KEY"); ok {
		t.Fatal("a blank key must count as unset")
	}

	t.Setenv("T_KEY", "from-env")
	if pass, ok, err := keyFromEnv("T_KEY"); !ok || err != nil || pass != "from-env" {
		t.Fatalf("env key: %q %v %v", pass, ok, err)
	}

	file := filepath.Join(t.TempDir(), "key")
	writeFile(t, file, "from-file\r\n")
	t.Setenv("T_KEY_FILE", file)
	if _, _, err := keyFromEnv("T_KEY"); err == nil || !strings.Contains(err.Error(), "only one") {
		t.Fatalf("both set must be an error: %v", err)
	}
	t.Setenv("T_KEY", "")
	if pass, ok, err := keyFromEnv("T_KEY"); !ok || err != nil || pass != "from-file" {
		t.Fatalf("file key (newline trimmed): %q %v %v", pass, ok, err)
	}

	writeFile(t, file, "\n")
	if _, _, err := keyFromEnv("T_KEY"); err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("empty key file: %v", err)
	}
	t.Setenv("T_KEY_FILE", filepath.Join(t.TempDir(), "missing"))
	if _, _, err := keyFromEnv("T_KEY"); err == nil {
		t.Fatal("missing key file must be an error")
	}
}

func openEncrypted(t *testing.T, path string) *Store {
	t.Helper()
	s, err := openStore(path, newFileCodec(testPass))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNewStoreWithKeyIsEncryptedFromTheFirstSave(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store := openEncrypted(t, data)
	if !store.Encrypted() {
		t.Fatal("Encrypted() is false with a key")
	}
	if _, err := os.Stat(data); !os.IsNotExist(err) {
		t.Fatal("nothing should be written before there is a service")
	}
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true, Tokens: []CallerToken{{Name: "default", Secret: "SECRET-TOKEN-1"}}}); err != nil {
		t.Fatal(err)
	}
	raw := readFile(t, data)
	if !isEncrypted([]byte(raw)) || strings.Contains(raw, "SECRET-TOKEN-1") || strings.Contains(raw, `"one"`) {
		t.Fatalf("data file is not sealed:\n%s", raw)
	}
	if runtime.GOOS != "windows" {
		if st, err := os.Stat(data); err != nil || st.Mode().Perm() != 0o600 {
			t.Fatalf("mode %v %v", st.Mode(), err)
		}
	}
	if _, err := os.Stat(data + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temp file left behind")
	}

	again := openEncrypted(t, data)
	svc, ok := again.Get("one")
	if !ok || svc.Tokens[0].Secret != "SECRET-TOKEN-1" {
		t.Fatalf("reload lost the service: %+v %v", svc, ok)
	}
	// Settings stay readable without any key.
	var settings Settings
	if err := json.Unmarshal([]byte(readFile(t, filepath.Join(dir, "postern-settings.json"))), &settings); err != nil || settings.RateLimit != defaultRateLimit {
		t.Fatalf("settings file must stay plain JSON: %v %+v", err, settings)
	}
}

func TestSaltIsReusedAndNonceIsNotAcrossSaves(t *testing.T) {
	data := filepath.Join(t.TempDir(), "postern-data.json")
	store := openEncrypted(t, data)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var first envelope
	_ = json.Unmarshal([]byte(readFile(t, data)), &first)
	if _, err := store.SetEnabled("one", false); err != nil {
		t.Fatal(err)
	}
	var second envelope
	_ = json.Unmarshal([]byte(readFile(t, data)), &second)
	if first.Salt != second.Salt || first.Nonce == second.Nonce {
		t.Fatalf("salt/nonce across saves: %q/%q vs %q/%q", first.Salt, second.Salt, first.Nonce, second.Nonce)
	}
}

func TestPlainFileIsEncryptedInPlaceAtStartup(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	writeFile(t, data, `{"services":[{"name":"one","url":"http://127.0.0.1:9","token":"SECRET-TOKEN-1","tokens":[{"id":"id1","name":"default","secret":"SECRET-TOKEN-1"}],"enabled":true,"auth":{"header":{"name":"X-Api-Key","secret":"UPSTREAM-SECRET-9"}}}]}`)

	store := openEncrypted(t, data)
	raw := readFile(t, data)
	if !isEncrypted([]byte(raw)) || strings.Contains(raw, "SECRET") {
		t.Fatalf("file was not encrypted at start-up:\n%s", raw)
	}
	if svc, ok := store.Get("one"); !ok || svc.Tokens[0].Secret != "SECRET-TOKEN-1" {
		t.Fatal("service lost while encrypting")
	}
	if _, err := os.Stat(data + ".bak"); err == nil {
		t.Fatal("a plaintext backup defeats the point of encrypting")
	}
	// The next start, with the key, reads it straight back.
	if again := openEncrypted(t, data); len(again.List()) != 1 {
		t.Fatal("encrypted file did not reload")
	}
}

func TestEncryptedFileIsNeverReplacedWhenItCannotBeRead(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store := openEncrypted(t, data)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	before := readFile(t, data)
	_ = os.Remove(filepath.Join(dir, "postern-settings.json"))

	if _, err := openStore(data, nil); !errors.Is(err, errKeyRequired) {
		t.Fatalf("no key: %v", err)
	}
	if _, err := openStore(data, newFileCodec("wrong")); !errors.Is(err, errWrongKey) {
		t.Fatalf("wrong key: %v", err)
	}
	if readFile(t, data) != before {
		t.Fatal("a failed start rewrote the encrypted file")
	}
	if _, err := os.Stat(filepath.Join(dir, "postern-settings.json")); !os.IsNotExist(err) {
		t.Fatal("a failed start must not write anything, settings included")
	}
}

func TestVerifySavedCatchesABadFile(t *testing.T) {
	dir := t.TempDir()
	want := []byte(`{"services":[]}`)
	c := newFileCodec(testPass)
	good := filepath.Join(dir, "good")
	sealed, _ := c.Encode(want)
	writeFile(t, good, string(sealed))
	if err := verifySaved(good, c, want); err != nil {
		t.Fatalf("a good file failed: %v", err)
	}

	for name, body := range map[string]string{
		"other key":  func() string { b, _ := newFileCodec("other").Encode(want); return string(b) }(),
		"other data": func() string { b, _ := c.Encode([]byte(`{"services":[1]}`)); return string(b) }(),
		"plaintext":  string(want),
		"truncated":  string(sealed[:len(sealed)/2]),
	} {
		p := filepath.Join(dir, strings.ReplaceAll(name, " ", "-"))
		writeFile(t, p, body)
		if err := verifySaved(p, c, want); err == nil {
			t.Errorf("%s: a bad file passed verification", name)
		}
	}
	if err := verifySaved(filepath.Join(dir, "missing"), c, want); err == nil {
		t.Error("a missing file passed verification")
	}
}

func TestCheckHandlesEncryptedFiles(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store := openEncrypted(t, data)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}

	t.Setenv("POSTERN_KEY", "")
	t.Setenv("POSTERN_KEY_FILE", "")
	if problems, err := CheckFile(data); !errors.Is(err, errContentsNotChecked) || len(problems) != 0 {
		t.Fatalf("no key: %v %v", problems, err)
	}

	t.Setenv("POSTERN_KEY", testPass)
	if problems, err := CheckFile(data); err != nil || len(problems) != 0 {
		t.Fatalf("with key: %v %v", problems, err)
	}
	t.Setenv("POSTERN_KEY", "wrong")
	if _, err := CheckFile(data); !errors.Is(err, errWrongKey) {
		t.Fatalf("wrong key: %v", err)
	}

	// With the key, the contents are really checked.
	t.Setenv("POSTERN_KEY", testPass)
	bad, _ := newFileCodec(testPass).Encode([]byte(`{"services":[{"name":"x","url":"not a url","token":"t","tokens":[{"id":"i","name":"default","secret":"t"}],"enabled":true}]}`))
	badPath := filepath.Join(t.TempDir(), "postern-data.json")
	writeFile(t, badPath, string(bad))
	if problems, err := CheckFile(badPath); err != nil || len(problems) == 0 {
		t.Fatalf("bad contents went unnoticed: %v %v", problems, err)
	}

	// A damaged envelope is reported even without a key.
	t.Setenv("POSTERN_KEY", "")
	damaged := mutate(t, bad, func(e *envelope) { e.Salt = "x" })
	damagedPath := filepath.Join(t.TempDir(), "postern-data.json")
	writeFile(t, damagedPath, string(damaged))
	if problems, err := CheckFile(damagedPath); err != nil || len(problems) != 1 || !strings.Contains(problems[0], "damaged") {
		t.Fatalf("damaged envelope: %v %v", problems, err)
	}
}

func TestDecryptAndRekey(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store := openEncrypted(t, data)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true, Tokens: []CallerToken{{Name: "default", Secret: "SECRET-TOKEN-1"}}}); err != nil {
		t.Fatal(err)
	}
	oldC, newC := newFileCodec(testPass), newFileCodec("a brand new passphrase")
	before := readFile(t, data)
	var beforeEnv envelope
	_ = json.Unmarshal([]byte(before), &beforeEnv)

	for name, tc := range map[string]struct{ old, new *fileCodec }{
		"no current key": {nil, newC},
		"no new key":     {oldC, nil},
		"same key":       {oldC, newFileCodec(testPass)},
		"wrong current":  {newFileCodec("nope"), newC},
	} {
		if err := rekeyFile(data, tc.old, tc.new); err == nil {
			t.Errorf("%s: expected an error", name)
		}
		if readFile(t, data) != before {
			t.Fatalf("%s: a refused rekey changed the file", name)
		}
	}

	if err := rekeyFile(data, oldC, newC); err != nil {
		t.Fatal(err)
	}
	var afterEnv envelope
	_ = json.Unmarshal([]byte(readFile(t, data)), &afterEnv)
	if afterEnv.Salt == beforeEnv.Salt {
		t.Fatal("rekey must use a new salt")
	}
	if _, err := openStore(data, newFileCodec(testPass)); !errors.Is(err, errWrongKey) {
		t.Fatalf("old key still works after rekey: %v", err)
	}
	if s, err := openStore(data, newFileCodec("a brand new passphrase")); err != nil || len(s.List()) != 1 {
		t.Fatalf("new key: %v", err)
	}

	if err := decryptFile(data, nil); err == nil {
		t.Fatal("decrypt without a key must fail")
	}
	if err := decryptFile(data, newFileCodec("a brand new passphrase")); err != nil {
		t.Fatal(err)
	}
	raw := readFile(t, data)
	if isEncrypted([]byte(raw)) || !strings.Contains(raw, "SECRET-TOKEN-1") {
		t.Fatalf("decrypt did not leave plain JSON:\n%s", raw)
	}
	if err := decryptFile(data, newFileCodec("a brand new passphrase")); err == nil || !strings.Contains(err.Error(), "not encrypted") {
		t.Fatalf("decrypting a plain file: %v", err)
	}
	if err := rekeyFile(data, oldC, newC); err == nil || !strings.Contains(err.Error(), "not encrypted") {
		t.Fatalf("rekeying a plain file: %v", err)
	}
	if s, err := openStore(data, nil); err != nil || len(s.List()) != 1 {
		t.Fatalf("plain file after decrypt: %v", err)
	}
}

// The files that stay unencrypted must never hold a secret, with or without
// encryption. This drives real traffic and then searches every file.
func TestNothingSecretLandsInThePlainFiles(t *testing.T) {
	const upstreamSecret, tokenSecret = "UPSTREAM-SECRET-XYZ-123", "TOKEN-SECRET-ABC-456"
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	defer up.Close()

	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store := openEncrypted(t, data)
	if _, err := store.Create(Service{
		Name: "one", URL: up.URL, Enabled: true,
		Auth:   UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: upstreamSecret}, Query: &QueryAuth{Name: "apikey", Secret: upstreamSecret}},
		Tokens: []CallerToken{{Name: "phone", Secret: tokenSecret}},
	}); err != nil {
		t.Fatal(err)
	}
	app := &App{
		store:    store,
		activity: openActivityLog(data+".activity", store.ActivityLimit()),
		usage:    openTokenUsage(data + ".usage"),
		audit:    newAuditLog(data + ".audit"),
	}
	send := func(target string, mod func(*http.Request)) {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req.SetPathValue("name", "one")
		req.SetPathValue("rest", "x")
		mod(req)
		app.proxy(httptest.NewRecorder(), req)
	}
	send("/p/one/x", func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+tokenSecret) })
	send("/p/one/x?token="+tokenSecret, func(*http.Request) {})
	send("/p/one/x?apikey="+upstreamSecret, func(*http.Request) {})
	send("/p/one/x", func(r *http.Request) { r.Header.Set("Authorization", "Bearer wrong-"+tokenSecret) })
	app.record(auditEvent{Action: "rotate", Service: "one", Token: "phone"})
	app.record(auditEvent{Action: "update", Service: "one", URL: up.URL})
	app.usage.flush()

	files := []string{data + ".activity", data + ".audit", data + ".usage", filepath.Join(dir, "postern-settings.json"), data}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		for _, secret := range []string{upstreamSecret, tokenSecret} {
			if strings.Contains(string(raw), secret) {
				t.Errorf("%s contains a secret (%s)", filepath.Base(f), secret)
			}
		}
	}
	if raw := readFile(t, data+".activity"); !strings.Contains(raw, "REDACTED") {
		t.Fatalf("expected redacted query values in the activity log:\n%s", raw)
	}
}

func TestMetaAndSettingsReportEncryption(t *testing.T) {
	data := filepath.Join(t.TempDir(), "postern-data.json")
	for _, withKey := range []bool{false, true} {
		var codec *fileCodec
		if withKey {
			codec = newFileCodec(testPass)
		}
		store, err := openStore(filepath.Join(filepath.Dir(data), map[bool]string{false: "plain", true: "enc"}[withKey], "postern-data.json"), codec)
		if err != nil {
			t.Fatal(err)
		}
		app := &App{store: store, sessions: newSessionStore("pw")}

		rec := httptest.NewRecorder()
		app.meta(rec, httptest.NewRequest(http.MethodGet, "/admin/api/meta", nil))
		var meta map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &meta); err != nil || meta["encrypted"] != withKey {
			t.Fatalf("meta encrypted = %v, want %v (%v)", meta["encrypted"], withKey, err)
		}
		rec = httptest.NewRecorder()
		app.getSettings(rec, httptest.NewRequest(http.MethodGet, "/admin/api/settings", nil))
		var settings map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil || settings["encrypted"] != withKey {
			t.Fatalf("settings encrypted = %v, want %v (%v)", settings["encrypted"], withKey, err)
		}
	}
}

func TestConcurrentSavesStayDecryptable(t *testing.T) {
	data := filepath.Join(t.TempDir(), "postern-data.json")
	store := openEncrypted(t, data)
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func(i int) {
			var err error
			for j := 0; j < 10 && err == nil; j++ {
				_, err = store.SetEnabled("one", (i+j)%2 == 0)
			}
			done <- err
		}(i)
	}
	deadline := time.After(20 * time.Second)
	for i := 0; i < 8; i++ {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-deadline:
			t.Fatal("timed out")
		}
	}
	if again := openEncrypted(t, data); len(again.List()) != 1 {
		t.Fatal("file unreadable after concurrent saves")
	}
}
