import { describe, expect, it } from 'vitest';
import type { FinancePayload } from '../contracts/finance';
import { applyFinanceFloor, floorSummary } from '../server/finance';

/**
 * Financeiro's privacy floor (08.7-09, D-462, INSIGHT-14, UI-D-470, planning decision 2): ONE pure
 * pass, `applyFinanceFloor(payload)`, walks every group of the floor truth — by band (merged), by band of a
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
  it("merges the area's bands under the floor (C-1): the 3 engaged buyers join a neighbour, never alone beside the exact total", () => {
    const floored = applyFinanceFloor(payload());
    expect(floored.byBand.flatMap((group) => group.bands).sort()).toEqual(
      ['at_risk', 'engaged', 'inactive', 'new', 'occasional', 'superfan'].sort(),
    );
    const engaged = floored.byBand.find((group) => group.bands.includes('engaged'));
    expect(engaged?.bands.length).toBeGreaterThan(1);
    for (const group of floored.byBand) {
      if (!group.sales.belowFloor) expect(group.sales.buyers).toBeGreaterThanOrEqual(5);
    }
    expect(JSON.stringify(floored.byBand)).not.toContain('5971');
  });

  it('no area band comes back by subtraction from totals.current', () => {
    const floored = applyFinanceFloor(
      payload({
        totals: { current: T(20, 40000, 15), previous: ZERO },
        byBand: BANDS(ZERO, {
          superfan: T(8, 16000, 6),
          engaged: T(2, 4000, 1),
          occasional: T(10, 20000, 8),
        }),
      }),
    );
    const shown = floored.byBand.filter((group) => !group.sales.belowFloor);
    const rest = shown.reduce(
      (sum, group) =>
        group.sales.belowFloor
          ? sum
          : { orders: sum.orders - group.sales.orders, cents: sum.cents - group.sales.cents },
      { orders: 20, cents: 40000 },
    );
    expect(rest).not.toEqual({ orders: 2, cents: 4000 });
    expect(floored.byBand.every((group) => !group.sales.belowFloor)).toBe(true);
  });

  it('merges a base of 9 buyers with one band of 3 into one group equal to the total', () => {
    const floored = applyFinanceFloor(payload());
    const occasional = floored.byBand.find((group) => group.bands.includes('occasional'));
    expect(occasional?.sales).toEqual({ belowFloor: false, orders: 12, cents: 23880, buyers: 9 });
  });

  it('answers an area with no buyer with no band group at all', () => {
    const floored = applyFinanceFloor(payload({ byBand: BANDS(ZERO) }));
    expect(floored.byBand).toEqual([]);
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

  describe('no floored group comes back by subtraction (C-1, CR-01)', () => {
    const PA = P1;
    const PB = P2;
    const PC = P3;
    const POST_2 = '77777777-7777-4777-8777-777777777777';
    const EVENT_2 = '88888888-8888-4888-8888-888888888888';

    type Money = ReturnType<typeof applyFinanceFloor>['revoked']['current'] | null;

    /**
     * What an admin can derive from one split: the parent minus every shown part. It must never be
     * a floored part's exact orders and cents.
     */
    function remainder(parent: Money, parts: readonly Money[]) {
      if (parent === null || parent.belowFloor) return null;
      return parts.reduce(
        (rest, part) =>
          part === null || part.belowFloor
            ? rest
            : { orders: rest.orders - part.orders, cents: rest.cents - part.cents },
        { orders: parent.orders, cents: parent.cents },
      );
    }

    const product = (productId: string, revoked: ReturnType<typeof T>) => ({
      productId,
      current: { ...T(9, 17910, 9), entry: 9, addon: 0 },
      previous: ZERO,
      lastSaleAt: '2026-10-17T15:00:00Z',
      revoked,
      weekly: WEEKS,
      byBand: BANDS(ZERO, { occasional: T(9, 17910, 9) }),
    });

    it("withholds the smallest shown product's revoked orders when one product is floored", () => {
      const floored = applyFinanceFloor(
        payload({
          revoked: { current: T(8, 14642, 6), previous: ZERO },
          byProduct: [product(PA, T(6, 6000, 5)), product(PB, T(2, 8642, 1))],
        }),
      );
      expect(floored.revoked.current).toEqual({
        belowFloor: false,
        orders: 8,
        cents: 14642,
        buyers: 6,
      });
      expect(floored.products[PB]?.revoked).toEqual({ belowFloor: true });
      expect(floored.products[PA]?.revoked).toBeNull();
      const rest = remainder(
        floored.revoked.current,
        Object.values(floored.products).map((row) => row.revoked),
      );
      expect(rest).not.toEqual({ orders: 2, cents: 8642 });
    });

    it('withholds only the smallest of several shown products, and nothing when none is floored', () => {
      const leaking = applyFinanceFloor(
        payload({
          revoked: { current: T(19, 30000, 15), previous: ZERO },
          byProduct: [
            product(PA, T(8, 12000, 8)),
            product(PB, T(9, 9000, 6)),
            product(PC, T(2, 9000, 1)),
          ],
        }),
      );
      expect(leaking.products[PA]?.revoked).toEqual({
        belowFloor: false,
        orders: 8,
        cents: 12000,
        buyers: 8,
      });
      expect(leaking.products[PB]?.revoked).toBeNull();
      expect(leaking.products[PC]?.revoked).toEqual({ belowFloor: true });
      expect(
        remainder(
          leaking.revoked.current,
          Object.values(leaking.products).map((row) => row.revoked),
        ),
      ).not.toEqual({ orders: 2, cents: 9000 });

      const safe = applyFinanceFloor(
        payload({
          revoked: { current: T(14, 21000, 11), previous: ZERO },
          byProduct: [product(PA, T(8, 12000, 6)), product(PB, T(6, 9000, 5))],
        }),
      );
      expect(Object.values(safe.products).map((row) => row.revoked)).not.toContain(null);
    });

    it("leaves the smallest shown product out of a post's products when another is floored", () => {
      const floored = applyFinanceFloor(
        payload({
          contentSales: {
            posts: [
              {
                postId: POST,
                ...T(7, 13642, 6),
                products: [
                  { productId: PA, ...T(5, 5000, 5) },
                  { productId: PB, ...T(2, 8642, 1) },
                ],
              },
            ],
            total: T(7, 13642, 6),
          },
        }),
      );
      const [post] = floored.contentSales.posts;
      expect(post?.sales).toEqual({ belowFloor: false, orders: 7, cents: 13642, buyers: 6 });
      expect(post?.products).toEqual([{ productId: PB, sales: { belowFloor: true } }]);
      expect(
        remainder(post?.sales ?? null, post?.products.map((row) => row.sales) ?? []),
      ).not.toEqual({ orders: 2, cents: 8642 });
    });

    it('withholds an association total when it minus the shown posts or events gives a floored one back', () => {
      const floored = applyFinanceFloor(
        payload({
          contentSales: {
            posts: [
              { postId: POST, ...T(6, 6000, 5), products: [{ productId: PA, ...T(6, 6000, 5) }] },
              { postId: POST_2, ...T(2, 8642, 1), products: [{ productId: PB, ...T(2, 8642, 1) }] },
            ],
            total: T(8, 14642, 6),
          },
          eventSales: {
            events: [
              { eventId: EVENT, ...T(6, 11943, 6) },
              { eventId: EVENT_2, ...T(1, 1990, 1) },
            ],
            total: T(7, 13933, 7),
          },
        }),
      );
      expect(floored.contentSales.total).toBeNull();
      expect(floored.contentSales.posts.map((post) => post.postId)).toEqual([POST, POST_2]);
      expect(floored.eventSales.total).toBeNull();
      expect(floored.eventSales.events.map((event) => event.eventId)).toEqual([EVENT, EVENT_2]);
      expect(JSON.stringify(floored.contentSales)).not.toContain('14642');
      expect(JSON.stringify(floored.eventSales)).not.toContain('13933');
    });

    it('keeps an association total whose posts are all shown', () => {
      const floored = applyFinanceFloor(
        payload({
          contentSales: {
            posts: [
              { postId: POST, ...T(6, 6000, 5), products: [{ productId: PA, ...T(6, 6000, 5) }] },
            ],
            total: T(6, 6000, 5),
          },
        }),
      );
      expect(floored.contentSales.total).toEqual({
        belowFloor: false,
        orders: 6,
        cents: 6000,
        buyers: 5,
      });
    });
  });

  describe('floorSummary (WR-06)', () => {
    it('floors the D-30 rebought group of 1-4 and drops its median days with it; current stays', () => {
      const summary = floorSummary({
        current: { base: 40, rebought: 3, timeToSecondDays: 9, lifetimeCents: 99000 },
        previous: { base: 30, rebought: 1, timeToSecondDays: 20, lifetimeCents: 50000 },
      });
      expect(summary.current).toEqual({
        base: 40,
        rebought: 3,
        timeToSecondDays: 9,
        lifetimeCents: 99000,
      });
      expect(summary.previous).toEqual({
        base: 30,
        rebought: { belowFloor: true },
        timeToSecondDays: null,
        lifetimeCents: 50000,
      });
      expect(JSON.stringify(summary.previous)).not.toContain('20');
    });

    it('shows a D-30 group of 0 or of 5 and more with its median days', () => {
      expect(
        floorSummary({
          current: { base: 40, rebought: 6, timeToSecondDays: 9, lifetimeCents: 99000 },
          previous: { base: 30, rebought: 5, timeToSecondDays: 12.5, lifetimeCents: 50000 },
        }).previous,
      ).toEqual({
        base: 30,
        rebought: { belowFloor: false, value: 5 },
        timeToSecondDays: 12.5,
        lifetimeCents: 50000,
      });
      expect(
        floorSummary({
          current: { base: 40, rebought: 0, timeToSecondDays: null, lifetimeCents: 0 },
          previous: { base: 30, rebought: 0, timeToSecondDays: null, lifetimeCents: 0 },
        }).previous.rebought,
      ).toEqual({ belowFloor: false, value: 0 });
    });
  });

  it('is pure: the same payload floors to the same answer twice', () => {
    expect(applyFinanceFloor(payload())).toEqual(applyFinanceFloor(payload()));
  });
});
