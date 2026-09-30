# Phase 7: Notifications, Web Push & Chat - Research

**Researched:** 2026-09-29
**Domain:** Supabase Realtime Broadcast authorization, event-driven notification fan-out (pg-boss), Web Push (VAPID + Serwist service worker), per-conversation ordered chat
**Confidence:** MEDIUM-HIGH (code and local-stack facts HIGH; hosted Realtime quotas and iOS behaviour MEDIUM; a few browser behaviours LOW, flagged)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried forward (locked before this discussion — do not re-open)
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

#### Support chat
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

#### Notifications (what, who, how read)
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

#### Web Push
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

#### Unread & badges
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

### Deferred Ideas (OUT OF SCOPE)

- Resolving or closing support threads with Abertas/Resolvidas triage. Rejected for V1 (D-221); revisit if a pilot tenant's support volume demands it.
- Assigning or claiming conversations, and per-agent unread. Rejected for V1 (D-225).
- A member-info side panel in the staff thread (joined date, e-mail, events). Rejected for V1 (D-224).
- A push rate limit per member per hour. Rejected in favour of collapsing by `tag` (D-236).
- A contextual push ask after the first chat message. Rejected (D-233).
- Per-kind push toggles (V2-NOTIF-01), grouped notifications (V2-NOTIF-02), and e-mail/WhatsApp channels (V2-NOTIF-03). Already in V2.

Also out of scope per the CONTEXT domain boundary: member-to-member DMs (CHAT-06), member blocking (CHAT-07), attachments/read receipts/typing (V2-CHAT-02), notifying members of event edits/cancels (V2-EVENT-02).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTIF-01 | In-app notifications from domain events: likes/replies on the member's comments, new posts, new events, reminders, support replies | §Fan-out (notification sources seam, eager rows, dedupe keys), §Event → kind map, D-228 via push channel |
| NOTIF-02 | Bell with live unread count, list, mark-as-read | §Realtime topics (`tenant:<t>:all` + `tenant:<t>:user:<u>`), §Counters composition, §List keyset with Novas/Anteriores, `seen_at`/`read_at` |
| NOTIF-03 | Web Push in the installed PWA, tenant name + icon, opens the screen, expired subscriptions cleaned | §Web Push (VAPID, `web-push` 3.6.7, SW handlers, 404/410 cleanup, iOS gate) |
| NOTIF-04 | Channel abstraction (in-app, push) that later accepts e-mail/WhatsApp | §Channel abstraction (adapter interface + registry) |
| EVENT-07 | Reminders 24 h / 1 h before, scheduled job, only `Vou` | §EVENT-07 design (in-tx deferred jobs armed by the events module, `event.reminder_due`, fire-time staleness checks) |
| PWA-02 | iOS "Adicionar à Tela de Início" hint before push | §iOS gating (`InstallHint` reuse, standalone detection incl. iPadOS, gesture-triggered prompt) |
| CHAT-01 | Generic conversations/participants/messages with per-conversation sequence | §Chat schema reshape (stubs already generic), §seq generation (counter row lock) |
| CHAT-02 | Member opens single support conversation, sends text; support answers | §Lazy creation on first message, routes, `chat.support` permission |
| CHAT-03 | Staff inbox ordered by last activity with unread indicators | §Shared staff read state (`staff_last_read_seq`), inbox query + index |
| CHAT-04 | Real-time delivery on private channels; browser only receives signals | §Chat publishing (AFTER INSERT definer trigger → `realtime.send` ids only), §catch-up cursor |
| CHAT-05 | Member unread badge when support replied | §Counters (`last_staff_seq > last_read_seq` → dot), D-237 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the planner must honour (from `.claude/CLAUDE.md` and memory notes passed in the prompt):

- **All business logic goes through the Hono API on Cloud Run.** The only sanctioned browser↔Supabase paths are (1) Supabase Auth via `@supabase/ssr` in the Next server and (2) **read-only** Realtime Broadcast subscriptions; data is always fetched through the API.
- **Realtime = Supabase Broadcast on private channels**, never Postgres Changes, never WebSockets/Socket.IO on Cloud Run, no Redis/Memorystore.
- **Uploads never pass through the API**; not relevant this phase (no chat attachments, V2-CHAT-02).
- **Tenant data only through `withTenantTx`**; `withAdminTx` is kernel-only (Biome `noRestrictedImports`); modules may not import `@rede-social/core/db`; every setting is LOCAL (`pnpm guard:lanes`).
- **Module boundaries:** a module depends on the kernel, `@rede-social/contracts` and tooling only (`turbo.json` boundaries: `"module": { "dependencies": { "allow": ["kernel", "contracts", "tooling"] } }`) — **a module may not import another module's package**. The app tier (`apps/api`, `apps/web`) is the composition point.
- **Migrations:** Drizzle TS is the source of truth; `pnpm db:generate`; hand-written SQL (functions, triggers, grants, `realtime.messages` policies) goes in `--custom` migrations; only the Supabase CLI applies. Never `drizzle-kit migrate/push`.
- **Tests gate:** every new tenant table gets a pgTAP isolation case (020) and every new endpoint a cross-tenant case in `apps/api/tests/integration/isolation.test.ts`; policies need cross-tenant negatives.
- **pt-BR UI, all strings in the catalog** (`apps/web/messages/pt-BR/*.json`, `scripts/check-ui-literals.sh`).
- **Tech pins:** Node 24, TypeScript 7.0.2, Next 16.3.5, Hono 4.13.7, Zod 4.6.2, Drizzle 0.45.2, pg-boss 12.31.0, `web-push` 3.6.7, `@supabase/realtime-js` 2.116.0, `@serwist/turbopack` 9.5.12, Vitest 5, Playwright 1.63, Biome 2.5.
- **VAPID:** private key only in the API/worker (Secret Manager); `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel.
- **Hosted config** (Realtime private-only, VAPID secrets, env vars) is written as **user-run steps in `docs/DEPLOY.md`**, never assumed done. Production is live (Free plan, sa-east-1; Cloud Run `api` + `worker`; Vercel gru1).
- **Never write the retired workspace/brand names in any file** (see the project notes in the planning prompt). Seed tenants are `rede-demo` / `rede-lab`. (Note: the local DB still carries pre-rename slugs until the next `db:reset`; plans must reference `rede-demo`/`rede-lab`.)
- **Commits:** no `Co-Authored-By` trailer (public repo). GSD execution is sequential (no parallel worktrees; one local Supabase stack).
- **Integration test commands:** `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts` (the root `test:integration -- <x>` does not filter).
- **Turbo cache fills the disk:** run long gates with `TURBO_CACHE=local:r` and prune `.turbo/cache`.

## Summary

Phase 7 is the first **cross-module consumer** in the codebase, and the repo's module boundary makes that the central design problem. `turbo.json` forbids a module from depending on another module, and every producer payload is ids-only by contract (06-01: "reminder copy reads the title through a published events contract"). A `notifications` module therefore cannot import feed/stories/events to read a post excerpt, an event title or the list of `Vou` members. The recommended answer is a **kernel seam in the manifest**: each *producer* module declares `notificationSources` (event name → `resolve(tx, payload)` returning notification *intents*: audience, kind, dedupe key, target, display facts, channels). The kernel owns only the shape. The notifications module is the *sink*: a bus subscriber (wired by the app registry) enqueues one pg-boss fan-out job per event, and the worker resolves the source inside the tenant lane and delivers through channel adapters (`in_app`, `push`). Producers keep ownership of their data and their audience rules. The consumer owns delivery, and neither imports the other (MOD-02/03).

The Realtime layer was verified against the local stack (Realtime v2.130.0, Postgres 17.6). **There is no custom access token hook in this project.** `app.tenant_id()` reads a `tenant_id` claim that only `withTenantTx` injects, and the real Supabase JWT that Realtime evaluates does not carry it. `memberships` is itself RLS-scoped by that claim. A `realtime.messages` policy can therefore use neither JWT claims nor a plain membership join. It must call a **`SECURITY DEFINER` function** `app.realtime_topic_allowed(topic)` that parses the topic and checks `memberships` / `chat_participants` / role, keyed by the JWT `sub`. This is SCHEMA-CONVENTIONS §(a)5 applied as written. `realtime.send(...)` is `SECURITY INVOKER` and **swallows errors as a WARNING**. Called from the tenant lane, it would be silently refused by RLS, so every publish must run in definer context: an AFTER INSERT trigger for chat and an `app.realtime_signal()` wrapper for notifications. Both publish only inside the writer's transaction, so a rollback publishes nothing. `broadcast_changes` is rejected because it ships the whole row (message bodies), which breaks "ids only".

On the Free plan, Realtime allows 200 concurrent connections, 100 messages/s and 2 M messages/month, and a broadcast counts 1 sent plus 1 per receiving client. That rules out per-member broadcasts for "every member" kinds, because a 300-member fan-out would be a 300-message burst. The recommended approach is one broadcast on a tenant-wide signal topic, plus per-user topics for personal kinds and chat badges. Chat `seq` comes from a **counter column on the conversation, incremented under its row lock** by a BEFORE INSERT trigger. This gives gapless numbering, commit order equal to seq order, and a trivially correct "after seq N" catch-up. Web Push uses `web-push` 3.6.7 with per-recipient payloads (so the SW can set the app badge), TTL/urgency/`Topic` set per kind, and 404/410 deleting the subscription. The Serwist `sw.ts` gains `push`/`notificationclick`/`pushsubscriptionchange` handlers that suppress the banner only on Chromium/Firefox when a window is focused. EVENT-07 is best armed **by the events module inside its own write transactions** (durable `enqueueInTx` deferred jobs keyed by `startsAt`). At fire time a stale or cancelled event is a no-op, and a live one emits `event.reminder_due`, which flows through the same notification source seam.

**Primary recommendation:** Build the kernel seams first (notification sources + sink, sweep-function registry, counters provider), the Realtime authorization migration (definer function + select-only policy + `app.realtime_signal`) and ONE broadcast kind end to end (`post.published` → live bell count), with pgTAP and a real `RealtimeClient` integration test. Then add the remaining kinds, push and chat on the same rails.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deciding who is notified (audience, kind, target, facts) | API/worker — **producer module** `notificationSources` | Kernel (seam shape) | Only the producer may read its own tables (turbo boundaries); ids-only payloads need a read |
| Fan-out, dedupe, channel delivery, pruning | Worker — `notifications` module jobs | Database (unique index, definer prune fn) | Never inside the producing request (PITFALLS §15); idempotency by index |
| Realtime authorization | Database (`realtime.messages` select policy + `app.realtime_topic_allowed` definer) | — | Realtime evaluates RLS with the user's JWT; no claim hook exists |
| Publishing signals | Database (chat AFTER INSERT trigger; `app.realtime_signal` from worker/API tx) | — | Transactional (rollback = no publish), writer-agnostic |
| Browser Realtime connection | Browser (`@supabase/realtime-js`, subscribe-only) | Frontend server (BFF `GET /api/realtime/token`) | Tokens stay in HttpOnly cookies; JS gets an in-memory access token only |
| Counters (bell unseen, chat dot/count) | API (`/v1/me/bootstrap`, `/v1/me/counters` composed from manifests) | Browser (live refetch on signal/refocus) | Data always via API (D-240) |
| Push subscribe/unsubscribe | Browser (PushManager, gesture) → BFF → API | Database (`push_subscriptions`) | iOS needs user gesture; server owns subscription rows |
| Push send | Worker (`web-push`, VAPID private key) | — | Secrets never on Vercel; retries via pg-boss |
| Push display / click / badge | Browser service worker (`apps/web/app/sw.ts`) | — | Only the SW can show notifications for a closed app |
| Chat ordering (`seq`) | Database (BEFORE INSERT trigger + counter row lock) | API (validation) | Serialisation must hold for every writer |
| Reminder scheduling | Worker — `events` module (deferred jobs armed in-tx) | notifications (delivery) | Events owns time/cancel/RSVP truth |
| iOS install gate, soft-ask, settings switch | Browser | — | UA/display-mode detection is client-only |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/realtime-js` | 2.116.0 (pin; already in the lockfile via `@supabase/supabase-js@2.116.0`) | Browser subscribe-only Realtime client | CLAUDE.md stack; `accessToken` callback mode re-auths on every heartbeat [VERIFIED: node_modules/.pnpm/@supabase+realtime-js@2.116.0 dist/module/RealtimeClient.js] |
| `web-push` | 3.6.7 | VAPID Web Push send from the worker | CLAUDE.md stack; exposes `generateRequestDetails` for deterministic header tests [VERIFIED: npm registry + source tarball] |
| `@types/web-push` | 3.6.4 | Types for `web-push` | DefinitelyTyped [VERIFIED: npm registry] |
| `pg-boss` | 12.31.0 (installed; do not bump this phase) | Fan-out, push-send, reminder jobs | Already the repo's queue; `short` policy + `singletonKey` [VERIFIED: packages/core/server/jobs/boss.ts:65] |
| `serwist` / `@serwist/turbopack` | 9.5.12 (installed) | SW event handlers live in `app/sw.ts` | Already wired [VERIFIED: apps/web/app/sw.ts] |
| Supabase Realtime (hosted/local) | local image `realtime:v2.130.0` | Broadcast from Database, private channels | [VERIFIED: docker ps] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@rede-social/ui` `InfiniteScroll` | workspace | Notification list, staff inbox | D-231 |
| `packages/core/server/paging.ts` | workspace | Keyset cursor for the notification list and inbox | D-231 |
| Existing `linkify` (`packages/modules/feed/ui/linkify.tsx`) | workspace | Chat auto-link | **Cannot be imported by `module-chat`** (module→module); re-home into `@rede-social/ui` or kernel UI, or restate (see Pitfalls) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Definer function in the policy | Custom Access Token Hook adding `tenant_id` | New hosted auth config, claim stale until refresh (1 h), breaks under V2 multi-membership; still needs a participant join for conv topics. Rejected. |
| `realtime.send` from definer code | `realtime.broadcast_changes` trigger | Ships `new`/`old` records (message body) → violates ids-only. Rejected. |
| API → Realtime REST `POST /realtime/v1/api/broadcast` | — | Not transactional (can broadcast a rolled-back write), needs the service key in the API. Rejected for data signals. |
| Counter-row seq | Postgres sequence / advisory lock + `max(seq)+1` | Sequence: gaps and commit order ≠ seq order (a reader can see 6 before 5). Advisory lock: extra scan, lock-key discipline. Rejected. |
| Per-member broadcast for D-226 kinds | Tenant-wide `tenant:<t>:all` signal | Per-member = N messages per publish (Free 100 msg/s). Tenant topic = 1 + online receivers. |
| Periodic reminder scan | Deferred per-event jobs | A scan must read events cross-tenant (admin lane is kernel-only; a definer reachable from the tenant lane would leak other tenants' event times). Deferred jobs armed in-tx need neither. |
| Imperative SW push | Declarative Web Push (`web_push: 8030`) | iOS/iPadOS 18.4+ only; Chrome/Android still need the SW path. Keep the imperative SW in V1; shape the payload so the switch is one server change. |

**Installation:**
```bash
# worker/API side (module owning push) — ALSO declare in apps/api so tsup externalises it (Pitfall 12)
pnpm --filter @rede-social/module-notifications add web-push@3.6.7
pnpm --filter @rede-social/module-notifications add -D @types/web-push@3.6.4
pnpm --filter @rede-social/api add web-push@3.6.7
# browser Realtime client (kernel UI provider) — exact pin, same version as supabase-js
pnpm --filter @rede-social/core add @supabase/realtime-js@2.116.0
```

**Version verification (2026-09-29):** `web-push` latest 3.6.7 (published 2024-01-16); `@types/web-push` 3.6.4; `@supabase/realtime-js` latest 2.117.2 (2026-09-25) but **2.116.0 (2026-09-07) is the pin** matching `@supabase/supabase-js@2.116.0` already installed; `pg-boss` latest 12.35.0, installed 12.31.0 (no upgrade: the queue schema is a reviewed migration, and an upgrade needs a new custom migration per `boss.ts`).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `web-push` | npm | 3.6.7 published 2024-01-16 (lib ~10 yrs) | ~10.3M/wk | github.com/web-push-libs/web-push | OK | Approved (no postinstall) |
| `@types/web-push` | npm | 3.6.4 | ~5.2M/wk | github.com/DefinitelyTyped/DefinitelyTyped | OK | Approved |
| `@supabase/realtime-js` | npm | latest 2.117.2 is 4 days old; **pin 2.116.0 (22 days)** | ~32M/wk | github.com/supabase/supabase-js | SUS (reason: `too-new`, about the *latest* tag) | Flagged — planner adds `checkpoint:human-verify` before install; install the exact 2.116.0 already present transitively |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@supabase/realtime-js` `[WARNING: flagged as suspicious — verify before using.]` The flag comes from the registry's newest version, not from the pinned one. The package is CLAUDE.md's named client and is already resolved in the lockfile at 2.116.0. It still gets a human checkpoint, per protocol (previous phases recorded per-phase approvals, e.g. 02-02, 03-06).

## Architecture Patterns

### System Architecture Diagram

```
                        ┌──────────────────────── API request (Cloud Run api) ────────────────────────┐
 admin publishes post ─►│ feed service: withTenantTx(insert post) ─commit─► emit('post.published')     │
 member likes comment ─►│ ... ─commit─► emit('comment.liked')                                          │
 member/staff sends msg►│ chat service: withTenantTx(insert chat_messages)                             │
                        │      └─ BEFORE INSERT trigger: seq = ++conversation.last_seq (row lock)       │
                        │      └─ AFTER INSERT definer trigger: realtime.send(ids) → conv/inbox/user    │
                        │   ─commit─► emit('chat.message_sent')                                         │
                        │ flushEventsAfterHandler ─► bus subscriber (app registry wiring):              │
                        │      has a notificationSource for this event? && notifications enabled?       │
                        │        └─ withTenantTx(system ctx) → enqueueInTx('notifications.fanout',      │
                        │                                         {event, tenantId, payload})           │
                        └────────────────────────────────────────────┬─────────────────────────────────┘
                                                                     │ pg-boss (pgboss schema)
                        ┌──────────────── Worker (Cloud Run worker) ─▼─────────────────────────────────┐
                        │ notifications.fanout: withTenantTx(system ctx)                                │
                        │   source.resolve(tx, payload) ──(producer module reads its own tables)──►     │
                        │   intents[] {kind, audience, dedupeKey, subject, facts, channels}             │
                        │   ├─ in_app adapter: INSERT … SELECT memberships … ON CONFLICT DO NOTHING     │
                        │   │      RETURNING user_id; app.realtime_signal('all'|'user:<u>', …)          │
                        │   └─ push adapter: enqueue notifications.push-send per new recipient batch    │
                        │ notifications.push-send: web-push → FCM / Mozilla / APNs endpoints            │
                        │   404/410 → DELETE subscription; 429/5xx → throw (pg-boss retry)              │
                        │ events.reminder (armed in-tx at create/edit/reactivate, startAfter):          │
                        │   still active && starts_at == payload.startsAt && inside window?             │
                        │     yes → emit('event.reminder_due') + flush → fan-out as above               │
                        │ kernel.media-sweep-orphans (hourly) → registered sweep fns                    │
                        │   → app.notifications_prune(batch) (90 days)                                  │
                        └──────────────────────────────────────────────────────────────────────────────┘
                                        │ realtime.messages (WAL, committed rows only)
                        ┌───────────────▼ Supabase Realtime ───────────────────────────────────────────┐
                        │ join private channel → RLS select policy →                                    │
                        │   app.realtime_topic_allowed(realtime.topic())  [cached per connection]       │
                        └───────────────┬──────────────────────────────────────────────────────────────┘
                                        │ ids-only broadcast
 Browser (PWA) ── RealtimeProvider (accessToken ← GET /api/realtime/token, cached until ~exp)
   topics: tenant:<t>:user:<u>, tenant:<t>:all, [staff] tenant:<t>:support-inbox, [open thread] tenant:<t>:conv:<c>
   on signal / SUBSCRIBED / visibilitychange→visible:
      refetch counters (BFF → GET /v1/me/counters), refetch open list/thread (messages after seq N)
      navigator.setAppBadge(unseen + chat)
 Service worker: push → showNotification (skip if focused & Chromium/Firefox) + setAppBadge(payload.badge)
                 notificationclick → focus/navigate client or openWindow(url)
```

### Recommended Project Structure

```
packages/core/server/notifications/        # KERNEL SEAM (shape only, no module knowledge)
├── source.ts        # NotificationIntent, NotificationSource<K>, registerNotificationSources, sourceFor(event)
├── sink.ts          # setNotificationSink / notificationSink (setPermissionResolver pattern)
└── realtime.ts      # topic builders (tenantTopic, userTopic, convTopic, inboxTopic) + signal event names
packages/core/server/modules/manifest.ts   # + notificationSources?, counters?, sweepFunctions?
packages/core/server/media/sweep-job.ts    # + runs registered sweep functions (kernel executes by name)
packages/core/ui/realtime/                 # RealtimeProvider, useRealtimeTopic, useLiveCounters (client-safe)

packages/modules/notifications/
├── module.ts        # key 'notifications', nav {placement:'topbar', icon:'bell', badge:'unreadNotifications'}, jobs, counters
├── contracts/       # list/row/counters/push-subscription Zod schemas, queue names, signal events
├── db/schema.ts     # notifications (moved from core stub), push_subscriptions
├── server/
│   ├── routes.ts    # GET /v1/notifications, POST …/seen, POST …/{id}/read, POST …/read-all, push-subscriptions CRUD
│   ├── service.ts
│   ├── fanout-job.ts
│   ├── channels/{types.ts,registry.ts,in-app.ts,push.ts}
│   ├── push/{send-job.ts,transport.ts (web-push | fake),payload.ts}
│   └── sink.ts      # the bus → enqueue bridge registered on the kernel seam
└── ui/              # NotificationItem, NotificationList (ported), SoftAskCard, PushSwitchRow (props-only)

packages/modules/chat/
├── module.ts        # key 'chat', nav {placement:'topbar', icon:'message-circle', badge:'unreadConversations', href:'/suporte'}, perms, notificationSources (chat.message_sent → push-only)
├── contracts/  db/schema.ts (chat_* moved from core stub)  server/{routes,service}.ts  ui/ (bubbles, composer, inbox rows)

packages/modules/{feed,stories,events}/server/notifications.ts   # each producer's notificationSources
packages/modules/events/server/reminders.ts                      # arm + reminder job

supabase/migrations/<ts>_realtime_authorization.sql   (--custom)  definer fns + realtime.messages policy
supabase/migrations/<ts>_notifications.sql            (generated)  reshape + push_subscriptions
supabase/migrations/<ts>_notifications_functions.sql  (--custom)  app.realtime_signal, app.notifications_prune, push upsert definer
supabase/migrations/<ts>_chat.sql                     (generated)  reshape columns + CHECKs
supabase/migrations/<ts>_chat_functions.sql           (--custom)  seq trigger + broadcast trigger
supabase/tests/150-realtime-authorization.sql  151-notifications.sql  152-chat.sql
apps/web/app/api/realtime/token/route.ts   apps/web/app/api/me/counters/route.ts
apps/web/app/(app)/notificacoes/page.tsx   apps/web/app/(app)/suporte/page.tsx (+ [conversationId] for staff)
apps/web/lib/push.ts (client subscribe flow)  apps/web/app/sw.ts (+ handlers)  apps/web/lib/push-sw.ts (pure handler logic, unit-tested)
```

### Pattern 1: Producer-declared notification sources (the cross-module seam)

**What:** The kernel manifest gains `notificationSources`. A producer (feed, stories, events, chat) declares, per domain event, a `resolve(tx, payload)` that runs **in the worker, inside the tenant lane**, reads the producer's own tables and returns intents. The notifications module registers the *sink* through a kernel seam, the same inversion as `setPermissionResolver` and `registerJobQueues` [VERIFIED: apps/api/src/modules/registry.ts:43-48, 159].

**Why this shape:** `turbo.json` forbids module→module dependencies (`"module": { "dependencies": { "allow": ["kernel", "contracts", "tooling"] } }`) [VERIFIED: turbo.json]. Payloads are ids-only, so someone must read the excerpt, the event title and the `Vou` list. Only the producer may read its own tables. The notifications module still "never enumerates other modules' types" (CONTEXT), and removing either module removes its half cleanly (MOD-03).

**Example (shape, not final code):**
```typescript
// packages/core/server/notifications/source.ts — KERNEL, shape only
import type { DomainEventName, EventMap } from '@rede-social/contracts';
import type { Tx } from '../../db/tenant-tx';

export type NotificationChannelKey = 'in_app' | 'push';

export interface NotificationIntent {
  kind: string;                                  // 'feed.post', 'feed.reel', 'feed.comment_reply', 'events.reminder_1h', 'chat.support_reply' …
  audience: { type: 'members' } | { type: 'users'; userIds: string[] }; // 'members' = role 'member', active, not blocked
  excludeUserIds: string[];                      // the author/actor (D-229)
  dedupeKey: string;                             // 'feed.comment_liked:<commentId>:<actorId>' (unlike/re-like safe)
  subject: { type: string; id: string };         // routing + retraction ('post', <postId>)
  object?: { type: string; id: string } | null;  // e.g. the comment inside the post
  actorUserId: string | null;
  facts: Record<string, string | number | boolean | null>; // excerpt ≤80, title, startsAt … (data, not sentences)
  channels: NotificationChannelKey[];            // likes: ['in_app']; support reply: ['push']; else both
  push?: { tag: string; topic: string; ttlSeconds: number; urgency: 'normal' | 'high'; body: string } | null;
}

export interface NotificationSource<K extends DomainEventName = DomainEventName> {
  event: K;
  resolve: (tx: Tx, payload: EventMap[K]) => Promise<NotificationIntent[]>;
}
// Retractions (deleted targets) use the same seam:
export interface NotificationRetraction<K extends DomainEventName = DomainEventName> {
  event: K;
  match: (payload: EventMap[K]) => { subjectType: string; subjectId: string } | { objectType: string; objectId: string };
}
```

The app registry wires it once at import time, like event subscriptions today:
```typescript
// apps/api/src/modules/registry.ts (addition)
for (const manifest of Object.values(MODULE_REGISTRY)) {
  for (const source of manifest?.notificationSources ?? []) {
    registerNotificationSource(source);                                   // kernel map: event -> sources
    subscribe(source.event, (payload) => notificationSink()(source.event, payload)); // sink = notifications module
  }
}
```
If the notifications module is absent, the sink is a no-op. If it is disabled for the tenant (`moduleFlags`), the sink returns without enqueueing.

### Pattern 2: Realtime authorization with a definer function (no claim hook)

**Facts that force the shape (all verified this session):**
- `app.tenant_id()` = ``select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id', '')::uuid`` [VERIFIED: supabase/migrations/20260912030541_app_helpers.sql:20-23]. Only `withTenantTx` puts `tenant_id` in the claims [VERIFIED: packages/core/db/tenant-tx.ts:25-32].
- No custom access token hook is configured: `supabase/config.toml` keeps `# [auth.hook.custom_access_token]` commented and no migration defines one [VERIFIED: grep + config.toml:330-332]. Realtime evaluates policies with the user's own JWT in `request.jwt.claims` [CITED: supabase.com/docs/guides/realtime/authorization], so `tenant_id` is absent there.
- `memberships` has only the policy `memberships_tenant_select … using: sql\`tenant_id = app.tenant_id()\`` [VERIFIED: packages/core/db/schema/memberships.ts:47-51], so a plain subquery on `memberships` from a `realtime.messages` policy sees **nothing**.
- `postgres` has `rolbypassrls = t` and `authenticated` does not [VERIFIED: local pg_roles]. A `SECURITY DEFINER` function owned by the migration role reads memberships freely, and must scope itself (SCHEMA-CONVENTIONS §(a)5, §(l)2).
- Realtime authorization runs on join and on an `access_token` message, and the result is cached for the connection. "If you revoke a user's access while they're still connected, they'll keep receiving messages until their JWT expires or a new one is sent." [CITED: supabase.com/docs/guides/realtime/authorization]
- `realtime.messages` has RLS enabled and **zero policies** locally [VERIFIED: local `pg_policy` query]. `authenticated` holds INSERT/SELECT/UPDATE grants on it [VERIFIED: information_schema.role_table_grants].

**Recommendation:** one SELECT policy for `authenticated`, and **no INSERT policy**, so browsers can never send (enforcing "read-only" in the database):
```sql
-- --custom migration: <ts>_realtime_authorization.sql
create or replace function app.realtime_topic_allowed(p_topic text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := app.user_id();          -- JWT 'sub' (present in Realtime's claims)
  v_parts text[];
  v_tenant uuid;
  v_role text;
begin
  if v_user is null or p_topic is null then return false; end if;
  -- tenant:<uuid>:<rest…>  — validate BEFORE any ::uuid cast (a bad cast would raise, not deny)
  if p_topic !~ '^tenant:[0-9a-f-]{36}:(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$' then
    return false;
  end if;
  v_parts := string_to_array(p_topic, ':');
  v_tenant := v_parts[2]::uuid;

  select m.role into v_role
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.tenant_id = v_tenant and m.user_id = v_user
     and m.status = 'active' and m.blocked_at is null and m.deleted_at is null
     and t.status = 'active';                         -- (check the tenants.status vocabulary before coding)
  if v_role is null then return false; end if;        -- not a live member of THAT tenant

  if v_parts[3] = 'all' then
    return app.module_enabled(v_tenant, 'notifications');
  elsif v_parts[3] = 'user' then
    return v_parts[4]::uuid = v_user;                 -- only your own user topic
  elsif v_parts[3] = 'support-inbox' then
    return v_role in ('admin_tenant', 'support_tenant') and app.module_enabled(v_tenant, 'chat');
  elsif v_parts[3] = 'conv' then
    return app.module_enabled(v_tenant, 'chat') and exists (
      select 1 from public.chat_conversations c
       where c.id = v_parts[4]::uuid and c.tenant_id = v_tenant
         and ( exists (select 1 from public.chat_participants p
                        where p.conversation_id = c.id and p.user_id = v_user)
               or (c.kind = 'support' and v_role in ('admin_tenant', 'support_tenant')) ));
  end if;
  return false;
end $$;
revoke all on function app.realtime_topic_allowed(text) from public;
grant execute on function app.realtime_topic_allowed(text) to authenticated;

create policy realtime_tenant_topics_select on realtime.messages
  for select to authenticated
  using ( realtime.messages.extension = 'broadcast'
          and (select app.realtime_topic_allowed((select realtime.topic()))) );
```

- **Role list vs `chat.support` permission:** the database cannot see TypeScript `defaultRolePermissions`. Use the literal role list `('admin_tenant','support_tenant')` in ONE SQL helper, and pin it with a test that compares it with `permissionsFor(role, allEnabled)` for every `TENANT_ROLES` entry (D-223 makes both roles holders). Cost: one duplicated fact, test-pinned. The alternative (a `support_agents` table) adds writes on every role change for no V1 gain.
- **Blocked mid-session:** after a block, the next join or token push re-evaluates the policy and refuses. Until then an already-joined channel keeps receiving **ids-only** signals, and every follow-up API read is refused by `requireAuth` (AUTH-06), so no data leaks. The web's blocked flow (`/auth/blocked` clears cookies) must also call `realtime.disconnect()`. Worst-case residual: `jwt_expiry` (3600 s locally [VERIFIED: supabase/config.toml:201]; check the hosted value in the dashboard). Accept this and document it in the threat model.
- **Private-only:** the hosted toggle "Allow public access" = Management API `PATCH /v1/projects/{ref}/config/realtime { "private_only": true }` [CITED: supabase.com/docs/reference/api/v1-update-realtime-config]. This is a **DEPLOY.md user step**. The local tenant row is `realtime-dev | private_only = f` [VERIFIED: `_realtime.tenants`]. There is no `config.toml` key for it [CITED: github.com/orgs/supabase/discussions/40417]. Locally, rely on every broadcast being `private => true` and the client always joining with `config: { private: true }`, and pin with a test that a **non-private** join to the same topic receives nothing.

### Pattern 3: Publishing — definer trigger for chat, definer wrapper for notifications

`realtime.send` as installed [VERIFIED: `pg_get_functiondef` on the local stack]:
```
CREATE OR REPLACE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
 RETURNS void LANGUAGE plpgsql            -- SECURITY INVOKER
 … EXECUTE format('SET LOCAL realtime.topic TO %L', topic);
   INSERT INTO realtime.messages (id, payload, event, topic, private, extension) VALUES (…, 'broadcast');
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
```
Consequences:
1. **Invoker + RLS + no INSERT policy** ⇒ calling it from the tenant lane (`authenticated`) fails RLS, and the failure is **swallowed as a WARNING**: a silent no-op. Every publish must run in a `SECURITY DEFINER` function owned by the migration role (bypassrls).
2. It is transactional: the row is inserted inside the caller's transaction, and Realtime reads `realtime.messages` through logical replication of the WAL [CITED: supabase.com/blog/realtime-broadcast-from-database]. Only committed rows are decoded, so **a rolled-back write publishes nothing** [CITED: Postgres logical decoding emits committed transactions; pinned by a test below].
3. It sets `realtime.topic` LOCAL in the caller's transaction. That is harmless, but do not rely on `realtime.topic()` elsewhere in the same transaction.

**Chat:** `AFTER INSERT ON chat_messages FOR EACH ROW` definer trigger → `realtime.send(jsonb_build_object('conversationId', NEW.conversation_id, 'seq', NEW.seq), 'chat.message', 'tenant:'||NEW.tenant_id||':conv:'||NEW.conversation_id, true)`. It also publishes to `tenant:<t>:support-inbox` (kind = support), and to `tenant:<t>:user:<member>` when the author side is staff (member dot). Low volume, and every writer (API, seed, tests) publishes automatically.

**Notifications:** fan-out inserts many rows in one statement, so use no row trigger (it would multiply sends). Use an explicit wrapper that can only publish inside the caller's own tenant:
```sql
create or replace function app.realtime_signal(p_suffix text, p_event text, p_payload jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid := app.tenant_id();
begin
  if v_tenant is null or p_suffix !~ '^(all|support-inbox|user:[0-9a-f-]{36}|conv:[0-9a-f-]{36})$' then
    raise exception 'realtime_signal: refused' using errcode = '42501';
  end if;
  perform realtime.send(p_payload, p_event, 'tenant:' || v_tenant || ':' || p_suffix, true);
end $$;
revoke all on function app.realtime_signal(text, text, jsonb) from public;
grant execute on function app.realtime_signal(text, text, jsonb) to authenticated;
```
Called by the fan-out job (system lane of the tenant) and by the seen/read routes, so a user's other tabs and devices update too.

### Pattern 4: Topic plan and quota math (Free plan)

Free plan: **200** concurrent connections, **100** messages/s, **100** channel joins/s, **100** channels per connection, 3,000 KB broadcast payload [CITED: supabase.com/docs/guides/realtime/limits]. **2 million** messages/month and 200 peak connections, with no overage billing on Free (grace period) [CITED: supabase.com/docs/guides/realtime/pricing]. "Each broadcast message counts as one message sent plus one message per subscribed client that receives it." [CITED: supabase.com/docs/guides/platform/manage-your-usage/realtime-messages]. The limits page does not say whether "messages per second" counts deliveries, so treat bursts conservatively.

| Topic | Who may join | Published by | Signal (ids only) |
|-------|--------------|--------------|-------------------|
| `tenant:<t>:all` | any live member of `<t>` (notifications on) | fan-out for D-226 kinds (1 per publish) | `notifications.changed` `{kind}` |
| `tenant:<t>:user:<u>` | only `<u>` | personal fan-out, seen/read routes, chat staff-reply trigger | `notifications.changed`, `chat.unread` `{conversationId, seq}` |
| `tenant:<t>:support-inbox` | staff roles (chat on) | chat trigger (member or staff message), read route | `chat.message` / `chat.read` `{conversationId, seq}` |
| `tenant:<t>:conv:<c>` | participants + staff (support kind) | chat trigger | `chat.message` `{conversationId, seq}` |

**Sizing example** (assumption: 300 members, peak 40 concurrent app windows, per day 3 posts + 3 stories + 1 reel + 0.2 events, ~100 personal notifications, ~30 chat messages):
- D-226 kinds: ~7/day × (1 + ~20 online) ≈ 150 msgs/day. Per-member topics would have cost 7 × 300 = 2,100 sends/day **and** 300-message bursts, which is above 100 msg/s. **Hence the tenant topic.**
- Personal: ~100 × 2 = 200/day. Chat: ~30 × (conv 1+2 + inbox 1+2 + user 1+1) ≈ 240/day.
- Total ≈ 600/day ≈ 18k/month, **< 1 % of the 2 M quota**. Connections at 40/200. Joins: ≤ 4 channels per window, and a reconnect storm of 40 × 4 = 160 joins can briefly exceed 100/s. realtime-js retries with backoff, and D-240 refetch makes a missed signal harmless.
- **Connection hygiene:** one `RealtimeClient` per window (multiplexes channels). Disconnect when `document.hidden` for > 60 s and reconnect on visible (iOS suspends sockets anyway). This keeps peak connections ≈ foreground users.
- Upgrade trigger: > ~150 simultaneous foreground windows, or observed `too_many_connections`/`tenant_events` errors → Pro (V2-PLAT-06). Record this in DEPLOY.md.

### Pattern 5: Browser token for Realtime without weakening the cookie model

`sb-*` cookies are `httpOnly: true, sameSite: 'lax'` [VERIFIED: apps/web/lib/supabase/cookie-options.ts:9-14]. Add a BFF route `GET /api/realtime/token`:
1. Refuse unless `Sec-Fetch-Site: same-origin`. A same-origin GET often carries no `Origin`, so the `/api/stories/views` Origin check does not transfer.
2. `createClient()` → `getClaims()` (verifies via JWKS and refreshes if expired, writing refreshed cookies) → `getSession()` → answer `{ accessToken, expiresAt }` with `Cache-Control: no-store`. Answer 401 with no body on a missing session.
3. Client: `new RealtimeClient(`${SUPABASE_URL}/realtime/v1`, { params: { apikey: PUBLISHABLE_KEY }, accessToken: cachedToken })`. `cachedToken` returns the in-memory token and only refetches when `expiresAt - now < 120 s`. realtime-js calls the callback **on every heartbeat (25 s)** and pushes the token to every joined channel only when it changed [VERIFIED: RealtimeClient.js `_wrapHeartbeatCallback` → `_setAuthSafely`, `_performAuth` compares `accessTokenValue != tokenToSend`; `HEARTBEAT_INTERVAL: 25000`]. Without the cache it would hit the BFF every 25 s.
- The token lives in JS memory only (never localStorage). Residual risk: XSS can call the same route, which is no worse than XSS calling server actions today. CSP hardening is Phase 8.
- **Side effect to guard:** a raw user JWT is now available to page JS, and the project exposes PostgREST (`authenticated` has table grants [VERIFIED: 20260912031029 migration]). Policies stay safe only because each ANDs `tenant_id = app.tenant_id()` (NULL without the claim). **Every new policy in this phase must keep the `tenant_id = app.tenant_id()` conjunct.** A policy keyed on `user_id = app.user_id()` alone would expose a user's own rows over PostgREST.

### Pattern 6: Fan-out mechanics (eager rows, one statement)

- **Where it runs:** `notifications.fanout` job in the worker. The bus subscriber only enqueues: `withTenantTx(systemCtx(tenantId), tx => enqueueInTx(tx, 'notifications.fanout', { event, tenantId, payload }))`. The synthetic context follows the feed unfurl precedent `{ userId: '00000000-0000-0000-0000-000000000000', tenantId, role: 'member', requestId: 'job', events: [] }` [VERIFIED: packages/modules/feed/server/unfurl/job.ts:190-197].
- **Audience `members`** is one statement. RLS on `memberships` admits it because the lane has the tenant claim:
```sql
insert into notifications (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id,
                           object_type, object_id, actor_user_id, facts)
select m.tenant_id, m.user_id, $kind, $dedupe, $st, $sid, $ot, $oid, $actor, $facts::jsonb
  from memberships m
 where m.tenant_id = app.tenant_id() and m.role = 'member' and m.status = 'active'
   and m.blocked_at is null and m.deleted_at is null and m.user_id <> all($exclude::uuid[])
on conflict (tenant_id, user_id, dedupe_key) do nothing
returning user_id;
```
  At pilot scale (hundreds to a few thousand members) one statement is fine. Add chunking by `user_id` ranges only when a tenant passes ~5k members.
- **Idempotency:** `unique (tenant_id, user_id, dedupe_key)` replaces the stub's `notifications_event_user_uq on (event_id, user_id) where event_id is not null` [VERIFIED: packages/core/db/schema/notification-stubs.ts:38-40]. The bus records carry no event id (`DomainEventRecord = { name, payload, tenantId, occurredAt }` [VERIFIED: packages/contracts/src/events.ts:23-28]), and the handler receives only the payload [VERIFIED: bus.ts:75]. A **natural key** from the payload is therefore both available and better: `feed.post:<postId>`, `feed.comment_liked:<commentId>:<actorId>` (unlike/re-like cannot duplicate), `feed.comment_reply:<replyId>`, `stories.story:<storyId>` (dedupes the documented `story.published` + `story.highlighted` double event [VERIFIED: packages/modules/stories/server/service.ts:388-390]), `events.event:<eventId>`, `events.reactivated:<eventId>:<n>`, `events.reminder_24h:<eventId>` / `…_1h`. The stub table has no production writer, so reshaping it is safe (Pitfall 9).
- **Push only for newly inserted rows** (the `returning` set), so a retried job never re-pushes.
- **Exclusions (D-229):** `role = 'member'` for D-226 kinds; the actor always in `excludeUserIds`; personal kinds use `audience.users` filtered by the same live-membership predicate (a staff comment author still gets a reply notification).
- **Deleted targets:** recommend **delete** on `post.deleted`, `comment.deleted`, `story.deleted`, `story.comment_deleted` via `NotificationRetraction` (`delete … where subject_type/id or object_type/id`), plus a legible fallback at the target route for anything missed (expired story, at-most-once gaps). Deleting also avoids keeping an excerpt of removed content (privacy).
- **Pruning (D-231 "existing hourly sweeper"):** the kernel sweeper cannot name a module table, and modules cannot use the admin lane. Add a manifest field `sweepFunctions: ['notifications_prune']`. The kernel sweeper runs `select app.<fn>(500)` through `withAdminTx` with `sql.identifier` (a name from code, never input). `app.notifications_prune(p_batch int)` is a definer deleting `created_at < now() - interval '90 days'` in bounded batches (`delete … where id in (select id … order by created_at limit p_batch)`) and needs an index on `created_at`. Stories: keep 90 days; the tap fallback covers expiry.
- **At-least-once gap (answering the research question):** `emit` runs **after** `withTenantTx` returns (e.g. `createPost` emits at service.ts:844 outside the transaction [VERIFIED: packages/modules/feed/server/service.ts:804-853]), and `flush` logs and swallows handler failures [VERIFIED: bus.ts:68-92]. So bus → enqueue is **at-most-once**: an API instance dying between commit and enqueue, or a failed enqueue, loses that notification (logged as `domain_event.handler_failed`). Phases 4-6 never cross that gap. Their async work (`feed.unfurl-link`, media derive, invites) is `enqueueInTx` **inside** the producing transaction [VERIFIED: feed/service.ts:714, media/service.ts:647]. **Recommendation:** accept at-most-once for bell rows in V1 (a lost row is not data loss, and D-240 refresh covers the badge), keep chat delivery durable (trigger publish + messages are the data), and make EVENT-07 durable (Pattern 8). Record the upgrade path, a kernel `emitInTx(tx, …)` that writes a `kernel.dispatch-event` job inside the producer's transaction, as a deferred item.

### Pattern 7: Channel abstraction (NOTIF-04)

```typescript
// packages/modules/notifications/server/channels/types.ts
export interface DeliveryBatch {
  tenantId: string;
  intent: NotificationIntent;
  recipients: string[];          // resolved + filtered user ids
}
export interface ChannelResult { delivered: string[]; skipped: number }
export interface NotificationChannel {
  key: NotificationChannelKey;   // 'in_app' | 'push' (V2: 'email' | 'whatsapp')
  deliver(tx: Tx, batch: DeliveryBatch): Promise<ChannelResult>;
}
// registry.ts
const channels = new Map<NotificationChannelKey, NotificationChannel>();
export function registerChannel(c: NotificationChannel) { channels.set(c.key, c); }
export function channel(key: NotificationChannelKey) { const c = channels.get(key); if (!c) throw new Error(`channel ${key} not registered`); return c; }
```
- `in_app`: the insert-select above plus `app.realtime_signal` (`all` for audience `members`, `user:<u>` per recipient for personal kinds). It returns the inserted ids, and the `push` channel receives only those (gating).
- `push`: enqueues `notifications.push-send` jobs (one per ≤ 100 subscriptions) whose data is **ids plus the rendered ≤ 100-char body**. Push-only intents (chat, D-228) dedupe through `singletonKey = dedupeKey:userId` (effective while `created` under the `short` policy [VERIFIED: boss.ts:57-65]).
- Order: in-app first, then push (push depends on "newly inserted"). A V2 e-mail adapter is a new file plus a `NotificationChannelKey` union member, with no schema change (preferences are V2-NOTIF-01).

### Pattern 8: EVENT-07 reminders (durable, follows start moves, skips stale)

1. **Arm inside the events module's own write transactions** (`createEvent`, `updateEvent` when `timesChanged`, `setEventStatus` → active): `enqueueInTx(tx, 'events.reminder', { tenantId, eventId, window: '24h'|'1h', startsAt }, { startAfter: fireAt, singletonKey: \`${eventId}:${window}:${startsAtEpoch}\` })`, only when `fireAt > now()` ("skipped, not sent late"). This is durable (rolls back with the write) and has no cross-tenant scan. pg-boss keeps deferred jobs: `keep_until = start_after + retention` [VERIFIED: pg-boss 12.31.0 dist/plans.js:1894].
2. **Fire:** `withTenantTx(systemCtx)` reads the event. Act only when `status = 'active'` (`EVENT_STATUSES = ['active', 'cancelled']` [VERIFIED: packages/modules/events/contracts/index.ts:76]), `deleted_at is null`, `starts_at = payload.startsAt` (a moved start makes the old job a no-op), and `now() < starts_at` and `now() <= fireAt + 30 min` (a late worker never sends a stale reminder). Then `emit(ctx, 'event.reminder_due', { tenantId, eventId, window, startsAt })` and **`await flush(ctx)` before the handler returns**. A crash before flush retries the job; retries are idempotent through the dedupe key.
3. **Source** (events module): `event.reminder_due` → audience = `event_attendances.status = 'going'` (`ATTENDANCE_STATUSES = ['going', 'not_going', 'checked_in', 'walk_in']` [VERIFIED: contracts/index.ts:84]; `checked_in` members need no reminder), facts = title + startsAt, dedupe `events.reminder_<window>:<eventId>` per user → **at most one 24 h and one 1 h reminder per member per event, ever** (CONTEXT idempotency per `(event, window, user)`; a later move does not re-remind, consistent with V2-EVENT-02).
4. Cancel → reactivate: `event.reactivated` re-arms. If the old jobs are still `created` with the same `startsAt` key, the new arm is dropped by the `short` policy and the old jobs fire and see `active`. Correct either way.
5. **Backfill:** events created before the deploy have no armed jobs. Recommend a one-shot `scripts/arm-event-reminders.ts` (scripts may use `withAdminTx`) as a DEPLOY.md step. Production likely has few or no upcoming events.

### Pattern 9: Chat `seq`, catch-up and read state

- **Counter row lock (recommended):** add `chat_conversations.last_seq bigint not null default 0`. A BEFORE INSERT trigger on `chat_messages` runs `update chat_conversations set last_seq = last_seq + 1, last_message_at = now(), last_message_side = NEW.author_side, last_staff_seq = case when NEW.author_side = 'staff' then last_seq + 1 else last_staff_seq end where id = NEW.conversation_id and tenant_id = NEW.tenant_id returning last_seq into NEW.seq`. The UPDATE's row lock serialises writers per conversation until commit, so there are **no gaps** (a rollback undoes the counter) and **commit order = seq order**: a reader that sees seq 6 has already seen 5. This is what makes "after seq N" catch-up lose nothing. The existing `chat_messages_conversation_seq_uq on (conversation_id, seq)` [VERIFIED: chat-stubs.ts:103] stays as the backstop. Contention is per conversation only (one member plus staff), so it is negligible.
- **Catch-up API:** `GET /v1/chat/conversations/{id}/messages?afterSeq=N&limit=50` (ascending, `seq > N`) and `?beforeSeq=N` for history (descending). The client keeps `lastSeq`. On a signal with `seq > lastSeq`, or on (re)subscribe or visible, it fetches after `lastSeq` until a short page. Seq is an integer keyset, so no timestamp cursor is needed.
- **Shared staff read state (D-225/D-238):** `chat_conversations.staff_last_read_seq bigint not null default 0`. Awaiting staff = `kind = 'support' and last_message_side = 'member' and last_seq > staff_last_read_seq`. Staff open → `POST …/read { seq }` sets `greatest(staff_last_read_seq, least($seq, last_seq))`. A staff reply implicitly sets it to its own seq. **No per-staff participant rows**: staff access is by role, so new staff see every thread.
- **Member read state (D-237):** member participant row `chat_participants.last_read_seq` (replace the stub's `last_read_at timestamp` [VERIFIED: chat-stubs.ts:69-70]). Dot = `last_staff_seq > last_read_seq`.
- **Author side on the message:** `chat_messages.author_side text check in ('member','staff')`, set by the API from `ctx.role`, so the bubble side and "first name" rendering need no join to roles. V2 DMs use `'member'` on both sides.
- **Body rule:** `check (char_length(btrim(body)) between 1 and 2000)` plus the Zod mirror (D-225).
- **Creation (D-220): lazy, on first message.** `GET /v1/chat/support` is read-only: it returns `{ conversation: null }` and the greeting renders. `POST /v1/chat/support/messages` upserts conversation + participant + message in one transaction (`insert … on conflict on the partial unique index do nothing` then select). Why: on-open creation would make a GET with a side effect (the 06-06 prefetch rule), and it would fill the staff inbox with empty threads.
- **Blocked member's thread:** staff see it read-only (composer replaced by a notice). The API refuses a staff reply to a blocked member with 409 `CONFLICT { chat: 'member_blocked' }`. The member cannot reach the API at all (AUTH-06).
- **Permissions:** move `chat.support` out of `KERNEL_ROLE_PERMISSIONS` (today `support_tenant: ['chat.support']` [VERIFIED: packages/core/server/rbac/require-role.ts:10-15]) into the chat manifest's `defaultRolePermissions` for both `admin_tenant` and `support_tenant` (D-223), so turning chat off revokes it. Pin with a test.

### Pattern 10: Web Push (server)

- **Keys:** generate once with `npx web-push generate-vapid-keys`. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:` address) go in Secret Manager for the **worker** (and the API if it validates keys); `NEXT_PUBLIC_VAPID_PUBLIC_KEY` goes on Vercel. **Rotating the key pair invalidates every subscription**, so treat it as a one-way door. The subject must be `https:` or `mailto:`, and a `localhost` subject is rejected by Apple (`BadJwtToken`) [VERIFIED: web-push 3.6.7 src/vapid-helper.js:68-92].
- **Options** [VERIFIED: web-push src/web-push-lib.js; CITED: README]: `TTL` in seconds (default 4 weeks: `DEFAULT_TTL = 2419200`), `urgency` ∈ `very-low|low|normal|high`, `topic` ≤ 32 chars matching `/^[A-Za-z0-9\-_]+$/`, `timeout` in ms. Non-2xx rejects with `WebPushError { statusCode, headers, body, endpoint }`. **Only `https.request`** is used, so a local fake push service must be HTTPS or bypassed (see Validation).
- **Per kind:** broadcast kinds `TTL 86400`, `urgency normal`, `topic = tag = kind slug` (e.g. `feed-post`); reminders `TTL` = seconds until start, `urgency high`, `tag = events-reminder-<eventIdHex32>`; chat `TTL 259200`, `urgency high`, `topic = tag = conversation uuid without hyphens` (exactly 32 hex chars).
- **`Topic` vs `tag`:** `Topic` collapses *undelivered* messages at the push service while the device is offline. `tag` replaces a *displayed* notification on the device. Set both to the same slug, which implements D-236 at both layers.
- **Status handling:** 201/202 → mark `last_success_at`; **404/410 → delete the subscription row**; 413 → log (payload > 4 KB), no retry; 429/5xx/network → throw so pg-boss retries (`retryLimit 3`, backoff). The payload stays ≤ 3 KB (the encrypted limit is 4096 bytes [ASSUMED: RFC 8291 record size]).
- **Recipient check at send:** skip, and delete that user's subscriptions, when the membership is no longer live (blocked/deleted). This covers "blocking deletes subscriptions" before Phase 8 builds the block action. Phase 8's block should additionally emit an event that deletes them eagerly.
- **Payload (versioned, per recipient):** `{ v: 1, title, body, icon, url, tag, badge }`. `badge` = recipient's unseen + chat count, computed at send so the SW can `setAppBadge` (D-239). `url` is a same-origin **path** (the SW resolves it against its own origin = the tenant's domain). `icon` = `branding.iconUrls.i192` (keys `i192`, `i512`, `maskable512`, `apple180` [VERIFIED: packages/contracts/src/branding.ts:37-42]), falling back to the neutral set when `iconUrls` is null.

### Pattern 11: Service worker handlers (Serwist `app/sw.ts`)

Add plain listeners next to `serwist.addEventListeners()`. Keep the decision logic in a pure module (`apps/web/lib/push-sw.ts`) so Vitest can test it with fake `clients`/`registration`:
```typescript
// Source: web.dev common-notification-patterns (focus exception), WebKit "Meet Web Push" (iOS must show)
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const data = parsePushPayload(event.data);            // total: bad payload → generic tenant-less banner
    if (data.badge !== undefined && 'setAppBadge' in self.navigator) {
      await self.navigator.setAppBadge(data.badge).catch(() => {});
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = windows.some((w) => w.focused && w.visibilityState === 'visible');
    // Chromium/Firefox allow skipping while focused; WebKit (Safari macOS/iOS) revokes subscriptions
    // whose pushes are not user-visible, so there we ALWAYS show.
    if (focused && !mustAlwaysShow(self.navigator.userAgent)) {
      for (const w of windows) w.postMessage({ type: 'push-received', tag: data.tag });
      return;
    }
    await self.registration.showNotification(data.title, {
      body: data.body, icon: data.icon, tag: data.tag, data: { url: data.url }, badge: data.monochromeBadge,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/inicio', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (client) { await client.focus(); await client.navigate(url).catch(() => self.clients.openWindow(url)); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // Same-origin fetch from the SW carries the HttpOnly session cookie; the BFF forwards to the API.
  event.waitUntil(resubscribeAndPost(event));   // best effort; the page also re-syncs on every open
});
```
- `mustAlwaysShow(ua)` = not Chromium/Firefox (`!/Chrome\/|Firefox\//.test(ua)`). iOS browsers are all WebKit, and only Safari standalone can subscribe anyway. The exact rule is [ASSUMED] and must be confirmed on devices.
- **Sync on open:** every standalone open with `Notification.permission === 'granted'` calls `pushManager.getSubscription()` and re-POSTs it (idempotent upsert). This covers browsers that never fire `pushsubscriptionchange`.
- The SW's `NETWORK_ONLY_PREFIXES` already include `/api/` and `/v1/` [VERIFIED: apps/web/app/sw.ts:45], so push BFF calls are never cached.

### Pattern 12: Client push subscribe flow and the iOS gate (PWA-02, D-233/D-234)

- Tap "Ativar" → if `isIosLike(ua) && !isStandalone(window)`, open `InstallHint` with push copy and stop. Else **call `Notification.requestPermission()` / `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` as the first awaited thing in the click handler**, with no `fetch` before it (iOS: "as long as that request is in response to direct user interaction" [CITED: webkit.org/blog/13878]). Then POST the subscription to the BFF → API.
- `isIosSafari` today returns false for iPadOS desktop-class UAs (`Macintosh`) [VERIFIED: apps/web/components/pwa/InstallHint.tsx `isIosSafari` tests only `/iPad|iPhone|iPod/`]. Add `navigator.maxTouchPoints > 1 && /Macintosh/` for iPadOS, which has the same home-screen requirement.
- `InstallHint` is built but unmounted [VERIFIED: InstallHint.tsx docblock]. Mount it from the push flow, not globally.
- **Logout:** before the sign-out action, `subscription.unsubscribe()` and `DELETE` the row (shared device: the next user on the browser must not receive the previous user's pushes).
- **Subscription table:** `push_subscriptions (id, tenant_id, user_id, endpoint text, p256dh text, auth text, user_agent text, created_at, last_success_at, failure_count)`, `unique (endpoint)` globally (an endpoint is one browser profile, and the origin pins the tenant). Upsert through a definer `app.push_subscription_upsert(...)` that deletes any row with the same endpoint and inserts for `app.user_id()`/`app.tenant_id()`. Under RLS, the caller cannot see another user's row with the same endpoint (a device handed from user A to user B). Policies: select/delete `tenant_id = app.tenant_id() and user_id = app.user_id()`; the worker reads through its system lane (tenant claim), with a `for select` policy variant `tenant_id = app.tenant_id() and (user_id = app.user_id() or app.user_id() = '00000000-…')`, **or** read through a narrow definer `app.push_subscriptions_for(p_user_ids uuid[])` gated to the lane's tenant. Prefer the definer (explicit and testable).

### Pattern 13: Counters and badges

- Kernel manifest `counters?: (tx, ctx) => Promise<Partial<Counters>>`, run inside the bootstrap's `withTenantTx` for **effective** modules only, replacing the hard-coded `counters: { unreadNotifications: 0, unreadConversations: 0 }` [VERIFIED: apps/api/src/routes/me.ts:190]. The same composition serves a lightweight `GET /v1/me/counters` for live refetch.
- Notifications: `count(*) where tenant_id and user_id and seen_at is null` (partial index `where seen_at is null`).
- Chat: member → 0/1 (dot); staff → awaiting count. **Contract change:** the dot-versus-count choice is role-dependent, but `ModuleNavBadge = 'unreadNotifications' | 'unreadConversations'` [VERIFIED: packages/core/server/modules/manifest.ts:14] and `bootstrapSchema.counters` has only the two numbers (a plain `z.object`, which strips unknown keys). Add `counters.conversationsBadge: z.enum(['dot','count'])` (or `badgeStyle` in nav). The API deploys before the web (the 06-01 precedent).
- Chat slot href: one route `/suporte` that renders the member thread or the staff inbox by permission (D-224). The manifest `href` is static data.
- Web: a client `LiveCountersProvider` (kernel UI) seeded from the bootstrap. It refetches `/api/me/counters` (BFF GET route handler) on signal, SUBSCRIBED or visible, and calls `navigator.setAppBadge(unseen + (dot ? 1 : awaiting))` when supported (D-239). `TopBar`/`DesktopRail` read counters from context instead of the static prop.

### Anti-Patterns to Avoid
- **`realtime.send` from the tenant lane:** a silent no-op (invoker + RLS + swallowed WARNING). Publish only from definer code.
- **`broadcast_changes` on `chat_messages`:** leaks the body into the Realtime payload.
- **A policy reading `app.tenant_id()` on `realtime.messages`:** always NULL there, so every join is denied (or, worse, someone "fixes" it with a permissive predicate).
- **Per-member broadcasts for D-226 kinds:** burst above Free 100 msg/s.
- **Server actions for realtime-triggered refetches:** Next runs a page's server actions one at a time [ASSUMED], so a counters refetch would queue behind a chat send. Use BFF GET route handlers (`cache: 'no-store'`).
- **Postgres sequence for `seq`:** gaps and out-of-order visibility break "after N".
- **Storing rendered pt-BR sentences in `notifications`:** CONTEXT forbids it; store facts, render in the web registry.
- **Asking for push permission on load, or after an `await fetch`:** iOS refuses outside a gesture.
- **Reusing `feed/ui/linkify.tsx` from the chat module:** module→module import (turbo boundaries).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket fan-out, reconnection, auth | A socket server on Cloud Run | Supabase Realtime Broadcast + `@supabase/realtime-js` | 60-min request cap, no shared state (CLAUDE.md) |
| Token refresh for the socket | Timers calling `setAuth` | realtime-js `accessToken` callback (heartbeat-driven) + in-memory cache | Library already re-auths every heartbeat and pushes only changed tokens |
| VAPID JWT + aes128gcm encryption | Custom crypto | `web-push` | RFC 8291/8292 details; `generateRequestDetails` for tests |
| Job retries/backoff/deferral | setTimeout schedulers, cron | pg-boss `startAfter`, `retryLimit`, `singletonKey` (short policy) | Repo's one periodic mechanism ("No scheduler exists anywhere in this repo") |
| Idempotent fan-out | Pre-check SELECTs | `unique (tenant_id, user_id, dedupe_key)` + `on conflict do nothing returning` | Race-free, retry-safe |
| Ordering under concurrency | App-level locks / max()+1 | Counter row `update … returning` in a trigger | DB serialises per conversation |
| Keyset paging | New cursor format | `packages/core/server/paging.ts` | One envelope repo-wide (R-11) |
| iOS install detection | New UA parser | `InstallHint.tsx` `isStandalone` / `shouldShowInstallHint` (+ iPadOS fix) | Already tested |

**Key insight:** every hard property in this phase (who may listen, ordering, idempotency, rollback-safety) is enforced **in Postgres** so that it holds for every writer, including the worker, seeds and tests, not just for the API route that happens to be written today.

## Common Pitfalls

### Pitfall 1: Realtime policy that can never pass (or always passes)
**What goes wrong:** the policy uses `app.tenant_id()` or a plain `memberships` subquery, so it evaluates to NULL/false for every user. Or it is "fixed" with `using (true)`.
**Why it happens:** the tenant claim exists only inside `withTenantTx`. Realtime uses the raw Supabase JWT.
**How to avoid:** use the definer function (Pattern 2) with a regex check before any uuid cast.
**Warning signs:** `CHANNEL_ERROR` on your own user topic in dev, or a pgTAP positive control failing.

### Pitfall 2: Silent publish failure
**What goes wrong:** `realtime.send` raises WARNING and returns, so nothing arrives and nothing errors.
**How to avoid:** call it only from definer functions/triggers. The integration test asserts a signal actually arrives (positive control), and API logs forward Postgres notices at warn level if available.

### Pitfall 3: `realtime.messages` partitions in pgTAP/CI
**What goes wrong:** inserting a probe row into `realtime.messages` fails with "no partition of relation found" on a fresh CI stack.
**Why:** the table is `PARTITION BY RANGE (inserted_at)` with daily partitions the Realtime service creates [VERIFIED: `\d realtime.messages`, 5 partitions locally].
**How to avoid:** the pgTAP helper inserts the probe with an `inserted_at` inside an existing partition (select one from `pg_inherits`), or skips with a named reason when none exists. Prove it green under `supabase test db` in CI.

### Pitfall 4: Staff role list drift
**What goes wrong:** someone grants `chat.support` to a new role in TypeScript, but the SQL helper still lists two roles (or the reverse).
**How to avoid:** a unit/integration test computes `TENANT_ROLES.filter(r => permissionsFor(r, allKeys).includes('chat.support'))` and compares it with a query of the SQL helper's answers.

### Pitfall 5: Push works in Chrome, banner never appears on iOS (or subscription revoked)
**Why:** WebKit requires a visible notification for every push ("Violations of the `userVisibleOnly` promise will result in a push subscription being revoked." [CITED: webkit.org/blog/12945]). Foreground suppression must not apply there.
**How to avoid:** `mustAlwaysShow` rule, and a real-device test (see Validation).

### Pitfall 6: iOS permission prompt silently refused
**Why:** an `await` (fetching the VAPID key, calling the API) before `requestPermission()` breaks the gesture chain.
**How to avoid:** have the VAPID key in memory beforehand (env var), make the prompt the first await, and POST afterwards.

### Pitfall 7: Chrome's "This site has been updated in the background"
**Why:** the `push` handler resolves before `showNotification`'s promise, or `waitUntil` is missing [CITED: pushpad.xyz / web.dev].
**How to avoid:** a single `event.waitUntil(async …)` that awaits `showNotification`.

### Pitfall 8: Token endpoint hit every 25 s
**Why:** realtime-js calls the `accessToken` callback on every heartbeat [VERIFIED].
**How to avoid:** an in-memory cache keyed on `expiresAt`, and a unit test that counts fetches over simulated heartbeats.

### Pitfall 9: Reshaping the Phase 1 stub tables breaks existing tests
**What goes wrong:** `supabase/tests/020-tenant-isolation.sql` inserts `notifications (tenant_id, user_id, kind)` and `chat_messages (…, seq, …)` fixtures [VERIFIED: 020-tenant-isolation.sql:114-133]. New NOT NULL columns (`dedupe_key`, `author_side`, `subject_*`) break them, and the seq trigger overrides the explicit `seq`.
**How to avoid:** update 020 in the same plan as the migration. The stubs have no production writer (no route, no job), so altering them is data-safe. Moving the Drizzle definitions from `packages/core/db/schema/*-stubs.ts` into `packages/modules/{notifications,chat}/db/schema.ts` keeps table names identical, and `drizzle.config.ts` globs both locations [VERIFIED: apps/api/drizzle.config.ts:9]. Confirm with `pnpm db:generate` that the move alone produces no DDL before the reshape.

### Pitfall 10: Commit order ≠ seq order
**Why:** a sequence or `max(seq)+1` without a lock.
**How to avoid:** the counter row lock (Pattern 9), plus a concurrency test: 20 parallel sends produce seqs 1..20, contiguous and unique, and a reader never observes a gap.

### Pitfall 11: Dedupe of story notifications
**Why:** a story published into a highlight emits `story.published` **and** `story.highlighted` [VERIFIED: stories/service.ts:388-390].
**How to avoid:** source only `story.published`, with dedupe key `stories.story:<storyId>`.

### Pitfall 12: `web-push` bundling in the API image
**Why:** tsup externalises only dependencies declared in `apps/api/package.json`. Undeclared CJS dependencies get bundled (the 260928-t3z crash class). The pg-boss precedent is declared in both packages.
**How to avoid:** declare `web-push` in `apps/api` too, then build and boot the worker in `worker.test.ts`.

### Pitfall 13: iPadOS misdetected as desktop
**Why:** iPadOS Safari sends a `Macintosh` UA.
**How to avoid:** `maxTouchPoints > 1` heuristic in the iOS-gate helper, with a unit test.

### Pitfall 14: Reminder fires for a moved/cancelled event, or late after worker downtime
**How to avoid:** the fire-time checks of Pattern 8, tested with a controllable `now` (pass `now` into the job function; integration test sets `starts_at` and calls the handler directly, the `runInviteSendJobs` precedent [VERIFIED: apps/api/tests/integration/setup.ts:141]).

### Pitfall 15: Comment deep link targets a comment beyond the first page
**Why:** D-232 wants "scrolled to and highlighting that comment", but the post page loads root comments in pages of 20.
**How to avoid:** the feed module adds a targeted read (`?comentario=<id>` → the root thread containing it, rendered pinned and highlighted). Scope it in the plan that ships comment kinds. The UI-SPEC decides the visual.

### Pitfall 16: Local DB carries pre-rename tenant slugs
**Why:** the workspace rename (2026-09-28) changed seed slugs, but the running local DB was not reset [VERIFIED: local `tenants.slug`].
**How to avoid:** Phase 7's first migration plan requires the developer-approved `db:reset` + `db:seed` (backup first, the 05.1/05.2 precedent). Seed also needs a `support_tenant` user per tenant, because none exists today [VERIFIED: grep scripts/seed.ts].

## Code Examples

### Realtime provider (browser, kernel UI)
```typescript
// packages/core/ui/realtime/RealtimeProvider.tsx — 'use client'
// Source: realtime-js 2.116.0 RealtimeClient options (accessToken callback, heartbeat re-auth)
import { RealtimeClient } from '@supabase/realtime-js';

function tokenSource(fetchToken: () => Promise<{ accessToken: string; expiresAt: number } | null>) {
  let cached: { accessToken: string; expiresAt: number } | null = null;
  return async () => {
    if (!cached || cached.expiresAt * 1000 - Date.now() < 120_000) cached = await fetchToken();
    return cached?.accessToken ?? null;
  };
}

const client = new RealtimeClient(`${supabaseUrl}/realtime/v1`, {
  params: { apikey: publishableKey },
  accessToken: tokenSource(() => fetch('/api/realtime/token', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null))),
});
const channel = client
  .channel(`tenant:${tenantId}:user:${userId}`, { config: { private: true } })
  .on('broadcast', { event: 'notifications.changed' }, () => invalidateCounters())
  .subscribe((status) => { if (status === 'SUBSCRIBED') invalidateCounters(); /* D-240 */ });
```

### pgTAP probe for Realtime authorization
```sql
-- supabase/tests/150-realtime-authorization.sql (sketch)
-- Mirrors what Realtime does on join: a probe row inserted with admin rights, then read back under
-- role authenticated with the user's REAL claim shape (no tenant_id) and realtime.topic set.
create or replace function tests.as_realtime_user(p_user uuid, p_topic text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', p_topic, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- as postgres: insert into realtime.messages (topic, extension, private, payload, inserted_at) … returning id
-- then: select tests.as_realtime_user(member_a, 'tenant:'||tenant_a||':user:'||member_a);
--       select is((select count(*) from realtime.messages where id = :probe)::int, 1, 'own user topic');
-- negatives (each its own probe): other user's topic, other tenant's user topic, conv of another member,
-- support-inbox as member, any topic after blocked_at is set, malformed topic, chat module disabled.
```

### Push send with 404/410 cleanup
```typescript
// packages/modules/notifications/server/push/transport.ts
// Source: web-push 3.6.7 README + src/web-push-lib.js (WebPushError.statusCode)
import webpush from 'web-push';
export async function sendOne(sub: StoredSubscription, payload: string, opts: PushOpts): Promise<'sent' | 'gone' | 'retry'> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: opts.ttlSeconds, urgency: opts.urgency, topic: opts.topic, timeout: 10_000,
        vapidDetails: { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } },
    );
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';     // caller deletes the row
    if (status === 400 || status === 413) return 'sent';      // permanent: log shape only, do not retry
    return 'retry';                                           // 429 / 5xx / network → throw → pg-boss retry
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Postgres Changes for chat | Broadcast from Database (`realtime.send`) on private channels | 2024-2025 | Topic-level RLS, no per-row RLS per subscriber |
| Public channels + anon key | Private channels + "Allow public access" off (`private_only`) | Realtime Authorization GA | Joins evaluated against `realtime.messages` policies |
| SW-only push handling | Declarative Web Push (iOS/iPadOS 18.4, macOS 15.5) with `web_push: 8030` JSON | 2025 | Optional; SW path still needed for Chromium/Android; defer |
| `setAuth(token)` manual refresh | `accessToken` callback refreshed on heartbeat | realtime-js 2.x | Use the callback with a cache |

**Deprecated/outdated:**
- `@serwist/next`: the webpack path; this repo uses `@serwist/turbopack` (already done).
- Supabase `channel.send()` server-side without subscribing: REST fallback bug (CLAUDE.md). Not used here (DB publish only).

## One-Way Doors (flag in plans)

| Decision | Why hard to reverse | Mitigation |
|----------|--------------------|------------|
| Topic names (`tenant:<t>:user:<u>`, `…:all`, `…:support-inbox`, `…:conv:<c>`) | Embedded in the policy function, triggers and deployed clients | Builders in one kernel file; the regex in the SQL function is the spec; tests pin both |
| `notifications` shape (`dedupe_key`, `subject_*`, `object_*`, `facts`, `seen_at`, `read_at`) | Rows accumulate; dedupe keys are part of idempotency | Reshape now while the table is empty |
| Chat reshape (`last_seq`, `staff_last_read_seq`, `last_staff_seq`, `last_message_side`, `author_side`, `last_read_seq`) | Seq semantics are the catch-up contract | Trigger-owned columns; concurrency test |
| Push payload `{ v: 1, … }` | Old SWs receive new payloads until they update | Version field + total parser |
| VAPID key pair | Rotation invalidates every subscription | Generate once, store in Secret Manager, document |
| Event names `event.reminder_due`, `chat.message_sent` and their payloads | Consumers declaration-merge on them | Ids + instants only, pinned by payload tests (the `events-payload.test.ts` precedent) |
| Bootstrap `counters` contract (+ badge style) | Web parses with a strict schema | API deploys before web (06-01 precedent) |
| Manifest seams (`notificationSources`, `counters`, `sweepFunctions`) | Every module will use them | Kept minimal; kernel shape only |

## Recommended Plan Slicing (MVP mode, thin tracer first, roadmap build order)

Execution is sequential here (no parallel worktrees). Each plan leads with a vertical tracer.

1. **07-01 Notifications tracer (API + DB):** stub → module move (no-DDL proof), `notifications` reshape, kernel seams (sources/sink/counters/sweep functions), realtime authorization migration + `app.realtime_signal`, fan-out job, ONE source (`post.published` → `feed.post`), `GET /v1/notifications`, `POST …/seen`, `…/{id}/read`, `…/read-all`, `GET /v1/me/counters`, bootstrap counters. Tests: pgTAP 150/151, integration with a real `RealtimeClient` (own topic receives; cross-tenant/other-user refused), isolation cases. *Blocking checkpoint:* `db:reset` + `db:seed` approval (backup first), `@supabase/realtime-js` legitimacy checkpoint.
2. **07-02 Live bell (web):** `/api/realtime/token`, kernel `RealtimeProvider` + `LiveCountersProvider`, TopBar/rail from context, `/notificacoes` list port (Novas/Anteriores, seen-on-open, tap-read, mark-all), row renderer registry in `apps/web/lib/registry.tsx`, app badge. e2e: two browser contexts, admin publishes → member bell increments without reload. *Gated on UI-SPEC + sketch approval for the unprototyped bits.*
3. **07-03 Remaining kinds + retraction + pruning:** comment liked/reply, story published/commented, reel kind (from `post.published` + `media_kind = 'video'`, no reels emission), event published/reactivated; deletes; 90-day prune via sweeper; target routing with fallbacks (deleted, expired story → Início notice, comment highlight read).
4. **07-04 EVENT-07:** events module arming in-tx + `events.reminder` job + `event.reminder_due` + source; backfill script; tests for moved/cancelled/late/past-window/idempotent.
5. **07-05 Push backend:** `push_subscriptions` + definers, VAPID env (fail-fast), channel abstraction registry (`in_app`, `push`), `notifications.push-send` job with a transport seam (`PUSH_TRANSPORT=fake|webpush`, the `VIDEO_PROVIDER=fake` precedent), 404/410 cleanup, live-membership check, header assertions via `generateRequestDetails`.
6. **07-06 Push web:** SW handlers + pure `push-sw.ts`, subscribe/unsubscribe flow, Configurações switch, soft-ask card, iOS gate (InstallHint + iPadOS), logout unsubscribe, sync-on-open; Playwright with mocked `PushManager`; **real-device test plan document** (deliverable).
7. **07-07 Chat backend:** chat module, reshape + seq/broadcast triggers, lazy creation, member/staff routes, read state, counters, `chat.message_sent` push-only source, `chat.support` moved to the manifest; concurrency test; pgTAP 152.
8. **07-08 Chat web:** member thread (greeting, bubbles with staff first names, composer, linkify re-homed), staff inbox (mobile list / desktop split), live append + catch-up, dot vs count, read-only blocked thread.
9. **07-09 Phase gate:** isolation suite extensions (pgTAP 020 + API isolation for every new endpoint + Realtime negatives), seed support users, DEPLOY.md steps, `pnpm verify` green, UAT script including the real-device plan.

## UI-SPEC Constraints (for `/gsd-ui-phase 7` — do not design here)

- **iOS gate:** on iOS/iPadOS outside standalone, "Ativar" opens `InstallHint` with push copy. The permission prompt appears only from a tap, and the soft-ask card must not prompt directly on iOS in the browser.
- **Standalone-only push on iOS 16.4+.** Below 16.4 the switch must render a disabled/unsupported state (no `PushManager`).
- **Switch states** to design: unsupported, not installed (iOS), default (off), granted+subscribed (on), denied (explain Ajustes; the app cannot re-prompt), error.
- **Badging:** Chrome/Edge desktop 81+, Safari macOS 17+, iOS 16.4+ home-screen apps only (and shown only after notification permission); **not** Chrome Android, Firefox or Samsung Internet [CITED: caniuse.com/mdn-api_navigator_setappbadge; webkit.org/blog/14112]. The in-app badges are the source of truth, and the icon badge is a bonus.
- **Foreground suppression:** on Android/desktop, a push while the app is focused shows no banner (only badges update). On iOS/macOS Safari the banner always shows. The UI must not add its own toast for the same event (double signal).
- **Novas / Anteriores:** sections are by `read_at` (D-231). A tap removes the tint in place and does not move the row until the next load. "Marcar todas como lidas" moves everything to Anteriores on refresh.
- **Chat:** member side shows "Equipe {tenant}" + logo, staff bubbles show first name only and no staff avatars. Staff side has a member avatar + name linking to the profile. Blocked member thread is read-only. Member badge is a dot, staff badge a number.
- **Fallback screens:** deleted target ("Conteúdo removido"-style copy), expired story → Início with "Este story expirou".
- **No realtime-dependent spinners:** lists must render from the API even if Realtime never connects.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Broadcasts sent with `private = true` are not delivered to a non-private channel join of the same topic | Pattern 2 | Local stack (private_only off) could leak signals to anon joins; the test pins it, and production sets `private_only` |
| A2 | Realtime's claims on join contain `sub`, so `app.user_id()` works inside the definer | Pattern 2 | Policy denies everything; caught immediately by the positive-control test |
| A3 | Only committed `realtime.messages` rows are delivered (logical decoding) | Pattern 3 | A rolled-back chat send could signal; pinned by an integration test (failed insert → no signal in 2 s) |
| A4 | Next.js serialises a page's server actions | Anti-patterns | Low: route handlers are chosen anyway |
| A5 | `mustAlwaysShow` UA rule (WebKit always shows; Chromium/Firefox may skip when focused) | Pattern 11 | Revoked iOS subscriptions or duplicate banners; real-device test |
| A6 | Safari honours `tag` replacement for web push notifications | Pattern 10 | Banners stack instead of replacing; cosmetic |
| A7 | Encrypted push payload limit ≈ 4 KB | Pattern 10 | Oversized payload 413; payload kept ≤ 3 KB |
| A8 | Hosted project `jwt_expiry` is 3600 s like local | Pattern 2 | Longer residual Realtime access for a blocked member; ids-only mitigates |
| A9 | Pilot size ~300 members / ~40 concurrent windows (sizing example) | Pattern 4 | If the pilot is far larger, tenant-topic bursts approach 100 msg/s; revisit Pro |
| A10 | `tenants.status` active value is `'active'` (used in the definer sketch) | Pattern 2 | Wrong literal denies all joins; read the tenants CHECK before coding |
| A11 | Story comments and post/story likes: only `story.commented` (to the story author) and `comment.liked` / replies notify; `post.liked`/`story.liked` do not (NOTIF-01 lists likes on *comments* only) | Pattern 6 | Missing or extra kinds; confirm at UI-SPEC |
| A12 | A reel notification opens `/post/<id>` (no reel detail route exists) | UI constraints | UI-SPEC may prefer `/reels`; routing only |

## Open Questions

1. **Production backfill of reminders for already-scheduled events.**
   - Known: arming happens at write time; existing upcoming events have no jobs.
   - Unclear: whether production has any upcoming events at deploy.
   - Recommendation: ship `scripts/arm-event-reminders.ts` and list it in DEPLOY.md as an optional post-deploy step.
2. **Durable domain-event delivery (bus at-most-once).**
   - Known: request-path emit is after commit and swallowed on failure.
   - Recommendation: accept for V1 bell rows; record `emitInTx` as a deferred item; revisit if the UAT shows lost notifications.
3. **Real-device push testing path.**
   - Known: phones cannot reach `*.localhost`; production is live; there is no staging.
   - Recommendation: run the real-iPhone + Android plan **against production** after the phase deploys, with a throwaway test tenant/domain (or the pilot tenant with test accounts). Document it as the UAT item, and default its status to blocked until it is run (memory: never record a pass without it).
4. **Should `support_tenant` see member profiles from the staff thread header?** D-224 links to the existing member profile, which `support_tenant` can already open (PROF-02, any member). No change is expected; confirm in the UI-SPEC.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Supabase stack (Docker) | pgTAP, integration, e2e | ✓ | Postgres 17.6.1.167, Realtime v2.130.0, GoTrue v2.196.0, Supavisor 2.9.12 | — |
| Local Realtime JWKS (ES256) | RealtimeClient tests | ✓ | `_realtime.tenants.jwt_jwks` populated | — |
| Node.js (global `WebSocket`) | realtime-js in Node integration tests | ✓ | v24.14.0 (`typeof WebSocket === 'function'`) | — |
| pnpm | workspace | ✓ | 12.4.1 | — |
| psql | read-only probes | ✓ | Homebrew | — |
| Real push services (FCM/Mozilla/APNs) | real delivery | ✗ locally (headless Chromium has no push service) | — | Fake transport + `generateRequestDetails` header tests; real devices against production |
| Real iPhone (iOS ≥ 16.4) / Android device on the network | PWA-02, NOTIF-03 UAT | ✗ locally (`*.localhost` unreachable) | — | Production host after deploy |
| Hosted Realtime `private_only` | SC 4 hardening | ✗ (user step) | — | DEPLOY.md step; local tests assert private-only semantics per channel |

**Missing dependencies with no fallback:** none block implementation. The real-device push verification is blocked until the production deploy of this phase.

**Missing dependencies with fallback:** push delivery (fake transport); iOS behaviour (Playwright cannot emulate standalone [VERIFIED: STATE 02-11 note], so the pure-function unit tests stand in).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.0 (unit + integration), pgTAP via `supabase test db`, Playwright 1.63.0 (e2e + PWA production build) |
| Config file | per package `vitest.config.ts`; `apps/web/playwright.config.ts`, `playwright.pwa.config.ts` |
| Quick run command | `pnpm --filter @rede-social/module-notifications test` (likewise `module-chat`, `module-events`) |
| Full suite command | `TURBO_CACHE=local:r pnpm verify` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTIF-01 | Each source yields the right intents/audience/dedupe (unit, fake tx) | unit | `pnpm --filter @rede-social/module-feed test` (+ stories, events) | ❌ Wave 0 |
| NOTIF-01 | Fan-out inserts one row per live `member`, excludes author/staff/blocked, idempotent on retry, unlike/re-like no dup | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/notifications.test.ts` | ❌ Wave 0 |
| NOTIF-01 | Retraction on post/comment/story delete | integration | same file | ❌ |
| NOTIF-02 | List keyset (Novas/Anteriores), seen-on-open zeroes the badge, tap read, read-all, counters | integration | same file | ❌ |
| NOTIF-02 | Live bell increments without reload (two contexts) | e2e | `pnpm --filter @rede-social/web exec playwright test notifications.spec.ts` | ❌ |
| NOTIF-02 / SC4 | Realtime join allowed on own topics, refused cross-tenant / other user / inbox as member / after block / malformed / module off | pgTAP + integration (real `RealtimeClient`) | `pnpm supabase test db` ; `pnpm --filter @rede-social/api exec vitest run tests/integration/realtime.test.ts` | ❌ |
| SC4 | Browser cannot broadcast (no INSERT policy); non-private join receives nothing; rolled-back write publishes nothing | integration | `realtime.test.ts` | ❌ |
| NOTIF-03 | Push headers (TTL/Urgency/Topic), 404/410 deletes row, 5xx retries, blocked member skipped + subs deleted | unit + integration | `pnpm --filter @rede-social/module-notifications test` ; `…vitest run tests/integration/push.test.ts` | ❌ |
| NOTIF-03 | SW push/click logic (focus suppression, badge, navigate/openWindow) | unit (pure `push-sw.ts`) | `pnpm --filter @rede-social/web test` | ❌ |
| NOTIF-03 / PWA-02 | Subscribe flow with mocked `PushManager`; iOS non-standalone opens InstallHint; iPadOS detection | unit + e2e | `pnpm --filter @rede-social/web exec playwright test push.spec.ts` | ❌ |
| NOTIF-03 / PWA-02 | Real iPhone (standalone) + Android: enable, receive with tenant name/icon, tap opens screen, focused suppression on Android | manual-only (real devices vs production) | UAT script | ❌ (deliverable doc) |
| NOTIF-04 | Channel registry: unregistered key throws; in_app then push; push only for new rows | unit | module-notifications test | ❌ |
| EVENT-07 | Arm on create/edit/reactivate in-tx; no arm for past windows; fire no-ops on moved/cancelled/deleted/late; only `going`; one per (event, window, user) | integration | `…vitest run tests/integration/events-reminders.test.ts` | ❌ |
| CHAT-01 | seq contiguous under 20 concurrent inserts; trigger-owned counters; body CHECK | pgTAP + integration | `pnpm supabase test db` ; `…vitest run tests/integration/chat.test.ts` | ❌ |
| CHAT-02/03 | Lazy creation, one support conversation per member, staff inbox order + awaiting count, shared read state, staff never get own thread, blocked → read-only 409 | integration | `chat.test.ts` | ❌ |
| CHAT-04 | Signal arrives on conv + inbox topics; catch-up after N returns exactly the missed messages | integration + e2e | `realtime.test.ts`, `playwright test chat.spec.ts` | ❌ |
| CHAT-05 | Member dot after staff reply; clears on read | integration + e2e | `chat.test.ts`, `chat.spec.ts` | ❌ |
| TENANT-05 | Every new table in 020; every new endpoint in `isolation.test.ts` | pgTAP + integration | `pnpm supabase test db` ; `…vitest run tests/integration/isolation.test.ts` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** the touched package's `typecheck && lint && test` (e.g. `pnpm --filter @rede-social/module-notifications typecheck && pnpm --filter @rede-social/module-notifications lint && pnpm --filter @rede-social/module-notifications test`) plus the one integration file it touches.
- **Per migration task:** `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)" && pnpm db:reset && pnpm db:seed && pnpm supabase test db` (after the developer-approved reset).
- **Per wave merge:** `pnpm test:integration` (whole folder, ~50 s+) and the plan's Playwright spec, e.g. `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test notifications.spec.ts -g "..."`.
- **Phase gate:** `TURBO_CACHE=local:r pnpm verify` green before `/gsd-verify-work`, plus the real-device UAT recorded honestly (blocked until run).

### Wave 0 Gaps
- [ ] `supabase/tests/150-realtime-authorization.sql` (+ `tests.as_realtime_user` helper, partition-safe probe insert)
- [ ] `supabase/tests/151-notifications.sql`, `152-chat.sql`; 020 fixture updates for reshaped stubs
- [ ] `apps/api/tests/integration/realtime.test.ts` (RealtimeClient helper: sign in via `signInAs`, subscribe private, await status/broadcast with timeouts)
- [ ] `apps/api/tests/integration/notifications.test.ts`, `push.test.ts`, `events-reminders.test.ts`, `chat.test.ts`; a `runNotificationJobs(tenantId)` helper in `setup.ts` (the `runInviteSendJobs` pattern)
- [ ] Fake push transport + test HTTPS-free path (transport seam), `generateRequestDetails` header unit tests
- [ ] `apps/web/lib/push-sw.ts` + unit tests; `apps/web/e2e/notifications.spec.ts`, `push.spec.ts`, `chat.spec.ts` (mocked `PushManager` via `addInitScript`, `serviceWorkers: 'block'` where routes are intercepted — the 03-05 lesson)
- [ ] Seed: one `support_tenant` per tenant; notifications/chat enabled on `rede-demo`, off on `rede-lab` (already the flag pattern)
- [ ] TDD red-evidence normaliser if any plan is TDD (Vitest emits no TAP; memory note)

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (token handed to JS) | Supabase JWT (ES256/JWKS); BFF token route with `Sec-Fetch-Site` gate, `no-store` |
| V3 Session Management | yes | HttpOnly cookies unchanged; Realtime disconnect on logout/blocked; push unsubscribe on logout |
| V4 Access Control | yes (core) | RLS `realtime.messages` select-only policy via definer; `requirePermission('chat.support')`; per-user notification policies ANDed with tenant |
| V5 Input Validation | yes | Zod (body 1-2000, seq ints, subscription JSON: https endpoint, key lengths) + DB CHECKs |
| V6 Cryptography | yes | `web-push` (VAPID ES256, aes128gcm) — never hand-rolled; VAPID private key in Secret Manager |
| V7 Error/Logging | yes | Shape-only logs (no bodies/excerpts/endpoints), the T-04-05 posture |
| V8 Data Protection | yes | Ids-only Realtime payloads; ≤100-char previews only in push (accepted, D-235); 90-day prune |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Subscribing to another tenant's/user's topic | Information disclosure | Definer topic check (tenant membership + own uid + participant/staff), pgTAP + live negatives |
| Browser broadcasting spoofed signals | Spoofing/Tampering | No INSERT policy on `realtime.messages`; clients only read; signals carry ids and trigger an authorised refetch |
| Blocked member keeps socket | Elevation (residual) | Re-evaluated on token refresh/join; ids-only; API refuses reads; web disconnects on blocked |
| Raw JWT reaches PostgREST | Information disclosure | Every policy keeps `tenant_id = app.tenant_id()` (NULL without the lane claim) |
| Push endpoint hijack / cross-user device reuse | Spoofing | Endpoint-unique upsert via definer; unsubscribe on logout; send-time membership check |
| SSRF via push endpoint | Tampering | Accept only `https:` endpoints; optional allow-list of known push-service hosts (fcm.googleapis.com, updates.push.services.mozilla.com, web.push.apple.com, *.notify.windows.com) [ASSUMED list — verify] |
| Chat XSS | Tampering | Plain text rendering + shared linkify (`rel="noopener noreferrer"`, `target=_blank`), never `dangerouslySetInnerHTML` |
| Notification flood / cost | DoS | Tenant-wide topic, tag/topic collapse, TTLs; staff-only publishing in V1 |
| Forged job payload `tenantId` | Tampering | Worker re-enters the tenant lane; RLS decides (T-07-03 precedent) |

## Sources

### Primary (HIGH confidence — verified in this session)
- Local stack, read-only: `realtime.send`/`realtime.topic` definitions, `\d realtime.messages` (partitioned, RLS on, no policies), grants, `pg_roles` bypassrls, `_realtime.tenants` (`private_only = f`, limits 200/100/100/100, JWKS present)
- Repo files: `packages/core/server/events/bus.ts`, `packages/core/server/jobs/boss.ts`, `packages/core/server/modules/manifest.ts`, `apps/api/src/modules/registry.ts`, `apps/api/src/worker.ts`, `packages/core/server/media/sweep-job.ts`, `packages/core/db/{tenant-tx.ts,rls.ts}`, `packages/core/db/schema/{memberships,notification-stubs,chat-stubs}.ts`, `supabase/migrations/20260912030541_app_helpers.sql`, `…031029_app_membership_lookup_and_grants.sql`, `…171114_membership_lookup_lifecycle.sql`, `supabase/config.toml`, `turbo.json`, `packages/contracts/src/{events,bootstrap,modules,branding}.ts`, `packages/modules/{feed,stories,events}/contracts/index.ts`, `packages/modules/events/db/schema.ts`, `apps/web/{app/sw.ts,components/pwa/*,lib/supabase/*,lib/api.ts,app/api/stories/views/route.ts,lib/manifest.ts,next.config.ts,playwright.pwa.config.ts}`, `packages/core/ui/{TopBar.tsx,nav.ts,AppShell.tsx}`, `packages/core/docs/SCHEMA-CONVENTIONS.md`, `supabase/tests/{000-helpers,020-tenant-isolation}.sql`
- `@supabase/realtime-js@2.116.0` dist (`RealtimeClient.js`: accessToken callback, heartbeat re-auth, `HEARTBEAT_INTERVAL: 25000`)
- `web-push@3.6.7` source tarball (`web-push-lib.js`, `vapid-helper.js`, `urlsafe-base64-helper.js`)
- pg-boss 12.31.0 `dist/plans.js` (`keep_until = start_after + retention`)
- npm registry (`npm view`) + `gsd-tools package-legitimacy check`

### Secondary (MEDIUM — official docs, fetched)
- https://supabase.com/docs/guides/realtime/authorization — RLS on `realtime.messages`, `realtime.topic()`, caching, revocation
- https://supabase.com/docs/guides/realtime/limits — per-plan limits and error codes
- https://supabase.com/docs/guides/realtime/pricing and https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages — 2M Free quota, N+1 counting
- https://supabase.com/docs/guides/realtime/broadcast and https://supabase.com/blog/realtime-broadcast-from-database — `realtime.send`, `broadcast_changes`, WAL-based delivery
- https://supabase.com/docs/reference/api/v1-update-realtime-config — `private_only`
- https://github.com/supabase/realtime/blob/main/lib/realtime/tenants/authorization.ex — probe-based authorization check
- https://github.com/web-push-libs/web-push (README) — options, errors
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/, https://webkit.org/blog/12945/meet-web-push/, https://webkit.org/blog/14112/badging-for-home-screen-web-apps/, https://webkit.org/blog/16535/meet-declarative-web-push/
- https://developer.mozilla.org/en-US/docs/Web/API/Badging_API, https://caniuse.com/mdn-api_navigator_setappbadge
- https://web.dev/articles/push-notifications-common-notification-patterns — focused-window exception, click patterns

### Tertiary (LOW — web search only)
- https://pushpad.xyz/blog/chrome-push-notifications-this-site-has-been-updated-in-the-background — Chrome default banner cause
- https://github.com/orgs/supabase/discussions/40417 — no local config key for private-only
- Search summaries on Declarative Web Push `mutable` semantics (not relied upon)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Versions come from the registry and lockfile; the packages are CLAUDE.md-named.
- Realtime authorization/publishing: HIGH for the local mechanics (functions, grants, RLS, roles inspected). MEDIUM for hosted behaviour (docs).
- Quotas/sizing: MEDIUM. Official numbers, but the msg/s counting semantics are unstated and the pilot size is assumed.
- Fan-out/EVENT-07/chat seq: HIGH. These are derived from verified repo code and Postgres semantics, and each is test-pinned.
- Web Push / iOS / Badging: MEDIUM. Official WebKit/MDN sources; device behaviour needs the real-device plan.
- Pitfalls: HIGH for the repo-specific ones; MEDIUM for the browser ones.

**Research date:** 2026-09-29
**Valid until:** 2026-10-29 (Supabase Realtime and realtime-js move fast; re-check limits and the realtime-js pin at plan time if > 2 weeks)
