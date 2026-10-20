import type { Bootstrap, TenantRole } from '@rede-social/contracts';
import { MEMBERS_PAGE_SIZE } from '@rede-social/contracts/profiles';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { getMembers } from '@/lib/profile';
import { loadFollowState } from '@/lib/social';
import { loadMoreMembersAction } from './actions';

/**
 * 2026-10-12 — the directory's load-more action is the staff's only, like the page. An action is a
 * public endpoint, so closing `/membros` alone would leave the list one POST away. The claims:
 *
 *  1. **A member is refused** with the action's ONE generic answer, and the list is never read.
 *  2. **The staff page on** exactly as before: the cursor and the search are forwarded verbatim.
 *  3. **A bootstrap refusal is still a navigation** (outside the try/catch), and any other bootstrap
 *     failure is the same generic answer, logged.
 *  4. **A malformed request is refused before anything is read**, the bootstrap included.
 *
 * What is stubbed: `getBootstrap` (the viewer's role), `getMembers` (the list) and `redirect`. What
 * is real: the query schema, `ApiClientError`, the refusal map and the role rule.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: vi.fn(),
}));

vi.mock('@/lib/profile', () => ({ getMembers: vi.fn() }));

vi.mock('@/lib/social', () => ({ loadFollowState: vi.fn() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

/** The bootstrap as far as the action reads it: the viewer's OWN role and composed permissions. */
function viewer(role: TenantRole, permissions: string[] = []) {
  vi.mocked(getBootstrap).mockResolvedValue({
    membership: { role },
    permissions,
  } as unknown as Bootstrap);
}

const PAGE = {
  items: [
    {
      membershipId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Ana Souza',
      bio: null,
      avatarAssetId: null,
      avatarUrl: null,
    },
  ],
  nextCursor: 'next-opaque',
};

const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.mocked(getBootstrap).mockReset();
  vi.mocked(getMembers).mockReset().mockResolvedValue(PAGE);
  vi.mocked(loadFollowState).mockReset();
  vi.mocked(redirect).mockClear();
  logged.mockClear();
});

describe('loadMoreMembersAction — the staff, and the member while social is on', () => {
  it('1. a member without social.participate gets the generic refusal and the list is never read', async () => {
    viewer('member');

    await expect(loadMoreMembersAction('opaque', 'ana')).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(getMembers).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('2. admin and support page on, the cursor and the search forwarded verbatim', async () => {
    for (const role of ['admin_tenant', 'support_tenant'] as const) {
      viewer(role);
      await expect(loadMoreMembersAction('opaque', 'ana')).resolves.toEqual({
        ok: true,
        items: PAGE.items,
        nextCursor: 'next-opaque',
      });
    }
    expect(getMembers).toHaveBeenCalledTimes(2);
    expect(getMembers).toHaveBeenLastCalledWith({
      cursor: 'opaque',
      q: 'ana',
      limit: MEMBERS_PAGE_SIZE,
    });
  });

  it('3. a bootstrap refusal is a navigation; any other bootstrap failure is generic, logged', async () => {
    vi.mocked(getBootstrap).mockRejectedValueOnce(new ApiClientError(401, 'UNAUTHENTICATED'));
    await expect(loadMoreMembersAction('opaque')).rejects.toThrow('redirect:/entrar');

    vi.mocked(getBootstrap).mockRejectedValueOnce(new ApiClientError(503, 'UNAVAILABLE'));
    await expect(loadMoreMembersAction('opaque')).resolves.toEqual({ ok: false, code: 'generic' });
    expect(logged).toHaveBeenCalledWith('members.load_more_failed', expect.any(Object));
    expect(getMembers).not.toHaveBeenCalled();
  });

  it('4. a malformed request is refused before anything is read', async () => {
    viewer('admin_tenant');
    // Far past the contract's cursor cap: the schema refuses it before any read.
    await expect(loadMoreMembersAction('x'.repeat(5_000))).resolves.toEqual({
      ok: false,
      code: 'generic',
    });
    expect(getBootstrap).not.toHaveBeenCalled();
    expect(getMembers).not.toHaveBeenCalled();
  });
});

/**
 * 09-10 (D-466, FOLLOW-05, EP-43): a participating member pages the directory too, and each page
 * carries the follow state of ITS ids from one batch read, so a row is never N requests.
 */
describe('loadMoreMembersAction — the member with social.participate (09-10)', () => {
  const ID = PAGE.items[0]?.membershipId ?? '';

  it('5. pages on and returns the batch follow state beside the items', async () => {
    viewer('member', ['social.participate']);
    vi.mocked(loadFollowState).mockResolvedValue({ [ID]: true });

    await expect(loadMoreMembersAction('opaque', 'ana')).resolves.toEqual({
      ok: true,
      items: PAGE.items,
      nextCursor: 'next-opaque',
      following: { [ID]: true },
    });
    expect(loadFollowState).toHaveBeenCalledTimes(1);
    expect(loadFollowState).toHaveBeenCalledWith([ID]);
  });

  it('6. a failed state read keeps the page and says so with null (the rows hold their slot)', async () => {
    viewer('member', ['social.participate']);
    vi.mocked(loadFollowState).mockResolvedValue(null);

    await expect(loadMoreMembersAction('opaque')).resolves.toEqual({
      ok: true,
      items: PAGE.items,
      nextCursor: 'next-opaque',
      following: null,
    });
  });

  it('7. the staff page without a follow state: the key is absent and nothing is read', async () => {
    viewer('admin_tenant');
    const answer = await loadMoreMembersAction('opaque');
    expect(answer).toEqual({ ok: true, items: PAGE.items, nextCursor: 'next-opaque' });
    expect('following' in answer).toBe(false);
    expect(loadFollowState).not.toHaveBeenCalled();
  });

  it('8. a member without the permission never reaches the state read either', async () => {
    viewer('member', ['feed.post.create']);
    await expect(loadMoreMembersAction('opaque')).resolves.toEqual({ ok: false, code: 'generic' });
    expect(loadFollowState).not.toHaveBeenCalled();
  });
});
