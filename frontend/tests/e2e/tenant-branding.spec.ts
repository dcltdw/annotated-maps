import { test, expect } from '@playwright/test';
import { registerViaApi, seedAuthInBrowser } from './helpers';

/**
 * E2E coverage for #163: tenant branding edit UI on the new
 * /tenants/{tid}/admin page.
 */

test.describe('Tenant branding editor (#163)', () => {
  test('admin sets a primary color, saves, reload preserves it', async ({ page, request }) => {
    const api = await registerViaApi(request, 'branding');
    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/admin`);

    await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible();

    // Set primary color via the color input. (color-input requires a hex
    // value; .fill() on a color input is the canonical way per Playwright.)
    await page.getByLabel(/^primary color$/i).fill('#ff8800');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/^saved\.$/i)).toBeVisible();

    // Reload → primary color persists in the form (round-trip via backend)
    await page.reload();
    const primaryAfterReload = await page.getByLabel(/^primary color$/i).inputValue();
    expect(primaryAfterReload.toLowerCase()).toBe('#ff8800');
  });

  test('admin sets display name, saves, document title updates', async ({ page, request }) => {
    const api = await registerViaApi(request, 'branding_dn');
    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/admin`);

    await page.getByLabel(/^display name$/i).fill('My Custom Org');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/^saved\.$/i)).toBeVisible();

    // useBranding's effect updates document.title from the authStore;
    // setStoreBranding fires inline on save, so the title flips without
    // a page reload.
    await expect.poll(() => page.title()).toBe('My Custom Org');
  });

  test('reset clears all customizations', async ({ page, request }) => {
    const api = await registerViaApi(request, 'branding_reset');
    await seedAuthInBrowser(page, api);
    await page.goto(`/tenants/${api.tenantId}/admin`);

    // Seed a custom value first
    await page.getByLabel(/^primary color$/i).fill('#00aa00');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/^saved\.$/i)).toBeVisible();

    // Reset
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /reset to defaults/i }).click();
    await expect(page.getByText(/^saved\.$/i)).toBeVisible();

    // After reset, the hex display reads "(default)" — the form's stored
    // value is undefined, so the color picker falls back to the default
    // value but the hex span shows "(default)".
    await expect(page.getByText('(default)').first()).toBeVisible();
  });
});
