import { describe, expect, it } from 'vitest';
import type { EngagementBand, OwnerBandScope, RelativeMoment } from '../fixtures';
import {
  OWNER_BAND_LIST_LIMIT,
  ownerBandIncludes,
  ownerBandList,
  ownerScopeBands,
  tenantOwnerPanel,
} from '../fixtures';
import { ownerBandRoster, PREVIEW_TODAY } from '../fixtures/owner-members';
import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';

/**
 * Quick 261012-pkd D-02: the level-4 band lists. One roster feeds every scope, so a member never
 * reads more engaged in a community than in the whole base, and every list adds up to its band.
 */

const { engagement, communityEngagement, eventEngagement, byCommunity, events } = tenantOwnerPanel;
const ALL_EVENTS = [...events.upcoming, ...events.past];

/** Higher = more engaged; `new` sits apart (a novo is a novo in every scope). */
const LEVEL: Record<Exclude<EngagementBand, 'new'>, number> = {
  superfan: 4,
  engaged: 3,
  occasional: 2,
  at_risk: 1,
  inactive: 0,
};

function level(band: EngagementBand): number {
  return band === 'new' ? Number.NaN : LEVEL[band];
}

/** The days-ago window each band's last activity must fall in. */
function fitsWindow(band: EngagementBand, daysAgo: number): boolean {
  if (band === 'at_risk') return daysAgo >= 30 && daysAgo <= 59;
  if (band === 'inactive') return daysAgo >= 60;
  return daysAgo >= 0 && daysAgo <= 29;
}

function joinedDaysAgo(memberSince: string): number {
  return Math.round(
    (Date.parse(`${PREVIEW_TODAY}T00:00:00Z`) - Date.parse(`${memberSince}T00:00:00Z`)) /
      86_400_000,
  );
}

function scopeBands(scope: OwnerBandScope) {
  if (scope.kind === 'member') return engagement;
  const rows = scope.kind === 'community' ? communityEngagement : eventEngagement;
  const entry = rows.find((row) => row.id === scope.id);
  if (!entry) throw new Error(`no bands for ${scope.id}`);
  return entry.bands;
}

function scopeCount(scope: OwnerBandScope, band: EngagementBand): number {
  return scopeBands(scope).counts[band];
}

function scopeNewActivated(scope: OwnerBandScope): number {
  return scopeBands(scope).newActivated;
}

function scopeName(scope: OwnerBandScope): string {
  return scope.kind === 'member' ? 'all' : scope.id;
}

/** daysAgo asc, then time desc, then id asc. */
function compareRecency(
  a: { id: string; lastActive: RelativeMoment },
  b: { id: string; lastActive: RelativeMoment },
): number {
  return (
    a.lastActive.daysAgo - b.lastActive.daysAgo ||
    (b.lastActive.time ?? '').localeCompare(a.lastActive.time ?? '') ||
    a.id.localeCompare(b.id)
  );
}

const SCOPES: OwnerBandScope[] = [
  { kind: 'member' },
  ...byCommunity.map((row): OwnerBandScope => ({ kind: 'community', id: row.id })),
  ...ALL_EVENTS.map((row): OwnerBandScope => ({ kind: 'event', id: row.id })),
];

function rosterBand(memberId: string, scope: OwnerBandScope): EngagementBand | undefined {
  const member = ownerBandRoster.find((row) => row.id === memberId);
  if (!member) return undefined;
  if (scope.kind === 'member') return member.band;
  if (scope.kind === 'community') return member.communities[scope.id]?.band;
  return member.eventIds.includes(scope.id) ? member.band : undefined;
}

describe('the band roster', () => {
  it('holds 72 members, 12 per band, with unique ids and names', () => {
    expect(ownerBandRoster).toHaveLength(72);
    for (const band of ENGAGEMENT_BAND_ORDER) {
      expect(
        ownerBandRoster.filter((row) => row.band === band),
        band,
      ).toHaveLength(12);
    }
    expect(new Set(ownerBandRoster.map((row) => row.id)).size).toBe(72);
    expect(new Set(ownerBandRoster.map((row) => row.name)).size).toBe(72);
  });

  it('borrows no name from the staff or the team panel’s lists', () => {
    const taken = new Set([
      // The team panel's support queue and moderated comments (level 6 in the preview).
      'Ana Souza',
      'Rui Matos',
      'João P.',
      'Lia C.',
      'M. Vieira',
      ...tenantOwnerPanel.support.answeredByStaff.map((row) => row.name),
    ]);
    expect(taken.size).toBeGreaterThan(0);
    for (const row of ownerBandRoster) expect(taken.has(row.name), row.name).toBe(false);
  });

  it('dates everything from the sample’s today, before every next event (quick 261014-dwc)', () => {
    expect(PREVIEW_TODAY).toBe('2026-10-12');
    for (const event of tenantOwnerPanel.events.upcoming) {
      expect(event.date > PREVIEW_TODAY, event.id).toBe(true);
    }
  });
});

describe('each member, across scopes', () => {
  it('is new exactly when they joined under 30 days ago', () => {
    for (const row of ownerBandRoster) {
      expect(row.band === 'new', row.id).toBe(joinedDaysAgo(row.memberSince) < 30);
    }
  });

  it('joined before any activity, and the whole-base activity fits the band', () => {
    for (const row of ownerBandRoster) {
      const joined = joinedDaysAgo(row.memberSince);
      expect(joined, row.id).toBeGreaterThanOrEqual(row.lastActive.daysAgo);
      for (const entry of Object.values(row.communities)) {
        expect(joined, row.id).toBeGreaterThanOrEqual(entry.lastActive.daysAgo);
      }
      expect(fitsWindow(row.band, row.lastActive.daysAgo), row.id).toBe(true);
    }
  });

  it('has every open community, and VIP only with access', () => {
    for (const row of ownerBandRoster) {
      for (const community of byCommunity) {
        if (!community.exclusive) expect(row.communities[community.id], row.id).toBeDefined();
      }
      for (const id of Object.keys(row.communities)) {
        expect(
          byCommunity.some((community) => community.id === id),
          id,
        ).toBe(true);
      }
    }
    expect(ownerBandRoster.some((row) => row.communities['c-vip'] === undefined)).toBe(true);
    expect(ownerBandRoster.some((row) => row.communities['c-vip'] !== undefined)).toBe(true);
  });

  it('is never more engaged nor more recent in a community than in the whole base', () => {
    for (const row of ownerBandRoster) {
      for (const [id, entry] of Object.entries(row.communities)) {
        const where = `${row.id} ${id}`;
        expect(entry.band === 'new', where).toBe(row.band === 'new');
        if (row.band !== 'new') {
          expect(level(entry.band), where).toBeLessThanOrEqual(level(row.band));
        }
        expect(entry.lastActive.daysAgo, where).toBeGreaterThanOrEqual(row.lastActive.daysAgo);
        expect(fitsWindow(entry.band, entry.lastActive.daysAgo), where).toBe(true);
      }
    }
  });

  it('interacts most in a community where they keep their whole-base band', () => {
    for (const row of ownerBandRoster) {
      const top = row.communities[row.topCommunityId];
      expect(top, row.id).toBeDefined();
      expect(top?.band, row.id).toBe(row.band);
    }
  });
});

describe('ownerBandList', () => {
  it('lists at most 10 members of the band, most recent first, adding up to the count', () => {
    expect(OWNER_BAND_LIST_LIMIT).toBe(10);
    for (const scope of SCOPES) {
      for (const band of ENGAGEMENT_BAND_ORDER) {
        const where = `${scopeName(scope)} ${band}`;
        const count = scopeCount(scope, band);
        const list = ownerBandList(scope, band);
        expect(list.members, where).toHaveLength(Math.min(OWNER_BAND_LIST_LIMIT, count));
        expect(list.members.length + list.more, where).toBe(count);
        expect([...list.members].sort(compareRecency), where).toEqual(list.members);
        for (const member of list.members) {
          expect(rosterBand(member.id, scope), `${where} ${member.id}`).toBe(band);
          const roster = ownerBandRoster.find((row) => row.id === member.id);
          expect(member.topCommunityId, `${where} ${member.id}`).toBe(roster?.topCommunityId);
          expect(member.dailyMinutes, `${where} ${member.id}`).toEqual(roster?.dailyMinutes);
        }
      }
    }
  });

  it('never holds more roster members in a band than its count, nor novos than activated', () => {
    for (const scope of SCOPES) {
      for (const band of ENGAGEMENT_BAND_ORDER) {
        const inBand = ownerBandRoster.filter((row) => rosterBand(row.id, scope) === band);
        expect(inBand.length, `${scopeName(scope)} ${band}`).toBeLessThanOrEqual(
          scopeCount(scope, band),
        );
      }
      const novos = ownerBandRoster.filter((row) => rosterBand(row.id, scope) === 'new');
      expect(novos.length, scopeName(scope)).toBeLessThanOrEqual(scopeNewActivated(scope));
    }
  });

  it('carries the scope’s last activity', () => {
    const list = ownerBandList({ kind: 'community', id: 'c-eventos' }, 'at_risk');
    for (const member of list.members) {
      const roster = ownerBandRoster.find((row) => row.id === member.id);
      expect(member.lastActive).toEqual(roster?.communities['c-eventos']?.lastActive);
    }
    const event = ownerBandList({ kind: 'event', id: 'u1' }, 'engaged');
    expect(event.members.length).toBeGreaterThan(0);
    for (const member of event.members) {
      const roster = ownerBandRoster.find((row) => row.id === member.id);
      expect(member.lastActive).toEqual(roster?.lastActive);
    }
  });

  it('throws for a community or an event the client does not have', () => {
    expect(() => ownerBandList({ kind: 'community', id: 'c-nope' }, 'new')).toThrow();
    expect(() => ownerBandList({ kind: 'event', id: 'e9' }, 'new')).toThrow();
  });
});

describe('ownerBandIncludes (quick 261012-ri4 R-5)', () => {
  it('holds a member only in their band of the scope', () => {
    const eventos: OwnerBandScope = { kind: 'community', id: 'c-eventos' };
    const vip: OwnerBandScope = { kind: 'community', id: 'c-vip' };
    expect(ownerBandIncludes(eventos, 'occasional', 'om-28')).toBe(true);
    expect(ownerBandIncludes(eventos, 'engaged', 'om-28')).toBe(false);
    expect(ownerBandIncludes(vip, 'engaged', 'om-28')).toBe(true);
    expect(ownerBandIncludes(vip, 'superfan', 'om-13')).toBe(false);
    expect(ownerBandIncludes({ kind: 'event', id: 'u1' }, 'inactive', 'om-61')).toBe(false);
    expect(ownerBandIncludes({ kind: 'member' }, 'new', 'om-99')).toBe(false);
  });

  it('agrees with every band list, and puts nobody in two bands of a scope', () => {
    for (const scope of SCOPES) {
      for (const band of ENGAGEMENT_BAND_ORDER) {
        for (const member of ownerBandList(scope, band).members) {
          expect(ownerBandIncludes(scope, band, member.id), `${scopeName(scope)} ${band}`).toBe(
            true,
          );
        }
      }
      for (const row of ownerBandRoster) {
        const bands = ENGAGEMENT_BAND_ORDER.filter((band) =>
          ownerBandIncludes(scope, band, row.id),
        );
        expect(bands.length, `${scopeName(scope)} ${row.id}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('event registrations (quick 261012-qer B-2)', () => {
  function eligible(memberSince: string, event: { id: string; date: string }): boolean {
    const past = events.past.some((row) => row.id === event.id);
    return !past || memberSince <= event.date;
  }

  it('registers, per event and band, the first eligible slots up to the band count', () => {
    for (const event of ALL_EVENTS) {
      const bands = eventEngagement.find((row) => row.id === event.id)?.bands;
      if (!bands) throw new Error(`no bands for ${event.id}`);
      for (const band of ENGAGEMENT_BAND_ORDER) {
        const slots = ownerBandRoster.filter(
          (row) => row.band === band && eligible(row.memberSince, event),
        );
        const expected = slots.slice(0, Math.min(bands.counts[band], 12)).map((row) => row.id);
        const registered = ownerBandRoster
          .filter((row) => row.band === band && row.eventIds.includes(event.id))
          .map((row) => row.id);
        expect(registered, `${event.id} ${band}`).toEqual(expected);
      }
    }
  });

  it('never registers a member for a past event they joined after', () => {
    for (const row of ownerBandRoster) {
      for (const id of row.eventIds) {
        const past = events.past.find((event) => event.id === id);
        if (past) expect(row.memberSince <= past.date, `${row.id} ${id}`).toBe(true);
      }
    }
  });

  it('only names panel events', () => {
    const ids = new Set(ALL_EVENTS.map((row) => row.id));
    for (const row of ownerBandRoster) {
      for (const id of row.eventIds) expect(ids.has(id), `${row.id} ${id}`).toBe(true);
    }
  });
});

describe('the example daily time (quick 261012-qer B-1)', () => {
  const MINUTES: Record<EngagementBand, (j: number) => number> = {
    new: (j) => 18 + 2 * j,
    superfan: (j) => 45 + 3 * j,
    engaged: (j) => 25 + 2 * j,
    occasional: (j) => 8 + j,
    at_risk: (j) => 2 + (j % 3),
    inactive: () => 0,
  };

  it('is an example (no usage sessions yet), a pure function of band and slot', () => {
    for (const band of ENGAGEMENT_BAND_ORDER) {
      const rows = ownerBandRoster.filter((row) => row.band === band);
      for (const [j, row] of rows.entries()) {
        expect(row.dailyMinutes, row.id).toEqual({
          example: true,
          reason: 'needs_usage_sessions',
          value: MINUTES[band](j),
        });
      }
    }
  });

  it('keeps the bands apart: superfãs spend the most time, inactive none', () => {
    const range = (band: EngagementBand) =>
      ownerBandRoster.filter((row) => row.band === band).map((row) => row.dailyMinutes.value);
    expect(Math.min(...range('superfan'))).toBeGreaterThan(Math.max(...range('occasional')));
    expect(Math.min(...range('engaged'))).toBeGreaterThan(Math.max(...range('at_risk')));
    expect(range('inactive').every((value) => value === 0)).toBe(true);
  });
});

describe('ownerScopeBands (quick 261012-tru)', () => {
  it('returns the whole base, a community entry or an event entry', () => {
    expect(ownerScopeBands({ kind: 'member' })).toBe(engagement);
    for (const row of communityEngagement) {
      expect(ownerScopeBands({ kind: 'community', id: row.id }), row.id).toBe(row.bands);
    }
    for (const row of eventEngagement) {
      expect(ownerScopeBands({ kind: 'event', id: row.id }), row.id).toBe(row.bands);
    }
  });

  it('throws for an id the fixture does not have', () => {
    expect(() => ownerScopeBands({ kind: 'community', id: 'c-xyz' })).toThrow();
    expect(() => ownerScopeBands({ kind: 'event', id: 'x9' })).toThrow();
  });
});
