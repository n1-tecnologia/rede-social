import type {
  FlooredMoney,
  OwnerFinanceBuyerRow,
  OwnerFinanceBuyersReady,
  OwnerFinanceProductReady,
  OwnerFinanceProductSummary,
  OwnerFinanceReady,
} from '@rede-social/module-dashboard/contracts';
import { contentId, contentSnapshot } from './owner-content-test-data';

/*
 * Contract-shaped Financeiro answers for the web's component tests (08.7-10): what
 * `GET /v1/dashboard/owner/finance`, its product detail and its buyers lists answer, built by hand so
 * a test states the very numbers it asserts. Test-only: no runtime file imports it.
 */

export const FINANCE_IDS = {
  entry: contentId(101),
  vip: contentId(102),
  stalled: contentId(103),
  community: contentId(201),
  post: contentId(301),
  event: contentId(401),
  member: contentId(501),
} as const;

/** A shown money group (5 or more buyers). */
export function shown(orders: number, cents: number, buyers = orders): FlooredMoney {
  return { belowFloor: false, orders, cents, buyers };
}

/** A group of 1-4 people: no number at all (D-462). */
export const FLOORED: FlooredMoney = { belowFloor: true };

/** Zero is not floored (UI-D-470). */
export const NONE: FlooredMoney = { belowFloor: false, orders: 0, cents: 0, buyers: 0 };

/** One product card of the answer. */
export function financeProduct(
  productId: string,
  patch: Partial<OwnerFinanceProductSummary> = {},
): OwnerFinanceProductSummary {
  return {
    productId,
    name: 'Guia de Entrada',
    priceCents: 4900,
    status: 'active',
    current: { orders: 8, cents: 39200, buyers: 8, entry: 6, addon: 2 },
    previous: { orders: 5, cents: 24500, buyers: 5 },
    lastSaleAt: '2026-10-15T14:00:00Z',
    ...patch,
  };
}

const weeks = (value: number) => ({
  current: Array.from({ length: 12 }, () => value),
  previous: Array.from({ length: 12 }, () => Math.round(value / 2)),
});

/** A ready Financeiro answer: a tenant whose store sold in the window, with a VIP. */
export function financeAnswer(patch: Partial<OwnerFinanceReady> = {}): OwnerFinanceReady {
  return {
    state: 'ready',
    snapshot: contentSnapshot(),
    totals: {
      current: { orders: 14, cents: 159200, buyers: 12 },
      previous: { orders: 10, cents: 98000, buyers: 9 },
    },
    primary: { current: { orders: 8, cents: 79200 }, previous: { orders: 6, cents: 58000 } },
    secondary: { current: { orders: 6, cents: 80000 }, previous: { orders: 4, cents: 40000 } },
    revoked: { current: FLOORED, previous: NONE },
    byProduct: [
      financeProduct(FINANCE_IDS.vip, {
        name: 'Círculo Interno',
        priceCents: 20000,
        current: { orders: 6, cents: 120000, buyers: 6, entry: 2, addon: 4 },
        previous: { orders: 4, cents: 80000, buyers: 4 },
      }),
      financeProduct(FINANCE_IDS.entry),
      financeProduct(FINANCE_IDS.stalled, {
        name: 'Mentoria Antiga',
        priceCents: 90000,
        current: { orders: 0, cents: 0, buyers: 0, entry: 0, addon: 0 },
        previous: { orders: 0, cents: 0, buyers: 0 },
        lastSaleAt: '2026-07-01T12:00:00Z',
      }),
    ],
    byBand: {
      new: shown(5, 24500),
      superfan: shown(6, 98000),
      engaged: FLOORED,
      occasional: NONE,
      at_risk: NONE,
      inactive: NONE,
    },
    weekly: { primary: weeks(18000), secondary: weeks(20000) },
    summary: {
      current: { base: 120, rebought: 9, timeToSecondDays: 12.4, lifetimeCents: 960000 },
      previous: { base: 110, rebought: 7, timeToSecondDays: 15, lifetimeCents: 800000 },
    },
    ladder: {
      paths: [
        {
          entryProductId: FINANCE_IDS.entry,
          nextProductId: FINANCE_IDS.vip,
          people: 6,
          averageDays: 11.6,
        },
      ],
      others: { belowFloor: true, paths: 2 },
    },
    neverAgain: {
      new: { belowFloor: false, value: 7 },
      superfan: { belowFloor: true },
      engaged: { belowFloor: false, value: 0 },
      occasional: { belowFloor: false, value: 12 },
      at_risk: { belowFloor: false, value: 0 },
      inactive: { belowFloor: false, value: 0 },
    },
    attention: {
      vipFading: { atRisk: 3, inactive: 2, withPush: 1 },
      stalled: [
        {
          productId: FINANCE_IDS.stalled,
          days: 108,
          lastSaleAt: '2026-07-01T12:00:00Z',
          name: 'Mentoria Antiga',
        },
      ],
      expiring: { measured: false, reason: 'needs_access_expiry' },
      fullEvents: { measured: false, reason: 'needs_waitlist' },
    },
    vip: {
      communityId: FINANCE_IDS.community,
      entryProductId: FINANCE_IDS.entry,
      holders: 20,
      fading: { atRisk: 3, inactive: 2, withPush: 1 },
      prospects: 9,
      revenueCents: 120000,
      communityName: 'Círculo Interno',
      entryProductName: 'Guia de Entrada',
    },
    offers: { measured: false, reason: 'needs_offers' },
    paidEvents: { measured: false, reason: 'needs_event_tickets' },
    contentSales: {
      posts: [
        {
          postId: FINANCE_IDS.post,
          sales: shown(5, 60000),
          products: [{ productId: FINANCE_IDS.vip, sales: shown(5, 60000) }],
        },
      ],
      total: shown(5, 60000),
    },
    eventSales: {
      events: [{ eventId: FINANCE_IDS.event, title: 'Encontro de outubro', sales: FLOORED }],
      total: FLOORED,
    },
    ...patch,
  };
}

/** A store with no order in the window and no product (the empty tenant). */
export function emptyFinanceAnswer(): OwnerFinanceReady {
  const zero = { orders: 0, cents: 0, buyers: 0 };
  return financeAnswer({
    totals: { current: zero, previous: zero },
    primary: { current: { orders: 0, cents: 0 }, previous: { orders: 0, cents: 0 } },
    secondary: { current: { orders: 0, cents: 0 }, previous: { orders: 0, cents: 0 } },
    revoked: { current: NONE, previous: NONE },
    byProduct: [],
    byBand: {
      new: NONE,
      superfan: NONE,
      engaged: NONE,
      occasional: NONE,
      at_risk: NONE,
      inactive: NONE,
    },
    weekly: { primary: weeks(0), secondary: weeks(0) },
    summary: {
      current: { base: 40, rebought: 0, timeToSecondDays: null, lifetimeCents: 0 },
      previous: { base: 40, rebought: 0, timeToSecondDays: null, lifetimeCents: 0 },
    },
    ladder: { paths: [], others: null },
    neverAgain: {
      new: { belowFloor: false, value: 0 },
      superfan: { belowFloor: false, value: 0 },
      engaged: { belowFloor: false, value: 0 },
      occasional: { belowFloor: false, value: 0 },
      at_risk: { belowFloor: false, value: 0 },
      inactive: { belowFloor: false, value: 0 },
    },
    attention: {
      vipFading: null,
      stalled: [],
      expiring: { measured: false, reason: 'needs_access_expiry' },
      fullEvents: { measured: false, reason: 'needs_waitlist' },
    },
    vip: null,
    contentSales: { posts: [], total: NONE },
    eventSales: { events: [], total: NONE },
  });
}

/** A product detail: its card, revocations, weeks, buyers by band merged, its associated posts. */
export function financeProductAnswer(
  patch: Partial<OwnerFinanceProductReady> = {},
): OwnerFinanceProductReady {
  return {
    state: 'ready',
    snapshot: contentSnapshot(),
    product: financeProduct(FINANCE_IDS.vip, {
      name: 'Círculo Interno',
      priceCents: 20000,
      current: { orders: 9, cents: 180000, buyers: 9, entry: 3, addon: 6 },
      previous: { orders: 4, cents: 80000, buyers: 4 },
    }),
    revoked: FLOORED,
    weekly: weeks(15000),
    byBand: [
      { bands: ['superfan'], sales: shown(5, 100000) },
      { bands: ['at_risk', 'inactive'], sales: FLOORED },
      { bands: ['new', 'engaged', 'occasional'], sales: FLOORED },
    ],
    posts: [{ postId: FINANCE_IDS.post, sales: FLOORED }],
    ...patch,
  };
}

/** One named buyer row. */
export function financeBuyer(n: number, patch: Partial<OwnerFinanceBuyerRow> = {}) {
  return {
    membershipId: contentId(n, '00000000-0000-4000-9000'),
    displayName: `Comprador ${n}`,
    avatarAssetId: null,
    band: 'engaged',
    at: '2026-10-15T14:00:00Z',
    orders: 1,
    cents: 4900,
    secondAfterDays: null,
    ...patch,
  } satisfies OwnerFinanceBuyerRow;
}

/** One page of a buyers list. */
export function financeBuyersPage(
  patch: Partial<OwnerFinanceBuyersReady> = {},
): OwnerFinanceBuyersReady {
  return {
    state: 'ready',
    snapshot: contentSnapshot(),
    list: 'primary',
    total: 2,
    rows: [financeBuyer(1), financeBuyer(2, { band: 'superfan', cents: 20000 })],
    nextCursor: null,
    ...patch,
  };
}
