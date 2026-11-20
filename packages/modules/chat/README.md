# @rede-social/module-chat

The member to support conversation (CHAT-01..05). Each member has one support thread with the
tenant's staff: the member sends lazily (the first message creates the conversation), staff answer
from the inbox, every message gets a gapless `seq` assigned by a trigger under the conversation row
lock, and reads catch up by `seq`. Realtime Broadcast carries ids-only signals published by a
definer trigger and by `app.realtime_signal`; the data is always fetched through the API. The module
also contributes the chat badges and the notification sources of the support cases: push-only for messages and
assignments, a bell row plus a push for the member's resolved case.

## Contracts

| Subpath | What it holds |
|---|---|
| `./module` | `chatModule`, the manifest |
| `./contracts` | Zod schemas and constants shared with the web app |
| `./server` | `chatRoutes`, the service functions, `chatCounters`, `chatNotificationSources` |
| `./ui` | `ChatComposer` (opt-in `voice` bundle), `useVoiceRecorder`, `MessageList`, `MessageBubble` (a text or a voice branch, never both), `VoicePlayer` and `pauseAllVoice`, `DaySeparator`, `InboxRow`, `ThreadHeader` |
| `./db` | Drizzle tables `chatConversations`, `chatParticipants`, `chatMessages` with their RLS policies |

Main contract names (`./contracts`): `chatBodySchema`, `sendMessageInputSchema`, `sendResultSchema`,
`messageRowSchema`, `messageQuerySchema`, `messagePageSchema`, `memberThreadMetaSchema`,
`supportThreadSchema`, `readInputSchema`, `conversationDetailSchema`, `inboxQuerySchema`,
`inboxRowSchema`, `inboxPageSchema`, the permission names `CHAT_PERMISSIONS` (`chat.support`,
`chat.support.contact`, `chat.support.assign`), the refusal vocabulary `CHAT_ISSUES` and
`CHAT_NOTIFICATION_KINDS`.

Support cases (Phase 12.4, all strict; every new key of an existing response is optional):
`supportSendInputSchema` (the member's first message: body, category, subject; a priority, state or
owner is refused), `memberCaseSchema` (no priority, owner or history), `staffCaseSchema`,
`caseCardSchema`, `myCasesQuerySchema`, `myCasesPageSchema`, `caseActionInputSchema`,
`caseAssignInputSchema`, `caseEditInputSchema`, `caseResultSchema`, `caseHistorySchema`,
`staffRosterSchema`, and the closed lists `CHAT_CASE_STATES`, `CHAT_CASE_CATEGORIES`,
`CHAT_CASE_PRIORITIES` and `CHAT_CASE_ACTIONS`.

### Direct conversation between two members (Phase 11, plan 08)

A member writes to another member of the same tenant (CHAT-06). The permission `chat.direct` is added to
`CHAT_PERMISSIONS` but the chat manifest never grants it: it would depend on `social` (MOD-02), so the app tier's
`permissionsFor` composes it for the `member` role only, when `social` AND `chat` are both effective (no staff role holds
it, and a tenant without `social` never does). The routes carry `requireModule('social')` and `requirePermission('chat.direct')`,
so `social` off is `404 MODULE_DISABLED` and a staff caller is `403 FORBIDDEN`.

- `POST /v1/chat/direct/messages` `{ toMembershipId, body }` (strict) answers `201 { conversationId, created, message }`.
  The target is a MEMBERSHIP id resolved in the caller's lane (a live `member` of the tenant who is not the caller); the
  conversation is created lazily by the first message, in the SAME transaction (`app.direct_conversation_open`, then the
  shared `insertMessage`), once per pair, even under twenty concurrent first sends. The body is the support rule (1 to
  2000 code points after trim); the message row, the `seq` and `chat.message_sent` are the support send's, with
  `authorSide: 'member'`. Every miss (staff, the caller, another tenant, an administrator-blocked or removed member, an
  unknown id) is ONE bare `404 NOT_FOUND`.
- `GET /v1/chat/direct/with/{membershipId}` answers `200 { conversationId | null, other: { membershipId, displayName,
  avatarAssetId, removed }, composer }` with `Cache-Control: no-store` and writes nothing. The conversation id is null before
  the first message; `avatarAssetId` appears only while the asset is live; `composer` is `open`, `blocker` (the caller
  blocked them) or `closed` (they blocked the caller, with no word of why): the two sides of a block differ in that word
  alone and no field says "blocked me". Every miss is the same bare `404 NOT_FOUND` as the send; a pair with a block is not
  a miss.
- A send the database refuses with `DM001` (a block standing either way, `social` off, the other member no longer live) is
  `409 CONFLICT` with `details.chat = 'direct_closed'`, the one word appended to `CHAT_ISSUES`. It never says which cause,
  never reuses the staff-side `member_blocked`, never carries a name, and the conversation and the message roll back together.
- Abuse limits (Claude's discretion, assumption A6): `directMessageLimiter` (30 messages a minute) and
  `directConversationLimiter` (20 new conversations an hour), both in `@rede-social/core/server/safety/limits`, keyed by the
  member inside the tenant, consumed before any write; a refusal is `429 RATE_LIMITED`.

New contracts, all strict and all NEW (no existing response schema gained a required key): `CHAT_PERMISSIONS.direct`,
`'direct_closed'`, `CHAT_NOTIFICATION_KINDS.directMessage` (`chat.direct_message`, push only, produced by plan 13),
`DIRECT_COMPOSER_STATES`, `directSendInputSchema`, `directWithParamsSchema`, `directWithAnswerSchema`,
`directSendResultSchema`.

### Voice in a direct conversation (Phase 11, plan 12)

`POST /v1/chat/direct/voice-messages` `{ toMembershipId, mediaId }` (strict, `directVoiceSendInputSchema`) answers
`201 { conversationId, created, message }` with the same guards as the text send (`requireModule('social')` and
`chat.direct`). Nothing of the voice machinery is rebuilt: it is the support voice send's order over the shipped
`storedVoiceMessage` (the idempotent read of the caller's own message for that asset), `assertVoiceUsable` and
`insertMessage` with `{ kind: 'voice', mediaAssetId }`, with the pair opened by the same `app.direct_conversation_open`
as text. `message.body` is the empty string and `message.voice` carries the asset id and the SERVER-MEASURED duration; no
client duration is accepted.

- The asset is asked BEFORE the pair (`voice_invalid`, `voice_not_ready`, the 12.5 words), so a refusal for the asset never
  reveals a block; a pair the database closed (`DM001`) is the same `409 CONFLICT { chat: 'direct_closed' }` body as text and
  the take stays unused (the orphan sweep retires it).
- Idempotent per take: the same `mediaId` again answers the stored message with `created: false` and emits nothing; the loser
  of two concurrent sends hits `chat_messages_tenant_media_asset_uq` (`23505`) and re-reads in a NEW transaction.
  `chat.message_sent` (ids only) is emitted after commit and only by the call that stored the message.
- Only the two participants play the recording (`GET /v1/media/{id}/original`, the gate `app.chat_asset_hidden` over the
  readable policy); a third member, `admin_tenant` and `support_tenant` get the bare 404 BEFORE any report. The staff reply
  routes stay support-only (a direct conversation id is the bare 404).

Contract added: `directVoiceSendInputSchema`. `assetIndexViolated` and `insertedMessage` are now exported from `service.ts`.

### Conversas list, bubble count and conversation detail (Phase 11, plan 10)

The reading half of the direct API (CHAT-06, CHAT-07), behind the same two guards as the send and always
`Cache-Control: no-store`.

- `GET /v1/chat/direct?cursor=&limit=` answers `{ support?, rows, nextCursor }`. `rows` are the paired direct
  conversations the caller's LANE can read (the select policy `app.direct_pair_readable` hides a pair with an
  administrator-blocked or removed member, and `social` off hides them all, so the list restates no predicate), ordered by
  `last_message_at desc, id desc`, 20 a page by keyset with the shipped instant-cursor guard (a forged cursor degrades to
  page 1, an over-fetch of one decides `nextCursor`). A conversation with no live message never shows. Each row carries the
  other member (`removed: true` with no id and no name for an anonymised account), `lastPreview` (`{ kind: 'text', text,
  own }` or `{ kind: 'voice', durationSeconds, own, deleted? }`, the recording's stored length, `deleted: true` once its
  asset is retired), `lastMessageAt` and `unreadCount` (messages of the other side above the caller's read position,
  capped at 100; the web prints `99+`). `support` is on the FIRST page only: the preview of the last message of the member's
  most recent support conversation (null when they never wrote) and `unread`, the shipped support dot, read by the same
  statement the bubble uses (`memberSupportUnread`); it never carries a staff id, an owner or a priority. A member block
  never hides a row.
- `GET /v1/chat/direct/{conversationId}` answers `{ conversationId, other, composer, canBlock, lastSeq, lastReadSeq }`.
  `composer` is ONE finished enum by the precedence `removed`, `blocker`, `closed`, else `open`; `closed` carries no reason,
  date or name and no key says "blocked me" (`blockedByViewer` belongs to the social read of plan 11, not here).
  `canBlock` is decided by the server (A-11-ROLE): the viewer's role of record on the request is `member`, the other member
  is live and the viewer has not blocked them already. A miss (unknown id, another tenant's, a support case, a pair the
  administrator hid, a conversation the caller is not part of) is ONE bare `404 NOT_FOUND`. The history stays readable
  for both sides through the shipped `GET /v1/chat/conversations/{id}/messages` and the read mark through the shipped
  `POST /v1/chat/conversations/{id}/read`; both are kind-agnostic through the policy.
- `chatCounters` (member branch): a caller holding `chat.direct` gets `unreadConversations` = the support dot (0 or 1) plus
  the number of paired directs with `c.last_seq > p.last_read_seq`, and `conversationsBadge: 'count'`; a caller without
  `chat.direct` keeps `{ dot }` exactly as before and staff are untouched. The counter and the list read through the same
  lane and the same readable policy, so a hidden conversation lights no badge (T-11-25).

New contracts, all strict and all NEW: `DIRECT_LIST_PAGE_SIZE` (20), `DIRECT_UNREAD_CAP` (100), `directListQuerySchema`,
`directPreviewSchema`, `directOtherSchema`, `directListRowSchema`, `directSupportSummarySchema`, `directListAnswerSchema`,
`directDetailParamsSchema`, `directDetailSchema`.

### Direct message push (Phase 11, plan 13)

The `chat.message_sent` notification source gains a direct branch (CHAT-06, D-728). The worker lane cannot read a direct
through RLS (`chat_conversations_select` admits staff only on a support case), so when the shipped read returns no row the
resolver asks the worker-only definer `app.direct_message_notice(messageId)` and builds the intent only from its row.
One push-only intent (`chat.direct_message`, never a bell row) goes to the OTHER participant: the title is the writer's
display name (the hint's `titleText`, absent when the name is blank, so the banner is titled with the tenant name), the
body is the start of the text cut on a word at 100 graphemes or `Mensagem de voz · m:ss` from the stored length, the tap
opens `/conversas/{id}`, and the tag and topic are the conversation's 32-hex id (one banner per conversation, 72 h TTL,
high urgency). `deliverable` is recomputed in SQL at fan-out time, so a closed pair, `social` off, a removed or
administrator-blocked recipient, a gone recording and a foreign or deleted message push nothing. The banner of a
participant looking at the app is suppressed by the service worker's global rule (a window focused and visible), not by a
per-conversation presence. The hint carries `titleText`, so the API and the worker deploy together.

### Voice messages (Phase 12.5)

A message can carry ONE recording instead of text. Contracts: `voiceSendInputSchema` (the member's
`{ mediaId, category?, subject? }`), `voiceReplyInputSchema` (the staff's `{ mediaId }`, strict),
`messageVoiceSchema` and the optional `voice` key of `messageRowSchema` (`mediaId`, `durationSeconds`, and
`deleted` only once the asset is retired; absent on text, `body` stays the empty string on the wire), and two
more issues appended to `CHAT_ISSUES`: `voice_not_ready` and `voice_invalid`.

Two routes, one per side, beside the unchanged text routes:

- `POST /v1/chat/support/voice-messages` (permission `chat.support.contact`): the member's recording, with the same
  case flow as text (it opens the case with its category and subject, a recording to a resolved case reopens it,
  one after a close opens a new case).
- `POST /v1/chat/conversations/{conversationId}/voice-messages` (permission `chat.support`): the team's recording.
  A member holds no `chat.support`, so a member calling it is 403; no new permission or module toggle exists.

The asset is the sender's own, `audio`/`voice`, `ready`, with a duration measured by the server at derive time:
`voice_seconds` is copied from the asset inside the insert and no client duration is accepted. A take is single-use
per tenant (a unique index), and the send is idempotent per take with no client key: a repeat or a concurrent
double send answers the stored message and stores one row; only the call that stored it emits the message event.

One refusal order for the staff route, the same codes as the text reply and asserted by the tests: 1. the support
conversation of the caller's tenant locked `for update` (a bare 404 for an unknown, foreign, direct or group id),
2. `member_blocked` (409), 3. `member_removed` (409), 4. the asset (`voice_not_ready` 409, one `voice_invalid` 400
for every other unusable asset, including one already used in another conversation), 5. the insert, where a closed
case refuses (`case_closed` 409). So blocked and removed win over everything below them, and an asset refusal wins
over a closed case. The member route keeps the same relative rule: every asset refusal precedes any case write.

Take on reply: a staff recording to an unowned open case takes it for the author (in progress, a `taken` history
row carrying the message id), a reply to a case owned by someone else changes nothing, and a reply to a resolved
case does not reopen it, because the transition trigger never reads the body.

This adds no kernel import, no emitted event and no job: the recording is read and written through the tenant lane
with the module's own SQL, and the message event the module already emits carries ids only.

Previews and labels (plan 09, D-860, D-861, D-868). Wherever a message's text is a preview the API answers FACTS, never
words: the two `lastMessage` objects (the inbox row of `GET /v1/chat/inbox` and the card of
`GET /v1/chat/support/cases`) keep `preview: string` and gain two OPTIONAL keys, both absent on a text preview.
`voiceSeconds` (1..300) is the stored length of a recording, with `preview` the empty string, and the host builds
"Mensagem de voz · m:ss" from it; `voiceDeleted: true` appears only once the recording is gone (`voiceSeconds` stays),
and the host reads "Mensagem de voz apagada". The length is the copy stored on the message, never a join to the
asset, so it survives the purge. The SQL selects the length and a gone flag (`voiceGoneSql`); no SQL string builds a
word.

The case label follows one rule on every surface (the member's header on `GET /v1/chat/support` and on
`GET /v1/chat/conversations/{id}`, closed cases included, the "Meus chamados" card, the staff inbox row, the staff
thread header and the earlier-cases list): the typed subject, else the constant "Mensagem de voz" (no duration) when
the case's FIRST message is a recording, else the cut start of the first text. `subjectLabelOf(subject, firstBody,
firstIsVoice)` is that rule, fed by `fm.voice_seconds is not null as first_is_voice` in each of the six first-message
selects.

Push words: the team's three pushes read "Novo chamado #N de {member}: Mensagem de voz · 0:42", "O chamado #N de
{member} foi reaberto: Mensagem de voz · 0:42" and "Nova mensagem de {member} no chamado #N: Mensagem de voz · 0:42",
and the member's push for a staff recording is "Mensagem de voz · 0:42" alone. One preview string is computed from the
stored length and handed to the unchanged builders (`formatVoiceClock`, `voicePreview` and `CHAT_VOICE_COPY` live in
`server/notification-copy.ts`); no template changed and no bell row exists for a message. A recording whose asset is
gone pushes nothing. This adds no kernel import, no event and no job.

## Permissions

- `chat.support`: answer support (the inbox, the staff reply, the case actions). Both staff roles.
- `chat.support.contact`: write to the team. Members only.
- `chat.support.assign`: hand a case to a colleague. `admin_tenant` only; the case definer repeats
  the role once and the drift test compares both. Assigning an in-progress case needs `expectedOwnerId`
  naming the owner the caller saw; any other value, or none, is `case_stale` (409) and nothing is written.

All three come from this manifest, so turning chat off revokes them.

Main server names (`./server`): `chatRoutes`, `sendSupportMessage`, `sendSupportVoiceMessage`, `replyToConversation`, `replyVoiceToConversation`,
`getSupportThread`, `getConversation`, `getMyCases`, `memberCaseOf`, `staffCaseOf`, `actionsFor`,
`getCaseHistory`, `getStaffRoster`, `runCaseAction`, `runCaseEdit`, `mapCaseError`, `subjectLabelOf`, `listMessages`, `listInbox`, `markConversationRead`, `isStaff`, `chatCounters`,
`chatNotificationSources`.

## Events emitted

- `chat.message_sent`: `tenantId`, `conversationId`, `messageId`, `seq`, `authorUserId`,
  `authorSide`. Never the body.
- `chat.case_resolved`: `tenantId`, `conversationId`, `resolvedAt`. Emitted by the resolve route
  after the commit; ids and an instant only, never a subject, a name or a body. Take, close,
  reopen and edit emit nothing.
- `chat.case_assigned`: `tenantId`, `conversationId`, `assigneeUserId`, `actorUserId`. Emitted by
  the assign route after the commit; ids only.
- Realtime signal (not a bus event): the ids-only Broadcast signal named chat.case, published by the
  case definers and by the auto-close sweep on the conversation, the support inbox and the member's
  own topic. Its payload is the conversation id (plus the injected message id), never a title,
  subject, name or body.

## Events consumed

- Manifest subscriptions: none.
- Notification sources (handed to the notifications module through the kernel seam):
  `chat.message_sent`, delivered as push only: a staff message pushes the member; a member message pushes the team
  as a new case (`seq = 1`), a reopened case (a `reopened` history row carries the message id) or an ongoing one
  (the owner only when the owner is live staff, every live staff member otherwise);
  `chat.case_assigned`, a push to the assignee only (never the actor);
  `chat.case_resolved`, the member's one case notice, a bell row plus a push with ids-only facts `{ caseId, number }`,
  issued only when the case is still resolved at the event's instant (compared in SQL as timestamptz).
- Notification retractions: none.

## Flag key

`chat` in `tenant_modules`. No `requires`. Turning it off also revokes `chat.support`, because the
grant lives in this manifest rather than in the kernel.

## Kernel dependencies

- `@rede-social/core/db/schema`
- `@rede-social/core/db/tenant-tx`
- `@rede-social/core/server/auth/context`
- `@rede-social/core/server/auth/require-auth`
- `@rede-social/core/server/events/bus`
- `@rede-social/core/server/http/api-error`
- `@rede-social/core/server/logging`
- `@rede-social/core/server/modules/counters`
- `@rede-social/core/server/modules/manifest`
- `@rede-social/core/server/modules/require-module`
- `@rede-social/core/server/notifications/source`
- `@rede-social/core/server/paging`
- `@rede-social/core/server/rbac/permissions`
- `@rede-social/core/server/safety/limits`
- `@rede-social/core/server/safety/sqlstate`

## Navigation

- Top bar entry "Suporte": placement `topbar`, href `/suporte`, icon `message-circle`, order 20,
  badge `unreadConversations` (staff see the unanswered count, members a dot).
- Home slots: none.

## Jobs

- Jobs: none.
- Sweep functions: `chat_cases_auto_close` (closes every support case left resolved for 7 days, hourly,
  admin lane, silent for the member; it writes a history row with no actor), and `chat_voice_orphans_sweep`
  (soft-deletes every voice take older than 24 hours that no message references, hourly, admin lane, so an unsent
  recording leaves the quota; a recording a message references is never touched. The kernel's hourly sweeper then
  purges the Storage objects. No new queue and no new job name).
- `counters`: `chatCounters` contributes `unreadConversations` to `bootstrap.counters`: for staff the active cases
  (not closed) whose last message is the member's and unread by the team, for a member a dot when a case that is not
  closed has an unread staff reply.

## Reuse

The worked example lives in `packages/reuse-fixture` (it mounts the events module the same way). A
host app must provide: a request id and a per-request logger, `flushEventsAfterHandler`, an
`onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant`: `chat.support` and `chat.support.assign`;
`support_tenant`: `chat.support`; `member`: `chat.support.contact`), `setCountersResolver` composing `counters`, and
`.route('/v1/chat', chatRoutes)`. The routes carry their own `requireAuth`, `requireModule('chat')`
and `requirePermission` chain. Push for new messages needs the notifications module's sink; the web
side subscribes to the Realtime signals read-only.

## Phase 11 compatibility

Direct and group conversations keep every case column null: the number, the state, the owner, the category, the
priority and both instants stay unset for them, and no case history row is written for them. A shape CHECK of
`chat_conversations` allows each of those columns to be set only on a `support` row, so `state` is null for every
non-support row. A Phase 11 plan that adds member-to-member chat must therefore leave `state` null for `direct` (and
for `group`) and must not reuse the case states for a conversation lifecycle; the numbering and message triggers
touch only `support` rows. The `kind` column and the support-only case policies are the contract.

### Voice in direct chats (Phase 12.5 hand-off)

Direct and group conversations accept a recording through the same table, policy, gate and bubble as the support
chat: the message model (`body` or `media_asset_id` with `voice_seconds`, exactly one), the replaced insert policy,
the read gate `app.chat_asset_hidden` (it follows the chat RLS, so the participants of a direct or group conversation
open the recording and nobody else does) and the shared bubble and composer all hold for `kind = 'direct'` and
`'group'` rows. This is proven at database and contract level only (`supabase/tests/236-chat-voice.sql` has a direct
and a group accept, and a cross-tenant negative beside its control); no screen, route or notification for a direct or
group recording was built in Phase 12.5.

For the Phase 11 planner:

- Phase 11 must list "voice in direct chats" in its acceptance and must NOT plan the recorder, the player, the media
  kind or the message model again: it passes the `voice` bundle to the shared `ChatComposer`, reuses `MessageBubble`
  and `VoicePlayer`, and adds its own send routes for a recording (the two routes of Phase 12.5 are support-only; the
  direct one is `POST /v1/chat/direct/voice-messages`, Phase 11 plan 12).
- The staff of a direct conversation are not participants and cannot open its audio: the read gate lets in only the
  uploader and the people who can read the message through the chat policies, and the support-staff clause of the
  insert policy covers `kind = 'support'` only.
- Previews and push words for a direct recording (`voiceSeconds`, "Mensagem de voz · m:ss") are the same facts and the
  same builders; Phase 11 maps them on its own lists.

For Phase 13 (the native app): the shell's microphone permission text in `scripts/app-release/config.ts` already covers
voice messages, and Phase 13 must list "record a voice message inside the app" and the OS microphone permission as
acceptance (the shell's WebView needs its capture permission too).

### Known follow-ups of Phase 12.5

- A voice take that ends "not found" shows the shipped `toast.failed` sentence ("Tente de novo"), but a dropped take
  cannot be retried from the bubble: a dedicated sentence is a small catalog follow-up (it edits the exact-key-set
  pins of the `chat` namespace).
- A blocked member who reloads the page sees the composer again until the next refused voice send, because the member
  thread answer carries no blocked state yet.
- The six info items of the Phase 12.5 code review (ffmpeg stderr overflow reported as a timeout, the 301 s verdict
  against the 1 s recorder timeslice, voice metadata on `GET /v1/media/{id}` for an administrator, a leftover
  `starting` flag in the recorder, the repeated `300` constant, and the DEPLOY.md diff check ending at `$$;`) are open.

## Phase 11 (direct messages, shipped)

- **The direct kind now has a member lane, through definers only.** A member lane still cannot insert a direct row:
  `chat_conversations_insert` accepts support rows only, and the one creator of a direct conversation is
  `app.direct_conversation_open(uuid)` (one conversation per pair, enforced by `chat_conversations_direct_pair_uq`; a
  refusal is SQLSTATE `DM001`). A paired direct is readable only while the pair is open (`app.direct_pair_readable`),
  and a send to a closed pair is refused by `app.chat_messages_before_insert` under the conversation row lock.
- **The support case triggers still skip direct rows.** The number, the state, the owner, the category, the priority
  and both instants stay null for a direct conversation, and no case history row is written for it. Staff are not
  participants of a direct: `chat_participants_select` narrows them to the participant rows of support conversations
  (`app.chat_conversation_is_support`).
- **Voice in direct chats reuses the 12.5 machinery.** `POST /v1/chat/direct/voice-messages` passes the `voice` bundle
  to the shared composer and bubble, with the same message model, insert policy and read gate; a send is idempotent per
  take and only the two participants play the recording (a reported recording opens for the administrator through its
  report only).
- **The notice is push-only.** A direct message produces one push to the other participant, titled with the writer's
  name through the literal `titleText` of the push hint, one tag per conversation, and no bell row; a closed pair gets
  nothing. The recipient's unread count rides a `chat.unread` signal on their own user topic.
- **Release order:** migrations, then the web, then the API and the worker together (see `docs/DEPLOY.md`, "Phase 11
  release").
