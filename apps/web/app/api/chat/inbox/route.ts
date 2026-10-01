import { getTranslations } from 'next-intl/server';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { fetchInbox } from '@/lib/chat';
import { inboxRowView, tenantDayKeys } from '@/lib/chat-view';
import { empty, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/inbox` (07-10, CHAT-03, D-240, UI-D-262): the staff inbox's page-1 refetch, run by
 * `SupportInbox` on every `chat.message` / `chat.read` signal on `tenant:<t>:support-inbox`, on every
 * (re)subscribe and on refocus. A GET route handler rather than a server action on purpose: Next runs a
 * page's server actions one at a time, and a realtime-triggered refetch must never queue behind a
 * reply (RESEARCH anti-pattern; the `/api/me/counters` rule). Load-more is the server action.
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403; C-WR-02's fetch-metadata fallback) and a verified
 * session (401). Then ONE forward through `apiFetch` (the caller's own Bearer): the API re-enforces
 * `chat.support` (a member gets its 403 passed through, T-07-66) and answers only this tenant's rows.
 *
 * The answer is FORMATTED here, in the tenant zone from ONE `Date.now()` (UI-D-262: "HH:mm", "Ontem",
 * `dd/MM`), so the client list never reads a clock or a catalog: `{ items: InboxRowView[], nextCursor }`.
 * `no-store` always; logs carry the shape only (status and code, never a preview or an id).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  try {
    const [bootstrap, t, page] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchInbox({ cursor: null }),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const keys = tenantDayKeys(Date.now(), timeZone);
    return Response.json(
      {
        items: page.items.map((row) => inboxRowView(row, { timeZone, keys, t })),
        nextCursor: page.nextCursor,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.inbox_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
