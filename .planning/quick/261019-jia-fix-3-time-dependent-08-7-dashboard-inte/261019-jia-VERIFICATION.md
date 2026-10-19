---
phase: quick-261019-jia
verified: 2026-10-19T17:30:00Z
status: passed
score: 6/7 must-haves verified (1 not re-run by the verifier, see Notes)
overrides_applied: 0
---

# Quick 261019-jia: Verification Report

**Goal:** the three time-dependent 08.7 dashboard integration tests build their own aged fixtures and pass on a same-day seed (CI) and on an aged seed, without weakening assertions or touching seed/setup/fixture/product code.
**Commits:** 6b6f8a4e, 9e35db8b (base e00a5bfe). **Mode:** initial verification.

## Checks requested

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| a | Only the two test files changed | VERIFIED | `git diff --name-only e00a5bfe..9e35db8b` lists only `apps/api/tests/integration/dashboard-snapshot.test.ts` and `apps/api/tests/integration/isolation.test.ts`. The stat for `scripts`, `packages`, `supabase`, `apps/api/src`, `dashboard-fixture.ts` and `setup.ts` is empty. Both commits are by igor.vboas and carry no trailer. `git status` for apps/scripts/packages/supabase is clean. |
| b | No assertion removed or weakened | VERIFIED | The removed (`-`) lines are 4: the old import line (extended), `tokens.demoMember` and `tokens.labMember` in the two `request(...)` calls (replaced by `demoActor.token` and `labActor.token`), and `u.email = 'member@rede-lab.local'` (replaced by `${labActor.email}`). No `expect()` line was removed. Added assertions: `expect(labBody.members.count).toBeGreaterThan(0)` and `expect(labRow).toBeDefined()`. The `expect(body.members.count).toBeGreaterThan(0)` and the independent-count equality in INSIGHT-07 are untouched. The demo-session-on-the-lab-host 403 case keeps the seed `tokens.demoMember`. |
| c | Fixtures cleaned up and tenant-scoped | VERIFIED | Cleanup runs in each sweep's `finally`, the file `afterAll`, and a `beforeAll` sweep of the `iso87` base. The INSIGHT-07 member is named `${PREFIX}-aged...` and is covered by the file's existing afterAll prefix sweep. Fixtures are created through `insertMembershipAt` / `insertPostAt` / `insertStoryAt` / `insertLikeAt` with an explicit host or `tenantId` (demo or lab). `removeDashboardFixtures` deletes stories by the prefix's authors, then identities by prefix, and deletes snapshots only for the `rede-demo` and `rede-lab` slugs. `iso87` appears in no other file. |
| d | Read-only DB check | VERIFIED | After the run: `auth.users` has 0 rows like `iso87-%` or `dash87%`; `public.email_allowlist` has 0; `public.feed_posts` by `iso87-` authors has 0. `memberships.joined_at` min is 2026-10-19 15:52:23 and max is 2026-10-19 15:52:26 (today, 20 rows). The seed was not aged and is the same both before and after the run. |
| run | Two files, once | VERIFIED | `pnpm exec vitest run tests/integration/dashboard-snapshot.test.ts tests/integration/isolation.test.ts` gave `Test Files 2 passed (2)`, `Tests 85 passed (85)`, on the same-day seed, with the developer's manual community and course rows present. |

## Must-haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | INSIGHT-07 inserts its own member (daysAgo 10) before the rebuild; assertions unchanged | VERIFIED | Diff plus passing run. |
| 2 | Owner sweep crafts 2 demo members, 1 lab member, a post (k3) and a story (k2) with likes; adds `labBody.members.count > 0`; all original assertions kept | VERIFIED | Diff plus passing run. |
| 3 | Activity sweep signs in as its own aged demo and lab members; `labRow` looked up by that e-mail; `toBeDefined` added; the 403 case untouched | VERIFIED | Diff plus passing run. |
| 4 | Seed-age independence (the 3-day shift proof) | NOT RE-RUN | The verifier did not repeat the shift because it is a mutating DB operation outside the allowed scope. Static evidence: all fixtures use `daysAgo` / `k` offsets relative to the tenant-local today and not the seed's timestamps, and the seed rows are still today's. The planning-time proof is recorded in the SUMMARY (the shift was run by the executor). |
| 5 | Fixture naming, allowlist via the createUser choke point, cleanup, no residue | VERIFIED | Items (c) and (d) above. |
| 6 | Only the two test files changed | VERIFIED | Item (a). |
| 7 | Two-file run green (85/85) | VERIFIED | The run above. The full `pnpm test:integration` (1396/1396), lint and typecheck were not run by the verifier, as instructed. |

## Pre-existing failures

The 17 local failures from the developer's manual rows (a "COMUNIDADE DE IA" community and an "IA em 7 dias" course in rede-demo) were not reproduced, because the full integration run was off limits. This change touches only two files, and both pass 85/85 with those manual rows present. So the 17 failures cannot be in these two files and are not caused by this change.

## CI

Deploy API run 39293604816 (for 9e35db8b) was still in progress when read. Its jobs (checks / pgTAP, seed, API integration, pooler spike; lint, typecheck; e2e PWA) had not finished. Not waited on. The CI result is the remaining external confirmation that the same-day seed passes.

## Anti-patterns

No TBD, FIXME or XXX markers were added. Nothing is stubbed. The assertions were only strengthened.

## Notes

The status is `passed`. The seed-age proof (truth 4) was not repeated by the verifier. It does not rest on anything the verifier observed to be wrong: fixtures are relative to the tenant-local today, and the diff, the two-file run, the cleanup and the DB state all check out. The one item left open is the CI result for run 39293604816.
