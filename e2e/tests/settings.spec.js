import { test, expect } from './fixtures.js';

const drawer = (page) => page.getByRole('dialog', { name: 'Settings' });
const row = (page, title) => drawer(page).locator('.settings-row-head', { hasText: title });
const saveButton = (page) => drawer(page).getByRole('button', { name: /^Save/ });
const discardButton = (page) => drawer(page).getByRole('button', { name: 'Discard' });
const toast = (page, text) => page.getByRole('region', { name: 'Notifications' }).getByText(text);

test.beforeEach(async ({ page, api }) => {
  await api.resetSettings();
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(drawer(page)).toBeVisible();
  // The rows arrive after the settings are fetched.
  await expect(row(page, 'Rate limit')).toBeVisible();
});

test.afterEach(async ({ api }) => {
  await api.resetSettings();
});

test('lists the settings in groups', async ({ page }) => {
  for (const group of ['Traffic', 'Logs', 'Security', 'Backup']) {
    await expect(drawer(page).getByRole('heading', { name: group })).toBeVisible();
  }
  for (const title of ['Rate limit', 'Request log', 'Admin log', 'Embedding', 'Export config', 'Import config']) {
    await expect(row(page, title)).toBeVisible();
  }
});

test('the search box narrows the list', async ({ page }) => {
  await drawer(page).getByPlaceholder('Search settings').fill('iframe');
  await expect(row(page, 'Embedding')).toBeVisible();
  await expect(row(page, 'Rate limit')).toHaveCount(0);
  await drawer(page).getByPlaceholder('Search settings').fill('zzzz-nothing');
  await expect(drawer(page)).toContainText('No matching settings');
});

test('Save and Discard stay off until something changes', async ({ page }) => {
  await expect(saveButton(page)).toBeDisabled();
  await expect(discardButton(page)).toBeDisabled();
  await row(page, 'Rate limit').click();
  await drawer(page).getByRole('button', { name: '300', exact: true }).click();
  await expect(saveButton(page)).toBeEnabled();
  await expect(discardButton(page)).toBeEnabled();
});

test('a changed setting is saved, kept on the server and shown after a reload', async ({ page, api }) => {
  await row(page, 'Rate limit').click();
  await drawer(page).getByRole('button', { name: '300', exact: true }).click();
  await expect(drawer(page).getByRole('button', { name: '300', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await saveButton(page).click();
  await expect(toast(page, 'Settings saved')).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();

  const stored = await api.get('settings');
  expect(stored.body.rateLimit).toBe(300);

  await page.reload();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(row(page, 'Rate limit')).toContainText('300');
});

test('the stepper and the number box change a value', async ({ page }) => {
  await row(page, 'Request log').click();
  const box = drawer(page).getByRole('textbox', { name: 'Request log' });
  await expect(box).toHaveValue('20');
  await drawer(page).getByRole('button', { name: 'Increase Request log' }).click();
  await expect(box).toHaveValue('21');
  await box.fill('50');
  await expect(row(page, 'Request log')).toContainText('50');
  await drawer(page).getByRole('button', { name: 'Use default' }).click();
  await expect(box).toHaveValue('20');
});

test('Ctrl+S saves', async ({ page, api }) => {
  await row(page, 'Rate limit').click();
  await drawer(page).getByRole('button', { name: '60', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect(toast(page, 'Settings saved')).toBeVisible();
  expect((await api.get('settings')).body.rateLimit).toBe(60);
});

test('Discard puts the saved values back', async ({ page }) => {
  await row(page, 'Rate limit').click();
  await drawer(page).getByRole('button', { name: '600', exact: true }).click();
  await expect(row(page, 'Rate limit')).toContainText('600');
  await discardButton(page).click();
  await expect(row(page, 'Rate limit')).toContainText('120');
  await expect(saveButton(page)).toBeDisabled();
});

test('closing with unsaved changes asks first, and Cancel keeps the drawer open', async ({ page }) => {
  await row(page, 'Rate limit').click();
  await drawer(page).getByRole('button', { name: '300', exact: true }).click();

  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await drawer(page).getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => asked).toMatch(/unsaved/i);
  await expect(drawer(page)).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await drawer(page).getByRole('button', { name: 'Close' }).click();
  await expect(drawer(page)).toBeHidden();
});

test('closing with nothing changed does not ask', async ({ page }) => {
  page.on('dialog', () => {
    throw new Error('no confirmation was expected');
  });
  await drawer(page).getByRole('button', { name: 'Close' }).click();
  await expect(drawer(page)).toBeHidden();
});

test('Escape closes the drawer', async ({ page }) => {
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
});

test('a bad embedding entry shows the problem and blocks Save', async ({ page }) => {
  await row(page, 'Embedding').click();
  const box = drawer(page).getByRole('textbox', { name: 'Sites allowed to embed the admin UI' });
  await box.fill('not a url');
  await expect(drawer(page).getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await box.fill('https://dash.example.com');
  await expect(drawer(page).getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await expect(saveButton(page)).toBeEnabled();
});

test('embedding a site is saved and changes the frame headers', async ({ page, api, baseURL }) => {
  await row(page, 'Embedding').click();
  await drawer(page).getByRole('textbox', { name: 'Sites allowed to embed the admin UI' }).fill('https://dash.example.com');
  await saveButton(page).click();
  await expect(toast(page, 'Settings saved')).toBeVisible();

  const res = await page.request.get(`${baseURL}/admin/login`);
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'self' https://dash.example.com");
  expect(res.headers()['x-frame-options']).toBeUndefined();

  await api.resetSettings();
  const after = await page.request.get(`${baseURL}/admin/login`);
  expect(after.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(after.headers()['x-frame-options']).toBe('DENY');
});
