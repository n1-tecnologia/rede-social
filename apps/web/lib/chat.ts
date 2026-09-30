import {
  type ConversationDetail,
  conversationDetailSchema,
  type InboxPage,
  inboxPageSchema,
  type MessagePage,
  messagePageSchema,
  type SendResult,
  type SupportThread,
  sendResultSchema,
  supportThreadSchema,
} from '@rede-social/module-chat/contracts';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath } from '@/lib/bootstrap';

/**
 * The ONE support-chat fetch implementation (the `lib/events.ts` rule). The `/suporte` page, its send
 * action and the two BFF routes (catch-up/history GET, read POST) all go through here, so they can
 * never disagree about the path, the cursor or the contract a page is parsed with.
 *
 * The browser never talks to Supabase for chat data: every read goes through `apiFetch` to the Hono
 * API, which re-verifies the token and applies 07-08's participant/staff policies (T-07-62). A signal
 * from Realtime only names ids; the messages always come from here.
 */

/** Reads the envelope's error code without ever throwing on a non-JSON body. */
async function apiError(res: Response): Promise<ApiClientError> {
  let code = 'HTTP_ERROR';
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; details?: Record<string, unknown> };
    };
    if (typeof body?.error?.code === 'string') code = body.error.code;
    details = body?.error?.details;
  } catch {
    // A non-JSON body keeps the generic code.
  }
  return new ApiClientError(res.status, code, details);
}

/** `GET /v1/chat/support` (D-220). Throws `ApiClientError` on a non-2xx answer. */
export async function fetchSupportThread(): Promise<SupportThread> {
  const res = await apiFetch('/v1/chat/support');
  if (!res.ok) throw await apiError(res);
  return supportThreadSchema.parse(await res.json());
}

/**
 * The member's thread for the page, or `null` when the API could not answer (the pane then renders
 * its load error). A refusal `bootstrapRedirectPath` knows becomes a navigation, performed OUTSIDE the
 * try/catch: `redirect()` throws in Next 16 and a catch would swallow it. Logs carry the shape only.
 */
export async function getSupportThread(): Promise<SupportThread | null> {
  let path: string | null = null;
  let thread: SupportThread | null = null;
  try {
    thread = await fetchSupportThread();
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.support_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);
  return thread;
}

/** One cursor at a time (the API refuses both): catch-up after a seq, or history before one. */
export type MessageCursor = { afterSeq: number } | { beforeSeq: number };

/**
 * `GET /v1/chat/conversations/{id}/messages?afterSeq=|beforeSeq=` (D-240), or the LATEST page with
 * `cursor: null` (the staff thread's first render, 07-10). Throws `ApiClientError` on a non-2xx answer
 * (a foreign or unknown id is the API's bare 404).
 */
export async function fetchMessages(
  conversationId: string,
  cursor: MessageCursor | null,
): Promise<MessagePage> {
  const search = new URLSearchParams();
  if (cursor && 'afterSeq' in cursor) search.set('afterSeq', String(cursor.afterSeq));
  else if (cursor) search.set('beforeSeq', String(cursor.beforeSeq));
  const query = search.toString();
  const res = await apiFetch(
    `/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages${query ? `?${query}` : ''}`,
  );
  if (!res.ok) throw await apiError(res);
  return messagePageSchema.parse(await res.json());
}

/** `fetchMessages`, or `null` on any failure (logged by shape). Never navigates. */
export async function getMessages(
  conversationId: string,
  cursor: MessageCursor | null,
): Promise<MessagePage | null> {
  try {
    return await fetchMessages(conversationId, cursor);
  } catch (error) {
    console.error('chat.messages_read_failed', {
      status: error instanceof ApiClientError ? error.status : null,
      code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
    });
    return null;
  }
}

/** `POST /v1/chat/conversations/{id}/read { seq }` (D-237). Throws `ApiClientError` on a non-2xx. */
export async function markConversationRead(conversationId: string, seq: number): Promise<void> {
  const res = await apiFetch(`/v1/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seq }),
  });
  if (!res.ok) throw await apiError(res);
}

/**
 * `POST /v1/chat/support/messages { body }` (CHAT-02): the member's message, creating the
 * conversation lazily on the first one. Throws `ApiClientError` on a non-2xx.
 */
export async function sendSupportMessage(body: string): Promise<SendResult> {
  const res = await apiFetch('/v1/chat/support/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw await apiError(res);
  return sendResultSchema.parse(await res.json());
}

/**
 * `GET /v1/chat/inbox?cursor=` (CHAT-03, 07-10): one keyset page of the staff inbox, latest activity
 * first. `cursor: null` is page 1. Throws `ApiClientError` on a non-2xx (403 without `chat.support`).
 */
export async function fetchInbox({ cursor }: { cursor: string | null }): Promise<InboxPage> {
  const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : '';
  const res = await apiFetch(`/v1/chat/inbox${query}`);
  if (!res.ok) throw await apiError(res);
  return inboxPageSchema.parse(await res.json());
}

/**
 * `fetchInbox` for a server render: the page, or `null` when the API could not answer (the list then
 * renders its first-load error). A refusal `bootstrapRedirectPath` knows becomes a navigation,
 * performed OUTSIDE the try/catch (Next 16: `redirect()` throws). Logs carry the shape only.
 */
export async function getInbox({ cursor }: { cursor: string | null }): Promise<InboxPage | null> {
  let path: string | null = null;
  let page: InboxPage | null = null;
  try {
    page = await fetchInbox({ cursor });
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.inbox_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);
  return page;
}

/** `GET /v1/chat/conversations/{id}` (D-224). Throws `ApiClientError` on a non-2xx. */
export async function fetchConversation(conversationId: string): Promise<ConversationDetail> {
  const res = await apiFetch(`/v1/chat/conversations/${encodeURIComponent(conversationId)}`);
  if (!res.ok) throw await apiError(res);
  return conversationDetailSchema.parse(await res.json());
}

/**
 * The staff thread's conversation, three ways (07-10, D-23): `ok` with the detail; `not-found` for
 * the API's bare 404 (an unknown id, another tenant's, another member's), which the page renders as
 * the ONE not-found screen; `error` for anything else (the pane's load error, never "not found").
 */
export type ConversationResult =
  | { status: 'ok'; detail: ConversationDetail }
  | { status: 'not-found' }
  | { status: 'error' };

export async function getConversation(conversationId: string): Promise<ConversationResult> {
  let path: string | null = null;
  let result: ConversationResult = { status: 'error' };
  try {
    result = { status: 'ok', detail: await fetchConversation(conversationId) };
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 400)) {
      return { status: 'not-found' };
    }
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.conversation_read_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);
  return result;
}

/**
 * `POST /v1/chat/conversations/{id}/messages { body }` (CHAT-03, D-225): any staff member answers any
 * support conversation. Throws `ApiClientError` on a non-2xx: a blocked or departed member is a 409
 * with `details.chat` `member_blocked` / `member_removed`.
 */
export async function replyToConversation(
  conversationId: string,
  body: string,
): Promise<SendResult> {
  const res = await apiFetch(
    `/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) throw await apiError(res);
  return sendResultSchema.parse(await res.json());
}
