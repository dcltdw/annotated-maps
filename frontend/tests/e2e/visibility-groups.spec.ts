import { test, expect } from '@playwright/test';
import {
  registerViaApi,
  seedAuthInBrowser,
  mysqlQuery,
} from './helpers';

/**
 * E2E coverage for the VisibilityGroupsPage admin UI (#94 / #137 closeout):
 * group create / edit / delete and member add / remove through the UI.
 * Backend coverage of the same endpoints lives in test_18_visibility_groups.py;
 * this spec asserts the page wiring, modals, and reload behavior.
 */

test.describe('VisibilityGroupsPage — group CRUD', () => {
  test('create, edit, then delete a visibility group', async ({ page, request }) => {
    const api = await registerViaApi(request, 'vg_crud');
    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/visibility-groups`);

    await expect(page.getByRole('heading', { name: 'Visibility Groups' })).toBeVisible();
    // Personal-tenant registration auto-bootstraps a "Visibility Managers"
    // group with the new user as a member, so the empty state never appears
    // on a freshly registered tenant. Confirm the bootstrap row is present.
    await expect(
      page.getByRole('heading', { name: 'Visibility Managers' }),
    ).toBeVisible();

    // ─── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: '+ New Group' }).click();
    await expect(page.getByRole('heading', { name: 'New Visibility Group' })).toBeVisible();
    await page.getByLabel('Name').fill('Players');
    await page.getByLabel('Description').fill('Player characters and allies');
    await page.getByRole('button', { name: 'Save' }).click();

    const groupRow = page.locator('.visibility-group-row', {
      has: page.getByRole('heading', { name: 'Players' }),
    });
    await expect(groupRow).toBeVisible();
    await expect(groupRow).toContainText('Player characters and allies');

    // ─── Edit ──────────────────────────────────────────────────────────────
    await groupRow.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Visibility Group' })).toBeVisible();
    const nameField = page.getByLabel('Name');
    await nameField.fill('Adventurers');
    await page.getByRole('button', { name: 'Save' }).click();

    const renamedRow = page.locator('.visibility-group-row', {
      has: page.getByRole('heading', { name: 'Adventurers' }),
    });
    await expect(renamedRow).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Players' }),
    ).toHaveCount(0);

    // ─── Delete ────────────────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await renamedRow.getByRole('button', { name: 'Delete' }).click();
    await expect(
      page.getByRole('heading', { name: 'Adventurers' }),
    ).toHaveCount(0);
    // The bootstrap group remains visible even after deleting the user-created one.
    await expect(
      page.getByRole('heading', { name: 'Visibility Managers' }),
    ).toBeVisible();
  });
});

test.describe('VisibilityGroupsPage — member management', () => {
  test('add then remove a tenant member from a group', async ({ page, request }) => {
    const apiA = await registerViaApi(request, 'vg_owner');
    const apiB = await registerViaApi(request, 'vg_member');

    // Move B into A's org + tenant — same fixture pattern as visibility.spec.ts.
    // Backend's same-org check (#98) blocks adding a cross-org user to a group.
    const aOrgId = mysqlQuery(`SELECT org_id FROM users WHERE id=${apiA.user.id};`);
    mysqlQuery(`UPDATE users SET org_id=${aOrgId} WHERE id=${apiB.user.id};`);
    mysqlQuery(
      `INSERT INTO tenant_members (tenant_id, user_id, role) ` +
      `VALUES (${apiA.tenantId}, ${apiB.user.id}, 'viewer');`,
    );

    await seedAuthInBrowser(page, apiA);
    await page.goto(`/tenants/${apiA.tenantId}/visibility-groups`);

    // Create a fresh group through the UI.
    await page.getByRole('button', { name: '+ New Group' }).click();
    await page.getByLabel('Name').fill('Cartographers');
    await page.getByRole('button', { name: 'Save' }).click();

    const groupRow = page.locator('.visibility-group-row', {
      has: page.getByRole('heading', { name: 'Cartographers' }),
    });
    await expect(groupRow).toBeVisible();

    // Expand the row to reveal the member panel.
    await groupRow.getByRole('button', { name: /Expand/i }).click();
    await expect(groupRow.getByText('No members yet.')).toBeVisible();

    // ─── Add member ─────────────────────────────────────────────────────────
    // Pick by value (the userId) — the label format is `${username} (${email})`
    // which would be brittle to match exactly.
    const memberSelect = groupRow.locator('select');
    await memberSelect.selectOption(String(apiB.user.id));
    await groupRow.getByRole('button', { name: 'Add' }).click();

    const memberRow = groupRow.locator('.visibility-member-row', {
      hasText: apiB.user.username,
    });
    await expect(memberRow).toBeVisible();
    await expect(memberRow).toContainText(apiB.user.email);

    // ─── Remove member ──────────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await memberRow.getByRole('button', { name: 'Remove' }).click();
    await expect(memberRow).toHaveCount(0);
    await expect(groupRow.getByText('No members yet.')).toBeVisible();
  });
});
