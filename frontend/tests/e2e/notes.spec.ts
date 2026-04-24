import { test, expect, Page } from '@playwright/test';
import { makeUser } from './helpers';

/**
 * E2E coverage for Notes and Note Groups (#37).
 *
 * Notes are placed on the map via a two-step flow: open the side-panel
 * "+ Note" form, click "Place on map", click somewhere on the map, then
 * Save. The map marker is a cyan circleMarker rendered in the overlay
 * pane (SVG <circle>); group tabs and the notes list live in the right
 * sidebar.
 *
 * One subtlety this spec works around: when "Place on map" lands a click,
 * a temporary cyan circle with the popup "Note will be placed here"
 * stays on the map for 5 seconds. Tests that count circles wait for that
 * popup to clear so they don't double-count the placement preview and
 * the saved note.
 */

const MAPS_URL_RE   = /\/tenants\/\d+\/maps$/;
const MAP_DETAIL_RE = /\/tenants\/\d+\/maps\/\d+$/;

async function registerAndOpenMap(page: Page, tag: string): Promise<void> {
  const user = makeUser(tag);
  await page.goto('/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password',         { exact: true }).fill(user.password);
  await page.getByLabel('Confirm Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(MAPS_URL_RE);

  await page.getByRole('button', { name: /new map|create your first map/i }).first().click();
  await page.getByLabel('Title').fill(`Notes Test ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(MAP_DETAIL_RE);

  // Wait for the notes panel to be ready before any test action.
  await expect(page.getByRole('button', { name: '+ Note' })).toBeVisible();
}

interface NoteOpts {
  title?: string;
  text: string;
  /** Click position on the .leaflet-container; defaults to (400, 300). */
  x?: number;
  y?: number;
}

/** Create a note via the full "+ Note → Place on map → click → Save"
 *  flow. Waits for the placement preview popup to clear so the next
 *  marker count is stable. */
async function createNote(page: Page, opts: NoteOpts): Promise<void> {
  const x = opts.x ?? 400;
  const y = opts.y ?? 300;

  await page.getByRole('button', { name: '+ Note' }).click();
  if (opts.title) {
    await page.getByPlaceholder('Title (optional)').fill(opts.title);
  }
  await page.getByPlaceholder(/Note text/i).fill(opts.text);

  await page.getByRole('button', { name: /place on map/i }).click();
  // Hint banner appears while waiting for the map click; verifying it
  // doubles as a wait for placement-mode activation.
  await expect(page.locator('.move-hint')).toBeVisible();
  await page.locator('.leaflet-container').click({ position: { x, y } });

  // The form's location chip should now show coordinates.
  await expect(page.getByText(/📍 -?\d+\.\d+, -?\d+\.\d+/)).toBeVisible();

  await page.getByRole('button', { name: /^Save$/ }).click();

  // Note card appears in the sidebar list; the placement-preview popup
  // ("Note will be placed here") will clear within 5s of the map click.
  await expect(page.getByText('Note will be placed here')).toHaveCount(0, { timeout: 7000 });
}

/** Note marker elements. L.circleMarker renders as an SVG <path>
 *  (arc-based circle), same element type as polyline/polygon
 *  annotations. These tests never create annotations, so every path
 *  under .leaflet-overlay-pane is a note marker. */
function noteMarkers(page: Page) {
  return page.locator('.leaflet-overlay-pane svg path');
}

/** Stable fingerprint of a note marker's position — the SVG `d`
 *  attribute contains the circle's center coords embedded in its arc. */
async function firstNoteMarkerFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const path = document.querySelector('.leaflet-overlay-pane svg path');
    return path?.getAttribute('d') ?? '';
  });
}

// ───── Note CRUD ──────────────────────────────────────────────────────────────

test.describe('Notes — CRUD', () => {
  test('create note via "Place on map" renders a circle marker', async ({ page }) => {
    await registerAndOpenMap(page, 'notes_create');
    await createNote(page, { title: 'Trailhead', text: 'Park here.' });

    // Sidebar reflects the new note.
    await expect(page.locator('.note-card').getByText('Trailhead')).toBeVisible();
    await expect(page.locator('.note-card').getByText('Park here.')).toBeVisible();

    // Map marker present after the placement preview clears.
    await expect(noteMarkers(page)).toHaveCount(1);
  });

  test('edit note title and text persists on reload', async ({ page }) => {
    await registerAndOpenMap(page, 'notes_edit');
    await createNote(page, { title: 'Original', text: 'First text.' });

    const card = page.locator('.note-card').first();
    await card.getByTitle('Edit').click();

    // The edit form replaces the read-only view in the same card.
    const titleInput = card.locator('input').first();
    const textArea   = card.locator('textarea');
    await expect(titleInput).toHaveValue('Original');
    await expect(textArea).toHaveValue('First text.');
    await titleInput.fill('Renamed');
    await textArea.fill('Updated text.');
    await card.getByRole('button', { name: /^Save$/ }).click();

    await expect(page.locator('.note-card').getByText('Renamed')).toBeVisible();
    await expect(page.locator('.note-card').getByText('Updated text.')).toBeVisible();

    await page.reload();
    await expect(page.locator('.note-card').getByText('Renamed')).toBeVisible();
    await expect(page.locator('.note-card').getByText('Updated text.')).toBeVisible();
  });

  test('delete note removes it from the panel and the map', async ({ page }) => {
    await registerAndOpenMap(page, 'notes_delete');
    await createNote(page, { text: 'Doomed note.' });
    await expect(noteMarkers(page)).toHaveCount(1);

    page.once('dialog', (d) => d.accept()); // window.confirm
    await page.locator('.note-card').first().getByTitle('Delete').click();

    await expect(page.locator('.note-card')).toHaveCount(0);
    await expect(noteMarkers(page)).toHaveCount(0);
  });

  test('move note via the move icon places it at the new click', async ({ page }) => {
    await registerAndOpenMap(page, 'notes_move');
    await createNote(page, { text: 'Mover.', x: 300, y: 250 });

    // Capture initial position via the SVG path's `d` attribute.
    const before = await firstNoteMarkerFingerprint(page);
    expect(before).not.toBe('');

    await page.locator('.note-card').first().getByTitle('Move').click();
    // Re-uses the same NotePlacement banner as create flow.
    await expect(page.locator('.move-hint')).toBeVisible();
    await page.locator('.leaflet-container').click({ position: { x: 600, y: 450 } });

    await expect(page.getByText('Note will be placed here')).toHaveCount(0, { timeout: 7000 });

    // After re-render, the same marker has a different `d` attribute.
    await expect.poll(async () => firstNoteMarkerFingerprint(page)).not.toBe(before);
  });
});

// ───── Note groups ────────────────────────────────────────────────────────────

test.describe('Notes — Groups', () => {
  test('create note group adds a new tab to the panel', async ({ page }) => {
    await registerAndOpenMap(page, 'groups_create');

    // Before: only the All tab.
    await expect(page.locator('.notes-tab')).toHaveCount(1);

    await page.getByRole('button', { name: '+ Group' }).click();
    await page.getByPlaceholder('Group name').fill('Trails');
    await page.getByRole('button', { name: /create group/i }).click();

    // All + Trails.
    await expect(page.locator('.notes-tab')).toHaveCount(2);
    await expect(page.locator('.notes-tab').nth(1)).toContainText('Trails');
  });

  test('assigning a note to a group surfaces it under that group tab', async ({ page }) => {
    await registerAndOpenMap(page, 'groups_assign');

    // Create a group first so the create-note form has a group selector.
    await page.getByRole('button', { name: '+ Group' }).click();
    await page.getByPlaceholder('Group name').fill('Routes');
    await page.getByRole('button', { name: /create group/i }).click();
    await expect(page.locator('.notes-tab').nth(1)).toContainText('Routes');

    // Two notes: one assigned to Routes, one ungrouped. We only have
    // one card at a time here, so use .first() rather than filtering
    // by text — once Edit is clicked the title becomes an <input
    // value>, not rendered text, and hasText stops matching.
    await createNote(page, { title: 'Route A', text: 'Long route.' });
    const cardA = page.locator('.note-card').first();
    await cardA.getByTitle('Edit').click();
    await cardA.locator('select').selectOption({ label: 'Routes' });
    await cardA.getByRole('button', { name: /^Save$/ }).click();

    await createNote(page, { title: 'Loose Note', text: 'Not in a group.', x: 300, y: 350 });

    // Click the Routes tab; only Route A should be visible.
    await page.locator('.notes-tab').filter({ hasText: 'Routes' }).click();
    await expect(page.locator('.note-card')).toHaveCount(1);
    await expect(page.locator('.note-card')).toContainText('Route A');
  });

  test('filtering by group shows only that group\'s notes; All restores both', async ({ page }) => {
    await registerAndOpenMap(page, 'groups_filter');

    await page.getByRole('button', { name: '+ Group' }).click();
    await page.getByPlaceholder('Group name').fill('Filtered');
    await page.getByRole('button', { name: /create group/i }).click();

    await createNote(page, { title: 'Inside', text: 'Inside the group.' });
    const cardInside = page.locator('.note-card').first();
    await cardInside.getByTitle('Edit').click();
    await cardInside.locator('select').selectOption({ label: 'Filtered' });
    await cardInside.getByRole('button', { name: /^Save$/ }).click();

    await createNote(page, { title: 'Outside', text: 'Not in the group.', x: 300, y: 350 });

    // All tab: both notes.
    await expect(page.locator('.note-card')).toHaveCount(2);

    // Filtered tab: only Inside.
    await page.locator('.notes-tab').filter({ hasText: 'Filtered' }).click();
    await expect(page.locator('.note-card')).toHaveCount(1);
    await expect(page.locator('.note-card')).toContainText('Inside');

    // Back to All: both again.
    await page.locator('.notes-tab').filter({ hasText: 'All' }).click();
    await expect(page.locator('.note-card')).toHaveCount(2);
  });

  test('deleting a group ungroups its notes (they remain in All)', async ({ page }) => {
    await registerAndOpenMap(page, 'groups_delete');

    await page.getByRole('button', { name: '+ Group' }).click();
    await page.getByPlaceholder('Group name').fill('TempGroup');
    await page.getByRole('button', { name: /create group/i }).click();

    await createNote(page, { title: 'Survivor', text: 'Should outlive its group.' });
    const card = page.locator('.note-card').first();
    await card.getByTitle('Edit').click();
    await card.locator('select').selectOption({ label: 'TempGroup' });
    await card.getByRole('button', { name: /^Save$/ }).click();

    // Delete the group via the inline × on its tab.
    page.once('dialog', (d) => d.accept()); // window.confirm
    await page.locator('.notes-tab')
      .filter({ hasText: 'TempGroup' })
      .getByTitle('Delete group')
      .click();

    // Tab gone, but the note still exists under All (now ungrouped).
    await expect(page.locator('.notes-tab')).toHaveCount(1);
    await expect(page.locator('.note-card')).toContainText('Survivor');
  });
});
