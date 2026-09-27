import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventInput, EventPublished } from '../contracts/index';

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
};

/**
 * With no cover, `createEvent` issues THREE statements: the `events` insert (returning the id), the
 * `event_secrets` insert, and the read-back through the shared projection.
 */
const tx = {
  execute: async (query: unknown) => {
    statements.push(JSON.stringify(query));
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

const { createEvent } = await import('../server/service');

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
