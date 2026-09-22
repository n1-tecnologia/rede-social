import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MOD-03, criterion 4 — the two guarantees `post.published` inherits from the kernel bus, asserted
 * without a database:
 *
 *  1. a create that COMMITS queues exactly one event, and a registered subscriber receives it once;
 *  2. a create that THROWS queues nothing, so a subscriber can never observe a post a rollback
 *     erased.
 *
 * `withTenantTx` is the seam: mocking it lets the test decide whether the transaction resolves or
 * rejects, which is exactly the distinction the two guarantees turn on. Nothing else is mocked — the
 * bus under test is the real one.
 */

const POST_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const MEMBERSHIP_ID = '44444444-4444-4444-8444-444444444444';
/** The projection formats timestamps in SQL (`to_char … 'US"Z"'`), so a row carries ISO TEXT. */
const CREATED_AT = '2026-09-22T12:00:00.000000Z';

/** Flipped per test: `'commit'` resolves the transaction, `'throw'` rejects it before the insert. */
let transaction: 'commit' | 'throw' = 'commit';

const row = {
  id: POST_ID,
  created_at: CREATED_AT,
  edited_at: null,
  caption: 'olá',
  community_id: null,
  like_count: 0,
  comment_count: 0,
  author_user_id: USER_ID,
  membership_id: MEMBERSHIP_ID,
  display_name: 'Admin',
  avatar_asset_id: null,
};

const tx = {
  insert: () => ({
    values: () => ({
      returning: async () => {
        if (transaction === 'throw') throw new Error('insert refused by the database');
        return [{ id: POST_ID }];
      },
    }),
  }),
  execute: async () => [row],
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { createPost } = await import('../server/service');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

let received: { postId: string; tenantId: string; authorUserId: string }[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  transaction = 'commit';
  received = [];
  unsubscribe = subscribe('post.published', async (payload) => {
    received.push(payload);
  });
});

afterEach(() => {
  unsubscribe();
});

describe('post.published — after commit, exactly once, never on failure', () => {
  it('1. a committed create queues ONE event and the subscriber receives it once after flush', async () => {
    const ctx = context();
    const post = await createPost(ctx, { caption: 'olá' });

    expect(post.id).toBe(POST_ID);
    // Queued, NOT delivered: `emit` only appends. Nothing has reached a subscriber yet.
    expect(ctx.events).toHaveLength(1);
    expect(received).toHaveLength(0);

    await flush(ctx);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      postId: POST_ID,
      tenantId: TENANT_ID,
      authorUserId: USER_ID,
    });
    // The queue is drained, so a second flush cannot deliver the same event twice.
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(1);
  });

  it('2. a create whose transaction throws queues NOTHING and delivers nothing', async () => {
    transaction = 'throw';
    const ctx = context();

    await expect(createPost(ctx, { caption: 'olá' })).rejects.toThrow(/insert refused/);

    // The guarantee in one line: `emit` runs only after `withTenantTx` RESOLVES.
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('3. a subscriber that throws does not fail the caller, and the others still run', async () => {
    const alsoRan: string[] = [];
    const unsubscribeBroken = subscribe('post.published', async () => {
      throw new Error('subscriber exploded');
    });
    const unsubscribeHealthy = subscribe('post.published', async (payload) => {
      alsoRan.push(payload.postId);
    });

    try {
      const ctx = context();
      await createPost(ctx, { caption: 'olá' });
      // The write already committed; a broken subscriber is an operational problem, not a failed
      // request, so `flush` must resolve rather than reject.
      await expect(flush(ctx)).resolves.toBeUndefined();
      expect(received).toHaveLength(1);
      expect(alsoRan).toEqual([POST_ID]);
    } finally {
      unsubscribeBroken();
      unsubscribeHealthy();
    }
  });
});
