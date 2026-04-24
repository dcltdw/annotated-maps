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

test.describe('Maps — edit / delete', () => {
  // The frontend has no map edit/delete UI yet — services exist but
  // no page wires them up. Tracked in #70. When that ships, replace
  // these fixmes with real specs.
  test.fixme('editing the title persists on reload (UI not yet built — see #70)', async () => {});
  test.fixme('editing the description persists on reload (UI not yet built — see #70)', async () => {});
  test.fixme('deleting a map removes it from the list (UI not yet built — see #70)', async () => {});
});
