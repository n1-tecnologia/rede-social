import {
  COMMUNITY_MAX_ORDER,
  COMMUNITY_MAX_PAGE_SIZE,
  type CommunitySummary,
} from '@rede-social/module-communities/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import { getOrderableCommunities, reorderCommunities } from './communities';

/**
 * 2026-10-03 — the two BFF calls behind the Comunidades reorder mode, against a stubbed transport.
 *
 *  1. **`getOrderableCommunities` walks the list's OWN keyset to the end** — `GET /v1/communities`
 *     at the widest page, the cursor handed back verbatim — because an order is one permutation of
 *     the WHOLE active set. Unlike the picker's `listAllCommunities` it never settles for "whatever
 *     loaded": past `COMMUNITY_MAX_ORDER` it says `null`, and a failed page THROWS, because a partial
 *     list could never be saved (the API would answer `order_stale` forever).
 *  2. **`reorderCommunities` is one `PUT /v1/communities/order`** with the ids as given, parses the
 *     answer with the strict page schema, and turns a refusal into an `ApiClientError` carrying the
 *     status and `details` — which is what the action reads `order_stale` from.
 *
 * What is stubbed: `lib/api`'s `apiFetch` and `lib/env`. What is real: the query strings, the schema
 * parse and the error mapping.
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

// `lib/communities` imports `redirect` for its loaders; nothing here may reach it.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A distinct, valid uuid per index. */
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

function community(index: number): CommunitySummary {
  return {
    id: uuid(index),
    name: `Comunidade ${index}`,
    slug: `comunidade-${index}`,
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: 'active',
    lastActivityAt: '2026-10-01T10:00:00.000000Z',
  };
}

/** `count` communities, served in pages of `COMMUNITY_MAX_PAGE_SIZE` with cursors `c1`, `c2`, … */
function serve(count: number) {
  const all = Array.from({ length: count }, (_, index) => community(index + 1));
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    const url = new URL(path, 'http://api.test');
    const cursor = url.searchParams.get('cursor');
    const pageIndex = cursor === null ? 0 : Number(cursor.slice(1));
    const start = pageIndex * COMMUNITY_MAX_PAGE_SIZE;
    const items = all.slice(start, start + COMMUNITY_MAX_PAGE_SIZE);
    const more = start + COMMUNITY_MAX_PAGE_SIZE < all.length;
    return json(200, { items, nextCursor: more ? `c${pageIndex + 1}` : null });
  });
  return all;
}

const paths = () => vi.mocked(apiFetch).mock.calls.map(([path]) => path);

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe('getOrderableCommunities — the whole active set, or an honest null', () => {
  it('1. walks every page of the ACTIVE keyset, at the widest page, cursors verbatim', async () => {
    const all = serve(COMMUNITY_MAX_PAGE_SIZE * 2 + 3);

    const items = await getOrderableCommunities();

    expect(items?.map((item) => item.id)).toEqual(all.map((item) => item.id));
    expect(paths()).toEqual([
      `/v1/communities?limit=${COMMUNITY_MAX_PAGE_SIZE}`,
      `/v1/communities?cursor=c1&limit=${COMMUNITY_MAX_PAGE_SIZE}`,
      `/v1/communities?cursor=c2&limit=${COMMUNITY_MAX_PAGE_SIZE}`,
    ]);
    // Never the archived list: the order belongs to the active one.
    for (const path of paths()) expect(path).not.toContain('status=');
  });

  it('2. exactly COMMUNITY_MAX_ORDER is a complete answer; one more is null, never a partial list', async () => {
    serve(COMMUNITY_MAX_ORDER);
    expect(await getOrderableCommunities()).toHaveLength(COMMUNITY_MAX_ORDER);

    vi.mocked(apiFetch).mockReset();
    serve(COMMUNITY_MAX_ORDER + 1);
    expect(await getOrderableCommunities()).toBeNull();
  });

  it('3. a failed page THROWS — the picker’s "whatever loaded" would be an unsavable order here', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(json(200, { items: [community(1), community(2)], nextCursor: 'c1' }))
      .mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));

    await expect(getOrderableCommunities()).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe('reorderCommunities — one PUT, a strict answer, refusals as ApiClientError', () => {
  it('4. PUTs the ids as given and returns the parsed first page', async () => {
    const page = { items: [community(2), community(1)], nextCursor: null };
    vi.mocked(apiFetch).mockResolvedValue(json(200, page));

    const answer = await reorderCommunities({ ids: [uuid(2), uuid(1)] });

    expect(answer).toEqual(page);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/communities/order');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ ids: [uuid(2), uuid(1)] });
  });

  it('5. a 409 order_stale arrives as an ApiClientError carrying the status and the code', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(409, { error: { code: 'CONFLICT', details: { community: 'order_stale' } } }),
    );

    const error = await reorderCommunities({ ids: [uuid(1)] }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(409);
    expect((error as ApiClientError).code).toBe('CONFLICT');
    expect((error as ApiClientError).details).toEqual({ community: 'order_stale' });
  });

  it('6. an answer that is not the strict page shape is refused, never half-trusted', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [{ ...community(1), position: 1 }], nextCursor: null }),
    );

    await expect(reorderCommunities({ ids: [uuid(1)] })).rejects.toThrow();
  });
});
