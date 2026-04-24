import { randomUUID } from 'crypto';

/**
 * Helpers shared across E2E specs.
 *
 * Tests run against a live backend with a persistent database, so each
 * test must use unique credentials to avoid duplicate-key collisions
 * with prior runs AND with parallel workers.
 */

let counter = 0;

/**
 * Generate a unique user object scoped to the current test run.
 * `tag` should be a short test-identifying string (e.g. 'reg', 'login')
 * to make it easy to spot leftover rows in the dev DB.
 *
 * Uniqueness layers (earlier cure latent collisions; later is defense
 * in depth):
 *  - `process.pid` — differs across Playwright workers; resets to 0 in
 *    each worker, so module-level counters can't disambiguate two
 *    workers starting the same test at the same millisecond. Before
 *    this was added, --repeat-each=20 under parallel workers hit
 *    "username already taken" ~30% of runs (#76).
 *  - `counter` — monotonic within a worker; disambiguates tests that
 *    start inside the same ms within the same process.
 *  - random UUID slice — insulates against worker pid reuse after a
 *    crash-and-respawn and any future scheduling weirdness.
 */
export function makeUser(tag: string): {
  username: string;
  email: string;
  password: string;
} {
  counter += 1;
  const id = [
    process.pid.toString(36),
    counter.toString(36),
    randomUUID().slice(0, 8),
  ].join('_');
  return {
    username: `e2e_${tag}_${id}`,
    email:    `e2e_${tag}_${id}@e2e.test`,
    password: 'pw_for_e2e_test_only',
  };
}
