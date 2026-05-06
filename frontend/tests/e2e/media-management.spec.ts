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
 * E2E coverage for #166: media management UI.
 *
 * Pre-#166, media (images + links) was display-only — users could see
 * existing media via API-injected fixtures but couldn't add, edit, or
 * delete from the UI. Note media wasn't accessible from the frontend
 * at all. These tests cover the new MediaSection component on both
 * NodeDetailPanel (always-visible) and NoteCard (collapsible).
 */

async function createNoteViaApi(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  nodeId: number,
  body: { title?: string; text: string },
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/maps/${mapId}/nodes/${nodeId}/notes`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: body },
  );
  if (!res.ok()) throw new Error(`createNote failed: ${res.status()}`);
  return res.json();
}

test.describe('Media management — node (#166)', () => {
  test('user adds an image and a link to a location; both appear; edit + delete work', async ({ page, request }) => {
    const api = await registerViaApi(request, 'media_node');
    const map = await createMapViaApi(request, api, 'Media Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, { name: 'PhotoSpot' });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);
    await page.getByRole('button', { name: 'PhotoSpot', exact: true }).click();

    // The detail panel renders the Media section. Add an image first.
    const mediaSection = page.locator('.node-detail-media .media-section');
    await expect(mediaSection).toBeVisible();
    await expect(mediaSection.getByText(/no media attached/i)).toBeVisible();

    await mediaSection.getByRole('button', { name: /\+ image/i }).click();
    await page.getByLabel(/image url/i).fill('https://example.com/photo.jpg');
    await page.getByLabel(/caption/i).fill('Trail head sign');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Image appears with its thumbnail + caption; empty state is gone.
    await expect(mediaSection.locator('.media-thumb')).toBeVisible();
    await expect(mediaSection.getByText('Trail head sign')).toBeVisible();
    await expect(mediaSection.getByText(/no media attached/i)).toHaveCount(0);

    // Now add a link.
    await mediaSection.getByRole('button', { name: /\+ link/i }).click();
    await page.getByLabel(/link url/i).fill('https://example.com/trail-info');
    await page.getByLabel(/caption/i).fill('Trail conditions');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Link appears as a clickable anchor with the caption text.
    const linkRow = mediaSection.locator('.media-link-item').filter({
      has: page.getByText('Trail conditions'),
    });
    await expect(linkRow).toBeVisible();
    await expect(linkRow.getByRole('link', { name: 'Trail conditions' }))
      .toHaveAttribute('href', 'https://example.com/trail-info');

    // Edit the link's caption.
    await linkRow.getByRole('button', { name: /^edit$/i }).click();
    const captionInput = mediaSection.locator('input[placeholder="Caption"]');
    await captionInput.fill('Updated trail info');
    await mediaSection.getByRole('button', { name: /^save$/i }).click();

    await expect(mediaSection.getByText('Updated trail info')).toBeVisible();
    await expect(mediaSection.getByText('Trail conditions')).toHaveCount(0);

    // Delete the image.
    page.once('dialog', (dialog) => dialog.accept());
    const imageRow = mediaSection.locator('.media-image-item');
    await imageRow.getByRole('button', { name: /^delete$/i }).click();
    await expect(mediaSection.locator('.media-thumb')).toHaveCount(0);
    // Link is still there.
    await expect(mediaSection.getByText('Updated trail info')).toBeVisible();
  });
});

test.describe('Media management — note (#166)', () => {
  test('user attaches media to a note via the per-note Media toggle', async ({ page, request }) => {
    const api = await registerViaApi(request, 'media_note');
    const map = await createMapViaApi(request, api, 'Note Media Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const node = await createNodeViaApi(request, api, map.id, { name: 'NoteHost' });
    await createNoteViaApi(request, api, map.id, node.id, {
      title: 'Trail entry note',
      text: 'Found a fossil here.',
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);
    await page.getByRole('button', { name: 'NoteHost', exact: true }).click();

    // Open the note's collapsible Media section.
    const noteCard = page.locator('.note-card', {
      has: page.getByText('Trail entry note'),
    });
    await noteCard.getByRole('button', { name: /^media$/i }).click();

    const noteMediaSection = noteCard.locator('.note-card-media .media-section');
    await expect(noteMediaSection).toBeVisible();
    await expect(noteMediaSection.getByText(/no media attached/i)).toBeVisible();

    // Add an image attached to this NOTE specifically (not to the parent node).
    await noteMediaSection.getByRole('button', { name: /\+ image/i }).click();
    await page.getByLabel(/image url/i).fill('https://example.com/fossil.jpg');
    await page.getByLabel(/caption/i).fill('Fossil close-up');
    await page.getByRole('button', { name: /^add$/i }).click();

    // Note's media section shows the image.
    await expect(noteMediaSection.locator('.media-thumb')).toBeVisible();
    await expect(noteMediaSection.getByText('Fossil close-up')).toBeVisible();

    // Wiring guard: the media should attach to the NOTE, not the parent
    // node. The simplest observable check is that the node-level media
    // section remains empty — if the UI accidentally POSTed to
    // /nodes/.../media, we'd see the image there too.
    const nodeMediaSection = page.locator('.node-detail-media .media-section');
    await expect(nodeMediaSection.getByText(/no media attached/i)).toBeVisible();
  });
});
