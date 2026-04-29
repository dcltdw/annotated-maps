import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { makeUser } from './helpers';

/**
 * E2E coverage for #128 (Phase 2f follow-up): pixel + blank map renderers.
 *
 * The new-map UI in MapListPage hardcodes `wgs84` defaults — there's no
 * UI yet for editing `coordinateSystem` to `pixel` or `blank`. To exercise
 * the renderers, this spec uses the backend API directly to register a
 * user, create a map with the desired coordinate system, attach a node,
 * then seeds `localStorage` so the browser session is authenticated and
 * navigates to the map detail page. The MapView renderer is what's
 * actually under test.
 *
 * Verification per type:
 *  - `pixel` → `<img class="leaflet-image-layer">` with the right src,
 *    plus a `.leaflet-marker-icon` for the placed node.
 *  - `blank` → no image layer, MapContainer carries `map-view-blank`
 *    class, marker is rendered.
 */

// The Playwright `request` fixture inherits the spec's baseURL (5173), but
// the backend runs on a different port. Hit it directly so we don't bounce
// through Vite's dev server.
const API = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:8080/api/v1';

interface ApiUser {
  token: string;
  tenantId: number;
  user: { id: number; username: string; email: string };
}

async function registerViaApi(request: APIRequestContext, tag: string): Promise<ApiUser> {
  const u = makeUser(tag);
  const res = await request.post(`${API}/auth/register`, {
    data: { username: u.username, email: u.email, password: u.password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { token: body.token, tenantId: body.tenantId, user: body.user };
}

async function createMapViaApi(
  request: APIRequestContext,
  api: ApiUser,
  title: string,
  coordinateSystem: unknown,
): Promise<{ id: number }> {
  const res = await request.post(`${API}/tenants/${api.tenantId}/maps`, {
    headers: { Authorization: `Bearer ${api.token}` },
    data: { title, coordinateSystem },
  });
  if (!res.ok()) {
    throw new Error(`createMap failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function createNodeViaApi(
  request: APIRequestContext,
  api: ApiUser,
  mapId: number,
  body: { name: string; geoJson: unknown },
): Promise<{ id: number }> {
  const res = await request.post(`${API}/tenants/${api.tenantId}/maps/${mapId}/nodes`, {
    headers: { Authorization: `Bearer ${api.token}` },
    data: body,
  });
  if (!res.ok()) {
    throw new Error(`createNode failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/** Seed the zustand-persisted auth storage so the SPA boots authenticated. */
async function seedAuthInBrowser(page: Page, api: ApiUser): Promise<void> {
  // First navigate so localStorage is scoped to the right origin.
  await page.goto('/login');
  await page.evaluate((api) => {
    const persisted = {
      state: {
        token: api.token,
        user: api.user,
        orgId: null,
        tenantId: api.tenantId,
        tenants: [
          { id: api.tenantId, name: '', slug: '', role: 'admin' as const },
        ],
        branding: {},
      },
      version: 0,
    };
    localStorage.setItem('auth-storage', JSON.stringify(persisted));
  }, api);
}

test.describe('Pixel coordinate system', () => {
  test('renders an image overlay and a marker for a placed node', async ({ page, request }) => {
    const api = await registerViaApi(request, 'cs_pixel');

    const map = await createMapViaApi(request, api, 'Pixel Test Map', {
      type: 'pixel',
      // Use a stable host that returns *something* (200/404 doesn't matter
      // — Leaflet still mounts the <img> with this src either way).
      image_url: 'https://example.com/test-map.png',
      width: 1024,
      height: 768,
      viewport: { x: 512, y: 384, zoom: 0 },
    });

    // Place a Point node in the middle of the image.
    await createNodeViaApi(request, api, map.id, {
      name: 'Pixel Pin',
      geoJson: { type: 'Point', coordinates: [512, 384] },
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Image overlay is present with our URL.
    const imgLayer = page.locator('img.leaflet-image-layer');
    await expect(imgLayer).toBeVisible();
    await expect(imgLayer).toHaveAttribute('src', /test-map\.png$/);

    // Marker for the node renders.
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();

    // The "coming in #91" stub banner should NOT be on the page — that
    // would mean the dispatch fell through to the default branch.
    await expect(page.getByText(/rendering coming in #91/i)).toHaveCount(0);
  });
});

test.describe('Blank coordinate system', () => {
  test('renders a blank canvas with a marker, no tile layer', async ({ page, request }) => {
    const api = await registerViaApi(request, 'cs_blank');

    const map = await createMapViaApi(request, api, 'Blank Test Map', {
      type: 'blank',
      extent: { x: 1000, y: 800 },
    });

    await createNodeViaApi(request, api, map.id, {
      name: 'Blank Pin',
      geoJson: { type: 'Point', coordinates: [500, 400] },
    });

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Container has the blank-class marker that scopes the off-white bg.
    await expect(page.locator('.map-view-blank')).toBeVisible();

    // No image overlay (it's a blank canvas).
    await expect(page.locator('img.leaflet-image-layer')).toHaveCount(0);

    // No tile layer either.
    await expect(page.locator('.leaflet-tile-pane img')).toHaveCount(0);

    // Marker for the node renders.
    await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();

    // Stub banner absent.
    await expect(page.getByText(/rendering coming in #91/i)).toHaveCount(0);
  });
});
