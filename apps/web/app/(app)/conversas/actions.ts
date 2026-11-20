'use server';

import {
  directSendInputSchema,
  directVoiceSendInputSchema,
} from '@rede-social/module-chat/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import { postDirectMessage, postDirectVoice } from '@/lib/chat';
import { type ChatMessageView, chatMessageView } from '@/lib/chat-view';
import type { VoiceSendError } from '@/lib/voice-send';

/**
 * The direct conversation's sends (11-22, CHAT-06, D-720, D-722, D-734), in the `suporte/actions.ts`
 * conventions: the SAME strict Zod the API validates with runs BEFORE the request (a server action is a public
 * endpoint), a 401/403 the bootstrap knows becomes a navigation OUTSIDE the try/catch (Next 16: `redirect()`
 * throws; that is why a lost session is never a result code here), and a refusal is answered with ONE closed code, never an API message (T-11-03, T-11-16).
 *
 * The target is a MEMBERSHIP id (public in the directory), never a user id, a conversation id or a side: the
 * author and the tenant come from the session, and the API re-decides everything (the block either way, the
 * module, the other member being live). Nothing here is an authority.
 *
 * The answer carries a FINISHED view, formatted here in the tenant zone, so the client never reads a clock or a
 * catalog to draw the bubble. `conversationId` lets the pane adopt the thread the FIRST message created.
 * `closed` is the API's `direct_closed` (409): the ONE word the screen turns into the neutral sentence and the
 * strip, with no name, no reason and nothing that says who blocked whom.
 *
 * **This module must not re-export anything** (Turbopack drops re-exports from `'use server'`).
 */

/** What a direct text send answers. A refusal is a closed code the pane maps to its own catalog sentence. */
export type SendDirectMessageResult =
  | { ok: true; view: ChatMessageView; conversationId: string; created: boolean }
  | {
      ok: false;
      error: 'closed' | 'invalid' | 'rate_limited' | 'not_found' | 'failed';
    };

const INVALID = { ok: false, error: 'invalid' } as const;

/** The closed code of an API refusal of a direct send; the API re-enforces everything this only names. */
function directErrorOf(error: unknown): Extract<SendDirectMessageResult, { ok: false }>['error'] {
  if (!(error instanceof ApiClientError)) return 'failed';
  if (error.status === 409 && error.details?.chat === 'direct_closed') return 'closed';
  if (error.status === 404) return 'not_found';
  if (error.status === 429) return 'rate_limited';
  if (error.status === 400) return 'invalid';
  return 'failed';
}

/**
 * `POST /v1/chat/direct/messages` (D-720): the member writes to another member. The strict
 * `directSendInputSchema` (a membership uuid and the shared 1 to 2000 code point body, no other key) runs before
 * the request. The bootstrap and the translator are read BEFORE the write, so nothing can fail after the message
 * is stored and report "not sent", which would restore a draft that was already sent.
 */
export async function sendDirectMessage(
  toMembershipId: unknown,
  body: unknown,
): Promise<SendDirectMessageResult> {
  const input = directSendInputSchema.safeParse({ toMembershipId, body });
  if (!input.success) return INVALID;

  let path: string | null = null;
  let result: SendDirectMessageResult = { ok: false, error: 'failed' };
  try {
    const [bootstrap, t] = await Promise.all([getBootstrap(), getTranslations('chat')]);
    const sent = await postDirectMessage(input.data.toMembershipId, input.data.body);
    result = {
      ok: true,
      conversationId: sent.conversationId,
      created: sent.created,
      view: chatMessageView(sent.message, {
        timeZone: bootstrap.tenant.timezone,
        viewer: 'member',
        t,
      }),
    };
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) {
      console.error('chat.direct_send_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
      result = { ok: false, error: directErrorOf(error) };
    }
  }

  if (path) redirect(path);
  return result;
}

/* ── The recording (D-734) ──────────────────────────────────────────────────────────────────────────── */

/**
 * What a direct voice send answers. A refusal is ONE closed word of the upload-and-send orchestration
 * (`lib/voice-send.ts`), the SAME vocabulary the support recordings use, so the pane maps it with the shipped
 * voice sentences: `not_ready` (409 `voice_not_ready`, retriable), `invalid` (a 400, or an input refused here,
 * permanent), `closed` (409 `direct_closed`: the neutral refusal, no word that says why), `not_found` (404),
 * or `retriable` (a 5xx, a 429, a bare 409, the transport). `member_blocked` and `member_removed` are staff
 * words and are never produced here.
 */
export type SendDirectVoiceResult =
  | { ok: true; view: ChatMessageView; conversationId: string; created: boolean }
  | { ok: false; error: VoiceSendError };

/** The closed word of an API refusal of a direct recording; the API re-enforces everything this only names. */
function directVoiceErrorOf(error: unknown): VoiceSendError {
  if (!(error instanceof ApiClientError)) return 'retriable';
  const chat = error.details?.chat;
  if (error.status === 409) {
    if (chat === 'voice_not_ready') return 'not_ready';
    if (chat === 'direct_closed') return 'closed';
    return 'retriable';
  }
  if (error.status === 404) return 'not_found';
  if (error.status === 429 || error.status >= 500) return 'retriable';
  return 'invalid';
}

/**
 * `POST /v1/chat/direct/voice-messages` (D-734): the member's recording to another member. The strict
 * `directVoiceSendInputSchema` (a membership uuid and the id of the asset, no duration, no side, no conversation id)
 * runs BEFORE the request, so a non-uuid or an extra key never leaves the server. The bootstrap and the translator
 * are read BEFORE the write, so nothing can fail after the message is stored and report "not sent". Called once
 * per attempt by `runVoiceSend`, which repeats it while the answer is `not_ready`; the API stores a take once, so a
 * repeat answers the stored message.
 */
export async function sendDirectVoice(
  toMembershipId: unknown,
  mediaId: unknown,
): Promise<SendDirectVoiceResult> {
  const input = directVoiceSendInputSchema.safeParse({ toMembershipId, mediaId });
  if (!input.success) return { ok: false, error: 'invalid' };

  let path: string | null = null;
  let result: SendDirectVoiceResult = { ok: false, error: 'retriable' };
  try {
    const [bootstrap, t] = await Promise.all([getBootstrap(), getTranslations('chat')]);
    const sent = await postDirectVoice(input.data.toMembershipId, input.data.mediaId);
    result = {
      ok: true,
      conversationId: sent.conversationId,
      created: sent.created,
      view: chatMessageView(sent.message, {
        timeZone: bootstrap.tenant.timezone,
        viewer: 'member',
        t,
      }),
    };
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path) {
      console.error('chat.direct_voice_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
      result = { ok: false, error: directVoiceErrorOf(error) };
    }
  }

  if (path) redirect(path);
  return result;
}
