---
phase: 02-tenant-shell-branding-platform-panel
plan: 05
subsystem: platform provisioning API (kernel platform lane services + /v1/platform/tenants* routes + integration tests)
tags: [platform, api, provisioning, hono, zod-openapi, drizzle, admin-lane, gotrue, invites, module-flags, vitest, integration]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 03
    provides: "tenant_invites table (RLS on, zero policies), tenant_domains verification columns, contracts platform.ts/invites.ts/domains.ts (createTenantBodySchema, platformTenantDetailSchema, TOGGLEABLE_MODULES, deriveBrandColors, contrastReport), publicWebOrigin(host), TENANT_SUSPENDED envelope in requireAuth"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "deriveBrandColors / contrastReport used for branding.colors and the detail's contrast block"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "withAdminTx admin lane, requireSuperAdmin()/PlatformEnv, moduleFlags cache (MODULE_FLAGS_TTL_MS = 30 s), resolveTenantHost/invalidateTenantHost, supabaseAdmin, signup.ts logger/compensation pattern, integration setup.ts helpers"
provides:
  - "packages/core/server/platform/tenants.ts — listPlatformTenants({ q, status, cursor, limit }) → { rows (+primaryHost), nextCursor } (slug-keyed paging, ilike name OR slug with escaped wildcards); createTenant(body, actor) in ONE withAdminTx (tenants row with derived colors, 7 tenant_modules rows with example=false, pending tenant_invites row) mapping unique violation 23505 on the slug to 400 VALIDATION_FAILED { slug: 'taken' } and calling sendPendingInvites after commit; getTenantDetail(id) → strict PlatformTenantDetail | null (6 real modules, domains, invites, active admin_tenant admins only); updateTenant(id, { displayName?, colors? }) re-deriving colors; setTenantStatus(id, status); both invalidating the host cache for every tenant_domains host"
  - "packages/core/server/platform/modules.ts — setModuleEnabled(tenantId, key, enabled, actor): refuses 'example' (400 { module: 'not_toggleable' }), 404 for an unknown tenant, row upsert on (tenant_id, module_key), then moduleFlags.invalidate(tenantId) so the toggle is live on this API instance's next request"
  - "packages/core/server/platform/invites.ts — PlatformActor/logFor, createPendingInvite(tx, …) (lower-cased email, role admin_tenant, status pending), sendPendingInvites(tenantId, actor?) → { sent, reason?: 'no_verified_primary' }: claim-before-send, GoTrue inviteUserByEmail with redirectTo = publicWebOrigin(verifiedPrimaryHost) + '/auth/confirm?next=/aceitar-convite', claim revert + 500 INTERNAL on GoTrue failure, memberships (admin_tenant, invited) + tenant_invites.user_id on success; exported for 02-09's on-verified hook"
  - "apps/api/src/routes/platform/index.ts — platformRoutes: OpenAPIHono<PlatformEnv> with requireSuperAdmin() registered before the chained .route('/', tenantsRoutes) (02-09 domains / 02-13 branding append their own .route)"
  - "apps/api/src/routes/platform/tenants.ts — GET/POST /tenants, GET/PATCH /tenants/{id}, POST /tenants/{id}/status, PUT /tenants/{id}/modules/{key} (key: z.enum(REAL_TENANT_DEFAULT_MODULES) so example is 400 at validation); every answer Cache-Control: no-store; mutations answer the fresh strict detail; platform.tenants.list|create|get|update|status and platform.modules.set logged with { userId, requestId, tenantId }"
  - "apps/api/src/http/openapi.ts — platformDefaultHook shared by the tenant lane (createOpenApiApp) and the platform routers (VALIDATION_FAILED with details.issues[{ path, message }])"
  - "apps/api/tests/integration/platform-tenants.test.ts — 20 cases: 9 service-level + 11 through the app (201 strict detail, duplicate slug, concurrent POSTs, modules [], field-path validation, ?q/?status/?limit+cursor, strict GET + 404, PATCH colors + slug refusal, PUT modules → bootstrap on the next request, suspend → by-host 'suspended' + member 403 TENANT_SUSPENDED, invite pending → sent via sendPendingInvites, member 403 FORBIDDEN / tenant-host 403 TENANT_HOST_MISMATCH); cleanupTestTenants() before and after the suite"
  - "apps/api/tests/integration/modules.test.ts case 13 — the platform PUT flips requireModule (200 ↔ 404 MODULE_DISABLED) on the same instance with no restart and no test-side invalidate; one upserted row; a tenant admin is refused"
affects: [02-06 mail transport + Send Email Hook (branded invite e-mail for inviteUserByEmail), 02-09 domains (sendPendingInvites on first verified host; .route('/', domainsRoutes)), 02-10 accept-invite (/aceitar-convite consumes the invited membership), 02-12 platform list/new tenant UI, 02-13 branding routes + suspended screen, 02-14 tenant page tabs (detail shape), 02-15 domains/admins tabs, Phase 8 audit log (platform.* events)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Platform-lane service signature: fn(…, actor: PlatformActor = { userId, logger? }) → logs { event: 'platform.<area>.<verb>', userId, tenantId } via logFor(actor, name) (request child logger when a route passes c.get('logger'), module logger for jobs/tests)"
    - "Provisioning is one withAdminTx or nothing; DB unique constraints are the concurrency arbiter and are mapped to 400 VALIDATION_FAILED { field: 'taken' } by walking the DrizzleQueryError cause chain for code 23505"
    - "Cache invalidation is the writer's job: setModuleEnabled → moduleFlags.invalidate; updateTenant/setTenantStatus → invalidateTenantHost for every host of the tenant"
    - "Claim-before-send for outbound side effects: update … where status='pending' returning, then the external call, revert the claim on failure"
    - "Platform sub-routers: routes/platform/<area>.ts exports an OpenAPIHono<PlatformEnv> chained into index.ts with .route('/', …) so AppType carries every route; the guard lives once on the parent"
    - "Integration fixtures that provision tenants clean up in beforeAll AND afterAll (memberships.tenant_id has no cascade; an interrupted run must not poison the next one)"

key-files:
  created:
    - packages/core/server/platform/modules.ts
    - packages/core/server/platform/invites.ts
    - apps/api/src/routes/platform/index.ts
    - apps/api/src/routes/platform/tenants.ts
    - apps/api/tests/integration/platform-tenants.test.ts
  modified:
    - packages/core/server/platform/tenants.ts
    - apps/api/src/http/openapi.ts
    - apps/api/tests/unit/mounts.test.ts
    - apps/api/tests/integration/modules.test.ts
  deleted:
    - apps/api/src/routes/platform.ts

key-decisions:
  - "listPlatformTenants keeps three separate selects (tenants page, enabled modules, verified primary hosts) instead of joins so a tenant with no module row or no host still lists with [] / null primaryHost"
  - "The unique-violation mapping walks the error cause chain (drizzle wraps postgres errors in DrizzleQueryError) and only claims 'slug: taken' when the constraint name contains 'slug' (or is absent)"
  - "The PUT modules route validates key with z.enum(REAL_TENANT_DEFAULT_MODULES) so 'example' fails at the OpenAPI validation layer (400 VALIDATION_FAILED with issues) while the service still refuses it independently ({ module: 'not_toggleable' }) for non-route callers"
  - "platformDefaultHook lives in apps/api/src/http/openapi.ts so routes/platform/index.ts and tenants.ts share it without an import cycle; createOpenApiApp reuses it"
  - "sendPendingInvites takes an optional actor: 02-09's domain-verify job calls it without a request context and logs userId: null"
  - "Task 3's integration tests passed against the committed Task 1/2 code once the fixture cleanup was fixed — no service/route change was needed, so Task 3 is a single test commit rather than a RED/GREEN pair"

patterns-established:
  - "routes/platform/<area>.ts + index.ts chaining for every future platform sub-router (domains, branding, admins)"
  - "Test tenants use a run-unique slug prefix (pt-svc-/pt-test-) and a cleanupTestTenants() that deletes memberships → tenants → stale auth users, before and after the suite"

requirements-completed: [ROLE-03, ROLE-04, ROLE-05, MOD-04]

coverage:
  - id: D1
    description: "POST /v1/platform/tenants provisions a tenant in one transaction: branding with derived colors, 7 tenant_modules rows (example=false), one pending admin invite; duplicate slug → 400 { slug: 'taken' } with no partial rows; concurrent duplicates leave exactly one tenant; modules [] is a valid empty community; empty fields → 400 with the field path"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#1,2,10,11,12,13"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /v1/platform/tenants supports ?q (name or slug, case-insensitive), ?status, ?cursor&limit (slug-keyed, 25 default, 1..100) and carries primaryHost; GET /v1/platform/tenants/{id} answers the strict detail (6 real modules, domains, invites, active admins only) and 404 NOT_FOUND for an unknown id"
    requirement: ROLE-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#3,4,14,15"
        status: pass
    human_judgment: false
  - id: D3
    description: "PUT /v1/platform/tenants/{id}/modules/{key} upserts the flag and is reflected in the tenant's /v1/me/bootstrap and in requireModule-guarded routes on the very next request of the same API instance, without a restart; example is refused with 400; the toggle is idempotent (one row)"
    requirement: ROLE-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#5,17"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/modules.test.ts#13"
        status: pass
    human_judgment: false
  - id: D4
    description: "Module availability is data-driven per tenant: no code change or redeploy is needed to enable/disable a module (row upsert + synchronous flags-cache invalidation; other instances converge within MODULE_FLAGS_TTL_MS)"
    requirement: MOD-04
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/modules.test.ts#8,13"
        status: pass
    human_judgment: true
    rationale: "Single-instance behaviour is proven; multi-instance convergence within the 30 s TTL is by construction (the cache design from Phase 1) and is not exercised by the local suite"
  - id: D5
    description: "PATCH /v1/platform/tenants/{id} re-derives onPrimary/primaryDark/onPrimaryDark and refuses a slug change; POST /v1/platform/tenants/{id}/status flips active/suspended, invalidates every host of the tenant so /v1/public/tenants/by-host answers the new status immediately and a member of a suspended tenant gets 403 TENANT_SUSPENDED"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#6,8,16,18"
        status: pass
    human_judgment: false
  - id: D6
    description: "First-admin invite: pending until a verified primary host exists; sendPendingInvites then claims the row, invites through GoTrue with a redirectTo built only from the verified host, creates the invited admin_tenant membership and marks the invite sent; a second call sends nothing"
    requirement: ROLE-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#7,9,19"
        status: pass
    human_judgment: true
    rationale: "The suite proves the GoTrue user (invited_at) and the DB states; the e-mail itself is not delivered locally and its branded template is 02-06's deliverable — the verifier should confirm the invite mail once 02-06 lands (Inbucket at supabase status → Inbucket URL)"
  - id: D7
    description: "Every /v1/platform/* route is behind requireSuperAdmin(): a member gets 403 FORBIDDEN, a super_admin on a registered tenant host gets 403 TENANT_HOST_MISMATCH (no tenant leak), anonymous gets 401; every platform answer is Cache-Control: no-store; the six platform paths are in the OpenAPI document"
    requirement: ROLE-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/platform-tenants.test.ts#20 and modules.test.ts#10,11"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/mounts.test.ts (platform paths mounted under /v1/platform)"
        status: pass
      - kind: other
        ref: "in-process app.request('/v1/openapi.json') lists get,post /v1/platform/tenants; get,patch /v1/platform/tenants/{id}; post …/status; put …/modules/{key}"
        status: pass
    human_judgment: false

# Metrics
duration: 60min
completed: 2026-09-16
status: complete
actuals:
  tokens: 22307
  tasks: 3
  commits: 5
plan_head_before: df7938c59180662a92ba6a640528f23fea535ef4
---

# Phase 02 Plan 05: Platform Provisioning API Summary

**A super_admin can now provision a tenant end-to-end through `/v1/platform/tenants*`: one transaction creates the tenant with derived brand colors, seven module rows (`example` always off) and a pending first-admin invite; list/detail/patch/status/module-toggle routes answer the strict `platformTenantDetailSchema` with `Cache-Control: no-store`; a module toggle is live in the tenant's bootstrap and guarded routes on the next request with no restart; suspending a tenant turns its members away with `TENANT_SUSPENDED` immediately; and `sendPendingInvites` claims-then-invites through GoTrue once a verified primary host exists — all pinned by 21 new integration cases (107/107 green).**

## Performance

- **Duration:** about 60 min of execution across two executor sessions (about 2h27m wall clock: 2026-09-16T20:22:30Z → 22:49:43Z, including the interruption between the first executor's Task 3 draft and this continuation)
- **Started:** 2026-09-16T20:22:30Z (after 02-04 closed)
- **Completed:** 2026-09-16T22:49:43Z
- **Tasks:** 3 (Task 1 TDD: RED + GREEN + fix; Task 2 auto; Task 3 TDD: tests committed once, see below)
- **Files modified:** 10 (5 created, 4 modified, 1 deleted)

## Accomplishments

- **Kernel platform lane (ROLE-03/04/05):** `tenants.ts` grew from a single list into `listPlatformTenants(query)` (q on name OR slug with escaped LIKE wildcards, status filter, slug cursor paging with `limit + 1`, `primaryHost` from verified primary domains), `createTenant` (one `withAdminTx`; 23505 on the slug constraint → `400 { slug: 'taken' }`; `sendPendingInvites` after commit), `getTenantDetail` (strict shape, six real modules in canonical order, domains `isPrimary desc, createdAt asc`, invites, active `admin_tenant` admins with email/name only), `updateTenant` (re-derived colors, `updatedAt`) and `setTenantStatus`, the last two invalidating the host cache for every `tenant_domains` row. `modules.ts` upserts `(tenant_id, module_key)` and invalidates the flags cache synchronously; `invites.ts` stores the pending invite inside the caller's transaction and sends with claim-before-send, GoTrue `inviteUserByEmail`, claim revert on failure, invited membership on success.
- **Routes restructured:** `routes/platform.ts` is gone; `routes/platform/index.ts` holds the guard once and chains `tenantsRoutes` (02-09/02-13 append theirs). Six operations documented in OpenAPI with the envelope codes; `key` validated as `z.enum(REAL_TENANT_DEFAULT_MODULES)`; every handler logs `platform.<area>.<verb>` with `{ userId, requestId, tenantId }` and sets `no-store`. `platformDefaultHook` moved to `http/openapi.ts` and is reused by `createOpenApiApp`.
- **Integration coverage:** `platform-tenants.test.ts` (20 cases: 9 on the services, 11 through the app including the concurrent-POST race, the `?limit=1` cursor walk, PATCH slug refusal, PUT modules → lab member bootstrap on the next request, suspend → `by-host` 'suspended' + member `403 TENANT_SUSPENDED` → reactivate, invite pending → sent with `auth.users.invited_at` and an `invited` membership, the guard triple) and `modules.test.ts` case 13 (the platform PUT flips `requireModule` 404 ↔ 200 on the same instance with no test-side invalidate). Whole suite 107/107 (86 before this plan); `pnpm lint` and `pnpm typecheck` green; unit 12/12.

## Task Commits

1. **Task 1 RED: failing integration tests for the platform provisioning services** — `c40a830` (test)
2. **Task 1 GREEN: platform-lane services for tenant provisioning, module toggles and first-admin invites** — `e3e60ba` (feat)
3. **Task 1 fix: `noUncheckedIndexedAccess` in the cursor assertion** — `d1d00e0` (test)
4. **Task 2: restructure the platform lane into `routes/platform/{index,tenants}` with provisioning routes** — `ae824d7` (feat)
5. **Task 3: drive `/v1/platform/*` through the app — provisioning lifecycle, list query, live module toggle, suspend, invite states** — `75a058a` (test)

**Plan metadata:** see the final `docs(02-05): complete …` commit.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 1 | `c40a830` (Part 1 imported `createTenant`/`getTenantDetail`/`updateTenant`/`setTenantStatus`/`setModuleEnabled`/`sendPendingInvites` before they existed and called `listPlatformTenants` with the new `{ rows, nextCursor }` signature → import/type failures, not wrong assertions) | `e3e60ba` (+ `d1d00e0` type fix) | — | compliant |
| 3 | `75a058a` — the Part 2 cases and `modules.test.ts#13` were written against the routes shipped in Task 2 and passed on their first complete run (after the fixture cleanup fix below) | same commit | — | compliant, single commit: the tests are the plan's end-to-end verification of Tasks 1–2, they revealed no gap in the services or routes, so no separate GREEN commit exists (recorded per the continuation instructions) |

## Files Created/Modified

- `packages/core/server/platform/tenants.ts` — list (query/cursor/primaryHost), createTenant, getTenantDetail, updateTenant, setTenantStatus, unique-violation mapping, host-cache invalidation
- `packages/core/server/platform/modules.ts` — setModuleEnabled (upsert + `moduleFlags.invalidate`, `example` refused, 404 unknown tenant)
- `packages/core/server/platform/invites.ts` — `PlatformActor`, `logFor`, `createPendingInvite`, `sendPendingInvites` (claim → GoTrue → membership; `no_verified_primary` no-op)
- `apps/api/src/routes/platform/index.ts` — `platformRoutes` with `requireSuperAdmin()` on the parent, chained sub-routers
- `apps/api/src/routes/platform/tenants.ts` — the six `/tenants*` operations, OpenAPI docs, `no-store`, audit logs
- `apps/api/src/http/openapi.ts` — `platformDefaultHook` shared by both lanes
- `apps/api/src/routes/platform.ts` — deleted (replaced by the directory)
- `apps/api/tests/unit/mounts.test.ts` — new platform paths
- `apps/api/tests/integration/platform-tenants.test.ts` — 20 cases + `cleanupTestTenants()`
- `apps/api/tests/integration/modules.test.ts` — case 13 (PUT toggle → `requireModule` live)

## Decisions Made

- Separate selects instead of joins in the list so module-less/host-less tenants still appear (empty list / `null` host).
- The 23505 mapping walks the drizzle `cause` chain and requires the constraint name to contain `slug`, so an unrelated unique violation still surfaces as 500 rather than a misleading `slug: taken`.
- `example` is refused twice on purpose: at the route's `z.enum(REAL_TENANT_DEFAULT_MODULES)` (400 with `issues`) and in the service (`{ module: 'not_toggleable' }`) for non-route callers.
- `platformDefaultHook` in `http/openapi.ts` (not in `routes/platform/index.ts`) avoids an index ↔ tenants import cycle.
- `sendPendingInvites(tenantId, actor?)` — actor optional so 02-09's verify job can call it without a request; it logs `userId: null` then.
- `invite.deferred` is logged (info) when there is no verified primary host, so "why has the admin not received the e-mail" is answerable from logs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Integration fixture cleanup could not delete the provisioned test tenants**
- **Found during:** Task 3 (first full run of the suite)
- **Issue:** `afterAll` deleted `pt-svc-%`/`pt-test-%` tenants directly, but `memberships.tenant_id` has no `ON DELETE CASCADE` (by design), so the rows left by the interrupted previous executor (its auth users were never deleted, hence their memberships survived) blocked the delete; the single failed statement also skipped the rest of `afterAll` (module restore, `adminSql.end()`), leaked two `tenant_domains` rows and broke `bootstrap.test.ts#11` (expects exactly 2 domains) and case 3's `q: 'pt-svc'` assertion on the next run.
- **Fix:** `cleanupTestTenants()` deletes memberships of the test tenants → the tenants → stale `*-pt-*@tria-test.local` / `admin.<run>@tria-test.local` auth users, and runs in **both** `beforeAll` and `afterAll`, so an interrupted run never poisons the next one.
- **Files modified:** `apps/api/tests/integration/platform-tenants.test.ts`
- **Verification:** whole integration suite 107/107 twice in a row; `select count(*) from tenant_domains` back to 2 after the run
- **Committed in:** `75a058a` (Task 3 commit)

**2. [Rule 1 - Bug] Unused `Detail` type alias (Biome warning) in the test file drafted by the previous executor**
- **Found during:** Task 3 (`pnpm lint`)
- **Fix:** removed the alias
- **Committed in:** `75a058a`

---

**Total deviations:** 2 auto-fixed (both Rule 1, both test-side). No production code changed in Task 3.
**Impact on plan:** None on scope; the cleanup fix is what makes the suite re-runnable on a shared local database.

## Issues Encountered

- **Executor interruption:** the first executor was cut mid-Task 3 with `+428/-8` uncommitted lines in `platform-tenants.test.ts`. This continuation kept that draft verbatim (it was complete), added the `modules.test.ts` case and the cleanup fix, and committed once.
- **`pnpm test:integration -- platform-tenants modules` does not filter:** the root script forwards to `pnpm --filter @tria/api test:integration`, and the extra args did not reach vitest as file filters — the whole suite ran each time (~10 s, acceptable). The plan's `<verify>` command therefore behaves like the whole-suite acceptance criterion; nothing to fix, noted for future plans (run `pnpm --filter @tria/api exec vitest run tests/integration/platform-tenants.test.ts` for a single file).
- **OpenAPI acceptance check without a server:** the plan's `curl http://localhost:8787/v1/openapi.json` needs a running API; the same assertion was made in-process with `app.request('/v1/openapi.json')` (all six operations present, `PUT …/modules/{key}` included).
- **Stale local data from the interruption** (2 tenants, 2 domains, 2 auth users) was removed by the new `beforeAll` cleanup on the first re-run; the local database needed no `pnpm db:reset`.

## Human-check notes (for `/gsd-verify-work`)

- The invite **e-mail** is not asserted here: locally GoTrue writes to Inbucket and the branded template/Send Email Hook is 02-06's deliverable. Verify the mail once 02-06 lands (D6).
- Multi-instance convergence of a module toggle (≤ 30 s on other Cloud Run instances) is by construction of the Phase 1 flags cache; only the single-instance path is exercised (D4).
- `sendPendingInvites` is **not** triggered by inserting a verified host — 02-09's domain-verify hook owns that call; `createTenant` calls it at creation (always a no-op then).

## User Setup Required

None - no external service configuration required (the local Supabase stack, `SUPER_ADMIN_EMAIL`/`SUPER_ADMIN_PASSWORD` and `SEED_PASSWORD` from `scripts/local-env.sh --write` are the existing prerequisites).

## Next Phase Readiness

- 02-06 (mail transport) can brand the `inviteUserByEmail` mail; the `redirectTo` is already the tenant's verified primary origin + `/auth/confirm?next=/aceitar-convite`.
- 02-09 (domains) has `sendPendingInvites(tenantId)` to call on the first verified primary host and `.route('/', domainsRoutes)` to chain in `routes/platform/index.ts`.
- 02-12/02-14/02-15 (panel UI) can consume `hc<AppType>()` for all six operations; the detail is the strict `platformTenantDetailSchema` and every mutation returns it fresh.
- No blockers. The `example` module remains toggle-proof (D-19) and the platform lane never carries member content (T-02-19).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All five plan files exist on disk and all five task commits (`c40a830`, `e3e60ba`, `d1d00e0`, `ae824d7`, `75a058a`) are in `git log`.
