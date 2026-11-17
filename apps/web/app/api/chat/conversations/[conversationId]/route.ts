import { getTranslations } from 'next-intl/server';
import { ApiClientError } from '@/lib/bootstrap';
import { fetchCaseHeader } from '@/lib/chat';
import { caseHeaderView } from '@/lib/chat-view';
import { empty, NOTIFICATION_ID_RE, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/conversations/{id}` (12.4-20, D-805, UI-D-830): the CASE HEADER of a support
 * conversation, finished, for either side of the thread. The thread pane refetches it on every
 * `chat.message` and `chat.case` signal, on every (re)subscribe and on refocus, so the bar and the
 * strips follow the case without the client ever computing a state. A GET route handler rather than a
 * server action on purpose: Next runs a page's server actions one at a time, and a realtime-triggered
 * refetch must never queue behind a send (the `/api/chat/inbox` rule).
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403), a verified session (401) and a
 * canonical uuid path id (404, the bare answer the API gives a foreign id). Then ONE forward through
 * `apiFetch` (the caller's own Bearer): the API chooses the staff or the member shape, and 07-08's
 * policies answer another member's thread with a bare 404.
 *
 * The answer is `{ viewer, header }`, `header` being `caseHeaderView` of the API's own `viewer`: the
 * member header is built from NAMED fields only, so a priority, an owner or an action list the payload
 * wrongly carried never reaches a member (T-12.4-87). `header` is null for a conversation with no case
 * (the previous API). `no-store` always; logs carry the shape only (status and code, never an id).
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
    const [t, detail] = await Promise.all([
      getTranslations('chat'),
      fetchCaseHeader(conversationId.toLowerCase()),
    ]);
    return Response.json(
      {
        viewer: detail.viewer,
        header: detail.case ? caseHeaderView(detail.case, { viewer: detail.viewer, t }) : null,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.case_header_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
