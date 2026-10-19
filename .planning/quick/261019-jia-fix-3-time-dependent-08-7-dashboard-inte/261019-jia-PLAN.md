---
phase: quick-261019-jia
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/api/tests/integration/dashboard-snapshot.test.ts
  - apps/api/tests/integration/isolation.test.ts
autonomous: true
requirements: [INSIGHT-06, INSIGHT-07, INSIGHT-18]
tags: [tests, integration, dashboard, isolation, time-dependent, ci, quick]

estimate:
  tokens: 40000
  raw_tokens: 40000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "dashboard-snapshot.test.ts > INSIGHT-07 passes on a same-day seed: the test inserts its OWN member joined 10 days before rede-demo's tenant-local today (insertMembershipAt) before the rebuild, so the snapshot of the tenant-local yesterday counts it; `expect(body.members.count).toBeGreaterThan(0)` and the `toEqual(await independentMembers(...))` comparison are unchanged and the other 18 tests of the file still pass."
    - "isolation.test.ts > 'phase 08.7 sweep: dashboard owner' passes on a same-day seed: it crafts two rede-demo members and one rede-lab member joined 40 days before their tenant-local today, plus one rede-demo post (D-3) and one rede-demo story (D-2) by the first demo member with a like of the second on each. Every existing assertion stays, and `expect(labBody.members.count).toBeGreaterThan(0)` is added so the lab count it compares with the lab-only SQL count is never the vacuous 0."
    - "isolation.test.ts > 'phase 08.7 sweep: dashboard activity' passes on a same-day seed: it signs in as its OWN aged rede-demo member and aged rede-lab member (their member rows exist in the newest build), reads /v1/dashboard/activity as them, and compares the lab answer with the lab fixture's row (looked up by that fixture's e-mail, `expect(labRow).toBeDefined()` added); the rede-demo-session-on-the-lab-host 403 case is untouched."
    - "No fixture depends on the seed's age: the three tests also pass with the seed's memberships.joined_at and feed_posts.created_at shifted back exactly 3 days (planning-time observation: 20 memberships and 65 posts shifted, both files green, DB restored to the same min/max afterwards). The executor repeats this on the committed tests and leaves the database un-aged."
    - "Every crafted identity is named `iso87-<RUN>-...` (isolation) or `<PREFIX>-aged-...` (snapshot), lists its e-mail on the allowlist through the existing authAdmin().createUser choke point, and is removed by removeDashboardFixtures in the case's finally, in the file's afterAll, and (leftovers of a crashed run) in the isolation file's beforeAll; after the full run no `iso87-%` or `dash87%` user is left in auth.users."
    - "Only the two integration test files change: scripts/seed.ts, setup.ts, dashboard-fixture.ts and every product file are untouched, and no assertion is removed or weakened."
    - "From apps/api, `pnpm exec vitest run tests/integration/dashboard-snapshot.test.ts tests/integration/isolation.test.ts` is green (85/85 at planning time), the full `pnpm test:integration` shows 1396/1396 with email-allowlist.test.ts 13/13, and `pnpm --filter @rede-social/api lint` and `typecheck` pass."
  artifacts:
    - path: "apps/api/tests/integration/dashboard-snapshot.test.ts"
      provides: "INSIGHT-07 case that creates its own aged member through insertMembershipAt before the rebuild"
      contains: "-aged"
    - path: "apps/api/tests/integration/isolation.test.ts"
      provides: "agedDashboardMember helper, DASH_FIXTURE prefix, aged fixtures + cleanup in the two 08.7 dashboard sweeps, file-level sweep of leftovers and teardown"
      contains: "agedDashboardMember"
  key_links:
    - from: "agedDashboardMember / insertMembershipAt"
      to: "app.dashboard_member_rows and app.dashboard_member_activity (memberships.joined_at < start of the tenant-local today)"
      via: "joined_at stamped as ((tenant-local today - daysAgo) + localTime) at time zone tenants.timezone, so the member row exists in the build of the tenant-local yesterday whatever the seed's age"
      pattern: "daysAgo"
    - from: "insertPostAt / insertStoryAt (k = 3 and 2 days before D)"
      to: "app.dashboard_area_content items (live posts and stories published in D-29..D)"
      via: "published inside Window30 and before until_at, so demoContent.items holds a non-story and a story item"
      pattern: "insertStoryAt"
    - from: "the try/finally of each sweep"
      to: "removeDashboardFixtures(DASH_FIXTURE)"
      via: "stories first, then removeIdentitiesByPrefix (posts, likes, media, allowlist rows) so later cases of the file never see the aged members"
      pattern: "removeDashboardFixtures"
---

<objective>
Make the three CI-red 08.7 dashboard integration tests independent of the seed's age, so the Deploy API production gate goes green (1396/1396).

Root cause (verified at planning time, see below): the dashboard reads the tenant-local YESTERDAY (D = tenant-local today - 1). `app.dashboard_member_rows` / `app.dashboard_member_activity` only write a member row for an active role-`member` membership with `joined_at < start of the tenant-local today`, and `app.dashboard_area_content` only lists posts and stories published in D-29..D. `scripts/seed.ts` (and CI, which seeds right before the run) creates every membership and post TODAY, so on a same-day seed the yesterday snapshot has 0 members, no content items and no member rows. The tests only pass on a seed older than a day. A previous attempt to age the whole seed pushed stories past their 24 h window and broke the stories suites, so the seed is left alone and each failing test crafts its OWN aged rows.

Live observation at planning time (baseline run of both files on the same-day seed, log `/private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/840e776b-bd40-4501-ae6b-052fa08bfa46/scratchpad/baseline-two-files.log`): 82 passed, 3 failed.
1. dashboard-snapshot.test.ts:127 `expected 0 to be greater than 0` (INSIGHT-07, members.count).
2. isolation.test.ts:4590 `expected undefined to be truthy` (`demoPost && demoStory`: the demo Conteúdo answer has no item). Behind it, line 4645 (`demoCommunity && demoEvent && demoMemberRow`, the member row) would fail next for the same reason.
3. isolation.test.ts:4731 `expected 'preparing' to be 'ready'` (the seed's `member@rede-demo.local` has no member row, so /v1/dashboard/activity answers preparing). The brief quoted `undefined to be truthy` for this one; the observed failure is the preparing answer, and the cause (no aged member row) is the same.
The patches described below were validated with throwaway copies of the two files: green on the same-day seed AND green with the seed backdated 3 days; the copies were deleted and the database restored.

Purpose: a deploy gate that does not depend on what day the seed ran. Output: two edited test files, two commits, a SUMMARY note with the seed-age proof.

Tracer note: no separate tracer task. The change is two test files and no architectural layer; Task 1 is the smallest end-to-end slice (one fixture, one real build, one real read) and proves the pattern Task 2 repeats.

Constraints from the brief (all kept): do not weaken or delete assertions; do not change scripts/seed.ts semantics; do not touch product code (if a real product bug shows up, STOP and report instead of working around it); do NOT run `supabase db reset`; commits use explicit paths only, identity igor.vboas, message prefix `fix(quick-261019-jia)`, NO Co-Authored-By trailer and no mention of Claude; do not push; do not commit PLAN/SUMMARY/STATE (the orchestrator does).
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@apps/api/tests/integration/dashboard-snapshot.test.ts
@apps/api/tests/integration/dashboard-fixture.ts
@apps/api/tests/integration/setup.ts
@apps/api/tests/integration/dashboard-member.test.ts
@apps/api/tests/integration/dashboard-owner-content.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: INSIGHT-07 crafts its own aged member (dashboard-snapshot.test.ts)</name>
  <files>apps/api/tests/integration/dashboard-snapshot.test.ts</files>
  <read_first>
    apps/api/tests/integration/dashboard-snapshot.test.ts (the `08.7 tracer` describe, the INSIGHT-07 case and the EP-50 case that already calls insertMembershipAt)
    apps/api/tests/integration/dashboard-fixture.ts (insertMembershipAt, dashboardDay, rebuildDashboard, removeDashboardFixtures)
  </read_first>
  <precondition>The local Supabase stack is up (container `supabase_db_rede-social` listed by `docker ps`), `public.tenants` holds `rede-demo` and `rede-lab`, and `apps/api/.env.local` supplies SEED_PASSWORD; nothing here resets the database.</precondition>
  <action>
In the INSIGHT-07 case ("INSIGHT-07: after one build for the tenant-local yesterday the read is ready, with the independent counts"), insert ONE fixture membership before the existing `rebuildDashboard(tenants.demo)` call, right after the `const day = await dashboardDay(tenants.demo);` line: `await insertMembershipAt({ prefix: `${PREFIX}-aged`, host: 'demo', daysAgo: 10, localTime: '10:00' });`. `insertMembershipAt` is already imported in this file (EP-50 uses it). Add a one-line comment above it citing quick 261019-jia: the seed writes every membership today, so the snapshot of the tenant-local yesterday would count none; the test crafts its own member joined 10 days before the tenant-local today (inside Window30, so it is also a new member).

Use daysAgo 10, never 0 (a member joined today is after the end of D and is not counted) and keep a margin so a midnight rollover during the run cannot move it out of range. Keep every existing line and assertion of the case exactly as it is, including `expect(body.members.count).toBeGreaterThan(0)` and the `toEqual(await independentMembers(tenants.demo, day))` comparison. Do not add a beforeAll, a new helper or a new import. The fixture is removed by the file's existing afterAll (`removeDashboardFixtures(PREFIX)` matches every e-mail starting `${PREFIX}-`) and by the beforeAll sweep of the prefix without its timestamp, so no new cleanup code is needed. The later cases (EP-50, EP-51, the staff/blocked case) compare against a `before` read taken after their own rebuild, so one extra counted member does not disturb them; confirm by running the whole file.

Do not edit setup.ts, dashboard-fixture.ts or scripts/seed.ts. Then commit only this file: `git add apps/api/tests/integration/dashboard-snapshot.test.ts` and `git commit` with message `fix(quick-261019-jia): INSIGHT-07 crafts its own aged member instead of leaning on the seed's age`, no Co-Authored-By trailer, identity igor.vboas (already the repo identity). Do not push.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social/apps/api && pnpm exec vitest run tests/integration/dashboard-snapshot.test.ts && pnpm exec biome check tests/integration/dashboard-snapshot.test.ts</automated>
  </verify>
  <done>dashboard-snapshot.test.ts is 19/19 green on the same-day seed (it was 18/19), the INSIGHT-07 case still asserts members.count > 0 and the independent-count equality, the file passes biome, one commit touches only this file, and `git diff --stat HEAD~1 HEAD` shows a change of a handful of lines in it.</done>
</task>

<task type="auto">
  <name>Task 2: the two 08.7 dashboard isolation sweeps craft aged members, a post and a story (isolation.test.ts)</name>
  <files>apps/api/tests/integration/isolation.test.ts</files>
  <read_first>
    apps/api/tests/integration/isolation.test.ts (file header imports, `const RUN`, the helper block that ends with `userIdOf`, the file-level beforeAll/afterAll, and the two cases whose titles start with "phase 08.7 sweep: dashboard owner" and "phase 08.7 sweep: dashboard activity")
    apps/api/tests/integration/dashboard-fixture.ts (insertMembershipAt, insertPostAt, insertStoryAt, insertLikeAt, removeDashboardFixtures signatures)
    apps/api/tests/integration/dashboard-owner-content.test.ts (the crafted post/story/like pattern this task mirrors: post k 3 at 10:00 liked at 11:00, story k 2 at 20:00 liked at 22:00)
  </read_first>
  <action>
All edits are in isolation.test.ts. Cite quick 261019-jia in one block comment on the helper; keep the case titles byte-identical (an isolation inventory test may key on them) and remove no existing line except the token and e-mail substitutions named below.

1. Imports. Extend the existing `./dashboard-fixture` import (currently insertFixtureProduct, rebuildDashboard, removeFixtureProduct) with insertLikeAt, insertMembershipAt, insertPostAt, insertStoryAt and removeDashboardFixtures, keeping the names alphabetically sorted so biome's import ordering passes. `HOSTS`, `SEED_PASSWORD` and `signInAs` are already imported from `./setup`.

2. Helper and prefix. Right after the existing `userIdOf` helper add, with a block comment explaining why (the dashboard reads the tenant-local yesterday; the seed and CI write everything today; so these two sweeps craft their own aged rows instead of leaning on the seed's age): a constant `DASH_FIXTURE_BASE = 'iso87'`, a constant `DASH_FIXTURE` equal to the base plus a dash plus the existing `RUN`, and an async function `agedDashboardMember(host: keyof typeof HOSTS, name: string)` that calls `insertMembershipAt({ prefix: `${DASH_FIXTURE}-${name}`, host, daysAgo: 40, localTime: '10:00' })` and returns that result spread together with `token: await signInAs(member.email, SEED_PASSWORD)`. The member is created through createSharedIdentity, so its e-mail is allowlisted automatically by authAdmin().createUser (quick 261018-owq) and its membership is active, so the token carries the tenant claims.

3. File-level hooks. As the FIRST statement of the file-level beforeAll add `await removeDashboardFixtures(DASH_FIXTURE_BASE);` (leftovers of a crashed run; it matches every `iso87-` e-mail). In the file-level afterAll add `await removeDashboardFixtures(DASH_FIXTURE);` before `await stopBoss();`.

4. Owner sweep ("phase 08.7 sweep: dashboard owner ..."). Immediately inside its `try {` (after `const path = '/v1/dashboard/owner/overview';`), BEFORE the two `rebuildDashboard` calls, create: `demoAuthor = await agedDashboardMember('demo', 'owner-demo-a')`, `demoLiker = await agedDashboardMember('demo', 'owner-demo-b')`, and one lab member `await agedDashboardMember('lab', 'owner-lab-a')`; then `agedPost = await insertPostAt({ tenantId: tenantIds.demo, authorUserId: demoAuthor.userId, k: 3, localTime: '10:00', caption: 'Aviso do painel' })` and `agedStory = await insertStoryAt({ tenantId: tenantIds.demo, authorUserId: demoAuthor.userId, k: 2, localTime: '20:00' })`, then two `insertLikeAt` calls by `demoLiker.userId`: on `postId: agedPost` with `k: 3, localTime: '11:00'` and on `storyId: agedStory` with `k: 2, localTime: '22:00'`. Because these exist before the case's own `demoPublications` / `demoMemberships` / `demoScopes` queries run, those leak lists now include the crafted ids, which keeps the cross-tenant naming assertions meaningful. Leave `demoContent.items.find(...)`, `expect(demoPost && demoStory).toBeTruthy()` and all other lines as they are. Directly after the existing `expect(labBody.members.count).toBe(labCount?.n);` line add `expect(labBody.members.count).toBeGreaterThan(0);` (the lab count is now the lab-only crafted count, never the vacuous 0). At the end of the case's existing `finally` block (after the two `delete from public.dashboard_...` statements) add `await removeDashboardFixtures(DASH_FIXTURE);`, so the aged members are gone before any later case of the file runs.

5. Activity sweep ("phase 08.7 sweep: dashboard activity ..."). Immediately inside its `try {` (after `const path = '/v1/dashboard/activity';`), before the two `rebuildDashboard` calls, create `demoActor = await agedDashboardMember('demo', 'activity-demo')` and `labActor = await agedDashboardMember('lab', 'activity-lab')`. Substitutions: the positive-control read `request(path, tokens.demoMember, { [TENANT_HOST_HEADER]: HOSTS.demo })` uses `demoActor.token`; the lab read `request(path, tokens.labMember, { [TENANT_HOST_HEADER]: HOSTS.lab })` uses `labActor.token`; the `labRow` query's `u.email = 'member@rede-lab.local'` becomes `u.email = ${labActor.email}`; add `expect(labRow).toBeDefined();` right after that query so the numbers comparison cannot pass against nothing. The last check of the case (a rede-demo member session on the lab host is refused with TENANT_HOST_MISMATCH) keeps the seed `tokens.demoMember` untouched. Add `await removeDashboardFixtures(DASH_FIXTURE);` at the end of this case's `finally` as in step 4.

Pitfalls: daysAgo must stay well above 1 (a member joined today has no member row); never pass the seed users to the crafted calls; do not move the fixtures into the shared top-level beforeAll (the earlier cases of the file count members and must not see them, and each sweep re-creates its own after those cases have run). If, after the fixtures, an assertion later in either case fails, do not weaken it: read why, add the missing crafted row if it is data (an aged row of the same kind via the existing dashboard-fixture helpers), and if the cause is a real product defect stop and report.

Run `pnpm exec biome check --write tests/integration/isolation.test.ts` from apps/api if the formatter reorders anything, re-run the verify command, then commit only this file: `git add apps/api/tests/integration/isolation.test.ts`, message `fix(quick-261019-jia): the 08.7 dashboard isolation sweeps craft their own aged rows`, no Co-Authored-By trailer, do not push.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social/apps/api && pnpm exec vitest run tests/integration/dashboard-snapshot.test.ts tests/integration/isolation.test.ts && pnpm exec biome check tests/integration/isolation.test.ts tests/integration/dashboard-snapshot.test.ts</automated>
  </verify>
  <done>Both files are green together (85/85 at planning time: 19 + 66); the two sweeps keep their titles and every original assertion, and gain `labBody.members.count > 0` and `labRow` defined; `grep -v '^[[:space:]]*//' apps/api/tests/integration/isolation.test.ts | grep -c agedDashboardMember` is at least 6 (definition plus five call sites); `grep -v '^[[:space:]]*//' apps/api/tests/integration/isolation.test.ts | grep -c 'removeDashboardFixtures('` is at least 4 (beforeAll, afterAll and the two finally blocks); `psql` shows zero `iso87-%` rows in auth.users and public.email_allowlist after the run; one commit touches only isolation.test.ts.</done>
</task>

<task type="auto">
  <name>Task 3: prove seed-age independence and run the acceptance gates (no source change)</name>
  <files>scratch only, never committed: a shell script and logs in the session scratchpad directory (for example /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/840e776b-bd40-4501-ae6b-052fa08bfa46/scratchpad)</files>
  <precondition>Tasks 1 and 2 are committed and the two-file run is green; the local database is the same-day reset+seed and is NOT reset here.</precondition>
  <action>
Three gates, in this order. This task writes no repo file and creates no commit.

A. Seed-age independence (the brief's "proof"). A rolled-back transaction cannot be used: the API and the test fixtures use their own connections and would never see uncommitted rows. Instead back-date the seed's committed rows by an exactly invertible shift and restore them in the same shell run. Write a small bash script in the scratchpad that (1) records `min(joined_at), max(joined_at)` of public.memberships and `min(created_at), max(created_at)` of public.feed_posts via psql (host 127.0.0.1, port 54322, user postgres, password postgres, database postgres) into a "before" file; (2) installs an EXIT trap that applies the inverse shift and records the same four values into an "after" file; (3) applies the shift: `update public.memberships set joined_at = joined_at - interval '3 days'` and `update public.feed_posts set created_at = created_at - interval '3 days'`, each restricted to `tenant_id in (select id from public.tenants where slug in ('rede-demo','rede-lab'))`; (4) from apps/api runs `pnpm exec vitest run tests/integration/dashboard-snapshot.test.ts tests/integration/isolation.test.ts` into a log. Do not shift stories (their 24 h window is exactly what broke the earlier attempt) and do not touch scripts/seed.ts. At planning time this shifted 20 memberships and 65 posts, both files passed, and before/after matched to the microsecond. Confirm the "before" and "after" files are identical and that no row has a `joined_at` three days old afterwards; if the restore ever fails, re-run the inverse shift by hand (`+ interval '3 days'`) before doing anything else, and never leave the database aged. Record the command, the counts and the green result in the SUMMARY (written but not committed) as the documented re-run recipe.

B. Static gates, from apps/api: `pnpm lint` (biome check .) and `pnpm typecheck` (tsc --noEmit), or the equivalent `pnpm --filter @rede-social/api lint` / `typecheck` from the repo root.

C. Full integration run. From apps/api start `pnpm test:integration` in the BACKGROUND (run_in_background) redirecting stdout and stderr to a log in the scratchpad (for example jia-integration.log); it does not filter on extra arguments and takes about 5-8 minutes, so do not poll it, wait for the completion notice and then read the tail. Expected: `Tests  1396 passed (1396)` and email-allowlist.test.ts at 13/13 (re-run `pnpm exec vitest run tests/integration/email-allowlist.test.ts` alone to see its 13 passed). If something outside the three target tests fails, first check for residue (`select email from auth.users where email like 'iso87-%' or email like 'dash87%'`) and for the seed-drift causes in the project notes (UAT rows left in the database); do not run `supabase db reset`; if the failure is a real product defect or cannot be tied to the fixtures, stop and report with the log path.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social/apps/api && pnpm lint && pnpm typecheck && pnpm exec vitest run tests/integration/email-allowlist.test.ts && grep -E "Tests +1396 passed \(1396\)" /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/840e776b-bd40-4501-ae6b-052fa08bfa46/scratchpad/jia-integration.log</automated>
  </verify>
  <done>The aged-seed run of the two files is green and the before/after seed timestamps are identical (database not left aged); lint and typecheck pass for apps/api; the full integration log shows 1396 passed (1396) with email-allowlist.test.ts 13/13; `git status --short apps scripts` shows no change besides the two committed test files (scripts/seed.ts untouched); the SUMMARY records the recipe, the numbers and the log path.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test harness -> local Supabase (adminSql, GoTrue admin) | superuser-ish fixture writes and real auth users on the developer machine and in CI; never reaches production |
| crafted fixtures -> later suites of the same run | rows left in rede-demo / rede-lab change counts other suites assert |
| seed-age proof -> shared local database | the proof mutates committed seed timestamps temporarily |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jia-01 | Tampering | aged fixture identities left in rede-demo / rede-lab (a crashed case) shifting member counts of later suites | medium | mitigate | removeDashboardFixtures(DASH_FIXTURE) in each sweep's finally and the file's afterAll, a prefix sweep (`iso87`) in the isolation beforeAll, the snapshot file's existing prefix sweep; Task 3 greps auth.users for `iso87-%` / `dash87%` after the full run |
| T-jia-02 | Information disclosure | weakening the two-tenant isolation gate while editing it (a vacuous pass certifies a guarantee that stopped existing) | high | mitigate | no assertion removed or relaxed; positive controls become non-vacuous (`labBody.members.count > 0`, `labRow` defined); crafted demo ids are created before the leak lists are read so the "names no rede-demo id" loops cover them |
| T-jia-03 | Spoofing | fixture accounts with the shared seed password signing in | low | accept | local stack and CI only; accounts are created through authAdmin().createUser (allowlisted by the 261018-owq choke point) and deleted with their allowlist rows by removeIdentitiesByPrefix |
| T-jia-04 | Tampering | the aged-seed proof leaves the seed backdated | medium | mitigate | exactly invertible `+/- interval '3 days'` shift, EXIT trap restoring it, before/after min/max compared, manual inverse shift documented; no db reset, no stories shifted |
| T-jia-05 | Denial of service | the full integration run starves or collides with another local process on the same stack | low | accept | single sequential run (`fileParallelism: false`), run in the background and read when finished |
</threat_model>

<verification>
Coverage audit (every source item mapped):
- GOAL (brief): Deploy API gate green with 1396/1396 -> Tasks 1-3 (Task 3 full run).
- REQ INSIGHT-07 -> Task 1 (members KPI case) and Task 2 (owner overview); INSIGHT-06 -> Task 2 owner sweep (admin-only reads, wrong host, bare 404 on foreign ids); INSIGHT-18 -> Task 2 (both sweeps keep their positive controls and negatives).
- RESEARCH: none for a quick task; the builder SQL (`20261018222405_dashboard_members_functions.sql`, `20261018225848_dashboard_activity_functions.sql`, `20261019003131_dashboard_content_functions.sql`) was read to derive the windows.
- CONTEXT / brief constraints: own aged fixtures per test (Tasks 1-2); no weakening (Task 2 adds assertions only); seed.ts and product code untouched (Task 3 git status gate); allowlist for auth users via authAdmin().createUser (Task 2 helper); seed-age proof documented (Task 3 A); lint + typecheck (Task 3 B); full suite 1396/1396, email-allowlist 13/13 (Task 3 C); no push, no docs commit, explicit-path commits without trailer (Tasks 1-2).
No item is unplanned; no deferred idea is included.

Phase checks: the three previously failing tests pass on the same-day seed and on the 3-day-aged seed; `git log --stat -2` shows exactly the two test files; `git diff --stat HEAD~2 HEAD -- scripts packages supabase apps/api/src` is empty.
</verification>

<success_criteria>
- `pnpm exec vitest run tests/integration/dashboard-snapshot.test.ts tests/integration/isolation.test.ts` is green from apps/api.
- Full `pnpm test:integration` reports 1396/1396 with email-allowlist.test.ts 13/13.
- Seed-age independence is demonstrated by the reversible 3-day shift (documented in the SUMMARY) and the database is not left aged.
- `pnpm --filter @rede-social/api lint` and `typecheck` pass.
- Two commits (one per test file), explicit paths, prefix `fix(quick-261019-jia)`, no trailer, nothing pushed, no docs artifact committed.
</success_criteria>

<output>
Create `.planning/quick/261019-jia-fix-3-time-dependent-08-7-dashboard-inte/261019-jia-SUMMARY.md` when done (written, NOT committed: the orchestrator commits PLAN/SUMMARY/STATE), including the seed-age re-run recipe, the before/after timestamps and the full-run log path.
</output>
