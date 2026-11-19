import { getTranslations } from 'next-intl/server';
import { ApiClientError } from '@/lib/bootstrap';
import { fetchDirectDetail } from '@/lib/chat';
import { directDetailView } from '@/lib/chat-view';
import { empty, NOTIFICATION_ID_RE, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/direct/{conversationId}` (11-18, CHAT-07, D-722, D-723, UI-D-865): the composer area of
 * one direct conversation, FINISHED. The thread pane refetches it on every conversation signal, on every
 * (re)subscribe and on refocus, so the strip follows a block or an unblock while the screen is open without
 * the client ever computing a state. A GET route handler rather than a server action on purpose: Next runs a
 * page's server actions one at a time, and a realtime refetch must never queue behind a send.
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403), a verified session (401) and a
 * canonical uuid path id (404, the bare answer the API gives a foreign id). Then ONE forward through
 * `apiFetch` (the caller's own Bearer): the API answers another member's conversation, a hidden one and
 * every `social`-off call with its one bare 404, passed through empty so the screen shows the single
 * not-found and never says why (T-11-06).
 *
 * The answer is `directDetailView`: the contact, the finished composer state and strip (`closed` is ONE
 * sentence with no name and no reason; no "blocked me" fact exists in it, T-11-03) and the viewer's own
 * positions. `no-store` always; logs carry the shape only (status and code, never an id or a name).
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
      fetchDirectDetail(conversationId.toLowerCase()),
    ]);
    return Response.json(directDetailView(detail, t), {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.direct_detail_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
