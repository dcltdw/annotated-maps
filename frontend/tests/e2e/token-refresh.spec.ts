import { test, expect } from '@playwright/test';
import { registerViaApi, seedAuthInBrowser } from './helpers';

/**
 * E2E coverage for #168: 401 + token-refresh interceptor.
 *
 * **Tested here:** the failure path. When the stored token is invalid,
 * the next API call 401s, the interceptor attempts /auth/refresh, the
 * refresh itself 401s (token signature is bad), the user is logged out
 * and redirected to /login.
 *
 * **NOT tested here:** the success path. Exercising "expired but
 * valid-signature token → refresh succeeds → retry succeeds" requires
 * a backend knob to issue a deliberately-expired token (or waiting
 * out the configured TTL). Both are out of scope; the interceptor's
 * happy path is straightforward enough to read from the diff.
 */

test.describe('Token refresh interceptor (#168)', () => {
  test('invalid token → /auth/refresh 401s → user is logged out and redirected', async ({ page, request }) => {
    const api = await registerViaApi(request, 'tokrefresh_fail');
    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps`);

    // Confirm we're on the maps page (the interceptor hasn't fired yet).
    await expect(page).toHaveURL(/\/maps/);

    // Corrupt the stored JWT — appending garbage breaks the signature so
    // both the next API request AND the subsequent /auth/refresh attempt
    // will 401, exercising the "refresh failed → logout" branch.
    await page.evaluate(() => {
      const raw = localStorage.getItem('auth-storage');
      if (!raw) throw new Error('no auth-storage in localStorage');
      const persisted = JSON.parse(raw);
      persisted.state.token = persisted.state.token + '_BROKEN';
      localStorage.setItem('auth-storage', JSON.stringify(persisted));
    });

    // Force a request through the interceptor by reloading; MapListPage's
    // useEffect calls loadMaps() → /tenants/{tid}/maps → 401 → refresh
    // → also 401 → logout + redirect.
    await page.reload();

    await expect(page).toHaveURL(/\/login$/);
  });
});
