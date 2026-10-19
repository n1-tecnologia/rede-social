import { describe, expect, it } from 'vitest';
import type { FinancePayload } from '../contracts/finance';
import { applyFinanceFloor } from '../server/finance';

/**
 * Financeiro's privacy floor (08.7-09, D-462, INSIGHT-14, UI-D-470, planning decision 2): ONE pure
 * pass, `applyFinanceFloor(payload)`, walks every group of the floor truth — by band, by band of a
 * product's buyers (merged), per ladder path ("outros caminhos"), never-again, revoked, per post or
 * event association — so a group of 1-4 people leaves the API as `{ belowFloor: true }` with no
 * count and no cents, and a group of 0 is the value 0. No database.
 */

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';
const EVENT = '55555555-5555-4555-8555-555555555555';
const COMMUNITY = '66666666-6666-4666-8666-666666666666';

const T = (orders: number, cents: number, buyers: number) => ({ orders, cents, buyers });
const ZERO = T(0, 0, 0);
const BANDS = <V>(value: V, over: Partial<Record<string, V>> = {}) => ({
  new: value,
  superfan: value,
  engaged: value,
  occasional: value,
  at_risk: value,
  inactive: value,
  ...over,
});
const WEEKS = { current: Array(12).fill(0), previous: Array(12).fill(0) };

function payload(over: Partial<FinancePayload> = {}): FinancePayload {
  return {
    totals: { current: T(12, 23880, 9), previous: T(4, 7960, 4) },
    primary: { current: { orders: 9, cents: 17910 }, previous: { orders: 4, cents: 7960 } },
    secondary: { current: { orders: 3, cents: 5970 }, previous: { orders: 0, cents: 0 } },
    revoked: { current: T(3, 5973, 3), previous: ZERO },
    byProduct: [
      {
        productId: P1,
        current: { ...T(9, 17910, 9), entry: 9, addon: 0 },
        previous: T(4, 7960, 4),
        lastSaleAt: '2026-10-17T15:00:00Z',
        revoked: T(2, 3982, 2),
        weekly: WEEKS,
        byBand: BANDS(ZERO, { engaged: T(3, 5973, 3), occasional: T(6, 11937, 6) }),
      },
    ],
    byBand: BANDS(ZERO, { engaged: T(3, 5971, 3), occasional: T(9, 17909, 6) }),
    weekly: { primary: WEEKS, secondary: WEEKS },
    summary: {
      current: { base: 40, rebought: 6, timeToSecondDays: 12.5, lifetimeCents: 99000 },
      previous: { base: 30, rebought: 2, timeToSecondDays: 20, lifetimeCents: 50000 },
    },
    ladder: [
      { entryProductId: P1, nextProductId: P2, people: 6, averageDays: 10 },
      { entryProductId: P1, nextProductId: P3, people: 2, averageDays: 4 },
      { entryProductId: P2, nextProductId: P1, people: 2, averageDays: 8 },
    ],
    neverAgain: BANDS(0, { engaged: 3, occasional: 7 }),
    attention: { stalled: [] },
    vip: {
      communityId: COMMUNITY,
      entryProductId: P1,
      holders: 12,
      fading: { atRisk: 2, inactive: 1, withPush: 1 },
      prospects: 4,
      revenueCents: 5970,
    },
    contentSales: {
      posts: [
        {
          postId: POST,
          ...T(2, 3977, 2),
          products: [{ productId: P1, ...T(2, 3977, 2) }],
        },
      ],
      total: T(2, 3977, 2),
    },
    eventSales: { events: [{ eventId: EVENT, ...T(6, 11943, 6) }], total: T(6, 11943, 6) },
    ...over,
  };
}

describe('applyFinanceFloor (08.7-09, D-462, planning decision 2)', () => {
  it('floors a band with 3 orders to { belowFloor: true }, with no orders, cents or buyers key', () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.byBand.engaged).toEqual({ belowFloor: true });
    expect(Object.keys(floored.byBand.engaged)).toEqual(['belowFloor']);
    expect(JSON.stringify(floored.byBand)).not.toContain('5971');
  });

  it('keeps a band of 0 as the value 0 (UI-D-470: zero identifies no one)', () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.byBand.superfan).toEqual({ belowFloor: false, orders: 0, cents: 0, buyers: 0 });
  });

  it('shows a band of 6 buyers with its orders and cents', () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.byBand.occasional).toEqual({
      belowFloor: false,
      orders: 9,
      cents: 17909,
      buyers: 6,
    });
  });

  it("sums ladder paths of 2 and 2 people into an 'outros caminhos' row of 4, which is floored; a path of 6 stays", () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.ladder.paths).toEqual([
      { entryProductId: P1, nextProductId: P2, people: 6, averageDays: 10 },
    ]);
    expect(floored.ladder.others).toEqual({ belowFloor: true, paths: 2 });
  });

  it("shows an 'outros caminhos' row of 5 or more with its people-weighted average days", () => {
    const floored = applyFinanceFloor(
      payload({
        ladder: [
          { entryProductId: P1, nextProductId: P3, people: 2, averageDays: 4 },
          { entryProductId: P2, nextProductId: P1, people: 4, averageDays: 10 },
        ],
      }),
    );
    expect(floored.ladder.paths).toEqual([]);
    expect(floored.ladder.others).toEqual({
      belowFloor: false,
      people: 6,
      paths: 2,
      averageDays: 8,
    });
  });

  it("has no 'outros caminhos' row when every path holds 5 or more", () => {
    const floored = applyFinanceFloor(
      payload({ ladder: [{ entryProductId: P1, nextProductId: P2, people: 5, averageDays: 3 }] }),
    );
    expect(floored.ladder.others).toBeNull();
  });

  it('floors never-again per band (3 floored, 0 is 0, 7 shown)', () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.neverAgain.engaged).toEqual({ belowFloor: true });
    expect(floored.neverAgain.new).toEqual({ belowFloor: false, value: 0 });
    expect(floored.neverAgain.occasional).toEqual({ belowFloor: false, value: 7 });
  });

  it('floors the revoked orders of the window, and keeps an empty window as 0', () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.revoked.current).toEqual({ belowFloor: true });
    expect(floored.revoked.previous).toEqual({ belowFloor: false, orders: 0, cents: 0, buyers: 0 });
  });

  it('floors the sales associated with a post, its products and the total, and shows an event of 6', () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.contentSales.posts).toEqual([
      {
        postId: POST,
        sales: { belowFloor: true },
        products: [{ productId: P1, sales: { belowFloor: true } }],
      },
    ]);
    expect(floored.contentSales.total).toEqual({ belowFloor: true });
    expect(floored.eventSales.events).toEqual([
      { eventId: EVENT, sales: { belowFloor: false, orders: 6, cents: 11943, buyers: 6 } },
    ]);
    expect(JSON.stringify(floored.contentSales)).not.toContain('3977');
  });

  it("merges a product's buyers by band (mergeBandsBelowFloor): the 3 engaged buyers join a neighbour, every group floored", () => {
    const floored = applyFinanceFloor(payload());
    const groups = floored.products[P1]?.byBand ?? [];
    const engaged = groups.find((group) => group.bands.includes('engaged'));
    expect(engaged?.bands.length).toBeGreaterThan(1);
    expect(groups.flatMap((group) => group.bands).sort()).toEqual(
      ['at_risk', 'engaged', 'inactive', 'new', 'occasional', 'superfan'].sort(),
    );
    for (const group of groups) {
      if (!group.sales.belowFloor) expect(group.sales.buyers).toBeGreaterThanOrEqual(5);
    }
    expect(JSON.stringify(groups)).not.toContain('5973');
    expect(floored.products[P1]?.revoked).toEqual({ belowFloor: true });
  });

  it('answers a product with no buyer in the window with no band group at all', () => {
    const floored = applyFinanceFloor(
      payload({
        byProduct: [
          {
            productId: P2,
            current: { ...ZERO, entry: 0, addon: 0 },
            previous: ZERO,
            lastSaleAt: null,
            revoked: ZERO,
            weekly: WEEKS,
            byBand: BANDS(ZERO),
          },
        ],
      }),
    );
    expect(floored.products[P2]?.byBand).toEqual([]);
    expect(floored.products[P2]?.revoked).toEqual({
      belowFloor: false,
      orders: 0,
      cents: 0,
      buyers: 0,
    });
  });

  it('is pure: the same payload floors to the same answer twice', () => {
    expect(applyFinanceFloor(payload())).toEqual(applyFinanceFloor(payload()));
  });
});
