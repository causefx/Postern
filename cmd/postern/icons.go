package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image/jpeg"
	"image/png"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Service icons. A service shows, in this order: the icon someone uploaded for it, the bundled
// icon of its app (apps/<app>/icon.svg), or a letter tile drawn by the browser.
//
// Uploaded icons live next to the data file in icons/, named by the SHA-256 of their contents, so
// the same image is stored once, names never need cleaning, and a URL can be cached forever. Only
// raster images are accepted: an SVG can carry script. Every file is served with a sandboxing
// policy as well, in case one is ever opened directly rather than through an <img>.

const (
	maxIconBytes = 256 << 10
	maxIconSide  = 512
	// iconGrace keeps an icon nobody uses yet: one uploaded for a service that is not saved yet.
	iconGrace = time.Hour
)

var (
	iconNameRe = regexp.MustCompile(`^[0-9a-f]{64}\.(png|jpg|webp)$`)
	appIDRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)
	appIconRe  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}\.svg$`)
)

// iconPolicy is sent with every icon so a file opened on its own can run nothing.
const iconPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

var iconTypes = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"webp": "image/webp",
}

type iconStore struct {
	mu  sync.Mutex
	dir string
}

// iconDirFor is the icons folder beside the data file.
func iconDirFor(dataPath string) string {
	return filepath.Join(filepath.Dir(dataPath), "icons")
}

func newIconStore(dir string) *iconStore {
	return &iconStore{dir: dir}
}

// checkIcon returns the file extension for an acceptable icon, or says what is wrong with it.
func checkIcon(b []byte) (string, error) {
	if len(b) == 0 {
		return "", errors.New("the file is empty")
	}
	if len(b) > maxIconBytes {
		return "", fmt.Errorf("the image must be %d KB or smaller", maxIconBytes>>10)
	}
	var (
		ext  string
		w, h int
	)
	switch {
	case bytes.HasPrefix(b, []byte("\x89PNG\r\n\x1a\n")):
		cfg, err := png.DecodeConfig(bytes.NewReader(b))
		if err != nil {
			return "", errors.New("the PNG could not be read")
		}
		ext, w, h = "png", cfg.Width, cfg.Height
	case bytes.HasPrefix(b, []byte{0xff, 0xd8, 0xff}):
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(b))
		if err != nil {
			return "", errors.New("the JPEG could not be read")
		}
		ext, w, h = "jpg", cfg.Width, cfg.Height
	case len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		var err error
		if w, h, err = webpSize(b); err != nil {
			return "", err
		}
		ext = "webp"
	default:
		return "", errors.New("use a PNG, JPEG or WebP image")
	}
	if w < 1 || h < 1 || w > maxIconSide || h > maxIconSide {
		return "", fmt.Errorf("the image must be at most %d×%d pixels (this one is %d×%d)", maxIconSide, maxIconSide, w, h)
	}
	// The size is checked first so decoding cannot be asked to allocate a huge image.
	var err error
	switch ext {
	case "png":
		_, err = png.Decode(bytes.NewReader(b))
	case "jpg":
		_, err = jpeg.Decode(bytes.NewReader(b))
	}
	if err != nil {
		return "", fmt.Errorf("the image could not be read: %v", err)
	}
	return ext, nil
}

// webpSize reads a WebP's canvas size from its first chunk. The standard library has no WebP
// decoder; the browser decodes it, and the size check keeps it small.
func webpSize(b []byte) (int, int, error) {
	bad := errors.New("the WebP could not be read")
	if len(b) < 30 {
		return 0, 0, bad
	}
	if int(binary.LittleEndian.Uint32(b[4:8]))+8 > len(b) {
		return 0, 0, bad
	}
	le24 := func(p []byte) int { return int(p[0]) | int(p[1])<<8 | int(p[2])<<16 }
	switch string(b[12:16]) {
	case "VP8 ":
		if b[23] != 0x9d || b[24] != 0x01 || b[25] != 0x2a {
			return 0, 0, bad
		}
		return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff), nil
	case "VP8L":
		if b[20] != 0x2f {
			return 0, 0, bad
		}
		bits := binary.LittleEndian.Uint32(b[21:25])
		return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, nil
	case "VP8X":
		return le24(b[24:27]) + 1, le24(b[27:30]) + 1, nil
	}
	return 0, 0, bad
}

// iconName is the stored name for an icon's bytes.
func iconName(b []byte, ext string) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]) + "." + ext
}

// save checks an icon and stores it, returning its name. Saving the same image twice is free.
func (s *iconStore) save(b []byte) (string, error) {
	ext, err := checkIcon(b)
	if err != nil {
		return "", err
	}
	if s == nil {
		return "", errors.New("icons are not available")
	}
	name := iconName(b, ext)
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.dir, name)
	if _, err := os.Stat(path); err == nil {
		// Touch it so a sweep does not take an icon just uploaded again for a new service.
		now := time.Now()
		_ = os.Chtimes(path, now, now)
		return name, nil
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return "", err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return name, nil
}

func (s *iconStore) read(name string) ([]byte, error) {
	if s == nil || !iconNameRe.MatchString(name) {
		return nil, fs.ErrNotExist
	}
	return os.ReadFile(filepath.Join(s.dir, name))
}

func (s *iconStore) exists(name string) bool {
	if s == nil || !iconNameRe.MatchString(name) {
		return false
	}
	_, err := os.Stat(filepath.Join(s.dir, name))
	return err == nil
}

// sweep removes stored icons that no service uses and that are older than grace. It returns how
// many it removed.
func (s *iconStore) sweep(keep map[string]bool, grace time.Duration, now time.Time) int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return 0
	}
	removed := 0
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || keep[name] {
			continue
		}
		// Leftover temporary files and anything that is not an icon name are only ever ours.
		if !iconNameRe.MatchString(name) && !strings.HasSuffix(name, ".tmp") {
			continue
		}
		info, err := e.Info()
		if err != nil || now.Sub(info.ModTime()) < grace {
			continue
		}
		if os.Remove(filepath.Join(s.dir, name)) == nil {
			removed++
		}
	}
	return removed
}

// sweepIcons drops uploaded icons no service uses any more.
func (a *App) sweepIcons() {
	if a == nil || a.icons == nil {
		return
	}
	keep := map[string]bool{}
	for _, svc := range a.store.List() {
		if svc.Icon != "" {
			keep[svc.Icon] = true
		}
	}
	if n := a.icons.sweep(keep, iconGrace, time.Now()); n > 0 {
		log.Printf("removed %d unused service icon(s)", n)
	}
}

// uploadIcon stores the image in the request body and answers {"icon": "<name>"}. The name is then
// sent with the service when it is saved.
func (a *App) uploadIcon(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxIconBytes))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("the image must be %d KB or smaller", maxIconBytes>>10))
			return
		}
		writeErr(w, 400, "could not read the image")
		return
	}
	name, err := a.icons.save(b)
	if err != nil {
		writeFieldErr(w, FieldError{"icon": err.Error()})
		return
	}
	writeJSON(w, 201, map[string]string{"icon": name})
}

// serveUploadedIcon serves GET /admin/icons/{file}.
func (a *App) serveUploadedIcon(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	b, err := a.icons.read(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	writeIcon(w, iconTypes[strings.TrimPrefix(filepath.Ext(name), ".")], "public, max-age=31536000, immutable", b)
}

// serveAppIcon serves GET /admin/app-icons/{id}.svg, the icon in apps/<id>/.
func (a *App) serveAppIcon(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !appIconRe.MatchString(name) {
		http.NotFound(w, r)
		return
	}
	b, err := a.appReg().iconSVG(strings.TrimSuffix(name, ".svg"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// Not immutable: an upgrade may bring a new drawing under the same name.
	writeIcon(w, "image/svg+xml", "public, max-age=86400", b)
}

func writeIcon(w http.ResponseWriter, ctype, cache string, b []byte) {
	h := w.Header()
	h.Set("Content-Type", ctype)
	h.Set("Content-Security-Policy", iconPolicy)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", cache)
	_, _ = w.Write(b)
}

// iconChange describes, for the admin log, how a service's uploaded icon changed. "" means it did
// not.
func iconChange(prev, next string) string {
	switch {
	case prev == next:
		return ""
	case prev == "":
		return "custom icon set"
	case next == "":
		return "custom icon removed"
	default:
		return "custom icon changed"
	}
}
