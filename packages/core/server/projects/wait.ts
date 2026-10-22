import {
  type ProjectDescription,
  type ProjectHealth,
  ProjectProviderError,
  type ProjectStatus,
  type WaitOptions,
} from './types';

/**
 * The shared wait of both providers (09.2-12, DBT-20, P38/P39, Pitfall 4): a project that is still coming
 * up is not a failure of the bootstrap, it is something to wait for with growing delays; only the budget
 * running out is `not_ready`.
 */

/** The services whose health the bootstrap needs, in the order the health endpoint is asked. */
export const REQUIRED_SERVICES = [
  'auth',
  'db',
  'db_postgres_user',
  'pooler',
  'realtime',
  'rest',
  'storage',
] as const;

export const WAIT_BUDGET_MS = 600_000;
const FIRST_DELAY_MS = 2_000;
const MAX_DELAY_MS = 30_000;

export type StatusClass = 'ready' | 'wait' | 'paused' | 'unavailable';

/**
 * P39: adjacent statuses are told apart. `ACTIVE_HEALTHY` proceeds; the transient ones wait; a paused or
 * pausing project fails as paused (kind `invalid`: a human must resume it); a dead one fails as
 * unavailable. An unknown future status is treated as `UNKNOWN` (unavailable), never as ready.
 */
export function classifyStatus(status: ProjectStatus | string): StatusClass {
  switch (status) {
    case 'ACTIVE_HEALTHY':
      return 'ready';
    case 'COMING_UP':
    case 'UPGRADING':
    case 'RESTARTING':
    case 'ACTIVE_UNHEALTHY':
    case 'RESTORING':
    case 'RESIZING':
      return 'wait';
    case 'INACTIVE':
    case 'PAUSING':
    case 'PAUSE_FAILED':
    case 'GOING_DOWN':
      return 'paused';
    default:
      return 'unavailable';
  }
}

/** Every required service must be reported AND healthy: `db` healthy while `auth` is coming up is NOT healthy. */
export function allServicesHealthy(health: ProjectHealth): boolean {
  return REQUIRED_SERVICES.every((name) => health.services[name] === 'ACTIVE_HEALTHY');
}

export type WaitDeps = {
  describe(ref: string): Promise<ProjectDescription>;
  health(ref: string): Promise<ProjectHealth>;
  now(): number;
  sleep(ms: number): Promise<void>;
};

/**
 * Polls `describe` and `health` with delays 2 s, 4 s, 8 s ... capped at 30 s. The budget is checked at the
 * top of every iteration, so a poll at 599_999 ms still happens and one at 600_000 ms never does: it throws
 * `not_ready`. The last sleep is clamped to the remaining budget, so the wait ends exactly on it.
 */
export async function waitUntilHealthy(
  deps: WaitDeps,
  ref: string,
  options: WaitOptions = {},
): Promise<void> {
  const maxMs = options.maxMs ?? WAIT_BUDGET_MS;
  if (!Number.isFinite(maxMs) || maxMs <= 0) throw new ProjectProviderError('invalid', 0);
  const started = deps.now();
  let delay = FIRST_DELAY_MS;
  for (;;) {
    const elapsed = deps.now() - started;
    if (elapsed >= maxMs) throw new ProjectProviderError('not_ready', 0);

    const described = await deps.describe(ref);
    const cls = classifyStatus(described.status);
    if (cls === 'paused') throw new ProjectProviderError('invalid', 0);
    if (cls === 'unavailable') throw new ProjectProviderError('unavailable', 0);
    if (cls === 'ready' && allServicesHealthy(await deps.health(ref))) return;

    await deps.sleep(Math.min(delay, Math.max(0, maxMs - elapsed)));
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}
