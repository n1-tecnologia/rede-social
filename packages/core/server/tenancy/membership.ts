import { TENANT_ROLES, type TenantRole } from '@rede-social/contracts';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

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
 * Reads the membership row for a user on EVERY request — never cached — so a block takes effect on the
 * very next request (D-09). Runs `app.membership_for_user()` (security definer) on the bare `api_user`
 * connection: the role may execute that function without opening a lane.
 *
 * The function is the single source of truth for the lifecycle columns (WR-08): a membership with
 * `deleted_at` set yields NO row (-> `NO_MEMBERSHIP`), and one with `blocked_at` set is reported with
 * `status = 'blocked'` whatever the `status` column says, so `requireAuth`'s status check fires.
 * Nothing here needs to know about those columns — do not re-implement the rule in TypeScript.
 */
export async function membershipForUser(userId: string): Promise<Membership | null> {
  const rows = await db.execute<Row>(
    sql`select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.membership_for_user(${userId}::uuid)`,
  );
  const row = rows[0];
  if (!row) return null;
  if (!isTenantRole(row.role) || !isStatus(row.status)) {
    throw new Error(`membership_for_user returned an unexpected role/status for user ${userId}`);
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
