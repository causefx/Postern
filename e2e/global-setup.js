import { request } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** Signs in once and keeps the session cookie, so only the login tests go through the form. */
export default async function globalSetup(config) {
  const baseURL = config.projects[0].use.baseURL;
  mkdirSync('.auth', { recursive: true });
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/admin/api/login', {
    data: { password: process.env.E2E_PASSWORD || 'e2e-password', remember: true },
  });
  if (!res.ok()) throw new Error(`sign-in failed: ${res.status()} ${await res.text()}`);
  await ctx.storageState({ path: '.auth/state.json' });
  await ctx.dispose();
}
