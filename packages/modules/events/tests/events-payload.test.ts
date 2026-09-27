import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EventCancelled,
  EventCheckedIn,
  EventInput,
  EventPublished,
  EventReactivated,
  EventRsvp,
  EventUpdated,
} from '../contracts/index';

/**
 * MOD-03 / T-06-06 — `event.published`, asserted without a database (the communities `events.test.ts`
 * shape, retargeted):
 *
 *  1. a create that COMMITS queues exactly one event, and its payload key set is EXACTLY
 *     `{ tenantId, eventId, actorUserId, format, startsAt, endsAt }`: ids and instants, never a title,
 *     a venue, a URL or a code (the manifest's subscriber logs the payload verbatim);
 *  2. a create whose transaction THROWS queues nothing;
 *  3. a `23514` raised by `events_window_chk` (the DST-fold case Zod cannot see) maps to
 *     `400 { event: 'end_before_start' }`, never a 500.
 *
 * 06-04 adds `event.updated` (exactly seven keys, `timesChanged` true only when an instant moved, and
 * nothing for an identical body), `event.cancelled` and `event.reactivated` (exactly five keys, once
 * per transition, nothing for a repeat), and the two 409 codes of the status write.
 *
 * 06-05 adds `event.checked_in` (exactly six keys, once on the FIRST check-in, nothing for `already`)
 * and the outcome mapping of `app.events_check_in`, whose refusals are RETURNED by the database and
 * thrown only after the transaction resolved (Pitfall 1).
 *
 * 06-06 adds `app.events_enter`'s mapping: `event.checked_in` with `via: 'online'` ONLY for
 * `recorded`, nothing for `forward` / `already`, the URL only on the passing outcomes, and a bare 404.
 *
 * `withTenantTx` is the seam; the bus under test is the real one.
 */

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const STARTS_AT = '2026-10-12T22:00:00.000000Z';
const ENDS_AT = '2026-10-13T00:00:00.000000Z';

let transaction: 'commit' | 'throw' | 'window' = 'commit';
let executeCall = 0;
const statements: string[] = [];

const row = {
  id: EVENT_ID,
  title: 'Encontro anual',
  format: 'online' as const,
  venue_name: null,
  cover_asset_id: null,
  cover_variant_widths: null,
  status: 'active' as const,
  starts_at: STARTS_AT,
  ends_at: ENDS_AT,
  viewer_status: null,
  viewer_checked_in_at: null,
  confirmed_count: 0,
  present_count: 0,
};

/**
 * 06-03: when non-null, `tx.execute` answers from this script instead, one entry per statement: an
 * array is a result, anything else is thrown (a driver error with its cause chain).
 */
let script: unknown[] | null = null;

/**
 * With no cover, `createEvent` issues THREE statements: the `events` insert (returning the id), the
 * `event_secrets` insert, and the read-back through the shared projection.
 */
const tx = {
  execute: async (query: unknown) => {
    statements.push(JSON.stringify(query));
    if (script) {
      const next = script.shift();
      if (Array.isArray(next)) return next;
      throw next;
    }
    if (transaction === 'throw') throw new Error('insert refused by the database');
    if (transaction === 'window') {
      throw {
        message: 'refused',
        cause: { code: '23514', constraint_name: 'events_window_chk' },
      };
    }
    executeCall += 1;
    if (executeCall === 1) return [{ id: EVENT_ID }];
    if (executeCall === 2) return [];
    return [row];
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { checkInEvent, createEvent, enterEvent, rsvpEvent, setEventStatus, updateEvent } =
  await import('../server/service');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

const MEETING_URL = 'https://meet.example.test/segredo';

const input: EventInput = {
  title: 'Encontro anual',
  description: '',
  format: 'online',
  meetingUrl: MEETING_URL,
  start: { date: '2026-10-12', time: '19:00' },
  end: { date: '2026-10-12', time: '21:00' },
};

let received: EventPublished[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  script = null;
  transaction = 'commit';
  executeCall = 0;
  statements.length = 0;
  received = [];
  unsubscribe = subscribe('event.published', async (payload) => {
    received.push(payload);
  });
});

afterEach(() => {
  unsubscribe();
});

describe('event.published — after commit, exactly once, ids and instants only', () => {
  it('1. a committed create queues ONE event whose key set is exactly the six contract keys', async () => {
    const ctx = context();
    const created = await createEvent(ctx, input);

    expect(created.id).toBe(EVENT_ID);
    // The summary carries no secret key at all (D-207).
    expect(Object.keys(created)).not.toContain('meetingUrl');
    expect(Object.keys(created)).not.toContain('checkinCode');
    expect(ctx.events).toHaveLength(1);
    expect(received).toHaveLength(0);

    await flush(ctx);

    expect(received).toHaveLength(1);
    expect(Object.keys(received[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'format',
      'startsAt',
      'tenantId',
    ]);
    expect(received[0]).toEqual({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      actorUserId: USER_ID,
      format: 'online',
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });
    // Neither the title nor the URL reaches the payload in any value either.
    expect(JSON.stringify(received[0])).not.toContain('Encontro');
    expect(JSON.stringify(received[0])).not.toContain('meet.example');

    // Both halves were written in the one transaction: events, then event_secrets.
    expect(statements[0]).toContain('insert into events');
    expect(statements[1]).toContain('insert into event_secrets');

    await flush(ctx);
    expect(received).toHaveLength(1);
  });

  it('2. a create whose transaction throws queues NOTHING (rollback)', async () => {
    transaction = 'throw';
    const ctx = context();
    await expect(createEvent(ctx, input)).rejects.toThrow(/insert refused/);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('3. events_window_chk maps to end_before_start, and nothing is queued', async () => {
    transaction = 'window';
    const ctx = context();
    await expect(createEvent(ctx, input)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { event: 'end_before_start' },
    });
    expect(ctx.events).toHaveLength(0);
  });

  it('4. an empty title is refused before any transaction opens', async () => {
    const ctx = context();
    await expect(createEvent(ctx, { ...input, title: '   ' })).rejects.toMatchObject({
      status: 400,
      details: { event: 'name_required' },
    });
    expect(statements).toHaveLength(0);
    expect(ctx.events).toHaveLength(0);
  });
});

/** A driver error as postgres.js + drizzle wrap it: the Postgres fields sit on the cause. */
const refusal = (code: string, constraint: string, message = 'refused') => ({
  message: 'Failed query',
  cause: { code, constraint_name: constraint, message },
});

describe('event.rsvp — after commit, only on a change, the exact six keys (06-03)', () => {
  let rsvps: EventRsvp[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    rsvps = [];
    stop = subscribe('event.rsvp', async (payload) => {
      rsvps.push(payload);
    });
  });
  afterEach(() => stop());

  it('5. a first answer queues ONE event.rsvp with previousStatus null and exactly six keys', async () => {
    script = [[{ status: 'going', previous_status: null, starts_at: STARTS_AT }]];
    const ctx = context();
    await expect(rsvpEvent(ctx, EVENT_ID, { answer: 'going' })).resolves.toEqual({
      status: 'going',
    });
    // ONE statement: the snapshot and the upsert are the same CTE.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('on conflict (tenant_id, event_id, user_id) do update');
    await flush(ctx);
    expect(rsvps).toHaveLength(1);
    expect(Object.keys(rsvps[0] ?? {}).sort()).toEqual([
      'eventId',
      'previousStatus',
      'startsAt',
      'status',
      'tenantId',
      'userId',
    ]);
    expect(rsvps[0]).toEqual({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      userId: USER_ID,
      status: 'going',
      previousStatus: null,
      startsAt: STARTS_AT,
    });
  });

  it('6. a changed answer carries the previous status', async () => {
    script = [[{ status: 'not_going', previous_status: 'going', starts_at: STARTS_AT }]];
    const ctx = context();
    await rsvpEvent(ctx, EVENT_ID, { answer: 'not_going' });
    await flush(ctx);
    expect(rsvps[0]).toMatchObject({ status: 'not_going', previousStatus: 'going' });
  });

  it('7. a REPEAT answer writes nothing, answers 200 with the status and emits nothing', async () => {
    script = [[], [{ status: 'going' }]];
    const ctx = context();
    await expect(rsvpEvent(ctx, EVENT_ID, { answer: 'going' })).resolves.toEqual({
      status: 'going',
    });
    await flush(ctx);
    expect(ctx.events).toHaveLength(0);
    expect(rsvps).toHaveLength(0);
  });

  it('8. an answer on a checked-in row is 409 attendance_locked, and nothing is queued', async () => {
    script = [[], [{ status: 'checked_in' }]];
    const ctx = context();
    await expect(rsvpEvent(ctx, EVENT_ID, { answer: 'not_going' })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { event: 'attendance_locked' },
    });
    expect(ctx.events).toHaveLength(0);
  });

  it('9. every guard refusal maps by constraint name; an unknown event is a bare 404', async () => {
    const cases: [string, string, string][] = [
      ['23514', 'event_attendances_rsvp_open', 'rsvp_closed'],
      ['23514', 'event_attendances_event_active', 'cancelled'],
      ['23514', 'event_attendances_locked', 'attendance_locked'],
    ];
    for (const [code, constraint, issue] of cases) {
      script = [refusal(code, constraint)];
      const ctx = context();
      await expect(rsvpEvent(ctx, EVENT_ID, { answer: 'going' })).rejects.toMatchObject({
        status: 409,
        details: { event: issue },
      });
      expect(ctx.events).toHaveLength(0);
    }
    script = [refusal('23503', 'event_attendances_event_visible', 'event_not_found')];
    const miss = rsvpEvent(context(), EVENT_ID, { answer: 'going' });
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
    // Anything else is not swallowed into a code.
    script = [refusal('23514', 'some_other_chk')];
    await expect(rsvpEvent(context(), EVENT_ID, { answer: 'going' })).rejects.toMatchObject({
      message: 'Failed query',
    });
  });
});

describe('06-04 — event.updated, event.cancelled, event.reactivated: exact keys, once per change', () => {
  const MOVED_START = '2026-10-12T23:00:00.000000Z';
  const locked = [{ cover_asset_id: null, starts_at: STARTS_AT, ends_at: ENDS_AT }];
  let updates: EventUpdated[] = [];
  let cancels: EventCancelled[] = [];
  let reactivations: EventReactivated[] = [];
  let stops: (() => void)[] = [];
  beforeEach(() => {
    updates = [];
    cancels = [];
    reactivations = [];
    stops = [
      subscribe('event.updated', async (payload) => {
        updates.push(payload);
      }),
      subscribe('event.cancelled', async (payload) => {
        cancels.push(payload);
      }),
      subscribe('event.reactivated', async (payload) => {
        reactivations.push(payload);
      }),
    ];
  });
  afterEach(() => {
    for (const stop of stops) stop();
  });

  it('10. a title-only change emits ONE event.updated with exactly seven keys and timesChanged false', async () => {
    // lock, update events (a row came back), update event_secrets (unchanged), read-back.
    script = [locked, [{ starts_at: STARTS_AT, ends_at: ENDS_AT }], [], [row]];
    const ctx = context();
    const updated = await updateEvent(ctx, EVENT_ID, { ...input, title: 'Outro nome' });
    expect(Object.keys(updated)).not.toContain('meetingUrl');
    // The one transaction: lock first, then events, then event_secrets, both guarded.
    expect(statements[0]).toContain('for update');
    expect(statements[1]).toContain('is distinct from');
    expect(statements[2]).toContain('update event_secrets');
    await flush(ctx);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'format',
      'startsAt',
      'tenantId',
      'timesChanged',
    ]);
    expect(updates[0]).toEqual({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      actorUserId: USER_ID,
      format: 'online',
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
      timesChanged: false,
    });
    expect(JSON.stringify(updates[0])).not.toContain('Outro');
    expect(JSON.stringify(updates[0])).not.toContain('meet.example');
  });

  it('11. a moved start emits timesChanged true; a URL-only change still emits, with false', async () => {
    script = [locked, [{ starts_at: MOVED_START, ends_at: ENDS_AT }], [], [row]];
    const ctx = context();
    await updateEvent(ctx, EVENT_ID, input);
    await flush(ctx);
    expect(updates[0]?.timesChanged).toBe(true);

    script = [locked, [], [{ event_id: EVENT_ID }], [row]];
    const second = context();
    await updateEvent(second, EVENT_ID, input);
    await flush(second);
    expect(updates).toHaveLength(2);
    expect(updates[1]?.timesChanged).toBe(false);
  });

  it('12. an identical body writes no row and emits NOTHING', async () => {
    script = [locked, [], [], [row]];
    const ctx = context();
    await updateEvent(ctx, EVENT_ID, input);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(updates).toHaveLength(0);
  });

  it('13. an unknown event is a bare 404, and events_window_chk maps to end_before_start', async () => {
    script = [[]];
    const miss = updateEvent(context(), EVENT_ID, input);
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');

    script = [locked, refusal('23514', 'events_window_chk')];
    const ctx = context();
    await expect(updateEvent(ctx, EVENT_ID, input)).rejects.toMatchObject({
      status: 400,
      details: { event: 'end_before_start' },
    });
    expect(ctx.events).toHaveLength(0);
  });

  it('14. cancel emits ONE event.cancelled with exactly five keys; a repeat cancel emits nothing', async () => {
    const cancelledRow = { ...row, status: 'cancelled' as const };
    script = [[{ id: EVENT_ID }], [cancelledRow]];
    const ctx = context();
    const result = await setEventStatus(ctx, EVENT_ID, { status: 'cancelled' });
    expect(result.status).toBe('cancelled');
    expect(statements[0]).toContain("status = 'active'");
    expect(statements[0]).toContain('now() < ends_at');
    await flush(ctx);
    expect(cancels).toHaveLength(1);
    expect(Object.keys(cancels[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'startsAt',
      'tenantId',
    ]);
    expect(cancels[0]).toEqual({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      actorUserId: USER_ID,
      startsAt: STARTS_AT,
      endsAt: ENDS_AT,
    });

    script = [[], [{ status: 'cancelled' }], [cancelledRow]];
    const repeat = context();
    await expect(setEventStatus(repeat, EVENT_ID, { status: 'cancelled' })).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(repeat.events).toHaveLength(0);
  });

  it('15. reactivate emits ONE event.reactivated with the same five keys; a repeat emits nothing', async () => {
    script = [[{ id: EVENT_ID }], [row]];
    const ctx = context();
    await setEventStatus(ctx, EVENT_ID, { status: 'active' });
    expect(statements[0]).toContain("status = 'cancelled'");
    expect(statements[0]).toContain('now() < starts_at');
    await flush(ctx);
    expect(reactivations).toHaveLength(1);
    expect(Object.keys(reactivations[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'endsAt',
      'eventId',
      'startsAt',
      'tenantId',
    ]);
    expect(cancels).toHaveLength(0);

    script = [[], [{ status: 'active' }], [row]];
    const repeat = context();
    await setEventStatus(repeat, EVENT_ID, { status: 'active' });
    expect(repeat.events).toHaveLength(0);
  });

  it('16. the refusals: event_ended, reactivate_started, and a bare 404', async () => {
    script = [[], [{ status: 'active' }]];
    const ended = context();
    await expect(setEventStatus(ended, EVENT_ID, { status: 'cancelled' })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { event: 'event_ended' },
    });
    expect(ended.events).toHaveLength(0);

    script = [[], [{ status: 'cancelled' }]];
    await expect(setEventStatus(context(), EVENT_ID, { status: 'active' })).rejects.toMatchObject({
      status: 409,
      details: { event: 'reactivate_started' },
    });

    script = [[], []];
    const miss = setEventStatus(context(), EVENT_ID, { status: 'cancelled' });
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
  });
});

describe('06-05 — event.checked_in and the check-in outcome mapping', () => {
  let checkIns: EventCheckedIn[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    checkIns = [];
    stop = subscribe('event.checked_in', async (payload) => {
      checkIns.push(payload);
    });
  });
  afterEach(() => stop());

  const STAMP = '2026-10-12T21:30:00.123456Z';

  it('17. a first check-in queues ONE event.checked_in with exactly six keys, via code', async () => {
    script = [[{ outcome: 'checked_in', checked_in_at: STAMP, starts_at: STARTS_AT }]];
    const ctx = context();
    await expect(checkInEvent(ctx, EVENT_ID, { code: 'k7-qm' })).resolves.toEqual({
      outcome: 'checked_in',
      checkedInAt: STAMP,
    });
    // ONE statement, and it is the definer: the service never reads or compares the code itself.
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('app.events_check_in');
    await flush(ctx);
    expect(checkIns).toHaveLength(1);
    expect(Object.keys(checkIns[0] ?? {}).sort()).toEqual([
      'eventId',
      'startsAt',
      'tenantId',
      'userId',
      'via',
      'walkIn',
    ]);
    expect(checkIns[0]).toEqual({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      userId: USER_ID,
      walkIn: false,
      via: 'code',
      startsAt: STARTS_AT,
    });
  });

  it('18. a walk-in carries walkIn true; already answers 200 with the original stamp and emits nothing', async () => {
    script = [[{ outcome: 'walk_in', checked_in_at: STAMP, starts_at: STARTS_AT }]];
    const ctx = context();
    await expect(checkInEvent(ctx, EVENT_ID, { code: 'K7QM' })).resolves.toEqual({
      outcome: 'walk_in',
      checkedInAt: STAMP,
    });
    await flush(ctx);
    expect(checkIns[0]).toMatchObject({ walkIn: true, via: 'code' });

    script = [[{ outcome: 'already', checked_in_at: STAMP, starts_at: STARTS_AT }]];
    const repeat = context();
    await expect(checkInEvent(repeat, EVENT_ID, { code: 'ZZZZ' })).resolves.toEqual({
      outcome: 'already',
      checkedInAt: STAMP,
    });
    expect(repeat.events).toHaveLength(0);
  });

  it('19. every refusal is RETURNED by the database and mapped to a 409 only after the transaction', async () => {
    const cases: [string, string][] = [
      ['wrong_code', 'wrong_code'],
      ['too_many_attempts', 'too_many_attempts'],
      ['not_open', 'checkin_not_open'],
      ['closed', 'checkin_closed'],
      ['cancelled', 'cancelled'],
    ];
    for (const [outcome, issue] of cases) {
      script = [[{ outcome, checked_in_at: null, starts_at: STARTS_AT }]];
      const ctx = context();
      await expect(checkInEvent(ctx, EVENT_ID, { code: 'ABCD' })).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
        details: { event: issue },
      });
      expect(ctx.events, outcome).toHaveLength(0);
    }
  });

  it('20. not_found (unknown, foreign, removed or online) is ONE bare 404', async () => {
    script = [[{ outcome: 'not_found', checked_in_at: null, starts_at: null }]];
    const miss = checkInEvent(context(), EVENT_ID, { code: 'K7QM' });
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
  });
});

describe('06-06 — the online enter: outcome mapping and event.checked_in via online', () => {
  let checkIns: EventCheckedIn[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    checkIns = [];
    stop = subscribe('event.checked_in', async (payload) => {
      checkIns.push(payload);
    });
  });
  afterEach(() => stop());

  const enterRow = (
    outcome: string,
    url: string | null,
    status: string | null,
    startsAt: string | null = STARTS_AT,
  ) => [{ outcome, meeting_url: url, attendance_status: status, starts_at: startsAt }];

  it('21. recorded queues ONE event.checked_in via online (walkIn from the recorded status)', async () => {
    script = [enterRow('recorded', MEETING_URL, 'checked_in')];
    const ctx = context();
    await expect(enterEvent(ctx, EVENT_ID)).resolves.toEqual({
      outcome: 'recorded',
      meetingUrl: MEETING_URL,
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('app.events_enter');
    await flush(ctx);
    expect(checkIns).toEqual([
      {
        tenantId: TENANT_ID,
        eventId: EVENT_ID,
        userId: USER_ID,
        walkIn: false,
        via: 'online',
        startsAt: STARTS_AT,
      },
    ]);

    script = [enterRow('recorded', MEETING_URL, 'walk_in')];
    const walkIn = context();
    await enterEvent(walkIn, EVENT_ID);
    await flush(walkIn);
    expect(checkIns[1]).toMatchObject({ walkIn: true, via: 'online' });
  });

  it('22. forward and already let the member through and emit NOTHING', async () => {
    for (const [outcome, status] of [
      ['forward', 'going'],
      ['already', 'walk_in'],
    ] as const) {
      script = [enterRow(outcome, MEETING_URL, status)];
      const ctx = context();
      await expect(enterEvent(ctx, EVENT_ID)).resolves.toEqual({
        outcome,
        meetingUrl: MEETING_URL,
      });
      expect(ctx.events, outcome).toHaveLength(0);
    }
  });

  it('23. the refusals answer 200 with meetingUrl null; a refusal carrying a URL is a 500, never a leak', async () => {
    for (const outcome of ['confirm_first', 'ended', 'cancelled']) {
      script = [enterRow(outcome, null, null)];
      const ctx = context();
      await expect(enterEvent(ctx, EVENT_ID)).resolves.toEqual({ outcome, meetingUrl: null });
      expect(ctx.events, outcome).toHaveLength(0);
    }
    script = [enterRow('ended', MEETING_URL, null)];
    await expect(enterEvent(context(), EVENT_ID)).rejects.toMatchObject({ status: 500 });
    script = [enterRow('recorded', null, 'walk_in')];
    await expect(enterEvent(context(), EVENT_ID)).rejects.toMatchObject({ status: 500 });
  });

  it('24. not_found (unknown, foreign, removed or in person) is ONE bare 404', async () => {
    script = [enterRow('not_found', null, null, null)];
    const miss = enterEvent(context(), EVENT_ID);
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
  });
});
