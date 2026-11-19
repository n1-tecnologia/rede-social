---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 14
subsystem: api
tags: [reports, api, create-report, list-reports, projection, report-created-event, copy-only, D-616, D-729, D-730, D-731, D-733]

requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plan 09 widened REPORT_SUBJECT_TYPES, the voice columns and the app.content_report_create definer; plan 03 chat policies; plan 08 direct fixtures"
provides:
  - "createReport files six subjects readable-first through the reporter's own lane (exhaustive switch, never-guarded)"
  - "report.created event (ids only) declared in @rede-social/contracts and queued after the filing commits"
  - "listReports projects each subject exhaustively: live predicate per subject, community snapshot split, voice object, post/story ref"
  - "reportItemSchema optional community, voice and ref keys; REPORT_NOTIFICATION_KIND constant"
  - "reports-new-subjects.test.ts (filing, projection, social off, concurrency, tenant isolation)"
affects: [11-16 resolve dispatcher, 11-17 moderators' notice, 11-18 web view functions, 11-25 queue screens]

plan_head_before: cd49e9525606fdc5fb2e8383d1129dcb28869477
actuals:
  tokens: 70000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "exhaustive switch over a closed subject vocabulary with a `never` assignment guard (a seventh subject is a compile error)"
    - "readable-first through the reporter's own lane, one bare 404 for every miss"
    - "event queued with emit() after withTenantTx returns, so the request flush delivers it only after the commit"

key-files:
  created:
    - apps/api/tests/integration/reports-new-subjects.test.ts
  modified:
    - packages/core/server/safety/reports.ts
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/server/moderation/README.md
    - apps/api/src/routes/safety.ts

key-decisions:
  - "A community is readable only when it is not in app.community_locked_ids() for the reporter (the store lock), beside the member-hidden gate the lane already applies"
  - "A direct message is readable only through the reporter's OWN chat_participants row joined to the message (never a staff read); the definer still refuses a support message with RP002, so both answer the same 404"
  - "The ref and voice keys are built only when the underlying ids exist, so an old row without them lists exactly as before"

patterns-established:
  - "Queue projection keys are all .optional() on a strict schema so a new web tolerates an old API"
  - "Cross-tenant and unreadable misses compare byte for byte (requestId stripped) in one Set"

requirements-completed: [MODER-05]

coverage:
  - id: D1
    description: "A member files a story, story comment, community or message report only when they can read it; every miss is one bare 404, stores nothing and emits nothing"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#report filing tracer"
        status: pass
    human_judgment: false
  - id: D2
    description: "report.created carries ids only, once per stored row, after the commit; the Phase 13 filing and error map are unchanged"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#report filing tracer, report concurrency"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/reports-blocks.test.ts"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/moderation.test.ts#report.created"
        status: pass
    human_judgment: false
  - id: D3
    description: "The queue reads each subject's own copy, the community snapshot, the recording through its report only and the item reference, and nothing of the conversation"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#report queue projection"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/chat-voice-gate.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Reporting works with social off for whatever the reporter can still read, one report per reporter and item holds under a race, and tenants never see each other's reports"
    requirement: MODER-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/reports-new-subjects.test.ts#report social off, report concurrency, report tenant isolation"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-11-19
status: complete
---

# Phase 11 Plan 14: The API half of reporting four more subjects Summary

**Readable-first filing of stories, story comments, communities and direct messages through the reporter's own lane, the ids-only `report.created` event, and an exhaustive queue projection that reads a message's copy and a community's snapshot but never a conversation.**

## Performance

- **Duration:** about 70 min
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 6 (1 created)
- **Commits:** 3 task commits

## Accomplishments

- `createReport` replaced its post-or-comment ternary with an exhaustive switch over the six subjects; each is one row read in the reporter's lane (story audience gate, community member-hidden gate and store lock, participant-only chat policies), a miss throws the same bare 404 the definer's `RP002` gives, and a `never` guard makes a seventh subject a compile error. `mapReportError` and the rest of the error map are untouched.
- `report.created` (`tenantId`, `reportId`, `reporterUserId`, `authorUserId`) is declared against the contracts `EventMap` beside `membership.blocked` and queued after the transaction returns; the author is read back through the reporter's own new row. `REPORT_NOTIFICATION_KIND = 'moderation.report_created'` is the constant plan 17 consumes. The file header that said no event names a report is rewritten.
- `listReports` has one live predicate per subject (a message is always available because its copy is what is judged) and projects `community {name, description}` (split at the first line break), `voice {mediaId, durationSeconds, gone}` (from `app.voice_asset_retired`) and `ref {postId, storyId}`; all three are `.optional()` on the strict `reportItemSchema`.
- The administrator hears a reported recording only after its report exists (302 after, bare 404 before, for a third member and the other tenant, and for everyone once the asset is retired), reads no chat row of the conversation, and the answer contains no conversation, counterpart or participant key (recursive scan).
- The kernel moderation README now lists `report.created` and the report functions; `module-readmes` test passes.

## Task Commits

1. **Task 1 (tracer): exhaustive precheck, event, contract keys** - `616deea6` (feat)
2. **Task 2: the queue's exhaustive projection** - `28ca95ab` (feat)
3. **Task 3: social off, concurrency, tenant isolation, README** - `18c9c139` (test)

## Files Created/Modified

- `packages/core/server/safety/reports.ts` - exhaustive `subjectIsReadable`, `report.created` emit, exhaustive `content_available`, `toItem` projections
- `packages/contracts/src/moderation.ts` - `community`, `voice`, `ref` optional keys, `ReportCreated`, EventMap entry, `REPORT_NOTIFICATION_KIND`
- `packages/contracts/tests/moderation.test.ts` - event and optional-key cases
- `packages/core/server/moderation/README.md` - `report.created`, report functions, contract names
- `apps/api/src/routes/safety.ts` - the documented 400/404 lists name the six subjects (stale "not reportable yet" text)
- `apps/api/tests/integration/reports-new-subjects.test.ts` - 12 cases in five describes

## Decisions Made

- A locked community is unreadable to the reporter: the community precheck adds `c.id <> all (coalesce((select app.community_locked_ids()), '{}'))` to the lane read (the plan's test 3 asks for a bare 404 for "a community locked for the reporter", and the lane's own communities policies do not hide it).
- The message precheck joins the reporter's own `chat_participants` row, so a staff user is never admitted through the support-staff read; a support message reads in the lane for a member but the definer refuses it with `RP002`, giving the same 404.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The exhaustive `content_available` case landed in Task 1, not Task 2**
- **Found during:** Task 1 (tracer test 1 expects `contentAvailable: true` for a story)
- **Issue:** the shipped ternary treats every non-post subject as a comment, so a story read as unavailable and the tracer could not pass.
- **Fix:** moved the exhaustive `case` into the Task 1 commit; Task 2 added the community/voice/ref projections on top.
- **Files modified:** packages/core/server/safety/reports.ts
- **Committed in:** 616deea6

**2. [Rule 1 - Bug] Stale route documentation**
- **Found during:** Task 3
- **Issue:** `apps/api/src/routes/safety.ts` still said a story comment, a community or a message "is not reportable yet" and that the 404 covers only posts and comments.
- **Fix:** updated the two documented response descriptions (no behavior change); this file is outside the plan's `files_modified`.
- **Committed in:** 18c9c139

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 documentation bug). **Impact on plan:** none on scope; the first only re-ordered work between two commits of the same plan.

## Issues Encountered

None that blocked. The social-off, concurrency and tenant-isolation cases passed on their first run, so no code change was needed for Task 3 beyond the README.

## Gates run

- `pnpm --filter @rede-social/contracts exec vitest run` 626 passed; `@rede-social/core` suite 1858 passed; web suite 10068 passed (turbo, `--concurrency=4`, `TURBO_CACHE=local:r`).
- `typecheck` for core, contracts, api and web: clean. `pnpm boundaries`, `bash scripts/check-ui-literals.sh`, `pnpm guard:lanes`: OK.
- API unit directory (138, includes `module-readmes` test 3 and `admin-lane-inventory`): passed.
- Integration, one file at a time: `reports-new-subjects` 12/12, `reports-blocks` 22/22, `moderation-posts` 22/22, `moderation-comments` 20/20, `moderation-log` 13/13, `moderation-member-content` 22/22, `chat-voice-gate` 9/9, `app-release` 19/19, `move-copy` 22/22, `notifications-prune` 5/5.
- `isolation.test.ts`: 92 passed, 4 failed, all in the pre-existing red list named by the project rule (stories b3, b8 and the two events tests); not caused by this plan.
- No pgTAP run: this plan adds no SQL and no migration. No hosted project touched; no `--local` migration command was needed.

## Known Stubs

None.

## Threat Flags

None. The one new emitted event (`report.created`) is the plan's own D-729 surface and carries ids only.

## Next Phase Readiness

Plan 16 (the resolve dispatcher) can append its describe to `reports-new-subjects.test.ts`; plan 17 subscribes to `report.created` and uses `REPORT_NOTIFICATION_KIND`; plans 18 and 25 read the optional `community`, `voice` and `ref` keys.

## Self-Check: PASSED

- Created file present: `apps/api/tests/integration/reports-new-subjects.test.ts`.
- Commits `616deea6`, `28ca95ab`, `18c9c139` exist on master; `git rev-list --count` from the recorded base is 3, matching `actuals.commits`.
- Acceptance criteria re-run: `grep report.created` in `reports.ts` and `moderation.ts` matches; `reports-blocks` and `chat-voice-gate` pass unchanged; README test passes.
