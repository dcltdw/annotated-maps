import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
  API_URL,
} from './helpers';

/**
 * E2E coverage for #107: note pin/unpin toggle in NodeDetailPanel.
 *
 * Backend already accepts `pinned` on note update (and sorts pinned notes
 * first on read); this ticket adds the inline toggle button so users can
 * pin/unpin without entering edit mode.
 */

test.describe('Note pin toggle (#107)', () => {
  test('user pins a note inline; reload preserves pin state', async ({ page, request }) => {
    const api = await registerViaApi(request, 'note_pin');
    const map = await createMapViaApi(request, api, 'PinTest', {
      type: 'wgs84', center: { lat: 0, lng: 0 }, zoom: 3,
    });
    const node = await createNodeViaApi(request, api, map.id, { name: 'Place' });

    // Seed an unpinned note via API (pin toggle is the inline UI under test).
    const noteRes = await request.post(
      `${API_URL}/tenants/${api.tenantId}/maps/${map.id}/nodes/${node.id}/notes`,
      {
        headers: { Authorization: `Bearer ${api.token}` },
        data: { text: 'A note that needs pinning' },
      },
    );
    if (!noteRes.ok()) throw new Error(`createNote failed: ${noteRes.status()}`);

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);
    await page.getByRole('button', { name: 'Place', exact: true }).click();

    // Toggle is visible, off by default
    const toggle = page.getByRole('button', { name: /pin note/i });
    await expect(toggle).toBeVisible();

    // Pin → button label flips, badge added to card
    await toggle.click();
    await expect(page.getByRole('button', { name: /unpin note/i })).toBeVisible();
    await expect(page.locator('.note-card-pinned')).toBeVisible();

    // Reload → pin state persists from the backend
    await page.reload();
    await page.getByRole('button', { name: 'Place', exact: true }).click();
    await expect(page.getByRole('button', { name: /unpin note/i })).toBeVisible();
    await expect(page.locator('.note-card-pinned')).toBeVisible();

    // Unpin → button flips back
    await page.getByRole('button', { name: /unpin note/i }).click();
    await expect(page.getByRole('button', { name: /pin note/i })).toBeVisible();
    await expect(page.locator('.note-card-pinned')).toHaveCount(0);
  });

  test('two notes: pinned one sorts above unpinned after toggle', async ({ page, request }) => {
    const api = await registerViaApi(request, 'note_pin_sort');
    const map = await createMapViaApi(request, api, 'PinSort', {
      type: 'wgs84', center: { lat: 0, lng: 0 }, zoom: 3,
    });
    const node = await createNodeViaApi(request, api, map.id, { name: 'P' });

    const seedNote = async (text: string) => {
      const r = await request.post(
        `${API_URL}/tenants/${api.tenantId}/maps/${map.id}/nodes/${node.id}/notes`,
        { headers: { Authorization: `Bearer ${api.token}` }, data: { text } },
      );
      if (!r.ok()) throw new Error(`createNote failed: ${r.status()}`);
    };
    await seedNote('First note');
    await seedNote('Second note');

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);
    await page.getByRole('button', { name: 'P', exact: true }).click();

    // Pin "Second note" — find its card by text + click the pin toggle inside it.
    const secondCard = page.locator('.note-card', { hasText: 'Second note' });
    await secondCard.getByRole('button', { name: /pin note/i }).click();

    // After reload (defensive against optimistic-only UI), assert the
    // pinned-first sort: first card text should be "Second note".
    await page.reload();
    await page.getByRole('button', { name: 'P', exact: true }).click();
    const firstCardText = await page.locator('.note-card').first().textContent();
    expect(firstCardText).toContain('Second note');
  });
});
