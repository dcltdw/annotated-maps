import { test, expect, type Page } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
} from './helpers';

/**
 * E2E coverage for #104 (Phase 2g.f): tree panel + node detail view.
 *
 * Each test sets up an API-driven session, builds the node fixture it
 * needs, then drives the UI to verify expand/collapse, click-to-pan,
 * the parent breadcrumb, and inline notes CRUD.
 *
 * Visibility-filter assertions on the tree (a hidden node's children
 * also hidden) belong with #94/#106 once the tagging UI lands — those
 * tests aren't in scope here.
 */

// Locate a tree row by the name of the inner name-button. We can't use
// `hasText` here because the row's visible text starts with the toggle
// character (▶/▼), so `^Foo` regexes never match. `has:` finds the row
// containing a button with the right accessible name and walks up.
function rowByName(page: Page, name: string) {
  return page.locator('.node-tree-row-inner', {
    has: page.getByRole('button', { name, exact: true }),
  });
}

// ─── Tree panel: expand/collapse ─────────────────────────────────────────────

test.describe('Tree panel — expand/collapse', () => {
  test('walks 5 levels of nested nodes by clicking the toggle on each row', async ({ page, request }) => {
    const api = await registerViaApi(request, 'tree_5lvl');
    const map = await createMapViaApi(request, api, 'Five-Level Tree', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });

    // Build a 5-deep chain: L0 → L1 → L2 → L3 → L4
    let parentId: number | undefined;
    for (let i = 0; i < 5; i++) {
      const created = await createNodeViaApi(request, api, map.id, {
        name: `L${i}`,
        ...(parentId !== undefined ? { parentId } : {}),
      });
      parentId = created.id;
    }

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Top-level row is L0; subsequent levels need to be expanded one at a time.
    await expect(page.getByRole('button', { name: /^L0$/ })).toBeVisible();
    for (let i = 0; i < 4; i++) {
      // Toggle is the sibling of the name button. We scope by the row's
      // own name-button to disambiguate. The row layout is:
      // [toggle][color][name][menu].
      await rowByName(page, `L${i}`).getByRole('button', { name: 'Expand' }).click();
      await expect(page.getByRole('button', { name: `L${i + 1}`, exact: true })).toBeVisible();
    }

    // Collapse one level — its descendants should disappear from the tree.
    await rowByName(page, 'L0').getByRole('button', { name: 'Collapse' }).click();
    // After collapsing L0, none of L1..L4 should be in the DOM.
    for (let i = 1; i < 5; i++) {
      await expect(page.getByRole('button', { name: new RegExp(`^L${i}$`) })).toHaveCount(0);
    }
  });

  test('leaf rows show no toggle button', async ({ page, request }) => {
    const api = await registerViaApi(request, 'tree_leaf');
    const map = await createMapViaApi(request, api, 'Leaf Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const parent = await createNodeViaApi(request, api, map.id, { name: 'Parent' });
    await createNodeViaApi(request, api, map.id, { name: 'Leaf', parentId: parent.id });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Expand Parent → Leaf appears. Initially Leaf has an Expand button
    // (children are unknown until we try to fetch them). Clicking Expand
    // hits the API, gets back [], and the toggle is then replaced with a
    // spacer to indicate "no children." That's the user-visible signal
    // that the row is a leaf.
    await rowByName(page, 'Parent').getByRole('button', { name: 'Expand' }).click();
    const leafRow = rowByName(page, 'Leaf');
    await expect(leafRow).toBeVisible();
    await expect(leafRow.getByRole('button', { name: 'Expand' })).toBeVisible();

    await leafRow.getByRole('button', { name: 'Expand' }).click();
    await expect(leafRow.locator('.node-tree-toggle-spacer')).toBeVisible();
  });
});

// ─── Click-to-pan ────────────────────────────────────────────────────────────

test.describe('Tree panel — click-to-pan', () => {
  test('clicking a row with a Point geometry pans the map to it', async ({ page, request }) => {
    const api = await registerViaApi(request, 'tree_pan');
    // Zoom 10 = city-level. A node at lat=10, lng=10 is far enough off
    // a center=(0,0) initial view that its marker is NOT in the viewport
    // before the pan, so a successful in-viewport assertion afterward
    // can only mean the flyTo actually happened.
    const map = await createMapViaApi(request, api, 'Pan Test Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 10,
    });
    await createNodeViaApi(request, api, map.id, {
      name: 'FarAway',
      geoJson: { type: 'Point', coordinates: [10, 10] },
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    const marker = page.locator('.leaflet-marker-icon').first();
    await expect(marker).toHaveCount(1);
    // Initially the marker is rendered in the DOM but positioned outside
    // the visible viewport (Leaflet still creates the icon for off-screen
    // markers).
    await expect(marker).not.toBeInViewport();

    // Click the tree row. PanController.flyTo() runs for ~400ms.
    await page.getByRole('button', { name: 'FarAway' }).click();

    // After the pan, the marker should be in the viewport. Bump the
    // expect timeout above the flyTo duration.
    await expect(marker).toBeInViewport({ timeout: 3_000 });
  });
});

// ─── Detail view + parent breadcrumb ─────────────────────────────────────────

test.describe('Detail view — parent breadcrumb', () => {
  test('breadcrumb shows the parent and clicking it changes selection', async ({ page, request }) => {
    const api = await registerViaApi(request, 'detail_breadcrumb');
    const map = await createMapViaApi(request, api, 'Breadcrumb Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const parent = await createNodeViaApi(request, api, map.id, { name: 'ParentNode' });
    await createNodeViaApi(request, api, map.id, { name: 'ChildNode', parentId: parent.id });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Expand parent + select child.
    await rowByName(page, 'ParentNode').getByRole('button', { name: 'Expand' }).click();
    await page.getByRole('button', { name: 'ChildNode' }).click();

    // Detail panel shows the child's name as h2 and the parent as a link.
    await expect(page.getByRole('heading', { name: 'ChildNode' })).toBeVisible();
    await expect(page.locator('.node-detail-breadcrumb')).toContainText('ParentNode');

    // Clicking the breadcrumb re-selects the parent — heading swaps.
    await page.locator('.node-detail-breadcrumb').getByRole('button', { name: 'ParentNode' }).click();
    await expect(page.getByRole('heading', { name: 'ParentNode' })).toBeVisible();
    // ParentNode has no parent → no breadcrumb element this time.
    await expect(page.locator('.node-detail-breadcrumb')).toHaveCount(0);
  });
});

// ─── Inline notes CRUD ───────────────────────────────────────────────────────

async function selectNode(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name }).click();
}

test.describe('Detail view — inline notes CRUD', () => {
  test('create + edit + delete + pin', async ({ page, request }) => {
    const api = await registerViaApi(request, 'notes_crud');
    const map = await createMapViaApi(request, api, 'Notes Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, { name: 'Hub' });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    await selectNode(page, 'Hub');
    await expect(page.getByRole('heading', { name: 'Hub' })).toBeVisible();

    // ─── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: '+ Note' }).click();
    await page.getByPlaceholder('Title (optional)').fill('First note');
    await page.getByPlaceholder('Note text').fill('Hello world');
    await page.getByRole('button', { name: /^Save$/ }).click();

    const firstCard = page.locator('.note-card').filter({ hasText: 'First note' });
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toContainText('Hello world');

    // ─── Edit ──────────────────────────────────────────────────────────────
    await firstCard.getByRole('button', { name: 'Edit' }).click();
    const textarea = page.locator('.note-form textarea');
    await textarea.fill('Hello edited');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.locator('.note-card').filter({ hasText: 'Hello edited' })).toBeVisible();

    // ─── Pin order ─────────────────────────────────────────────────────────
    // Add a second note (unpinned), then pin the FIRST note via edit.
    // The pinned note should sort first.
    await page.getByRole('button', { name: '+ Note' }).click();
    await page.getByPlaceholder('Title (optional)').fill('Second note');
    await page.getByPlaceholder('Note text').fill('Another');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page.locator('.note-card').filter({ hasText: 'Second note' })).toBeVisible();

    // Pin the first note via its edit form.
    await page.locator('.note-card').filter({ hasText: 'First note' })
      .getByRole('button', { name: 'Edit' }).click();
    await page.locator('.note-form input[type="checkbox"]').check();
    await page.getByRole('button', { name: /^Save$/ }).click();

    // Wait for the edit form to close (so we know the save settled),
    // then check the order: the pinned card should be the first .note-card
    // in the list.
    await expect(page.locator('.note-form')).toHaveCount(0);
    const cardsInOrder = await page.locator('.note-card .note-card-titlebar strong').allTextContents();
    expect(cardsInOrder[0]).toBe('First note');
    expect(cardsInOrder).toContain('Second note');

    // ─── Delete ────────────────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await page.locator('.note-card').filter({ hasText: 'First note' })
      .getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.note-card').filter({ hasText: 'First note' })).toHaveCount(0);
    // Second note still there.
    await expect(page.locator('.note-card').filter({ hasText: 'Second note' })).toBeVisible();
  });
});
