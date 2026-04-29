import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
  mysqlQuery,
  API_URL,
  type ApiUser,
} from './helpers';

/**
 * E2E coverage for #95: Plots admin page.
 *
 * Plots are tenant-scoped narrative groupings tying together nodes + notes
 * across maps. The user-facing assertions are:
 *  1) An admin can create a plot, attach members from multiple maps via the
 *     two-step picker, and click a member row to land on the right map with
 *     the right node selected.
 *  2) The plot member list respects per-node visibility — a non-admin
 *     tenant member who can't see a tagged node won't see it in the plot
 *     either, even if the plot owner attached it.
 *
 * Visibility test mirrors the cross-user fixture pattern from
 * visibility.spec.ts (move user B into A's org via SQL bypass, grant
 * map view via SQL, then check the plot members list as B).
 */

// ─── Local API helpers ──────────────────────────────────────────────────────
// Same lift-when-second-spec-needs-it pattern as helpers.ts: hoisting these
// to helpers.ts is overkill until a third spec needs notes/plots setup.

async function createPlotViaApi(
  request: APIRequestContext,
  api: ApiUser,
  name: string,
  description?: string,
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${API_URL}/tenants/${api.tenantId}/plots`, {
    headers: { Authorization: `Bearer ${api.token}` },
    data: description ? { name, description } : { name },
  });
  if (!res.ok()) {
    throw new Error(`createPlot failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function createNoteViaApi(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  nodeId: number,
  body: { title?: string; text: string; pinned?: boolean },
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/maps/${mapId}/nodes/${nodeId}/notes`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: body },
  );
  if (!res.ok()) {
    throw new Error(`createNote failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function createVisibilityGroup(
  request: APIRequestContext,
  api: ApiUser,
  name: string,
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/visibility-groups`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: { name } },
  );
  if (!res.ok()) throw new Error(`createGroup failed: ${res.status()}`);
  return res.json();
}

async function setNodeVisibility(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  nodeId: number,
  body: { override?: boolean; groupIds?: number[] },
): Promise<void> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/maps/${mapId}/nodes/${nodeId}/visibility`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: body },
  );
  if (!res.ok()) throw new Error(`setNodeVisibility failed: ${res.status()}`);
}

// ─── Plot CRUD + cross-map navigation ────────────────────────────────────────

test.describe('Plots — CRUD and cross-map navigation', () => {
  test('owner creates a plot, attaches a node + a note from different maps, and clicks through to the right map+node', async ({ page, request }) => {
    const api = await registerViaApi(request, 'plot_nav');

    // Two maps — proves the plot aggregates members across maps.
    const mapA = await createMapViaApi(request, api, 'Plot Map A', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const mapB = await createMapViaApi(request, api, 'Plot Map B', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const nodeA = await createNodeViaApi(request, api, mapA.id, { name: 'CityA' });
    const nodeB = await createNodeViaApi(request, api, mapB.id, { name: 'CityB' });
    const noteOnB = await createNoteViaApi(request, api, mapB.id, nodeB.id, {
      title: 'Heist Brief',
      text: 'The vault opens at midnight.',
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/plots`);

    // Empty state.
    await expect(page.getByText(/no plots yet/i)).toBeVisible();

    // Create a plot via the modal.
    await page.getByRole('button', { name: /\+ New Plot/i }).click();
    await page.getByLabel(/^name$/i).fill('Act II');
    await page.getByLabel(/^description$/i).fill('The heist arc.');
    await page.getByRole('button', { name: /^save$/i }).click();

    const plotRow = page.locator('.plot-row', {
      has: page.getByRole('heading', { name: 'Act II' }),
    });
    await expect(plotRow).toBeVisible();

    // Expand the row to reveal the member panel.
    await plotRow.locator('.plot-toggle').click();

    // Add `CityA` from Map A via the node picker.
    const addNodeForm = plotRow.locator('.plot-add-form').first();
    await addNodeForm.locator('select').nth(0).selectOption({ label: 'Plot Map A' });
    await addNodeForm.locator('select').nth(1).selectOption({ label: 'CityA' });
    await addNodeForm.getByRole('button', { name: /add node/i }).click();
    await expect(plotRow.getByRole('link', { name: /CityA/ })).toBeVisible();

    // Add the note on Map B via the note picker. The note picker is the
    // second .plot-add-form inside the row body.
    const addNoteForm = plotRow.locator('.plot-add-form').nth(1);
    await addNoteForm.locator('select').nth(0).selectOption({ label: 'Plot Map B' });
    await addNoteForm.locator('select').nth(1).selectOption({ label: 'CityB' });
    await addNoteForm.locator('select').nth(2).selectOption({ label: 'Heist Brief' });
    await addNoteForm.getByRole('button', { name: /add note/i }).click();
    await expect(plotRow.getByRole('link', { name: /Heist Brief/ })).toBeVisible();

    // Click-to-jump: clicking CityA lands on Map A with CityA selected.
    await plotRow.getByRole('link', { name: /CityA/ }).click();
    await expect(page).toHaveURL(new RegExp(`/maps/${mapA.id}\\?node=${nodeA.id}\\b`));
    // The detail panel renders the selected node's name as a heading.
    await expect(page.getByRole('heading', { name: 'CityA' })).toBeVisible();

    // Back to plots; click the note link, land on Map B at CityB.
    await page.goto(`/tenants/${api.tenantId}/plots`);
    await page.locator('.plot-row', {
      has: page.getByRole('heading', { name: 'Act II' }),
    }).locator('.plot-toggle').click();
    await page.getByRole('link', { name: /Heist Brief/ }).click();
    await expect(page).toHaveURL(new RegExp(`/maps/${mapB.id}\\?node=${nodeB.id}\\b`));
    await expect(page.getByRole('heading', { name: 'CityB' })).toBeVisible();
    // Sanity-check the note is rendered in the detail panel.
    await expect(page.getByText('Heist Brief')).toBeVisible();

    // Silence the unused-var warning while making the assertion explicit.
    expect(noteOnB.id).toBeGreaterThan(0);
  });
});

// ─── Visibility filtering on plot member list ───────────────────────────────

test.describe('Plots — visibility filtering', () => {
  test('a non-admin member only sees plot nodes their visibility grants permit', async ({ browser, request }) => {
    const apiA = await registerViaApi(request, 'plot_vis_owner');
    const apiB = await registerViaApi(request, 'plot_vis_member');

    // Move B into A's org + tenant — same fixture as visibility.spec.ts.
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);
    mysqlQuery(
      `INSERT INTO tenant_members (tenant_id, user_id, role) ` +
      `VALUES (${apiA.tenantId}, ${apiB.user.id}, 'viewer');`,
    );

    const map = await createMapViaApi(request, apiA, 'Plot Filter Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    mysqlQuery(
      `INSERT INTO map_permissions (map_id, user_id, level) ` +
      `VALUES (${map.id}, ${apiB.user.id}, 'view');`,
    );

    // Two nodes, two visibility groups. Players (B is a member): only sees
    // PlayersOnly. GMs (B is not a member): GmsOnly is hidden from B.
    const players = await createVisibilityGroup(request, apiA, 'Players');
    const gms = await createVisibilityGroup(request, apiA, 'GMs');
    const playersOnly = await createNodeViaApi(request, apiA, map.id, { name: 'PlayersOnly' });
    const gmsOnly = await createNodeViaApi(request, apiA, map.id, { name: 'GmsOnly' });
    await setNodeVisibility(request, apiA, map.id, playersOnly.id, {
      override: true,
      groupIds: [players.id],
    });
    await setNodeVisibility(request, apiA, map.id, gmsOnly.id, {
      override: true,
      groupIds: [gms.id],
    });
    // Add B to Players.
    const addB = await request.post(
      `${API_URL}/tenants/${apiA.tenantId}/visibility-groups/${players.id}/members`,
      { headers: { Authorization: `Bearer ${apiA.token}` }, data: { userId: apiB.user.id } },
    );
    if (!addB.ok()) throw new Error(`addPlayersMember failed: ${addB.status()}`);

    // Plot with both nodes attached.
    const plot = await createPlotViaApi(request, apiA, 'Mixed Plot');
    for (const nodeId of [playersOnly.id, gmsOnly.id]) {
      const r = await request.post(
        `${API_URL}/tenants/${apiA.tenantId}/plots/${plot.id}/nodes`,
        { headers: { Authorization: `Bearer ${apiA.token}` }, data: { nodeId } },
      );
      if (!r.ok()) throw new Error(`addPlotNode failed: ${r.status()}`);
    }

    // ── B browses /tenants/{A.tenantId}/plots: only PlayersOnly visible.
    const ctxB = await browser.newContext();
    try {
      const pageB = await ctxB.newPage();
      await seedAuthInBrowser(pageB, apiB, { id: apiA.tenantId, role: 'viewer' });
      await pageB.goto(`/tenants/${apiA.tenantId}/plots`);

      const plotRowB = pageB.locator('.plot-row', {
        has: pageB.getByRole('heading', { name: 'Mixed Plot' }),
      });
      await plotRowB.locator('.plot-toggle').click();

      await expect(plotRowB.getByRole('link', { name: /PlayersOnly/ })).toBeVisible();
      await expect(plotRowB.getByRole('link', { name: /GmsOnly/ })).toHaveCount(0);
    } finally {
      await ctxB.close();
    }

    // ── A (the owner) sees both members.
    const ctxA = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      await seedAuthInBrowser(pageA, apiA);
      await pageA.goto(`/tenants/${apiA.tenantId}/plots`);

      const plotRowA = pageA.locator('.plot-row', {
        has: pageA.getByRole('heading', { name: 'Mixed Plot' }),
      });
      await plotRowA.locator('.plot-toggle').click();

      await expect(plotRowA.getByRole('link', { name: /PlayersOnly/ })).toBeVisible();
      await expect(plotRowA.getByRole('link', { name: /GmsOnly/ })).toBeVisible();
    } finally {
      await ctxA.close();
    }
  });
});
