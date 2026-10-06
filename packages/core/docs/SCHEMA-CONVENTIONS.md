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
3. **One membership per tenant per identity, any number of tenants** (V2-PLAT-07, 08.1): the V1
   index `memberships_one_tenant_per_user_v1` is dropped and `memberships_tenant_user_uq` on
   `(tenant_id, user_id)` is the only uniqueness. Each request runs as the membership its HOST
   selects among the user's own (D-307: `app.membership_in_tenant` on a tenant host,
   `app.memberships_of_user` plus the D-308 choice rule elsewhere); the host never grants one. Every
   read of `memberships` names the tenant — `membershipOfRecord` stays the layer-2 predicate — and
   nothing may select a membership by `user_id` alone.
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
2. **Tables stay in `public`** with a **module prefix** (`chat_conversations`, `feed_posts`,
   `feed_comments`) — not one Postgres schema per module (PITFALLS §6: per-schema layouts multiply
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
   and nowhere else: the public `@rede-social/core/db/tenant-tx` entry point must never re-export it, and a
   module may not import the raw client `@rede-social/core/db` either (Biome, `packages/modules/**`).
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

Copy this into the PR description and tick every line (shape of `@rede-social/module-feed`, the reference module since 04-10 closed D-19):

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
- [ ] Values the tenant's own members must not read (a door code, a meeting URL, a counter a
      member must not reset) → §(l): a separate table, a definer that returns outcomes, and the
      tests each pattern needs.

## (l) Secrets inside a tenant

Phase 6 (events, plans 06-01 to 06-07) was the first module with values that belong to a tenant but
must stay hidden from most of that tenant's own members: the venue check-in code and the online
meeting URL (D-207, D-217). Tenant isolation (§(a)) does not help here, because the reader and the
owner are in the same tenant. The four patterns below are what the events module settled on. The
next module that keeps a secret (Phase 7's chat and notifications are the likely next ones) copies
them rather than rediscovering them. Reference files:
`supabase/migrations/20260927145318_events.sql`, `…154335_event_attendance_guard.sql`,
`…185926_event_check_in_function.sql` and `…193130_event_enter_function.sql`; tests in
`supabase/tests/140-events.sql`, `141-event-attendances.sql` and `142-event-checkin.sql`.

1. **A separate table behind an inline role-claim policy**, for values the tenant's own members must
   not read.
   - **Why:** every member lane reads the parent table under `<table>_tenant_isolation`, so any
     column on it can be selected by any member through RLS alone. A column privilege cannot help
     either: an admin and a member are the same database role (`authenticated`), and only the
     `tenant_role` claim tells them apart.
   - **How:** the secret goes in its own table (`event_secrets`, keyed by `event_id`, with its own
     `tenant_id`). It gets `.enableRLS()` and one policy that reads the claim inline:
     `event_secrets_staff_all`, `for all to authenticated using (tenant_id = app.tenant_id() and
     app.tenant_role() = 'admin_tenant')` with the same `with check`. The predicate is an inline
     literal, not a helper function, because a helper would have to exist before a statement that
     drizzle-kit owns. This is the one sanctioned exception to "always `tenantIsolationPolicy`"
     (§(a) rule 3). The PR must say so, and 010 still passes because the table has a policy.
   - **Widening it** to another staff role is one `alter policy` plus the matching permission in the
     module manifest. Do it deliberately; nothing else changes. In V1, `support_tenant` does not
     see the door code (06-07, asked at the pilot UAT).
   - **Test it:** in pgTAP, a member lane reads **zero** rows of the secrets table for its own
     tenant's event, and the tenant's `admin_tenant` lane reads the row as the positive control, in
     the same file. Also add the usual cross-tenant case in 020. At the API, the secret is absent
     from every member-facing payload: only the manage-guarded edit read carries it.

2. **SECURITY DEFINER functions called from a module service, which return outcomes instead of
   raising.** Use this when a member must *use* a secret they cannot read, or write a row their
   lane may not write: check a code, get forwarded to a URL, bump a guess counter.
   - **Why a definer:** the comparison has to run where the secret is, inside Postgres. That way the
     secret never leaves the database on the member's path. `app.events_check_in(p_event_id,
     p_code)` compares the venue code and writes the attendance. `app.events_enter(p_event_id)`
     returns the meeting URL only on the outcomes that let the member in (`forward`, `recorded`,
     `already`), and a null URL on every refusal. The counter table
     (`event_checkin_attempts`) has a self-select policy and no write policy at all, so only the
     definer writes it.
   - **Why return outcomes instead of raising:** a `raise` rolls back the whole transaction. That
     includes the write the refusal itself must keep: a wrong code must still increment the guess
     counter, or the bound never trips. The function returns a row (`outcome`, plus whatever the
     success path needs). The service takes that row out of `withTenantTx` and maps a refusal to
     its HTTP error only after the transaction has committed.
   - **Why every statement filters by `app.tenant_id()` / `app.user_id()`:** the owner is
     `postgres`, which has `rolbypassrls`, so RLS protects nothing inside the function. Read both
     claims into locals at the top and return `not_found` when either is null. Then put
     `tenant_id = v_t` (and `user_id = v_u` for the member's own rows) on every `select`, `insert
     … on conflict … where` and `update`. A single missing predicate reads or writes another
     tenant's rows.
   - **Harden it:** `set search_path = ''` with fully qualified names, `revoke all … from public`
     (PUBLIC holds EXECUTE on every new function by default), and `grant execute … to
     authenticated` only. Add `#variable_conflict use_column` plus table aliases when the `returns
     table (…)` OUT columns share names with table columns.
   - **Test it:** in pgTAP, call the function from tenant A's lane with **tenant B's** id and assert
     `not_found` **and** that B's rows are unchanged, read through the service lane. Put A's own id
     in the same block as the positive control. Also assert the privilege facts (`authenticated`
     can execute, PUBLIC cannot) and that a claimless lane gets `not_found`. In integration, prove
     that the committed side effect survives the refusal: N refusals in N separate requests, then
     read the counter through `adminSql`.

3. **A cross-table XOR through a redundant discriminator and deferrable composite foreign keys.**
   - **Why:** "an in-person event has a venue, an online event has an `https:` URL" spans two tables
     once the URL is a secret. A CHECK cannot read another table. So the child carries a copy of
     the parent's discriminator (`event_secrets.event_format`), a composite FK pins the copy to the
     parent, and a CHECK on the child (`event_secrets_url_chk`) does the rest. The FKs are:
     - `event_secrets_event_fk (tenant_id, event_id, event_format) → events (tenant_id, id,
       format)`, backed by the unique index `events_tenant_id_format_uq`. This is the D-53
       redundant-discriminator pattern.
     - `events_secrets_fk (id) → event_secrets (event_id)` makes "every event has exactly one
       secrets row" a commit-time fact.
   - **Why deferrable:** both FKs are `deferrable initially deferred`. That is the only order that
     admits a format switch: the update to `events.format` and the update to `event_secrets.
     {event_format, meeting_url}` each break the FK until the other has run. It is also the only
     way to create the pair, since each half references the other. Referential actions still fire
     immediately (`on delete cascade`); only the check waits for commit.
   - drizzle-kit cannot express `DEFERRABLE`, so these FKs live in the hand-written half of the
     migration, below the generated statements. They are absent from the snapshot, so drizzle-kit
     never tries to drop them.
   - **Test it:** a pgTAP file rolls back and never reaches commit, so a deferred check would pass
     there vacuously. Issue `set constraints all immediate` before each `throws_ok` that expects
     the FK to fire. Include a `lives_ok('set constraints all immediate')` after a legal
     two-statement pair as the positive control.

4. **A BEFORE trigger raising SQLSTATE 23514 with a named `constraint`**, for rules a CHECK cannot
   read.
   - **Why:** a rule that compares a row with *another* table's row cannot be a CHECK. Examples: "no
     RSVP from `starts_at` on", "no check-in outside the window", "no answer on a cancelled event".
     Hiding the control in the UI is not enough, because the API, a psql session, a backfill and
     the definers of pattern 2 all write the table. A `before insert or update … for each row`
     trigger is the one place every writer passes through. It fires before the `on conflict`
     arbiter too.
   - **How:** the reference is `app.event_attendance_guard()` on `event_attendances`. It reads the
     parent row in the writer's own lane, with an explicit `tenant_id = new.tenant_id` and
     `for share`. The share lock serialises the write against a concurrent cancel or edit, without
     making two writers wait on each other. Every refusal is `raise exception using errcode =
     '23514', constraint = '<table>_<rule>', message = '<code>'` (use 23503 for a missing parent).
     The service therefore maps it exactly like a real CHECK violation: it walks the driver's cause
     chain for `code` and `constraint_name`. Do not maintain counters on the parent from inside the
     trigger. Upgrading the share lock would deadlock two concurrent writers, so read counts as
     aggregates instead.
   - **Test it:** use `throws_ok(<statement>, '23514', '<message>')` for each refusal, each with
     its positive control (the boundary pair: the last instant that is allowed and the first that is
     refused).

Pattern 4 and pattern 2 overlap on purpose. The definers write through the guarded table, so the
trigger re-checks the window for them too. The two cannot disagree: `now()` is the transaction
timestamp, and the definer reads the parent row `for share` first.
