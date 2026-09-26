import { STORY_SEEN_BATCH_MAX } from '@tria/module-stories/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { markStoriesSeenAction } from './story-actions';

/**
 * 05.2-10 — the seen-state write behind the tenant circle's ring (HIGHLIGHT-06, D-105, R-P5).
 *
 * `StoriesSurface` flushes its buffer of shown story ids through this server action. A server action
 * is a public endpoint and its argument is untrusted, and this one runs in the BACKGROUND of a
 * viewing session, so the claims worth a test are:
 *
 *  1. **Nothing malformed reaches the API** — an empty list or a non-uuid is refused here, with no
 *     request (the contract's own `markStoriesSeenSchema`).
 *  2. **A valid list is ONE `POST /v1/stories/views`** — and a list longer than the contract's cap is
 *     chunked, never refused.
 *  3. **It is SILENT** (planning decision 4): a refusal, a 401 or a transport failure answers `false`
 *     — it never navigates (`redirect`), never revalidates a page, and never throws.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env`, `next/cache` and
 * `next/navigation`. What is real: the schema guard, the chunking and the fetcher.
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

  it('A3. a list over the contract cap is CHUNKED into requests of at most the cap', async () => {
    vi.mocked(apiFetch).mockResolvedValue(status(204));
    const ids = Array.from({ length: STORY_SEEN_BATCH_MAX + 3 }, (_, n) => uuid(n + 1));
    await expect(markStoriesSeenAction(ids)).resolves.toBe(true);

    const bodies = vi
      .mocked(apiFetch)
      .mock.calls.map(([, init]) => JSON.parse(String(init?.body)).storyIds as string[]);
    expect(bodies.map((chunk) => chunk.length)).toEqual([STORY_SEEN_BATCH_MAX, 3]);
    expect(bodies.flat()).toEqual(ids);
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
