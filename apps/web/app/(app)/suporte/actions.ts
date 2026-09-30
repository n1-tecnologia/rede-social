'use server';

import { sendMessageInputSchema } from '@rede-social/module-chat/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { sendSupportMessage } from '@/lib/chat';
import { type ChatMessageView, chatMessageView } from '@/lib/chat-view';

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
