---
phase: 07-notifications-web-push-chat
plan: 05
subsystem: notifications
tags: [events, reminders, scheduled-jobs, pg-boss, deferred-jobs, notifications, EVENT-07, D-201, D-214, D-226, D-235, D-236, UI-D-251]
status: complete

requires:
  - phase: 06-events
    provides: "createEvent / updateEvent (timesChanged) / setEventStatus, event_attendances, the event.* payloads, lib/events-view.ts formatters"
  - phase: 07-notifications-web-push-chat
    provides: "07-01 NotificationSource seam, sink (sinkAt), notificationsFanoutJob, runNotificationJobs, notification-renderers.tsx; 07-02 sketch 007 (the D-33 gate for Task 2); 07-04 the actor-less glyph leading and the sink singleton-key fix"
provides:
  - "events contracts: EventReminderDue + EventMap 'event.reminder_due', EVENT_REMINDER_WINDOWS, EVENT_REMINDER_OFFSET_MS, EVENT_REMINDER_LATE_TOLERANCE_MINUTES = 30, EVENTS_NOTIFICATION_KINDS, EVENTS_QUEUES.reminder, eventReminderPayloadSchema"
  - "events server: armEventReminders (in-tx), planEventReminders, reminderSingletonKey, reminderSkipReason, runEventReminder, eventReminderJob, eventsSystemCtx, eventsNotificationSources, eventsPushCopy / eventWhen / eventTime, reminderTagAndTopic"
  - "eventsModule.jobs [events.reminder] and notificationSources (published, reactivated, reminder_due)"
  - "integration harness: eventReminderJobsOf(tenantId), runEventReminderJobs(tenantId, nowMs, only?)"
  - "web: renderers for events.event, events.event_reactivated, events.reminder_24h, events.reminder_1h; NotificationRenderContext { timeZone, nowMs }; notificationRowView takes timeZone"
  - "catalog: notifications.kinds.{event,eventReactivated,reminder24h,reminder1h,eventWhen}"
  - "scripts/arm-event-reminders.ts (one-shot backfill, --dry-run)"
affects: [07-06 push channel (event hints, reminder Topic = 32 hex), 07-11 DEPLOY.md backfill step, phase 8 moderation (a removed event makes its reminders no-ops)]

actuals:
  tokens: 31291
  tasks: 2
  commits: 2
plan_head_before: f7910277d32959536b469279039ae4df06aa5c46

tech-stack:
  added: []
  patterns:
    - "Deferred per-entity jobs armed INSIDE the producer's transaction (enqueueInTx with startAfter + a singleton key carrying the instant), checked again at fire time; no cron, no cross-tenant scan"
    - "Job handler body with an injected clock (runEventReminder(payload, nowMs)); the JobDefinition passes Date.now()"
    - "A job that produces a domain event emits on its own system context and awaits flush before returning"
    - "Renderer sentences receive { timeZone, nowMs } so tenant-clock formatting stays on the server"
    - "A root-workspace script restates a module's key/payload rules instead of importing the module (the seed.ts MOD-02 precedent)"

key-files:
  created:
    - packages/modules/events/server/reminders.ts
    - packages/modules/events/server/notifications.ts
    - packages/modules/events/server/notification-copy.ts
    - packages/modules/events/server/system-context.ts
    - packages/modules/events/tests/reminders.test.ts
    - packages/modules/events/tests/notification-sources.test.ts
    - apps/api/tests/integration/events-reminders.test.ts
    - scripts/arm-event-reminders.ts
  modified:
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/module.ts
    - packages/modules/events/tests/events-payload.test.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/notifications.test.ts
    - apps/web/lib/notification-renderers.tsx
    - apps/web/lib/notifications-view.ts
    - apps/web/lib/notifications-view.test.ts
    - apps/web/app/(app)/notificacoes/page.tsx
    - apps/web/app/(app)/notificacoes/actions.ts
    - apps/web/messages/pt-BR/notifications.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/notifications.spec.ts
    - apps/web/e2e/notifications-admin.ts

key-decisions:
  - "A reminder's Web Push Topic is the event id without hyphens (exactly 32 hex characters, RFC 8030's limit); the device tag keeps the readable prefix events-reminder-{hex32}. The broadcast kinds use events-event / events-reactivated for both"
  - "The in-app {when} is the UI-D-203 when.at shape ({date} · {time}) built from lib/events-view.ts formatEventDate + formatEventTime in bootstrap.tenant.timezone, through a new catalog key notifications.kinds.eventWhen; the push banner uses the same shape server-side"
  - "event.reactivated names and excludes the REACTIVATING admin (payload.actorUserId); event.published names and excludes the creator read from the row"
  - "Reminder rows carry the event cover as previewAssetId (sketch 007 surface 7: 'A capa do evento, quando existe, vira a prévia')"
  - "The events system context is role member with the zero user (reads events and event_attendances, never event_secrets)"
  - "The backfill script restates the queue name, offsets, key format and payload shape (it may not import the module); its skipped count includes windows whose job was already waiting"
  - "Sketch 007 (the D-33 gate for Task 2) was approved by the developer, igor.vboas, by hand on 2026-09-30 (approval_kind: provisional; committed as 67ba861 before this plan). The executor only verified it with grep '^approved: true'"

patterns-established:
  - "EVENT-07 arming: armEventReminders(tx, { tenantId, eventId, startsAt }) with the row's STORED starts_at read back in the same transaction"
  - "Integration harness for deferred jobs: <queue>JobsOf(tenantId) + run<Queue>Jobs(tenantId, nowMs, only?) ignoring start_after"

requirements-completed: [EVENT-07, NOTIF-01]

coverage:
  - id: D1
    description: "Reminders are armed in the write transaction: 25 h ahead arms both windows with the exact start_after and singleton key, 2 h ahead only the 1 h job, 30 minutes ahead none; a moved start and a reactivation re-arm, a cancel and an unmoved edit arm nothing"
    requirement: EVENT-07
    verification:
      - kind: unit
        ref: "packages/modules/events/tests/reminders.test.ts#armEventReminders: skip rules and the key format"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/events-payload.test.ts#1, 1b, 11, 12, 14, 15"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/events-reminders.test.ts#events-reminders: arming in the write transaction"
        status: pass
    human_judgment: false
  - id: D2
    description: "At fire time the job follows moves and skips cancels, removals, started events and workers more than 30 minutes late, then emits event.reminder_due (four keys, no title) and flushes before returning"
    requirement: EVENT-07
    verification:
      - kind: unit
        ref: "packages/modules/events/tests/reminders.test.ts#reminderSkipReason / runEventReminder decision tables"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/events-payload.test.ts#30, 31 (event.reminder_due key set)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/events-reminders.test.ts#events-reminders: the job follows moves and skips cancels"
        status: pass
    human_judgment: false
  - id: D3
    description: "Only members who answered Vou get the reminder, once per window ever: A going gets one 24 h row, B not going and C unanswered none, a re-run adds nothing, A blocked before the 1 h job gets no 1 h row; the member reads it actor-less through the list API"
    requirement: EVENT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-reminders.test.ts#events-reminders: the audience is the Vou list, once per window"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/notification-sources.test.ts#event.reminder_due source (EVENT-07)"
        status: pass
    human_judgment: false
  - id: D4
    description: "New and reactivated events reach every live member (creator, reactivator and staff excluded); two reactivations are two notifications, a retried job for one is not; edits and cancels add no row and enqueue no fan-out; push hints carry the tenant-clock copy, tags and TTLs"
    requirement: NOTIF-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#notifications eventos"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/notification-sources.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Event rows show the creator's avatar with CalendarDays / CalendarCheck and the tenant-clock when-line; reminder rows are actor-less on the CalendarClock disc; all open /eventos/{eventId}; a Manaus device reads the São Paulo wall clock"
    requirement: NOTIF-01
    verification:
      - kind: unit
        ref: "apps/web/lib/notifications-view.test.ts#notificationRowView — 07-05 event kinds and actor-less reminders"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#07-05 catalog pins"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications eventos (8 passed, mobile-chromium and desktop-chromium)"
        status: pass
    human_judgment: true
    rationale: "The actor-less reminder row and the event rows are sketch 007 surface 7 items; visual fidelity (disc, spacing, preview) in light and dark under a tenant brand is judged by eye at the phase UAT."
  - id: D6
    description: "scripts/arm-event-reminders.ts arms every active upcoming event of every tenant with the module's payload and singleton key, skips past windows, prints one { events, armed, skipped } line, supports --dry-run, and arms nothing new on a second run"
    requirement: EVENT-07
    verification:
      - kind: other
        ref: "pnpm exec tsx scripts/arm-event-reminders.ts --dry-run → {\"events\":6,\"armed\":12,\"skipped\":0}; real run → armed 12; second run → armed 0, skipped 12"
        status: pass
    human_judgment: false

duration: 31min
completed: 2026-09-30
---

# Phase 7 Plan 05: Event kinds and EVENT-07 reminders Summary

**Members who answered `Vou` get one reminder a day before and one an hour before, from deferred pg-boss jobs armed inside the events module's own write transactions and re-checked at fire time. New and reactivated events reach every member in the tenant's clock. Edits and cancels stay silent, and a one-shot script arms events created before the deploy.**

## Performance

- **Duration:** about 31 min
- **Started:** 2026-09-30T17:23:38Z (plan base f791027)
- **Completed:** 2026-09-30T17:55:00Z
- **Tasks:** 2 of 2
- **Files modified:** 24 (8 created, 16 modified)

## Accomplishments

- **Arming in the producer's transaction.** `createEvent`, `updateEvent` (when `timesChanged`) and `setEventStatus` (cancelled → active) each call `armEventReminders(tx, …)` inside their own `withTenantTx`. Each call enqueues one `events.reminder` job per window, with `startAfter = starts_at − 24 h / − 1 h` and the key `{eventId}:{window}:{startsAtEpochSeconds}`. A past window is skipped, never sent late.
- **Fire-time checks.** `runEventReminder(payload, nowMs)` reads the event in the payload tenant's lane and fires only when all of these hold: the event exists, is not removed, is `active`, still starts at the payload's instant (compared in SQL), has not started, and `now <= fireAt + 30 min`. It then emits `event.reminder_due` and awaits `flush` before returning.
- **Three sources, no more.** `event.published`, `event.reactivated` (dedupe key carries the sink's `sinkAt`) and `event.reminder_due`, which reads the `Vou` list at fire time and dedupes per window and event. There is no source for `event.updated` or `event.cancelled` (D-201, D-214).
- **Tenant-clock copy everywhere.** Push bodies are formatted server-side in `tenants.timezone`. The web rows format through `lib/events-view.ts` in `bootstrap.tenant.timezone`, so a Manaus device reads São Paulo's 19:00.
- **Backfill.** `scripts/arm-event-reminders.ts` arms the same jobs for every tenant through the admin lane. It is idempotent through the same key and the `short` policy.

## Task Commits

1. **Task 1: Event kinds and EVENT-07 end to end** - `3e994ac` (feat)
2. **Task 2: Web rows, actor-less reminders, backfill script, e2e** - `2d9320b` (feat)

**Plan metadata:** recorded in the docs commit that carries this SUMMARY.

## Files Created/Modified

- `packages/modules/events/server/reminders.ts`: arming, the fire-time decision, the job.
- `packages/modules/events/server/notifications.ts`: the three sources, the reminder tag and Topic.
- `packages/modules/events/server/notification-copy.ts`: the pt-BR push bodies in the tenant clock.
- `packages/modules/events/server/system-context.ts`: the events worker lane.
- `packages/modules/events/server/service.ts`: the three `armEventReminders(tx, …)` calls.
- `packages/modules/events/contracts/index.ts`: the reminder contracts and kinds.
- `apps/api/tests/integration/{events-reminders.test.ts,setup.ts,notifications.test.ts}`: the reminders suite, the harness and `notifications eventos`.
- `apps/web/lib/{notification-renderers.tsx,notifications-view.ts}` and `app/(app)/notificacoes/{page.tsx,actions.ts}`: the four row kinds and the timezone threading.
- `apps/web/messages/pt-BR/notifications.json` and `apps/web/i18n/messages.test.ts`: the catalog and its pins.
- `apps/web/e2e/{notifications.spec.ts,notifications-admin.ts}`: `notifications eventos` and its fixtures.
- `scripts/arm-event-reminders.ts`: the backfill.

## Decisions Made

See `key-decisions`. In short:
- **Reminder Topic.** The Web Push Topic is the 32-hex event id, and the device tag is `events-reminder-{hex32}` (see deviation 1).
- **`{when}` shape.** In-app and push both use `{date} · {time}` (UI-D-203's `when.at`).
- **Named actors.** A reactivation names the admin who reactivated the event, and a new event names its creator.
- **D-33 gate for Task 2.** Sketch 007 was approved by hand by the developer, **igor.vboas**, on **2026-09-30** (`approval_kind: provisional`) and committed as `67ba861` before this plan started. The executor only verified `grep -q '^approved: true'` (exit 0) and never edited the README.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The planned reminder tag was not a valid Web Push `Topic`**
- **Found during:** Task 1
- **Issue:** The plan named the tag and topic `events-reminder-{eventIdHex32}`. That is 48 characters, and RFC 8030 caps `Topic` at 32 characters of the URL-safe base64 alphabet. 07-06 sets the `Topic` header from the hint and expects "a 32-hex topic" for reminders.
- **Fix:** `topic` is the 32-hex id, and `tag` keeps the readable `events-reminder-{hex32}`. `reminderTagAndTopic()` owns the pair, and a unit test pins `^[0-9a-f]{32}$`.
- **Files modified:** packages/modules/events/server/notifications.ts, tests/notification-sources.test.ts
- **Committed in:** 3e994ac

**2. [Rule 2 - Missing critical] The reminder payload schema rejects anything the `::timestamptz` cast could refuse**
- **Found during:** Task 1
- **Issue:** A payload that passes `Date.parse` but not Postgres' cast (for example `'2026'`) would make the job raise and be retried forever.
- **Fix:** `startsAt` must match this module's own UTC ISO shape before the refine. A malformed payload is dropped with a shape-only warning (`'dropped'`), never raised.
- **Committed in:** 3e994ac

**3. [Rule 3 - Blocking] `events-payload.test.ts` mocks the kernel's pg-boss wrapper**
- **Found during:** Task 1
- **Issue:** `createEvent` now enqueues inside its transaction, and the real `enqueueInTx` would start pg-boss against a database the unit suite does not have.
- **Fix:** `vi.mock('@rede-social/core/server/jobs/boss')` records every arm, and the suite runs on a fake `Date` set before the fixture start. The suite now also asserts the arming rules (tests 1, 1b, 11, 12, 14, 15) and the `event.reminder_due` key set (30, 31).
- **Committed in:** 3e994ac

**4. [Design fidelity] Reminder facts carry the event cover as `previewAssetId`**
- **Found during:** Task 2 (read_first: sketch 007 surface 7)
- **Issue:** The approved sketch shows the reminder row with the event cover as its 44px preview ("A capa do evento, quando existe, vira a prévia"). The plan's reminder facts had no preview.
- **Fix:** The reminder source reads `e.cover_asset_id` into `facts.previewAssetId`, and the unit and integration expectations include it. A title-free, ids-only fact adds no disclosure.
- **Files modified:** packages/modules/events/server/notifications.ts, tests/notification-sources.test.ts, apps/api/tests/integration/events-reminders.test.ts
- **Committed in:** 2d9320b

**5. [Plan path] The web renderers live in `apps/web/lib/notification-renderers.tsx`, not `registry.tsx`**
- **Found during:** Task 2
- **Issue:** 07-01 moved the renderer map into that leaf module, and `registry.tsx` re-exports it (line 561). 07-04 recorded the same move. The acceptance grep on `registry.tsx` therefore prints 0.
- **Fix:** The four entries are in the leaf. The same grep on `notification-renderers.tsx` prints 5. The acceptance grep is left failing on the literal path rather than padded with a comment.
- **Committed in:** 2d9320b

**6. [Plan detail] `{when}` comes from `formatEventDate` + `formatEventTime`, not `eventWhenLine`**
- **Found during:** Task 2
- **Issue:** `eventWhenLine` needs `endsAt`, `status` and the `events`-namespace translator, but the row's facts carry only `startsAt` and the renderer holds the `notifications` translator.
- **Fix:** Both formatters come from `lib/events-view.ts` in `bootstrap.tenant.timezone`, joined through a new catalog key `notifications.kinds.eventWhen` = "{date} · {time}" (UI-D-203's `when.at`). No literal separator was added in TSX.
- **Committed in:** 2d9320b

**7. [Rule 3 - Blocking] The row view and its callers carry the tenant timezone**
- **Found during:** Task 2
- **Issue:** The renderer signature had no timezone.
- **Fix:** `NotificationRenderer.sentence(facts, t, actorName, { timeZone, nowMs })`, and `notificationRowView({ …, timeZone })`. `notificacoes/page.tsx` passes `bootstrap.tenant.timezone`. `notificacoes/actions.ts` reads it through `getBootstrap()`, which redirects on a refusal and returns the generic error otherwise, never throwing an action. Both files are outside the plan's file list.
- **Committed in:** 2d9320b

**8. [Rule 3 - Blocking] The backfill restates the module's rules instead of importing them**
- **Found during:** Task 2
- **Issue:** The root workspace may not depend on a `module`-tagged package: `turbo boundaries` would mis-attribute the edge (the `seed.ts` precedent, lines 490 and 1547).
- **Fix:** The script restates the queue name, the two offsets, the key format and the payload shape, and its docblock says "edit both together". The keys it wrote were checked by hand against the module's formula (`…:24h:1791039600` for a start at `2026-10-03T15:00:00.000000Z`). A drift would still notify nobody twice, because the fan-out dedupes per `(event, window, user)`.
- **Committed in:** 2d9320b

**9. [Harness] `runEventReminderJobs` takes an optional `only` filter and returns each outcome**
- **Issue:** The move case must run the OLD job and the NEW job of one window separately.
- **Fix:** A third parameter, `only(row)`, where the plan named two. It returns `('emitted' | 'skipped' | 'dropped')[]`.
- **Committed in:** 3e994ac

---

**Total deviations:** 9 (1 bug, 1 missing critical, 3 blocking, 1 design fidelity, 2 plan detail, 1 harness).
**Impact on plan:** Deviation 1 would have produced an invalid push header for every reminder in 07-06. The rest follow the codebase's structure or the approved sketch. No scope creep.

## Issues Encountered

- **Env hosts, one new symptom (pre-existing, not worked around).** The plan-level `playwright test notifications.spec.ts events.spec.ts` passed 94 tests, skipped 28 by design and failed 2. Both failures are one case on both projects: `events.spec.ts` "events detalhe › … ONE not-found screen". Its body prints "…não é de rede-demo.localhost." because `getHostTenant()` cannot resolve the `rede-demo.localhost` host while the seed registered `<old-brand>-demo.localhost`. 07-05 does not touch that page. The desktop events cases skipped behind it were re-run on their own: 11 passed. Recorded in `deferred-items.md` and the WINDOWS ledger (unrun-verify, events.spec.ts:422).
- **Full API integration suite:** 669 of 670 pass. The one failure is the known `signup.test.ts` case 2 (env hosts).
- A first integration run failed three reminder cases because the test's own `closeWaiting()` also closed the reminder jobs. It now closes only fan-out jobs mid-test and both kinds in the sweep.

## Verification (final runs)

- `pnpm --filter @rede-social/module-events typecheck`, `lint` and `test` (121 passed), `pnpm --filter @rede-social/api typecheck` and `pnpm boundaries` (776 files, no issues): all pass.
- `pnpm db:reset && pnpm db:seed`, then `vitest run` on `events-reminders`, `notifications`, `events-admin` and `events`: 59 of 59 pass. After the preview change, `events-reminders` and `notifications` were re-run: 31 of 31 pass.
- `pnpm --filter @rede-social/web typecheck`, `lint`, `vitest run lib/notifications-view i18n` (496) and `bash scripts/check-ui-literals.sh`: all pass.
- Backfill: `db:reset` + `db:seed`, then `tsx scripts/arm-event-reminders.ts --dry-run` prints `{"events":6,"armed":12,"skipped":0}`. A real run arms 12, and a second run arms 0 and skips 12.
- `VIDEO_PROVIDER=fake playwright test notifications.spec.ts -g "notifications eventos"`: 8 of 8 pass (mobile-chromium and desktop-chromium).

## Notes for 07-11 (DEPLOY.md)

After the API and worker revision carrying 07-05 is live, run the optional one-shot backfill once, from a machine whose environment holds the production `DATABASE_URL` (the `api_user` connection the API uses; it is never printed):

```bash
pnpm exec tsx scripts/arm-event-reminders.ts --dry-run   # plan only: { events, armed, skipped }
pnpm exec tsx scripts/arm-event-reminders.ts             # arm; re-running arms nothing new
```

It arms the 24 h and 1 h `events.reminder` jobs of every active, upcoming, not-removed event created before the deploy, and skips any window already past. The worker must have created the `events.reminder` queue, or the script creates it itself with the `short` policy.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. T-07-27 to T-07-31 are mitigated and tested: the audience pin, the fire-time checks, re-entering the payload tenant's lane, the per-window dedupe with the `short` policy, and ids-only payloads. T-07-32 (the backfill's admin lane) is accepted as planned.

## User Setup Required

None. No new environment variable was added.

## Next Phase Readiness

- 07-06 can push the event kinds. Every intent carries its hint. The reminder `topic` is 32 hex characters and the broadcast topics are `events-event` / `events-reactivated`.
- 07-11 has the backfill command above for DEPLOY.md.
- Open for the phase UAT: how the actor-less reminder row and the event rows look on a real phone (sketch 007 surface 7). Real-device UAT is blocked locally.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All eight created key files exist on disk, and both task commits (`3e994ac`, `2d9320b`) are in history.
