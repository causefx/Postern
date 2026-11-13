package main

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// freeAddr returns a loopback address nothing is listening on.
func freeAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	return addr
}

// waitListening waits until addr accepts connections.
func waitListening(t *testing.T, addr string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if c, err := net.Dial("tcp", addr); err == nil {
			c.Close()
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("%s never started listening", addr)
}

func TestServeUntilFinishesRequestsInProgress(t *testing.T) {
	addr := freeAddr(t)
	started := make(chan struct{})
	srv := &http.Server{Addr: addr, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		time.Sleep(300 * time.Millisecond)
		io.WriteString(w, "finished")
	})}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serveUntil(ctx, 5*time.Second, srv) }()
	waitListening(t, addr)

	type result struct {
		body string
		err  error
	}
	got := make(chan result, 1)
	go func() {
		res, err := http.Get("http://" + addr + "/")
		if err != nil {
			got <- result{err: err}
			return
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		got <- result{body: string(b)}
	}()

	<-started
	cancel() // the stop signal arrives mid-request

	select {
	case r := <-got:
		if r.err != nil || r.body != "finished" {
			t.Fatalf("the request in progress was cut off: %q %v", r.body, r.err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the request never finished")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("a clean stop returned %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serveUntil did not return")
	}

	// And it no longer accepts new connections.
	if c, err := net.DialTimeout("tcp", addr, 300*time.Millisecond); err == nil {
		c.Close()
		t.Fatal("still accepting connections after the stop")
	}
}

func TestServeUntilCutsOffRequestsThatOutlastTheGrace(t *testing.T) {
	addr := freeAddr(t)
	release := make(chan struct{})
	started := make(chan struct{})
	srv := &http.Server{Addr: addr, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release // a stream that never ends
	})}
	t.Cleanup(func() { close(release) })

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serveUntil(ctx, 200*time.Millisecond, srv) }()
	waitListening(t, addr)
	go http.Get("http://" + addr + "/")
	<-started

	begin := time.Now()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("returned %v", err)
		}
		if took := time.Since(begin); took > 2*time.Second {
			t.Fatalf("took %v to stop with a 200ms grace", took)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a stuck request kept the server from stopping")
	}
}

func TestServeUntilReportsAListenFailure(t *testing.T) {
	// Hold a port so the server cannot have it.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	taken := &http.Server{Addr: ln.Addr().String(), Handler: http.NotFoundHandler()}
	other := &http.Server{Addr: freeAddr(t), Handler: http.NotFoundHandler()}

	done := make(chan error, 1)
	go func() { done <- serveUntil(context.Background(), time.Second, other, taken) }()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), ln.Addr().String()) {
			t.Fatalf("want an error naming the address, got %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("a listen failure did not stop the other server")
	}
}

func TestServeUntilRunsSeveralServers(t *testing.T) {
	a, b := freeAddr(t), freeAddr(t)
	mk := func(addr string) *http.Server {
		return &http.Server{Addr: addr, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serveUntil(ctx, time.Second, mk(a), mk(b)) }()
	waitListening(t, a)
	waitListening(t, b)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("did not stop")
	}
}

func TestShutdownGraceFromEnvironment(t *testing.T) {
	for value, want := range map[string]time.Duration{
		"":      defaultShutdownGrace,
		"20s":   20 * time.Second,
		"1m30s": 90 * time.Second,
		"abc":   defaultShutdownGrace,
		"0s":    defaultShutdownGrace,
		"-5s":   defaultShutdownGrace,
		"15":    defaultShutdownGrace, // a bare number has no unit
	} {
		t.Setenv(shutdownGraceEnv, value)
		if got := shutdownGrace(); got != want {
			t.Errorf("%s=%q: %v, want %v", shutdownGraceEnv, value, got, want)
		}
	}
	if defaultShutdownGrace >= 10*time.Second {
		t.Fatal("the default must stay under Docker's 10 second stop timeout")
	}
}

func TestUsageCloseWritesWhatIsWaiting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	u := openTokenUsage(path)

	// Nothing waiting: nothing is written.
	u.close()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("close wrote a file when there was nothing to write")
	}

	// A use waits up to usageFlushDelay for its write; close must not.
	u.touch("tok-1", time.Now())
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("the write was not delayed")
	}
	u.close()
	if reopened := openTokenUsage(path); reopened.lastUsed("tok-1").IsZero() {
		t.Fatal("a use made just before the stop was lost")
	}

	// The delayed write is cancelled, and a second close is harmless.
	u.close()
	if u.timer != nil {
		t.Fatal("the delayed write is still scheduled")
	}
	var none *tokenUsage
	none.close()
}
