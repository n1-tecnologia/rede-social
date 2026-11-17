import { getTranslations } from 'next-intl/server';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { fetchCaseHistory } from '@/lib/chat';
import { caseHistoryView, tenantDayKeys } from '@/lib/chat-view';
import { empty, NOTIFICATION_ID_RE, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/conversations/{id}/case/history` (12.4-20, D-810, UI-D-829): the details sheet's
 * history and the member's earlier cases, loaded lazily when the sheet opens, finished on the server.
 * STAFF only: the API answers a member 403 and this handler passes it through.
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403), a verified session (401), a
 * canonical uuid path id (404). Then ONE forward through `apiFetch` (the caller's own Bearer).
 *
 * The answer is FORMATTED here, in the tenant zone from ONE `Date.now()`: `{ events, earlier,
 * hasMoreEarlier }` with each event as its finished sentence (the actor in the bold part, an actor who
 * left through `history.actorGone`, the automatic close as its own sentence) and time. `no-store`
 * always; logs carry the shape only (status and code, never a name or an id).
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  const { conversationId } = await params;
  if (!NOTIFICATION_ID_RE.test(conversationId)) return empty(404);

  try {
    const [bootstrap, t, history] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchCaseHistory(conversationId.toLowerCase()),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const keys = tenantDayKeys(Date.now(), timeZone);
    return Response.json(caseHistoryView(history, { timeZone, keys, t }), {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.case_history_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
