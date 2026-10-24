---
phase: quick-261024-lcq
plan: 01
subsystem: migrate-job
tags: [migrate, deploy, registry, first-release, quick]
requirements: [DBT-23, DBT-24]
status: complete
commits: 1
plan_head_before: 3c536e84c9b7d7edaa12a8bfef0acc89fccb74a7
actuals:
  tokens: 30000
  tasks: 3
  commits: 1
key-files:
  modified:
    - packages/core/server/projects/migrate.ts
  created:
    - packages/core/tests/migrate-missing-registry.test.ts
---

# Quick 261024-lcq: migrateAll applies the central set on a database that has no platform registry yet

The migrate Job no longer dies on a central database that has never had the central set. The first release now applies the central set, reads the registry strictly and fans the tenant set out, in one Job execution. The integration suite was NOT run locally (not migrate-all.test.ts, not schema-gate.test.ts); the next CI run is the proof. Commit `942ea89b`, not pushed.

## The bug and its evidence

The first production run of the 09.2 release, on 2026-10-24, failed: GitHub Actions run 40043498712 attempt 4, step "Run the migrate job", Cloud Run job execution migrate-5gs9z. Its first and only output was a crash `DrizzleQueryError: Failed query: select ... from "platform"."projects" where ... state = $1`, cause `PostgresError: relation "platform.projects" does not exist` (code 42P01), thrown from `migrateAll` through `deps.listProjects` (`listReadyProjects`).

Cause: `migrateAll` read the registry before it applied the central set, and the central set is what creates the `platform` schema and `platform.projects`. Only the migrate Job applies the central set, so on the very first release the first registry read threw and the Job exited 1 before it could create the schema.

CI did not cover a central database without the platform schema. Local stacks and CI always already have it (the database reset and the seed apply the central set first), so nothing exercised the first-release state. Until an integration case that starts from an empty central database exists, the hermetic cases of this task are the only guard.

## The fix, by behaviour

- The selector resolution moved out of `migrateAll` into `selectTargets` (same messages, same de-duplication, same ascending-ref order). `isUndefinedTable` walks the error and its `.cause` chain (at most eight links, cycle-safe) and returns true only for code `42P01`; it reads codes only, never a message.
- First pass is tolerant (unless `options.projectIds` is set): a 42P01 on the tenant lookup or the registry list yields `registry_missing`, the target list stays empty and the selectors are not judged. Any other error is rethrown as the same object.
- Step 1 is unchanged (ensureProjectZero attempt, central apply, failure handling, exit 1).
- After a successful, non-dry central apply in a run where the registry was missing, a second pass runs strictly: a registry still missing rejects with the original error; a selector that still matches nothing returns the usage result (exit 2) with the central line printed first; otherwise the targets are replaced and the existing fan-out runs.
- Dry run on a missing registry: no second pass, no tenant connection, no state write, no ensureProjectZero. The output is the central line with its pending list plus a summary with projects 0, exit 0. Selectors given to it are deferred, not rejected.
- The retry path (`projectIds`) stays strict: a missing registry still throws on its first read. The normal path still reads the registry exactly once. Exit codes, strict, concurrency, the line shape and the content-free output rule are unchanged. No exported name or type changed.

## RED run (Task 1, before the change)

`pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts`: Test Files 1 failed (1), **Tests 12 failed | 9 passed (21)**.

Failed, each because `migrateAll` rejected with the 42P01 error out of the registry read (or an assertion that follows from it): a (4 cases: the plain run and the three cause-chain variants), a2, c, c2 (tenant slug), c2 (project ref), e, e2, f, g. In f the rejection itself was correct, but the failure was `apply` called 0 times instead of 1, because the central set was never applied.

Passed, because they pin behaviour that already held: b (6 cases: list and tenant lookup, each with a plain error, undefined_column 42703 and cannot_connect_now 57P03), d (2 cases), h (1 case).

## GREEN run (Task 2, after the change)

`pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts tests/migration-files.test.ts tests/migrations-manifest.test.ts tests/migrations-required.test.ts`: Test Files 4 passed (4), **Tests 59 passed (59)**. Re-run as the final proof in Task 3 with the same result (4 files, 59 tests).

## Gates (Task 3)

| Command | Result |
|---|---|
| `pnpm --filter @rede-social/core run typecheck` | exit 0 |
| `pnpm --filter @rede-social/api typecheck` | exit 0 (covers the integration tests that call migrateAll, so the exported types still fit) |
| `pnpm exec biome check` on the two files | clean ("Checked 2 files, No fixes applied") |
| `pnpm guard:lanes` | OK |
| `pnpm boundaries` | "Checked 2046 files in 19 packages, no issues found" |

Scope: the commit contains exactly `packages/core/server/projects/migrate.ts` and `packages/core/tests/migrate-missing-registry.test.ts`; the commit message has no trailer and no tool attribution. `git rev-list --count 3c536e84..HEAD` = 1.

## What was NOT run

No integration suite, no `supabase` command, no database reset, no build, no Turborepo task run, no Playwright. The local central database holds a real tenant bound to the hosted project rede-demo-externo with sealed credentials. The new tests open no database (every dependency injected, the platform lane replaced by one that rejects, the three schema-state writers stubbed). The next CI run, including `migrate-all.test.ts` and `schema-gate.test.ts`, is the proof of the integration behaviour.

## Deviations from Plan

None. Biome reformatted one line in each file once (formatting only).

## Observations (not changed)

- On a first run the `ensureProjectZero` attempt runs before the registry exists and is swallowed by the existing try/catch, so project 0's ref and api_url are aligned on the next run or the worker boot (docs/DEPLOY.md "Check release 1" already says so).
- The core typecheck does not cover the test file (its tsconfig includes `db` and `server` only); Biome is the test file's only static gate.
- docs/DEPLOY.md was not edited: the scope was the function and its test. It still describes the Job as applying the central set first, which is now true on the first release too.

## Known Stubs

None.

## Threat Flags

None. The tolerance reads only error codes, never a message, and no new endpoint, path or schema was added.

## Self-Check: PASSED

- packages/core/tests/migrate-missing-registry.test.ts: found
- packages/core/server/projects/migrate.ts: modified, found
- commit 942ea89b: found in `git log`
