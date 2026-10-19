import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { type SQL, sql } from 'drizzle-orm';
import {
  type EngagementBandId,
  FINANCE_BUYERS_PAGE_SIZE,
  type FinanceBuyerListId,
  type OwnerFinanceBuyerRow,
  type OwnerFinanceBuyersAnswer,
  type OwnerFinanceBuyersQuery,
} from '../contracts/index';
import { financeFlags, liveCommunityName, liveProducts, readFinanceFrame } from './finance';
import { ISO_US } from './member-lists';
import { type CursorKind, NEVER_ACTIVE, pageInput, pageOf } from './paging';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;

/**
 * The named buyers behind Financeiro's numbers (08.7-09, D-461, D-462, T-08.7-21, EP-39): read
 * LIVE in the admin's lane, bounded by the newest snapshot (`from30At` / `untilAt`, never `now()`),
 * with the builder's own predicates so a list agrees with its number — the orders of active role
 * members, paid before `untilAt` and not revoked before it, each member's first paid order (by
 * `paid_at, id`) primary. Named lists are not floored: they are readable by the tenant's
 * `admin_tenant` only (the route's role gate; the snapshot's admin-only RLS behind it) and never
 * stored in a snapshot by name.
 *
 * The lists and their own key (id desc as the tie-break everywhere, EP-39):
 * - `band` (`?band=`): Window30 buyers of today's band, their Window30 orders, last purchase first;
 * - `never` (`?band=`): the band's members with exactly one paid order, most recent first;
 * - `primary`: members whose first paid order is in Window30, most recent first;
 * - `secondary`: members with secondary orders in Window30, their latest one first;
 * - `rebought`: members with two or more paid orders, the second purchase most recent first;
 * - `time-to-second`: the same members, fewest days from the first to the second first;
 * - `lifetime`: every buyer, most cents first;
 * - `vip-fading`: the VIP community's holders `at_risk` / `inactive` today (UI-D-490), the most
 *   recently active first (empty with no VIP, `communities` off, or a VIP community no longer live,
 *   as the area's card);
 * - `product` (`?productId=`): the product's Window30 buyers, most recent purchase first.
 * There is no `expiring` and no `offer` list (D-465, no offer table).
 *
 * Paging: plan 04's helper (`limit` 1..50, 20 by default; a malformed cursor reads page 1).
 */

/** The cursor each list's order needs. */
function cursorKindOf(list: FinanceBuyerListId): CursorKind {
  if (list === 'lifetime' || list === 'time-to-second') return 'integer';
  if (list === 'vip-fading') return 'last-active';
  return 'instant';
}

type Window = { tenantId: string; from30: SQL; until: SQL };

/** Which members a list holds, and its `at`, `orders` and `cents` (`m`, `pm`, `r` in scope). */
function listShape(
  list: FinanceBuyerListId,
  w: Window,
  band: EngagementBandId | null,
  vipCommunityId: string | null,
): { include: SQL; at: SQL; orders: SQL; cents: SQL } {
  switch (list) {
    case 'band':
      return {
        include: sql`pm.n_win > 0 and r.band = ${band}`,
        at: sql`pm.last_win`,
        orders: sql`pm.n_win`,
        cents: sql`pm.cents_win`,
      };
    case 'never':
      return {
        include: sql`pm.n_all = 1 and r.band = ${band}`,
        at: sql`pm.last_all`,
        orders: sql`pm.n_all`,
        cents: sql`pm.cents_all`,
      };
    case 'primary':
      return {
        include: sql`pm.first_at >= ${w.from30}`,
        at: sql`pm.first_at`,
        orders: sql`1`,
        cents: sql`pm.first_cents`,
      };
    case 'secondary':
      return {
        include: sql`pm.n_sec > 0`,
        at: sql`pm.last_sec`,
        orders: sql`pm.n_sec`,
        cents: sql`pm.cents_sec`,
      };
    case 'rebought':
    case 'time-to-second':
      return {
        include: sql`pm.n_all >= 2`,
        at: sql`pm.second_at`,
        orders: sql`pm.n_all`,
        cents: sql`pm.cents_all`,
      };
    case 'lifetime':
      return {
        include: sql`pm.n_all >= 1`,
        at: sql`pm.last_all`,
        orders: sql`pm.n_all`,
        cents: sql`pm.cents_all`,
      };
    case 'vip-fading':
      return {
        // The builder's holder rule: an entitlement to a product linked to the VIP community,
        // created before untilAt and not revoked before it (the 08.2 access rule).
        include: sql`r.band in ('at_risk', 'inactive') and exists (
          select 1
            from public.store_product_communities l
            join public.store_entitlements e
              on e.tenant_id = l.tenant_id and e.product_id = l.product_id
           where l.tenant_id = ${w.tenantId}::uuid
             and l.community_id = ${vipCommunityId}::uuid
             and e.user_id = m.user_id
             and e.created_at < ${w.until}
             and (e.status = 'active' or coalesce(e.revoked_at >= ${w.until}, false)))`,
        at: sql`r.last_active_at`,
        orders: sql`coalesce(pm.n_all, 0)`,
        cents: sql`coalesce(pm.cents_all, 0)`,
      };
    case 'product':
      return {
        include: sql`pm.n_prod > 0`,
        at: sql`pm.last_prod`,
        orders: sql`pm.n_prod`,
        cents: sql`pm.cents_prod`,
      };
  }
}

/** EP-39: each list's order, and the keyset predicate of a cursor on it. */
function listOrder(
  list: FinanceBuyerListId,
  after: { n: string; id: string } | null,
): { orderBy: SQL; past: SQL } {
  if (list === 'lifetime') {
    return {
      orderBy: sql`l.cents desc, l.membership_id desc`,
      past: after
        ? sql`(l.cents, l.membership_id) < (${after.n}::bigint, ${after.id}::uuid)`
        : sql`true`,
    };
  }
  if (list === 'time-to-second') {
    return {
      orderBy: sql`l.second_after_days asc, l.membership_id desc`,
      // `bigint`, as `lifetime`: the cursor's integer may hold up to 15 digits (paging's INTEGER),
      // and an `::int` cast of one above 2^31-1 raised `integer out of range` → 500 (WR-07).
      past: after
        ? sql`(l.second_after_days > ${after.n}::bigint
               or (l.second_after_days = ${after.n}::bigint and l.membership_id < ${after.id}::uuid))`
        : sql`true`,
    };
  }
  if (list === 'vip-fading') {
    const n = after ? (after.n === NEVER_ACTIVE ? '-infinity' : after.n) : null;
    return {
      orderBy: sql`coalesce(l.at, '-infinity'::timestamptz) desc, l.membership_id desc`,
      past: after
        ? sql`(coalesce(l.at, '-infinity'::timestamptz), l.membership_id)
               < (${n}::timestamptz, ${after.id}::uuid)`
        : sql`true`,
    };
  }
  return {
    orderBy: sql`l.at desc, l.membership_id desc`,
    past: after
      ? sql`(l.at, l.membership_id) < (${after.n}::timestamptz, ${after.id}::uuid)`
      : sql`true`,
  };
}

type BuyerDb = {
  membership_id: string;
  display_name: string;
  avatar_asset_id: string | null;
  band: EngagementBandId | null;
  at: string | null;
  orders: number;
  cents: string;
  second_after_days: number | null;
};

const missing = (path: string) =>
  new ApiError(400, 'VALIDATION_FAILED', {
    issues: [{ path, message: `${path} is required for this list` }],
  });

/**
 * `GET /v1/dashboard/owner/finance/buyers/{list}`: one page of a buyers list of the newest
 * snapshot (see the header). `band` and `never` need `?band=`, `product` needs `?productId=` (400
 * `VALIDATION_FAILED` without it); a product id that is not the tenant's is the bare 404 in every
 * state. No snapshot → `preparing`.
 */
export async function listOwnerFinanceBuyers(
  ctx: Ctx,
  list: FinanceBuyerListId,
  input: OwnerFinanceBuyersQuery,
): Promise<OwnerFinanceBuyersAnswer> {
  const band = list === 'band' || list === 'never' ? (input.band ?? null) : null;
  if ((list === 'band' || list === 'never') && band === null) throw missing('band');
  const productId = list === 'product' ? (input.productId ?? null) : null;
  if (list === 'product' && productId === null) throw missing('productId');
  const flags = await financeFlags(ctx);
  const { limit, after } = pageInput(input, FINANCE_BUYERS_PAGE_SIZE, cursorKindOf(list));

  return withTenantTx(ctx, async (tx): Promise<OwnerFinanceBuyersAnswer> => {
    if (productId !== null) {
      const known = await liveProducts(tx, ctx.tenantId, [productId]);
      if (!known.has(productId)) throw new ApiError(404, 'NOT_FOUND');
    }
    const frame = await readFinanceFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const base = {
      state: 'ready' as const,
      snapshot: frame.snapshot,
      list,
      ...(band !== null ? { band } : {}),
      ...(productId !== null ? { productId } : {}),
    };
    let vipCommunityId = flags.communities ? (frame.finance.vip?.communityId ?? null) : null;
    // WR-09: the same live check as the area's VIP card (`getOwnerFinance`): a community deleted or
    // archived since the build has no card, so its list names no one either.
    if (
      list === 'vip-fading' &&
      vipCommunityId !== null &&
      (await liveCommunityName(tx, ctx.tenantId, vipCommunityId)) === null
    ) {
      vipCommunityId = null;
    }
    if (list === 'vip-fading' && vipCommunityId === null) {
      return { ...base, total: 0, rows: [], nextCursor: null };
    }

    const w: Window = {
      tenantId: ctx.tenantId,
      from30: sql`${frame.snapshot.windows.from30At}::timestamptz`,
      until: sql`${frame.snapshot.windows.untilAt}::timestamptz`,
    };
    const shape = listShape(list, w, band, vipCommunityId);
    const order = listOrder(list, after);
    const inProduct = productId !== null ? sql`o.product_id = ${productId}::uuid` : sql`false`;

    const cte = sql`
      with tz as (
        select t.timezone as tz from public.tenants t where t.id = ${ctx.tenantId}::uuid
      ),
      m as (
        select ms.id, ms.user_id
          from public.memberships ms
         where ms.tenant_id = ${ctx.tenantId}::uuid
           and ms.role = 'member'
           and ms.status = 'active'
           and ms.blocked_at is null
           and ms.deleted_at is null
      ),
      o as (
        select so.id, so.product_id, so.amount_cents as cents, so.paid_at, m.id as membership_id,
               row_number() over (partition by m.id order by so.paid_at, so.id) as rn
          from public.store_orders so
          join m on m.user_id = so.user_id
         where so.tenant_id = ${ctx.tenantId}::uuid
           and so.paid_at is not null
           and so.paid_at < ${w.until}
           and (so.status = 'paid'
                or (so.status = 'revoked' and coalesce(so.revoked_at >= ${w.until}, false)))
      ),
      pm as (
        select o.membership_id,
               count(*) as n_all,
               sum(o.cents) as cents_all,
               max(o.paid_at) as last_all,
               count(*) filter (where o.paid_at >= ${w.from30}) as n_win,
               coalesce(sum(o.cents) filter (where o.paid_at >= ${w.from30}), 0) as cents_win,
               max(o.paid_at) filter (where o.paid_at >= ${w.from30}) as last_win,
               max(o.paid_at) filter (where o.rn = 1) as first_at,
               max(o.cents) filter (where o.rn = 1) as first_cents,
               max(o.paid_at) filter (where o.rn = 2) as second_at,
               count(*) filter (where o.paid_at >= ${w.from30} and o.rn > 1) as n_sec,
               coalesce(sum(o.cents) filter (where o.paid_at >= ${w.from30} and o.rn > 1), 0)
                 as cents_sec,
               max(o.paid_at) filter (where o.paid_at >= ${w.from30} and o.rn > 1) as last_sec,
               count(*) filter (where o.paid_at >= ${w.from30} and ${inProduct}) as n_prod,
               coalesce(sum(o.cents) filter (where o.paid_at >= ${w.from30} and ${inProduct}), 0)
                 as cents_prod,
               max(o.paid_at) filter (where o.paid_at >= ${w.from30} and ${inProduct}) as last_prod
          from o
         group by o.membership_id
      ),
      l as (
        select m.id as membership_id, r.band,
               ${shape.at} as at,
               ${shape.orders} as orders,
               ${shape.cents} as cents,
               case when pm.second_at is not null
                    then (pm.second_at at time zone tz.tz)::date - (pm.first_at at time zone tz.tz)::date
               end as second_after_days
          from m
          cross join tz
          left join pm on pm.membership_id = m.id
          left join public.dashboard_member_snapshots r
            on r.tenant_id = ${ctx.tenantId}::uuid and r.membership_id = m.id
         where ${shape.include}
      )`;
    const rows = await tx.execute<BuyerDb>(sql`
      ${cte}
      select l.membership_id::text as membership_id,
             coalesce(mp.display_name, '') as display_name,
             mp.avatar_asset_id::text as avatar_asset_id,
             l.band,
             to_char(l.at at time zone 'UTC', ${ISO_US}) as at,
             l.orders::int as orders,
             l.cents::bigint::text as cents,
             l.second_after_days::int as second_after_days
        from l
        left join public.member_profiles mp
          on mp.tenant_id = ${ctx.tenantId}::uuid and mp.membership_id = l.membership_id
       where ${order.past}
       order by ${order.orderBy}
       limit ${limit + 1}`);
    const [counted] = await tx.execute<{ total: number }>(sql`
      ${cte}
      select count(*)::int as total from l`);

    const page = pageOf(rows, limit, (row) => ({
      n:
        list === 'lifetime'
          ? row.cents
          : list === 'time-to-second'
            ? String(row.second_after_days ?? 0)
            : (row.at ?? NEVER_ACTIVE),
      id: row.membership_id,
    }));
    return {
      ...base,
      total: Number(counted?.total ?? 0),
      rows: page.rows.map(
        (row): OwnerFinanceBuyerRow => ({
          membershipId: row.membership_id,
          displayName: row.display_name,
          avatarAssetId: row.avatar_asset_id,
          band: row.band,
          at: row.at,
          orders: Number(row.orders),
          cents: Number(row.cents),
          secondAfterDays: row.second_after_days === null ? null : Number(row.second_after_days),
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });
}
