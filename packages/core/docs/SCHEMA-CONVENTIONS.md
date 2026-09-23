# Schema conventions

**Status:** Foundation deliverable (phase 01, plan 01-03). This document is the **review checklist
for every table added by every later module**. A PR that adds a table and does not satisfy every
rule below is not mergeable.

Source: `.planning/research/PITFALLS.md` §9 (schema decisions that force a V2 rewrite), §3 (global
identity), §6 (tables stay in `public`), §15 (blocking per request); `ROADMAP.md` "Cross-cutting
rules"; phase 01 plans 01-01 (lanes, core tables), 01-03 (this doc, `platform_admins`, chat and
notification stubs), 01-06 (module registry), 01-08 (pgTAP isolation suite).

The one-sentence version: **V1 product rules ("only the admin posts", "chat is support only", "one
tenant per user") live in permissions and flags, never in column shapes.** Flipping V2 on must be a
settings change plus UI, not a migration that rewrites tables.

---

## (a) Tenancy

1. **`tenant_id uuid not null references tenants(id)` on every tenant-owned row** — even when it is
   derivable through a join. The denormalisation is deliberate: RLS policies and indexes both need
   the column on the row itself.
2. **RLS is enabled on every table in `public`**, without exception: `.enableRLS()` in the Drizzle
   table definition. A table with RLS off is a tenant leak waiting for the first missing `where`.
3. **The isolation policy is always `tenant_id = app.tenant_id()`**, added through
   `tenantIsolationPolicy('<table>_tenant_isolation')` (`packages/core/db/rls.ts`) so every table
   gets the identical `using` + `with check` pair. Do not hand-roll the predicate.
   - Tables that are *not* tenant-owned are the rare exception and must be justified in the PR:
     `users` (global identity, own-row policy) and `platform_admins` (no policy at all — admin lane
     only; see (b)).
4. **Every list query has a matching index**, `(tenant_id, created_at desc)` for feeds/inboxes or
   `(tenant_id, <fk>)` for lookups. Policies are evaluated per row; an unindexed `tenant_id` turns
   isolation into a sequential scan.
5. Keep policy predicates cheap and index-friendly. No correlated subqueries over large tables
   inside `using`; if authorisation needs a join, put it in a `security definer` function in the
   `app` schema (like `app.membership_for_user`) and keep the policy a comparison.

## (b) Identity and membership

1. **`public.users` mirrors `auth.users`** (trigger `on_auth_user_created`) and holds global
   identity only: `id`, `email`, `name`. It has **no `tenant_id` and no `role`** (PITFALLS §3).
2. **`memberships` is the tenant-scoping noun**: `(tenant_id, user_id, role, status, joined_at,
   blocked_at, deleted_at)`. Authorisation reads `memberships`, never a column on the user.
3. V1's "one tenant per user" is the droppable partial index `memberships_one_tenant_per_user_v1`.
   **Dropping that index is the entire V2 multi-tenancy migration** (ROLE-02) — nothing else may
   encode the assumption.
4. **Profile data hangs off the membership** (Phase 3), not off `users`: a person may present
   differently in different tenants.
5. **`super_admin` is not a membership role.** It lives in `platform_admins` (`user_id` pk), which
   has RLS enabled and **no policy for `authenticated`** — the tenant lane can never see a row.
   Only the admin lane (`withAdminTx`) behind `requireSuperAdmin()` reads it. `memberships.role` is
   CHECK-constrained to `admin_tenant | support_tenant | member`.

## (c) Authorship and permissions

1. **Authorship is a generic `author_user_id` / `created_by_user_id` referencing `users.id`.** Never
   an FK to a role-specific table (`admins.id`), never a role-flavoured boolean (`from_support`),
   never a role-specific column name (`admin_id`).
2. **Who *may* author is a permission check in the API**, gated by the tenant's flags — e.g.
   `can('post.create', membership)` plus a `tenant_modules` setting. V2 member posting is therefore
   a flag flip, not a migration.
3. The same rule holds for every "only X may do Y" V1 rule: express it in the route guard and in the
   tenant's settings, and let the schema stay general. `chat_conversations.kind` allows
   `support | direct | group` from day one although V1 only creates `support`.

## (d) Lifecycle columns

1. **State is a `status text` column with a CHECK**, not a pile of booleans. One row per
   relationship with status transitions (`event_attendance.status`), never
   `is_going boolean` + `is_checked_in boolean`.
2. **Soft delete is `deleted_at timestamptz` (plus `deleted_by_user_id` where moderation needs an
   author)**, and every read filters `deleted_at is null`. Moderation must be able to see what was
   removed; hard deletes destroy evidence and break sequences.
3. **Time-based visibility is a predicate, not a cron**: stories expire through
   `expires_at > now()` in the query. A scheduled job is justified only when something must be
   *notified* or *archived*, never to hide a row a `where` can hide.
4. `created_at timestamptz not null default now()` on every table; `updated_at` where the row is
   edited.

## (e) Shared behaviours across content types

1. **One table per behaviour, with a typed target — not one table per content type.** Reactions:
   `reactions (tenant_id, user_id, target_type, target_id, kind)` with
   `unique (user_id, target_type, target_id)`; never `post_likes` + `comment_likes` +
   `story_likes`. Emoji reactions in V2 are new `kind` values.
2. **Comments** are one table with `target_type` + `parent_id` (nullable, one reply level enforced
   in the API), not `post_comments` + `story_comments`.
3. **"Exactly one target" nullable-FK tables** (a notification pointing at a post *or* a comment *or*
   an event) use nullable FKs plus a CHECK that exactly one is set, and partial unique indexes for
   the uniqueness rules that apply per target (pattern:
   `unique (event_id, user_id) where event_id is not null` on `notifications`).
4. Optional membership in a container is a **nullable FK** (`posts.community_id`), and
   many-to-many pinning gets its own table (`story_pins`) instead of an array column.

## (f) Feature flags and modules

1. **Module toggles are rows in `tenant_modules` `(tenant_id, module_key, enabled, settings jsonb)`,
   never boolean columns on `tenants`.** Adding a module is an insert, not a migration (D-16).
2. Kernel capabilities (tenancy, auth, profiles, media, moderation, platform) are **always on and
   have no flag**. Only the six toggleable keys (`feed`, `communities`, `stories`, `events`, `chat`,
   `notifications`) live in `tenant_modules`.
3. Per-module configuration goes in that row's `settings jsonb`, not in new columns on `tenants`.

## (g) Naming and placement

1. **snake_case** for every table, column, index, constraint and policy.
2. **Tables stay in `public`** with a **module prefix** (`chat_conversations`, `example_items`,
   `feed_posts`) — not one Postgres schema per module (PITFALLS §6: per-schema layouts multiply
   grants, `search_path` surprises and RLS coverage gaps).
3. Conventional suffixes: `_uq` for unique indexes, `_idx` for indexes, `_chk` for CHECK
   constraints, `_tenant_isolation` for the standard policy.
4. Drizzle file layout: kernel tables in `packages/core/db/schema/<topic>.ts` (re-exported from
   `schema/index.ts`); a module owns `packages/modules/<name>/db/schema.ts`, which
   `apps/api/drizzle.config.ts` already globs.

## (h) Migrations

1. **The Drizzle TypeScript schema is the source of truth**, including `pgPolicy(...)` and
   `.enableRLS()` — policies are code-reviewed next to the table they protect.
2. Generate with `pnpm db:generate --name=<change>` (drizzle-kit, `prefix: 'supabase'` →
   `YYYYMMDDHHmmss_name.sql` in `supabase/migrations/`), then **read the emitted SQL in the PR**.
3. **Only the Supabase CLI applies migrations**: `supabase db reset` / `pnpm supabase migration up`
   locally, `supabase db push` in CI. **Never `drizzle-kit migrate` and never `drizzle-kit push`** —
   two appliers means two history tables and guaranteed drift.
4. Anything Drizzle cannot express (functions, triggers, grants, `realtime.messages` policies,
   pg-boss schema) goes in a hand-written migration created with
   `supabase migration new <name> --custom`, in the same folder and the same order.
5. Migrations are **additive and forward-only** on shared environments. Destructive changes need an
   explicit plan; never edit a migration that has been applied anywhere.

## (i) Database lanes

1. **Request handlers reach tenant data only through `withTenantTx(ctx, fn)`** — one transaction
   that binds `set_config('request.jwt.claims', $1, true)` and runs `set local role authenticated`.
   Never query the `db` client directly from a route.
2. **`withAdminTx(fn)` (`service_role`, bypasses RLS) is kernel-only** — importable from
   `packages/core/server/{tenancy,platform}` and `scripts/` (Biome `noRestrictedImports` enforces
   it). Every use is a deliberate, reviewed exception. It is defined in `packages/core/db/admin-tx.ts`
   and nowhere else: the public `@tria/core/db/tenant-tx` entry point must never re-export it, and a
   module may not import the raw client `@tria/core/db` either (Biome, `packages/modules/**`).
3. **Every setting is LOCAL.** `set_config(..., false)` and `set role` without `LOCAL` survive on
   the pooled connection and leak into the next request — possibly another tenant's.
   `pnpm guard:lanes` (`scripts/guard-local-settings.sh`) fails CI on both shapes.
4. **The connection role `api_user` is `NOINHERIT`** and holds no privileges of its own: a query
   outside a lane fails with SQLSTATE `42501` instead of running unscoped.
5. Never use the `postgres` role or the service-role key for tenant traffic. See
   `packages/core/db/README.md` for the lane contract, the `DATABASE_URL` shapes and the
   session-pooler fallback.

## (j) Test gate

The gate is six files. Five run inside Postgres (`pnpm supabase test db`), one runs against the live
API (`pnpm test:integration`); CI runs them in this order on every push (`.github/workflows/ci.yml`).

| File | What it refuses to let through |
|---|---|
| `supabase/tests/000-helpers.sql` | Installs pgTAP and the `tests` schema (fixtures + lane helpers). The **only** file that commits; 010–040 each undo their own transaction, so order never changes a result. |
| `supabase/tests/010-rls-coverage.sql` | Any table in `public` without RLS, and any table with a `tenant_id` column without at least one policy. Catalogue-only, so it covers tables that do not exist yet. |
| `supabase/tests/020-tenant-isolation.sql` | Cross-tenant read or write through the tenant lane, per table, with **identical-looking content on both sides**. |
| `supabase/tests/030-lanes.sql` | Privilege creep on `api_user`: it owns nothing until it opens a lane (`42501`), a claimless lane returns zero rows, and no runtime role has `rolbypassrls`. |
| `supabase/tests/040-schema-conventions.sql` | The rules on this page: no `tenant_id`/`role` on `users`, `super_admin` is not a membership role, `platform_admins` has zero policies, `consent_records` is append-only, every tenant table is indexed tenant-first, `tenant_domains` is case-proof and lane-read-only. |
| `apps/api/tests/integration/isolation.test.ts` | The same isolation one layer up: list, detail, empty, disabled module, a member blocked between two requests, a session presented on another tenant's host, the platform identity, and the public host lookup. |

**The two rules that keep the gate honest:**

1. **Every new tenant-owned table adds a case to `020-tenant-isolation.sql`** — tenant A's lane must
   see its own row and **zero** rows of tenant B, for that table specifically. 010 will already fail
   if the table has no RLS or no policy; 020 is what proves the policy is the *right* one.
2. **Every new endpoint adds a cross-tenant case to `apps/api/tests/integration/isolation.test.ts`** —
   at minimum: the other tenant's id is `404 NOT_FOUND` (never `403`), and a session of tenant A on
   tenant B's registered host is `403 TENANT_HOST_MISMATCH` with no row and no tenant name in the body.

Both files seed **identical-looking** data in the two tenants (same title, same message body, same
`member@…` local part) on purpose: a query that filtered on a value instead of on `tenant_id` would
otherwise pass by returning something that merely looks right. Every assertion compares ids.

The two-tenant isolation suite is the **exit gate of every phase** (TENANT-05), not a Phase 1
artifact.

## (k) Checklist for a new module

Copy this into the PR description and tick every line (shape of `@tria/module-feed`, the reference module since 04-10 closed D-19):

- [ ] Module is its own package `packages/modules/<name>` with `db/schema.ts`, routes, service and
      UI; it depends on the kernel and on other modules' published contracts only.
- [ ] Every table carries `tenant_id uuid not null references tenants(id)`, `created_at`, and a
      soft-delete / `status` column where the domain needs one.
- [ ] Every table has `.enableRLS()` **and** `tenantIsolationPolicy('<table>_tenant_isolation')`.
- [ ] Every list query has a `(tenant_id, ...)` index.
- [ ] Authorship is `author_user_id` / `created_by_user_id` → `users.id`; no role-specific FKs or
      booleans; who may write is a permission check.
- [ ] Shared behaviours reuse `reactions` / `comments` with a target type — no per-type copies.
- [ ] The module key is registered and gated by a `tenant_modules` row; routes use
      `requireModule('<name>')` and navigation reads the same flags.
- [ ] Migration generated with `pnpm db:generate`, SQL reviewed in the PR, applied only by the
      Supabase CLI.
- [ ] Handlers use `withTenantTx`; no `withAdminTx` outside the kernel; `pnpm guard:lanes` green.
- [ ] pgTAP: coverage test passes and an isolation case for each new table was added.
- [ ] Domain events are emitted after commit; fan-out and any slow work run in the worker, never
      inside the producing request (PITFALLS §15).
