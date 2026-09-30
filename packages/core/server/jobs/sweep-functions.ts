/**
 * The sweep-function name registry (07-04, planning decision 3): the kernel's hourly sweeper
 * (`kernel.media-sweep-orphans`) also runs every SQL function a module manifest declares in
 * `sweepFunctions`, so a module can bound its own table's growth without the kernel ever naming a
 * module table (MOD-02) and without a module ever touching the admin lane.
 *
 * The contract a declared name signs up to: `app.<name>(p_batch int) returns int` deletes AT MOST
 * `p_batch` rows and returns how many it deleted. The sweeper calls it through `withAdminTx`, repeats
 * it while it returns a full batch (bounded per run), and isolates each name's failure.
 *
 * **Names come from code, never from input (T-07-24).** `registerSweepFunctions` is called by the app
 * registry with manifest literals, every name is validated against `SWEEP_FUNCTION_NAME` HERE (a bad
 * name throws at import time, loudly), and the sweeper still passes it through `sql.identifier`, so a
 * name can never become SQL text. The `registerJobQueues` precedent (`./boss.ts`): a Set, idempotent.
 */

/** Lower-case letters and underscores only: an `app` schema function name, nothing else. */
export const SWEEP_FUNCTION_NAME = /^[a-z_]+$/;

const names = new Set<string>();

/** Registers every name (idempotent). Throws on the FIRST name that fails `SWEEP_FUNCTION_NAME`. */
export function registerSweepFunctions(list: readonly string[]): void {
  for (const name of list) {
    if (!SWEEP_FUNCTION_NAME.test(name)) {
      throw new Error(`invalid sweep function name: ${JSON.stringify(name)}`);
    }
  }
  for (const name of list) names.add(name);
}

/** Every registered name, in registration order. */
export function registeredSweepFunctions(): string[] {
  return [...names];
}

/**
 * Test-only: removes `name` from the registry (a case that registers a failing name restores the
 * registry afterwards). Returns whether it was registered.
 */
export function unregisterSweepFunction(name: string): boolean {
  return names.delete(name);
}
