import {
  type FollowResult,
  type FollowState,
  followResultSchema,
  followStateSchema,
  type MemberSocialProfile,
  memberSocialProfileSchema,
  SOCIAL_LIST_PAGE_SIZE,
  type SocialListPage,
  socialListPageSchema,
} from '@rede-social/module-social/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE place the web talks to `/v1/social` (09-10, D-466..D-468, FOLLOW-02..04), in the
 * `lib/feed.ts` style: one `apiFetch`, one `apiError`, the module's own strict schemas parse every
 * answer so the shape the API sends and the shape the screens read cannot drift.
 *
 * Nothing here takes a member id for a LIST: `getFollowers` and `getFollowing` read the session's own
 * rows (D-468), so there is no function, and therefore no route or action, that could ask for someone
 * else's. Every call travels with the caller's session and host (`apiFetch`); the API re-derives the
 * tenant from them and the database re-checks it, so nothing a client hands an action widens a read.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code - every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** `PUT /v1/social/follows/{id}`: idempotent; the answer is the state after the call and the count. */
export async function putFollow(membershipId: string): Promise<FollowResult> {
  const res = await apiFetch(`/v1/social/follows/${encodeURIComponent(membershipId)}`, {
    method: 'PUT',
  });
  if (!res.ok) throw await apiError(res);
  return followResultSchema.parse(await res.json());
}

/** `DELETE /v1/social/follows/{id}`: idempotent as well, so a repeat answers 200 `following: false`. */
export async function deleteFollow(membershipId: string): Promise<FollowResult> {
  const res = await apiFetch(`/v1/social/follows/${encodeURIComponent(membershipId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await apiError(res);
  return followResultSchema.parse(await res.json());
}

/** `POST /v1/social/follows/state`: which of these members does the caller follow (one call per page). */
export async function getFollowState(membershipIds: string[]): Promise<FollowState> {
  const res = await apiFetch('/v1/social/follows/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ membershipIds }),
  });
  if (!res.ok) throw await apiError(res);
  return followStateSchema.parse(await res.json());
}

function listQuery(cursor?: string): string {
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  search.set('limit', String(SOCIAL_LIST_PAGE_SIZE));
  return search.toString();
}

/** `GET /v1/social/me/followers`: the people who follow the caller, newest first. The cursor is opaque. */
export async function getFollowers(cursor?: string): Promise<SocialListPage> {
  const res = await apiFetch(`/v1/social/me/followers?${listQuery(cursor)}`);
  if (!res.ok) throw await apiError(res);
  return socialListPageSchema.parse(await res.json());
}

/** `GET /v1/social/me/following`: the people the caller follows, newest first. The cursor is opaque. */
export async function getFollowing(cursor?: string): Promise<SocialListPage> {
  const res = await apiFetch(`/v1/social/me/following?${listQuery(cursor)}`);
  if (!res.ok) throw await apiError(res);
  return socialListPageSchema.parse(await res.json());
}

/**
 * The outcome of the social profile read: the numbers, "this member is outside the graph" (or the
 * module is off, or the id is not a member's), or an answer we could not get. The last two are
 * DIFFERENT screens on purpose: a failure must never look like a staff profile (UI-D-501).
 */
export type SocialProfileResult =
  | { status: 'ok'; data: MemberSocialProfile }
  | { status: 'not-eligible' }
  | { status: 'error' };

/**
 * `GET /v1/social/members/{id}` (D-467), independent of the base profile read. **Never throws.**
 * The API answers a bare 404 for a staff target, a blocked or removed one, an unknown id and a
 * tenant with `social` off, and a 403 for a viewer outside the graph; all of them are `not-eligible`
 * (a 400 for an id that is not a uuid joins them, as `loadMemberProfile` does). A 5xx, a malformed
 * answer and a network failure are `error`. A refusal of the SESSION (401, blocked, suspended...)
 * becomes a navigation, performed OUTSIDE the try/catch because `redirect()` throws in Next 16.
 */
export async function getSocialProfile(membershipId: string): Promise<SocialProfileResult> {
  let path: string | null = null;
  let result: SocialProfileResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/social/members/${encodeURIComponent(membershipId)}`);
    if (res.ok) {
      result = { status: 'ok', data: memberSocialProfileSchema.parse(await res.json()) };
    } else if (res.status === 404 || res.status === 403 || res.status === 400) {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path) result = { status: 'not-eligible' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path) console.error('social.profile_failed', { status: res.status, code: error.code });
    }
  } catch (error) {
    console.error('social.profile_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}

/**
 * One page of "Seguidores" or "Seguindo", or `null` when the API could not answer - the screen then
 * renders the `members` generic error card with its retry. A refusal the bootstrap map knows becomes
 * a navigation, performed OUTSIDE the try/catch.
 */
async function loadList(
  read: (cursor?: string) => Promise<SocialListPage>,
  cursor?: string,
): Promise<SocialListPage | null> {
  let path: string | null = null;
  let page: SocialListPage | null = null;
  try {
    page = await read(cursor);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('social.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

export function loadFollowers(cursor?: string): Promise<SocialListPage | null> {
  return loadList(getFollowers, cursor);
}

export function loadFollowing(cursor?: string): Promise<SocialListPage | null> {
  return loadList(getFollowing, cursor);
}

/**
 * The follow state of a page of members as an id -> boolean map, or `null` when the batch read
 * failed (the rows then keep an empty `w-24` slot rather than a label that could be wrong, EP-43).
 * One call per page, never one per row. Ids beyond the contract's cap are read in slices.
 */
export async function loadFollowState(
  membershipIds: readonly string[],
): Promise<Record<string, boolean> | null> {
  if (membershipIds.length === 0) return {};
  let path: string | null = null;
  let map: Record<string, boolean> | null = null;
  try {
    const found: Record<string, boolean> = {};
    for (let index = 0; index < membershipIds.length; index += 50) {
      const state = await getFollowState(membershipIds.slice(index, index + 50));
      for (const item of state.items) found[item.membershipId] = item.following;
    }
    map = found;
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('social.state_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return map;
}
