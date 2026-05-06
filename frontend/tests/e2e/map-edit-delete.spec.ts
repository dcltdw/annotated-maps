import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  seedAuthInBrowser,
} from './helpers';

/**
 * E2E coverage for #160: map edit + delete UI.
 *
 * Pre-#160, maps had Read + Create + ownerXray-toggle but no edit-title
 * and no delete from the UI. These tests exercise the new ⋯ menu on
 * each map card (edit + delete) plus the Delete-map button on the
 * detail page header.
 */

test.describe('Map edit + delete (#160)', () => {
  test('user edits a map\'s title and description from the list page; changes persist', async ({ page, request }) => {
    const api = await registerViaApi(request, 'map_edit');
    await createMapViaApi(request, api, 'Original Title', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps`);

    // Find the card and open its ⋯ menu.
    const card = page.locator('.map-card-wrapper', {
      has: page.getByRole('heading', { name: 'Original Title', exact: true }),
    });
    await card.getByRole('button', { name: /map actions/i }).click();
    await page.getByRole('menuitem', { name: /^edit$/i }).click();

    // Modal opens in edit mode pre-populated.
    await expect(page.getByRole('heading', { name: /^edit map$/i })).toBeVisible();
    const titleField = page.getByLabel(/^title$/i);
    await expect(titleField).toHaveValue('Original Title');

    // Update + save.
    await titleField.fill('New Title');
    await page.getByLabel(/^description$/i).fill('Updated description');
    await page.getByRole('button', { name: /^save$/i }).click();

    // List shows the new title; old title is gone.
    await expect(page.getByRole('heading', { name: 'New Title', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Original Title', exact: true })).toHaveCount(0);

    // Reload to confirm persistence (not just optimistic UI).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'New Title', exact: true })).toBeVisible();
  });

  test('user deletes a map from the list page card menu; map is gone', async ({ page, request }) => {
    const api = await registerViaApi(request, 'map_delete_list');
    await createMapViaApi(request, api, 'ToDelete From List', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps`);

    page.once('dialog', (dialog) => dialog.accept());
    const card = page.locator('.map-card-wrapper', {
      has: page.getByRole('heading', { name: 'ToDelete From List', exact: true }),
    });
    await card.getByRole('button', { name: /map actions/i }).click();
    await page.getByRole('menuitem', { name: /^delete$/i }).click();

    // Card is gone; empty state appears.
    await expect(page.getByRole('heading', { name: 'ToDelete From List', exact: true })).toHaveCount(0);
    await expect(page.getByText(/you don't have any maps yet/i)).toBeVisible();
  });

  test('user deletes a map from the detail page header; redirects back to list', async ({ page, request }) => {
    const api = await registerViaApi(request, 'map_delete_detail');
    const map = await createMapViaApi(request, api, 'ToDelete From Detail', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Sanity: we're on the detail page.
    await expect(page.getByRole('heading', { name: 'ToDelete From Detail', level: 1 })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^delete map$/i }).click();

    // Redirect to the maps list; the deleted map is gone.
    await expect(page).toHaveURL(new RegExp(`/tenants/${api.tenantId}/maps$`));
    await expect(page.getByRole('heading', { name: 'ToDelete From Detail', exact: true })).toHaveCount(0);
  });

  test('cancelling the edit modal does not save changes', async ({ page, request }) => {
    const api = await registerViaApi(request, 'map_edit_cancel');
    await createMapViaApi(request, api, 'Stable Title', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps`);

    const card = page.locator('.map-card-wrapper', {
      has: page.getByRole('heading', { name: 'Stable Title', exact: true }),
    });
    await card.getByRole('button', { name: /map actions/i }).click();
    await page.getByRole('menuitem', { name: /^edit$/i }).click();

    await page.getByLabel(/^title$/i).fill('Should Not Persist');
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await expect(page.getByRole('heading', { name: 'Stable Title', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Should Not Persist', exact: true })).toHaveCount(0);
  });
});
