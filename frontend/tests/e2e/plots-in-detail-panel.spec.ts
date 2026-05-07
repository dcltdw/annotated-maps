import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  registerViaApi,
  createMapViaApi,
  createNodeViaApi,
  seedAuthInBrowser,
  API_URL,
  type ApiUser,
} from './helpers';

/**
 * E2E coverage for #139: per-item Plots section in node/note detail panel.
 *
 * Tests the round-trip: attach an item to a plot from the detail panel,
 * then verify the change is observable on the Plots admin page (i.e. the
 * write actually hit the same backend store the read uses).
 */

async function createPlotViaApi(
  request: APIRequestContext,
  api: ApiUser,
  name: string,
): Promise<{ id: number; name: string }> {
  const res = await request.post(`${API_URL}/tenants/${api.tenantId}/plots`, {
    headers: { Authorization: `Bearer ${api.token}` },
    data: { name },
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
  body: { title?: string; text: string },
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

test.describe('Plots in detail panel — node', () => {
  test('attach a node to a plot from the detail panel; verify on plots page', async ({ page, request }) => {
    const api = await registerViaApi(request, 'plot_detail_node');
    const map = await createMapViaApi(request, api, 'Detail-Plot Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    await createNodeViaApi(request, api, map.id, { name: 'TownA' });
    await createPlotViaApi(request, api, 'Detail Plot');

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);

    // Select the node in the tree → triggers detail panel render.
    await page.getByRole('button', { name: 'TownA', exact: true }).click();

    // The detail panel renders the Plots section with empty state initially.
    const plotsSection = page.locator('.node-detail-plots .plots-section');
    await expect(plotsSection).toBeVisible();
    await expect(plotsSection.getByText(/not in any plot/i)).toBeVisible();

    // Pick "Detail Plot" from the add-to-plot dropdown and submit.
    await plotsSection.locator('select').selectOption({ label: 'Detail Plot' });
    await plotsSection.getByRole('button', { name: /^add$/i }).click();

    // The attached list now shows the plot with a Remove button.
    const attachedRow = plotsSection.locator('.plots-section-row', {
      has: page.getByText('Detail Plot'),
    });
    await expect(attachedRow).toBeVisible();

    // Verify the attachment is observable on the Plots admin page —
    // confirms the write actually round-tripped through the same store
    // the read endpoint uses.
    await page.goto(`/tenants/${api.tenantId}/plots`);
    const plotRow = page.locator('.plot-row', {
      has: page.getByRole('heading', { name: 'Detail Plot' }),
    });
    await plotRow.locator('.plot-toggle').click();
    await expect(plotRow.getByRole('link', { name: /TownA/ })).toBeVisible();

    // Round-trip: detach back from the detail panel, verify the plot's
    // member list is empty.
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);
    await page.getByRole('button', { name: 'TownA', exact: true }).click();
    await page.locator('.node-detail-plots .plots-section').getByRole('button', { name: /remove/i }).click();
    await expect(page.locator('.node-detail-plots .plots-section').getByText(/not in any plot/i)).toBeVisible();
  });
});

test.describe('Plots in detail panel — note', () => {
  test('attach a note to a plot from the per-note section; verify on plots page', async ({ page, request }) => {
    const api = await registerViaApi(request, 'plot_detail_note');
    const map = await createMapViaApi(request, api, 'Detail-Plot Note Map', {
      type: 'wgs84',
      center: { lat: 0, lng: 0 },
      zoom: 3,
    });
    const node = await createNodeViaApi(request, api, map.id, { name: 'NoteHost' });
    await createNoteViaApi(request, api, map.id, node.id, {
      title: 'Important Detail',
      text: 'Plot-relevant content.',
    });
    await createPlotViaApi(request, api, 'Note Plot');

    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/maps/${map.id}`);
    await page.getByRole('button', { name: 'NoteHost', exact: true }).click();

    // The note card renders inside NotesList. Click "Plots" to expand its
    // collapsible plots section.
    const noteCard = page.locator('.note-card', {
      has: page.getByText('Important Detail'),
    });
    await noteCard.getByRole('button', { name: /^plots$/i }).click();

    // The per-note plots section renders inside .note-card-plots.
    const notePlots = noteCard.locator('.note-card-plots .plots-section');
    await expect(notePlots).toBeVisible();
    await expect(notePlots.getByText(/not in any plot/i)).toBeVisible();

    // Attach the note to "Note Plot".
    await notePlots.locator('select').selectOption({ label: 'Note Plot' });
    await notePlots.getByRole('button', { name: /^add$/i }).click();

    await expect(notePlots.locator('.plots-section-row', {
      has: page.getByText('Note Plot'),
    })).toBeVisible();

    // Verify on the Plots admin page that the note is now in this plot.
    await page.goto(`/tenants/${api.tenantId}/plots`);
    const plotRow = page.locator('.plot-row', {
      has: page.getByRole('heading', { name: 'Note Plot' }),
    });
    await plotRow.locator('.plot-toggle').click();
    await expect(plotRow.getByRole('link', { name: /Important Detail/ })).toBeVisible();
  });
});
