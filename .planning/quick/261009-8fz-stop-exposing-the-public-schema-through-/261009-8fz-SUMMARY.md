---
phase: quick-261009-8fz
plan: 01
subsystem: infra
tags: [security, supabase, postgrest, data-api, config, migration, rls, defense-in-depth, deploy-doc]

requires:
  - phase: 08.2
    provides: "CR-01 of 08.2-REVIEW.md (member token + publishable key reach public through PostgREST)"
provides:
  - "Empty, grant-less schema data_api_closed (hand-written migration) as the only schema the Data API exposes"
  - "[api] block: schemas = [\"data_api_closed\"], extra_search_path = [\"extensions\"]"
  - "Live regression matrix in pnpm test:integration (20 tests) plus static [api] and database pins"
  - "docs/DEPLOY.md section 'Data API exposure (quick 261009-8fz)' and an hml runbook checkbox"
affects: [08.2, deploy, supabase-config, hml]

actuals:
  tokens: 57500    # chars/4 over the realized diff (230005 added chars; ~51 900 of it the generated drizzle snapshot, ~6 400 hand-written)
  tasks: 3
  commits: 3
plan_head_before: 4a3a249d66b8cd98c5cc8b26d4f44f49d07a32c9

tech-stack:
  added: []
  patterns:
    - "Close a Supabase surface by pointing it at a dedicated empty schema, not by an empty list or a disabled service"
    - "Gateway probes with AbortSignal.timeout(5_000) so a hang fails fast; refusals pinned by status + PostgREST code"

key-files:
  created:
    - supabase/migrations/20261009111139_data_api_closed_schema.sql
    - supabase/migrations/meta/20261009111139_snapshot.json
    - apps/api/tests/integration/data-api-not-exposed.test.ts
  modified:
    - supabase/config.toml
    - supabase/migrations/meta/_journal.json
    - docs/DEPLOY.md

key-decisions:
  - "No USAGE grant on data_api_closed: PostgREST boots (0 relations, 0 functions, no permission-denied, no PGRST002) and refuses cleanly with an owner-only schema; the DB pin asserts USAGE and CREATE false for anon, authenticated, service_role and authenticator."
  - "Pinned refusals: default profile 404 PGRST205 (tables, every method), 404 PGRST202 (RPC); public/graphql_public profile and /graphql/v1 406 PGRST106 with hint 'Only the following schemas are exposed: data_api_closed'; OpenAPI root 200 with paths ['/'] only."
  - "Missing schema (config before migration) fails closed: 503 PGRST002 in ~10 ms, and PostgREST self-heals on its next retry once the schema exists; the migration-before-config-push order is documented as required, not as a fail-open risk."

requirements-completed: [TENANT-03]

coverage:
  - id: D1
    description: "Local Data API exposes only the empty data_api_closed schema; every /rest/v1 and /graphql/v1 call with a member token or the publishable key alone is refused fast with a pinned code, and no probe writes"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/data-api-not-exposed.test.ts (20 tests)"
        status: pass
      - kind: other
        ref: "P5 curl matrix (Task 1 step 4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Static pins: [api] block, no public in any [remotes.*.api] block, schema empty with no USAGE/CREATE for the API roles"
    requirement: TENANT-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/data-api-not-exposed.test.ts#the [api] block exposes only data_api_closed and keeps public off the search path"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/data-api-not-exposed.test.ts#data_api_closed exists, holds no object and grants nothing to the API roles"
        status: pass
    human_judgment: false
  - id: D3
    description: "Auth, Storage, Realtime and the local tooling keep working with the closed config"
    verification:
      - kind: other
        ref: "pnpm supabase test db (29 files, 1126 tests)"
        status: pass
      - kind: integration
        ref: "TURBO_CACHE=local:r pnpm test:integration (56 files / 1024 tests + reuse-fixture 1/1)"
        status: pass
      - kind: e2e
        ref: "playwright login/session/logout/phase7-smoke/chat/notifications (98 passed, 4 project-gated skips)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Hosted production (and later isolated hml) gets the closed Data API through the deploy's db push then config push"
    verification: []
    human_judgment: true
    rationale: "No hosted call was allowed. That config push applies [api] to the hosted project, and the hosted refusal shapes, can only be confirmed by the developer's post-deploy dashboard check and curl proof in docs/DEPLOY.md."

duration: 24min
completed: 2026-10-09
status: complete
---

# Quick 261009-8fz: Close the Supabase Data API with a dedicated empty schema Summary

**PostgREST now exposes only `data_api_closed`, an empty schema with no grants created by a hand-written migration, and `public` is off the request search path. Every `/rest/v1` and `/graphql/v1` call fails fast with a pinned PostgREST code (404 `PGRST205`/`PGRST202`, 406 `PGRST106`). A 20-test live matrix in `pnpm test:integration` locks this in, and docs/DEPLOY.md explains how the next production deploy carries it.**

## Previous run (halted)

The first run of this quick task stopped at Task 1 step 4 and committed nothing. Neither config-only candidate worked. With `schemas = []`, PostgREST fell back to serving `public` (`/graphql/v1` answered "Only the following schemas are exposed: public"). With `enabled = false`, Kong kept its routes to a missing upstream, which hung for about 60 s on the developer's network. On 2026-10-09 the user chose option 1, "Schema vazio dedicado". This run carries it out. The halted SUMMARY was never committed (this quick dir was untracked), so overwriting it removed its full write-up. The measured A/B facts are kept in the PLAN's context section "Facts measured by the halted run" and in the reasons in the `[api]` comments, the test header and DEPLOY.md.

## Performance

- **Duration:** 24 min
- **Started:** 2026-10-09T11:10:21Z
- **Completed:** 2026-10-09T11:35:08Z
- **Tasks:** 3 of 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- A `--custom` migration `20261009111139_data_api_closed_schema.sql`:
  - runs `create schema data_api_closed` (no `if not exists`), adds a comment and runs `revoke all ... from public, anon, authenticated, service_role`;
  - creates no objects and no grants;
  - the resulting ACL is `{postgres=UC/postgres}`;
  - re-running `pnpm db:generate` reports "No schema changes".
- `[api]` in supabase/config.toml now reads `enabled = true`, `schemas = ["data_api_closed"]`, `extra_search_path = ["extensions"]`. The comments give the reason, and the `auto_expose_new_tables` comment is untouched.
- The container env reads `PGRST_DB_SCHEMAS=data_api_closed` and `PGRST_DB_EXTRA_SEARCH_PATH=extensions`.
- `apps/api/tests/integration/data-api-not-exposed.test.ts` (20 tests) covers:
  - the GoTrue positive control;
  - six tables × GET;
  - the public profile on GET and POST;
  - the publishable key alone;
  - POST, PATCH (rename, and membership self-promotion) and DELETE;
  - the RPC call;
  - GraphQL, both a query and a delete mutation;
  - the OpenAPI root;
  - the static `[api]`/remotes pin and the schema emptiness/privilege pin;
  - DB no-write invariants, with marker cleanup.
- docs/DEPLOY.md gained the "Data API exposure (quick 261009-8fz)" section, placed between the hosted auth settings and Storage buckets, and an unchecked "Data API" item in the hml runbook.

## Task Commits

1. **Task 1: audit, red test, empty-schema migration, [api] switch, boot/USAGE probe, green pin:** `63b91e0` (fix)
2. **Task 2: full probe matrix, P6, full local verification:** `e2fb121` (test)
3. **Task 3: docs/DEPLOY.md section and hml runbook checkbox:** `e5ab6ec` (docs)

`commits: 3` was measured with `git rev-list --count 4a3a249..HEAD`. None of the commits has a trailer.

## Consumer audit

G1, before any change (4 lines, all comments, identical to the baseline):
```
packages/modules/notifications/db/schema.ts:27: *    would be readable over PostgREST (RESEARCH Pattern 5).
packages/modules/notifications/db/schema.ts:126: *    from reading its own rows over PostgREST (the notifications rule, RESEARCH Pattern 5).
supabase/tests/180-store.sql:443:--     admin claim only. These lanes are exactly what PostgREST runs for a member's own token
packages/modules/store/db/schema.ts:73: * member's own token (PostgREST, or any lane that reaches SQL) do both, so SELECT stays
```
G2, before any change (7 lines, all Storage bucket calls on `storageAdmin()`, identical to the baseline):
```
apps/api/tests/integration/mux-webhook.test.ts:198:        .from('media')
apps/api/tests/integration/media.test.ts:154:    .from('media')
apps/api/tests/integration/isolation.test.ts:225:    .from('media')
apps/api/tests/integration/isolation.test.ts:2932:        if (added.length > 0) await storageAdmin().from('branding').remove(added);
apps/api/tests/integration/admin-branding.test.ts:109:  const { error } = await storageAdmin().from('branding').remove(added);
apps/api/tests/integration/profile.test.ts:122:    .from('media')
apps/api/tests/integration/platform-branding.test.ts:166:  const { error } = await storageAdmin().from('branding').remove(names);
```
G1 after the change, with `| grep -v 'data-api-not-exposed.test.ts'` appended, prints the same 4 comment lines. Nothing in apps/, packages/, scripts/, supabase/tests, supabase/seed.sql or .github is a Data API consumer.

## Red evidence (old stack, Task 1 test file)

4 tests: 1 passed, 3 failed.
- (a) GoTrue control `GET /auth/v1/user`: passed (200 with the member's id).
- (b) `GET /rest/v1/users?select=id` refused: **failed**. The status was **200** (`users_self_select`).
- (c) `[api]` pin: **failed** (`expected [ 'enabled = true', …(4) ] to include 'schemas = ["data_api_closed"]'`).
- (d) schema pin: **failed** (`expected +0 to be 1`: no `data_api_closed` namespace).

After the switch, all 4 passed. After the Task 2 expansion, 20 of 20 pass.

## USAGE outcome

**No grant.** None of the triggers fired:
- P2 showed no crash, no restart, no PGRST002 loop and no "permission denied".
- No probe answered 42501.

Case (d) pins `usage: false, create: false` for anon, authenticated, service_role and authenticator.

## Probes

- **P1:** `supabase stop` and `supabase start` both exited 0, then `pnpm db:reset` and `pnpm db:seed` both exited 0. After the reset, the migration applied under the OLD config first (production order). With the new config, a later reset was ready immediately: the first probe after `db:reset` answered 404 `PGRST205`.
- **P2**, 15 s after the reset:
  - the container reports `running 0`, with env `PGRST_DB_SCHEMAS=data_api_closed` and `PGRST_DB_EXTRA_SEARCH_PATH=extensions`;
  - the log shows "Schema cache loaded **0 Relations, 0 Relationships, 0 Functions**, 0 Domain Representations, 4 Media Type Handlers, 1196 Timezones", with no FATAL, no PGRST002 and no permission-denied line;
  - auth, storage, realtime and kong are healthy.
- **P3:** `status -o env` prints the names `ANON_KEY`, `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY` and `SERVICE_ROLE_KEY`. `bash scripts/local-env.sh` exits 0, and **scripts/local-env.sh is unchanged** (`git diff --quiet` exits 0).
- **P4:** the test file passes 4 of 4.
- **P5**, curl with the publishable key and the service key captured into variables and never echoed:

| Probe | Status | Time | Code / message |
|---|---|---|---|
| GET communities, publishable key | 404 | 0.005 s | `PGRST205` Could not find the table 'data_api_closed.communities' in the schema cache |
| same + `Accept-Profile: public` | 406 | 0.003 s | `PGRST106` Invalid schema: public; hint "Only the following schemas are exposed: data_api_closed" |
| same with the service key (apikey + bearer) | 404 | 0.007 s | `PGRST205` |
| POST rpc/handle_new_user `{}` | 404 | 0.005 s | `PGRST202` Could not find the function data_api_closed.handle_new_user without parameters |
| POST /graphql/v1 `{ __typename }` | 406 | 0.005 s | `PGRST106` Invalid schema: graphql_public; same hint |
| GET /rest/v1/ | 200 | 0.034 s | OpenAPI document, `paths` = `/` only, names none of the six tables |
| /auth/v1/health | 200 | 0.002 s | |
| /storage/v1/version | 200 | 0.002 s | |

  No probe answered 42501, and none listed `public` as exposed.
- **P6**, missing schema (`drop schema data_api_closed`):
  - After 5 s, both the default profile and `Accept-Profile: public` answered **503 `PGRST002`** "Could not query the database for the schema cache. Retrying." in 0.004 to 0.012 s.
  - After `docker restart supabase_rest_rede-social` and 15 s, the log repeated "Failed to load the schema cache using db-schemas=data_api_closed and db-extra-search-path=extensions ... 3F000 schema "data_api_closed" does not exist". Both probes still answered 503 `PGRST002` fast. The container stayed `running 0`.
  - **Fail closed**: `public` was never served.
  - After `db:reset` + `db:seed` brought the schema back, PostgREST was in a 32 s reconnect backoff, so one immediate test run saw 503. It then reloaded by itself ("Schema cache loaded 0 Relations") with no restart, and the file went back to 20 of 20.
  - Consequence for DEPLOY.md: the migration-before-config-push order is required for the Data API to answer cleanly, but a reversed order does not open `public`.

## Pinned refusal shapes (per test case)

| Case | Pinned |
|---|---|
| GET /rest/v1/{communities, feed_posts, events, memberships, tenant_modules, users}, member token | 404 `PGRST205` |
| GET communities, `accept-profile: public` | 406 `PGRST106` + hint naming only data_api_closed |
| GET communities, publishable key alone | 404 `PGRST205` |
| POST communities | 404 `PGRST205` |
| POST communities, `content-profile: public` | 406 `PGRST106` + hint |
| PATCH communities (rename), PATCH memberships (self-promotion), DELETE feed_posts | 404 `PGRST205` |
| POST rpc/handle_new_user | 404 `PGRST202` |
| POST /graphql/v1, query and `deleteFromFeedPostsCollection` mutation | 406 `PGRST106` + hint |
| GET /rest/v1/ | 200, `paths` = `['/']`, no table name in the text |

Every refusal also asserts four things:
- not 2xx;
- not a JSON array;
- no `42501` in the text;
- an answer in under 5 s (each fetch is aborted at 5 s).

## Per-suite counts (fresh reset + seed)

| Step | Result |
|---|---|
| `pnpm supabase test db` (pgTAP) | 29 files, 1126 tests, PASS (includes 010, 040, 100) |
| `TURBO_CACHE=local:r pnpm test:integration` | 56 files / 1024 tests passed; reuse-fixture 1 file / 1 test passed |
| Playwright login, session, logout, phase7-smoke, chat, notifications | 102 tests: 98 passed, 4 skipped (project-gated viewport cases: notifications 320px on mobile only, chat lg split view on desktop only), exit 0 |
| `TURBO_CACHE=local:r pnpm turbo run typecheck lint --filter=@rede-social/api` | 2/2 tasks successful |

The stack was reset and seeded between the integration run and e2e, and once more at the end.

## Files Created/Modified

- `supabase/migrations/20261009111139_data_api_closed_schema.sql`: the empty, owner-only schema, with a header explaining the invariant.
- `supabase/migrations/meta/_journal.json`, `supabase/migrations/meta/20261009111139_snapshot.json`: the drizzle journal entry and the copied snapshot.
- `supabase/config.toml`: the closed `[api]` block, with the reasons in comments.
- `apps/api/tests/integration/data-api-not-exposed.test.ts`: the live matrix, the invariants and both pins.
- `docs/DEPLOY.md`: the new section and the hml runbook item.

## Parked artifacts

`draft-data-api-not-exposed.test.ts.txt` and `candidate-b-attempt.diff.txt` were removed from the quick dir. Both were untracked, so no commit includes the deletion.

## Decisions Made

- No USAGE grant (see "USAGE outcome").
- `extra_search_path = ["extensions"]`, not `[]`, because PostgREST's default for an empty extra search path is `public`.
- The no-write invariants use a throwaway community and post that `adminSql` inserts. Snapshot counts are taken after those inserts, and `afterAll` removes every marker row and ends `adminSql`, as the sibling suites do.

## Deviations from Plan

None. The plan was executed as written. The only extra check was a readiness measurement: the first probe right after a normal `db:reset` answered 404 `PGRST205`. That means the long backoff seen in P6 happens only when the schema stays missing, so the test needed no readiness wait.

## Issues Encountered

- In P6, PostgREST's reconnect backoff (up to 32 s here) kept answering 503 `PGRST002` for a short while after the schema came back. The first single-file run after the restore failed on that, and the next run passed with no change. This is recorded in DEPLOY.md: it fails closed and self-heals.

## Threat Flags

None. The change only removes surface. The new schema is empty and owner-only, and it is pinned by T-q8fz-05.

## User Setup Required

Hosted steps for the developer, by hand: docs/DEPLOY.md "Data API exposure (quick 261009-8fz)".
- Run the curl proof before the next production deploy.
- After `deploy-api.yml` succeeds, check that Exposed schemas lists only `data_api_closed` and Extra search path lists only `extensions`.
- Run the curl proof again and do a Realtime smoke.
- Check the hml runbook item once hml is isolated.

No hosted command was run: no `--linked`, `link`, `config push`, `db push`, `gh`, `gcloud` or `vercel`, and no curl to `*.supabase.co`.

## Next Phase Readiness

- Local closure is complete and guarded by CI.
- The production rollout happens on the next `deploy-api.yml` run and needs the developer's dashboard check (coverage D4, human judgment).
- Stack state: running the final config, reset and seeded. No API, web or worker server is running.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261009111139_data_api_closed_schema.sql, supabase/migrations/meta/20261009111139_snapshot.json, apps/api/tests/integration/data-api-not-exposed.test.ts
- FOUND commits: 63b91e0, e2fb121, e5ab6ec (`git rev-list --count 4a3a249..HEAD` = 3)
- The Task 1, 2 and 3 verify gates passed. No tracked file is left modified.
