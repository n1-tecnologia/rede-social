import type { RequestContext } from '@tria/core/server/auth/context';
import { flush, subscribe } from '@tria/core/server/events/bus';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 05.2-03 — the curation writes' properties, asserted without a database (`story-pins.test.ts`'s
 * shape, retargeted at the highlight writes):
 *
 *  1. **Removal is idempotent** (HIGHLIGHT-02): removing a pair that is there answers `{ highlighted:
 *     false, highlightCount }` and announces it once; removing a pair that is NOT there answers the
 *     same 200 shape and announces nothing.
 *  2. **Events count TRANSITIONS, not requests** (R-D-L): a PATCH identical to the stored row writes
 *     nothing observable and announces nothing.
 *  3. **Payloads are IDS ONLY** (T-05.2-17): the manifest's handlers log payloads verbatim, so each
 *     key set is asserted with `sort()` rather than trusted — no title, no caption.
 *  4. **A refusal writes nothing and emits nothing**: an archived place refuses a rename with
 *     `{ highlight: 'archived' }` before any write statement runs.
 *
 * `withTenantTx` is the seam, as in `story-pins.test.ts`, but the scripted transaction answers by
 * the statement's TEXT (rendered through drizzle's own `PgDialect`) rather than by its index, so the
 * script names what each answer is for. `moduleFlags` is mocked because the place gate reads it
 * before the transaction opens. The bus is the real one.
 */

const HIGHLIGHT_ID = '66666666-6666-4666-8666-666666666666';
const STORY_ID = '11111111-1111-4111-8111-111111111111';
const COMMUNITY_ID = '55555555-5555-4555-8555-555555555555';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const dialect = new PgDialect();

/** The highlight the in-lane lookup resolves (null = a miss). */
let highlight: {
  id: string;
  community_id: string | null;
  title: string;
  cover_story_id: string | null;
  cover_asset_id: string | null;
} | null = null;
/** The place's community status (only read when `highlight.community_id` is set). */
let communityStatus = 'active';
/** Whether the write statement (delete/update `returning`) really moved a row. */
let moved = true;
/** The STORY's highlight count read back after a removal. */
let highlightCount = 0;
/** Whether the communities module is on for the tenant. */
let communitiesOn = true;
/** The ids the reorder's place lock finds — the place's CURRENT set, in its current order. */
let placeIds: string[] = [];

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Every statement the scripted transaction saw, by the kind the script recognised… */
let seen: string[] = [];
/** …and its whitespace-normalised text, so "never touches `stories`" is a check on the SQL itself. */
let texts: string[] = [];

function classify(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/^select h\.id, h\.community_id/.test(t)) return 'highlight';
  if (/^select h\.id from story_highlights h .* for update$/.test(t)) return 'lock';
  if (/^update story_highlights h set position/.test(t)) return 'renumber';
  if (/from communities c/.test(t)) return 'place';
  if (/^select s\.id from stories s/.test(t)) return 'story';
  if (/^delete from story_highlight_items/.test(t)) return 'remove';
  if (/^update story_highlights set cover_story_id = null/.test(t)) return 'clear-cover';
  if (/as highlight_count/.test(t)) return 'count';
  if (/^update story_highlights/.test(t)) return 'update';
  if (/^delete from story_highlights/.test(t)) return 'delete';
  if (/^select hp\.\* from/.test(t)) return 'summary';
  return `unknown: ${t.slice(0, 60)}`;
}

const tx = {
  execute: async (query: SQL) => {
    const text = dialect.sqlToQuery(query).sql;
    const kind = classify(text);
    seen.push(kind);
    texts.push(text.replace(/\s+/g, ' ').trim());
    switch (kind) {
      case 'highlight':
        return highlight === null ? [] : [highlight];
      case 'place':
        return [{ status: communityStatus }];
      case 'lock':
        return placeIds.map((id) => ({ id }));
      case 'renumber':
        return moved ? [{ id: A }] : [];
      case 'story':
        return [{ id: STORY_ID }];
      case 'remove':
      case 'update':
        return moved ? [{ id: 'row' }] : [];
      case 'delete':
        return moved && highlight
          ? [{ id: highlight.id, community_id: highlight.community_id }]
          : [];
      case 'count':
        return [{ highlight_count: highlightCount }];
      case 'summary':
        return [
          {
            id: HIGHLIGHT_ID,
            community_id: highlight?.community_id ?? null,
            title: highlight?.title ?? '',
            position: 0,
            cover_asset_id: null,
            cover_variant_widths: null,
            cover_story_id: null,
            cover_chosen: false,
            item_count: 1,
          },
        ];
      default:
        return [];
    }
  },
};

vi.mock('@tria/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

vi.mock('@tria/core/server/modules/flags-cache', () => ({
  moduleFlags: { isEnabled: async () => communitiesOn },
}));

const { deleteHighlight, removeStoryFromHighlight, reorderHighlights, updateHighlight } =
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

type Payload = Record<string, unknown>;
let unhighlighted: Payload[] = [];
let updated: Payload[] = [];
let deleted: Payload[] = [];
let reordered: Payload[] = [];
let unsubscribe: Array<() => void> = [];

beforeEach(() => {
  highlight = {
    id: HIGHLIGHT_ID,
    community_id: null,
    title: 'Bastidores',
    cover_story_id: null,
    cover_asset_id: null,
  };
  communityStatus = 'active';
  moved = true;
  highlightCount = 0;
  communitiesOn = true;
  placeIds = [A, B, C];
  seen = [];
  texts = [];
  unhighlighted = [];
  updated = [];
  deleted = [];
  reordered = [];
  unsubscribe = [
    subscribe('highlight.reordered', async (payload) => {
      reordered.push(payload as unknown as Payload);
    }),
    subscribe('story.unhighlighted', async (payload) => {
      unhighlighted.push(payload as unknown as Payload);
    }),
    subscribe('highlight.updated', async (payload) => {
      updated.push(payload as unknown as Payload);
    }),
    subscribe('highlight.deleted', async (payload) => {
      deleted.push(payload as unknown as Payload);
    }),
  ];
});

afterEach(() => {
  for (const off of unsubscribe) off();
});

describe('05.2-03 — curating a highlight: idempotent, transitions-only, ids-only', () => {
  it('1. a remove that deleted a row answers the count and emits story.unhighlighted once, ids only', async () => {
    const ctx = context();
    highlightCount = 1;

    await expect(removeStoryFromHighlight(ctx, HIGHLIGHT_ID, STORY_ID)).resolves.toEqual({
      highlighted: false,
      highlightCount: 1,
    });

    // The story row is never written (R-D-F): no statement of this remove targets `stories`.
    expect(seen).toEqual(['highlight', 'story', 'remove', 'clear-cover', 'count']);
    expect(texts.some((text) => /^(update|delete from) stories\b/.test(text))).toBe(false);
    expect(ctx.events).toHaveLength(1);
    await flush(ctx);

    expect(unhighlighted).toHaveLength(1);
    expect(Object.keys(unhighlighted[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'highlightId',
      'storyId',
      'tenantId',
    ]);
    expect(unhighlighted[0]).toMatchObject({
      tenantId: TENANT_ID,
      highlightId: HIGHLIGHT_ID,
      storyId: STORY_ID,
      actorUserId: USER_ID,
    });
  });

  it('2. removing a pair that is NOT there still answers 200 and emits nothing', async () => {
    const ctx = context();
    moved = false;
    highlightCount = 2;

    await expect(removeStoryFromHighlight(ctx, HIGHLIGHT_ID, STORY_ID)).resolves.toEqual({
      highlighted: false,
      highlightCount: 2,
    });

    // Nothing was removed, so the chosen-cover pointer has nothing to follow and is not touched.
    expect(seen).not.toContain('clear-cover');
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(unhighlighted).toHaveLength(0);
  });

  it('3. a PATCH that changed nothing (the same title) answers the summary and emits nothing', async () => {
    const ctx = context();
    moved = false;

    const result = await updateHighlight(ctx, HIGHLIGHT_ID, { title: 'Bastidores' });

    expect(result).toMatchObject({ id: HIGHLIGHT_ID, title: 'Bastidores', coverChosen: false });
    // The guarded UPDATE ran and matched nothing — the `is distinct from` predicate, not a JS
    // comparison, is what decided that nothing changed.
    expect(seen).toContain('update');
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(updated).toHaveLength(0);
  });

  it('4. an ARCHIVED place refuses a rename with `archived` before any write, and emits nothing', async () => {
    const ctx = context();
    if (highlight) highlight.community_id = COMMUNITY_ID;
    communityStatus = 'archived';

    await expect(updateHighlight(ctx, HIGHLIGHT_ID, { title: 'Novo nome' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { highlight: 'archived' },
    });

    // The highlight lookup and the place lookup — the one seam's two reads — and then the
    // transaction stopped: no UPDATE, no read-back.
    expect(seen).toEqual(['highlight', 'place']);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(updated).toHaveLength(0);
  });

  it('5. a real delete emits highlight.deleted with exactly the four ids', async () => {
    const ctx = context();
    if (highlight) highlight.community_id = COMMUNITY_ID;

    await deleteHighlight(ctx, HIGHLIGHT_ID);

    expect(seen).toContain('delete');
    await flush(ctx);
    expect(deleted).toHaveLength(1);
    expect(Object.keys(deleted[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'highlightId',
      'tenantId',
    ]);
    expect(deleted[0]).toMatchObject({
      tenantId: TENANT_ID,
      highlightId: HIGHLIGHT_ID,
      communityId: COMMUNITY_ID,
      actorUserId: USER_ID,
    });
  });

  it('6. a PATCH that really changed the title emits highlight.updated once, ids only', async () => {
    const ctx = context();

    await updateHighlight(ctx, HIGHLIGHT_ID, { title: 'Novo nome' });
    await flush(ctx);

    expect(updated).toHaveLength(1);
    expect(Object.keys(updated[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'highlightId',
      'tenantId',
    ]);
  });

  it('7. an unknown highlight is ONE bare 404 with no details, for every write, and nothing moves', async () => {
    highlight = null;
    for (const call of [
      (ctx: RequestContext) => updateHighlight(ctx, HIGHLIGHT_ID, { title: 'Novo nome' }),
      (ctx: RequestContext) => deleteHighlight(ctx, HIGHLIGHT_ID),
      (ctx: RequestContext) => removeStoryFromHighlight(ctx, HIGHLIGHT_ID, STORY_ID),
    ]) {
      seen = [];
      const ctx = context();
      const thrown = await call(ctx).catch((error: unknown) => error);
      expect(thrown).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect((thrown as { details?: unknown }).details).toBeUndefined();
      expect(seen).toEqual(['highlight']);
      expect(ctx.events).toHaveLength(0);
    }
  });

  it('8. with the communities module OFF a community highlight is the bare 404, before any lookup of its place', async () => {
    if (highlight) highlight.community_id = COMMUNITY_ID;
    communitiesOn = false;
    const ctx = context();

    const thrown = await deleteHighlight(ctx, HIGHLIGHT_ID).catch((error: unknown) => error);
    expect(thrown).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(seen).toEqual(['highlight']);
    expect(ctx.events).toHaveLength(0);
  });

  it("9. a reorder whose set is NOT the place's current set is `order_stale` after the lock, and writes nothing", async () => {
    for (const highlightIds of [
      [C, A], // missing B
      [C, A, B, B], // a duplicate
      [C, A, HIGHLIGHT_ID], // a foreign id in place of B
      [C, A, B, HIGHLIGHT_ID], // an extra id
    ]) {
      seen = [];
      const ctx = context();
      await expect(
        reorderHighlights(ctx, { highlightIds }),
        JSON.stringify(highlightIds),
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        details: { highlight: 'order_stale' },
      });
      // Início has no community to resolve: the lock ran, then the transaction stopped.
      expect(seen).toEqual(['lock']);
      expect(ctx.events).toHaveLength(0);
    }
  });

  it('10. a permutation EQUAL to the current order renumbers nothing and emits nothing', async () => {
    const ctx = context();
    moved = false;

    const result = await reorderHighlights(ctx, { highlightIds: [A, B, C] });

    expect(result.items).toHaveLength(1);
    expect(seen).toEqual(['lock', 'renumber', 'summary']);
    expect(ctx.events).toHaveLength(0);
    await flush(ctx);
    expect(reordered).toHaveLength(0);
  });

  it('11. a real reorder emits highlight.reordered once, ids only, and names the place', async () => {
    const ctx = context();

    await reorderHighlights(ctx, { communityId: COMMUNITY_ID, highlightIds: [C, A, B] });

    // The community place is resolved for `curate` BEFORE the place's rows are locked.
    expect(seen).toEqual(['place', 'lock', 'renumber', 'summary']);
    // ONE renumber statement for the whole permutation (R-D-C).
    expect(texts.filter((text) => /with ordinality/.test(text))).toHaveLength(1);
    await flush(ctx);
    expect(reordered).toHaveLength(1);
    expect(Object.keys(reordered[0] ?? {}).sort()).toEqual([
      'actorUserId',
      'communityId',
      'tenantId',
    ]);
    expect(reordered[0]).toMatchObject({ communityId: COMMUNITY_ID, tenantId: TENANT_ID });
  });

  it('12. an ARCHIVED community refuses a reorder with `archived` before its rows are locked', async () => {
    communityStatus = 'archived';
    const ctx = context();

    await expect(
      reorderHighlights(ctx, { communityId: COMMUNITY_ID, highlightIds: [A, B, C] }),
    ).rejects.toMatchObject({ status: 400, details: { highlight: 'archived' } });
    expect(seen).toEqual(['place']);
    expect(ctx.events).toHaveLength(0);
  });
});
