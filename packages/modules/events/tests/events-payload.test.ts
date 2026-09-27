import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventInput, EventPublished, EventRsvp } from '../contracts/index';

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

const { createEvent, rsvpEvent } = await import('../server/service');

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
