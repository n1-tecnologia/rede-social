'use server';

import {
  CHAT_MAX_CURSOR_LENGTH,
  caseActionInputSchema,
  caseAssignInputSchema,
  caseEditInputSchema,
  type SendResult,
  sendMessageInputSchema,
  supportSendInputSchema,
} from '@rede-social/module-chat/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiClientError, bootstrapRedirectPath, getBootstrap } from '@/lib/bootstrap';
import {
  type CaseTransition,
  editCase,
  fetchInbox,
  fetchMyCases,
  parseInboxFilters,
  replyToConversation,
  runCaseAction,
  sendSupportMessage,
} from '@/lib/chat';
import {
  type ChatMessageView,
  caseHeaderView,
  chatMessageView,
  type InboxRowView,
  inboxRowView,
  type MyCasesPageView,
  myCasesPageView,
  type StaffCaseHeaderView,
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

/**
 * What a member's send answers. 12.4 (D-811, checker R-W8): `case` is the API's own
 * `{ id, number, state, opened, reopened }` passed through UNCHANGED, so the screen reads the new case's
 * number and the `opened` / `reopened` flags from the server and computes nothing; it is absent when
 * the API sent none (the previous API).
 */
export type SendSupportMessageResult =
  | {
      ok: true;
      view: ChatMessageView;
      conversationId: string;
      case?: NonNullable<SendResult['case']>;
    }
  | { ok: false; error: 'composer.errors.failed' };

const FAILED = { ok: false, error: 'composer.errors.failed' } as const;

/**
 * The member's send. `category` and `subject` are the optional pair of the opener (D-811): the SAME strict
 * Zod the API validates with (`supportSendInputSchema`) runs before the request, so an unknown category,
 * a subject over 80 characters or an extra key never leaves the server; a blank subject is dropped.
 */
export async function sendSupportMessageAction(
  body: unknown,
  category?: unknown,
  subject?: unknown,
): Promise<SendSupportMessageResult> {
  const input = supportSendInputSchema.safeParse({
    body,
    category: category ?? undefined,
    subject: subject ?? undefined,
  });
  if (!input.success) return FAILED;

  let path: string | null = null;
  let result: SendSupportMessageResult = FAILED;
  try {
    // Everything the view needs is read BEFORE the write: once the message is stored, nothing may
    // fail and report "not sent", or the restored draft would be sent twice.
    const [bootstrap, t] = await Promise.all([getBootstrap(), getTranslations('chat')]);
    const sent = await sendSupportMessage(input.data.body, {
      category: input.data.category,
      subject: input.data.subject,
    });
    result = {
      ok: true,
      conversationId: sent.conversationId,
      view: chatMessageView(sent.message, {
        timeZone: bootstrap.tenant.timezone,
        viewer: 'member',
        t,
      }),
      ...(sent.case ? { case: sent.case } : {}),
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
 *
 * 12.4 (D-805, checker R-I8): `loadMoreInboxAction(cursor, filters)`. `filters` is the object
 * `{ tab, owner, priority, awaiting }` in the API's vocabulary (`tab` open, resolved or closed; `owner`
 * me, none or a uuid; `priority` low, normal or high; `awaiting` a boolean), each validated against its
 * enum here and DROPPED when unknown, so the next page honours the filters the first page was read with.
 * A null cursor reads page 1 with the filters (a filter change); a missing or non-object `filters` is
 * the unfiltered call.
 */
export async function loadMoreInboxAction(
  cursor: unknown,
  filters?: unknown,
): Promise<InboxPageResult> {
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length === 0)) return { ok: false };
  if (typeof cursor === 'string' && cursor.length > CHAT_MAX_CURSOR_LENGTH) return { ok: false };
  const safe = parseInboxFilters(
    typeof filters === 'object' && filters !== null ? (filters as Record<string, unknown>) : {},
  );
  let path: string | null = null;
  let result: InboxPageResult = { ok: false };
  try {
    const [bootstrap, t, page] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchInbox({ cursor: cursor as string | null, filters: safe }),
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

/* ── 07-10: the staff reply ─────────────────────────────────────────────────────────────────────── */

/** A canonical uuid, checked before any request (the API would answer a malformed id 400). */
const CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What a staff reply can answer. A refusal is a CODE, never pt-BR copy: `member_blocked` /
 * `member_removed` are the API's 409 `details.chat` (T-07-68, UI-D-263), which the pane turns into the
 * matching read-only notice; everything else is the composer's generic failure.
 */
export type ReplyToConversationResult =
  | { ok: true; view: ChatMessageView; conversationId: string }
  | { ok: false; error: 'composer.errors.failed' | 'member_blocked' | 'member_removed' };

/**
 * `POST /v1/chat/conversations/{id}/messages` (CHAT-03, D-225): any staff member answers any support
 * conversation. The same conventions as `sendSupportMessageAction`: the SAME Zod the API validates
 * with runs before the request (a server action is a public endpoint), the view is formatted in the
 * tenant zone for the STAFF viewer (the own bubble reads "Você"), and everything the view needs is
 * read BEFORE the write, so a formatting failure can never restore a draft that was already sent.
 *
 * A reply racing a block (or a departure) is answered 409 by the API: it maps to `member_blocked` /
 * `member_removed` so the pane restores the draft, toasts the notice and refreshes into the read-only
 * state. The API re-enforces `chat.support`; this action decides nothing about permissions.
 */
export async function replyToConversationAction(
  conversationId: unknown,
  body: unknown,
): Promise<ReplyToConversationResult> {
  if (typeof conversationId !== 'string' || !CONVERSATION_ID_RE.test(conversationId)) return FAILED;
  const input = sendMessageInputSchema.safeParse({ body });
  if (!input.success) return FAILED;

  let path: string | null = null;
  let result: ReplyToConversationResult = FAILED;
  try {
    const [bootstrap, t] = await Promise.all([getBootstrap(), getTranslations('chat')]);
    const sent = await replyToConversation(conversationId.toLowerCase(), input.data.body);
    result = {
      ok: true,
      conversationId: sent.conversationId,
      view: chatMessageView(sent.message, {
        timeZone: bootstrap.tenant.timezone,
        viewer: 'staff',
        t,
      }),
    };
  } catch (error) {
    const refusal = error instanceof ApiClientError ? error.details?.chat : undefined;
    if (error instanceof ApiClientError && error.status === 409) {
      if (refusal === 'member_blocked') return { ok: false, error: 'member_blocked' };
      if (refusal === 'member_removed') return { ok: false, error: 'member_removed' };
    }
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.staff_reply_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }

  if (path) redirect(path);
  return result;
}

/* ── 12.4-20: the team's case actions and the member's "Meus chamados" ─────────────────────────────── */

/**
 * What a case action or edit answers (D-845, UI-D-827). A refusal is ONE closed word the screen maps to a
 * toast: `stale` (the API's 409 `case_stale`: the case changed while the viewer looked, the screen
 * re-reads), `closed` (409 `case_closed`: the case ended), `not_allowed` (409 `transition_not_allowed`),
 * `invalid` (a 400, or an input the strict contract refused before any request) and `failed` (anything
 * else: a 403, a 404, a 5xx, the transport). `header` is the FRESH staff header of the case, with the
 * `actions[]` the server now allows: the client never computes a transition.
 */
export type CaseActionResult =
  | { ok: true; header: StaffCaseHeaderView }
  | { ok: false; error: 'stale' | 'closed' | 'not_allowed' | 'invalid' | 'failed' };

const CASE_INVALID = { ok: false, error: 'invalid' } as const;
const CASE_FAILED = { ok: false, error: 'failed' } as const;

const CASE_TRANSITIONS: readonly string[] = ['take', 'assign', 'resolve', 'close', 'reopen'];

/** The closed word of an API refusal: the 409's `details.chat` decides, a 400 is `invalid`, the rest `failed`. */
function caseRefusal(error: ApiClientError): Extract<CaseActionResult, { ok: false }> {
  if (error.status === 409) {
    const chat = error.details?.chat;
    if (chat === 'case_stale') return { ok: false, error: 'stale' };
    if (chat === 'case_closed') return { ok: false, error: 'closed' };
    if (chat === 'transition_not_allowed') return { ok: false, error: 'not_allowed' };
    return CASE_FAILED;
  }
  if (error.status === 400) return CASE_INVALID;
  return CASE_FAILED;
}

/** Runs one case write and finishes its answer; shared by the action and the edit. */
async function finishCaseWrite(
  write: () => Promise<{ case: Parameters<typeof caseHeaderView>[0] }>,
  event: string,
): Promise<CaseActionResult> {
  let path: string | null = null;
  let result: CaseActionResult = CASE_FAILED;
  try {
    // The translator is read BEFORE the write: nothing after it may fail and report "not done".
    const t = await getTranslations('chat');
    const done = await write();
    result = {
      ok: true,
      header: caseHeaderView(done.case, { viewer: 'staff', t }) as StaffCaseHeaderView,
    };
  } catch (error) {
    if (error instanceof ApiClientError) {
      path = bootstrapRedirectPath(error);
      if (!path) result = caseRefusal(error);
    }
    if (!path)
      console.error(event, {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);
  return result;
}

/**
 * `POST /v1/chat/conversations/{id}/case/{action}` (D-805, D-806, D-845): take, assign, resolve, close or
 * reopen. `input` is `{ action, expectedState, expectedOwnerId?, assigneeUserId? }`: the INTENT plus the
 * state (and, for a take-over, the owner) the screen showed. The remainder is validated by the SAME strict
 * Zod the API uses (an unknown key, a forged state or owner, an assignee on a take or a missing one on an
 * assign is `invalid` with zero API calls) and is the exact body sent; the SERVER decides whether the
 * transition is legal and answers the fresh case.
 */
export async function runCaseActionAction(
  conversationId: unknown,
  input: unknown,
): Promise<CaseActionResult> {
  if (typeof conversationId !== 'string' || !CONVERSATION_ID_RE.test(conversationId)) {
    return CASE_INVALID;
  }
  if (typeof input !== 'object' || input === null) return CASE_INVALID;
  const { action, ...rest } = input as Record<string, unknown>;
  if (typeof action !== 'string' || !CASE_TRANSITIONS.includes(action)) return CASE_INVALID;
  const parsed = (action === 'assign' ? caseAssignInputSchema : caseActionInputSchema).safeParse(
    rest,
  );
  if (!parsed.success) return CASE_INVALID;

  return finishCaseWrite(
    () => runCaseAction(conversationId.toLowerCase(), action as CaseTransition, parsed.data),
    'chat.case_action_failed',
  );
}

/**
 * `PATCH /v1/chat/conversations/{id}/case` (D-812, D-845): the team corrects the category, the subject or
 * the priority. `input` is `{ expectedState, category?, subject?, priority? }` with only the CHANGED fields;
 * a blank or `null` subject blanks it (sent as null). The API's own strict contract validates it before
 * the request, so an edit with no field, a subject over 80 characters or a forged `state` key is `invalid`
 * with zero API calls.
 */
export async function editCaseAction(
  conversationId: unknown,
  input: unknown,
): Promise<CaseActionResult> {
  if (typeof conversationId !== 'string' || !CONVERSATION_ID_RE.test(conversationId)) {
    return CASE_INVALID;
  }
  const parsed = caseEditInputSchema.safeParse(input);
  if (!parsed.success) return CASE_INVALID;

  return finishCaseWrite(
    () => editCase(conversationId.toLowerCase(), parsed.data),
    'chat.case_edit_failed',
  );
}

/**
 * What "Meus chamados" paging answers: the WHOLE finished page (checker W11), `current` and `total`
 * included on every page, or `{ ok: false }` (the list's inline retry line).
 */
export type MyCasesPageResult = ({ ok: true } & MyCasesPageView) | { ok: false };

/**
 * The member's "Meus chamados" page (CASE-14, UI-D-821). With a NULL cursor it reads page 1 and answers the
 * whole page, so a pull-to-refresh replaces "Chamado atual", the list and the section counts; with a
 * cursor it answers the next `items` in the same shape (the API sends `current` and `total` on every page)
 * and the load-more appends `items` only. The cursor is opaque and capped at the API's own ceiling; the
 * cards come back formatted in the tenant zone from ONE clock read.
 */
export async function loadMoreMyCasesAction(cursor: unknown): Promise<MyCasesPageResult> {
  if (cursor !== null) {
    if (
      typeof cursor !== 'string' ||
      cursor.length === 0 ||
      cursor.length > CHAT_MAX_CURSOR_LENGTH
    ) {
      return { ok: false };
    }
  }
  let path: string | null = null;
  let result: MyCasesPageResult = { ok: false };
  try {
    const [bootstrap, t, page] = await Promise.all([
      getBootstrap(),
      getTranslations('chat'),
      fetchMyCases({ cursor }),
    ]);
    const timeZone = bootstrap.tenant.timezone;
    const keys = tenantDayKeys(Date.now(), timeZone);
    result = { ok: true, ...myCasesPageView(page, { timeZone, keys, t }) };
  } catch (error) {
    if (error instanceof ApiClientError) path = bootstrapRedirectPath(error);
    if (!path)
      console.error('chat.my_cases_page_failed', {
        status: error instanceof ApiClientError ? error.status : null,
        code: error instanceof ApiClientError ? error.code : 'TRANSPORT',
      });
  }
  if (path) redirect(path);
  return result;
}
