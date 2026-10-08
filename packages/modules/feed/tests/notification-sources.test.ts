import type { Tx } from '@rede-social/core/db/tenant-tx';
import { describe, expect, it } from 'vitest';
import { FEED_NOTIFICATION_KINDS } from '../contracts/index';
import { feedPushCopy, feedReplyPushCopy } from '../server/notification-copy';
import {
  FEED_EXCERPT_MAX,
  feedNotificationRetractions,
  feedNotificationSources,
} from '../server/notifications';

/**
 * The feed's `post.published` source (07-01, D-226/D-227/D-229), pinned with a fake `tx` returning a
 * fixed row: the one-kind rule, the shared dedupe key, the author exclusion, the 80-grapheme
 * excerpt and the push body. The SQL itself is proved end to end by the API integration tracer.
 */

const T = 'e05bbbdd-92d5-4d38-beab-69100a1a269b';
const P = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const IMG = '44444444-4444-4444-8444-444444444444';

type Row = {
  id: string;
  author_user_id: string;
  caption: string;
  community_id: string | null;
  community_name: string | null;
  media_kind: 'none' | 'gallery' | 'video';
  author_name: string | null;
  preview_asset_id: string | null;
};

const baseRow: Row = {
  id: P,
  author_user_id: A,
  caption: 'Olá, comunidade',
  community_id: null,
  community_name: null,
  media_kind: 'none',
  author_name: 'Ana Admin',
  preview_asset_id: null,
};

function fakeTx(rows: Row[]): Tx {
  return { execute: async () => rows } as unknown as Tx;
}

const source = feedNotificationSources[0];
if (!source) throw new Error('feed declares no post.published source');

const payload = {
  tenantId: T,
  postId: P,
  authorUserId: A,
  communityId: null,
  hasMedia: false,
  occurredAt: '2026-09-30T12:00:00.000000Z',
};

async function resolve(row: Partial<Row>) {
  return source?.resolve(fakeTx([{ ...baseRow, ...row }]), payload, {
    sinkAt: '2026-09-30T12:00:01.000Z',
  });
}

describe('feed post.published source', () => {
  it('declares exactly the post.published, comment.liked and comment.created sources (07-04)', () => {
    expect(feedNotificationSources.map((s) => s.event)).toEqual([
      'post.published',
      'comment.liked',
      'comment.created',
    ]);
  });

  it('a plain post yields ONE feed.post intent to members, excluding the author', async () => {
    const intents = await resolve({});
    expect(intents).toHaveLength(1);
    const [intent] = intents ?? [];
    expect(intent?.kind).toBe(FEED_NOTIFICATION_KINDS.post);
    expect(intent?.audience).toEqual({ type: 'members' });
    expect(intent?.excludeUserIds).toEqual([A]);
    expect(intent?.dedupeKey).toBe(`feed.post:${P}`);
    expect(intent?.subject).toEqual({ type: 'post', id: P });
    expect(intent?.actorUserId).toBe(A);
    expect(intent?.channels).toEqual(['in_app', 'push']);
    expect(intent?.push?.url).toBe(`/post/${P}`);
    expect(intent?.push?.tag).toBe('feed-post');
    expect(intent?.facts).toEqual({
      postId: P,
      excerpt: 'Olá, comunidade',
      communityId: null,
      communityName: null,
      previewAssetId: null,
    });
  });

  it('a community post yields feed.community_post with the community name, same dedupe key', async () => {
    const [intent] =
      (await resolve({
        community_id: C,
        community_name: 'Corredores',
        media_kind: 'gallery',
        preview_asset_id: IMG,
      })) ?? [];
    expect(intent?.kind).toBe(FEED_NOTIFICATION_KINDS.communityPost);
    expect(intent?.dedupeKey).toBe(`feed.post:${P}`);
    expect(intent?.facts.communityName).toBe('Corredores');
    expect(intent?.facts.previewAssetId).toBe(IMG);
  });

  it('a video post yields feed.reel and NOT feed.post, even inside a community', async () => {
    const intents =
      (await resolve({ media_kind: 'video', community_id: C, community_name: 'X' })) ?? [];
    expect(intents.map((i) => i.kind)).toEqual([FEED_NOTIFICATION_KINDS.reel]);
    expect(intents[0]?.dedupeKey).toBe(`feed.post:${P}`);
    expect(intents[0]?.push?.tag).toBe('feed-reel');
    expect(intents[0]?.push?.body).toBe('Novo reel');
  });

  it('a soft-deleted (absent) post yields no intent', async () => {
    const intents = await source.resolve(fakeTx([]), payload, { sinkAt: 'x' });
    expect(intents).toEqual([]);
  });

  it('cuts the excerpt to 80 graphemes on a word, and a blank caption to null', async () => {
    const long = `${'palavra '.repeat(20)}fim`;
    const [intent] = (await resolve({ caption: long })) ?? [];
    const excerpt = String(intent?.facts.excerpt);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(
      Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(excerpt)).length,
    ).toBeLessThanOrEqual(FEED_EXCERPT_MAX);
    const [blank] = (await resolve({ caption: '   ' })) ?? [];
    expect(blank?.facts.excerpt).toBeNull();
    expect(blank?.push?.body).toBe('Novo post de Ana Admin');
  });
});

describe('feedPushCopy (UI-SPEC §Push banner copy)', () => {
  it('renders the five verbatim bodies', () => {
    expect(
      feedPushCopy({ kind: 'feed.post', excerpt: 'oi', actorName: 'Ana', communityName: null }),
    ).toBe('Novo post: oi');
    expect(
      feedPushCopy({ kind: 'feed.post', excerpt: null, actorName: 'Ana', communityName: null }),
    ).toBe('Novo post de Ana');
    expect(
      feedPushCopy({
        kind: 'feed.community_post',
        excerpt: 'oi',
        actorName: 'Ana',
        communityName: 'Grupo',
      }),
    ).toBe('Novo post em Grupo: oi');
    expect(
      feedPushCopy({
        kind: 'feed.community_post',
        excerpt: null,
        actorName: 'Ana',
        communityName: 'Grupo',
      }),
    ).toBe('Novo post em Grupo');
    expect(
      feedPushCopy({ kind: 'feed.reel', excerpt: 'oi', actorName: 'Ana', communityName: null }),
    ).toBe('Novo reel');
  });
});

/* ── 07-04: the comment kinds and the retractions ──────────────────────────────────────────────── */

const CM = '55555555-5555-4555-8555-555555555555';
const ROOT = '66666666-6666-4666-8666-666666666666';
const LIKER = '77777777-7777-4777-8777-777777777777';
const COMMENT_AUTHOR = '88888888-8888-4888-8888-888888888888';

function sourceFor(event: string) {
  const found = feedNotificationSources.find((s) => s.event === event);
  if (!found) throw new Error(`no ${event} source`);
  return found;
}

/** A fake tx answering every statement with `rows`, and recording that it was asked. */
function recordingTx(rows: unknown[]): { tx: Tx; calls: () => number } {
  let n = 0;
  return {
    tx: {
      execute: async () => {
        n += 1;
        return rows;
      },
    } as unknown as Tx,
    calls: () => n,
  };
}

describe('feed comment.liked source (D-226, D-235)', () => {
  const liked = sourceFor('comment.liked');
  const payload = {
    tenantId: T,
    commentId: CM,
    commentAuthorUserId: COMMENT_AUTHOR,
    actorUserId: LIKER,
  };
  const row = {
    comment_id: CM,
    post_id: P,
    body: 'Meu comentário',
    author_user_id: COMMENT_AUTHOR,
  };

  it("yields ONE in-app-only intent to the comment's author, never pushed", async () => {
    const intents = await liked.resolve(fakeTx([row] as never), payload, { sinkAt: 'x' });
    expect(intents).toHaveLength(1);
    const [intent] = intents;
    expect(intent?.kind).toBe(FEED_NOTIFICATION_KINDS.commentLiked);
    expect(intent?.audience).toEqual({ type: 'users', userIds: [COMMENT_AUTHOR] });
    expect(intent?.excludeUserIds).toEqual([LIKER]);
    expect(intent?.dedupeKey).toBe(`feed.comment_liked:${CM}:${LIKER}`);
    expect(intent?.subject).toEqual({ type: 'post', id: P });
    expect(intent?.object).toEqual({ type: 'comment', id: CM });
    expect(intent?.actorUserId).toBe(LIKER);
    expect(intent?.facts).toEqual({ postId: P, commentId: CM, excerpt: 'Meu comentário' });
    expect(intent?.channels).toEqual(['in_app']);
    expect(intent?.push).toBeNull();
  });

  it('a self-like yields nothing', async () => {
    const self = { ...payload, actorUserId: COMMENT_AUTHOR };
    expect(await liked.resolve(fakeTx([row] as never), self, { sinkAt: 'x' })).toEqual([]);
  });

  it('a missing or deleted comment (no row) yields nothing', async () => {
    expect(await liked.resolve(fakeTx([]), payload, { sinkAt: 'x' })).toEqual([]);
  });
});

describe('feed comment.created source: replies only (D-226)', () => {
  const created = sourceFor('comment.created');
  const payload = {
    tenantId: T,
    postId: P,
    commentId: CM,
    parentCommentId: ROOT,
    postAuthorUserId: A,
    parentAuthorUserId: COMMENT_AUTHOR,
    actorUserId: LIKER,
  };
  const row = {
    comment_id: CM,
    post_id: P,
    body: 'Concordo com você',
    root_comment_id: ROOT,
    root_author_user_id: COMMENT_AUTHOR,
    actor_name: 'Bia',
  };

  it("a reply yields ONE pushed intent to the ROOT's author", async () => {
    const [intent, ...rest] = await created.resolve(fakeTx([row] as never), payload, {
      sinkAt: 'x',
    });
    expect(rest).toEqual([]);
    expect(intent?.kind).toBe(FEED_NOTIFICATION_KINDS.commentReplied);
    expect(intent?.audience).toEqual({ type: 'users', userIds: [COMMENT_AUTHOR] });
    expect(intent?.excludeUserIds).toEqual([LIKER]);
    expect(intent?.dedupeKey).toBe(`feed.comment_replied:${CM}`);
    expect(intent?.subject).toEqual({ type: 'post', id: P });
    expect(intent?.object).toEqual({ type: 'comment', id: CM });
    expect(intent?.facts).toEqual({
      postId: P,
      commentId: CM,
      rootCommentId: ROOT,
      excerpt: 'Concordo com você',
    });
    expect(intent?.channels).toEqual(['in_app', 'push']);
    expect(intent?.push).toEqual({
      title: 'tenant',
      body: 'Bia respondeu ao seu comentário: Concordo com você',
      url: `/post/${P}?comentario=${CM}`,
      tag: 'feed-comment-replied',
      topic: 'feed-comment-replied',
      ttlSeconds: 86_400,
      urgency: 'normal',
      renotify: true,
    });
  });

  it('a ROOT comment yields nothing, without even reading', async () => {
    const { tx, calls } = recordingTx([row]);
    const root = { ...payload, parentCommentId: null, parentAuthorUserId: null };
    expect(await created.resolve(tx, root, { sinkAt: 'x' })).toEqual([]);
    expect(calls()).toBe(0);
  });

  it("a self-reply (the root's author answering themselves) yields nothing", async () => {
    const self = { ...payload, actorUserId: COMMENT_AUTHOR };
    expect(await created.resolve(fakeTx([row] as never), self, { sinkAt: 'x' })).toEqual([]);
  });

  it('a reply removed before the job ran (no row) yields nothing', async () => {
    expect(await created.resolve(fakeTx([]), payload, { sinkAt: 'x' })).toEqual([]);
  });
});

/* ── 08.2-04: the community gate in the worker (STORE-19, Pitfall 6) ────────────────────────────── */

/** A fake tx answering the statements IN ORDER, one `rows` list per statement, and recording each. */
function queuedTx(answers: unknown[][]): { tx: Tx; statements: () => number } {
  let n = 0;
  return {
    tx: {
      execute: async () => {
        const rows = answers[n] ?? [];
        n += 1;
        return rows;
      },
    } as unknown as Tx,
    statements: () => n,
  };
}

describe('08.2-04 the gated audience and the per-recipient filters', () => {
  const H1 = '99999999-9999-4999-8999-999999999999';
  const communityRow = { ...baseRow, community_id: C, community_name: 'Exclusiva' };

  it('a post with no community keeps the members broadcast and asks the gate nothing', async () => {
    const { tx, statements } = queuedTx([[baseRow]]);
    const [intent] = await source.resolve(tx, payload, { sinkAt: 'x' });
    expect(intent?.audience).toEqual({ type: 'members' });
    expect(statements()).toBe(1);
  });

  it('a post of a community that is not gated (viewers null) keeps the members broadcast', async () => {
    const { tx, statements } = queuedTx([[communityRow], [{ viewers: null }]]);
    const [intent] = await source.resolve(tx, payload, { sinkAt: 'x' });
    expect(intent?.audience).toEqual({ type: 'members' });
    expect(statements()).toBe(2);
  });

  it('a post of a gated community targets exactly the holders, dedupe key and exclusions unchanged', async () => {
    const { tx } = queuedTx([[communityRow], [{ viewers: [H1] }]]);
    const [intent] = await source.resolve(tx, payload, { sinkAt: 'x' });
    expect(intent?.audience).toEqual({ type: 'users', userIds: [H1] });
    expect(intent?.excludeUserIds).toEqual([A]);
    expect(intent?.dedupeKey).toBe(`feed.post:${P}`);
  });

  it('a gated community nobody holds targets nobody; a reel in one is gated too; a missing probe fails closed', async () => {
    const nobody = queuedTx([[communityRow], [{ viewers: [] }]]);
    expect((await source.resolve(nobody.tx, payload, { sinkAt: 'x' }))[0]?.audience).toEqual({
      type: 'users',
      userIds: [],
    });
    const reel = queuedTx([[{ ...communityRow, media_kind: 'video' }], [{ viewers: [H1] }]]);
    const [reelIntent] = await source.resolve(reel.tx, payload, { sinkAt: 'x' });
    expect(reelIntent?.kind).toBe(FEED_NOTIFICATION_KINDS.reel);
    expect(reelIntent?.audience).toEqual({ type: 'users', userIds: [H1] });
    const missing = queuedTx([[communityRow], []]);
    expect((await source.resolve(missing.tx, payload, { sinkAt: 'x' }))[0]?.audience).toEqual({
      type: 'users',
      userIds: [],
    });
  });

  it('comment.liked: dropped when the community is locked for the author, kept when it is not', async () => {
    const liked = sourceFor('comment.liked');
    const likedPayload = {
      tenantId: T,
      commentId: CM,
      commentAuthorUserId: COMMENT_AUTHOR,
      actorUserId: LIKER,
    };
    const row = {
      comment_id: CM,
      post_id: P,
      community_id: C,
      body: 'Meu comentário',
      author_user_id: COMMENT_AUTHOR,
    };
    const locked = queuedTx([[row], [{ locked: true }]]);
    expect(await liked.resolve(locked.tx, likedPayload, { sinkAt: 'x' })).toEqual([]);
    const open = queuedTx([[row], [{ locked: false }]]);
    expect(await liked.resolve(open.tx, likedPayload, { sinkAt: 'x' })).toHaveLength(1);
    const general = queuedTx([[{ ...row, community_id: null }]]);
    expect(await liked.resolve(general.tx, likedPayload, { sinkAt: 'x' })).toHaveLength(1);
    expect(general.statements()).toBe(1);
  });

  it('comment.created: a reply is dropped when the community is locked for the root author', async () => {
    const created = sourceFor('comment.created');
    const replyPayload = {
      tenantId: T,
      postId: P,
      commentId: CM,
      parentCommentId: ROOT,
      postAuthorUserId: A,
      parentAuthorUserId: COMMENT_AUTHOR,
      actorUserId: LIKER,
    };
    const row = {
      comment_id: CM,
      post_id: P,
      community_id: C,
      body: 'Resposta',
      root_comment_id: ROOT,
      root_author_user_id: COMMENT_AUTHOR,
      actor_name: 'Bia',
    };
    const locked = queuedTx([[row], [{ locked: true }]]);
    expect(await created.resolve(locked.tx, replyPayload, { sinkAt: 'x' })).toEqual([]);
    const open = queuedTx([[row], [{ locked: false }]]);
    expect(await created.resolve(open.tx, replyPayload, { sinkAt: 'x' })).toHaveLength(1);
    const missing = queuedTx([[row], []]);
    expect(await created.resolve(missing.tx, replyPayload, { sinkAt: 'x' })).toEqual([]);
  });
});

describe('feed retractions (keep-and-mark)', () => {
  it('post.deleted retracts on the subject post; comment.deleted on the object comment', () => {
    expect(feedNotificationRetractions.map((r) => r.event)).toEqual([
      'post.deleted',
      'comment.deleted',
    ]);
    const [post, comment] = feedNotificationRetractions;
    expect(
      post?.match({ tenantId: T, postId: P, authorUserId: A, actorUserId: A, occurredAt: 'x' }),
    ).toEqual({ on: 'subject', type: 'post', id: P });
    expect(comment?.match({ tenantId: T, commentId: CM, actorUserId: A })).toEqual({
      on: 'object',
      type: 'comment',
      id: CM,
    });
  });
});

describe('feedReplyPushCopy (UI-SPEC §Push banner copy)', () => {
  it('renders the verbatim reply body, cut to 100 graphemes', () => {
    expect(feedReplyPushCopy('Ana', 'oi')).toBe('Ana respondeu ao seu comentário: oi');
    const long = feedReplyPushCopy('Ana', 'palavra '.repeat(30));
    expect(long.endsWith('…')).toBe(true);
    expect(
      Array.from(new Intl.Segmenter('pt-BR', { granularity: 'grapheme' }).segment(long)).length,
    ).toBeLessThanOrEqual(100);
  });
});
