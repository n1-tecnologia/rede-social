# DB lanes (`@tria/core/db`)

The API reaches Postgres through **one** connection role, `api_user` (`LOGIN NOBYPASSRLS NOINHERIT`,
granted `authenticated` and `service_role`), and through exactly **two lanes**. Nothing else may
switch roles or inject claims. This is the TENANT-03 contract; `scripts/guard-local-settings.sh`
(`pnpm guard:lanes`) fails CI on any deviation and `scripts/spike-supavisor.test.ts`
(`pnpm spike:supavisor`) proves the contract holds under connection reuse.

## The two lanes

| Lane | Function | What it does | Who may import it |
|------|----------|--------------|-------------------|
| Tenant lane | `withTenantTx(ctx, fn)` (`@tria/core/db/tenant-tx`) | One transaction: bound `select set_config('request.jwt.claims', $1, true)` + `set local role authenticated`; RLS policies read `app.tenant_id()` / `app.user_id()` / `app.tenant_role()` from those claims | Every request handler and module service. This is the default and only lane for tenant data. |
| Admin lane | `withAdminTx(fn)` (`@tria/core/db/admin-tx`) | One transaction: `set local role service_role` (bypasses RLS for that transaction only) | Kernel only: `packages/core/server/tenancy/**`, `packages/core/server/platform/**` and `scripts/**` (Biome `noRestrictedImports` rejects it anywhere else). |

Both settings are **LOCAL** (`is_local = true`, `SET LOCAL`), so they die with the transaction —
before the pooler hands the physical connection to the next request. Outside a lane `api_user` has
no table privileges of its own (`NOINHERIT`): a bare query fails with SQLSTATE `42501` instead of
silently running unscoped.

Rules:

- Never call `db` / `sqlClient` directly from a handler; go through a lane.
- Never `set role` without `LOCAL`; never `set_config(..., false)`; never `SET SESSION`. The guard
  greps `packages apps scripts` (`*.ts`, `*.sql`) for both shapes.
- Never use the `postgres` role or the service-role key for tenant traffic (PITFALLS §1).
- Keep policies index-friendly: `tenant_id = app.tenant_id()` with `(tenant_id, ...)` indexes.

## `DATABASE_URL` shapes

The lane code is identical in every environment; only the URL changes.

| Environment | `DATABASE_URL` | Pooler mode | Driver options |
|-------------|----------------|-------------|----------------|
| Local (target) | `postgres://api_user:postgres@127.0.0.1:54329/postgres` | Supabase CLI pooler (`[db.pooler]`, `pool_mode = "transaction"`) | `prepare: false`, `max: 5` |
| Local (current contingency, see "Local run") | `postgres://api_user:postgres@127.0.0.1:54322/postgres` | direct Postgres port | same |
| Staging / production API | `postgres://api_user.<project-ref>:<API_DB_PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` | Supavisor **transaction** mode (username is `[ROLE].[PROJECT-REF]`) | `prepare: false`, `max` ≤ 5 per Cloud Run instance |
| Worker (pg-boss) | `postgres://api_user.<project-ref>:<API_DB_PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` | Supavisor **session** mode | `max: 2` (pg-boss keeps long-lived listeners) |
| Migrations (CI only) | `postgres://postgres.<project-ref>:<DB_PASSWORD>@...:5432/postgres` via `supabase db push` | session | never used by the API |

`prepare: false` stays on in every mode: prepared statements are unsupported in transaction mode, and
keeping the option constant means a pooler switch is a URL change only.

## Fallback switch (if the spike fails on Supavisor 6543)

The staging run of `pnpm spike:supavisor` (plan 01-12, before the production gate) is the
authoritative proof for the hosted transaction pooler. If it fails there:

1. Change **only** `DATABASE_URL` in Secret Manager to the **session pooler** — same host, same
   username, port **5432** instead of **6543**.
2. Keep `prepare: false` and every line of `withTenantTx` / `withAdminTx` unchanged.
3. Size the pool for session mode: `max` ≤ 5 per Cloud Run instance (each pooled client holds a
   server connection for its lifetime), and keep `min-instances` small.
4. Re-run `SPIKE_DATABASE_URL=<session URL> pnpm spike:supavisor`; the same file must go green —
   it is parameterised only by `SPIKE_DATABASE_URL`, so it proves either mode.

The **fallback is a configuration switch, not a code fork.** Fallback #2 from the research — a
per-request PostgREST/Supabase client carrying the user's JWT — is **NOT recommended**: it forks the
lane abstraction (two transaction models, two typing models, two RLS entry points) and is exactly the
`add-alongside` the phase's assumption-delta decision rules out. If the staging spike fails on BOTH
pooler modes, that is a phase-split surprise to raise with the user, never a silent switch.

## Run schedule for the spike

| Run | Target | When | Status |
|-----|--------|------|--------|
| Local | Supabase CLI pooler `127.0.0.1:54329` (transaction mode), `api_user` | plan 01-03 (this plan), and on every `pnpm spike:supavisor` locally / in `ci.yml` (01-09) | see "Local run" |
| Staging | Supavisor `aws-0-sa-east-1.pooler.supabase.com:6543`, `api_user.<ref>` | plan 01-12 Task 1, before the production gate | pending |

The spike is never skipped and a skipped run is never reported as green: it needs two seeded tenants
(`SEED_PASSWORD=... pnpm db:seed`) and fails loudly if the target is unreachable.

### Local run

**Local run (2026-09-12, plan 01-03): the spike ran on the direct port 54322 — the local pooler
refused `api_user`.** Contingency chain recorded by the test itself (`spike contingency:` line):

- `api_user @ 127.0.0.1:54329` → `FATAL: (ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)`
- `api_user.rede-social @ 127.0.0.1:54329` (Supavisor `[ROLE].[PROJECT-REF]` form with the local `project_id`) → `FATAL: (ENOTFOUND) tenant/user api_user.rede-social not found`
- `postgres.rede-social` fails the same way, so the local Supavisor tenant is not addressable by `project_id` at all; the local pooler only serves its own internal user.

On the direct port the three cases (40 interleaved lanes on `max: 2`, NOINHERIT `42501`, error
isolation) are green, and `max: 2` still forces the 40 lanes to reuse two physical connections, so the
LOCAL-scope assertions are meaningful. The **staging Supavisor run in plan 01-12 is therefore the
single authoritative pooler proof** for TENANT-03. When the local CLI ships a pooler that accepts
custom roles, delete this section's contingency note and the spike will pick 54329 automatically
(the contingency only triggers on a loopback `:54329` target; explicit hosted URLs never fall back).
