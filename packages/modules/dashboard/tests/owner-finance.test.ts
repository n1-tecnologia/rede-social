import { describe, expect, it } from 'vitest';
import {
  buildOwnerFinanceLedger,
  classifyOrders,
  type EngagementBand,
  FINANCE_OFFERS,
  type FinanceOfferId,
  type FinanceOrder,
  type FinancePeopleList,
  financeOffer,
  financeProductOffers,
  ownerContentDetail,
  ownerFinanceAttention,
  ownerFinanceBands,
  ownerFinanceContentSales,
  ownerFinanceEventSales,
  ownerFinanceIncludes,
  ownerFinanceMembers,
  ownerFinanceNeverAgain,
  ownerFinanceOrders,
  ownerFinancePaths,
  ownerFinancePeople,
  ownerFinanceProductDetail,
  ownerFinanceSummary,
  ownerFinanceVipUsage,
  ownerFinanceWeekly,
  ownerFinanceWindow,
  tenantOwnerPanel,
} from '../fixtures';
import { daysSince, ownerBandRoster } from '../fixtures/owner-members';
import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';

/**
 * Quick 261014-dwc: the Financeiro's single order ledger. Every total the panel, the member insights
 * and Conteúdo show comes from this one list, so these tests prove the sums (D-02) and the planner's
 * targets (PD-1..PD-6).
 */

const { engagement, growth, kpis, store, channels, communityEngagement } = tenantOwnerPanel;

const MEMBERS = new Map(ownerFinanceMembers.map((member) => [member.id, member]));
const PAID = ownerFinanceOrders.filter((order) => order.status === 'paid');
const KINDS = classifyOrders(ownerFinanceOrders);
const ROSTER = new Map(ownerBandRoster.map((row) => [row.id, row]));

function memberOf(order: FinanceOrder) {
  const member = MEMBERS.get(order.memberId);
  if (!member) throw new Error(`no member ${order.memberId}`);
  return member;
}

function paidOf(memberId: string): FinanceOrder[] {
  return PAID.filter((order) => order.memberId === memberId);
}

const inWindow = (order: FinanceOrder, from: number, to: number) =>
  order.daysAgo >= from && order.daysAgo <= to;

describe('the base (PD-5)', () => {
  it('holds the 1.240 members with unique ids, the bands of the panel', () => {
    expect(ownerFinanceMembers).toHaveLength(1240);
    expect(new Set(ownerFinanceMembers.map((member) => member.id)).size).toBe(1240);
    for (const band of ENGAGEMENT_BAND_ORDER) {
      expect(ownerFinanceMembers.filter((member) => member.band === band).length, band).toBe(
        engagement.counts[band],
      );
    }
  });

  it('holds the 72 roster members with their band and joining day, and 1.168 without a name', () => {
    for (const row of ownerBandRoster) {
      const member = MEMBERS.get(row.id);
      expect(member?.band, row.id).toBe(row.band);
      expect(member?.joinedDaysAgo, row.id).toBe(daysSince(row.memberSince));
    }
    const others = ownerFinanceMembers.filter((member) => !ROSTER.has(member.id));
    expect(others).toHaveLength(1168);
    for (const member of others) {
      expect(member.id).toMatch(/^ob-\d{4}$/);
      expect(Object.keys(member).sort()).toEqual(['band', 'id', 'joinedDaysAgo']);
    }
  });

  it('is deterministic', () => {
    expect(buildOwnerFinanceLedger()).toEqual({
      members: ownerFinanceMembers,
      orders: ownerFinanceOrders,
    });
  });

  it('puts novos under 30 days, em risco from 31 and inativos from 61', () => {
    for (const member of ownerFinanceMembers) {
      if (member.band === 'new') expect(member.joinedDaysAgo, member.id).toBeLessThan(30);
      else expect(member.joinedDaysAgo, member.id).toBeGreaterThanOrEqual(30);
      if (member.band === 'at_risk') {
        expect(member.joinedDaysAgo, member.id).toBeGreaterThanOrEqual(31);
      }
      if (member.band === 'inactive') {
        expect(member.joinedDaysAgo, member.id).toBeGreaterThanOrEqual(61);
      }
    }
  });
});

describe('primary and secondary revenue (D-02, D-03, D-05, PD-18)', () => {
  it('gives every member exactly one primary order: the first paid one, on the joining day', () => {
    for (const member of ownerFinanceMembers) {
      const paid = paidOf(member.id);
      const primaries = paid.filter((order) => KINDS.get(order.id) === 'primary');
      expect(primaries, member.id).toHaveLength(1);
      const [primary] = primaries;
      expect(primary?.daysAgo, member.id).toBe(member.joinedDaysAgo);
      expect(financeOffer(primary?.offerId ?? '').kind, member.id).toBe('entry');
      for (const order of paid) {
        expect(order.daysAgo, order.id).toBeLessThanOrEqual(member.joinedDaysAgo);
      }
    }
  });

  it('classifies a renewal (same member, same product, 365 days later) as secondary', () => {
    const entry: FinanceOrder = {
      id: 'x-1',
      memberId: 'x',
      offerId: 'vip-entrada',
      productId: 's2',
      cents: 24700,
      daysAgo: 400,
      status: 'paid',
    };
    const renewal: FinanceOrder = {
      ...entry,
      id: 'x-2',
      offerId: 'vip-adicional',
      cents: 19700,
      daysAgo: 35,
    };
    const kinds = classifyOrders([renewal, entry]);
    expect(kinds.get('x-1')).toBe('primary');
    expect(kinds.get('x-2')).toBe('secondary');
  });

  it('never makes a revoked order primary, nor counts it', () => {
    const revoked = ownerFinanceOrders.filter((order) => order.status === 'revoked');
    expect(revoked.length).toBeGreaterThan(0);
    for (const order of revoked) expect(KINDS.has(order.id), order.id).toBe(false);
    const kinds = classifyOrders([
      {
        id: 'y-1',
        memberId: 'y',
        offerId: 'ebook-entrada',
        productId: 's3',
        cents: 1700,
        daysAgo: 50,
        status: 'revoked',
      },
      {
        id: 'y-2',
        memberId: 'y',
        offerId: 'ebook-entrada',
        productId: 's3',
        cents: 1700,
        daysAgo: 40,
        status: 'paid',
      },
    ]);
    expect(kinds.has('y-1')).toBe(false);
    expect(kinds.get('y-2')).toBe('primary');
  });

  it('prices every order at its offer, and the offers at PD-2', () => {
    expect(
      FINANCE_OFFERS.map((offer) => [offer.id, offer.productId, offer.kind, offer.priceCents]),
    ).toEqual([
      ['ebook-entrada', 's3', 'entry', 1700],
      ['vip-entrada', 's2', 'entry', 24700],
      ['ebook-adicional', 's3', 'addon', 2700],
      ['vip-adicional', 's2', 'addon', 19700],
      ['mentoria-adicional', 's1', 'addon', 49000],
      ['workshop-adicional', 's4', 'addon', 9700],
    ]);
    for (const order of ownerFinanceOrders) {
      const offer = financeOffer(order.offerId);
      expect(order.cents, order.id).toBe(offer.priceCents);
      expect(order.productId, order.id).toBe(offer.productId);
    }
    expect(financeProductOffers('s2').map((offer) => offer.id)).toEqual([
      'vip-entrada',
      'vip-adicional',
    ]);
    expect(() => financeOffer('xyz')).toThrow();
    expect(() => financeProductOffers('xyz')).toThrow();
  });
});

describe('entries (D-02)', () => {
  it('match the weekly joins, and the 96 novos of the month', () => {
    const primaries = PAID.filter((order) => KINDS.get(order.id) === 'primary');
    const weekly = Array.from({ length: 12 }, (_, i) => {
      const weeksBack = 11 - i;
      return primaries.filter((order) => inWindow(order, 7 * weeksBack, 7 * weeksBack + 6)).length;
    });
    expect(weekly).toEqual(growth.weeklyJoined);
    const month = primaries.filter((order) => inWindow(order, 0, 29)).length;
    expect(month).toBe(96);
    expect(month).toBe(engagement.counts.new);
    expect(month).toBe(kpis.members.newMembers);
    expect(month).toBe(growth.joined);
  });
});

describe('the last 30 days (PD-3)', () => {
  const month = ownerFinanceWindow(0, 29);

  it('split by offer', () => {
    const byOffer = Object.fromEntries(
      FINANCE_OFFERS.map((offer) => [
        offer.id,
        [month.byOffer[offer.id].orders, month.byOffer[offer.id].cents],
      ]),
    );
    expect(byOffer).toEqual({
      'vip-entrada': [11, 271700],
      'ebook-entrada': [85, 144500],
      'mentoria-adicional': [6, 294000],
      'vip-adicional': [7, 137900],
      'ebook-adicional': [17, 45900],
      'workshop-adicional': [0, 0],
    });
  });

  it('add up to 96 entries and 30 add-on purchases: 126 orders and R$ 8.940,00', () => {
    expect(month.primary).toEqual({ orders: 96, cents: 416200 });
    expect(month.secondary).toEqual({ orders: 30, cents: 477800 });
    expect(month.total.orders).toBe(126);
    expect(month.total.cents).toBe(894000);
    expect(month.revoked.orders).toBe(2);
    expect(Math.round((100 * month.secondary.cents) / month.total.cents)).toBe(53);
    expect(Math.round(month.primary.cents / month.primary.orders)).toBe(4335);
  });

  it('split by product', () => {
    const byProduct = Object.fromEntries(
      ['s2', 's1', 's3', 's4'].map((id) => [
        id,
        [month.byProduct[id]?.orders, month.byProduct[id]?.cents],
      ]),
    );
    expect(byProduct).toEqual({
      s2: [18, 409600],
      s1: [6, 294000],
      s3: [102, 190400],
      s4: [0, 0],
    });
  });

  it('split by today’s band (PD-4)', () => {
    const byBand = Object.fromEntries(
      ENGAGEMENT_BAND_ORDER.map((band) => [
        band,
        [month.byBand[band].orders, month.byBand[band].cents],
      ]),
    );
    expect(byBand).toEqual({
      new: [99, 475300],
      superfan: [10, 212200],
      engaged: [11, 173300],
      occasional: [6, 33200],
      at_risk: [0, 0],
      inactive: [0, 0],
    });
  });

  it('cancel one VIP add-on and one Mentoria, out of the revenue', () => {
    const revoked = ownerFinanceOrders.filter(
      (order) => order.status === 'revoked' && inWindow(order, 0, 29),
    );
    expect(revoked.map((order) => order.offerId).sort()).toEqual([
      'mentoria-adicional',
      'vip-adicional',
    ]);
  });

  it('agree with the panel: the order value, the products and the orders channel (PD-1)', () => {
    expect(kpis.orderValue.cents).toBe(month.total.cents);
    for (const product of store.products) {
      expect([product.orders, product.cents], product.id).toEqual([
        month.byProduct[product.id]?.orders,
        month.byProduct[product.id]?.cents,
      ]);
    }
    expect(channels.find((row) => row.channel === 'orders')?.count).toBe(126);
  });

  it('closes the 30 days before at a total that makes the +12%', () => {
    const before = ownerFinanceWindow(30, 59);
    expect(before.total.cents).toBeGreaterThanOrEqual(794700);
    expect(before.total.cents).toBeLessThanOrEqual(801700);
    expect(Math.round((100 * (month.total.cents - before.total.cents)) / before.total.cents)).toBe(
      12,
    );
  });
});

describe('the ledger’s rules', () => {
  const vipOwners = (band: EngagementBand) =>
    ownerFinanceMembers.filter(
      (member) =>
        member.band === band &&
        paidOf(member.id).some((order) => order.productId === 's2' && order.daysAgo < 365),
    ).length;

  it('owns the VIP as the VIP community counts it (186)', () => {
    const vip = communityEngagement.find((row) => row.id === 'c-vip');
    for (const band of ENGAGEMENT_BAND_ORDER) {
      expect(vipOwners(band), band).toBe(vip?.bands.counts[band]);
    }
  });

  it('gives a roster member exactly one paid VIP order when they have VIP access', () => {
    for (const row of ownerBandRoster) {
      const vip = paidOf(row.id).filter((order) => order.productId === 's2');
      expect(vip, row.id).toHaveLength(row.communities['c-vip'] ? 1 : 0);
    }
  });

  it('sells each product to a member at most once', () => {
    const seen = new Set<string>();
    for (const order of PAID) {
      const key = `${order.memberId}:${order.productId}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('keeps the 30-day orders to active bands, em risco from 31 days and inativos from 61', () => {
    for (const order of ownerFinanceOrders) {
      const { band } = memberOf(order);
      if (order.daysAgo < 30) expect(['new', 'superfan', 'engaged', 'occasional']).toContain(band);
      if (band === 'at_risk') expect(order.daysAgo, order.id).toBeGreaterThanOrEqual(31);
      if (band === 'inactive') expect(order.daysAgo, order.id).toBeGreaterThanOrEqual(61);
    }
  });

  it('sold the Workshop gravado, last over 60 days ago', () => {
    const workshop = PAID.filter((order) => order.productId === 's4');
    expect(workshop.length).toBeGreaterThan(0);
    expect(Math.min(...workshop.map((order) => order.daysAgo))).toBeGreaterThan(60);
  });

  it('ends exactly 6 accesses in the next 7 days, all VIP entries, the first 6 members', () => {
    const ending = PAID.filter(
      (order) => KINDS.get(order.id) === 'primary' && order.daysAgo >= 358 && order.daysAgo <= 364,
    );
    expect(ending).toHaveLength(6);
    for (const order of ending) expect(order.offerId).toBe('vip-entrada');
    expect(ownerFinanceMembers.filter((member) => member.joinedDaysAgo >= 358).length).toBe(6);
  });

  it('meets the planner’s lifetime targets: who bought again, when, and the ladder', () => {
    const again = ownerFinanceMembers.filter((member) => paidOf(member.id).length >= 2);
    const share = again.length / ownerFinanceMembers.length;
    expect(share).toBeGreaterThanOrEqual(0.15);
    expect(share).toBeLessThanOrEqual(0.25);
    const gaps = again.map((member) => {
      const [first, second] = [...paidOf(member.id)].sort((a, b) => b.daysAgo - a.daysAgo);
      return (first?.daysAgo ?? 0) - (second?.daysAgo ?? 0);
    });
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    expect(average).toBeGreaterThanOrEqual(20);
    expect(average).toBeLessThanOrEqual(60);
    const paths = new Map<string, number>();
    for (const member of again) {
      const [first, second] = [...paidOf(member.id)].sort((a, b) => b.daysAgo - a.daysAgo);
      const key = `${first?.offerId}>${second?.offerId}`;
      paths.set(key, (paths.get(key) ?? 0) + 1);
    }
    const counts = [...paths.values()];
    expect(counts.filter((count) => count >= 5).length).toBeGreaterThanOrEqual(3);
    expect(counts.filter((count) => count < 5).length).toBeGreaterThanOrEqual(1);
  });
});

describe('the roster’s orders (PD-6)', () => {
  const month = ownerFinanceOrders.filter(
    (order) => order.status === 'paid' && inWindow(order, 0, 29),
  );
  const rosterMonth = month.filter((order) => ROSTER.has(order.memberId));

  it('stays within the base in every offer and band', () => {
    for (const offer of FINANCE_OFFERS) {
      for (const band of ENGAGEMENT_BAND_ORDER) {
        const of = (rows: FinanceOrder[]) =>
          rows.filter((order) => order.offerId === offer.id && memberOf(order).band === band)
            .length;
        expect(of(rosterMonth), `${offer.id} ${band}`).toBeLessThanOrEqual(of(month));
      }
    }
  });

  it('has a roster buyer for every offer sold in the month', () => {
    for (const offer of FINANCE_OFFERS) {
      if (!month.some((order) => order.offerId === offer.id)) continue;
      expect(
        rosterMonth.some((order) => order.offerId === offer.id),
        offer.id,
      ).toBe(true);
    }
  });

  it('buys at most once a month, on the last active day (novos: on joining)', () => {
    for (const row of ownerBandRoster) {
      const orders = rosterMonth.filter((order) => order.memberId === row.id);
      expect(orders.length, row.id).toBeLessThanOrEqual(1);
      const [order] = orders;
      if (!order) continue;
      const day = row.band === 'new' ? daysSince(row.memberSince) : row.lastActive.daysAgo;
      expect(order.daysAgo, row.id).toBe(day);
    }
  });

  it('puts older add-on purchases 90 days back or more, never after the last action', () => {
    for (const order of PAID) {
      const row = ROSTER.get(order.memberId);
      if (!row || KINDS.get(order.id) !== 'secondary' || order.daysAgo < 30) continue;
      expect(order.daysAgo, order.id).toBeGreaterThanOrEqual(90);
      expect(order.daysAgo, order.id).toBeGreaterThanOrEqual(row.lastActive.daysAgo);
    }
  });
});

describe('ownerFinancePeople (D-11: the one web file that reads it lists names)', () => {
  const offerIds: FinanceOfferId[] = FINANCE_OFFERS.map((offer) => offer.id);

  it('lists the VIP entry’s roster buyers, most recent first, out of 11', () => {
    const { people, total } = ownerFinancePeople({ kind: 'offer', offerId: 'vip-entrada' });
    expect(total).toBe(11);
    const expected = ownerBandRoster
      .filter((row) => row.band === 'new' && row.communities['c-vip'])
      .map((row) => row.id);
    expect(people.map((person) => person.id).sort()).toEqual([...expected].sort());
    for (const [i, person] of people.entries()) {
      const before = people[i - 1];
      if (before) expect(person.when.daysAgo).toBeGreaterThanOrEqual(before.when.daysAgo);
      expect(person.cents).toBe(24700);
      expect(person.offerId).toBe('vip-entrada');
      expect(person.band).toBe('new');
    }
  });

  it('holds exactly the members ownerFinanceIncludes says, each total its offer’s orders', () => {
    const month = ownerFinanceWindow(0, 29);
    for (const offerId of offerIds) {
      const list = { kind: 'offer', offerId } as const;
      const { people, total } = ownerFinancePeople(list);
      expect(total, offerId).toBe(month.byOffer[offerId].orders);
      const ids = new Set(people.map((person) => person.id));
      for (const row of ownerBandRoster) {
        expect(ownerFinanceIncludes(list, row.id), `${offerId} ${row.id}`).toBe(ids.has(row.id));
      }
    }
  });

  it('throws on an offer the fixture does not have', () => {
    expect(() => ownerFinancePeople({ kind: 'offer', offerId: 'xyz' as FinanceOfferId })).toThrow();
  });
});

describe('the overview numbers (quick 261014-dwc D-07, D-10)', () => {
  const today = ownerFinanceSummary(0);
  const before = ownerFinanceSummary(30);
  const change = (now: number, then: number) => Math.round((100 * (now - then)) / then);

  it('gives the six numbers of today', () => {
    expect(today.primary).toEqual({ orders: 96, cents: 416200 });
    expect(Math.round(today.primary.cents / today.primary.orders)).toBe(4335);
    expect(today.secondary).toEqual({ orders: 30, cents: 477800 });
    expect(today.total).toEqual({ orders: 126, cents: 894000 });
    expect(Math.round((100 * today.secondary.cents) / today.total.cents)).toBe(53);
    expect(today.base).toBe(1240);
    const again = ownerFinanceMembers.filter((member) => paidOf(member.id).length >= 2);
    expect(today.rebought).toBe(again.length);
    expect(today.timeToSecondDays).toBeGreaterThanOrEqual(20);
    expect(today.timeToSecondDays).toBeLessThanOrEqual(60);
    expect(today.lifetimeCents).toBe(PAID.reduce((sum, order) => sum + order.cents, 0));
  });

  it('computes the same numbers as if today were 30 days ago', () => {
    const then = (order: FinanceOrder) => order.daysAgo >= 30;
    const base = ownerFinanceMembers.filter((member) => member.joinedDaysAgo >= 30);
    const window = PAID.filter((order) => inWindow(order, 30, 59));
    expect(before.base).toBe(base.length);
    expect(before.total).toEqual({
      orders: window.length,
      cents: window.reduce((sum, order) => sum + order.cents, 0),
    });
    expect(before.rebought).toBe(
      base.filter((member) => paidOf(member.id).filter(then).length >= 2).length,
    );
    expect(before.lifetimeCents).toBe(
      PAID.filter(then).reduce((sum, order) => sum + order.cents, 0),
    );
    for (const summary of [today, before]) {
      expect(summary.primary.orders + summary.secondary.orders).toBe(summary.total.orders);
      expect(summary.primary.cents + summary.secondary.cents).toBe(summary.total.cents);
    }
  });

  it('moves the total +12%, the panel’s order value change, against the 30 days before', () => {
    expect(change(today.total.cents, before.total.cents)).toBe(12);
    expect(kpis.orderValue.delta).toEqual({
      amount: 12,
      kind: 'percent',
      direction: 'up',
      good: true,
      basis: 'previous_30_days',
    });
  });

  it('splits 12 weeks of primary and secondary revenue, and the 12 before', () => {
    const weekly = ownerFinanceWeekly();
    for (const series of [weekly.primary, weekly.secondary]) {
      expect(series.current).toHaveLength(12);
      expect(series.previous).toHaveLength(12);
    }
    const sumIn = (kind: 'primary' | 'secondary', weeksBack: number) =>
      PAID.filter(
        (order) =>
          KINDS.get(order.id) === kind && inWindow(order, 7 * weeksBack, 7 * weeksBack + 6),
      ).reduce((sum, order) => sum + order.cents, 0);
    for (let i = 0; i < 12; i += 1) {
      expect(weekly.primary.current[i], `primary ${i}`).toBe(sumIn('primary', 11 - i));
      expect(weekly.primary.previous[i], `primary before ${i}`).toBe(sumIn('primary', 23 - i));
      expect(weekly.secondary.current[i], `secondary ${i}`).toBe(sumIn('secondary', 11 - i));
      expect(weekly.secondary.previous[i], `secondary before ${i}`).toBe(
        sumIn('secondary', 23 - i),
      );
    }
    // An entry's week is its joining week: the weekly entries × their offers' prices.
    const entries = PAID.filter((order) => KINDS.get(order.id) === 'primary' && order.daysAgo < 84);
    expect(weekly.primary.current.reduce((sum, value) => sum + value, 0)).toBe(
      entries.reduce((sum, order) => sum + financeOffer(order.offerId).priceCents, 0),
    );
  });
});

describe('Precisa de atenção (D-07)', () => {
  const attention = ownerFinanceAttention();

  it('counts the VIP payers fading: 22 em risco + 18 inativos, 11 with push', () => {
    expect(attention.vipFading).toEqual({ atRisk: 22, inactive: 18, withPush: 11 });
  });

  it('ends 6 VIP accesses in 7 days, an example', () => {
    expect(attention.expiring).toEqual({
      example: true,
      reason: 'needs_access_expiry',
      value: { count: 6, productId: 's2' },
    });
  });

  it('flags the Workshop gravado, unsold for over 60 days', () => {
    const workshop = PAID.filter((order) => order.productId === 's4');
    const days = Math.min(...workshop.map((order) => order.daysAgo));
    expect(days).toBeGreaterThan(60);
    expect(attention.stalled).toEqual([{ productId: 's4', days }]);
  });

  it('points at the full Imersão with 17 waiting, from the waiting list example', () => {
    expect(attention.fullEvents).toEqual({
      example: true,
      reason: 'needs_waitlist',
      value: [{ eventId: 'u3', waiting: 17 }],
    });
  });
});

describe('what only the app knows (D-07)', () => {
  it('ties sales to publications as Conteúdo shows them: 12 distinct orders, R$ 1.807,00', () => {
    const sales = ownerFinanceContentSales();
    expect(sales.total).toEqual({ orders: 12, cents: 180700 });
    const counts = Object.fromEntries(sales.posts.map((post) => [post.postId, post.orders]));
    expect(counts).toEqual({ 'op-11': 6, 'op-15': 6, 'op-19': 3, 'op-41': 9, 'op-55': 2 });
    for (const post of sales.posts) {
      expect(ownerContentDetail(post.postId).orders, post.postId).toEqual({
        count: post.orders,
        cents: post.cents,
        products: post.products,
      });
      expect(post.orderIds, post.postId).toHaveLength(post.orders);
      for (const id of post.orderIds) {
        const order = ownerFinanceOrders.find((row) => row.id === id);
        expect(order?.status, id).toBe('paid');
        expect(order && KINDS.get(order.id), id).toBe('secondary');
        expect(order?.daysAgo ?? 99, id).toBeLessThan(30);
      }
    }
    expect(ownerContentDetail('op-22').orders.count).toBe(0);
  });

  it('ties sales to events: within 7 days after, never more than the check-ins', () => {
    const sales = ownerFinanceEventSales();
    const past = tenantOwnerPanel.events.past;
    expect(sales.events.map((row) => row.eventId).sort()).toEqual(
      past.map((event) => event.id).sort(),
    );
    const distinct = new Set<string>();
    let cents = 0;
    for (const row of sales.events) {
      const event = past.find((entry) => entry.id === row.eventId);
      const age = daysSince(event?.date ?? '');
      expect(row.orders, row.eventId).toBeLessThanOrEqual(event?.checkIns ?? 0);
      expect(row.orderIds, row.eventId).toHaveLength(row.orders);
      for (const id of row.orderIds) {
        const order = ownerFinanceOrders.find((entry) => entry.id === id);
        expect(order && KINDS.get(order.id), id).toBe('secondary');
        expect(order?.daysAgo ?? -1, id).toBeLessThanOrEqual(age);
        expect(order?.daysAgo ?? 99, id).toBeGreaterThanOrEqual(age - 7);
        if (!distinct.has(id)) cents += order?.cents ?? 0;
        distinct.add(id);
      }
    }
    expect(sales.total).toEqual({ orders: distinct.size, cents });
    // Pinned once built: 2 / 3 / 6 / 4 per event; an order after two events counts once.
    expect(sales.total).toEqual({ orders: 13, cents: 208000 });
  });

  it('puts the VIP revenue next to the VIP’s use', () => {
    expect(ownerFinanceVipUsage()).toEqual({ cents: 409600, activeWeek: 104, holders: 186 });
  });
});

describe('the lists behind the numbers (D-07, PD-11, PD-17)', () => {
  const today = ownerFinanceSummary(0);
  const lists: [FinancePeopleList, number][] = [
    [{ kind: 'primary' }, 96],
    [{ kind: 'secondary' }, 30],
    [{ kind: 'rebought' }, today.rebought],
    [{ kind: 'timeToSecond' }, today.rebought],
    [{ kind: 'lifetime' }, 1240],
    [{ kind: 'vipFading' }, 40],
    [{ kind: 'expiring' }, 6],
  ];

  it('total the number they open; ownerFinanceIncludes agrees with each list', () => {
    for (const [list, total] of lists) {
      const people = ownerFinancePeople(list);
      expect(people.total, list.kind).toBe(total);
      expect(people.people.length, list.kind).toBeLessThanOrEqual(total);
      const ids = new Set(people.people.map((person) => person.id));
      for (const row of ownerBandRoster) {
        expect(ownerFinanceIncludes(list, row.id), `${list.kind} ${row.id}`).toBe(ids.has(row.id));
      }
    }
  });

  it('names the month’s roster buyers, the fading VIP payers and nobody whose access ends', () => {
    expect(ownerFinancePeople({ kind: 'primary' }).people).toHaveLength(12);
    expect(ownerFinancePeople({ kind: 'secondary' }).people).toHaveLength(5);
    const fading = ownerFinancePeople({ kind: 'vipFading' }).people;
    expect(fading).toHaveLength(20);
    for (const person of fading) expect(['at_risk', 'inactive']).toContain(person.band);
    expect(ownerFinancePeople({ kind: 'expiring' }).people).toHaveLength(0);
    for (const person of ownerFinancePeople({ kind: 'timeToSecond' }).people) {
      const [first, second] = [...paidOf(person.id)].sort((a, b) => b.daysAgo - a.daysAgo);
      expect(person.days, person.id).toBe((first?.daysAgo ?? 0) - (second?.daysAgo ?? 0));
    }
    for (const person of ownerFinancePeople({ kind: 'lifetime' }).people) {
      expect(person.cents, person.id).toBe(
        paidOf(person.id).reduce((sum, order) => sum + order.cents, 0),
      );
    }
  });
});

describe('the last 7 days come from the same list (PD-7)', () => {
  const week = ownerFinanceWindow(0, 6);

  it('gives each product its 7-day orders, 45 in all', () => {
    const byProduct = Object.fromEntries(
      tenantOwnerPanel.store.products.map((row) => [row.id, week.byProduct[row.id]?.orders]),
    );
    expect(byProduct).toEqual({ s1: 3, s2: 7, s3: 35, s4: 0 });
    expect(week.total.orders).toBe(45);
  });

  it('moves the 7-day orders by this week against the week before (quick 261014-ia8 C-1)', () => {
    const previous = ownerFinanceWindow(7, 13);
    expect(previous.total.orders).toBe(29);
    const amount = week.total.orders - previous.total.orders;
    expect(amount).toBe(16);
  });
});

describe('Quem compra (quick 261014-dwc D-09, PD-4, PD-15)', () => {
  const bands = ownerFinanceBands();

  it('splits the month by today’s band, with buyers and their share of the band', () => {
    const rows = Object.fromEntries(
      ENGAGEMENT_BAND_ORDER.map((band) => [
        band,
        [bands[band].orders, bands[band].cents, bands[band].buyers, bands[band].members],
      ]),
    );
    expect(rows).toEqual({
      new: [99, 475300, 96, 96],
      superfan: [10, 212200, 10, 62],
      engaged: [11, 173300, 11, 205],
      occasional: [6, 33200, 6, 150],
      at_risk: [0, 0, 0, 168],
      inactive: [0, 0, 0, 559],
    });
    for (const band of ENGAGEMENT_BAND_ORDER) {
      if (bands[band].orders > 0) expect(bands[band].orders, band).toBeGreaterThanOrEqual(5);
    }
  });

  it('climbs the ladder: entry offer, second purchase, people and days, small paths last', () => {
    const { paths, others } = ownerFinancePaths();
    const again = ownerFinanceMembers.filter((member) => paidOf(member.id).length >= 2);
    expect(paths.reduce((sum, path) => sum + path.people, 0) + (others?.people ?? 0)).toBe(
      again.length,
    );
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths) {
      expect(path.people, `${path.entry}>${path.next}`).toBeGreaterThanOrEqual(5);
      expect(financeOffer(path.entry).kind).toBe('entry');
      expect(financeOffer(path.next).kind).toBe('addon');
      const members = again.filter((member) => {
        const [first, second] = paidOf(member.id);
        return first?.offerId === path.entry && second?.offerId === path.next;
      });
      expect(members.length).toBe(path.people);
      const gaps = members.map((member) => {
        const [first, second] = paidOf(member.id);
        return (first?.daysAgo ?? 0) - (second?.daysAgo ?? 0);
      });
      expect(path.averageDays).toBeCloseTo(gaps.reduce((s, g) => s + g, 0) / gaps.length, 6);
    }
    for (let i = 1; i < paths.length; i += 1) {
      expect(paths[i]?.people ?? 0).toBeLessThanOrEqual(paths[i - 1]?.people ?? 0);
    }
    expect(others).not.toBeNull();
    expect(others?.paths).toBeGreaterThanOrEqual(1);
  });

  it('counts who entered and never bought again, by band: with who did, the whole base', () => {
    const never = ownerFinanceNeverAgain();
    const total = ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + never[band], 0);
    expect(total + ownerFinanceSummary(0).rebought).toBe(1240);
    for (const band of ENGAGEMENT_BAND_ORDER) {
      expect(never[band], band).toBe(
        ownerFinanceMembers.filter(
          (member) => member.band === band && paidOf(member.id).length === 1,
        ).length,
      );
    }
  });

  it('lists a band’s month buyers and a band’s single buyers, with predicates', () => {
    for (const band of ENGAGEMENT_BAND_ORDER) {
      const buyers = ownerFinancePeople({ kind: 'band', band });
      expect(buyers.total, band).toBe(bands[band].buyers);
      const never = ownerFinancePeople({ kind: 'never', band });
      expect(never.total, band).toBe(ownerFinanceNeverAgain()[band]);
      for (const row of ownerBandRoster) {
        const inBand = buyers.people.some((person) => person.id === row.id);
        expect(ownerFinanceIncludes({ kind: 'band', band }, row.id), row.id).toBe(inBand);
        if (inBand) expect(row.band).toBe(band);
        const single = never.people.some((person) => person.id === row.id);
        expect(ownerFinanceIncludes({ kind: 'never', band }, row.id), row.id).toBe(single);
        if (single) expect(paidOf(row.id)).toHaveLength(1);
      }
    }
  });
});

describe('a product’s detail (D-08, PD-14)', () => {
  it('gives the VIP’s month, the month before, weeks, bands and the publications that sold it', () => {
    const vip = ownerFinanceProductDetail('s2');
    expect(vip.month).toMatchObject({ orders: 18, cents: 409600 });
    expect(vip.before.orders).toBe(ownerFinanceWindow(30, 59).byProduct.s2?.orders);
    expect(vip.revoked).toEqual({ orders: 1, cents: 19700 });
    expect(vip.weekly.current).toHaveLength(12);
    expect(vip.weekly.previous).toHaveLength(12);
    const sumBands = ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + vip.byBand[band].orders, 0);
    expect(sumBands).toBe(18);
    expect(ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + vip.byBand[band].cents, 0)).toBe(
      409600,
    );
    expect(vip.posts).toEqual([
      { postId: 'op-15', orders: 6, cents: 118200 },
      { postId: 'op-41', orders: 3, cents: 59100 },
      { postId: 'op-11', orders: 2, cents: 39400 },
    ]);
  });

  it('leaves the Workshop gravado at zero, with the days since its last sale', () => {
    const workshop = ownerFinanceProductDetail('s4');
    expect(workshop.month).toMatchObject({ orders: 0, cents: 0, buyers: 0 });
    expect(workshop.posts).toEqual([]);
    expect(workshop.lastSaleDaysAgo).toBe(74);
    expect(() => ownerFinanceProductDetail('xyz')).toThrow();
  });
});
