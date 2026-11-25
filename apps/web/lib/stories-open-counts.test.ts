import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { loadOpenHighlightCounts } from '@/lib/stories-open-counts';

/**
 * 11.1-12 (UI-D-884 (3), A-UI-5): the staff-only open-counts read the product form's helper line
 * stands on. It answers a record of finished counts, or `null` on ANY failure (a missing or failed
 * count shows no helper), never throws and never navigates.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function answer(items: unknown[], status = 200) {
  vi.mocked(apiFetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ items }), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.restoreAllMocks();
});

describe('loadOpenHighlightCounts', () => {
  it('1. reads the route with one comma-separated string and answers a record by community', async () => {
    answer([
      { communityId: uuid(1), openHighlights: 0 },
      { communityId: uuid(2), openHighlights: 3 },
    ]);
    const counts = await loadOpenHighlightCounts([uuid(1), uuid(2)]);
    expect(counts).toEqual({ [uuid(1)]: 0, [uuid(2)]: 3 });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe(
      `/v1/stories/highlights/open-counts?communityIds=${encodeURIComponent(`${uuid(1)},${uuid(2)}`)}`,
    );
  });

  it('2. a community the API leaves out stays ABSENT from the record (no helper), never 0', async () => {
    answer([{ communityId: uuid(1), openHighlights: 2 }]);
    const counts = await loadOpenHighlightCounts([uuid(1), uuid(2)]);
    expect(counts).not.toBeNull();
    expect(uuid(2) in (counts ?? {})).toBe(false);
  });

  it('3. no community asks nothing and answers an empty record', async () => {
    await expect(loadOpenHighlightCounts([])).resolves.toEqual({});
    expect(vi.mocked(apiFetch)).not.toHaveBeenCalled();
  });

  it('4. a refusal (403, 404, 400, 500) is null and is logged by shape only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const status of [400, 403, 404, 500]) {
      vi.mocked(apiFetch).mockResolvedValueOnce(new Response('{}', { status }));
      await expect(loadOpenHighlightCounts([uuid(1)])).resolves.toBeNull();
    }
    expect(log).toHaveBeenCalledWith('stories.open_counts_failed', expect.anything());
    expect(JSON.stringify(log.mock.calls)).not.toContain(uuid(1));
  });

  it('5. a thrown transport and an answer outside the strict contract are null too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    await expect(loadOpenHighlightCounts([uuid(1)])).resolves.toBeNull();

    answer([{ communityId: uuid(1), openHighlights: -1 }]);
    await expect(loadOpenHighlightCounts([uuid(1)])).resolves.toBeNull();

    answer([{ communityId: uuid(1), openHighlights: 1, extra: true }]);
    await expect(loadOpenHighlightCounts([uuid(1)])).resolves.toBeNull();
  });

  it('6. more than 50 communities go in chunks of 50, deduplicated; any failed chunk makes the whole null', async () => {
    const ids = Array.from({ length: 120 }, (_, index) => uuid(index + 1));
    answer([{ communityId: uuid(1), openHighlights: 1 }]);
    answer([{ communityId: uuid(51), openHighlights: 0 }]);
    answer([{ communityId: uuid(101), openHighlights: 4 }]);
    const counts = await loadOpenHighlightCounts([...ids, uuid(1)]);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(3);
    expect(counts).toEqual({ [uuid(1)]: 1, [uuid(51)]: 0, [uuid(101)]: 4 });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer([]);
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    answer([]);
    await expect(loadOpenHighlightCounts(ids)).resolves.toBeNull();
  });
});
