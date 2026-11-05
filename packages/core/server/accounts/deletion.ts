import { sql } from 'drizzle-orm';
import { withHandle } from '../../db/project-pools';
import { type Tx, withTenantTx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { env } from '../env';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { supabaseAdminFor } from '../supabase-admin';
import { type ProjectRecord, resolveProject } from '../tenancy/project-registry';

/**
 * "Excluir minha conta", the request side (13-13, D-609, D-610, NATIVE-19, NATIVE-20). The rules live in SQL
 * (13-07: `app.account_deletion_request`, `_cancel`, `_notice_take`); this file is the part only the API can do:
 * prove the password against the member's OWN project, call the SQL in the member's tenant transaction, and
 * revoke every session of the person.
 *
 * Order is load-bearing:
 *   1. the password is verified FIRST, so a wrong one changes nothing (403 `WRONG_PASSWORD`);
 *   2. the SQL request runs in the tenant lane (the last administrator is refused there, `AD001` -> 409
 *      `LAST_ADMIN`); it deactivates the member at once, so the very next request with the OLD token is refused
 *      by the live-member predicate (the lookups return no row);
 *   3. the sessions are revoked with Auth's global sign-out. It is best effort AFTER the commit: the deletion is
 *      already in force and every old token is already refused, so a sign-out that fails is logged by event only
 *      and the member still gets their deadline.
 *
 * Nothing here logs the password, the address or the token: the only event is `account.deletion.requested` with
 * the tenant id (the per-request logger adds the user id and request id like every other line).
 */

const log = moduleLogger('account-deletion');

/** How long Auth may take to answer the password grant or the sign-out. */
const AUTH_TIMEOUT_MS = 5_000;

export const PASSWORD_MAX = 256;

export type DeletionInput = {
  /** The password typed on the delete page; never logged, never echoed. */
  password: string;
  /** The member's address, from the VERIFIED token claims (never from the body). */
  email: string;
  /** The caller's own access token, so Auth can revoke the person's sessions globally. */
  accessToken: string;
};

export type DeletionDeps = {
  /** True when the project's Auth accepts the password for the address; false for any rejection. */
  verifyPassword(project: ProjectRecord, email: string, password: string): Promise<boolean>;
  /** Revokes every session of the token's user in the project. */
  signOutGlobal(project: ProjectRecord, accessToken: string): Promise<void>;
};

/**
 * The key the password grant is sent with: the project's PUBLISHABLE key, or, for the environment project
 * (project 0 keeps no publishable key in the registry) the service key. A password grant carries no role of its
 * own: Auth only needs a valid `apikey` to reach it, and the result is discarded, never used.
 */
function grantKeyOf(project: ProjectRecord): string {
  const publishable = project.publishableKey?.trim();
  if (publishable) return publishable;
  if (project.credentialSource === 'env') return env.SUPABASE_SERVICE_KEY;
  throw new ApiError(503, 'TENANT_UNAVAILABLE');
}

export const defaultDeletionDeps: DeletionDeps = {
  async verifyPassword(project, email, password) {
    let response: Response;
    try {
      response = await fetch(`${project.apiUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: grantKeyOf(project), 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Auth unreachable or too slow: the member's project cannot answer, which is NOT a wrong password.
      throw new ApiError(503, 'TENANT_UNAVAILABLE');
    }
    if (response.ok) return true;
    // 400 `invalid_credentials`, 401 and 422 are Auth saying no to this pair; anything else is Auth failing.
    if (response.status === 400 || response.status === 401 || response.status === 422) return false;
    throw new ApiError(503, 'TENANT_UNAVAILABLE');
  },
  async signOutGlobal(project, accessToken) {
    const { error } = await supabaseAdminFor(project).auth.admin.signOut(accessToken, 'global');
    if (error) throw new Error(error.message);
  },
};

/** The five-character SQLSTATE of a failed statement; drizzle wraps the driver error, so the chain is walked. */
function sqlstateOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = current.cause;
  }
  return null;
}

/** The deadline as an ISO string, whatever shape the driver hands back for a `timestamptz`. */
export function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Requests the deletion of the caller's OWN account and returns the deadline. The account acted on is
 * `ctx.userId` and nothing else: there is no administrator variant and no id in the input.
 */
export async function requestAccountDeletion(
  ctx: Pick<RequestContext, 'userId' | 'tenantId' | 'role'>,
  input: DeletionInput,
  deps: DeletionDeps = defaultDeletionDeps,
  logger: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  } = log,
): Promise<{ dueAt: string }> {
  const { password } = input;
  if (password.length < 1 || password.length > PASSWORD_MAX || password.trim().length === 0) {
    throw new ApiError(400, 'VALIDATION_FAILED');
  }

  const project = await resolveProject(ctx.tenantId);
  if (!(await deps.verifyPassword(project, input.email, password))) {
    throw new ApiError(403, 'WRONG_PASSWORD');
  }

  let dueAt: string | null;
  try {
    dueAt = await withTenantTx(ctx, async (tx) => {
      const rows = await tx.execute<{ due: unknown }>(
        sql`select app.account_deletion_request() as due`,
      );
      return isoOf(rows[0]?.due);
    });
  } catch (error) {
    // AD001: the caller is the only active administrator (13-07). One answer, no details.
    if (sqlstateOf(error) === 'AD001') throw new ApiError(409, 'LAST_ADMIN');
    throw error;
  }
  if (dueAt === null) throw new ApiError(500, 'INTERNAL');

  try {
    await deps.signOutGlobal(project, input.accessToken);
  } catch {
    // Every old token is already refused by the live predicate; the sessions simply linger until they expire.
    logger.warn(
      { event: 'account.deletion.signout_failed', tenantId: ctx.tenantId },
      'sign-out failed',
    );
  }
  logger.info(
    { event: 'account.deletion.requested', tenantId: ctx.tenantId },
    'account deletion requested',
  );
  return { dueAt };
}

/**
 * The cancel by a fresh sign-in (NATIVE-20), called by `requireAuth` when the host's membership lookup found no
 * live membership. `tokenIat` is the token's own issue instant: SQL refuses a token issued at or before the
 * request and any call at or after the deadline, so the answer is `true` only for a genuine fresh sign-in inside
 * the window. Runs on the project's connection role, before any tenant claim exists.
 */
export async function cancelPendingDeletion(args: {
  tenantId: string;
  userId: string;
  tokenIat: Date;
}): Promise<boolean> {
  const project = await resolveProject(args.tenantId);
  const rows = await withHandle(project, (handle) =>
    handle.db.execute<{ cancelled: boolean | null }>(
      sql`select app.account_deletion_cancel(${args.tenantId}::uuid, ${args.userId}::uuid, ${args.tokenIat.toISOString()}::timestamptz) as cancelled`,
    ),
  );
  return rows[0]?.cancelled === true;
}

/**
 * The one-time "Exclusão cancelada" notice (`app.account_deletion_notice_take`), read inside the bootstrap's own
 * tenant transaction. Returns the cancelled deadline ONCE and `null` for every other request.
 */
export async function takeDeletionNotice(tx: Tx): Promise<{ until: string } | null> {
  const rows = await tx.execute<{ due: unknown }>(
    sql`select app.account_deletion_notice_take() as due`,
  );
  const until = isoOf(rows[0]?.due);
  return until === null ? null : { until };
}

/**
 * The last-administrator read of the delete page (UI-D-617): `false` for every role but `admin_tenant`, with no
 * query at all; for an administrator, whether NO OTHER active, unblocked, non-deleted administrator exists.
 * Reveals nothing else.
 */
export async function isLastAdmin(
  ctx: Pick<RequestContext, 'userId' | 'tenantId' | 'role'>,
): Promise<boolean> {
  if (ctx.role !== 'admin_tenant') return false;
  return withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ others: number | string }>(sql`
      select count(*)::int as others
        from public.memberships m
       where m.tenant_id = ${ctx.tenantId}::uuid
         and m.user_id <> ${ctx.userId}::uuid
         and m.role = 'admin_tenant'
         and m.status = 'active'
         and m.blocked_at is null
         and m.deleted_at is null`);
    return Number(rows[0]?.others ?? 0) === 0;
  });
}
