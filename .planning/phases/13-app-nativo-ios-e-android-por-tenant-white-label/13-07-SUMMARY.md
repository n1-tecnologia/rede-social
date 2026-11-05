---
phase: 13-app-nativo-ios-e-android-por-tenant-white-label
plan: 07
subsystem: database
tags: [native-app, schema, account-deletion, anonymisation, lgpd, rls, pgtap, D-609, D-610, tracer, blocking-schema]

requires:
  - phase: 13-app-nativo-ios-e-android-por-tenant-white-label
    provides: "13-06 native device tokens in push_subscriptions and app.push_subscriptions_for_v2 (the live-member read the request is proved against); 13-03 REMOVED_MEMBER_NAME"
provides:
  - "memberships.deletion_requested_at, deletion_due_at, anonymised_at, deletion_cancelled_until and CHECK memberships_deletion_chk"
  - "app.account_deletion_request(): own request, reuses deleted_at, 14-day deadline, AD001 for the last admin under row locks, idempotent"
  - "app.account_deletion_cancel(tenant, user, token_iat): fresh token only, deadline re-checked under for update, parks the old deadline"
  - "app.account_deletion_notice_take(): the parked deadline, read once"
  - "app.account_deletion_due(limit): passed deadlines only, ordered, clamped 1..500"
  - "app.account_anonymise(membership): in-place, idempotent, never deletes a content row"
affects: [13-13, 13-19]

plan_head_before: 2f35221e9f0d5f99a35a281637554a3a668839c5
actuals:
  tokens: 16000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "reuse the shipped soft state (deleted_at) plus a marker column instead of a new predicate, so every live-member filter deactivates the member for free"
    - "lock the whole active-admin set in id order before reading anything (same order for every admin, no deadlock) and refuse the last one with a custom SQLSTATE"
    - "cancel and anonymise take the same row lock and re-check the same deadline, so the race has exactly one outcome"
    - "two-tenant negative by hashing every touched table of the other tenant before and after, with a positive control that the hash moves when the same call runs for that tenant"

key-files:
  created:
    - supabase/migrations/20261105150240_account_deletion.sql
    - supabase/migrations/meta/20261105150240_snapshot.json
    - supabase/migrations/20261105150248_account_deletion_functions.sql
    - supabase/migrations/meta/20261105150248_snapshot.json
    - supabase/tests/222-account-deletion.sql
  modified:
    - packages/core/db/schema/memberships.ts
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "The member's e-mail for the retained rows is read from public.users BEFORE any scrub, and only tenant-scoped rows are touched: a grant or event of ANOTHER tenant that carries the same address is left alone (proved in fact 8)."
  - "Placeholders for NOT NULL e-mail columns are `removed-<row id>@removed.invalid` (unique per row, lower-case, satisfies the lower(btrim()) CHECKs and the unique indexes); nullable columns (payment_events.email, consent_records.ip and user_agent) are set to null."
  - "public.users (global e-mail and name) is NOT scrubbed by account_anonymise: it is the global identity mirror and a user can hold memberships in other tenants (shared project in dev/CI). Plan 13's job decides, per the Auth soft delete, when no other live membership remains."
  - "The avatar media_assets row is marked status deleted, deleted_at set, filename blanked; the storage object itself is the API job's (plan 13), since only the job can remove a file."

patterns-established:
  - "Hand-written function migration from drizzle-kit generate --custom so journal and snapshot stay in sync"
  - "Fixture helper functions in pg_temp (u, m, t, tenant_hash) keep a 97-assertion two-tenant file readable"

requirements-completed: [NATIVE-19, NATIVE-20, NATIVE-21]

coverage:
  - id: D1
    description: "Request deactivates a member at once (deleted_at plus marker plus deadline requested + 14 days), is idempotent, refuses blocked, moderation-deleted, foreign-tenant and claim-less callers, and leaves the other tenant's rows identical"
    requirement: "NATIVE-19"
    verification:
      - kind: integration
        ref: "supabase/tests/222-account-deletion.sql#fact 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "Last administrator refused with AD001 (a blocked and a deleted admin do not count), allowed with a second active admin, two admins one after the other leave exactly one"
    requirement: "NATIVE-19"
    verification:
      - kind: integration
        ref: "supabase/tests/222-account-deletion.sql#fact 2"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cancel only with a token issued after the request and before the deadline, moderation soft-delete never restored, old deadline parked and read once; the cancel-versus-anonymise pair resolves to one outcome in both orders"
    requirement: "NATIVE-20"
    verification:
      - kind: integration
        ref: "supabase/tests/222-account-deletion.sql#facts 3, 5 and 6"
        status: pass
    human_judgment: false
  - id: D4
    description: "Due list and in-place anonymisation: boundary one second either side, profile reads Membro removido, answers and devices gone, retained purchase, grant, event, consent and invite rows lose the e-mail, posts, comments and membership stay, second call returns false, two-tenant negative with positive control"
    requirement: "NATIVE-21"
    verification:
      - kind: integration
        ref: "supabase/tests/222-account-deletion.sql#facts 4, 7 and 8 (pnpm supabase test db: 56 files, 3401 tests, PASS)"
        status: pass
      - kind: other
        ref: "pnpm db:generate and pnpm db:generate:central print 'No schema changes'; db-two-databases.sh --reset applied 160 tenant migrations; --assert-no-platform ok"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-11-05
status: complete
---

# Phase 13 Plan 07: Account deletion data model and SQL rules Summary

**"Excluir minha conta" as four nullable `memberships` columns and five tenant-pinned definers: a request that reuses the shipped soft state and a 14-day deadline, a cancel that only a token issued after the request can make, a last-administrator refusal (`AD001`) under row locks, and an in-place anonymisation that keeps every post and comment as "Membro removido".**

## Performance

- **Duration:** 17 min
- **Started:** 2026-11-05T14:58:00Z
- **Completed:** 2026-11-05T15:15:00Z
- **Tasks:** 3 (tracer, TDD, blocking schema gate)
- **Files modified:** 7 (two of them generated snapshots)

## Accomplishments

- `memberships` gained `deletion_requested_at`, `deletion_due_at`, `anonymised_at` and `deletion_cancelled_until` (nullable, no default, no backfill) and `memberships_deletion_chk`, in ONE generated expand-only migration. `git diff -U0` of `memberships.ts` shows only added lines.
- `app.account_deletion_request()` derives tenant and user from the claims only, locks an admin's whole active-admin set in id order before anything else, refuses the last administrator with `AD001`, and otherwise sets `deleted_at`, `deletion_requested_at` and `deletion_due_at = now() + interval '14 days'` in one statement. A second call returns the same deadline and rewrites nothing. The requester leaves `app.push_subscriptions_for_v2` at once with no new predicate.
- `app.account_deletion_cancel` is executable by the connection role and `service_role` only; it restores only a row that carries the marker, only while `deletion_due_at > now()`, only for `p_token_iat > deletion_requested_at`, and parks the old deadline for `app.account_deletion_notice_take`, which returns it once.
- `app.account_deletion_due` and `app.account_anonymise` (connection role and `service_role` only). The anonymisation re-checks the deadline under `for update`, takes `tenant_id` from the locked row in every statement, and never deletes a post, a comment, a counter, an order, a grant or the membership.
- `222-account-deletion.sql`: 97 assertions, every negative beside a positive control, two tenants plus a third for the last-admin rule.

## Task Commits

1. **Task 1: [tracer] columns, request, cancel, notice** - `bfc105ae` (feat)
2. **Task 2 RED: failing pgTAP proof** - `c097e8bc` (test)
3. **Task 2 GREEN: due list and anonymisation** - `8ea35cd6` (feat)
4. **Task 3: [BLOCKING schema] gate** - no files; ran against the committed state (below)

**Plan metadata:** the docs commit that carries this summary.

## TDD Gate Compliance

- RED commit `c097e8bc` precedes GREEN commit `8ea35cd6` (`test(13-07)` then `feat(13-07)`). No refactor commit.
- RED evidence: the file was replayed through `psql -At -v ON_ERROR_STOP=1` in the local database (the CLI prints only failure summaries; psql prints the real TAP). Real exit code 3 (the file stops at the first call of the then-missing `app.account_deletion_due(integer)`), 33 `ok` and 6 `not ok` before the stop. Target test `fact 0: the five deletion functions exist and are SECURITY DEFINER with search_path pinned to ""` failed on its assertion (two of the five functions did not exist yet). The TAP lines were copied verbatim into a record kept in the scratchpad, outside the repo, and `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`).
- GREEN: the same file passed 97 of 97 on the first run after the function bodies were applied; `pnpm supabase test db 000-helpers 222 221` reported 158 tests, PASS. The first RED draft declared `plan(86)`; the real count is 97 and was corrected in the GREEN commit.

## Privacy inventory (assumption A-13-01, Igor's review)

Source: `information_schema.columns` over `public` for text, jsonb and inet columns whose name suggests a person, plus every table carrying a user or membership id. One decision per column.

| Table.column | Decision |
|---|---|
| member_profiles.display_name | scrubbed to the constant `Membro removido` |
| member_profiles.bio | scrubbed (null) |
| member_profiles.avatar_asset_id | scrubbed (null) |
| media_assets.status, deleted_at, filename (owner's `avatar` purpose rows) | scrubbed: status `deleted`, `deleted_at` set, filename null; the storage object is the job's |
| profile_form_answers (all columns, `value` carries Instagram and the other free text) | row deleted |
| push_subscriptions (endpoint token, user_agent, keys) | row deleted |
| access_grants.email | scrubbed to `removed-<id>@removed.invalid`; the row stays |
| tenant_invites.email (by user id or by the same address) | scrubbed to the same placeholder; the row stays |
| payment_events.email | scrubbed (null); amounts, dates and refs stay; the table stores no raw payload column |
| consent_records.ip, user_agent | scrubbed (null); kind, version and time stay as the consent proof |
| memberships (id, role, status, timestamps) | kept (author foreign keys; no personal data) |
| feed_posts.caption, feed_comments.body, stories, events and other authored content | kept, read through the profile as "Membro removido" (plan scope: content is detached, never deleted) |
| store_orders, store_entitlements, event_attendances, social_follows, community_members, chat_participants, course progress | kept (ids, amounts, dates only) |
| moderation_log.reason, excerpt, details | kept (snapshots of removed text and ids, not identities; A-13-01) |
| notifications.payload | kept (facts and excerpts of other people's content; the actor's name is read live, so it already renders "Membro removido") |
| dashboard_member_snapshots | kept (engagement bands and counters, no identity column) |

**Residual for Igor's review (not scrubbed by this plan):**

1. `public.users.email` and `public.users.name`: the global identity mirror. It still holds the address and name after `account_anonymise`. It is global (a user can hold memberships in other tenants in a shared project, where the per-tenant rule cannot erase it), so the decision belongs to plan 13's job together with the Auth admin soft delete: scrub or delete it when no other live membership remains. This is the largest open item.
2. `chat_messages.body` (the member's own messages to the support team): personal communication kept as content; no per-person scrub was agreed.
3. The Supabase Storage object of the avatar (and any other file the member uploaded): only the API job can remove a file; the DB row is marked deleted.
4. `email_allowlist.email`: a global platform list of addresses, not tenant data.
5. `dashboard_member_snapshots.insights, activity, community_bands` (jsonb engagement aggregates): ids and counts, no identity, kept; review if Igor wants them dropped.
6. Free-text moderation excerpts could repeat a person's words; plan assumption A-13-01 keeps them.

## [BLOCKING schema] gate results (Task 3)

- `pnpm db:generate` and `pnpm db:generate:central`: "No schema changes, nothing to migrate".
- Whole `pnpm supabase test db`: 56 files, 3401 tests (3304 before plus the 97 of this plan), Result: PASS. 010, 040, 146, 154, 220 and 221 are undisturbed by the new columns.
- `bash scripts/db-two-databases.sh --reset`: the tenant set applied 160 migrations from scratch (`20261105150240` and `20261105150248` last); `--assert-no-platform`: "ok: no platform schema and no central ledger in rede_tenant_b".
- `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core --filter=@rede-social/contracts --filter=@rede-social/api`: 3 successful.
- `git status --porcelain supabase/central` prints nothing; no applied migration file changed.
- The two generated files: `supabase/migrations/20261105150240_account_deletion.sql` (generated, header comment added by hand) and `supabase/migrations/20261105150248_account_deletion_functions.sql` (hand-written through `drizzle-kit generate --custom`, so journal and snapshot are in sync).
- Disk stayed at 8.5 to 8.7 GiB free; no `.turbo` cache entry, `.next` or other large artefact was created by this plan.

## Files Created/Modified

- `packages/core/db/schema/memberships.ts` - the four deletion columns and `memberships_deletion_chk` (added lines only)
- `supabase/migrations/20261105150240_account_deletion.sql` - expand-only generated migration (+ snapshot, journal)
- `supabase/migrations/20261105150248_account_deletion_functions.sql` - the five definers (+ snapshot, journal)
- `supabase/tests/222-account-deletion.sql` - the pgTAP proof

## Decisions Made

See `key-decisions` above. D-610's reversibility is as the plan recorded it: the marker, the grace column and the fresh-token rule become published behaviour with the first request. D-609 stays one-way.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] One `db:reset`, not two**
- **Found during:** Task 3
- **Issue:** The project rule for this run allows `db:reset` at most once. Task 1 consumed it (applied the first version of the functions file). The Task 3 verify command also lists `pnpm db:reset`.
- **Fix:** The GREEN function bodies were applied to the running local database by replaying the committed functions file through `psql`, and the from-scratch proof of the committed migration files is `bash scripts/db-two-databases.sh --reset` (160 tenant migrations applied from nothing) plus `--assert-no-platform`. The whole pgTAP suite ran against the running database whose function bodies are byte-identical to the committed file.
- **Files modified:** none
- **Verification:** both commands above passed; the whole pgTAP suite passed.

**2. [Rule 1 - Bug] RED test plan count**
- **Found during:** Task 2 GREEN
- **Issue:** The first draft declared `plan(86)` but contained 97 assertions.
- **Fix:** `plan(97)` in the GREEN commit; the RED evidence is unaffected (the failing target test is fact 0).
- **Files modified:** `supabase/tests/222-account-deletion.sql`
- **Committed in:** `8ea35cd6`

---

**Total deviations:** 2 auto-fixed (1 blocking gate adjustment, 1 test bug)
**Impact on plan:** None on behaviour; the schema gate is proved by the two-database from-scratch apply rather than a second `db:reset`.

## Issues Encountered

- The first throwaway psql replay failed because the `tests` schema only exists after `000-helpers.sql` has run and committed; replaying it first fixed the replay.
- pgTAP runs the whole file in one transaction, so `now()` is constant. The boundary facts (due now, one second ahead, one second past) are therefore set up by direct `update` statements on the deadline relative to `now()`, and the request path is proved separately through the function.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-13-13 (anonymising another member or one not due) is mitigated and proven by facts 0, 4 and 7 (no administrator variant, 42501 from a member lane, five not-due cases return false). T-13-14 (an old token cancelling) is mitigated and proven by facts 0, 3 and 5 (before, at and after the request instant, and at the deadline instant). T-13-15 (personal data in retained rows) is mitigated for the agreed scope and proven by fact 7; the residual items above are the part left for Igor.

## User Setup Required

None. Deploy order for hosted environments stays migration, then API, then worker. Nothing was pushed or applied to a hosted project.

## Next Phase Readiness

- Plan 13 (routes, sign-in hook, job, e-mail): map `AD001` to `LAST_ADMIN`; call `app.account_deletion_cancel(tenant, user, token_iat)` from `requireAuth` when the membership lookup finds no live membership; call `app.account_deletion_due(n)` then `app.account_anonymise(id)` per row from the job (connection role); send the completion e-mail BEFORE the Auth soft delete, and decide the `public.users` e-mail and name scrub (residual item 1) and the avatar storage object (residual item 3) in the same job.
- Plan 19 (screens): `app.account_deletion_notice_take()` is the one-time "Exclusão cancelada" source; the deadline is a `timestamptz`, format it in the tenant's time zone.
- No index on `memberships.deletion_due_at` was added (the plan names one generated migration with the columns); the job's scan runs at a low cadence over one table. Add a partial index in a later migration if the member count makes it matter.

## Self-Check: PASSED

- Files exist: both migrations, both snapshots, `222-account-deletion.sql`, `memberships.ts` (checked with `ls`).
- Commits found: `bfc105ae`, `c097e8bc`, `8ea35cd6`; `git rev-list --count` from the recorded base is 3.
- Acceptance criteria: two `*_account_deletion*.sql` files; functions file contains `account_deletion_request`, `account_deletion_cancel`, `account_deletion_notice_take`, `AD001` and `for update`; `git diff -U0` of `memberships.ts` shows only added lines; `grep -c AD001` in the test is 7 and `grep -c "Membro removido"` is 11; `delete from public.(feed_posts|post_comments)` in the functions file counts 0; `git status --porcelain supabase/central` is empty; the SUMMARY holds the privacy inventory and the residual list.

---
*Phase: 13-app-nativo-ios-e-android-por-tenant-white-label*
*Completed: 2026-11-05*
