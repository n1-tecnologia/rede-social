import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MOD-03 — the guarantees `story.published` and `story.deleted` inherit from the kernel bus,
 * asserted without a database (the feed's and communities' `events.test.ts`, retargeted):
 *
 *  1. a publish that COMMITS queues exactly one event, and a registered subscriber receives it once;
 *  2. a publish that THROWS queues nothing, so a subscriber can never observe a story a rollback
 *     erased;
 *  3. the payload is IDS AND FLAGS ONLY — a story caption must never reach a log line (T-05-29),
 *     and the manifest's own subscriber logs the payload verbatim, so this is the assertion that
 *     stops one getting there;
 *  4. a story whose media asset is rejected BEFORE any transaction opens costs no statement at all.
 *
 * `withTenantTx` is the seam: mocking it lets the test decide whether the transaction resolves or
 * rejects, which is exactly the distinction guarantee 2 turns on. Nothing else is mocked — the bus
 * under test is the real one.
 */

const STORY_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';
/** The projection formats the timestamps in SQL (`to_char … 'US"Z"'`), so a row carries ISO TEXT. */
const PUBLISHED_AT = '2026-09-23T12:00:00.000000Z';
const EXPIRES_AT = '2026-09-24T12:00:00.000000Z';

/** Flipped per test: `'commit'` resolves the transaction, `'throw'` rejects it at the insert. */
let transaction: 'commit' | 'throw' = 'commit';
/** What the asset lookup answers: the story asset, a wrong-purpose one, or nothing at all. */
let asset: { kind: string; purpose: string } | null = { kind: 'image', purpose: 'story' };

const row = {
  id: STORY_ID,
  author_user_id: USER_ID,
  media_asset_id: ASSET_ID,
  media_kind: 'image' as const,
  media_variant_widths: [640, 1080],
  media_status: 'ready' as const,
  media_failure_reason: null,
  duration_seconds: null,
  caption: 'uma legenda que nunca deve aparecer num payload',
  published_at: PUBLISHED_AT,
  expires_at: EXPIRES_AT,
  is_active: true,
  like_count: 0,
  comment_count: 0,
  viewer_liked: false,
};

/**
 * `publishStory` issues THREE `tx.execute` calls in order — the asset lookup, the insert (returning
 * the id) and the read-back through the shared projection — so the mock answers them in that order.
 */
let executeCall = 0;

const tx = {
  execute: async () => {
    executeCall += 1;
    if (executeCall === 1) return asset === null ? [] : [asset];
    if (transaction === 'throw') throw new Error('insert refused by the database');
    return executeCall === 2 ? [{ id: STORY_ID }] : [row];
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { publishStory } = await import('../server/service');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

const input = { mediaAssetId: ASSET_ID, mediaKind: 'image' as const, caption: row.caption };

let received: Record<string, unknown>[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  transaction = 'commit';
  asset = { kind: 'image', purpose: 'story' };
  executeCall = 0;
  received = [];
  unsubscribe = subscribe('story.published', async (payload) => {
    received.push(payload as unknown as Record<string, unknown>);
  });
});

afterEach(() => {
  unsubscribe();
});

describe('story.published — after commit, exactly once, never on failure', () => {
  it('1. a committed publish queues ONE event and the subscriber receives it once after flush', async () => {
    const ctx = context();
    const story = await publishStory(ctx, input);

    expect(story.id).toBe(STORY_ID);
    // Queued, NOT delivered: `emit` only appends. Nothing has reached a subscriber yet.
    expect(ctx.events).toHaveLength(1);
    expect(received).toHaveLength(0);

    await flush(ctx);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      storyId: STORY_ID,
      tenantId: TENANT_ID,
      authorUserId: USER_ID,
      mediaKind: 'image',
      expiresAt: EXPIRES_AT,
    });
    // The queue is drained, so a second flush cannot deliver the same event twice.
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(1);
  });

  it('2. the payload is ids and flags ONLY — the caption never leaves the row (T-05-29)', async () => {
    const ctx = context();
    await publishStory(ctx, input);
    await flush(ctx);

    expect(Object.keys(received[0] ?? {}).sort()).toEqual([
      'authorUserId',
      'expiresAt',
      'mediaKind',
      'storyId',
      'tenantId',
    ]);
    // Said twice on purpose: the key list above would still pass if a caption were smuggled into
    // one of the five allowed fields.
    expect(JSON.stringify(received[0])).not.toContain('legenda');
  });

  it('3. a publish whose transaction throws queues NOTHING and delivers nothing (rollback)', async () => {
    transaction = 'throw';
    const ctx = context();

    await expect(publishStory(ctx, input)).rejects.toThrow(/insert refused/);

    // The guarantee in one line: `emit` runs only after `withTenantTx` RESOLVES.
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('4. a missing mediaAssetId is refused BEFORE any transaction opens, so nothing is queued', async () => {
    const ctx = context();

    await expect(
      publishStory(ctx, { mediaAssetId: null, mediaKind: 'image', caption: '' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { story: 'media_required' },
    });

    expect(executeCall).toBe(0);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('5. an asset this tenant cannot see is a BARE 404 with no details, and emits nothing', async () => {
    asset = null;
    const ctx = context();

    // D-23 / T-05-26: unknown, another tenant's and soft-deleted are one indistinguishable answer.
    // The `details` half is asserted on the SAME thrown value rather than by calling again, because
    // a second call would advance the statement counter and answer a different question.
    const thrown = await publishStory(ctx, input).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect((thrown as { details?: unknown }).details).toBeUndefined();

    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('6. an asset of the WRONG purpose is a 400 the caller can act on, and emits nothing', async () => {
    asset = { kind: 'image', purpose: 'post' };
    const ctx = context();

    await expect(publishStory(ctx, input)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { story: 'media_invalid' },
    });

    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
  });

  it('7. a subscriber that throws does not fail the caller, and the others still run', async () => {
    const alsoRan: string[] = [];
    const unsubscribeBroken = subscribe('story.published', async () => {
      throw new Error('subscriber exploded');
    });
    const unsubscribeHealthy = subscribe('story.published', async (payload) => {
      alsoRan.push(payload.storyId);
    });

    try {
      const ctx = context();
      await publishStory(ctx, input);
      // The write already committed; a broken subscriber is an operational problem, not a failed
      // request, so `flush` must resolve rather than reject.
      await expect(flush(ctx)).resolves.toBeUndefined();
      expect(received).toHaveLength(1);
      expect(alsoRan).toEqual([STORY_ID]);
    } finally {
      unsubscribeBroken();
      unsubscribeHealthy();
    }
  });
});
