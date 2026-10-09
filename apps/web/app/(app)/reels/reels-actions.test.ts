import type { MediaPlayback } from '@rede-social/contracts/media';
import { REELS_MINT_MAX_IDS } from '@rede-social/module-reels/contracts';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { getPlaybackTokens } from '@/lib/media';
import { loadReelStartAction, loadReelsPageAction, mintReelPlaybackAction } from './reels-actions';

/**
 * 05.3-07 — the two Reels server actions (REELS-05, REELS-08, MEDIA-03, D-43, D-44).
 *
 * A server action is a public endpoint and its argument is untrusted, so the claims worth a test are:
 *
 *  1. **The batched mint is bounded and uuid-only** (T-05.3-16). A non-uuid, an empty list and a
 *     list longer than `REELS_MINT_MAX_IDS` are refused before any credential is minted.
 *  2. **One action, per-item answers.** A 409 on one asset is `notReady` for that asset only; the
 *     others still get their playback. A refusal the bootstrap knows (401/403) is ONE navigation,
 *     performed after every mint settled, outside any catch.
 *  3. **Nothing sensitive is logged** (T-05.3-15). A failed mint logs the asset id, never a token.
 *  4. **The page action guards its lane and cursor** and maps the page through the one feed fetch.
 *  5. **The overlay's start** (2026-10-09) guards the post and the lane, puts the tapped video first
 *     and keeps the rest of its lane's page after it, without the video twice.
 *
 * What is stubbed: `lib/media`'s `getPlaybackTokens` (the credential call), `lib/api`'s `apiFetch`
 * (the transport), `lib/env`, `lib/tenant-host` and `next/navigation`. What is real: the Zod guards,
 * `lib/reels`, `getFeed`, the schema parse and the catalog.
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

vi.mock('@/lib/media', () => ({ getPlaybackTokens: vi.fn() }));

vi.mock('@/lib/tenant-host', () => ({
  primaryHostOrigin: vi.fn(async () => 'https://comunidade.example'),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
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

const A = '0e000000-0000-4000-8000-0000000000d1';
const B = '0e000000-0000-4000-8000-0000000000d2';
const C = '0e000000-0000-4000-8000-0000000000d3';
const D = '0e000000-0000-4000-8000-0000000000d4';
const POST = '0e000000-0000-4000-8000-0000000000a1';
const COMMUNITY = '0e000000-0000-4000-8000-0000000000c1';

function playbackFor(assetId: string): MediaPlayback {
  return {
    playbackId: `pb-${assetId}`,
    tokens: {
      playback: `tok-playback-${assetId}`,
      thumbnail: `tok-thumbnail-${assetId}`,
      storyboard: `tok-storyboard-${assetId}`,
    },
    expiresAt: '2026-09-26T22:00:00.000Z',
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function readyVideoPost() {
  return {
    id: POST,
    createdAt: '2026-09-26T12:00:00.000Z',
    editedAt: null,
    caption: 'Um reel',
    author: {
      membershipId: '0e000000-0000-4000-8000-0000000000b1',
      displayName: 'Ana Souza',
      avatarAssetId: null,
    },
    likeCount: 3,
    commentCount: 0,
    viewerLiked: false,
    communityId: null,
    community: null,
    canManage: false,
    mediaKind: 'video',
    media: [
      {
        assetId: A,
        kind: 'video',
        position: 0,
        status: 'ready',
        width: null,
        height: null,
        mime: 'video/mp4',
        bytes: 1000,
        filename: null,
        variantWidths: [],
      },
    ],
    linkPreview: null,
  };
}

beforeEach(() => {
  vi.mocked(getPlaybackTokens).mockReset();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(redirect).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('mintReelPlaybackAction — one batched, bounded mint (D-43, D-44)', () => {
  it('a non-uuid is refused before any mint', async () => {
    await expect(mintReelPlaybackAction(['not-a-uuid'])).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(getPlaybackTokens).not.toHaveBeenCalled();
  });

  it('more ids than REELS_MINT_MAX_IDS are refused before any mint', async () => {
    expect(REELS_MINT_MAX_IDS).toBe(3);
    await expect(mintReelPlaybackAction([A, B, C, D])).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(getPlaybackTokens).not.toHaveBeenCalled();
  });

  it('an empty list is refused', async () => {
    await expect(mintReelPlaybackAction([])).resolves.toEqual({ ok: false, code: 'generic' });
    expect(getPlaybackTokens).not.toHaveBeenCalled();
  });

  it('two uuids, the first minted and the second a 409, answer per item', async () => {
    vi.mocked(getPlaybackTokens).mockImplementation(async (assetId: string) => {
      if (assetId === A) return playbackFor(A);
      throw new ApiClientError(409, 'MEDIA_NOT_READY');
    });

    await expect(mintReelPlaybackAction([A, B])).resolves.toEqual({
      ok: true,
      results: [
        { assetId: A, ok: true, playback: playbackFor(A) },
        { assetId: B, ok: false, code: 'notReady' },
      ],
    });
    expect(getPlaybackTokens).toHaveBeenCalledTimes(2);
  });

  it('three ids are minted in parallel inside the one action', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getPlaybackTokens).mockImplementation(async (assetId: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return playbackFor(assetId);
    });

    const result = await mintReelPlaybackAction([A, B, C]);
    expect(result.ok).toBe(true);
    expect(peak).toBe(3);
  });

  it('a 401 on any id is ONE navigation', async () => {
    vi.mocked(getPlaybackTokens).mockRejectedValue(new ApiClientError(401, 'UNAUTHORIZED'));

    await expect(mintReelPlaybackAction([A, B])).rejects.toThrow('redirect:/entrar');
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it('a generic failure is generic for that item and logs the asset id, never a token', async () => {
    vi.mocked(getPlaybackTokens).mockImplementation(async (assetId: string) => {
      if (assetId === A) return playbackFor(A);
      throw new Error(`upstream exploded near tok-playback-${B}`);
    });

    await expect(mintReelPlaybackAction([A, B])).resolves.toEqual({
      ok: true,
      results: [
        { assetId: A, ok: true, playback: playbackFor(A) },
        { assetId: B, ok: false, code: 'generic' },
      ],
    });
    expect(console.error).toHaveBeenCalledWith('reels.playback_mint_failed', { assetId: B });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain('tok-');
  });
});

describe('loadReelsPageAction — a page of Reels through the one feed fetch (REELS-03)', () => {
  it('a non-uuid communityId is refused without a request', async () => {
    await expect(loadReelsPageAction('not-a-uuid', null)).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a cursor longer than 512 is refused without a request', async () => {
    await expect(loadReelsPageAction(null, 'x'.repeat(513))).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('a valid call answers the mapped items and the next cursor', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [readyVideoPost()], nextCursor: 'opaque-2' }),
    );

    const result = await loadReelsPageAction(COMMUNITY, 'opaque-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextCursor).toBe('opaque-2');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: POST,
      community: null,
      shareUrl: `https://comunidade.example/post/${POST}`,
      video: { assetId: A, width: null, height: null },
    });
    const path = String(vi.mocked(apiFetch).mock.calls[0]?.[0]);
    const search = new URL(path, 'http://api.test').searchParams;
    expect(search.get('media')).toBe('video');
    expect(search.get('communityId')).toBe(COMMUNITY);
    expect(search.get('cursor')).toBe('opaque-1');
  });

  it('an API failure answers { ok: false }', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(500, { error: { code: 'INTERNAL' } }));
    await expect(loadReelsPageAction(null, null)).resolves.toEqual({ ok: false });
  });
});

describe('loadReelStartAction — the overlay starts at the tapped video (2026-10-09)', () => {
  const NEWER = '0e000000-0000-4000-8000-0000000000a2';

  /**
   * The single-post read answers `post`, the lane read answers `page`, and an author's profile (the
   * Instagram lookup, 2026-10-09) is the API's bare 404: no handle, which these cases do not test.
   */
  function answer(post: Response, page: Response) {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      const at = String(path);
      if (at.startsWith('/v1/members/')) return json(404, { error: { code: 'NOT_FOUND' } });
      return at.startsWith('/v1/feed/posts/') ? post : page;
    });
  }

  it('a non-uuid post or lane is refused without a request', async () => {
    await expect(loadReelStartAction('not-a-uuid', null)).resolves.toEqual({ ok: false });
    await expect(loadReelStartAction(POST, 'not-a-uuid')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('the tapped video first, then its lane’s newest page without it', async () => {
    answer(
      json(200, readyVideoPost()),
      json(200, {
        items: [{ ...readyVideoPost(), id: NEWER }, readyVideoPost()],
        nextCursor: 'c2',
      }),
    );

    const result = await loadReelStartAction(POST, COMMUNITY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual([POST, NEWER]);
    expect(result.nextCursor).toBe('c2');
    const lane = vi
      .mocked(apiFetch)
      .mock.calls.map(([path]) => String(path))
      .find((path) => path.startsWith('/v1/feed?'));
    const search = new URL(lane ?? '', 'http://api.test').searchParams;
    expect(search.get('media')).toBe('video');
    expect(search.get('communityId')).toBe(COMMUNITY);
    expect(search.has('cursor')).toBe(false);
  });

  it('a post that is no Reel any more leaves the lane’s page as it is', async () => {
    answer(
      json(404, { error: { code: 'NOT_FOUND' } }),
      json(200, { items: [{ ...readyVideoPost(), id: NEWER }], nextCursor: null }),
    );
    const result = await loadReelStartAction(POST, null);
    expect(result.ok && result.items.map((item) => item.id)).toEqual([NEWER]);
  });

  it('a lane that cannot be read leaves the tapped video alone, with nothing after it', async () => {
    answer(json(200, readyVideoPost()), json(500, { error: { code: 'INTERNAL' } }));
    const result = await loadReelStartAction(POST, null);
    expect(result).toMatchObject({ ok: true, nextCursor: null });
    expect(result.ok && result.items.map((item) => item.id)).toEqual([POST]);
  });

  it('neither read: { ok: false }', async () => {
    answer(json(500, { error: { code: 'INTERNAL' } }), json(500, { error: { code: 'INTERNAL' } }));
    await expect(loadReelStartAction(POST, null)).resolves.toEqual({ ok: false });
  });
});
