import { test, expect, Page } from '@playwright/test';
import { makeUser } from './helpers';

/**
 * E2E coverage for Map CRUD (#35).
 *
 * Edit and delete cases are deferred via test.fixme until the UI for
 * those operations exists — see #70. The service-layer functions
 * (updateMap, deleteMap in src/services/maps.ts) are wired up but no
 * page calls them yet.
 */

const MAPS_URL_RE   = /\/tenants\/\d+\/maps$/;
const MAP_DETAIL_RE = /\/tenants\/\d+\/maps\/\d+$/;

async function registerAndLand(page: Page, tag: string): Promise<void> {
  const user = makeUser(tag);
  await page.goto('/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password',         { exact: true }).fill(user.password);
  await page.getByLabel('Confirm Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(MAPS_URL_RE);
}

async function createMap(page: Page, title: string, description = ''): Promise<void> {
  // The page shows two "+ New Map" buttons when the list is empty (header
  // and empty-state). Either one opens the modal, so use the first match.
  await page.getByRole('button', { name: /new map|create your first map/i }).first().click();

  // Modal fields — title is `<input>`, description is `<textarea>`.
  await page.getByLabel('Title').fill(title);
  if (description) {
    await page.getByLabel('Description').fill(description);
  }
  await page.getByRole('button', { name: /^create$/i }).click();

  // Successful create navigates to the map detail page.
  await expect(page).toHaveURL(MAP_DETAIL_RE);
}

test.describe('Maps — create', () => {
  test('a fresh user starts with an empty map list', async ({ page }) => {
    await registerAndLand(page, 'maps_empty');
    await expect(page.getByText(/you don't have any maps yet/i)).toBeVisible();
  });

  test('creating a map navigates to the detail page and shows the title', async ({ page }) => {
    await registerAndLand(page, 'maps_create');
    const title = `E2E Map ${Date.now().toString(36)}`;
    await createMap(page, title, 'A map created by an E2E test.');

    // The detail page heading shows the map title (h2 in MapDetailPage).
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(/a map created by an e2e test/i)).toBeVisible();
  });

  test('a created map appears in the map list on return', async ({ page }) => {
    await registerAndLand(page, 'maps_list');
    const title = `Listed Map ${Date.now().toString(36)}`;
    await createMap(page, title);

    // Navigate back to the list (browser back works — list page loads
    // its own data on mount, so we get a fresh fetch either way).
    await page.goBack();
    await expect(page).toHaveURL(MAPS_URL_RE);

    // Card title and the owner badge both show.
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(/owner/i).first()).toBeVisible();
  });

  test('a second map appears alongside the first', async ({ page }) => {
    await registerAndLand(page, 'maps_two');
    const a = `First ${Date.now().toString(36)}`;
    const b = `Second ${Date.now().toString(36)}`;
    await createMap(page, a);
    await page.goBack();
    await expect(page).toHaveURL(MAPS_URL_RE);
    await createMap(page, b);
    await page.goBack();

    await expect(page.getByRole('heading', { name: a })).toBeVisible();
    await expect(page.getByRole('heading', { name: b })).toBeVisible();
  });
});

test.describe('Maps — view', () => {
  test('clicking a map card opens the detail view', async ({ page }) => {
    await registerAndLand(page, 'maps_view');
    const title = `Viewable ${Date.now().toString(36)}`;
    await createMap(page, title);
    await page.goBack();
    await expect(page).toHaveURL(MAPS_URL_RE);

    // The card is wrapped in a <Link>, exposed as a link role.
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(MAP_DETAIL_RE);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });

  test('opening a non-existent map shows the not-found message', async ({ page }) => {
    await registerAndLand(page, 'maps_404');
    // 999999999 is well past anything the test has created. The detail
    // page maps a load failure to a friendly "not found / no permission".
    await page.goto(page.url().replace(/\/maps$/, '/maps/999999999'));
    await expect(
      page.getByText(/map not found or you do not have permission/i)
    ).toBeVisible();
  });
});

test.describe('Maps — edit', () => {
  test('editing the title persists on reload', async ({ page }) => {
    await registerAndLand(page, 'maps_edit_title');
    const original = `Original ${Date.now().toString(36)}`;
    const updated  = `Updated ${Date.now().toString(36)}`;
    await createMap(page, original);
    await expect(page.getByRole('heading', { name: original })).toBeVisible();

    await page.getByRole('button', { name: /edit map/i }).click();
    const titleField = page.getByLabel('Title');
    await expect(titleField).toHaveValue(original);
    await titleField.fill(updated);
    await page.getByRole('button', { name: /^save$/i }).click();

    // Modal closes; the heading reflects the new title.
    await expect(page.getByRole('heading', { name: updated })).toBeVisible();
    await expect(page.getByRole('heading', { name: original })).toHaveCount(0);

    // Reload to prove the change actually persisted server-side.
    await page.reload();
    await expect(page.getByRole('heading', { name: updated })).toBeVisible();
  });

  test('editing the description persists on reload', async ({ page }) => {
    await registerAndLand(page, 'maps_edit_desc');
    const title = `DescEdit ${Date.now().toString(36)}`;
    await createMap(page, title, 'Original description.');
    await expect(page.getByText(/original description\./i)).toBeVisible();

    await page.getByRole('button', { name: /edit map/i }).click();
    const descField = page.getByLabel('Description');
    await expect(descField).toHaveValue('Original description.');
    await descField.fill('Updated description!');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByText(/updated description!/i)).toBeVisible();
    await expect(page.getByText(/original description\./i)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(/updated description!/i)).toBeVisible();
  });
});

test.describe('Maps — delete', () => {
  test('deleting a map removes it from the list and navigates back', async ({ page }) => {
    await registerAndLand(page, 'maps_delete');
    const title = `Doomed ${Date.now().toString(36)}`;
    await createMap(page, title);
    const detailUrl = page.url();

    // Auto-accept the window.confirm prompt the delete button triggers.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /delete map/i }).click();

    // Lands back on the map list.
    await expect(page).toHaveURL(MAPS_URL_RE);
    // The empty-state copy proves the map is actually gone (this user
    // had only the one map).
    await expect(page.getByText(/you don't have any maps yet/i)).toBeVisible();

    // And the detail URL is no longer reachable.
    await page.goto(detailUrl);
    await expect(
      page.getByText(/map not found or you do not have permission/i)
    ).toBeVisible();
  });

  test('cancelling the delete confirmation keeps the map', async ({ page }) => {
    await registerAndLand(page, 'maps_delete_cancel');
    const title = `Survivor ${Date.now().toString(36)}`;
    await createMap(page, title);

    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: /delete map/i }).click();

    // Still on the detail page, map still visible.
    await expect(page).toHaveURL(MAP_DETAIL_RE);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  });
});
