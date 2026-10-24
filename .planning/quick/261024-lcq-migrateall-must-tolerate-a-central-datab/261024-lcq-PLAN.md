---
phase: quick-261024-lcq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/server/projects/migrate.ts
  - packages/core/tests/migrate-missing-registry.test.ts
autonomous: true
requirements: [DBT-23, DBT-24]
tags: [migrate, deploy, registry, first-release, quick]

estimate:
  tokens: 30000
  raw_tokens: 30000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "migrateAll no longer dies on a central database that has never had the central set. A registry read (deps.listProjects, and deps.projectIdOfTenant when a tenant slug is given) that fails with PostgreSQL code 42P01, found by walking the .cause chain (a DrizzleQueryError wraps the driver error and the code is on its cause), means 'the registry does not exist yet': the project list is empty, the selectors are NOT rejected yet, and the flow continues to step 1, the central set. Any other error from those reads propagates exactly as today (the same error object)."
    - "After a successful, non-dry central apply in a run where the registry was missing, the selector resolution and the registry read run again (project id of the tenant, the project-ref filter, the id filter) and the existing tenant fan-out proceeds for the now-listed projects, in ascending ref. The call order is: failed read, the ensureProjectZero attempt, central apply, re-read, tenant apply per project. The re-read is strict: a registry still missing after the central set rejects loudly with the original error. A selector that still matches nothing returns the existing usage result (exit 2, same message); the central line is printed before the usage line, because the central set did change the database and the Job log must not hide it."
    - "With dryRun the central apply writes nothing, so the registry stays missing: no re-read, no tenant connection, no state write, no ensureProjectZero. The output is the existing central line with its pending list (existing keys and types) plus the existing summary with projects 0, and the exit code is 0. A selector given to such a dry run cannot be resolved without a registry and is deferred, not rejected."
    - "options.projectIds (the retry job) is unchanged: it never applies the central set and stays strict, so a missing registry still throws on its first read, with or without a tenant slug."
    - "Step 1 (ensureProjectZero attempt, central apply, failure handling and its exit 1), exit codes, the line shape on the normal path (which still reads the registry exactly once), strict, concurrency and the content-free output rule (PR-4) do not change. A test asserts that no emitted line carries the driver or Drizzle message text, a statement or a connection string."
    - "The new tests are hermetic: packages/core/tests/migrate-missing-registry.test.ts injects every MigrateDeps member, replaces the platform lane with one that rejects, and stubs the three schema-state writers, so no database is opened. They fail before the change for the right reason (the registry read throws 42P01 out of migrateAll) and pass after it."
    - "The integration suite was NOT run locally, not even apps/api/tests/integration/migrate-all.test.ts: the local central database holds a REAL tenant bound to the hosted project rede-demo-externo with sealed credentials. The next CI run is the proof. The SUMMARY records that the first production run on 2026-10-24 (GitHub Actions run 40043498712 attempt 4, step 'Run the migrate job', Cloud Run job execution migrate-5gs9z) exposed this, and that CI did not cover a central database without the platform schema because local stacks and CI always have it (db reset and the seed apply the central set first)."
  artifacts:
    - path: "packages/core/server/projects/migrate.ts"
      provides: "isUndefinedTable (cause-chain walk for 42P01), selectTargets (the selector resolution moved out of migrateAll, tolerant or strict), migrateAll calling it before and, when the registry was missing and the run is not a dry run, after the central apply"
      contains: "42P01"
    - path: "packages/core/tests/migrate-missing-registry.test.ts"
      provides: "hermetic cases a to h for a central database without the platform registry"
      contains: "42P01"
  key_links:
    - from: "migrateAll (first selector pass, tolerant)"
      to: "step 1, the central apply"
      via: "a registry_missing outcome instead of a throw; targets stay empty and the selectors stay unjudged"
      pattern: "registry_missing"
    - from: "migrateAll (second selector pass, strict, only when the registry was missing and dryRun is false)"
      to: "the existing tenant fan-out"
      via: "targets replaced by the re-read; usage result returned with the central line first"
      pattern: "selectTargets"
---

<objective>
Fix a real bug in the production deploy path: the migrate Job crashes on a central database that has never had the central set, before it can apply it.

Evidence (the first production run of the 09.2 release, 2026-10-24): GitHub Actions run 40043498712 attempt 4, step "Run the migrate job", failed. Cloud Run job execution migrate-5gs9z logged as its first and only output a crash `DrizzleQueryError: Failed query: select ... from "platform"."projects" where "platform"."projects"."state" = $1 ... params: ready`, cause `PostgresError: relation "platform.projects" does not exist` (code 42P01, routine parserOpenTable), thrown from migrateAll (packages/core/server/projects/migrate.ts) through deps.listProjects (listReadyProjects in packages/core/server/tenancy/project-registry.ts).

Root cause (established, not re-investigated here): migrateAll reads the registry BEFORE it applies the central set, and the central set is what creates the `platform` schema and `platform.projects`. Only the migrate Job applies the central set (docs/DEPLOY.md "Phase 09.2 release"), so on the very first release the first registry read throws and the Job exits 1 before it can create the schema. Local stacks and CI always already have the schema, so nothing covered it.

Purpose: the first release (and any run against a central database whose registry is missing) applies the central set, then fans the tenant set out, in one Job execution; and a unit test pins it so the gap cannot reopen unseen.
Output: one edited source file, one new hermetic test file, one code commit (explicit paths, no trailer, not pushed), and a SUMMARY that states plainly that the integration suite was not run locally.

Tracer-first does not apply: one function in one file, and the only end-to-end proof (the integration suite against a central database without the schema) is forbidden locally. The order is still thin to wide and test-first: Task 1 writes the failing hermetic cases (the proof of the bug), Task 2 makes them pass without touching the normal path, Task 3 runs the gates, writes the SUMMARY and commits.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@packages/core/server/projects/migrate.ts
@packages/core/server/tenancy/project-registry.ts
@apps/api/src/migrate.ts
@packages/core/tests/mirror-job.test.ts

<interfaces>
Read at planning time; do not re-derive.

- packages/core/server/projects/migrate.ts (396 lines). Header doc comment lines 32-52 (the three steps, the output rule, "Exit codes: 0 ok ..., 1 the central set failed or strict saw a tenant failure, 2 a usage error (nothing changed)"). Types MigrateLine, MigrateResult, MigrateOptions (projectIds "implies no central set"), MigrateDeps (connectCentral, connect, loadFiles, apply, listProjects, projectIdOfTenant, ensureProjectZero) at 54-88. defaultDeps 94-115. codeOf 118-136. usage() 141-145 returns exit 2 with one line `{ kind: 'usage', message }`. migrateProject 157-264. migrateAll 266-395: argument validation 271-281 (before any query); selector resolution 283-305 (onlyIds from projectIds; tenantSlug through deps.projectIdOfTenant, usage 'no tenant has that slug'; deps.listProjects; filter by onlyIds and by projectRef; usage 'no ready project matches' when a selector was given and nothing matched; de-duplicate by id and sort ascending by ref); step 1 309-358 (only when options.projectIds is unset: ensureProjectZero unless dryRun, swallowed; loadFiles('central'); connectCentral; apply with set central and dryRun; one central line, which carries `pending` when dryRun; a failure pushes a summary and returns exit 1); step 2 360-379 (workers over targets, slots filled by index, so printed order is ascending ref whatever finishes first); summary 383-391; exit code 393-394.
- migrateProject on the non-dry path calls readAppliedSchema, recordSchemaState and invalidateProjectHosts (all in ./schema-state; the last two go through withPlatformTx, a real database). Any hermetic test of the fan-out MUST stub these. stateOf in the same module is pure.
- The real runner's dry run reads an absent ledger as empty ("Absent tables read as empty", packages/core/server/migrations/runner.ts readState) and takes no lock and creates nothing, so a real central dry run on a never-migrated database already works; the only crash was the registry read. MigrationErrorCode literals include 'file_failed'.
- DrizzleQueryError is exported by the drizzle-orm package index; constructor `(query: string, params: any[], cause?: Error)`; it sets `.cause`. Its message starts with 'Failed query:' and holds the statement, so it must never reach an output line.
- ensureProjectZero (packages/core/server/tenancy/project-zero.ts) only UPDATEs the is_central row. On a first run it runs before the registry exists, fails, and is swallowed by the existing try/catch. Step 1 is unchanged by this task, so that alignment happens on the next run or the worker boot. Record it in the SUMMARY as an observation, do not change it.
- packages/core/vitest.config.ts: include `tests/**/*.test.{ts,tsx}`, node environment, placeholder env for DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY, "no database, no network". packages/core/tsconfig.json includes only `db/**/*.ts` and `server/**/*.ts`, so `pnpm --filter @rede-social/core run typecheck` does NOT typecheck files under tests: keep the test file's types honest by hand (no `any`, narrow casts with `as unknown as`), Biome is its only gate.
- Style reference for module mocks in this package: packages/core/tests/mirror-job.test.ts (vi.hoisted state, top-level vi.mock with a relative path from the tests directory such as '../db/platform-tx') and packages/core/tests/project-database-state.test.ts (a partial mock through importOriginal).
- Files that import migrateAll: only apps/api/tests/integration/migrate-all.test.ts and apps/api/tests/integration/schema-gate.test.ts (integration, need a database, NOT run here) and apps/api/src/migrate.ts (the CLI wrapper, unchanged). No file under packages/core/tests imports it today. The hermetic regression files for the migration machinery are packages/core/tests/migration-files.test.ts, migrations-manifest.test.ts and migrations-required.test.ts.
- apps/api typecheck (`tsc --noEmit` in apps/api) includes the integration tests, so it proves the exported types of migrate.ts (MigrateDeps, MigrateOptions, MigrateResult, migrateAll) still fit their callers. Do not change any exported name or type.
</interfaces>

<execution_rules>
- Verification is limited to: the new hermetic file plus the three migration regression files with `pnpm --filter @rede-social/core exec vitest run <files>`, `pnpm --filter @rede-social/core run typecheck`, `pnpm --filter @rede-social/api typecheck`, `pnpm exec biome check` on the two touched files, `pnpm guard:lanes`, `pnpm boundaries`, plus grep and git checks. Do NOT run any integration suite (not migrate-all, not schema-gate), do NOT run `supabase db reset` or any supabase command, no web build, no turbo build or `turbo run`, no Playwright. The disk is at 98 percent; create no build output.
- Do not read, grep, cat or name any `.env*` file (a secret-read guard blocks it; never retry a variant of a blocked command).
- Write file contents with the Write and Edit tools, never with shell redirection or heredocs.
- Do not touch anything under .planning/phases/. Do not stage or edit .planning/ROADMAP.md or .planning/STATE.md. Do not edit any file other than the two named in files_modified (the SUMMARY aside).
- Do NOT commit PLAN.md or SUMMARY.md: the orchestrator commits both. Do not push.
- Commit rules (project rule, overrides any attribution reminder): no Co-Authored-By trailer and no tool or Claude attribution in the message (public repository, identity igor.vboas noreply). Stage ONLY the two files by explicit path; never `git add -A` or `git add .` (many untracked personal files exist, for example docs/LOCAL-SETUP.md). Message style `fix(quick-261024-lcq): ...`. Exactly one code commit, made in Task 3.
- No `check tdd-red-evidence` run: Vitest does not emit the TAP shape that gate parses, and this is not a tdd plan. Record the real red run (test names and the real pass/fail counts from the vitest output) in the SUMMARY; never write counts you did not see.
- Comment and wording discipline: comments say why and where. Do not use the tokens "v1", "for now", "placeholder", "simplified", "future" or "later" in new comments or in the test titles. Never put an error message text, a statement or a connection string into an output line of migrate.ts.
</execution_rules>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write the hermetic cases for a central database without the platform registry and show them failing for the right reason</name>
  <files>packages/core/tests/migrate-missing-registry.test.ts</files>
  <behavior>
    - a: first run, registry missing, no selectors: call order is failed read, ensureProjectZero, central apply, re-read, tenant apply per project in ascending ref; exit 0; lines are central, project, project, summary.
    - a2: same with a tenant slug: the lookup fails, then resolves after the central apply, and only that project is migrated.
    - b: any error that is not 42P01 (a plain error, an undefined_column code, a not-yet-accepting-connections code, on either read) rejects with the same error object and applies nothing.
    - c: dry run on a missing registry: exit 0, one central apply with dryRun, nothing written, no re-read, central line with pending, summary with projects 0. c2: the same with a tenant slug or a project ref still exits 0.
    - d: the projectIds path with a missing registry still rejects, with or without a tenant slug, and applies nothing.
    - e: missing registry plus an unknown tenant slug (e2: an unknown project ref) after the central apply returns the existing usage result, central line first, exit 2.
    - f: the registry still missing after the central apply rejects with the original error, after the central apply was made.
    - g: the central apply fails while the registry is missing: exit 1 with the central line and the existing failure summary, no re-read, no tenant work.
    - h: normal path with the registry present reads the registry exactly once.
  </behavior>
  <action>
Create packages/core/tests/migrate-missing-registry.test.ts with the Write tool. This is the test-first half; migrate.ts is not touched in this task.

1. Header doc comment: the evidence (GitHub Actions run 40043498712 attempt 4, Cloud Run job execution migrate-5gs9z, the 42P01 crash from the registry read), the rule being pinned (the first release applies the central set before any registry exists), and the statement that no database is opened (every dependency injected, the platform lane replaced, the schema-state writers stubbed).

2. Module setup. Use vi.hoisted for three stubs: readAppliedSchema, recordSchemaState, invalidateProjectHosts. Top-level vi.mock of '../db/platform-tx' returning a withPlatformTx that rejects with an Error whose text says a hermetic test must not reach a database (so anything unstubbed fails loudly instead of connecting to the local stack, which holds a real tenant). Top-level vi.mock of '../server/projects/schema-state' as a partial mock through importOriginal that keeps the real stateOf and replaces the three writers with the hoisted stubs; if loading the original module under the unit environment fails, replace the whole module with a factory exposing the four names and a stateOf stub that returns 'current'. Import migrateAll and the MigrateDeps type from '../server/projects/migrate', DrizzleQueryError from 'drizzle-orm', the ApplyResult and ApplyOptions types from '../server/migrations/runner', the ProjectRecord type from '../server/tenancy/project-registry', the MigrationFile type from '../server/migrations/sets', and the Sql type from 'postgres'. In a beforeEach reset every stub (calls and implementations) and give readAppliedSchema, recordSchemaState and invalidateProjectHosts their harmless defaults (counts of 1 with a head, `{ changed: false }`, resolved void).

3. Fakes, small and typed without `any`. A `missingRegistry()` factory returning a DrizzleQueryError built with a select statement over "platform"."projects", the params ['ready'] and a cause Error whose message says the relation does not exist and which carries `code: '42P01'`; a second variant with the code one level deeper (an error whose cause is the DrizzleQueryError) to pin the chain walk; a plain-shape variant (an Error with a cause that has the code) so the walk does not depend on the Drizzle class. A `project(ref)` factory for a ProjectRecord (copy the field list of fakeRecord in apps/api/tests/integration/migrate-all.test.ts, ready state, refs in the registry shape such as 'alpha-proj' and 'beta-proj', an id per ref). A fake Sql made of a tagged label and an `end` stub that resolves, cast with `as unknown as Sql`. A `harness()` that builds the dependency set and a shared `calls: string[]` log: connectCentral returns the fake labelled central; connect(project) returns the fake labelled with the ref; loadFiles returns one MigrationFile (14-digit version, name, text, sha256 strings) for either set; apply records `apply:central` or `apply:tenant:<ref>` (the ref read from the fake's label), flips a `centralApplied` flag when the central set is applied with dryRun false, and returns an ApplyResult (central applied one version; tenant applied none, skipped one, pending none); listProjects records `list:missing` and throws missingRegistry() while the flag is false, else records `list:ok` and returns the projects in a NON-sorted order (beta before alpha) so the ascending sort is proved; projectIdOfTenant records `tenantOf:missing` and throws while the flag is false, else `tenantOf:ok` and returns the id of beta; ensureProjectZero records `ensureProjectZero`. Every member of MigrateDeps is injected in every case, so no default dependency (and no default connection) is ever built. All behaviours are overridable per case.

4. The cases, each titled in plain words (a to h as in the behavior block). Details that must be asserted:
   - a: concurrency 1 so the call order is deterministic; expect exactly the call sequence ['list:missing', 'ensureProjectZero', 'apply:central', 'list:ok', 'apply:tenant:alpha-proj', 'apply:tenant:beta-proj']; result ok true and exitCode 0; line kinds ['central', 'project', 'project', 'summary']; project refs ascending; the central line status 'ok'; the summary central 'ok' and projects 2; `JSON.stringify(result.lines)` contains none of 'Failed query', 'does not exist', 'platform.projects' and 'postgres://'. Repeat the first-sequence assertion for the one-level-deeper and the plain-shape errors with `it.each` or a short loop, so the cause-chain walk is pinned.
   - a2: tenantSlug 'acme'; sequence ['tenantOf:missing', 'ensureProjectZero', 'apply:central', 'tenantOf:ok', 'list:ok', 'apply:tenant:beta-proj']; one project line.
   - b: `it.each` over a plain Error, a DrizzleQueryError whose cause has code '42703', and one whose cause has code '57P03', for listProjects, and the same set for projectIdOfTenant (with a tenant slug); `await expect(migrateAll(...)).rejects.toBe(error)`; the apply stub, ensureProjectZero and connectCentral never called.
   - c: dryRun true; the central apply stub returns pending ['20260101000000', '20260102000000'] and applied none; expect exit 0, ok true, kinds ['central', 'summary'], the central line to match dryRun true, status 'ok', applied 0 and that pending list, the summary to match dryRun true, central 'ok', projects 0, current 0, failed 0, applied 0; apply called exactly once, with `{ set: 'central', dryRun: true }`; listProjects called once; ensureProjectZero, connect, recordSchemaState and invalidateProjectHosts never called. c2: the same with a tenantSlug and with a projectRef (two runs): still exit 0, still two lines, no usage line.
   - d: options.projectIds set, listProjects always throwing missingRegistry(): `rejects.toBe(error)`; apply, ensureProjectZero and connectCentral never called. A second run with projectIds and a tenantSlug where projectIdOfTenant throws the same error: same expectations.
   - e: tenantSlug 'ghost'; projectIdOfTenant throws missingRegistry() until the central apply, then returns null; expect ok false, exitCode 2, exactly two lines, the first a central line with status 'ok', the second equal to `{ kind: 'usage', message: 'no tenant has that slug' }`; apply called once (the central set), connect never called. e2: projectRef 'no-such-ref', listProjects missing until the central apply, then returning alpha only; the second line's message is 'no ready project matches'.
   - f: listProjects always throwing missingRegistry(); `rejects.toBe(error)`; apply called exactly once with the central set (the change was made), listProjects called twice, connect never called.
   - g: the central apply returns `{ applied: [], skipped: 0, pending: [version], errorCode: 'file_failed', failedVersion: version }`; expect ok false, exitCode 1, kinds ['central', 'summary'], the central line status 'failed' with errorCode 'file_failed', the summary central 'failed' and projects 0; listProjects called once; connect never called.
   - h: the registry present from the start (set the flag so the first read succeeds): listProjects called exactly once, sequence ['list:ok', 'ensureProjectZero', 'apply:central', 'apply:tenant:alpha-proj', 'apply:tenant:beta-proj'], exit 0.

5. Run `pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts`. The expected partition BEFORE the change: the cases a, a2, c, c2, e, e2, f and g FAIL, and each failure shows migrateAll rejecting with the 42P01 error (or an assertion on the result that follows from it); the cases b, d and h PASS (they pin behaviour that already holds). A load error, a failure for another reason, or a case from the red set that passes means the test is wrong: fix the test, not the source. Keep the real output: you will copy the names and the counts into the SUMMARY. If Biome reports only formatting, run `pnpm exec biome check --write packages/core/tests/migrate-missing-registry.test.ts` once and re-check.
  </action>
  <verify>
    <automated>pnpm exec biome check packages/core/tests/migrate-missing-registry.test.ts && ! pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts</automated>
  </verify>
  <done>The new file exists, is Biome-clean, and the suite is red for the intended reason: the failing set is exactly a, a2, c, c2, e, e2, f and g, each failing because migrateAll throws the missing-registry error (or because of the result that follows), and b, d and h pass. The real names and counts of that run are noted for the SUMMARY. migrate.ts is unchanged and nothing is committed.</done>
</task>

<task type="auto">
  <name>Task 2: Make migrateAll tolerate a missing registry on the first pass and re-read it after the central apply</name>
  <files>packages/core/server/projects/migrate.ts</files>
  <action>
Edit packages/core/server/projects/migrate.ts with the Edit tool. Implements the behaviour of the test file from Task 1 per D-544 (the fan-out: central set first, then the tenant set) and D-547 (the central set creates the registry). No exported name or type changes.

1. Add a private helper `isUndefinedTable(error: unknown): boolean` next to codeOf. It walks the error and its `.cause` chain, at most eight links, remembering the objects it has seen so a cyclic chain ends, and returns true when any link is an object whose `code` equals the string '42P01' (PostgreSQL undefined_table). Doc comment: the driver error is wrapped by the query builder, so the code sits on the cause, not on the thrown error; the message text is never read or kept (PR-4).

2. Add a private function `selectTargets(options, deps, tolerant)` that returns a discriminated union: `{ kind: 'usage'; result: MigrateResult }`, `{ kind: 'registry_missing' }` or `{ kind: 'targets'; targets: ProjectRecord[] }`. Move into it, unchanged in behaviour and message text, the whole existing selector block of migrateAll: the onlyIds set from options.projectIds, the tenant lookup through deps.projectIdOfTenant with the usage message 'no tenant has that slug', deps.listProjects, the onlyIds and projectRef filters, the usage message 'no ready project matches' when a tenant or project selector was given and nothing matched, then the de-duplication by id and the ascending sort by ref. The two registry reads (the tenant lookup and the list) are the only calls inside a try block. In the catch: when `tolerant` is true and isUndefinedTable(error) is true, return `{ kind: 'registry_missing' }`; in every other case rethrow the same error object. Doc comment: why the first pass is tolerant (the central set creates the registry, so on the first release it cannot exist yet), why the second pass is not, and that a selector is judged only against a registry that exists.

3. In migrateAll, keep the argument validation exactly where it is (before any query). Replace the old selector block with a first pass: `tolerant` is true exactly when options.projectIds is unset, so the retry path stays strict. Call selectTargets; return its usage result when it is one; remember `registryMissing` (the kind is registry_missing); hold `targets` as a mutable array that is empty when the registry is missing. Step 1 stays byte-for-byte as it is.

4. Directly after step 1 and before step 2, add the second pass: when registryMissing is true and dryRun is false (the central set succeeded, because a failure already returned), call selectTargets again with tolerant false. If it returns a usage result, return that result with its `lines` replaced by the already collected lines (the central line) followed by the usage lines; ok and exitCode stay as the usage result has them. If it returns targets, replace `targets` with them. An error from this call is not caught: a registry still missing after the central set rejects loudly with the original error. When dryRun is true nothing is re-read: the central apply wrote nothing, the registry is still missing, `targets` stay empty, and the unchanged step 2 and summary produce projects 0 with exit 0. Add a short comment on that branch saying that selectors given to a dry run on a missing registry cannot be resolved and are deferred, not rejected.

5. Update the header doc comment: add a paragraph describing the first release (the registry is missing until the central set creates it; the first selector pass tolerates exactly that case, the second pass after the central apply is strict, a dry run reports the central set as pending and exits 0), and amend the exit code 2 sentence so it says a usage error changes nothing, except a selector that can only be checked once the central set has created the registry, where the central line is printed before the usage line.

6. Do not touch migrateProject, codeOf, usage, defaultDeps, the types, step 1, step 2, the summary or the exit code line. Then run, in this order: the new test file together with tests/migration-files.test.ts, tests/migrations-manifest.test.ts and tests/migrations-required.test.ts through `pnpm --filter @rede-social/core exec vitest run` (all green); `pnpm exec biome check` on migrate.ts and the new test file (if only formatting is reported, `--write` on those two paths once and re-check). If a case from Task 1 fails after the change, decide whether the source or the test is wrong against the must_haves; do not weaken an assertion to make it pass.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts tests/migration-files.test.ts tests/migrations-manifest.test.ts tests/migrations-required.test.ts && pnpm exec biome check packages/core/server/projects/migrate.ts packages/core/tests/migrate-missing-registry.test.ts && test "$(grep -v -E '^[[:space:]]*(//|/\*|\*)' packages/core/server/projects/migrate.ts | grep -c "'42P01'")" -ge 1</automated>
  </verify>
  <done>Every case of the new file passes (a to h, including the cases that were red), the three migration regression files stay green, Biome is clean on both files, and the string '42P01' appears in executable code of migrate.ts (not only in comments). The retry path (projectIds) still rejects on a missing registry; the normal path reads the registry once; exported names and types are unchanged.</done>
</task>

<task type="auto">
  <name>Task 3: Run the gates, write the SUMMARY and make the one commit</name>
  <files>packages/core/server/projects/migrate.ts, packages/core/tests/migrate-missing-registry.test.ts, .planning/quick/261024-lcq-migrateall-must-tolerate-a-central-datab/261024-lcq-SUMMARY.md</files>
  <action>
1. Run the gates, and only these, fixing what they report in the two files:
   - `pnpm --filter @rede-social/core run typecheck` (tsc without emit; covers migrate.ts, not the test file)
   - `pnpm --filter @rede-social/api typecheck` (tsc without emit; covers the integration tests that call migrateAll, so it proves the exported types still fit)
   - `pnpm exec biome check packages/core/server/projects/migrate.ts packages/core/tests/migrate-missing-registry.test.ts`
   - `pnpm guard:lanes`
   - `pnpm boundaries`
   Then re-run the hermetic files once more as the final proof: `pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts tests/migration-files.test.ts tests/migrations-manifest.test.ts tests/migrations-required.test.ts`.

2. Scope checks: `git status --short -- packages apps docs scripts supabase` must show exactly packages/core/server/projects/migrate.ts as modified and packages/core/tests/migrate-missing-registry.test.ts as untracked and nothing else (untracked personal files elsewhere are not yours; never stage them). `git diff --stat -- packages/core/server/projects/migrate.ts` must show only that file.

3. Write the SUMMARY with the Write tool at .planning/quick/261024-lcq-migrateall-must-tolerate-a-central-datab/261024-lcq-SUMMARY.md (follow the section structure of .planning/quick/261023-t3x-make-the-two-database-routing-integratio/261023-t3x-SUMMARY.md). It must contain: the bug and its evidence (Actions run 40043498712 attempt 4, step "Run the migrate job", job execution migrate-5gs9z, the 42P01 crash from deps.listProjects through listReadyProjects); the fix described by behaviour (tolerant first pass, strict second pass after the central apply, dry run, projectIds path, usage-after-central output shape, the deferred selector in a dry run); the real RED run from Task 1 (the failing and passing case names and the real counts you saw) and the real GREEN run; the exact gate commands and their results; and these statements in plain words: (a) the integration suite was NOT run locally, not even migrate-all.test.ts or schema-gate.test.ts, because the local central database holds a real tenant bound to the hosted project rede-demo-externo with sealed credentials, and the next CI run is the proof; (b) the first production run on 2026-10-24 exposed this bug, and CI did not cover a central database without the platform schema, because local stacks and CI always already have it (the reset and the seed apply the central set first), so the hermetic cases of this task are the only guard until an integration case that starts from an empty central database exists; (c) observations, not changes: on a first run the ensureProjectZero attempt runs before the registry exists and is swallowed, so project 0's ref and api_url alignment happens on the next run or the worker boot (docs/DEPLOY.md "Check release 1" already says so); the test file is not covered by the core typecheck (the tsconfig includes db and server only); docs/DEPLOY.md was not edited because the scope was the function and its test, and it still describes the Job as applying the central set first, which is now true on the first release too. Do not write a count or a name you did not observe.

4. Commit: stage ONLY packages/core/server/projects/migrate.ts and packages/core/tests/migrate-missing-registry.test.ts by explicit path. Message `fix(quick-261024-lcq): migrateAll applies the central set on a database that has no platform registry yet`, with a short body saying the registry read now tolerates undefined_table on the first pass and is repeated strictly after the central apply, and that hermetic cases cover it; no Co-Authored-By trailer, no tool or Claude attribution line. Do not push. Do not stage the SUMMARY, the PLAN, STATE.md or ROADMAP.md. Check with `git show --stat HEAD` that exactly the two files are in the commit and with `git log -1 --format=%B` that no trailer line exists.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core run typecheck && pnpm --filter @rede-social/api typecheck && pnpm exec biome check packages/core/server/projects/migrate.ts packages/core/tests/migrate-missing-registry.test.ts && pnpm guard:lanes && pnpm boundaries && pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts tests/migration-files.test.ts tests/migrations-manifest.test.ts tests/migrations-required.test.ts</automated>
  </verify>
  <done>All six commands exit 0. Exactly one commit exists, containing only the two files, with no trailer and not pushed. The SUMMARY exists, holds the real red and green runs and the gate results, and states plainly that the integration suite was not run locally and that the next CI run is the proof, that the first production run on 2026-10-24 exposed the bug, and that CI did not cover a central database without the platform schema.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Job process to central database | The migrate Job runs as `postgres` against the central project and creates the platform schema; a wrong skip or a wrong tolerance changes which database state the fan-out acts on |
| Job log to operators | Every output line is read in Cloud Run logs and in the workflow summary; it must stay free of statements, driver messages and connection strings |
| developer machine to hosted project | The local central database holds a real tenant bound to the hosted project rede-demo-externo with sealed credentials; integration suites and db reset could mutate or break it |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-lcq-01 | Information disclosure | Tolerating the registry error could leak the Drizzle or driver message (it holds the statement) into an output line | high | mitigate | isUndefinedTable reads only the `code` strings along the cause chain and returns a boolean; the error is never formatted, logged or put in a line; case a asserts no line contains the statement text, the driver message text or a connection string |
| T-quick-lcq-02 | Tampering | Tolerance applied too widely would hide a real registry problem (a dropped table on a live database) or let a wrong selector slip past | high | mitigate | Only code 42P01 is tolerated and only on the first, non-retry pass; every other error is rethrown as the same object (case b); the second pass is strict, so a registry still missing after the central set rejects (case f); the retry path stays strict (case d); selectors are judged against a registry that exists (cases e and e2) |
| T-quick-lcq-03 | Tampering | A dry run on a missing registry could write something (ledger, state, registry fix-up) | medium | mitigate | In a dry run the second pass, ensureProjectZero, tenant connections and the state writers are skipped; case c asserts one central apply with dryRun true and no connect, no state write, no host invalidation, no ensureProjectZero |
| T-quick-lcq-04 | Denial of service | A first run that crashes before applying the central set blocks the whole release (the production deploy gate stops at the Job) | high | mitigate | This task: the central set is applied first and the fan-out follows in the same execution; case a pins the order; central failure keeps exit 1 with the existing summary (case g) |
| T-quick-lcq-05 | Tampering | Running the integration suites or a database reset locally mutates or breaks the real tenant bound to rede-demo-externo | high | mitigate | No integration run, no db reset, no supabase command; hermetic cases replace the platform lane with a rejecting stub so nothing can reach a database; the SUMMARY states the suite was not run and CI is the proof |
| T-quick-lcq-06 | Repudiation | The usage-after-central path could hide that the central set was applied | low | mitigate | The central line is printed before the usage line (case e), so the Job log records the change |
| T-quick-lcq-07 | Denial of service | ensureProjectZero fails silently on a first run (no registry yet), leaving project 0's ref and api_url unaligned until the next run | low | accept | Cosmetic, already swallowed today; step 1 is deliberately unchanged; the worker boot and the next run align it (docs/DEPLOY.md "Check release 1"); recorded in the SUMMARY |
</threat_model>

<verification>
- `pnpm --filter @rede-social/core exec vitest run tests/migrate-missing-registry.test.ts tests/migration-files.test.ts tests/migrations-manifest.test.ts tests/migrations-required.test.ts` is green; Task 1 showed the red set (a, a2, c, c2, e, e2, f, g) failing before the change and Task 2 shows it green.
- `pnpm --filter @rede-social/core run typecheck`, `pnpm --filter @rede-social/api typecheck`, `pnpm exec biome check` on the two files, `pnpm guard:lanes` and `pnpm boundaries` exit 0.
- `git show --stat HEAD` lists exactly packages/core/server/projects/migrate.ts and packages/core/tests/migrate-missing-registry.test.ts; `git log -1 --format=%B` has no Co-Authored-By line; nothing is pushed.
- No integration suite, no supabase command, no build and no Playwright was run; the SUMMARY says so.
</verification>

<success_criteria>
- The migrate Job, started against a central database that has no platform schema, applies the central set, re-reads the registry and fans the tenant set out in ascending ref, in one execution, exit 0.
- A dry run against such a database reports the central set as pending, writes nothing and exits 0; the retry path still fails loudly on a missing registry; any other registry error still propagates unchanged; the normal path, the exit codes, strict, concurrency and the content-free output rule are unchanged.
- A hermetic test file pins all of it, and the SUMMARY records plainly that the integration suite was not run locally, that the next CI run is the proof, and that the first production run on 2026-10-24 exposed a gap CI did not cover.
</success_criteria>

<output>
Create `.planning/quick/261024-lcq-migrateall-must-tolerate-a-central-datab/261024-lcq-SUMMARY.md` when done (Task 3). The orchestrator commits the PLAN and the SUMMARY; the executor commits only the two code files.
</output>
