import {
  COMMUNITY_MAX_ORDER,
  COMMUNITY_MAX_PAGE_SIZE,
  type CommunitySummary,
} from '@rede-social/module-communities/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import {
  communityRelation,
  getOrderableCommunities,
  loadCommunities,
  ownsActiveCommunity,
  reorderCommunities,
} from './communities';

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
    kind: 'organization',
    createdBy: null,
    viewer: {
      isOwner: false,
      canPublish: false,
      canEdit: false,
      canCurate: false,
      actions: { like: true, comment: true, share: true, post: false, story: false },
    },
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
    return json(200, { items, nextCursor: more ? `c${pageIndex + 1}` : null, memberQuota: null });
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
      .mockResolvedValueOnce(
        json(200, { items: [community(1), community(2)], nextCursor: 'c1', memberQuota: null }),
      )
      .mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));

    await expect(getOrderableCommunities()).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe('reorderCommunities — one PUT, a strict answer, refusals as ApiClientError', () => {
  it('4. PUTs the ids as given and returns the parsed first page', async () => {
    const page = { items: [community(2), community(1)], nextCursor: null, memberQuota: null };
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
      json(200, { items: [{ ...community(1), position: 1 }], nextCursor: null, memberQuota: null }),
    );

    await expect(reorderCommunities({ ids: [uuid(1)] })).rejects.toThrow();
  });
});

/* ── 10-13 (D-701, D-703, D-710): what the list read carries into the web ─────────────────────── */

describe('loadCommunities — kind, createdBy, viewer and memberQuota reach the page WHOLE (10-13)', () => {
  const HELENA = {
    membershipId: '99999999-9999-4999-8999-999999999999',
    displayName: 'Helena',
    avatarAssetId: null,
  };

  it('1. an organization entry and a member entry keep their viewer.actions object unchanged', async () => {
    const org = community(1);
    const member: CommunitySummary = {
      ...community(2),
      kind: 'member',
      createdBy: HELENA,
      viewer: {
        isOwner: true,
        canPublish: true,
        canEdit: true,
        canCurate: true,
        // Deliberately NOT the defaults the web could invent: the web only forwards what the API said.
        actions: { like: true, comment: false, share: true, post: true, story: false },
      },
    };
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [org, member], nextCursor: null, memberQuota: null }),
    );

    const page = await loadCommunities();

    expect(page?.items[0]?.viewer.actions).toEqual(org.viewer.actions);
    expect(page?.items[0]?.kind).toBe('organization');
    expect(page?.items[0]?.createdBy).toBeNull();
    expect(page?.items[1]?.viewer).toEqual(member.viewer);
    expect(page?.items[1]?.viewer.actions).toEqual({
      like: true,
      comment: false,
      share: true,
      post: true,
      story: false,
    });
    expect(page?.items[1]?.kind).toBe('member');
    expect(page?.items[1]?.createdBy).toEqual(HELENA);
  });

  it('2. the memberQuota the API sent is carried as sent', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [], nextCursor: null, memberQuota: { ownedActive: 2, limit: 3 } }),
    );
    expect((await loadCommunities())?.memberQuota).toEqual({ ownedActive: 2, limit: 3 });
  });
});

describe('getOrderableCommunities — ORGANIZATION communities only (10-13, UI-D-708)', () => {
  const member = (index: number): CommunitySummary => ({
    ...community(index),
    kind: 'member',
    createdBy: {
      membershipId: '99999999-9999-4999-8999-999999999999',
      displayName: 'Helena',
      avatarAssetId: null,
    },
  });

  it('3. returns the organization rows and drops the member rows that follow them', async () => {
    const org = [community(1), community(2)];
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [...org, member(3), member(4)], nextCursor: null, memberQuota: null }),
    );

    const items = await getOrderableCommunities();

    expect(items?.map((item) => item.id)).toEqual(org.map((item) => item.id));
  });

  it('4. stops walking at the first member row: they come after every organization row', async () => {
    const org = Array.from({ length: COMMUNITY_MAX_PAGE_SIZE - 1 }, (_, i) => community(i + 1));
    vi.mocked(apiFetch).mockImplementation(async () =>
      json(200, { items: [...org, member(900)], nextCursor: 'c1', memberQuota: null }),
    );

    const items = await getOrderableCommunities();

    expect(items).toHaveLength(org.length);
    // The member rows are ordered after the organization's (D-712): nothing later can be organization.
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('5. member rows do not count against the reorder bound', async () => {
    const org = [community(1)];
    const members = Array.from({ length: COMMUNITY_MAX_ORDER }, (_, i) => member(i + 100));
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, { items: [...org, ...members], nextCursor: null, memberQuota: null }),
    );

    const items = await getOrderableCommunities();

    expect(items).not.toBeNull();
    expect(items).toHaveLength(1);
  });
});

/**
 * 10-12 (UI-D-701, UI-D-705): "Destacar" in the story viewer's menu and in "Seus stories" exists only
 * for a member who owns an ACTIVE community. The list read already says it in the caller's own
 * `memberQuota.ownedActive`, so ONE row of the list answers it; the communities module off needs no
 * read at all, and a failed read is `false`, never an error (a UX hint: the API refuses the write).
 */
describe('ownsActiveCommunity — one row of the list answers it (10-12)', () => {
  const MODULES = [{ key: 'communities' }];

  it('O1. the communities module off reads nothing and is false', async () => {
    vi.mocked(apiFetch).mockClear();
    await expect(ownsActiveCommunity([{ key: 'stories' }])).resolves.toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('O2. ownedActive above zero is true, zero or no quota is false; the request is ONE row', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { items: [], nextCursor: null, memberQuota: { ownedActive: 2, limit: 3 } }),
    );
    await expect(ownsActiveCommunity(MODULES)).resolves.toBe(true);
    expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]).toBe('/v1/communities?limit=1');
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { items: [], nextCursor: null, memberQuota: { ownedActive: 0, limit: 3 } }),
    );
    await expect(ownsActiveCommunity(MODULES)).resolves.toBe(false);
    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(200, { items: [], nextCursor: null, memberQuota: null }),
    );
    await expect(ownsActiveCommunity(MODULES)).resolves.toBe(false);
  });

  it('O3. a failed read is false, never an error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL' } }));
    await expect(ownsActiveCommunity(MODULES)).resolves.toBe(false);
    log.mockRestore();
  });
});

/**
 * 10-14 (UI-D-712, UI-D-714): which of the three lifecycle copy variants a viewer reads on a community.
 * It is read off the API's own flags (`kind`, `viewer.isOwner`), never a role or an id comparison: an
 * organization community is `organization` for everyone; a member community is `owner` for its creator
 * and `moderator` for any other viewer the API lets edit it.
 */
describe('communityRelation (10-14)', () => {
  const viewer = (isOwner: boolean) => ({
    isOwner,
    canPublish: isOwner,
    canEdit: true,
    canCurate: isOwner,
    actions: { like: true, comment: true, share: true, post: isOwner, story: isOwner },
  });

  it('R1. an organization community is the organization’s, whoever the viewer is', () => {
    expect(communityRelation({ kind: 'organization', viewer: viewer(false) })).toBe('organization');
  });

  it('R2. the creator of a member community is the owner', () => {
    expect(communityRelation({ kind: 'member', viewer: viewer(true) })).toBe('owner');
  });

  it('R3. any other viewer of a member community is a moderator', () => {
    expect(communityRelation({ kind: 'member', viewer: viewer(false) })).toBe('moderator');
  });
});
