import { test, expect, PASSWORD } from './fixtures.js';

// These tests sign in through the form, so they start with no session.
test.use({ storageState: { cookies: [], origins: [] } });

test('the sign-in page asks for the admin password', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Admin password')).toBeFocused();
});

test('a wrong password shows an error and stays on the page', async ({ page, problems }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Admin password').fill('definitely-not-it');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/isn't right|incorrect|invalid/i);
  await expect(page.getByLabel('Admin password')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/admin\/login/);
  // The browser logs the 401 as a failed resource; that is the point of this test.
  problems.allow(/401|Failed to load resource/);
});

test('the show password button reveals and hides the field', async ({ page }) => {
  await page.goto('/admin/login');
  const field = page.getByLabel('Admin password');
  await field.fill('abc');
  await expect(field).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(field).toHaveAttribute('type', 'password');
});

test('the right password opens the dashboard', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Admin password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});

test('the dashboard sends a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/login/);
});
