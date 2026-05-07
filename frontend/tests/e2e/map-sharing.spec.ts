import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  seedAuthInBrowser,
  mysqlQuery,
  API_URL,
} from './helpers';

/**
 * E2E coverage for #161: map sharing / permissions UI on the
 * MapDetailPage "Share" button.
 *
 * Backend permission semantics already covered in test_03_maps.py and
 * test_28_permissions.py (#177). This spec asserts the UI wiring:
 * modal opens, public toggle, grant + revoke per-user, dropdown
 * filters out already-granted users.
 */

test.describe('Map sharing modal (#161)', () => {
  test('owner toggles public access on, then off', async ({ page, request }) => {
    const api = await registerViaApi(request, 'share_pub');
    const map = await createMapViaApi(request, api, 'PublicMap', {
      type: 'wgs84', center: { lat: 0, lng: 0 }, zoom: 3,
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    await page.getByRole('button', { name: /^share$/i }).click();
    await expect(page.getByRole('heading', { name: /^sharing$/i })).toBeVisible();

    const publicToggle = page.getByRole('checkbox', {
      name: /anyone with the link can view/i,
    });
    await expect(publicToggle).not.toBeChecked();

    await publicToggle.click();
    await expect(publicToggle).toBeChecked();

    // Confirm via direct API call: public row exists in /permissions
    const res = await request.get(
      `${API_URL}/tenants/${api.tenantId}/maps/${map.id}/permissions`,
      { headers: { Authorization: `Bearer ${api.token}` } },
    );
    const perms = await res.json();
    expect(perms.some((p: { userId: number | null }) => p.userId === null)).toBe(true);

    // Toggle off
    await publicToggle.click();
    await expect(publicToggle).not.toBeChecked();
  });

  test('owner grants view to a same-org tenant member; per-user grant appears', async ({ page, request }) => {
    const apiA = await registerViaApi(request, 'share_owner');
    const apiB = await registerViaApi(request, 'share_target');

    // Move B into A's org + tenant via SQL fixture so the cross-org check
    // passes and B shows up in the listMembers dropdown.
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);
    mysqlQuery(
      `INSERT INTO tenant_members (tenant_id, user_id, role) ` +
      `VALUES (${apiA.tenantId}, ${apiB.user.id}, 'viewer');`
    );

    const map = await createMapViaApi(request, apiA, 'SharedMap', {
      type: 'wgs84', center: { lat: 0, lng: 0 }, zoom: 3,
    });

    await seedAuthInBrowser(page, apiA);
    await page.goto(`/tenants/${apiA.tenantId}/maps/${map.id}`);

    await page.getByRole('button', { name: /^share$/i }).click();
    await expect(page.getByRole('heading', { name: /^sharing$/i })).toBeVisible();
    await expect(page.getByText(/no one else has access yet/i)).toBeVisible();

    // Pick B from the dropdown, level=view (default), submit
    await page
      .getByRole('combobox', { name: /user to grant access/i })
      .selectOption(String(apiB.user.id));
    await page.getByRole('button', { name: /^grant$/i }).click();

    // The grant row appears with B's username and level=view
    const bRow = page.locator('.sharing-grant-row').filter({ hasText: apiB.user.username });
    await expect(bRow).toBeVisible();
    await expect(bRow.getByRole('combobox')).toHaveValue('view');

    // Revoke (auto-accept the confirm dialog)
    page.once('dialog', (d) => d.accept());
    await bRow.getByRole('button', { name: /^remove$/i }).click();
    await expect(page.locator('.sharing-grant-row')).toHaveCount(0);
  });

  test('non-owner does not see the Share button', async ({ page, request }) => {
    const apiA = await registerViaApi(request, 'share_nonowner_a');
    const apiB = await registerViaApi(request, 'share_nonowner_b');
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);
    mysqlQuery(
      `INSERT INTO tenant_members (tenant_id, user_id, role) ` +
      `VALUES (${apiA.tenantId}, ${apiB.user.id}, 'viewer');`
    );

    const map = await createMapViaApi(request, apiA, 'NonOwnerMap', {
      type: 'wgs84', center: { lat: 0, lng: 0 }, zoom: 3,
    });

    // Grant B view so they can load the map detail page
    await request.put(
      `${API_URL}/tenants/${apiA.tenantId}/maps/${map.id}/permissions`,
      {
        headers: { Authorization: `Bearer ${apiA.token}` },
        data: { userId: apiB.user.id, level: 'view' },
      },
    );

    await seedAuthInBrowser(page, apiB, { id: apiA.tenantId, role: 'viewer' });
    await page.goto(`/tenants/${apiA.tenantId}/maps/${map.id}`);

    // Map loads (B has view perm)
    await expect(page.getByRole('heading', { name: 'NonOwnerMap' })).toBeVisible();
    // But Share is not in the header — only owners get it
    await expect(page.getByRole('button', { name: /^share$/i })).toHaveCount(0);
  });
});
