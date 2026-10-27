import { env } from '../env';
import { registerJobQueues } from '../jobs/boss';
import { customerProviderFor } from '../projects/provider-for';
import type { ProjectRecord } from '../tenancy/project-registry';
import {
  createLocalAuthAllowList,
  createProviderAuthAllowList,
  createSupabaseAuthAllowList,
} from './auth-allow-list';
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
  name: 'VERCEL_TOKEN' | 'VERCEL_PROJECT_ID' | 'VERCEL_TEAM_ID' | 'SUPABASE_PAT',
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

/**
 * The columns of a registry row the allow-list adapter is chosen from. The owner, pin and sealed token are
 * optional so a caller (and a test) that knows nothing of customer projects still compiles (09.4-06).
 */
export type AllowListProject = Pick<
  ProjectRecord,
  'id' | 'ref' | 'provider' | 'credentialVersion'
> &
  Partial<Pick<ProjectRecord, 'owner' | 'orgSlug' | 'mgmtTokenSealed'>>;

const ADAPTER_CACHE_MAX = 64;
const adapters = new Map<string, AuthAllowList>();

/**
 * 09.2-11 (DBT-42, D-538): the redirect allow-list of ONE project. Every project has its own GoTrue and so its
 * own `uri_allow_list`. `AUTH_ALLOW_LIST=supabase` with a `supabase` project writes through the Management API
 * with `SUPABASE_PAT` and that project's `ref`; anything else (the env default, or a `fake` project of a local
 * stack) keeps an in-memory ledger of its own. Memoised by project id and credential version, bounded at 64
 * (least recently used goes first).
 *
 * 09.4-06 (CTK-27, D-575, ruling 5): a CUSTOMER project's list is read and written through that project's own
 * guarded provider (its sealed token and organisation pin), never with the platform token. The function stays
 * synchronous. `deps.mode` is a documented test seam; production passes none and the env decides.
 */
export function authAllowListFor(
  project: AllowListProject,
  deps: { mode?: 'local' | 'supabase' } = {},
): AuthAllowList {
  const key = `${project.id}:${project.credentialVersion}`;
  const hit = adapters.get(key);
  if (hit) {
    adapters.delete(key);
    adapters.set(key, hit);
    return hit;
  }
  const mode = deps.mode ?? env.AUTH_ALLOW_LIST;
  let adapter: AuthAllowList;
  if (mode === 'supabase' && project.provider === 'supabase') {
    adapter =
      project.owner === 'customer'
        ? createProviderAuthAllowList(customerProviderFor(project), project.ref)
        : createSupabaseAuthAllowList({ pat: requireEnv('SUPABASE_PAT'), projectRef: project.ref });
  } else {
    adapter = createLocalAuthAllowList(project.id);
  }
  if (adapters.size >= ADAPTER_CACHE_MAX) {
    const oldest = adapters.keys().next();
    if (!oldest.done) adapters.delete(oldest.value);
  }
  adapters.set(key, adapter);
  return adapter;
}

/** Forgets every credential version of one project's adapter (D-575(a): after a replacement it is rebuilt). */
export function dropAllowListAdapter(projectId: string): void {
  for (const key of [...adapters.keys()]) {
    if (key.startsWith(`${projectId}:`)) adapters.delete(key);
  }
}

// `kernel.domain-verify` is a KERNEL-owned queue, so it registers itself here rather than in
// `apps/api/src/modules/registry.ts` (which lists MODULE queues only, MOD-02). Every enqueue path
// (`platform/domains.ts`) imports this barrel at module top, so the API's lazy sender (`senderFor`)
// always knows the queue before the first `send`; the worker creates it from its explicit job list.
registerJobQueues([DOMAIN_VERIFY_QUEUE], 'platform');

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
