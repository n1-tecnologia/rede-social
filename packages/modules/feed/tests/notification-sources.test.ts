import type { Tx } from '@rede-social/core/db/tenant-tx';
import { describe, expect, it } from 'vitest';
import { FEED_NOTIFICATION_KINDS } from '../contracts/index';
import { feedPushCopy } from '../server/notification-copy';
import { FEED_EXCERPT_MAX, feedNotificationSources } from '../server/notifications';

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
  it('listens to post.published only', () => {
    expect(feedNotificationSources.map((s) => s.event)).toEqual(['post.published']);
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
