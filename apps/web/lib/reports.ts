import {
  type ReportListAnswer,
  type ReportListState,
  reportListAnswerSchema,
} from '@rede-social/contracts/moderation';
import { apiFetch } from '@/lib/api';
import { ApiClientError } from '@/lib/bootstrap';

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
