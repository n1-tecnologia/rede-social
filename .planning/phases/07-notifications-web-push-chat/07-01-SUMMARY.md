---
phase: 07-notifications-web-push-chat
plan: 01
subsystem: notifications
tags: [notifications, tracer, module-package, kernel-seam, realtime-authorization, fan-out, pg-boss, keyset, drizzle, pgtap, next-intl, playwright]
status: complete

requires:
  - phase: 04-feed
    provides: "post.published domain event, feed_posts / feed_post_media, the post page /post/{id}"
  - phase: 01-foundation
    provides: "the notifications and chat stub tables, the bus, pg-boss enqueueInTx, withTenantTx, app.* claim helpers"
provides:
  - "@rede-social/module-notifications (manifest, contracts, server, ui, db)"
  - "kernel notification seam: sources/retractions, sink, counters resolver; manifest notificationSources / notificationRetractions / counters"
  - "notifications table reshaped (dedupe key, subject/object, actor, seen_at, owner-only policies)"
  - "app.realtime_topic_allowed + realtime_tenant_topics_select (the only realtime.messages policy), app.realtime_signal"
  - "app.notifications_fanout (definer, tenant-scoped, idempotent)"
  - "feed post.published source (feed.post / feed.community_post / feed.reel)"
  - "GET /v1/notifications, POST /seen, /{id}/read, /read-all; bootstrap counters from countersFor"
  - "/notificacoes with Novas / Anteriores keysets, seen, read-in-place, mark-all; BFF mark routes"
  - "@rede-social/contracts/realtime (topic spec) and /text (cutOnWord)"
affects: [07-03 live counters, 07-04 retractions and generic row, 07-05 event sources, 07-06 push channel, 07-07 soft-ask, 07-08 chat topics and counters]

actuals:
  tokens: 70100
  tasks: 3
  commits: 4
plan_head_before: 7c4a2784b158aa81e64f8d29cc18c9aaa930893c

tech-stack:
  added: []
  patterns:
    - "Producer-declared notificationSources on the kernel seam; the notifications module never imports a producer (MOD-02)"
    - "Every Realtime publish from SECURITY DEFINER code (app.realtime_signal); ids-only payloads"
    - "Owner-only RLS (tenant_id AND user_id) with writes only through a tenant-scoped definer"
    - "NOTIF-04 channel registry: in_app delivered list becomes the next channel's recipients"
    - "Kind renderers at the web composition point render sentences from facts via next-intl t.rich with a <b> actor tag"
    - "BFF mark routes behind sameOrigin / no-body / session gates, keepalive for the tap"

key-files:
  created:
    - packages/modules/notifications/module.ts
    - packages/modules/notifications/contracts/index.ts
    - packages/modules/notifications/db/schema.ts
    - packages/modules/notifications/server/service.ts
    - packages/modules/notifications/server/routes.ts
    - packages/modules/notifications/server/sink.ts
    - packages/modules/notifications/server/fanout-job.ts
    - packages/modules/notifications/server/channels/registry.ts
    - packages/modules/notifications/server/channels/in-app.ts
    - packages/modules/notifications/ui/NotificationItem.tsx
    - packages/modules/notifications/ui/NotificationList.tsx
    - packages/core/server/notifications/source.ts
    - packages/core/server/notifications/sink.ts
    - packages/core/server/modules/counters.ts
    - packages/contracts/src/realtime.ts
    - packages/contracts/src/text.ts
    - packages/modules/feed/server/notifications.ts
    - packages/modules/feed/server/notification-copy.ts
    - supabase/migrations/20260930123126_notifications.sql
    - supabase/migrations/20260930123133_notifications_drop_event_id.sql
    - supabase/migrations/20260930123213_realtime_authorization.sql
    - supabase/migrations/20260930123214_notifications_functions.sql
    - supabase/tests/150-realtime-authorization.sql
    - supabase/tests/151-notifications.sql
    - apps/api/tests/integration/notifications.test.ts
    - apps/web/app/(app)/notificacoes/page.tsx
    - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
    - apps/web/app/(app)/notificacoes/actions.ts
    - apps/web/app/(app)/notificacoes/loading.tsx
    - apps/web/app/api/notifications/seen/route.ts
    - apps/web/app/api/notifications/[notificationId]/read/route.ts
    - apps/web/app/api/notifications/read-all/route.ts
    - apps/web/lib/notifications.ts
    - apps/web/lib/notifications-view.ts
    - apps/web/lib/notifications-bff.ts
    - apps/web/lib/notification-renderers.tsx
    - apps/web/messages/pt-BR/notifications.json
    - apps/web/e2e/notifications.spec.ts
    - apps/web/e2e/notifications-admin.ts
  modified:
    - packages/core/server/modules/manifest.ts
    - packages/core/db/schema/index.ts
    - packages/core/db/schema/notification-stubs.ts (deleted: moved into the module)
    - packages/modules/feed/module.ts
    - packages/modules/feed/contracts/index.ts
    - apps/api/src/app.ts
    - apps/api/src/modules/registry.ts
    - apps/api/src/routes/me.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/modules.test.ts
    - apps/api/tests/unit/registry.test.ts
    - supabase/tests/020-tenant-isolation.sql
    - apps/web/lib/registry.tsx
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/shell.spec.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "Realtime topic definer checks each id segment against the canonical 8-4-4-4-12 shape after the spec regex, because [0-9a-f-]{36} also admits 36 hyphens that would raise at ::uuid"
  - "A delivered signal payload is {id, kind}: the installed realtime.send injects the message row's own id; still ids-only"
  - "Notification rows carry a preview {assetId, variantWidths} resolved at list time from facts.previewAssetId (MediaImage needs the ladder); the uuid fact is shape-checked inside a CASE before the cast"
  - "Actor bold rendered with next-intl t.rich and a <b> tag in the catalog, so the catalog keeps {actor} and the renderer owns the span"
  - "Kind renderers live in the leaf lib/notification-renderers.tsx and are re-exported by lib/registry.tsx (testable without the server-action graph)"
  - "/notificacoes PageHeader uses the in-shell convention stickyTop=0px md:static (the default offset overlapped the Novas header row)"

patterns-established:
  - "Notification source: resolve(tx, payload, {sinkAt}) -> NotificationIntent[] reading only the producer's own tables, in the worker's tenant lane"
  - "pgTAP Realtime probes: tests.as_realtime_user (sub+role, no tenant_id) + probe rows in an existing realtime.messages partition, skipped by name when none exists"
  - "Raw postgres.js fixtures bind instants as text (::text::timestamptz): its timestamptz serializer truncates to milliseconds; drizzle's client does not"

requirements-completed: [NOTIF-01, NOTIF-02, NOTIF-04]

coverage:
  - id: D1
    description: "An admin's post becomes one feed.post row per live member (author and staff excluded), a bootstrap count of 1, and one ids-only signal on tenant:<t>:all"
    requirement: NOTIF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#notifications tracer"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#D-229: neither the admin nor a support_tenant gets a feed.post row"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-226/D-227 kind rule, idempotency, empty fan-outs and the module flag gate on the fan-out"
    requirement: NOTIF-01
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#notifications list and marks"
        status: pass
      - kind: other
        ref: "supabase/tests/151-notifications.sql (pnpm supabase test db)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Realtime authorisation: every topic join rule, no browser publish, definer-only signals"
    verification:
      - kind: other
        ref: "supabase/tests/150-realtime-authorization.sql (44 assertions, 0 skipped)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/notifications keysets (ordering, microsecond precision, clamps), seen / read / read-all semantics, owner-only isolation"
    requirement: NOTIF-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#notifications list and marks"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b10. notifications"
        status: pass
      - kind: other
        ref: "supabase/tests/020-tenant-isolation.sql + 151-notifications.sql"
        status: pass
    human_judgment: false
  - id: D5
    description: "NOTIF-04 channel registry: in_app registered, canonical order, unregistered push logged not failing"
    requirement: NOTIF-04
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/channels.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "/notificacoes on phone and desktop: bell badge, Novas then Anteriores, 90-day footer, seen clears the bell, tap reads and navigates, mark-all, empty state, 320px label"
    requirement: NOTIF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts (13 passed, 1 phone-only skip on desktop)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts (bell present for rede-demo, absent for rede-lab)"
        status: pass
    human_judgment: true
    rationale: "Visual fidelity to the prototype row (tint, glyph disc, bold actor, spacing) and the feel of read-in-place are judged by eye; automation proves behaviour, not look."

duration: 52min
completed: 2026-09-30
---

# Phase 7 Plan 01: Notifications Tracer Summary

**An admin's feed post reaches each live member as an owner-only notification row, written by a tenant-scoped definer from a worker job fed through a kernel seam, signalled ids-only on a definer-published Realtime topic, counted on the TopBar bell, and listed on `/notificacoes` with Novas/Anteriores keysets, seen, read-in-place and mark-all**

## Performance

- **Duration:** 52 min (this continuation; the earlier executor's partial Task 1 work predates it)
- **Started:** 2026-09-30T12:28:53Z
- **Completed:** 2026-09-30T13:20:36Z
- **Tasks:** 3 of 3
- **Files modified:** 80 (76 excluding drizzle snapshots)

## Accomplishments

- New module package `@rede-social/module-notifications`, with the bell as a TopBar slot (order 10), the `notifications.fanout` worker job, the owner-scoped keyset list and the three marks. It imports no other module (`turbo boundaries` stays clean).
- Kernel seam: producers declare `notificationSources` in their manifests, the app registry registers them and subscribes the sink once per event, and bootstrap counters are composed from the effective modules' `counters`.
- The first `realtime.messages` policy (SELECT only, via the definer `app.realtime_topic_allowed`) and the only publisher, `app.realtime_signal`. pgTAP 150 checks every join rule with probe rows, each block with a positive control.
- `app.notifications_fanout` is idempotent on `(tenant, user, dedupe_key)` and hands back only newly inserted recipients. pgTAP 151 checks the live predicate, owner-only reads and writes, and the list and count indexes by name.
- `/notificacoes` on phone and desktop, backed by BFF mark routes, catalog-driven sentences and the full API battery.

## Task Commits

1. **Task 1 (tracer): module, seam, schema reshape, Realtime authorisation, fan-out, feed source, list route, counters, /notificacoes** - `d45c207` (feat)
   - Follow-up fix: `8faefbe` (fix): removed the row cap from `app.realtime_topic_allowed` to satisfy pgTAP 040's convention (see deviation 5).
2. **Task 2 [BLOCKING schema]: pgTAP 150/151, 020 fixture, isolation b10** - `19bd973` (test)
3. **Task 3: seen/read/read-all, BFF routes, NotificationsSurface, battery, list e2e** - `82124e8` (feat)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

See `key-files` above. The main ones:
- `packages/modules/notifications/server/{service,routes,sink,fanout-job}.ts`: the list, the marks, the enqueue and the worker job.
- `packages/modules/notifications/server/channels/{registry,in-app}.ts`: NOTIF-04 seam and the in_app adapter.
- `supabase/migrations/*_realtime_authorization.sql`, `*_notifications_functions.sql`: the definers and the Realtime policy.
- `packages/modules/feed/server/notifications.ts`: the feed's `post.published` source.
- `apps/web/app/(app)/notificacoes/*`, `apps/web/app/api/notifications/*`, `apps/web/lib/notification*`: the web surface.

## Decisions Made

See `key-decisions`. Also recorded:
- **Local reset (Task 1 precondition):** the developer chose **backup-then-reset**. The backup is `~/rede-social-local-backups/pre-07-reset.sql` (329,529 bytes), outside the repository and never copied into it. The reset applies to the whole phase, so later verify commands reset and re-seed freely.
- A refresh returns both sections, labelled (`refreshNotificationsAction()` takes no section argument), so a pull cannot swap the lists. Load-more carries its section.
- Test-only: the raw postgres.js fixtures bind instants as text. drizzle's client installs pass-through timestamp serializers, so the service's cursor keeps microseconds. The precision case proves this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The installed `realtime.send` adds an `id` key to every signal payload**
- **Found during:** Task 1 (by the previous executor, confirmed here)
- **Issue:** The plan's tracer check expected the payload keys to be exactly `['kind']`, but `realtime.send` injects the message row's own uuid as `id` into any payload that lacks one.
- **Fix:** The tracer now asserts the keys are `['id', 'kind']` and that `payload.id` equals the `realtime.messages` row id. The payload is still ids-only.
- **Files modified:** apps/api/tests/integration/notifications.test.ts
- **Committed in:** d45c207

**2. [Rule 1 - Bug] drizzle generated the list indexes `DESC NULLS LAST`**
- **Found during:** Task 1 (first `db:generate`)
- **Issue:** `order by created_at desc` sorts NULLS FIRST by default, so indexes built `DESC NULLS LAST` could not serve the list's ordering.
- **Fix:** Changed the index columns to `.desc().nullsFirst()` (the feed's precedent) and regenerated before committing.
- **Files modified:** packages/modules/notifications/db/schema.ts, supabase/migrations/20260930123126_notifications.sql
- **Committed in:** d45c207

**3. [Rule 2 - Missing critical] Canonical uuid check inside `app.realtime_topic_allowed`**
- **Found during:** Task 1
- **Issue:** The spec regex `[0-9a-f-]{36}` also matches 36 hyphens. Such a topic passes the regex and then raises at the `::uuid` cast instead of being denied.
- **Fix:** After the verbatim spec regex, each id segment is checked against the 8-4-4-4-12 shape. pgTAP 150 fact 7 pins it.
- **Committed in:** d45c207, 19bd973

**4. [Rule 3 - Blocking] `NotificationSource<any>` failed typecheck**
- **Found during:** Task 1
- **Issue:** `DomainEventName` is `never` in any package that does not augment `EventMap`, so `any` failed the type constraint.
- **Fix:** Replaced the `any` erasure with a default type parameter plus method-syntax bivariance (the kernel's `EventSubscription` pattern).
- **Files modified:** packages/core/server/notifications/source.ts, packages/core/server/modules/manifest.ts
- **Committed in:** d45c207

**5. [Rule 1 - Bug] `limit 1` in the definer broke pgTAP 040's convention**
- **Found during:** Task 2 (`supabase test db`)
- **Issue:** 040 pins `app.membership_for_user` as the only `app` function that silently picks one row.
- **Fix:** Removed the row cap. `memberships_tenant_user_uq` already guarantees one row per tenant and user. The migration was local-only and not yet deployed.
- **Committed in:** 8faefbe

**6. [Rule 3 - Blocking] pgTAP 151 needs a larger fixture than planned**
- **Found during:** Task 2
- **Issue:** With the planned 400 rows (10 unread per recipient), the planner rightly chose a bitmap scan plus sort, so the index-by-name assertion failed.
- **Fix:** Grew the fixture to 4,000 rows (the 141 precedent). The comment records why.
- **Committed in:** 19bd973

**7. [Rule 2 - Missing critical] Row contract gained `preview`**
- **Found during:** Task 1
- **Issue:** `MediaImage` needs the variant ladder, but the facts carry only an asset id.
- **Fix:** The list joins `media_assets` on `facts.previewAssetId`, shape-checked inside a CASE because AND evaluation order is not guaranteed. A retired asset or an empty ladder gives no preview.
- **Committed in:** d45c207

**8. [Rule 3 - Blocking] Kind renderers moved to a leaf module**
- **Found during:** Task 3
- **Issue:** `lib/registry.tsx` imports the feed and stories server actions, so the view test could not import it.
- **Fix:** The renderers live in `lib/notification-renderers.tsx`, which `registry.tsx` re-exports. It is one new file outside `files_modified`.
- **Committed in:** 82124e8

**9. [Rule 1 - Bug] `PageHeader` overlapped the mark-all control**
- **Found during:** Task 3 (e2e)
- **Issue:** The default `stickyTop` assumes a document scroller and intercepted the pointer on the Novas header row.
- **Fix:** Used the in-shell convention (`stickyTop="0px"`, `md:static md:px-0`), as on the post and members pages.
- **Committed in:** 82124e8

**10. [Rule 3 - Blocking] `publishPostAs` publishes through the real API**
- **Found during:** Task 1
- **Issue:** `feed-admin.ts` has no publish helper.
- **Fix:** Signs in the admin and calls `POST /v1/feed/posts`, the `eventsApiAs` pattern. The signature is `(email, caption)`.
- **Committed in:** d45c207

**11. [Rule 2] Positive bell assertions added to `shell.spec.ts`**
- **Found during:** Task 3
- **Issue:** No existing TopBar slot assertion needed updating: the tab lists exclude TopBar and rail bottom-group slots. The D-40 truth therefore had no browser-level check.
- **Fix:** rede-demo shows exactly one visible bell, and rede-lab has none.
- **Committed in:** 82124e8

---

**Total deviations:** 11 auto-fixed (4 Rule 1, 3 Rule 2, 4 Rule 3)
**Impact on plan:** Correctness and testability fixes, no scope creep. One file was added outside the plan's list (`lib/notification-renderers.tsx`), and a second shared helper (`lib/notifications-bff.ts`) replaces three copies of the same gates.

## Issues Encountered

- **Docker Desktop was not running** when this continuation started, although the previous executor had left the stack up. I started it with `open -a Docker` (non-destructive), the containers came back healthy, and the precondition still printed 2.
- **Env hosts (recorded, not acted on).** `pnpm db:seed` prints `platform=tria.localhost rede-demo=tria-demo.localhost rede-lab=tria-lab.localhost`, so the env files still carry the old host values. Every test in this plan reads hosts from the env and passes. Two pre-existing tests outside this plan hardcode `rede-*` hosts and fail only because of this:
  - `apps/web/e2e/phase2-smoke.spec.ts` case 1 fails on the platform host, so cases 2-5 (listed in this plan's Task 3 verify) did not run.
  - `apps/api/tests/integration/signup.test.ts` case 2 fails (`by-host?host=rede-demo.localhost` answers 404).

  I did not work around either one, as instructed. Both are recorded in `deferred-items.md` and the WINDOWS ledger. Static reading shows phase2-smoke's nav lists exclude TopBar slots, so the bell should not change their outcome once the hosts match.
- The full API integration suite passes 639 of 640 tests. The one failure is the signup case above.

## Known Stubs

| File | Line | Stub | Resolved by |
|------|------|------|-------------|
| apps/web/lib/notifications-view.ts | ~61 | A kind with no renderer is filtered out of the list instead of showing the generic row | 07-04 (generic row after its sketch is approved) |
| apps/web/messages/pt-BR/notifications.json | navBadge | The ICU count label exists but the shell's bell still uses the plain `nav` label | 07-03 (live counters) |
| packages/modules/notifications/server/channels | push | Intents request `push`; it logs `notifications.channel_unavailable` until the adapter is registered | 07-06 |

## User Setup Required

None. No external service configuration was needed.

## Next Phase Readiness

- 07-03 can subscribe to the three topics. The builders are in `@rede-social/contracts/realtime`, and seen/read already signal `tenant:<t>:user:<u>`.
- 07-04 and 07-05 add producer sources with the same shape as `feedNotificationSources`, and retractions through `notificationRetractions`.
- 07-06 registers the push channel on the registry; in_app already hands it only the newly inserted recipients.
- 07-08 needs no Realtime SQL, because `conv:` and `support-inbox` are already admitted by the definer.
- Open: regenerate the local env hosts, which unblocks phase2-smoke 2-5 and signup case 2.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All key files exist on disk and all four commits (d45c207, 8faefbe, 19bd973, 82124e8) are in history.
