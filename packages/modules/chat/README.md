# @rede-social/module-chat

The member to support conversation (CHAT-01..05). Each member has one support thread with the
tenant's staff: the member sends lazily (the first message creates the conversation), staff answer
from the inbox, every message gets a gapless `seq` assigned by a trigger under the conversation row
lock, and reads catch up by `seq`. Realtime Broadcast carries ids-only signals published by a
definer trigger and by `app.realtime_signal`; the data is always fetched through the API. The module
also contributes the chat badges and a push-only notification source for new messages.

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

## Permissions

- `chat.support`: answer support (the inbox, the staff reply, the case actions). Both staff roles.
- `chat.support.contact`: write to the team. Members only.
- `chat.support.assign`: hand a case to a colleague. `admin_tenant` only; the case definer repeats
  the role once and the drift test compares both.

All three come from this manifest, so turning chat off revokes them.

Main server names (`./server`): `chatRoutes`, `sendSupportMessage`, `replyToConversation`,
`getSupportThread`, `getConversation`, `getMyCases`, `memberCaseOf`, `subjectLabelOf`,
`listMessages`, `listInbox`, `markConversationRead`, `isStaff`, `chatCounters`,
`chatNotificationSources`.

## Events emitted

- `chat.message_sent`: `tenantId`, `conversationId`, `messageId`, `seq`, `authorUserId`,
  `authorSide`. Never the body.
- Declared on the kernel event map for the case notices, ids only and never any text (they are
  emitted by the case routes that follow in this phase): chat.case_resolved (`tenantId`,
  `conversationId`, `resolvedAt`) and chat.case_assigned (`tenantId`, `conversationId`,
  `assigneeUserId`, `actorUserId`).
- Realtime signal (not a bus event): the ids-only Broadcast signal named chat.case, published by the
  case definers and by the auto-close sweep on the conversation, the support inbox and the member's
  own topic. Its payload is the conversation id (plus the injected message id), never a title,
  subject, name or body.

## Events consumed

- Manifest subscriptions: none.
- Notification sources (handed to the notifications module through the kernel seam):
  `chat.message_sent`, delivered as push only.
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
  admin lane, silent for the member; it writes a history row with no actor).
- `counters`: `chatCounters` contributes `unreadConversations` to `bootstrap.counters`.

## Reuse

The worked example lives in `packages/reuse-fixture` (it mounts the events module the same way). A
host app must provide: a request id and a per-request logger, `flushEventsAfterHandler`, an
`onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant`: `chat.support` and `chat.support.assign`;
`support_tenant`: `chat.support`; `member`: `chat.support.contact`), `setCountersResolver` composing `counters`, and
`.route('/v1/chat', chatRoutes)`. The routes carry their own `requireAuth`, `requireModule('chat')`
and `requirePermission` chain. Push for new messages needs the notifications module's sink; the web
side subscribes to the Realtime signals read-only.
