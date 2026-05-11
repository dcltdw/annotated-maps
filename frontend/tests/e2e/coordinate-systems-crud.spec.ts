import { test, expect, type Locator } from '@playwright/test';
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

    test(`${name}: edge create + delete (Wave 4 #200 lock-in)`, async ({ page, request }) => {
      // Each coord system uses its own pointable coordinates. wgs84 +
      // blank both accept [x, y] in the GeoJSON spec; pixel uses image
      // pixels. The Point geometry shape is the same — the renderer
      // interprets it per coord-system at view time.
      const pointA: [number, number] =
        name === 'pixel' ? [200, 200] :
        name === 'blank' ? [100, 100] :
        [0, 0];
      const pointB: [number, number] =
        name === 'pixel' ? [600, 400] :
        name === 'blank' ? [400, 300] :
        [10, 5];

      const api = await registerViaApi(request, `${name}_edge_lockin`);
      const map = await createMapViaApi(request, api, `${name} Edge Lockin`, cs);
      await createNodeViaApi(request, api, map.id, {
        name: 'NodeA',
        geoJson: { type: 'Point', coordinates: pointA },
      });
      await createNodeViaApi(request, api, map.id, {
        name: 'NodeB',
        geoJson: { type: 'Point', coordinates: pointB },
      });

      await seedAuthInBrowser(page, api);
      await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

      // Create the edge via the toolbar two-step pick. The same
      // dispatchEvent trick used elsewhere — Leaflet's L.DomEvent
      // listens for real native events; Playwright's synthetic
      // .click() doesn't trigger it.
      await page.getByRole('button', { name: /\+ edge/i }).click();
      const dispatchClick = (loc: Locator) =>
        loc.evaluate((el) =>
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        );
      const markers = page.locator('.leaflet-marker-icon');
      await dispatchClick(markers.nth(0));
      await dispatchClick(markers.nth(1));
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: /^create$/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();

      // Polyline renders on this coord system.
      await expect(
        page.locator('.leaflet-overlay-pane svg path'),
      ).toHaveCount(1, { timeout: 10000 });

      // Delete via the polyline click → modal → Delete.
      page.once('dialog', (d) => d.accept());
      await dispatchClick(page.locator('.leaflet-overlay-pane svg path').first());
      await page.getByRole('button', { name: /^delete$/i }).click();
      await expect(
        page.locator('.leaflet-overlay-pane svg path'),
      ).toHaveCount(0);
    });
  });
}
