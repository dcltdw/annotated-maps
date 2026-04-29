import { test, expect, Page } from '@playwright/test';
import { makeUser } from './helpers';

/**
 * E2E coverage for cross-tenant isolation (#38).
 *
 * Each test runs **two separate browser contexts** so user A and user B
 * have independent localStorage / cookies / JWTs — the same way two
 * humans on different laptops would. (Sharing a single context would
 * just log one user out when the other registers.)
 *
 * What we're proving:
 *  1. Registration creates a fresh tenant per user (different /tenants/N/...)
 *  2. User B's map list does not surface user A's maps; B cannot reach A's
 *     map page by direct URL.
 *
 * The previous "annotations and notes don't leak" test is gone — that flow
 * relied on the leaflet-draw toolbar and the lat/lng-based notes UI, both
 * removed during the rebuild. The equivalent for the new model (nodes +
 * node-attached notes) lands in #104 once the tree panel + node detail
 * UI are in place.
 */

const MAPS_URL_RE   = /\/tenants\/(\d+)\/maps$/;
const MAP_DETAIL_RE = /\/tenants\/(\d+)\/maps\/(\d+)$/;

interface RegisteredUser {
  tenantId: number;
  mapsUrl: string; // captured directly from the URL post-register
}

async function registerInContext(page: Page, tag: string): Promise<RegisteredUser> {
  const user = makeUser(tag);
  await page.goto('/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password',         { exact: true }).fill(user.password);
  await page.getByLabel('Confirm Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(MAPS_URL_RE);

  const url = page.url();
  const match = url.match(MAPS_URL_RE);
  return { tenantId: Number(match![1]), mapsUrl: url };
}

async function createMap(page: Page, title: string): Promise<{ mapId: number; detailUrl: string }> {
  await page.getByRole('button', { name: /new map|create your first map/i }).first().click();
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(MAP_DETAIL_RE);
  const m = page.url().match(MAP_DETAIL_RE)!;
  return { mapId: Number(m[2]), detailUrl: page.url() };
}

test.describe('Cross-tenant isolation', () => {
  test('two new registrations land in different tenants', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const userA = await registerInContext(await ctxA.newPage(), 'xt_distinct_a');
      const userB = await registerInContext(await ctxB.newPage(), 'xt_distinct_b');
      expect(userA.tenantId).not.toBe(userB.tenantId);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("user A's map is invisible in user B's map list and via direct URL", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await registerInContext(pageA, 'xt_map_a');
      const { detailUrl } = await createMap(pageA, 'Secret Trail Map');

      await registerInContext(pageB, 'xt_map_b');

      // B's own map list is the empty-state — A's map is not visible.
      await expect(pageB.getByText(/you don't have any maps yet/i)).toBeVisible();
      await expect(pageB.getByRole('heading', { name: 'Secret Trail Map' })).toHaveCount(0);

      // B navigating to A's map URL gets the same friendly error the
      // detail page uses for both 403 and 404 from the API.
      await pageB.goto(detailUrl);
      await expect(
        pageB.getByText(/map not found or you do not have permission/i)
      ).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  // The old "annotations and notes don't leak" test (and its dependence on
  // leaflet-draw + the lat/lng note UI) is gone — both are removed in the
  // rebuild. The equivalent for the new node + node-attached-notes model
  // lands in #104 alongside the tree panel + node detail UI.
});
