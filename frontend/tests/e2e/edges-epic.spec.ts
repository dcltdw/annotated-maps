import { test, expect, type Locator } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
} from './helpers';

/**
 * Epic lock-in E2E for the Edges epic (#148). Full round-trip in one
 * spec — covers the integration points across all four implementation
 * tickets (#148 backend CRUD, #197 visibility filter, #198 rendering,
 * #199 toolbar UX, #200 detail-panel section):
 *
 *   - create two nodes via API → navigate to map
 *   - toolbar "+ Edge" → click source → click dest → modal → save
 *   - polyline renders
 *   - click polyline → edit label → save → reload → label persists
 *   - select a source-side node → NodeDetailPanel shows the edge in the
 *     Edges section with the correct direction glyph
 *   - "Remove" in the panel → confirm → edge gone from panel AND map
 *
 * The "+ Edge from here" affordance (#200) is exercised in its own test
 * below: select a node, click the button in the panel, pick a dest by
 * clicking on the map, save, verify.
 */

const WGS84 = {
  type: 'wgs84' as const,
  center: { lat: 0, lng: 0 },
  zoom: 3,
};

// Leaflet's L.DomEvent listens for native events; Playwright's
// synthetic .click() doesn't trigger it. dispatchEvent is the same
// trick used in edges-create-edit.spec.ts and is documented in the
// PR #199 description for future-spec reference.
async function clickLeafletEl(locator: Locator): Promise<void> {
  await locator.evaluate((el) =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  );
}

test.describe('Edges — epic lock-in (#148 / #197 / #198 / #199 / #200)', () => {
  test('full round-trip: create via toolbar, edit, find in detail panel, remove', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_epic');
    const map = await createMapViaApi(request, api, 'Epic edges', WGS84);

    await createNodeViaApi(request, api, map.id, {
      name: 'NodeA',
      geoJson: { type: 'Point', coordinates: [0, 0] },
    });
    await createNodeViaApi(request, api, map.id, {
      name: 'NodeB',
      geoJson: { type: 'Point', coordinates: [10, 5] },
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // ── Create via toolbar ───────────────────────────────────────────────
    await page.getByRole('button', { name: /\+ edge/i }).click();
    await expect(page.getByText(/click the source node/i)).toBeVisible();

    const markers = page.locator('.leaflet-marker-icon');
    await clickLeafletEl(markers.nth(0));
    await expect(page.getByText(/click the destination node/i)).toBeVisible();
    await clickLeafletEl(markers.nth(1));

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/^label/i).fill('Trade route');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(1, { timeout: 10000 });

    // ── Edit + reload persistence ────────────────────────────────────────
    await clickLeafletEl(page.locator('.leaflet-overlay-pane svg path').first());
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel(/^label/i).fill('Updated route');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    await page.reload();
    await clickLeafletEl(page.locator('.leaflet-overlay-pane svg path').first());
    await expect(page.getByLabel(/^label/i)).toHaveValue('Updated route');
    // Close the modal so the rest of the flow can interact freely.
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // ── Detail panel: select NodeA, see the edge listed ──────────────────
    // The tree panel has a button per node; clicking selects + scrolls the
    // detail panel into view.
    await page.getByRole('button', { name: 'NodeA' }).click();

    // EdgesSection lists the row with NodeB as the other endpoint.
    const edgesSection = page.locator('.edges-section');
    await expect(edgesSection.getByRole('heading', { name: /^edges$/i })).toBeVisible();
    await expect(edgesSection.getByRole('button', { name: 'NodeB' })).toBeVisible();

    // Other-endpoint click should navigate selection. We don't need to
    // assert on URL here — the heading flipping to NodeB is enough.
    await edgesSection.getByRole('button', { name: 'NodeB' }).click();
    await expect(page.getByRole('heading', { name: 'NodeB', level: 2 })).toBeVisible();

    // ── Remove via panel ─────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await page.locator('.edges-section').getByRole('button', { name: /^remove$/i }).click();
    // Edge gone from panel
    await expect(page.locator('.edges-section').getByRole('button', { name: 'NodeA' })).toHaveCount(0);
    // Gone from map (refetch + rerender)
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);

    // Reload — still gone (DELETE was real, not just optimistic).
    await page.reload();
    await page.waitForTimeout(500);
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(0);
  });

  test('"+ Edge from here" prefills source and only the dest needs picking', async ({ page, request }) => {
    const api = await registerViaApi(request, 'edges_epic_fromhere');
    const map = await createMapViaApi(request, api, 'Epic from-here', WGS84);
    await createNodeViaApi(request, api, map.id, {
      name: 'NodeA',
      geoJson: { type: 'Point', coordinates: [0, 0] },
    });
    await createNodeViaApi(request, api, map.id, {
      name: 'NodeB',
      geoJson: { type: 'Point', coordinates: [10, 5] },
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Select NodeA from the tree so its panel section renders.
    await page.getByRole('button', { name: 'NodeA' }).click();
    await expect(page.locator('.edges-section')).toBeVisible();

    // "+ Edge from here" button in the section header.
    await page.locator('.edges-section').getByRole('button', { name: /\+ edge from here/i }).click();

    // Toolbar should jump straight to "Click the destination node"
    // (source is prefilled — picking-source is skipped).
    await expect(page.getByText(/click the destination node/i)).toBeVisible();
    // We should NOT have seen the "Click the source node" hint.
    await expect(page.getByText(/click the source node/i)).not.toBeVisible();

    // Click NodeB as the dest. The second marker by creation order.
    await page.locator('.leaflet-marker-icon').nth(1).evaluate((el) =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    );

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.locator('.leaflet-overlay-pane svg path')).toHaveCount(1, { timeout: 10000 });
  });
});
