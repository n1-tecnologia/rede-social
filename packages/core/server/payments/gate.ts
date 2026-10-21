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
 * and the release below both ask it; neither re-implements the precedence. `none` is releasable,
 * `inactive` stays cut and is only counted, `blocked` outranks, staff are never in the set (09.1-21,
 * G-09.1-1).
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
 * The live members of the tenant and the state the database gives them: the `member`-role memberships
 * (active, not blocked, not deleted), each with its effective access `eff` from `app.access_effective`
 * (never re-implemented here). Staff never need a release (D-492) and are not in the set; an e-mail under
 * a manual block is `blocked`, which outranks (D-489). ONE fragment shared by the tally and the release
 * insert, so the preview, the release and the result read the same population. The tenant is bound only
 * from `tenantId`.
 */
const liveMembers = (tenantId: string) => sql`
  select m.tenant_id,
         lower(btrim(u.email)) as email,
         app.access_effective(m.tenant_id, u.email) as eff
    from public.memberships m
    join public.users u on u.id = m.user_id
   where m.tenant_id = ${tenantId}::uuid
     and m.role = 'member'
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null`;

/**
 * ONE statement, ONE population: `releasable` is the live members whose effective access is `none` (the
 * members a release would admit) and `gatewayCut` those whose state is `inactive` (cut by the gateway,
 * which outranks a manual release, so a release does not change them). Exact integers from
 * `count(*) filter`, never a JavaScript sum or a list length.
 */
async function tallyMembers(
  tx: Tx,
  tenantId: string,
): Promise<{ releasable: number; gatewayCut: number }> {
  const [row] = rowsOf<{ releasable: number; gateway_cut: number }>(
    await tx.execute(sql`
      select count(*) filter (where l.eff = 'none')::int as releasable,
             count(*) filter (where l.eff = 'inactive')::int as gateway_cut
        from (${liveMembers(tenantId)}) l`),
  );
  return { releasable: row?.releasable ?? 0, gatewayCut: row?.gateway_cut ?? 0 };
}

/**
 * `GET /v1/payments/gate/preview` (PAY-31): two exact integers produced by the database, nothing
 * estimated. `count` is the members a release would admit (effective access `none`); `gatewayCut` is the
 * members the gateway has cut (effective `inactive`), who stay cut after a release (D-489). Staff and
 * blocked e-mails are in neither number.
 */
export async function previewGate(ctx: RequestContext): Promise<GatePreview> {
  return withAdminTx(async (tx) => {
    const { releasable, gatewayCut } = await tallyMembers(tx, ctx.tenantId);
    return { count: releasable, gatewayCut };
  });
}

/**
 * `PUT /v1/payments/gate`. ONE admin transaction:
 *  1. the setup lock, then the module row `for update` (a missing or disabled row is `404 MODULE_DISABLED`),
 *     so two concurrent writes leave the last committed value and lose no released row;
 *  2. turning ON needs a saved integration AND at least one access product (`409 gate_requires_setup`);
 *     turning OFF is always allowed;
 *  3. `releaseExisting` inserts ONE manual `active` row per `none` member in a single set-based
 *     statement (never a loop per member), `on conflict … do nothing returning`, and `released` is the
 *     number of rows that statement actually created, not the preview. A member the gateway has cut
 *     (`inactive`) gets no row: D-489 ranks the cut above a manual release, so a row would be dead data;
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
            select l.tenant_id, l.email, 'manual', 'active', ${ctx.userId}::uuid
              from (${liveMembers(tenantId)}) l
             where l.eff = 'none'
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
