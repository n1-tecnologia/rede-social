---
phase: quick-261023-qev
plan: 01
subsystem: project-bootstrap
tags: [bootstrap, observability, logging, diagnostics, project-provider, quick]
requirements: [DBT-17]
key-files:
  modified:
    - packages/core/server/projects/bootstrap.ts
  created:
    - packages/core/tests/project-bootstrap-failure-log.test.ts
decisions:
  - "errorName is the constructor's name (or typeof for a non-Error), never the instance name property or the message (D-539)"
metrics:
  tasks: 1
  files: 2
actuals:
  tasks: 1
  commits: 1
plan_head_before: b82db72aad36d64d246772cb5097d7bfc79ffab7
status: complete
---

# Quick 261023-qev: failed bootstrap step names the error class, kind, status and code

The `project.bootstrap.step_failed` warning now carries `errorName` always, and `kind`, `status` and `code` (code only when set) for a `ProjectProviderError`, so the four causes of `auth_config_failed` (missing smtp password, TypeError from `buildAuthConfigBody`, failed `getAuthConfig` GET, Supabase 400 on the PATCH) can be told apart from the worker log.

## What changed

- `packages/core/server/projects/bootstrap.ts`: a private `failureFields(error)` helper and one spread into the existing warning; `ProjectProviderError` is now a value import; header comment refreshed. The message text, `reason`, `failStep`, the returned `RunOutcome`, the no-tenant warning and all info lines are unchanged.
- `packages/core/tests/project-bootstrap-failure-log.test.ts` (new, hermetic): drives the real `runBootstrap` with a recording logger, an in-memory platform transaction and mocked registry, steps, job and host cache.

## Contract of the new fields

- `errorName`: the constructor's name; 'Error' when the constructor is anonymous; `typeof` for a non-Error. Never the instance `name` property.
- `kind`, `status`, `code`: read only from a `ProjectProviderError`.
- The error's message, stack, cause and any response body are never read.

## Verification

- `pnpm --filter @rede-social/core exec vitest run tests/project-bootstrap-failure-log.test.ts tests/project-auth-config.test.ts`: 2 files, 22 tests passed (13 in the new file, 9 in project-auth-config).
- `pnpm --filter @rede-social/core run typecheck`: exit 0.
- `biome check` on both files: clean.
- Red first: before the change, the new file had 10 failing and 3 passing tests, failing on the missing `errorName`/`kind` fields, not on an import or mock error.

## Deviations from Plan

None in behaviour. One small addition: a `biome-ignore lint/suspicious/noThenProperty` comment on the deliberately awaitable fake query link in the test (Biome flagged it).

## Known limit

When both the GET and the PATCH of the Auth config fail with the same provider kind and status, the line cannot say which call failed; naming the call would mean touching `steps.ts`, which is out of scope.

## Commit

- a660b67a: fix(quick-261023-qev): name the error class, and the provider error's kind, status and code, on a failed bootstrap step (2 files, no trailer)

## Self-Check: PASSED

Both files exist, commit a660b67a exists and lists exactly the two paths.
