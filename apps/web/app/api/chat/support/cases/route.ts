import { CHAT_MAX_CURSOR_LENGTH } from '@rede-social/module-chat/contracts';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { fetchMyCases } from '@/lib/chat';
import { myCasesPageView, tenantDayKeys } from '@/lib/chat-view';
import { empty, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/support/cases?cursor=` (12.4-20, D-803, UI-D-821): the member's "Meus chamados" page,
 * finished. It is the pull-to-refresh and the realtime refetch of the list: with NO cursor it answers
 * the whole first page, `{ current, items, total, nextCursor }` (`total` counts the member's closed cases,
 * not the current one), so the refresh replaces "Chamado atual", the list and the section counts; a cursor answers the next page in the same shape (the API sends
 * `current` and `total` on every page). Load-more through a user scroll is `loadMoreMyCasesAction`.
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403), a verified session (401) and a
 * cursor within the API's own ceiling (400). Then ONE forward through `apiFetch` (the caller's own
 * Bearer: the API answers only this member's cases). The cards are FORMATTED here, in the tenant zone
 * from ONE `Date.now()`, from named fields only (a member card has no priority or owner). `no-store`
 * always; logs carry the shape only (status and code, never a subject or an id).
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
    const [bootstrap, t, page] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchMyCases({ cursor }),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const keys = tenantDayKeys(Date.now(), timeZone);
    return Response.json(myCasesPageView(page, { timeZone, keys, t }), {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.my_cases_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
