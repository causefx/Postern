# Running Postern

How to run Postern for real: Docker Compose, a reverse proxy, backups, upgrades, and what it connects to. The [README](../README.md) explains each setting; this page puts them together. Ready-made files are in [`examples/`](../examples/).

- [A sensible setup](#a-sensible-setup)
- [Docker Compose](#docker-compose)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Upgrading](#upgrading)
- [Backup and restore](#backup-and-restore)
- [What Postern connects to](#what-postern-connects-to)
- [When something is wrong](#when-something-is-wrong)

## A sensible setup

1. **Two listeners.** `LISTEN=:8080` serves only `/p/...`. `ADMIN_LISTEN=:8081` serves the admin UI and its API. The port you expose to the internet then has no admin UI on it at all.
2. **HTTPS in front.** Postern does not do TLS. Put Caddy, Traefik or nginx in front and set `POSTERN_SECURE=1`.
3. **The admin UI private.** Reach it from your own network, a VPN or an SSH tunnel. The proxy examples below refuse it for everyone else.
4. **Real client addresses.** Set `POSTERN_TRUSTED_PROXIES` to your proxy, or every caller shares one rate limit.
5. **Encryption at rest.** Set `POSTERN_KEY_FILE`, and keep a copy of the key away from the server.
6. **A backup that you have restored once.** See [Backup and restore](#backup-and-restore).
7. **A pinned version.** `ghcr.io/causefx/postern:1.0.0`, or `:1.0` for fixes only. `:latest` follows releases. `:edge` is built from every push to `main`, released or not, so do not run it in production.

## Docker Compose

[`examples/docker-compose.yml`](../examples/docker-compose.yml) is Postern on its own: the proxy on port 8080, the admin UI on `127.0.0.1:8081`, an encrypted data file, and a named volume.

```bash
cd examples
cp .env.example .env                      # set ADMIN_PASSWORD
openssl rand -base64 32 > postern.key     # the encryption key
docker compose up -d
```

Open `http://127.0.0.1:8081/admin/`. From another machine, use an SSH tunnel: `ssh -L 8081:127.0.0.1:8081 your-server`, then the same address on your own computer.

Notes:

- The image already has a health check that asks `http://127.0.0.1:8080/healthz`, so Compose does not need one. Keep `LISTEN` on port 8080 inside the container, or the container shows as unhealthy.
- On `docker compose stop`, Postern stops taking new requests and gives the ones in progress `POSTERN_SHUTDOWN_TIMEOUT` (8 seconds) to finish. Docker waits 10 seconds before it kills the container, so leave the timeout under that, or raise `stop_grace_period` with it.
- The data volume holds the data file, the settings file and the logs. The entrypoint fixes its ownership when it starts, so a bind mount (`./data:/data`) works too.
- To run without encryption, delete `POSTERN_KEY_FILE`, the `secrets` entries and the key file. The README's encryption section says what happens to an existing file when you add or remove a key.

## Behind a reverse proxy

Each example is a whole stack, Postern and the proxy, to copy and edit:

| Proxy | Files | Certificates |
|---|---|---|
| Caddy | [`examples/caddy/`](../examples/caddy/) | Caddy gets and renews them |
| Traefik v3 | [`examples/traefik/`](../examples/traefik/) | Let's Encrypt, through Traefik |
| nginx | [`examples/nginx/`](../examples/nginx/) | You bring them (`./certs`), or end HTTPS in front |

They all do the same thing, on **one hostname**:

```
https://postern.example.com/p/...   ->  postern:8080   open to the internet
https://postern.example.com/...     ->  postern:8081   your own networks only, 403 or 404 for anyone else
```

Postern itself is not published on any port. Only the proxy, on the Docker network, can reach it. They set the three things the README's sections explain:

- `POSTERN_SECURE=1`, because the proxy ends HTTPS and Postern has to hand out `Secure` cookies and `https://` addresses.
- `POSTERN_TRUSTED_PROXIES=private`, so Postern believes the client address the proxy passes on. On a Docker network that holds only the proxy and Postern, `private` is exactly those two. If other containers share the network, give the proxy's own address instead.
- A proxy that sets `X-Forwarded-For` itself. Caddy, Traefik and nginx's `$proxy_add_x_forwarded_for` all do.

They also send `Strict-Transport-Security`, which Postern leaves to the proxy.

### Check that the admin UI is private

The examples decide by the address a request comes from. That is only as good as the address the proxy sees. On Linux with Docker's normal port publishing it is the real one. Behind another proxy or load balancer, with Docker Desktop, or with some VPS "private network" setups, every request can look like it comes from a private address, and the admin UI is open to the world.

So **test it from outside**, from your phone on mobile data, or any machine that is not on your network:

```bash
curl -i https://postern.example.com/admin/     # expect 403 (Traefik, nginx) or 404 (Caddy), not a sign-in page
curl -i https://postern.example.com/p/nothing/ # expect 404 from Postern (no such service): the proxy is reachable
```

If the first one shows the sign-in page, remove the admin route from the proxy altogether and use an SSH tunnel to `127.0.0.1:8081` (publish `"127.0.0.1:8081:8081"` on the Postern service, as the standalone example does). The sign-in page also has a lockout, but do not rely on that alone.

### Two things that confuse people

- **Open the admin UI on the public name.** The UI builds the Proxy address it shows you, and the `curl` examples, from the address in your browser's bar. Open it through `https://postern.example.com/admin/` and you copy the right ones. Open it on `http://192.168.1.5:8081` and you copy that.
- **With `POSTERN_SECURE=1`, do not sign in over plain HTTP.** Postern then marks the session cookie `Secure`, and a browser will not keep it from a plain `http://` address, so sign-in appears to work and then bounces you back to the login page. Use the HTTPS name. Some browsers make an exception for `http://localhost`; do not count on it.

### Other proxies, and what to carry over

- Anything else (HAProxy, Apache, a cloud load balancer) needs the same things: route `/p/` to port 8080 and the rest to 8081 from your own networks only, set `X-Forwarded-For`, send HSTS, and set `Host`.
- **Do not buffer** responses from `/p/`. Postern sends each chunk on at once, so streaming APIs (server-sent events, chunked downloads) work. A proxy that buffers will hold them back.
- **Timeouts.** Postern waits up to 10 seconds to connect to an upstream and 60 seconds for it to start answering, then replies 502 itself. Keep your proxy's read timeout longer than that, so callers see Postern's answer and not the proxy's.
- **Body size.** nginx refuses request bodies over 1 MB by default (`client_max_body_size`). Raise it if callers upload through Postern.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

1. **Back up first.** See below. It takes a minute and it is the only way back.
2. Read the release notes for what you skip. The header shows a **vX.Y.Z available** pill, and its dialog lists every release between yours and the latest.
3. Pull and restart. The data file and settings file from an earlier 1.x load as they are.
4. Check the log (`docker compose logs postern`) and that the version in the header is the one you wanted.

To go back, put the backup you took before the upgrade in place and start the older image tag. Do not try to run an older version on files a newer one has written.

## Backup and restore

### What there is

Everything lives in one directory: `/data` in Docker, `data/` otherwise.

| File | Back it up? | Holds |
|---|---|---|
| `postern-data.json` | **Yes** | Your services, upstream keys and caller tokens. Encrypted when a key is set |
| `postern-settings.json` | **Yes** | The settings. No secrets |
| `postern-data.json.audit`, `.audit.1` | Optional | The admin log |
| `postern-data.json.activity` | Optional | Recent requests |
| `postern-data.json.usage` | Optional | When each token last signed a request. Losing it only resets "last used" |

The encryption key is **not** in that directory. It is wherever `POSTERN_KEY` or `POSTERN_KEY_FILE` points.

### The key

If the data file is encrypted, a backup of it is **useless without the key**, and the key cannot be recovered if you lose it. So:

- Keep a copy of the key somewhere other than the server and other than the backups: a password manager, or a printout in a drawer. A backup that sits next to its key gives away everything if either leaks.
- Back up the data and the key separately, and check once that the pair works (below).
- If you change the key (`postern rekey`), back up the new one before you delete the old.

### Making a backup

The data file is written to a temporary file and then renamed into place, so a copy taken while Postern runs is always a whole file. You do not need to stop it.

**Docker Compose**, from the directory with the compose file:

```bash
mkdir -p backup
docker compose cp postern:/data/. ./backup/
```

Put that folder somewhere safe, and the key somewhere else. Copy the folder with the date in its name, and keep the last few.

**Without Docker:** copy `postern-data.json` and `postern-settings.json`. `cp` is enough.

**From the UI:** **Settings, Export config, Full backup** writes every service, upstream key and token to one JSON file. It is a good way to move services to another instance or to keep a second copy, but it holds the secrets in plain text, covers services only (not the settings) and is not encrypted. Treat it like an unencrypted data file.

### Restoring

1. Stop Postern: `docker compose stop postern`.
2. Put the files back. For Docker Compose:
   ```bash
   docker compose cp ./backup/. postern:/data/
   ```
   `docker compose cp` also works on a stopped container. The entrypoint fixes the file ownership on the next start.
3. Make sure the key is the one the data file was encrypted with.
4. Check the files without starting the server:
   ```bash
   docker compose run --rm postern check
   ```
   It prints `ok`, or says what is wrong. It never changes a file. With the wrong key it says so. With no key it can only tell that the encrypted file is intact, not what is in it, so run it with the key set.
5. Start it: `docker compose up -d`.

What a restore does not bring back: services, tokens or settings you changed after the backup. A caller using a token that was created after the backup will be refused until you issue them a new one.

### Check your backup before you need it

Once, on a spare machine or in a scratch directory, restore the files and the key and run `check` on them (or start Postern on another port). A backup you have never restored is a hope, not a backup.

## What Postern connects to

Postern makes **no connection you did not set up**. There is no telemetry, and the admin UI loads no fonts, scripts or images from other sites (its Content-Security-Policy would block them).

| What | When | Where to | What it sends | Turn it off |
|---|---|---|---|---|
| **Update check** | About a minute after start, then once a day | `https://api.github.com/repos/causefx/Postern/releases` | A plain `GET` with the user agent `postern-update-check`. Nothing about your instance | `POSTERN_UPDATE_CHECK=off` |
| **Proxied requests** | Every call to `/p/...` | The service's upstream URL | The caller's request, with your upstream credential added | Pause or delete the service |
| **Test connection** | When you press **Test** in the service drawer | The upstream URL in the form | A `GET` with the credential in the form, a few redirects at most, 5 seconds | Do not press it |
| **OpenID Connect sign-in** | When someone signs in with it | Your provider's issuer, its keys and token endpoint | The standard authorization code exchange | Unset `POSTERN_OIDC_ISSUER` |

All of them honour `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, so a host that must go through a proxy can set those.

If Postern runs behind a firewall that blocks outbound traffic, allow the upstream hosts of your services, your OIDC provider if you use one, and `api.github.com:443` for the update check, or turn the check off. A blocked update check only shows a message in the update dialog. It never affects the proxy.

## When something is wrong

**Every caller shares one rate limit, or five failed sign-ins lock everyone out.** Postern sees only the proxy's address. Set `POSTERN_TRUSTED_PROXIES`, and make sure the proxy sets `X-Forwarded-For`. The log has a line when a client is rate limited and one when an address is locked out, showing which address was counted.

**Sign-in works, then you are back at the login page.** `POSTERN_SECURE=1` is set and you are on plain HTTP. Use the HTTPS name. Or `POSTERN_SECURE` is unset behind an HTTPS proxy, and the cookie is not marked `Secure`: set it.

**The Proxy address in the UI is wrong** (the wrong host, or `http://`). It comes from the address in your browser's bar, and from `POSTERN_SECURE` for the scheme. Open the admin UI on the public name.

**The container is "unhealthy".** The health check asks `127.0.0.1:8080/healthz` inside the container. If you changed `LISTEN` to another port, change the check to match.

**Postern cannot read the key file.** The container drops to an unprivileged user (uid 65532) before it reads `POSTERN_KEY_FILE`, so the file must be readable by everyone, as one made with `openssl rand ... > postern.key` is. A file set to `chmod 600` and owned by you is not.

**It will not start, and says the data file is encrypted.** Either the key is missing or it is the wrong one. Nothing is written when that happens. Fix the key; do not delete the file.

**A caller gets 502.** Postern could not reach the upstream, or the upstream took too long (10 seconds to connect, 60 to start answering). The reply is always `502 upstream unavailable`, and the log says why. Use **Test** in the service drawer, and check that Postern's container can reach the upstream's address. From inside a container, `localhost` is the container itself.

**The admin UI opens inside a dashboard and stays blank.** Embedding is off by default. See the README's "Browser protections and embedding".
