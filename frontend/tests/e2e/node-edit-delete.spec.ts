import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
} from './helpers';

/**
 * E2E coverage for #158: location edit + delete UI.
 *
 * Pre-#158, locations had only create + read. The "⋯" button on each
 * tree row was disabled; the only path to edit/delete was via API.
 * These tests cover the basic CRUD primitives now exposed in the UI.
 */

test.describe('Location edit + delete (#158)', () => {
  test('user edits a location\'s name and description; changes persist', async ({ page, request }) => {
    const api = await registerViaApi(request, 'loc_edit');
    const map = await createMapViaApi(request, api, 'Edit Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, {
      name: 'Old Name',
      description: 'Old description',
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Open the row's ⋯ menu and click Edit.
    const row = page.locator('.node-tree-row-inner', {
      has: page.getByRole('button', { name: 'Old Name', exact: true }),
    });
    await row.getByRole('button', { name: /location actions/i }).click();
    await page.getByRole('menuitem', { name: /^edit$/i }).click();

    // Modal opens in edit mode pre-populated.
    await expect(page.getByRole('heading', { name: /^edit location$/i })).toBeVisible();
    const nameField = page.getByLabel(/^name$/i);
    await expect(nameField).toHaveValue('Old Name');
    await expect(page.getByLabel(/^description$/i)).toHaveValue('Old description');

    // Update both fields and save.
    await nameField.fill('New Name');
    await page.getByLabel(/^description$/i).fill('Updated description');
    await page.getByRole('button', { name: /^save$/i }).click();

    // Tree shows the new name; old name is gone.
    await expect(page.getByRole('button', { name: 'New Name', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Old Name', exact: true })).toHaveCount(0);

    // Detail panel reflects the new name + description.
    await expect(page.getByRole('heading', { name: 'New Name' })).toBeVisible();
    await expect(page.getByText('Updated description')).toBeVisible();

    // Reload the page to confirm persistence (not just optimistic UI).
    await page.reload();
    await expect(page.getByRole('button', { name: 'New Name', exact: true })).toBeVisible();
  });

  test('user deletes a location; tree clears and detail panel returns to empty state', async ({ page, request }) => {
    const api = await registerViaApi(request, 'loc_delete');
    const map = await createMapViaApi(request, api, 'Delete Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, { name: 'ToDelete' });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Click the location to select it (so we exercise the
    // clear-selection-on-delete code path).
    await page.getByRole('button', { name: 'ToDelete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ToDelete' })).toBeVisible();

    // Open the row's ⋯ menu and click Delete. Auto-accept the
    // window.confirm dialog.
    page.once('dialog', (dialog) => dialog.accept());
    const row = page.locator('.node-tree-row-inner', {
      has: page.getByRole('button', { name: 'ToDelete', exact: true }),
    });
    await row.getByRole('button', { name: /location actions/i }).click();
    await page.getByRole('menuitem', { name: /^delete$/i }).click();

    // Tree empty + detail panel back to empty state.
    await expect(page.getByText(/no locations on this map yet/i)).toBeVisible();
    await expect(page.getByText(/select a location to see its details/i)).toBeVisible();
  });

  test('cancelling the edit modal does not save changes', async ({ page, request }) => {
    const api = await registerViaApi(request, 'loc_edit_cancel');
    const map = await createMapViaApi(request, api, 'Cancel Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, {
      name: 'Stable',
      description: 'Original',
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    const row = page.locator('.node-tree-row-inner', {
      has: page.getByRole('button', { name: 'Stable', exact: true }),
    });
    await row.getByRole('button', { name: /location actions/i }).click();
    await page.getByRole('menuitem', { name: /^edit$/i }).click();

    await page.getByLabel(/^name$/i).fill('Should Not Persist');
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Original name is still in the tree; "Should Not Persist" never appears.
    await expect(page.getByRole('button', { name: 'Stable', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Should Not Persist', exact: true })).toHaveCount(0);
  });
});
