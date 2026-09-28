import { env } from '../env';
import { registerJobQueues } from '../jobs/boss';
import { createLocalAuthAllowList, createSupabaseAuthAllowList } from './auth-allow-list';
import { createFakeDomainProvider } from './fake';
import { type AuthAllowList, DOMAIN_VERIFY_QUEUE, type DomainProvider } from './types';
import { createVercelDomainProvider } from './vercel';

/**
 * Env-selected singletons (T-02-59: the fail-safe defaults are the local implementations; a real
 * selection without its credentials already failed at import in `env.ts` — `assertProductionEnv`).
 * Configuration is read ONLY through the kernel `env` module, never through the raw Node
 * environment, so the selection is validated once and the secrets never leave this file's callers.
 *
 * Imported as `@rede-social/core/server/domains/index` from outside the kernel (the `./server/*` export
 * maps to a file, not a directory).
 */

/**
 * `assertProductionEnv()` (02-03) already refused a `vercel` / `supabase` selection without these
 * values at import time, so a missing one here is a programming error, not a deploy error — but it
 * still fails with a named message instead of a `!` assertion that would let `undefined` reach a
 * request header.
 */
function requireEnv(
  name:
    | 'VERCEL_TOKEN'
    | 'VERCEL_PROJECT_ID'
    | 'VERCEL_TEAM_ID'
    | 'SUPABASE_PAT'
    | 'SUPABASE_PROJECT_REF',
): string {
  const value = env[name];
  if (!value)
    throw new Error(`${name} is required by the selected adapter (see assertProductionEnv)`);
  return value;
}

export const domainProvider: DomainProvider =
  env.DOMAIN_PROVIDER === 'vercel'
    ? createVercelDomainProvider({
        token: requireEnv('VERCEL_TOKEN'),
        projectId: requireEnv('VERCEL_PROJECT_ID'),
        teamId: requireEnv('VERCEL_TEAM_ID'),
      })
    : createFakeDomainProvider();

export const authAllowList: AuthAllowList =
  env.AUTH_ALLOW_LIST === 'supabase'
    ? createSupabaseAuthAllowList({
        pat: requireEnv('SUPABASE_PAT'),
        projectRef: requireEnv('SUPABASE_PROJECT_REF'),
      })
    : createLocalAuthAllowList();

// `kernel.domain-verify` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). Every enqueue path
// (`platform/domains.ts`) imports this barrel at module top, so the API's lazy `startedBoss()`
// always knows the queue before the first `send`; the worker creates it from its explicit job list.
registerJobQueues([DOMAIN_VERIFY_QUEUE]);

export type {
  AuthAllowList,
  DomainCheck,
  DomainProvider,
  DomainProviderErrorKind,
  DomainVerifyPayload,
} from './types';
export {
  allowListEntry,
  DOMAIN_VERIFY_DEADLINE_MS,
  DOMAIN_VERIFY_INTERVAL_S,
  DOMAIN_VERIFY_QUEUE,
  DomainProviderError,
} from './types';
