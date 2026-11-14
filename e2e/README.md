# Browser tests for the admin UI

[Playwright](https://playwright.dev) drives a real browser against a real Postern binary. It covers
sign-in, the account menu, the command palette, the settings drawer, the service drawer, export and
import, and a phone-sized layout. It lives in its own package so the Docker build never installs it.

```bash
cd e2e
npm ci
npx playwright install chromium     # once; CI uses --with-deps
npm test                            # builds ./cmd/postern, starts it, runs every test
```

Handy locally:

```bash
npm run test:headed                              # watch it
npx playwright test palette                      # one file
E2E_CHANNEL=msedge npm test                      # use the Edge or Chrome you already have
npx playwright show-report                       # after a run, with traces for any failure
```

## How it works

- `server.mjs` builds the binary into a temp folder and starts it with a fresh data directory, the
  admin password `e2e-password`, and update checks off. It serves the UI **embedded in the binary**,
  not from `web/`, so the tests see what ships. Set `E2E_BIN` to a prebuilt binary to skip the build,
  and `E2E_PORT` (default 18080) if the port is taken.
- `global-setup.js` signs in once through the API and saves the session, so only `login.spec.js` uses
  the form.
- One worker, one server, one data file. Tests make their own services with unique names (`svc`
  fixture) and delete them afterwards. Settings are shared, so the settings tests reset them.

## Every test also checks the console

The automatic `problems` fixture in `tests/fixtures.js` fails a test if the page throws, logs an error,
or the browser blocks something under the Content-Security-Policy. The UI has a strict CSP with no
inline script or style, so this is what catches a stray one. A test that causes an error on purpose
says so with `problems.allow(/pattern/)`; the browser logs every refused request (a 400 or a 401) as
"Failed to load resource", which is the usual one to allow.

## Writing tests

- Find things the way a person would: by role, label or visible text. The UI has `aria-label`s on its
  controls. Avoid CSS classes unless there is no other handle (`.settings-row-head` is one).
- Dialogs made with `<dialog>` have a heading but no accessible name. Use
  ``page.locator('dialog[open]', { hasText: 'Title' })``.
- The desktop table and the phone list are both in the page, one hidden by CSS. Phone tests pick
  `.mobile-row[data-name="..."]`.
- Drawers slide in. Wait for `toBeInViewport({ ratio: 1 })` before measuring them.
- The admin API has no call for one service. Read the list and find it.
- Reduced motion is on, so Motion does nothing, but CSS transitions still run.
- When you fix a UI bug, add a test that fails without the fix. Put the old behaviour back and watch it
  fail before you trust it. For example, the palette test that checks hovering keeps the same row
  element was proved this way.

## What this does not cover

Real phones (swipe and long-press on the phone list, safe-area insets, the iOS and Android header
colour), Safari and Firefox, OpenID Connect sign-in (it needs an identity provider), and anything
behind a reverse proxy. The mobile project only catches layout that breaks outright.
