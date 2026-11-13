# Postern

A small reverse proxy that puts a front door on private services: callers get a Postern token (or use the service’s own auth shape), while the real upstream credential never leaves this server.

## Layout

| Path | What it is |
|---|---|
| `cmd/postern/` | The server: proxy, admin API, store, sessions |
| `web/` | Admin UI (HTML, CSS, JS). Embedded into the binary |
| `data/` | Local config and design references. Not part of the build |

## Releases

Versions follow [semantic versioning](https://semver.org/). `0.1.0` in [`cmd/postern/version.go`](cmd/postern/version.go) is the baseline already shipped in source. Later versions come from commit messages on `main`.

One release is one git tag, one GitHub Release, and one container image:

| | |
|---|---|
| Git tag | `v1.2.3` |
| GitHub Release | `v1.2.3`, with the changelog |
| Image | `ghcr.io/causefx/postern:1.2.3` (linux/amd64 and linux/arm64), also tagged `1.2` and `latest` |

Every other push to `main` publishes `ghcr.io/causefx/postern:edge` (and `sha-<short>`). Those tags move continuously and are not releases. Tests (`go vet`, `go test -race`) must pass before anything is published. A new GHCR package is private until its visibility is changed in the package settings.

1. Open a pull request whose title is a [Conventional Commit](https://www.conventionalcommits.org/). Squash-merge it so that title is the commit on `main`.
   - `fix:` patch, `0.1.0` → `0.1.1`
   - `feat:` minor, `0.1.0` → `0.2.0`
   - `feat!:` or a `BREAKING CHANGE:` footer bumps the minor while the version is still `0.x`. Put `Release-As: 1.0.0` in the commit footer to cut the first stable major.
   - `docs:`, `chore:`, `refactor:`, `test:`, `ci:` do not cut a release
2. Release Please opens a Release pull request that bumps `cmd/postern/version.go` and `CHANGELOG.md`.
3. Merge that pull request. GitHub creates tag `vX.Y.Z` and the Release, then builds the image with that version and adds the image name to the Release notes.

Do not push `vX.Y.Z` tags by hand. Releases are published only by the Release workflow, so the changelog, tag, binary version and image stay together.

```bash
go build -ldflags "-X main.Version=1.2.3" -o postern ./cmd/postern
```

The running version shows in the startup log, `/admin/api/meta`, the admin header, and the login footer.

## Quick start

```bash
export ADMIN_PASSWORD='choose-a-strong-password'
go run ./cmd/postern
# UI: http://127.0.0.1:8080/admin/
```

Docker:

```bash
docker run --rm -p 8080:8080 \
  -e ADMIN_PASSWORD='choose-a-strong-password' \
  -v postern-data:/data \
  ghcr.io/causefx/postern:latest
```

## Security

### Admin UI

- Sign-in uses `ADMIN_PASSWORD` (required in production; a random one is generated for the run if unset).
- Sessions are an HMAC cookie derived from `ADMIN_PASSWORD`. Restarting Postern keeps you signed in. Changing the password signs everyone out.
- After 5 failed logins from one IP, further attempts are rejected for 1 minute.
- Optional OpenID Connect sign-in (Pocket ID and similar) sits beside the password. See below.
- Prefer keeping the admin UI off the public internet.

**Separate admin listener (recommended):**

```bash
export LISTEN=:8080                 # public proxy only (/p/...)
export ADMIN_LISTEN=127.0.0.1:8081  # admin UI/API on localhost
```

Point a private reverse proxy or SSH tunnel at `ADMIN_LISTEN`. Leave `ADMIN_LISTEN` unset only when proxy and admin intentionally share one port.

### OpenID Connect

Set `POSTERN_OIDC_ISSUER` and `POSTERN_OIDC_CLIENT_ID` to add a second button on the sign-in page. The admin password still works. Postern uses the authorization code flow with PKCE, checks the ID token (RS256, ES256, or EdDSA), and then issues the same admin session cookie. It does not keep the provider's tokens.

In Pocket ID, add a confidential client, turn on PKCE, and set the callback URL to `https://<admin host>/admin/oidc/callback`. Copy the issuer URL, client ID, and client secret. On the client's Access tab, choose the groups that may sign in. Behind a TLS proxy, set `POSTERN_SECURE=1`.

| Variable | Meaning |
|---|---|
| `POSTERN_OIDC_ISSUER` | Issuer URL from the provider (Pocket ID shows this under the client) |
| `POSTERN_OIDC_CLIENT_ID` | Client ID |
| `POSTERN_OIDC_CLIENT_SECRET` | Client secret. Leave empty only for a public client |
| `POSTERN_OIDC_REDIRECT` | Callback URL, if the public origin is not the host Postern sees |
| `POSTERN_OIDC_LABEL` | Button text. Default `Sign in with SSO` |
| `POSTERN_OIDC_SCOPES` | Default `openid email profile groups` |
| `POSTERN_OIDC_EMAIL` | Optional comma-separated emails that may become admin |
| `POSTERN_OIDC_GROUP` | Optional comma-separated group names. The ID token must include one |

If neither email nor group is set, anyone the provider releases for that client can administer Postern. Use the provider's allowed-groups control, or set one of these, when the client is open to every user.

Settings has an **Admin password** switch once OIDC is configured. Turning it off requires a successful test sign-in in this browser, then Save. Until that save, the password still works. Restarting without the OIDC environment variables turns the password back on, even if the switch was saved off.

### HTTPS and cookies

Session cookies are `HttpOnly` + `SameSite=Lax`. The `Secure` flag follows `POSTERN_SECURE`:

| `POSTERN_SECURE` | Behavior |
|---|---|
| unset | `Secure` only when Postern itself terminates TLS (`r.TLS`). `X-Forwarded-Proto` is **not** trusted. |
| `1` / `true` | Always `Secure` cookies and `https://` public origins. Use this behind a TLS-terminating reverse proxy. |
| `0` / `false` | Force plain HTTP (local/dev only). |

```bash
# Example: Caddy/nginx terminates TLS, Postern listens on HTTP internally
export POSTERN_SECURE=1
```

### Caller tokens on `/p/...`

- Default access mode requires a Postern-issued caller token. By default that is accepted as `Authorization: Bearer …`, `X-Proxy-Token`, or `?token=`. Per service you can narrow or rename those places (any one enabled place is enough).
- A service can hold up to 8 named caller tokens. Any one of them is enough, and the last one cannot be deleted. Pausing a token refuses that caller with 403 `token paused` until it is resumed. An older file with a single `token` loads as a token named `default`; saves still write that field as the first secret.
- A switched-off service answers `403` with `service disabled`. An unknown name is `404`.
- Each service and client IP can make `settings.rateLimit` proxy requests per minute (default 120, at most 10000), including open paths. Set it to 0 to turn the limit off. The next request over the limit is `429` with an empty body. Admin routes are not counted. The limit uses the connection address, not a forwarded header. The Settings drawer saves it immediately. A hand edit applies on restart.
- Caller `Cookie` headers are removed before the upstream credential is added.
- Dial and TLS handshake wait 10s, response headers 60s, and idle connections 90s. Streams keep flushing after the headers arrive. An upstream that never sends headers returns `502`.
- Prefer **Bearer** or a dedicated header. Query-string tokens can leak via access logs, `Referer`, and browser history.
- Upstream credentials are multi-slot: a service can use a **request header**, a **URL parameter**, and/or **Authorization** (Bearer or Basic) at once. Postern injects every enabled slot on outbound requests.
- `access: upstream` accepts a matching value in **any one** of those places — the Postern token or the real secret for that slot (by design). Anyone who knows a real upstream key can call Postern in that mode.

### Open paths

Per service you can list **open paths** that skip the caller token check (useful for health checks or public webhooks). Postern still injects the stored upstream credential.

- **Prefix** — matches the start of the proxied path (e.g. `/health` matches `/health` and `/health/ready`). Cannot be `/` alone.
- **Regex** — must start with `^`. Go regexp against the proxied path (e.g. `^/webhooks/[^/]+$`). An unanchored pattern is rejected.

Open paths are reachable by anyone who can hit the proxy port. Keep the list short and specific.

### Data file

Service config (including upstream secrets and Postern tokens) lives in `POSTERN_DATA` (default `data/postern-data.json`, or `/data/postern-data.json` in Docker). Treat it like a secrets store; back it up privately.

Admin changes are appended beside that file as `POSTERN_DATA.audit` (create, update, enable, rotate, token add, token revoke, duplicate, delete, settings). Lines do not include secrets or query strings. The Settings activity list keeps the newest `settings.auditLimit` lines (default 100, at most 5000). At about 1 MB the current file is renamed to `.audit.1` and a new one starts.

Recent proxy requests (the Recent column and the Usage list) are kept beside the data file as `POSTERN_DATA.activity`. The Recent column names the caller token on the latest request (`open`, `rejected`, `off`, `limited`, or `upstream` when it was not a token). A paused token keeps its name and is marked paused. How many each service keeps is `settings.activityLimit` in the data file (default 20, at most 1000). Paths are stored with query secrets redacted. Deleting a service removes its entries. The Settings drawer saves the limit immediately and trims the log. A hand edit applies on restart.

`GET /healthz` on the proxy listener and the admin listener returns `ok` with no authentication and does not call an upstream.

Check a data file without starting the server:

```bash
POSTERN_DATA=data/postern-data.json go run ./cmd/postern check
```

Problems go to stderr and the command exits 1. A valid file prints `ok` and exits 0.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `LISTEN` | `:8080` | Proxy listen address (`/p/...`) |
| `ADMIN_LISTEN` | _(empty)_ | If set, admin UI/API bind here only |
| `ADMIN_PASSWORD` | _(generated)_ | Admin sign-in password |
| `POSTERN_DATA` | `data/postern-data.json` | JSON store path |
| `POSTERN_SECURE` | _(auto)_ | Cookie / origin HTTPS mode (see above) |
| `POSTERN_DEV` | _(off)_ | Serve UI from `./web` on disk (no rebuild for JS/HTML/CSS). Run from repo root; use `npm run dev:css` in another terminal for Tailwind. |
| `POSTERN_OIDC_ISSUER` | _(off)_ | OpenID Connect issuer. Also set `POSTERN_OIDC_CLIENT_ID`. See above |
