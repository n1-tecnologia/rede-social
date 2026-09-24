import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * STORY-04 — the pin toggle's four properties, asserted without a database (`events.test.ts`'s
 * shape, retargeted at the pair this plan adds):
 *
 *  1. **Idempotent in BOTH directions, with no conflict status anywhere.** A repeat pin inserts
 *     nothing and still answers 200 with the current count; an unpin of something never pinned
 *     removes nothing and answers 200 too. A 409 on either would surface as an error toast on a
 *     gesture the admin has every right to repeat.
 *  2. **The event counts TRANSITIONS, not requests.** `story.pinned` fires only when a row was
 *     really created and `story.unpinned` only when one was really removed — the `story.unliked`
 *     rule applied to both halves. Phase 7 builds a notification row straight from these payloads,
 *     and a duplicate announcement of a state that never changed is a lie it cannot detect.
 *  3. **The payload is IDS ONLY** (T-05-29 / T-05-06): neither a story caption nor a community name
 *     may reach a log line, and the manifest's own subscriber logs the payload verbatim.
 *  4. **A refusal emits nothing and costs nothing it does not have to.** An archived target answers
 *     `400 { pin: 'archived' }`; a story or community this lane cannot see answers a BARE 404 with
 *     no `details` at all (D-23, T-05-49). Neither queues an event.
 *
 * `withTenantTx` is the seam, exactly as in `events.test.ts`: mocking it lets the test script what
 * each statement answers, which is the only way to distinguish "the insert created a row" from
 * "the insert conflicted" without a database. Nothing else is mocked — the bus is the real one.
 */

const STORY_ID = '11111111-1111-4111-8111-111111111111';
const COMMUNITY_ID = '55555555-5555-4555-8555-555555555555';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

/** What the target lookup answers: the pair resolved inside the transaction, or nothing. */
let target: { story_id: string; community_id: string; community_status: string } | null = {
  story_id: STORY_ID,
  community_id: COMMUNITY_ID,
  community_status: 'active',
};
/** Whether the insert/delete really moved a row — the distinction guarantee 2 turns on. */
let moved = true;
/** The count read back from the rows after the write. */
let pinnedCount = 1;

/** Every statement the scripted transaction saw, so "costs nothing it does not have to" is measurable. */
let statements = 0;

const tx = {
  execute: async () => {
    statements += 1;
    // 1: the pair lookup. 2: the insert/delete (`returning id`). 3: the count read-back.
    if (statements === 1) return target === null ? [] : [target];
    if (statements === 2) return moved ? [{ id: 'row' }] : [];
    return [{ pinned_community_count: pinnedCount }];
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const { pinStory, unpinStory } = await import('../server/service');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

let pinned: Record<string, unknown>[] = [];
let unpinned: Record<string, unknown>[] = [];
let unsubscribe: Array<() => void> = [];

beforeEach(() => {
  target = { story_id: STORY_ID, community_id: COMMUNITY_ID, community_status: 'active' };
  moved = true;
  pinnedCount = 1;
  statements = 0;
  pinned = [];
  unpinned = [];
  unsubscribe = [
    subscribe('story.pinned', async (payload) => {
      pinned.push(payload as unknown as Record<string, unknown>);
    }),
    subscribe('story.unpinned', async (payload) => {
      unpinned.push(payload as unknown as Record<string, unknown>);
    }),
  ];
});

afterEach(() => {
  for (const off of unsubscribe) off();
});

describe('STORY-04 — pinning a story to a community, idempotently and in both directions', () => {
  it('1. a pin creates one row and answers the story pinned-community count', async () => {
    const ctx = context();

    await expect(pinStory(ctx, STORY_ID, COMMUNITY_ID)).resolves.toEqual({
      pinned: true,
      pinnedCommunityCount: 1,
    });
  });

  it('2. a REPEAT pin creates no second row, answers the same count and never 409', async () => {
    const ctx = context();
    moved = false;
    pinnedCount = 1;

    const result = await pinStory(ctx, STORY_ID, COMMUNITY_ID);

    expect(result).toEqual({ pinned: true, pinnedCommunityCount: 1 });
    // …and it announced nothing: the unique pair absorbed the write, so no transition happened.
    await flush(ctx);
    expect(pinned).toHaveLength(0);
  });

  it('3. a pin that really created a row emits story.pinned exactly once, ids only', async () => {
    const ctx = context();
    await pinStory(ctx, STORY_ID, COMMUNITY_ID);

    // Queued, not delivered: `emit` only appends (MOD-03).
    expect(ctx.events).toHaveLength(1);
    await flush(ctx);

    expect(pinned).toHaveLength(1);
    expect(Object.keys(pinned[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'storyId',
      'tenantId',
    ]);
    expect(pinned[0]).toMatchObject({
      tenantId: TENANT_ID,
      storyId: STORY_ID,
      communityId: COMMUNITY_ID,
      actorUserId: USER_ID,
    });
  });

  it('4. an unpin removes the row and answers the DECREMENTED count', async () => {
    const ctx = context();
    pinnedCount = 0;

    await expect(unpinStory(ctx, STORY_ID, COMMUNITY_ID)).resolves.toEqual({
      pinned: false,
      pinnedCommunityCount: 0,
    });
  });

  it('5. unpinning something that was never pinned removes nothing and emits NO event', async () => {
    const ctx = context();
    moved = false;
    pinnedCount = 2;

    const result = await unpinStory(ctx, STORY_ID, COMMUNITY_ID);

    expect(result).toEqual({ pinned: false, pinnedCommunityCount: 2 });
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(unpinned).toHaveLength(0);
  });

  it('6. an unpin that really removed a row emits story.unpinned once, ids only', async () => {
    const ctx = context();
    pinnedCount = 0;
    await unpinStory(ctx, STORY_ID, COMMUNITY_ID);
    await flush(ctx);

    expect(unpinned).toHaveLength(1);
    expect(Object.keys(unpinned[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'storyId',
      'tenantId',
    ]);
  });

  it('7. an ARCHIVED target community is refused with the 05-03 vocabulary, and emits nothing', async () => {
    const ctx = context();
    target = { story_id: STORY_ID, community_id: COMMUNITY_ID, community_status: 'archived' };

    await expect(pinStory(ctx, STORY_ID, COMMUNITY_ID)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { pin: 'archived' },
    });

    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(pinned).toHaveLength(0);
  });

  it('8. a pair this lane cannot see is a BARE 404 with no details, and writes nothing', async () => {
    const ctx = context();
    target = null;

    // D-23 / T-05-49: an unknown story, an unknown community, another tenant's of either — one
    // indistinguishable answer. The `details` half is read off the SAME thrown value, because a
    // second call would advance the statement counter and answer a different question.
    const thrown = await pinStory(ctx, STORY_ID, COMMUNITY_ID).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect((thrown as { details?: unknown }).details).toBeUndefined();

    // The lookup ran and then the transaction stopped: no insert, no read-back.
    expect(statements).toBe(1);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(pinned).toHaveLength(0);
  });

  it('9. an unpin whose pair this lane cannot see is the same bare 404', async () => {
    const ctx = context();
    target = null;

    const thrown = await unpinStory(ctx, STORY_ID, COMMUNITY_ID).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect((thrown as { details?: unknown }).details).toBeUndefined();
    expect(ctx.events).toHaveLength(0);
  });

  it('10. an ARCHIVED community can still be UNPINNED — the refusal gates new content only', async () => {
    const ctx = context();
    target = { story_id: STORY_ID, community_id: COMMUNITY_ID, community_status: 'archived' };
    pinnedCount = 0;

    // The admin archived the container after pinning; taking the pin back must not be the one
    // action archiving blocks, or the story stays highlighted forever with no way to remove it.
    await expect(unpinStory(ctx, STORY_ID, COMMUNITY_ID)).resolves.toEqual({
      pinned: false,
      pinnedCommunityCount: 0,
    });
  });
});
