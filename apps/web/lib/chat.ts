import {
  type CaseActionInput,
  type CaseAssignInput,
  type CaseEditInput,
  type CaseHistory,
  type CaseResult,
  CHAT_CASE_PRIORITIES,
  CHAT_INBOX_TABS,
  type ChatCaseCategory,
  type ChatCasePriority,
  type ChatInboxTab,
  type ConversationDetail,
  caseHistorySchema,
  caseResultSchema,
  conversationDetailSchema,
  type DirectDetail,
  type DirectListAnswer,
  type DirectSendResult,
  type DirectWithAnswer,
  directDetailSchema,
  directListAnswerSchema,
  directSendResultSchema,
  directWithAnswerSchema,
  type InboxPage,
  inboxPageSchema,
  type MessagePage,
  type MyCasesPage,
  messagePageSchema,
  myCasesPageSchema,
  type SendResult,
  type StaffRoster,
  type SupportThread,
  sendResultSchema,
  staffRosterSchema,
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
export async function sendSupportMessage(
  body: string,
  opening: { category?: ChatCaseCategory; subject?: string } = {},
): Promise<SendResult> {
  // 12.4 (D-811): the category and the subject ride only when the member chose them, so a plain
  // message still goes out as the shipped `{ body }`. The API writes them only when the message opens
  // a case; on a later message they are ignored.
  const payload: Record<string, string> = { body };
  if (opening.category !== undefined) payload.category = opening.category;
  if (opening.subject !== undefined) payload.subject = opening.subject;
  const res = await apiFetch('/v1/chat/support/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiError(res);
  return sendResultSchema.parse(await res.json());
}

/**
 * `POST /v1/chat/support/voice-messages { mediaId, category?, subject? }` (12.5, D-866, VOICE-18): the
 * member's recording, by the id of the asset they uploaded and completed. The opener pair rides only
 * when chosen, exactly as in {@link sendSupportMessage}. The API answers a recording still being
 * normalized with a 409 `voice_not_ready` (retriable) and an unusable one with ONE 400 `voice_invalid`;
 * a take is stored once, so the same send repeated answers the stored message. Throws `ApiClientError`
 * on a non-2xx.
 */
export async function sendSupportVoice(
  mediaId: string,
  opening: { category?: ChatCaseCategory; subject?: string } = {},
): Promise<SendResult> {
  const payload: Record<string, string> = { mediaId };
  if (opening.category !== undefined) payload.category = opening.category;
  if (opening.subject !== undefined) payload.subject = opening.subject;
  const res = await apiFetch('/v1/chat/support/voice-messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await apiError(res);
  return sendResultSchema.parse(await res.json());
}

/**
 * The inbox filters in the API's own vocabulary (12.4, D-805): `tab` open, resolved or closed, `owner`
 * me, none or a uuid, `priority` low, normal or high, `awaiting` the "so quem espera" toggle. Every key
 * is optional: an absent one is the API's default.
 */
export interface InboxFilters {
  tab?: ChatInboxTab;
  owner?: string;
  priority?: ChatCasePriority;
  awaiting?: boolean;
}

const FILTER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UNTRUSTED filter values (a query string or a server-action argument) as the closed {@link InboxFilters}:
 * a value outside its enum is DROPPED (never forwarded, never defaulted here), so the API only ever sees
 * what it documents. Pure; the ONE validator the inbox handler and the load-more action share.
 */
export function parseInboxFilters(raw: {
  tab?: unknown;
  owner?: unknown;
  priority?: unknown;
  awaiting?: unknown;
}): InboxFilters {
  const filters: InboxFilters = {};
  if (typeof raw.tab === 'string' && (CHAT_INBOX_TABS as readonly string[]).includes(raw.tab)) {
    filters.tab = raw.tab as ChatInboxTab;
  }
  if (typeof raw.owner === 'string') {
    if (raw.owner === 'me' || raw.owner === 'none') filters.owner = raw.owner;
    else if (FILTER_UUID_RE.test(raw.owner)) filters.owner = raw.owner.toLowerCase();
  }
  if (
    typeof raw.priority === 'string' &&
    (CHAT_CASE_PRIORITIES as readonly string[]).includes(raw.priority)
  ) {
    filters.priority = raw.priority as ChatCasePriority;
  }
  if (
    raw.awaiting === true ||
    raw.awaiting === '1' ||
    raw.awaiting === 'true' ||
    raw.awaiting === 1
  ) {
    filters.awaiting = true;
  }
  return filters;
}

/**
 * `GET /v1/chat/inbox?cursor=&tab=&owner=&priority=&awaiting=` (CHAT-03, 07-10; filters 12.4): one
 * keyset page of the staff inbox, latest activity first. `cursor: null` is page 1. The filters are
 * re-validated here ({@link parseInboxFilters}) so a caller cannot forward an unknown value. Throws
 * `ApiClientError` on a non-2xx (403 without `chat.support`).
 */
export async function fetchInbox({
  cursor,
  filters = {},
}: {
  cursor: string | null;
  filters?: InboxFilters;
}): Promise<InboxPage> {
  const safe = parseInboxFilters(filters);
  const search = new URLSearchParams();
  if (cursor) search.set('cursor', cursor);
  if (safe.tab) search.set('tab', safe.tab);
  if (safe.owner) search.set('owner', safe.owner);
  if (safe.priority) search.set('priority', safe.priority);
  if (safe.awaiting) search.set('awaiting', '1');
  const query = search.toString();
  const res = await apiFetch(`/v1/chat/inbox${query ? `?${query}` : ''}`);
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

/**
 * `POST /v1/chat/conversations/{id}/voice-messages { mediaId }` (12.5, D-866, VOICE-18): the team's
 * recording in a support conversation, with the refusal order of {@link replyToConversation} (a
 * blocked or departed member is a 409 `member_blocked` / `member_removed`) plus `voice_not_ready` and
 * `voice_invalid`. Throws `ApiClientError` on a non-2xx.
 */
export async function replyVoice(conversationId: string, mediaId: string): Promise<SendResult> {
  const res = await apiFetch(
    `/v1/chat/conversations/${encodeURIComponent(conversationId)}/voice-messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaId }),
    },
  );
  if (!res.ok) throw await apiError(res);
  return sendResultSchema.parse(await res.json());
}

/**
 * `GET /v1/chat/conversations/{id}` read as the case header (12.4, D-805): the staff or the member shape
 * the API chose for the caller, `case` included when the conversation is a case. The same route as
 * {@link fetchConversation}; the name says what the BFF header handler reads it for. Throws
 * `ApiClientError` on a non-2xx.
 */
export async function fetchCaseHeader(conversationId: string): Promise<ConversationDetail> {
  return fetchConversation(conversationId);
}

/** `GET /v1/chat/support/cases?cursor=` (CASE-14): the member's own cases. `cursor: null` is page 1. */
export async function fetchMyCases({ cursor }: { cursor: string | null }): Promise<MyCasesPage> {
  const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : '';
  const res = await apiFetch(`/v1/chat/support/cases${query}`);
  if (!res.ok) throw await apiError(res);
  return myCasesPageSchema.parse(await res.json());
}

/** `GET /v1/chat/conversations/{id}/case/history` (CASE-12, staff only). Throws `ApiClientError`. */
export async function fetchCaseHistory(conversationId: string): Promise<CaseHistory> {
  const res = await apiFetch(
    `/v1/chat/conversations/${encodeURIComponent(conversationId)}/case/history`,
  );
  if (!res.ok) throw await apiError(res);
  return caseHistorySchema.parse(await res.json());
}

/** `GET /v1/chat/staff` (CASE-16): the live team, names only. Throws `ApiClientError`. */
export async function fetchStaffRoster(): Promise<StaffRoster> {
  const res = await apiFetch('/v1/chat/staff');
  if (!res.ok) throw await apiError(res);
  return staffRosterSchema.parse(await res.json());
}

/** The five transitions a case action route carries (the sixth case action, `edit`, is a PATCH). */
export type CaseTransition = 'take' | 'assign' | 'resolve' | 'close' | 'reopen';

/**
 * `POST /v1/chat/conversations/{id}/case/{action}` (D-805, D-806): ONE intent plus the state (and owner)
 * the screen showed; the SERVER decides whether the transition is legal. A 409 carries `details.chat`
 * `case_stale`, `transition_not_allowed` or `case_closed`. Throws `ApiClientError` on a non-2xx.
 */
export async function runCaseAction(
  conversationId: string,
  action: CaseTransition,
  input: CaseActionInput | CaseAssignInput,
): Promise<CaseResult> {
  const res = await apiFetch(
    `/v1/chat/conversations/${encodeURIComponent(conversationId)}/case/${action}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw await apiError(res);
  return caseResultSchema.parse(await res.json());
}

/** `PATCH /v1/chat/conversations/{id}/case` (D-812): only the fields that changed. Throws `ApiClientError`. */
export async function editCase(conversationId: string, input: CaseEditInput): Promise<CaseResult> {
  const res = await apiFetch(`/v1/chat/conversations/${encodeURIComponent(conversationId)}/case`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await apiError(res);
  return caseResultSchema.parse(await res.json());
}

/**
 * `GET /v1/chat/direct?cursor=` (11-18, CHAT-06, D-719): the Conversas list, the pinned support summary on
 * page 1 only. `cursor: null` is page 1; the cursor is opaque and forwarded as is. The strict
 * `directListAnswerSchema` refuses any key the contract does not name (a "blocked me" flag included), so a
 * non-conforming answer never reaches a view. Throws `ApiClientError` on a non-2xx.
 */
export async function fetchDirectList({
  cursor,
}: {
  cursor: string | null;
}): Promise<DirectListAnswer> {
  const query = cursor ? `?${new URLSearchParams({ cursor }).toString()}` : '';
  const res = await apiFetch(`/v1/chat/direct${query}`);
  if (!res.ok) throw await apiError(res);
  return directListAnswerSchema.parse(await res.json());
}

/**
 * `GET /v1/chat/direct/{conversationId}` (11-18, CHAT-07, D-722): one conversation's other member, the
 * composer enum and the viewer's positions. A conversation that is not the caller's (foreign, unknown,
 * hidden by the administrator's block, `social` off) is the API's bare 404, which the screens map to the
 * single not-found. Throws `ApiClientError` on a non-2xx.
 */
export async function fetchDirectDetail(conversationId: string): Promise<DirectDetail> {
  const res = await apiFetch(`/v1/chat/direct/${encodeURIComponent(conversationId)}`);
  if (!res.ok) throw await apiError(res);
  return directDetailSchema.parse(await res.json());
}

/**
 * `GET /v1/chat/direct/with/{membershipId}` (11-18, D-720): the existing conversation with that member
 * (or `null`), who the member is and the composer enum. The start of a conversation by membership id; a
 * target that is staff, removed, foreign or unknown is the API's one bare 404. Throws `ApiClientError`.
 */
export async function fetchDirectWith(membershipId: string): Promise<DirectWithAnswer> {
  const res = await apiFetch(`/v1/chat/direct/with/${encodeURIComponent(membershipId)}`);
  if (!res.ok) throw await apiError(res);
  return directWithAnswerSchema.parse(await res.json());
}

/**
 * `POST /v1/chat/direct/messages { toMembershipId, body }` (11-22, CHAT-06, D-720): the member's message to
 * another member, named by MEMBERSHIP id. The FIRST message of a pair creates the conversation in the same
 * transaction (`created: true`); the answer is the strict `directSendResultSchema`. A refusal is the API's one
 * word (409 `direct_closed`, never saying why), a 404 for a target or conversation that is gone, a 429 for the
 * limiters. Throws `ApiClientError` on a non-2xx.
 */
export async function postDirectMessage(
  toMembershipId: string,
  body: string,
): Promise<DirectSendResult> {
  const res = await apiFetch('/v1/chat/direct/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toMembershipId, body }),
  });
  if (!res.ok) throw await apiError(res);
  return directSendResultSchema.parse(await res.json());
}
