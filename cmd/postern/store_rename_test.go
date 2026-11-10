package main

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestUpdateRename(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(filepath.Join(dir, "d.json"))
	if err != nil {
		t.Fatal(err)
	}
	svc, err := store.Create(Service{
		Name: "old", URL: "http://127.0.0.1:9", Enabled: true,
		Auth: UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: "sek"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	tok := svc.Token

	updated, err := store.Update("old", Service{
		Name: "new", URL: "http://127.0.0.1:9", Enabled: true,
		Auth:   UpstreamAuth{Header: &HeaderAuth{Name: "X-Api-Key", Secret: ""}},
		Access: AccessPostern,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "new" || updated.Token != tok {
		t.Fatalf("got name=%q token=%q", updated.Name, updated.Token)
	}
	if updated.Auth.Header == nil || updated.Auth.Header.Secret != "sek" {
		t.Fatalf("secret not preserved: %+v", updated.Auth)
	}
	if _, ok := store.Get("old"); ok {
		t.Fatal("old key still present")
	}
	if _, ok := store.Get("new"); !ok {
		t.Fatal("new key missing")
	}
}

func TestUpdateRenameCollision(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, _ = store.Create(Service{Name: "a", URL: "http://127.0.0.1:9", Enabled: true})
	_, _ = store.Create(Service{Name: "b", URL: "http://127.0.0.1:9", Enabled: true})
	_, err := store.Update("a", Service{Name: "b", URL: "http://127.0.0.1:9", Enabled: true})
	var fe FieldError
	if !errors.As(err, &fe) || fe["name"] == "" {
		t.Fatalf("expected name field error, got %v", err)
	}
	if _, ok := store.Get("a"); !ok {
		t.Fatal("a should remain")
	}
}

func TestUpdateRenameInvalid(t *testing.T) {
	dir := t.TempDir()
	store, _ := OpenStore(filepath.Join(dir, "d.json"))
	_, _ = store.Create(Service{Name: "a", URL: "http://127.0.0.1:9", Enabled: true})
	_, err := store.Update("a", Service{Name: "BAD_NAME", URL: "http://127.0.0.1:9", Enabled: true})
	var fe FieldError
	if !errors.As(err, &fe) || fe["name"] == "" {
		t.Fatalf("expected name field error, got %v", err)
	}
}
