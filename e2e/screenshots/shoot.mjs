// Takes a screenshot of every screen of the admin UI: desktop and phone, dark and light.
//
//   cd e2e && npm run screenshots          (E2E_CHANNEL=msedge to use the Edge you already have)
//
// It starts a fresh Postern (the same server.mjs the tests use, on its own port), fills it with a
// believable set of services and some traffic, then walks the screens. Pictures go to
// e2e/screenshots/out/<viewport>-<theme>/NN-name.png. That folder is ignored by git; copy what you
// want into docs/. A screen that cannot be reached is reported at the end and does not stop the rest.

import { chromium, request } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const e2eDir = resolve(here, '..');
const outRoot = join(here, 'out');
const PORT = process.env.SHOT_PORT || '18090';
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'e2e-password';
const only = process.env.SHOT_ONLY ? new RegExp(process.env.SHOT_ONLY) : null;
const view = process.env.SHOT_VIEW || '';
const wanted = (kind, theme) => !view || view === `${kind}-${theme}`;

const failures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const firstLine = (text) => String(text).split(/\r?\n/)[0];

// ---------------------------------------------------------------- a stand-in for the upstream apps

const upstream = http.createServer((req, res) => {
  const delay = 8 + Math.floor(Math.random() * 60);
  setTimeout(() => {
    if (req.url.includes('/fail')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"error":"internal"}');
    } else if (req.url.includes('/missing')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    }
  }, delay);
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamURL = `http://127.0.0.1:${upstream.address().port}`;

// ---------------------------------------------------------------- the server

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: e2eDir,
  env: { ...process.env, E2E_PORT: PORT, E2E_PASSWORD: PASSWORD },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

async function stopAll() {
  server.kill();
  upstream.close();
  await sleep(400);
}
process.on('SIGINT', async () => {
  await stopAll();
  process.exit(130);
});

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${BASE}/healthz`)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 240) throw new Error('Postern did not start');
  await sleep(500);
}

// ---------------------------------------------------------------- the admin API, for seeding

const admin = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { 'X-Postern-Admin': '1' } });
{
  const res = await admin.post('/admin/api/login', { data: { password: PASSWORD, remember: true } });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()}`);
}
const storageState = await admin.storageState();

async function call(method, path, data) {
  const res = await admin[method](`/admin/api/${path}`, data === undefined ? {} : { data });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${text}`);
  return body;
}

const inDays = (n) => new Date(Date.now() + n * 86400_000).toISOString();

const SERVICES = [
  {
    name: 'sonarr', pretty: 'http://sonarr:8989',
    auth: { header: { name: 'X-Api-Key', secret: 'sonarr-api-key-0123456789' }, query: { name: 'apikey', secret: 'sonarr-api-key-0123456789' } },
    openPaths: [{ match: 'prefix', path: '/ping' }],
  },
  { name: 'radarr', pretty: 'http://radarr:7878', auth: { header: { name: 'X-Api-Key', secret: 'radarr-api-key-0123456789' } } },
  {
    name: 'plex', pretty: 'http://192.168.1.20:32400',
    auth: { query: { name: 'X-Plex-Token', secret: 'plex-token-0123456789' } },
    openPaths: [{ match: 'prefix', path: '/identity' }, { match: 'regex', path: '^/web/[^/]+$' }],
  },
  { name: 'home-assistant', pretty: 'http://homeassistant.local:8123', auth: { authz: { kind: 'bearer', username: '', secret: 'ha-long-lived-token-0123456789' } } },
  { name: 'grafana', pretty: 'http://grafana:3000', auth: { authz: { kind: 'basic', username: 'viewer', secret: 'grafana-password-0123' } } },
  { name: 'paperless', pretty: 'http://paperless:8000', auth: { authz: { kind: 'bearer', username: '', secret: 'paperless-token-0123456789' } } },
  { name: 'jellyfin', pretty: 'http://jellyfin:8096', auth: { header: { name: 'X-Emby-Token', secret: 'jellyfin-token-0123456789' } }, enabled: false },
  { name: 'sabnzbd', pretty: 'http://sabnzbd:8080', auth: { query: { name: 'apikey', secret: 'sabnzbd-api-key-0123456789' } } },
];

async function seed() {
  const made = {};
  for (const s of SERVICES) {
    made[s.name] = await call('post', 'services', {
      name: s.name, url: upstreamURL, auth: s.auth, openPaths: s.openPaths || [], enabled: s.enabled !== false,
    });
  }
  // Extra tokens: one limited to reading, one paused, one that expires soon.
  const sonarr = made.sonarr;
  const dash = await call('post', 'services/sonarr/tokens', { name: 'dashboard' });
  const dashTok = dash.tokens.find((t) => t.name === 'dashboard');
  await call('patch', `services/sonarr/tokens/${dashTok.id}`, {
    scope: { methods: ['GET', 'HEAD'], paths: [{ match: 'prefix', path: '/api/v3' }] },
  });
  const phone = await call('post', 'services/sonarr/tokens', { name: 'phone' });
  const phoneTok = phone.tokens.find((t) => t.name === 'phone');
  await call('patch', `services/sonarr/tokens/${phoneTok.id}`, { paused: true });
  const rad = made.radarr;
  await call('patch', `services/radarr/tokens/${rad.tokens[0].id}`, { expiresAt: inDays(45) });
  const homepage = await call('post', 'services/plex/tokens', { name: 'homepage' });
  const hpTok = homepage.tokens.find((t) => t.name === 'homepage');

  // Traffic through the proxy, so the Recent column and the request log have something in them.
  const caller = await request.newContext({ baseURL: BASE });
  const hit = async (name, path, token, method = 'GET') => {
    await caller.fetch(`/p/${name}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, failOnStatusCode: false });
  };
  const defaultTok = (n) => made[n].tokens[0].secret;
  for (let i = 0; i < 6; i++) await hit('sonarr', '/api/v3/series', defaultTok('sonarr'));
  for (let i = 0; i < 3; i++) await hit('sonarr', '/api/v3/queue', dashTok.secret);
  await hit('sonarr', '/api/v3/series', dashTok.secret, 'POST'); // outside the token's scope
  await hit('sonarr', '/api/v3/missing', defaultTok('sonarr'));
  await hit('sonarr', '/api/v3/series', 'not-a-real-token');
  await hit('sonarr', '/ping', 'x');
  await hit('radarr', '/api/v3/movie', defaultTok('radarr'));
  await hit('radarr', '/api/v3/movie/lookup', defaultTok('radarr'));
  await hit('radarr', '/api/v3/fail', defaultTok('radarr'));
  for (let i = 0; i < 4; i++) await hit('plex', '/library/sections', hpTok.secret);
  await hit('plex', '/identity', 'x');
  for (let i = 0; i < 3; i++) await hit('home-assistant', '/api/states', defaultTok('home-assistant'));
  await hit('grafana', '/api/search', defaultTok('grafana'));
  await hit('paperless', '/api/documents/', defaultTok('paperless'));
  await hit('jellyfin', '/Users', defaultTok('jellyfin')); // service is off
  await hit('sabnzbd', '/api?mode=queue', defaultTok('sabnzbd'));
  await caller.dispose();

  // Now give each service the address it would really have. The request log keeps its entries.
  const now = await call('get', 'services');
  for (const s of SERVICES) {
    const cur = now.find((x) => x.name === s.name);
    const a = cur.auth;
    await call('put', `services/${s.name}`, {
      name: s.name, url: s.pretty, enabled: cur.enabled, access: cur.access, gate: cur.gate, openPaths: cur.openPaths || [],
      auth: {
        header: a.header ? { name: a.header.name, secret: '' } : null,
        query: a.query ? { name: a.query.name, secret: '' } : null,
        authz: a.authz ? { kind: a.authz.kind, username: a.authz.username || '', secret: '' } : null,
      },
    });
  }
  return made;
}

// ---------------------------------------------------------------- the browser

const launchOpts = { channel: process.env.E2E_CHANNEL || undefined };
const browser = await chromium.launch(launchOpts);

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

async function newPage(kind, theme, { signedIn }) {
  const context = await browser.newContext({
    ...VIEWPORTS[kind],
    colorScheme: theme,
    reducedMotion: 'reduce',
    baseURL: BASE,
    storageState: signedIn ? storageState : undefined,
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('postern.theme', t);
    } catch {
      /* ignore */
    }
  }, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  return { page, context };
}

async function snap(page, kind, theme, n, name) {
  const dir = join(outRoot, `${kind}-${theme}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${String(n).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${kind}-${theme}/${String(n).padStart(2, '0')}-${name}`);
}

// One counter per viewport and theme, shared by every pass, so file numbers follow the order the
// screens are taken in and never collide.
const counters = {};
function sequence(kind, theme) {
  const key = `${kind}-${theme}`;
  counters[key] ??= { n: 0 };
  const c = counters[key];
  return async (page, name, prepare) => {
    c.n += 1;
    const label = `${key}/${String(c.n).padStart(2, '0')}-${name}`;
    try {
      if (prepare) await prepare();
      if (only && !only.test(label)) return;
      await sleep(350); // drawers slide in, toasts settle
      await snap(page, kind, theme, c.n, name);
    } catch (err) {
      failures.push(`${label}: ${firstLine(err.message)}`);
      mkdirSync(join(outRoot, '_failed'), { recursive: true });
      await page.screenshot({ path: join(outRoot, '_failed', `${label.replace('/', '_')}.png`) }).catch(() => {});
      console.log(`  ✗ ${label}`);
    }
  };
}

const row = (page, name) => page.locator('tr.svc-tr', { hasText: name });
const modal = (page, title) => page.locator('dialog[open]', { hasText: title });
const settingsDrawer = (page) => page.getByRole('dialog', { name: 'Settings' });
const settingsRow = (page, title) => settingsDrawer(page).locator('.settings-row-head', { hasText: title });

async function dashboard(page) {
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Account menu' }).waitFor();
  await sleep(300);
}

async function openService(page, kind, name) {
  if (kind === 'mobile') await page.locator(`.mobile-row[data-name="${name}"] .mobile-row-content`).tap();
  else await row(page, name).click();
  await page.getByRole('dialog', { name: `Edit ${name}` }).waitFor();
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await settingsRow(page, 'Rate limit').waitFor();
}

async function openPalette(page, kind) {
  await page.getByRole('button', { name: /Search or run a command/ }).filter({ visible: true }).first().click();
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
}

// ---------------------------------------------------------------- the screens

async function loginScreens(kind, theme) {
  const seq = sequence(kind, theme);
  const { page, context } = await newPage(kind, theme, { signedIn: false });
  await seq(page, 'login', async () => {
    await page.goto('/admin/login');
    await page.getByLabel('Admin password').waitFor();
  });
  await seq(page, 'login-password-shown', async () => {
    await page.getByLabel('Admin password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Show password' }).click();
  });
  await seq(page, 'login-wrong-password', async () => {
    await page.getByRole('button', { name: 'Hide password' }).click();
    await page.getByLabel('Admin password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').filter({ hasText: /\S/ }).waitFor();
    // No highlighted text in the picture: put the cursor at the end.
    await page.getByLabel('Admin password').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  });
  await context.close();
}

async function emptyDashboard(kind, theme) {
  const seq = sequence(kind, theme);
  const { page, context } = await newPage(kind, theme, { signedIn: true });
  await seq(page, 'dashboard-empty', async () => {
    await dashboard(page);
    await sleep(500);
  });
  await context.close();
}

async function dashboardScreens(kind, theme) {
  const seq = sequence(kind, theme);
  const { page, context } = await newPage(kind, theme, { signedIn: true });
  const mobile = kind === 'mobile';

  await seq(page, 'dashboard', async () => {
    await dashboard(page);
    await sleep(500);
  });

  if (!mobile) {
    await seq(page, 'dashboard-filter-off', async () => {
      await page.getByRole('tab', { name: /^Off/ }).click();
    });
    await seq(page, 'dashboard-selection', async () => {
      await page.getByRole('tab', { name: /^All/ }).click();
      await page.getByLabel('Select sonarr').check();
      await page.getByLabel('Select radarr').check();
    });
    await seq(page, 'dashboard-selection-palette', async () => {
      await openPalette(page, kind);
    });
    await page.keyboard.press('Escape');
  }

  await seq(page, 'palette', async () => {
    await dashboard(page);
    await openPalette(page, kind);
  });
  await seq(page, 'palette-search', async () => {
    await page.getByPlaceholder('Type a command…').fill('plex');
  });
  await page.keyboard.press('Escape');

  await seq(page, 'account-menu', async () => {
    await dashboard(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
  });

  await context.close();
}

async function addScreens(kind, theme) {
  const seq = sequence(kind, theme);
  const { page, context } = await newPage(kind, theme, { signedIn: true });
  await dashboard(page);

  const drawer = () => page.getByRole('dialog', { name: 'Add service' });
  await seq(page, 'add-service', async () => {
    await page.getByRole('button', { name: 'Add service' }).first().click();
    await drawer().waitFor();
  });
  await seq(page, 'add-service-error', async () => {
    await drawer().getByRole('button', { name: /^Save/ }).click();
    await drawer().locator('.text-danger').filter({ hasText: /\S/ }).first().waitFor();
  });
  await seq(page, 'add-service-filled', async () => {
    await drawer().getByPlaceholder('sonarr').fill('prowlarr');
    await drawer().getByLabel('Upstream URL').fill('http://prowlarr:9696');
    await drawer().locator('select.auth-row-select').first().selectOption({ label: '*arr apps' });
    const fields = drawer().locator('input[type="password"]');
    await fields.first().fill('prowlarr-api-key-0123456789');
    await fields.nth(1).fill('prowlarr-api-key-0123456789');
  });
  await seq(page, 'add-service-access-tab', async () => {
    await drawer().getByRole('tab', { name: 'Access' }).click();
  });
  await context.close();
}

async function editScreens(kind, theme) {
  const seq = sequence(kind, theme);
  const { page, context } = await newPage(kind, theme, { signedIn: true });
  await dashboard(page);
  const drawer = () => page.getByRole('dialog', { name: 'Edit sonarr' });
  const tab = (name) => drawer().getByRole('tab', { name });

  await seq(page, 'edit-connection', async () => {
    await openService(page, kind, 'sonarr');
  });
  await seq(page, 'edit-access', async () => {
    await tab('Access').click();
  });
  await seq(page, 'edit-access-scope', async () => {
    await drawer().getByRole('button', { name: /^More actions for dashboard/ }).click();
    await page.getByRole('menuitem', { name: 'Edit scope…' }).click();
    await drawer().getByText('Caller tokens').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  });
  await seq(page, 'edit-access-expiry', async () => {
    await drawer().getByRole('button', { name: /^More actions for default/ }).click();
    await page.getByRole('menuitem', { name: 'Set expiry…' }).click();
  });
  await seq(page, 'edit-open-paths', async () => {
    await tab('Advanced').click();
  });
  await seq(page, 'edit-requests', async () => {
    await tab('Requests').click();
  });
  await seq(page, 'edit-how-to-use', async () => {
    await tab('How to use').click();
  });
  await seq(page, 'edit-unsaved', async () => {
    await tab('Connection').click();
    await drawer().getByLabel('Upstream URL').fill('http://sonarr:8990');
    await page.keyboard.press('Escape');
    await modal(page, 'Unsaved changes').waitFor();
  });
  await modal(page, 'Unsaved changes').getByRole('button', { name: 'Discard' }).click();
  await sleep(300);

  await seq(page, 'edit-rotate-token', async () => {
    await openPalette(page, kind);
    await page.getByPlaceholder('Type a command…').fill('sonarr');
    await page.getByRole('option', { name: /Rotate token — sonarr/ }).click();
    await modal(page, 'Rotate the token').waitFor();
  });
  await page.keyboard.press('Escape');
  await sleep(300);
  await openService(page, kind, 'sonarr');

  await seq(page, 'edit-delete-confirm', async () => {
    await drawer().getByRole('button', { name: 'Delete sonarr' }).click();
    await modal(page, 'Delete sonarr?').waitFor();
    await modal(page, 'Delete sonarr?').getByLabel('Type sonarr to confirm').fill('sonarr');
  });
  await context.close();
}

async function settingsScreens(kind, theme) {
  const seq = sequence(kind, theme);
  // Every pass starts from the default settings, so the "saved" toast always has something to save.
  await call('put', 'settings', { rateLimit: 120, activityLimit: 20, auditLimit: 100, embedOrigins: [] });
  const { page, context } = await newPage(kind, theme, { signedIn: true });
  await dashboard(page);

  await seq(page, 'settings', async () => {
    await openSettings(page);
  });
  await seq(page, 'settings-rate-limit', async () => {
    await settingsRow(page, 'Rate limit').click();
    await settingsDrawer(page).getByRole('button', { name: '300', exact: true }).click();
  });
  await seq(page, 'settings-saved-toast', async () => {
    await settingsDrawer(page).getByRole('button', { name: /^Save/ }).click();
    await page.getByRole('region', { name: 'Notifications' }).getByText('Settings saved').waitFor();
  });
  await seq(page, 'settings-embedding', async () => {
    await settingsRow(page, 'Embedding').click();
    await settingsDrawer(page).getByRole('textbox', { name: 'Sites allowed to embed the admin UI' }).fill('https://dash.example.com\nhttp://192.168.1.10:3000');
  });
  await seq(page, 'settings-security-search', async () => {
    await settingsDrawer(page).getByRole('button', { name: /^Discard/ }).click();
    await settingsDrawer(page).getByPlaceholder('Search settings').fill('log');
  });
  await seq(page, 'settings-requests-tab', async () => {
    await settingsDrawer(page).getByPlaceholder('Search settings').fill('');
    await settingsDrawer(page).getByRole('tab', { name: 'Requests' }).click();
  });
  await seq(page, 'settings-admin-log-tab', async () => {
    await settingsDrawer(page).getByRole('tab', { name: /^Admin log/ }).click();
  });
  await seq(page, 'settings-export-redacted', async () => {
    await settingsDrawer(page).getByRole('tab', { name: 'Settings' }).click();
    await settingsRow(page, 'Export config').click();
    await settingsDrawer(page).getByRole('heading', { name: 'Export config' }).waitFor();
  });
  await seq(page, 'settings-export-full', async () => {
    await settingsDrawer(page).getByRole('button', { name: 'Full backup' }).click();
    await settingsDrawer(page).locator('#bk-confirm').check();
  });
  await seq(page, 'settings-import', async () => {
    await settingsDrawer(page).getByRole('button', { name: 'Back to settings' }).click();
    await settingsRow(page, 'Import config').click();
    await settingsDrawer(page).getByRole('heading', { name: 'Import config' }).waitFor();
  });
  await seq(page, 'settings-import-unknown-field', async () => {
    await settingsDrawer(page).getByRole('button', { name: 'Paste JSON' }).click();
    const typo = { version: 1, services: [{ name: 'bazarr', url: 'http://bazarr:6767', enabld: true, auth: {} }] };
    await settingsDrawer(page).getByLabel('Config JSON').fill(JSON.stringify(typo));
    await settingsDrawer(page).getByRole('button', { name: 'Check file' }).click();
    await settingsDrawer(page).getByText(/does not look like a Postern config/).waitFor();
  });
  await seq(page, 'settings-import-review', async () => {
    const file = {
      version: 1,
      services: [
        { name: 'sonarr', url: 'http://sonarr:8989', auth: { header: { name: 'X-Api-Key', secret: '' } } },
        { name: 'lidarr', url: 'http://lidarr:8686', auth: { header: { name: 'X-Api-Key', secret: 'lidarr-api-key-0123456789' } } },
        { name: 'bazarr', url: 'http://bazarr:6767', auth: { header: { name: 'X-Api-Key', secret: '' } } },
      ],
    };
    await settingsDrawer(page).getByLabel('Config JSON').fill(JSON.stringify(file));
    await settingsDrawer(page).getByRole('button', { name: 'Check file' }).click();
    await settingsDrawer(page).getByRole('button', { name: 'Change' }).waitFor();
  });
  await context.close();
}

async function dialogScreens(kind, theme) {
  if (kind === 'mobile') return;
  const seq = sequence(kind, theme);
  const { page, context } = await newPage(kind, theme, { signedIn: true });
  await dashboard(page);
  await seq(page, 'dialog-duplicate', async () => {
    await openPalette(page, kind);
    await page.getByPlaceholder('Type a command…').fill('plex');
    await page.getByRole('option', { name: /Duplicate — plex/ }).click();
    await modal(page, 'Duplicate plex').waitFor();
  });
  await page.keyboard.press('Escape');
  await sleep(300);
  await seq(page, 'dialog-bulk-rotate', async () => {
    await page.getByLabel('Select sonarr').check();
    await page.getByLabel('Select radarr').check();
    await openPalette(page, kind);
    await page.getByPlaceholder('Type a command…').fill('rotate');
    await page.getByRole('option', { name: /Rotate tokens for/ }).click();
    await modal(page, 'Rotate').waitFor();
  });
  await context.close();
}

// ---------------------------------------------------------------- run

try {
  console.log('Sign-in and the empty dashboard');
  for (const kind of ['desktop', 'mobile']) {
    for (const theme of ['dark', 'light']) {
      if (!wanted(kind, theme)) continue;
      await loginScreens(kind, theme);
      await emptyDashboard(kind, theme);
    }
  }

  console.log('Seeding services and traffic');
  await seed();

  for (const kind of ['desktop', 'mobile']) {
    for (const theme of ['dark', 'light']) {
      if (!wanted(kind, theme)) continue;
      console.log(`${kind} ${theme}`);
      await dashboardScreens(kind, theme);
      await addScreens(kind, theme);
      await editScreens(kind, theme);
      await settingsScreens(kind, theme);
      await dialogScreens(kind, theme);
    }
  }
} finally {
  await browser.close();
  await admin.dispose();
  await stopAll();
}

console.log(`\nDone. Pictures are in ${outRoot}`);
if (failures.length) {
  console.log(`\n${failures.length} screen(s) could not be taken:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
