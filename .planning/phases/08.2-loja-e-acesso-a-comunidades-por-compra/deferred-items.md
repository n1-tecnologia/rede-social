# Phase 08.2 deferred items

Out-of-scope discoveries logged by the plan executors (not caused by this phase's changes).

## Deferred Items

- `pnpm --filter @rede-social/contracts lint` fails on `packages/contracts/tests/text.test.ts:9` and `:15`
  status: resolved
  **Resolved:** 08.2-12 (`style(08.2-12): format the money test so pnpm lint passes`, 25b5cf7). The
  failure was never `text.test.ts`: its two `useTemplate` findings are warnings, which do not fail
  `biome check`. The one ERROR was the formatter refusing the `it.each` layout of
  `packages/contracts/tests/money.test.ts`, a file 08.2-01 created, so it failed the first stage of
  `pnpm verify` and was fixed here (`biome format --write` on that file only). The contracts lint and
  `pnpm lint` exit 0; the two warnings remain as they were before 08.2.
  **Found during:** 08.2-01 Task 1 (lint of the touched packages).
  **What:** two pre-existing `lint/style/useTemplate` errors (`'a'.repeat(40) + ' ' + 'b'.repeat(39)`), in a file
  08.2 did not touch (unchanged since before the phase). The contracts package lint is not part of any 08.2-01
  verify command; `money.ts` and `money.test.ts` lint clean. Fix with `biome check --write` on that file.

- `pnpm --filter @rede-social/api lint` fails on `apps/api/src/routes/platform/tenants.ts:2` (organizeImports)
  status: resolved
  **Resolved:** 08.2-06 (`style(08.2-06): sort imports in the platform tenants route`), `biome check --write` on
  that file only (one import line swapped, no behaviour change); `pnpm --filter @rede-social/api lint` is clean.
  **Found during:** 08.2-04 Task 1 (lint of the api package after editing its integration tests).
  **What:** biome wants `type TenantInvitesList` sorted before `TOGGLEABLE_MODULES` in the `@rede-social/contracts`
  import, last touched by 08.2-05 commit 47b54c9. Not in any 08.2-04 verify command and not a file this plan edits;
  the integration test files 08.2-04 changed lint clean. Fix with `biome check --write` on that file.
