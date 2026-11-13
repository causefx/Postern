package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// defaultShutdownGrace is how long in-flight requests get to finish after a stop signal. Docker
// kills a container 10 seconds after `docker stop`, so the default stays under that.
const defaultShutdownGrace = 8 * time.Second

const shutdownGraceEnv = "POSTERN_SHUTDOWN_TIMEOUT"

// shutdownGrace reads POSTERN_SHUTDOWN_TIMEOUT, a Go duration such as "20s". A missing, invalid or
// non-positive value means the default.
func shutdownGrace() time.Duration {
	v := os.Getenv(shutdownGraceEnv)
	if v == "" {
		return defaultShutdownGrace
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		log.Printf("%s=%q is not a positive duration such as 20s; using %s", shutdownGraceEnv, v, defaultShutdownGrace)
		return defaultShutdownGrace
	}
	return d
}

// serveUntil runs the servers until ctx is cancelled or one of them fails to listen. It then stops
// accepting connections and gives requests already in progress up to grace to finish; anything
// still running after that is cut off. It returns the listen error that ended it, if any, and
// returns only once every server has stopped.
func serveUntil(ctx context.Context, grace time.Duration, servers ...*http.Server) error {
	failed := make(chan error, len(servers))
	for _, s := range servers {
		go func() {
			if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				failed <- fmt.Errorf("listen on %s: %w", s.Addr, err)
			}
		}()
	}

	var serveErr error
	select {
	case <-ctx.Done():
		log.Printf("stopping: letting requests in progress finish (up to %s)", grace)
	case serveErr = <-failed:
		log.Printf("%v; stopping", serveErr)
	}

	sctx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	var wg sync.WaitGroup
	for _, s := range servers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.Shutdown(sctx); err != nil {
				log.Printf("%s: requests still running after %s were cut off", s.Addr, grace)
				_ = s.Close()
			}
		}()
	}
	wg.Wait()
	return serveErr
}
