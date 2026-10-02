import type { TenantRole } from '@rede-social/contracts';
import {
  ADMIN_MEMBERS_PAGE_SIZE,
  type AdminMember,
  type AdminMemberPage,
  type AdminMemberStatusFilter,
  adminMemberPageSchema,
  adminMemberSchema,
} from '@rede-social/contracts/moderation';
import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The Membros admin screen's web client (ADMIN-02, MODER-02, UI-D-271..274) — SERVER-ONLY: every call
 * goes through `apiFetch` with the session's Bearer and the tenant host, so the browser never talks to
 * the API and never holds a token. The API decides everything: the tenant is the membership of record,
 * the permissions are `members.manage` / `moderation.manage` (D-338), and the D-332 guards live there.
 * Nothing here is an authority.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body (the `media.ts` helper). */
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
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

export type AdminMembersRequest = {
  q?: string;
  status?: AdminMemberStatusFilter;
  cursor?: string;
};

/** `GET /v1/admin/members` — one keyset page. `cursor` is opaque (forwarded untouched). */
export async function getAdminMembers(query: AdminMembersRequest = {}): Promise<AdminMemberPage> {
  const search = new URLSearchParams();
  if (query.q) search.set('q', query.q);
  if (query.status && query.status !== 'all') search.set('status', query.status);
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(ADMIN_MEMBERS_PAGE_SIZE));

  const res = await apiFetch(`/v1/admin/members?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return adminMemberPageSchema.parse(await res.json());
}

/** `GET /v1/admin/members/{membershipId}` — the sheet's row. A miss is a 404 `ApiClientError`. */
export async function getAdminMember(membershipId: string): Promise<AdminMember> {
  const res = await apiFetch(`/v1/admin/members/${encodeURIComponent(membershipId)}`);
  if (!res.ok) throw await apiError(res);
  return adminMemberSchema.parse(await res.json());
}

/**
 * `POST /v1/admin/members/{membershipId}/block|unblock` with the optional internal reason (D-331).
 * Answers the membership's state after the call; a refusal is an `ApiClientError` whose `details`
 * carries `{ member: 'self' | 'last_admin' | 'not_active' }` on a 409.
 */
export async function postMemberAccess(
  membershipId: string,
  kind: 'block' | 'unblock',
  reason: string | undefined,
): Promise<AdminMember> {
  const res = await apiFetch(`/v1/admin/members/${encodeURIComponent(membershipId)}/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason === undefined ? {} : { reason }),
  });
  if (!res.ok) throw await apiError(res);
  return adminMemberSchema.parse(await res.json());
}

/**
 * `PUT /v1/admin/members/{membershipId}/role` (08-05, D-332). Answers the membership after the
 * change; a refusal is an `ApiClientError` whose `details` carries `{ member: 'self' | 'last_admin' |
 * 'not_active' | 'blocked' }` on a 409.
 */
export async function putMemberRole(membershipId: string, role: TenantRole): Promise<AdminMember> {
  const res = await apiFetch(`/v1/admin/members/${encodeURIComponent(membershipId)}/role`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw await apiError(res);
  return adminMemberSchema.parse(await res.json());
}

/**
 * The page's loader. Session and membership refusals follow the shipped bootstrap mapping (401 →
 * `/entrar`, blocked → the "Acesso suspenso" screen, …). A 403 `FORBIDDEN` means the permission was
 * lost since the bootstrap was read (UI-D-284): the screen answers `notFound()`, exactly as it does
 * for a member who types the URL. Any other failure answers `null`, which the page renders as its
 * first-load error. `redirect` and `notFound` throw, so both sit OUTSIDE the try/catch (Next 16).
 */
export async function loadAdminMembers(
  query: AdminMembersRequest = {},
): Promise<AdminMemberPage | null> {
  let path: string | null = null;
  let forbidden = false;
  let page: AdminMemberPage | null = null;
  try {
    page = await getAdminMembers(query);
  } catch (error) {
    if (error instanceof ApiClientError) {
      path = bootstrapRedirectPath(error);
      forbidden = error.status === 403 && error.code === 'FORBIDDEN';
    }
    // Shape only: a search term is the admin's own words and never reaches a log line.
    if (!path && !forbidden) console.error('admin.members.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  if (forbidden) notFound();
  return page;
}

/**
 * The profile page's admin read (D-340, UI-D-275): the membership in the admin row shape, for the
 * header trigger's sheet. The page calls it ONLY for holders of `members.manage` or
 * `moderation.manage`. Any failure — a permission lost since the bootstrap (403), a membership gone
 * (404), a transport error — answers `null` and the page simply renders no trigger: the profile itself
 * is unaffected, and an admin action's own refusal handling covers the rest (UI-D-284).
 */
export async function loadAdminMemberForProfile(membershipId: string): Promise<AdminMember | null> {
  try {
    return await getAdminMember(membershipId);
  } catch (error) {
    const expected =
      error instanceof ApiClientError && (error.status === 403 || error.status === 404);
    if (!expected) console.error('admin.members.profile_read_failed', { error: String(error) });
    return null;
  }
}
