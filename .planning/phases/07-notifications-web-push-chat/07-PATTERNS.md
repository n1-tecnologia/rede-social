# Phase 7: Notifications, Web Push & Chat - Pattern Map

**Mapped:** 2026-09-30
**Files analyzed:** 48 (new + modified, from 07-CONTEXT, 07-RESEARCH §Recommended Project Structure, 07-UI-SPEC §Component Inventory)
**Analogs found:** 42 / 48

All analog paths below are git-tracked source (no install/runtime mirrors).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/modules/notifications/{package.json,turbo.json,tsconfig.json,vitest.config.ts}` | config | — | `packages/modules/events/{package.json,turbo.json,...}` | exact |
| `packages/modules/chat/{package.json,turbo.json,...}` | config | — | same | exact |
| `packages/modules/notifications/module.ts` | manifest | event-driven | `packages/modules/events/module.ts`, `packages/modules/feed/module.ts` (jobs) | exact |
| `packages/modules/chat/module.ts` | manifest | event-driven | `packages/modules/events/module.ts` | exact |
| `packages/modules/{notifications,chat}/contracts/index.ts` | contract | request-response | `packages/modules/events/contracts/index.ts` (EventMap merge at 629-635) | exact |
| `packages/modules/notifications/db/schema.ts` (moved from core stub + `seen_at`, `push_subscriptions`) | model | CRUD | `packages/core/db/schema/notification-stubs.ts` + `packages/modules/events/db/schema.ts` | exact |
| `packages/modules/chat/db/schema.ts` (moved from core stub + `last_seq`, `staff_last_read_seq`, body CHECK) | model | CRUD | `packages/core/db/schema/chat-stubs.ts` | exact |
| `packages/core/db/schema/{notification-stubs,chat-stubs}.ts` (remove/re-export) | model | — | `packages/core/db/schema/*` barrel | exact |
| `packages/modules/{notifications,chat}/server/routes.ts` | route | request-response | `packages/modules/events/server/routes.ts` | exact |
| `packages/modules/{notifications,chat}/server/service.ts` | service | CRUD | `packages/modules/events/server/service.ts`, `packages/modules/feed/server/service.ts` | exact |
| `packages/modules/notifications/server/fanout-job.ts` | job | batch / event-driven | `packages/modules/feed/server/unfurl/job.ts` (260+) | role-match |
| `packages/modules/notifications/server/push/send-job.ts`, `transport.ts`, `payload.ts` | job/utility | request-response (outbound) | `packages/modules/feed/server/unfurl/job.ts`; `kernel.invite-send` retry opts (`boss.ts` 150-157) | role-match |
| `packages/modules/notifications/server/channels/{types,registry,in-app,push}.ts` | utility (adapter registry) | transform | `packages/core/server/jobs/boss.ts` `registerJobQueues` (26-33) | partial |
| `packages/modules/notifications/server/sink.ts` | service (bus bridge) | pub-sub | `apps/api/src/modules/registry.ts` 43-48 + `boss.ts` `enqueueInTx` | role-match |
| `packages/core/server/notifications/{source,sink,realtime}.ts` | kernel seam | pub-sub | `packages/core/server/rbac/permissions.ts` `setPermissionResolver` (used at registry.ts:159) | role-match |
| `packages/core/server/modules/manifest.ts` (+ `notificationSources`, `counters`, `sweepFunctions`) | kernel type | — | itself (lines 82-101: optional field + docblock) | exact |
| `packages/core/server/media/sweep-job.ts` (+ registered sweep fns) | job | batch | itself (138-175) | exact |
| `apps/api/src/modules/registry.ts` (add modules, wire sources) | composition | pub-sub | itself (28-48) | exact |
| `apps/api/src/routes/me.ts` (real counters; `/v1/me/counters`) | route | request-response | itself (~190) | exact |
| `packages/modules/{feed,stories,events}/server/notifications.ts` | service (producer source) | transform | `packages/modules/feed/server/service.ts` emit sites (844-854) | partial |
| `packages/modules/events/server/reminders.ts` | job | event-driven (deferred) | `enqueueInTx(...{startAfter})` in `boss.ts` 158-185 + `feed/server/service.ts:714` | role-match |
| `packages/core/server/rbac/require-role.ts` / chat manifest `defaultRolePermissions` (D-223) | config | — | `packages/modules/events/module.ts` 73-81 | exact |
| `supabase/migrations/<ts>_realtime_authorization.sql` (--custom) | migration | — | `supabase/migrations/20260927185926_event_check_in_function.sql` | exact (definer pattern) |
| `supabase/migrations/<ts>_notifications_functions.sql`, `<ts>_chat_functions.sql` (--custom, triggers) | migration | event-driven | same + `20260927154335_event_attendance_guard.sql` (trigger) | role-match |
| `supabase/migrations/<ts>_notifications.sql`, `<ts>_chat.sql` (generated) | migration | — | `pnpm db:generate` output (e.g. `20260927185909_event_checkin_attempts.sql`) | exact |
| `supabase/tests/150-realtime-authorization.sql`, `151-notifications.sql`, `152-chat.sql` | test (pgTAP) | — | `supabase/tests/141-event-attendances.sql`, `142-event-checkin.sql` | exact |
| `apps/api/tests/integration/{notifications,push,chat,realtime}.test.ts` | test | request-response | `apps/api/tests/integration/events-rsvp.test.ts`, `feed-unfurl.test.ts`, `jobs.test.ts`, `worker.test.ts` | exact |
| `apps/api/tests/integration/isolation.test.ts` (new lettered cases) | test | — | itself (1390-1589, `it('x. …')`) | exact |
| `packages/modules/notifications/ui/{NotificationItem,NotificationList}.tsx` | component | — | `reference/frontend-design/components/notifications/*` (port) + `packages/modules/events/ui/AttendeeRow.tsx` (props-only house style) | exact (proto) |
| `packages/modules/notifications/ui/{SoftAskCard,PushSwitchRow}.tsx` | component | — | `packages/modules/events/ui/NextEventCard.tsx` (props-only card) | role-match |
| `packages/modules/chat/ui/{ThreadHeader,MessageBubble,DaySeparator,MessageList,ChatComposer,InboxRow}.tsx` | component | — | `reference/frontend-design/app/(app)/suporte/[ticketId]/page.tsx` (bubbles) + `packages/modules/feed/ui/CommentInput.tsx` (composer) | role-match |
| `packages/ui/src/.../Linkify.tsx` (re-homed) + `packages/modules/feed/ui/linkify.tsx` (re-export) | utility component | transform | `packages/modules/feed/ui/linkify.tsx` | exact (move) |
| `packages/ui` `Badge` (`variant="dot"`), `packages/core/ui/TenantLogo.tsx` (`size="thread"`) | component | — | themselves | exact |
| `packages/core/ui/realtime/{RealtimeProvider,useRealtimeTopic,LiveCountersProvider}.tsx` | provider | streaming (subscribe-only) | — | none |
| `packages/core/ui/{TopBar,DesktopRail,AppShell}.tsx` (live counters) | component | — | themselves | exact |
| `apps/web/app/api/realtime/token/route.ts`, `apps/web/app/api/me/counters/route.ts`, push-subscription BFF | route (BFF) | request-response | `apps/web/app/api/stories/views/route.ts` | exact |
| `apps/web/app/(app)/notificacoes/page.tsx` (+ `NotificationsSurface.tsx`) | page | request-response | `apps/web/app/(app)/eventos/page.tsx` + `EventsList.tsx` | exact |
| `apps/web/app/(app)/suporte/{page.tsx,layout.tsx,[conversationId]/page.tsx,ThreadPane.tsx,SupportInbox.tsx}` | page | request-response + streaming | `apps/web/app/(app)/eventos/*` (page), `EventRefresh.tsx` (refresh) | role-match |
| `apps/web/app/(app)/configuracoes/page.tsx` (row 148 → switch) | page | — | itself (ThemeToggle row at 141-145) | exact |
| `apps/web/app/(app)/layout.tsx` (counters, providers) | layout | — | itself (~71) | exact |
| `apps/web/app/(app)/post/[postId]` + feed `CommentsList` (`highlightCommentId`) | page/component | — | themselves | exact |
| `apps/web/lib/{notifications,chat}.ts` (API fetchers) | utility | request-response | `apps/web/lib/events.ts` | exact |
| `apps/web/lib/chat-view.ts` (+ test) | utility | transform | `apps/web/lib/events-view.ts` + `events-view.test.ts` | exact |
| `apps/web/lib/push.ts`, `apps/web/lib/push-sw.ts` (+ tests) | utility | event-driven | `apps/web/components/pwa/InstallHint.tsx` pure exported helpers | role-match |
| `apps/web/app/sw.ts` (push / notificationclick / pushsubscriptionchange) | service worker | event-driven | itself (84-100) | exact |
| `apps/web/components/pwa/InstallHint.tsx` (`variant`, `onClose`, `isIosLike`) | component | — | itself | exact |
| `apps/web/lib/registry.tsx` (notification row renderers by kind) | composition | — | itself (`eventsHome`) | exact |
| `apps/web/messages/pt-BR/{notifications,chat}.json` | config (i18n) | — | existing `apps/web/messages/pt-BR/*.json` | exact |
| `apps/web/e2e/{notifications,suporte}.spec.ts` | test (Playwright) | — | `apps/web/e2e/events.spec.ts` + `events-admin.ts` helper | exact |
| `docs/DEPLOY.md` (VAPID, Realtime private_only steps) | doc | — | existing DEPLOY.md user-step sections | exact |

## Pattern Assignments

### `packages/modules/{notifications,chat}/module.ts` (manifest)

**Analog:** `packages/modules/events/module.ts` (1-82). Copy verbatim structure:
```typescript
import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { EVENT_PERMISSIONS } from './contracts/index';
const log = moduleLogger('module-events');   // never a bare pino() (WR-12)

export const eventsModule = defineModule({
  key: 'events',
  nav: { placement: 'tab', label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
  routes: () => import('./server/routes').then((m) => m.eventsRoutes),
  events: [ { event: 'event.published', handler: async (payload) => { log.info({ event: 'event.published', ...payload }, '…'); } }, … ],
  defaultRolePermissions: { admin_tenant: [...], support_tenant: [...], member: [...] },
});
```
- For notifications: `nav: { placement: 'topbar', icon: 'bell', badge: 'unreadNotifications', href: '/notificacoes', … }` (`ModuleNavBadge` already typed in `manifest.ts:14`).
- For chat: `badge: 'unreadConversations'`, `href: '/suporte'`, `defaultRolePermissions: { admin_tenant: ['chat.support'], support_tenant: ['chat.support'] }` (D-223).
- Jobs: `jobs: [feedUnfurlJob]` form from `packages/modules/feed/module.ts:33`.
- `key` must be in `TOGGLEABLE_MODULES` or `defineModule` throws (manifest.ts 108-113) — verify `notifications`/`chat` are listed in `@rede-social/contracts`.

### `packages/modules/*/package.json` / `turbo.json`
**Analog:** `packages/modules/events/package.json` — `exports` map `./module`, `./contracts`, `./server`, `./ui`, `./db`; deps pinned exact (`hono 4.13.7`, `zod 4.6.2`, `drizzle-orm 0.45.2`). `turbo.json` = `{ "extends": ["//"], "tags": ["module"] }` (enforces no module→module import). Add `web-push@3.6.7` to notifications AND `apps/api` (tsup externals, RESEARCH Pitfall 12).

### `packages/modules/*/contracts/index.ts`
**Analog:** `packages/modules/events/contracts/index.ts` 629-635 — EventMap declaration merge:
```typescript
declare module '@rede-social/contracts' {
  interface EventMap {
    'event.published': EventPublished;
    'event.reactivated': EventReactivated;
  }
}
```
Use for `chat.message_sent`, `event.reminder_due`. Payloads ids + instants only (T-06-06).

### `packages/modules/notifications/db/schema.ts`, `packages/modules/chat/db/schema.ts`
**Analogs:** `packages/core/db/schema/notification-stubs.ts` (whole file, 45 lines) and `chat-stubs.ts` (111 lines) — move tables, keep names/indexes; imports switch to the module-side form used by `packages/modules/events/db/schema.ts` 1-17:
```typescript
import { tenantIsolationPolicy } from '@rede-social/core/db/rls';
import { tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
```
Stub already has: `notifications_event_user_uq … where event_id is not null` (idempotency), `chat_conversations_one_support_per_member` partial unique, `chat_messages_conversation_seq_uq`, `tenantIsolationPolicy(...)` + `.enableRLS()`. Add `seen_at`, dedupe key, `staff_last_read_seq`/`last_seq`, body CHECK `char_length(btrim(body)) between 1 and 2000` via `check('…_chk', sql\`…\`)` (pattern chat-stubs.ts:50). Keep the big "THINGS A REVIEWER MUST NOT FIX" docblock style from events schema (lines 9-50).

### `packages/modules/{notifications,chat}/server/routes.ts`
**Analog:** `packages/modules/events/server/routes.ts` 1-100:
```typescript
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';

const events = new OpenAPIHono<AppEnv>({ defaultHook: (result) => { if (!result.success) throw new ApiError(400, 'VALIDATION_FAILED', { issues: … }); } });
events.use('*', requireAuth, requireModule('events'));   // 401 -> 404 -> 403 (ROLE-06 order)
```
Inbox routes add `requirePermission('chat.support')` per route. Mount in `apps/api/src/app.ts` as plain `.route('/v1/notifications', …)`.

### `packages/modules/*/server/service.ts`
**Analog:** `packages/modules/feed/server/service.ts` — `withTenantTx` writes, then `emit(ctx, …)` AFTER the tx (844-854):
```typescript
emit(ctx, 'post.published', { tenantId: ctx.tenantId, postId: created.id, authorUserId: ctx.userId, communityId: created.community_id, hasMedia: …, occurredAt: created.created_at });
```
Constraint-violation → `ApiError(400,…)` mapping (feed 836-841). `enqueueInTx(tx, QUEUE, payload, opts)` inside the tx (feed 714).

### `packages/modules/notifications/server/fanout-job.ts`, `push/send-job.ts`
**Analog:** `packages/modules/feed/server/unfurl/job.ts` 260-300:
```typescript
export const feedUnfurlJob: JobDefinition<FeedUnfurlJob> = {
  name: FEED_UNFURL_QUEUE,
  handler: async (payload) => {
    const parsed = z.object({ tenantId: z.uuid(), previewId: z.uuid(), url: z.string().min(1) }).safeParse(payload);
    if (!parsed.success) { log.warn({ event: 'feed.unfurl.bad_payload' }, '…'); return; }  // drop, never retry malformed
    …
    log.info(/* shape only, no body/url */);
```
Push send: 404/410 → delete row and return; 429/5xx → throw so pg-boss retries with `retryLimit/retryBackoff` (boss.ts 150-157, `kernel.invite-send` precedent).

### `packages/core/server/notifications/{source,sink}.ts` + `apps/api/src/modules/registry.ts`
**Analog:** registry.ts 43-48 and 159:
```typescript
for (const manifest of Object.values(MODULE_REGISTRY)) {
  for (const subscription of manifest?.events ?? []) subscribe(subscription.event, subscription.handler);
  registerJobQueues((manifest?.jobs ?? []).map((job) => job.name));
}
setPermissionResolver(permissionsFor);   // kernel seam inverted by the app tier
```
Add `notifications: notificationsModule, chat: chatModule` to `MODULE_REGISTRY` (28-34) and the `notificationSources` loop (RESEARCH Pattern 1). Sink setter mirrors `setPermissionResolver`. Bus handlers must not throw expectations — `flush` swallows and logs (bus.ts 68-100); events are dropped when the handler errored (106+).

### `packages/core/server/modules/manifest.ts`
Add optional fields after `requires?` (line 100) with the same docblock voice; kernel stays module-agnostic.

### `packages/core/server/media/sweep-job.ts`
Extend `sweepOrphansJob.handler` (138+) with a third independent `try { … } catch { log.error({ event: 'media.sweep.…_failed' }) }` block calling registered sweep fns (e.g. `app.notifications_prune`) — same "one failing pass never stops the others" structure.

### `packages/modules/events/server/reminders.ts`
Arm in the events write tx: `await enqueueInTx(tx, 'events.reminder', { tenantId, eventId, window, startsAt }, { startAfter: <Date>, singletonKey: \`${eventId}:${window}:${startsAt}\` })` (signature boss.ts 158-172). Skip if `startAfter` already past. Fire-time check against `starts_at` + status; emit `event.reminder_due`.

### Migrations (--custom definer functions / triggers)
**Analog:** `supabase/migrations/20260927185926_event_check_in_function.sql` — header explaining WHY definer + Pitfall 2 (owner bypasses RLS, every statement scopes `tenant_id`), then:
```sql
create or replace function app.events_check_in(...) returns ... language plpgsql volatile security definer set search_path = '' as $$ … $$;
revoke all on function app.events_check_in(uuid, text) from public;--> statement-breakpoint
grant execute on function app.events_check_in(uuid, text) to authenticated;
```
Use for `app.realtime_topic_allowed`, `app.realtime_signal`, `app.notifications_prune`, seq BEFORE INSERT + broadcast AFTER INSERT triggers (trigger precedent: `20260927154335_event_attendance_guard.sql`). Note `--> statement-breakpoint` separators.

### pgTAP `supabase/tests/150/151/152-*.sql`
**Analog:** `supabase/tests/141-event-attendances.sql` — `begin;` + numbered-facts header comment (fact list, each with its T-/D- id), positive control per negative, cross-tenant block "B's lane selects zero rows of A", ANALYZE'd fixture for index-by-name assertions. Numbering continues after 142.

### API integration tests
**Analogs:** `apps/api/tests/integration/events-rsvp.test.ts` (route + DB), `feed-unfurl.test.ts` / `jobs.test.ts` / `worker.test.ts` (job handlers), `isolation.test.ts` lettered cases (`it("r. …")` after `q.`). Run with `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`.

### UI: `NotificationItem`, `NotificationList`
**Analog:** `reference/frontend-design/components/notifications/NotificationList.tsx` 1-40 (Novas/Anteriores split: `unread.filter(!isRead)` → `<h2>Novas</h2>` …). Port rules: no mock data, no literals (strings as props, `SectionTitle group`), `@/lib/utils` `cn` → `@rede-social/ui`. House style for props-only module UI: `packages/modules/events/ui/AttendeeRow.tsx`, exported via `ui/index.ts`.

### UI: chat components
**Analogs:** bubble visuals from `reference/frontend-design/app/(app)/suporte/[ticketId]/page.tsx` (drop attachments/resolve/status); composer from `packages/modules/feed/ui/CommentInput.tsx`; linkify from `packages/modules/feed/ui/linkify.tsx` (rules: no HTML sink, http/https only, `rel="noopener noreferrer nofollow" target="_blank"`) — move to `@rede-social/ui`, feed re-exports.

### BFF routes `apps/web/app/api/{realtime/token,me/counters,push/subscriptions}/route.ts`
**Analog:** `apps/web/app/api/stories/views/route.ts` 1-60+: `export const dynamic = 'force-dynamic'`, `sameOrigin(request)` via `x-forwarded-host`/`host` (403), size cap, `createClient()` from `@/lib/supabase/server` + `getClaims()` (401), forward once through `apiFetch` helper in `@/lib/*`, `cache-control: no-store`, log shape only.

### Pages `/notificacoes`, `/suporte`
**Analog:** `apps/web/app/(app)/eventos/page.tsx` — async server component, `requireBootstrap()` from `@/lib/bootstrap`, `getTranslations`, loader in `@/lib/events.ts`, view formatting in `@/lib/events-view.ts` using `bootstrap.tenant.timezone`, client list component (`EventsList.tsx`) with `InfiniteScroll`; permission gates read bootstrap `permissions` never role. `loading.tsx` / `not-found.tsx` siblings as in `eventos/[...]/`.

### `apps/web/lib/{notifications,chat}.ts`, `chat-view.ts`
**Analog:** `apps/web/lib/events.ts` (imports schemas from `@rede-social/module-*/contracts`, parses API responses with Zod) and `events-view.ts` + `events-view.test.ts` (fixed clock + tz unit tests).

### `apps/web/app/sw.ts`
Add `self.addEventListener('push'|'notificationclick'|'pushsubscriptionchange', …)` before/after `serwist.addEventListeners()` (line 100); keep pure logic in `lib/push-sw.ts`. `NETWORK_ONLY_PREFIXES` (line 45) already covers `/api/`, `/v1/`.

### `apps/web/components/pwa/InstallHint.tsx` / `lib/push.ts`
Extend in place; follow its exported-pure-helper pattern (`isIosSafari`, `isStandalone(w: WindowLike)`, `shouldShowInstallHint`) with tests in `InstallHint.test.ts`; localStorage flags guarded by `Number()`+NaN, UX-only (T-02-78) — reuse for the soft-ask dismissal key.

### `apps/web/app/(app)/configuracoes/page.tsx`
Replace line ~148 `<Row icon="bell" label={t('settings.rows.notifications')} trailing={soon} />` with a `PushSwitchRow` trailing, same shape as the ThemeToggle row (141-145); keep the `platform ? null :` guard.

### `apps/api/src/routes/me.ts` + `apps/web/app/(app)/layout.tsx`
Replace `counters: { unreadNotifications: 0, unreadConversations: 0 }` (me.ts ~190) with manifest-composed counters; layout.tsx ~71 passes counters to `AppShell` (platform branch keeps zeros).

## Shared Patterns

### Guard chain
Source: `packages/modules/events/server/routes.ts` — `use('*', requireAuth, requireModule(key))` then per-route `requirePermission(...)`. Apply to all new API routes.

### Tenant lane + definer discipline
Source: `event_check_in_function.sql` header; modules never import `@rede-social/core/db` / `withAdminTx`. Every definer filters `tenant_id` explicitly; `revoke … from public; grant execute … to authenticated`.

### Domain events after commit
Source: `packages/core/server/events/bus.ts` 30-46 (`emit` queues on ctx), 106+ (`flushEventsAfterHandler`, dropped on error). Producers only emit; consumers subscribe through the registry.

### Jobs
Source: `boss.ts` `enqueueInTx` (158-185), `registerJobQueues`; job handlers Zod-parse payload and drop malformed (unfurl job). Log shape only.

### Logging
`moduleLogger('module-<key>')`; `log.info({ event: '<dotted.name>', ...ids }, 'msg')` — no bodies, URLs or message text.

### Isolation tests
Every new table → pgTAP cross-tenant case; every endpoint → `isolation.test.ts` lettered case; realtime policy → non-participant + cross-tenant negatives.

### i18n
All strings via `next-intl` catalog `apps/web/messages/pt-BR/*.json`; module UI takes strings as props; `scripts/check-ui-literals.sh` gate.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/ui/realtime/RealtimeProvider.tsx` / `useRealtimeTopic` / `LiveCountersProvider` | provider | streaming | No browser Realtime client exists yet; use RESEARCH Pattern 13 (`@supabase/realtime-js` `accessToken` callback, `private: true`) |
| `app.realtime_topic_allowed` + `realtime.messages` policy | migration | — | First policy on `realtime.messages`; follow RESEARCH Pattern 2 SQL (definer form from check-in fn) |
| chat seq BEFORE INSERT counter-row trigger | migration | — | No counter-row seq exists; RESEARCH seq section |
| `notifications/server/push/transport.ts` (web-push) | utility | outbound | No web-push usage yet; RESEARCH §Web Push |
| `lib/push.ts` subscribe flow + SW push handlers | utility | event-driven | No PushManager code yet; RESEARCH Pattern 11 |
| `channels/registry.ts` adapter registry | utility | transform | Only loose analog (`registerJobQueues`); RESEARCH NOTIF-04 section |

## Metadata

**Analog search scope:** `packages/modules/*`, `packages/core/{server,db,ui}`, `apps/api/src`, `apps/api/tests/integration`, `apps/web/{app,lib,components,e2e}`, `supabase/{migrations,tests}`, `reference/frontend-design`
**Files scanned:** ~60
**Pattern extraction date:** 2026-09-30
