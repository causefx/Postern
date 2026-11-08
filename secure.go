package main

import (
	"net/http"
	"os"
	"strings"
)

// secureMode controls cookie Secure / public HTTPS detection.
// -1 = auto (direct TLS only; does not trust X-Forwarded-Proto)
//  0 = force plain HTTP cookies / http origins
//  1 = force Secure cookies / https origins (use behind a TLS-terminating proxy)
var secureMode = parseSecureMode(os.Getenv("POSTERN_SECURE"))

func parseSecureMode(v string) int {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return 1
	case "0", "false", "no", "off":
		return 0
	default:
		return -1
	}
}

// isHTTPS reports whether Postern should treat the request as HTTPS.
// Set POSTERN_SECURE=1 when TLS is terminated upstream of Postern.
func isHTTPS(r *http.Request) bool {
	switch secureMode {
	case 1:
		return true
	case 0:
		return false
	default:
		return r.TLS != nil
	}
}
