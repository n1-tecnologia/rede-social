# Deferred items (09.2)

## 09.2-13: payments-admin P45 flake (found in the full integration run)

`apps/api/tests/integration/payments-admin.test.ts` > "09.1 concurrency > P45: two concurrent first saves of the integration leave one row with the derived id and a token that opens" answered `[500, 200]` instead of `[200, 200]` once, on the first PUT of the pair, right after a `pnpm db:reset` + seed. It passed 3 of 3 in isolation afterwards. Not related to plan 13 (payments setup path; no bootstrap, no `tenant_invites`). Suspect: the concurrent first insert of `payment_integrations` racing its unique key on a database that has never saved one. Owner: whoever next touches `packages/core/server/payments/setup.ts`.

## 09.2-11: project-bootstrap ordering flake (found in the full integration run)

`apps/api/tests/integration/project-bootstrap.test.ts` > "adjacency and order (P32, P34) > the Data API closure comes after the last ledger row, and steps run once each in order" failed once in the full run with `expected 1792723119563 to be greater than or equal to 1792723119564`: step N+1's `startedAt` was one millisecond BEFORE step N's `finishedAt`. It passed 25 of 25 when the file was re-run alone. Plan 11 changed nothing in the bootstrap. Suspect: the two timestamps come from different clocks (database `now()` for one, the process clock for the other), so a millisecond skew shows when two steps run back to back. Owner: whoever next touches `packages/core/server/projects/bootstrap.ts` (compare with a tolerance, or take both from the database).

## 09.2-14: dashboard-owner-members gate case fails after local midnight (found in the full integration run)

`apps/api/tests/integration/dashboard-owner-members.test.ts` > "09.1 dashboard population > gate on: B and C leave every active-member figure by exactly the cut members, ..." failed in the single full run of plan 14 (2,035 of 2,036 pass) and again when the file was re-run alone, with `interactorsByBand.new` 0 instead of 4 and `reactivated` 1 and 2 instead of 0. The run happened at 00:3x in the tenant timezone (America/Sao_Paulo, 03:3x UTC); plan 11's green full run was at about 23:xx the evening before. Suspect: the fixtures place members "today" and "yesterday" relative to `now`, so a run in the first hours of the local day puts the "new" members on the previous local day. Plan 14 touches nothing near the dashboard (registry, panel routes, health, list). Not investigated further (scope boundary). Owner: whoever next touches `dashboard-owner-members.test.ts` or the 09.1 gap work; re-run the file after 03:00 local to confirm.

## 09.2-13/14: the bootstrap ordering flake is a mixed-clock stamp (confirmed by reading the code, not seen again in plan 14's run)

`packages/core/server/projects/bootstrap.ts` stamps `started_at` with the DATABASE clock (`claimStep`: `set started_at = now()`) and `finished_at` with the PROCESS clock (`finishStep` and `failStep`: `finishedAt: new Date()`), so step N+1's `started_at` can read a millisecond before step N's `finished_at`. Fix when plan 13's engine is next touched: `sql\`now()\`` in `finishStep`/`failStep`. Left alone in plan 14 on purpose (the plan text does not require it).
