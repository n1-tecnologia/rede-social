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
| `./ui` | `ChatComposer`, `MessageList`, `MessageBubble`, `DaySeparator`, `InboxRow`, `ThreadHeader` |
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
