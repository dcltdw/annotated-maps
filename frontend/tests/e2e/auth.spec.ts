import { test, expect, Page } from '@playwright/test';
import { makeUser } from './helpers';

/**
 * E2E coverage for the auth flows (#34). Each test creates fresh
 * users — no shared fixture state, so failures are easy to bisect
 * and the suite is safe to run in parallel.
 */

// Map URL after a successful login/register lands at /tenants/{N}/maps
// via the LoginForm → navigate('/maps') → DefaultRedirect chain.
const MAPS_URL_RE = /\/tenants\/\d+\/maps/;

async function fillRegisterForm(
  page: Page,
  user: { username: string; email: string; password: string },
) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password',         { exact: true }).fill(user.password);
  await page.getByLabel('Confirm Password', { exact: true }).fill(user.password);
}

test.describe('Registration', () => {
  test('new user is redirected to the maps page', async ({ page }) => {
    const user = makeUser('reg');
    await fillRegisterForm(page, user);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page).toHaveURL(MAPS_URL_RE);
    // Navbar shows the username — confirms the auth state actually persisted.
    await expect(page.getByText(user.username)).toBeVisible();
  });

  test('duplicate email shows a specific error', async ({ page }) => {
    // First registration — succeeds.
    const original = makeUser('dup_email');
    await fillRegisterForm(page, original);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(MAPS_URL_RE);

    // Second registration with the same email but a fresh username.
    const collision = { ...makeUser('dup_email_2'), email: original.email };
    await fillRegisterForm(page, collision);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/this email address is already registered/i)
    ).toBeVisible();
    await expect(page).toHaveURL(/\/register$/); // didn't navigate
  });

  test('duplicate username shows a specific error', async ({ page }) => {
    const original = makeUser('dup_user');
    await fillRegisterForm(page, original);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(MAPS_URL_RE);

    const collision = { ...makeUser('dup_user_2'), username: original.username };
    await fillRegisterForm(page, collision);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/this username is already taken/i)
    ).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });
});

test.describe('Login', () => {
  test('valid credentials redirect to the maps page', async ({ page }) => {
    // Register first (the only way to mint a user via the public surface).
    const user = makeUser('login_ok');
    await fillRegisterForm(page, user);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(MAPS_URL_RE);

    // Log out so we can prove the login flow works end-to-end.
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Log in.
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(MAPS_URL_RE);
  });

  test('wrong password shows a persistent error (not a flash)', async ({ page }) => {
    const user = makeUser('login_wrong_pw');
    await fillRegisterForm(page, user);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(MAPS_URL_RE);
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('definitely_not_the_real_password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The error must be visible AND we must still be on /login.
    // (Bug #55 was that the 401 interceptor redirected to /login,
    // dropping the error mid-flash. Asserting URL still matches /login
    // and that the error text is visible catches a regression of that.)
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('non-existent email returns the same generic error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(`nobody_${Date.now().toString(36)}@e2e.test`);
    await page.getByLabel('Password').fill('whatever_password_will_do');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Identical message to the wrong-password case — server hides the
    // distinction to prevent email enumeration on the login endpoint.
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('Logout', () => {
  test('logout returns to /login and protected routes redirect back', async ({ page }) => {
    const user = makeUser('logout');
    await fillRegisterForm(page, user);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL(MAPS_URL_RE);

    // Capture the post-login URL so we can try to revisit it after logout.
    const protectedUrl = page.url();

    // Log out via the navbar button.
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Visiting the previously-authenticated map page should bounce back.
    await page.goto(protectedUrl);
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
  });
});
