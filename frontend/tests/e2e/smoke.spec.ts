import { test, expect } from '@playwright/test';

/**
 * Smoke test — verifies the Playwright + Vite + backend stack is wired
 * up correctly. If this fails, none of the other E2E suites
 * (#34-#38) will run, so it's intentionally minimal: load the login
 * page and confirm the form renders.
 */
test.describe('Login page smoke', () => {
  test('renders email, password, and submit', async ({ page }) => {
    await page.goto('/login');

    // Page heading.
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // Form fields. We assert by accessible role/label rather than CSS
    // selector so the test survives DOM restructuring.
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    // "Sign Up" link is present in the auth-card footer (sanity check that
    // React Router rendered the LoginForm component, not just navbar shell).
    // Two "Sign Up" links exist on this page — navbar and form footer —
    // so we scope to the form's footer text "Don't have an account?".
    await expect(
      page.getByText(/don't have an account/i)
        .getByRole('link', { name: /sign up/i })
    ).toBeVisible();
  });
});
