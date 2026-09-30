/**
 * `@rede-social/contracts/realtime` — the Realtime topic and signal contract (07-01, planning
 * decisions 1-3). CLIENT-SAFE: this file imports nothing, so the browser provider (07-03) can import
 * the builders without pulling the server-only `legal` module the package index re-exports. That is
 * why it is a SUBPATH and never re-exported from `src/index.ts`.
 *
 * THE SQL IS THE SPEC. `app.realtime_topic_allowed` (the `realtime.messages` SELECT policy) and
 * `app.realtime_signal` (the only publisher) validate every topic against the regex below, verbatim,
 * BEFORE any uuid cast. `REALTIME_TOPIC_PATTERN` is the same literal, and a unit test feeds every
 * builder's output through it and greps the migration for it, so the two cannot drift.
 *
 * Four topics, every one private and every signal ids-only (the prohibition in 07-01: no excerpt,
 * body, title, display name or endpoint ever rides a signal):
 * - `tenant:<t>:all`           every live member of `<t>` while `notifications` is on; one signal per
 *                              broadcast publish (RESEARCH Pattern 4: never one per member);
 * - `tenant:<t>:user:<u>`      only `<u>`: personal kinds, seen/read in other tabs, the chat dot;
 * - `tenant:<t>:support-inbox` staff (`admin_tenant`, `support_tenant`) while `chat` is on;
 * - `tenant:<t>:conv:<c>`      a conversation's participants, plus staff on a support conversation.
 */

/** Signal event names. A signal says "something changed, refetch"; the data always comes from the API. */
export const REALTIME_EVENTS = {
  notificationsChanged: 'notifications.changed',
  chatMessage: 'chat.message',
  chatRead: 'chat.read',
  chatUnread: 'chat.unread',
} as const;
export type RealtimeEvent = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/**
 * The exact regex source `app.realtime_topic_allowed` checks (lower-case hex only: Postgres prints
 * uuids lower-case, and an upper-case spelling is refused rather than normalised).
 */
export const REALTIME_TOPIC_PATTERN =
  '^tenant:[0-9a-f-]{36}:(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$';

/** The suffix half `app.realtime_signal` checks (it prefixes `tenant:<app.tenant_id()>:` itself). */
export const REALTIME_SUFFIX_PATTERN =
  '^(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$';

/** Suffix builders for the definer: the tenant half is never a caller's choice. */
export const topicSuffix = {
  all: () => 'all' as const,
  user: (userId: string) => `user:${userId}`,
  inbox: () => 'support-inbox' as const,
  conv: (conversationId: string) => `conv:${conversationId}`,
};

/** Full topic builders for the subscribe-only browser client. */
export const tenantTopic = (tenantId: string) => `tenant:${tenantId}:${topicSuffix.all()}`;
export const userTopic = (tenantId: string, userId: string) =>
  `tenant:${tenantId}:${topicSuffix.user(userId)}`;
export const inboxTopic = (tenantId: string) => `tenant:${tenantId}:${topicSuffix.inbox()}`;
export const convTopic = (tenantId: string, conversationId: string) =>
  `tenant:${tenantId}:${topicSuffix.conv(conversationId)}`;
