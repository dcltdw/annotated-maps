import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
  API_URL,
  type ApiUser,
} from './helpers';

/**
 * E2E for #198 — edge rendering layer (read-only).
 *
 * Seeds an edge between two existing nodes via the backend API, then
 * navigates to the map and asserts the polyline is rendered. Covers the
 * directed-edge marker and the wgs84 coord system — the cross-coord-system
 * lock-in (pixel + blank) is filed as part of #200's coordinate-systems-crud
 * extension, not duplicated here.
 *
 * Create / edit UX lands in #199; this spec only verifies that an edge
 * the backend already knows about renders correctly.
 */

const WGS84 = {
  type: 'wgs84' as const,
  center: { lat: 0, lng: 0 },
  zoom: 3,
};

async function createEdgeViaApi(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  body: {
    sourceNodeId: number;
    destNodeId: number;
    directed?: boolean;
    color?: string;
    label?: string;
  },
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/maps/${mapId}/edges`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: body },
  );
  if (!res.ok()) {
    throw new Error(`createEdge failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

test.describe('Edges — rendering (#198)', () => {
  test('an edge between two Point nodes renders as a polyline on the map', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_render');
    const map = await createMapViaApi(request, api, 'Edge render', WGS84);

    // Two nodes with Point geometry — endpoints we can connect.
    const a = await createNodeViaApi(request, api, map.id, {
      name: 'NodeA',
      geoJson: { type: 'Point', coordinates: [0, 0] },
    });
    const b = await createNodeViaApi(request, api, map.id, {
      name: 'NodeB',
      geoJson: { type: 'Point', coordinates: [10, 5] },
    });

    await createEdgeViaApi(request, api, map.id, {
      sourceNodeId: a.id,
      destNodeId: b.id,
      color: '#ff5500',
    });

    // Boot authenticated and navigate to the map detail page.
    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // The map renders SVG paths for both polyline-like layers (edges) and
    // any polygon nodes. We have no polygon/line nodes in this test, so
    // every <path> in the overlay pane is an edge polyline.
    const paths = page.locator('.leaflet-overlay-pane svg path');
    await expect(paths).toHaveCount(1, { timeout: 10000 });
    // Edge color is applied via the path's `stroke` attribute.
    await expect(paths.first()).toHaveAttribute('stroke', '#ff5500');
  });

  test('a directed edge renders an extra circle marker at the destination', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_directed');
    const map = await createMapViaApi(request, api, 'Edge directed', WGS84);

    const a = await createNodeViaApi(request, api, map.id, {
      name: 'NodeA',
      geoJson: { type: 'Point', coordinates: [0, 0] },
    });
    const b = await createNodeViaApi(request, api, map.id, {
      name: 'NodeB',
      geoJson: { type: 'Point', coordinates: [5, 5] },
    });

    await createEdgeViaApi(request, api, map.id, {
      sourceNodeId: a.id,
      destNodeId: b.id,
      directed: true,
      color: '#3388ff',
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Directed edges add a CircleMarker at the dest endpoint. Leaflet
    // renders CircleMarker as an SVG <path> with a circular `d` attr —
    // it shows up alongside the polyline path. So we expect 2 paths
    // (1 polyline + 1 directed-marker) instead of 1.
    const paths = page.locator('.leaflet-overlay-pane svg path');
    await expect(paths).toHaveCount(2, { timeout: 10000 });
  });

  test('edges with non-Point endpoints are skipped (no crash, no render)', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_skip_nonpoint');
    const map = await createMapViaApi(request, api, 'Edge skip', WGS84);

    const a = await createNodeViaApi(request, api, map.id, {
      name: 'PointNode',
      geoJson: { type: 'Point', coordinates: [0, 0] },
    });
    // Tree-only node (no geoJson) — edge from this node should be skipped.
    const b = await createNodeViaApi(request, api, map.id, { name: 'TreeOnly' });

    await createEdgeViaApi(request, api, map.id, {
      sourceNodeId: a.id,
      destNodeId: b.id,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // The polyline shouldn't render because TreeOnly lacks Point geometry.
    // We expect 0 paths in the overlay pane (no edges, no polygon nodes).
    // Wait briefly to be sure the listEdges call has finished and
    // nothing rendered as a side effect.
    await page.waitForTimeout(500);
    const paths = page.locator('.leaflet-overlay-pane svg path');
    await expect(paths).toHaveCount(0);
  });
});
