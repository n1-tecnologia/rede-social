# Deferred items (09.2)

## 09.2-13: payments-admin P45 flake (found in the full integration run)

`apps/api/tests/integration/payments-admin.test.ts` > "09.1 concurrency > P45: two concurrent first saves of the integration leave one row with the derived id and a token that opens" answered `[500, 200]` instead of `[200, 200]` once, on the first PUT of the pair, right after a `pnpm db:reset` + seed. It passed 3 of 3 in isolation afterwards. Not related to plan 13 (payments setup path; no bootstrap, no `tenant_invites`). Suspect: the concurrent first insert of `payment_integrations` racing its unique key on a database that has never saved one. Owner: whoever next touches `packages/core/server/payments/setup.ts`.

## 09.2-11: project-bootstrap ordering flake (found in the full integration run)

`apps/api/tests/integration/project-bootstrap.test.ts` > "adjacency and order (P32, P34) > the Data API closure comes after the last ledger row, and steps run once each in order" failed once in the full run with `expected 1792723119563 to be greater than or equal to 1792723119564`: step N+1's `startedAt` was one millisecond BEFORE step N's `finishedAt`. It passed 25 of 25 when the file was re-run alone. Plan 11 changed nothing in the bootstrap. Suspect: the two timestamps come from different clocks (database `now()` for one, the process clock for the other), so a millisecond skew shows when two steps run back to back. Owner: whoever next touches `packages/core/server/projects/bootstrap.ts` (compare with a tolerance, or take both from the database).
