---
phase: quick-261023-sfy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/tests/boss-scope.test.ts
  - packages/core/tests/project-database-state.test.ts
autonomous: true
requirements: [DBT-48]
tags: [ci, unit-tests, hermetic, vitest, lane-rule, quick]

estimate:
  tokens: 20000
  raw_tokens: 20000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "The test 'the kernel registers its platform queues at import' in packages/core/tests/boss-scope.test.ts carries an explicit timeout of 30_000 ms as the last argument of its `it(...)`. Its two dynamic imports and its three assertions are byte-for-byte what they are today; nothing else in the file changes (a one-line comment saying why the timeout exists is the only other allowed addition)."
    - "packages/core/tests/project-database-state.test.ts no longer needs a database: `vi.mock` of '../server/projects/move/state' keeps every export real through `importOriginal` and replaces only `openMoveOf` with a hoisted `vi.fn`, so `isTenantMoving` (packages/core/server/projects/moving.ts, which returns `(await openMoveOf(tenantId)) !== null`) is driven by the test, in both directions: an `openMoveOf` that resolves `null` gives false, and one that resolves an open `MoveRow` gives true (and was asked for that tenant id)."
    - "The describe and the first test of the old 'moves' block are renamed so neither title calls the move code a placeholder or says 'until plan 23': the move table IS read since plan 09.2-23 (D-535, DBT-48). The second test of that describe ('the overview schema has a moving flag') and every other test in the file are untouched, and the file's existing static imports keep working."
    - "The open-move fixture has the REAL shape of `MoveRow` (packages/core/server/projects/move/state.ts lines 54-72: id, tenantId, fromProjectId, toProjectId, state, statusBefore, actor, counts, fingerprint, errorCode, leaseOwner, leaseUntil, startedAt, updatedAt, cutoverAt, finishedAt, sourceDeletedAt), with an open state ('copied', not 'done' and not 'rolled_back'), built the way `row()` in packages/core/tests/move-state.test.ts builds it."
    - "Hermeticity is proved, not assumed: with every TCP connect to the local Postgres port (54322) refused inside the test process, the OLD project-database-state test fails with ECONNREFUSED (red, observed at planning time and re-observed before the edit), and after the edit both files pass. The refusal is a throwaway preload that lives in the session scratchpad, outside the repo, never committed."
    - "Scope is exactly two files, no product code, nothing under .planning/phases/, no .env* file read or named, no integration suite, no `supabase db reset`, no web build, no turbo build, no push. The code commit stages the two files by explicit path and carries no Co-Authored-By trailer and no tool attribution."
  artifacts:
    - path: "packages/core/tests/boss-scope.test.ts"
      provides: "the kernel-import test with an explicit 30_000 ms timeout"
      contains: "30_000"
    - path: "packages/core/tests/project-database-state.test.ts"
      provides: "a database-free proof that isTenantMoving follows openMoveOf, in both directions"
      contains: "importOriginal"
  key_links:
    - from: "packages/core/tests/project-database-state.test.ts vi.mock('../server/projects/move/state')"
      to: "packages/core/server/projects/moving.ts isTenantMoving"
      via: "moving.ts imports `openMoveOf` from './move/state', the same module id the test mocks; the mock replaces that one binding"
      pattern: "openMoveOf"
    - from: "packages/core/tests/project-database-state.test.ts"
      to: "packages/core/server/projects/overview.ts"
      via: "overview.ts also imports isTenantMoving; the rest of the file only calls the pure summarizeDatabase and reasonCodeOf, so the mock does not change them"
      pattern: "summarizeDatabase"
---

<objective>
Make the two unit tests that failed the first CI run of the 09.2 push pass on a runner with no database and a slow disk.

GitHub Actions run 40039284864, job "lint, typecheck, build gate, unit tests, boundaries, lane guard", step
"Typecheck, build, unit tests", `@rede-social/core#test`: 2 failed of 1156.

  1. `boss-scope.test.ts` > "registerJobQueues scopes > the kernel registers its platform queues at import"
     dynamically imports the whole kernel (`../server/domains/index`, `../server/platform/invite-send`) and hit the
     default 5000 ms limit on the CI runner (5696 ms measured; under 1 s locally). Fix: an explicit 30_000 ms
     timeout. No assertion changes.
  2. `project-database-state.test.ts` > "moves are a stub with a contract (planning decision 2)" > "no tenant is
     moving until plan 23 reads the move table" calls the real `isTenantMoving`. Since plan 09.2-23 that reads
     `platform.tenant_moves` through `openMoveOf`, so in the unit lane it tries to connect to 127.0.0.1:54322 and
     fails with ECONNREFUSED. Locally it only passes because the local Supabase stack is up. Fix: mock `openMoveOf`
     (the rest of the module stays real) and prove both directions.

Purpose: the lane rule says unit tests under packages/core/tests must not need a database. The CI unit job has none.
Output: two edited test files, one code commit. TEST-ONLY: no product code changes.

Tracer note: the change is two independent test edits with no layers to wire; Task 1 is the one-line fix and Task 2
is the hermetic rewrite plus the full verification, so there is no separate tracer task.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@packages/core/tests/boss-scope.test.ts
@packages/core/tests/project-database-state.test.ts
@packages/core/server/projects/moving.ts
@packages/core/server/projects/move/state.ts

This is a quick task that runs alongside Phase 09.2 (paused at human checkpoints). Do not touch anything under
.planning/phases/, and do not stage .planning/ROADMAP.md or .planning/STATE.md in the code commit. Do not read, cat,
grep or name any `.env*` file (a secret-read guard blocks it). The disk is 98 percent full: no web build, no turbo
build, no integration suite, no `supabase db reset`.

Facts read at planning time, which the executor should not re-derive:

- `isTenantMoving(tenantId)` is `(await openMoveOf(tenantId)) !== null`. A bare `vi.fn()` resolves `undefined`,
  and `undefined !== null` is true, so the default of the mock must resolve `null`, set in a `beforeEach`.
- `openMoveOf(tenantId, store = platformStore)` returns `Promise<MoveRow | null>`. `isTenantMoving` calls it with the
  tenant id only, so `toHaveBeenCalledWith(tenantId)` matches exactly.
- Precedent for the mock shape: packages/core/tests/require-auth-cut.test.ts lines 35-42 (`vi.mock(path, async
  (importOriginal) => { const original = await importOriginal<typeof import(path)>(); return { ...original, x } })`)
  and the `vi.hoisted` state object of packages/core/tests/mirror-job.test.ts. `vi.mock` is hoisted above the file's
  static imports, so the static `import { isTenantMoving } from '../server/projects/moving'` stays as it is.
- Precedent for the fixture: `row()` at the top of packages/core/tests/move-state.test.ts builds a full `MoveRow`.
- DATABASE_URL is the only variable the db client reads (packages/core/db/client.ts, through server/env.ts; the
  platform lane's `centralHandle` uses that same `sqlClient`). It cannot be used to make the database unreachable
  from the command line: Vitest builds each worker's environment as `{ ...process.env, ...config.env }`, so the
  `test.env.DATABASE_URL` placeholder in packages/core/vitest.config.ts (127.0.0.1:54322) overrides whatever the
  command sets. boss-scope.test.ts also asserts that exact placeholder string (lines 204-206), so changing the
  URL would break an unrelated assertion. The refusal therefore happens at the socket instead (Task 2).
- The local Supabase stack IS up on this machine (port 54322 accepts), which is why the old test passes locally.
- Baseline observed at planning time with the socket refusal active: `tests/project-database-state.test.ts` gives
  "16 tests | 1 failed", the failure being the old moving test with `connect ECONNREFUSED 127.0.0.1:54322`.
- packages/core/tsconfig.json includes only `db/**` and `server/**`, so `tsc --noEmit` does not type-check these two
  test files; they are checked by running them and by Biome.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Give the kernel-import test in boss-scope.test.ts an explicit 30_000 ms timeout</name>
  <files>packages/core/tests/boss-scope.test.ts</files>
  <read_first>
    packages/core/tests/boss-scope.test.ts (lines 105-111, the `it` to change; the rest only to leave it alone)
  </read_first>
  <action>
    In the `describe('registerJobQueues scopes', ...)` block, change the third `it`, titled 'the kernel registers its
    platform queues at import', so that its callback is followed by a second argument, the number `30_000`, the
    repo's numeric-separator style (apps/web/lib/tenant-host.test.ts uses `}, 10_000);`). The only line that changes
    is the closing `});` of that `it`, which becomes `}, 30_000);`.

    Do not change the two `await import(...)` lines or the two `expect(boss.queueScope(...)).toBe('platform')` lines,
    do not change any other test, and do not touch the file's header comment or the `vi.mock` blocks. A single
    `//` comment line directly above the `it`, saying the test loads the whole kernel and a cold CI runner needs
    more than the 5000 ms default (5696 ms measured in run 40039284864), is allowed and is the only other addition.

    Then run only this file, from the repo root, with the stack up as it is: `pnpm --filter @rede-social/core exec
    vitest run tests/boss-scope.test.ts`. It must pass with every test green.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core exec vitest run tests/boss-scope.test.ts</automated>
  </verify>
  <done>
    The `it` for the kernel-import test ends with `}, 30_000);`. `git diff -U0 packages/core/tests/boss-scope.test.ts`
    shows that closing line (and, at most, the one comment line) and nothing else; no `expect`, `await import` or
    `vi.mock` line appears in the diff. The file passes.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Make project-database-state.test.ts hermetic by mocking openMoveOf, prove both directions, then verify and commit</name>
  <files>packages/core/tests/project-database-state.test.ts</files>
  <read_first>
    packages/core/tests/project-database-state.test.ts (the whole file)
    packages/core/server/projects/moving.ts (isTenantMoving, lines 19-21)
    packages/core/server/projects/move/state.ts (MoveRow lines 54-72, openMoveOf lines 334-337)
    packages/core/tests/require-auth-cut.test.ts (lines 35-42, the importOriginal mock)
    packages/core/tests/move-state.test.ts (lines 1-50, the `row()` fixture)
    packages/core/tests/mirror-job.test.ts (lines 9-17, the vi.hoisted state object)
  </read_first>
  <behavior>
    With `openMoveOf` replaced and everything else in the module real:
    - Test 1: `openMoveOf` resolves `null` -> `isTenantMoving(tenant)` is false, and `openMoveOf` was called with that
      tenant id.
    - Test 2: `openMoveOf` resolves an open `MoveRow` (state 'copied') -> `isTenantMoving(tenant)` is true, and
      `openMoveOf` was called with that tenant id.
    - Test 3 (unchanged): the overview schema's shape has a `moving` key.
    - Every other test in the file passes untouched; the file goes from 16 tests to 17.
  </behavior>
  <action>
    Work red first, then edit. Per D-535 and DBT-48 the move table is read, and the unit lane must not need a database.

    STEP A, red evidence before touching the file. The throwaway preload already exists at
    /private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/f0c85909-1949-47b9-bc9c-fa63a69afd25/scratchpad/block-db.cjs.
    If that file is missing, recreate it at that exact path as a CommonJS script that requires `node:net`, saves
    `net.Socket.prototype.connect`, and replaces it with a function that takes the port from its first argument
    (an options object's `port`, otherwise the argument itself) and, when `String(port)` is `'54322'`, builds an
    `Error` with message 'connect ECONNREFUSED 127.0.0.1:54322' and the properties code 'ECONNREFUSED', errno -61,
    syscall 'connect', address '127.0.0.1', port 54322, schedules `this.destroy(error)` on `process.nextTick`, and
    returns `this`; for any other port it calls the saved original with the same `this` and arguments. It lives
    outside the repo and is never committed or staged.

    From the repo root run `NODE_OPTIONS="--require=<that path>" pnpm --filter @rede-social/core exec vitest run
    tests/project-database-state.test.ts`. Expect exactly one failure, the old moving test, with
    `connect ECONNREFUSED 127.0.0.1:54322`, and 15 passes. If it passes instead, the refusal is not active: fix
    the preload before going on, because everything after depends on it. Record the failure line in the SUMMARY.

    STEP B, edit packages/core/tests/project-database-state.test.ts and nothing else in it:

    1. Imports. Add `beforeEach` and `vi` to the existing `vitest` import. Add `import type { MoveRow } from
       '../server/projects/move/state';` (a type-only import; place it where Biome's import ordering wants it).
    2. Mock state and mock, placed after the imports and before the first `describe`. A `vi.hoisted` object `h`
       with one member, `openMoveOf`, a `vi.fn` typed as `(tenantId: string) => Promise<MoveRow | null>`; the type
       import is erased, so the hoisting is safe. Then `vi.mock('../server/projects/move/state', async
       (importOriginal) => ({ ...(await importOriginal<typeof import('../server/projects/move/state')>()), openMoveOf:
       h.openMoveOf }))`, the shape of require-auth-cut.test.ts. Every other export of that module stays real.
    3. A constant for the tenant id used today (`0a000000-0000-4000-8000-000000000001`) and a small `openMove()`
       function returning a `MoveRow` with all seventeen fields of the real shape, built like `row()` in
       move-state.test.ts: UUID-shaped ids for the move, the tenant (the constant above), the source project and
       the target project; `state: 'copied'`; `statusBefore: 'active'`; `actor: 'cli'`; `counts: {}`; `fingerprint`,
       `errorCode`, `leaseOwner`, `leaseUntil`, `cutoverAt`, `finishedAt` and `sourceDeletedAt` all `null`;
       `startedAt` and `updatedAt` the same fixed `Date`. Do not import the helper from move-state.test.ts.
    4. Replace the old 'moves' describe (the one whose title calls the move code a placeholder with a contract and
       cites a planning decision) with a describe titled 'the moving flag follows the move table (09.2-23, D-535)'.
       Inside it, a `beforeEach` that resets the mock and makes it resolve `null` (a bare `vi.fn` would resolve
       `undefined`, which `isTenantMoving` reads as moving). Then two tests: 'no open move: the tenant is not moving'
       (mock resolves `null`; `expect(await isTenantMoving(TENANT)).toBe(false)`; the mock was called with TENANT),
       and 'an open move row: the tenant is moving' (mock resolves `openMove()`; the result is true; the mock was
       called with TENANT). Keep the second original test, 'the overview schema has a moving flag', inside this
       describe exactly as it is, body and title.
    5. The titles of the new describe and tests must not say that the code is a placeholder and must not say 'until
       plan' anywhere. Nothing else in the file changes: the header comment, the catalog tests, the
       `summarizeDatabase` block and its `done`/`base`/`cases` fixtures stay byte-for-byte.

    STEP C, verify (all from the repo root; nothing else is run):
    (a) `pnpm --filter @rede-social/core exec vitest run tests/boss-scope.test.ts tests/project-database-state.test.ts`
        with the stack up as it is: both files green, 17 tests in the second.
    (b) the same command with `NODE_OPTIONS="--require=<the preload path>"` in front: both files green with the
        database refused. This replaces the DATABASE_URL-on-the-command-line idea, which cannot work here (see the
        Facts in the context: the vitest config's `test.env` wins over the command environment).
    (c) `pnpm --filter @rede-social/core run typecheck`.
    (d) `pnpm exec biome check packages/core/tests/boss-scope.test.ts packages/core/tests/project-database-state.test.ts`.
        If it reports only formatting or import-order fixes in these two files, apply them with the same command plus
        `--write` and run it again until it is clean; never pass any other path.
    (e) `pnpm guard:lanes`.

    STEP D, commit, and do not push. Stage the two files by explicit path only (`git add
    packages/core/tests/boss-scope.test.ts packages/core/tests/project-database-state.test.ts`); never `git add -A`
    or `git add .` (many untracked personal files exist, for example docs/LOCAL-SETUP.md); never stage
    .planning/ROADMAP.md or .planning/STATE.md here. Message style `fix(quick-261023-sfy): <what>`, for example
    'make the two CI-failing core unit tests pass without a database or a warm runner'. Project rule, which overrides
    any attribution reminder: NO Co-Authored-By trailer and no tool or Claude attribution anywhere in the message
    (public repository, identity igor.vboas noreply).
  </action>
  <verify>
    <automated>NODE_OPTIONS="--require=/private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/f0c85909-1949-47b9-bc9c-fa63a69afd25/scratchpad/block-db.cjs" pnpm --filter @rede-social/core exec vitest run tests/boss-scope.test.ts tests/project-database-state.test.ts</automated>
  </verify>
  <done>
    With the local Postgres port refused, both files pass (the second with 17 tests), and the same two files pass
    with the stack up. Typecheck, Biome on the two files and `pnpm guard:lanes` are green. The file contains
    `importOriginal`, `openMoveOf`, a `null` case and a `MoveRow` open-move case, the second original test is
    unchanged, and no title says the code is a placeholder or says 'until plan 23'. One commit exists that touches
    exactly the two test files, with no trailer; nothing was pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test process -> local Postgres :54322 | the unit lane must not cross it; CI has no database behind it |
| working tree -> public GitHub repo | many untracked personal files sit beside the two files to commit |
| executor -> .env* files | a secret-read guard blocks any read; the plan never needs one |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-sfy-01 | Tampering | the mocked `openMoveOf` could hide a real regression of the move-table read | medium | mitigate | The mock replaces only the lookup that `isTenantMoving` wraps; the SQL of `platformStore.open` stays proved by the integration/pgTAP lane named in move-state.test.ts (move-guard.test.ts and pgTAP 215), which this task does not touch or run. The unit test proves the wrapper's contract (null means free, a row means moving). |
| T-sfy-02 | Information disclosure | commit of untracked personal files or planning state | medium | mitigate | Code commit stages the two test files by explicit path; no `git add -A` or `git add .`; ROADMAP.md and STATE.md never staged; the Done criteria check `git show --stat HEAD` lists exactly two files. |
| T-sfy-03 | Information disclosure | attribution trailers or tool names in a public commit message | low | mitigate | The commit message carries no Co-Authored-By trailer and no tool attribution; checked with `git log -1 --format=%B` after the commit. |
| T-sfy-04 | Information disclosure | a secret read through .env* while deciding which env var the db client reads | low | mitigate | Decided from code only (packages/core/db/client.ts, server/env.ts, vitest.config.ts); no .env* file is read, named, grepped or catted. |
| T-sfy-05 | Denial of service | disk at 98 percent | low | accept | Only vitest, tsc, Biome and a grep guard run; no web build, turbo build or integration suite. The preload is a few lines in the scratchpad. |
</threat_model>

<verification>
Run from the repo root, in this order, and nothing else:

1. `pnpm --filter @rede-social/core exec vitest run tests/boss-scope.test.ts tests/project-database-state.test.ts` (stack up as it is).
2. The same with `NODE_OPTIONS="--require=/private/tmp/claude-501/-Users-igorvboas-Library-Developer-TRIA-rede-social/f0c85909-1949-47b9-bc9c-fa63a69afd25/scratchpad/block-db.cjs"` in front (database refused).
3. `pnpm --filter @rede-social/core run typecheck`
4. `pnpm exec biome check packages/core/tests/boss-scope.test.ts packages/core/tests/project-database-state.test.ts`
5. `pnpm guard:lanes`
6. Title gate: `grep -n -E "s[t]ub|until plan 2[3]" packages/core/tests/project-database-state.test.ts` prints nothing.
7. Diff gate: `git diff HEAD~1 --name-only` (after the commit) prints exactly the two test paths; `git log -1 --format=%B` contains neither "Co-Authored-By" nor "Claude".
</verification>

<success_criteria>
- Both files pass with the database reachable and with the database refused (the CI condition).
- The kernel-import test has an explicit 30_000 ms timeout and unchanged assertions.
- `isTenantMoving` is proved false for no open move and true for an open `MoveRow`, with no database.
- Typecheck, Biome (the two files) and the lane guard are green; one commit, two files, no trailer, not pushed.
</success_criteria>

<output>
Create `.planning/quick/261023-sfy-make-the-two-ci-failing-core-unit-tests-/261023-sfy-SUMMARY.md` when done.
</output>
