import { ProjectProviderError } from './types';

/**
 * The closed catalog of bootstrap reason codes (09.2-12, DBT-20, UI A-UI-10). A step that fails is shown
 * to the operator as exactly one of these codes, and the panel maps each code to one fixed sentence. No
 * provider text, no SQL, no host and no key can reach a screen because nothing but a code ever leaves the
 * bootstrap.
 */
export const BOOTSTRAP_REASONS = [
  'unreachable',
  'access_denied',
  'not_empty',
  'migration_failed',
  'auth_config_failed',
  'storage_failed',
  'realtime_failed',
  'tenant_failed',
  'invite_failed',
  'unknown',
] as const;

export type BootstrapReason = (typeof BOOTSTRAP_REASONS)[number];

/** The bootstrap steps in UI-SPEC order (the same names `failAt` of the fake provider uses). */
export const BOOTSTRAP_STEPS = [
  'verify',
  'roles',
  'schema',
  'auth',
  'buckets',
  'realtime',
  'tenant',
  'invite',
] as const;

export type BootstrapStep = (typeof BOOTSTRAP_STEPS)[number];

/** The code of a step's own failure. `not_empty` is raised by the bootstrap itself, never mapped from here. */
export const STEP_REASON: Record<BootstrapStep, BootstrapReason> = {
  verify: 'unreachable',
  roles: 'unreachable',
  schema: 'migration_failed',
  auth: 'auth_config_failed',
  buckets: 'storage_failed',
  realtime: 'realtime_failed',
  tenant: 'tenant_failed',
  invite: 'invite_failed',
};

/**
 * Exactly one code for a failure at a step. A provider `forbidden` is always `access_denied` (the token or
 * the organisation is wrong, whatever the step); a provider that cannot be reached, timed out or never got
 * ready is `unreachable`; any other provider or non-provider error is the step's own code, and a step this
 * catalog does not know is `unknown`. The error's message is never read.
 */
export function reasonOf(error: unknown, step: BootstrapStep | string): BootstrapReason {
  if (error instanceof ProjectProviderError) {
    if (error.kind === 'forbidden') return 'access_denied';
    if (error.kind === 'timeout' || error.kind === 'unavailable' || error.kind === 'not_ready') {
      return 'unreachable';
    }
  }
  return Object.hasOwn(STEP_REASON, step) ? STEP_REASON[step as BootstrapStep] : 'unknown';
}
