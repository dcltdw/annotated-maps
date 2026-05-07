import { test, expect } from '@playwright/test';

/**
 * E2E coverage for #167: SSO initiate UI on the login form.
 *
 * Tests the toggle + form-submit wiring; doesn't follow the full SSO
 * redirect (no IdP available in CI). The redirect URL is asserted via
 * page.route() interception.
 */

test.describe('SSO initiate (#167)', () => {
  test('toggle reveals the org-slug form; cancel hides it again', async ({ page }) => {
    await page.goto('/login');

    // Initial state: only the email/password form is visible; SSO button shown
    await expect(page.getByLabel(/organization slug/i)).toHaveCount(0);
    const ssoButton = page.getByRole('button', { name: /use sso/i });
    await expect(ssoButton).toBeVisible();

    // Click "Sign in with SSO" → org-slug form appears, password form stays
    await ssoButton.click();
    await expect(page.getByLabel(/organization slug/i)).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();

    // Cancel returns to the initial state
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByLabel(/organization slug/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /use sso/i })).toBeVisible();
  });

  test('submitting an org slug navigates to the backend SSO initiate URL', async ({ page }) => {
    // Intercept the redirect so the test doesn't actually follow it (no IdP
    // available); just assert the URL the browser was sent to.
    let interceptedUrl: string | null = null;
    await page.route('**/api/v1/auth/sso/**', (route) => {
      interceptedUrl = route.request().url();
      // Stub a 200 so the browser doesn't show an error page; the test
      // doesn't need to follow further.
      route.fulfill({ status: 200, contentType: 'text/html', body: 'OK' });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: /use sso/i }).click();
    await page.getByLabel(/organization slug/i).fill('acme-corp');
    await page.getByRole('button', { name: /continue to sso/i }).click();

    // Wait for the route to fire; expect.poll handles the timing without
    // a fixed wait.
    await expect.poll(() => interceptedUrl).toMatch(/\/api\/v1\/auth\/sso\/acme-corp(?:$|\?)/);
  });

  test('empty org-slug submit is blocked by the disabled button', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /use sso/i }).click();
    await expect(
      page.getByRole('button', { name: /continue to sso/i }),
    ).toBeDisabled();
  });
});
