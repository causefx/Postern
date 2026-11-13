package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
)

// The data file holds upstream credentials and caller tokens. When a key is
// configured it is stored as one JSON envelope, AES-256-GCM sealed with a key
// derived from the passphrase:
//
//	{"postern":"enc","v":1,"kdf":"pbkdf2-sha256","iter":600000,
//	 "salt":"<base64>","nonce":"<base64>","ct":"<base64>"}
//
// The header fields are authenticated as GCM additional data, so changing any
// of them makes opening fail. Settings and the audit, activity and usage logs
// are not encrypted: they hold no secrets.

const (
	envelopeMark    = "enc"
	envelopeVersion = 1
	kdfName         = "pbkdf2-sha256"
	saltLen         = 16
	keyLen          = 32 // AES-256
	// maxKDFIterations bounds what a file may ask for, so a hostile or damaged
	// header cannot make start-up spin for minutes.
	maxKDFIterations = 10_000_000
)

// defaultKDFIterations is the PBKDF2 cost for newly written files: 600,000 is
// the OWASP figure for PBKDF2-HMAC-SHA256.
const defaultKDFIterations = 600_000

// kdfIterations is a variable so tests can lower it.
var kdfIterations = defaultKDFIterations

var (
	errKeyRequired = errors.New("the data file is encrypted; set POSTERN_KEY or POSTERN_KEY_FILE")
	errWrongKey    = errors.New("wrong key, or the data file is corrupted")
	// errContentsNotChecked is returned by CheckFile for an encrypted file when
	// no key was given: only the envelope could be checked.
	errContentsNotChecked = errors.New("encrypted; structure is valid, but set POSTERN_KEY or POSTERN_KEY_FILE to check the contents")
)

type envelope struct {
	Postern string `json:"postern"`
	V       int    `json:"v"`
	KDF     string `json:"kdf"`
	Iter    int    `json:"iter"`
	Salt    string `json:"salt"`
	Nonce   string `json:"nonce"`
	CT      string `json:"ct"`
}

// parseEnvelope reports whether b is an encrypted file. Anything that is not
// JSON carrying the "enc" mark, including plain data files and files that are
// not valid JSON at all, is treated as plaintext.
func parseEnvelope(b []byte) (envelope, bool) {
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return envelope{}, false
	}
	var env envelope
	if err := json.Unmarshal(trimmed, &env); err != nil || env.Postern != envelopeMark {
		return envelope{}, false
	}
	return env, true
}

func isEncrypted(b []byte) bool {
	_, ok := parseEnvelope(b)
	return ok
}

// open decodes and sanity-checks the header fields.
func (e envelope) open() (salt, nonce, ct []byte, err error) {
	if e.V != envelopeVersion {
		return nil, nil, nil, fmt.Errorf("unsupported encrypted file version %d", e.V)
	}
	if e.KDF != kdfName {
		return nil, nil, nil, fmt.Errorf("unsupported key derivation %q", e.KDF)
	}
	if e.Iter < 1 || e.Iter > maxKDFIterations {
		return nil, nil, nil, fmt.Errorf("unreasonable iteration count %d", e.Iter)
	}
	dec := base64.StdEncoding.DecodeString
	if salt, err = dec(e.Salt); err != nil || len(salt) != saltLen {
		return nil, nil, nil, errors.New("damaged salt")
	}
	if nonce, err = dec(e.Nonce); err != nil || len(nonce) != 12 {
		return nil, nil, nil, errors.New("damaged nonce")
	}
	if ct, err = dec(e.CT); err != nil || len(ct) < 16 {
		return nil, nil, nil, errors.New("damaged ciphertext")
	}
	return salt, nonce, ct, nil
}

// header is what GCM authenticates alongside the ciphertext.
func header(iter int, salt []byte) []byte {
	return append([]byte(fmt.Sprintf("postern/%d/%s/%d/", envelopeVersion, kdfName, iter)), salt...)
}

// fileCodec seals and opens the data file with a key derived from a
// passphrase. A nil *fileCodec means "no encryption configured".
type fileCodec struct {
	pass string

	mu   sync.Mutex
	salt []byte
	iter int
	key  []byte
}

func newFileCodec(passphrase string) *fileCodec {
	return &fileCodec{pass: passphrase}
}

// keyFor returns the derived key for this salt and cost, deriving it only
// when it differs from the cached one. The caller holds c.mu.
func (c *fileCodec) keyFor(salt []byte, iter int) ([]byte, error) {
	if c.key != nil && c.iter == iter && bytes.Equal(c.salt, salt) {
		return c.key, nil
	}
	key, err := pbkdf2.Key(sha256.New, c.pass, salt, iter, keyLen)
	if err != nil {
		return nil, err
	}
	c.salt, c.iter, c.key = append([]byte(nil), salt...), iter, key
	return key, nil
}

func gcmFor(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Encode seals plain. Every call uses a fresh nonce. The salt is generated
// once per codec, or adopted from the file it last decoded, so the key is
// derived once per process.
func (c *fileCodec) Encode(plain []byte) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	salt, iter := c.salt, c.iter
	if c.key == nil {
		salt = make([]byte, saltLen)
		if _, err := rand.Read(salt); err != nil {
			return nil, err
		}
		iter = kdfIterations
	}
	key, err := c.keyFor(salt, iter)
	if err != nil {
		return nil, err
	}
	gcm, err := gcmFor(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := gcm.Seal(nil, nonce, plain, header(iter, salt))
	b, err := json.MarshalIndent(envelope{
		Postern: envelopeMark,
		V:       envelopeVersion,
		KDF:     kdfName,
		Iter:    iter,
		Salt:    base64.StdEncoding.EncodeToString(salt),
		Nonce:   base64.StdEncoding.EncodeToString(nonce),
		CT:      base64.StdEncoding.EncodeToString(ct),
	}, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

// Decode opens b. encrypted reports whether b was an envelope; a plaintext
// file comes back unchanged. It is safe on a nil codec: an encrypted file then
// fails with errKeyRequired rather than being read as garbage.
func (c *fileCodec) Decode(b []byte) (plain []byte, encrypted bool, err error) {
	env, ok := parseEnvelope(b)
	if !ok {
		return b, false, nil
	}
	if c == nil {
		return nil, true, errKeyRequired
	}
	salt, nonce, ct, err := env.open()
	if err != nil {
		return nil, true, fmt.Errorf("the encrypted data file is damaged: %w", err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key, err := c.keyFor(salt, env.Iter)
	if err != nil {
		return nil, true, err
	}
	gcm, err := gcmFor(key)
	if err != nil {
		return nil, true, err
	}
	plain, err = gcm.Open(nil, nonce, ct, header(env.Iter, salt))
	if err != nil {
		// Wrong key and tampering are indistinguishable by design.
		return nil, true, errWrongKey
	}
	return plain, true, nil
}

// keyFromEnv reads a passphrase from NAME or from the file named by NAME_FILE.
// ok is false when neither is set. Setting both is an error, so it is never
// unclear which one applies.
func keyFromEnv(name string) (pass string, ok bool, err error) {
	direct := os.Getenv(name)
	if strings.TrimSpace(direct) == "" {
		direct = ""
	}
	path := strings.TrimSpace(os.Getenv(name + "_FILE"))
	switch {
	case direct != "" && path != "":
		return "", false, fmt.Errorf("set only one of %s and %s_FILE", name, name)
	case path != "":
		b, err := os.ReadFile(path)
		if err != nil {
			return "", false, fmt.Errorf("%s_FILE: %w", name, err)
		}
		pass = strings.TrimRight(string(b), "\r\n")
		if strings.TrimSpace(pass) == "" {
			return "", false, fmt.Errorf("%s_FILE %s is empty", name, path)
		}
		return pass, true, nil
	case direct != "":
		return direct, true, nil
	}
	return "", false, nil
}

// codecFromEnv returns the codec for POSTERN_KEY / POSTERN_KEY_FILE, or nil
// when no key is configured.
func codecFromEnv() (*fileCodec, error) {
	pass, ok, err := keyFromEnv("POSTERN_KEY")
	if err != nil || !ok {
		return nil, err
	}
	return newFileCodec(pass), nil
}

// writeFileAtomic writes b to path through a temp file, owner-only.
func writeFileAtomic(path string, b []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
