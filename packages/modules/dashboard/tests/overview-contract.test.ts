import { describe, expect, it } from 'vitest';
import { ownerAlertSchema, ownerOverviewAnswerSchema } from '../contracts/overview';
import { eventIsSoonFull } from '../server/overview';

/**
 * The owner's Visão geral contract, complete (08.7-12, D-459, D-460, D-461, UI-D-472, UI-D-480,
 * UI-D-489 a/d, INSIGHT-07): every KPI composed from the area key that owns it — `perPost` from
 * `content`, `attendance` from `events`, `orderValue` from `finance`, `awaiting` from `support` —
 * each present only while its module is on; the bell's three alerts; the account read live. Raw
 * integers only (the web derives every percent and chip). No database.
 */

const EVENT = '33333333-3333-4333-8333-333333333333';

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

const BANDS = {
  counts: { new: 2, superfan: 1, engaged: 12, occasional: 3, at_risk: 2, inactive: 0 },
  newActivated: 1,
};

const twelve = (value: number) => Array.from({ length: 12 }, () => value);

/** The ready answer of a tenant with every module on. */
const READY_ALL = {
  state: 'ready',
  snapshot: SNAPSHOT,
  members: { count: 20, newMembers: 2, previous: 18 },
  engagement: BANDS,
  previousEngagement: BANDS,
  actions30: 55,
  activeMembers30: 10,
  weeklyInteracting: { current: twelve(4), previous: twelve(3) },
  perPost: { posts: 6, interactions: 42, previousPosts: 4, previousInteractions: 20 },
  attendance: {
    current: { confirmed: 12, present: 10, walkIns: 1 },
    previous: { confirmed: 8, present: 5, walkIns: 0 },
  },
  orderValue: { current: 19_700, previous: 9_900 },
  awaiting: { count: 2, oldestHours: 26 },
  alerts: [
    { kind: 'support_waiting', conversations: 2, oldestHours: 26 },
    {
      kind: 'event_soon',
      eventId: EVENT,
      title: 'Encontro de outubro',
      startsAt: '2026-10-24T22:00:00Z',
      confirmed: 90,
      capacity: 100,
    },
    { kind: 'entered_at_risk', members: 3, withPush: 1 },
  ],
  account: { plan: 'pilot', admins: 1, staff: 2 },
};

/** rede-lab's shape: feed and events on; store, chat and notifications off. */
const {
  orderValue: _orderValue,
  awaiting: _awaiting,
  alerts: _alerts,
  ...READY_LAB_BASE
} = READY_ALL;
const READY_LAB = { ...READY_LAB_BASE, alerts: [{ kind: 'entered_at_risk', members: 3 }] };

describe('08.7 overview contract', () => {
  it('ownerOverviewAnswerSchema accepts a ready answer with every module’s key, the alerts and the account', () => {
    const parsed = ownerOverviewAnswerSchema.parse(READY_ALL);
    expect(parsed.state).toBe('ready');
    if (parsed.state !== 'ready') return;
    expect(parsed.orderValue).toEqual({ current: 19_700, previous: 9_900 });
    expect(parsed.alerts.map((alert) => alert.kind)).toEqual([
      'support_waiting',
      'event_soon',
      'entered_at_risk',
    ]);
    expect(parsed.account).toEqual({ plan: 'pilot', admins: 1, staff: 2 });
  });

  it('accepts a ready answer without orderValue (store off), awaiting (chat off) or a support alert', () => {
    const parsed = ownerOverviewAnswerSchema.parse(READY_LAB);
    expect(parsed.state).toBe('ready');
    expect('orderValue' in parsed).toBe(false);
    expect('awaiting' in parsed).toBe(false);
  });

  it('accepts a ready answer with neither attendance (events off) nor perPost (feed and stories off)', () => {
    const { attendance: _attendance, perPost: _perPost, ...rest } = READY_LAB;
    expect(ownerOverviewAnswerSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects orderValue as a delta object (the API sends raw cents, the web derives the chip)', () => {
    const delta = {
      ...READY_ALL,
      orderValue: {
        cents: 19_700,
        delta: {
          amount: 8,
          kind: 'percent',
          direction: 'up',
          good: true,
          basis: 'previous_30_days',
        },
      },
    };
    expect(ownerOverviewAnswerSchema.safeParse(delta).success).toBe(false);
    expect(
      ownerOverviewAnswerSchema.safeParse({
        ...READY_ALL,
        orderValue: { current: 19.5, previous: 0 },
      }).success,
    ).toBe(false);
  });

  it('requires the alerts and the account on a ready answer', () => {
    const { alerts: _a, ...noAlerts } = READY_ALL;
    const { account: _b, ...noAccount } = READY_ALL;
    expect(ownerOverviewAnswerSchema.safeParse(noAlerts).success).toBe(false);
    expect(ownerOverviewAnswerSchema.safeParse(noAccount).success).toBe(false);
    expect(
      ownerOverviewAnswerSchema.safeParse({
        ...READY_ALL,
        account: { plan: 'pilot', admins: 1, staff: 2, billing: 'coming_soon' },
      }).success,
    ).toBe(false);
  });

  it('accepts an empty alert list (the bell is absent)', () => {
    expect(ownerOverviewAnswerSchema.safeParse({ ...READY_ALL, alerts: [] }).success).toBe(true);
  });

  it('keeps preparing free of every number key', () => {
    expect(ownerOverviewAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
    expect(
      ownerOverviewAnswerSchema.safeParse({ state: 'preparing', orderValue: READY_ALL.orderValue })
        .success,
    ).toBe(false);
  });
});

describe('08.7 overview alerts (ownerAlertSchema)', () => {
  it('accepts the three kinds', () => {
    for (const alert of READY_ALL.alerts) {
      expect(ownerAlertSchema.safeParse(alert).success, alert.kind).toBe(true);
    }
  });

  it('accepts entered_at_risk without withPush (notifications off, UI-D-489 d)', () => {
    expect(ownerAlertSchema.safeParse({ kind: 'entered_at_risk', members: 3 }).success).toBe(true);
  });

  it('refuses an unknown kind, an extra key, a sample value or a name of a member', () => {
    expect(ownerAlertSchema.safeParse({ kind: 'trial_ending', days: 3 }).success).toBe(false);
    expect(
      ownerAlertSchema.safeParse({ kind: 'entered_at_risk', members: 3, names: ['Ana'] }).success,
    ).toBe(false);
    expect(
      ownerAlertSchema.safeParse({
        kind: 'support_waiting',
        conversations: 2,
        oldestHours: 26,
        severity: 'danger',
      }).success,
    ).toBe(false);
  });

  it('refuses an event_soon without a capacity (an event with no limit never raises it)', () => {
    const { capacity: _capacity, ...noCapacity } = READY_ALL.alerts[1] as Record<string, unknown>;
    expect(ownerAlertSchema.safeParse(noCapacity).success).toBe(false);
    expect(ownerAlertSchema.safeParse({ ...noCapacity, capacity: null }).success).toBe(false);
  });

  it('refuses an alert that counts nobody', () => {
    expect(
      ownerAlertSchema.safeParse({ kind: 'support_waiting', conversations: 0, oldestHours: 0 })
        .success,
    ).toBe(false);
    expect(ownerAlertSchema.safeParse({ kind: 'entered_at_risk', members: 0 }).success).toBe(false);
  });
});

describe('08.7 overview event_soon rule (EP-18, UI-D-489 a)', () => {
  it('capacity 100: 90 confirmed (10 left) raises it, 89 (11 left) and 100 (0 left) do not', () => {
    expect(eventIsSoonFull({ capacity: 100, confirmed: 90 })).toBe(true);
    expect(eventIsSoonFull({ capacity: 100, confirmed: 89 })).toBe(false);
    expect(eventIsSoonFull({ capacity: 100, confirmed: 100 })).toBe(false);
  });

  it('an event with no capacity never raises it, and a small one needs at least one seat left', () => {
    expect(eventIsSoonFull({ capacity: null, confirmed: 1_000 })).toBe(false);
    expect(eventIsSoonFull({ capacity: 10, confirmed: 9 })).toBe(true);
    expect(eventIsSoonFull({ capacity: 5, confirmed: 5 })).toBe(false);
    expect(eventIsSoonFull({ capacity: 5, confirmed: 4 })).toBe(false);
  });
});
