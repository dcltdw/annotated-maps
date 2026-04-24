import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end tests.
 *
 * Tests assume the Docker Compose stack is already running (mysql,
 * backend, frontend). Start it with `docker compose up -d` and wait
 * for the backend log line "Annotated Maps backend starting on port
 * 8080" before running `npm run test:e2e`.
 *
 * See ../docs/TESTING-E2E.md.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Fail the build on `test.only` left in source.
  forbidOnly: !!process.env.CI,
  // Single retry in CI to absorb flakes; none locally so failures are loud.
  retries: process.env.CI ? 1 : 0,
  // Sequential locally so the dev sees what's happening; parallel in CI.
  workers: process.env.CI ? undefined : 1,
  // Default per-test timeout. Individual tests can override.
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    // Capture trace on retry only (cheap, useful for debugging flakes).
    trace: 'on-first-retry',
    // Screenshots/videos on failure only.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
