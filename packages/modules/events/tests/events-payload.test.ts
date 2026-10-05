import type { RequestContext } from '@rede-social/core/server/auth/context';
import { flush, subscribe } from '@rede-social/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EventCancelled,
  EventCheckedIn,
  EventInput,
  EventPublished,
  EventReactivated,
  EventReminderDue,
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
 * 06-07 adds the attendance reads and the code regeneration: three LITERAL chip statements (the list
 * value is never bound), the in-lane 404 first, a tampered cursor degrading to page 1, the two
 * "confirmados" numbers under their own names, and a regenerated code that is always new and never
 * logged or emitted.
 *
 * 07-05 adds the reminder arming (EVENT-07): a create arms both windows IN its transaction, a moved
 * start re-arms, a reactivation re-arms, a cancel, an unmoved edit and an identical body arm nothing;
 * and `event.reminder_due`, emitted by the reminder job, carries exactly four keys (ids, the window
 * and one instant, never a title). `enqueueInTx` is mocked at the module boundary (the kernel's
 * pg-boss wrapper), so the arming is observed without a database.
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

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

/** 07-05: every reminder the service armed, in order (the pg-boss wrapper is the seam). */
const armed = vi.hoisted(() => [] as { name: string; payload: unknown; opts: unknown }[]);
vi.mock('@rede-social/core/server/jobs/boss', () => ({
  enqueueInTx: async (_tx: unknown, name: string, payload: unknown, opts: unknown) => {
    armed.push({ name, payload, opts });
    return 'job-id';
  },
}));

/** A clock well before `STARTS_AT`, so both windows are in the future whatever day the suite runs. */
const BEFORE_START = Date.parse('2026-10-01T12:00:00.000Z');

const { runEventReminder } = await import('../server/reminders');

const {
  checkInEvent,
  createEvent,
  enterEvent,
  getAttendanceSummary,
  listAttendance,
  regenerateCheckinCode,
  rsvpEvent,
  setEventStatus,
  updateEvent,
} = await import('../server/service');

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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BEFORE_START);
  armed.length = 0;
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
  vi.useRealTimers();
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

    // 07-05: both reminder windows were armed in the same transaction, from the stored instant,
    // with ids and the instant only in the job payload (T-07-31).
    const startsSeconds = Math.floor(Date.parse(STARTS_AT) / 1000);
    expect(armed).toEqual([
      {
        name: 'events.reminder',
        payload: { tenantId: TENANT_ID, eventId: EVENT_ID, window: '24h', startsAt: STARTS_AT },
        opts: {
          startAfter: new Date(Date.parse(STARTS_AT) - 24 * 3_600_000),
          singletonKey: `${EVENT_ID}:24h:${startsSeconds}`,
        },
      },
      {
        name: 'events.reminder',
        payload: { tenantId: TENANT_ID, eventId: EVENT_ID, window: '1h', startsAt: STARTS_AT },
        opts: {
          startAfter: new Date(Date.parse(STARTS_AT) - 3_600_000),
          singletonKey: `${EVENT_ID}:1h:${startsSeconds}`,
        },
      },
    ]);

    await flush(ctx);
    expect(received).toHaveLength(1);
  });

  it('1b. a create 2 h before the start arms only the 1 h job; 30 min before, none (never late)', async () => {
    vi.setSystemTime(Date.parse(STARTS_AT) - 2 * 3_600_000);
    await createEvent(context(), input);
    expect(armed.map((job) => (job.payload as { window: string }).window)).toEqual(['1h']);

    armed.length = 0;
    executeCall = 0;
    vi.setSystemTime(Date.parse(STARTS_AT) - 30 * 60_000);
    await createEvent(context(), input);
    expect(armed).toEqual([]);
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

  it('9b. event_full (2026-10-03): a new Vou is 409 event_full; a member already going is unchanged; a checked-in one is locked', async () => {
    const full = () => refusal('23514', 'event_attendances_capacity', 'event_full');

    // The guard refused the upsert; the follow-up read of the caller's OWN row finds nothing.
    script = [full(), []];
    const ctx = context();
    await expect(rsvpEvent(ctx, EVENT_ID, { answer: 'going' })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { event: 'event_full' },
    });
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('from event_attendances');
    expect(statements[1]).toContain(USER_ID);
    expect(ctx.events).toHaveLength(0);

    // A Não vou moving to Vou on a full event is refused the same way.
    script = [full(), [{ status: 'not_going' }]];
    await expect(rsvpEvent(context(), EVENT_ID, { answer: 'going' })).rejects.toMatchObject({
      details: { event: 'event_full' },
    });

    // Already going, on an event whose limit was lowered under its confirmed count: the repeat
    // answer it always was (200, nothing written, nothing emitted).
    script = [full(), [{ status: 'going' }]];
    const repeat = context();
    await expect(rsvpEvent(repeat, EVENT_ID, { answer: 'going' })).resolves.toEqual({
      status: 'going',
    });
    await flush(repeat);
    expect(repeat.events).toHaveLength(0);
    expect(rsvps).toHaveLength(0);

    // Checked in (or walked in): the lock it is on any event.
    for (const status of ['checked_in', 'walk_in']) {
      script = [full(), [{ status }]];
      await expect(rsvpEvent(context(), EVENT_ID, { answer: 'going' })).rejects.toMatchObject({
        status: 409,
        details: { event: 'attendance_locked' },
      });
    }
  });
});

describe('2026-10-03 — category and capacity on the writes, the poster keys on the read-back', () => {
  it('9c. create binds the trimmed category (blank stored as null) and the capacity, and maps them back', async () => {
    script = [
      [{ id: EVENT_ID }],
      [],
      [{ ...row, category: 'Workshop', capacity: 30, address: null }],
    ];
    const created = await createEvent(context(), {
      ...input,
      category: '  Workshop ',
      capacity: 30,
    });
    expect(created).toMatchObject({ category: 'Workshop', capacity: 30, address: null });
    expect(statements[0]).toContain('category, capacity');
    expect(statements[0]).toContain('"Workshop"');
    expect(statements[0]).not.toContain('  Workshop ');
    expect(statements[0]).toContain('30');

    // A blank category and an absent capacity are both stored as null, never '' or 0.
    statements.length = 0;
    script = [[{ id: EVENT_ID }], [], [row]];
    const plain = await createEvent(context(), { ...input, category: '   ' });
    expect(plain).toMatchObject({ category: null, capacity: null, address: null });
    expect(statements[0]).not.toContain('"   "');
  });

  it('9d. the replacement writes category and capacity in the same guarded statement', async () => {
    const locked = [{ cover_asset_id: null, starts_at: STARTS_AT, ends_at: ENDS_AT }];
    script = [
      locked,
      [{ starts_at: STARTS_AT, ends_at: ENDS_AT }],
      [],
      [{ ...row, category: 'Imersão', capacity: 12 }],
    ];
    const updated = await updateEvent(context(), EVENT_ID, {
      ...input,
      category: 'Imersão',
      capacity: 12,
    });
    expect(updated).toMatchObject({ category: 'Imersão', capacity: 12 });
    expect(statements[1]).toContain('category = n.category');
    expect(statements[1]).toContain('capacity = n.capacity');
    // Both are in the `is distinct from` tuple, so a limit-only change is a change.
    expect(statements[1]).toMatch(/e\.category, e\.capacity[\s\S]*is distinct from/);
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
    const movedRow = { ...row, starts_at: MOVED_START };
    script = [locked, [{ starts_at: MOVED_START, ends_at: ENDS_AT }], [], [movedRow]];
    const ctx = context();
    await updateEvent(ctx, EVENT_ID, input);
    await flush(ctx);
    expect(updates[0]?.timesChanged).toBe(true);
    // 07-05: the move re-armed both windows at the NEW start (new singleton keys).
    const movedSeconds = Math.floor(Date.parse(MOVED_START) / 1000);
    expect(armed.map((job) => (job.opts as { singletonKey: string }).singletonKey)).toEqual([
      `${EVENT_ID}:24h:${movedSeconds}`,
      `${EVENT_ID}:1h:${movedSeconds}`,
    ]);
    expect(
      armed.every((job) => (job.payload as { startsAt: string }).startsAt === MOVED_START),
    ).toBe(true);

    armed.length = 0;
    script = [locked, [], [{ event_id: EVENT_ID }], [row]];
    const second = context();
    await updateEvent(second, EVENT_ID, input);
    await flush(second);
    expect(updates).toHaveLength(2);
    expect(updates[1]?.timesChanged).toBe(false);
    // An edit that moved no instant arms nothing.
    expect(armed).toEqual([]);
  });

  it('12. an identical body writes no row and emits NOTHING', async () => {
    script = [locked, [], [], [row]];
    const ctx = context();
    await updateEvent(ctx, EVENT_ID, input);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(updates).toHaveLength(0);
    expect(armed).toEqual([]);
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
    // 07-05: a cancel arms nothing and cancels nothing (the fire-time check does the rest).
    expect(armed).toEqual([]);

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
    // 07-05: the cancelled -> active transition re-arms both windows at the stored start.
    expect(armed.map((job) => (job.payload as { window: string }).window)).toEqual(['24h', '1h']);

    armed.length = 0;
    script = [[], [{ status: 'active' }], [row]];
    const repeat = context();
    await setEventStatus(repeat, EVENT_ID, { status: 'active' });
    expect(repeat.events).toHaveLength(0);
    // A repeat (no transition) arms nothing.
    expect(armed).toEqual([]);
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

describe('06-07 — attendance reads and code regeneration', () => {
  const attendeeRow = (id: string, status: string, removed = false) => ({
    id,
    status,
    responded_at: status === 'walk_in' ? null : '2026-10-10T12:00:00.123456Z',
    checked_in_at:
      status === 'checked_in' || status === 'walk_in' ? '2026-10-12T21:30:00.654321Z' : null,
    removed,
    display_name: removed ? null : 'Iris',
    avatar_asset_id: null,
    avatar_variant_widths: null,
  });
  const A1 = 'aaaaaaaa-0000-4000-8000-000000000001';
  const A2 = 'aaaaaaaa-0000-4000-8000-000000000002';

  it('25. each chip is its own LITERAL statement, and the list value is never a bound parameter', async () => {
    const predicates = {
      confirmed: "a.status = 'going'",
      not_going: "a.status = 'not_going'",
      present: 'a.checked_in_at is not null',
    } as const;
    for (const list of ['confirmed', 'not_going', 'present'] as const) {
      statements.length = 0;
      script = [[{ id: EVENT_ID }], []];
      await expect(listAttendance(context(), EVENT_ID, { list, limit: 10 })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('from events');
      expect(statements[1], list).toContain(predicates[list]);
      for (const [other, predicate] of Object.entries(predicates)) {
        if (other !== list) expect(statements[1], `${list} vs ${other}`).not.toContain(predicate);
      }
      expect(statements[1]).not.toContain(`"${list}"`);
    }
  });

  it('26. the in-lane existence check comes first: a miss is ONE bare 404 and no chip is read', async () => {
    script = [[]];
    const miss = listAttendance(context(), EVENT_ID, { list: 'present', limit: 10 });
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
    expect(statements).toHaveLength(1);
  });

  it('27. over-fetch sets nextCursor; a present page keys on checked_in_at; walkIn and removed map', async () => {
    script = [
      [{ id: EVENT_ID }],
      [attendeeRow(A2, 'walk_in', true), attendeeRow(A1, 'checked_in'), attendeeRow(A1, 'going')],
    ];
    const page = await listAttendance(context(), EVENT_ID, { list: 'present', limit: 2 });
    expect(page.items.map((item) => [item.walkIn, item.removed, item.displayName])).toEqual([
      [true, true, null],
      [false, false, 'Iris'],
    ]);
    expect(page.nextCursor).not.toBeNull();
    const envelope = JSON.parse(
      Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8'),
    ) as { n: string; id: string };
    expect(envelope).toMatchObject({ n: '2026-10-12T21:30:00.654321Z', id: A1 });

    // The cursor is spliced back as the next page's bound; a tampered `n` degrades to page 1.
    const tampered = Buffer.from(JSON.stringify({ v: 1, n: 'not-an-instant', id: A1 })).toString(
      'base64url',
    );
    statements.length = 0;
    script = [[{ id: EVENT_ID }], []];
    await listAttendance(context(), EVENT_ID, { list: 'present', limit: 2, cursor: tampered });
    expect(statements[1]).not.toContain('not-an-instant');
  });

  it('28. Pitfall 11: pending (going) and confirmed (going + checked_in) keep their own names', async () => {
    script = [
      [
        {
          format: 'in_person',
          pending_confirmed_count: 2,
          present_count: 2,
          not_going_count: 1,
          confirmed_count: 3,
          checkin_code: 'K7QM',
        },
      ],
    ];
    await expect(getAttendanceSummary(context(), EVENT_ID)).resolves.toEqual({
      format: 'in_person',
      pendingConfirmedCount: 2,
      presentCount: 2,
      notGoingCount: 1,
      confirmedCount: 3,
      checkinCode: 'K7QM',
    });
    expect(statements[0]).toContain("count(*) filter (where x.status = 'going')");
    expect(statements[0]).toContain("count(*) filter (where x.status in ('going','checked_in'))");
    script = [[]];
    await expect(getAttendanceSummary(context(), EVENT_ID)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('29. regeneration draws two DISTINCT candidates, emits nothing, and a miss is a bare 404', async () => {
    script = [[{ checkin_code: 'ABCD' }]];
    const ctx = context();
    await expect(regenerateCheckinCode(ctx, EVENT_ID)).resolves.toEqual({ checkinCode: 'ABCD' });
    expect(ctx.events).toHaveLength(0);
    expect(statements[0]).toContain('code_rotated_at = now()');
    expect(statements[0]).toContain("s.event_format = 'in_person'");
    const params = (
      JSON.parse(statements[0] ?? '{}') as { queryChunks: unknown[] }
    ).queryChunks.filter((chunk): chunk is string => typeof chunk === 'string');
    const candidates = params.filter((value) => /^[A-Z2-9]{4}$/.test(value));
    expect(new Set(candidates).size).toBe(2);

    script = [[]];
    const miss = regenerateCheckinCode(context(), EVENT_ID);
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
  });
});

describe('07-05 — event.reminder_due: ids, the window and one instant, exactly four keys', () => {
  let due: EventReminderDue[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    due = [];
    stop = subscribe('event.reminder_due', async (payload) => {
      due.push(payload);
    });
  });
  afterEach(() => {
    stop();
  });

  it('30. a passing reminder job emits ONE event.reminder_due and flushes it before returning', async () => {
    script = [[{ status: 'active', deleted: false, starts_at: STARTS_AT, starts_match: true }]];
    const fireAt = Date.parse(STARTS_AT) - 24 * 3_600_000;
    const outcome = await runEventReminder(
      { tenantId: TENANT_ID, eventId: EVENT_ID, window: '24h', startsAt: STARTS_AT },
      fireAt,
    );
    expect(outcome).toBe('emitted');
    // Already delivered: the job flushed its own context.
    expect(due).toHaveLength(1);
    expect(Object.keys(due[0] ?? {}).sort()).toEqual(['eventId', 'startsAt', 'tenantId', 'window']);
    expect(due[0]).toEqual({
      tenantId: TENANT_ID,
      eventId: EVENT_ID,
      window: '24h',
      startsAt: STARTS_AT,
    });
    // The fire-time read is ONE statement, and no title is ever read or carried.
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toContain('title');
  });

  it('31. a skipped reminder emits nothing', async () => {
    script = [[{ status: 'cancelled', deleted: false, starts_at: STARTS_AT, starts_match: true }]];
    const outcome = await runEventReminder(
      { tenantId: TENANT_ID, eventId: EVENT_ID, window: '1h', startsAt: STARTS_AT },
      Date.parse(STARTS_AT) - 3_600_000,
    );
    expect(outcome).toBe('skipped');
    expect(due).toHaveLength(0);
  });
});
