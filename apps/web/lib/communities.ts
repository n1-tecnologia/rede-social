import {
  COMMUNITY_MAX_ORDER,
  COMMUNITY_MAX_PAGE_SIZE,
  COMMUNITY_PAGE_SIZE,
  type CommunityPage,
  type CommunityStatus,
  type CommunitySummary,
  type CreateCommunity,
  communityPageSchema,
  communitySummarySchema,
  type ReorderCommunities,
  type UpdateCommunity,
} from '@rede-social/module-communities/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE communities fetch implementation (the `getMembers`/`getFeed` rule, D-58, Pitfall 9). The
 * `/comunidades` RSC page and its load-more server action both read THIS, so the page and its
 * pagination can never disagree about the page size or the tenant the request is scoped to.
 *
 * The browser never talks to Supabase for community data: every read goes through `apiFetch` to the
 * Hono API, which re-verifies the token and re-reads the membership row on every request.
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
    // A non-JSON body keeps the generic code — every caller's refusal handling is the same.
  }
  return new ApiClientError(res.status, code, details);
}

/**
 * The query the page and the load-more action send; `cursor` is OPAQUE and forwarded verbatim.
 * `status` selects the `Arquivadas` list (05.1, D-88); absent or `active` is today's list.
 */
export type CommunityQueryInput = { cursor?: string; limit?: number; status?: CommunityStatus };

/**
 * `GET /v1/communities` (COMM-02, COMM-03).
 *
 * `limit` defaults to `COMMUNITY_PAGE_SIZE`; the API clamps it anyway. `status` is sent only for the
 * archived list (05.1). The cursor is passed through
 * untouched: its encoding is an implementation detail of the API, and nothing on the web side
 * parses, rebuilds or validates it.
 */
export async function getCommunities(query: CommunityQueryInput = {}): Promise<CommunityPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? COMMUNITY_PAGE_SIZE));
  // Only the archived list names a status, so the active request stays exactly today's string. The
  // API refuses `archived` to a non-manager (D-89); the page asks for it only for a manager.
  if (query.status === 'archived') search.set('status', 'archived');

  const res = await apiFetch(`/v1/communities?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return communityPageSchema.parse(await res.json());
}

/**
 * One page of communities, or `null` when the API could not answer — the list then renders its own
 * error card (UI-SPEC E10/error) rather than taking the whole tab down. A refusal
 * `bootstrapRedirectPath` knows (401, blocked, suspended, host mismatch, no membership) becomes a
 * navigation, performed OUTSIDE the try/catch: `redirect()` throws in Next 16 and a catch would
 * swallow it.
 *
 * A 404 `MODULE_DISABLED` also lands here as `null`. It cannot normally happen — a module without an
 * enabled flag never reaches `bootstrap.modules`, so its tab never renders — but a direct visit
 * during a flag flip must degrade to the error card, not to a crash.
 */
export async function loadCommunities(
  query: CommunityQueryInput = {},
): Promise<CommunityPage | null> {
  let path: string | null = null;
  let page: CommunityPage | null = null;
  try {
    page = await getCommunities(query);
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) console.error('communities.list_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return page;
}

/**
 * What the "Criar comunidade" entry looks like for a viewer (10-13, UI-D-706, D-710).
 *
 *  - `control`: the brand control shows (an admin always; a member under the limit);
 *  - `notice`: the member is AT the limit with a limit above 0, so the control is absent and the
 *    notice replaces it;
 *  - `none`: nothing (not a creator, or limit 0: creation is not offered in this tenant).
 *
 * The inputs are the COMPOSED permissions the bootstrap carries (`communities.community.manage` for
 * the organization, `communities.community.create` for a member, which the API composes only while
 * `social` and `communities` are effective) and the quota the list read carries for the caller: never
 * a role comparison, so granting a permission to another role changes the entry with no web edit.
 * A creator whose quota did not arrive (the read failed) still gets the control: the API's
 * `limit_reached` and `403` are the real controls, this is UX.
 */
export type CommunityEntry = 'control' | 'notice' | 'none';

export function communityEntryState(input: {
  canManage: boolean;
  canCreate: boolean;
  memberQuota: CommunityPage['memberQuota'] | undefined;
}): CommunityEntry {
  if (input.canManage) return 'control';
  if (!input.canCreate) return 'none';
  const quota = input.memberQuota;
  if (!quota) return 'control';
  if (quota.limit <= 0) return 'none';
  return quota.ownedActive >= quota.limit ? 'notice' : 'control';
}

/**
 * Every ACTIVE community of the tenant, for a surface that has to offer ALL of them at once —
 * UI-D-45's "Publicar em" picker today, UI-D-41's pin sheet in 05-08.
 *
 * It walks the SAME keyset `getCommunities` pages (never a second endpoint and never a second
 * cursor), with a hard page ceiling so a tenant with thousands of containers cannot turn opening a
 * composer into an unbounded server-side loop. A tenant past the ceiling gets the first N and the
 * picker stays usable; a scrolling picker with its own pagination is a real screen 05-08 can design
 * when a tenant needs one, not something to half-build here. Because it is the same keyset, the
 * picker offers the communities in the order an admin chose for the list (2026-10-03) with no code
 * of its own.
 *
 * It NEVER throws and never redirects: an unreadable list returns `[]`, the picker then offers only
 * "Feed principal", and the composer still publishes. Losing the destination chooser must not cost
 * the admin the post.
 */
const PICKER_MAX_PAGES = 10;

export async function listAllCommunities(): Promise<CommunitySummary[]> {
  const items: CommunitySummary[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < PICKER_MAX_PAGES; page += 1) {
      const result = await getCommunities({ cursor, limit: COMMUNITY_MAX_PAGE_SIZE });
      items.push(...result.items);
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
  } catch (error) {
    // Shape only: a community NAME is member-facing content and never reaches a log line (T-05-06).
    console.error('communities.picker_failed', { error: String(error), loaded: items.length });
  }
  return items;
}

/**
 * How many pages the reorder walk may read: enough to hold `COMMUNITY_MAX_ORDER` communities, plus
 * the one page that proves there are more than that.
 */
const ORDER_MAX_PAGES = Math.ceil(COMMUNITY_MAX_ORDER / COMMUNITY_MAX_PAGE_SIZE) + 1;

/**
 * EVERY active ORGANIZATION community of the tenant, in the list's order, for the `Comunidades` reorder
 * mode (2026-10-03) — or `null` when the tenant holds more than `COMMUNITY_MAX_ORDER`.
 *
 * **10-13 (UI-D-708, D-712): organization communities only.** The list now carries member-created
 * communities after the organization's, but the admin's order is one permutation of the ORGANIZATION
 * set (the API answers `order_stale` for a member id). Member rows come after every organization row,
 * so the walk stops at the first one, keeps only the organization rows and never counts a member row
 * against the bound.
 *
 * The same keyset walk `listAllCommunities` does, with the opposite failure posture, on purpose:
 * that one degrades to "whatever loaded" because a picker with fewer rows still publishes, but a
 * reorder is ONE permutation of the whole set — a partial list could never be saved (the API
 * answers `order_stale` for a set that is not exactly the current one) and would loop the admin
 * through refusals. So this one THROWS on a failed page and says `null` past the bound, and the
 * caller tells the admin which of the two happened.
 */
export async function getOrderableCommunities(): Promise<CommunitySummary[] | null> {
  const items: CommunitySummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < ORDER_MAX_PAGES; page += 1) {
    const result = await getCommunities({ cursor, limit: COMMUNITY_MAX_PAGE_SIZE });
    const organization = result.items.filter((item) => item.kind !== 'member');
    items.push(...organization);
    if (items.length > COMMUNITY_MAX_ORDER) return null;
    // A member row ends the organization rows (D-712): nothing after it can be one.
    if (organization.length < result.items.length) return items;
    if (result.nextCursor === null) return items;
    cursor = result.nextCursor;
  }
  // Only reachable if pages kept arriving under the bound with a cursor after each — which the
  // over-fetch rule (`nextCursor` exactly when another row exists) rules out. Treated as too many
  // rather than as a complete list, because a list that might be partial must not be saved.
  return null;
}

/**
 * `PUT /v1/communities/order` (2026-10-03) — the admin's order of the ACTIVE list, as one full
 * permutation of ids, through the SAME `apiFetch` every other call here uses. The body is validated
 * by `reorderCommunitiesSchema` in the action; the API re-validates it, and answers the FIRST PAGE
 * of the list in the new order, which the list renders without a second request. A set that is not
 * exactly the current one is `409 { community: 'order_stale' }`, thrown as an `ApiClientError` like
 * every other refusal.
 */
export async function reorderCommunities(input: ReorderCommunities): Promise<CommunityPage> {
  const res = await apiFetch('/v1/communities/order', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return communityPageSchema.parse(await res.json());
}

/** The outcome of reading ONE community: the community, a bare miss, or an answer we could not read. */
export type CommunityResult =
  | { status: 'ok'; community: CommunitySummary }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * `GET /v1/communities/{communityId}` (COMM-03).
 *
 * The API answers ONE indistinguishable bare 404 for every miss — unknown id, another tenant's,
 * soft-deleted (D-23/T-05-02) — and a 400 for an id that is not a uuid at all. This helper collapses
 * ALL of them to a single `not-found`, so the screen renders one "Comunidade não encontrada" for
 * every reason a member can fail to reach one.
 *
 * A transport or 5xx failure is `error`, which is a DIFFERENT screen: "Algo deu errado" must never
 * be mistaken for "this community is not in your organisation", nor the other way round.
 */
export async function loadCommunity(communityId: string): Promise<CommunityResult> {
  let path: string | null = null;
  let result: CommunityResult = { status: 'error' };
  try {
    const res = await apiFetch(`/v1/communities/${encodeURIComponent(communityId)}`);
    if (res.ok) {
      result = { status: 'ok', community: communitySummarySchema.parse(await res.json()) };
    } else if (res.status === 404 || res.status === 400) {
      result = { status: 'not-found' };
    } else {
      const error = await apiError(res);
      path = bootstrapRedirectPath(error);
      if (!path) console.error('communities.read_failed', { status: res.status, code: error.code });
    }
  } catch (error) {
    console.error('communities.read_failed', { error: String(error) });
  }

  if (path) redirect(path);
  return result;
}

/**
 * `POST /v1/communities` (COMM-01) — through the SAME `apiFetch` every read above uses, so the
 * create form cannot drift on the tenant header or on how a refusal is read. The body is validated
 * by `createCommunitySchema` in the action; the API re-validates it independently.
 */
export async function createCommunity(input: CreateCommunity): Promise<CommunitySummary> {
  const res = await apiFetch('/v1/communities', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return communitySummarySchema.parse(await res.json());
}

/**
 * `PATCH /v1/communities/{communityId}` (COMM-01) — the edit, the archive and the reactivate, all
 * three through the SAME `apiFetch` every read above uses, so no write path can drift on the tenant
 * header or on how a refusal is read.
 *
 * There is deliberately no `archiveCommunity`/`reactivateCommunity` here: archive is a `status`
 * write on this endpoint (05-04), and a second function would be a second place to keep in step.
 */
export async function updateCommunity(
  communityId: string,
  input: UpdateCommunity,
): Promise<CommunitySummary> {
  const res = await apiFetch(`/v1/communities/${encodeURIComponent(communityId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return communitySummarySchema.parse(await res.json());
}

/**
 * `DELETE /v1/communities/{communityId}` (PEND-07, D-553): the soft delete of an ARCHIVED community,
 * for whoever may manage communities. The answer is `204` with no body, so there is nothing to parse.
 * A refusal throws the `ApiClientError` the other writes throw: a bare 404 (gone or another tenant's),
 * or a `409` whose `details.community` is `not_archived` or `unlock_active` (D-554: the second carries
 * the Loja products that still unlock it).
 */
export async function deleteCommunity(communityId: string): Promise<void> {
  const res = await apiFetch(`/v1/communities/${encodeURIComponent(communityId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await apiError(res);
}
