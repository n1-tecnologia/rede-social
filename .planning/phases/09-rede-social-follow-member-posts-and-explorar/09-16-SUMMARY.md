---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 16
subsystem: api
tags: [social, gap-closure, tracer, media, member-share, WR-03, WR-06, WR-08, IN-02, D-474, vitest]

requires:
  - phase: 09-rede-social-follow-member-posts-and-explorar
    provides: "the member media sub-budget, the duration_cap_seconds snapshot and the member policy seam (plan 09-06); the gap round baseline (plans 09-14, 09-15)"
provides:
  - "memberBytesUsed: the member byte share now counts every non-video upload a member made, whatever its purpose"
  - "memberPostSecondsUsed charges a pending member video at its snapshotted cap and replaces the charge with the measured seconds on ready"
  - "judgeDuration: the pure verdict (ok, too_long, unmeasurable) of a ready event; a member video with no measured duration fails closed as failed / transcode_failed"
  - "completeUpload judges a member post photo by the size declared at start, not by the tenant policy re-read"
  - "a true 403 description on POST /v1/media/uploads"
affects: [09-17, media, phase-10-member-authoring, docs-deploy]

actuals:
  tokens: 9300
  tasks: 3
  commits: 6
plan_head_before: 0c8ad90159e87bd822b5a14f97c56fb81db06292
commits: 6

tech-stack:
  added: []
  patterns:
    - "a declared value snapshotted at start is the ceiling at complete (media_assets.bytes plays for photos the role duration_cap_seconds plays for video), so the tenant policy is read once"
    - "a pure verdict function in front of the one writer (judgeDuration), so the fail-closed rule is unit-testable without a database"
    - "a soft quota that charges in-flight work at its cap and replaces the charge with the measured value on completion"

key-files:
  created:
    - packages/core/server/media/video/duration-verdict.ts
    - packages/core/tests/media-duration-verdict.test.ts
  modified:
    - packages/core/server/media/member-share.ts
    - packages/core/server/media/service.ts
    - packages/core/server/media/video/event-job.ts
    - apps/api/src/routes/media.ts
    - apps/api/tests/integration/social-media.test.ts

key-decisions:
  - "Planning decision 1: memberPostBytesUsed is renamed memberBytesUsed and loses the purpose filter; the role is still the uploader's CURRENT membership role, so an admin's uploads never count and a promoted member stops counting. It applies with social off too: the test is the role, not the module."
  - "Planning decision 2 (pending-charge choice): pending member videos are charged at their snapshotted duration_cap_seconds against the member minutes sub-budget. Chosen over 'one in flight per member' because D-474 forbids a per-member quota in this phase and because an abandoned pending upload lives 24 h (the pending sweeper), which would lock that member out of video for a day. Cost: soft like the rest of the quota (EP-77); released on ready (replaced by the measured duration), rejected, failed, retired or swept. To be recorded in the DEPLOY open decision by plan 09-17."
  - "Planning decision 3: judgeDuration is a pure function (member snapshot or null, static cap, reported duration) answering ok, too_long or unmeasurable; applyReady stays the only writer."
  - "Planning decision 4: an unmeasurable member video ends failed with transcode_failed, not rejected: rejected means a refusal the member can act on; transcode_failed is already in the closed MEDIA_ISSUES set with web copy, so no catalog string is added."
  - "Planning decision 5: the declared size is the snapshot at complete (info.size and the decoded length must be <= row.bytes for a member post photo); it also closes under-declaring as a route around the byte share. Admin and non-post member uploads keep the static limit."
  - "Planning decision 6: SOCIAL-05 in REQUIREMENTS.md says the share covers member-owned post uploads; this plan widens it to every member purpose by the user's recorded choice. REQUIREMENTS.md is not edited here (the orchestrator owns it)."
  - "Planning decision 7: all three tasks are reversible: service-local behavior behind unchanged signatures, no schema, no contract."

patterns-established:
  - "Charge in-flight uploads at the cap snapshotted at start; replace, never add, when the measured value arrives"

requirements-completed: [SOCIAL-03, SOCIAL-05]

coverage:
  - id: D1
    description: "A member's upload of ANY purpose (post, avatar, cover) draws from the member byte share: exactly on half (419430400 bytes) is accepted, one byte more of any purpose is refused 413 quota_exceeded with no row created, an avatar already uploaded counts, and an admin_tenant is unaffected (WR-03 part 1, tracer)"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#11. EP-17 sub-budget (WR-03): member uploads of ANY purpose draw from half the byte ceiling, the admin is unaffected"
        status: pass
    human_judgment: false
  - id: D2
    description: "A pending member video holds its snapshotted cap in the minutes share (5400 s is the half), refuses the next member start at the half, and releases or is replaced on failed, ready (measured, at or below the cap) and retired; an admin pending video charges nothing (WR-03 part 2)"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#14. WR-03: a pending member video holds its snapshotted cap in the minutes share"
        status: pass
    human_judgment: false
  - id: D3
    description: "A member video the provider reports ready with no duration fails closed (failed / transcode_failed, provider asset deleted, duration null), while an admin video with no duration still goes ready (WR-06)"
    requirement: SOCIAL-05
    verification:
      - kind: unit
        ref: "packages/core/tests/media-duration-verdict.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#15. WR-06 and #16. an admin video with no measured duration still goes ready"
        status: pass
    human_judgment: false
  - id: D4
    description: "An accepted member photo is judged at complete by the size declared at start: lowering the cap or turning social off in the window neither rejects it nor widens the ceiling, an object larger than declared is rejected too_large and removed, complete is idempotent and concurrency-safe (WR-08)"
    requirement: SOCIAL-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#10, #17, #18, #19, #20, #21"
        status: pass
    human_judgment: false
  - id: D5
    description: "The 403 description of POST /v1/media/uploads names the three conditions under which a member may start a video (IN-02)"
    requirement: SOCIAL-05
    verification:
      - kind: other
        ref: "grep social.video.enabled apps/api/src/routes/media.ts; no 'members publish nothing yet'"
        status: pass
    human_judgment: false
  - id: D6
    description: "A real Mux asset that reports no duration is failed with its provider asset deleted (the fake provider runs the same applyReady path; Mux always reports a duration, so this edge cannot be reproduced against a real account)"
    requirement: SOCIAL-05
    verification: []
    human_judgment: true
    rationale: "Backstop truth from the plan: only the fake provider can produce the edge locally; no real-account run exists."

duration: 6min
completed: 2026-10-20
status: complete
---

# Phase 9 Plan 16: Member upload hardening Summary

**A member's upload of any purpose now draws from half of the byte ceiling, pending member videos are charged at their snapshotted cap against half of the minutes ceiling, a member video the provider cannot measure fails closed as transcode_failed, an accepted photo is judged at complete by the size declared at start, and the start-route 403 text is true.**

## Performance

- **Duration:** 6 min (12:51 to 12:58 UTC)
- **Started:** 2026-10-20T12:51:57Z
- **Completed:** 2026-10-20T12:58:00Z
- **Tasks:** 3
- **Files modified:** 7 (two new, five edited)

## Accomplishments

- **WR-03 part 1, closed (Task 1, tracer).** `memberPostBytesUsed` became `memberBytesUsed` (no `purpose = 'post'` filter) and the `startUpload` sub-budget condition lost its purpose test, so a flood of avatars, covers, stories or attachments cannot walk around the share. A real 413 `quota_exceeded` at the exact boundary: 419430400 bytes is accepted, one byte more is refused for post, avatar and cover, no row is created, and the admin's start is accepted.
- **WR-03 part 2, closed (Task 2).** `memberPostSecondsUsed` charges a pending member video at `duration_cap_seconds`, a ready one at its measured `duration_seconds`, rejected, failed and retired rows nothing. The check in `startVideoUpload` is untouched (`>=` half of 10800 s = 5400 s).
- **WR-06, closed (Task 2).** New pure `judgeDuration` returns `ok`, `too_long` or `unmeasurable`; `applyReady` fails a member upload (a row with a snapshot) that arrives with no duration as `failed` / `transcode_failed`, deletes the provider asset best effort, and leaves `duration_seconds` null. An admin video with no duration still goes `ready`; exactly the cap is still ready; one second over is still `rejected` / `duration_too_long`.
- **WR-08 and IN-02, closed (Task 3).** `completeUpload` takes `min(static limit, row.bytes)` as the ceiling of a member `post` photo in both the Storage-size check and the decoded-length check, with no policy re-read; `startUpload` still reads the policy. The 403 description of the start route names the three conditions.

## Task Commits

1. **Task 1 (tracer), RED:** `24ce404f` (test) - startImage purpose parameter, `memberBytes` mirror, case 11 rewritten
2. **Task 1, GREEN:** `ade3cbc3` (feat) - `memberBytesUsed` and the role-only start condition
3. **Task 2, RED:** `510332ec` (test) - `judgeDuration` unit cases against an always-`ok` stub, pending-aware mirror, cases 14 to 16
4. **Task 2, GREEN:** `db183e17` (feat) - `judgeDuration`, `applyReady` branch, pending charge
5. **Task 3, RED:** `7b2e5bfd` (test) - cases 17 to 21
6. **Task 3, GREEN:** `38968340` (feat) - declared-size ceiling at complete, route description

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## Files Created/Modified

- `packages/core/server/media/member-share.ts` - `memberBytesUsed` (every purpose), pending-aware `memberPostSecondsUsed`, docblock with the choice and its reason
- `packages/core/server/media/video/duration-verdict.ts` - the pure verdict (new)
- `packages/core/server/media/video/event-job.ts` - `applyReady` branches on the verdict; `Outcome` gains `'failed'`; `DURATION_UNMEASURABLE`
- `packages/core/server/media/service.ts` - role-only start condition; declared-size ceiling in `completeUpload`
- `apps/api/src/routes/media.ts` - the 403 description
- `packages/core/tests/media-duration-verdict.test.ts` - the verdict unit cases (new)
- `apps/api/tests/integration/social-media.test.ts` - case 11 rewritten, cases 14 to 21, helpers

## Decisions Made

Planning decisions 1 to 7 were followed as written; they are listed under `key-decisions`, including the pending-charge choice and its reason. **For the orchestrator:** SOCIAL-05 in REQUIREMENTS.md still says the share covers member-owned `post` uploads; this plan widens it to every member purpose (a wording update at close). The `MEDIA_MEMBER_SHARE_OF_CEILING` docblock in `limits.ts` also still says "A member's `post` uploads"; it is outside this plan's file list and was left as is.

## Verification results (real numbers)

| Check | Result |
|-------|--------|
| `@rede-social/core` unit suite | 45 files, 465 tests, PASS (459 before, plus the 6 verdict cases) |
| `@rede-social/api` unit suite | 8 files, 73 tests, PASS |
| `@rede-social/core` and `@rede-social/api` typecheck and lint | clean |
| `pnpm boundaries` | clean, no issues in 1719 files |
| `pnpm db:generate` | "No schema changes, nothing to migrate" |
| `git diff --stat -- packages/core/db/schema/media-assets.ts` | empty |
| Integration: social-media, media, media-playback, mux-webhook (after the last change) | 4 files, 145 tests, PASS |
| Integration: social-media alone | 41 tests, PASS (33 at the start of the plan, 8 new: 14 to 21) |
| Acceptance greps (old name gone, `memberBytesUsed`, `judgeDuration`, `transcode_failed`, `social.video.enabled`, old route text gone) | all PASS |

No pgTAP was run: no schema or policy changed. No `db:reset`, no `db:seed`, no push, no deploy. Local data after the runs: no `social-media-09-06*` asset rows, no `Teste 09-06 ` posts, `social` on for rede-lab with an empty settings blob (seed state).

## Deviations from Plan

None - plan executed exactly as written.

Authoring notes, not deviations: (1) the `judgeDuration` RED needed a module to import, so the RED commit carries a stub that always answers `ok` (so the unit cases fail on assertions rather than on a missing import); (2) `completePhoto` in the test file is declared `async` so it types as `Promise<Response>`.

## TDD Gate Compliance

Vitest does not emit the TAP that `gsd check tdd-red-evidence` parses, and `workflow.tdd_mode` is off, so the checker was not run; the RED evidence below is the real Vitest output of each run.

- **Task 1 (tracer): genuine RED** (`24ce404f`). Integration, `-t "11. EP-17"`: 1 failed, 32 skipped; failed at `expect(over.status, purpose).toBe(413)` for `post` (received 201) because the 100 MiB avatar the test seeded was not counted by the old sum. GREEN (`ade3cbc3`): 1 passed in isolation, then 33 passed for the whole file.
- **Task 2: genuine RED** (`510332ec`). Unit: 4 failed, 2 passed (`expected 'ok' to be 'too_long'` and `'unmeasurable'`; the two passing cases are the `ok` cases the stub also satisfies). Integration: 3 failed, 33 passed: case 14 failed at the first refused start (expected 201 to be 413), case 15 failed at `expected 'ready' to be 'failed'`, and case 12 failed with `expected 201 to be 413` because the pending-aware mirror now counted pending member videos left by cases 3, 4 and 8 that the old sum ignored (the pending charge is exactly this plan's behavior). Case 16, the admin control, passed. GREEN (`db183e17`): unit 6 passed, integration 36 passed.
- **Task 3: genuine RED** (`7b2e5bfd`). Integration: 3 failed, 38 passed: case 17 `expected 400 to be 200` (policy re-read rejected an accepted upload), cases 18 and 19 `expected 200 to be 400` (an object larger than declared got through). Cases 20 and 21 passed against the old code: they are regression pins for idempotency and concurrency, not RED cases (the early return on `processing` and the pg-boss singleton key already provide them). GREEN (`38968340`): 41 passed, then 145 passed across the four files.
- **Refactor:** none; no refactor commits.

## Issues Encountered

- Case 18 (turning `social` off) and the tracer cases mutate `tenant_modules` and `media_assets`; each restores in a `finally` or in `afterAll`, and the post-run query confirmed the seed state.
- Disk free dropped from 8.3 GiB to 7.2 GiB over the run; well above the 3 GiB stop line.

## Known Stubs

None.

## Threat Flags

None. The threat register T-09-59 to T-09-64 is addressed: T-09-59 (case 11), T-09-60 (case 14), T-09-61 (unit plus cases 15 and 16), T-09-62 (cases 10, 17, 18, 19), T-09-63 accepted as soft-quota behavior (case 8 stays green), T-09-64 (route text).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 09-17 is next. It should record the pending-charge choice (planning decision 2) in the DEPLOY open decision, and the SOCIAL-05 wording update (member `post` uploads to every member purpose) is flagged for the orchestrator.
- A real Mux upload with no duration cannot be reproduced locally (backstop truth D6).

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*

## Self-Check: PASSED

- Created files exist: `packages/core/server/media/video/duration-verdict.ts`, `packages/core/tests/media-duration-verdict.test.ts` (FOUND).
- Commits exist: `24ce404f`, `ade3cbc3`, `510332ec`, `db183e17`, `7b2e5bfd`, `38968340` (FOUND, `git rev-list --count` from the ledger base is 6).
- All task acceptance criteria re-run and green (see Verification results).
