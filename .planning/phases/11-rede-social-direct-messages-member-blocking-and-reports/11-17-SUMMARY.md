---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 17
subsystem: notifications
tags: [notifications, report-notice, moderation-manage, push, bell-row, audience-drift, D-229, D-235, D-616, D-729]

requires:
  - phase: 11-04
    provides: the literal push title (`titleText`, max 60 code points) on the push hint
  - phase: 11-14
    provides: the ids-only kernel event `report.created`, `REPORT_NOTIFICATION_KIND` and `KERNEL_PERMISSIONS`
provides:
  - the `report.created` notification source in the notifications manifest (one bell row and one push per report for the live holders of `moderation.manage`)
  - the one-role-list drift test that pins the SQL `admin_tenant` literal to the TypeScript permission map
affects: [11-21 bell row renderer for moderation.report_created, phase 11 verification]

plan_head_before: de39b35981f93b09e5f8d85e9656133f7c15a284
actuals:
  tokens: 14000
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "a kernel-event notice declared in the notifications manifest (recorded exception to MOD-02's producer-declares rule) with the audience derived from KERNEL_ROLE_PERMISSIONS"
    - "a drift unit test that reads the migration files and proves its detector on a copy of the map"

key-files:
  created:
    - packages/modules/notifications/server/report-notice.ts
    - packages/modules/notifications/tests/report-notice.test.ts
    - apps/api/tests/unit/report-audience-drift.test.ts
    - apps/api/tests/integration/reports-notice.test.ts
  modified:
    - packages/modules/notifications/module.ts
    - packages/modules/notifications/server/index.ts
    - packages/modules/notifications/README.md

key-decisions:
  - "The audience is derived from KERNEL_ROLE_PERMISSIONS (roles holding moderation.manage); the SQL definers keep the literal admin_tenant and a drift test forces both to change together"
  - "renotify is false: a tag per report already makes two reports two banners, so there is nothing to re-alert on"
  - "The source is declared in the notifications manifest, not a producer's, because the event is the kernel's and the audience is the moderators; recorded in the manifest doc and the README"

patterns-established:
  - "Report notice: empty facts, subject {report, id}, no actor, fixed title/body/url, 32-hex tag per report, 72 h TTL, urgency normal"

requirements-completed: [MODER-05]

coverage:
  - id: D1
    description: "A filed report gives every live holder of moderation.manage one bell row (kind moderation.report_created, empty facts, subject report, no actor) and one push titled Nova denúncia with the fixed body, the queue path and a tag per report"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/report-notice.test.ts#builds exactly the intent of D-729"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/reports-notice.test.ts#report notice tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "The notice names nothing and is byte-identical for the six subject types; the reporter, the reported author, a support member, a blocked or removed administrator and another tenant are never told"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-notice.test.ts#every subject, #exclusions, #tenant isolation"
        status: pass
    human_judgment: false
  - id: D3
    description: "Edge cases: nobody left returns no intent; a redelivered event is the same key and adds nothing; notifications off sends nothing while the report still files and lists"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/report-notice.test.ts#returns no intent when the only holders are the reporter or the author"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/reports-notice.test.ts#two reports are two rows..., #notifications off"
        status: pass
    human_judgment: false
  - id: D4
    description: "The audience and the SQL role check cannot silently disagree"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/report-audience-drift.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The new kind sits in the bell list, counters, seen/read marks and the 90-day prune like any row; every shipped source stays registered"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-notice.test.ts#bell counters and list, #unchanged"
        status: pass
    human_judgment: false
  - id: D6
    description: "The banner as it looks and reads on a real phone lock screen"
    verification: []
    human_judgment: true
    rationale: "Real-device push rendering cannot be proven locally (the fake transport records the payload); the bell row renderer is plan 21"

duration: 40min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 17: The report notice for moderators Summary

**A filed report now rings the bell and the phone of every live `moderation.manage` holder once, titled "Nova denúncia", with empty facts and a fixed body, never naming the subject, the reporter or the reported member; the audience comes from the kernel permission map and a drift test pins it to the SQL role check.**

## Performance

- **Duration:** about 40 min
- **Started:** 2026-11-19T21:58Z
- **Completed:** 2026-11-19T22:10Z
- **Tasks:** 3 (task 1 was a tracer, re-verified end to end before expansion)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `reportCreatedNotificationSource` (`packages/modules/notifications/server/report-notice.ts`), registered through `notificationsModule.notificationSources`: reads the tenant's live memberships (active, not blocked, not removed) whose role holds `moderation.manage`, excludes the reporter and the reported author, returns `[]` when nobody is left, otherwise one intent: kind `moderation.report_created`, `users` audience, dedupe key `moderation.report_created:{reportId}`, subject `{report, id}`, no actor, empty facts, channels `in_app` + `push`, push `titleText` "Nova denúncia", body "Toque para ver a fila de denúncias.", url `/configuracoes/denuncias`, 32-hex tag and topic of the report id, 72 h TTL, urgency normal.
- `moderatorRoles()` derives the role list from `KERNEL_ROLE_PERMISSIONS`; nothing types `admin_tenant` in the source.
- Drift test `report-audience-drift.test.ts`: the holders of `moderation.manage` are exactly `['admin_tenant']`, the notice follows the map, the resolve definer and the `content_reports_select` policy still spell `admin_tenant`, and the detector is proved on a copy of the map (never the real one).
- Integration suite `reports-notice.test.ts` (10 cases): the tracer, per-report rows and tags, redelivery adds nothing, the six subjects compared byte for byte (post, post comment, story, story comment, community, direct message), exclusions (only administrator is the reported author, reported administrator with a second administrator as control, support, blocked and removed administrators, a staff reporter), notifications off, tenant isolation with tenant B's administrator as the positive control, bell counter/list/seen/read/prune, and the registry check.
- README of the notifications module names the consumed `report.created` event and the new kernel import (`rbac/require-role`).

## Task Commits

1. **Task 1: tracer, the source and its registration** - `f4aa4c78` (feat)
2. **Task 2: the six subjects, the exclusion matrix and the drift test** - `0acee48d` (test)
3. **Task 3: bell counters, list, prune and the shipped sources unchanged** - `bfef4858` (test)
4. **Test typing fix (seeded support id, lab author id)** - `82864847` (fix)

**Plan metadata:** the docs commit of this SUMMARY.

## Files Created/Modified

- `packages/modules/notifications/server/report-notice.ts` - the source, the role derivation and the fixed copy constants
- `packages/modules/notifications/module.ts` - `notificationSources`, manifest doc updated (recorded exception)
- `packages/modules/notifications/server/index.ts` - exports the source and helpers
- `packages/modules/notifications/README.md` - consumed event and kernel dependency documented
- `packages/modules/notifications/tests/report-notice.test.ts` - unit tests with a stubbed `tx` (8)
- `apps/api/tests/unit/report-audience-drift.test.ts` - the one-role-list drift test (4)
- `apps/api/tests/integration/reports-notice.test.ts` - the live-stack suite (10)

## Decisions Made

- The audience derives from the TypeScript permission map; the SQL keeps its literal and the drift test is the contract between them (Open Question 1).
- `renotify: false` (the plan did not state it): a tag per report means two reports never replace each other, so re-alerting has no job here.
- Recipients are filtered in TypeScript after the select (the reporter and author are still passed as `excludeUserIds`, so the database predicate applies the same exclusion again).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] README updated in the Task 1 commit instead of Task 2**
- **Found during:** Task 1
- **Issue:** the plan lists the README under Task 2, but registering the source turns `module-readmes.test.ts` red the moment the manifest changes, which would leave a red commit.
- **Fix:** documented the consumed event and the `rbac/require-role` kernel import in the Task 1 commit. Task 2 then only ran the README, registry and mount tests.
- **Files modified:** `packages/modules/notifications/README.md`
- **Committed in:** `f4aa4c78`

**2. [Rule 1 - Bug] Test typing and an `undefined` id in the exclusion loop**
- **Found during:** final typecheck (`@rede-social/api`)
- **Issue:** `ids.demoSupport` was never declared on the test's `ids` object, so the seeded support member was compared as `undefined` (a vacuous `not.toContain`), and a lab author id was `string | undefined` in a SQL parameter.
- **Fix:** declared and filled `ids.demoSupport` from `caseKit`, defaulted the lab author id.
- **Files modified:** `apps/api/tests/integration/reports-notice.test.ts`
- **Verification:** typecheck clean, the suite still 10/10.
- **Committed in:** `82864847`

---

**Total deviations:** 2 auto-fixed (1 blocking order, 1 bug in the test)
**Impact on plan:** none on behavior; no scope creep.

## Issues Encountered

- `report-notice.test.ts` first failed typecheck because `satisfies NotificationSource` narrowed `resolve` to two arguments; the source is now annotated as `NotificationSource<'report.created'>`.
- The README check reads any backticked `noun.verb` as an event name, so the permission is spelled without backticks in the README.

## Gates run

- Unit: `report-notice` (module, 8), `report-audience-drift`, `module-readmes`, `registry`, `mounts` pass; whole `apps/api` unit suite 146/146 (includes the admin-lane inventory and the README test); whole `@rede-social/module-notifications` suite 212/212; whole `@rede-social/core` suite 1858/1858; whole `@rede-social/contracts` suite 626/626.
- Integration, one by one: `reports-notice` 10/10 (run several times, stable), `reports-blocks` 22/22, `notifications` 28/28, `notifications-prune` 5/5, `reports-new-subjects` 28/28, `direct-notifications` 23/23. No integration file was a stale-seed red this time; none of the known pre-existing reds (stories, feed-query-budget, isolation) were run.
- `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm guard:lanes` clean. Biome clean on every touched file.
- Typecheck: `@rede-social/module-notifications`, `@rede-social/api`, `@rede-social/web` clean.
- Web suite via `TURBO_CACHE=local:r pnpm turbo test --filter=@rede-social/web --concurrency=4`: 416 files, 10068 tests passed (the Phase 10.2 `EventsSections` flake did not trip).
- Not run: pgTAP (`supabase test db`): this plan has no migration and changed no SQL, so no policy or definer moved. The full API integration suite was not run (it resets the shared database).

## Worker and push contract

The push contract (`.strict()`) is unchanged: the hint only uses `titleText` ("Nova denúncia", 13 characters, under the 60 limit) that plan 04 added, so no new field exists. The worker does read the new code, though: the `report.created` source's `resolve` runs inside the worker's `notifications.fanout` job, so the API and the worker must ship together (the registry that wires the source is imported by both). A worker without this release would drop the event as having no source.

## Known Stubs

None. The web renders the generic bell row for the new kind until plan 21 ships its renderer (stated in the plan, not a stub of this plan).

## Threat Flags

None. No new endpoint, auth path or schema; the notice reuses the existing fan-out, definers and push adapter.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 21 can render the `moderation.report_created` bell row from `kind` alone (facts are empty, the subject is `{report, id}`, the tap target is `/configuracoes/denuncias`).
- Open for a human: how the "Nova denúncia" banner reads on a real phone (the fake transport only proves the payload).

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*

## Self-Check: PASSED

- Created files exist: `report-notice.ts`, `report-notice.test.ts` (module), `report-audience-drift.test.ts`, `reports-notice.test.ts`.
- Commits found: `f4aa4c78`, `0acee48d`, `bfef4858`, `82864847`.
- Acceptance criteria re-run: `grep report.created` in `module.ts` and `report-notice.ts` matches (module.ts via the manifest doc and `notificationSources`); the integration test asserts the empty facts and no row for the reporter or the author; the six subjects' rows are compared in one test; the drift detector is proved on a copy; `reports-blocks` and `notifications` pass unchanged; module and API typecheck clean.
