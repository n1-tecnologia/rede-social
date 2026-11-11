import { STORY_SEEN_BATCH_MAX } from '@rede-social/module-stories/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import {
  deleteStoryAction,
  loadAuthorStoriesAction,
  loadStoryAuthorsPageAction,
  markStoriesSeenAction,
} from './story-actions';

/**
 * 05.2-10 — the seen-state write behind the tenant circle's ring (HIGHLIGHT-06, D-105, R-P5).
 *
 * `StoriesSurface` flushes its buffer of shown story ids through this server action. A server action
 * is a public endpoint and its argument is untrusted, and this one runs in the BACKGROUND of a
 * viewing session, so the claims worth a test are:
 *
 *  1. **Nothing malformed reaches the API** — an empty list or a non-uuid is refused here, with no
 *     request (the contract's own `markStoriesSeenSchema`).
 *  2. **A valid list is ONE `POST /v1/stories/views`** — the list is deduplicated first, and a list
 *     of more than the contract's cap of UNIQUE ids is refused with no request at all (review WR-04,
 *     T-05.2-48): the surface never sends more than 10, so a bigger list is not a real client and
 *     must not amplify into many API calls.
 *  3. **It is SILENT** (planning decision 4): a refusal, a 401 or a transport failure answers `false`
 *     — it never navigates (`redirect`), never revalidates a page, and never throws.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env`, `next/cache` and
 * `next/navigation`. What is real: the schema guard, `parseSeenBatch` (dedupe, then the cap) and the fetcher.
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));

const A = '0d000000-0000-4000-8000-0000000000d1';
const B = '0d000000-0000-4000-8000-0000000000d2';

function uuid(n: number): string {
  return `0d000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function status(code: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: code,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(redirect).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('markStoriesSeenAction — the silent, batched seen write (05.2-10)', () => {
  it('A1. an empty list and a list with a non-uuid send NO request', async () => {
    await expect(markStoriesSeenAction([])).resolves.toBe(false);
    await expect(markStoriesSeenAction([A, 'nao-e-um-uuid'])).resolves.toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('A2. a valid list is ONE POST /v1/stories/views with exactly those ids — and answers true on 204', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(204));
    await expect(markStoriesSeenAction([A, B])).resolves.toBe(true);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/stories/views');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ storyIds: [A, B] });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('A3. a list of more than the contract cap of UNIQUE ids is refused with NO request (WR-04)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(204));
    const ids = Array.from({ length: STORY_SEEN_BATCH_MAX + 1 }, (_, n) => uuid(n + 1));
    await expect(markStoriesSeenAction(ids)).resolves.toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('A5. duplicates collapse BEFORE the cap: 60 entries with 50 unique ids are ONE request, first-seen order', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(204));
    const unique = Array.from({ length: STORY_SEEN_BATCH_MAX }, (_, n) => uuid(n + 1));
    const ids = [...unique.slice(0, 5), ...unique, ...unique.slice(20, 25)];
    expect(ids).toHaveLength(STORY_SEEN_BATCH_MAX + 10);
    await expect(markStoriesSeenAction(ids)).resolves.toBe(true);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/stories/views');
    expect(JSON.parse(String(init?.body))).toEqual({ storyIds: unique });
  });

  it('A4. a 401, a 400 and a transport failure all answer false — no navigation, no revalidation, no throw', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(status(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(markStoriesSeenAction([A])).resolves.toBe(false);

    vi.mocked(apiFetch).mockResolvedValueOnce(
      status(400, { error: { code: 'VALIDATION_FAILED' } }),
    );
    await expect(markStoriesSeenAction([A])).resolves.toBe(false);

    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('fetch failed'));
    await expect(markStoriesSeenAction([A])).resolves.toBe(false);

    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-20 (the client's FRONT.pdf): a story is deleted from the VIEWER too, which passes
 * `{ revalidate: false }`: while it is open the URL is the deleted story's own `/stories/{id}`, and a
 * revalidation would re-render that page into its not-found screen. "Seus stories" keeps the default.
 * The option is untrusted like the id: anything but `{ revalidate?: boolean }` sends no request.
 */
describe('deleteStoryAction — the viewer opts out of the revalidation (2026-10-20)', () => {
  it('D1. by default one DELETE /v1/stories/{id}, then Início and the history are revalidated', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(204));
    await expect(deleteStoryAction(A)).resolves.toEqual({ ok: true });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe(`/v1/stories/${A}`);
    expect(init?.method).toBe('DELETE');
    expect(vi.mocked(revalidatePath).mock.calls.map(([target]) => target)).toEqual([
      '/inicio',
      '/stories/meus',
    ]);
  });

  it('D2. { revalidate: false } deletes the same way and revalidates nothing', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(204));
    await expect(deleteStoryAction(A, { revalidate: false })).resolves.toEqual({ ok: true });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('D3. a malformed id or option sends NO request', async () => {
    await expect(deleteStoryAction('nao-e-um-uuid')).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    await expect(
      deleteStoryAction(A, { revalidate: 'nao' } as unknown as { revalidate: boolean }),
    ).resolves.toEqual({ ok: false, code: 'generic' });
    await expect(
      deleteStoryAction(A, { revalidate: false, path: '/x' } as unknown as { revalidate: boolean }),
    ).resolves.toEqual({ ok: false, code: 'generic' });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('D5. 10-12: a member’s refused delete (a 403 of someone else’s story) is generic, silent and revalidates nothing', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(403, { error: { code: 'FORBIDDEN' } }));
    await expect(deleteStoryAction(A, { revalidate: false })).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('D4. a miss is the generic answer and revalidates nothing', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(404, { error: { code: 'NOT_FOUND' } }));
    await expect(deleteStoryAction(A)).resolves.toEqual({ ok: false, code: 'generic' });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

/**
 * 10-12 (MSTORY-03, D-714, D-717): the Explorar row's two server actions. Both are public endpoints
 * with untrusted arguments, so a membership id that is not a uuid and a cursor outside the contract
 * send NO request; both answer `{ ok: false }` for every miss with no detail (the bare 404 included),
 * which the row renders as the group error with its retry or the trailing "Recarregar" circle; a
 * lost session is a navigation taken outside the try/catch.
 */
describe('loadAuthorStoriesAction / loadStoryAuthorsPageAction — the row (10-12)', () => {
  const MEMBER = '0e000000-0000-4000-8000-0000000000e1';
  const PHOTO = '/v1/media/0b000000-0000-4000-8000-0000000000a1/w128';

  function story(n: number) {
    return {
      id: uuid(n),
      authorUserId: null,
      author: { membershipId: MEMBER, displayName: 'Helena', avatarUrl: PHOTO },
      mediaAssetId: '0b000000-0000-4000-8000-000000000001',
      mediaKind: 'image',
      mediaVariantWidths: [640],
      mediaStatus: 'ready',
      mediaFailureReason: null,
      caption: 'oi',
      publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      isActive: true,
      durationSeconds: null,
      likeCount: 1,
      commentCount: 0,
      viewerLiked: false,
      highlightCount: 0,
      viewerSeen: true,
    };
  }

  function circle(n: number, extra: Record<string, unknown> = {}) {
    return {
      membershipId: uuid(n),
      displayName: `Pessoa ${n}`,
      avatarUrl: null,
      storyCount: 1,
      latestPublishedAt: '2026-11-11T12:00:00.000000Z',
      hasUnseen: n % 2 === 0,
      isSelf: false,
      ...extra,
    };
  }

  it('G1. a membership id that is not a uuid is refused WITHOUT a request', async () => {
    await expect(loadAuthorStoriesAction('nao-e-um-uuid')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('G2. a hit maps every story with the viewer view builder, in the API order, seen flags kept', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(200, { items: [story(1), story(2)] }));
    const result = await loadAuthorStoriesAction(MEMBER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual([uuid(1), uuid(2)]);
    expect(result.items[0]).toMatchObject({ caption: 'oi', likeCount: 1, seen: true });
    expect(typeof result.items[0]?.timeLabel).toBe('string');
    expect(apiFetch).toHaveBeenCalledWith(`/v1/stories/authors/${MEMBER}`);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('G3. the bare 404, an EMPTY group and a failure are all { ok: false } with no detail', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(status(404, { error: { code: 'NOT_FOUND' } }));
    await expect(loadAuthorStoriesAction(MEMBER)).resolves.toEqual({ ok: false });
    vi.mocked(apiFetch).mockResolvedValueOnce(status(200, { items: [] }));
    await expect(loadAuthorStoriesAction(MEMBER)).resolves.toEqual({ ok: false });
    vi.mocked(apiFetch).mockResolvedValueOnce(status(500, { error: { code: 'INTERNAL' } }));
    await expect(loadAuthorStoriesAction(MEMBER)).resolves.toEqual({ ok: false });
  });

  it('G4. a lost session is a navigation to /entrar, taken outside the try/catch', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(401, { error: { code: 'UNAUTHENTICATED' } }));
    await expect(loadAuthorStoriesAction(MEMBER)).rejects.toThrow('redirect:/entrar');
  });

  it('G5. the moderator page: plain author data and the next cursor, one GET with the cursor verbatim', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      status(200, { items: [circle(1), circle(2, { avatarUrl: PHOTO })], nextCursor: 'next-1' }),
    );
    const result = await loadStoryAuthorsPageAction('cur-1');
    expect(result).toEqual({
      ok: true,
      authors: [
        { membershipId: uuid(1), displayName: 'Pessoa 1', avatarUrl: null, hasUnseen: false },
        { membershipId: uuid(2), displayName: 'Pessoa 2', avatarUrl: PHOTO, hasUnseen: true },
      ],
      nextCursor: 'next-1',
    });
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/v1/stories/authors?cursor=cur-1');
  });

  it('G6. a cursor outside the contract sends no request; a failed page is { ok: false }', async () => {
    await expect(loadStoryAuthorsPageAction('x'.repeat(5000))).resolves.toEqual({ ok: false });
    await expect(loadStoryAuthorsPageAction('')).resolves.toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
    vi.mocked(apiFetch).mockResolvedValue(status(500, { error: { code: 'INTERNAL' } }));
    await expect(loadStoryAuthorsPageAction('cur-1')).resolves.toEqual({ ok: false });
    expect(redirect).not.toHaveBeenCalled();
  });
});
