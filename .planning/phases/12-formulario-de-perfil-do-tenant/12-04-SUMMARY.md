---
phase: 12-formulario-de-perfil-do-tenant
plan: 04
subsystem: database
tags: [profile-form, schema, rls, gate-function, guard-trigger, pgtap, drizzle, D-585, D-587, D-588, D-591, D-593, D-594, tracer, blocking-schema]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 02 module key profile_form (tenant_modules_key_chk widened) and plan 03 PROFILE_FORM_TYPES / PROFILE_FORM_CHOICE_TYPES / PROFILE_FORM_LIMITS in @rede-social/contracts/profile-form"
  - phase: 09.1-acesso-por-gateway-de-pagamento
    provides: "the app.access_state / _gated lookup pair that the _gate twins extend"
provides:
  - "tables public.profile_form_questions and public.profile_form_answers under RLS (Drizzle exports profileFormQuestions, profileFormAnswers)"
  - "app.profile_form_missing(tenant, membership), app.profile_form_missing_self(), app.membership_in_tenant_gate(user, tenant), app.memberships_of_user_gate(user)"
  - "BEFORE UPDATE trigger profile_form_questions_guard raising SQLSTATE PF001..PF005"
  - "member_profiles.profile_form_notice_dismissed_at (nullable) and moderation_log_action_chk widened by profile_form_exported"
  - "pgTAP file 220 sections 2 to 8 (205 assertions in total with plan 02's section 1)"
affects: [12-05, 12-06, 12-07, 12-08, 12-09, 12-10, 12-14, 12-17, 12-18, profile-form]

actuals:
  tokens: 29800
  tasks: 3
  commits: 2
plan_head_before: e534d0d8c319d2bc55254609aa6e8292b079303c

tech-stack:
  added: []
  patterns:
    - "A table CHECK built from a contract list (type in PROFILE_FORM_TYPES, choice types in PROFILE_FORM_CHOICE_TYPES), the tenant_modules_key_chk trick, compared as an ordered array by pgTAP"
    - "Completeness is a pure SQL anti-join behind a single CASE with ordered short circuits (module row, role, partial index, unique-index probes); no flag, counter or per-type SQL"
    - "A successor *_gate function pair beside the untouched *_gated pair, so a still-serving API revision keeps working during the fan-out"
    - "Guard trigger as SECURITY DEFINER with a custom SQLSTATE per rule, so the 'has answers' probe is independent of the editing session's RLS"

key-files:
  created:
    - packages/core/db/schema/profile-form-questions.ts
    - packages/core/db/schema/profile-form-answers.ts
    - supabase/migrations/20261029232606_profile_form_tables.sql
    - supabase/migrations/20261029233037_profile_form_functions.sql
    - supabase/migrations/meta/20261029232606_snapshot.json
    - supabase/migrations/meta/20261029233037_snapshot.json
  modified:
    - packages/core/db/schema/index.ts
    - packages/core/db/schema/member-profiles.ts
    - packages/core/db/schema/moderation-log.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/220-profile-form.sql

key-decisions:
  - "The generated tables migration is 20261029232606_profile_form_tables.sql and the hand-written one is 20261029233037_profile_form_functions.sql; both sort after plan 02's 20261029230924_profile_form_module_key.sql. The existing _gated pair and 20261020225255_access_gate_functions.sql are untouched."
  - "The read policies fail closed for a null or unknown role claim (questions select, answers self and public select add app.tenant_role() in the three real roles), so the PFORM-08 'null role reads nothing from both tables' truth holds for reads as well as writes"
  - "TRUNCATE is revoked from authenticated on both tables in the functions migration: Supabase default privileges hand it to every lane and RLS does not see it"
  - "Deferred follow-up kept from the plan: dropping the old _gated pair is a later cleanup migration after the API calling _gate has been live for one release (08.1-05 precedent); to be repeated in plan 18's release notes"

patterns-established:
  - "pgTAP fixtures for a whole feature live in one file with a 22000000- id prefix, one tenant per concern (A and B for policies, C empty, D for the gate rule and the trigger) so counts never collide"
  - "Section order in a rollback-only pgTAP file: sections that delete memberships or identities go LAST"

requirements-completed: [PFORM-03, PFORM-05, PFORM-08, PFORM-09, PFORM-17, PFORM-18, PFORM-22, PFORM-25]

coverage:
  - id: D1
    description: "profile_form_questions and profile_form_answers exist with the planned columns, named constraints and indexes, RLS on, exactly ten named policies, no privilege for anon; the type CHECK lists the thirteen types in the contract's order"
    requirement: PFORM-05
    verification:
      - kind: integration
        ref: "supabase/tests/220-profile-form.sql sections 2 and 3 (pnpm supabase test db)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every policy is proven from two tenants with a positive control: admin, support, member and a null/unknown/no-claims lane read and write only what D-593 allows; a foreign question is refused by the composite foreign key"
    requirement: PFORM-08
    verification:
      - kind: integration
        ref: "supabase/tests/220-profile-form.sql section 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "An answered question cannot be deleted (RESTRICT, 23503), an unanswered one can; an answer goes with its membership and with its identity; the dismissal column is nullable with no backfill; the widened moderation log CHECK accepts profile_form_exported"
    requirement: PFORM-22
    verification:
      - kind: integration
        ref: "supabase/tests/220-profile-form.sql section 5"
        status: pass
    human_judgment: false
  - id: D4
    description: "app.profile_form_missing returns the count of active required questions without an answer row, 0 for module off, staff, another tenant, a soft-deleted membership and no required question; the _gate twins return the _gated columns plus the count; the session variant derives the membership from the claims"
    requirement: PFORM-09
    verification:
      - kind: integration
        ref: "supabase/tests/220-profile-form.sql section 6"
        status: pass
      - kind: other
        ref: "EXPLAIN ANALYZE on 20,000 members x 30 answers + 200,000 other rows: complete member 0.056 ms cold / 0.027 ms warm, module off 0.008 ms"
        status: pass
    human_judgment: false
  - id: D5
    description: "The guard trigger raises PF001..PF005 on an answered question and allows the same edits on a never-answered one, plus title, required, position, archive, adding options, widening limits and public to private"
    requirement: PFORM-17
    verification:
      - kind: integration
        ref: "supabase/tests/220-profile-form.sql section 7"
        status: pass
    human_judgment: false
  - id: D6
    description: "Function grants and hardening: the rule and the twins are not executable by anon or authenticated, the _self variant is, all five are SECURITY DEFINER with an empty search_path, authenticated has no TRUNCATE on either table"
    requirement: PFORM-08
    verification:
      - kind: integration
        ref: "supabase/tests/220-profile-form.sql section 8"
        status: pass
    human_judgment: false
  - id: D7
    description: "The migration set is expand-only and applies from scratch: both drizzle-kit sets say No schema changes, db:reset + seed + the whole pgTAP suite (53 files, 3125 tests) pass, the two-database lane applies 155 tenant files and --assert-no-platform passes, the workspace gate is green"
    requirement: PFORM-25
    verification:
      - kind: other
        ref: "pnpm db:generate; pnpm db:generate:central; pnpm db:reset; pnpm db:seed; pnpm supabase test db; bash scripts/db-two-databases.sh --reset; --assert-no-platform; TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4 (41 tasks)"
        status: pass
    human_judgment: false
  - id: D8
    description: "An older API revision still serving during the hosted fan-out keeps calling the untouched _gated functions and is unaffected by the new tables"
    requirement: PFORM-25
    verification: []
    human_judgment: true
    rationale: "PFORM-25 edge concurrency: only the hosted rollout (Igor's) can confirm; no automated test reproduces a mixed-revision fan-out"

duration: 13min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 04: Profile form data model Summary

**Two tenant tables with per-operation RLS (self, staff, public-flagged), a RESTRICT foreign key and a guard trigger that keep answers by construction, and one SQL rule `app.profile_form_missing` carried by new `_gate` lookup twins; measured at 0.056 ms for a complete member on 800,000 answer rows.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-29T23:24:10Z
- **Completed:** 2026-10-29T23:37:00Z
- **Tasks:** 3 (1 tracer, 2 auto; Task 3 is a verification gate with no files of its own)
- **Files modified:** 11 (5 created, 6 modified; 2 of them snapshots)

## Accomplishments

- Tracer across the layer: a question written by an `admin_tenant` is read by a member of the same tenant, a member's answer is written and read back by her only, and the same statements from the other tenant read and write nothing (pgTAP section 4, 205 assertions in the file).
- D-593 holds as a database fact: six answer policies (self select, staff select, public-flagged select, self insert, update, delete) and no inheritance of the tenant-wide `member_profiles_tenant_select`; staff never write answers; the composite foreign key refuses a foreign question (23503) and the `with check` ties user and tenant to a live membership.
- D-588 holds as a database fact: `ON DELETE RESTRICT` on the composite key, so an answered question cannot be deleted by anyone; an unanswered one can; answers cascade with the membership and with the identity (D-594).
- D-585 holds as SQL: `app.profile_form_missing` is one `case` with ordered short circuits and no stored completeness; the `_gate` twins return it in the lookup's own statement; the old `_gated` pair is untouched.
- D-587 holds as a trigger: PF001 type, PF002 answered option removed or relabelled, PF003 Outro turned off, PF004 private to public, PF005 limit narrowed, each proven on an answered and a never-answered question.
- Gate rule measured (Task 3): see Performance of the rule below.

## Performance of the rule (T-12-10)

Throwaway rolled-back temp tables outside the repo, with the proposed indexes: tenant with 30 required questions and 20,000 members x 30 answers, plus 10 other tenants (200,000 answers), 800,000 answer rows in all.

| Case | Planning | Execution | Limit |
|---|---|---|---|
| Complete member, module on, 30 required answered (cold) | 0.179 ms | **0.056 ms** | under 5 ms |
| Same, warm | 0.081 ms | 0.027 ms | under 5 ms |
| Tenant with the module off | 0.048 ms | **0.008 ms** | under 1 ms |

## Task Commits

1. **Task 1: [tracer] the two tables, policies, CHECKs, dismissal column, widened log CHECK, pgTAP sections 2 to 5** - `7ec512f2` (feat)
2. **Task 2: the pending-count rule, the `_gate` twins and the guard trigger, pgTAP sections 6 to 8** - `3a2ab049` (feat)
3. **Task 3: [BLOCKING schema] drift, full pgTAP, two-database lane, typecheck, benchmark** - no commit (verification only; the plan lists no file this task changes)

**Plan metadata:** committed after this file (docs: complete plan).

Generated file names: `supabase/migrations/20261029232606_profile_form_tables.sql` (drizzle-kit, once) and `supabase/migrations/20261029233037_profile_form_functions.sql` (`--custom`).

## Files Created/Modified

- `packages/core/db/schema/profile-form-questions.ts` - the questions table, its seven CHECKs, two indexes, four policies
- `packages/core/db/schema/profile-form-answers.ts` - the answers table, composite RESTRICT foreign key, unique and count indexes, value size CHECK, six policies
- `packages/core/db/schema/index.ts`, `member-profiles.ts`, `moderation-log.ts` - exports, the dismissal column, the widened action CHECK and its docblock
- `supabase/migrations/20261029232606_profile_form_tables.sql` (+ snapshot, journal) - generated, expand-only
- `supabase/migrations/20261029233037_profile_form_functions.sql` (+ snapshot, journal) - hand-written functions, trigger, grants
- `supabase/tests/220-profile-form.sql` - pgTAP sections 2 to 8 (plan 205)

## Decisions Made

See `key-decisions`. In short: read policies fail closed on a null or unknown role; TRUNCATE is revoked from `authenticated`; the guard is a definer function; the `_gated` drop stays a deferred follow-up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Read policies did not fail closed on a null or unknown role**
- **Found during:** Task 1 (writing the null-role lane test required by the PFORM-08 empty truth)
- **Issue:** the plan's policy predicates (`tenant_id = app.tenant_id()` with `archived_at is null`, and the self and public answer reads) would let a session with a valid tenant but a null or unknown role claim read active questions and its own answers, contradicting the must-have "a session with no claims or a null role reads and writes nothing from both tables".
- **Fix:** added `app.tenant_role() in ('admin_tenant','support_tenant','member')` to the questions select, answers self select and answers public select. Policy names and the set of policies are as planned.
- **Files modified:** `packages/core/db/schema/profile-form-questions.ts`, `profile-form-answers.ts` (migration regenerated before it was ever committed; the first generated file was discarded and regenerated once with the final schema)
- **Verification:** pgTAP section 4 null role, unknown role (`owner`) and no-claims lanes read zero rows from both tables
- **Committed in:** `7ec512f2`

**2. [Rule 2 - Missing critical] TRUNCATE reachable by the tenant lane**
- **Found during:** Task 1 exposure checks (`has_table_privilege('authenticated', ..., 'truncate')` was true on both tables)
- **Issue:** Supabase default privileges hand `authenticated` TRUNCATE on every public table and RLS does not see it, so a tenant session could empty every tenant's answers (T-12-06). Same lesson as `20261009084554_store_admin_write_truncate.sql`.
- **Fix:** `revoke truncate ... from authenticated` on both tables, placed in the hand-written functions migration (drizzle-kit cannot model grants); pgTAP section 8 asserts it.
- **Files modified:** `supabase/migrations/20261029233037_profile_form_functions.sql`, `supabase/tests/220-profile-form.sql`
- **Verification:** pgTAP section 8, "authenticated holds no TRUNCATE on either table"
- **Committed in:** `3a2ab049`

**3. [Plan item restated] The migration-is-data-free truth is proven statically, not by a row count**
- **Found during:** Task 1 (PFORM-25 edge empty)
- **Issue:** a pgTAP row-count of the two tables would fail whenever a later integration suite leaves residue in the shared local database; the file also inserts its own fixtures.
- **Fix:** the claim rests on the migrations holding DDL only (no insert, update or delete statement), plus the plan-02 assertion that no `tenant_modules` row was created and pgTAP section 5's check that an existing profile's dismissal reads null.
- **Files modified:** none beyond the test file
- **Committed in:** `7ec512f2`

---

**Total deviations:** 2 auto-fixed (both Rule 2), 1 restated proof.
**Impact on plan:** both fixes tighten security (T-12-06) and match the stated truths; no scope creep, no change to table shape or policy names.

## Issues Encountered

- A first `drizzle-kit generate` was run before the fail-closed tightening; the file, its snapshot and the journal entry were discarded and generated once more with the final schema (two runs before commit, one migration committed). `supabase migration up` had already applied the discarded version locally, which the required `pnpm db:reset` cleared.
- `pnpm supabase test db` over the whole suite was green (53 files, 3125 tests) on a freshly reset and seeded database, so the known `154-moderation-log.sql` residue failure did not appear. pgTAP was run before any integration suite, as required.
- One scratch copy of a SQL file was briefly written to `/tmp` instead of the scratchpad; it was moved into the repo file and nothing remains there.

## Known Stubs

None.

## Threat Flags

None. The new surface is exactly the one in the plan's threat register: T-12-06 and T-12-07 (policies, composite key, `with check`), T-12-08 (rule not executable by `authenticated`, `_self` variant), T-12-09 (guard trigger plus RESTRICT) and T-12-10 (measured above) are mitigated and each has a pgTAP assertion. The TRUNCATE revoke closes a path the register did not name.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched; the hosted tenant projects receive the migrations through `migrateAll` on the next release.

## Next Phase Readiness

- Plan 05 can switch `membershipInTenant` / `membershipsOfUser` to `app.membership_in_tenant_gate` / `app.memberships_of_user_gate`; the new column is `profile_form_missing integer`.
- Plan 08's services map PF001 to PF005 to coded 409s and check the same rules first; the answer upsert target is the unique index `profile_form_answers_member_question_uq`.
- Plan 16 can read and write `member_profiles.profile_form_notice_dismissed_at`.
- Plan 18's release notes must carry the deferred follow-up: drop `app.membership_in_tenant_gated` and `app.memberships_of_user_gated` in a later cleanup migration once the API that calls `_gate` has been live for one release.
- PFORM-25 edge concurrency (an older API revision during the fan-out) is confirmed only by the hosted rollout, which is Igor's. Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*

## Self-Check: PASSED

- Created files exist: both schema files, both migrations, both snapshots, `supabase/tests/220-profile-form.sql`.
- Commits `7ec512f2` and `3a2ab049` exist; `git rev-list --count e534d0d8..HEAD` is 2 before this commit.
- Acceptance re-run: one `*_profile_form_tables.sql` and one `*_profile_form_functions.sql`; the tables file holds `ON DELETE restrict` and `profile_form_notice_dismissed_at`; `git diff --stat` for migrations lists only new files, snapshots and the journal; `20261020225255_access_gate_functions.sql` has no diff; `grep -c throws_ok` of the pgTAP file is 48 and `grep -c 23503` is 4; the file has 17 lines with PF001 to PF005; `git status --porcelain supabase/central` is empty.
- Plan verification: both drizzle-kit sets print "No schema changes"; `pnpm db:reset && pnpm db:seed && pnpm supabase test db` PASS (53 files, 3125 tests); two-database lane applied 155 tenant files and `--assert-no-platform` printed ok; `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` 41 of 41 tasks successful.
