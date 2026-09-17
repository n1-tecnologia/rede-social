import { env } from '../env';
import { registerJobQueues } from '../jobs/boss';
import { createLocalAuthAllowList } from './auth-allow-list';
import { createFakeDomainProvider } from './fake';
import { type AuthAllowList, DOMAIN_VERIFY_QUEUE, type DomainProvider } from './types';

/**
 * Env-selected singletons (T-02-59: the fail-safe defaults are the local implementations; a real
 * selection without its credentials already failed at import in `env.ts` — `assertProductionEnv`).
 * Configuration is read ONLY through the kernel `env` module, never through the raw Node
 * environment, so the selection is validated once and the secrets never leave this file's callers.
 *
 * Imported as `@tria/core/server/domains/index` from outside the kernel (the `./server/*` export
 * maps to a file, not a directory).
 */

function notWiredYet(what: string): never {
  throw new Error(`${what} is wired in 02-09 Task 3`);
}

export const domainProvider: DomainProvider =
  env.DOMAIN_PROVIDER === 'vercel'
    ? notWiredYet('DOMAIN_PROVIDER=vercel')
    : createFakeDomainProvider();

export const authAllowList: AuthAllowList =
  env.AUTH_ALLOW_LIST === 'supabase'
    ? notWiredYet('AUTH_ALLOW_LIST=supabase')
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
