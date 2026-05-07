import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
} from './helpers';

/**
 * E2E coverage for #170: cross-coordinate-system CRUD lock-in.
 *
 * The existing E2E suite implicitly tests wgs84 maps everywhere (every
 * `createMapViaApi` defaults to wgs84). The pixel + blank renderers are
 * exercised by `coordinate-systems.spec.ts`, but no test covers the
 * full CRUD flows (map edit/delete, location create/edit/delete) on
 * non-wgs84 maps. This spec parameterizes the most-touched flows over
 * all three types so a future wgs84-ism in any of these UIs would fail
 * pixel + blank rather than silently passing.
 *
 * Risks each flow guards against:
 *  - Map edit modal: a wgs84-ism in the modal payload (e.g. flat
 *    centerLat/centerLng) would fail on pixel/blank where those don't
 *    exist.
 *  - Location create/edit/delete: NodeTreePanel + Location modal are
 *    coord-agnostic by design; this pins that.
 *  - Map delete: cascade should fire identically across types.
 */

const COORD_SYSTEMS = [
  {
    name: 'wgs84',
    cs: { type: 'wgs84' as const, center: { lat: 0, lng: 0 }, zoom: 3 },
  },
  {
    name: 'pixel',
    cs: {
      type: 'pixel' as const,
      image_url: 'https://example.com/test.png',
      width: 1024,
      height: 768,
      viewport: { x: 512, y: 384, zoom: 0 },
    },
  },
  {
    name: 'blank',
    cs: { type: 'blank' as const, extent: { x: 1000, y: 800 } },
  },
];

for (const { name, cs } of COORD_SYSTEMS) {
  test.describe(`Cross-type CRUD on ${name} maps`, () => {
    test(`${name}: map title edit persists`, async ({ page, request }) => {
      const api = await registerViaApi(request, `${name}_mapedit`);
      await createMapViaApi(request, api, `${name} Original`, cs);

      await seedAuthInBrowser(page, api);
      await page.goto(`/tenants/${api.tenantId}/maps`);

      const card = page.locator('.map-card-wrapper', {
        has: page.getByRole('heading', { name: `${name} Original`, exact: true }),
      });
      await card.getByRole('button', { name: /map actions/i }).click();
      await page.getByRole('menuitem', { name: /^edit$/i }).click();

      const titleField = page.getByLabel(/^title$/i);
      await expect(titleField).toHaveValue(`${name} Original`);
      await titleField.fill(`${name} Renamed`);
      await page.getByRole('button', { name: /^save$/i }).click();

      await expect(
        page.getByRole('heading', { name: `${name} Renamed`, exact: true }),
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole('heading', { name: `${name} Renamed`, exact: true }),
      ).toBeVisible();
    });

    test(`${name}: map delete from list page`, async ({ page, request }) => {
      const api = await registerViaApi(request, `${name}_mapdel`);
      await createMapViaApi(request, api, `${name} Doomed`, cs);

      await seedAuthInBrowser(page, api);
      await page.goto(`/tenants/${api.tenantId}/maps`);

      page.once('dialog', (d) => d.accept());
      const card = page.locator('.map-card-wrapper', {
        has: page.getByRole('heading', { name: `${name} Doomed`, exact: true }),
      });
      await card.getByRole('button', { name: /map actions/i }).click();
      await page.getByRole('menuitem', { name: /^delete$/i }).click();

      await expect(
        page.getByRole('heading', { name: `${name} Doomed`, exact: true }),
      ).toHaveCount(0);
    });

    test(`${name}: location create + edit + delete`, async ({ page, request }) => {
      const api = await registerViaApi(request, `${name}_locrud`);
      const map = await createMapViaApi(request, api, `${name} CRUD Map`, cs);

      await seedAuthInBrowser(page, api);
      await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

      // ── Create ────────────────────────────────────────────────────────
      await page.getByRole('button', { name: /\+ Location/i }).click();
      await expect(
        page.getByRole('heading', { name: /^new location$/i }),
      ).toBeVisible();
      await page.getByLabel(/^name$/i).fill('Place A');
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(
        page.getByRole('button', { name: 'Place A', exact: true }),
      ).toBeVisible();

      // ── Edit (rename) ─────────────────────────────────────────────────
      const row = page.locator('.node-tree-row-inner', {
        has: page.getByRole('button', { name: 'Place A', exact: true }),
      });
      await row.getByRole('button', { name: /location actions/i }).click();
      await page.getByRole('menuitem', { name: /^edit$/i }).click();
      await page.getByLabel(/^name$/i).fill('Place B');
      await page.getByRole('button', { name: /^save$/i }).click();
      await expect(
        page.getByRole('button', { name: 'Place B', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Place A', exact: true }),
      ).toHaveCount(0);

      // ── Delete ────────────────────────────────────────────────────────
      page.once('dialog', (d) => d.accept());
      const renamedRow = page.locator('.node-tree-row-inner', {
        has: page.getByRole('button', { name: 'Place B', exact: true }),
      });
      await renamedRow.getByRole('button', { name: /location actions/i }).click();
      await page.getByRole('menuitem', { name: /^delete$/i }).click();
      await expect(
        page.getByRole('button', { name: 'Place B', exact: true }),
      ).toHaveCount(0);
    });

    test(`${name}: detail panel renders the node name`, async ({ page, request }) => {
      const api = await registerViaApi(request, `${name}_locdetail`);
      const map = await createMapViaApi(request, api, `${name} Detail Map`, cs);
      await createNodeViaApi(request, api, map.id, { name: 'NodeForDetail' });

      await seedAuthInBrowser(page, api);
      await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

      await page.getByRole('button', { name: 'NodeForDetail', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'NodeForDetail' }),
      ).toBeVisible();
    });
  });
}
