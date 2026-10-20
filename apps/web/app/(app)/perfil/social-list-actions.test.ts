import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/bootstrap';
import { getFollowers, getFollowing } from '@/lib/social';
import { loadMoreFollowersAction, loadMoreFollowingAction } from './social-list-actions';

/**
 * 09-10 Task 3 (D-468, T-09-29): the two list actions. They take a CURSOR and nothing else - there is
 * no member id to forge - and read the session's own rows through the API. The claims: the contract's
 * own Zod runs before any request (a cursor past its cap is refused), the opaque cursor is forwarded
 * verbatim, a session refusal is a navigation outside the try/catch, and any other failure is the one
 * `generic` answer (a catalog key, never the server's words, T-09-37).
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/social', () => ({ getFollowers: vi.fn(), getFollowing: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const PAGE = {
  items: [
    {
      membershipId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Ana Souza',
      bio: null,
      avatarAssetId: null,
      viewerFollows: true,
    },
  ],
  nextCursor: 'next-opaque',
};

const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  vi.mocked(getFollowers).mockReset().mockResolvedValue(PAGE);
  vi.mocked(getFollowing).mockReset().mockResolvedValue(PAGE);
  vi.mocked(redirect).mockClear();
  logged.mockClear();
});

describe('loadMoreFollowersAction and loadMoreFollowingAction', () => {
  it('A1: each reads its own list and forwards the cursor verbatim', async () => {
    await expect(loadMoreFollowersAction('opaque')).resolves.toEqual({
      ok: true,
      items: PAGE.items,
      nextCursor: 'next-opaque',
    });
    expect(getFollowers).toHaveBeenCalledWith('opaque');
    expect(getFollowing).not.toHaveBeenCalled();

    await loadMoreFollowingAction('opaque-2');
    expect(getFollowing).toHaveBeenCalledWith('opaque-2');
  });

  it('A2: a cursor past the contract cap is refused before any request', async () => {
    await expect(loadMoreFollowersAction('x'.repeat(5_000))).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    await expect(loadMoreFollowingAction('x'.repeat(5_000))).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(getFollowers).not.toHaveBeenCalled();
    expect(getFollowing).not.toHaveBeenCalled();
  });

  it('A3: a session refusal is a navigation', async () => {
    vi.mocked(getFollowers).mockRejectedValueOnce(new ApiClientError(401, 'UNAUTHENTICATED'));
    await expect(loadMoreFollowersAction('opaque')).rejects.toThrow('redirect:/entrar');
  });

  it('A4: any other failure is the generic answer, logged by shape', async () => {
    vi.mocked(getFollowing).mockRejectedValueOnce(new ApiClientError(503, 'UNAVAILABLE'));
    await expect(loadMoreFollowingAction('opaque')).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(logged).toHaveBeenCalledWith('social.list_more_failed', expect.any(Object));
  });

  it('A5: the actions take exactly one argument: no member id', () => {
    expect(loadMoreFollowersAction.length).toBe(1);
    expect(loadMoreFollowingAction.length).toBe(1);
  });
});
