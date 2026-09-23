import {
  COMMUNITY_MAX_PAGE_SIZE,
  COMMUNITY_PAGE_SIZE,
  type CommunityPage,
  type CommunitySummary,
  type CreateCommunity,
  communityPageSchema,
  communitySummarySchema,
  type UpdateCommunity,
} from '@tria/module-communities/contracts';
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

/** The query the page and the load-more action send; `cursor` is OPAQUE and forwarded verbatim. */
export type CommunityQueryInput = { cursor?: string; limit?: number };

/**
 * `GET /v1/communities` (COMM-02, COMM-03).
 *
 * `limit` defaults to `COMMUNITY_PAGE_SIZE`; the API clamps it anyway. The cursor is passed through
 * untouched: its encoding is an implementation detail of the API, and nothing on the web side
 * parses, rebuilds or validates it.
 */
export async function getCommunities(query: CommunityQueryInput = {}): Promise<CommunityPage> {
  const search = new URLSearchParams();
  if (query.cursor) search.set('cursor', query.cursor);
  search.set('limit', String(query.limit ?? COMMUNITY_PAGE_SIZE));

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
 * Every ACTIVE community of the tenant, for a surface that has to offer ALL of them at once —
 * UI-D-45's "Publicar em" picker today, UI-D-41's pin sheet in 05-08.
 *
 * It walks the SAME keyset `getCommunities` pages (never a second endpoint and never a second
 * cursor), with a hard page ceiling so a tenant with thousands of containers cannot turn opening a
 * composer into an unbounded server-side loop. A tenant past the ceiling gets the first N and the
 * picker stays usable; a scrolling picker with its own pagination is a real screen 05-08 can design
 * when a tenant needs one, not something to half-build here.
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
