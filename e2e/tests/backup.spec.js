import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

const drawer = (page) => page.getByRole('dialog', { name: 'Settings' });
const toast = (page, text) => page.getByRole('region', { name: 'Notifications' }).getByText(text);
const stored = async (api, name) => ((await api.get('services')).body || []).find((s) => s.name === name);

async function openBackupScreen(page, title) {
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await drawer(page).locator('.settings-row-head', { hasText: title }).click();
  await expect(drawer(page).getByRole('heading', { name: title })).toBeVisible();
}

async function download(page, label) {
  const [file] = await Promise.all([page.waitForEvent('download'), drawer(page).getByRole('button', { name: label }).click()]);
  return { name: file.suggestedFilename(), json: JSON.parse(readFileSync(await file.path(), 'utf8')) };
}

test('a redacted export has the service but no secrets', async ({ page, svc }) => {
  const s = await svc.create('redacted');
  await openBackupScreen(page, 'Export config');
  await expect(drawer(page).getByRole('button', { name: 'Redacted' })).toHaveAttribute('aria-pressed', 'true');

  const { name, json } = await download(page, 'Download');
  expect(name).toBe('postern-config.redacted.json');
  expect(json.version).toBe(1);
  expect(json.redacted).toBe(true);
  const made = json.services.find((x) => x.name === s.name);
  expect(made).toBeTruthy();
  expect(made.auth.header.secret).toBe('');
  expect(JSON.stringify(json)).not.toContain('upstream-secret-value');
  expect(JSON.stringify(json)).not.toContain(s.tokens[0].secret);
});

test('a full backup needs the box ticked and then holds the secrets', async ({ page, svc }) => {
  const s = await svc.create('full');
  await openBackupScreen(page, 'Export config');
  await drawer(page).getByRole('button', { name: 'Full backup' }).click();
  await expect(drawer(page).getByRole('button', { name: 'Download backup' })).toBeDisabled();
  await drawer(page).locator('#bk-confirm').check();
  await expect(drawer(page).getByRole('button', { name: 'Download backup' })).toBeEnabled();

  const { name, json } = await download(page, 'Download backup');
  expect(name).toMatch(/^postern-backup-\d{4}-\d{2}-\d{2}\.json$/);
  expect(json.redacted).toBe(false);
  const made = json.services.find((x) => x.name === s.name);
  expect(made.auth.header.secret).toBe('upstream-secret-value');
  expect(made.tokens[0].secret).toBe(s.tokens[0].secret);
});

test('a full backup puts a deleted service back, token and all', async ({ page, api, svc }, testInfo) => {
  const s = await svc.create('roundtrip');
  await openBackupScreen(page, 'Export config');
  await drawer(page).getByRole('button', { name: 'Full backup' }).click();
  await drawer(page).locator('#bk-confirm').check();
  const { json } = await download(page, 'Download backup');
  const only = { ...json, services: json.services.filter((x) => x.name === s.name) };
  const file = testInfo.outputPath('backup.json');
  (await import('node:fs')).writeFileSync(file, JSON.stringify(only));

  await api.del(`services/${s.name}`);
  expect(await stored(api, s.name)).toBeUndefined();

  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await drawer(page).locator('.settings-row-head', { hasText: 'Import config' }).click();
  await drawer(page).getByLabel('Config file').setInputFiles(file);
  await drawer(page).getByRole('button', { name: 'Check file' }).click();

  const importBtn = drawer(page).getByRole('button', { name: 'Import 1 service' });
  await expect(importBtn).toBeVisible();
  // Checking is a dry run: nothing has changed yet.
  expect(await stored(api, s.name)).toBeUndefined();
  await importBtn.click();

  await expect(toast(page, /Imported 1 service/)).toBeVisible();
  const back = await stored(api, s.name);
  expect(back.url).toBe('https://upstream.invalid');
  expect(back.tokens[0].secret).toBe(s.tokens[0].secret);
});

test('pasting something that is not JSON is explained, not applied', async ({ page }) => {
  await openBackupScreen(page, 'Import config');
  await drawer(page).getByRole('button', { name: 'Paste JSON' }).click();
  await drawer(page).getByLabel('Config JSON').fill('{ this is not json');
  await drawer(page).getByRole('button', { name: 'Check file' }).click();
  await expect(drawer(page)).toContainText(/not valid JSON/i);
});

test('a file that names an unknown field is reported as an error and imports nothing', async ({ page, api, svc, problems }) => {
  const name = svc.name('typo');
  svc.track(name);
  await openBackupScreen(page, 'Import config');
  await drawer(page).getByRole('button', { name: 'Paste JSON' }).click();
  const bad = { version: 1, services: [{ name, url: 'https://x.invalid', enabld: true, auth: {} }] };
  await drawer(page).getByLabel('Config JSON').fill(JSON.stringify(bad));
  await drawer(page).getByRole('button', { name: 'Check file' }).click();
  await expect(drawer(page)).toContainText(/error/i);
  await expect(drawer(page).getByRole('button', { name: /^Import \d/ })).toHaveCount(0);
  expect(await stored(api, name)).toBeUndefined();
  // The dry run answers a bad file with HTTP 400, which the browser logs as a failed resource.
  problems.allow(/Failed to load resource/);
});

test('Back returns from a backup screen to the settings list', async ({ page }) => {
  await openBackupScreen(page, 'Export config');
  await drawer(page).getByRole('button', { name: 'Back to settings' }).click();
  await expect(drawer(page).locator('.settings-row-head', { hasText: 'Rate limit' })).toBeVisible();
});
