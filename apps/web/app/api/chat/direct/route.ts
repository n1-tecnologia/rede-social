import { CHAT_MAX_CURSOR_LENGTH } from '@rede-social/module-chat/contracts';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { fetchDirectList } from '@/lib/chat';
import { conversationsPageView, tenantDayKeys } from '@/lib/chat-view';
import { empty, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/direct?cursor=` (11-18, CHAT-06, D-719, UI-D-862, UI-D-863): the Conversas list, FINISHED.
 * It is the live refetch of the list: `ConversationsList` runs it on every conversation signal, on every
 * (re)subscribe and on refocus, and the bubble's count follows the same signals. With NO cursor it answers
 * page 1 with the pinned support row; a cursor answers the next page without it. A GET route handler rather
 * than a server action on purpose: Next runs a page's server actions one at a time, and a realtime refetch
 * must never queue behind a send (the `/api/chat/inbox` rule).
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403), a verified session (401) and a
 * cursor within the API's own ceiling (400). Then ONE forward through `apiFetch` (the caller's own Bearer:
 * the API answers only this member's conversations, never a hidden one, and 403/404 when `social` is off,
 * passed through empty). The rows are FORMATTED here, in the tenant zone from ONE `Date.now()`, so the client
 * never computes a preview, a prefix, a count or a time. `no-store` always; logs carry the shape only (status
 * and code, never a preview, a name or an id).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  const cursor = new URL(request.url).searchParams.get('cursor');
  if (cursor !== null && (cursor.length === 0 || cursor.length > CHAT_MAX_CURSOR_LENGTH)) {
    return empty(400);
  }

  try {
    const [bootstrap, t, answer] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchDirectList({ cursor }),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const keys = tenantDayKeys(Date.now(), timeZone);
    return Response.json(
      conversationsPageView(answer, { tenant: bootstrap.tenant.displayName, timeZone, keys, t }),
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.direct_list_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
