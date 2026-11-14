import { test, expect } from './fixtures.js';

// A phone-sized viewport (see the "mobile" project in playwright.config.js). This catches layout that
// breaks outright: sideways scrolling, controls pushed off screen, sheets that do not open. It does
// not replace a look on a real phone.

const noSidewaysScroll = async (page) => {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'the page should not scroll sideways').toBeLessThanOrEqual(client);
};

test('the dashboard fits the screen with its header controls reachable', async ({ page, svc }) => {
  await svc.create('phone');
  await page.goto('/admin/');
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add service' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search or run a command' })).toBeVisible();
  await noSidewaysScroll(page);
});

test('the account menu opens as a sheet that fits, and closes again', async ({ page }) => {
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Account menu' }).tap();
  const menu = page.getByRole('menu', { name: 'Account' });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('the command palette opens from the search icon and runs a command', async ({ page }) => {
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Search or run a command' }).tap();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder('Type a command…').fill('settings');
  await palette.getByRole('option').first().tap();
  await expect(palette).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('a service opens in a drawer that fits, and shows its list on the phone layout', async ({ page, svc }) => {
  const s = await svc.create('phone-open');
  await page.goto('/admin/');
  // The desktop table is in the page too (hidden by CSS), so pick the phone row.
  await page.locator(`.mobile-row[data-name="${s.name}"] .mobile-row-content`).tap();
  const drawer = page.getByRole('dialog', { name: `Edit ${s.name}` });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Upstream URL')).toBeVisible();
  // The drawer slides in, so wait until all of it is on screen rather than measuring mid-slide.
  await expect(drawer).toBeInViewport({ ratio: 1 });
  await noSidewaysScroll(page);
});

test('the settings drawer fits and its rows can be opened', async ({ page }) => {
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Account menu' }).tap();
  await page.getByRole('menuitem', { name: 'Settings' }).tap();
  const drawer = page.getByRole('dialog', { name: 'Settings' });
  await expect(drawer).toBeInViewport({ ratio: 1 });
  await drawer.locator('.settings-row-head', { hasText: 'Rate limit' }).tap();
  await expect(drawer.getByRole('textbox', { name: 'Rate limit' })).toBeVisible();
  await noSidewaysScroll(page);
});

test('the sign-in page fits the screen', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeInViewport();
  await noSidewaysScroll(page);
});
