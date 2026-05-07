import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  seedAuthInBrowser,
  mysqlQuery,
} from './helpers';

/**
 * E2E coverage for #162: tenant member management UI.
 */

test.describe('Tenant member management (#162)', () => {
  test('admin sees the member list and can add a same-org user, then remove them', async ({ page, request }) => {
    const apiA = await registerViaApi(request, 'tm_admin');
    const apiB = await registerViaApi(request, 'tm_target');

    // Move B into A's org so the cross-org check at the backend allows the
    // add. (A is admin of their personal tenant by default; B starts in
    // their own org.)
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);

    await seedAuthInBrowser(page, apiA);
    await page.goto(`/tenants/${apiA.tenantId}/members`);

    // The current admin (A) is the only member to start.
    await expect(page.getByRole('heading', { name: /Tenant members/i })).toBeVisible();
    await expect(page.locator('.member-row')).toHaveCount(1);
    await expect(
      page.locator('.member-row').filter({ hasText: apiA.user.username }),
    ).toBeVisible();

    // The admin's own Remove button is disabled (last admin).
    const ownRow = page.locator('.member-row').filter({ hasText: apiA.user.username });
    await expect(ownRow.getByRole('button', { name: /^remove$/i })).toBeDisabled();

    // Add B as viewer.
    await page.getByLabel(/^user id$/i).fill(String(apiB.user.id));
    await page.getByLabel(/^role$/i).selectOption('viewer');
    await page.getByRole('button', { name: /add member/i }).click();

    // Member list now has both A and B.
    await expect(page.locator('.member-row')).toHaveCount(2);
    const bRow = page.locator('.member-row').filter({ hasText: apiB.user.username });
    await expect(bRow).toBeVisible();
    await expect(bRow.getByText(/^viewer$/i)).toBeVisible();

    // Remove B (auto-accept the confirm dialog).
    page.once('dialog', (d) => d.accept());
    await bRow.getByRole('button', { name: /^remove$/i }).click();
    await expect(page.locator('.member-row')).toHaveCount(1);
  });

  test('non-admin viewer sees an access-denied banner', async ({ page, request }) => {
    const apiA = await registerViaApi(request, 'tm_admin2');
    const apiB = await registerViaApi(request, 'tm_viewer');

    // Add B to A's tenant as viewer (via SQL fixture; same as visibility tests).
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);
    mysqlQuery(
      `INSERT INTO tenant_members (tenant_id, user_id, role) ` +
      `VALUES (${apiA.tenantId}, ${apiB.user.id}, 'viewer');`
    );

    // Seed B's session, but with the active tenant set to A's tenant + role=viewer.
    await seedAuthInBrowser(page, apiB, { id: apiA.tenantId, role: 'viewer' });
    await page.goto(`/tenants/${apiA.tenantId}/members`);

    await expect(
      page.getByText(/only tenant admins can manage members/i),
    ).toBeVisible();
  });
});
