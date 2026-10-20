import { ACCESS_REFUSALS } from '@rede-social/contracts/access';
import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { loadPost } from './feed';

/**
 * 09-11 (D-469, UI-D-499, T-09-38): `loadPost` and the 403 a stranger gets on a followers-only member
 * post. The claims:
 *
 *  1. A 403 whose `details.access` is `follow_required` and whose `details.author` is the strict
 *     `postLockedAuthorSchema` shape is the `follow-required` result, carrying exactly that author.
 *  2. A malformed or missing author, an author with an extra key, or an author id that is not a uuid
 *     falls back to the standard `not-found`: an attacker-chosen body can never draw the locked card.
 *  3. The access value is matched BY NAME against `ACCESS_REFUSALS`, and `community_locked` keeps its
 *     08.2 redirect to the community page untouched.
 *  4. 404 and 400 stay `not-found`.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const MEMBERSHIP = '11111111-1111-4111-8111-111111111111';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const AVATAR = '44444444-4444-4444-8444-444444444444';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function forbidden(details: Record<string, unknown>): Response {
  return json({ error: { code: 'FORBIDDEN', message: 'forbidden', requestId: 'r', details } }, 403);
}

const AUTHOR = { membershipId: MEMBERSHIP, displayName: 'Helena Küster', avatarAssetId: AVATAR };

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(redirect).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('loadPost - the follow-required answer', () => {
  it('P1: ACCESS_REFUSALS contains follow_required, found by name and never by position', () => {
    expect(ACCESS_REFUSALS).toContain('follow_required');
    expect(ACCESS_REFUSALS[0]).toBe('community_locked');
  });

  it('P2: a 403 follow_required with a valid author is the follow-required result', async () => {
    vi.mocked(apiFetch).mockResolvedValue(forbidden({ access: 'follow_required', author: AUTHOR }));
    await expect(loadPost('post-id')).resolves.toEqual({
      status: 'follow-required',
      author: AUTHOR,
    });
  });

  it('P3: an author without a photo (avatarAssetId null) is still the follow-required result', async () => {
    const author = { ...AUTHOR, avatarAssetId: null };
    vi.mocked(apiFetch).mockResolvedValue(forbidden({ access: 'follow_required', author }));
    await expect(loadPost('post-id')).resolves.toEqual({ status: 'follow-required', author });
  });

  it.each([
    ['no author at all', { access: 'follow_required' }],
    ['an author that is not an object', { access: 'follow_required', author: 'Helena' }],
    [
      'a membership id that is not a uuid',
      { access: 'follow_required', author: { ...AUTHOR, membershipId: '../../admin' } },
    ],
    [
      'an author carrying an extra key (the schema is strict)',
      { access: 'follow_required', author: { ...AUTHOR, caption: 'the secret caption' } },
    ],
    [
      'a display name that is not a string',
      { access: 'follow_required', author: { ...AUTHOR, displayName: 7 } },
    ],
  ])('P4: %s falls back to the standard not-found screen', async (_label, details) => {
    vi.mocked(apiFetch).mockResolvedValue(forbidden(details));
    await expect(loadPost('post-id')).resolves.toEqual({ status: 'not-found' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('P5: community_locked keeps its 08.2 redirect to the community page', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      forbidden({ access: 'community_locked', communityId: COMMUNITY }),
    );
    await expect(loadPost('post-id')).rejects.toThrow(
      `redirect:/comunidades/${COMMUNITY}?exclusivo=1`,
    );
  });

  it('P6: a community_locked body is never read as a follow-required one', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      forbidden({ access: 'community_locked', communityId: COMMUNITY, author: AUTHOR }),
    );
    await expect(loadPost('post-id')).rejects.toThrow('redirect:/comunidades/');
  });

  it.each([404, 400])('P7: a bare %i is the standard not-found', async (status) => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status }));
    await expect(loadPost('post-id')).resolves.toEqual({ status: 'not-found' });
  });

  it('P8: a 500 that carries a follow_required body is an error, never the locked card', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(
        {
          error: {
            code: 'X',
            message: 'x',
            requestId: 'r',
            details: { access: 'follow_required', author: AUTHOR },
          },
        },
        500,
      ),
    );
    await expect(loadPost('post-id')).resolves.toEqual({ status: 'error' });
  });
});
