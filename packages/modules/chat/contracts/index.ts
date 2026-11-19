import { z } from 'zod';

/**
 * The chat module's published contract surface (`@rede-social/module-chat/contracts`). The API
 * validates with these schemas and the web (07-09) parses with them, so there is one definition of
 * what a message, a thread and an inbox row are (MOD-01).
 *
 * Facts a reader must not "fix":
 *
 * 1. **Two permissions, not roles** (D-223). `chat.support` answers support (both staff roles, via
 *    the chat manifest, so disabling chat revokes it); `chat.support.contact` is the member's right to
 *    write to the team. Staff never hold `contact`, so they are never offered a thread of their own.
 * 2. **The body rule counts CODE POINTS after a JS `trim()`** (D-225, CHAT-02 encoding): the stored
 *    body is the trimmed string, inner line breaks kept as sent, and the database CHECK counts the same
 *    code points, so the two can never disagree. No markdown, no HTML: plain text, rendered by 07-09.
 * 3. **`seq` is the only cursor** (D-240). A conversation's messages are ordered by their gapless
 *    per-conversation `seq`; catch-up is `afterSeq`, history is `beforeSeq`.
 * 4. **A member never learns more than a staff member's FIRST NAME** (D-222): a staff row carries
 *    `author: { firstName }` and nothing else about the agent (no avatar, surname, e-mail, role or id).
 * 5. **The member's first message may carry a category and a subject, never a priority** (D-811, D-812).
 *    `supportSendInputSchema` is strict with exactly `body`, `category?`, `subject?`: a forged `priority`,
 *    `state` or owner key is the plain `VALIDATION_FAILED`, not an issue code (T-12.4-21). The reply route
 *    keeps `sendMessageInputSchema` unchanged. A subject is trimmed, an empty one is absent, and it counts
 *    `CHAT_SUBJECT_MAX` CODE POINTS (`subject_too_long`).
 * 6. **Existing responses only gain `.optional()` keys** (CASE-24): the new web must tolerate the previous
 *    API between the web step and the API step. Every new REQUEST key lives on a NEW schema.
 * 7. **What a member never receives** (UI-D-835): `memberCaseSchema` carries no priority, owner, history or
 *    staff id; only `staffCaseSchema` does. The contracts index imports `zod` and nothing else, so it stays
 *    client-safe (a `node:fs` leak is caught only by `next build`).
 */

/** D-223: the two chat permissions, spelled once. */
export const CHAT_PERMISSIONS = {
  /** Answer support: the inbox, the staff reply and the staff read. Both staff roles. */
  answer: 'chat.support',
  /** Write to the team: the member's own support thread. Members only. */
  contact: 'chat.support.contact',
  /** Hand a support case to a colleague (D-806, CASE-08). `admin_tenant` only, granted by the chat manifest. */
  assign: 'chat.support.assign',
  /**
   * 11-08 (D-719): write to ANOTHER member. Members only, and only while `social` AND `chat` are both effective. The
   * chat manifest cannot name it (it would depend on `social`: MOD-02), so the app tier's `permissionsFor` composes it
   * and no manifest grants it statically.
   */
  direct: 'chat.direct',
} as const;

/** D-811: the subject of a case, picked by the member from this closed list of areas. */
export const CHAT_CASE_CATEGORIES = ['check_in', 'events', 'payment', 'account', 'other'] as const;
export type ChatCaseCategory = (typeof CHAT_CASE_CATEGORIES)[number];

/** D-812: the team's priority of a case. A member neither sets nor reads it. */
export const CHAT_CASE_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ChatCasePriority = (typeof CHAT_CASE_PRIORITIES)[number];

/** The typed subject of a case, at most this many code points after trim (D-811). */
export const CHAT_SUBJECT_MAX = 80;

/** D-805: the four states of a support case. A closed ORDERED tuple, pinned by a contract test. */
export const CHAT_CASE_STATES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type ChatCaseState = (typeof CHAT_CASE_STATES)[number];

/** What the server may list for a viewer of a case (UI-D-826): the UI draws exactly this list, in this order. */
export const CHAT_CASE_ACTIONS = ['take', 'assign', 'resolve', 'close', 'reopen', 'edit'] as const;
export type ChatCaseAction = (typeof CHAT_CASE_ACTIONS)[number];

/** D-810: the kinds of a history row, equal to the CHECK of `chat_case_events.kind`. */
export const CHAT_CASE_EVENT_KINDS = [
  'opened',
  'taken',
  'assigned',
  'resolved',
  'closed',
  'reopened',
  'edited',
] as const;
export type ChatCaseEventKind = (typeof CHAT_CASE_EVENT_KINDS)[number];

/** The fields the team may correct on a case, as an `edited` history row names them (D-812). */
export const CHAT_CASE_EDIT_FIELDS = ['category', 'subject', 'priority'] as const;

/** The member's "Meus chamados" page: 20 cards, newest first. */
export const CHAT_MY_CASES_PAGE_SIZE = 20;

/** The most cards one "Meus chamados" request may ask for. */
export const CHAT_MAX_MY_CASES_PAGE_SIZE = 50;

/** The inbox tabs (D-805): the open group, resolved and closed. */
export const CHAT_INBOX_TABS = ['open', 'resolved', 'closed'] as const;
export type ChatInboxTab = (typeof CHAT_INBOX_TABS)[number];

/** D-225: 1..2000 code points after trim. */
export const CHAT_MAX_BODY = 2000;

/** One catch-up or history page, and the ceiling a crafted `limit` cannot exceed. */
export const CHAT_PAGE_SIZE = 50;

/** One screen of inbox rows on a phone. */
export const CHAT_INBOX_PAGE_SIZE = 20;

/** The inbox's one-line preview of the last message (CHAT-03). */
export const CHAT_PREVIEW_GRAPHEMES = 100;

/** The longest inbox cursor this API will look at (the `NOTIF_MAX_CURSOR_LENGTH` rule). */
export const CHAT_MAX_CURSOR_LENGTH = 512;

/**
 * The ACTIVE states of a support case (D-802): a member holds at most one case in these states at a time. It is
 * the predicate of the partial unique index `chat_conversations_one_active_case_per_member`, and the member
 * send's `on conflict` arbiter repeats it to the letter (a test compares both lists). `closed` is the only state
 * that frees the member to open the next case (D-801).
 */
export const CASE_ACTIVE_STATES = ['open', 'in_progress', 'resolved'] as const;

/**
 * The closed vocabulary of `details.chat`. Input problems are `400 VALIDATION_FAILED`
 * (`body_required`, `body_too_long`); state refusals are `409 CONFLICT` (`member_blocked`,
 * `member_removed`). `staff_has_inbox` names the rule that staff never own a thread (the member routes
 * answer them `403 FORBIDDEN` through the missing `chat.support.contact` permission).
 */
export const CHAT_ISSUES = [
  'body_required',
  'body_too_long',
  'member_blocked',
  'member_removed',
  'staff_has_inbox',
  'case_stale',
  'case_closed',
  'transition_not_allowed',
  'assignee_invalid',
  'subject_too_long',
  'case_nothing_to_edit',
  'voice_not_ready',
  'voice_invalid',
  /**
   * 11-08 (D-722): the ONE word of a direct send the database refused (a block either way, `social` off, the other
   * member no longer live). It never says which, never reuses the staff-side `member_blocked`, never names anyone.
   */
  'direct_closed',
] as const;
export type ChatIssue = (typeof CHAT_ISSUES)[number];
export const CHAT_ISSUE_SET: ReadonlySet<string> = new Set(CHAT_ISSUES);

/** Code points, not UTF-16 units: an emoji is one, as it is for Postgres' `char_length`. */
export const codePointLength = (value: string): number => [...value].length;

/**
 * A message body: trimmed with JS `trim()`, then 1..`CHAT_MAX_BODY` code points (fact 2). The issue
 * MESSAGE is the machine code, so the route lifts it to `details.chat`.
 */
export const chatBodySchema = z
  .string()
  .transform((value) => value.trim())
  .superRefine((value, issue) => {
    const length = codePointLength(value);
    if (length === 0) issue.addIssue({ code: 'custom', message: 'body_required' });
    else if (length > CHAT_MAX_BODY) issue.addIssue({ code: 'custom', message: 'body_too_long' });
  });

/**
 * The typed subject of a case (D-811): trimmed, an empty or whitespace-only one is ABSENT, and one over
 * `CHAT_SUBJECT_MAX` code points is the machine message `subject_too_long` (so the route lifts it to
 * `details.chat`).
 */
export const subjectInputSchema = z
  .string()
  .transform((value) => value.trim())
  .superRefine((value, issue) => {
    if (codePointLength(value) > CHAT_SUBJECT_MAX)
      issue.addIssue({ code: 'custom', message: 'subject_too_long' });
  })
  .transform((value) => (value === '' ? undefined : value));

/**
 * `POST /v1/chat/support/messages` (D-811, D-812, T-12.4-21): the member's message, which may carry the
 * category and the subject of the case it opens. Strict: `priority`, `state`, an owner and every other key
 * are the plain `VALIDATION_FAILED`.
 */
export const supportSendInputSchema = z
  .object({
    body: chatBodySchema,
    category: z.enum(CHAT_CASE_CATEGORIES).optional(),
    subject: subjectInputSchema.optional(),
  })
  .strict();
export type SupportSendInput = z.infer<typeof supportSendInputSchema>;

/**
 * `POST /v1/chat/conversations/{id}/messages` (the reply route, unchanged by 12.4) and, until the case routes
 * move the member's first message to `supportSendInputSchema`, `POST /v1/chat/support/messages`.
 */
export const sendMessageInputSchema = z.object({ body: chatBodySchema }).strict();
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

/**
 * The longest recording a chat message carries, in seconds. It MIRRORS `VOICE_MAX_SECONDS` of the media contract
 * (`@rede-social/contracts/media`): this index imports `zod` and nothing else so it stays client-safe, and a test
 * of this module compares the two constants.
 */
export const CHAT_VOICE_MAX_SECONDS = 300;

/**
 * `POST /v1/chat/support/voice-messages` (D-866, D-861, VOICE-04, VOICE-31): the member sends ONE recording, by the
 * id of a `ready` voice asset they own, and may carry the category and the subject of the case it opens exactly as
 * text does. A NEW route and a NEW schema, never a union with `supportSendInputSchema` (the router's default hook
 * lifts `body_required` and `body_too_long` from the issue message). Strict, and no duration, side or author is
 * accepted: the duration is copied from the asset's server-measured one.
 */
export const voiceSendInputSchema = z
  .object({
    mediaId: z.uuid(),
    category: z.enum(CHAT_CASE_CATEGORIES).optional(),
    subject: subjectInputSchema.optional(),
  })
  .strict();
export type VoiceSendInput = z.infer<typeof voiceSendInputSchema>;

/** The staff reply with a recording (`POST /v1/chat/conversations/{id}/voice-messages`, plan 06): the asset id only. */
export const voiceReplyInputSchema = z.object({ mediaId: z.uuid() }).strict();
export type VoiceReplyInput = z.infer<typeof voiceReplyInputSchema>;

/**
 * The recording of a message, ABSENT on a text row (never null). `deleted` appears only when the asset has been
 * retired since: the row stays (its seq is taken) and the player draws "Mensagem de voz indisponivel".
 */
export const messageVoiceSchema = z
  .object({
    mediaId: z.uuid(),
    durationSeconds: z.int().min(1).max(CHAT_VOICE_MAX_SECONDS),
    deleted: z.boolean().optional(),
  })
  .strict();
export type MessageVoice = z.infer<typeof messageVoiceSchema>;

/** Who wrote a message: the member, or anyone of the team. */
export const CHAT_SIDES = ['member', 'staff'] as const;
export type ChatSide = (typeof CHAT_SIDES)[number];

/**
 * One message as every reader receives it. `author` is `{ firstName }` on a staff row (fact 4; `''`
 * when the agent has since left the tenant) and `null` on a member row. `authorIsViewer` tells the
 * reader which bubbles are their own without exposing any id.
 */
export const messageRowSchema = z
  .object({
    id: z.uuid(),
    seq: z.int().positive(),
    side: z.enum(CHAT_SIDES),
    /** The empty string on a voice row: `body` stays a string on the wire (the previous web parses it strictly). */
    body: z.string(),
    createdAt: z.string(),
    author: z.object({ firstName: z.string() }).strict().nullable(),
    authorIsViewer: z.boolean(),
    /** 12.5 (D-846): present only on a recording, absent on text. Optional like every new key (fact 6). */
    voice: messageVoiceSchema.optional(),
  })
  .strict();
export type MessageRow = z.infer<typeof messageRowSchema>;

/**
 * `GET /v1/chat/conversations/{id}/messages?afterSeq=|beforeSeq=&limit=` (fact 3). `afterSeq` is the
 * catch-up (`seq > N`, ascending); `beforeSeq` is the previous page (`seq < N`, answered ascending);
 * neither is the latest page. Both at once is a 400. `limit` clamps to `1..CHAT_PAGE_SIZE`.
 */
export const messageQuerySchema = z
  .object({
    afterSeq: z.coerce.number().int().min(0).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .catch(CHAT_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), CHAT_PAGE_SIZE))
      .default(CHAT_PAGE_SIZE),
  })
  .strict()
  .refine((query) => query.afterSeq === undefined || query.beforeSeq === undefined, {
    message: 'afterSeq_and_beforeSeq',
  });
export type MessageQuery = z.infer<typeof messageQuerySchema>;

/**
 * One page, always ascending by `seq`. `hasMore` is true when another page exists in the direction
 * that was asked: newer for `afterSeq`, older for `beforeSeq` and for the latest page.
 */
export const messagePageSchema = z
  .object({
    conversationId: z.uuid(),
    items: z.array(messageRowSchema),
    hasMore: z.boolean(),
  })
  .strict();
export type MessagePage = z.infer<typeof messagePageSchema>;

/** The member's own position in their thread. */
export const memberThreadMetaSchema = z
  .object({
    id: z.uuid(),
    lastSeq: z.int().min(0),
    lastReadSeq: z.int().min(0),
    lastStaffSeq: z.int().min(0),
  })
  .strict();

/**
 * What every viewer of a case shares (fact 7). `id` is the conversation id (a case IS a support conversation);
 * `subject` is the typed one (null when the member typed none) and `subjectLabel` is the server's finished fallback
 * (the subject, else the constant label of a case opened by a recording (12.5, D-861), else the start of the first
 * message cut at `CHAT_SUBJECT_MAX`), so the UI never computes it.
 */
const caseSharedShape = {
  id: z.uuid(),
  number: z.int().positive(),
  state: z.enum(CHAT_CASE_STATES),
  subject: z.string().nullable(),
  subjectLabel: z.string(),
  category: z.enum(CHAT_CASE_CATEGORIES),
  openedAt: z.string(),
};

/**
 * A case as the MEMBER reads it (UI-D-835, T-12.4-23): the shared facts and NOTHING else. No priority, owner, history,
 * resolve or close instant, action list or staff id: the schema is strict, so a staff-shaped payload does not parse.
 */
export const memberCaseSchema = z.object(caseSharedShape).strict();
export type MemberCase = z.infer<typeof memberCaseSchema>;

/**
 * A case as the TEAM reads it: the shared facts, the priority, the owner (`ownerName` is the live display name, null
 * for no owner or an owner who is no longer live staff, and the UI draws "Sem responsavel"), `ownerIsViewer`, the
 * resolve and close instants and the `actions[]` the viewer may take in this state.
 */
export const staffCaseSchema = z
  .object({
    ...caseSharedShape,
    priority: z.enum(CHAT_CASE_PRIORITIES),
    ownerUserId: z.uuid().nullable(),
    ownerName: z.string().nullable(),
    ownerIsViewer: z.boolean(),
    resolvedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    actions: z.array(z.enum(CHAT_CASE_ACTIONS)),
  })
  .strict();
export type StaffCase = z.infer<typeof staffCaseSchema>;

/**
 * One card of "Meus chamados" (the member's own cases only): the member facts plus the one-line preview of the last
 * message with its side (the UI prefixes "Voce" or the team) and the instant. Never a priority or an owner.
 */
export const caseCardSchema = z
  .object({
    ...caseSharedShape,
    lastMessage: z
      .object({
        preview: z.string(),
        side: z.enum(CHAT_SIDES),
        /**
         * 12.5 (D-860, VOICE-28): ABSENT on a text preview. A recording has `preview: ''` and the stored length here;
         * the host builds "Mensagem de voz · m:ss" from it through its catalog.
         */
        voiceSeconds: z.int().min(1).max(CHAT_VOICE_MAX_SECONDS).optional(),
        /** 12.5 (D-868): `true` only when the recording is gone; the host reads "Mensagem de voz apagada". */
        voiceDeleted: z.literal(true).optional(),
      })
      .strict()
      .nullable(),
    lastMessageAt: z.string().nullable(),
  })
  .strict();
export type CaseCard = z.infer<typeof caseCardSchema>;

/**
 * `GET /v1/chat/support/cases?cursor=&limit=`: the same cursor clamp and limit rule as the inbox (an over-long cursor
 * degrades to page 1), 20 per page by default.
 */
export const myCasesQuerySchema = z
  .object({
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > CHAT_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(CHAT_MY_CASES_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), CHAT_MAX_MY_CASES_PAGE_SIZE))
      .default(CHAT_MY_CASES_PAGE_SIZE),
  })
  .strict();
export type MyCasesQuery = z.infer<typeof myCasesQuerySchema>;

/**
 * "Meus chamados": `current` is the active case (null when none), `items` the closed ones newest first, `total`
 * counts the closed cases of the member (the one the card "Chamado atual" shows is not in it), `nextCursor` is
 * opaque.
 */
export const myCasesPageSchema = z
  .object({
    current: caseCardSchema.nullable(),
    items: z.array(caseCardSchema),
    total: z.int().min(0),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type MyCasesPage = z.infer<typeof myCasesPageSchema>;

/**
 * `POST /v1/chat/conversations/{id}/case/take|resolve|close|reopen`: the state the client read (a stale one is
 * `case_stale`, 409) and, when it read an owner, that owner. Strict: nothing else can be written through an action.
 */
export const caseActionInputSchema = z
  .object({
    expectedState: z.enum(CHAT_CASE_STATES),
    expectedOwnerId: z.uuid().optional(),
  })
  .strict();
export type CaseActionInput = z.infer<typeof caseActionInputSchema>;

/** `POST /v1/chat/conversations/{id}/case/assign` (`chat.support.assign`, D-806): an action plus the target. */
export const caseAssignInputSchema = z
  .object({
    expectedState: z.enum(CHAT_CASE_STATES),
    expectedOwnerId: z.uuid().optional(),
    assigneeUserId: z.uuid(),
  })
  .strict();
export type CaseAssignInput = z.infer<typeof caseAssignInputSchema>;

/**
 * `PATCH /v1/chat/conversations/{id}/case` (D-812): the team corrects the category, the subject or the priority.
 * `subject: null` (or an empty one) blanks it. An edit with no field is the issue `case_nothing_to_edit`. There is
 * no `state` and no owner key: a transition is an action, never an edit.
 */
export const caseEditInputSchema = z
  .object({
    expectedState: z.enum(CHAT_CASE_STATES),
    category: z.enum(CHAT_CASE_CATEGORIES).optional(),
    priority: z.enum(CHAT_CASE_PRIORITIES).optional(),
    subject: z
      .string()
      .transform((value) => value.trim())
      .superRefine((value, issue) => {
        if (codePointLength(value) > CHAT_SUBJECT_MAX)
          issue.addIssue({ code: 'custom', message: 'subject_too_long' });
      })
      .transform((value) => (value === '' ? null : value))
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (edit) =>
      edit.category !== undefined || edit.priority !== undefined || edit.subject !== undefined,
    { message: 'case_nothing_to_edit' },
  );
export type CaseEditInput = z.infer<typeof caseEditInputSchema>;

/** Every case action and edit answers the fresh case, with its `actions[]`. */
export const caseResultSchema = z.object({ case: staffCaseSchema }).strict();
export type CaseResult = z.infer<typeof caseResultSchema>;

/** One row of the append-only history (D-810). `actorName` is absent for the automatic close. */
export const caseEventSchema = z
  .object({
    kind: z.enum(CHAT_CASE_EVENT_KINDS),
    at: z.string(),
    actorName: z.string().optional(),
    targetName: z.string().optional(),
    fromState: z.enum(CHAT_CASE_STATES).optional(),
    toState: z.enum(CHAT_CASE_STATES).optional(),
    field: z.enum(CHAT_CASE_EDIT_FIELDS).optional(),
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
  })
  .strict();
export type CaseEvent = z.infer<typeof caseEventSchema>;

/** An earlier case of the same member, for the details sheet (never the current one). */
export const earlierCaseSchema = z
  .object({
    id: z.uuid(),
    number: z.int().positive(),
    state: z.enum(CHAT_CASE_STATES),
    subjectLabel: z.string(),
    openedAt: z.string(),
  })
  .strict();

/** The most earlier cases the details sheet lists. */
export const CHAT_EARLIER_CASES_MAX = 5;

/** `GET /v1/chat/conversations/{id}/case/history` (staff only): the events and up to five earlier cases. */
export const caseHistorySchema = z
  .object({
    events: z.array(caseEventSchema),
    earlierCases: z.array(earlierCaseSchema).max(CHAT_EARLIER_CASES_MAX),
    hasMoreEarlier: z.boolean(),
  })
  .strict();
export type CaseHistory = z.infer<typeof caseHistorySchema>;

/** `GET /v1/chat/staff`: the live team, names only (the owner filter and the assign sheet). */
export const staffRosterSchema = z
  .object({
    items: z.array(z.object({ userId: z.uuid(), name: z.string() }).strict()),
  })
  .strict();
export type StaffRoster = z.infer<typeof staffRosterSchema>;

/**
 * `GET /v1/chat/support` (D-220). Before the member's first message there is NO conversation: the
 * answer is `{ conversation: null, messages: [], hasOlder: false }` and nothing is written.
 */
export const supportThreadSchema = z
  .object({
    conversation: memberThreadMetaSchema.nullable(),
    messages: z.array(messageRowSchema),
    hasOlder: z.boolean(),
    /** 12.4: the member's active case (null when none) and whether they ever wrote. Optional: the previous API omits them. */
    case: memberCaseSchema.nullable().optional(),
    hasAnyCase: z.boolean().optional(),
  })
  .strict();
export type SupportThread = z.infer<typeof supportThreadSchema>;

/** The answer to a send: the conversation (created lazily on the first one) and the stored message. */
export const sendResultSchema = z
  .object({
    conversationId: z.uuid(),
    message: messageRowSchema,
    /** 12.4: which case the message landed in, and whether it opened or reopened it. Optional like every new key. */
    case: z
      .object({
        id: z.uuid(),
        number: z.int().positive(),
        state: z.enum(CHAT_CASE_STATES),
        opened: z.boolean(),
        reopened: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SendResult = z.infer<typeof sendResultSchema>;

/* ── Phase 11, plan 08: the direct conversation (CHAT-06; D-719, D-720, D-722) ───────────────────────── */

/**
 * What the composer of a direct conversation may do, decided by the server (UI-D-864): `open` writes, `closed` is the
 * strip the BLOCKED side reads, `blocker` is the strip the blocker reads (with the way to unblock), `removed` is the
 * read-only strip of an other member who left. Closed ORDERED tuple, pinned by a contract test. The `with` answer never
 * carries `removed` (a removed member is a bare 404 there); the list and detail of plan 10 do.
 */
export const DIRECT_COMPOSER_STATES = ['open', 'closed', 'blocker', 'removed'] as const;
export type DirectComposerState = (typeof DIRECT_COMPOSER_STATES)[number];

/**
 * `POST /v1/chat/direct/messages` (D-720): the target is a MEMBERSHIP id (public in the directory), never a user id, a
 * conversation id, a tenant id or an author side; the tenant and the author come from the claims. Strict: any other key
 * is the plain `VALIDATION_FAILED`. The body is the one shared rule (D-734): 1 to 2000 code points after trim.
 */
export const directSendInputSchema = z
  .object({
    toMembershipId: z.uuid(),
    body: chatBodySchema,
  })
  .strict();
export type DirectSendInput = z.infer<typeof directSendInputSchema>;

/**
 * `POST /v1/chat/direct/voice-messages` (D-734): ONE recording to another member, named by MEMBERSHIP id, by the id of a
 * `ready` voice asset the caller owns. A NEW strict schema, never a union with the text input (the router's default hook
 * lifts `body_required` from the issue message). No duration, side, author, user or conversation id is accepted: the
 * duration is the asset's server-measured one and the author is the caller.
 */
export const directVoiceSendInputSchema = z
  .object({
    toMembershipId: z.uuid(),
    mediaId: z.uuid(),
  })
  .strict();
export type DirectVoiceSendInput = z.infer<typeof directVoiceSendInputSchema>;

/** `GET /v1/chat/direct/with/{membershipId}`: a strict path parameter; a malformed id is a 400 before any read. */
export const directWithParamsSchema = z.object({ membershipId: z.uuid() }).strict();
export type DirectWithParams = z.infer<typeof directWithParamsSchema>;

/**
 * `GET /v1/chat/direct/with/{membershipId}` (D-720, D-722): the existing conversation with that member or null, who the
 * other member is, and what the composer may do. No flag says "blocked me": the blocked side and the blocker differ ONLY
 * in the `composer` word. `other.displayName` is null only for a member with no profile; `avatarAssetId` is null when
 * there is none or the asset is gone.
 */
export const directWithAnswerSchema = z
  .object({
    conversationId: z.uuid().nullable(),
    other: z
      .object({
        membershipId: z.uuid(),
        displayName: z.string().nullable(),
        avatarAssetId: z.uuid().nullable(),
        removed: z.boolean(),
      })
      .strict(),
    composer: z.enum(DIRECT_COMPOSER_STATES),
  })
  .strict();
export type DirectWithAnswer = z.infer<typeof directWithAnswerSchema>;

/** The answer to a direct send: the conversation, whether THIS call created it, and the stored message. */
export const directSendResultSchema = z
  .object({
    conversationId: z.uuid(),
    created: z.boolean(),
    message: messageRowSchema,
  })
  .strict();
export type DirectSendResult = z.infer<typeof directSendResultSchema>;

/* ── Phase 11, plan 10: the Conversas list and the conversation detail (CHAT-06, CHAT-07; D-719, D-721..D-723) ───── */

/** 20 conversations a page (D-719), the same size as the support inbox. */
export const DIRECT_LIST_PAGE_SIZE = 20;

/** The unread number of one conversation stops counting here; the web prints `99+` (D-719). */
export const DIRECT_UNREAD_CAP = 100;

/**
 * `GET /v1/chat/direct?cursor=&limit=`: a keyset page. An over-long cursor is dropped (page 1) and a bad `limit`
 * degrades to the page size, never a 500 (the inbox query's posture); an unknown key is the plain `VALIDATION_FAILED`.
 */
export const directListQuerySchema = z
  .object({
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > CHAT_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(DIRECT_LIST_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), DIRECT_LIST_PAGE_SIZE))
      .default(DIRECT_LIST_PAGE_SIZE),
  })
  .strict();
export type DirectListQuery = z.infer<typeof directListQuerySchema>;

/**
 * The last message of a row, one line, as FACTS the host builds its words from: a text message is cut like the inbox
 * preview; a recording carries its STORED length and `deleted: true` only once its asset is retired (D-868). `own` says
 * whether the viewer wrote it. No author name, no side, no staff id.
 */
export const directPreviewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string(), own: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal('voice'),
      durationSeconds: z.int().min(1).max(CHAT_VOICE_MAX_SECONDS),
      own: z.boolean(),
      deleted: z.literal(true).optional(),
    })
    .strict(),
]);
export type DirectPreview = z.infer<typeof directPreviewSchema>;

/**
 * Who the other member of a direct conversation is. `removed` is the anonymised account (D-721): the row stays,
 * read-only, with no id and no name. The key set is the same for every state, so nothing here tells a block apart.
 */
export const directOtherSchema = z
  .object({
    membershipId: z.uuid().nullable(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    removed: z.boolean(),
  })
  .strict();
export type DirectOther = z.infer<typeof directOtherSchema>;

/** One paired conversation of the viewer, newest activity first. A conversation with no message does not exist. */
export const directListRowSchema = z
  .object({
    conversationId: z.uuid(),
    other: directOtherSchema,
    lastPreview: directPreviewSchema,
    lastMessageAt: z.string(),
    unreadCount: z.int().min(0).max(DIRECT_UNREAD_CAP),
  })
  .strict();
export type DirectListRow = z.infer<typeof directListRowSchema>;

/**
 * The pinned support row (D-719): the preview of the last message of the member's most recent support conversation
 * (null when they never wrote) and the shipped dot rule (the team wrote past the member's position in a case that is
 * not closed). Never a staff id, an owner or a priority.
 */
export const directSupportSummarySchema = z
  .object({ lastPreview: directPreviewSchema.nullable(), unread: z.boolean() })
  .strict();
export type DirectSupportSummary = z.infer<typeof directSupportSummarySchema>;

/** `GET /v1/chat/direct`: the support summary on the FIRST page only, the rows, and the opaque next cursor. */
export const directListAnswerSchema = z
  .object({
    support: directSupportSummarySchema.optional(),
    rows: z.array(directListRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type DirectListAnswer = z.infer<typeof directListAnswerSchema>;

/** `GET /v1/chat/direct/{conversationId}`: a strict path parameter; a malformed id is a 400 before any read. */
export const directDetailParamsSchema = z.object({ conversationId: z.uuid() }).strict();
export type DirectDetailParams = z.infer<typeof directDetailParamsSchema>;

/**
 * `GET /v1/chat/direct/{conversationId}` (D-722, D-723): what the screen of one conversation draws. `composer` is the ONLY
 * block-derived fact and a finished enum (`removed`, then `blocker`, then `closed`, else `open`); `closed` carries no
 * reason, date or name, and no field says "blocked me". `canBlock` is decided by the server (A-11-ROLE): the viewer is a
 * member, the other is live and the viewer has not blocked them already. Positions are the viewer's own.
 */
export const directDetailSchema = z
  .object({
    conversationId: z.uuid(),
    other: directOtherSchema,
    composer: z.enum(DIRECT_COMPOSER_STATES),
    canBlock: z.boolean(),
    lastSeq: z.int().min(0),
    lastReadSeq: z.int().min(0),
  })
  .strict();
export type DirectDetail = z.infer<typeof directDetailSchema>;

/** `POST /v1/chat/conversations/{id}/read`: the highest seq the reader has seen. */
export const readInputSchema = z.object({ seq: z.int().min(0) }).strict();
export type ReadInput = z.infer<typeof readInputSchema>;

/** A conversation member's membership as staff see it (CONTEXT's discretion item, decided). */
export const MEMBER_STATES = ['active', 'blocked', 'removed'] as const;
export type MemberStateValue = (typeof MEMBER_STATES)[number];

/**
 * The member behind a support thread, for STAFF only. A soft-deleted (or missing) membership is
 * `removed` with every identity field null (the feed's UI-D-24 rule); a blocked one keeps its name
 * and is marked `blocked` (the thread is then read-only for the team).
 */
export const conversationMemberSchema = z
  .object({
    membershipId: z.uuid().nullable(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
    state: z.enum(MEMBER_STATES),
  })
  .strict();
export type ConversationMember = z.infer<typeof conversationMemberSchema>;

/**
 * `GET /v1/chat/conversations/{id}`: staff get the member and the team's read position; the member
 * gets their own position. `viewer` says which shape arrived.
 */
export const conversationDetailSchema = z.discriminatedUnion('viewer', [
  z
    .object({
      viewer: z.literal('staff'),
      id: z.uuid(),
      member: conversationMemberSchema,
      lastSeq: z.int().min(0),
      staffLastReadSeq: z.int().min(0),
      case: staffCaseSchema.optional(),
    })
    .strict(),
  z
    .object({
      viewer: z.literal('member'),
      id: z.uuid(),
      lastSeq: z.int().min(0),
      lastReadSeq: z.int().min(0),
      lastStaffSeq: z.int().min(0),
      case: memberCaseSchema.optional(),
    })
    .strict(),
]);
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

/**
 * `GET /v1/chat/inbox?cursor=&limit=` (CHAT-03). `limit` clamps to `1..CHAT_MAX_INBOX_PAGE_SIZE`;
 * an over-long or undecodable cursor degrades to page 1.
 */
export const CHAT_MAX_INBOX_PAGE_SIZE = 50;
export const inboxQuerySchema = z
  .object({
    cursor: z
      .string()
      .optional()
      .transform((value) =>
        value !== undefined && value.length > CHAT_MAX_CURSOR_LENGTH ? undefined : value,
      ),
    limit: z.coerce
      .number()
      .int()
      .catch(CHAT_INBOX_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), CHAT_MAX_INBOX_PAGE_SIZE))
      .default(CHAT_INBOX_PAGE_SIZE),
    /** 12.4 filters: a bad value degrades to its default, like the cursor, never to a 500. */
    tab: z.enum(CHAT_INBOX_TABS).catch('open').default('open'),
    owner: z
      .union([z.enum(['me', 'none']), z.uuid()])
      .optional()
      .catch(undefined),
    priority: z.enum(CHAT_CASE_PRIORITIES).optional().catch(undefined),
    awaiting: z
      .union([z.literal('1'), z.literal('true'), z.literal(1), z.literal(true)])
      .transform(() => true)
      .catch(false)
      .default(false),
  })
  .strict();
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

/** The case facts of one inbox row (staff only; the owner is a name, never an id). */
export const inboxCaseSchema = z
  .object({
    number: z.int().positive(),
    state: z.enum(CHAT_CASE_STATES),
    subjectLabel: z.string(),
    category: z.enum(CHAT_CASE_CATEGORIES),
    priority: z.enum(CHAT_CASE_PRIORITIES),
    ownerName: z.string().nullable(),
    ownerIsViewer: z.boolean(),
  })
  .strict();

/**
 * One inbox row. `lastMessage.preview` is ONE line (newlines as spaces) of at most
 * `CHAT_PREVIEW_GRAPHEMES` graphemes, cut on a word; `authorFirstName` names the team member who
 * wrote it when the side is `staff`. `awaiting` is the shared D-225 state: the latest message is the
 * member's and the team has not read up to it.
 */
export const inboxRowSchema = z
  .object({
    conversationId: z.uuid(),
    member: conversationMemberSchema,
    lastMessage: z
      .object({
        seq: z.int().positive(),
        preview: z.string(),
        side: z.enum(CHAT_SIDES),
        authorFirstName: z.string().nullable(),
        /** 12.5 (D-860, VOICE-28): absent on text; the stored length of a recording (its `preview` is empty). */
        voiceSeconds: z.int().min(1).max(CHAT_VOICE_MAX_SECONDS).optional(),
        /** 12.5 (D-868): `true` only when the recording is gone. */
        voiceDeleted: z.literal(true).optional(),
      })
      .strict()
      .nullable(),
    lastMessageAt: z.string().nullable(),
    awaiting: z.boolean(),
    /** 12.4: the case facts the row draws. Optional: the previous API omits it. */
    case: inboxCaseSchema.optional(),
  })
  .strict();
export type InboxRow = z.infer<typeof inboxRowSchema>;

/** One keyset page of the inbox, `last_message_at desc, id desc`. `nextCursor` is opaque. */
export const inboxPageSchema = z
  .object({
    items: z.array(inboxRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type InboxPage = z.infer<typeof inboxPageSchema>;

/** 07-08's notification kinds. Push-only (D-228): neither ever writes a bell row. */
export const CHAT_NOTIFICATION_KINDS = {
  /** A staff reply, pushed to the member (title "Equipe {tenant}"). */
  supportReply: 'chat.support_reply',
  /** A member message, pushed to every live staff member. */
  memberMessage: 'chat.member_message',
  /** D-808: a case became Resolvido. The member's ONLY case notice, push plus a bell row (ids only). */
  caseResolved: 'chat.case_resolved',
  /** D-809: a case was assigned to a staff member, pushed to the assignee. */
  caseAssigned: 'chat.case_assigned',
  /** D-809: a new case opened, pushed to the team. */
  caseNew: 'chat.case_new',
  /** D-809: a Resolvido case came back to Aberto by a member message, pushed to the team. */
  caseReopened: 'chat.case_reopened',
  /** 11-08 (D-719): a member wrote to another member. Push only, to the recipient; produced by plan 13. */
  directMessage: 'chat.direct_message',
} as const;

/**
 * `chat.message_sent`: ids only (T-06-06). Emitted after the writer's transaction committed; the
 * push source reads the body itself, in the worker, through the policies.
 */
export interface ChatMessageSent {
  tenantId: string;
  conversationId: string;
  messageId: string;
  seq: number;
  authorUserId: string;
  authorSide: ChatSide;
}

/**
 * `chat.case_resolved` (D-808): ids and an instant only. No text, no name, no subject: the renderer and the push
 * source read what they show themselves, through the policies.
 */
export interface ChatCaseResolved {
  tenantId: string;
  conversationId: string;
  resolvedAt: string;
}

/** `chat.case_assigned` (D-809): ids only, `assigneeUserId` is who is notified, `actorUserId` who assigned. */
export interface ChatCaseAssigned {
  tenantId: string;
  conversationId: string;
  assigneeUserId: string;
  actorUserId: string;
}

/**
 * MOD-02: the module teaches the KERNEL's `EventMap` about its own event. Nothing goes into
 * `packages/contracts/src/events.ts`, which is the bus contract and knows no module.
 */
declare module '@rede-social/contracts' {
  interface EventMap {
    'chat.message_sent': ChatMessageSent;
    'chat.case_resolved': ChatCaseResolved;
    'chat.case_assigned': ChatCaseAssigned;
  }
}
