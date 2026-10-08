# Phase 08.2 deferred items

Out-of-scope discoveries logged by the plan executors (not caused by this phase's changes).

## Deferred Items

- `pnpm --filter @rede-social/contracts lint` fails on `packages/contracts/tests/text.test.ts:9` and `:15`
  status: open
  **Found during:** 08.2-01 Task 1 (lint of the touched packages).
  **What:** two pre-existing `lint/style/useTemplate` errors (`'a'.repeat(40) + ' ' + 'b'.repeat(39)`), in a file
  08.2 did not touch (unchanged since before the phase). The contracts package lint is not part of any 08.2-01
  verify command; `money.ts` and `money.test.ts` lint clean. Fix with `biome check --write` on that file.
