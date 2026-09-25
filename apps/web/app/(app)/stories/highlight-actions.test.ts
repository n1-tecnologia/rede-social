import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { loadHighlightItemsAction } from './highlight-actions';

/**
 * 05.2-05 — the lazy group read behind every Início highlight circle (HIGHLIGHT-02, T-05.2-23).
 *
 * `/inicio`'s SSR never carries a highlight's items (N×M): the viewer asks for ONE highlight's
 * stories when the member enters its group, through this server action. A server action is a public
 * endpoint and its argument is untrusted, so the three claims worth a test are:
 *
 *  1. **An id that is not a uuid never reaches the API** — refused here, before any request.
 *  2. **Every API miss is ONE answer.** The API's bare 404 (another tenant's highlight, an empty one
 *     a member may not open, a deleted one) becomes `{ ok: false }` with no detail to tell them apart.
 *  3. **A hit is mapped with the SAME view builder the strip uses** (`storyViewerItem`), so a story
 *     looks identical whichever circle opened it — relative time already formatted on the server.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env` and `next/navigation`. What is
 * real: the uuid guard, `getHighlight`'s schema parse and the item mapping.
 */

// The module graph reaches `lib/env`, which validates the process environment at import time.
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'tria.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const HIGHLIGHT = '0000000a-1111-4111-8111-111111111111';
const STORY = '0d000000-0000-4000-8000-0000000000d4';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A `GET /v1/stories/highlights/{id}` body: the highlight and ONE expired story, oldest first. */
function detail() {
  const published = new Date(Date.now() - 30 * 3_600_000).toISOString();
  return {
    highlight: {
      id: HIGHLIGHT,
      communityId: null,
      title: 'Bastidores',
      position: 0,
      coverAssetId: null,
      coverVariantWidths: [],
      coverStoryId: null,
      coverChosen: false,
      itemCount: 1,
    },
    items: [
      {
        id: STORY,
        authorUserId: '0a000000-0000-4000-8000-000000000001',
        mediaAssetId: '0b000000-0000-4000-8000-000000000001',
        mediaKind: 'image',
        mediaVariantWidths: [640, 1080],
        mediaStatus: 'ready',
        mediaFailureReason: null,
        caption: 'Publicado ontem, ja fora da regua.',
        publishedAt: published,
        expiresAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
        isActive: false,
        durationSeconds: null,
        likeCount: 2,
        commentCount: 1,
        viewerLiked: true,
        pinnedCommunityCount: 0,
        highlightCount: 1,
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadHighlightItemsAction — the lazy highlight group read (T-05.2-23)', () => {
  it('1. an id that is not a uuid is refused WITHOUT a request', async () => {
    await expect(loadHighlightItemsAction('not-a-uuid')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('2. the API’s bare 404 is { ok: false } — no detail, no navigation', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(loadHighlightItemsAction(HIGHLIGHT)).resolves.toEqual({ ok: false });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/highlights/${HIGHLIGHT}`);
  });

  it('3. a 200 maps every story with the strip’s own view builder — expired ones included', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, detail()));
    const result = await loadHighlightItemsAction(HIGHLIGHT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: STORY,
      mediaKind: 'image',
      mediaAssetId: '0b000000-0000-4000-8000-000000000001',
      mediaVariantWidths: [640, 1080],
      caption: 'Publicado ontem, ja fora da regua.',
      likeCount: 2,
      commentCount: 1,
      viewerLiked: true,
    });
    // The relative time is formatted HERE, on the server (UI-D-14) — a string, never a date.
    expect(typeof result.items[0]?.timeLabel).toBe('string');
    expect(result.items[0]?.timeLabel).not.toBe('');
  });

  it('4. a 401 is a NAVIGATION to /entrar, taken outside the try/catch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(loadHighlightItemsAction(HIGHLIGHT)).rejects.toThrow('redirect:/entrar');
  });
});
