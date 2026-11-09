# Postern

A small reverse proxy that puts a front door on private services: callers get a Postern token (or use the service’s own auth shape), while the real upstream credential never leaves this server.

## Version

Current release series: **0.1.x**. Source default is `0.1.0` ([`version.go`](version.go)).

```bash
go build -ldflags "-X main.Version=1.2.3" -o postern .
```

Docker/CI inject the same via build-arg `VERSION` (git tag `v1.2.3` → `1.2.3`). The version appears in startup logs, `/admin/api/meta`, the admin header, and the login footer.

## Quick start

```bash
export ADMIN_PASSWORD='choose-a-strong-password'
go run .
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
- After 5 failed logins from one IP, further attempts are rejected for 1 minute.
- Prefer keeping the admin UI off the public internet.

**Separate admin listener (recommended):**

```bash
export LISTEN=:8080                 # public proxy only (/p/...)
export ADMIN_LISTEN=127.0.0.1:8081  # admin UI/API on localhost
```

Point a private reverse proxy or SSH tunnel at `ADMIN_LISTEN`. Leave `ADMIN_LISTEN` unset only when proxy and admin intentionally share one port.

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

- Default access mode requires the Postern-issued token (`Authorization: Bearer …`, `X-Proxy-Token`, or `?token=`).
- Prefer **Bearer** or **`X-Proxy-Token`**. Query-string tokens can leak via access logs, `Referer`, and browser history.
- Upstream credentials are multi-slot: a service can use a **request header**, a **URL parameter**, and/or **Authorization** (Bearer or Basic) at once. Postern injects every enabled slot on outbound requests.
- `access: upstream` accepts a matching value in **any one** of those places — the Postern token or the real secret for that slot (by design). Anyone who knows a real upstream key can call Postern in that mode.

### Open paths

Per service you can list **open paths** that skip the caller token check (useful for health checks or public webhooks). Postern still injects the stored upstream credential.

- **Prefix** — matches the start of the proxied path (e.g. `/health` matches `/health` and `/health/ready`). Cannot be `/` alone.
- **Regex** — Go regexp against the proxied path; anchor with `^` / `$` when you need an exact match (e.g. `^/webhooks/[^/]+$`).

Open paths are reachable by anyone who can hit the proxy port. Keep the list short and specific.

### Data file

Service config (including upstream secrets and Postern tokens) lives in `POSTERN_DATA` (default `data/postern-data.json`, or `/data/postern-data.json` in Docker). Treat it like a secrets store; back it up privately.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `LISTEN` | `:8080` | Proxy listen address (`/p/...`) |
| `ADMIN_LISTEN` | _(empty)_ | If set, admin UI/API bind here only |
| `ADMIN_PASSWORD` | _(generated)_ | Admin sign-in password |
| `POSTERN_DATA` | `data/postern-data.json` | JSON store path |
| `POSTERN_SECURE` | _(auto)_ | Cookie / origin HTTPS mode (see above) |
| `POSTERN_DEV` | _(off)_ | Serve UI from `./static` on disk (no rebuild for JS/HTML/CSS). Run from repo root; use `npm run dev:css` in another terminal for Tailwind. |
