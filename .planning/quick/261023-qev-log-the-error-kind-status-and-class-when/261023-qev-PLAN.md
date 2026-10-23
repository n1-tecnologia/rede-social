---
phase: quick-261023-qev
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/server/projects/bootstrap.ts
  - packages/core/tests/project-bootstrap-failure-log.test.ts
autonomous: true
requirements: [DBT-17]
tags: [bootstrap, observability, logging, diagnostics, project-provider, quick]

estimate:
  tokens: 25000
  raw_tokens: 25000
  tasks: 1
  confidence: low

must_haves:
  truths:
    - "The `project.bootstrap.step_failed` warning written by the catch block of `runBootstrap` (bootstrap.ts, around lines 369-383) gains exactly these fields and no others: `errorName` always; `kind`, `status` and `code` only when the thrown value is a ProjectProviderError (`code` only when that error carries one). Every other field of the line (event, projectId, step, attempt, reason), the message 'bootstrap step failed', the no-tenant warning, the info lines, the stored reason code, the returned RunOutcome, the API response and the UI stay byte-for-byte what they are."
    - "`errorName` is the CLASS identifier of an Error (its constructor's name, falling back to the literal 'Error' when the constructor is anonymous) and `typeof` of anything that is not an Error. It is never the error's own `name` property and never its message: a missing smtp password (a BootstrapStepError), a TypeError raised by buildAuthConfigBody, and a ProjectProviderError from the Management API now log three different class names for the same reason code auth_config_failed."
    - "Nothing that could carry a secret reaches the line: no message, no stack, no cause, no provider response body, no value, host, token or key (D-539; the `reasonOf` rule 'the error's message is never read' in reasons.ts is kept and reasons.ts is not edited). A Vitest file proves it by giving the thrown errors secret-shaped message text (a Resend-style key, a database password, a connection string, a secret key, a JWT, a project host) and asserting that none of it, and no key outside the allow-list, appears in the logged object; a getter on the message proves it is read zero times."
    - "A new hermetic Vitest file packages/core/tests/project-bootstrap-failure-log.test.ts drives the REAL `runBootstrap` with its collaborators replaced (recording logger, in-memory platform transaction, mocked registry/steps/job/host cache) and proves: (1) ProjectProviderError('invalid', 400) logs kind invalid and status 400, (2) a plain TypeError logs errorName TypeError with no kind, (3) the logged object never contains the error message text or any secret-shaped value. No database, no network, no .env file is touched."
    - "Scope is exactly two files: bootstrap.ts and the new test. steps.ts (which a static test pins to contain no log call), auth-config.ts, reasons.ts, types.ts, the API, the UI and everything under .planning/phases/ are untouched."
  artifacts:
    - path: "packages/core/server/projects/bootstrap.ts"
      provides: "a private failureFields helper and its use in the step_failed warning"
      contains: "errorName"
    - path: "packages/core/tests/project-bootstrap-failure-log.test.ts"
      provides: "the hermetic proof of what the failed-step log line carries and never carries"
      contains: "ProjectProviderError('invalid', 400)"
  key_links:
    - from: "packages/core/server/projects/bootstrap.ts catch block of runBootstrap"
      to: "packages/core/server/projects/types.ts ProjectProviderError (kind, status, code)"
      via: "instanceof on the class that reasons.ts already uses; the three public fields are read, the message never is"
      pattern: "ProjectProviderError"
    - from: "packages/core/tests/project-bootstrap-failure-log.test.ts"
      to: "packages/core/server/projects/bootstrap.ts runBootstrap"
      via: "vi.mock of logging, platform-tx, project-registry, tenant-host, bootstrap-job and steps; the real bootstrap.ts, reasons.ts and types.ts run"
      pattern: "runBootstrap"
---

<objective>
Make a failed bootstrap step diagnosable from the worker log.

On 2026-10-23 a real bootstrap against a hosted Pro Supabase project failed twice at step 4 (auth) in under one
second with `auth_config_failed`, and the hosted Auth custom SMTP setting stayed off. Four different causes end
in that one code and the stored data (`platform.project_bootstrap_steps.reason_code`) and the worker log both
carry only the code:

  - a missing smtp password: a BootstrapStepError thrown by the `auth` step in steps.ts;
  - a TypeError from `buildAuthConfigBody` (the `refuse` helper in auth-config.ts);
  - a failed `getAuthConfig` GET (a ProjectProviderError);
  - a Supabase 400 on the PATCH (a ProjectProviderError of kind `invalid`).

Purpose: add to the `project.bootstrap.step_failed` log line, and to nothing else, the error's class name and,
for a provider error, its kind, status and code, so the next failure says which of the four it was. D-539 (a
credential is never logged) and D-542 (the bootstrap stores a reason CODE per step) both stay: the line gains
identifiers only, never a message, a response body, a value, a host, a token or a secret.

Output: one private helper and one spread in bootstrap.ts, plus one new hermetic Vitest file. One commit.

Tracer note: the whole change is a single log call fed by one helper, so the one task below is itself the
end-to-end slice (a thrown error goes in, a log object comes out, asserted by a test that runs the real engine
loop); there is no second layer for an expansion task to build out.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@packages/core/server/projects/bootstrap.ts
@packages/core/server/projects/reasons.ts
@packages/core/server/projects/types.ts

This is a quick task that runs alongside Phase 09.2 (paused at human checkpoints). Do not touch anything under
.planning/phases/, STATE.md or ROADMAP.md in the code commit. Do not read, cat or grep any `.env*` file.

Facts the executor needs and should not re-derive (all read at planning time):

- `bootstrap.ts` builds its logger with `moduleLogger('project-bootstrap')` from '../logging' at module load;
  `runBootstrap(projectId, deps)` loops `BOOTSTRAP_STEPS`, skips rows already `done`, claims the next one with
  `claimStep` (a platform-transaction `execute` returning `[{ attempt }]`), then calls
  `STEP_RUNNERS[step](context)` inside the try; the catch computes `reason` (a BootstrapStepError's own reason,
  else `reasonOf(error, step)`), calls `failStep`, logs the warning and returns `{ status: 'failed', step, reason }`.
- `ProjectProviderError` (types.ts) has readonly `kind` (closed union), `status` (number, 0 when no answer) and
  `code` (`'org_mismatch' | undefined`); its message is only `<kind> <status>`.
- `reasonOf`: forbidden -> access_denied; timeout/unavailable/not_ready -> unreachable; everything else is the
  step's own code. At step `auth`, a ProjectProviderError('invalid', 400) therefore yields `auth_config_failed`
  and ProjectProviderError('forbidden', 403, 'org_mismatch') yields `access_denied`.
- packages/core/tsconfig.json includes only `db/**` and `server/**`, so `tsc --noEmit` type-checks bootstrap.ts
  but NOT the test file; the test is checked by running it. packages/core/vitest.config.ts includes
  `tests/**/*.test.{ts,tsx}`, runs on node, and sets placeholder env values, so no .env is needed.
- Existing coverage of the engine is the integration file apps/api/tests/integration/project-bootstrap.test.ts,
  which needs a database and is NOT run here. No unit test imports bootstrap.ts today, hence the new file.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Log the error's class name and the provider error's kind, status and code on a failed bootstrap step, with a hermetic proof</name>
  <files>packages/core/tests/project-bootstrap-failure-log.test.ts, packages/core/server/projects/bootstrap.ts</files>
  <read_first>
    packages/core/server/projects/bootstrap.ts (the whole file; the catch block is at the end of the step loop)
    packages/core/server/projects/reasons.ts (reasonOf and the 'message is never read' rule)
    packages/core/server/projects/types.ts (ProjectProviderError)
    packages/core/tests/mirror-job.test.ts (the vi.hoisted + vi.mock + top-level `await import` pattern this repo uses for a unit test of a job module)
    packages/core/tests/project-auth-config.test.ts (the static test that pins steps.ts to zero log calls; it must keep passing)
  </read_first>
  <behavior>
    Driving the real runBootstrap with verify, roles and schema already done and the `auth` runner rejecting:
    - Test 1: ProjectProviderError('invalid', 400) -> outcome failed at auth with reason auth_config_failed; the
      step_failed fields include errorName ProjectProviderError, kind invalid, status 400 and NO `code` key.
    - Test 2: ProjectProviderError('forbidden', 403, 'org_mismatch') -> reason access_denied; fields carry kind
      forbidden, status 403 and code org_mismatch.
    - Test 3: a plain TypeError -> reason auth_config_failed; errorName TypeError; the fields have no `kind`, no
      `status` and no `code` key.
    - Test 4: a BootstrapStepError('auth_config_failed') (the missing-smtp-password cause) -> errorName
      BootstrapStepError, no kind; so the four causes of the incident are told apart.
    - Test 5 (it.each): a thrown string, an object carrying a `message`, undefined, null and a number -> errorName is
      `typeof` the value (string, object, undefined, object, number), no kind, reason is the step's own code.
    - Test 6: an Error subclass whose own `name` property was overwritten with a secret-shaped string still logs
      its constructor name; an anonymous Error subclass logs 'Error'.
    - Test 7 (never leaks): for a TypeError, a ProjectProviderError whose message was overwritten, a thrown string
      and a thrown object, all carrying secret-shaped text, the failure line has only keys from the allow-list
      (attempt, code, errorName, event, kind, projectId, reason, status, step), every value is a string or a
      number, the JSON of the whole recorded entry contains none of the secret-shaped tokens nor the full message
      text, and a getter installed on the Error's `message` is read zero times.
    - Test 8: the failed step is still stored with its reason code only (the recorded update payload of the fail
      is status failed and reasonCode auth_config_failed), and the info line for the started step is still
      written, so nothing but the one warning changed.
  </behavior>
  <action>
    Work test-first (TDD, per D-539 and D-542 as stated in the objective). No TAP red-evidence gate is needed for
    this quick task: just run the new file once before touching bootstrap.ts, confirm the new-field assertions
    fail for the right reason (a missing `errorName`/`kind`, not an import or mock error), then implement.

    STEP A - create packages/core/tests/project-bootstrap-failure-log.test.ts.
    Open with a short comment block saying: unit level, no database, no network; the engine's integration suite
    lives in apps/api/tests/integration/project-bootstrap.test.ts and is not run here; what is proved is the
    content of the `project.bootstrap.step_failed` line (quick 261023-qev, D-539).

    Imports: `beforeEach`, `describe`, `expect`, `it`, `vi` from 'vitest'; `projectBootstrapSteps` from
    '../db/central' (the REAL table object, used by identity so the fake transaction can tell the step-row read
    from the tenant-binding read); `ProjectProviderError` from '../server/projects/types'.

    Hoisted shared state (`vi.hoisted`, the pattern of mirror-job.test.ts): `logged` (an array of
    `{ level, fields, message }`), `logger` (an object with `info`, `warn` and `error` that push to `logged`,
    taking the pino argument order `(fields, message)`), `tx` (a slot, assigned after the imports, that holds the
    fake transaction), `stepRows` (what the step-row read returns), `sets` (every payload passed to an `update(...).set(...)`),
    and `runners` (one `vi.fn()` per step key, in the eight names verify, roles, schema, auth, buckets,
    realtime, tenant, invite, defaulting to a resolved undefined).

    Module mocks, all by the paths the TEST sees (they resolve to the same files bootstrap.ts imports):
    - '../server/logging': `moduleLogger` returns the hoisted `logger`.
    - '../db/platform-tx': `withPlatformTx` runs its callback with the hoisted `tx` slot.
    - '../server/tenancy/project-registry': `resolveProjectById` resolves a minimal registry row (a UUID id, a
      20-character ref, `isCentral: false`, `credentialSource: 'sealed'`, `state: 'preparing'`) and
      `invalidateProject` is a no-op `vi.fn()`.
    - '../server/tenancy/tenant-host': `invalidateTenantHost` is a no-op `vi.fn()`.
    - '../server/projects/bootstrap-job': `enqueueBootstrap` is a `vi.fn()`.
    - '../server/projects/steps': a factory that does NOT load the real module (the real one drags in the mail,
      Supabase admin and migrations import chain, which no unit test loads). It defines a stand-in
      `BootstrapStepError` class inside the factory (extends Error, sets `name` to 'BootstrapStepError', keeps a
      readonly `reason`, message `bootstrap step failed: <reason>`, mirroring steps.ts), and returns it together
      with `STEP_RUNNERS` set to the hoisted `runners` and `defaultStepDeps` returning an empty object. Say in a
      comment that the stand-in is deliberate and mirrors the real class's name and shape.

    Load the module under test after the mocks with a top-level `await import('../server/projects/bootstrap')`
    for `runBootstrap`, and `await import('../server/projects/steps')` for the stand-in `BootstrapStepError`.

    The fake transaction (a plain object assigned to the hoisted `tx` slot): a small helper builds a chainable,
    thenable link whose `from`, `where`, `orderBy`, `limit`, `values` and `onConflictDoNothing` return the same
    link and whose `then` resolves to a result. `select()` returns a link that records the table given to
    `from` and resolves to the hoisted `stepRows` when that table is `projectBootstrapSteps` and to an empty
    array otherwise (the tenant-binding read); `insert()` resolves to undefined; `update()` returns an object
    whose `set(values)` pushes `values` onto `sets` and returns a link resolving to undefined; `execute()` is an
    async function resolving to an array holding one `{ attempt: 1 }` (the claim). `beforeEach` clears `logged`
    and `sets`, resets every runner to resolve undefined, and rebuilds `stepRows` as eight rows for a fixed
    project UUID with verify, roles and schema `done` (attempt 1) and auth, buckets, realtime, tenant and invite
    `pending` (attempt 0), each row carrying projectId, step, status, attempt, reasonCode null, startedAt null,
    finishedAt null.

    A `failAtAuth(thrown)` helper: `runners.auth.mockRejectedValueOnce(thrown)`, then await `runBootstrap`
    with the fixed project id and deps `{ provider: <a bare object>, tenantsToSeed: async () => [<a tenant UUID>] }`
    so neither the provider singleton nor the move lookup is touched, and return the outcome. A `failureLine()`
    helper returns the single recorded entry whose `fields.event` is 'project.bootstrap.step_failed' (assert
    exactly one exists; avoid a non-null assertion operator: destructure and throw if absent).

    Secret-shaped fixtures: a list of tokens (a Resend-style `re_live_...` key, a database password, a
    `sb_secret_...` key, a three-part JWT starting `eyJ`, a `db.<20 chars>.supabase.co` host) and one message
    string that embeds all of them plus a `postgres://api_user:<password>@<host>:5432/postgres` URL. Use that
    message for the TypeError, the overwritten ProjectProviderError message (assign to its `message` after
    construction), the thrown string and the thrown object's `message`. For the zero-reads proof, install the
    getter on the Error with `Object.defineProperty(error, 'message', { get })`, counting reads in a closure.

    Write the eight behaviours listed above, using `toMatchObject` for the positive fields and
    `not.toHaveProperty` for the absent ones (kind, status and code on a non-provider error; code when the
    provider error has none). Assert the returned outcome of tests 1-4 (`status: 'failed'`, step 'auth', the
    expected reason) so the reason codes are shown to be unchanged. Run it now (command in <verify>) and
    confirm it is RED for the right reason.

    STEP B - edit packages/core/server/projects/bootstrap.ts, nothing else:
    1. Change the type-only import `import type { ProjectProvider } from './types'` into a mixed import that
       also brings in the class as a value: `type ProjectProvider` first, then `ProjectProviderError` (the order
       Biome's import sorter uses; the same file already mixes `type` and value specifiers on its reasons import).
    2. Add a private, non-exported function `failureFields(error: unknown)` just above `runBootstrap` (after
       `stepDeps`), with a doc comment stating its contract: it returns identifiers only, from a closed set;
       the error's message, stack, cause and any response body are never read (D-539, the rule in reasons.ts).
       Behaviour: a value that is not an `Error` returns `{ errorName: typeof error }`; an `Error` returns
       `errorName` equal to the name of its constructor when that is a function with a non-empty name, else the
       literal 'Error' (read the constructor, NOT the instance's `name` property, which a provider or a bug can
       overwrite); when the error is also a `ProjectProviderError`, add `kind` and `status`, and add `code`
       only when it is defined. Give it an explicit return type of the shape
       `{ errorName: string; kind?: string; status?: number; code?: string }`.
    3. In the catch block, spread `...failureFields(error)` into the existing `log.warn` field object, after
       `reason`. Leave the message text 'bootstrap step failed', the `reason` computation, `failStep`, the
       return value, the no-tenant warning and every info line exactly as they are.
    4. Refresh the file header comment's last paragraph (the one saying every log line is built from ids, step
       keys, attempts and reason codes) so it stays true: a failed step's line also names the error's class and,
       for a provider error, its kind, status and code, never its message. In that comment do not write the
       dotted property access for the message; say "the message".

    Do NOT edit reasons.ts, types.ts, steps.ts, auth-config.ts, any API or UI file. Do not add a field beyond
    `errorName`, `kind`, `status`, `code`. Do not widen the log of the no-tenant refusal.

    STEP C - verify (commands in <verify>), then commit with explicit paths only:
    `git add packages/core/server/projects/bootstrap.ts packages/core/tests/project-bootstrap-failure-log.test.ts`,
    check `git diff --cached --name-only` lists exactly those two paths, then commit with a message of the form
    `fix(quick-261023-qev): name the error class, and the provider error's kind, status and code, on a failed bootstrap step`
    plus a short body. The message carries NO Co-Authored-By trailer and NO tool or Claude attribution (public
    repository; the project's commit rule overrides any attribution reminder). Never use `git add -A` or
    `git add .`, never stage STATE.md, ROADMAP.md or any untracked personal file (for example docs/LOCAL-SETUP.md).
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/core exec vitest run tests/project-bootstrap-failure-log.test.ts tests/project-auth-config.test.ts && pnpm --filter @rede-social/core run typecheck</automated>
  </verify>
  <done>
    The new test file passes (all eight behaviours) together with project-auth-config.test.ts (which keeps steps.ts
    free of log calls), and `tsc --noEmit` for packages/core passes. A ProjectProviderError('invalid', 400) logs
    errorName ProjectProviderError, kind invalid, status 400; a TypeError logs errorName TypeError with no kind,
    status or code; a BootstrapStepError logs errorName BootstrapStepError; a non-Error logs its typeof; the logged
    object has only allow-listed keys, primitive values, none of the secret-shaped tokens or the message text, and
    the message getter was read zero times. The outcome, reason codes and stored reason are unchanged. Exactly two
    files are committed, in one commit with no trailer and no attribution.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Management API / Postgres / Auth to worker | Errors raised by hosted-project calls carry provider-controlled text (messages, bodies) that must not reach the worker log |
| Worker log to Cloud Logging | Structured lines are readable by anyone with log access; they must hold identifiers only (D-539) |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-qev-01 | Information Disclosure | `failureFields` and the `step_failed` warning in bootstrap.ts | high | mitigate | The helper emits an allow-list of four scalar identifiers (`errorName`, `kind`, `status`, `code`); it never reads the message, stack, cause or a response body, and never spreads the error. The Vitest file asserts the key allow-list, primitive-only values, absence of every secret-shaped token and of the full message text, and zero reads of a message getter, for an Error, a ProjectProviderError with a tampered message, a string and an object. |
| T-qev-02 | Information Disclosure | `errorName` derived from a provider-controlled `name` property | medium | mitigate | `errorName` comes from the constructor's name (a code identifier), never from the instance's `name` property; the test overwrites `name` with a secret-shaped string and asserts the constructor name is logged instead. |
| T-qev-03 | Information Disclosure | `kind`, `status`, `code` values | low | accept | `kind` is a closed union, `status` is an HTTP number (0 when no answer), `code` is the literal `org_mismatch` or absent; none can carry free text. |
| T-qev-04 | Tampering | Log injection through the logged strings | low | accept | The logger is pino with structured JSON output, which escapes the values; the only strings added are a class identifier, a closed-union kind and a literal code. |

No package is installed or upgraded by this plan, so there is no package-legitimacy checkpoint.
</threat_model>

<verification>
Run only these two commands (the quick-task constraint forbids database resets, the integration suites, builds and the web app):

1. `pnpm --filter @rede-social/core exec vitest run tests/project-bootstrap-failure-log.test.ts tests/project-auth-config.test.ts`
2. `pnpm --filter @rede-social/core run typecheck`

Source coverage audit (GOAL / REQ / RESEARCH / CONTEXT):

| Source | Item | Covered by |
|--------|------|-----------|
| GOAL | A failed bootstrap step is diagnosable (the four causes of `auth_config_failed` can be told apart) | Task 1, `errorName` + provider `kind`/`status`/`code` |
| GOAL | Add `errorName` (constructor name, or typeof for non-Errors) and, for a ProjectProviderError, `kind`, `status`, `code`, and nothing else | Task 1 step B items 2-3; tests 1-6 |
| GOAL | Never log or return the message, a response body, a value, a host, a token or a secret; D-539 and the reasonOf rule stay | Task 1 step B (helper contract), test 7, T-qev-01/02 |
| GOAL | Do not change reasonOf, the reason codes, the API response or the UI | Scope: only bootstrap.ts and the new test; outcome and stored reason asserted unchanged (tests 1-4, 8) |
| GOAL | Test (1) invalid/400 logs kind and status; (2) a TypeError logs errorName with no kind; (3) no message text or secret-shaped value | Tests 1, 3 and 7 |
| REQ | DBT-17 (bootstrap steps persist status and a reason code): cited as the nearest requirement; this plan does not complete it and changes no requirement status | frontmatter `requirements` |
| RESEARCH | none for a quick task | n/a |
| CONTEXT | D-539 (credentials never logged), D-542 (reason CODE per step, no provider text) | Task 1 action, T-qev-01 |

Known limit, not a gap: when both the GET and the PATCH of the Auth config fail with the same provider kind and
status, the line cannot say which call failed, because naming the call would mean touching steps.ts, which a
static test pins to zero log calls and which is out of this task's scope. The reason code already restricts the
possible provider kinds at step `auth` to not_found, rate_limited, invalid and conflict (forbidden, timeout,
unavailable and not_ready map to other codes).
</verification>

<success_criteria>
- The two verification commands pass.
- `git show --stat HEAD` lists exactly packages/core/server/projects/bootstrap.ts and packages/core/tests/project-bootstrap-failure-log.test.ts.
- The commit message has no Co-Authored-By trailer and no tool or Claude attribution.
- No file under .planning/phases/, no STATE.md, no ROADMAP.md and no untracked personal file was staged or modified by this task.
</success_criteria>

<output>
Create `.planning/quick/261023-qev-log-the-error-kind-status-and-class-when/261023-qev-SUMMARY.md` when done
</output>
