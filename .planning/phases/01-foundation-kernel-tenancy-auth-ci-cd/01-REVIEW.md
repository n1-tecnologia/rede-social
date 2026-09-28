---
phase: 01-foundation-kernel-tenancy-auth-ci-cd
reviewed: 2026-09-14T15:48:08Z
depth: standard
files_reviewed: 89
files_reviewed_list:
  - packages/core/db/tenant-tx.ts
  - packages/core/db/admin-tx.ts
  - packages/core/db/client.ts
  - packages/core/db/rls.ts
  - packages/core/db/schema/index.ts
  - packages/core/db/schema/memberships.ts
  - packages/core/db/schema/tenant-domains.ts
  - packages/core/db/schema/tenant-modules.ts
  - packages/core/db/schema/consent-records.ts
  - packages/core/db/schema/platform-admins.ts
  - packages/core/db/schema/chat-stubs.ts
  - packages/core/db/schema/notification-stubs.ts
  - packages/core/db/schema/tenants.ts
  - packages/core/db/schema/users.ts
  - packages/core/server/env.ts
  - packages/core/server/auth/jwks.ts
  - packages/core/server/auth/require-auth.ts
  - packages/core/server/auth/context.ts
  - packages/core/server/tenancy/membership.ts
  - packages/core/server/tenancy/tenant-host.ts
  - packages/core/server/tenancy/signup.ts
  - packages/core/server/tenancy/public-tenant.ts
  - packages/core/server/platform/require-super-admin.ts
  - packages/core/server/platform/platform-admins.ts
  - packages/core/server/platform/tenants.ts
  - packages/core/server/rbac/require-role.ts
  - packages/core/server/modules/require-module.ts
  - packages/core/server/modules/flags-cache.ts
  - packages/core/server/modules/manifest.ts
  - packages/core/server/jobs/boss.ts
  - packages/core/server/events/bus.ts
  - packages/core/server/supabase-admin.ts
  - packages/core/server/http/api-error.ts
  - apps/api/src/app.ts
  - apps/api/src/env.ts
  - apps/api/src/main.ts
  - apps/api/src/worker.ts
  - apps/api/src/http/openapi.ts
  - apps/api/src/http/logger.ts
  - apps/api/src/http/request-id.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/health.ts
  - apps/api/src/routes/me.ts
  - apps/api/src/routes/platform.ts
  - apps/api/src/routes/public.ts
  - apps/api/Dockerfile
  - apps/api/package.json
  - apps/api/drizzle.config.ts
  - apps/api/tsup.config.ts
  - apps/web/proxy.ts
  - apps/web/lib/tenant-host.ts
  - apps/web/lib/supabase/server.ts
  - apps/web/lib/supabase/cookie-options.ts
  - apps/web/lib/api.ts
  - apps/web/lib/bootstrap.ts
  - apps/web/lib/platform.ts
  - apps/web/lib/env.ts
  - apps/web/app/layout.tsx
  - apps/web/app/page.tsx
  - apps/web/app/(app)/layout.tsx
  - apps/web/app/(app)/actions.ts
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/inicio/example-actions.ts
  - apps/web/app/(auth)/layout.tsx
  - apps/web/app/(auth)/SubmitButton.tsx
  - apps/web/app/(auth)/entrar/page.tsx
  - apps/web/app/(auth)/entrar/actions.ts
  - apps/web/app/(auth)/cadastro/[slug]/actions.ts
  - apps/web/app/(auth)/cadastro/[slug]/page.tsx
  - apps/web/app/(auth)/cadastro/[slug]/PasswordField.tsx
  - apps/web/app/(auth)/cadastro/[slug]/RulesSheet.tsx
  - apps/web/app/(auth)/esqueci-senha/page.tsx
  - apps/web/app/(auth)/esqueci-senha/actions.ts
  - apps/web/app/(auth)/redefinir-senha/page.tsx
  - apps/web/app/(auth)/redefinir-senha/actions.ts
  - apps/web/app/(auth)/acesso-suspenso/page.tsx
  - apps/web/app/(auth)/termos/page.tsx
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/auth/blocked/route.ts
  - apps/web/app/auth/host-mismatch/route.ts
  - apps/web/next.config.ts
  - apps/web/vercel.json
  - apps/web/i18n/request.ts
  - apps/web/turbo.json
  - apps/web/playwright.config.ts
  - apps/web/messages/pt-BR.json
  - supabase/migrations/20260912030541_app_helpers.sql
  - supabase/migrations/20260912031019_core.sql
  - supabase/migrations/20260912031029_app_membership_lookup_and_grants.sql
  - supabase/migrations/20260912031030_auth_user_mirror.sql
  - supabase/migrations/20260912205432_platform_admins_and_v2_stubs.sql
  - supabase/migrations/20260912214429_consent_records.sql
  - supabase/migrations/20260913143601_tenant_modules.sql
  - supabase/migrations/20260913150245_pgboss_schema.sql
  - supabase/migrations/20260913151120_example_items.sql
  - supabase/roles.sql
  - supabase/config.toml
  - supabase/seed.sql
  - supabase/tests/010-rls-coverage.sql
  - supabase/tests/020-tenant-isolation.sql
  - packages/modules/example/db/schema.ts
  - packages/modules/example/server/routes.ts
  - packages/modules/example/server/service.ts
  - packages/modules/example/server/jobs.ts
  - packages/modules/example/server/index.ts
  - packages/modules/example/module.ts
  - packages/modules/example/contracts/index.ts
  - packages/modules/example/ui/ExampleWidget.tsx
  - packages/modules/example/package.json
  - packages/contracts/src/auth.ts
  - packages/contracts/src/bootstrap.ts
  - packages/contracts/src/errors.ts
  - packages/contracts/src/events.ts
  - packages/contracts/src/hosts.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/legal.ts
  - packages/contracts/src/modules.ts
  - packages/contracts/src/platform.ts
  - packages/contracts/package.json
  - packages/core/package.json
  - packages/config/tsconfig.base.json
  - scripts/seed.ts
  - scripts/local-env.sh
  - scripts/db-local-role.sh
  - scripts/check-boundaries.sh
  - scripts/guard-local-settings.sh
  - .github/workflows/ci.yml
  - .github/workflows/deploy-api.yml
  - .github/workflows/keepalive-staging.yml
  - .github/workflows/seed-prod.yml
  - .dockerignore
  - biome.json
  - apps/api/tests/integration/setup.ts
  - apps/web/e2e/admin.ts
  - docs/DEPLOY.md
findings:
  critical: 3
  warning: 12
  info: 10
  total: 25
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-09-14T15:48:08Z
**Depth:** standard
**Files Reviewed:** 89 (all tier 1 read in full; tier 2 read in full; tier 3 skimmed for secrets and wrong assertions)
**Status:** issues_found

## Summary

The kernel's tenant-isolation core is sound where it matters most: `withTenantTx` injects claims with `set_config(..., true)` and `SET LOCAL ROLE authenticated` on a `NOBYPASSRLS`/`NOINHERIT` `api_user`, every tenant table has RLS plus a `tenant_id = app.tenant_id()` policy, `platform_admins` is policy-less, `app.membership_for_user()` is `security definer` with an empty `search_path`, the JWT is verified against JWKS with issuer and audience pinned, the membership row (not the JWT and not the host) is the tenant of record, and the host header can only deny. The pgTAP suite covers the isolation predicates and the Supavisor lane guard is enforced in CI. Session cookies are HttpOnly, the recovery landing guards `next`, and no secrets are committed (`signing_keys.json`, `.env*` are ignored; local-only defaults are documented as throwaways).

Three things must be fixed before this phase can be considered shippable:

1. The `ROLE=worker` process never binds a port, but `deploy-api.yml` deploys it as a Cloud Run **service**. Cloud Run's startup probe will fail and the worker revision will never become ready, in staging and production.
2. GoTrue's own public sign-up is left enabled (`enable_signup = true`, confirmations off), so anyone with the publishable key can create identities that bypass the API's tenant + consent flow. Because `auth.users.email` is global, an attacker can pre-register a victim's e-mail and permanently lock them out of `POST /v1/public/signup` (409 with no recovery path).
3. The "admin lane is kernel-only" Biome rule restricts `@rede-social/core/db/admin-tx`, but `withAdminTx` is exported from `@rede-social/core/db/tenant-tx` as well — the public entry point every module already imports. The single enforcement of the `service_role` boundary is bypassable with a one-line import change and no lint error.

The warnings cluster around three themes: the event bus and job queue promise guarantees the code does not actually deliver (events flushed after a rolled-back handler; `singletonKey` provides no idempotency on a `standard` queue; the `finally` in `enqueueInTx` masks the real error), the public API accepting attacker-controlled inputs it treats as trusted (`X-Client-IP`, unbounded host cache keys, unlimited sign-up rate), and the `memberships` RLS policy being `FOR ALL` while every other core table is select-only in the tenant lane.

## Critical Issues

### CR-01: Worker is deployed as a Cloud Run service but never listens on `$PORT`

**File:** `apps/api/src/worker.ts:17-38`, `apps/api/src/main.ts:15-16`, `.github/workflows/deploy-api.yml:160-173` and `:243-256`
**Issue:** `startWorker()` starts pg-boss and returns; the `ROLE=worker` branch of `main.ts` never calls `serve()`. Both `worker-staging` and `worker` are deployed with `google-github-actions/deploy-cloudrun@v3` as Cloud Run **services** (`--min-instances=1 --no-cpu-throttling`). A Cloud Run service must accept TCP connections on `PORT` (8080 per the Dockerfile) during the startup probe window, or the revision is marked failed ("container failed to start and listen on the port"). The deploy step will fail for every environment, and because `migrate-and-deploy-prod` runs migrations before the API/worker deploys, a production run would leave migrations applied with the worker undeployed. Cloud provisioning was deferred to 01.1 so this has never been exercised against a real Cloud Run project; the Docker smoke only verified the `ROLE=api` branch.
**Fix:** Either bind a minimal health listener in the worker branch, or deploy the worker as a Cloud Run worker pool / job instead of a service. Minimal in-process fix:
```ts
// apps/api/src/worker.ts (inside startWorker, after boss.start())
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
const probe = new Hono().get('/v1/health', (c) => c.json({ ok: true, service: 'worker', role: env.ROLE }));
const server = serve({ fetch: probe.fetch, port: env.PORT });
// and close `server` in the SIGTERM handler before/alongside boss.stop()
```
Add a Docker/CI smoke for `ROLE=worker` that asserts the container answers on `PORT` so the property is verified the same way the API's DB-free boot is.

### CR-02: GoTrue public sign-up remains enabled, bypassing the API's tenant + consent sign-up and enabling e-mail squatting

**File:** `supabase/config.toml:175` (`[auth] enable_signup = true`), `:220` (`[auth.email] enable_signup = true`), `:225` (`enable_confirmations = false`); consequence in `packages/core/server/tenancy/signup.ts:148-167`
**Issue:** The design states the API is "the only party allowed to bind an identity to a tenant" and that consent must be recorded before an identity exists (AUTH-01/AUTH-04). But `POST {SUPABASE_URL}/auth/v1/signup` is reachable by anyone holding `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (shipped in the browser bundle), and with confirmations off the account is immediately usable. Effects: (a) identities with no membership and no consent records appear in `auth.users` and, via the mirror trigger, `public.users`; (b) since `auth.users.email` is globally unique, an attacker can register any target e-mail first — the real person then gets `409 EMAIL_ALREADY_REGISTERED` from `signupMember` forever, and even a password recovery only hands them an orphan identity that still cannot join (`existingIdentityForEmail` reports it as "existing" and there is no join-existing-identity path). `admin.createUser` (used by `signupMember` and the seed) is unaffected by `enable_signup`, so disabling it costs nothing.
**Fix:**
```toml
# supabase/config.toml
[auth]
enable_signup = false           # identities are created only by the API (admin.createUser) and the seed
[auth.email]
enable_signup = false
```
Push the same setting to the hosted projects (`supabase config push` already runs in both deploy jobs). Add an integration test that `POST /auth/v1/signup` with the publishable key returns 4xx.

### CR-03: The admin-lane import restriction is bypassable — `withAdminTx` is exported from the unrestricted `tenant-tx` entry point

**File:** `packages/core/db/tenant-tx.ts:42-47`, `packages/core/db/admin-tx.ts:1-2`, `packages/core/package.json` (`"./db/tenant-tx"` export), `biome.json:40-52`
**Issue:** `withAdminTx` (which runs `SET LOCAL ROLE service_role`, bypassing every RLS policy) is defined and exported in `tenant-tx.ts`; `admin-tx.ts` merely re-exports it. Biome's `noRestrictedImports` only lists `@rede-social/core/db/admin-tx` and `@rede-social/core/server/supabase-admin`. `@rede-social/core/db/tenant-tx` is a public export that `packages/modules/example/server/service.ts:1` and `apps/api/src/routes/me.ts:4` already import. Any module or route can write `import { withAdminTx } from '@rede-social/core/db/tenant-tx'` and open the cross-tenant lane with no lint error, no boundary failure and nothing in `guard-local-settings.sh` to catch it (the switch is `LOCAL`). The comment in `tenant-tx.ts:39-40` and the SCHEMA/PLAN docs claim the lane is "importable ONLY from `server/{tenancy,platform}` and `scripts/`" — that claim is currently false, and the negative fixture (`packages/boundary-fixture`) only exercises the `admin-tx` path.
**Fix:** Move the implementation so the public entry point cannot leak it:
```ts
// packages/core/db/admin-tx.ts — the ONLY definition
import { sql } from 'drizzle-orm';
import { db } from './client';
import type { Tx } from './tenant-tx';
export async function withAdminTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role service_role`);
    return fn(tx);
  });
}
// packages/core/db/tenant-tx.ts — delete withAdminTx; export only Tx + withTenantTx
```
Then add `import { withAdminTx } from '@rede-social/core/db/tenant-tx'` to `packages/boundary-fixture/src/index.ts` so `boundaries:negative` proves the hole is closed, and consider also restricting `@rede-social/core/db` (raw `db`/`sqlClient`) outside the kernel — a module could otherwise issue `db.execute(sql\`set_config('role', 'service_role', false)\`)`, which the lane guard's regex does not match.

## Warnings

### WR-01: Domain events are flushed even when the handler threw and its transaction rolled back

**File:** `packages/core/server/events/bus.ts:97-101`, `apps/api/src/app.ts:19-29`
**Issue:** The bus documents rule 1 as "a subscriber can never observe a row that a rollback then erased" and says delivery happens "once the handler … has returned". In Hono 4.13 `compose()` (verified in `node_modules/.pnpm/hono@4.13.7/node_modules/hono/dist/compose.js`), an error thrown by a route handler is caught at that handler's own `dispatch` level and converted into a response by `app.onError`; upstream middleware's `await next()` then **resolves normally**. `flushEventsAfterResponse` therefore runs `flush(ctx)` after a failed handler and delivers whatever was pushed to `ctx.events` before the throw. Today the example module emits only after `withTenantTx` resolves, so nothing breaks yet — but the guarantee is convention, not construction, and the first module that calls `emit` inside a transaction callback (nothing prevents it) will notify subscribers about rolled-back rows.
**Fix:**
```ts
export const flushEventsAfterResponse = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const ctx = c.get('ctx');
  if (!ctx) return;
  if (c.error) { ctx.events.length = 0; return; } // handler failed: nothing committed
  await flush(ctx);
});
```
Optionally make `emit` refuse to be called while a tenant transaction is open (e.g. a flag on `ctx` set/cleared by `withTenantTx`). Also rename the middleware: it runs before the response is sent, in the request's critical path.

### WR-02: `enqueueInTx` `finally` masks the original failure when the transaction is already aborted

**File:** `packages/core/server/jobs/boss.ts:112-119`
**Issue:** If `boss.send` fails because the database rejected the insert (constraint, missing queue, privilege), the transaction is in the aborted state. The `finally` then executes `set local role …`, which Postgres rejects with `current transaction is aborted, commands ignored until end of transaction block`; that second error replaces the first one on the way out, so the caller and the logs never see why the enqueue failed. The role restore is also unnecessary on the failure path (the transaction is being rolled back and the LOCAL setting dies with it).
**Fix:**
```ts
await tx.execute(sql`set local role api_user`);
let id: string | null;
try {
  id = await boss.send(name, payload, { db: fromDrizzle(tx, sql), ...opts });
} catch (err) {
  throw err; // transaction is aborted; no restore possible or needed
}
if (callerRole && callerRole !== 'api_user') {
  await tx.execute(sql`set local role ${sql.identifier(callerRole)}`);
}
return id;
```
(or keep the `finally` but wrap the restore in its own try/catch that logs and rethrows the original).

### WR-03: `singletonKey` gives no idempotency on the `standard` queue policy the code creates

**File:** `packages/core/server/jobs/boss.ts:90-92`, `apps/api/src/worker.ts:32`, `packages/modules/example/server/service.ts:61,80-85`
**Issue:** Both comments state that `singletonKey` makes a retried enqueue idempotent (T-07-04). pg-boss 12 enforces singleton keys only through policy-specific partial unique indexes (`job_i1` short, `job_i2` singleton, `job_i3` stately, `job_i6` exclusive, `job_i8` key_strict_fifo — see the migration lines 235-242) or through `singleton_on` when `singletonSeconds` is given. `createQueue(name)` with no options creates a `standard` queue, where a `singletonKey` alone hits no unique index, and the insert's `ON CONFLICT DO NOTHING` never fires. Two `send` calls with the same key produce two jobs. The documented mechanism future modules will copy does not exist.
**Fix:** Create queues with an explicit policy that enforces the key, in one place:
```ts
// boss.ts + worker.ts
await boss.createQueue(name, { policy: 'short' }); // 1 queued job per (name, singletonKey)
```
and state in the `enqueueInTx` docblock which policy the idempotency depends on. Add a unit/integration test that enqueues the same key twice inside one transaction and asserts one row.

### WR-04: `X-Client-IP` is trusted from any caller of the public API

**File:** `apps/api/src/routes/public.ts:27-28,112`, `packages/core/server/tenancy/signup.ts:21,35-37`, `apps/web/app/(auth)/cadastro/[slug]/actions.ts:49-61`
**Issue:** The API is deployed with `--allow-unauthenticated` and `POST /v1/public/signup/{slug}` carries no authentication, so the "trusted hop only" assumption in the comments is not enforced: anyone can call the endpoint directly with an arbitrary `X-Client-IP` (and `User-Agent`), and the value is persisted as LGPD consent evidence in `consent_records.ip`. The evidence is therefore forgeable by the very party it is meant to attribute. There is no shared secret or identity between the Next.js BFF and Cloud Run.
**Fix:** Either (a) derive the IP on the API from Cloud Run's own `X-Forwarded-For` (the last hop appended by the Google front end is trustworthy) and ignore `X-Client-IP`, or (b) authenticate the BFF hop: have the web action send a `X-Internal-Token` from a shared secret (Vercel env + Secret Manager) and only honour `X-Client-IP` when it matches; otherwise store `null`. Either way document in `consent_records.ip` which source the value came from.

### WR-05: No rate limiting on `POST /v1/public/signup/{slug}`, which is also an e-mail existence oracle

**File:** `apps/api/src/routes/public.ts:81-118`, `packages/core/server/tenancy/signup.ts:141-170`
**Issue:** The endpoint creates auth users via `admin.createUser` with the service key. GoTrue's `[auth.rate_limit] sign_in_sign_ups = 30` applies to the public `/signup` endpoint, not to admin calls, and nothing in Hono limits requests. An unauthenticated client can (1) mass-create members in any active tenant, each with consent rows and an `auth.users` entry, and (2) enumerate registered e-mails across all tenants at line rate through the distinct 409 (`EMAIL_ALREADY_REGISTERED`) versus 201 answer — D-04 accepted the message wording but not unlimited probing.
**Fix:** Add a per-IP/per-e-mail limiter in front of the route (e.g. `hono-rate-limiter` with a Postgres or in-memory store, or Cloud Armor on the Cloud Run URL) with tight limits (e.g. 5/min per IP, 3/hour per e-mail), and consider a CAPTCHA/Turnstile token from the web form for the pilot. At minimum log `signup.duplicate_email` with the client IP so abuse is visible.

### WR-06: Host resolution caches are unbounded and keyed by attacker-controlled input

**File:** `packages/core/server/tenancy/tenant-host.ts:10-11,37`, `apps/web/lib/tenant-host.ts:29,75`
**Issue:** `resolveTenantHost` stores one `Map` entry per distinct host string for 60 s (negative results included) and never evicts expired entries — an entry is only overwritten when the same key is queried again. `GET /v1/public/tenants/by-host?host=…` is unauthenticated and accepts any 253-char string, so a client iterating random hostnames grows the map without bound for the life of the instance (each miss also costs an admin-lane query). The web-side cache has the same shape; on Vercel the `host` is constrained to project domains, but on any other deployment it is client-supplied.
**Fix:** Bound the cache (LRU with a fixed `max`, e.g. 1,000 entries, evicting on insert) and validate the host shape before caching (`/^[a-z0-9.-]{1,253}$/`, matching `tenant_domains_host_chk`); reject anything else with 404 without touching the cache or the database.

### WR-07: `memberships` is writable from the tenant lane (`FOR ALL`), unlike every other core table

**File:** `packages/core/db/schema/memberships.ts:40-45`, `supabase/migrations/20260912031019_core.sql:62`
**Issue:** `tenants`, `tenant_domains`, `tenant_modules`, `consent_records` and `users` expose only `SELECT` to `authenticated`, with the stated rule that writes go through the admin lane. `memberships` — the table that carries `role` and `status`, i.e. the authorization source of truth — has a `FOR ALL` policy scoped only by `tenant_id`. In the tenant lane any request can therefore `UPDATE memberships SET role = 'admin_tenant'` or `status = 'active'` for itself or any member of the same tenant, and the RLS layer will not stop it. No Phase 1 route does this, but the layer exists precisely for the day a route has a bug (an admin "update member" endpoint that forgets to exclude `role` from the patch, for example). The pgTAP isolation suite tests cross-tenant invisibility, not intra-tenant privilege changes.
**Fix:** Make the tenant-lane policy select-only and keep membership writes in the admin lane behind explicit guards (Phase 2's admin routes):
```ts
pgPolicy('memberships_tenant_select', { for: 'select', to: authenticatedRole, using: sql`tenant_id = app.tenant_id()` }),
```
If a tenant-lane write is ever needed, add a narrow `update` policy with a `WITH CHECK` that pins `role` and `status` (e.g. via a trigger or column-level grants: `REVOKE UPDATE (role, status, blocked_at, deleted_at) ON memberships FROM authenticated`).

### WR-08: `app.membership_for_user()` ignores `deleted_at` (and `blocked_at`), so a soft-deleted membership still authenticates

**File:** `supabase/migrations/20260912031029_app_membership_lookup_and_grants.sql:17-22`, `packages/core/db/schema/memberships.ts:30-31`, `packages/core/server/auth/require-auth.ts:57`
**Issue:** The schema adds `deleted_at` ("soft delete columns on members for moderation") and `blocked_at`, but the only lookup the auth middleware runs filters on nothing but `user_id`, and `requireAuth` checks only `status`. A moderation action that sets `deleted_at` (or `blocked_at`) without also flipping `status` leaves the member fully authenticated. Two columns that mean "this membership is gone/blocked" with no code honouring them is a latent authorization bug.
**Fix:** Either make the function the single source of truth — `where m.user_id = p_user_id and m.deleted_at is null`, and treat `blocked_at is not null` as blocked — or drop the columns until Phase 8 defines their semantics. Add a pgTAP/integration case: set `deleted_at`, expect `NO_MEMBERSHIP`.

### WR-09: Password-recovery `redirectTo` is built from `Host`/`X-Forwarded-Host`; safety depends entirely on the hosted redirect allow-list

**File:** `apps/web/app/(auth)/esqueci-senha/actions.ts:17-23,37-39`
**Issue:** `requestOrigin()` trusts `x-forwarded-host` (then `host`) with no validation against the hosts this deployment actually serves. On Vercel those headers are set by the platform, but on any other runtime (`next start` behind a misconfigured proxy, a self-hosted preview, local) a request with a forged `X-Forwarded-Host: evil.example` makes Supabase e-mail the victim a reset link pointing at the attacker's domain (classic host-header poisoning of password-reset links). The only backstop is Supabase's `additional_redirect_urls` allow-list, which for local is `http://*.localhost:3000/**` and for hosted environments is configured outside this repo and not reviewable here.
**Fix:** Validate the origin against known hosts before using it: accept `PLATFORM_HOST`, hosts that `resolveHostTenant` classified as `tenant`, and (dev only) `*.localhost`; otherwise fall back to the tenant's primary domain or refuse. Document in `docs/DEPLOY.md` that the hosted `additional_redirect_urls` must be an explicit per-domain list, never a wildcard, and add a check in `supabase config push` review.

### WR-10: `/auth/confirm` `next` guard misses the backslash form of a scheme-relative URL

**File:** `apps/web/app/auth/confirm/route.ts:11,33-39`
**Issue:** `RELATIVE_PATH = /^\/(?!\/)/` rejects `//evil.example` but accepts `/\evil.example`. Browsers parse `/\evil.example` in a `Location` header as `//evil.example` (WHATWG URL: backslash is a slash for special schemes), so a successful `verifyOtp` followed by `redirect(safeNext)` becomes an open redirect. Exploitation requires a valid `token_hash`, which the attacker only has for their own account — but that is exactly the login-CSRF + open-redirect chain (victim's browser is signed in as the attacker and sent to a phishing page that looks like the tenant).
**Fix:**
```ts
const RELATIVE_PATH = /^\/(?![\/\\])/;
// or, stricter:
const safeNext = (() => { try { const u = new URL(next, request.nextUrl.origin); return u.origin === request.nextUrl.origin ? u.pathname + u.search : '/inicio'; } catch { return '/inicio'; } })();
```
Also consider an allow-list (`/redefinir-senha`, `/inicio`) since only two values are ever generated.

### WR-11: Pull requests run PR-controlled code against staging with the staging service key and DB password

**File:** `.github/workflows/deploy-api.yml:14-19,85-138`
**Issue:** The `staging` job triggers on `pull_request`, runs `supabase db push` (arbitrary SQL from the PR branch) and `pnpm db:seed` (arbitrary TypeScript from the PR branch) with `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `SUPABASE_DB_PASSWORD` and `SUPABASE_ACCESS_TOKEN` in the environment, and deploys the PR's image with `--allow-unauthenticated`. Anyone who can open a PR in the repo can exfiltrate every staging secret or destroy the staging database before review. If the `staging` GitHub Environment has no required reviewers, there is no gate at all.
**Fix:** Require reviewers on the `staging` environment (the same mechanism `production` uses), or move staging deploys to `push` on a `staging` branch / `workflow_dispatch`, and keep only build + tests on `pull_request`. Never expose `SUPABASE_ACCESS_TOKEN` to PR-triggered jobs.

### WR-12: Kernel and module loggers bypass the Cloud Logging severity formatter

**File:** `packages/core/server/tenancy/signup.ts:12-16`, `packages/core/server/events/bus.ts:26-30`, `packages/modules/example/server/jobs.ts:6-10`, `packages/modules/example/module.ts:5-9` versus `apps/api/src/http/logger.ts:16-23`
**Issue:** Four separate root `pino()` instances are created without the `level -> severity` formatter and without the `LOG_LEVEL` setting. Their lines carry `"level":50` instead of `"severity":"ERROR"`, so Cloud Logging files `signup.compensated`, `domain_event.handler_failed` and job failures as DEFAULT severity — exactly the operational errors alerting must see. They also ignore `LOG_LEVEL`, and none of them carries `requestId`/`tenantId` the request logger already has.
**Fix:** Export one configured root logger from the kernel (e.g. `packages/core/server/logging.ts` with the same formatter and `LOG_LEVEL`) and have `apps/api` and modules create children from it; pass the request child logger (`c.get('logger')`) into `signupMember` and `flush` so their lines carry the request context.

## Info

### IN-01: `/auth/blocked` and `/auth/host-mismatch` sign the user out on a plain GET

**File:** `apps/web/app/auth/blocked/route.ts:16-18`, `apps/web/app/auth/host-mismatch/route.ts:12-14`
**Issue:** A state-changing action (`signOut`) on an unauthenticated GET is trivially triggerable cross-site (`<img src="https://tenant/auth/blocked">`) — a logout-CSRF nuisance.
**Fix:** Have the layout `redirect()` to a page whose Server Action performs the sign-out, or check `Sec-Fetch-Site: same-origin` / a one-time token before signing out.

### IN-02: `flags-cache.read()` returns two different shapes and shares mutable state

**File:** `packages/core/server/modules/flags-cache.ts:53-68`
**Issue:** On a hit it returns the internal `Entry` (including `expiresAt`); on a miss a fresh `{ keys, settings }`. Both expose the cached `Set`/`Map` by reference, so a caller mutating `flags.keys` poisons the cache for the tenant.
**Fix:** Return `{ keys: new Set(entry.keys), settings: new Map(entry.settings) }` or freeze, and always return the same shape.

### IN-03: `acesso-suspenso` renders an unbounded, attacker-controlled `t` query parameter

**File:** `apps/web/app/(auth)/acesso-suspenso/page.tsx:24-29`
**Issue:** `/auth/blocked` truncates to 80 chars, but this page is reachable directly and interpolates any length of text into the heading — content spoofing for phishing (`?t=Clique em ...`). React escapes HTML so it is not XSS.
**Fix:** Apply the same 80-char cap here and consider resolving the display name server-side instead of echoing a parameter.

### IN-04: `guard-local-settings.sh` excludes any line containing the substring `local`

**File:** `scripts/guard-local-settings.sh:39`
**Issue:** `grep -vi 'local'` removes matches like `set role service_role -- localhost only` and would also miss `set_config('role', ...)`, `set session authorization`, or a third argument that is a variable.
**Fix:** Match the keyword positionally: `set[[:space:]]+(local[[:space:]]+)?role` and reject when the optional group is absent; add patterns for `set_config\('role'` and `session authorization`.

### IN-05: `renderMarkdown` and `RulesSheet` use content prefixes as React keys

**File:** `apps/web/app/(auth)/termos/page.tsx:32`, `apps/web/app/(auth)/cadastro/[slug]/RulesSheet.tsx:48`
**Issue:** Two paragraphs sharing the first 48 characters produce duplicate keys (React warning, wrong reconciliation).
**Fix:** Use the block index (`key={i}`) — the lists are static.

### IN-06: `public.users.email` is mirrored only on insert

**File:** `supabase/migrations/20260912031030_auth_user_mirror.sql:15-18`, `packages/core/server/tenancy/signup.ts:98-113`
**Issue:** An e-mail change in `auth.users` is never reflected, so `existingIdentityForEmail` (and the bootstrap's `user.email`) go stale.
**Fix:** Add an `after update of email on auth.users` trigger that updates `public.users.email`, or read the e-mail from the JWT claims instead of the mirror.

### IN-07: Seed upsert updates `rules_text` without bumping `rules_version`

**File:** `scripts/seed.ts:122-125`
**Issue:** Re-running the seed with changed rules text leaves `rules_version = 1`, so existing `tenant_rules` consents point at text the member never saw. Seed-only, but it is the reference implementation for the Phase 2 rules editor.
**Fix:** Bump `rulesVersion` (`sql\`rules_version + 1\``) when `rulesText` differs, or leave `rulesText` out of the `set`.

### IN-08: `createExampleItem` surfaces API error codes via `throw new Error(code)`

**File:** `apps/web/app/(app)/inicio/example-actions.ts:18,28`
**Issue:** Next.js masks Server Action error messages in production, so the user sees a generic failure and the code is lost. Throwaway module, but the pattern will be copied.
**Fix:** Return a result object (`{ ok: false, code }`) and render it with `useActionState`, as the auth actions do with `redirect(...?erro=)`.

### IN-09: `tenant_slug` hint cookie is not `Secure`

**File:** `apps/web/proxy.ts:141-146`
**Issue:** Session cookies get `secure` from `cookie-options.ts`, but this cookie does not; it is a low-value hint, but the inconsistency will be copied.
**Fix:** Reuse `sessionCookieOptions`' `secure` value.

### IN-10: Graceful shutdown leaves the DB pool and lazy pg-boss instance open

**File:** `apps/api/src/main.ts:23-32`, `packages/core/server/jobs/boss.ts:123-129`
**Issue:** SIGTERM closes the HTTP server but never calls `sqlClient.end()` or `stopBoss()`; `server.close` also waits for idle keep-alive sockets, which can exceed Cloud Run's 10 s grace and end in SIGKILL mid-transaction.
**Fix:** After `server.close`, `await stopBoss(); await sqlClient.end({ timeout: 5 })`, and call `server.closeAllConnections?.()` (or set a hard timer) to drop idle keep-alives.

---

_Reviewed: 2026-09-14T15:48:08Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
