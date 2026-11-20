'use server';

import {
  type ReportResolution,
  reportListQuerySchema,
  reportResolveBodySchema,
} from '@rede-social/contracts/moderation';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import {
  fetchReports,
  postReportResolve,
  type ReportQueueRow,
  reportQueueRow,
} from '@/lib/reports';

/**
 * The administrator's report queue actions (MODER-04, MODER-05, D-616, D-732, UI-D-637, UI-D-874), in the
 * `moderacao/actions.ts` conventions:
 *
 * - the SAME Zod the API validates with runs BEFORE the request: a server action is a public endpoint, so a report id
 *   that is not a uuid, a verb outside the three, an unknown `?estado=` or an over-long reason is refused here and
 *   never reaches the API;
 * - the answer is a CLOSED code, never an API message: the screen maps a code to its own catalog sentence, so no
 *   server-controlled string reaches the DOM (T-11-16);
 * - a session or membership refusal that is a navigation (an administrator blocked in another tab) is a
 *   `redirect()` OUTSIDE the try block (Next 16: `redirect()` throws);
 * - logs carry the shape only (status and code): a reported text, a name or a reason never reaches a log line.
 *
 * Nothing here notifies the author, the reporter or the reported member of an outcome (D-732).
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

const reportIdSchema = z.uuid();

export type ReportsPageResult =
  | { ok: true; items: ReportQueueRow[]; nextCursor: string | null }
  | { ok: false; code: 'generic' | 'forbidden' };

/**
 * One keyset page of the queue for the chip's `estado`. `cursor` null asks for page 1 (what a pull to refresh calls);
 * otherwise it is OPAQUE and forwarded untouched. The rows come back FINISHED (pills, bodies, the meta line, the legal
 * resolve rows and the date in the tenant's zone), built by the same function the page uses, so a row from page 7
 * reads exactly like a row from page 1.
 */
export async function loadMoreReportsAction(
  cursor: string | null,
  estado: string | null,
): Promise<ReportsPageResult> {
  if (cursor !== null && typeof cursor !== 'string') return { ok: false, code: 'generic' };
  if (estado !== null && typeof estado !== 'string') return { ok: false, code: 'generic' };
  const query = reportListQuerySchema.safeParse({
    ...(estado === null ? {} : { estado }),
    ...(cursor === null ? {} : { cursor }),
  });
  if (!query.success) return { ok: false, code: 'generic' };

  let refusal: string | null = null;
  let result: ReportsPageResult = { ok: false, code: 'generic' };
  try {
    const [page, bootstrap, ts, tm] = await Promise.all([
      fetchReports({ estado: query.data.estado, cursor: query.data.cursor }),
      getBootstrap(),
      getTranslations('safety'),
      getTranslations('moderation'),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    result = {
      ok: true,
      items: page.items.map((item) => reportQueueRow(item, { timeZone, ts, tm })),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) {
      refusal = bootstrapRedirectPath(error);
      if (!refusal && error.status === 403 && error.code === 'FORBIDDEN') {
        result = { ok: false, code: 'forbidden' };
      }
    }
    if (!refusal && !(result.ok === false && result.code === 'forbidden')) {
      console.error('reports.queue.load_more_failed', { error: String(error) });
    }
  }

  if (refusal) redirect(refusal);
  return result;
}

/** The closed answers of `resolveReport` (the API's 200, 409 variants, 401, 403 and everything else). */
export type ResolveReportCode =
  | 'ok'
  | 'already_resolved'
  | 'not_removable'
  | 'author_unavailable'
  | 'failed'
  | 'unauthenticated';

export type ResolveReportResult =
  | { ok: true; code: 'ok'; status: ReportResolution }
  | { ok: false; code: Exclude<ResolveReportCode, 'ok'> };

/** The code the screen reads for a refused resolve, or `null` for an error that is not an API refusal. */
function codeOf(error: unknown): Exclude<ResolveReportCode, 'ok'> | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 401) return 'unauthenticated';
  if (error.status === 403 && error.code === 'FORBIDDEN') return 'unauthenticated';
  if (error.status === 409) {
    if (error.code === 'REPORT_ALREADY_RESOLVED') return 'already_resolved';
    const report = error.details?.report;
    if (report === 'not_removable') return 'not_removable';
    // A deleted account and a non-member author both leave nothing to block (the API's two refusals).
    if (report === 'author_unavailable' || report === 'author_not_member') {
      return 'author_unavailable';
    }
  }
  return 'failed';
}

/**
 * `POST /v1/admin/reports/{id}/resolve` (UI-D-874): the verb is one of the three the contract names and `reason` is
 * the optional INTERNAL reason of an author's block (it travels for `block_author` only; the two other resolutions
 * carry none by design). Everything else the API decides: whether the verb is legal for the subject (a message is
 * never removed, the API answers `not_removable`), whether the report is still open, whether the author is a member.
 */
export async function resolveReport(
  id: unknown,
  resolution: unknown,
  reason?: unknown,
): Promise<ResolveReportResult> {
  const reportId = reportIdSchema.safeParse(id);
  const body = reportResolveBodySchema.safeParse({
    resolution,
    ...(resolution === 'block_author' && typeof reason === 'string' && reason.trim() !== ''
      ? { reason }
      : {}),
  });
  if (!reportId.success || !body.success) return { ok: false, code: 'failed' };

  let navigate: string | null = null;
  let result: ResolveReportResult = { ok: false, code: 'failed' };
  try {
    const done = await postReportResolve(reportId.data, body.data);
    result = { ok: true, code: 'ok', status: done.status };
  } catch (error) {
    const code = codeOf(error);
    if (code !== null && code !== 'failed') {
      result = { ok: false, code };
    } else {
      if (error instanceof ApiClientError) navigate = bootstrapRedirectPath(error);
      if (!navigate) {
        console.error('reports.queue.resolve_failed', {
          status: error instanceof ApiClientError ? error.status : undefined,
          code: error instanceof ApiClientError ? error.code : undefined,
        });
      }
    }
  }

  if (navigate) redirect(navigate);
  return result;
}
