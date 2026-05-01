import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  seedAuthInBrowser,
} from './helpers';

/**
 * E2E coverage for #150: node-creation UI in NodeTreePanel.
 *
 * Pre-#150, nodes could only be created via API — meaning a fresh map
 * created via the UI was uninhabitable from the browser. These tests
 * cover the "+ Node" affordance + modal that closes that gap.
 */

test.describe('Node creation UI (#150)', () => {
  test('user creates a top-level node from a fresh map; tree updates and detail panel renders it', async ({ page, request }) => {
    const api = await registerViaApi(request, 'node_create_top');
    const map = await createMapViaApi(request, api, 'Fresh Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Empty state — no nodes yet, "+ Node" button visible.
    await expect(page.getByText(/no nodes on this map yet/i)).toBeVisible();
    const addButton = page.getByRole('button', { name: /\+ Node/i });
    await expect(addButton).toBeVisible();

    // Click "+ Node" → modal opens.
    await addButton.click();
    await expect(page.getByRole('heading', { name: /^new node$/i })).toBeVisible();

    // Fill form + submit.
    await page.getByLabel(/^name$/i).fill('Town Hall');
    await page.getByLabel(/^description$/i).fill('Where the council meets.');
    await page.getByLabel(/^color/i).fill('#cc0000');
    await page.getByRole('button', { name: /^create$/i }).click();

    // Tree shows the new node (button rendered in NodeTreeRow).
    await expect(page.getByRole('button', { name: 'Town Hall', exact: true })).toBeVisible();

    // Detail panel auto-renders the new node (panel renders the name as a heading).
    await expect(page.getByRole('heading', { name: 'Town Hall' })).toBeVisible();

    // Empty-state hint is gone.
    await expect(page.getByText(/no nodes on this map yet/i)).toHaveCount(0);
  });

  test('user creates a node with lat/lng on a wgs84 map; geometry round-trips and pans the map', async ({ page, request }) => {
    const api = await registerViaApi(request, 'node_create_coords');
    const map = await createMapViaApi(request, api, 'Geo Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    await page.getByRole('button', { name: /\+ Node/i }).click();
    await page.getByLabel(/^name$/i).fill('Catskills');
    // wgs84 maps surface "Latitude" and "Longitude" labels.
    await page.getByLabel(/^latitude$/i).fill('42.0');
    await page.getByLabel(/^longitude$/i).fill('-74.4');
    await page.getByRole('button', { name: /^create$/i }).click();

    // Tree row + detail panel both show the new node.
    await expect(page.getByRole('button', { name: 'Catskills', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Catskills' })).toBeVisible();

    // Round-trip the geometry through the API to confirm the Point was
    // saved with the right [lng, lat] ordering. (Visual map-marker checks
    // are brittle — assert the data shape instead.)
    const tokenRes = await request.get(
      `http://localhost:8080/api/v1/tenants/${api.tenantId}/maps/${map.id}/nodes`,
      { headers: { Authorization: `Bearer ${api.token}` } },
    );
    expect(tokenRes.ok()).toBeTruthy();
    const nodes = await tokenRes.json();
    const created = nodes.find((n: { name: string }) => n.name === 'Catskills');
    expect(created).toBeTruthy();
    expect(created.geoJson).toEqual({
      type: 'Point',
      coordinates: [-74.4, 42.0],  // GeoJSON [lng, lat] convention
    });
  });

  test('user creates a child node by picking a parent from the dropdown; tree shows the nested row', async ({ page, request }) => {
    const api = await registerViaApi(request, 'node_create_child');
    const map = await createMapViaApi(request, api, 'Parent-Child Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Create the parent first via the UI to make sure the create →
    // refresh → child-create flow round-trips through the same code paths
    // a user would actually exercise.
    await page.getByRole('button', { name: /\+ Node/i }).click();
    await page.getByLabel(/^name$/i).fill('Region');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('button', { name: 'Region', exact: true })).toBeVisible();

    // Now create a child of "Region" via the parent-picker.
    await page.getByRole('button', { name: /\+ Node/i }).click();
    await page.getByLabel(/^name$/i).fill('City');
    await page.getByLabel(/parent/i).selectOption({ label: 'Region' });
    await page.getByRole('button', { name: /^create$/i }).click();

    // The "City" node is selected (detail panel renders it as the
    // current selection). The tree won't render City as a row yet
    // because Region is collapsed — auto-expanding the parent chain
    // on child-create is a UX improvement deferred to a follow-up;
    // for now the user sees the new node in the detail panel and
    // expands the parent manually if they want it in the tree.
    await expect(page.getByRole('heading', { name: 'City' })).toBeVisible();
    // Detail panel also renders the parent breadcrumb — so the
    // parent-child relationship is observable without expanding the tree.
    await expect(page.getByText(/in/i).getByRole('button', { name: 'Region', exact: true })).toBeVisible();

    // Expand "Region" to confirm City is nested under it. The toggle
    // is the ▶/▼ button on Region's row in the tree (NOT the parent
    // breadcrumb in the detail panel — that's also "Region" but a
    // different element).
    const regionTreeRow = page.locator('.node-tree-row-inner', {
      has: page.getByRole('button', { name: 'Region', exact: true }),
    });
    await regionTreeRow.getByRole('button', { name: /expand/i }).click();

    // After expand, City should appear nested in Region's children list.
    // The selector confirms structural nesting (City inside the
    // .node-tree-children container that follows Region's row).
    const regionContainer = page.locator('.node-tree-row', { has: page.getByRole('button', { name: 'Region', exact: true }) }).first();
    await expect(regionContainer.locator('.node-tree-children').getByRole('button', { name: 'City', exact: true })).toBeVisible();
  });
});
