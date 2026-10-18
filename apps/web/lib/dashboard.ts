import {
  type MemberActivityAnswer,
  memberActivityAnswerSchema,
  type OwnerOverviewAnswer,
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
  try {
    const res = await apiFetch(path);
    if (res.ok) return { status: 'ok', answer: parse(await res.json()) };
    const error = await readError(res);
    const redirectPath = bootstrapRedirectPath(error);
    if (redirectPath) return { status: 'redirect', path: redirectPath };
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
