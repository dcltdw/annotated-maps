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
 *  2. User B's map list does not surface user A's maps
 *  3. User B cannot reach user A's map page by direct URL — the same
 *     friendly "not found / no permission" copy fires that we see for
 *     non-existent maps in the same tenant
 *  4. Annotations and notes added by A on their map don't leak to B
 *     (B still can't open the map, so they see none of its content)
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

  test("annotations and notes on user A's map don't leak to user B", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await registerInContext(pageA, 'xt_content_a');
      const { detailUrl } = await createMap(pageA, 'Map With Stuff');

      // A drops a marker annotation.
      let promptCalls = 0;
      pageA.on('dialog', async (dialog) => {
        promptCalls += 1;
        if (promptCalls === 1) await dialog.accept('Hidden annotation');
        else if (promptCalls === 2) await dialog.accept('Should not leak.');
        else await dialog.dismiss();
      });
      await pageA.locator('.leaflet-draw-draw-marker').click();
      await pageA.locator('.leaflet-container').click({ position: { x: 400, y: 300 } });
      await expect(pageA.locator('.leaflet-marker-icon').first()).toBeVisible();

      // A creates a note on the same map.
      pageA.removeAllListeners('dialog');
      await pageA.getByRole('button', { name: '+ Note' }).click();
      await pageA.getByPlaceholder(/Note text/i).fill('Hidden note text.');
      await pageA.getByRole('button', { name: /place on map/i }).click();
      await pageA.locator('.leaflet-container').click({ position: { x: 500, y: 350 } });
      await expect(pageA.getByText(/📍 -?\d+\.\d+, -?\d+\.\d+/)).toBeVisible();
      await pageA.getByRole('button', { name: /^Save$/ }).click();
      // Wait for the placement preview popup to clear; confirms note saved.
      await expect(pageA.getByText('Note will be placed here')).toHaveCount(0, { timeout: 7000 });

      // B's view: no maps, can't open A's map URL, no leaked content.
      await registerInContext(pageB, 'xt_content_b');
      await expect(pageB.getByText(/you don't have any maps yet/i)).toBeVisible();

      await pageB.goto(detailUrl);
      await expect(
        pageB.getByText(/map not found or you do not have permission/i)
      ).toBeVisible();

      // Sanity — the leaked content strings really aren't anywhere on B's page.
      await expect(pageB.getByText(/Hidden annotation/)).toHaveCount(0);
      await expect(pageB.getByText(/Hidden note text/)).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
