import { randomUUID } from 'crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

// The Playwright `request` fixture inherits the spec's baseURL (5173), but
// the backend lives on a different port. Hit it directly for the API
// helpers below so we don't bounce through Vite's dev server.
export const API_URL =
  process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:8080/api/v1';

/**
 * Helpers shared across E2E specs.
 *
 * Tests run against a live backend with a persistent database, so each
 * test must use unique credentials to avoid duplicate-key collisions
 * with prior runs AND with parallel workers.
 */

let counter = 0;

/**
 * Generate a unique user object scoped to the current test run.
 * `tag` should be a short test-identifying string (e.g. 'reg', 'login')
 * to make it easy to spot leftover rows in the dev DB.
 *
 * Uniqueness layers (earlier cure latent collisions; later is defense
 * in depth):
 *  - `process.pid` — differs across Playwright workers; resets to 0 in
 *    each worker, so module-level counters can't disambiguate two
 *    workers starting the same test at the same millisecond. Before
 *    this was added, --repeat-each=20 under parallel workers hit
 *    "username already taken" ~30% of runs (#76).
 *  - `counter` — monotonic within a worker; disambiguates tests that
 *    start inside the same ms within the same process.
 *  - random UUID slice — insulates against worker pid reuse after a
 *    crash-and-respawn and any future scheduling weirdness.
 */
export function makeUser(tag: string): {
  username: string;
  email: string;
  password: string;
} {
  counter += 1;
  const id = [
    process.pid.toString(36),
    counter.toString(36),
    randomUUID().slice(0, 8),
  ].join('_');
  return {
    username: `e2e_${tag}_${id}`,
    email:    `e2e_${tag}_${id}@e2e.test`,
    password: 'pw_for_e2e_test_only',
  };
}

// ─── API-driven session setup ────────────────────────────────────────────────
// Specs that exercise UI which doesn't yet have its own create flow
// (pixel/blank maps in #128, multi-level node trees in #104) drive setup
// via direct backend API calls + localStorage seeding. The pattern was
// originally inlined in coordinate-systems.spec.ts; lifted here once the
// second spec needed it.

export interface ApiUser {
  token: string;
  tenantId: number;
  user: { id: number; username: string; email: string };
}

export async function registerViaApi(
  request: APIRequestContext,
  tag: string,
): Promise<ApiUser> {
  const u = makeUser(tag);
  const res = await request.post(`${API_URL}/auth/register`, {
    data: { username: u.username, email: u.email, password: u.password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token, tenantId: body.tenantId, user: body.user };
}

export async function createMapViaApi(
  request: APIRequestContext,
  api: ApiUser,
  title: string,
  coordinateSystem: unknown,
): Promise<{ id: number }> {
  const res = await request.post(`${API_URL}/tenants/${api.tenantId}/maps`, {
    headers: { Authorization: `Bearer ${api.token}` },
    data: { title, coordinateSystem },
  });
  if (!res.ok()) {
    throw new Error(`createMap failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

interface CreateNodeBody {
  name: string;
  parentId?: number;
  geoJson?: unknown;
  description?: string;
  color?: string;
}

export async function createNodeViaApi(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  body: CreateNodeBody,
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/maps/${mapId}/nodes`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: body },
  );
  if (!res.ok()) {
    throw new Error(`createNode failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Seed the zustand-persisted auth storage so the SPA boots authenticated.
 * Must be called *before* navigating to any route that requires auth, but
 * *after* an initial `page.goto('/login')` (or any path on the right
 * origin) so localStorage is writable.
 */
export async function seedAuthInBrowser(page: Page, api: ApiUser): Promise<void> {
  await page.goto('/login');
  await page.evaluate((api) => {
    const persisted = {
      state: {
        token: api.token,
        user: api.user,
        orgId: null,
        tenantId: api.tenantId,
        tenants: [
          { id: api.tenantId, name: '', slug: '', role: 'admin' as const },
        ],
        branding: {},
      },
      version: 0,
    };
    localStorage.setItem('auth-storage', JSON.stringify(persisted));
  }, api);
}
