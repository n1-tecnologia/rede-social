import { redirect } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import {
  deleteFollow,
  getFollowers,
  getFollowing,
  getFollowState,
  getSocialProfile,
  putFollow,
} from './social';

/**
 * 09-10 (D-467, D-468, FOLLOW-04): the ONE place the web reads or writes `/v1/social`. The claims:
 *
 *  1. **The social profile read never throws.** A 404 (a staff target, social off, an id that is not
 *     a uuid) is `not-eligible`; a 5xx, a malformed answer and a network failure are `error`, so a
 *     failure can never be mistaken for a staff profile.
 *  2. **A session refusal is a navigation**, performed outside the try/catch.
 *  3. **The writes answer `{ following, followerCount }` parsed by the module's own schema**, and a
 *     non-2xx answer throws the `ApiClientError` the action maps.
 *  4. **The lists take no id**: the cursor is the only parameter, forwarded verbatim.
 */

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function envelope(status: number, code: string): Response {
  return json({ error: { code, message: code, requestId: 'r' } }, status);
}

const PROFILE = {
  membershipId: ID,
  followerCount: 3,
  followingCount: 2,
  viewerFollows: false,
  self: false,
};

const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(redirect).mockClear();
  logged.mockClear();
});

describe('getSocialProfile - never throws', () => {
  it('S1: 200 is ok with the parsed shape, read from the social route', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(PROFILE));
    await expect(getSocialProfile(ID)).resolves.toEqual({ status: 'ok', data: PROFILE });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/social/members/${ID}`);
  });

  it.each([404, 403, 400])('S2: %s is not-eligible, never an error', async (status) => {
    vi.mocked(apiFetch).mockResolvedValue(envelope(status, 'NOT_FOUND'));
    await expect(getSocialProfile(ID)).resolves.toEqual({ status: 'not-eligible' });
  });

  it('S3: a 5xx is error and is logged by shape only', async () => {
    vi.mocked(apiFetch).mockResolvedValue(envelope(503, 'UNAVAILABLE'));
    await expect(getSocialProfile(ID)).resolves.toEqual({ status: 'error' });
    expect(logged).toHaveBeenCalledWith('social.profile_failed', expect.any(Object));
  });

  it('S4: a network failure and a malformed answer are error', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('network'));
    await expect(getSocialProfile(ID)).resolves.toEqual({ status: 'error' });
    vi.mocked(apiFetch).mockResolvedValueOnce(json({ membershipId: ID }));
    await expect(getSocialProfile(ID)).resolves.toEqual({ status: 'error' });
  });

  it('S5: a 401 is a navigation to the sign-in, outside the try', async () => {
    vi.mocked(apiFetch).mockResolvedValue(envelope(401, 'UNAUTHENTICATED'));
    await expect(getSocialProfile(ID)).rejects.toThrow('redirect:/entrar');
  });
});

describe('putFollow and deleteFollow', () => {
  it('S6: PUT parses { following, followerCount }', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ following: true, followerCount: 4 }));
    await expect(putFollow(ID)).resolves.toEqual({ following: true, followerCount: 4 });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/social/follows/${ID}`, { method: 'PUT' });
  });

  it('S7: DELETE uses the same route and answers following false', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ following: false, followerCount: 3 }));
    await expect(deleteFollow(ID)).resolves.toEqual({ following: false, followerCount: 3 });
    expect(apiFetch).toHaveBeenCalledWith(`/v1/social/follows/${ID}`, { method: 'DELETE' });
  });

  it('S8: a refusal throws the ApiClientError with the envelope code', async () => {
    vi.mocked(apiFetch).mockResolvedValue(envelope(404, 'NOT_FOUND'));
    await expect(putFollow(ID)).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(putFollow(ID)).rejects.toBeInstanceOf(ApiClientError);
  });

  it('S9: an answer outside the strict shape is refused', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json({ following: true, followerCount: 4, extra: 1 }));
    await expect(putFollow(ID)).rejects.toThrow();
  });
});

describe('the batch state and the two private lists', () => {
  it('S10: the state read posts the ids and returns the items', async () => {
    const body = {
      items: [
        { membershipId: ID, following: true },
        { membershipId: OTHER, following: false },
      ],
    };
    vi.mocked(apiFetch).mockResolvedValue(json(body));
    await expect(getFollowState([ID, OTHER])).resolves.toEqual(body);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/social/follows/state');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ membershipIds: [ID, OTHER] });
  });

  it('S11: the lists carry only the cursor and the page size, never an id', async () => {
    const page = { items: [], nextCursor: null };
    vi.mocked(apiFetch).mockResolvedValue(json(page));
    await getFollowers('opaque-cursor');
    await getFollowing();
    const paths = vi.mocked(apiFetch).mock.calls.map((call) => String(call[0]));
    expect(paths[0]).toBe('/v1/social/me/followers?cursor=opaque-cursor&limit=25');
    expect(paths[1]).toBe('/v1/social/me/following?limit=25');
  });

  it('S12: a list item outside the strict shape is refused', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json({ items: [{ membershipId: ID }], nextCursor: null }),
    );
    await expect(getFollowers()).rejects.toThrow();
  });
});
