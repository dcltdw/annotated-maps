import { test, expect, Page } from '@playwright/test';
import { makeUser } from './helpers';

/**
 * E2E coverage for Annotation CRUD on a map (#36).
 *
 * Annotations are drawn directly on the Leaflet map via the leaflet-draw
 * toolbar in the top-right of the map. Each test here:
 *   1. Registers a fresh user and creates a map
 *   2. Drives the leaflet-draw toolbar by class name
 *   3. Clicks at known pixel offsets inside the .leaflet-container
 *   4. Handles the two window.prompt dialogs (title, description) the
 *      `onCreated` handler in MapView.tsx fires
 *
 * Verification is structural where possible (DOM markers / paths / popup
 * content); pixel positions aren't asserted because Leaflet's pixel↔latlng
 * mapping isn't a useful contract to lock down at this layer.
 */

const MAPS_URL_RE   = /\/tenants\/\d+\/maps$/;
const MAP_DETAIL_RE = /\/tenants\/\d+\/maps\/\d+$/;

/** Register a fresh user, create one map, land on its detail page. */
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
  await page.getByLabel('Title').fill(`Annotation Test ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(MAP_DETAIL_RE);

  // The leaflet draw toolbar mounts after the map initializes. Wait for
  // the marker tool — every test that follows needs the toolbar.
  await expect(page.locator('.leaflet-draw-draw-marker')).toBeVisible();
}

/**
 * Register a one-shot dialog handler that answers the next two
 * window.prompt calls (title, then description). Matches the MapView
 * onCreated handler's prompt order.
 */
function answerCreatePrompts(page: Page, title: string, description = ''): void {
  let calls = 0;
  page.on('dialog', async (dialog) => {
    if (dialog.type() !== 'prompt') {
      await dialog.dismiss();
      return;
    }
    calls += 1;
    if (calls === 1) await dialog.accept(title);
    else if (calls === 2) await dialog.accept(description);
    else await dialog.dismiss();
  });
}

/** Click somewhere on the map at an (x, y) offset from the container's
 *  top-left. The leaflet-container fills its parent, so offsets are
 *  stable across viewport sizes within a test. */
async function clickMapAt(page: Page, x: number, y: number): Promise<void> {
  await page.locator('.leaflet-container').click({ position: { x, y } });
}

/** Place a polyline/polygon vertex while drawing. Same as clickMapAt but
 *  with a short pause for leaflet-draw's internal state machine to
 *  register the click before the next one — without it, rapid Playwright
 *  clicks get merged and vertices are silently dropped. There's no
 *  observable DOM change between vertex clicks to wait on, so a fixed
 *  delay is the pragmatic fix. */
async function placeVertex(page: Page, x: number, y: number): Promise<void> {
  await clickMapAt(page, x, y);
  await page.waitForTimeout(120);
}

/** Stable fingerprint of the first annotation's position. For markers
 *  it's the CSS transform (Leaflet uses translate3d for marker icons);
 *  for paths it's the SVG `d` attribute. Both change on move and are
 *  immune to the brief window where the leaflet-draw scratch layer and
 *  the saved annotation coexist in the SVG (which broke the earlier
 *  boundingBox-based check). */
async function annotationFingerprint(page: Page): Promise<string> {
  return page.evaluate(() => {
    const marker = document.querySelector('.leaflet-marker-icon') as HTMLElement | null;
    if (marker) return marker.style.transform;
    const path = document.querySelector('.leaflet-overlay-pane svg path');
    if (path) return path.getAttribute('d') ?? '';
    return '';
  });
}

/** Click the leaflet-draw "Finish" button that appears in the actions
 *  toolbar mid-draw for polyline/polygon. */
async function clickDrawFinish(page: Page): Promise<void> {
  await page.locator('.leaflet-draw-actions a', { hasText: /^Finish$/ }).click();
}

// ───── Marker ─────────────────────────────────────────────────────────────────

test.describe('Annotations — marker', () => {
  test('create marker → popup shows title', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_marker_create');
    answerCreatePrompts(page, 'My Marker', 'A test marker.');

    await page.locator('.leaflet-draw-draw-marker').click();
    await clickMapAt(page, 400, 300);

    // After save, the AnnotationLayer re-renders and adds a marker icon.
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();

    // Click the marker to open the popup; assert the title is rendered.
    await page.locator('.leaflet-marker-icon').first().click();
    const popup = page.locator('.leaflet-popup-content');
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('heading', { name: 'My Marker' })).toBeVisible();
    await expect(popup.getByText('A test marker.')).toBeVisible();
  });

  test('edit marker title and description via popup persists on reload', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_marker_edit');
    answerCreatePrompts(page, 'Original Title', 'Original desc.');

    await page.locator('.leaflet-draw-draw-marker').click();
    await clickMapAt(page, 400, 300);
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();

    // Open popup, click Edit. The Edit handler fires two prompts:
    // newTitle (pre-filled), newDesc (pre-filled).
    await page.locator('.leaflet-marker-icon').first().click();
    await expect(page.locator('.leaflet-popup')).toBeVisible();

    // Replace the create-prompt handlers with edit-prompt ones.
    page.removeAllListeners('dialog');
    let editCalls = 0;
    page.on('dialog', async (dialog) => {
      editCalls += 1;
      if (editCalls === 1) await dialog.accept('Edited Title');
      else if (editCalls === 2) await dialog.accept('Edited desc.');
      else await dialog.dismiss();
    });

    await page.locator('.btn-edit-annotation').click();

    // Re-open popup to see updated text.
    await page.locator('.leaflet-marker-icon').first().click();
    const popup = page.locator('.leaflet-popup-content');
    await expect(popup.getByRole('heading', { name: 'Edited Title' })).toBeVisible();
    await expect(popup.getByText('Edited desc.')).toBeVisible();

    // Reload to confirm the edit persisted server-side.
    await page.reload();
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();
    await page.locator('.leaflet-marker-icon').first().click();
    await expect(popup.getByRole('heading', { name: 'Edited Title' })).toBeVisible();
  });

  test('delete marker via popup removes it from the map', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_marker_del');
    answerCreatePrompts(page, 'Doomed Marker');

    await page.locator('.leaflet-draw-draw-marker').click();
    await clickMapAt(page, 400, 300);
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);

    await page.locator('.leaflet-marker-icon').first().click();
    // The create-prompt handler from answerCreatePrompts() is still
    // attached as page.on(...) — clear it before installing the confirm
    // handler so the delete's window.confirm goes to ours.
    page.removeAllListeners('dialog');
    page.once('dialog', (d) => d.accept()); // window.confirm
    await page.locator('.btn-delete-annotation').click();

    // Marker icon removed from the DOM after the store update.
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);

    // Survives reload.
    await page.reload();
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);
  });

  test('move marker via popup updates its position', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_marker_move');
    answerCreatePrompts(page, 'Mover');

    await page.locator('.leaflet-draw-draw-marker').click();
    await clickMapAt(page, 300, 200);
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();

    const before = await annotationFingerprint(page);
    expect(before).not.toBe('');

    await page.locator('.leaflet-marker-icon').first().click();
    await page.locator('.btn-move-annotation').click();

    // The move-hint banner appears while in move mode — verifies we're
    // actually waiting for the next click.
    await expect(page.locator('.move-hint')).toBeVisible();

    // Click a noticeably different spot.
    await clickMapAt(page, 600, 450);

    // Banner clears and the marker's CSS transform differs.
    await expect(page.locator('.move-hint')).toHaveCount(0);
    await expect.poll(async () => annotationFingerprint(page)).not.toBe(before);
  });
});

// ───── Polyline ───────────────────────────────────────────────────────────────

test.describe('Annotations — polyline', () => {
  test('create polyline renders an interactive path on the map', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_line_create');
    answerCreatePrompts(page, 'My Line');

    await page.locator('.leaflet-draw-draw-polyline').click();
    // Use vertices we'll re-click later to open the popup. SVG paths are
    // hit-tested against their stroke, so clicking on a known vertex
    // pixel reliably hits the line; clicking the path element's bbox
    // center misses thin diagonal lines.
    await placeVertex(page, 200, 200);
    await placeVertex(page, 350, 250);
    await placeVertex(page, 500, 200);
    await clickDrawFinish(page);

    // Re-render from the store: an SVG <path> appears in the overlay pane.
    const path = page.locator('.leaflet-overlay-pane svg path').first();
    await expect(path).toBeVisible();

    // Open the popup by clicking on a known point along the line.
    await clickMapAt(page, 200, 200);
    await expect(
      page.locator('.leaflet-popup-content').getByRole('heading', { name: 'My Line' })
    ).toBeVisible();
  });

  test('move polyline via popup shifts the path', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_line_move');
    answerCreatePrompts(page, 'Movable Line');

    await page.locator('.leaflet-draw-draw-polyline').click();
    await placeVertex(page, 200, 200);
    await placeVertex(page, 350, 250);
    await clickDrawFinish(page);

    const path = page.locator('.leaflet-overlay-pane svg path').first();
    await expect(path).toBeVisible();
    const before = await annotationFingerprint(page);
    expect(before).not.toBe('');

    // Click on a known vertex (always on the stroke) to open the popup.
    await clickMapAt(page, 200, 200);
    await expect(page.locator('.leaflet-popup')).toBeVisible();
    await page.locator('.btn-move-annotation').click();
    await expect(page.locator('.move-hint')).toBeVisible();
    await clickMapAt(page, 550, 450);

    await expect(page.locator('.move-hint')).toHaveCount(0);
    await expect.poll(async () => annotationFingerprint(page)).not.toBe(before);
  });
});

// ───── Polygon ────────────────────────────────────────────────────────────────

test.describe('Annotations — polygon', () => {
  test('create polygon renders a filled path on the map', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_poly_create');
    answerCreatePrompts(page, 'My Polygon');

    await page.locator('.leaflet-draw-draw-polygon').click();
    await placeVertex(page, 250, 200);
    await placeVertex(page, 400, 200);
    await placeVertex(page, 400, 350);
    await placeVertex(page, 250, 350);
    await clickDrawFinish(page);

    const path = page.locator('.leaflet-overlay-pane svg path').first();
    await expect(path).toBeVisible();

    // Click inside the filled polygon (centroid of the rectangle above)
    // to open the popup. Filled paths are hit-tested across their fill,
    // so any interior point works.
    await clickMapAt(page, 325, 275);
    await expect(
      page.locator('.leaflet-popup-content').getByRole('heading', { name: 'My Polygon' })
    ).toBeVisible();
  });

  test('move polygon via popup shifts the path', async ({ page }) => {
    await registerAndOpenMap(page, 'ann_poly_move');
    answerCreatePrompts(page, 'Movable Polygon');

    await page.locator('.leaflet-draw-draw-polygon').click();
    await placeVertex(page, 250, 200);
    await placeVertex(page, 400, 200);
    await placeVertex(page, 325, 350);
    await clickDrawFinish(page);

    const path = page.locator('.leaflet-overlay-pane svg path').first();
    await expect(path).toBeVisible();
    const before = await annotationFingerprint(page);
    expect(before).not.toBe('');

    // Centroid of the triangle above (~325, 250) is inside the fill.
    await clickMapAt(page, 325, 250);
    await expect(page.locator('.leaflet-popup')).toBeVisible();
    await page.locator('.btn-move-annotation').click();
    await expect(page.locator('.move-hint')).toBeVisible();
    await clickMapAt(page, 600, 450);

    await expect(page.locator('.move-hint')).toHaveCount(0);
    await expect.poll(async () => annotationFingerprint(page)).not.toBe(before);
  });
});
