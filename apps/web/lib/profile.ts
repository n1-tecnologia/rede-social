import {
  MEMBERS_PAGE_SIZE,
  type MemberList,
  type MemberProfile,
  memberListSchema,
  memberProfileSchema,
  type OwnProfile,
  ownProfileSchema,
} from '@tria/contracts/profiles';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * `GET /v1/me/profile` (03-02) for the member-facing profile screens, deduplicated per request
 * render (React `cache`) exactly like `getBootstrap` — `/perfil`, `/perfil/editar` and 03-05's nudge
 * all read THIS, so the screen and the shell never disagree about the same row.
 *
 * The payload carries `avatarAssetId` plus the STABLE `/v1/media/{assetId}/w128` path, never a signed
 * Storage URL (R-05/TENANT-04): the tenant check runs on every image fetch and a cached payload can
 * never outlive its URLs.
 */
export const getOwnProfile = cache(async (): Promise<OwnProfile> => {
  const res = await apiFetch('/v1/me/profile');
  if (!res.ok) throw await apiError(res);
  return ownProfileSchema.parse(await res.json());
});

/**
 * The profile a screen renders, or `null`. A refusal `bootstrapRedirectPath` knows (401, blocked,
 * suspended, host mismatch, no membership) becomes a navigation — performed OUTSIDE the try/catch,
 * since `redirect()` throws (Next 16 rule) and a catch would swallow it. Anything else is logged
 * once and answered with `null`, so the screen renders its own "Tentar novamente" empty state
 * (UI-SPEC E1/error) instead of the app-level error page.
 */
export async function loadOwnProfile(): Promise<OwnProfile | null> {
  let path: string | null = null;
  let profile: OwnProfile | null = null;
  try {
    profile = await getOwnProfile();
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('profile.load_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return profile;
}

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
    // A non-JSON body keeps the generic code — every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/** The query `/membros` sends; `cursor` is OPAQUE and is forwarded verbatim (03-03). */
export type MembersQuery = { q?: string; cursor?: string; limit?: number };

/**
 * `GET /v1/members` (03-03) — ONE implementation shared by the `/membros` page and the
 * `loadMoreMembersAction` server action, so the list and its pagination can never disagree about
 * the page size or the tenant the request is scoped to.
 *
 * `limit` defaults to `MEMBERS_PAGE_SIZE` (R-11's 25); the API clamps it anyway. The cursor is
 * passed through untouched: its encoding is an implementation detail of the API and nothing on the
 * web side parses, rebuilds or validates it (T-03-34).
 */
export async function getMembers(query: MembersQuery = {}): Promise<MemberList> {
  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? MEMBERS_PAGE_SIZE));

  const res = await apiFetch(`/v1/members?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return memberListSchema.parse(await res.json());
}

/**
 * One page of the directory, or `null` when the API could not answer — the screen then renders its
 * own "Tentar novamente" empty state (UI-SPEC E4/error) rather than the app-level error page. A
 * refusal `bootstrapRedirectPath` knows becomes a navigation, performed OUTSIDE the try/catch.
 */
export async function loadMembers(query: MembersQuery = {}): Promise<MemberList | null> {
  let path: string | null = null;
  let page: MemberList | null = null;
  try {
    page = await getMembers(query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('members.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

/** The outcome of reading ONE member: the profile, a bare miss, or an answer we could not read. */
export type MemberProfileResult =
  | { status: 'ok'; member: MemberProfile }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * `GET /v1/members/{membershipId}` (03-03). The API answers ONE indistinguishable bare 404 for every
 * miss — unknown id, another tenant's id, invited, blocked, soft-deleted (D-23/TENANT-04) — so this
 * helper collapses them to a single `not-found`, and the screen can render only one 404 for all
 * five. A transport or 5xx failure is `error`, which is a DIFFERENT screen: "Algo deu errado" must
 * never be mistaken for "this person is not in your community".
 */
export async function loadMemberProfile(membershipId: string): Promise<MemberProfileResult> {
  let path: string | null = null;
  let result: MemberProfileResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/members/${encodeURIComponent(membershipId)}`);
    if (res.ok) {
      result = { status: 'ok', member: memberProfileSchema.parse(await res.json()) };
    } else if (res.status === 404) {
      result = { status: 'not-found' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path) console.error('members.read_failed', { status: res.status, code: error.code });
    }
  } catch (error) {
    console.error('members.read_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}
