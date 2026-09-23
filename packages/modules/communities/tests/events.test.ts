import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MOD-03 — the two guarantees `community.created` inherits from the kernel bus, asserted without a
 * database (a direct copy of `packages/modules/feed/tests/events.test.ts`, retargeted):
 *
 *  1. a create that COMMITS queues exactly one event, and a registered subscriber receives it once;
 *  2. a create that THROWS queues nothing, so a subscriber can never observe a community a rollback
 *     erased.
 *
 * `withTenantTx` is the seam: mocking it lets the test decide whether the transaction resolves or
 * rejects, which is exactly the distinction the two guarantees turn on. Nothing else is mocked — the
 * bus under test is the real one.
 */

const COMMUNITY_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
/** The projection formats the timestamp in SQL (`to_char … 'US"Z"'`), so a row carries ISO TEXT. */
const LAST_ACTIVITY_AT = '2026-09-23T12:00:00.000000Z';

/** Flipped per test: `'commit'` resolves the transaction, `'throw'` rejects it at the insert. */
let transaction: 'commit' | 'throw' = 'commit';

const row = {
  id: COMMUNITY_ID,
  name: 'Avisos',
  slug: 'avisos',
  description: '',
  cover_asset_id: null,
  cover_variant_widths: null,
  post_count: 0,
  status: 'active' as const,
  last_activity_at: LAST_ACTIVITY_AT,
};

/**
 * `createCommunity` issues TWO `tx.execute` calls — the insert (returning the id) and the read-back
 * through the shared projection — so the mock answers them in that order. Thrown by the next call
 * when `executeError` is set, which is how the unique-violation retry is simulated.
 */
let executeCall = 0;
let executeError: unknown = null;

const tx = {
  execute: async () => {
    if (executeError !== null) {
      const error = executeError;
      executeError = null;
      throw error;
    }
    if (transaction === 'throw') throw new Error('insert refused by the database');
    executeCall += 1;
    return executeCall % 2 === 1 ? [{ id: COMMUNITY_ID }] : [row];
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { createCommunity } = await import('../server/service');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

let received: { communityId: string; tenantId: string; actorUserId: string }[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  transaction = 'commit';
  executeCall = 0;
  executeError = null;
  received = [];
  unsubscribe = subscribe('community.created', async (payload) => {
    received.push(payload);
  });
});

afterEach(() => {
  unsubscribe();
});

describe('community.created — after commit, exactly once, never on failure', () => {
  it('1. a committed create queues ONE event and the subscriber receives it once after flush', async () => {
    const ctx = context();
    const community = await createCommunity(ctx, { name: 'Avisos', description: '' });

    expect(community.id).toBe(COMMUNITY_ID);
    // Queued, NOT delivered: `emit` only appends. Nothing has reached a subscriber yet.
    expect(ctx.events).toHaveLength(1);
    expect(received).toHaveLength(0);

    await flush(ctx);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      communityId: COMMUNITY_ID,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
    });
    // T-05-06: ids ONLY. A community name in the payload would reach a log line through the
    // manifest's own subscriber, which logs the payload verbatim.
    expect(Object.keys(received[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'tenantId',
    ]);
    // The queue is drained, so a second flush cannot deliver the same event twice.
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(1);
  });

  it('2. a create whose transaction throws queues NOTHING and delivers nothing (rollback)', async () => {
    transaction = 'throw';
    const ctx = context();

    await expect(createCommunity(ctx, { name: 'Avisos', description: '' })).rejects.toThrow(
      /insert refused/,
    );

    // The guarantee in one line: `emit` runs only after `withTenantTx` RESOLVES.
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('3. an empty name is refused BEFORE any transaction opens, so nothing is queued', async () => {
    const ctx = context();

    await expect(createCommunity(ctx, { name: '   ', description: '' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { community: 'name_required' },
    });

    expect(executeCall).toBe(0);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('4. a slug collision RETRIES the next suffix and still emits exactly one event — never a 409', async () => {
    // Postgres' unique violation, shaped the way postgres.js raises it and drizzle wraps it.
    executeError = {
      message: 'refused',
      cause: { code: '23505', constraint_name: 'communities_tenant_slug_uq' },
    };

    const ctx = context();
    const community = await createCommunity(ctx, { name: 'Avisos', description: '' });

    expect(community.id).toBe(COMMUNITY_ID);
    // One create, one event — the retry is invisible from the outside, which is the whole point:
    // two admins naming a community the same thing is not a conflict to surface.
    expect(ctx.events).toHaveLength(1);
    await flush(ctx);
    expect(received).toHaveLength(1);
  });

  it('5. a subscriber that throws does not fail the caller, and the others still run', async () => {
    const alsoRan: string[] = [];
    const unsubscribeBroken = subscribe('community.created', async () => {
      throw new Error('subscriber exploded');
    });
    const unsubscribeHealthy = subscribe('community.created', async (payload) => {
      alsoRan.push(payload.communityId);
    });

    try {
      const ctx = context();
      await createCommunity(ctx, { name: 'Avisos', description: '' });
      // The write already committed; a broken subscriber is an operational problem, not a failed
      // request, so `flush` must resolve rather than reject.
      await expect(flush(ctx)).resolves.toBeUndefined();
      expect(received).toHaveLength(1);
      expect(alsoRan).toEqual([COMMUNITY_ID]);
    } finally {
      unsubscribeBroken();
      unsubscribeHealthy();
    }
  });
});

describe('slugify — the per-tenant URL segment (COMM-01 edge/encoding)', () => {
  it('6. folds accents to ASCII, collapses separators and never splits a grapheme', async () => {
    const { slugify } = await import('../server/service');

    expect(slugify('Avisos da Diretoria')).toBe('avisos-da-diretoria');
    expect(slugify('Ação & Comunicação')).toBe('acao-comunicacao');
    expect(slugify('  ---Espaços   estranhos---  ')).toBe('espacos-estranhos');
    // A name made entirely of emoji folds to the empty string; `createCommunity` then falls back,
    // because a community must always have a slug.
    expect(slugify('🙂🙂🙂')).toBe('');
    // The cap never leaves a trailing separator behind, which would make two names collide on a
    // slug that merely LOOKS different.
    expect(slugify('a'.repeat(80))).toBe('a'.repeat(64));
    expect(slugify(`${'a'.repeat(64)} bcd`).endsWith('-')).toBe(false);
  });
});
