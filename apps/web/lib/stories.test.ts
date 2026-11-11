import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { loadAuthorStories, loadStories, loadStoryAuthors, storyWriteIssue } from '@/lib/stories';

/**
 * `storyWriteIssue` is the ONE place the web reads a story-publish refusal out of the API envelope.
 * Since 05.2-08 a publish can name a highlight (`highlightId` or `newHighlight`), so the refusal is
 * no longer only the story module's own `details.story` vocabulary: a destination community archived
 * after the composer opened answers `400 { highlight: 'archived' }`, and a pending title the API
 * refuses answers `{ highlight: 'title_invalid' }` — the highlight writes' own closed vocabulary.
 * These cases pin that the web tells those refusals apart from a generic failure, reads nothing
 * else, and no longer reads the retired `details.pin`.
 *
 * What is stubbed: `lib/env` only. What is real: the error class and the mapping.
 */

// The module graph reaches `lib/api` -> `lib/env`, which validates the process environment at
// import time (fail fast, by design). Stubbed here exactly as `comunidades/actions.test.ts` does.
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

// The transport, for the strip read below; `storyWriteIssue` never calls it.
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

describe('storyWriteIssue — the publish refusal the composer can switch on', () => {
  it('1. a bare 404 is not_found', () => {
    expect(storyWriteIssue(new ApiClientError(404, 'NOT_FOUND'))).toBe('not_found');
  });

  it('2. a 400 carrying details.story media_invalid is media_invalid', () => {
    expect(
      storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { story: 'media_invalid' })),
    ).toBe('media_invalid');
  });

  it('3. a 400 carrying details.highlight archived / title_invalid / full is that code', () => {
    for (const code of ['archived', 'title_invalid', 'full'] as const) {
      expect(
        storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { highlight: code })),
      ).toBe(code);
    }
  });

  it('4. an unknown highlight code, the retired details.pin, a 400 with no details and a non-API error are all null', () => {
    expect(
      storyWriteIssue(
        new ApiClientError(400, 'VALIDATION_FAILED', { highlight: 'something-else' }),
      ),
    ).toBeNull();
    expect(
      storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED', { pin: 'archived' })),
    ).toBeNull();
    expect(storyWriteIssue(new ApiClientError(400, 'VALIDATION_FAILED'))).toBeNull();
    expect(storyWriteIssue(new Error('boom'))).toBeNull();
    expect(storyWriteIssue('archived')).toBeNull();
  });
});

/**
 * #2b (2026-10-03): the strip's page now carries each story's `authorAvatarUrl` — the face the
 * tenant circle wears — and the web reads it through the SAME strict contract the API answers with.
 * What the web side must guarantee: the stable `/v1/media/…` path arrives intact, an answer carrying
 * anything else is refused as a whole (a failed strip read is `null`, the row's own posture — never a
 * foreign URL inside an `<img>`), and a page from an API that predates the field still renders.
 */
describe('loadStories — the author photo crosses the strict contract (#2b)', () => {
  const PHOTO = '/v1/media/0b000000-0000-4000-8000-0000000000a1/w128';

  function story(extra: Record<string, unknown> = {}) {
    return {
      id: '0d000000-0000-4000-8000-0000000000d1',
      authorUserId: '0a000000-0000-4000-8000-000000000001',
      mediaAssetId: '0b000000-0000-4000-8000-000000000001',
      mediaKind: 'image',
      mediaVariantWidths: [640, 1080],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: '',
      publishedAt: '2026-10-03T12:00:00.000000Z',
      expiresAt: '2026-10-04T12:00:00.000000Z',
      isActive: true,
      durationSeconds: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 0,
      viewerSeen: false,
      ...extra,
    };
  }

  function answer(items: unknown[]) {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ items, nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('5. the stable photo path and a null photo both arrive intact', async () => {
    answer([story({ authorAvatarUrl: PHOTO }), story({ authorAvatarUrl: null })]);
    const page = await loadStories();
    expect(page?.items.map((item) => item.authorAvatarUrl)).toEqual([PHOTO, null]);
  });

  it('6. an answer carrying a foreign photo URL is refused WHOLE — the strip read is null, nothing reaches an <img>', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    answer([story({ authorAvatarUrl: 'https://cdn.example/face.jpg' })]);
    await expect(loadStories()).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith('stories.list_failed', expect.anything());
    log.mockRestore();
  });

  it('7. a page from an API that predates the field renders, every story photo-less', async () => {
    answer([story()]);
    const page = await loadStories();
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.authorAvatarUrl).toBeNull();
  });
});

/**
 * 10-12 (D-714, D-717, MSTORY-03): the Explorar row's two reads. They go through the strict
 * contracts of plan 10-08, never throw and never navigate (the row is never the reason Explorar
 * errors, UI-D-700): a 404 is the empty answer, any other failure is `null` and is logged by SHAPE
 * (never a name, a caption or a membership id).
 */
describe('loadStoryAuthors / loadAuthorStories — the row reads (10-12, UI-D-700)', () => {
  const AUTHOR = '0e000000-0000-4000-8000-0000000000e1';
  const PHOTO = '/v1/media/0b000000-0000-4000-8000-0000000000a1/w128';

  function circle(extra: Record<string, unknown> = {}) {
    return {
      membershipId: AUTHOR,
      displayName: 'Helena',
      avatarUrl: PHOTO,
      storyCount: 2,
      latestPublishedAt: '2026-11-11T12:00:00.000000Z',
      hasUnseen: true,
      isSelf: false,
      ...extra,
    };
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('A1. the authors page crosses the strict contract and asks for the cursor and limit it was given', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { items: [circle({ isSelf: true }), circle()], nextCursor: 'c2' }),
    );
    const page = await loadStoryAuthors({ cursor: 'c1', limit: 20 });
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]).toBe('/v1/stories/authors?cursor=c1&limit=20');
    expect(page?.items.map((item) => item.isSelf)).toEqual([true, false]);
    expect(page?.nextCursor).toBe('c2');
  });

  it('A2. with no query the request carries no cursor and no limit (the API defaults)', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, { items: [], nextCursor: null }));
    await loadStoryAuthors();
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]).toBe('/v1/stories/authors');
  });

  it('A3. a 404 is the EMPTY page, not an error', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(404, { error: { code: 'MODULE_DISABLED' } }));
    await expect(loadStoryAuthors()).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('A4. a 500, a transport failure and a page outside the contract are null, logged by shape only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));
    await expect(loadStoryAuthors()).resolves.toBeNull();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('offline'));
    await expect(loadStoryAuthors()).resolves.toBeNull();
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { items: [circle({ userId: 'x' })], nextCursor: null }),
    );
    await expect(loadStoryAuthors()).resolves.toBeNull();
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Helena');
      expect(JSON.stringify(call)).not.toContain(AUTHOR);
    }
    log.mockRestore();
  });

  it('A5. one author\'s group: the stories arrive in the API order, through the strict story contract', async () => {
    const story = (n: number) => ({
      id: `0d000000-0000-4000-8000-00000000000${n}`,
      authorUserId: null,
      author: { membershipId: AUTHOR, displayName: 'Helena', avatarUrl: PHOTO },
      mediaAssetId: '0b000000-0000-4000-8000-000000000001',
      mediaKind: 'image',
      mediaVariantWidths: [640],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: 'oi',
      publishedAt: '2026-11-11T12:00:00.000000Z',
      expiresAt: '2026-11-12T12:00:00.000000Z',
      isActive: true,
      durationSeconds: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 0,
      viewerSeen: false,
    });
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, { items: [story(1), story(2)] }));
    const stories = await loadAuthorStories(AUTHOR);
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]).toBe(`/v1/stories/authors/${AUTHOR}`);
    expect(stories?.map((item) => item.id.at(-1))).toEqual(['1', '2']);
  });

  it('A6. a group that is a 404 is the empty result; any other failure is null', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValueOnce(json(404, { error: { code: 'NOT_FOUND' } }));
    await expect(loadAuthorStories(AUTHOR)).resolves.toEqual([]);
    vi.mocked(apiFetch).mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));
    await expect(loadAuthorStories(AUTHOR)).resolves.toBeNull();
    log.mockRestore();
  });
});
