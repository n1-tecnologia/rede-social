import type { GatePreview, GateResult } from '@rede-social/contracts/payments';
import { and, eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantModules } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import type { RequestContext } from '../auth/context';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { moduleFlags } from '../modules/flags-cache';

/**
 * The gate switch and the release of the members who already exist (09.1-09, D-491, D-492, PAY-08,
 * PAY-31). The switch is `tenant_modules.settings.gate` of the `payments` row: the table has no
 * tenant-lane write policy, so the write is an explicit-predicate ADMIN-lane statement here, in the
 * kernel, where the Biome lane rule can see it. The tenant comes ONLY from `ctx.tenantId`.
 *
 * The decision of who a gate lets in lives in ONE place, `app.access_effective` (plan 02). The preview
 * and the release below both ask it; neither re-implements the precedence.
 */

const log = moduleLogger('payments-gate');

type Rows<T> = T[];
const rowsOf = <T>(result: unknown): Rows<T> => result as Rows<T>;

/** The kernel setup lock: gate writes and access-product removals of ONE tenant never interleave (T-09.1-43). */
export const setupLock = (tenantId: string) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${`payments:setup:${tenantId}`}, 0))`;

/**
 * Whether the tenant's gate is stored ON: the module row is enabled and `settings.gate` is the jsonb
 * boolean `true` (the same rule as `app.access_gate_on`, which the tenant lane may not execute). A stored
 * switch of a disabled module reads as off.
 */
export async function readGate(tx: Tx, tenantId: string): Promise<boolean> {
  const [row] = await tx
    .select({
      on: sql<boolean>`${tenantModules.enabled} and ${tenantModules.settings} -> 'gate' = 'true'::jsonb`,
    })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, 'payments')));
  return row?.on === true;
}

/**
 * The members a release would admit: the live `member`-role memberships of the tenant (active, not
 * blocked, not deleted) whose effective access is `none` or `inactive`. Staff never need a release
 * (D-492) and an e-mail under a manual block is `blocked`, which outranks (D-489), so neither is
 * counted. ONE predicate shared by the count and the insert, so the preview and the release agree.
 */
const releasable = (tenantId: string) => sql`
  from public.memberships m
  join public.users u on u.id = m.user_id
 where m.tenant_id = ${tenantId}::uuid
   and m.role = 'member'
   and m.status = 'active'
   and m.blocked_at is null
   and m.deleted_at is null
   and app.access_effective(${tenantId}::uuid, u.email) in ('none', 'inactive')`;

/** `GET /v1/payments/gate/preview` (PAY-31): an exact integer produced by the database, nothing estimated. */
export async function previewGate(ctx: RequestContext): Promise<GatePreview> {
  return withAdminTx(async (tx) => {
    const [row] = rowsOf<{ count: number }>(
      await tx.execute(sql`select count(*)::int as count ${releasable(ctx.tenantId)}`),
    );
    return { count: row?.count ?? 0 };
  });
}

/**
 * `PUT /v1/payments/gate`. ONE admin transaction:
 *  1. the setup lock, then the module row `for update` (a missing or disabled row is `404 MODULE_DISABLED`),
 *     so two concurrent writes leave the last committed value and lose no released row;
 *  2. turning ON needs a saved integration AND at least one access product (`409 gate_requires_setup`);
 *     turning OFF is always allowed;
 *  3. `releaseExisting` inserts ONE manual `active` row per releasable member in a single set-based
 *     statement (never a loop per member), `on conflict … do nothing returning`, and `released` is the
 *     number of rows that statement actually created, not the preview;
 *  4. `settings = settings || {"gate": <bool>}` merges the one key, so nothing else the module stores is
 *     lost and the platform toggle (an upsert of `enabled` alone) never touches it.
 * All or nothing: a failure changes neither the switch nor any access.
 */
export async function setGate(
  ctx: RequestContext,
  body: { required: boolean; releaseExisting?: boolean | undefined },
): Promise<GateResult> {
  const tenantId = ctx.tenantId;
  const result = await withAdminTx(async (tx): Promise<GateResult> => {
    await tx.execute(setupLock(tenantId));
    const [row] = await tx
      .select({ enabled: tenantModules.enabled })
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, 'payments')))
      .for('update');
    if (!row?.enabled) throw new ApiError(404, 'MODULE_DISABLED');

    let released = 0;
    if (body.required) {
      const [ready] = rowsOf<{ ok: boolean }>(
        await tx.execute(sql`
          select exists (select 1 from public.payment_integrations where tenant_id = ${tenantId}::uuid)
             and exists (select 1 from public.payment_products
                          where tenant_id = ${tenantId}::uuid and kind = 'access') as ok`),
      );
      if (!ready?.ok) throw new ApiError(409, 'CONFLICT', { payments: 'gate_requires_setup' });

      if (body.releaseExisting === true) {
        const created = rowsOf<{ id: string }>(
          await tx.execute(sql`
            insert into public.access_grants (tenant_id, email, source, status, created_by_user_id)
            select m.tenant_id, lower(btrim(u.email)), 'manual', 'active', ${ctx.userId}::uuid
            ${releasable(tenantId)}
            on conflict (tenant_id, email, status) where source = 'manual' do nothing
            returning id`),
        );
        released = created.length;
      }
    }

    await tx.execute(sql`
      update public.tenant_modules
         set settings = settings || jsonb_build_object('gate', ${body.required}::boolean),
             updated_at = now()
       where tenant_id = ${tenantId}::uuid and module_key = 'payments'`);
    return { required: body.required, released };
  });

  moduleFlags.invalidate(tenantId);
  log.info(
    {
      event: 'payments.gate.set',
      tenantId,
      userId: ctx.userId,
      required: result.required,
      released: result.released,
    },
    'payments gate set',
  );
  return result;
}
