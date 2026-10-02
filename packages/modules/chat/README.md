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
`chat.support.contact`), the refusal vocabulary `CHAT_ISSUES` and `CHAT_NOTIFICATION_KINDS`.

Main server names (`./server`): `chatRoutes`, `sendSupportMessage`, `replyToConversation`,
`getSupportThread`, `getConversation`, `listMessages`, `listInbox`, `markConversationRead`,
`isStaff`, `chatCounters`, `chatNotificationSources`.

## Events emitted

- `chat.message_sent`: `tenantId`, `conversationId`, `messageId`, `seq`, `authorUserId`,
  `authorSide`. Never the body.

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

## Navigation

- Top bar entry "Suporte": placement `topbar`, href `/suporte`, icon `message-circle`, order 20,
  badge `unreadConversations` (staff see the unanswered count, members a dot).
- Home slots: none.

## Jobs

- Jobs: none.
- Sweep functions: none.
- `counters`: `chatCounters` contributes `unreadConversations` to `bootstrap.counters`.

## Reuse

The worked example lives in `packages/reuse-fixture` (it mounts the events module the same way). A
host app must provide: a request id and a per-request logger, `flushEventsAfterHandler`, an
`onError` rendering `errorEnvelope`, `setPermissionResolver` with the kernel grants plus
`defaultRolePermissions` (`admin_tenant` and `support_tenant`: `chat.support`; `member`:
`chat.support.contact`), `setCountersResolver` composing `counters`, and
`.route('/v1/chat', chatRoutes)`. The routes carry their own `requireAuth`, `requireModule('chat')`
and `requirePermission` chain. Push for new messages needs the notifications module's sink; the web
side subscribes to the Realtime signals read-only.
