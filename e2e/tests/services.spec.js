import { test, expect } from './fixtures.js';

const toast = (page, text) => page.getByRole('region', { name: 'Notifications' }).getByText(text);
const tableRow = (page, name) => page.locator('tr.svc-tr', { hasText: name });
/** The admin API has no call for one service, so read it from the list. */
const stored = async (api, name) => ((await api.get('services')).body || []).find((s) => s.name === name);
/** Dialogs made with <dialog> have a heading, not an accessible name. */
const modal = (page, title) => page.locator('dialog[open]', { hasText: title });

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});

test('adding a service: fill the form, save, and it shows in the list', async ({ page, api, svc }) => {
  const name = svc.name('add');
  svc.track(name);

  await page.getByRole('button', { name: 'Add service' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add service' });
  await expect(drawer).toBeVisible();

  await drawer.getByPlaceholder('sonarr').fill(name);
  await drawer.getByLabel('Upstream URL').fill('https://upstream.invalid/api');
  await drawer.getByRole('button', { name: 'Add credential' }).click();
  await drawer.getByLabel(/Header value/).fill('a-brand-new-upstream-key');
  await drawer.getByRole('button', { name: /^Save/ }).click();

  await expect(toast(page, 'Service created')).toBeVisible();
  await expect(page.getByRole('dialog', { name: `Edit ${name}` })).toBeVisible();
  await expect(tableRow(page, name)).toBeVisible();

  const made = await stored(api, name);
  expect(made.url).toBe('https://upstream.invalid/api');
  expect(made.enabled).toBe(true);
  expect(made.tokens.length).toBeGreaterThan(0);
});

test('a service with no name or URL is refused and the drawer stays open', async ({ page, api, problems }) => {
  const before = (await api.get('services')).body.length;
  await page.getByRole('button', { name: 'Add service' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add service' });
  await drawer.getByRole('button', { name: /^Save/ }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.text-danger').filter({ hasText: /\S/ }).first()).toBeVisible();
  expect((await api.get('services')).body.length).toBe(before);
  // The browser logs the refused request (HTTP 400) as a failed resource; that is the point here.
  problems.allow(/Failed to load resource/);
});

test('opening a service shows its details, and a stored upstream key is never shown', async ({ page, svc }) => {
  const s = await svc.create('open');
  await page.reload();
  await tableRow(page, s.name).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Upstream URL')).toHaveValue('https://upstream.invalid');
  await expect(drawer.getByLabel('Proxy URL')).toHaveValue(new RegExp(`/p/${s.name}/$`));

  const secret = drawer.getByLabel('Header value');
  await expect(secret).toHaveValue('');
  await expect(secret).toHaveAttribute('placeholder', '••••••••');
  await expect(drawer).not.toContainText('upstream-secret-value');
});

test('editing the URL marks the change, saves it, and keeps the stored key', async ({ page, api, svc }) => {
  const s = await svc.create('edit');
  await page.reload();
  await tableRow(page, s.name).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });

  const save = drawer.getByRole('button', { name: /^Save/ });
  await expect(save).toBeDisabled();
  await drawer.getByLabel('Upstream URL').fill('https://changed.invalid');
  await expect(drawer).toContainText('1 unsaved change');
  await expect(save).toBeEnabled();
  await save.click();

  await expect(toast(page, 'Service saved')).toBeVisible();
  await expect(drawer).not.toContainText('unsaved change');
  const saved = await stored(api, s.name);
  expect(saved.url).toBe('https://changed.invalid');
  // The key was not retyped, so the server must still have it.
  expect(saved.auth.header.hasSecret).toBe(true);
  expect(JSON.stringify(saved)).not.toContain("upstream-secret-value");
});

test('closing a drawer with unsaved changes asks, and Discard throws the edit away', async ({ page, api, svc }) => {
  const s = await svc.create('dirty');
  await page.reload();
  await tableRow(page, s.name).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await drawer.getByLabel('Upstream URL').fill('https://typed-but-not-saved.invalid');
  await page.keyboard.press('Escape');
  const ask = modal(page, 'Unsaved changes');
  await expect(ask).toBeVisible();

  // Cancel keeps the drawer and the typed text.
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ask).toBeHidden();
  await expect(drawer.getByLabel('Upstream URL')).toHaveValue('https://typed-but-not-saved.invalid');

  await page.keyboard.press('Escape');
  await modal(page, 'Unsaved changes').getByRole('button', { name: 'Discard' }).click();
  await expect(drawer).toBeHidden();
  expect((await stored(api, s.name)).url).toBe('https://upstream.invalid');
});

test('the Access tab shows the caller token, hidden until revealed', async ({ page, svc }) => {
  const s = await svc.create('token');
  await page.reload();
  await tableRow(page, s.name).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await drawer.getByRole('tab', { name: 'Access' }).click();
  await expect(drawer.getByRole('button', { name: /^Copy / }).first()).toBeVisible();
  await expect(drawer).not.toContainText(s.tokens[0].secret);
});

test('limiting a token to GET is saved on the server', async ({ page, api, svc }) => {
  const s = await svc.create('scope');
  await page.reload();
  await tableRow(page, s.name).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await drawer.getByRole('tab', { name: 'Access' }).click();

  await drawer.getByRole('button', { name: /^More actions for / }).first().click();
  await page.getByRole('menuitem', { name: 'Limit access…' }).click();

  const editor = drawer.locator('.token-scope-editor');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'GET', exact: true }).click();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'Scope saved')).toBeVisible();

  expect((await stored(api, s.name)).tokens[0].scope.methods).toEqual(['GET']);
});

test('deleting a service needs its name typed, then removes it', async ({ page, api, svc }) => {
  const s = await svc.create('delete');
  await page.reload();
  await tableRow(page, s.name).click();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await drawer.getByRole('button', { name: `Delete ${s.name}` }).click();

  const confirm = modal(page, `Delete ${s.name}?`);
  const go = confirm.getByRole('button', { name: 'Delete service' });
  await expect(go).toBeDisabled();
  await confirm.getByLabel(`Type ${s.name} to confirm`).fill('wrong-name');
  await expect(go).toBeDisabled();
  await confirm.getByLabel(`Type ${s.name} to confirm`).fill(s.name);
  await expect(go).toBeEnabled();
  await go.click();

  await expect(toast(page, 'Service deleted')).toBeVisible();
  await expect(tableRow(page, s.name)).toHaveCount(0);
  expect(await stored(api, s.name)).toBeUndefined();
});

test('turning a service off from the palette marks it Off', async ({ page, api, svc }) => {
  const s = await svc.create('toggle');
  await page.reload();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a command…').fill(s.name);
  await page.getByRole('option', { name: `Turn off — ${s.name}` }).click();
  await expect(tableRow(page, s.name)).toContainText('Off');
  expect((await stored(api, s.name)).enabled).toBe(false);
});

test('a created service really proxies: the caller token is accepted and a wrong one is not', async ({ page, svc, baseURL }) => {
  const s = await svc.create('proxy');
  const token = s.tokens[0].secret;
  const wrong = await page.request.get(`${baseURL}/p/${s.name}/x`, { headers: { Authorization: 'Bearer nope' } });
  expect(wrong.status()).toBe(401);
  // The upstream does not exist, so a good token gets as far as a gateway error rather than a refusal.
  const right = await page.request.get(`${baseURL}/p/${s.name}/x`, { headers: { Authorization: `Bearer ${token}` } });
  expect([502, 504]).toContain(right.status());
});
