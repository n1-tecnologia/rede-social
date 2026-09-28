import { FEED_MAX_PAGE_SIZE, type FeedPost } from '@rede-social/module-feed/contracts';
import { REELS_PAGE_SIZE } from '@rede-social/module-reels/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { apiFetch } from '@/lib/api';
import { getFeed } from '@/lib/feed';
import {
  announcedCount,
  loadReelsPage,
  loadVideoCommunities,
  type ReelView,
  reelView,
} from '@/lib/reels';

/**
 * 05.3-07 — the web data path of Reels (REELS-03 web half, REELS-05, FEED-07).
 *
 * The claims worth a test:
 *
 *  1. **One fetch implementation.** `getFeed` forwards `media=video`, and `loadReelsPage` reaches
 *     the API through it with `REELS_PAGE_SIZE`, the lane and the opaque cursor. A page size above
 *     the feed's own maximum would be refused by the `.strict()` feed query, so it is pinned here.
 *  2. **One mapping.** `reelView` is built on the feed card's `postCardBase` for the author link,
 *     the counts, the liked state and the FEED-07 share link, and drops a post with no ready video.
 *  3. **Graceful lanes.** A failed lanes read is an empty list (the D-120 "Todos only" view), except
 *     a refusal the bootstrap knows, which is a navigation.
 *  4. **The announced count** is the full-number template, the plural chosen from the count.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env`, `lib/tenant-host`'s
 * `primaryHostOrigin` and `next/navigation`. What is real: `getFeed`, the feed schema parse, the
 * lanes schema parse, `postCardBase`, and the pt-BR catalog through next-intl's own translator.
 */

// The module graph reaches `lib/env`, which validates the process environment at import time.
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/tenant-host', () => ({ primaryHostOrigin: vi.fn(async () => ORIGIN) }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages: load } = await import('@/i18n/messages');
  const messages = load();
  return {
    // The REAL pt-BR catalog: a wrong key or a reworded string turns the view assertions red.
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const ORIGIN = 'https://comunidade.example';
const POST = '0e000000-0000-4000-8000-0000000000a1';
const OTHER_POST = '0e000000-0000-4000-8000-0000000000a2';
const MEMBERSHIP = '0e000000-0000-4000-8000-0000000000b1';
const COMMUNITY = '0e000000-0000-4000-8000-0000000000c1';
const ASSET = '0e000000-0000-4000-8000-0000000000d1';
const CAPTION_SECRET = 'legenda-que-nunca-vai-para-o-log';

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function post(overrides: Partial<FeedPost> = {}, videoStatus: 'ready' | 'processing' = 'ready') {
  return {
    id: POST,
    createdAt: '2026-09-26T12:00:00.000Z',
    editedAt: null,
    caption: CAPTION_SECRET,
    author: { membershipId: MEMBERSHIP, displayName: 'Ana Souza', avatarAssetId: null },
    likeCount: 8000,
    commentCount: 2,
    viewerLiked: true,
    communityId: COMMUNITY,
    community: { id: COMMUNITY, name: 'Corrida', slug: 'corrida' },
    canManage: false,
    mediaKind: 'video',
    media: [
      {
        assetId: ASSET,
        kind: 'video',
        position: 0,
        status: videoStatus,
        width: 1080,
        height: 1920,
        mime: 'video/mp4',
        bytes: 1000,
        filename: null,
        variantWidths: [],
      },
    ],
    linkPreview: null,
    ...overrides,
  } satisfies FeedPost;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function feedTranslator(): Promise<Translator> {
  return getTranslations('feed');
}

function likesTemplates() {
  const messages = loadMessages() as { feed: { meta: { likes: { one: string; other: string } } } };
  return messages.feed.meta.likes;
}

function commentsTemplates() {
  const messages = loadMessages() as {
    feed: { meta: { comments: { one: string; other: string } } };
  };
  return messages.feed.meta.comments;
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(redirect).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('reelView — the feed card mapping, reused (REELS-05, FEED-07)', () => {
  it('a ready-video post with a community maps to the full ReelView', async () => {
    const view = reelView(post(), await feedTranslator(), ORIGIN);

    expect(view).toEqual({
      id: POST,
      caption: CAPTION_SECRET,
      shareUrl: `${ORIGIN}/post/${POST}`,
      author: {
        displayName: 'Ana Souza',
        profileHref: `/membros/${MEMBERSHIP}`,
        avatarUrl: null,
      },
      community: {
        name: 'Corrida',
        href: `/comunidades/${COMMUNITY}`,
        ariaLabel: 'Ver a comunidade Corrida',
      },
      likeCount: 8000,
      commentCount: 2,
      viewerLiked: true,
      video: { assetId: ASSET, width: 1080, height: 1920 },
    } satisfies ReelView);
  });

  it('with no verified primary host (shareOrigin null) the shareUrl is null', async () => {
    const view = reelView(post(), await feedTranslator(), null);
    expect(view?.shareUrl).toBeNull();
  });

  it('a tenant-wide post has community null', async () => {
    const view = reelView(
      post({ communityId: null, community: null }),
      await feedTranslator(),
      ORIGIN,
    );
    expect(view?.community).toBeNull();
  });

  it('a post whose video is still processing maps to null', async () => {
    expect(reelView(post({}, 'processing'), await feedTranslator(), ORIGIN)).toBeNull();
  });

  it('a post with no video at all maps to null', async () => {
    expect(
      reelView(post({ mediaKind: 'none', media: [] }), await feedTranslator(), ORIGIN),
    ).toBeNull();
  });
});

describe('announcedCount — the accessible full-number count (UI-D-87, E05)', () => {
  it('announcedCount(8000, likes) is "8.000 curtidas"', () => {
    expect(announcedCount(8000, likesTemplates(), 'pt-BR')).toBe('8.000 curtidas');
  });

  it('announcedCount(1, likes) is "1 curtida"', () => {
    expect(announcedCount(1, likesTemplates(), 'pt-BR')).toBe('1 curtida');
  });

  it('announcedCount(0, likes) is null', () => {
    expect(announcedCount(0, likesTemplates(), 'pt-BR')).toBeNull();
  });

  it('announcedCount(2, comments) is "2 comentários"', () => {
    expect(announcedCount(2, commentsTemplates(), 'pt-BR')).toBe('2 comentários');
  });
});

describe('the page size and the one fetch implementation (REELS-03)', () => {
  it('REELS_PAGE_SIZE is at most FEED_MAX_PAGE_SIZE', () => {
    expect(REELS_PAGE_SIZE).toBeLessThanOrEqual(FEED_MAX_PAGE_SIZE);
  });

  it('getFeed forwards media=video', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await getFeed({ media: 'video', limit: REELS_PAGE_SIZE });

    const path = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    const search = new URL(path, 'http://api.test').searchParams;
    expect(search.get('media')).toBe('video');
    expect(search.get('limit')).toBe(String(REELS_PAGE_SIZE));
  });

  it('getFeed without media sends no media parameter (Início is unchanged)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await getFeed({});

    const path = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    expect(new URL(path, 'http://api.test').searchParams.has('media')).toBe(false);
  });

  it('loadReelsPage asks the lane with media=video, the page size and the cursor, and maps the items', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, {
        items: [post(), post({ id: OTHER_POST }, 'processing')],
        nextCursor: 'opaque-cursor-2',
      }),
    );

    const page = await loadReelsPage({ communityId: COMMUNITY, cursor: 'opaque-cursor-1' });

    const path = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    const url = new URL(path, 'http://api.test');
    expect(url.pathname).toBe('/v1/feed');
    expect(url.searchParams.get('media')).toBe('video');
    expect(url.searchParams.get('limit')).toBe(String(REELS_PAGE_SIZE));
    expect(url.searchParams.get('communityId')).toBe(COMMUNITY);
    expect(url.searchParams.get('cursor')).toBe('opaque-cursor-1');

    // The processing post is dropped defensively; the API already filters it.
    expect(page?.items.map((item) => item.id)).toEqual([POST]);
    expect(page?.items[0]?.shareUrl).toBe(`${ORIGIN}/post/${POST}`);
    expect(page?.nextCursor).toBe('opaque-cursor-2');
  });

  it('loadReelsPage for Todos sends no communityId and no cursor', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await loadReelsPage({});

    const path = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    const search = new URL(path, 'http://api.test').searchParams;
    expect(search.has('communityId')).toBe(false);
    expect(search.has('cursor')).toBe(false);
  });

  it('loadReelsPage turns a 401 into ONE navigation, outside the catch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHORIZED' } }));

    await expect(loadReelsPage({})).rejects.toThrow('redirect:/entrar');
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it('loadReelsPage answers null on a 500 and logs no content', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));

    await expect(loadReelsPage({})).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(CAPTION_SECRET);
  });
});

describe('loadVideoCommunities — the lanes, degrading to Todos only (D-120)', () => {
  it('returns the lanes read items', async () => {
    const lane = { id: COMMUNITY, name: 'Corrida', slug: 'corrida' };
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [lane] }));

    await expect(loadVideoCommunities()).resolves.toEqual([lane]);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/feed/video-communities');
  });

  it('a failed read is an empty list, not an error screen', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    await expect(loadVideoCommunities()).resolves.toEqual([]);
  });

  it('a body that does not parse is an empty list', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [{ id: 'not-a-uuid' }] }));
    await expect(loadVideoCommunities()).resolves.toEqual([]);
  });

  it('a 401 is a navigation, not an empty list', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHORIZED' } }));
    await expect(loadVideoCommunities()).rejects.toThrow('redirect:/entrar');
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});
