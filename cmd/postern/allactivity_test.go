package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func allActivityApp(t *testing.T) *App {
	t.Helper()
	st, err := openStore(filepath.Join(t.TempDir(), "d.json"), nil)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: st, activity: newActivityLog()}
	base := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	app.activity.add("a", activityEvent{Time: base, Method: "GET", Path: "/1", Status: 200, Who: "x"})
	app.activity.add("b", activityEvent{Time: base.Add(2 * time.Second), Method: "GET", Path: "/3", Status: 401, Who: "rejected"})
	app.activity.add("a", activityEvent{Time: base.Add(1 * time.Second), Method: "POST", Path: "/2", Status: 429, Who: "limited"})
	app.activity.add("b", activityEvent{Time: base.Add(3 * time.Second), Method: "GET", Path: "/4", Status: 200, Who: "y", Reason: "paused"})
	return app
}

type allActivityBody struct {
	Total   int `json:"total"`
	Entries []struct {
		Service string `json:"service"`
		Path    string `json:"path"`
		Status  int    `json:"status"`
		Who     string `json:"who"`
		Reason  string `json:"reason"`
	} `json:"entries"`
}

func getAllActivity(t *testing.T, app *App, query string) (int, allActivityBody) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/admin/api/activity"+query, nil)
	rec := httptest.NewRecorder()
	app.allActivity(rec, req)
	var body allActivityBody
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
	}
	return rec.Code, body
}

func TestAllActivityMergesNewestFirst(t *testing.T) {
	code, body := getAllActivity(t, allActivityApp(t), "")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	var paths []string
	for _, e := range body.Entries {
		paths = append(paths, e.Service+e.Path)
	}
	want := []string{"b/4", "b/3", "a/2", "a/1"}
	if len(paths) != len(want) {
		t.Fatalf("got %v want %v", paths, want)
	}
	for i := range want {
		if paths[i] != want[i] {
			t.Fatalf("got %v want %v", paths, want)
		}
	}
	if body.Total != 4 {
		t.Fatalf("total %d", body.Total)
	}
	if body.Entries[0].Reason != "paused" || body.Entries[0].Who != "y" {
		t.Fatalf("fields not flattened: %+v", body.Entries[0])
	}
}

func TestAllActivityLimitAndService(t *testing.T) {
	app := allActivityApp(t)
	_, body := getAllActivity(t, app, "?limit=2")
	if len(body.Entries) != 2 || body.Total != 4 || body.Entries[0].Path != "/4" {
		t.Fatalf("limit: %+v", body)
	}
	_, body = getAllActivity(t, app, "?service=a")
	if len(body.Entries) != 2 || body.Total != 2 || body.Entries[0].Service != "a" || body.Entries[0].Path != "/2" {
		t.Fatalf("service: %+v", body)
	}
	_, body = getAllActivity(t, app, "?service=nope")
	if len(body.Entries) != 0 || body.Total != 0 {
		t.Fatalf("unknown service: %+v", body)
	}
}

func TestAllActivityRejectsBadLimit(t *testing.T) {
	app := allActivityApp(t)
	for _, q := range []string{"?limit=0", "?limit=-3", "?limit=abc"} {
		if code, _ := getAllActivity(t, app, q); code != http.StatusBadRequest {
			t.Fatalf("%s: status %d", q, code)
		}
	}
	// A huge limit is clamped, not refused.
	if code, _ := getAllActivity(t, app, "?limit=999999"); code != http.StatusOK {
		t.Fatalf("clamp: status %d", code)
	}
}

func TestAllActivityEmptyAndNilLog(t *testing.T) {
	st, err := openStore(filepath.Join(t.TempDir(), "d.json"), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, log := range []*activityLog{nil, newActivityLog()} {
		app := &App{store: st, activity: log}
		code, body := getAllActivity(t, app, "")
		if code != http.StatusOK || body.Entries == nil || len(body.Entries) != 0 {
			t.Fatalf("code %d body %+v", code, body)
		}
	}
}
