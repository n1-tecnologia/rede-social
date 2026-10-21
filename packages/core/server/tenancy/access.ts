import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/tenant-tx';

/**
 * 09.1-03 (D-495): the TypeScript doors over the access decision that lives in SQL. The rule exists in
 * exactly ONE place, `app.access_effective` (migration `*_access_gate_functions.sql`); nothing here
 * re-implements precedence or normalises an e-mail. Run these in the admin lane (`withAdminTx`): the
 * functions are executable by `api_user` and `service_role` only, and `access_grants` has zero policies.
 *
 * Callers are the two doors that CREATE a membership, `signupMember` and `joinTenant`. They ask the
 * tenant's switch first (`isAccessGateOn`) and only then the e-mail (`hasTenantAccess`), so a tenant
 * with the gate off never pays for, or is changed by, the access lookup (D-491).
 */

/** What `app.access_effective` answers: only `active` opens the door. */
export type TenantAccess = 'active' | 'inactive' | 'blocked' | 'none';

const TENANT_ACCESS: readonly string[] = ['active', 'inactive', 'blocked', 'none'];

const isTenantAccess = (value: unknown): value is TenantAccess =>
  typeof value === 'string' && TENANT_ACCESS.includes(value);

/** Is the tenant's payment gate on? Only an enabled `payments` row with `settings.gate = true` reads on. */
export async function isAccessGateOn(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.execute<{ on: boolean }>(
    sql`select app.access_gate_on(${tenantId}::uuid) as on`,
  );
  return rows[0]?.on === true;
}

/**
 * The effective access of `email` in `tenantId`. The e-mail is normalised by `lower(btrim())` INSIDE the
 * SQL function, on the same terms as the table CHECK and the auth hooks (JavaScript lowercasing differs
 * for some non-ASCII input; plus-addressing is intentionally not folded). A value outside the four
 * states is a broken invariant, never a silently-open door.
 */
export async function hasTenantAccess(
  tx: Tx,
  tenantId: string,
  email: string,
): Promise<TenantAccess> {
  const rows = await tx.execute<{ state: string }>(
    sql`select app.access_effective(${tenantId}::uuid, ${email}) as state`,
  );
  const state = rows[0]?.state;
  if (!isTenantAccess(state)) {
    throw new Error(`app.access_effective answered an unknown state: ${String(state)}`);
  }
  return state;
}

/**
 * 09.1-04 (D-492): the ONE function that writes a manual `active` access on behalf of an invite or an
 * accept, idempotently: `insert … on conflict (tenant_id, email, status) where source = 'manual' do
 * nothing`, so `access_grants_manual_uq` is the arbiter of a retry, a replay and a race. Returns true
 * when a row was inserted, false when the release already existed.
 *
 * Callers, all in the CALLER's transaction (the grant commits or rolls back with the rest):
 *   - invite creation (`createPendingInvite`): the row exists before the send, because GoTrue's
 *     `before_user_created` hook fires at SEND time, long before the accept (assumption A-P3);
 *   - `acceptInvite`: re-asserts it, so an invite created before this phase (no row) is still granted;
 *   - plan 09's release action.
 *
 * The e-mail is normalised in SQL (`lower(btrim())`), on the same terms as the table CHECK and every
 * reader. The helper only ever inserts an `active` row: it never reads or touches a `blocked` row, so
 * a manual block keeps outranking the release (D-489). Run it in the admin lane (`withAdminTx`).
 */
export async function grantManualAccess(
  tx: Tx,
  input: { tenantId: string; email: string; createdBy: string | null },
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    insert into public.access_grants (tenant_id, email, source, status, created_by_user_id)
    values (${input.tenantId}::uuid, lower(btrim(${input.email})), 'manual', 'active',
            ${input.createdBy}::uuid)
    on conflict (tenant_id, email, status) where source = 'manual' do nothing
    returning id`);
  return rows.length > 0;
}

/** The e-mail of a signed-in identity, from the `public.users` mirror (never from a request body). */
export async function emailOfUser(tx: Tx, userId: string): Promise<string | null> {
  const rows = await tx.execute<{ email: string | null }>(
    sql`select email from public.users where id = ${userId}::uuid`,
  );
  return rows[0]?.email ?? null;
}

/**
 * 09.1-10 (D-493, D-497, D-502, UI-D-532): THE reader of the tenant's checkout link, the only one the
 * subscription endpoint, the public tenant record and the join state call. `null` unless the tenant's gate
 * is ON (which already requires the `payments` module to be enabled); otherwise the stored `https:` link of
 * the OLDEST access product that has one (`order by created_at, id`), the same product the admin's
 * "Usado no botão Assinar" marker names. The table CHECK and the contract guarantee the shape; nothing
 * here reads a query string, a cookie or a header. Run it in the admin lane with an explicit tenant.
 */
export async function accessCheckoutUrl(tx: Tx, tenantId: string): Promise<string | null> {
  if (!(await isAccessGateOn(tx, tenantId))) return null;
  const rows = await tx.execute<{ checkout_url: string }>(sql`
    select checkout_url
      from public.payment_products
     where tenant_id = ${tenantId}::uuid
       and kind = 'access'
       and checkout_url is not null
     order by created_at, id
     limit 1`);
  return rows[0]?.checkout_url ?? null;
}
