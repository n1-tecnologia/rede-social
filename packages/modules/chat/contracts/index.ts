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
 */

/** D-223: the two chat permissions, spelled once. */
export const CHAT_PERMISSIONS = {
  /** Answer support: the inbox, the staff reply and the staff read. Both staff roles. */
  answer: 'chat.support',
  /** Write to the team: the member's own support thread. Members only. */
  contact: 'chat.support.contact',
} as const;

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

/** `POST /v1/chat/support/messages` and `POST /v1/chat/conversations/{id}/messages`. */
export const sendMessageInputSchema = z.object({ body: chatBodySchema }).strict();
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

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
    body: z.string(),
    createdAt: z.string(),
    author: z.object({ firstName: z.string() }).strict().nullable(),
    authorIsViewer: z.boolean(),
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
 * `GET /v1/chat/support` (D-220). Before the member's first message there is NO conversation: the
 * answer is `{ conversation: null, messages: [], hasOlder: false }` and nothing is written.
 */
export const supportThreadSchema = z
  .object({
    conversation: memberThreadMetaSchema.nullable(),
    messages: z.array(messageRowSchema),
    hasOlder: z.boolean(),
  })
  .strict();
export type SupportThread = z.infer<typeof supportThreadSchema>;

/** The answer to a send: the conversation (created lazily on the first one) and the stored message. */
export const sendResultSchema = z
  .object({
    conversationId: z.uuid(),
    message: messageRowSchema,
  })
  .strict();
export type SendResult = z.infer<typeof sendResultSchema>;

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
    })
    .strict(),
  z
    .object({
      viewer: z.literal('member'),
      id: z.uuid(),
      lastSeq: z.int().min(0),
      lastReadSeq: z.int().min(0),
      lastStaffSeq: z.int().min(0),
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
  })
  .strict();
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

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
      })
      .strict()
      .nullable(),
    lastMessageAt: z.string().nullable(),
    awaiting: z.boolean(),
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
 * MOD-02: the module teaches the KERNEL's `EventMap` about its own event. Nothing goes into
 * `packages/contracts/src/events.ts`, which is the bus contract and knows no module.
 */
declare module '@rede-social/contracts' {
  interface EventMap {
    'chat.message_sent': ChatMessageSent;
  }
}
