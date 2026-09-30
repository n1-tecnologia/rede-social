'use server';

import { CHAT_MAX_CURSOR_LENGTH, sendMessageInputSchema } from '@rede-social/module-chat/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { fetchInbox, sendSupportMessage } from '@/lib/chat';
import {
  type ChatMessageView,
  chatMessageView,
  type InboxRowView,
  inboxRowView,
  tenantDayKeys,
} from '@/lib/chat-view';

/**
 * The member thread's send (CHAT-02, UI-D-260), in the `notificacoes/actions.ts` conventions: the SAME
 * Zod the API validates with runs BEFORE the request (a server action is a public endpoint), a 401/403
 * becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()` throws), and a refusal is answered
 * with a catalog KEY rather than pt-BR copy.
 *
 * A send is a user action, so it is a server action (like `CommentInput`'s). The realtime-triggered
 * refetches are NOT here: they are GET route handlers, because Next runs a page's actions one at a time
 * and a catch-up must never queue behind a send (RESEARCH anti-pattern).
 *
 * The answer carries a FINISHED view, formatted here in the tenant zone, so the client never reads a
 * clock or a catalog to draw the bubble. `conversationId` lets the pane adopt the thread the first
 * message created lazily and join its topic.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

export type SendSupportMessageResult =
  | { ok: true; view: ChatMessageView; conversationId: string }
  | { ok: false; error: 'composer.errors.failed' };

const FAILED = { ok: false, error: 'composer.errors.failed' } as const;

export async function sendSupportMessageAction(body: unknown): Promise<SendSupportMessageResult> {
  const input = sendMessageInputSchema.safeParse({ body });
  if (!input.success) return FAILED;

  let path: string | null = null;
  let result: SendSupportMessageResult = FAILED;
  try {
    // Everything the view needs is read BEFORE the write: once the message is stored, nothing may
    // fail and report "not sent", or the restored draft would be sent twice.
    const [bootstrap, t] = await Promise.all([getBootstrap(), getTranslations('chat')]);
    const sent = await sendSupportMessage(input.data.body);
    result = {
      ok: true,
      conversationId: sent.conversationId,
      view: chatMessageView(sent.message, {
        timeZone: bootstrap.tenant.timezone,
        viewer: 'member',
        t,
      }),
    };
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.support_send_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }

  if (path) redirect(path);
  return result;
}

/* ── 07-10: the staff inbox ─────────────────────────────────────────────────────────────────────── */

export type InboxPageResult =
  | { ok: true; items: InboxRowView[]; nextCursor: string | null }
  | { ok: false };

/**
 * The staff inbox's next keyset page (CHAT-03, UI-D-262): what `InfiniteScroll` calls at the
 * sentinel. A user-paced read, so a server action (the paging paradigm); the realtime-triggered page-1
 * refetch is the `GET /api/chat/inbox` route instead. The cursor is opaque and capped at the API's
 * own ceiling before the request; the rows come back formatted in the tenant zone from ONE clock read.
 * A refusal the bootstrap knows becomes a navigation outside the try/catch; anything else is
 * `{ ok: false }` (the list's inline load-more line).
 */
export async function loadMoreInboxAction(cursor: unknown): Promise<InboxPageResult> {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > CHAT_MAX_CURSOR_LENGTH) {
    return { ok: false };
  }
  let path: string | null = null;
  let result: InboxPageResult = { ok: false };
  try {
    const [bootstrap, t, page] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchInbox({ cursor }),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const keys = tenantDayKeys(Date.now(), timeZone);
    result = {
      ok: true,
      items: page.items.map((row) => inboxRowView(row, { timeZone, keys, t })),
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.inbox_page_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);
  return result;
}
