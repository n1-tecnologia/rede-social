---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 04
subsystem: notifications
tags: [push, notification-seam, title-literal, additive-widening, D-728, D-729, D-860]

requires:
  - phase: 07-notifications
    provides: the notification seam, the push channel, the push-send job and buildPushPayload
provides:
  - "Optional `titleText` on NotificationPushHint, notificationPushHintSchema and buildPushPayload"
  - "PUSH_TITLE_TEXT_MAX = 60 and the grapheme-safe literal title with a blank fallback"
affects: [11-13 message push, 11-17 report push]

actuals:
  tokens: 4250
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Additive optional key widened in the three places that must move together (kernel type, strict zod schema, builder), ahead of any enqueuer"

key-files:
  created: []
  modified:
    - packages/core/server/notifications/source.ts
    - packages/modules/notifications/contracts/index.ts
    - packages/modules/notifications/server/push/payload.ts
    - packages/modules/notifications/tests/push-payload.test.ts
    - packages/modules/notifications/tests/contracts.test.ts
    - packages/modules/notifications/tests/push-channel.test.ts
    - packages/modules/notifications/tests/push-send-job.test.ts
    - packages/modules/notifications/README.md

key-decisions:
  - "titleText is cut with Intl.Segmenter at 60 graphemes plus an ellipsis, trimmed first; a blank value falls back to the closed title (tenant name or Equipe {tenant}), so the service worker's non-empty title check always holds"
  - "The channel and the send job needed no code change: both already pass the validated hint whole (`push: hint.data`, `hint: push`), so Task 2 is tests plus the README line"

requirements-completed: [CHAT-06, MODER-05]

coverage:
  - id: D1
    description: "A hint with a literal titleText parses and buildPushPayload titles the payload with it inside the 3072-byte bound"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/push-payload.test.ts#a literal title (D-728, D-729)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A blank literal falls back to the tenant name and a hint without titleText renders as before for tenant and team"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/push-payload.test.ts#a blank literal falls back to the tenant name, never an empty title"
        status: pass
    human_judgment: false
  - id: D3
    description: "The literal is cut by graphemes (90-grapheme name, ZWJ emoji, combining marks, right-to-left name), never by UTF-16 units"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/push-payload.test.ts#ZWJ emoji sequences, combining marks and a right-to-left name are cut by graphemes"
        status: pass
    human_judgment: false
  - id: D4
    description: "The schema bounds the literal at 1 to 200 characters, keeps title a closed union and stays strict"
    requirement: MODER-05
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/contracts.test.ts#notificationPushHintSchema literal title (D-728, D-729)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The push channel enqueues the literal whole and the send job delivers it with the badge sum"
    requirement: CHAT-06
    verification:
      - kind: unit
        ref: "packages/modules/notifications/tests/push-channel.test.ts#D-728: a hint with a literal titleText reaches the job whole"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/push-send-job.test.ts#D-728: a hint with a literal titleText is delivered with that title"
        status: pass
    human_judgment: false
  - id: D6
    description: "A real lock-screen render of a writer name as push title on a device"
    verification: []
    human_judgment: true
    rationale: "Plans 13 and 17 set the literal and own the device proof; this plan only widens the seam"

duration: 4min
completed: 2026-11-19
status: complete
commits: 2
plan_head_before: 66741868a1ae495e30f512f8bbe0053ff82a5131
---

# Phase 11 Plan 04: Literal push title Summary

**An optional, grapheme-cut `titleText` on the push hint (kernel type, strict zod schema and payload builder widened together) so a push can be titled with the writer's name or `Nova denúncia`, with every shipped producer unchanged.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-11-19T16:04:00Z
- **Completed:** 2026-11-19T16:07:05Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- `NotificationPushHint.titleText?` in the kernel seam and `titleText: z.string().min(1).max(200).optional()` on the still-strict `notificationPushHintSchema`; `title` stays the required closed union `tenant | team`.
- `buildPushPayload` uses the trimmed literal cut at `PUSH_TITLE_TEXT_MAX` (60) graphemes with `…`, and falls back to the tenant name (or `Equipe {tenant}`) when it is blank; the byte bound and the body loop are untouched.
- The push channel and the send job were already passing the validated hint whole; two tests per file now prove the literal survives enqueue and delivery and that the badge sum is still sent.

## Task Commits

1. **Task 1: seam type, schema and `buildPushPayload` (tracer)** - `9d265fab` (feat)
2. **Task 2: channel and send job forward the literal; README** - `1f30e4f7` (test)

**Plan metadata:** the commit carrying this SUMMARY (docs).

## Files Created/Modified

- `packages/core/server/notifications/source.ts` - the optional `titleText` with the D-728/D-729 comment
- `packages/modules/notifications/contracts/index.ts` - `PUSH_TITLE_TEXT_MAX` and the schema key
- `packages/modules/notifications/server/push/payload.ts` - `literalTitle` (trim, grapheme cut, blank to null) and the title fallback chain
- `packages/modules/notifications/tests/push-payload.test.ts`, `contracts.test.ts`, `push-channel.test.ts`, `push-send-job.test.ts` - new cases appended, no shipped case edited
- `packages/modules/notifications/README.md` - one paragraph naming the optional key in the Contracts section

## Decisions Made

- The ellipsis is appended after the 60th grapheme, so a cut title is 61 graphemes long with the `…`; the plan says "cut to 60 graphemes with an ellipsis" and the existing body cut also ends in `…`.
- A hint rejected by the schema (a 201-character literal) is handled by the existing bad-hint path of the channel (warn log, nothing enqueued, `skipped: 0`), not a new branch.

## Deviations from Plan

None - plan executed exactly as written. The channel and the send job needed no source change because they already forwarded the hint whole; Task 2 therefore contains tests and the README line only.

## Issues Encountered

None. One test expectation (`skipped: 1` for a rejected hint) was a wrong guess about the shipped behavior (`skipped: 0`); fixed in the test before the commit.

## Gates Run

- `pnpm --filter @rede-social/module-notifications test`: 15 files, 204 tests passed
- `pnpm --filter @rede-social/core test`: 116 files, 1858 tests passed
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core --filter=@rede-social/module-notifications --concurrency=4`: 2 of 2 successful
- `apps/api/tests/unit/module-readmes.test.ts` (19 passed); `apps/api/tests/admin-lane-inventory` has no test files, nothing to run
- `pnpm boundaries`: no issues in 2626 files; `bash scripts/check-ui-literals.sh`: OK; `pnpm guard:lanes`: OK; `biome check` on the touched packages: clean
- No integration suite was run (no database, no migration in this plan)

## Deploy order (T-11-14)

The schema is `.strict()`: a worker without commit `9d265fab` rejects a push-send job that carries `titleText`. Plans 13 and 17, which enqueue the new shape, must land after it and the release must ship the API and the worker together.

## Threat Flags

None. No new endpoint, auth path or trust boundary; T-11-08 stays mitigated by the 200-character schema bound and the grapheme cut, and plans 13 and 17 own what string is set.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 13 (message push) and 17 (report push) can set `titleText` on a hint; nothing else in this plan blocks them.

## Self-Check: PASSED

- All eight modified files exist and are in the two task commits (`git show --stat` confirmed only plan paths).
- Commits `9d265fab` and `1f30e4f7` found in `git log`; `git rev-list --count 66741868..HEAD` = 2 before this commit.
- Acceptance criteria re-run: the `titleText` grep finds all three files; the shipped payload and contract tests pass unchanged beside the new ones; the full notifications suite and the module README test pass.

---
*Phase: 11-rede-social-direct-messages-member-blocking-and-reports*
*Completed: 2026-11-19*
