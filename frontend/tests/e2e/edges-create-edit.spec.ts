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
 * E2E for #199 — edge create + edit UX.
 *
 * Read-only rendering is covered by edges.spec.ts (#198). This spec covers
 * the toolbar-driven create flow, the click-to-edit modal, delete, and
 * Esc cancellation. NodeDetailPanel-side edge listing is in #200's spec.
 *
 * The maps in these tests use a wgs84 coord system because the tests
 * interact with Leaflet markers as the picking targets — the same DOM
 * shape applies to pixel/blank, but cross-coord-system lock-in is
 * #200's coordinate-systems-crud extension.
 */

const WGS84 = {
  type: 'wgs84' as const,
  center: { lat: 0, lng: 0 },
  zoom: 3,
};

async function seedMapWithTwoNodes(
  request: APIRequestContext,
  api: ApiUser,
  tag: string,
): Promise<{ mapId: number; nodeAId: number; nodeBId: number }> {
  const map = await createMapViaApi(request, api, `Edge UX ${tag}`, WGS84);
  const a = await createNodeViaApi(request, api, map.id, {
    name: 'NodeA',
    geoJson: { type: 'Point', coordinates: [0, 0] },
  });
  const b = await createNodeViaApi(request, api, map.id, {
    name: 'NodeB',
    geoJson: { type: 'Point', coordinates: [10, 5] },
  });
  return { mapId: map.id, nodeAId: a.id, nodeBId: b.id };
}

async function createEdgeViaApi(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  body: { sourceNodeId: number; destNodeId: number; label?: string; color?: string; directed?: boolean },
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/maps/${mapId}/edges`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: body },
  );
  if (!res.ok()) throw new Error(`createEdge failed: ${res.status()}`);
  return res.json();
}

test.describe('Edges — create + edit UX (#199)', () => {
  test('toolbar two-step pick → modal → create renders the polyline', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_ux_create');
    const { mapId } = await seedMapWithTwoNodes(request, api, 'create');

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${mapId}`);

    // Toolbar shows when caller has edit perm (owner here).
    await page.getByRole('button', { name: /\+ edge/i }).click();
    await expect(page.getByText(/click the source node/i)).toBeVisible();

    // Click the two markers to pick source then dest. Leaflet renders
    // each Point node as a `.leaflet-marker-icon`; first() / nth(1) by
    // creation order in our seed. Use dispatchEvent because Leaflet's
    // L.DomEvent listens for real native events; Playwright's synthetic
    // click sometimes goes through actionability checks but doesn't
    // trigger Leaflet's underlying click binding.
    const clickMarker = (idx: number) =>
      page.locator('.leaflet-marker-icon').nth(idx).evaluate((el) =>
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      );
    await clickMarker(0);
    await expect(page.getByText(/click the destination node/i)).toBeVisible();
    await clickMarker(1);

    // Modal opens with both endpoints prefilled.
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/^label/i).fill('Trade route');
    await page.getByRole('button', { name: /^create$/i }).click();

    // Modal closes, polyline appears in the overlay pane.
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const paths = page.locator('.leaflet-overlay-pane svg path');
    await expect(paths).toHaveCount(1, { timeout: 10000 });
  });

  test('clicking an existing edge opens the edit modal and saves changes that persist on reload', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_ux_edit');
    const { mapId, nodeAId, nodeBId } = await seedMapWithTwoNodes(request, api, 'edit');
    await createEdgeViaApi(request, api, mapId, {
      sourceNodeId: nodeAId,
      destNodeId: nodeBId,
      label: 'Initial',
      color: '#3388ff',
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${mapId}`);

    // Click the polyline (only path in the overlay pane for this test).
    // Same dispatchEvent trick as marker clicks — Leaflet's path uses
    // its own event binding, not the React synthetic event chain.
    const clickPolyline = () =>
      page.locator('.leaflet-overlay-pane svg path').first().evaluate((el) =>
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      );
    await clickPolyline();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Label field reflects the existing value, then we change it.
    const label = page.getByLabel(/^label/i);
    await expect(label).toHaveValue('Initial');
    await label.fill('Updated');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Reload and re-open to confirm the new value round-trips through the API.
    await page.reload();
    await clickPolyline();
    await expect(page.getByLabel(/^label/i)).toHaveValue('Updated');
  });

  test('delete from the edit modal removes the edge and survives reload', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_ux_delete');
    const { mapId, nodeAId, nodeBId } = await seedMapWithTwoNodes(request, api, 'delete');
    await createEdgeViaApi(request, api, mapId, { sourceNodeId: nodeAId, destNodeId: nodeBId });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${mapId}`);

    // Polyline visible pre-delete.
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(1, { timeout: 10000 });

    page.once('dialog', (d) => d.accept());  // confirm() prompt
    await page.locator('.leaflet-overlay-pane svg path').first().evaluate((el) =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    );
    await page.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Polyline gone after refetch.
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);

    // Reload — still gone (DELETE was real, not just optimistic).
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
  });

  test('Esc cancels edge-create mid-flow without creating an edge', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_ux_cancel');
    const { mapId } = await seedMapWithTwoNodes(request, api, 'cancel');

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${mapId}`);

    await page.getByRole('button', { name: /\+ edge/i }).click();
    await expect(page.getByText(/click the source node/i)).toBeVisible();

    await page.locator('.leaflet-marker-icon').nth(0).evaluate((el) =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    );
    await expect(page.getByText(/click the destination node/i)).toBeVisible();

    // Esc — modal should NOT open and toolbar returns to idle.
    await page.keyboard.press('Escape');
    await expect(page.getByText(/click the destination node/i)).not.toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // No polyline created.
    await page.waitForTimeout(500);
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
  });
});
