import { describe, expect, it } from 'vitest';
import type { EngagementBand, OwnerMemberInsights } from '../fixtures';
import {
  classifyOrders,
  ownerFinanceOrders,
  ownerMemberInsights,
  tenantOwnerPanel,
} from '../fixtures';
import { ownerBandRoster, PREVIEW_TODAY } from '../fixtures/owner-members';
import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';

/**
 * Quick 261012-qer B-3: one member's insights, built from the roster row. Every number agrees with
 * the member's band, dates and registrations, and the whole roster stays within the panel totals
 * (event check-ins, VIP orders, support conversations).
 */

const { events, support, byCommunity } = tenantOwnerPanel;
const DAY_MS = 86_400_000;

function daysSince(isoDate: string): number {
  return Math.round(
    (Date.parse(`${PREVIEW_TODAY}T00:00:00Z`) - Date.parse(`${isoDate}T00:00:00Z`)) / DAY_MS,
  );
}

function plusDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function insightsOf(id: string): OwnerMemberInsights {
  const insights = ownerMemberInsights(id);
  if (!insights) throw new Error(`no insights for ${id}`);
  return insights;
}

const ALL = ownerBandRoster.map((row) => ({ row, insights: insightsOf(row.id) }));
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const ACTIVE: readonly EngagementBand[] = ['superfan', 'engaged', 'occasional'];

describe('ownerMemberInsights', () => {
  it('is null for an id outside the roster', () => {
    expect(ownerMemberInsights('om-99')).toBeNull();
    expect(ownerMemberInsights('')).toBeNull();
  });

  it('is deterministic', () => {
    for (const { row } of ALL) expect(ownerMemberInsights(row.id)).toEqual(insightsOf(row.id));
  });

  it('heads with the roster row', () => {
    for (const { row, insights } of ALL) {
      expect(insights.id).toBe(row.id);
      expect(insights.name).toBe(row.name);
      expect(insights.band).toBe(row.band);
      expect(insights.memberSince).toBe(row.memberSince);
      expect(insights.lastActive).toEqual(row.lastActive);
      expect(insights.topCommunityId).toBe(row.topCommunityId);
    }
  });
});

describe('the last 30 days', () => {
  it('fit the band rules', () => {
    for (const { row, insights } of ALL) {
      const { activeDays, strongActions } = insights.last30;
      const where = `${row.id} ${row.band}`;
      switch (row.band) {
        case 'superfan':
          expect(activeDays, where).toBeGreaterThanOrEqual(12);
          expect(strongActions, where).toBeGreaterThanOrEqual(3);
          break;
        case 'engaged':
          expect(activeDays, where).toBeGreaterThanOrEqual(4);
          expect(activeDays, where).toBeLessThanOrEqual(11);
          break;
        case 'occasional':
          expect(activeDays, where).toBeGreaterThanOrEqual(1);
          expect(activeDays, where).toBeLessThanOrEqual(3);
          break;
        case 'new':
          expect(activeDays, where).toBeGreaterThanOrEqual(1);
          break;
        default:
          expect(activeDays, where).toBe(0);
      }
    }
  });

  it('count strong actions as comments, check-ins and orders (members cannot post in V1)', () => {
    for (const { row, insights } of ALL) {
      const { comments, checkIns, orders, strongActions } = insights.last30;
      expect(strongActions, row.id).toBe(comments + checkIns + orders);
    }
  });

  it('are all zero for em risco and inativos', () => {
    for (const { row, insights } of ALL) {
      if (row.band !== 'at_risk' && row.band !== 'inactive') continue;
      const { activeDays, likes, comments, checkIns, orders, strongActions } = insights.last30;
      expect([activeDays, likes, comments, checkIns, orders, strongActions], row.id).toEqual([
        0, 0, 0, 0, 0, 0,
      ]);
    }
  });

  it('hold a realistic number of comments per band (quick 261013-uoi C-1)', () => {
    const range: Record<EngagementBand, readonly [number, number]> = {
      superfan: [6, 12],
      engaged: [3, 8],
      occasional: [1, 3],
      new: [0, 3],
      at_risk: [0, 0],
      inactive: [0, 0],
    };
    const formula: Record<EngagementBand, (j: number) => number> = {
      new: (j) => j % 3,
      superfan: (j) => 6 + (j % 4),
      engaged: (j) => 3 + (j % 3),
      occasional: (j) => 1 + (j % 2),
      at_risk: () => 0,
      inactive: () => 0,
    };
    const byBand: Partial<Record<EngagementBand, number>> = {};
    for (const { row, insights } of ALL) {
      const { comments } = insights.last30;
      const [min, max] = range[row.band];
      expect(comments, row.id).toBeGreaterThanOrEqual(min);
      expect(comments, row.id).toBeLessThanOrEqual(max);
      const j = ownerBandRoster.filter((other) => other.band === row.band).indexOf(row);
      expect(comments, row.id).toBe(formula[row.band](j));
      byBand[row.band] = (byBand[row.band] ?? 0) + comments;
    }
    expect(byBand).toEqual({
      superfan: 90,
      engaged: 48,
      occasional: 18,
      new: 12,
      at_risk: 0,
      inactive: 0,
    });
    expect(sum(ALL.map(({ insights }) => insights.last30.comments))).toBe(168);
  });

  it('mark the daily time and the posts seen as examples', () => {
    for (const { row, insights } of ALL) {
      expect(insights.last30.dailyMinutes, row.id).toEqual(row.dailyMinutes);
      expect(insights.last30.postsSeen.example, row.id).toBe(true);
      if (insights.last30.postsSeen.example) {
        expect(insights.last30.postsSeen.reason, row.id).toBe('needs_post_views');
      }
    }
  });
});

describe('the active days per week', () => {
  it('hold 12 weeks of 0 to 7 days', () => {
    for (const { row, insights } of ALL) {
      expect(insights.weeklyActiveDays, row.id).toHaveLength(12);
      for (const days of insights.weeklyActiveDays) {
        expect(Number.isInteger(days) && days >= 0 && days <= 7, row.id).toBe(true);
      }
    }
  });

  it('end at the week of the last action', () => {
    for (const { row, insights } of ALL) {
      const weeks = insights.weeklyActiveDays;
      const back = Math.floor(row.lastActive.daysAgo / 7);
      if (row.lastActive.daysAgo > 83) {
        expect(
          weeks.every((days) => days === 0),
          row.id,
        ).toBe(true);
        continue;
      }
      expect(weeks[11 - back], row.id).toBeGreaterThan(0);
      expect(
        weeks.slice(12 - back).every((days) => days === 0),
        row.id,
      ).toBe(true);
    }
  });

  it('agree with the 30-day active days', () => {
    for (const { row, insights } of ALL) {
      const weeks = insights.weeklyActiveDays;
      expect(sum(weeks.slice(-4)), row.id).toBeLessThanOrEqual(insights.last30.activeDays);
      expect(insights.last30.activeDays, row.id).toBeLessThanOrEqual(sum(weeks.slice(-5)));
    }
  });

  it('are zero before the member joined', () => {
    for (const { row, insights } of ALL) {
      const joined = daysSince(row.memberSince);
      for (const [index, days] of insights.weeklyActiveDays.entries()) {
        const newestDayAgo = 7 * (11 - index);
        if (newestDayAgo > joined) expect(days, `${row.id} week ${index}`).toBe(0);
      }
    }
  });
});

describe('the band history', () => {
  it('reads 60 days ago, 30 days ago and today, ending in the roster band', () => {
    for (const { row, insights } of ALL) {
      expect(
        insights.bandHistory.map((entry) => entry.month),
        row.id,
      ).toEqual(['2026-08', '2026-09', 'today']);
      expect(insights.bandHistory[2]?.band, row.id).toBe(row.band);
    }
  });

  it('is null before the member joined, so every novo has none 60 days ago', () => {
    for (const { row, insights } of ALL) {
      const joined = daysSince(row.memberSince);
      expect(insights.bandHistory[0]?.band === null, row.id).toBe(joined < 60);
      expect(insights.bandHistory[1]?.band === null, row.id).toBe(joined < 30);
      if (row.band === 'new') expect(insights.bandHistory[0]?.band, row.id).toBeNull();
    }
  });

  it('shows em risco active a month ago, and inativos em risco or inactive', () => {
    for (const { row, insights } of ALL) {
      const before = insights.bandHistory[1]?.band;
      if (row.band === 'at_risk') expect(ACTIVE.includes(before ?? 'new'), row.id).toBe(true);
      if (row.band === 'inactive') expect(['at_risk', 'inactive'], row.id).toContain(before);
    }
  });
});

describe('where the member interacts', () => {
  it('covers every community they can access, the top one strictly first', () => {
    for (const { row, insights } of ALL) {
      const ids = insights.communities.map((entry) => entry.id);
      expect([...ids].sort(), row.id).toEqual(Object.keys(row.communities).sort());
      expect(ids[0], row.id).toBe(row.topCommunityId);
      const actions = insights.communities.map((entry) => entry.actions);
      expect(
        [...actions].sort((a, b) => b - a),
        row.id,
      ).toEqual(actions);
      for (const value of actions.slice(1)) {
        expect(value, row.id).toBeLessThan(actions[0] ?? 0);
      }
      for (const id of ids) expect(byCommunity.some((community) => community.id === id)).toBe(true);
    }
  });

  it('never counts fewer actions since joining than in the last 30 days (quick 261013-orf)', () => {
    for (const { row, insights } of ALL) {
      const { likes, comments, checkIns, orders } = insights.last30;
      expect(insights.communities[0]?.actions ?? 0, row.id).toBeGreaterThanOrEqual(
        likes + comments + checkIns + orders,
      );
    }
  });

  it('ranks the four post types', () => {
    for (const { row, insights } of ALL) {
      const types = insights.postTypes.map((entry) => entry.type);
      expect([...types].sort(), row.id).toEqual(['gallery', 'link', 'text', 'video']);
      const values = insights.postTypes.map((entry) => entry.interactions);
      expect(
        [...values].sort((a, b) => b - a),
        row.id,
      ).toEqual(values);
    }
  });
});

describe('events', () => {
  const past = new Map(events.past.map((event) => [event.id, event]));

  it('lists the member’s registrations, attended only for past ones', () => {
    for (const { row, insights } of ALL) {
      expect(
        insights.events.map((entry) => entry.id),
        row.id,
      ).toEqual(row.eventIds);
      for (const entry of insights.events) {
        const event = past.get(entry.id);
        if (!event) {
          expect(entry.attended, `${row.id} ${entry.id}`).toBeNull();
          continue;
        }
        expect(typeof entry.attended, `${row.id} ${entry.id}`).toBe('boolean');
        if (entry.attended) {
          expect(['at_risk', 'inactive'], row.id).not.toContain(row.band);
          expect(row.lastActive.daysAgo, row.id).toBeLessThanOrEqual(daysSince(event.date));
        }
      }
    }
  });

  it('counts the attended events as the 30-day check-ins, each in an active week', () => {
    for (const { row, insights } of ALL) {
      const attended = insights.events.filter((entry) => entry.attended === true);
      expect(insights.last30.checkIns, row.id).toBe(attended.length);
      for (const entry of attended) {
        const event = past.get(entry.id);
        if (!event) throw new Error(`attended a non-past event ${entry.id}`);
        const week = Math.floor(daysSince(event.date) / 7);
        expect(insights.weeklyActiveDays[11 - week], `${row.id} ${entry.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('never puts more roster members at an event than its check-ins', () => {
    for (const event of events.past) {
      const attendees = ALL.filter(({ insights }) =>
        insights.events.some((entry) => entry.id === event.id && entry.attended === true),
      ).length;
      expect(attendees, event.id).toBeLessThanOrEqual(event.checkIns);
    }
    expect(ALL.some(({ insights }) => insights.last30.checkIns > 0)).toBe(true);
  });
});

describe('purchases (quick 261014-dwc D-02, D-03)', () => {
  const kinds = classifyOrders(ownerFinanceOrders);

  it('are the member’s paid orders of the single ledger, oldest first', () => {
    for (const { row, insights } of ALL) {
      const ledger = ownerFinanceOrders
        .filter((order) => order.memberId === row.id && order.status === 'paid')
        .sort((a, b) => b.daysAgo - a.daysAgo);
      expect(
        insights.purchases.map((purchase) => [
          purchase.productId,
          purchase.offerId,
          purchase.kind,
          purchase.date,
          purchase.cents,
        ]),
        row.id,
      ).toEqual(
        ledger.map((order) => [
          order.productId,
          order.offerId,
          kinds.get(order.id),
          plusDays(PREVIEW_TODAY, -order.daysAgo),
          order.cents,
        ]),
      );
    }
  });

  it('start with the entry, on the joining day, and hold the VIP exactly with VIP access', () => {
    for (const { row, insights } of ALL) {
      const [entry] = insights.purchases;
      expect(entry?.kind, row.id).toBe('primary');
      expect(entry?.date, row.id).toBe(row.memberSince);
      const vip = insights.purchases.filter((purchase) => purchase.productId === 's2');
      expect(vip, row.id).toHaveLength(row.communities['c-vip'] ? 1 : 0);
      for (const purchase of insights.purchases) {
        expect(daysSince(purchase.date), row.id).toBeGreaterThanOrEqual(row.lastActive.daysAgo);
      }
    }
  });

  it('end the access a year after an entry or a VIP purchase, as an example; never otherwise', () => {
    for (const { row, insights } of ALL) {
      for (const purchase of insights.purchases) {
        const yearly = purchase.kind === 'primary' || purchase.productId === 's2';
        expect(purchase.expiresAt, row.id).toEqual(
          yearly
            ? {
                example: true,
                reason: 'needs_access_expiry',
                value: plusDays(purchase.date, 365),
              }
            : null,
        );
      }
    }
  });

  it('count the 30-day orders: at most one per member', () => {
    let recent = 0;
    for (const { row, insights } of ALL) {
      const within = insights.purchases.filter((purchase) => daysSince(purchase.date) < 30);
      expect(insights.last30.orders, row.id).toBe(within.length);
      expect(within.length, row.id).toBeLessThanOrEqual(1);
      recent += within.length;
    }
    expect(recent).toBeGreaterThan(0);
    expect(recent).toBeLessThanOrEqual(126);
  });
});

describe('support', () => {
  const medians = support.firstResponse.weeklyMedianMinutes;

  it('holds counts and dates only, never message text', () => {
    for (const { row, insights } of ALL) {
      expect(Object.keys(insights.support).sort(), row.id).toEqual([
        'conversations',
        'lastDaysAgo',
        'medianResponseMinutes',
      ]);
      const { conversations, lastDaysAgo, medianResponseMinutes } = insights.support;
      if (conversations === 0) {
        expect(lastDaysAgo, row.id).toBeNull();
        expect(medianResponseMinutes, row.id).toBeNull();
        continue;
      }
      expect(lastDaysAgo, row.id).not.toBeNull();
      expect(lastDaysAgo ?? Number.NaN, row.id).toBeLessThan(56);
      expect(lastDaysAgo ?? Number.NaN, row.id).toBeLessThanOrEqual(daysSince(row.memberSince));
      expect(medianResponseMinutes ?? Number.NaN, row.id).toBeGreaterThanOrEqual(
        Math.min(...medians),
      );
      expect(medianResponseMinutes ?? Number.NaN, row.id).toBeLessThanOrEqual(Math.max(...medians));
    }
  });

  it('stays within the 8 weeks of support conversations', () => {
    const total = sum(ALL.map(({ insights }) => insights.support.conversations));
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(sum(support.weeklyConversations));
  });
});

describe('the suggestion', () => {
  it('follows the band, with the days since joining (novos) or since the last action', () => {
    for (const { row, insights } of ALL) {
      expect(insights.suggestion, row.id).toEqual({
        kind: row.band,
        days: row.band === 'new' ? daysSince(row.memberSince) : row.lastActive.daysAgo,
      });
    }
    expect(new Set(ALL.map(({ insights }) => insights.suggestion.kind))).toEqual(
      new Set(ENGAGEMENT_BAND_ORDER),
    );
  });
});
