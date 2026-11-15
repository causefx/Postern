package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func decodeRec(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
}

func newMemStore(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "data.json"), nil)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func pngBytes(t *testing.T, w, h int, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// webpVP8L is a minimal lossless WebP header with the given size; enough for the size check.
func webpVP8L(w, h int) []byte {
	b := make([]byte, 30)
	copy(b[0:], "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WEBP")
	copy(b[12:], "VP8L")
	binary.LittleEndian.PutUint32(b[16:], 10)
	b[20] = 0x2f
	binary.LittleEndian.PutUint32(b[21:], uint32(w-1)|uint32(h-1)<<14)
	return b
}

func TestCheckIcon(t *testing.T) {
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, image.NewRGBA(image.Rect(0, 0, 32, 32)), nil); err != nil {
		t.Fatal(err)
	}
	ok := map[string][]byte{
		"png":  pngBytes(t, 64, 64, color.White),
		"jpg":  jpg.Bytes(),
		"webp": webpVP8L(128, 128),
	}
	for want, b := range ok {
		if ext, err := checkIcon(b); err != nil || ext != want {
			t.Errorf("%s: ext %q err %v", want, ext, err)
		}
	}
	bad := map[string][]byte{
		"svg":        []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"empty":      nil,
		"too wide":   pngBytes(t, maxIconSide+1, 8, color.White),
		"big webp":   webpVP8L(4000, 4000),
		"truncated":  pngBytes(t, 16, 16, color.White)[:40],
		"too big":    append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, maxIconBytes)...),
		"html":       []byte("<html><body>hi</body></html>"),
		"short webp": []byte("RIFF\x04\x00\x00\x00WEBPVP8L"),
	}
	for name, b := range bad {
		if _, err := checkIcon(b); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func iconApp(t *testing.T) *App {
	t.Helper()
	store := newMemStore(t)
	return &App{
		store: store, usage: openTokenUsage(""),
		audit: newAuditLog(filepath.Join(t.TempDir(), "audit")),
		icons: newIconStore(filepath.Join(t.TempDir(), "icons")),
	}
}

func upload(t *testing.T, app *App, b []byte) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	app.uploadIcon(rec, httptest.NewRequest(http.MethodPost, "/admin/api/icons", bytes.NewReader(b)))
	return rec
}

func TestUploadAndServeIcon(t *testing.T) {
	app := iconApp(t)
	img := pngBytes(t, 32, 32, color.RGBA{255, 0, 0, 255})
	rec := upload(t, app, img)
	if rec.Code != 201 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var out struct{ Icon string }
	decodeRec(t, rec, &out)
	if !iconNameRe.MatchString(out.Icon) || !strings.HasSuffix(out.Icon, ".png") {
		t.Fatalf("name %q", out.Icon)
	}
	if again := upload(t, app, img); !strings.Contains(again.Body.String(), out.Icon) {
		t.Fatalf("same image should get the same name: %s", again.Body.String())
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/icons/{file}", app.serveUploadedIcon)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/admin/icons/"+out.Icon, nil))
	if res.Code != 200 || !bytes.Equal(res.Body.Bytes(), img) {
		t.Fatalf("serve: %d", res.Code)
	}
	h := res.Header()
	if h.Get("Content-Type") != "image/png" || !strings.Contains(h.Get("Content-Security-Policy"), "sandbox") || h.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("headers: %v", h)
	}

	for _, bad := range []string{"../data.json", "x.png", strings.Repeat("a", 64) + ".svg"} {
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/admin/icons/"+bad, nil))
		if res.Code == 200 {
			t.Errorf("%s was served", bad)
		}
	}

	if rec := upload(t, app, []byte(`<svg/>`)); rec.Code != 400 || !strings.Contains(rec.Body.String(), "PNG, JPEG or WebP") {
		t.Fatalf("svg upload: %d %s", rec.Code, rec.Body.String())
	}
	if rec := upload(t, app, make([]byte, maxIconBytes+10)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload: %d", rec.Code)
	}
}

func TestServeAppIcon(t *testing.T) {
	app := &App{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/app-icons/{file}", app.serveAppIcon)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/admin/app-icons/sonarr.svg", nil))
	if res.Code != 200 || res.Header().Get("Content-Type") != "image/svg+xml" || !strings.Contains(res.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatalf("sonarr: %d %v", res.Code, res.Header())
	}
	for _, bad := range []string{"nope.svg", "..%2fsite.webmanifest", "Sonarr.svg"} {
		res := httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/admin/app-icons/"+bad, nil))
		if res.Code != 404 {
			t.Errorf("%s: %d", bad, res.Code)
		}
	}
}

func saveJSON(t *testing.T, h http.HandlerFunc, method, path, name, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if name != "" {
		req.SetPathValue("name", name)
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestServiceAppAndIcon(t *testing.T) {
	app := iconApp(t)
	var up struct{ Icon string }
	decodeRec(t, upload(t, app, pngBytes(t, 16, 16, color.Black)), &up)

	rec := saveJSON(t, app.createService, "POST", "/", "",
		`{"name":"tv","url":"http://tv:8989","app":"sonarr","icon":"`+up.Icon+`"}`)
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var v view
	decodeRec(t, rec, &v)
	if v.App != "sonarr" || v.Icon != up.Icon {
		t.Fatalf("view: %+v", v)
	}

	// Leaving app and icon out keeps them.
	if rec := saveJSON(t, app.updateService, "PUT", "/", "tv", `{"name":"tv","url":"http://tv:8990"}`); rec.Code != 200 {
		t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
	}
	if svc, _ := app.store.Get("tv"); svc.App != "sonarr" || svc.Icon != up.Icon {
		t.Fatalf("omitted fields were not kept: %+v", svc)
	}

	// An icon that was never uploaded, or a malformed app, is refused.
	if rec := saveJSON(t, app.updateService, "PUT", "/", "tv", `{"name":"tv","url":"http://tv:8990","icon":"`+strings.Repeat("0", 64)+`.png"}`); rec.Code != 400 {
		t.Fatalf("unknown icon: %d", rec.Code)
	}
	if rec := saveJSON(t, app.updateService, "PUT", "/", "tv", `{"name":"tv","url":"http://tv:8990","app":"Bad App"}`); rec.Code != 400 {
		t.Fatalf("bad app: %d", rec.Code)
	}

	// Duplicates keep both.
	dup, err := app.store.Duplicate("tv", "")
	if err != nil || dup.App != "sonarr" || dup.Icon != up.Icon {
		t.Fatalf("duplicate: %+v %v", dup, err)
	}

	// Clearing the icon is logged.
	if rec := saveJSON(t, app.updateService, "PUT", "/", "tv", `{"name":"tv","url":"http://tv:8990","icon":""}`); rec.Code != 200 {
		t.Fatalf("clear: %d %s", rec.Code, rec.Body.String())
	}
	last := app.audit.list()[0]
	if last.Action != "update" || last.Detail != "custom icon removed" {
		t.Fatalf("audit: %+v", last)
	}

	// The data file keeps both fields across a restart.
	again, err := openStore(app.store.path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if svc, _ := again.Get("tv-2"); svc.App != "sonarr" || svc.Icon != up.Icon {
		t.Fatalf("reload: %+v", svc)
	}
}

func TestIconSweep(t *testing.T) {
	dir := t.TempDir()
	s := newIconStore(dir)
	used, _ := s.save(pngBytes(t, 8, 8, color.White))
	old, _ := s.save(pngBytes(t, 8, 8, color.Black))
	fresh, _ := s.save(pngBytes(t, 9, 9, color.Black))
	long := time.Now().Add(-2 * iconGrace)
	for _, n := range []string{used, old} {
		if err := os.Chtimes(filepath.Join(dir, n), long, long); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "keep-me.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if n := s.sweep(map[string]bool{used: true}, iconGrace, time.Now()); n != 1 {
		t.Fatalf("removed %d, want 1", n)
	}
	if !s.exists(used) || s.exists(old) || !s.exists(fresh) {
		t.Fatalf("used %v old %v fresh %v", s.exists(used), s.exists(old), s.exists(fresh))
	}
	if _, err := os.Stat(filepath.Join(dir, "keep-me.txt")); err != nil {
		t.Fatal("sweep removed a file that is not an icon")
	}
}

func TestExportImportCarriesIcons(t *testing.T) {
	src := iconApp(t)
	img := pngBytes(t, 24, 24, color.RGBA{0, 0, 255, 255})
	var up struct{ Icon string }
	decodeRec(t, upload(t, src, img), &up)
	if rec := saveJSON(t, src.createService, "POST", "/", "",
		`{"name":"tv","url":"http://tv:8989","app":"sonarr","icon":"`+up.Icon+`","auth":{"header":{"name":"X-Api-Key","secret":"k"}}}`); rec.Code != 201 {
		t.Fatalf("create: %s", rec.Body.String())
	}

	rec := postConfig(src.exportConfig, `{"mode":"full","confirm":true}`)
	var exp struct {
		File configFile `json:"file"`
	}
	decodeRec(t, rec, &exp)
	if got := exp.File.Icons[up.Icon]; got != base64.StdEncoding.EncodeToString(img) {
		t.Fatalf("export icons: %v", exp.File.Icons)
	}
	if cs := exp.File.Services[0]; cs.App == nil || *cs.App != "sonarr" || cs.Icon == nil || *cs.Icon != up.Icon {
		t.Fatalf("export service: %+v", cs)
	}

	// Import into an empty Postern, with the icon stored under a wrong name in the file: it is
	// renamed after its contents.
	wrong := strings.Repeat("f", 64) + ".png"
	exp.File.Icons = map[string]string{wrong: exp.File.Icons[up.Icon]}
	*exp.File.Services[0].Icon = wrong
	raw, _ := json.Marshal(map[string]any{"config": exp.File})
	dst := iconApp(t)
	if rec := postConfig(dst.importConfig, string(raw)); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body.String())
	}
	svc, _ := dst.store.Get("tv")
	if svc.App != "sonarr" || svc.Icon != up.Icon || !dst.icons.exists(up.Icon) {
		t.Fatalf("imported: %+v exists=%v", svc, dst.icons.exists(up.Icon))
	}

	// A file whose icon is not an image is refused as a whole.
	exp.File.Icons = map[string]string{wrong: base64.StdEncoding.EncodeToString([]byte("<svg/>"))}
	raw, _ = json.Marshal(map[string]any{"config": exp.File, "overwrite": true})
	if rec := postConfig(dst.importConfig, string(raw)); rec.Code != 400 || !strings.Contains(rec.Body.String(), "cannot be used") {
		t.Fatalf("bad icon import: %d %s", rec.Code, rec.Body.String())
	}

	// An older file without app or icon keeps what an overwritten service has.
	exp.File.Icons = nil
	exp.File.Services[0].App = nil
	exp.File.Services[0].Icon = nil
	raw, _ = json.Marshal(map[string]any{"config": exp.File, "overwrite": true})
	if rec := postConfig(dst.importConfig, string(raw)); rec.Code != 200 {
		t.Fatalf("overwrite: %d %s", rec.Code, rec.Body.String())
	}
	if svc, _ := dst.store.Get("tv"); svc.App != "sonarr" || svc.Icon != up.Icon {
		t.Fatalf("overwrite lost app or icon: %+v", svc)
	}
}
