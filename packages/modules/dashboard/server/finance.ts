import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { sql } from 'drizzle-orm';
import {
  ENGAGEMENT_BAND_ORDER,
  FINANCE_PATH_FLOOR,
  type FinanceContentSalesAnswer,
  type FinanceEventSalesAnswer,
  type FinanceLadderAnswer,
  type FinancePayload,
  type FinanceTotals,
  type FlooredCount,
  type FlooredMoney,
  type FlooredMoneyBandGroup,
  financePayloadSchema,
  mergeBandsBelowFloor,
  type OwnerFinanceAnswer,
  type OwnerFinanceProductAnswer,
  type OwnerFinanceProductReady,
  type OwnerFinanceProductSummary,
  type OwnerFinanceReady,
  type SnapshotMeta,
} from '../contracts/index';
import { floorCount, sortFloored } from './floor';
import { readLatestSnapshot, snapshotMetaOf } from './snapshot';

type Ctx = Pick<RequestContext, 'userId' | 'tenantId' | 'role'>;
type Band = (typeof ENGAGEMENT_BAND_ORDER)[number];

/** D-455 / D-465: what Financeiro cannot measure yet. */
const NOT_MEASURED = {
  offers: { measured: false, reason: 'needs_offers' },
  paidEvents: { measured: false, reason: 'needs_event_tickets' },
  expiring: { measured: false, reason: 'needs_access_expiry' },
  fullEvents: { measured: false, reason: 'needs_waitlist' },
} as const;

// ── the floor (planning decision 2: one pure pass) ─────────────────────────────────────────────

/**
 * A money group through the floor (D-462, UI-D-470): no buyer → the value 0; 1-4 buyers →
 * `{ belowFloor: true }` with no number at all; 5 and more → orders, cents and buyers together.
 * The floor is on the PEOPLE behind the group (a buyer count of 1-4 identifies them, whatever the
 * number of orders), and orders ≥ buyers, so a group of 1-4 orders is floored too.
 */
export function floorMoney(totals: FinanceTotals): FlooredMoney {
  const shown = floorCount(totals.buyers);
  if (shown.belowFloor) return { belowFloor: true };
  return { belowFloor: false, orders: totals.orders, cents: totals.cents, buyers: totals.buyers };
}

/** Shown money groups first (most orders first), floored ones after: the client's order stays true. */
function moneyRank(sales: FlooredMoney): FlooredCount {
  return sales.belowFloor ? { belowFloor: true } : { belowFloor: false, value: sales.orders };
}

/**
 * A product's buyers by band (UI-D-470): bands under the floor merged with a neighbour by the ONE
 * `mergeBandsBelowFloor` (on buyers), each group's orders, cents and buyers summed and floored. No
 * buyer at all → no group.
 */
function floorMoneyBands(byBand: Readonly<Record<Band, FinanceTotals>>): FlooredMoneyBandGroup[] {
  const counts = Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [band, byBand[band].buyers]),
  ) as Record<Band, number>;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  const groups = mergeBandsBelowFloor({ counts }).map((group) => {
    const sum = group.bands.reduce(
      (acc, band) => ({
        orders: acc.orders + byBand[band].orders,
        cents: acc.cents + byBand[band].cents,
        buyers: acc.buyers + byBand[band].buyers,
      }),
      { orders: 0, cents: 0, buyers: 0 },
    );
    return { bands: [...group.bands], sales: floorMoney(sum) };
  });
  return sortFloored(groups, (group) => moneyRank(group.sales));
}

/** One decimal, as the builder rounds its averages. */
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * The ladder through the floor: paths of 5 or more people, most people first (then the product
 * ids); the smaller ones summed into "outros caminhos", floored when that sum is still under 5
 * (its average days is derived from those people, so it goes with them).
 */
function floorLadder(ladder: FinancePayload['ladder']): FinanceLadderAnswer {
  const order = (a: (typeof ladder)[number], b: (typeof ladder)[number]) =>
    b.people - a.people ||
    a.entryProductId.localeCompare(b.entryProductId) ||
    a.nextProductId.localeCompare(b.nextProductId);
  const paths = ladder.filter((path) => path.people >= FINANCE_PATH_FLOOR).sort(order);
  const small = ladder.filter((path) => path.people > 0 && path.people < FINANCE_PATH_FLOOR);
  if (small.length === 0) return { paths, others: null };
  const people = small.reduce((sum, path) => sum + path.people, 0);
  if (floorCount(people).belowFloor) {
    return { paths, others: { belowFloor: true, paths: small.length } };
  }
  const weighted = small.reduce((sum, path) => sum + path.averageDays * path.people, 0);
  return {
    paths,
    others: {
      belowFloor: false,
      people,
      paths: small.length,
      averageDays: oneDecimal(weighted / people),
    },
  };
}

/** The floored parts of one finance payload, keyed for the area answer and the product detail. */
export type FlooredFinance = {
  revoked: { current: FlooredMoney; previous: FlooredMoney };
  byBand: Record<Band, FlooredMoney>;
  ladder: FinanceLadderAnswer;
  neverAgain: Record<Band, FlooredCount>;
  contentSales: FinanceContentSalesAnswer;
  eventSales: Omit<FinanceEventSalesAnswer, 'events'> & {
    events: { eventId: string; sales: FlooredMoney }[];
  };
  products: Record<string, { revoked: FlooredMoney; byBand: FlooredMoneyBandGroup[] }>;
};

/**
 * `applyFinanceFloor` (08.7-09, D-462, INSIGHT-14, planning decision 2): ONE pure pass over every
 * group of the floor truth, between the parsed payload and `c.json`, so a new block cannot forget
 * it — by band, revoked, per ladder path ("outros caminhos"), never-again, per post and per event
 * association (and each post's products, and the totals), a product's revoked orders and its
 * buyers by band (merged). Totals, primary / secondary and per-product numbers are not floored
 * (the admin's own business totals; a product's buyers have their own named screen, D-461).
 */
export function applyFinanceFloor(payload: FinancePayload): FlooredFinance {
  const byBand = Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [band, floorMoney(payload.byBand[band])]),
  ) as Record<Band, FlooredMoney>;
  const neverAgain = Object.fromEntries(
    ENGAGEMENT_BAND_ORDER.map((band) => [band, floorCount(payload.neverAgain[band])]),
  ) as Record<Band, FlooredCount>;
  const posts = sortFloored(
    payload.contentSales.posts.map((post) => ({
      postId: post.postId,
      sales: floorMoney(post),
      products: sortFloored(
        post.products.map((product) => ({
          productId: product.productId,
          sales: floorMoney(product),
        })),
        (row) => moneyRank(row.sales),
      ),
    })),
    (row) => moneyRank(row.sales),
  );
  const events = sortFloored(
    payload.eventSales.events.map((event) => ({
      eventId: event.eventId,
      sales: floorMoney(event),
    })),
    (row) => moneyRank(row.sales),
  );
  const products = Object.fromEntries(
    payload.byProduct.map((product) => [
      product.productId,
      { revoked: floorMoney(product.revoked), byBand: floorMoneyBands(product.byBand) },
    ]),
  );
  return {
    revoked: {
      current: floorMoney(payload.revoked.current),
      previous: floorMoney(payload.revoked.previous),
    },
    byBand,
    ladder: floorLadder(payload.ladder),
    neverAgain,
    contentSales: { posts, total: floorMoney(payload.contentSales.total) },
    eventSales: { events, total: floorMoney(payload.eventSales.total) },
    products,
  };
}

// ── reading the snapshot ───────────────────────────────────────────────────────────────────────

/** The module flags Financeiro reads (the store is the route's gate), before the lane opens. */
export type FinanceFlags = { communities: boolean; feed: boolean; events: boolean };

export async function financeFlags(ctx: Ctx): Promise<FinanceFlags> {
  const { keys } = await moduleFlags.flags(ctx);
  return {
    communities: keys.has('communities'),
    feed: keys.has('feed'),
    events: keys.has('events'),
  };
}

/** The newest build as Financeiro reads it: its meta and its parsed `finance` key. */
export type FinanceFrame = { snapshot: SnapshotMeta; finance: FinancePayload };

/**
 * The tenant's newest snapshot read in the admin's lane (its admin-only policy applies), or `null`
 * when there is none yet or its windows / `finance` key fail their contracts (an older payload
 * version): the caller answers `preparing`, never zeros (R-Pitfall 3).
 */
export async function readFinanceFrame(tx: Tx, tenantId: string): Promise<FinanceFrame | null> {
  const row = await readLatestSnapshot(tx, tenantId);
  if (!row) return null;
  const snapshot = snapshotMetaOf(row);
  const parsed = financePayloadSchema.safeParse(
    ((row.payload ?? {}) as Record<string, unknown>).finance,
  );
  return snapshot && parsed.success ? { snapshot, finance: parsed.data } : null;
}

/** `{a,b,c}`: a Postgres array literal of ids the contract already validated as uuids. */
function uuidArray(ids: readonly string[]): string {
  return `{${[...new Set(ids)].join(',')}}`;
}

export type ProductLabel = { name: string; priceCents: number; status: 'active' | 'archived' };

/** The live name, price and status of the given products of `tenantId` (explicit predicate). */
export async function liveProducts(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, ProductLabel>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{
    id: string;
    name: string;
    price_cents: number;
    status: 'active' | 'archived';
  }>(sql`
    select p.id::text as id, p.name, p.price_cents, p.status
      from public.store_products p
     where p.id = any (${uuidArray(ids)}::uuid[])
       and p.tenant_id = ${tenantId}::uuid`);
  return new Map(
    rows.map((row) => [
      row.id,
      { name: row.name, priceCents: Number(row.price_cents), status: row.status },
    ]),
  );
}

/** The ids of the given posts that are still live in `tenantId`. */
async function livePostIds(tx: Tx, tenantId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`
    select p.id::text as id from public.feed_posts p
     where p.id = any (${uuidArray(ids)}::uuid[])
       and p.tenant_id = ${tenantId}::uuid
       and p.deleted_at is null`);
  return new Set(rows.map((row) => row.id));
}

/** The live titles of the given active, non-deleted events of `tenantId`. */
async function liveEventTitles(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; title: string }>(sql`
    select e.id::text as id, e.title from public.events e
     where e.id = any (${uuidArray(ids)}::uuid[])
       and e.tenant_id = ${tenantId}::uuid
       and e.status = 'active'
       and e.deleted_at is null`);
  return new Map(rows.map((row) => [row.id, row.title]));
}

/** The live name of an active, non-deleted community of `tenantId`, or null. */
async function liveCommunityName(
  tx: Tx,
  tenantId: string,
  communityId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ name: string }>(sql`
    select c.name from public.communities c
     where c.id = ${communityId}::uuid
       and c.tenant_id = ${tenantId}::uuid
       and c.status = 'active'
       and c.deleted_at is null`);
  return rows[0]?.name ?? null;
}

/** EP-39: cents desc, then the live name, then the id. */
function byRevenue(a: OwnerFinanceProductSummary, b: OwnerFinanceProductSummary): number {
  return (
    b.current.cents - a.current.cents ||
    a.name.localeCompare(b.name, 'pt-BR') ||
    a.productId.localeCompare(b.productId)
  );
}

/**
 * `GET /v1/dashboard/owner/finance` (08.7-09, D-455, D-460, D-462, D-465, UI-D-490, INSIGHT-12):
 * the Financeiro area of the tenant's newest snapshot, read in the admin's own lane. The route's
 * chain already refused a tenant without `store` (404 `MODULE_DISABLED`) and any role but
 * `admin_tenant` (403), in that order.
 *
 * - No snapshot, or a snapshot whose `finance` key is missing or fails its contract → `preparing`.
 * - Every small group passes `applyFinanceFloor` before the answer (D-462).
 * - Product, community and event names are joined LIVE; a product gone since the build leaves.
 * - `vip` is null with `communities` off or when its community is no longer live (UI-D-490);
 *   `contentSales` only with `feed` on, `eventSales` only with `events` on (omitted, never zeroed).
 */
export async function getOwnerFinance(ctx: Ctx): Promise<OwnerFinanceAnswer> {
  const flags = await financeFlags(ctx);
  return withTenantTx(ctx, async (tx): Promise<OwnerFinanceAnswer> => {
    const frame = await readFinanceFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const { finance } = frame;
    const floored = applyFinanceFloor(finance);

    const products = await liveProducts(tx, ctx.tenantId, [
      ...finance.byProduct.map((row) => row.productId),
      ...finance.attention.stalled.map((row) => row.productId),
      ...(finance.vip?.entryProductId ? [finance.vip.entryProductId] : []),
    ]);
    const byProduct = finance.byProduct
      .flatMap((row): OwnerFinanceProductSummary[] => {
        const label = products.get(row.productId);
        if (!label) return [];
        return [
          {
            productId: row.productId,
            name: label.name,
            priceCents: label.priceCents,
            status: label.status,
            current: row.current,
            previous: row.previous,
            lastSaleAt: row.lastSaleAt,
          },
        ];
      })
      .sort(byRevenue);
    const stalled = finance.attention.stalled.flatMap((row) => {
      const label = products.get(row.productId);
      return label && label.status === 'active' ? [{ ...row, name: label.name }] : [];
    });

    let vip: OwnerFinanceReady['vip'] = null;
    if (finance.vip && flags.communities) {
      const communityName = await liveCommunityName(tx, ctx.tenantId, finance.vip.communityId);
      if (communityName !== null) {
        const entry = finance.vip.entryProductId
          ? products.get(finance.vip.entryProductId)
          : undefined;
        vip = {
          ...finance.vip,
          communityName,
          entryProductId: entry ? finance.vip.entryProductId : null,
          entryProductName: entry?.name ?? null,
          prospects: entry ? finance.vip.prospects : 0,
        };
      }
    }

    const answer: OwnerFinanceReady = {
      state: 'ready',
      snapshot: frame.snapshot,
      totals: finance.totals,
      primary: finance.primary,
      secondary: finance.secondary,
      revoked: floored.revoked,
      byProduct,
      byBand: floored.byBand,
      weekly: finance.weekly,
      summary: finance.summary,
      ladder: floored.ladder,
      neverAgain: floored.neverAgain,
      attention: {
        vipFading: vip?.fading ?? null,
        stalled,
        expiring: NOT_MEASURED.expiring,
        fullEvents: NOT_MEASURED.fullEvents,
      },
      vip,
      offers: NOT_MEASURED.offers,
      paidEvents: NOT_MEASURED.paidEvents,
    };

    if (flags.feed) {
      const live = await livePostIds(
        tx,
        ctx.tenantId,
        floored.contentSales.posts.map((post) => post.postId),
      );
      answer.contentSales = {
        posts: floored.contentSales.posts.filter((post) => live.has(post.postId)),
        total: floored.contentSales.total,
      };
    }
    if (flags.events) {
      const titles = await liveEventTitles(
        tx,
        ctx.tenantId,
        floored.eventSales.events.map((event) => event.eventId),
      );
      answer.eventSales = {
        events: floored.eventSales.events.flatMap((event) => {
          const title = titles.get(event.eventId);
          return title === undefined ? [] : [{ ...event, title }];
        }),
        total: floored.eventSales.total,
      };
    }
    return answer;
  });
}

/**
 * `GET /v1/dashboard/owner/finance/products/{productId}` (08.7-09, D-461, D-462, T-08.7-12): one
 * product of the newest build. The id passes one gate before any snapshot read — a product of THIS
 * tenant (explicit predicate beside RLS) — so a foreign or unknown id is the same bare 404 in every
 * state; then no snapshot → `preparing`; a product absent from the build (created since) → the bare
 * 404 (the web falls one level up). The band split is merged and floored by `applyFinanceFloor`,
 * and so are the associated posts (live posts only, `feed` on; never a caption).
 */
export async function getOwnerFinanceProduct(
  ctx: Ctx,
  productId: string,
): Promise<OwnerFinanceProductAnswer> {
  const flags = await financeFlags(ctx);
  return withTenantTx(ctx, async (tx): Promise<OwnerFinanceProductAnswer> => {
    const label = (await liveProducts(tx, ctx.tenantId, [productId])).get(productId);
    if (!label) throw new ApiError(404, 'NOT_FOUND');
    const frame = await readFinanceFrame(tx, ctx.tenantId);
    if (!frame) return { state: 'preparing' };
    const stored = frame.finance.byProduct.find((row) => row.productId === productId);
    if (!stored) throw new ApiError(404, 'NOT_FOUND');
    const floored = applyFinanceFloor(frame.finance);
    const own = floored.products[productId];
    if (!own) throw new ApiError(404, 'NOT_FOUND');

    const answer: OwnerFinanceProductReady = {
      state: 'ready',
      snapshot: frame.snapshot,
      product: {
        productId,
        name: label.name,
        priceCents: label.priceCents,
        status: label.status,
        current: stored.current,
        previous: stored.previous,
        lastSaleAt: stored.lastSaleAt,
      },
      revoked: own.revoked,
      weekly: stored.weekly,
      byBand: own.byBand,
    };
    if (flags.feed) {
      const posts = floored.contentSales.posts.flatMap((post) => {
        const sold = post.products.find((row) => row.productId === productId);
        return sold ? [{ postId: post.postId, sales: sold.sales }] : [];
      });
      const live = await livePostIds(
        tx,
        ctx.tenantId,
        posts.map((post) => post.postId),
      );
      answer.posts = sortFloored(
        posts.filter((post) => live.has(post.postId)),
        (row) => moneyRank(row.sales),
      );
    }
    return answer;
  });
}
