// Package apps holds the self-hosted apps Postern knows: one folder per app, named by its id, with
// an app.json (how to recognise it and how it takes its key) and an icon.svg. See README.md for how
// to add an app.
//
// The server (cmd/postern/apps.go) checks every folder at start-up, uses the match rules to detect
// apps, and hands the browser a trimmed list. Nothing in this folder is code.
package apps

import "embed"

//go:embed */app.json */icon.svg LICENSES
var FS embed.FS
