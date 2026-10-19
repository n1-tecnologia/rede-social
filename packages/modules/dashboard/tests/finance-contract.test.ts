import { describe, expect, it } from 'vitest';
import {
  FINANCE_BUYER_LISTS,
  FINANCE_BUYERS_PAGE_SIZE,
  FINANCE_STALLED_DAYS,
  financePayloadSchema,
  ownerFinanceAnswerSchema,
  ownerFinanceBuyersAnswerSchema,
  ownerFinanceBuyersParamSchema,
  ownerFinanceBuyersQuerySchema,
  ownerFinanceProductAnswerSchema,
  ownerFinanceProductParamSchema,
} from '../contracts/finance';

/**
 * The owner's Financeiro contract (08.7-09, D-455, D-460, D-462, D-465, UI-D-470, UI-D-490,
 * INSIGHT-12, INSIGHT-14): what the stored `payload.finance` and the area answer may and may not
 * carry. Product ids, never offer ids (planning decision 1); no example branch anywhere; a floored
 * group carries no count and no cents. No database.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const POST = '44444444-4444-4444-8444-444444444444';
const EVENT = '55555555-5555-4555-8555-555555555555';
const COMMUNITY = '66666666-6666-4666-8666-666666666666';

const SNAPSHOT = {
  day: '2026-10-17',
  builtAt: '2026-10-18T03:30:00.000Z',
  windows: {
    day: '2026-10-17',
    from30: '2026-09-18',
    prev30From: '2026-08-19',
    from7: '2026-10-11',
    prev7From: '2026-10-04',
    from30At: '2026-09-18T03:00:00Z',
    prev30At: '2026-08-19T03:00:00Z',
    untilAt: '2026-10-18T03:00:00Z',
  },
};

const T = (orders: number, cents: number, buyers: number) => ({ orders, cents, buyers });
const ZERO = T(0, 0, 0);
const BANDS = <V>(value: V) => ({
  new: value,
  superfan: value,
  engaged: value,
  occasional: value,
  at_risk: value,
  inactive: value,
});
const WEEKS = { current: Array(12).fill(0), previous: Array(12).fill(0) };
const NM = (reason: string) => ({ measured: false, reason });
const SHOWN = (orders: number, cents: number, buyers: number) => ({
  belowFloor: false,
  ...T(orders, cents, buyers),
});
const FLOORED = { belowFloor: true };

const PAYLOAD = {
  totals: { current: T(7, 13930, 6), previous: ZERO },
  primary: { current: { orders: 6, cents: 11940 }, previous: { orders: 0, cents: 0 } },
  secondary: { current: { orders: 1, cents: 1990 }, previous: { orders: 0, cents: 0 } },
  revoked: { current: T(1, 1990, 1), previous: ZERO },
  byProduct: [
    {
      productId: P1,
      current: { ...T(6, 11940, 6), entry: 6, addon: 0 },
      previous: ZERO,
      lastSaleAt: '2026-10-17T15:00:00Z',
      revoked: ZERO,
      weekly: WEEKS,
      byBand: { ...BANDS(ZERO), occasional: T(6, 11940, 6) },
    },
  ],
  byBand: { ...BANDS(ZERO), occasional: T(7, 13930, 6) },
  weekly: { primary: WEEKS, secondary: WEEKS },
  summary: {
    current: { base: 20, rebought: 1, timeToSecondDays: 3, lifetimeCents: 13930 },
    previous: { base: 18, rebought: 0, timeToSecondDays: null, lifetimeCents: 0 },
  },
  ladder: [{ entryProductId: P1, nextProductId: P2, people: 1, averageDays: 3 }],
  neverAgain: { ...BANDS(0), occasional: 5 },
  attention: { stalled: [{ productId: P2, days: 75, lastSaleAt: null }] },
  vip: {
    communityId: COMMUNITY,
    entryProductId: P1,
    holders: 3,
    fading: { atRisk: 1, inactive: 0, withPush: 1 },
    prospects: 2,
    revenueCents: 1990,
  },
  contentSales: {
    posts: [{ postId: POST, ...T(1, 1990, 1), products: [{ productId: P2, ...T(1, 1990, 1) }] }],
    total: T(1, 1990, 1),
  },
  eventSales: { events: [{ eventId: EVENT, ...T(1, 1990, 1) }], total: T(1, 1990, 1) },
};

const READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  totals: PAYLOAD.totals,
  primary: PAYLOAD.primary,
  secondary: PAYLOAD.secondary,
  revoked: { current: FLOORED, previous: SHOWN(0, 0, 0) },
  byProduct: [
    {
      productId: P1,
      name: 'Comunidade VIP',
      priceCents: 1990,
      status: 'active',
      current: { ...T(6, 11940, 6), entry: 6, addon: 0 },
      previous: ZERO,
      lastSaleAt: '2026-10-17T15:00:00Z',
    },
  ],
  byBand: [
    {
      bands: ['new', 'superfan', 'engaged', 'occasional', 'at_risk', 'inactive'],
      sales: SHOWN(7, 13930, 6),
    },
  ],
  weekly: PAYLOAD.weekly,
  summary: PAYLOAD.summary,
  ladder: { paths: [], others: { belowFloor: true, paths: 1 } },
  neverAgain: {
    ...BANDS({ belowFloor: false, value: 0 }),
    occasional: { belowFloor: false, value: 5 },
  },
  attention: {
    vipFading: { atRisk: 1, inactive: 0, withPush: 1 },
    stalled: [{ productId: P2, name: 'E-book', days: 75, lastSaleAt: null }],
    expiring: NM('needs_access_expiry'),
    fullEvents: NM('needs_waitlist'),
  },
  vip: {
    communityId: COMMUNITY,
    communityName: 'Comunidade VIP',
    entryProductId: P1,
    entryProductName: 'E-book',
    holders: 3,
    fading: { atRisk: 1, inactive: 0, withPush: 1 },
    prospects: 2,
    revenueCents: 1990,
  },
  offers: NM('needs_offers'),
  paidEvents: NM('needs_event_tickets'),
  contentSales: {
    posts: [{ postId: POST, sales: FLOORED, products: [{ productId: P2, sales: FLOORED }] }],
    total: FLOORED,
  },
  eventSales: {
    events: [{ eventId: EVENT, title: 'Encontro', sales: FLOORED }],
    total: FLOORED,
  },
};

describe('financePayloadSchema (08.7-09, PR-1, planning decision 1)', () => {
  it('accepts the stored finance area: ids and numbers only', () => {
    expect(financePayloadSchema.safeParse(PAYLOAD).success).toBe(true);
  });

  it('refuses an offer id on a ladder path (product ids only)', () => {
    const ladder = [{ ...PAYLOAD.ladder[0], entryOfferId: 'vip-entrada' }];
    expect(financePayloadSchema.safeParse({ ...PAYLOAD, ladder }).success).toBe(false);
  });

  it('refuses a byOffer block (no offer table, needs_offers)', () => {
    expect(financePayloadSchema.safeParse({ ...PAYLOAD, byOffer: {} }).success).toBe(false);
  });

  it('refuses a product name in the stored payload (PR-1: names are joined live)', () => {
    const byProduct = [{ ...PAYLOAD.byProduct[0], name: 'Comunidade VIP' }];
    expect(financePayloadSchema.safeParse({ ...PAYLOAD, byProduct }).success).toBe(false);
  });

  it('accepts a tenant with no product: byProduct [] and no VIP (EP-38)', () => {
    expect(
      financePayloadSchema.safeParse({ ...PAYLOAD, byProduct: [], vip: null, ladder: [] }).success,
    ).toBe(true);
  });

  it('refuses a weekly series that is not 12 blocks', () => {
    const weekly = { primary: { current: [1], previous: [] }, secondary: WEEKS };
    expect(financePayloadSchema.safeParse({ ...PAYLOAD, weekly }).success).toBe(false);
  });

  it('refuses negative or fractional cents', () => {
    const totals = { current: T(1, -5, 1), previous: ZERO };
    expect(financePayloadSchema.safeParse({ ...PAYLOAD, totals }).success).toBe(false);
    const fractional = { current: T(1, 19.9, 1), previous: ZERO };
    expect(financePayloadSchema.safeParse({ ...PAYLOAD, totals: fractional }).success).toBe(false);
  });
});

describe('ownerFinanceAnswerSchema (08.7-09, D-455, D-462, D-465, UI-D-490)', () => {
  it('accepts a ready answer with floored groups and the not-measured blocks', () => {
    expect(ownerFinanceAnswerSchema.safeParse(READY).success).toBe(true);
  });

  it('accepts preparing', () => {
    expect(ownerFinanceAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
  });

  it('accepts vip null and no association blocks (feed and events off)', () => {
    const { contentSales: _c, eventSales: _e, ...rest } = READY;
    expect(
      ownerFinanceAnswerSchema.safeParse({
        ...rest,
        vip: null,
        attention: { ...READY.attention, vipFading: null },
      }).success,
    ).toBe(true);
  });

  it('refuses a floored group that still carries its count or cents (EP-48)', () => {
    const byBand = { ...READY.byBand, engaged: { belowFloor: true, orders: 3 } };
    expect(ownerFinanceAnswerSchema.safeParse({ ...READY, byBand }).success).toBe(false);
    const revoked = { current: { belowFloor: true, cents: 1990 }, previous: SHOWN(0, 0, 0) };
    expect(ownerFinanceAnswerSchema.safeParse({ ...READY, revoked }).success).toBe(false);
  });

  it('refuses an offers block carrying an example value (D-455: no example branch)', () => {
    const offers = { example: true, reason: 'needs_offers', value: [] };
    expect(ownerFinanceAnswerSchema.safeParse({ ...READY, offers }).success).toBe(false);
  });

  it('refuses expiring accesses as a number (D-465: needs_access_expiry only)', () => {
    const attention = { ...READY.attention, expiring: { measured: true, value: 6 } };
    expect(ownerFinanceAnswerSchema.safeParse({ ...READY, attention }).success).toBe(false);
  });

  it('refuses an example anywhere: a full-events block with example true', () => {
    const attention = {
      ...READY.attention,
      fullEvents: { example: true, reason: 'needs_waitlist', value: [] },
    };
    expect(ownerFinanceAnswerSchema.safeParse({ ...READY, attention }).success).toBe(false);
  });

  it('refuses an offer-keyed purchase list (byOffer)', () => {
    expect(ownerFinanceAnswerSchema.safeParse({ ...READY, byOffer: {} }).success).toBe(false);
  });

  it("names the paid events block 'needs_event_tickets' and the offers block 'needs_offers'", () => {
    const wrong = { ...READY, paidEvents: NM('needs_offers') };
    expect(ownerFinanceAnswerSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('finance constants', () => {
  it('stalls a product after 60 days and lists no expiring or offer buyers', () => {
    expect(FINANCE_STALLED_DAYS).toBe(60);
    expect([...FINANCE_BUYER_LISTS]).toEqual([
      'band',
      'never',
      'primary',
      'secondary',
      'rebought',
      'time-to-second',
      'lifetime',
      'vip-fading',
      'product',
    ]);
  });
});

// ── Task 2: the product detail and the buyers lists ───────────────────────────────────────────

const MEMBER = '77777777-7777-4777-8777-777777777777';

const PRODUCT_READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  product: READY.byProduct[0],
  revoked: FLOORED,
  weekly: WEEKS,
  byBand: [
    { bands: ['new', 'superfan', 'engaged', 'occasional', 'at_risk', 'inactive'], sales: FLOORED },
  ],
  posts: [{ postId: POST, sales: FLOORED }],
};

const BUYER_ROW = {
  membershipId: MEMBER,
  displayName: 'Ana',
  avatarAssetId: null,
  band: 'engaged',
  at: '2026-10-17T15:00:00.000000Z',
  orders: 2,
  cents: 6980,
  secondAfterDays: 3,
};

const BUYERS_READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  list: 'rebought',
  total: 1,
  rows: [BUYER_ROW],
  nextCursor: null,
};

describe('ownerFinanceProductAnswerSchema (08.7-09 Task 2, D-462, UI-D-470)', () => {
  it('accepts a product detail with its merged, floored band groups and associated posts', () => {
    expect(ownerFinanceProductAnswerSchema.safeParse(PRODUCT_READY).success).toBe(true);
  });

  it('accepts preparing, and a detail with no associated posts block (feed off)', () => {
    expect(ownerFinanceProductAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
    const { posts: _posts, ...withoutPosts } = PRODUCT_READY;
    expect(ownerFinanceProductAnswerSchema.safeParse(withoutPosts).success).toBe(true);
  });

  it('refuses a floored band group that still carries its orders', () => {
    const byBand = [{ bands: ['engaged'], sales: { belowFloor: true, orders: 3 } }];
    expect(ownerFinanceProductAnswerSchema.safeParse({ ...PRODUCT_READY, byBand }).success).toBe(
      false,
    );
  });

  it('refuses an associated post carrying its caption', () => {
    const posts = [{ postId: POST, sales: FLOORED, caption: 'Legenda' }];
    expect(ownerFinanceProductAnswerSchema.safeParse({ ...PRODUCT_READY, posts }).success).toBe(
      false,
    );
  });

  it('takes the raw uuid of a product in the path', () => {
    expect(ownerFinanceProductParamSchema.safeParse({ productId: P1 }).success).toBe(true);
    expect(ownerFinanceProductParamSchema.safeParse({ productId: 'vip-entrada' }).success).toBe(
      false,
    );
  });
});

describe('ownerFinanceBuyersAnswerSchema (08.7-09 Task 2, D-462: named buyers, admin only)', () => {
  it('accepts a page of named buyers with their totals', () => {
    expect(ownerFinanceBuyersAnswerSchema.safeParse(BUYERS_READY).success).toBe(true);
  });

  it('accepts preparing, a band list with its band and a product list with its product', () => {
    expect(ownerFinanceBuyersAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
    expect(
      ownerFinanceBuyersAnswerSchema.safeParse({ ...BUYERS_READY, list: 'band', band: 'engaged' })
        .success,
    ).toBe(true);
    expect(
      ownerFinanceBuyersAnswerSchema.safeParse({ ...BUYERS_READY, list: 'product', productId: P1 })
        .success,
    ).toBe(true);
  });

  it('refuses a row keyed by an offer', () => {
    const rows = [{ ...BUYER_ROW, offerId: 'vip-entrada' }];
    expect(ownerFinanceBuyersAnswerSchema.safeParse({ ...BUYERS_READY, rows }).success).toBe(false);
  });

  it('refuses the expiring and the offer lists, which do not exist (D-465, needs_offers)', () => {
    expect(
      ownerFinanceBuyersAnswerSchema.safeParse({ ...BUYERS_READY, list: 'expiring' }).success,
    ).toBe(false);
    expect(ownerFinanceBuyersParamSchema.safeParse({ list: 'expiring' }).success).toBe(false);
    expect(ownerFinanceBuyersParamSchema.safeParse({ list: 'offer' }).success).toBe(false);
    expect(ownerFinanceBuyersParamSchema.safeParse({ list: 'time-to-second' }).success).toBe(true);
  });

  it('takes a known band and a uuid product in the query, and nothing else', () => {
    expect(
      ownerFinanceBuyersQuerySchema.safeParse({ band: 'engaged', cursor: 'x', limit: '5' }).success,
    ).toBe(true);
    expect(ownerFinanceBuyersQuerySchema.safeParse({ productId: P1 }).success).toBe(true);
    expect(ownerFinanceBuyersQuerySchema.safeParse({ band: 'vip' }).success).toBe(false);
    expect(ownerFinanceBuyersQuerySchema.safeParse({ productId: 'ebook' }).success).toBe(false);
    expect(ownerFinanceBuyersQuerySchema.safeParse({ offerId: 'x' }).success).toBe(false);
  });

  it('pages 20 buyers by default', () => {
    expect(FINANCE_BUYERS_PAGE_SIZE).toBe(20);
  });
});
