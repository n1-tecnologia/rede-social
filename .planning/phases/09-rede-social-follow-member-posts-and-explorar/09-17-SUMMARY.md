---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 17
subsystem: web
tags: [social, gap-closure, tracer, web, records, WR-04, A6, UI-D-498, UI-D-501, docs]

requires:
  - phase: 09-rede-social-follow-member-posts-and-explorar
    provides: "FollowControl and SocialCountsBlock (09-10), the four gap-round migrations (09-14), the reply-notice gate (09-15), the member upload hardening (09-16)"
provides:
  - "FollowControl and SocialCountsBlock follow the server value: a late (null then boolean) or refreshed value replaces local state during render, a same-value rerender never undoes a confirmed tap (WR-04)"
  - "docs/DEPLOY.md: the fourteen-migration release order, the Resíduos aceitos paragraph (A6 photo variants, EP-60 minted playback tokens), the gap-round behavior bullet and the rewritten member upload share decision"
  - "the social README Known limits section and the app.social_can_read_for sentence in the seam paragraph"
  - "09-VALIDATION.md rows 9-14-01 to 9-17-02, the gap-round Wave 0 files, two Manual-Only rows and a gap-round paragraph under Approval"
affects: [phase-09-verification, phase-10-member-authoring, docs-deploy]

actuals:
  tokens: 10650
  tasks: 2
  commits: 3
plan_head_before: 71d494714159aded043e41c8066a6e4bfd701fe6
commits: 3

tech-stack:
  added: []
  patterns:
    - "adjust state while rendering: keep a copy of the last server prop seen and, when it differs, set the copy and the local state in the render body (no effect, no key), so no frame shows the stale value and an in-flight tap is not dropped"
    - "accepted residuals are written with three parts (what, why accepted, what reopens it) in the go-live item and in the module README"

key-files:
  created:
    - apps/web/components/social/SocialCountsBlock.test.tsx
  modified:
    - apps/web/components/social/FollowControl.tsx
    - apps/web/components/social/FollowControl.test.tsx
    - apps/web/components/social/SocialCountsBlock.tsx
    - docs/DEPLOY.md
    - packages/modules/social/README.md
    - .planning/phases/09-rede-social-follow-member-posts-and-explorar/09-VALIDATION.md

key-decisions:
  - "Planning decision 1: resync during render, not by key and not by effect. FollowControl keeps seenInitial and SocialCountsBlock keeps seenFollowerCount; only a CHANGED prop replaces local state, so a confirmed tap survives a same-value rerender and a tap in flight is not dropped by a remount."
  - "Planning decision 2: no e2e for the resync. The batch-read failure that makes the state arrive late cannot be produced in the local e2e; the unit tests are the proof and the browser pull-to-refresh is a Manual-Only row. The social.spec.ts regression sample was NOT run in this run (see Verification)."
  - "Planning decision 3: the residuals live in the go-live item ('Resíduos aceitos (decididos em 2026-10-20)') and in a README '## Known limits' section; the eight fixed MOD-05 headings and their order are unchanged."
  - "Planning decision 4: the release order was read from the directory. ls supabase/migrations lists exactly four files after 20261019225153_moderation_post_removed.sql and they are items 11 to 14."
  - "Planning decision 5: REQUIREMENTS.md was not edited. SOCIAL-05 ('post uploads') and SOCIAL-10 ('the ten Phase 9 migrations') are now narrower than the code and the release; flagged for the orchestrator."
  - "Planning decision 6: Task 1 is reversible (two components), Task 2 is documentation."
  - "No in-flight guard on the resync: a changed server value can only differ from the optimistic value by going to null (the slot, no visible label), and the action's own answer is applied when it resolves, so the plan's simple form already gives 'no flash, no revert' (test W6)."

requirements-completed: [FOLLOW-05, SOCIAL-06, SOCIAL-10]

coverage:
  - id: D1
    description: "A FollowControl that first rendered with initialFollowing null and later receives true or false shows Seguindo or Seguir in the same instance; a changed server value flips the label; a same-value rerender never undoes a confirmed tap; a new value during a tap neither flashes nor reverts (WR-04, EP-78, EP-79, EP-80)"
    requirement: FOLLOW-05
    verification:
      - kind: unit
        ref: "apps/web/components/social/FollowControl.test.tsx#FollowControl follows the server value (WR-04, EP-43) W1-W7"
        status: pass
    human_judgment: false
  - id: D2
    description: "SocialCountsBlock prints a new followerCount after a refresh, keeps the number the control's answer set across a same-value rerender, replaces it on a changed value, prints 0 for zero, resyncs the control below it, and renders two link cells and no control in own mode"
    requirement: FOLLOW-05
    verification:
      - kind: unit
        ref: "apps/web/components/social/SocialCountsBlock.test.tsx C1-C6"
        status: pass
    human_judgment: false
  - id: D3
    description: "After a pull-to-refresh of /membros in a real browser, a row whose follow state arrived late shows Seguindo for a followed member"
    requirement: FOLLOW-05
    verification: []
    human_judgment: true
    rationale: "Backstop truth from the plan: the batch-read failure that makes the state arrive late cannot be produced in the local e2e, and no e2e was run in this plan."
  - id: D4
    description: "The A6 photo-variant residual and the minted-playback-token residual are recorded as ACCEPTED, each with what it is, why it is accepted and what would reopen it, in docs/DEPLOY.md and the social README"
    requirement: SOCIAL-06
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/module-readmes.test.ts (17 tests)"
        status: pass
      - kind: other
        ref: "grep -c 'Resíduos aceitos' docs/DEPLOY.md and grep -c '## Known limits' packages/modules/social/README.md (each 1)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Phase 09 release lists FOURTEEN expand-only migrations in the order ls supabase/migrations prints, every migration count of that section agrees, and the member upload share decision is rewritten for the widened share and the pending charge (limits.ts)"
    requirement: SOCIAL-10
    verification:
      - kind: other
        ref: "14 numbered items in the section; items 11-14 match ls supabase/migrations | tail -4; the Phase 8 release step 1 grep over the four files printed nothing"
        status: pass
    human_judgment: false
  - id: D6
    description: "09-VALIDATION.md has one row per task of plans 09-14 to 09-17 (10 rows), the new Wave 0 files, two Manual-Only rows and a gap-round paragraph, with no row green for a command that did not run"
    requirement: SOCIAL-10
    verification:
      - kind: other
        ref: "grep -c '^| 9-1[4-7]-' 09-VALIDATION.md prints 10"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-10-20
status: complete
---

# Phase 9 Plan 17: Follow state resync and the gap-round records Summary

**The follow control and the follower count now follow the server value (resynced during render, so a late or refreshed state shows the truth and a confirmed tap survives a same-value rerender), and DEPLOY.md, the social README and the validation map record the fourteen-migration release order and the two accepted residuals honestly.**

## Performance

- **Duration:** about 11 min (start recorded from the first commit at 13:01Z; the run began a minute or two earlier)
- **Started:** 2026-10-20T12:59:00Z (approximate)
- **Completed:** 2026-10-20T13:10:00Z (approximate)
- **Tasks:** 2
- **Files modified:** 7 (one new)

## Accomplishments

- **WR-04 closed (Task 1, tracer).** `FollowControl` keeps `seenInitial` and, when `initialFollowing` differs from it during render, sets both the copy and the local `following`. The branch sits before the `null` early return, with no effect and no `key` at any call site. `SocialCountsBlock` does the same for `followerCount` (`seenFollowerCount`); `followingCount` and `viewerFollows` stay plain props because the control below resyncs itself. No prop, export, string or class changed; `apps/web/messages` and `affected-map.json` have an empty diff, and so do `membros` and `perfil`.
- **The records (Task 2).** `docs/DEPLOY.md` lists items 11 to 14 (`20261020123217_social_audience_revocation.sql`, `20261020123622_feed_social_member_write_gate.sql`, `20261020123631_feed_member_update_guard.sql`, `20261020123859_social_can_read_for.sql`) with kind and purpose, says fourteen everywhere the section counts, states why the update side is a guard and not a policy, adds the 'Resíduos aceitos (decididos em 2026-10-20)' paragraph under the go-live item, adds a gap-round behavior bullet to the API and worker list, and rewrites the member upload share decision (every purpose, the pending charge, the unmeasured-video failure, the constant in `packages/core/server/media/limits.ts`). The social README gains the `app.social_can_read_for` sentence and `## Known limits` after `## Reuse`. `09-VALIDATION.md` gains ten task rows, the gap-round Wave 0 files, two Manual-Only rows and the gap-round paragraph.

## Task Commits

1. **Task 1 (tracer), RED:** `8690a144` (test) - W1 to W7 in `FollowControl.test.tsx`, the new `SocialCountsBlock.test.tsx` (C1 to C6)
2. **Task 1, GREEN:** `40c7bc60` (feat) - the two components
3. **Task 2:** `793bd365` (docs) - `docs/DEPLOY.md`, the social README, `09-VALIDATION.md`

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## Files Created/Modified

- `apps/web/components/social/FollowControl.tsx` - `seenInitial` copy, resync branch before the null return, docblock rule
- `apps/web/components/social/SocialCountsBlock.tsx` - `seenFollowerCount` copy and resync, docblock rule
- `apps/web/components/social/FollowControl.test.tsx` - describe 'FollowControl follows the server value (WR-04, EP-43)' (7 cases)
- `apps/web/components/social/SocialCountsBlock.test.tsx` - new, 6 cases
- `docs/DEPLOY.md`, `packages/modules/social/README.md`, `.planning/phases/09-rede-social-follow-member-posts-and-explorar/09-VALIDATION.md` - the records

## Verification results (real numbers)

| Check | Result |
|-------|--------|
| RED run, the two test files | 22 tests: 6 failed, 16 passed (W1, W3, W7, C2, C3, C5 failed on the stale label or count) |
| GREEN, `vitest run components/social` | 6 files, 64 tests, PASS |
| `pnpm --filter @rede-social/web typecheck` | clean |
| `pnpm --filter @rede-social/web lint` | exit 0; one pre-existing `info` in `components/dashboard/AlertsBell.test.tsx:151` (noUselessFragments), not this plan's file |
| `bash scripts/check-ui-literals.sh` | OK, both lines |
| `vitest run scripts/e2e-affected.test.ts` | 1 file, 44 tests, PASS |
| `pnpm --filter @rede-social/api exec vitest run tests/unit/module-readmes.test.ts` | 17 tests, PASS (run before and after the docs commit) |
| `pnpm --filter @rede-social/core test` (alone) | 45 files, 465 tests, PASS |
| `TURBO_CACHE=local:r pnpm turbo typecheck test --concurrency=4` | 37 of 37 tasks successful |
| `pnpm lint`, `pnpm boundaries` (1720 files, no issues), `pnpm boundaries:negative` | PASS |
| `social.spec.ts` e2e sample on `mobile-chromium` | **NOT RUN** (see below) |

## Deviations from Plan

### Instructed omissions

**1. [Run instruction] The Playwright sample of Task 1 was not run.** The run instructions forbade Playwright e2e, `next dev`, builds and `pnpm verify` because the disk is tight. The plan itself allows recording the e2e as not executed. The browser behavior is covered by the unit tests and by the Manual-Only row, and the 09-VALIDATION row `9-17-01` carries it as `unrun-verify`.

### Observations (not code changes)

**2. The first `turbo typecheck test` run failed and was re-run bounded.** The unbounded run (`TURBO_CACHE=local:r pnpm turbo typecheck test`) reported eight `test` tasks as ELIFECYCLE failures (core, ui, dashboard, communities, api, courses, feed, web) and `module-notifications#test` as the failing task, with 11 of 32 tasks successful. `@rede-social/core test` run alone passes (465 tests), and the same command with `--concurrency=4` passed 37 of 37 tasks. I did not isolate the cause of the unbounded failure; resource contention under unlimited concurrency fits the project note that gates run with `--concurrency=4`, but I did not prove it.

**Total deviations:** 1 instructed omission, 1 unexplained transient. **Impact:** none on the code; the e2e gap is recorded, not claimed.

## TDD Gate Compliance

Task 1 is `tdd="true"`. `workflow.tdd_mode` is off and `gsd check tdd-red-evidence` parses `node --test` TAP, which Vitest never emits, so the checker was not run and no evidence record was fabricated. The RED evidence is the real Vitest output: 22 tests, 6 failed and 16 passed, committed as `8690a144` (`test(09-17)`) before `40c7bc60` (`feat(09-17)`). Honest note on the RED set: W2, W4, W5 and W6 and C1, C4 and C6 passed against the old code. They pin behavior that must survive the fix (null to false is trivially `Seguir`; a same-value rerender and an in-flight rerender were already safe with the one-shot state), so they are regression guards and not RED cases. The six failing cases are the resync itself. No refactor commit. Task 2 is documentation and has no RED, as the plan marks it `type="auto"`.

## Issues Encountered

- **Disk fell below the 3 GiB stop line after the workspace gate.** Free space was 7.1 GiB before `turbo typecheck test` and 2.6 GiB after the later commands; I removed `apps/web/.next/dev` and `apps/web/.next/cache` (regenerable, no `next dev` running) and it recovered to 2.9 GiB, still under 3 GiB. All heavy runs had already finished; the remainder (documents, SUMMARY, STATE, commits) writes a few kilobytes, so I finished rather than stopping with uncommitted records. I did not find which directory took the other 4 GiB (`.turbo` is 216K, `/private/var/folders` 4.8G, `~/Library/pnpm` 3.8G). The orchestrator should free disk before the next heavy run.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema changed. T-09-65 mitigated (unit cases W1 to W7, C2, C3, C5), T-09-66 mitigated (residuals written as ACCEPTED with a reopen condition, statuses taken from the SUMMARYs, unrun checks marked), T-09-67 mitigated (fourteen files by real name in timestamp order), T-09-54 and T-09-53 recorded as accepted.

## User Setup Required

None - no external service configuration required. Nothing was pushed, deployed or applied to a hosted project; `supabase db push` was not run.

## Open items for the orchestrator

1. **`packages/core/server/media/limits.ts`**: the docblock above `MEDIA_MEMBER_SHARE_OF_CEILING` still says "A member's `post` uploads draw from this fraction...". The share now covers every member purpose. The file is outside this plan's `files_modified`, so it was not edited.
2. **REQUIREMENTS.md wording** (not edited; boxes stay Pending until re-verification): SOCIAL-05 says the share covers member `post` uploads (now every purpose), and SOCIAL-10 says "the ten Phase 9 migrations" (now fourteen).
3. **ROADMAP.md** Phase 9 plan list: the roadmap update handler was run for plan progress only; the plan list text (13/13) was not rewritten here. See the orchestrator hand-off for what the handler printed.
4. **Human items still open** (listed in the validation Approval paragraph): the `social.spec.ts` e2e sample, one uninterrupted `pnpm verify`, the real-device PWA walk, the designer review of sketch 012, a real Mux upload (no duration, and one over the cap), the browser pull-to-refresh of `/membros`, the D-478 legal wording.
5. **Disk**: 2.9 GiB free at the end of this run.

## Self-Check

- Created files exist: `apps/web/components/social/SocialCountsBlock.test.tsx`.
- Commits exist: `8690a144`, `40c7bc60`, `793bd365`; `git rev-list --count` from `plan_head_before` 71d49471 is 3.
- Acceptance criteria re-run: `seenInitial` present and before the null return; no `useEffect` in either component; empty diff for `apps/web/messages`, `affected-map.json`, `membros`, `perfil`, `09-CONTEXT.md`, `REQUIREMENTS.md`, `ROADMAP.md` (before the roadmap handler); 14 numbered migration items, items 11 to 14 match `ls supabase/migrations | tail -4`; no standalone "ten" in the Phase 09 release section; `Resíduos aceitos`, `## Known limits`, `9-14-01` and `limits.ts` each found; 10 `9-1[4-7]-` rows.

## Self-Check: PASSED

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
