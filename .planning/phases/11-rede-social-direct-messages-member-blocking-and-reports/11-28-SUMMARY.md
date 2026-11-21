---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 28
subsystem: release
tags: [release, deploy-order, expand-only, ledger, manual-proofs, exit-gate, validation, D-616, D-728, D-730, plan-13-20-handover]
requires:
  - phase: 11-rede-social-direct-messages-member-blocking-and-reports
    provides: "plans 01 to 27: the thirteen migrations, the API and worker routes, the web screens, the two Playwright specs"
provides:
  - "docs/DEPLOY.md section 'Phase 11 release (direct messages, block effects and reports)': three ordered steps, seven failing windows, per-tenant effect, rollback limit, read-only checks, smoke checks"
  - "11-MANUAL-PROOFS.md: rows P1 to P41, every one pending"
  - "the Phase 11 note in packages/modules/chat/README.md"
  - "11-VALIDATION.md checked against the 28 plans, Wave 0 files ticked, the exit gate recorded"
affects: [phase-11-verification, plan-13-20, release]
requirements-completed: [CHAT-06, CHAT-07, MODER-04, MODER-05]
actuals:
  tokens: 45000
  tasks: 3
  commits: 4
plan_head_before: de4e6130
key-files:
  created:
    - .planning/phases/11-rede-social-direct-messages-member-blocking-and-reports/11-MANUAL-PROOFS.md
  modified:
    - docs/DEPLOY.md
    - packages/modules/chat/README.md
    - .planning/phases/11-rede-social-direct-messages-member-blocking-and-reports/11-VALIDATION.md
key-decisions:
  - "The release order inverts the API-first rule: migrations, then the web, then the API and the worker together (an old web refuses the new API's optional keys; the push hint schema is strict)"
  - "nyquist_compliant and wave_0_complete stay false: two gate commands end non-zero for reasons that are not this phase's (stale local seed and residue)"
duration: 8h 30m wall clock, almost all of it the machine asleep (a 15-minute nap cycle killed one test or worker per cycle)
completed: 2026-11-20
status: complete
coverage:
  - id: D1
    description: "DEPLOY.md release section naming the thirteen migrations in file order, the three numbered steps, the seven failing windows, the per-tenant first-day effect and the rollback limit"
    requirement: "CHAT-06"
    verification:
      - kind: other
        ref: "shell guard of Task 1 (scratchpad guard.sh): failed before the section, exit 0 after"
        status: pass
    human_judgment: false
  - id: D2
    description: "Owner's ledger 11-MANUAL-PROOFS.md, 41 rows, none passed"
    requirement: "MODER-05"
    verification:
      - kind: other
        ref: "Task 2 verify: no passed or done row, 41 pending rows, CHAT-06, MODER-05, A-11-ROLE and A5 present"
        status: pass
    human_judgment: false
  - id: D3
    description: "The local exit gate run once and recorded"
    requirement: "MODER-04"
    verification:
      - kind: integration
        ref: "bash scripts/supabase.sh test db; 22 API integration files; unit suites; guards; no-drift gates; expand-only grep; next build"
        status: pass
    human_judgment: true
    rationale: "Five isolation cases and four pgTAP assertions stay red on the stale local seed and residue (not this phase's); a person decides whether the gate counts as closed"
---

# Phase 11 Plan 28: Release, ledger and exit gate Summary

**The Phase 11 release notes (migrations, then web, then API and worker together), a 41-row owner's ledger with every row pending, and one recorded run of the local gate that is green apart from the known stale-seed reds.**

## Performance

- **Duration:** about 8h 30m of wall clock (11:51 to 20:24 on 2026-11-20); the work itself was short, the rest was the machine sleeping through the gate
- **Tasks:** 3 of 3
- **Files modified:** 4 (one created)
- **Commits:** 3 task commits plus this summary

## Accomplishments

- Task 1: the guard was written first and seen failing (`guard exit=1`, no section), then the section was written and the same guard passes (exit 0). The section sits after the 12.5 one, has exactly one numbered `Migrations`, `Web` and `API and worker` list, names `titleText`, and does not increase the `db:reset` count (6 before, 6 after).
- Task 2: the ledger (P1 to P41), the chat README note and the validation map check. The map was compared with the 28 plans by script: 79 rows, task counts and waves identical, the first real command of each task identical; no row drifted, so none was edited. The only difference is that the first `<automated>` of the web and e2e tasks is the sketch approval guard and the map deliberately lists the real command.
- Task 3: the gate was run once and recorded (below).

## Task Commits

1. **Task 1: DEPLOY.md Phase 11 release section** - `66fc12d4` (docs)
2. **Task 2: ledger, chat README note, ticked Wave 0 files** - `9712bb59` (docs)
3. **Task 3: exit gate recorded in the validation map** - `a9faa348` (docs)

**Plan metadata:** the commit that holds this SUMMARY (with a one-word correction of the count in the validation record).

## Exit gate, step by step

| # | Step | Exit status |
|---|------|-------------|
| 1 | `bash scripts/supabase.sh test db` (whole directory, first) | 1. 73 files, 6004 tests. `237`, `238`, `239`, `240` ok. Reds: `120 #37`, `141 #21`, `232 #56`, `154 #65`, exactly the known four |
| 2 | Integration, one file at a time (`SEED_PASSWORD` exported from the documented local file, never printed or written; ffmpeg on PATH) | see the table below |
| 3 | `pnpm boundaries`, `boundaries:negative`, `guard:lanes`, `check:static-routes`, `check-ui-literals.sh`, `check-dashboard-fixtures.sh` | 0 each |
| 4 | `pnpm db:generate`, `pnpm db:generate:central` | 0 each, `No schema changes, nothing to migrate` |
| 5 | Expand-only grep over the 13 migrations | prints nothing |
| 6 | Body diffs | `account_anonymise`: no Phase 11 migration defines it (nothing to diff). `chat_messages_before_insert` and `chat_messages_after_insert` against their previous newest files: only added lines except two lines each, where the `select ... into` list is extended by the pair columns (a superset; no logic removed) |
| 7 | `turbo typecheck test` over the ten packages, which also ran the one production `next build` of the web | typecheck and build green (18 of 22 tasks green); 4 test tasks red from sleep artifacts, all green on lone reruns (below) |
| 8 | Caches cleared (`.turbo/cache`, `apps/web/.next/cache`; `.next/dev` did not exist) | free disk stayed at 16 GiB |

Integration files (21 green, 1 known red):

| File | Result |
|------|--------|
| direct-chat | 19 passed |
| direct-chat-block | 14 passed (the run took 640 s: a nap, but it passed) |
| direct-chat-voice | red first (a 901 s test), 5 of 5 on the lone rerun |
| direct-notifications | red first (2 cases, sleep), 23 of 23 on the rerun |
| social-block | red twice from 900 s tests, 7 of 7 on a third lone run |
| block-by-membership | 9 passed |
| story-comment-block | 4 passed |
| report-removers, report-riders, reports-new-subjects | 12, 19, 28 passed |
| reports-notice | red first (785 s), 10 of 10 on the rerun |
| reports-blocks | 22 passed |
| chat, chat-cases-notices | 15, 16 passed |
| chat-voice | red first (915 s), 23 of 23 on the rerun |
| chat-voice-gate | 9 passed |
| isolation | **5 failed, 93 passed**: stories b3, stories b8, `events` (shared identity), `inventory sweep: events`, and `phase 10 sweep` (member stories). Four are on the known list; the fifth is the same seeded story (`0e...00f3`, a followers story of the lab tenant with a 24 h window) that the phase 10 sweep expects and the stale seed no longer provides. Every `phase 11 sweep` case passed |
| feed-social | 53 passed (a 911 s run, passed) |
| member-stories | red once on EP-60 while the seeded lab story `0e...00f3` still had its window (it showed up as an extra live story); 46 of 46 after the window closed. Not Phase 11 code (no commit of this phase touches the expiry predicate) |
| member-communities, moderation-member-content, notifications | 48, 22, 28 passed |

Unit suites (first run red only from the sleeping machine: tests of 900 to 1,900 s, workers that never answered): `@rede-social/core` 116 files and 1858 tests green on a lone rerun, `module-chat` 332, `module-stories` 224, and the 40 web files that failed or never started (28 and 12) all green on lone reruns. `contracts`, `module-social`, `module-notifications`, `module-communities`, `module-feed` and the API unit tests passed in the first run.

## Decisions Made

- Both Nyquist flags are left `false`: the plan requires every automated command to exit 0, and the whole-directory pgTAP run (known residue) and `isolation.test.ts` (stale seed) do not. Wave 0: every file exists and its box is ticked; the flags are the orchestrator's or Igor's call once the residue row (P40) is cleared.
- The ledger and the DEPLOY.md section are written in English like the 12.5 ones.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's own list] The guard names thirteen migrations, not eleven**
- **Found during:** Task 1
- **Issue:** the plan's guard lists eleven files; plan 09 also created `chat_support_conversation_gate.sql` and `direct_participants_policy.sql`, and the plan's own truth says the guard must name every migration the phase created, in file order.
- **Fix:** the guard, the DEPLOY.md section, the expand-only grep and the read-only checks use all thirteen.
- **Files modified:** docs/DEPLOY.md
- **Verification:** the guard fails before the section and passes after it.
- **Committed in:** `66fc12d4`

**2. [Rule 3 - Blocking] A file-edit slip on DEPLOY.md, repaired before commit**
- **Found during:** Task 1
- **Issue:** a first scripted edit duplicated the 12.5 section tail; it was repaired from the file itself (nothing was committed in that state) and the final diff is 231 insertions, 0 deletions.
- **Committed in:** `66fc12d4`

---

**Total deviations:** 2 (one plan-list correction, one transient edit slip). **Impact on plan:** none on scope.

## Issues Encountered

- The Mac's maintenance sleep killed one test or worker about every 15 minutes (900 s tests, `Timeout waiting for worker to respond`, 30 s timeouts). Every such red was rerun alone and only the second run counted, as agreed.
- A `FeedVideo` batch of 26 failures looked real; it passes 62 of 62 alone.
- Two helper scripts of mine used `mapfile`, which the macOS bash 3.2 does not have; the first one ran the whole web suite by mistake, the second ran nothing. Both were stopped and replaced.

## Anything blocked

- Nothing was blocked. Not run, by rule: `pnpm db:reset`, `pnpm db:seed`, `pnpm e2e` and any Playwright spec, the full `pnpm verify`, `pnpm spike:supavisor` and every hosted command (each is a ledger row: P21, P22, P29 to P35, P38).

## Known Stubs

None.

## Threat Flags

None. The plan writes documentation only; no new surface.

## Self-Check: PASSED

- docs/DEPLOY.md (one `## Phase 11 release` heading, guard exit 0), 11-MANUAL-PROOFS.md (41 pending rows, no passed or done), packages/modules/chat/README.md (note present), 11-VALIDATION.md (79 task rows) all exist.
- Commits `66fc12d4`, `9712bb59`, `a9faa348` are in `git log`.
- ROADMAP.md, STATE.md, REQUIREMENTS.md, anything under `.planning/phases/13-*` and sketch 025 were not touched.
