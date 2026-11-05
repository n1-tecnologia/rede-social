---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 08
subsystem: database
tags: [native-app, schema, moderation, reports, member-block, store-policy, rls, pgtap, D-616, tracer, blocking-schema]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-07 app.account_anonymise (replaced here) and the soft-state marker columns; 13-06 native device tokens"
provides:
  - "public.content_reports and public.member_blocks kernel tables, one select policy each, no write policy"
  - "app.content_report_create / content_report_resolve / member_block_create / member_block_delete (tenant-pinned definers) and app.is_blocked_by_viewer (security invoker, stable)"
  - "SQLSTATEs RP001, RP002, RP004, BL001; REPORT_* vocabularies in @rede-social/contracts/moderation"
  - "app.account_anonymise now deletes the member's blocks in both directions and nulls the notes of reports they filed"
affects: [13-14, 13-20]

plan_head_before: bf7aee3b36c80b9c4b2ad5aa6dc4589c08af7ce4
actuals:
  tokens: 22000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "kernel table with ONE select policy and writes only through tenant-pinned definers (no insert/update/delete policy)"
    - "viewer-scoped predicate as a security invoker function over an owner-only select policy, so the answer is false for everyone but the blocker"
    - "pgTAP DML probe (pg_temp.try_dml) that answers rows changed or -1 on 42501, to prove a lane changes nothing without caring which of RLS or privilege stopped it"
    - "identifier carried to another lane in a transaction-local setting (set_config) when that lane cannot read the row"

key-files:
  created:
    - packages/core/db/schema/content-reports.ts
    - packages/core/db/schema/member-blocks.ts
    - supabase/migrations/20261105152832_reports_blocks.sql
    - supabase/migrations/meta/20261105152832_snapshot.json
    - supabase/migrations/20261105152916_reports_blocks_functions.sql
    - supabase/migrations/meta/20261105152916_snapshot.json
    - supabase/tests/223-reports-blocks.sql
  modified:
    - packages/contracts/src/moderation.ts
    - packages/core/db/schema/index.ts
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "content_report_resolve answers a report that does not exist (or is another tenant's) with RP002, not a new RP003: the plan's SQLSTATE list stays exact and the HTTP meaning is the same 404 as a missing subject. RP003 is deliberately unused and said so in the file header."
  - "content_report_resolve returns (subject_type, subject_id, author_user_id) so plan 14 can call the kernel removal / block path in the SAME transaction; the function itself removes and blocks nothing (proved)."
  - "An unknown subject type given to content_report_create is 22023, not RP002 (a malformed call, not a missing subject); an unknown reason falls to the table CHECK (23514)."
  - "No foreign key on author_user_id or resolved_by_user_id (the evidence outlives people, the moderation_log reason); reporter_user_id, blocker and blocked cascade with the identity; tenant_id cascades."
  - "member_blocks uses a composite primary key (tenant_id, blocker_user_id, blocked_user_id), no surrogate id."
  - "Reporting does not apply feed visibility (a 'followers' post of someone the reporter does not follow can be reported by uuid): ids are unguessable and the plan asks only for tenant scope and the live predicate."

patterns-established:
  - "Two generated-style migrations from drizzle-kit (generate --name, then generate --custom --name) so journal and snapshots stay in sync; a later task may extend the custom file while it is still unapplied anywhere but local."

requirements-completed: [NATIVE-31, NATIVE-33]

coverage:
  - id: D1
    description: "Tracer: a member reports another member's comment, the reporter and the tenant's admin read it and nobody else, the same statements from tenant B read and write nothing, and the member blocks that author with is_blocked_by_viewer true for the blocker only; one generated migration carries both tables"
    requirement: "NATIVE-31"
    verification:
      - kind: integration
        ref: "supabase/tests/223-reports-blocks.sql (facts 2, 3 and 5; 147 assertions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Report rules: RP001 own content, RP002 missing / deleted / foreign subject, 23505 duplicate, 42501 blocked / deleted / claim-less callers, snapshot of author and 280-code-point excerpt (emoji never split), note 500 accepted and 501 refused, admin-only resolve to exactly one of three states with RP004 on a second resolve and nothing removed"
    requirement: "NATIVE-31"
    verification:
      - kind: integration
        ref: "supabase/tests/223-reports-blocks.sql#facts 1, 2 and 4"
        status: pass
    human_judgment: false
  - id: D3
    description: "Block rules: idempotent create, no-op delete, BL001 for self / staff / foreign tenant / blocked / deleted / unknown / null target, blocker's row invisible to the blocked member, a third member and the admin, a block of tenant A is no block in tenant B"
    requirement: "NATIVE-33"
    verification:
      - kind: integration
        ref: "supabase/tests/223-reports-blocks.sql#fact 5"
        status: pass
    human_judgment: false
  - id: D4
    description: "Anonymisation cleanup: a due member's blocks are deleted in both directions and the notes of their reports nulled, in that tenant only; plan 07's 97 assertions still pass"
    requirement: "NATIVE-33"
    verification:
      - kind: integration
        ref: "supabase/tests/223-reports-blocks.sql#fact 6 and supabase/tests/222-account-deletion.sql (pnpm supabase test db: 57 files, 3548 tests, PASS)"
        status: pass
      - kind: other
        ref: "pnpm db:generate and pnpm db:generate:central print 'No schema changes'; db-two-databases.sh --reset applied 162 tenant migrations; --assert-no-platform ok"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 08: Reports and member blocks data model and SQL rules Summary

**The minimum report and block slice the store policies require, as two kernel tables with one select policy each and five tenant-pinned functions: a member reports a post or comment, only the reporter and the tenant's admin can read the report, and a member's block is visible to the blocker alone.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-11-05T15:20:00Z
- **Completed:** 2026-11-05T16:00:00Z
- **Tasks:** 3 (tracer, TDD, blocking schema gate)
- **Files modified:** 10 (two of them generated snapshots)

## Accomplishments

- `content_reports` (reason, status, note and excerpt CHECKs, the `open` iff unresolved CHECK, the unique `(tenant_id, reporter_user_id, subject_type, subject_id)`, the admin queue's keyset index) and `member_blocks` (composite key, self-block CHECK) exist in ONE generated expand-only migration, with exactly two `CREATE POLICY` (both `FOR SELECT`) and no write policy. `git diff -U0` of `moderation.ts` shows only added lines.
- `app.content_report_create` resolves the subject in the caller's tenant with the live predicate, refuses the caller's own content (`RP001`) and a missing / deleted / foreign subject (`RP002`), snapshots the author and `left(text, 280)` (characters, so an emoji is whole or dropped, never half), and leaves a duplicate to the unique key (23505).
- `app.content_report_resolve` is `admin_tenant` only, live admin only, takes the row `for update`, moves `open` to one of three states once (`RP004` after), and writes the resolver and `now()` once. It removes and blocks nothing; it returns the subject and the author at report time for plan 14's same-transaction removal.
- `app.member_block_create` refuses (`BL001`) a self, staff, foreign-tenant, blocked, deleted, unknown or null target, is idempotent, and `app.member_block_delete` lifts only the caller's own block. `app.is_blocked_by_viewer` is `security invoker` and `stable`: true for the blocker only; the blocked member, a third member, the admin and a lane with no claim read false or nothing.
- `app.account_anonymise` replaced in the functions migration (plan 07's body verbatim plus the two statements): blocks deleted in both directions, report notes nulled, scoped by the locked row's tenant. Plan 07's file is untouched.
- `223-reports-blocks.sql`: 147 assertions, every negative beside a positive control, two tenants plus a third for the direct CHECK writes, and the same identity in both tenants for the isolation facts.

## Task Commits

1. **Task 1: [tracer] tables, contract vocabularies, generated migration and the five definers** - `476b82b3` (feat)
2. **Task 2 RED: failing pgTAP proof** - `875d7d02` (test)
3. **Task 2 GREEN: anonymisation extension** - `d6c800a7` (feat)
4. **Task 3: [BLOCKING schema] gate** - no files; ran against the committed state (below)

**Plan metadata:** the docs commit that carries this summary.

## Tracer proof (Task 1)

Before the pgTAP file existed, a throwaway transaction (scratchpad, rolled back, not committed) exercised the whole slice: tenant A member reported another member's comment (report id returned, the reporter reads 1 row), blocked that author (`true`, `is_blocked_by_viewer` true); the blocked member read 0 reports, 0 blocks and `false` for the predicate; the admin of A read 1; the admin of tenant B read 0; a member of B reporting A's comment got `RP002` and blocking A's member got `BL001`. The committed pgTAP file proves the same and far more.

## TDD Gate Compliance

- RED commit `875d7d02` (`test(13-08)`) precedes GREEN commit `d6c800a7` (`feat(13-08)`). No refactor commit. The tracer commit `476b82b3` came first, as the plan orders it (Task 1 is the tracer, Task 2 the TDD proof of the whole).
- RED evidence: `pnpm supabase test db supabase/tests/223-reports-blocks.sql` exited 1, `Failed 4/147 subtests`, failing 138-140 and 147. The TAP lines (143 `ok`, 4 `not ok`) were taken from a `psql` replay of the same file (the CLI prints only failure summaries), written with the `# tests / # pass / # fail` summary of the real counts into a record kept in the scratchpad, outside the repo; `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`, target `fact 6 (NATIVE-33): the removed member's blocks are deleted in both directions`, which failed with `have: 2, want: 0`). The other three failures are the same fact 6 group (the same-tenant control count, the report note, the function body). Everything else already passed, because Task 1 carried the five functions.
- An earlier replay of the file failed on wrong literal ids in my own fixtures (`...0401` instead of the helper's `...04a1`); that was a test-authoring error fixed before the RED commit and is not RED evidence.
- GREEN: the same file passed 147 of 147; `pnpm supabase test db 000 223 222 154`: 4 files, 293 tests, PASS.

## [BLOCKING schema] gate results (Task 3)

- `pnpm db:generate` and `pnpm db:generate:central`: "No schema changes, nothing to migrate".
- Whole `pnpm supabase test db`: **57 files, 3548 tests (3401 before plus the 147 of this plan), Result: PASS.** This includes `010-rls-coverage` and `040-schema-conventions` picking up the two new tables with no enumeration change, and `154-moderation-log` (the previous 2-orphan-row failure) passing after the single `pnpm db:reset` and `pnpm db:seed` run in Task 1.
- `bash scripts/db-two-databases.sh --reset`: the tenant set applied 162 migrations from scratch (`20261105152832` and `20261105152916` last); `--assert-no-platform`: "ok: no platform schema and no central ledger in rede_tenant_b".
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core --filter=@rede-social/contracts --filter=@rede-social/api`: 3 successful; `pnpm --filter @rede-social/web exec tsc --noEmit`: clean (the web typecheck was run directly, not through turbo, to avoid a Next build on this machine). `packages/core/tests/tenant-set-no-platform.test.ts` (3) and the contracts `moderation.test.ts` (27) pass.
- `git status --porcelain supabase/central` prints nothing; no applied migration file changed.
- The two generated file names: `supabase/migrations/20261105152832_reports_blocks.sql` (generated, EXPAND-ONLY header added by hand) and `supabase/migrations/20261105152916_reports_blocks_functions.sql` (hand-written through `drizzle-kit generate --custom`, journal and snapshot in sync).
- Disk: 7.1 GiB free at the start, 8.3 to 8.4 GiB after; no `.turbo` cache entry (`TURBO_CACHE=local:r`), no `.next` and no large artefact was created.

## Files Created/Modified

- `packages/core/db/schema/content-reports.ts`, `member-blocks.ts` - the tables, CHECKs, keys, index and select policies; `index.ts` exports both
- `packages/contracts/src/moderation.ts` - `REPORT_SUBJECT_TYPES`, `REPORT_REASONS`, `REPORT_STATUSES`, `REPORT_RESOLUTIONS`, `REPORT_NOTE_MAX` (500), `REPORT_EXCERPT_MAX` (280) and the docblock paragraph naming what Phase 11 appends (added lines only)
- `supabase/migrations/20261105152832_reports_blocks.sql`, `20261105152916_reports_blocks_functions.sql` (+ snapshots, journal)
- `supabase/tests/223-reports-blocks.sql` - the pgTAP proof

## Decisions Made

See `key-decisions` above. D-616 stays `reversible` as the plan recorded it: both tables are new, unreferenced by shipped code, and the vocabularies are CHECK lists later phases append to.

## Phase 11 split (D-616, stated so it is not planned twice)

This plan delivers, in the database, the Phase 11 requirement ids **MODER-05** in part (reports of posts and comments, the resolve with its three outcomes, the admin's read of the queue by status and keyset) and **CHAT-07** in part (the member block, unblock and the blocker's content predicate). Still Phase 11: stories, communities and direct messages as report subjects (append values to `content_reports_subject_type_chk` and `REPORT_SUBJECT_TYPES`), the block's effect on messaging, follow and the profile message button, and everything in the admin queue beyond what plan 14 and plan 20 build.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] One `db:reset`, not two**
- **Found during:** Task 3
- **Issue:** The run rule allows `db:reset` at most once; Task 1 used it (and cleared the known `154-moderation-log` residue). Task 3's verify command lists a second one.
- **Fix:** The final `account_anonymise` replacement was applied to the running local database by replaying the committed tail of the functions file through `psql`; the from-scratch proof of the committed files is `bash scripts/db-two-databases.sh --reset` (162 tenant migrations from nothing) plus `--assert-no-platform`, and the whole pgTAP suite ran against the running database whose function body is byte-identical to the committed file. Same adjustment 13-07 made.
- **Files modified:** none
- **Verification:** both commands above and the whole pgTAP suite passed.

**2. [Rule 1 - Bug] Wrong fixture literals in the first draft of the test**
- **Found during:** Task 2 RED
- **Issue:** several literal subject ids in `223-reports-blocks.sql` did not match the helper functions that created the rows, so the first replay reported spurious RP002 failures.
- **Fix:** literals corrected before the RED commit; plan count 147 confirmed against the real run.
- **Files modified:** `supabase/tests/223-reports-blocks.sql`
- **Committed in:** `875d7d02`

---

**Total deviations:** 2 auto-fixed (1 blocking gate adjustment, 1 test bug). The `RP002`-for-a-missing-report choice (instead of a new `RP003`) is a design decision, recorded above, not a deviation from a stated requirement.

**Impact on plan:** None on behaviour.

## Issues Encountered

- The local database had no `pgtap` extension installed outside the CLI's own run, so the psql replay for the RED record needed `create extension pgtap` first; it was dropped again afterwards so the local state is as it was.
- A block-count control in fact 6 initially read 4 instead of 2 in the RED run, which is the correct RED symptom (the cleanup was absent), and 2 after GREEN.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-13-21 (identity leakage) is mitigated and proven by fact 3 (the author, a third member, support, the admin of tenant B and a claim-less lane read no report; the reporter reads exactly their own rows) and fact 5 (the blocked member, a third member and the admin read no block row, and the predicate is false for them). T-13-22 (cross-tenant and self actions) is mitigated and proven by facts 0, 2, 4, 5 and 6 (no insert / update / delete from a member or admin lane, `RP001`, `RP002`, `BL001`, same user ids in two tenants, tenant B's rows byte-identical after tenant A's anonymisation). T-13-23 (abuse) is mitigated: one report per reporter and item (23505), staff cannot be blocked (`BL001`), and a resolve of `content_removed` or `author_blocked` removes and blocks nothing by itself (fact 4). Rate limiting of the routes stays plan 14's.

One note for review, not a flag: the report definer does not apply feed visibility, so a member who learns the uuid of a `followers`-only post of someone they do not follow can report it. Ids are unguessable and the plan asks for tenant scope plus the live predicate; plan 14 may add a visibility check on the route if the product wants it.

## User Setup Required

None. Deploy order for hosted environments stays migration, then API, then worker. Nothing was pushed or applied to a hosted project.

## Next Phase Readiness

- Plan 14 (routes): map `RP001` to a 409/422 `OWN_CONTENT`, `RP002` to 404, `RP004` to 409 `ALREADY_RESOLVED`, `BL001` to 422 `INVALID_TARGET`, 23505 to 409 `ALREADY_REPORTED`, 22023 to 400. Call `app.content_report_resolve` and, for `content_removed` / `author_blocked`, the existing kernel removal / block paths (with their `moderation_log` row) in the SAME transaction, using the three columns the resolve returns. Add `app.is_blocked_by_viewer(author_user_id)` to the feed read paths. Read the admin queue from `content_reports` under the admin lane: index `(tenant_id, status, created_at desc, id desc)`.
- Plan 20 (screens): `reason` values are the five of `REPORT_REASONS`; the optional note is 500 characters; the member never sees who reported or blocked.
- No Postgres-side rate limiting exists (plan 14's).

## Self-Check: PASSED

- Files exist: both Drizzle schema files, both migrations, both snapshots, `223-reports-blocks.sql`, `moderation.ts` (checked with `ls`).
- Commits found: `476b82b3`, `875d7d02`, `d6c800a7`; `git rev-list --count` from the recorded base is 3.
- Acceptance criteria: two `*_reports_blocks*.sql` files; `grep -c "CREATE POLICY"` in the generated file is 2 and it holds no `FOR INSERT/UPDATE/DELETE`; `git diff -U0` of `moderation.ts` shows only added lines; the test greps count 45 (`RP001|RP002|RP004|BL001`, at least 8) and 29 (`42501`, at least 5); `git diff --stat` of plan 07's functions migration prints nothing; `git status --porcelain supabase/central` is empty; `git status --porcelain supabase/migrations` showed only the two new `.sql` files, their snapshots and the journal before commit.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
