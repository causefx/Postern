# Contributing to Postern

Thanks for wanting to help. Bug reports, fixes, documentation and ideas are all welcome.

Postern is **source-available** under the [PolyForm Shield License 1.0.0](LICENSE), not an open-source license. You can read it, run it, change it and share your changes, but you cannot use it to build a competing product or service. Please read the license and the agreement below before you send code.

## Before you start

- **Small fixes** (typos, bugs, docs): just open a pull request.
- **New features or behaviour changes**: open an issue first and describe what you want and why, so you don't build something that won't be merged. Postern is deliberately small, so some good ideas will still be declined.
- **Security problems**: do not open a public issue. Report them privately through GitHub's "Report a vulnerability" on the repository's Security tab.

## Contributor agreement

By opening a pull request, or otherwise sending code, documentation or other material (a "Contribution") to this project, you agree that:

1. **It is yours to give.** You wrote the Contribution, or you have the right to submit it, and it does not break anyone else's rights. If your employer has rights in what you write, you have their permission.
2. **You keep your copyright.** You are not handing it over.
3. **You grant a license.** You give the maintainer (causefx) and everyone who receives Postern from the maintainer a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, copy, modify, distribute, sublicense and relicense your Contribution, under the PolyForm Shield License or any other terms, including commercial terms.
4. **You grant a patent license.** The same people get a perpetual, worldwide, royalty-free, irrevocable license under any patent claims you can license that your Contribution would infringe.
5. **It comes as is.** The Contribution is provided without warranty.

The pull request template has a checkbox that confirms this. A pull request without it ticked will not be merged. If you can't agree to these terms, an issue describing the change is just as useful and costs you nothing.

## Working on the code

You need Go (the version in `go.mod`) and Node 22 or later. The server uses only the Go standard library, so don't add a dependency without discussing it first.

```bash
npm install
npm run dev      # Tailwind watch + the server, rebuilt when a .go file is saved
```

`npm run dev` serves the UI from `web/` on disk (refresh the browser to see changes), listens on `127.0.0.1:8080` and signs in with the password `dev`. To reach it from another machine, set `LISTEN` and your own `ADMIN_PASSWORD`; see `scripts/dev.mjs`.

Before you push:

```bash
go vet ./...
go test ./...        # CI also runs it with -race
npm run build:css    # only if you changed web/input.css or a class name; web/app.css is committed minified
cd e2e && npm ci && npm test    # browser tests of the admin UI, if you changed web/ (see e2e/README.md)
```

`npm run dev` rewrites `web/app.css` unminified while it runs. Run `npm run build:css` before you commit it; CI rebuilds the file and fails if it differs.

Some conventions:

- Add or update tests with the change. Look at the neighbouring `*_test.go` files for how the proxy, store and admin handlers are set up.
- Admin API writes need the header `X-Postern-Admin: 1` (the CSRF guard). Use it in `curl` tests.
- Never put a secret in the audit log, the request log, the usage file, a log line or an error body.
- The admin UI is plain JavaScript modules with no framework and no inline scripts or styles, because of its Content-Security-Policy. Use the theme variables in `web/input.css`, not fixed colours, so light and dark both work.
- Animation goes through `web/js/lib/motion.js` (`rise`, `reveal`, `expand`, `slideIn`, `pop`), which builds on a vendored copy of [Motion](https://motion.dev)'s mini build in `web/js/vendor/`. It does nothing for people who prefer reduced motion. The dashboard repaints itself on every state change, so play an entrance once per item with `reveal` and a stable key, never from a render function directly. To upgrade Motion, bump `motion` in `package.json` and run `npm run vendor:motion`.
- Keep user-facing text plain and short.

## Pull requests

- Use a [Conventional Commit](https://www.conventionalcommits.org/) title, for example `fix: refuse dot segments in proxied paths` or `feat: add a per-service IP allowlist`. The title is the commit on `main` after a squash merge, and it decides the next version (`fix:` patch, `feat:` minor). CI checks it.
- One change per pull request, with a description of what changed and why.
- Releases are cut by the maintainer through Release Please. Don't edit `CHANGELOG.md` or `cmd/postern/version.go`, and don't push version tags.
