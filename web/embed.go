// Package web is the embedded admin UI (HTML, CSS, JS, fonts, icons).
package web

import "embed"

//go:generate npm --prefix .. run build:css

//go:embed index.html
var IndexHTML []byte

//go:embed login.html
var LoginHTML []byte

//go:embed app.css
var AppCSS []byte

//go:embed js
var JS embed.FS

//go:embed fonts
var Fonts embed.FS

//go:embed icons
var Icons embed.FS
