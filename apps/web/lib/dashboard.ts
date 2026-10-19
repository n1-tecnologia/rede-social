import {
  type EngagementBandId,
  type MemberActivityAnswer,
  memberActivityAnswerSchema,
  type OwnerBandListAnswer,
  type OwnerBandScopeId,
  type OwnerContentAnswer,
  type OwnerContentDetailAnswer,
  type OwnerContentInteractionsAnswer,
  type OwnerContentPeopleAnswer,
  type OwnerContentPeopleId,
  type OwnerContentUnansweredAnswer,
  type OwnerEventsAnswer,
  type OwnerFinanceAnswer,
  type OwnerMemberDetailAnswer,
  type OwnerMemberListAnswer,
  type OwnerMemberListId,
  type OwnerMembersAnswer,
  type OwnerOverviewAnswer,
  ownerBandListAnswerSchema,
  ownerContentAnswerSchema,
  ownerContentDetailAnswerSchema,
  ownerContentInteractionsAnswerSchema,
  ownerContentPeopleAnswerSchema,
  ownerContentUnansweredAnswerSchema,
  ownerEventsAnswerSchema,
  ownerFinanceAnswerSchema,
  ownerMemberDetailAnswerSchema,
  ownerMemberListAnswerSchema,
  ownerMembersAnswerSchema,
  ownerOverviewAnswerSchema,
} from '@rede-social/module-dashboard/contracts';
import { cache } from 'react';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The owner panel's snapshot reads (08.7-01, D-464): the `/v1/dashboard/owner/*` answers, parsed
 * with the dashboard's strict contracts so a drifted shape fails HERE and never half-renders a card.
 *
 * Each read answers a result union and NEVER throws (the `learnRead` mapping of `lib/courses-learn.ts`):
 * `ok` with the parsed answer (which may itself be `{ state: 'preparing' }`), `redirect` for a refusal
 * the bootstrap knows (401, blocked, suspended…; the CALLER navigates, because `redirect()` throws),
 * and `error` for anything else — a 5xx, a transport error, a body that fails the contract — which
 * the area shows as its own error card, never `app/error.tsx` (UI-D-479). Each is React `cache`d, so
 * one render costs one request. Logs carry the failure SHAPE only (a status and a code, or the
 * error's name), never a number of the tenant's business.
 */

export type DashboardReadResult<T> =
  | { status: 'ok'; answer: T }
  | { status: 'redirect'; path: string }
  | { status: 'error' };

/**
 * A read whose path names an id (a member, a community or an event scope, 08.7-05): a 404 is its own
 * result, `notFound`, so the view falls one level up (D-06) instead of showing an error card. The API
 * answers the same bare 404 for an unknown, other-tenant or staff id (EP-17) and `MODULE_DISABLED`
 * for a scope whose module is off; both read as `notFound`.
 */
export type DashboardIdReadResult<T> = DashboardReadResult<T> | { status: 'notFound' };

/**
 * A read of a module-gated area (08.7-08, D-460): the API answers 404 `MODULE_DISABLED` when the
 * tenant does not have the area's module, which is its own result, `disabled`, rendered as nothing
 * (the area's tab and its `?area=` fallback are the panel's concern). Any other 404 is an error.
 */
export type DashboardModuleReadResult<T> = DashboardReadResult<T> | { status: 'disabled' };

/** Reads the envelope's error code (and details) without ever throwing on a non-JSON body. */
async function readError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    if (body?.error?.details && typeof body.error.details === 'object') {
      details = body.error.details;
    }
  } catch {
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

/** The shared mapping of one dashboard read's answer; `op` names the log line. */
async function dashboardRead<T>(
  path: string,
  parse: (body: unknown) => T,
  op: string,
): Promise<DashboardReadResult<T>> {
  const result = await dashboardIdRead(path, parse, op, false);
  return result.status === 'notFound' ? { status: 'error' } : result;
}

/** `dashboardRead` for a path that names an id: a 404 answers `notFound` when `notFound` is set. */
async function dashboardIdRead<T>(
  path: string,
  parse: (body: unknown) => T,
  op: string,
  notFound = true,
): Promise<DashboardIdReadResult<T>> {
  try {
    const res = await apiFetch(path);
    if (res.ok) return { status: 'ok', answer: parse(await res.json()) };
    const error = await readError(res);
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    if (notFound && res.status === 404) return { status: 'notFound' };
    console.error(op, { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error(op, { name: error instanceof Error ? error.name : typeof error });
    return { status: 'error' };
  }
}

/** `dashboardRead` for a module-gated area: 404 `MODULE_DISABLED` answers `disabled`. */
async function dashboardModuleRead<T>(
  path: string,
  parse: (body: unknown) => T,
  op: string,
): Promise<DashboardModuleReadResult<T>> {
  try {
    const res = await apiFetch(path);
    if (res.ok) return { status: 'ok', answer: parse(await res.json()) };
    const error = await readError(res);
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
    if (res.status === 404 && error.code === 'MODULE_DISABLED') return { status: 'disabled' };
    console.error(op, { status: res.status, code: error.code });
    return { status: 'error' };
  } catch (error) {
    console.error(op, { name: error instanceof Error ? error.name : typeof error });
    return { status: 'error' };
  }
}

/**
 * `GET /v1/dashboard/owner/overview` (08.7-01, INSIGHT-07): the Visão geral of the tenant's newest
 * snapshot — `{ state: 'preparing' }` before the first build, else the snapshot meta and the members
 * numbers as raw integers (the web derives the chip with `changeDelta`).
 */
export const getOwnerOverview = cache(
  (): Promise<DashboardReadResult<OwnerOverviewAnswer>> =>
    dashboardRead(
      '/v1/dashboard/owner/overview',
      (body) => ownerOverviewAnswerSchema.parse(body),
      'dashboard.owner_overview_failed',
    ),
);

/**
 * `GET /v1/dashboard/activity` (08.7-03, D-463, INSIGHT-01..05): the member's OWN "Sua atividade" —
 * `{ state: 'preparing' }` before their first build, else their numbers of the last 7 complete days
 * with the "Em breve" metrics as `{ measured: false }`. The route takes no parameter. Never throws.
 */
export const getMemberActivity = cache(
  (): Promise<DashboardReadResult<MemberActivityAnswer>> =>
    dashboardRead(
      '/v1/dashboard/activity',
      (body) => memberActivityAnswerSchema.parse(body),
      'dashboard.member_activity_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/members` (08.7-02, INSIGHT-08): Membros of the newest snapshot — growth,
 * the six bands, movement, retention, the at-risk push reach and, while their modules are on, the
 * community and event bands with their LIVE labels. Never throws.
 */
export const getOwnerMembers = cache(
  (): Promise<DashboardReadResult<OwnerMembersAnswer>> =>
    dashboardRead(
      '/v1/dashboard/owner/members',
      (body) => ownerMembersAnswerSchema.parse(body),
      'dashboard.owner_members_failed',
    ),
);

/** A query string of the defined values only, in a stable order (one cache key per page). */
function queryOf(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

const readBandMembers = cache(
  (
    band: EngagementBandId,
    scope: OwnerBandScopeId,
    scopeId: string | undefined,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<DashboardIdReadResult<OwnerBandListAnswer>> =>
    dashboardIdRead(
      `/v1/dashboard/owner/members/bands/${band}${queryOf({ scope, scopeId, cursor, limit })}`,
      (body) => ownerBandListAnswerSchema.parse(body),
      'dashboard.owner_band_members_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/members/bands/{band}` (08.7-04, D-461): one page of a band's members in
 * the whole base, a community or an event's RSVPs. `notFound` for a foreign or unknown `scopeId` and
 * for a scope whose module is off. Never throws; one request per page per render.
 */
export function getOwnerBandMembers(input: {
  band: EngagementBandId;
  scope: OwnerBandScopeId;
  scopeId?: string;
  cursor?: string;
  limit?: number;
}): Promise<DashboardIdReadResult<OwnerBandListAnswer>> {
  return readBandMembers(input.band, input.scope, input.scopeId, input.cursor, input.limit);
}

/**
 * `GET /v1/dashboard/owner/members/{membershipId}` (08.7-04, D-461): one member's detail. `notFound`
 * for an unknown, other-tenant or staff id (EP-17), so the view falls back to the band list.
 */
export const getOwnerMemberDetail = cache(
  (membershipId: string): Promise<DashboardIdReadResult<OwnerMemberDetailAnswer>> =>
    dashboardIdRead(
      `/v1/dashboard/owner/members/${membershipId}`,
      (body) => ownerMemberDetailAnswerSchema.parse(body),
      'dashboard.owner_member_detail_failed',
    ),
);

const readMemberList = cache(
  (
    membershipId: string,
    list: OwnerMemberListId,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<DashboardIdReadResult<OwnerMemberListAnswer>> =>
    dashboardIdRead(
      `/v1/dashboard/owner/members/${membershipId}/lists/${list}${queryOf({ cursor, limit })}`,
      (body) => ownerMemberListAnswerSchema.parse(body),
      'dashboard.owner_member_list_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/members/{membershipId}/lists/{list}` (08.7-04): one page of the rows
 * behind one of a member's numbers, inside the snapshot's 30 days. `notFound` as the detail.
 */
export function getOwnerMemberList(
  membershipId: string,
  list: OwnerMemberListId,
  page: { cursor?: string; limit?: number } = {},
): Promise<DashboardIdReadResult<OwnerMemberListAnswer>> {
  return readMemberList(membershipId, list, page.cursor, page.limit);
}

/**
 * `GET /v1/dashboard/owner/content` (08.7-06/07, INSIGHT-10): Conteúdo of the newest snapshot — the
 * window's publications with their live labels, the kinds, the posts-only KPIs, trend, heatmap and
 * per-community numbers while `feed` is on. `MODULE_DISABLED` (feed and stories both off) is an
 * error here: the area is not reachable then. Never throws.
 */
export const getOwnerContent = cache(
  (): Promise<DashboardReadResult<OwnerContentAnswer>> =>
    dashboardRead(
      '/v1/dashboard/owner/content',
      (body) => ownerContentAnswerSchema.parse(body),
      'dashboard.owner_content_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/events` (08.7-08, INSIGHT-11): Eventos of the newest snapshot — the next
 * events, the window's past events with check-ins and walk-ins, the totals and the presences by
 * band, titles and covers read live, ticket and waiting list not measured. `disabled` when the
 * tenant does not have `events` (D-460). Never throws.
 */
export const getOwnerEvents = cache(
  (): Promise<DashboardModuleReadResult<OwnerEventsAnswer>> =>
    dashboardModuleRead(
      '/v1/dashboard/owner/events',
      (body) => ownerEventsAnswerSchema.parse(body),
      'dashboard.owner_events_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/finance` (08.7-09/10, INSIGHT-12): Financeiro of the newest snapshot — the
 * window's primary and secondary revenue, revoked orders, revenue by product and by today's band, the
 * 12 + 12 weekly trend, the purchase ladder, never-again, the stalled products, the VIP and the
 * sales associated with a publication or an event, every group of 1-4 people as
 * `{ belowFloor: true }` (D-462). `disabled` when the tenant does not have `store` (D-460). Never
 * throws.
 */
export const getOwnerFinance = cache(
  (): Promise<DashboardModuleReadResult<OwnerFinanceAnswer>> =>
    dashboardModuleRead(
      '/v1/dashboard/owner/finance',
      (body) => ownerFinanceAnswerSchema.parse(body),
      'dashboard.owner_finance_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/content/items/{itemId}` (08.7-06): one publication's detail with its
 * 48-hour curve and its floored associations. `notFound` for an unknown, other-tenant, deleted or
 * out-of-window id, so the view falls back to the list it came from (D-06).
 */
export const getOwnerContentDetail = cache(
  (itemId: string): Promise<DashboardIdReadResult<OwnerContentDetailAnswer>> =>
    dashboardIdRead(
      `/v1/dashboard/owner/content/items/${itemId}`,
      (body) => ownerContentDetailAnswerSchema.parse(body),
      'dashboard.owner_content_detail_failed',
    ),
);

const readContentPeople = cache(
  (
    itemId: string,
    who: OwnerContentPeopleId,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<DashboardIdReadResult<OwnerContentPeopleAnswer>> =>
    dashboardIdRead(
      `/v1/dashboard/owner/content/items/${itemId}/people/${who}${queryOf({ cursor, limit })}`,
      (body) => ownerContentPeopleAnswerSchema.parse(body),
      'dashboard.owner_content_people_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/content/items/{itemId}/people/{who}` (08.7-06): one page of who liked or
 * who commented a publication (members only, never a comment's text). `notFound` as the detail.
 */
export function getOwnerContentPeople(
  itemId: string,
  who: OwnerContentPeopleId,
  page: { cursor?: string; limit?: number } = {},
): Promise<DashboardIdReadResult<OwnerContentPeopleAnswer>> {
  return readContentPeople(itemId, who, page.cursor, page.limit);
}

const readContentInteractions = cache(
  (
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<DashboardReadResult<OwnerContentInteractionsAnswer>> =>
    dashboardRead(
      `/v1/dashboard/owner/content/interactions${queryOf({ cursor, limit })}`,
      (body) => ownerContentInteractionsAnswerSchema.parse(body),
      'dashboard.owner_content_interactions_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/content/interactions` (08.7-06): one page of the member likes and
 * comments behind the interactions number, most recent first. Never throws.
 */
export function getOwnerContentInteractions(
  page: { cursor?: string; limit?: number } = {},
): Promise<DashboardReadResult<OwnerContentInteractionsAnswer>> {
  return readContentInteractions(page.cursor, page.limit);
}

const readContentUnanswered = cache(
  (
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<DashboardReadResult<OwnerContentUnansweredAnswer>> =>
    dashboardRead(
      `/v1/dashboard/owner/content/unanswered${queryOf({ cursor, limit })}`,
      (body) => ownerContentUnansweredAnswerSchema.parse(body),
      'dashboard.owner_content_unanswered_failed',
    ),
);

/**
 * `GET /v1/dashboard/owner/content/unanswered` (08.7-06, P4): one page of the root member comments
 * waiting more than 24 hours for the team, oldest first, with their excerpt (admin only). Read live.
 */
export function getOwnerContentUnanswered(
  page: { cursor?: string; limit?: number } = {},
): Promise<DashboardReadResult<OwnerContentUnansweredAnswer>> {
  return readContentUnanswered(page.cursor, page.limit);
}
