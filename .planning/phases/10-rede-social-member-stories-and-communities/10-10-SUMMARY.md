---
phase: 10-rede-social-member-stories-and-communities
plan: 10
subsystem: testing
tags: [isolation, seed, social-switch, rollout, tracer, D-718, D-701, D-702, D-705, MPUB-05, MPUB-07, T-10-37, T-10-38, T-10-39, T-10-40]

requires:
  - phase: 10-06
    provides: "the communities read contract (kind, createdBy, viewer, memberQuota) and the organization-only order"
  - phase: 10-08
    provides: "the Explorar authors routes and the first phase 10 sweep case"
  - phase: 10-09
    provides: "the highlight owner seam and the caller-scoped catalog"
provides:
  - "scripts/seed.ts: one member community and one live member story in rede-lab, owned by the plain lab member, idempotent and self-healing"
  - "isolation sweep: two phase 10 member cases (communities and posts, stories and highlights) with lab positive controls, unknown-id equality and wrong-host 403, and the inventory entries of every route the phase touched pointing at them"
  - "the social off and on matrix end to end (describe '10 social switch', five ordered cases) and the registry pins against the seed module sets"
  - "two correctness fixes the matrix found: a creator's community edit and highlight writes are 403 while social is off inside the flags-cache window"
  - "docs/DEPLOY.md: the Phase 10 go-live paragraph, the Phase 10 release section (eight expand-only migrations, the web-first A7 exception, the communities window, the open items) and the Phase 10 facts in the three module READMEs"
affects: [10-11, 10-12, 10-13, 10-14, 10-15]

actuals:
  tokens: 21800
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "A fixture a suite counts against is set aside (soft delete) for the file's run and restored in afterAll; the seed heals a left-over soft delete on its next run"
    - "A write that RLS gates only on INSERT asks app.social_enabled() itself inside the service for the member branch, so the 30 s flags-cache window cannot reach it"

key-files:
  created: []
  modified:
    - scripts/seed.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/admin-lane-inventory/scripts.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/social-module.test.ts
    - apps/api/tests/integration/member-communities.test.ts
    - apps/api/tests/integration/member-stories.test.ts
    - apps/api/tests/integration/communities.test.ts
    - apps/api/tests/unit/registry.test.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/stories/server/service.ts
    - docs/DEPLOY.md
    - packages/modules/communities/README.md
    - packages/modules/stories/README.md
    - packages/modules/feed/README.md

key-decisions:
  - "The seeded member community and story belong to member@rede-lab.local (the lab member nobody follows): every other lab member is a reader or author in the earlier suites"
  - "The member suites that count member communities and stories soft-delete the seed rows for their run and restore them, instead of each assertion filtering them out; the seed upserts so a crashed run heals"
  - "The creator's edit, archive and delete of a member community and the creator's highlight writes ask app.social_enabled() inside the service (the update gate and the highlight tables carry no social term), after the non-curator 403"
  - "The plan's registry wording 'absent for every other role' is exact for the two community keys only: stories.story.publish is also the admin's own through the stories manifest, so the pin says admin yes, support no"
  - "EP-53's literal 'empty second database' was NOT run: it needs db:two --reset --bare, which was not authorized; the evidence is the authorized db:reset (all 181 files from empty) and the unchanged second database"

patterns-established:
  - "A phase sweep describe holds one it() per route family, each titled 'phase 10 sweep: <family> ...', and the inventory entries name that title"
  - "Moderator actions that write moderation_log rows are cleaned by a scoped subject-id delete with session_replication_role = replica (append-only table)"

requirements-completed: [MPUB-05, MPUB-07]

coverage:
  - id: D1
    description: "Tracer (MPUB-07, D-718): the seed carries one member community and one live member story in rede-lab (idempotent, healing), rede-demo stays with social off, and a demo session cannot list, open, edit, delete, post into or read any of it nor the stories, highlights, history, catalog and order of its member, each beside the lab positive control, the same bytes as an unknown id and a wrong-host 403"
    requirement: MPUB-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 10 sweep: member communities and their posts, phase 10 sweep: member stories and highlights"
        status: pass
      - kind: command
        ref: "pnpm db:seed twice, count(communities where kind = 'member') = 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every route the phase mounted or whose guard changed has an isolation inventory entry naming a phase 10 sweep case; removing one entry turns the unit check red (EP-52)"
    requirement: MPUB-07
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts (136 api unit tests); throwaway removal of GET /v1/stories/authors made 'every mounted route is classified' fail and was reverted"
        status: pass
    human_judgment: false
  - id: D3
    description: "MPUB-05 / D-718 matrix: social on, then off with a warm cache (every member write 403, never 500), off with the cache expired (reads stay, like and comment work, loose member stories and the authors routes are gone, the moderator keeps working with log rows), then on again with no row changed"
    requirement: MPUB-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-module.test.ts#10 social switch (cases 1-4)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-701 / D-702 / D-705 re-asserted once as a whole: a stranger's story read is the bare 404, a member-community post is in no Inicio, Explorar or Reels Todos, a non-owner publish is 403 for a member, an admin and a support user"
    requirement: MPUB-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-module.test.ts#10 social switch case 5"
        status: pass
    human_judgment: false
  - id: D5
    description: "Registry pins against the seed module sets: the member keys are composed for role member only with social and the owning module effective, and permissionsFor is pure"
    requirement: MPUB-05
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#26, #27"
        status: pass
    human_judgment: false
  - id: D6
    description: "EP-53 / EP-55: the tenant migration set applies from empty (db:reset) and a repeated fan-out is a no-op; the literal empty second database proof was not run (not authorized)"
    requirement: MPUB-07
    verification:
      - kind: command
        ref: "pnpm db:reset; pnpm db:two (applied 0, skipped 181); pnpm db:migrate-all -- --dry-run; pnpm db:migrate-all twice (applied 0, skipped 181 both times)"
        status: pass
    human_judgment: true
    rationale: "The empty second database (db:two --reset --bare) needs the developer's word; the local db:reset evidence and the no-op re-runs are in place"
  - id: D7
    description: "docs/DEPLOY.md carries the go-live paragraph, the Phase 10 release order with the web-first A7 exception and the open items; the module READMEs carry the Phase 10 facts"
    requirement: MPUB-07
    verification:
      - kind: command
        ref: "the plan's Task 3 verify chain (db:two, db:migrate-all --dry-run, greps) and apps/api/tests/unit/module-readmes.test.ts"
        status: pass
    human_judgment: true
    rationale: "The wording of the release order and the open items is the developer's to read and settle"

duration: about 55min
completed: 2026-11-11
status: complete
plan_head_before: a89f701237b039321aebfcd85d036114ea7cb8cd
commits: 6
---

# Phase 10 Plan 10: The Backend Proof Summary

**The seed now carries a member community and a member story in rede-lab, every route the phase touched is in the two-tenant inventory with a lab positive control and a wrong-host 403, the `social` off and on matrix is proven end to end (and found and closed two writes that survived `social` off inside the flags-cache window), and DEPLOY.md carries the go-live paragraph, the eight-migration release order with the one web-first exception and the open items.**

## Performance

- **Duration:** about 55 minutes of work; two full integration runs of about 20 minutes each ran in the background (estimate 180000 tokens; realized diff about 21800 on the chars/4 scale)
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3 (Task 1 is the tracer; its automated verify passed before Tasks 2 and 3: `Tracer verified end-to-end, expanding`)
- **Files:** 0 created, 15 modified

## Accomplishments

- **Tracer (Task 1):** `scripts/seed.ts` writes, for rede-lab only, one member community (`kind = 'member'`, position 1000000, active, with a slug) and one live member story (`visibility = 'followers'`, 24 hours) owned by `member@rede-lab.local`, with their own `story` image asset. The upsert heals a soft-deleted or renamed row and renews the story window, so a re-run adds nothing and fails nothing. The sweep `describe('phase 10 sweep (10-10)')` has two cases that ask each of the phase's routes the isolation question with both demo sessions (member and admin): communities (list, detail, create, edit, delete, the organization-only order, a post naming the community) and stories (story by id, delete, memberships, highlight row and detail, create, rename, reorder, save, take out, delete, two publish destinations, the history, the catalog and the authors group). Every crossing is a bare 404 equal to the same call on an unknown id (no `requestId` aside), nothing is written or moved, every lab positive control answers, and the wrong host is 403 in both directions.
- **Switch matrix (Task 2):** `describe('10 social switch')` runs five ordered cases on rede-lab. It found two real gaps (below). The registry pins are cases 26 and 27 of `registry.test.ts`.
- **Proofs and docs (Task 3):** see the proofs and the documentation sections.

## Task Commits

1. **Task 1 RED:** `6f5a6642` (test): the two phase 10 sweep cases, red because the seed row was absent (`the seed carries the lab member community`).
2. **Task 1 GREEN:** `6e0c67f7` (feat): the seed, the inventory entries, the admin-lane inventory (two new `withAdminTx` sites of the seed), the two seed-pinned fixes in `isolation.test.ts`.
3. **Task 2 RED:** `0c7b7e92` (test): the switch matrix, the registry pins, the member suites setting the seeded rows aside; red on `edit a community (warm cache): 200` and `create a highlight (warm cache): 201`.
4. **Task 2 GREEN:** `3eb5ee88` (fix): the two creator writes ask `app.social_enabled()`.
5. **Task 3:** `95688bd3` (docs): DEPLOY.md and the three module READMEs.
6. **Seed follow-through:** `84b383d4` (test): `communities.test.ts` counts and orders the organization set beside the seeded member community.

**Plan metadata:** this SUMMARY is committed separately. `.planning/STATE.md` and `.planning/ROADMAP.md` were not touched. Nothing was pushed and no hosted project was touched. No commit carries a `Co-Authored-By` trailer or tool attribution.

## Migration proofs (EP-53, EP-55, T-10-39)

The eight migrations of the phase, all expand-only (`ls supabase/migrations`, after `20261110163941_profile_form_professional_id_guard.sql`):

```
20261111143858_member_communities_functions.sql   (hand-written, sorts before the next on purpose, EP-54)
20261111143948_member_communities.sql
20261111144148_feed_community_audience.sql
20261111144205_feed_member_update_allowlist.sql   (hand-written)
20261111145716_member_stories.sql
20261111150352_story_media_gate.sql               (hand-written)
20261111151218_moderation_member_content.sql      (hand-written)
20261111163020_member_stories_authors.sql         (one index)
```

- **From empty:** `pnpm db:reset` (authorized, run twice in this plan) applied all 181 files to a fresh local project through the Supabase runner, the central set through `db:central`, and `pnpm supabase test db` was green on it (65 files, 4473 tests). The ledger of the local project holds the eight versions.
- **`pnpm db:two`** (no flags): `{"summary":true,"set":"tenant","dryRun":false,"applied":0,"skipped":181,"pending":0}`. The second database already carried the whole set (the integration suites call `ensureSecondDatabase` first), so this run is the no-op re-run, not the first apply. **The literal "apply to an EMPTY second database" (`db:two --reset --bare`) was not run: that drops `rede_tenant_b`, which was not authorized. It is the one sub-proof of EP-53 left to the developer.**
- **`pnpm db:migrate-all -- --dry-run`:** central `skipped 12, pending []`; project `local` `status current, skipped 181, pending []`; summary `projects 1, current 1, failed 0`. Only the project `local` exists in `platform.projects` (api_url on 127.0.0.1), so the fan-out reaches nothing else.
- **`pnpm db:migrate-all` twice (EP-55):** both runs `applied 0, skipped 181, head 20261111163020, ledgerCount 181`; the ledger holds each of the eight versions once.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] A creator's edit, archive and delete of a member community survived `social` off inside the cache window**
- **Found during:** Task 2 (the matrix, case 2: `edit a community (warm cache): 200`)
- **Issue:** `communities_member_update_gate` has no `social` term (only the INSERT gates have `app.social_enabled()`), so with the flags cache still warm after the switch the route guard let the creator through. The plan and D-718 say every member write is 403 (T-10-38).
- **Fix:** `assertMayWriteCommunity` asks `app.social_enabled()` for the creator branch (a moderator with `manage` returns before it and is never judged by `social`).
- **Files modified:** `packages/modules/communities/server/service.ts` | **Commit:** `3eb5ee88`

**2. [Rule 2 - Missing critical functionality] A creator's highlight writes survived `social` off inside the cache window**
- **Found during:** Task 2 (`create a highlight (warm cache): 201`)
- **Issue:** the highlight tables carry no `social` term either; the seam of plan 09 trusted the cached `canPublish`.
- **Fix:** `resolveHighlightPlace` asks `app.social_enabled()` for the write intents of a member community, after the non-curator 403 (so it adds no answer for anyone else). Both fixes keep the units green (communities 73, stories 202).
- **Files modified:** `packages/modules/stories/server/service.ts` | **Commit:** `3eb5ee88`

**3. [Rule 3 - Blocking] Seed-pinned tests broke on the new rows; the seed owner and a set-aside pattern**
- **Issue:** five earlier suites assume "no member community, no member story" (`member-stories` 5, 3 and 4 over the plain member and the moderator's circles; `member-communities` six list and order cases; `communities.test.ts` 7 and 46 over the lab's four; `isolation.test.ts` b8 and the Phase 8 order). The `member-communities` sweep also deleted the seeded community by creator.
- **Fix:** `member-communities` and `member-stories` soft-delete the seeded rows for their run (and spare the community in their sweep) and restore them in `afterAll`; `communities.test.ts` and the two `isolation.test.ts` cases filter to the organization set and to organization stories; the seed upsert heals a left-over soft delete. The owner is the lab member nobody follows.
- **Files modified:** `apps/api/tests/integration/member-communities.test.ts`, `member-stories.test.ts`, `communities.test.ts`, `isolation.test.ts`, `scripts/seed.ts` | **Commits:** `6e0c67f7`, `0c7b7e92`, `84b383d4`

**4. [Rule 3 - Blocking] The admin-lane inventory counts every `withAdminTx` site outside tests, the seed included**
- **Fix:** the two new sites of the seed are two more rows in the `seedMemberProfile` group (23 to 25).
- **Files modified:** `apps/api/tests/admin-lane-inventory/scripts.ts` | **Commit:** `6e0c67f7`

**5. [Plan wording] The registry pin "absent for every other role" is exact for the two community keys only**
- `stories.story.publish` is the admin's own through the stories manifest (the organization publishes stories). Case 26 pins admin yes and support no for it, and both community keys member-only.

**6. [Plan wording] The moderator's story delete with `social` off**
- Per the dispatch note (pgTAP 231 section 3 against D-718) the plan's "story delete keeps working" is split in the matrix: a story held by a community highlight is deleted by the moderator (204, `story_removed` row); a loose member story is the bare 404 (pinned, with a comment). Recorded as an open item in DEPLOY.md; the gate was not changed.

**7. [Plan wording] Eight migrations, not four to seven; the post delete answers 200**
- The phase ships eight migrations (listed above); the post delete route answers 200 with a body, not 204 (the matrix asserts 200).

**Total deviations:** 7 (Rule 2 x2, Rule 3 x2, plan-wording x3). **Impact:** two security-adjacent window gaps closed with 19 lines of service code; no scope change.

## Issues Encountered

- `pnpm supabase test db` case 154 trips on moderation-log residue after a full integration run (anchors of removed members; none of the rows are this plan's, which deletes its own by subject id). A `pnpm db:reset && pnpm db:seed` cleared it and pgTAP was green again (known gotcha: run pgTAP before the integration files).
- A full integration run after the first fixes left the module-flag rows of rede-lab `communities` and `stories` absent (the suites' restore deletes a row that had none when captured); a final `pnpm db:seed` wrote them back (`communities f`, `notifications f`, `social t`, `stories f`), the state found at dispatch.
- `pnpm --filter @rede-social/module-stories lint` fails on `packages/modules/stories/db/schema.ts` (a Biome format nit in a line added by plan 08, outside this plan). Left alone (scope boundary); `deferred` below.
- The flaky pin in `232-feed-community-audience.sql` test 56 and the `LegacyDbSetupError` on reset did not come up.

## Deferred

- `packages/modules/stories/db/schema.ts` Biome format of the `stories_tenant_author_expires_idx` index (one multi-line `.on(...)`), predates this plan.

## Known Stubs

None added. `app.community_action_allowed` stays the intentional constant-false Escopo seam.

## Threat Flags

None beyond the plan's register. T-10-37 (the two phase 10 sweep cases and the inventory unit check), T-10-38 (the matrix with a warm cache, and the two service fixes above), T-10-39 (the proofs above, with the one sub-proof left), T-10-40 (the release order in DEPLOY.md).

## Open items handed to Igor

1. **EP-53 literal:** run `bash scripts/db-two-databases.sh --reset --bare` then `pnpm db:two` once to see the whole tenant set apply to an EMPTY second database (not authorized here).
2. **The release order (DEPLOY.md, Phase 10 release):** web before the API for the story wire (A7), and the communities screens fail between the two deploys (the previous web and the new API disagree on three required keys); making `kind`, `createdBy` and `viewer` optional in the web's contract removes the window (one line, not made).
3. **Open decisions recorded, not decided:** a creator can reactivate a community a moderator archived (OQ-3); a moderator cannot read or delete a LOOSE member story with `social` off; the dashboard counts of member stories and communities before `social` is enabled on a real tenant; the D-478 legal wording for communities; the A9 reading of the member story video cap.
4. The `member-communities` and `member-stories` suites now set the seeded rows aside; if either file is killed mid-run, `pnpm db:seed` restores them.

## Verification

- `pnpm supabase test db` after the final `db:reset` and `db:seed`: 65 files, 4473 tests, PASS (run before the integration files).
- Integration: the whole `tests/integration` directory ran twice with the seed in place (141 files). Run 1: 139 files green, two failing files (the member authors cases and my new matrix, both fixed). Run 2: 140 green, one file (`communities.test.ts`, two cases) fixed in `84b383d4`; after the fix `isolation`, `social-module`, `member-communities`, `member-stories`, `communities` and `stories` ran together green: 6 files, 321 tests.
- Units through turbo with `TURBO_CACHE=local:r --concurrency=4`: `typecheck` and `test` for `@rede-social/api` (136), `@rede-social/module-stories` (202) and `@rede-social/module-communities` (73) pass; Biome clean for the api and communities packages and the seed; `pnpm boundaries` clean. `apps/web` was not touched and its known red spots (plans 11 and 12) are as before.
- Acceptance: `grep "phase 10 sweep"` in `isolation.test.ts`, `grep "/v1/stories/authors"` in the inventory, `count(communities where kind = 'member') = 1` after two seed runs, `grep "10 social switch"`, `grep authorUserId`, `grep "Phase 10"`, `grep A7`, `grep OQ-3`, `grep "Ativar a Rede social"` all pass.
- Module flags of the local rede-lab tenant checked before the integration runs and after the final seed: `communities f`, `notifications f`, `social t`, `stories f`; no `Teste 10-10` rows left.

## Self-Check: PASSED

- FOUND: `scripts/seed.ts` (`SEED_MEMBER_COMMUNITY`), `apps/api/tests/integration/isolation.test.ts` (`phase 10 sweep (10-10)`), `apps/api/tests/integration/social-module.test.ts` (`10 social switch`), `apps/api/tests/unit/registry.test.ts` (cases 26 and 27), `docs/DEPLOY.md` (`Phase 10 release`), `10-10-SUMMARY.md`
- FOUND commits: `6f5a6642`, `6e0c67f7`, `0c7b7e92`, `3eb5ee88`, `95688bd3`, `84b383d4`
- `commits: 6` measured with `git rev-list --count a89f7012..HEAD` before this SUMMARY commit; no `Co-Authored-By` trailer and no tool attribution in any commit of the plan; no path under `.planning/sketches/`, `STATE.md` or `ROADMAP.md` staged
