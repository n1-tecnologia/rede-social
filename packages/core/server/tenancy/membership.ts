import { TENANT_ROLES, type TenantRole } from '@rede-social/contracts';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

/**
 * The two membership lookups — one tenant (`membershipInTenant`, a verified tenant host) or every
 * tenant (`membershipsOfUser`, a generic host) — that `requireAuth` runs on EVERY request (never
 * cached, D-09) and the auth-mail table reads for its facts (D-315), on the bare `api_user`
 * connection: that role may EXECUTE the SECURITY DEFINER functions below without opening a lane.
 * There is no "oldest membership" lookup any more (08.1-05 removed the last caller; the SQL
 * `app.membership_for_user` stays until 08.1-08 drops it, D-318).
 *
 * The lifecycle rules (`deleted_at` -> no row, `blocked_at` -> `status = 'blocked'`) live ONLY in SQL
 * (WR-08, migrations 20260914171114 and 20261006195913) — do not re-implement them in TypeScript.
 * The one rule that does live here is `pickGenericMembership`, a pure choice among rows the database
 * already filtered.
 */

export type MembershipStatus = 'active' | 'blocked' | 'invited';

export type Membership = {
  tenantId: string;
  tenantSlug: string;
  tenantDisplayName: string;
  role: TenantRole;
  status: MembershipStatus;
  tenantStatus: string;
};

type Row = {
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  role: string;
  status: string;
  tenant_status: string;
};

const isTenantRole = (value: string): value is TenantRole =>
  (TENANT_ROLES as readonly string[]).includes(value);

const isStatus = (value: string): value is MembershipStatus =>
  value === 'active' || value === 'blocked' || value === 'invited';

/**
 * Snake to camel, refusing a role or status the CHECK constraints should have made impossible (a
 * broken invariant is a 500, never a silently mis-authorized request).
 */
function toMembership(row: Row, source: string, userId: string): Membership {
  if (!isTenantRole(row.role) || !isStatus(row.status)) {
    throw new Error(`${source} returned an unexpected role/status for user ${userId}`);
  }
  return {
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    role: row.role,
    status: row.status,
    tenantStatus: row.tenant_status,
  };
}

/**
 * D-307: the caller's membership in the tenant the request's VERIFIED host resolved to, or `null`.
 * `app.membership_in_tenant` returns at most one row (`memberships_tenant_user_uq`); `null` is the
 * tenant-host `TENANT_HOST_MISMATCH` — the host selects among the user's own memberships, never grants
 * one (D-23).
 */
export async function membershipInTenant(
  userId: string,
  tenantId: string,
): Promise<Membership | null> {
  const rows = await db.execute<Row>(
    sql`select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.membership_in_tenant(${userId}::uuid, ${tenantId}::uuid)`,
  );
  const row = rows[0];
  return row ? toMembership(row, 'membership_in_tenant', userId) : null;
}

/**
 * D-308 / D-06: every non-deleted membership of the caller, for a request whose host is NOT a tenant
 * host (localhost, Vercel Preview, the platform host, a missing header). Ordered by slug for display
 * only; which row the request uses is `pickGenericMembership`'s decision.
 */
export async function membershipsOfUser(userId: string): Promise<Membership[]> {
  const rows = await db.execute<Row>(
    sql`select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.memberships_of_user(${userId}::uuid)`,
  );
  return Array.from(rows, (row) => toMembership(row, 'memberships_of_user', userId));
}

/** The outcome of the generic-host rule; `requireAuth` maps every non-`selected` kind to a 403. */
export type GenericPick =
  | { kind: 'selected'; membership: Membership }
  | { kind: 'none' }
  | { kind: 'choice_required' }
  | { kind: 'all_blocked' };

/**
 * The generic-host choice rule (D-308, D-06), pure so `requireAuth` and the 08.1-03 picker agree by
 * construction. In order:
 *   1. a `choice` (the `x-tenant-choice` hint, trimmed and lower-cased, non-empty) equal to one of
 *      the caller's OWN rows selects it — a slug naming any other tenant is ignored, never an error;
 *   2. exactly one row selects it (today's single-tenant behaviour, whatever its status: requireAuth
 *      then answers that membership's own block/invite/suspension);
 *   3. no row is `none` (403 NO_MEMBERSHIP);
 *   4. exactly one row that is not blocked selects it;
 *   5. no row that is not blocked is `all_blocked` (403 MEMBERSHIP_BLOCKED, no details);
 *   6. otherwise `choice_required` (403 TENANT_CHOICE_REQUIRED, no details).
 */
export function pickGenericMembership(rows: Membership[], choice: string | null): GenericPick {
  const wanted = choice?.trim().toLowerCase() ?? '';
  if (wanted !== '') {
    const chosen = rows.find((row) => row.tenantSlug === wanted);
    if (chosen) return { kind: 'selected', membership: chosen };
  }
  const [only] = rows;
  if (rows.length === 1 && only) return { kind: 'selected', membership: only };
  if (rows.length === 0) return { kind: 'none' };
  const open = rows.filter((row) => row.status !== 'blocked');
  const [single] = open;
  if (open.length === 1 && single) return { kind: 'selected', membership: single };
  if (open.length === 0) return { kind: 'all_blocked' };
  return { kind: 'choice_required' };
}
