import { test as base, expect, request as pwRequest } from '@playwright/test';

export { expect };

export const PASSWORD = process.env.E2E_PASSWORD || 'e2e-password';

/**
 * Things every test gets:
 *
 *  - `problems` (automatic): the test fails if the page threw, logged an error to the console, or
 *    the browser refused something under the Content-Security-Policy. This keeps the strict CSP
 *    honest: a stray inline script or style anywhere in the UI shows up here.
 *  - `api`: the admin API as the signed-in admin, for setting up and cleaning up.
 *  - `svc`: makes services with a unique name and deletes them when the test ends.
 */
export const test = base.extend({
  problems: [
    async ({ page }, use) => {
      const seen = [];
      page.on('pageerror', (err) => seen.push(`page error: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') seen.push(`console error: ${msg.text()}`);
      });
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile || ''}:${e.lineNumber || 0})`);
        });
      });
      await use({
        seen,
        /** For a test that causes an error on purpose, say which message to ignore. */
        allow: (pattern) => {
          for (let i = seen.length - 1; i >= 0; i--) if (pattern.test(seen[i])) seen.splice(i, 1);
        },
      });
      expect(seen, 'the page should raise no errors and no CSP violations').toEqual([]);
    },
    { auto: true },
  ],

  api: async ({ baseURL }, use) => {
    const ctx = await pwRequest.newContext({
      baseURL,
      storageState: '.auth/state.json',
      extraHTTPHeaders: { 'X-Postern-Admin': '1' },
    });
    const call = async (method, path, data) => {
      const res = await ctx[method](`/admin/api/${path}`, data === undefined ? {} : { data });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: res.status(), ok: res.ok(), body };
    };
    await use({
      get: (p) => call('get', p),
      post: (p, d = {}) => call('post', p, d),
      put: (p, d) => call('put', p, d),
      del: (p) => call('delete', p),
      /** Back to default settings, since settings are shared by every test. */
      resetSettings: () => call('put', 'settings', { rateLimit: 120, activityLimit: 20, auditLimit: 100, embedOrigins: [] }),
    });
    await ctx.dispose();
  },

  svc: async ({ api }, use, testInfo) => {
    const made = [];
    const tag = `e2e-${testInfo.workerIndex}-${Date.now().toString(36)}`;
    await use({
      /** A name no other test uses. */
      name: (suffix = '') => `${tag}${suffix ? `-${suffix}` : ''}`,
      /** Creates a service through the API. Returns the service as the server describes it. */
      create: async (suffix = '', extra = {}) => {
        const name = `${tag}${suffix ? `-${suffix}` : ''}`;
        const res = await api.post('services', {
          name,
          url: 'https://upstream.invalid',
          auth: { header: { name: 'X-Api-Key', secret: 'upstream-secret-value' } },
          ...extra,
        });
        if (!res.ok) throw new Error(`could not create ${name}: ${res.status} ${JSON.stringify(res.body)}`);
        made.push(name);
        return res.body;
      },
      track: (name) => made.push(name),
    });
    for (const name of made) await api.del(`services/${encodeURIComponent(name)}`);
    // A test may have made services by hand with the tag as a prefix; sweep those too.
    const all = await api.get('services');
    for (const s of all.body || []) if (s.name.startsWith(tag)) await api.del(`services/${encodeURIComponent(s.name)}`);
  },
});
