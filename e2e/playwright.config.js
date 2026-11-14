import { defineConfig } from '@playwright/test';

const port = process.env.E2E_PORT || '18080';
const baseURL = `http://127.0.0.1:${port}`;
// CI uses the Chromium that `playwright install` fetches. Locally, set E2E_CHANNEL=msedge (or chrome)
// to use a browser you already have.
const channel = process.env.E2E_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests',
  // One server and one data file are shared, and the settings tests change settings for everyone.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    channel,
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: './global-setup.js',
  webServer: {
    command: 'node server.mjs',
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.js/,
      use: { viewport: { width: 1280, height: 800 }, storageState: '.auth/state.json' },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
        storageState: '.auth/state.json',
      },
    },
  ],
});
