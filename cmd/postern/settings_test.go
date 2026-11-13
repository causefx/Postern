package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const oneService = `{"name":"one","url":"http://127.0.0.1:9","token":"abc","tokens":[{"id":"id1","name":"default","secret":"abc"}],"enabled":true,"auth":{}}`

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestFreshStartWritesDefaultSettingsFile(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "sub", "postern-data.json"))
	if err != nil {
		t.Fatal(err)
	}
	got := readFile(t, filepath.Join(dir, "sub", "postern-settings.json"))
	for _, want := range []string{`"activityLimit": 20`, `"rateLimit": 120`, `"auditLimit": 100`, `"passwordLogin": true`} {
		if !strings.Contains(got, want) {
			t.Fatalf("settings file is missing %s:\n%s", want, got)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "sub", "postern-data.json")); !os.IsNotExist(err) {
		t.Fatal("a fresh start must not create the data file before there is a service")
	}
	if store.ActivityLimit() != 20 || store.RateLimit() != 120 || store.AuditLimit() != 100 || !store.PasswordLogin() {
		t.Fatal("defaults not applied")
	}
}

func TestInlineSettingsMigrateOutOfDataFile(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	writeFile(t, data, `{"settings":{"activityLimit":7,"rateLimit":0,"auditLimit":50,"passwordLogin":false},"services":[`+oneService+`]}`)

	store, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	if store.ActivityLimit() != 7 || store.RateLimit() != 0 || store.AuditLimit() != 50 || store.PasswordLogin() {
		t.Fatalf("inline values lost: %d %d %d %v", store.ActivityLimit(), store.RateLimit(), store.AuditLimit(), store.PasswordLogin())
	}
	settings := readFile(t, filepath.Join(dir, "postern-settings.json"))
	for _, want := range []string{`"activityLimit": 7`, `"rateLimit": 0`, `"auditLimit": 50`, `"passwordLogin": false`} {
		if !strings.Contains(settings, want) {
			t.Fatalf("settings file is missing %s:\n%s", want, settings)
		}
	}
	rewritten := readFile(t, data)
	if strings.Contains(rewritten, "settings") || strings.Contains(rewritten, "activityLimit") {
		t.Fatalf("data file still carries settings:\n%s", rewritten)
	}
	if _, ok := store.Get("one"); !ok || !strings.Contains(rewritten, `"secret": "abc"`) {
		t.Fatal("the service did not survive the migration")
	}

	again, err := OpenStore(data)
	if err != nil || again.ActivityLimit() != 7 || again.PasswordLogin() {
		t.Fatalf("second start: %v %d", err, again.ActivityLimit())
	}
}

func TestSettingsFileWinsOverInlineBlock(t *testing.T) {
	// A crash between the two migration writes leaves both: the settings file
	// is already written, the data file still has its old block.
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	writeFile(t, data, `{"settings":{"activityLimit":999,"rateLimit":1,"auditLimit":1},"services":[`+oneService+`]}`)
	writeFile(t, filepath.Join(dir, "postern-settings.json"), `{"activityLimit":33,"rateLimit":44,"auditLimit":55,"passwordLogin":true}`)

	store, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	if store.ActivityLimit() != 33 || store.RateLimit() != 44 || store.AuditLimit() != 55 {
		t.Fatalf("the old inline block overrode the settings file: %d %d %d", store.ActivityLimit(), store.RateLimit(), store.AuditLimit())
	}
	if strings.Contains(readFile(t, data), "settings") {
		t.Fatal("the leftover inline block was not dropped")
	}
	if got := readFile(t, filepath.Join(dir, "postern-settings.json")); !strings.Contains(got, `"activityLimit":33`) {
		t.Fatalf("a valid settings file must not be rewritten:\n%s", got)
	}
}

func TestLegacyArrayFileGetsSettingsFile(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	writeFile(t, data, `[`+oneService+`]`)
	if _, err := OpenStore(data); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(readFile(t, filepath.Join(dir, "postern-settings.json")), `"rateLimit": 120`) {
		t.Fatal("no settings file for a bare-array data file")
	}
	if !strings.HasPrefix(strings.TrimSpace(readFile(t, data)), "{") {
		t.Fatal("data file was not rewritten in the current format")
	}
}

func TestHandEditedSettingsAreFilledAndClamped(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	settingsPath := filepath.Join(dir, "postern-settings.json")

	writeFile(t, settingsPath, `{"rateLimit":10}`)
	store, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	if store.RateLimit() != 10 || store.ActivityLimit() != 20 || store.AuditLimit() != 100 || !store.PasswordLogin() {
		t.Fatalf("missing keys must take defaults: %d %d %d", store.RateLimit(), store.ActivityLimit(), store.AuditLimit())
	}
	if !strings.Contains(readFile(t, settingsPath), `"activityLimit": 20`) {
		t.Fatal("the file was not completed with the missing keys")
	}

	writeFile(t, settingsPath, `{"activityLimit":5000,"rateLimit":99999,"auditLimit":0,"passwordLogin":true}`)
	store, err = OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	if store.ActivityLimit() != maxActivityLimit || store.RateLimit() != maxRateLimit || store.AuditLimit() != defaultAuditLimit {
		t.Fatalf("out-of-range values not pulled in: %d %d %d", store.ActivityLimit(), store.RateLimit(), store.AuditLimit())
	}

	writeFile(t, settingsPath, "")
	if store, err = OpenStore(data); err != nil || store.RateLimit() != defaultRateLimit {
		t.Fatalf("empty settings file: %v", err)
	}
}

func TestBrokenSettingsFileStopsStartupAndIsKept(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	settingsPath := filepath.Join(dir, "postern-settings.json")
	writeFile(t, settingsPath, `{"rateLimit": 10,`)
	if _, err := OpenStore(data); err == nil || !strings.Contains(err.Error(), "postern-settings.json") {
		t.Fatalf("want an error naming the settings file, got %v", err)
	}
	if got := readFile(t, settingsPath); got != `{"rateLimit": 10,` {
		t.Fatalf("a broken file must not be overwritten: %q", got)
	}
}

func TestServiceSavesLeaveSettingsFileAlone(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	settingsPath := filepath.Join(dir, "postern-settings.json")
	// Compact and complete, so an unwanted rewrite would change the bytes.
	const hand = `{"activityLimit":11,"rateLimit":22,"auditLimit":33,"passwordLogin":true}`
	writeFile(t, settingsPath, hand)

	store, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, settingsPath); got != hand {
		t.Fatalf("opening rewrote a complete settings file: %q", got)
	}
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetEnabled("one", false); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, settingsPath); got != hand {
		t.Fatalf("saving a service touched the settings file: %q", got)
	}
}

func TestSettingsSavesLeaveDataFileAlone(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(Service{Name: "one", URL: "http://127.0.0.1:9", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	before := readFile(t, data)

	saved, err := store.UpdateSettings(Settings{ActivityLimit: 5, RateLimit: 6, AuditLimit: 7, PasswordLogin: false})
	if err != nil || saved.ActivityLimit != 5 {
		t.Fatalf("update: %+v %v", saved, err)
	}
	if after := readFile(t, data); after != before {
		t.Fatal("saving settings rewrote the data file")
	}
	reloaded, err := OpenStore(data)
	if err != nil || reloaded.ActivityLimit() != 5 || reloaded.RateLimit() != 6 || reloaded.AuditLimit() != 7 || reloaded.PasswordLogin() {
		t.Fatalf("settings did not persist: %v", err)
	}
}

func TestFailedSettingsSaveKeepsPreviousValues(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	store, err := OpenStore(data)
	if err != nil {
		t.Fatal(err)
	}
	// A path whose parent is a regular file can never be written.
	blocker := filepath.Join(dir, "blocker")
	writeFile(t, blocker, "x")
	store.settingsPath = filepath.Join(blocker, "postern-settings.json")

	if _, err := store.UpdateSettings(Settings{ActivityLimit: 3, RateLimit: 3, AuditLimit: 3, PasswordLogin: true}); err == nil {
		t.Fatal("expected the save to fail")
	}
	if store.ActivityLimit() != 20 || store.RateLimit() != 120 {
		t.Fatalf("a failed save changed the live settings: %d %d", store.ActivityLimit(), store.RateLimit())
	}
}

func TestSettingsPathCanBeOverridden(t *testing.T) {
	dir := t.TempDir()
	elsewhere := filepath.Join(dir, "conf", "my-settings.json")
	t.Setenv("POSTERN_SETTINGS", elsewhere)
	if _, err := OpenStore(filepath.Join(dir, "data", "postern-data.json")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(readFile(t, elsewhere), `"auditLimit": 100`) {
		t.Fatal("POSTERN_SETTINGS was ignored")
	}
	if _, err := os.Stat(filepath.Join(dir, "data", "postern-settings.json")); !os.IsNotExist(err) {
		t.Fatal("the default location was written as well")
	}
}

func TestCheckValidatesSettingsFile(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	settingsPath := filepath.Join(dir, "postern-settings.json")
	writeFile(t, data, `{"services":[`+oneService+`]}`)

	writeFile(t, settingsPath, `{"activityLimit":20,"rateLimit":0,"auditLimit":100,"passwordLogin":true}`)
	if problems, err := CheckFile(data); err != nil || len(problems) != 0 {
		t.Fatalf("valid settings: %v %v", problems, err)
	}

	writeFile(t, settingsPath, `{"activityLimit":0,"rateLimit":10001,"auditLimit":5001}`)
	problems, err := CheckFile(data)
	if err != nil || len(problems) != 3 {
		t.Fatalf("want 3 problems, got %v %v", problems, err)
	}
	for i, field := range []string{"activityLimit", "rateLimit", "auditLimit"} {
		if !strings.Contains(problems[i], field) {
			t.Fatalf("problem %d should name %s: %q", i, field, problems[i])
		}
	}

	writeFile(t, settingsPath, `{nope`)
	problems, err = CheckFile(data)
	if err != nil || len(problems) != 1 || !strings.Contains(problems[0], "invalid json") {
		t.Fatalf("broken settings file: %v %v", problems, err)
	}
}

func TestCheckUsesInlineBlockOnlyWithoutSettingsFile(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	writeFile(t, data, `{"settings":{"rateLimit":10001},"services":[`+oneService+`]}`)

	if problems, _ := CheckFile(data); len(problems) != 1 || !strings.Contains(problems[0], "rateLimit") {
		t.Fatalf("an unmigrated inline block should be checked: %v", problems)
	}
	writeFile(t, filepath.Join(dir, "postern-settings.json"), `{"activityLimit":20,"rateLimit":10,"auditLimit":100,"passwordLogin":true}`)
	if problems, _ := CheckFile(data); len(problems) != 0 {
		t.Fatalf("the inline block is ignored once a settings file exists: %v", problems)
	}
}

func TestCheckDoesNotCreateFiles(t *testing.T) {
	dir := t.TempDir()
	data := filepath.Join(dir, "postern-data.json")
	writeFile(t, data, `{"services":[`+oneService+`]}`)
	if _, err := CheckFile(data); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "postern-settings.json")); !os.IsNotExist(err) {
		t.Fatal("check must be read-only")
	}
}
