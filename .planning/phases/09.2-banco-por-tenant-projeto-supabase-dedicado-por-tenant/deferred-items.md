# Deferred items (09.2)

## 09.2-13: payments-admin P45 flake (found in the full integration run)

`apps/api/tests/integration/payments-admin.test.ts` > "09.1 concurrency > P45: two concurrent first saves of the integration leave one row with the derived id and a token that opens" answered `[500, 200]` instead of `[200, 200]` once, on the first PUT of the pair, right after a `pnpm db:reset` + seed. It passed 3 of 3 in isolation afterwards. Not related to plan 13 (payments setup path; no bootstrap, no `tenant_invites`). Suspect: the concurrent first insert of `payment_integrations` racing its unique key on a database that has never saved one. Owner: whoever next touches `packages/core/server/payments/setup.ts`.
