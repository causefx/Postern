import { test, expect } from './fixtures.js';

const palette = (page) => page.getByRole('dialog', { name: 'Command palette' });
const searchBox = (page) => palette(page).getByPlaceholder('Type a command…');

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
});

test('Ctrl+K opens it with the search box focused, Escape closes it', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toBeHidden();
});

test('the search box in the header opens it too', async ({ page }) => {
  await page.getByRole('button', { name: /Search or run a command/ }).first().click();
  await expect(palette(page)).toBeVisible();
});

test('typing filters the commands, and nothing matching says so', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await searchBox(page).fill('theme');
  const options = palette(page).getByRole('option');
  await expect(options.first()).toContainText(/theme/i);
  for (const text of await options.allTextContents()) expect(text.toLowerCase()).toContain('theme');
  await searchBox(page).fill('zzzz-no-such-command');
  await expect(options).toHaveCount(0);
  await expect(palette(page)).toContainText('No matching commands');
});

test('Enter runs the highlighted command', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await searchBox(page).fill('settings');
  await expect(palette(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('ArrowDown moves the highlight and Enter runs that command', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await searchBox(page).fill('theme:');
  const options = palette(page).getByRole('option');
  await expect(options.nth(1)).toBeVisible();
  const second = (await options.nth(1).textContent()).trim();
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toBeHidden();
  const wanted = second.replace(/^Theme:\s*/, '').toLowerCase();
  if (wanted !== 'system') await expect(page.locator('html')).toHaveAttribute('data-theme', wanted);
});

test('clicking a command that is not the highlighted one runs it', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const option = palette(page).getByRole('option', { name: 'Filter: Off only' });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('aria-selected', 'false');
  await option.hover();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await option.click();
  await expect(palette(page)).toBeHidden();
});

// Regression guard for fix b1a71fa. Moving the pointer onto a row used to rebuild the whole list, so
// the button under the pointer was replaced between mousedown and mouseup and the click never fired.
// A click test cannot see that (Playwright finds the new button again), so this checks the cause:
// the row the pointer is on must be the same element after the highlight moves. Checked by putting
// the old behaviour back: this test fails and the click test above does not.
test('hovering moves the highlight without replacing the row under the pointer', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const target = palette(page).getByRole('option').nth(3);
  const handle = await target.elementHandle();
  await target.hover();
  await expect(target).toHaveAttribute('aria-selected', 'true');
  expect(await handle.evaluate((el) => el.isConnected)).toBe(true);
});

test('clicking the dimmed area outside closes it', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await expect(palette(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(palette(page)).toBeHidden();
});

test('service commands appear once a service exists', async ({ page, svc }) => {
  const s = await svc.create('cmd');
  await page.reload();
  await page.keyboard.press('Control+k');
  await searchBox(page).fill(s.name);
  await expect(palette(page).getByRole('option', { name: new RegExp(`Edit — ${s.name}`) })).toBeVisible();
  await expect(palette(page).getByRole('option', { name: new RegExp(`Delete — ${s.name}`) })).toBeVisible();
});
