# Phase 7: Notifications, Web Push & Chat - Context

**Gathered:** 2026-09-29
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase reaches members in real time through three consumers of one shared realtime infrastructure:
- a notification bell with a live unread count, a list, and mark-as-read (NOTIF-01, NOTIF-02);
- Web Push in the installed PWA, gated on iOS behind the install hint, and sent through a channel abstraction (NOTIF-03, NOTIF-04, PWA-02);
- a live 1:1 support conversation, with an inbox for support staff (CHAT-01..05).

Event reminders at 24 h and 1 h before the start come from a scheduled job and go only to members who confirmed (EVENT-07).

Every signal is a Supabase Broadcast on a private topic. It carries ids only, and the data always comes through the API.

Out of scope:
- member-to-member DMs (CHAT-06) and member blocking (CHAT-07), which are Phase 11;
- per-category preferences, grouping, and e-mail/WhatsApp (V2-NOTIF-01..03);
- attachments, read receipts and typing (V2-CHAT-02);
- notifying members when an event is edited or cancelled (V2-EVENT-02).

</domain>

<decisions>
## Implementation Decisions

### Carried forward (locked before this discussion — do not re-open)
- **D-40:** The bell (`Bell` icon) and the chat bubble are TopBar/rail **slots** with unread badges, not tabs. `notifications` and `chat` declare `nav.placement` as a TopBar slot in their module manifests. The badges read `bootstrap.counters.unreadNotifications` / `unreadConversations`, which already exist as zero placeholders (`apps/api/src/routes/me.ts:190`, `apps/web/app/(app)/layout.tsx:71`).
- **Domain events** go through the in-process bus. It collects events and flushes them after commit (`packages/core/server/events/bus.ts`). Modules declaration-merge into `EventMap`. Notification fan-out subscribes and enqueues pg-boss jobs. It never runs inside the producing request, and it is idempotent on `(event_id, user_id)` (roadmap Notes).
- **Chat schema is generic:** `conversations` has `kind`, participants have a `role` and `last_read_at`, and `messages` has a per-conversation `seq`. A partial unique index enforces one open support conversation per member. V2 direct messages will be a `kind` value, not a migration (CHAT-01, roadmap Notes).
- **Authorisation** uses `requirePermission(...)`. `support_tenant` already holds `chat.support` (`packages/core/server/rbac/require-role.ts:12`).
- **Silence on edits and cancels:** event edits and cancels notify nobody in V1 (D-201, D-214). D-226 below adds one exception: reactivation.
- **Prototype port (PROTOTYPE.md):**
  - The ticket protocol, category, priority, status, FAQ and attachments in `suporte/*` are extras and are **not ported**.
  - The bubble UI from `suporte/[ticketId]` and `NotificationItem`/`NotificationList` ("Novas" / "Anteriores") are the parts to port.
  - Notification text is rendered from `kind` + payload through the pt-BR catalog, never stored pre-rendered.
  - Row renderers form a registry keyed by `kind`, so the notifications module never enumerates other modules' types.

### Support chat
- **D-220: The member's chat bubble opens the single support thread directly.** There is no "Ajuda" hub.
  - Empty state: a short greeting (catalog copy such as "Fale com a equipe da {tenant}") above the composer.
  - The conversation row is created lazily on the first message, or on first open (the planner decides which).
- **D-221: No resolve/close status. Each member has one ongoing thread, forever.** The staff inbox orders by last activity and shows unread indicators, with no Abertas/Resolvidas chips.
  - **Reversibility:** costly. Adding a status later means a migration plus a reopen rule on the partial unique index, but no data is lost.
- **D-222: Attribution on the member side.**
  - The thread header shows the tenant's name and logo ("Equipe {tenant}").
  - Each staff bubble shows the sending agent's **first name** in small text.
  - The member never sees staff avatars.
- **D-223: `admin_tenant` also answers support.** It receives the `chat.support` permission through `defaultRolePermissions`, alongside `support_tenant`.
  - Staff (either role) are never offered a support conversation of their own.
  - The inbox route, API and Realtime topic require `chat.support`.
- **D-224: Staff reach the inbox from the same TopBar chat slot.**
  - The target depends on the role: members get their thread, staff get the inbox.
  - On mobile, the inbox is a list and a tap opens the thread. On the desktop rail layout, it is a list + thread split view.
  - The inbox row shows the member's display name and avatar, a preview of the last message, the relative time and an unread indicator.
  - The staff thread header shows the member's name and avatar and links to their existing member profile. There is no side panel.
- **D-225: The thread is shared and nothing is assigned.**
  - Any staff member can reply, and all staff see every message live.
  - Staff read state is **shared**. Once any staff member has read the latest member message, the thread no longer counts as awaiting staff for anyone. The planner picks the shape, for example a conversation-level `staff_last_read_seq`, or the support participant row standing for the team.
  - No claim, assignment, or per-agent unread.
- **Message body rules (part of D-225):**
  - Plain text, 1-2000 characters after trim, validated by the API and a DB CHECK.
  - Line breaks are preserved.
  - URLs are auto-linked on render, opening in a new tab with `rel="noopener noreferrer"`.
  - No markdown, no link preview, and never HTML injection.

### Notifications (what, who, how read)
- **D-226: Kinds that notify every member.** Each of these produces one in-app row per member:
  - every published post (feed and community posts alike);
  - every new reel;
  - every new story;
  - every new event;
  - an event **reactivated** with `Reativar`. This is the one exception to the silence of D-214; edits and cancels stay silent.

  Personal kinds are unchanged from NOTIF-01: a like on the member's comment, a reply or comment on the member's comment, and event reminders at 24 h and 1 h (EVENT-07, only for members whose answer is `Vou`).
- **D-227: One notification per publication, with no collapsing.** "3 novos posts" grouping is V2-NOTIF-02. Push collapses separately (D-236).
- **D-228: Support replies produce no bell row.** They light the chat badge and send a push through the notification module's push channel. The bell list stays about content, and nothing is counted twice. NOTIF-01's "support replies" is satisfied by the channel abstraction delivering a push, plus the chat badge.
- **D-229: Staff (`admin_tenant`, `support_tenant`) receive none of the broadcast kinds** in D-226, and an author never notifies themselves.
  - Staff still receive the personal kinds: likes and replies on their own comments.
  - Staff also receive the support-inbox signals of D-235.
  - Fan-out targets the tenant's members with the `member` role and excludes blocked members.
- **D-230: Two read fields, `seen_at` and `read_at`.**
  - Opening the bell list marks every row as seen, which drops the bell badge to zero. The badge counts unseen rows.
  - A row keeps its unread tint until it is tapped, which sets `read_at`.
  - The list header has a "Marcar todas como lidas" action.
  - Rejected: tap-only (the badge feels sticky), and open-marks-all (it loses the tint that points at new items).
- **D-231: The list is infinite scroll with "Novas" (unread) and "Anteriores" sections**, using the shared keyset envelope (`packages/core/server/paging.ts`) and `InfiniteScroll` from `@rede-social/ui`.
  - Rows older than **90 days** are deleted by the existing hourly sweeper, which keeps the fan-out table bounded.
- **D-232: Tapping a row opens its target screen.**
  - A like or reply on a comment opens the post **scrolled to and highlighting that comment**.
  - A story comment opens the story.
  - Posts, reels, events and reminders open their detail screens.
  - Where the target is gone (a deleted post, an expired story), the tap opens a legible pt-BR fallback, and no route is ever broken (see Claude's Discretion).

### Web Push
- **D-233: Push is offered in two places, and the native permission prompt fires only from a tap.**
  1. The Configurações "Notificações" row (`apps/web/app/(app)/configuracoes/page.tsx:148`, today `soon`) becomes an on/off switch for this device.
  2. A one-time, dismissible soft-ask card at the top of the bell list: "Ative as notificações para não perder nada". Once dismissed, it stays hidden for good.

  There is no automatic prompt on load and no ask after sending a chat message.
- **D-234: The iOS gate (PWA-02).** On iOS Safari outside standalone mode, tapping "Ativar" opens the existing Phase 2 `InstallHint` sheet (`apps/web/components/pwa/InstallHint.tsx`), with push-specific copy explaining that notifications need the app on the home screen. In standalone mode on iOS 16.4+, the switch runs the normal subscribe flow.
- **D-235: Which kinds are pushed.**
  - Every in-app kind **except likes** is pushed. Likes stay in-app only.
  - Support replies are pushed to the member. The title is "Equipe {tenant}" and the body is the **first ~100 characters of the reply** (lock-screen preview accepted).
  - A new member message in the support inbox is pushed to **every staff member with a subscription** ("Nova mensagem de {membro}" + preview), with one `tag` per conversation.
  - V1 has no per-kind toggles (V2-NOTIF-01). Push is one switch per device.
- **D-236: Push content, collapsing and foreground behaviour.**
  - The title is the tenant's display name. The body is per kind: "Novo post: {first ~80 chars}", "Novo reel", "Novo story", "Novo evento: {título} · {data no fuso do tenant}", reminder copy, and so on.
  - The icon is the tenant's `icon-192` from the branding bucket.
  - A tap opens the target screen (D-232).
  - Broadcast kinds share one `tag` per kind, so the newest banner replaces the previous one while every in-app row is kept. There is no hard rate limit.
  - The service worker **suppresses the OS banner when an app window is focused and visible**, because realtime has already updated the badge. On iOS a notification must be shown for every push, so there it is always shown.
- **Expired subscriptions** (404/410) are deleted. Blocking a member deletes their subscriptions (roadmap SC 4).

### Unread & badges
- **D-237: The member's chat badge is a dot, not a number.** It shows when the member's conversation has a staff message with `seq` above the member's `last_read_at`/`last_read_seq`.
- **D-238: The staff chat badge is a number.** It is the count of conversations **awaiting staff**, meaning the last message is from the member and is unread by staff under the shared read state (D-225). Opening the thread or replying clears it for all staff.
- **D-239: The app-icon badge (Badging API) is used.**
  - The value is the bell's unseen count plus the chat count: the member's dot counts as 1, and staff add the awaiting count.
  - It is set with `navigator.setAppBadge` from the page whenever the counters change, and from the service worker when a push arrives.
  - Where the API is unsupported, it silently does nothing.
- **D-240: Refresh on reconnect or refocus, with no reliance on Realtime replay.**
  - On Realtime (re)subscribe and on `visibilitychange` to visible, the client invalidates the counters query and any open conversation.
  - Catch-up uses the `seq` cursor ("messages after seq N").
  - A signal missed while the app was away therefore never matters.

### Claude's Discretion

These were not raised with the user. Decide them in research or planning, record the choice, and pin the behaviour with tests. Do not re-ask the user.

- **The roadmap's "Research needed" items:**
  - the RLS shape on `realtime.messages` (a membership join or a JWT claim), and the topics: `tenant:<id>:user:<uid>`, `tenant:<id>:conv:<cid>`, and a support-inbox topic gated on `chat.support`;
  - whether to use `realtime.send` or a `broadcast_changes` trigger;
  - sizing against the Free-plan Realtime quota;
  - the fan-out mechanics for "every member" kinds (eager rows per member through a pg-boss job, batched). The pilot scale makes eager rows the expected default;
  - generating `seq` under concurrent inserts;
  - the push handlers in the Serwist `apps/web/app/sw.ts`;
  - the private-channel authorisation tests for non-participants.
- **Build order (roadmap Notes):** notifications + the Realtime provider first, then push (a real-iPhone and Android test plan is a deliverable), then chat reusing the same topics, worker, push and unread patterns.
- **EVENT-07 reminders:**
  - The scheduled job must follow `event.updated` when a start moves, and skip cancelled events.
  - Idempotency per `(event, window, user)`.
  - A reminder whose time has already passed when the event is created or edited (for example, an event created 30 minutes before it starts) is skipped, not sent late.
- **Stories (D-226):** a story notification whose story has expired (24 h) opens Início with a short "Este story expirou" notice. Whether story notifications are pruned sooner than 90 days is the planner's call.
- **Reels:** they notify through whatever event the reels module emits (`post.published` with a reel kind, or its own event). Do not double-emit.
- **Deleted targets:** when `post.deleted`, `comment.deleted` or `story.deleted` fires, either delete the related notification rows or render them as "Conteúdo removido". The planner picks one and tests it.
- **Unlike/re-like:** it must not produce duplicate like notifications. The idempotency key covers this.
- **Channel abstraction (NOTIF-04):** the adapter interface and registry shape, with in-app and push as the two V1 adapters.
- **Push subscriptions:** the table shape (per user and device, with endpoint uniqueness), where the VAPID keys live (Secret Manager on Cloud Run, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel), and resubscribing on `pushsubscriptionchange`.
- **Blocked members (roadmap SC 4):**
  - Realtime access is dropped: RLS checks the membership's blocked state, and the auth middleware checks `blocked_at`.
  - Push subscriptions are deleted.
  - The fan-out excludes blocked members.
  - What staff see for a blocked member's existing thread (read-only is suggested).
- **Copy:** every pt-BR catalog string (kinds, the empty chat greeting, the soft-ask card, the push bodies), following PWA-03.
- **UI surfaces without a prototype** (the staff inbox, the desktop split view, the soft-ask card, the push switch row) go through the D-33 process (UI-SPEC plus a `/gsd-sketch` review), as in earlier phases.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` § Phase 7: the goal, success criteria 1-4, the "Research needed" list and the build-order notes.
- `.planning/REQUIREMENTS.md`: NOTIF-01..04, EVENT-07, PWA-02, CHAT-01..05, plus the V2-NOTIF-01..03 and V2-CHAT-02 exclusions.
- `.planning/PROJECT.md`: the core value (zero leakage between tenants), the Free-plan constraints, and the Realtime read-only exception.

### Stack patterns (project CLAUDE.md)
- `.claude/CLAUDE.md` § "Stack Patterns" 1 (PWA: Serwist, Web Push, the iOS rules, the manifest and icons) and 5 (Realtime: Broadcast topics, RLS on `realtime.messages`, `broadcast_changes`, re-`setAuth` on refresh, invalidating the notification center).

### Prior decisions
- `.planning/phases/02-tenant-shell-branding-platform-panel/02-CONTEXT.md` D-40: the TopBar slots, the badges and the `Bell` icon.
- `.planning/phases/06-events/06-CONTEXT.md` D-201, D-214 (silent edits and cancels) and D-209 (event times), plus the domain events that must be ready for Phase 7 (the event payloads carry `starts_at`).
- `packages/core/docs/SCHEMA-CONVENTIONS.md`: status columns rather than booleans, `tenant_id`-first indexes, and the keyset/DESC index rules.

### Design source
- `.planning/research/PROTOTYPE.md` §5 `components/notifications/`, the rows for `/notifications` and `/suporte*`, and the Chat and Notification rows of the data-model table (lines ~130-174, 256-261, 307, 341-342): what to port and what to drop.
- `reference/frontend-design/app/(app)/notifications/page.tsx`, `reference/frontend-design/components/notifications/NotificationItem.tsx` and `NotificationList.tsx`.
- `reference/frontend-design/app/(app)/suporte/[ticketId]/page.tsx`: the bubble UI and the reply composer (without attachments or resolve).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/server/events/bus.ts`: `emit`/`subscribe`, flushed after commit. Notifications subscribe to the declared events: `post.published`, `story.published`, `event.published`, `event.reactivated`, `event.updated`, `event.cancelled`, `comment.created`, `comment.liked`, `story.commented`, and the delete events.
- `packages/core/server/jobs/boss.ts` and `connection.ts`, `apps/api/src/worker.ts`: pg-boss on the worker service for the fan-out, push sends and reminder scheduling.
- `packages/core/server/media/sweep-job.ts`: the existing hourly sweeper, reused for the 90-day notification pruning.
- `packages/core/server/paging.ts` + `@rede-social/ui` `InfiniteScroll`: the notification list and the inbox.
- `packages/core/ui/nav.ts` (the `NavBadge` type), `TopBar.tsx`, `DesktopRail.tsx`, `AppShell.tsx`: the badge plumbing already exists and only needs real counters.
- `packages/contracts/src/bootstrap.ts:59-60`: `counters.unreadNotifications` / `unreadConversations`.
- `apps/web/components/pwa/InstallHint.tsx`, `ServiceWorkerRegister.tsx`, `apps/web/app/sw.ts`: the iOS hint, service worker registration, and where the `push` / `notificationclick` handlers go.
- `apps/web/app/(app)/configuracoes/page.tsx:148`: the "Notificações" row placeholder.
- The tenant branding icons (`icon-192`) in the `branding` bucket, for push icons.

### Established Patterns
- **Feature modules** live in `packages/modules/<name>/{contracts,db,server,ui,module.ts}` (see `packages/modules/events`). `notifications` and `chat` should follow this layout and register in `apps/api/src/modules/registry.ts`.
- **Permissions:** `requirePermission('chat.support')` etc., with defaults in `defaultRolePermissions`.
- **Testing:** pgTAP isolation and the API isolation suite (`apps/api/tests/integration/isolation.test.ts`) must cover the new tables and `realtime.messages` policies, including cross-tenant and non-participant negatives.

### Integration Points
- `apps/api/src/routes/me.ts:190`: the bootstrap counters, which are hard-coded 0 today.
- `apps/web/app/(app)/layout.tsx:71`: the counters passed to the shell.
- The web client uses `@supabase/realtime-js` subscribe-only, with the BFF access token and `setAuth` on refresh (the Realtime exception in the stack docs).

</code_context>

<specifics>
## Specific Ideas

- The chat header says "Equipe {tenant}", with the tenant logo. Staff bubbles carry the agent's first name only.
- The soft-ask copy is "Ative as notificações para não perder nada".
- The push title is always the tenant's display name, with the tenant's icon. Members should feel it is their organization's app (the core value).
- The notification list keeps the prototype's "Novas" / "Anteriores" sections.

</specifics>

<deferred>
## Deferred Ideas

- Resolving or closing support threads with Abertas/Resolvidas triage. Rejected for V1 (D-221); revisit if a pilot tenant's support volume demands it.
- Assigning or claiming conversations, and per-agent unread. Rejected for V1 (D-225).
- A member-info side panel in the staff thread (joined date, e-mail, events). Rejected for V1 (D-224).
- A push rate limit per member per hour. Rejected in favour of collapsing by `tag` (D-236).
- A contextual push ask after the first chat message. Rejected (D-233).
- Per-kind push toggles (V2-NOTIF-01), grouped notifications (V2-NOTIF-02), and e-mail/WhatsApp channels (V2-NOTIF-03). Already in V2.

</deferred>

---

*Phase: 07-notifications-web-push-chat*
*Context gathered: 2026-09-29*
