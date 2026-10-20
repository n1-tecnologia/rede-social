# Deferred items (phase 09.1)

- **09.1-03, found 2026-10-20 (out of scope):** `apps/api/tests/integration/stories.test.ts` cases 5-8 of "GET /v1/stories" fail with `SEEDED_ACTIVE = 3` against 2 live stories. The seeded stories carry a 24-hour window from the moment of `db:seed`, so they age out as the clock moves (the oldest expired at 18:40 UTC). Not caused by the access-gate changes. A fresh `pnpm db:reset && pnpm db:seed` makes it green.
