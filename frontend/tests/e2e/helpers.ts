/**
 * Helpers shared across E2E specs.
 *
 * Tests run against a live backend with a persistent database, so each
 * test must use unique credentials to avoid duplicate-key collisions
 * with prior runs.
 */

let counter = 0;

/**
 * Generate a unique user object scoped to the current test run.
 * `tag` should be a short test-identifying string (e.g. 'reg', 'login')
 * to make it easy to spot leftover rows in the dev DB.
 */
export function makeUser(tag: string): {
  username: string;
  email: string;
  password: string;
} {
  // 8-char base36 from the high bits of Date.now() collides only across
  // ~50-day windows, plus a per-test counter so tests in the same
  // millisecond stay unique.
  counter += 1;
  const id = Date.now().toString(36).slice(-8) + counter.toString(36);
  return {
    username: `e2e_${tag}_${id}`,
    email:    `e2e_${tag}_${id}@e2e.test`,
    password: 'pw_for_e2e_test_only',
  };
}
