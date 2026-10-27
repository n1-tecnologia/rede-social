import { isProjectRef, type PrecheckReason } from '@rede-social/contracts/projects';
import { and, eq, ne, sql } from 'drizzle-orm';
import { projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { env } from '../env';
import { getProjectProvider } from './provider-access';
import { createRequestTokenProvider } from './provider-for';
import { TokenRefusal, validateCustomerToken } from './token';
import {
  type ApiKey,
  type ProjectProvider,
  ProjectProviderError,
  type ProjectStatus,
} from './types';

/**
 * The read-only pre-check behind "Continuar" in the new-tenant form (09.2-14, D-541, UI-D-533). It answers one
 * question: may the platform prepare this project for a tenant, and can it obtain the project's access by
 * itself?
 *
 *   ok, manualAccess false  the common path: the keys, the pooler address and the password are the platform's
 *   ok, manualAccess true   the platform token cannot reveal the project's secrets, so the form asks for three
 *   not ok, a reason        invalid | not_found | in_use | paused | not_empty | unchecked
 *
 * It writes nothing and it never returns provider text: a failure of the check itself is `unchecked`, which is
 * DATA (a 200 answer), so the form can show its top alert without a failed request (planning decision 5).
 * The order of the reasons is the order an operator can act on them: the shape, then whether the project
 * exists, whether another tenant already owns it (production only, D-540), whether it is paused, whether it is
 * empty.
 *
 * A CUSTOMER project (09.4-09, D-566, D-570, D-571): with `owner: 'customer'` the pasted token travels once, in
 * the options, and is validated by `validateCustomerToken` (the typed date, the `sbp_fc` prefix, `describe`,
 * the account-wide listing); every check that follows (REMOVED, in use, paused, emptiness, the key list) runs
 * through the SAME request-token provider, so the platform token never touches the customer's project. The
 * refusals are the closed reasons `token_invalid`, `token_forbidden`, `token_account_wide` and
 * `token_expiry_invalid` (D-541 amended: a 403 on the key list is `token_forbidden` for a customer token,
 * which holds API Key Secrets by D-569, while keys listed WITHOUT a value still answer `manualAccess: true`).
 * D-572: the plan is never read, so `not_pro` and `token_other_project` stay reserved and are never emitted. A
 * token with the Read levels but without a Read-write one passes every read here; the bootstrap fails it later
 * with `token_forbidden` (RESEARCH Pitfall 10), so this check never promises "Sem permissão".
 *
 * `learned` (the organisation read from the project, the typed expiry) is INTERNAL: the creation seals it with
 * the token. The route builds its answer from `ok`, `manualAccess` and `reason` only, so it can never leave.
 */

export type PrecheckResult =
  | {
      ok: true;
      manualAccess: boolean;
      /** Internal (customer path only): what the validation learned, for the creation to pin and seal. */
      learned?: { orgSlug: string; expiresAt: string | null };
    }
  | { ok: false; reason: PrecheckReason };

export type PrecheckOptions = {
  /** The tenant the project is for, when it already exists: its own binding is not "in use by another tenant". */
  tenantId?: string;
  /** Test seam; defaults to `NODE_ENV === 'production'` (the hosted homologation environment sets it too). */
  production?: boolean;
  /** Test seam; defaults to the env-selected provider (platform) or one built from `token` (customer). */
  provider?: ProjectProvider;
  /** 09.4-09 (D-566): whose project this is. Absent or `platform` is the platform path, untouched. */
  owner?: 'platform' | 'customer';
  /** The customer's pasted management token; write-only, never returned or logged. */
  token?: string;
  /** The expiry date the operator typed (`YYYY-MM-DD`), or none. */
  tokenExpiresAt?: string | null;
  /** Test seam: the day the typed date is judged against (default: today in America/Sao_Paulo). */
  today?: string;
};

/** The two buckets the tenant set itself creates; any other bucket means the project's Storage was used. */
const OWN_BUCKETS = new Set(['branding', 'media']);

const PAUSED_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  'INACTIVE',
  'PAUSING',
  'PAUSE_FAILED',
  'GOING_DOWN',
]);

/** Same predicate as `projectIsEmpty` (the bootstrap's own guard), run through the Management API. */
const PUBLIC_TABLES_QUERY = `
  select count(*)::int as n
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')`;

const UNCHECKED: PrecheckResult = { ok: false, reason: 'unchecked' };

function describeFailure(error: unknown, customer = false): PrecheckResult {
  if (error instanceof ProjectProviderError) {
    if (customer && error.customerToken) {
      // A customer token says what is wrong with IT; the platform's wording (not_found) would hide that.
      if (error.code === 'token_invalid') return { ok: false, reason: 'token_invalid' };
      if (
        error.kind === 'forbidden' ||
        error.code === 'token_forbidden' ||
        error.code === 'org_mismatch'
      ) {
        return { ok: false, reason: 'token_forbidden' };
      }
      if (error.kind === 'not_found') return { ok: false, reason: 'not_found' };
      return UNCHECKED;
    }
    // A project of another organisation (`org_mismatch`) and one the token cannot see look the same: not ours.
    if (error.kind === 'not_found' || error.kind === 'forbidden') {
      return { ok: false, reason: 'not_found' };
    }
  }
  return UNCHECKED;
}

/** A `TokenRefusal` code as the pre-check reason of the same meaning (D-570, D-571, D-572). */
function reasonOfRefusal(refusal: TokenRefusal): PrecheckReason {
  switch (refusal.code) {
    case 'token_invalid':
    case 'token_forbidden':
    case 'token_account_wide':
    case 'token_expiry_invalid':
    case 'not_found':
    case 'unchecked':
      return refusal.code;
    case 'org_mismatch':
      return 'token_forbidden';
    // Reserved (D-572) or impossible on a first registration: never produced by the validation today.
    default:
      return 'unchecked';
  }
}

/** Whether the picked key of a kind is listed WITHOUT its value (a token that cannot reveal secrets). */
function lacksValue(keys: ApiKey[], kinds: readonly ApiKey['kind'][]): boolean {
  const picked = keys.filter((key) => !key.disabled && kinds.includes(key.kind));
  return picked.length > 0 && picked.every((key) => key.value === undefined);
}

export async function precheckProject(
  ref: string,
  options: PrecheckOptions = {},
): Promise<PrecheckResult> {
  const customer = options.owner === 'customer';
  let provider: ProjectProvider;
  try {
    if (customer) {
      if (!options.token) return { ok: false, reason: 'token_invalid' };
      provider = options.provider ?? (await createRequestTokenProvider({ token: options.token }));
    } else {
      provider = options.provider ?? (await getProjectProvider());
    }
  } catch {
    return UNCHECKED;
  }
  if (typeof ref !== 'string' || !isProjectRef(provider.name, ref)) {
    return { ok: false, reason: 'invalid' };
  }

  // The customer's token is judged first (date, prefix, describe, listing): one closed refusal or the learned pin.
  let learned: { orgSlug: string; expiresAt: string | null } | undefined;
  if (customer && options.token) {
    try {
      const validated = await validateCustomerToken({
        ref,
        token: options.token,
        expiresAt: options.tokenExpiresAt ?? null,
        provider,
        ...(options.today === undefined ? {} : { today: options.today }),
      });
      learned = { orgSlug: validated.orgSlug, expiresAt: validated.expiresAt };
    } catch (error) {
      if (error instanceof TokenRefusal) return { ok: false, reason: reasonOfRefusal(error) };
      return UNCHECKED;
    }
  }

  let status: ProjectStatus;
  try {
    status = (await provider.describe(ref)).status;
  } catch (error) {
    return describeFailure(error, customer);
  }
  if (status === 'REMOVED') return { ok: false, reason: 'not_found' };

  // Outside production any number of tenants may share a project (D-540), so "in use" never occurs there.
  const production = options.production ?? env.NODE_ENV === 'production';
  if (production) {
    try {
      const [row] = await withPlatformTx((tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(tenantProjects)
          .innerJoin(projects, eq(projects.id, tenantProjects.projectId))
          .where(
            and(
              eq(projects.ref, ref),
              options.tenantId ? ne(tenantProjects.tenantId, options.tenantId) : undefined,
            ),
          ),
      );
      if ((row?.n ?? 0) > 0) return { ok: false, reason: 'in_use' };
    } catch {
      return UNCHECKED;
    }
  }

  if (PAUSED_STATUSES.has(status)) return { ok: false, reason: 'paused' };

  // Emptiness: no migration of any kind, no bucket the tenant set does not create, and (best effort, the Beta
  // query endpoint) no ordinary table in `public`. The bootstrap checks the database itself again.
  try {
    if ((await provider.listMigrations(ref)).length > 0) return { ok: false, reason: 'not_empty' };
    if ((await provider.listBuckets(ref)).some((bucket) => !OWN_BUCKETS.has(bucket.id))) {
      return { ok: false, reason: 'not_empty' };
    }
    const rows = await provider.readOnlyQuery(ref, PUBLIC_TABLES_QUERY);
    const first = rows?.[0] as { n?: unknown } | undefined;
    if (typeof first?.n === 'number' && first.n > 0) return { ok: false, reason: 'not_empty' };
  } catch (error) {
    return customer ? describeFailure(error, true) : UNCHECKED;
  }

  // Access: can the token reveal the project's keys? A 403 (or keys listed without values) means the form must
  // ask for the three manual fields; any other failure is a check that could not run. For a CUSTOMER token a
  // 403 here is the token's own missing permission (it holds API Key Secrets, D-569), so it is `token_forbidden`
  // (D-541 amended); the masked-values fallback below stays for safety.
  try {
    const keys = await provider.listApiKeys(ref);
    const manualAccess =
      lacksValue(keys, ['publishable', 'legacy_anon']) ||
      lacksValue(keys, ['secret', 'legacy_service_role']);
    return learned ? { ok: true, manualAccess, learned } : { ok: true, manualAccess };
  } catch (error) {
    if (customer) return describeFailure(error, true);
    if (error instanceof ProjectProviderError && error.kind === 'forbidden') {
      return { ok: true, manualAccess: true };
    }
    return UNCHECKED;
  }
}
