import { describe, expect, it } from 'vitest';
import {
  EVENT_FORMATS,
  eventsPayloadSchema,
  OWNER_UPCOMING_EVENTS_LIMIT,
  ownerEventsAnswerSchema,
} from '../contracts/events';

/**
 * The owner's Eventos contract (08.7-08, D-455, D-460, D-461, UI-D-489 c, INSIGHT-11): what the
 * stored `payload.events` and the area answer may and may not carry. No database.
 */

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const COVER = '44444444-4444-4444-8444-444444444444';

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

const NM = (reason: string) => ({ measured: false, reason });
const ZERO_BANDS = { new: 0, superfan: 0, engaged: 0, occasional: 0, at_risk: 0, inactive: 0 };
const TOTALS = {
  current: { confirmed: 4, present: 6, walkIns: 3 },
  previous: { confirmed: 1, present: 1, walkIns: 0 },
};

const UPCOMING_PAYLOAD = {
  id: EVENT_A,
  startsAt: '2026-10-18T03:00:00Z',
  endsAt: '2026-10-18T05:00:00Z',
  format: 'in_person',
  capacity: 2,
  confirmed: 2,
  durationMinutes: 120,
};

const PAST_PAYLOAD = {
  id: EVENT_B,
  startsAt: '2026-10-17T15:00:00Z',
  endsAt: '2026-10-17T16:30:00Z',
  format: 'online',
  capacity: null,
  confirmed: 3,
  checkIns: 2,
  walkIns: 1,
  durationMinutes: 90,
};

const PAYLOAD = {
  upcoming: [UPCOMING_PAYLOAD],
  past: [PAST_PAYLOAD],
  attendanceTotals: TOTALS,
  attendanceByBand: { ...ZERO_BANDS, occasional: 2, new: 1 },
};

const LIVE = (title: string) => ({
  title,
  coverAssetId: COVER,
  ticketCents: NM('needs_event_tickets'),
  revenue: NM('needs_event_tickets'),
});

const READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  upcoming: [{ ...UPCOMING_PAYLOAD, ...LIVE('Encontro mensal') }],
  past: [{ ...PAST_PAYLOAD, ...LIVE('Live de dúvidas') }],
  attendanceTotals: TOTALS,
  attendanceByBand: { ...ZERO_BANDS, occasional: 2, new: 1 },
  waitlist: NM('needs_waitlist'),
};

function withUpcoming(patch: Record<string, unknown>) {
  const [first] = READY.upcoming;
  return { ...READY, upcoming: [{ ...first, ...patch }] };
}

function withPast(patch: Record<string, unknown>) {
  const [first] = READY.past;
  return { ...READY, past: [{ ...first, ...patch }] };
}

describe('eventsPayloadSchema (08.7-08, PR-1): the stored events area is ids and numbers only', () => {
  it('accepts upcoming and past events, the totals of both windows and the presences by band', () => {
    expect(eventsPayloadSchema.safeParse(PAYLOAD).success).toBe(true);
  });

  it('refuses a title in the stored payload (titles are joined live)', () => {
    const payload = { ...PAYLOAD, upcoming: [{ ...UPCOMING_PAYLOAD, title: 'Encontro' }] };
    expect(eventsPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it(`stores at most ${6} upcoming events (EP-32: a seventh is not listed)`, () => {
    expect(OWNER_UPCOMING_EVENTS_LIMIT).toBe(6);
    const seven = Array.from({ length: 7 }, () => UPCOMING_PAYLOAD);
    expect(eventsPayloadSchema.safeParse({ ...PAYLOAD, upcoming: seven }).success).toBe(false);
    const six = seven.slice(0, 6);
    expect(eventsPayloadSchema.safeParse({ ...PAYLOAD, upcoming: six }).success).toBe(true);
  });

  it('accepts the empty tenant: no event, every band 0 (EP-34)', () => {
    const empty = {
      upcoming: [],
      past: [],
      attendanceTotals: {
        current: { confirmed: 0, present: 0, walkIns: 0 },
        previous: { confirmed: 0, present: 0, walkIns: 0 },
      },
      attendanceByBand: ZERO_BANDS,
    };
    expect(eventsPayloadSchema.safeParse(empty).success).toBe(true);
  });
});

describe('ownerEventsAnswerSchema (08.7-08, D-455, INSIGHT-11): the Eventos answer', () => {
  it('accepts a ready answer whose ticket, revenue and waiting list are not measured', () => {
    expect(ownerEventsAnswerSchema.safeParse(READY).success).toBe(true);
  });

  it('accepts an event with no capacity (EP-34: capacity null, no seats-left figure)', () => {
    const parsed = ownerEventsAnswerSchema.safeParse(withUpcoming({ capacity: null }));
    expect(parsed.success).toBe(true);
  });

  it('rejects ticketCents as a number (D-455: no ticket price is stored)', () => {
    expect(ownerEventsAnswerSchema.safeParse(withUpcoming({ ticketCents: 6000 })).success).toBe(
      false,
    );
    expect(ownerEventsAnswerSchema.safeParse(withPast({ ticketCents: 0 })).success).toBe(false);
  });

  it('rejects a measured or example ticket, revenue or waiting list', () => {
    const measured = { measured: true, value: 6000 };
    const example = { example: true, reason: 'needs_event_tickets', value: 6000 };
    expect(ownerEventsAnswerSchema.safeParse(withUpcoming({ ticketCents: measured })).success).toBe(
      false,
    );
    expect(ownerEventsAnswerSchema.safeParse(withPast({ revenue: example })).success).toBe(false);
    expect(ownerEventsAnswerSchema.safeParse({ ...READY, waitlist: [] }).success).toBe(false);
    expect(
      ownerEventsAnswerSchema.safeParse({ ...READY, waitlist: NM('needs_event_tickets') }).success,
    ).toBe(false);
  });

  it('accepts the preparing state alone, and refuses a ready answer without its snapshot', () => {
    expect(ownerEventsAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
    const { snapshot: _snapshot, ...noSnapshot } = READY;
    expect(ownerEventsAnswerSchema.safeParse(noSnapshot).success).toBe(false);
  });

  it('knows the two formats and refuses any other (events_format_chk)', () => {
    expect([...EVENT_FORMATS]).toEqual(['in_person', 'online']);
    expect(ownerEventsAnswerSchema.safeParse(withPast({ format: 'hybrid' })).success).toBe(false);
  });

  it('refuses a negative or fractional count and a zero capacity', () => {
    expect(ownerEventsAnswerSchema.safeParse(withPast({ walkIns: -1 })).success).toBe(false);
    expect(ownerEventsAnswerSchema.safeParse(withPast({ durationMinutes: 1.5 })).success).toBe(
      false,
    );
    expect(ownerEventsAnswerSchema.safeParse(withUpcoming({ capacity: 0 })).success).toBe(false);
  });
});
