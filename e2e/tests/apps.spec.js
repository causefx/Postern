import { createServer } from 'node:http';
import { test, expect } from './fixtures.js';

// A stand-in Sonarr: its page is enough for Postern to recognise it.
let upstream;
let upstreamURL;

test.beforeAll(async () => {
  upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><head><title>Sonarr</title></head><body><script>window.Sonarr = {}</script></body></html>');
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamURL = `http://127.0.0.1:${upstream.address().port}`;
});

test.afterAll(() => upstream?.close());

const stored = async (api, name) => ((await api.get('services')).body || []).find((s) => s.name === name);
// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});

test('nothing shows under the address until it is tested', async ({ page }) => {
  await page.getByRole('button', { name: 'Add service' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add service' });
  await drawer.getByLabel('Upstream URL').fill(upstreamURL);
  await drawer.getByLabel('Upstream URL').blur();
  await expect(drawer.locator('.test-card')).toHaveCount(0);
  // The preset menu is gone: Set up on a test result replaces it.
  await expect(drawer.getByText('Fill from preset')).toHaveCount(0);
});

test('a test recognises the app, and Set up adds its key slots, name and app', async ({ page, api, svc }) => {
  await page.getByRole('button', { name: 'Add service' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add service' });

  await drawer.getByLabel('Upstream URL').fill(upstreamURL);
  await drawer.getByRole('button', { name: 'Test' }).click();
  const card = drawer.locator('.test-card');
  await expect(card).toContainText('Reachable · HTTP 200 · Sonarr');
  await expect(card).toContainText('Sonarr takes its key as the X-Api-Key header or ?apikey.');
  await expect(card).toContainText('Find it in Sonarr: Settings → General → Security → API Key');
  await expect(card).toContainText('Sets the app to Sonarr and adds an X-Api-Key header and an apikey URL parameter');
  await expect(card.locator('.svc-icon img')).toHaveAttribute('src', '/admin/app-icons/sonarr.svg');

  await card.getByRole('button', { name: 'Set up for Sonarr' }).click();
  await expect(drawer.getByPlaceholder('sonarr')).toHaveValue('sonarr');
  await expect(drawer.getByLabel('App and icon')).toHaveValue('sonarr');
  await expect(drawer.getByLabel(/Header value/)).toBeVisible();
  await expect(drawer.getByLabel(/URL param value/)).toBeVisible();
  await expect(drawer.locator('.svc-drawer-header .svc-icon img')).toHaveAttribute('src', '/admin/app-icons/sonarr.svg');
  // Set up: the card is down to its status line.
  await expect(card).toContainText('app and key match');
  await expect(card.getByRole('button', { name: /Set up/ })).toHaveCount(0);

  // Testing again with the new slots still empty checks the address, not the missing key.
  await drawer.getByRole('button', { name: 'Test' }).click();
  await expect(card).toContainText('Reachable · HTTP 200 · Sonarr');
  await expect(card).toContainText('app and key match');

  // Changing the address drops the result: it belonged to the old one.
  await drawer.getByLabel('Upstream URL').fill(upstreamURL + '/');
  await expect(card).toHaveCount(0);

  const name = svc.name('detect');
  svc.track(name);
  await drawer.getByPlaceholder('sonarr').fill(name);
  await drawer.getByLabel(/Header value/).fill('an-upstream-key-1234');
  await drawer.getByLabel(/URL param value/).fill('an-upstream-key-1234');
  await drawer.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByRole('dialog', { name: `Edit ${name}` })).toBeVisible();

  const made = await stored(api, name);
  expect(made.app).toBe('sonarr');
  expect(made.auth.header.name).toBe('X-Api-Key');
  expect(made.auth.query.name).toBe('apikey');
  await expect(page.locator('tr.svc-tr', { hasText: name }).locator('.svc-icon img')).toHaveAttribute(
    'src',
    '/admin/app-icons/sonarr.svg',
  );
});

test('Set up keeps a key already typed', async ({ page }) => {
  await page.getByRole('button', { name: 'Add service' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add service' });
  await drawer.getByLabel('Upstream URL').fill(upstreamURL);
  await drawer.getByRole('button', { name: 'Add credential' }).click();
  await drawer.getByLabel(/Header value/).fill('typed-before-setup');
  await drawer.getByRole('button', { name: 'Test' }).click();
  const card = drawer.locator('.test-card');
  // The header is already there, so only the URL parameter is left to add.
  await expect(card).toContainText('Sets the app to Sonarr and adds an apikey URL parameter');
  await card.getByRole('button', { name: 'Set up for Sonarr' }).click();
  await expect(drawer.getByLabel(/Header value/)).toHaveValue('typed-before-setup');
});

test('an address that does not answer says so in the card', async ({ page }) => {
  await page.getByRole('button', { name: 'Add service' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add service' });
  // A port nothing listens on.
  await drawer.getByLabel('Upstream URL').fill('http://127.0.0.1:9');
  await drawer.getByRole('button', { name: 'Test' }).click();
  const card = drawer.locator('.test-card');
  await expect(card.locator('.test-card-status.is-danger')).toHaveText('Connection refused', { timeout: 10_000 });
  await expect(card).toContainText('Nothing is listening at that address and port.');
  await expect(card.getByRole('button', { name: /Set up/ })).toHaveCount(0);
});

test('an uploaded icon replaces the app icon, and removing it brings the app icon back', async ({ page, api, svc }) => {
  const s = await svc.create('icon', { app: 'radarr' });
  await page.reload();
  const row = page.locator('tr.svc-tr', { hasText: s.name });
  await expect(row.locator('.svc-icon img')).toHaveAttribute('src', '/admin/app-icons/radarr.svg');

  await row.click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await drawer.locator('input[type=file]').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: PNG });
  await expect(drawer.getByRole('button', { name: 'Remove custom icon' })).toBeVisible();
  await drawer.getByRole('button', { name: /^Save/ }).click();
  await expect(drawer.getByRole('button', { name: /^Save/ })).toBeDisabled();

  const withIcon = await stored(api, s.name);
  expect(withIcon.icon).toMatch(/^[0-9a-f]{64}\.png$/);
  await expect(row.locator('.svc-icon img')).toHaveAttribute('src', `/admin/icons/${withIcon.icon}`);
  const served = await page.request.get(`/admin/icons/${withIcon.icon}`);
  expect(served.headers()['content-security-policy']).toContain('sandbox');

  await drawer.getByRole('button', { name: 'Remove custom icon' }).click();
  await drawer.getByRole('button', { name: /^Save/ }).click();
  await expect(drawer.getByRole('button', { name: /^Save/ })).toBeDisabled();
  expect((await stored(api, s.name)).icon).toBeUndefined();
  await expect(row.locator('.svc-icon img')).toHaveAttribute('src', '/admin/app-icons/radarr.svg');
});

test('an SVG upload is refused', async ({ page, svc, problems }) => {
  const s = await svc.create('svg');
  await page.reload();
  await page.locator('tr.svc-tr', { hasText: s.name }).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await drawer.locator('input[type=file]').setInputFiles({
    name: 'evil.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('PNG, JPEG or WebP')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Remove custom icon' })).toHaveCount(0);
  problems.allow(/Failed to load resource/);
});
