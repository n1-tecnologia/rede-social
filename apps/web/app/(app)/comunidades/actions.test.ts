import { COMMUNITY_MAX_ORDER } from '@rede-social/module-communities/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import {
  createCommunity,
  getCommunities,
  getOrderableCommunities,
  loadCommunity,
  reorderCommunities,
  updateCommunity,
} from '@/lib/communities';
import {
  archiveCommunityAction,
  createCommunityAction,
  loadMoreCommunitiesAction,
  loadOrderableCommunitiesAction,
  refreshCommunitiesAction,
  reorderCommunitiesAction,
  updateCommunityAction,
} from './actions';

/**
 * 05-09 — where the TWO bare 404s are told apart, and why it is safe to tell them apart HERE.
 *
 * The API answers ONE bare 404 for a missing community and for a missing cover asset, deliberately:
 * that indistinguishability is the anti-oracle property D-23 buys and `isolation.test.ts` case b5
 * pins with a body equality. Nothing in the web tier may weaken the server to make this job easier.
 *
 * So the disambiguation happens in the BFF, and it is decided by a FACT rather than by what the form
 * remembers:
 *   - on a CREATE no community id was sent at all, so a 404 on a submission carrying a cover can
 *     only be about the cover;
 *   - on an UPDATE the action RE-READS the community; it still reads back, so the 404 was the cover.
 *
 * The re-read is one extra GET on an already-failed write, against a resource the admin has open on
 * their screen — it tells them nothing they did not already know, so it opens no channel of its own.
 *
 * What is stubbed: `lib/communities` (the three requests). What is real: the schemas, the refusal
 * mapping and the attribution rule this file exists to pin.
 */

// The module graph reaches `lib/env`, which validates the process environment at import time
// (fail fast, by design). Stubbed here exactly as `tenant-host.test.ts` stubs it.
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/communities', () => ({
  createCommunity: vi.fn(),
  updateCommunity: vi.fn(),
  loadCommunity: vi.fn(),
  getCommunities: vi.fn(),
  getOrderableCommunities: vi.fn(),
  reorderCommunities: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('redirect should not be reached in these cases');
  }),
}));

const COVER = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '22222222-2222-4222-8222-222222222222';

/** The bare 404 the API answers for a missing community AND for a missing cover — no details. */
const bare404 = () => new ApiClientError(404, 'NOT_FOUND', undefined, 'req-1');

beforeEach(() => {
  vi.mocked(createCommunity).mockReset();
  vi.mocked(updateCommunity).mockReset();
  vi.mocked(loadCommunity).mockReset();
  vi.mocked(getCommunities).mockReset();
  vi.mocked(getOrderableCommunities).mockReset();
  vi.mocked(reorderCommunities).mockReset();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(redirect).mockClear();
});

describe('createCommunityAction — a 404 on a create can only be the cover (05-09)', () => {
  it('attributes the bare 404 to the cover when the submission carried one', async () => {
    vi.mocked(createCommunity).mockRejectedValue(bare404());

    const result = await createCommunityAction({ name: 'Avisos', coverAssetId: COVER });

    // Not `not_found`: on `/comunidades/nova` there IS no community id, so "Comunidade não
    // encontrada" would be a false statement about what the admin just did.
    expect(result).toEqual({ ok: false, code: 'cover_invalid' });
    // And it costs no extra request: the create path decides from a fact it already holds.
    expect(loadCommunity).not.toHaveBeenCalled();
  });

  it('keeps not_found when the submission carried NO cover', async () => {
    vi.mocked(createCommunity).mockRejectedValue(bare404());

    const result = await createCommunityAction({ name: 'Avisos', coverAssetId: null });

    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('maps the closed cover_invalid code straight through', async () => {
    vi.mocked(createCommunity).mockRejectedValue(
      new ApiClientError(400, 'VALIDATION_FAILED', { community: 'cover_invalid' }, 'req-2'),
    );

    const result = await createCommunityAction({ name: 'Avisos', coverAssetId: COVER });

    expect(result).toEqual({ ok: false, code: 'cover_invalid' });
  });
});

describe('updateCommunityAction — a 404 on an edit is settled by a RE-READ (05-09)', () => {
  it('answers cover_invalid when the community still reads back', async () => {
    vi.mocked(updateCommunity).mockRejectedValue(bare404());
    vi.mocked(loadCommunity).mockResolvedValue({
      status: 'ok',
      // Only the discriminant is read; the shape is the contract's own.
      community: {
        id: COMMUNITY,
        name: 'Avisos',
        slug: 'avisos',
        description: '',
        coverAssetId: null,
        coverVariantWidths: [],
        postCount: 0,
        status: 'active',
        lastActivityAt: '2026-01-01T00:00:00.000000Z',
      },
    });

    const result = await updateCommunityAction(COMMUNITY, { coverAssetId: COVER });

    expect(result).toEqual({ ok: false, code: 'cover_invalid' });
    expect(loadCommunity).toHaveBeenCalledWith(COMMUNITY);
  });

  it('keeps not_found when the community itself is gone', async () => {
    vi.mocked(updateCommunity).mockRejectedValue(bare404());
    vi.mocked(loadCommunity).mockResolvedValue({ status: 'not-found' });

    const result = await updateCommunityAction(COMMUNITY, { coverAssetId: COVER });

    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('keeps not_found — conservatively — when the re-read itself could not be read', async () => {
    vi.mocked(updateCommunity).mockRejectedValue(bare404());
    vi.mocked(loadCommunity).mockResolvedValue({ status: 'error' });

    const result = await updateCommunityAction(COMMUNITY, { coverAssetId: COVER });

    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('pays for NO re-read when the submission carried no cover — and the 404 can only mean the community is gone', async () => {
    // A cover-silent submission makes no claim about a cover, so there is nothing for a re-read to
    // disambiguate and the refusal stays `not_found`. What that 404 MEANS narrowed with CR-01: the
    // API no longer re-validates the STORED cover on a cover-silent PATCH, so it can no longer
    // produce a 404 about a retired cover at all — a community whose own cover was retired archives
    // with a 200 and self-heals (integration case 33). The only surviving meaning here is the
    // literal one: the community itself is gone. The BFF's conservatism is unchanged and still
    // correct; only the case it was covering for no longer exists.
    vi.mocked(updateCommunity).mockRejectedValue(bare404());

    const edit = await updateCommunityAction(COMMUNITY, { name: 'Avisos' });
    expect(edit).toEqual({ ok: false, code: 'not_found' });

    const archived = await archiveCommunityAction(COMMUNITY);
    expect(archived).toEqual({ ok: false, code: 'not_found' });

    expect(loadCommunity).not.toHaveBeenCalled();
  });

  it('archives successfully without adding a refusal of its own — no re-read on the happy path', async () => {
    // The other side of the case above: with CR-01 fixed, the archive of a community carrying a
    // retired cover is a 200 at the API, and the BFF must pass it straight through. It adds no
    // cover-awareness of its own on a path that submitted no cover.
    vi.mocked(updateCommunity).mockResolvedValue({
      id: COMMUNITY,
      name: 'Avisos',
      slug: 'avisos',
      description: '',
      coverAssetId: null,
      coverVariantWidths: [],
      postCount: 0,
      status: 'archived',
      lastActivityAt: '2026-01-01T00:00:00.000000Z',
    });

    const archived = await archiveCommunityAction(COMMUNITY);

    expect(archived).toEqual({ ok: true, communityId: COMMUNITY });
    expect(loadCommunity).not.toHaveBeenCalled();
  });
});

describe('05.1 — the list status is carried through refresh and load-more (Pitfall 9)', () => {
  // A pull or a scroll on `Arquivadas` must never swap the active list in. The status is part of
  // the request the action makes, validated by the SAME schema the API uses.
  const emptyPage = { items: [], nextCursor: null };

  it('load-more carries the archived status beside the cursor, and defaults to active', async () => {
    vi.mocked(getCommunities).mockResolvedValue(emptyPage);

    await loadMoreCommunitiesAction('c', 'archived');
    expect(getCommunities).toHaveBeenLastCalledWith({ cursor: 'c', limit: 10, status: 'archived' });

    await loadMoreCommunitiesAction('c');
    expect(getCommunities).toHaveBeenLastCalledWith({ cursor: 'c', limit: 10, status: 'active' });
  });

  it('refresh carries the archived status, and defaults to active', async () => {
    vi.mocked(getCommunities).mockResolvedValue(emptyPage);

    await refreshCommunitiesAction('archived');
    expect(getCommunities).toHaveBeenLastCalledWith({ status: 'archived' });

    await refreshCommunitiesAction();
    expect(getCommunities).toHaveBeenLastCalledWith({ status: 'active' });
  });

  it('a status outside the enum is refused with generic and never reaches the API', async () => {
    vi.mocked(getCommunities).mockResolvedValue(emptyPage);

    // A server action is a public endpoint: a crafted argument bypasses the type system.
    const forced = 'deleted' as unknown as 'active';
    expect(await refreshCommunitiesAction(forced)).toEqual({ ok: false, code: 'generic' });
    expect(await loadMoreCommunitiesAction('c', forced)).toEqual({ ok: false, code: 'generic' });
    expect(getCommunities).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-03 — the reorder mode's two actions: the read that opens it and the write that saves it.
 *
 * A server action is a public endpoint, so the claims worth a test are the ones a crafted call or a
 * later edit could break: a malformed list never reaches the API (the SAME schema the route uses
 * runs first), `order_stale` is told apart from every other refusal (the list reloads on one and
 * keeps the draft on the other), the save revalidates `/comunidades` only when it landed, and a
 * session refusal is still a navigation.
 */
describe('2026-10-03 — the reorder actions', () => {
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const summary = (id: string, name: string) => ({
    id,
    name,
    slug: name.toLowerCase(),
    description: '',
    coverAssetId: null,
    coverVariantWidths: [],
    postCount: 0,
    status: 'active' as const,
    lastActivityAt: '2026-10-01T10:00:00.000000Z',
  });

  it('opening: the whole set is answered as-is; past the bound it is too_many; a failure is generic', async () => {
    const items = [summary(A, 'Avisos'), summary(B, 'Eventos')];
    vi.mocked(getOrderableCommunities).mockResolvedValueOnce(items);
    expect(await loadOrderableCommunitiesAction()).toEqual({ ok: true, items });

    vi.mocked(getOrderableCommunities).mockResolvedValueOnce(null);
    expect(await loadOrderableCommunitiesAction()).toEqual({ ok: false, code: 'too_many' });

    vi.mocked(getOrderableCommunities).mockRejectedValueOnce(
      new ApiClientError(500, 'INTERNAL', undefined, 'req-3'),
    );
    expect(await loadOrderableCommunitiesAction()).toEqual({ ok: false, code: 'generic' });
    // A read never revalidates.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('saving: the API’s first page in the new order comes back, and /comunidades is revalidated', async () => {
    const page = { items: [summary(B, 'Eventos'), summary(A, 'Avisos')], nextCursor: null };
    vi.mocked(reorderCommunities).mockResolvedValue(page);

    const result = await reorderCommunitiesAction([B, A]);

    expect(result).toEqual({ ok: true, items: page.items, nextCursor: null });
    expect(reorderCommunities).toHaveBeenCalledWith({ ids: [B, A] });
    expect(revalidatePath).toHaveBeenCalledWith('/comunidades');
  });

  it('a malformed list — duplicated, empty, oversized, not uuids, not an array — never reaches the API', async () => {
    const oversized = Array.from(
      { length: COMMUNITY_MAX_ORDER + 1 },
      (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    );
    for (const ids of [[A, A], [A, A.toUpperCase()], [], oversized, ['nope'], A, null]) {
      expect(await reorderCommunitiesAction(ids)).toEqual({ ok: false, code: 'generic' });
    }
    expect(reorderCommunities).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a 409 order_stale is its own code; any other refusal is generic; neither revalidates', async () => {
    vi.mocked(reorderCommunities).mockRejectedValueOnce(
      new ApiClientError(409, 'CONFLICT', { community: 'order_stale' }, 'req-4'),
    );
    expect(await reorderCommunitiesAction([A, B])).toEqual({ ok: false, code: 'order_stale' });

    // A member forcing the action: the API's 403 is not a navigation, and not "stale" either.
    vi.mocked(reorderCommunities).mockRejectedValueOnce(
      new ApiClientError(403, 'FORBIDDEN', undefined, 'req-5'),
    );
    expect(await reorderCommunitiesAction([A, B])).toEqual({ ok: false, code: 'generic' });

    // Another code under 409 is not `order_stale`: only the closed code decides.
    vi.mocked(reorderCommunities).mockRejectedValueOnce(
      new ApiClientError(409, 'CONFLICT', { community: 'archived' }, 'req-6'),
    );
    expect(await reorderCommunitiesAction([A, B])).toEqual({ ok: false, code: 'generic' });

    vi.mocked(reorderCommunities).mockRejectedValueOnce(new Error('network down'));
    expect(await reorderCommunitiesAction([A, B])).toEqual({ ok: false, code: 'generic' });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a lost session is a navigation, taken outside the try/catch', async () => {
    vi.mocked(reorderCommunities).mockRejectedValueOnce(
      new ApiClientError(401, 'UNAUTHENTICATED', undefined, 'req-7'),
    );

    await expect(reorderCommunitiesAction([A, B])).rejects.toThrow(
      'redirect should not be reached in these cases',
    );
    expect(redirect).toHaveBeenCalledWith('/entrar');
  });
});
