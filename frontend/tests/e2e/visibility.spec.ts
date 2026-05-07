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
 * E2E coverage for #106: visibility visual indicators + owner_xray banner +
 * the cross-user visibility flow.
 *
 * Single-user tests cover the override icon, the owner_xray banner, and the
 * owner_xray toggle wiring — all reachable with one registered user.
 *
 * The cross-user "tagged node visible to member, hidden from non-member"
 * test needs the same SQL fixtures as test_20_node_visibility_filter.py
 * on the backend (move user B into A's org so visibility-group membership
 * is allowed; insert B as a viewer in A's tenant_members; grant B map
 * view permission). Same approach mirrored here via `mysqlQuery`.
 */

// ─── Visibility-group setup helpers (API + SQL) ──────────────────────────────

async function createVisibilityGroup(
  request: APIRequestContext,
  api: ApiUser,
  name: string,
): Promise<{ id: number }> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/visibility-groups`,
    {
      headers: { Authorization: `Bearer ${api.token}` },
      data: { name },
    },
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

async function addGroupMember(
  request: APIRequestContext,
  api: ApiUser,
  groupId: number,
  userId: number,
): Promise<void> {
  const res = await request.post(
    `${API_URL}/tenants/${api.tenantId}/visibility-groups/${groupId}/members`,
    { headers: { Authorization: `Bearer ${api.token}` }, data: { userId } },
  );
  if (!res.ok()) throw new Error(`addGroupMember failed: ${res.status()}`);
}

// ─── Override icon in the tree ───────────────────────────────────────────────

test.describe('Tree panel — override icon', () => {
  test('a node with visibility override shows the lock icon in the tree row', async ({ page, request }) => {
    const api = await registerViaApi(request, 'override_icon');
    const map = await createMapViaApi(request, api, 'Override Icon Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const tagged = await createNodeViaApi(request, api, map.id, { name: 'TaggedNode' });
    await createNodeViaApi(request, api, map.id, { name: 'PlainNode' });

    // Set override (with no groups → admin-only, but the override flag is
    // what drives the icon display, not the group membership).
    await setNodeVisibility(request, api, map.id, tagged.id, {
      override: true,
      groupIds: [],
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // The tagged row has the override icon; the plain row does not.
    const taggedRow = page.locator('.node-tree-row-inner', {
      has: page.getByRole('button', { name: 'TaggedNode', exact: true }),
    });
    const plainRow = page.locator('.node-tree-row-inner', {
      has: page.getByRole('button', { name: 'PlainNode', exact: true }),
    });
    await expect(taggedRow.locator('.node-tree-override-icon')).toBeVisible();
    await expect(plainRow.locator('.node-tree-override-icon')).toHaveCount(0);
  });
});

// ─── owner_xray banner + toggle ──────────────────────────────────────────────

test.describe('owner_xray — banner + toggle', () => {
  test('toggle reveals the banner; toggling off hides it again', async ({ page, request }) => {
    const api = await registerViaApi(request, 'xray_toggle');
    const map = await createMapViaApi(request, api, 'Xray Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, { name: 'Solo' });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Initially: toggle is unchecked, banner absent.
    const toggle = page.getByRole('checkbox', { name: /Owner X-ray/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('.alert-xray')).toHaveCount(0);

    // Click → banner appears. Use .click() rather than .check(): the toggle
    // disables itself while the PUT is in flight and the controlled `checked`
    // only flips after the follow-up GET resolves, so .check()'s tight retry
    // loop sees the checkbox briefly stuck unchecked-and-disabled and bails.
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.locator('.alert-xray')).toBeVisible();
    await expect(page.locator('.alert-xray')).toContainText(/owner x-ray active/i);

    // Reload to confirm persistence.
    await page.reload();
    await expect(page.locator('.alert-xray')).toBeVisible();
    const toggleAfterReload = page.getByRole('checkbox', { name: /Owner X-ray/i });
    await expect(toggleAfterReload).toBeChecked();

    // Toggle off → banner gone.
    await toggleAfterReload.click();
    await expect(toggleAfterReload).not.toBeChecked();
    await expect(page.locator('.alert-xray')).toHaveCount(0);
  });
});

// ─── Cross-user visibility flow ──────────────────────────────────────────────
// Mirrors the test_20_node_visibility_filter.py setup pattern. Uses two
// browser contexts — A is admin/owner, B is a non-admin tenant member of
// A's tenant who's also been moved into A's org so visibility-group
// membership is allowed.

test.describe('Cross-user visibility filtering', () => {
  test('member of a tagged group sees the node; non-member does not', async ({ browser, request }) => {
    const apiA = await registerViaApi(request, 'vis_owner');
    const apiB = await registerViaApi(request, 'vis_member');

    // Move B into A's org + tenant via SQL — same fixture pattern as the
    // backend filter tests.
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);
    mysqlQuery(
      `INSERT INTO tenant_members (tenant_id, user_id, role) ` +
      `VALUES (${apiA.tenantId}, ${apiB.user.id}, 'viewer');`,
    );

    // Create a map (as A), grant B map-view permission via SQL, build two
    // tagged nodes — one B can see, one B can't.
    const map = await createMapViaApi(request, apiA, 'Filter Test Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    mysqlQuery(
      `INSERT INTO map_permissions (map_id, user_id, level) ` +
      `VALUES (${map.id}, ${apiB.user.id}, 'view');`,
    );

    const players = await createVisibilityGroup(request, apiA, 'Players');
    const gms     = await createVisibilityGroup(request, apiA, 'GMs');
    await addGroupMember(request, apiA, players.id, apiB.user.id);

    const visibleNode = await createNodeViaApi(request, apiA, map.id, {
      name: 'PlayersOnly',
    });
    const hiddenNode = await createNodeViaApi(request, apiA, map.id, {
      name: 'GmsOnly',
    });
    await setNodeVisibility(request, apiA, map.id, visibleNode.id, {
      override: true,
      groupIds: [players.id],
    });
    await setNodeVisibility(request, apiA, map.id, hiddenNode.id, {
      override: true,
      groupIds: [gms.id],
    });

    // ── B's view: only PlayersOnly visible in the tree ───────────────────
    const ctxB = await browser.newContext();
    try {
      const pageB = await ctxB.newPage();
      await seedAuthInBrowser(pageB, apiB, { id: apiA.tenantId, role: 'viewer' });
      await pageB.goto(`/tenants/${apiA.tenantId}/maps/${map.id}`);

      await expect(
        pageB.getByRole('button', { name: 'PlayersOnly', exact: true }),
      ).toBeVisible();
      await expect(
        pageB.getByRole('button', { name: 'GmsOnly', exact: true }),
      ).toHaveCount(0);
    } finally {
      await ctxB.close();
    }

    // ── A (the owner) sees both ───────────────────────────────────────────
    const ctxA = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      await seedAuthInBrowser(pageA, apiA);
      await pageA.goto(`/tenants/${apiA.tenantId}/maps/${map.id}`);

      await expect(
        pageA.getByRole('button', { name: 'PlayersOnly', exact: true }),
      ).toBeVisible();
      await expect(
        pageA.getByRole('button', { name: 'GmsOnly', exact: true }),
      ).toBeVisible();
    } finally {
      await ctxA.close();
    }
  });
});
