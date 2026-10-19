---
phase: quick-261019-jia
plan: 01
subsystem: tests
tags: [tests, integration, dashboard, isolation, time-dependent, ci, quick]
requirements: [INSIGHT-06, INSIGHT-07, INSIGHT-18]
key-files:
  modified:
    - apps/api/tests/integration/dashboard-snapshot.test.ts
    - apps/api/tests/integration/isolation.test.ts
status: complete
commits: 2
plan_head_before: e00a5bfe
actuals:
  tokens: 6000
  tasks: 3
  commits: 2
---

# Quick 261019-jia: three time-dependent 08.7 dashboard integration tests Summary

The three seed-age-dependent tests now craft their own aged rows and pass on the same-day seed and on a seed backdated 3 days. The full-suite gate is NOT 1396/1396 on this database: 21 failures in files this task did not touch, 17 of them tied to manual residue in rede-demo (see Open items). Status is incomplete for that reason only.

## Commits
- 6b6f8a4e fix(quick-261019-jia): INSIGHT-07 crafts its own aged member instead of leaning on the seed's age (dashboard-snapshot.test.ts, +9 lines)
- 9e35db8b fix(quick-261019-jia): the 08.7 dashboard isolation sweeps craft their own aged rows (isolation.test.ts)

## Gates
- Task 1: dashboard-snapshot.test.ts 19/19 (was 18/19), biome clean.
- Task 2: dashboard-snapshot + isolation 85/85 on the same-day seed (log scratchpad/jia-two-files.log). agedDashboardMember occurrences outside comments: 6; removeDashboardFixtures( outside comments: 4; zero iso87-/dash87 users in auth.users and public.email_allowlist afterwards. `git diff --stat HEAD~2 HEAD -- scripts packages supabase apps/api/src` empty.
- Task 3A seed-age proof: script /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/840e776b-bd40-4501-ae6b-052fa08bfa46/scratchpad/seed-age-proof.sh shifts memberships.joined_at (20 rows) and feed_posts.created_at (65 rows) of rede-demo/rede-lab back 3 days, runs the two files (85/85 passed, /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/840e776b-bd40-4501-ae6b-052fa08bfa46/scratchpad/jia-aged-seed.log), restores via EXIT trap (+3 days). Before/after files identical:
  memberships min/max 2026-10-19 15:52:23.845161+00 / 15:52:26.557054+00; feed_posts min/max 2026-10-19 14:35:24.815+00 / 15:51:26.993+00. Database not left aged. Re-run recipe: run the script.
- Task 3B: apps/api `pnpm lint` clean (119 files), `pnpm typecheck` clean.
- Task 3C full run (`pnpm test:integration`, log /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/840e776b-bd40-4501-ae6b-052fa08bfa46/scratchpad/jia-integration.log): 21 failed | 1332 passed | 43 skipped (1396), 5 failed files. email-allowlist.test.ts alone 13/13. dashboard-snapshot and isolation passed inside the full run. No iso87-/dash87 residue afterwards.

## Open items (not caused by these commits)
Failing files, none touched by this task:
- communities.test.ts (3) and courses-member-area.test.ts (14) and media.test.ts (file-level cleanup FK error, courses_cover_asset_id_media_assets_id_fk): the local DB holds manually created rows, community "COMUNIDADE DE IA" (rede-demo, created 2026-10-19 17:03Z) and course "IA em 7 dias" (rede-demo, 17:04Z, cover asset 1285416f..., 3 lessons), both created before this run started (first test run 17:14Z). They break seed-pinned counts (5 communities instead of 4, extra lessons/streak) and block media cleanup. Re-running those three files alone reproduces the 17 failures. Fixing needs deleting that course/community (user data) or a db reset; neither was done.
- signup.test.ts (2: GoTrue resend 422) and platform-tenants.test.ts (2: inviteUserByEmail failed): failed only in the full run; both files pass 38/38 when run alone right after, so these look environmental (hook/mail), not data.

To get 1396/1396: remove the IA community and course (and its lessons/cover asset) or accept a reset+seed, then re-run `pnpm test:integration`.

## Deviations from Plan
None to the code; the plan was executed as written.

## Self-Check: PASSED (files and commits exist; gate 3C open as above)

## Post-execution addendum (orchestrator, 2026-10-19)

- **Status raised to `complete`.** The verifier returned `passed` (`261019-jia-VERIFICATION.md`): only the two test files changed, no assertion was removed or weakened, fixtures are cleaned up, `dashboard-snapshot` + `isolation` pass 85/85 on the same-day seed.
- **The local full-suite gate (1332/1396) was not a blocker.** Its 17 failures came from rows the developer created by hand in the local DB (community "COMUNIDADE DE IA", course "IA em 7 dias" in rede-demo) in files this change never touched; the 4 signup/platform-tenants failures passed when those two files ran alone (38/38). The authoritative gate is CI on a fresh DB.
- **CI confirmed it.** Push `9e35db8b` -> Deploy API run 39293604816: `checks / pgTAP, seed, API integration` green (was 1393/1396), lint/typecheck/build and e2e PWA green, image built, and `Production (migrations -> API -> worker)` succeeded.
- **Production, as read from that job's log:** `supabase db push` applied 37 migrations (`20261013205445_course_gate_seam` through `20261019152008_email_allowlist_hooks`); `config push` ran with both allowlist hooks still `enabled = false` (the only remote note is the old Twilio/pooler one, same as the 2026-10-12 deploy); `gcloud run deploy` published `api` and `worker` with image `9e35db8b`. Read-only smoke afterwards: `/v1/courses`, `/v1/join/state`, `/v1/dashboard/overview` answer 401 and `/v1/health` 200.
- **Local DB note:** the manual IA community/course rows are still in the local DB and make 17 seed-pinned integration tests fail locally until they are removed or the DB is reset and seeded.
