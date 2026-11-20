import {
  type ReportItem,
  type ReportListAnswer,
  type ReportListState,
  type ReportResolveAction,
  type ReportResolveAnswer,
  reportListAnswerSchema,
  reportResolveAnswerSchema,
} from '@rede-social/contracts/moderation';
import type { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';
import {
  type ReportRowView,
  type ReportStatePill,
  type ResolveRowsView,
  reportRowView,
  reportStatePill,
  resolveRowsFor,
} from '@/lib/reports-view';

/**
 * The admin report queue's web client (11-18, MODER-05, D-730, D-731, UI-D-873) — SERVER-ONLY: every call
 * goes through `apiFetch` with the session's Bearer and the tenant host, so the browser never talks to the
 * API and never holds a token. The API decides everything (the tenant is the membership of record, the
 * permission is `moderation.manage`); nothing here is an authority.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body (the `moderation.ts` helper). */
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

/**
 * `GET /v1/admin/reports?estado=&cursor=`: one keyset page of the queue, newest first. `estado` is the
 * closed list the page parses with `parseReportEstado` (the default is the open queue); `cursor` is opaque
 * and forwarded as is. The strict list schema (with the optional `community`, `voice` and `ref` keys of
 * Phase 11) parses the answer, so a key the contract does not name is refused. Throws `ApiClientError` on a
 * non-2xx (403 without `moderation.manage`).
 */
export async function fetchReports({
  estado = 'abertas',
  cursor,
}: {
  estado?: ReportListState;
  cursor?: string | null;
}): Promise<ReportListAnswer> {
  const search = new URLSearchParams({ estado });
  if (cursor) search.set('cursor', cursor);
  const res = await apiFetch(`/v1/admin/reports?${search.toString()}`);
  if (!res.ok) throw await apiError(res);
  return reportListAnswerSchema.parse(await res.json());
}

/**
 * `POST /v1/admin/reports/{id}/resolve` (UI-D-874, D-732): one resolution of an open report, through the API's own
 * transaction (the removal or archive, the block, the moderation-log row). `body` is the contract's own shape (the
 * verb, and the optional INTERNAL reason of an author's block). Throws `ApiClientError` on a non-2xx: 409
 * `REPORT_ALREADY_RESOLVED`, 409 `CONFLICT` with `details.report` (`not_removable`, `author_not_member`,
 * `author_unavailable`) or `details.member`, 404, 403.
 */
export async function postReportResolve(
  id: string,
  body: { resolution: ReportResolveAction; reason?: string },
): Promise<ReportResolveAnswer> {
  const res = await apiFetch(`/v1/admin/reports/${id}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
  return reportResolveAnswerSchema.parse(await res.json());
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * One queue row as the screen holds it (UI-D-873, UI-D-874): the finished `ReportRowView`, the resolve rows LEGAL for
 * its subject (never a disabled one), and the state pill each resolution will leave the row reading, so the client
 * updates the row in place without a catalog of its own or a second request. Serializable.
 */
export interface ReportQueueRow extends ReportRowView {
  resolve: ResolveRowsView;
  outcome: Record<ReportResolveAction, ReportStatePill>;
}

/**
 * The finished queue row of an API item. `ts` is the `safety` translator (the subject, the state, the reason and the
 * queue words) and `tm` the `moderation` one (the resolve rows); every member string stays a plain string the screen
 * renders as React text (T-11-16).
 */
export function reportQueueRow(
  item: ReportItem,
  { timeZone, ts, tm }: { timeZone: string; ts: Translator; tm: Translator },
): ReportQueueRow {
  const outcomeOf = (action: ReportResolveAction): ReportStatePill =>
    reportStatePill(
      action === 'dismiss'
        ? 'dismissed'
        : action === 'remove_content'
          ? 'content_removed'
          : 'author_blocked',
      item.subjectType,
      ts,
    );
  return {
    ...reportRowView(item, { timeZone, t: ts }),
    resolve: resolveRowsFor(item, tm),
    outcome: {
      dismiss: outcomeOf('dismiss'),
      remove_content: outcomeOf('remove_content'),
      block_author: outcomeOf('block_author'),
    },
  };
}
