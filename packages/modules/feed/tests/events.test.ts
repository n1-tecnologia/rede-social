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
  // 04-04: the projection's media half. `media` is `coalesce(json_agg(...), '[]'::json)`, so it is
  // ALWAYS an array on the wire — the fixture mirrors that rather than omitting it, which is what
  // makes `hasMedia` on the emitted event a real assertion instead of a guarded `?? []`.
  media_kind: 'none' as const,
  media: [],
};

/**
 * Statements the NEXT `tx.execute` calls should answer with, in order. Empty means "the post row",
 * which is what every 04-01 assertion needs. 04-03's interaction cases push their own.
 */
let executeQueue: unknown[][] = [];
/** Thrown by the next `tx.execute`, then cleared — how the 23503 refusal is simulated. */
let executeError: unknown = null;

const tx = {
  insert: () => ({
    values: () => ({
      returning: async () => {
        if (transaction === 'throw') throw new Error('insert refused by the database');
        return [{ id: POST_ID }];
      },
    }),
  }),
  execute: async () => {
    if (executeError !== null) {
      const error = executeError;
      executeError = null;
      throw error;
    }
    return executeQueue.length > 0 ? executeQueue.shift() : [row];
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { createComment, createPost, deleteComment, likePost, unlikePost } = await import(
  '../server/service'
);

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
  executeQueue = [];
  executeError = null;
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

/* ── 04-03: the five interaction events ────────────────────────────────────────────────────────── */

const COMMENT_ID = '55555555-5555-4555-8555-555555555555';
const PARENT_ID = '66666666-6666-4666-8666-666666666666';
const POST_AUTHOR_ID = '77777777-7777-4777-8777-777777777777';
const PARENT_AUTHOR_ID = '88888888-8888-4888-8888-888888888888';

/** A Postgres refusal shaped the way postgres.js raises it, wrapped once the way drizzle does. */
const pgError = (code: string, constraint: string) => ({
  message: 'refused',
  cause: { code, constraint_name: constraint },
});

const commentRow = {
  id: COMMENT_ID,
  created_at: CREATED_AT,
  body: 'olá',
  like_count: 0,
  viewer_liked: false,
  reply_count: 0,
  depth: 1,
  author_user_id: USER_ID,
  membership_id: MEMBERSHIP_ID,
  display_name: 'Membro',
  avatar_asset_id: null,
  post_author_user_id: POST_AUTHOR_ID,
  parent_author_user_id: PARENT_AUTHOR_ID,
};

describe('the interaction events — after commit, once, and never on a refusal', () => {
  it('4. a like emits ONE post.liked carrying the recipient Phase 7 needs', async () => {
    const ctx = context();
    const seen: unknown[] = [];
    const off = subscribe('post.liked', async (payload) => {
      seen.push(payload);
    });
    try {
      // insert (no rows) → the counter read-back inside the same transaction
      executeQueue = [[], [{ like_count: 1, author_user_id: POST_AUTHOR_ID }]];
      const result = await likePost(ctx, POST_ID);

      expect(result).toEqual({ liked: true, likeCount: 1 });
      expect(ctx.events).toHaveLength(1);
      await flush(ctx);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        postId: POST_ID,
        postAuthorUserId: POST_AUTHOR_ID,
        actorUserId: USER_ID,
      });
    } finally {
      off();
    }
  });

  it('5. an unlike that removed NOTHING is a successful no-op and emits no post.unliked', async () => {
    const ctx = context();
    const seen: unknown[] = [];
    const off = subscribe('post.unliked', async (payload) => {
      seen.push(payload);
    });
    try {
      // the delete returned no row: there was nothing to unlike
      executeQueue = [[], [{ like_count: 0, author_user_id: POST_AUTHOR_ID }]];
      expect(await unlikePost(ctx, POST_ID)).toEqual({ liked: false, likeCount: 0 });
      expect(ctx.events).toHaveLength(0);

      // …and the same call that DID remove a row emits exactly once.
      executeQueue = [[{ id: 'row' }], [{ like_count: 0, author_user_id: POST_AUTHOR_ID }]];
      await unlikePost(ctx, POST_ID);
      expect(ctx.events).toHaveLength(1);
      await flush(ctx);
      expect(seen).toHaveLength(1);
    } finally {
      off();
    }
  });

  it('6. a reply emits comment.created carrying BOTH the post author and the parent author', async () => {
    const ctx = context();
    const seen: unknown[] = [];
    const off = subscribe('comment.created', async (payload) => {
      seen.push(payload);
    });
    try {
      executeQueue = [[{ id: COMMENT_ID }], [commentRow]];
      const created = await createComment(ctx, POST_ID, { body: 'olá', parentId: PARENT_ID });

      expect(created.isReply).toBe(true);
      await flush(ctx);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        postId: POST_ID,
        commentId: COMMENT_ID,
        parentCommentId: PARENT_ID,
        postAuthorUserId: POST_AUTHOR_ID,
        parentAuthorUserId: PARENT_AUTHOR_ID,
        actorUserId: USER_ID,
      });
    } finally {
      off();
    }
  });

  it('7. a reply REFUSED by the database (23503) emits nothing and answers reply_depth_exceeded', async () => {
    const ctx = context();
    const seen: unknown[] = [];
    const off = subscribe('comment.created', async (payload) => {
      seen.push(payload);
    });
    try {
      executeError = pgError('23503', 'feed_comments_parent_fk');
      await expect(
        createComment(ctx, POST_ID, { body: 'olá', parentId: PARENT_ID }),
      ).rejects.toMatchObject({ status: 400, details: { comment: 'reply_depth_exceeded' } });

      // The guarantee in one line: the write never committed, so nothing was queued.
      expect(ctx.events).toHaveLength(0);
      await flush(ctx);
      expect(seen).toHaveLength(0);
    } finally {
      off();
    }
  });

  it('8. an UNRELATED integrity error is not mistranslated into a 400', async () => {
    const ctx = context();
    executeError = pgError('23503', 'feed_comments_post_id_feed_posts_id_fk');
    await expect(createComment(ctx, POST_ID, { body: 'olá' })).rejects.not.toMatchObject({
      status: 400,
    });
    expect(ctx.events).toHaveLength(0);
  });

  it('9. a soft delete emits comment.deleted once', async () => {
    const ctx = context();
    const seen: unknown[] = [];
    const off = subscribe('comment.deleted', async (payload) => {
      seen.push(payload);
    });
    try {
      executeQueue = [[{ id: COMMENT_ID }]];
      await deleteComment(ctx, COMMENT_ID);
      await flush(ctx);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ commentId: COMMENT_ID, actorUserId: USER_ID });
    } finally {
      off();
    }
  });
});
