import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, getBootstrap } from '@/lib/bootstrap';
import { fetchMessages, type MessageCursor } from '@/lib/chat';
import { chatMessageView, tenantDayKeys } from '@/lib/chat-view';
import { empty, NOTIFICATION_ID_RE, sameOriginGet } from '@/lib/notifications-bff';
import { createClient } from '@/lib/supabase/server';

/**
 * `GET /api/chat/conversations/{id}/messages?afterSeq=N | ?beforeSeq=N` (07-09, D-240, UI-D-261): the
 * thread pane's catch-up (after a `chat.message` signal, on every (re)subscribe and on refocus) and its
 * "Carregar mensagens anteriores". A GET route handler rather than a server action on purpose: Next
 * runs a page's server actions one at a time, and a realtime-triggered refetch must never queue behind
 * a send (RESEARCH anti-pattern; the `/api/me/counters` rule).
 *
 * Gates, each refusal costing ZERO API calls: `sameOriginGet` (403; C-WR-02's fetch-metadata fallback); a verified session
 * (401); a canonical uuid path id (404: the same bare answer the API gives a foreign id, D-23); exactly
 * ONE integer cursor, `afterSeq >= 0` or `beforeSeq >= 1` (400). Then ONE forward through `apiFetch`
 * (the member's own Bearer: 07-08's policies answer another member's thread with a bare 404, T-07-62),
 * re-validated against the chat contract.
 *
 * The answer is FORMATTED here, on the server, in the tenant zone from ONE `Date.now()`:
 * `{ items: ChatMessageView[], hasMore, todayKey, yesterdayKey }`, so the client pane never reads a
 * clock or a catalog (UI-D-14). The viewer (member or staff) comes from `bootstrap.permissions`, never
 * from a role. `no-store` always; logs carry the shape only (status and code, never a body or an id).
 */
export const dynamic = 'force-dynamic';

const SEQ_RE = /^\d{1,10}$/;

function cursorFrom(url: URL): MessageCursor | null {
  const after = url.searchParams.getAll('afterSeq');
  const before = url.searchParams.getAll('beforeSeq');
  if (after.length + before.length !== 1) return null;
  const raw = (after[0] ?? before[0]) as string;
  if (!SEQ_RE.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  if (after.length === 1) return { afterSeq: value };
  return value >= 1 ? { beforeSeq: value } : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  if (!sameOriginGet(request)) return empty(403);

  const { data } = await (await createClient()).auth.getClaims();
  if (!data?.claims) return empty(401);

  const { conversationId } = await params;
  if (!NOTIFICATION_ID_RE.test(conversationId)) return empty(404);
  const cursor = cursorFrom(new URL(request.url));
  if (!cursor) return empty(400);

  try {
    const [bootstrap, t, page] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchMessages(conversationId.toLowerCase(), cursor),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const viewer = bootstrap.permissions.includes(CHAT_PERMISSIONS.answer) ? 'staff' : 'member';
    const keys = tenantDayKeys(Date.now(), timeZone);
    return Response.json(
      {
        items: page.items.map((row) => chatMessageView(row, { timeZone, viewer, t })),
        hasMore: page.hasMore,
        todayKey: keys.todayKey,
        yesterdayKey: keys.yesterdayKey,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const status = error instanceof ApiClientError ? error.status : null;
    console.error('chat.messages_bff_failed', {
      status,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return empty(status !== null && status >= 400 && status < 500 ? status : 502);
  }
}
