import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});

const avatar = (page) => page.getByRole('button', { name: 'Account menu' });
const menu = (page) => page.getByRole('menu', { name: 'Account' });

test('opens from the avatar and shows where you are signed in', async ({ page }) => {
  await expect(avatar(page)).toHaveAttribute('aria-expanded', 'false');
  await avatar(page).click();
  await expect(avatar(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toContainText('admin');
  await expect(menu(page)).toContainText('127.0.0.1:18080');
  await expect(menu(page).getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(menu(page).getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
});

test('Escape closes it and returns focus to the avatar', async ({ page }) => {
  await avatar(page).click();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(avatar(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(avatar(page)).toBeFocused();
});

test('a click outside closes it', async ({ page }) => {
  await avatar(page).click();
  await expect(menu(page)).toBeVisible();
  await page.mouse.click(5, 400);
  await expect(menu(page)).toBeHidden();
});

test('clicking the avatar again closes it', async ({ page }) => {
  await avatar(page).click();
  await expect(menu(page)).toBeVisible();
  await avatar(page).click();
  await expect(menu(page)).toBeHidden();
});

test('the theme control changes the theme and it is remembered after a reload', async ({ page }) => {
  const html = page.locator('html');
  await avatar(page).click();
  await menu(page).getByRole('radio', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(menu(page).getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');

  await avatar(page).click();
  await menu(page).getByRole('radio', { name: 'Dark' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('Settings opens the settings drawer and closes the menu', async ({ page }) => {
  await avatar(page).click();
  await menu(page).getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(menu(page)).toBeHidden();
});

test('Sign out ends the session', async ({ page }) => {
  await avatar(page).click();
  await menu(page).getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/login/);
});
