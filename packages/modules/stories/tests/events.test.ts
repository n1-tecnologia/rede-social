import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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

/**
 * `'plain'` is every case in the first block — a publish with no destination, three statements.
 * (05.1's `'community'` mode, a publish that wrote a community pin, retired with the pin model in
 * 05.2-11.)
 */
let mode: 'plain' | 'highlight' | 'inline' = 'plain';

/**
 * 05.2 (D-113/D-114): `'highlight'` and `'inline'` publish INTO a highlight. Those two modes answer
 * by the statement's TEXT (rendered through drizzle's own `PgDialect`, `story-highlights.test.ts`'s
 * script) rather than by its index, so each case can assert the ORDER the statements ran in by name.
 * The plain cases never enter this branch and keep their index-based answers unchanged.
 */
const dialect = new PgDialect();
const HIGHLIGHT_ID = '66666666-6666-4666-8666-666666666666';
const NEW_HIGHLIGHT_ID = '77777777-7777-4777-8777-777777777777';
const PLACE_ID = '55555555-5555-4555-8555-555555555555';
/** The existing highlight's place: null is Início, else a community id. */
let highlightPlace: string | null = null;
/** The place community's status (only read when a community place is named). */
let placeStatus = 'active';
/** How many stories the existing highlight already holds. */
let heldItems = 0;
/** How many highlights the inline place already holds (its `for update` lock answers that many). */
let placeHighlights = 0;
/** Whether the communities module is on — the place gate is read BEFORE the transaction. */
let communitiesOn = true;
/** How many times the module flag was read: a publish with no destination must read it zero times. */
let flagReads = 0;
/** Every statement the scripted modes saw, by the kind the script recognised. */
let seen: string[] = [];

/** The item-cap read (WR-01): pins that the count filters out soft-deleted stories. */
const ROOM_COUNT =
  /^select count\(\*\) filter \(where s\.deleted_at is null\)::int as n, coalesce\(bool_or/;

function classify(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/^select h\.id, h\.community_id/.test(t)) return 'highlight';
  if (/from communities c/.test(t)) return 'place';
  if (ROOM_COUNT.test(t)) return 'room';
  if (/^select h\.id from story_highlights h .* for update$/.test(t)) return 'lock';
  if (/^select kind, purpose from media_assets/.test(t)) return 'asset';
  if (/^insert into stories /.test(t)) return 'story-insert';
  if (/^insert into story_highlights /.test(t)) return 'highlight-insert';
  if (/^insert into story_highlight_items/.test(t)) return 'item';
  if (/^select s\.id, s\.author_user_id/.test(t)) return 'projection';
  return `unknown: ${t.slice(0, 60)}`;
}

function scripted(query: SQL): unknown[] {
  const kind = classify(dialect.sqlToQuery(query).sql);
  seen.push(kind);
  switch (kind) {
    case 'highlight':
      return [
        {
          id: HIGHLIGHT_ID,
          community_id: highlightPlace,
          title: 'Aulas',
          cover_story_id: null,
          cover_asset_id: null,
        },
      ];
    case 'place':
      return [{ status: placeStatus }];
    case 'room':
      return [{ n: heldItems, present: false }];
    case 'lock':
      return Array.from({ length: placeHighlights }, (_, index) => ({ id: `h-${index}` }));
    case 'asset':
      return asset === null ? [] : [asset];
    case 'story-insert':
      return [{ id: STORY_ID }];
    case 'highlight-insert':
      return [{ id: NEW_HIGHLIGHT_ID }];
    case 'item':
      return [{ id: 'item-row' }];
    case 'projection':
      return [{ ...row, highlight_count: 1 }];
    default:
      return [];
  }
}

const tx = {
  execute: async (query: SQL) => {
    executeCall += 1;
    if (mode === 'highlight' || mode === 'inline') return scripted(query);
    if (executeCall === 1) return asset === null ? [] : [asset];
    if (transaction === 'throw') throw new Error('insert refused by the database');
    return executeCall === 2 ? [{ id: STORY_ID }] : [row];
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

vi.mock('@tria/core/server/modules/flags-cache', () => ({
  moduleFlags: {
    isEnabled: async () => {
      flagReads += 1;
      return communitiesOn;
    },
  },
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
  mode = 'plain';
  highlightPlace = null;
  placeStatus = 'active';
  heldItems = 0;
  placeHighlights = 0;
  communitiesOn = true;
  flagReads = 0;
  seen = [];
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

describe('05.2 — a publish INTO a highlight: destination first, one write, events after commit (D-113/D-114)', () => {
  let highlighted: Record<string, unknown>[] = [];
  let createdHighlights: Record<string, unknown>[] = [];
  const offs: (() => void)[] = [];

  beforeEach(() => {
    highlighted = [];
    createdHighlights = [];
    offs.push(
      subscribe('story.highlighted', async (payload) => {
        highlighted.push(payload as unknown as Record<string, unknown>);
      }),
      subscribe('highlight.created', async (payload) => {
        createdHighlights.push(payload as unknown as Record<string, unknown>);
      }),
    );
  });

  afterEach(() => {
    for (const off of offs.splice(0)) off();
  });

  it('12. into an existing Início highlight: highlight row → room → asset → insert → item → projection, then published + highlighted', async () => {
    mode = 'highlight';
    const ctx = context();
    const story = await publishStory(ctx, { ...input, highlightId: HIGHLIGHT_ID });

    expect(seen).toEqual(['highlight', 'room', 'asset', 'story-insert', 'item', 'projection']);
    expect(story.highlightCount).toBe(1);
    // Queued in order, NOT delivered yet (MOD-03).
    expect(ctx.events.map((event) => event.name)).toEqual(['story.published', 'story.highlighted']);
    expect(highlighted).toHaveLength(0);

    await flush(ctx);

    expect(received).toHaveLength(1);
    expect(highlighted).toHaveLength(1);
    expect(Object.keys(highlighted[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'highlightId',
      'storyId',
      'tenantId',
    ]);
    expect(highlighted[0]).toMatchObject({
      tenantId: TENANT_ID,
      storyId: STORY_ID,
      highlightId: HIGHLIGHT_ID,
      actorUserId: USER_ID,
    });
    expect(JSON.stringify(highlighted[0])).not.toContain('legenda');
  });

  it('13. a highlight in an ARCHIVED community is refused `archived` after its two destination statements, and queues nothing', async () => {
    mode = 'highlight';
    highlightPlace = PLACE_ID;
    placeStatus = 'archived';
    const ctx = context();

    await expect(publishStory(ctx, { ...input, highlightId: HIGHLIGHT_ID })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { highlight: 'archived' },
    });

    // Destination first: no asset lookup, no insert.
    expect(seen).toEqual(['highlight', 'place']);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(received).toHaveLength(0);
    expect(highlighted).toHaveLength(0);
  });

  it('14. a FULL highlight refuses the new story `full` before the asset, and queues nothing', async () => {
    mode = 'highlight';
    heldItems = 100;
    const ctx = context();

    await expect(publishStory(ctx, { ...input, highlightId: HIGHLIGHT_ID })).rejects.toMatchObject({
      status: 400,
      details: { highlight: 'full' },
    });
    expect(seen).toEqual(['highlight', 'room']);
    expect(ctx.events).toHaveLength(0);
  });

  it('15. inline into a community: place → place lock → asset → story insert → highlight insert → item → projection, three events in order', async () => {
    mode = 'inline';
    placeHighlights = 2;
    const ctx = context();
    const story = await publishStory(ctx, {
      ...input,
      newHighlight: { communityId: PLACE_ID, title: 'Teste Um' },
    });

    expect(seen).toEqual([
      'place',
      'lock',
      'asset',
      'story-insert',
      'highlight-insert',
      'item',
      'projection',
    ]);
    expect(story.highlightCount).toBe(1);
    expect(ctx.events.map((event) => event.name)).toEqual([
      'story.published',
      'highlight.created',
      'story.highlighted',
    ]);

    await flush(ctx);

    expect(createdHighlights).toHaveLength(1);
    expect(Object.keys(createdHighlights[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'highlightId',
      'tenantId',
    ]);
    expect(createdHighlights[0]).toMatchObject({
      highlightId: NEW_HIGHLIGHT_ID,
      communityId: PLACE_ID,
      actorUserId: USER_ID,
    });
    // Ids only: the curator-written title never rides an event (T-05.2-37).
    expect(JSON.stringify(createdHighlights[0])).not.toContain('Teste Um');
    expect(highlighted[0]).toMatchObject({ storyId: STORY_ID, highlightId: NEW_HIGHLIGHT_ID });
  });

  it('16. inline into Início skips the community read; a FULL place is refused `full` after the lock and writes nothing', async () => {
    mode = 'inline';
    const ctx = context();
    await publishStory(ctx, { ...input, newHighlight: { communityId: null, title: 'Teste Dois' } });
    expect(seen).toEqual([
      'lock',
      'asset',
      'story-insert',
      'highlight-insert',
      'item',
      'projection',
    ]);

    seen = [];
    placeHighlights = 50;
    const refusedCtx = context();
    await expect(
      publishStory(refusedCtx, {
        ...input,
        newHighlight: { communityId: null, title: 'Teste Tres' },
      }),
    ).rejects.toMatchObject({ status: 400, details: { highlight: 'full' } });
    expect(seen).toEqual(['lock']);
    expect(refusedCtx.events).toHaveLength(0);
  });

  it('17. an inline create into an ARCHIVED community is refused `archived` after ONE statement', async () => {
    mode = 'inline';
    placeStatus = 'archived';
    const ctx = context();

    await expect(
      publishStory(ctx, { ...input, newHighlight: { communityId: PLACE_ID, title: 'Teste' } }),
    ).rejects.toMatchObject({ status: 400, details: { highlight: 'archived' } });
    expect(seen).toEqual(['place']);
    expect(ctx.events).toHaveLength(0);
  });

  it('18. WITHOUT a destination the module flag is never read and exactly three statements run', async () => {
    mode = 'plain';
    const ctx = context();

    await publishStory(ctx, input);

    expect(flagReads).toBe(0);
    expect(executeCall).toBe(3);
    expect(ctx.events.map((event) => event.name)).toEqual(['story.published']);
  });
});
