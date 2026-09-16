---
phase: 02-tenant-shell-branding-platform-panel
plan: 01
subsystem: multi-tenant branding (contracts, kernel host resolver, API, web layouts)
tags: [branding, multi-tenant, tracer, zod, wcag, drizzle, hono, nextjs, playwright]

# Dependency graph
requires:
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: tenant_domains + tenants schema, resolveTenantHost admin-lane cache, proxy.ts host classification with the four x-tenant-* headers, GET /v1/me/bootstrap, seed of two tenants, Playwright fixtures (hosts.demo/lab/generic, login())
provides:
  - "@tria/contracts/branding: hexColorSchema, brandColorsSchema, hostBrandingSchema, tenantBrandingSchema, ResolvedBranding, NEUTRAL_BRAND/LIGHT_BG/DARK_BG/NAVY/THEME_COOKIE, relativeLuminance, contrastRatio, deriveBrandColors, contrastReport, resolveBranding, toHostBranding, brandStyleVars, absoluteBrandUrl (client-safe subpath export)"
  - "hostTenantSchema widened: slug, displayName, status, isPrimary, primaryHost, branding — still .strict()"
  - "bootstrapSchema.tenant.branding structured (tenantBrandingSchema), answered resolved by the API"
  - "resolveTenantHost: verified hosts only (D-36), status returned not filtered (D-32), primary-host lookup for aliases (D-35), resolved brand in the 60 s cache"
  - "GET /v1/public/tenants/by-host carries status/isPrimary/primaryHost + public brand subset"
  - "apps/web/lib/host-brand.ts getHostBrand(); HostShell type for header-only readers; TTL_HIT_MS 60 s"
  - "(auth) <main> and (app) [data-brand-root] server-render the five --brand-* variables; logo or display name on the auth pages (D-26)"
  - "Seed brands: tria-demo #7c3aed/#a78bfa, tria-lab #0f766e/#14b8a6 with persisted derivations and SVG wordmarks"
affects: [02-06 e-mail templates, 02-07 AppShell, 02-08 proxy alias 308 + auth visuals, 02-11 manifest/icons, 02-14 panel branding form, 02-13 suspended screen]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Brand resolution is ONE pure function (resolveBranding) applied at every read seam (by-host resolver, bootstrap, (app) layout); the jsonb stays loose, consumers always get a complete ResolvedBranding"
    - "Derivations (onPrimary, primaryDark, onPrimaryDark) are persisted at write time via deriveBrandColors and honoured on read; only missing keys are recomputed"
    - "Brand reaches the HTML only through brandStyleVars (five fixed keys, validated hex) and <img src> — never inline SVG, never a header"
    - "Two host types in apps/web: HostTenant (full by-host answer, from resolveHostTenant) vs HostShell (four headers, from getHostTenant); the brand always comes from the cached fetch"
    - "Integration tests use one fresh host per case so the 60 s host cache cannot cross-contaminate cases"

key-files:
  created:
    - packages/contracts/src/branding.ts
    - packages/contracts/tests/branding.test.ts
    - apps/web/lib/host-brand.ts
    - apps/web/e2e/branding.spec.ts
    - apps/web/public/seed-logos/tria-demo.svg
    - apps/web/public/seed-logos/tria-lab.svg
    - apps/api/tests/integration/hosts.test.ts
  modified:
    - packages/contracts/src/hosts.ts
    - packages/contracts/src/bootstrap.ts
    - packages/contracts/src/index.ts
    - packages/contracts/package.json
    - packages/core/db/schema/tenants.ts
    - packages/core/server/tenancy/tenant-host.ts
    - apps/api/src/routes/public.ts
    - apps/api/src/routes/me.ts
    - scripts/seed.ts
    - apps/web/lib/tenant-host.ts
    - apps/web/app/(auth)/layout.tsx
    - apps/web/app/(app)/layout.tsx
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - apps/api/tests/integration/signup.test.ts

key-decisions:
  - "resolveBranding throws on a malformed stored color instead of falling back to the neutral brand: a corrupt row must fail loud (500 → generic shell) rather than render TRIA blue to a configured tenant (the prohibition); the panel validates with the same schema before saving"
  - "hexColorSchema accepts #rrggbb case-insensitively and lower-cases on parse; the regex carries no flag so the OpenAPI pattern serialises cleanly"
  - "apps/web splits HostTenant (full by-host answer) from HostShell (the four headers): getHostTenant() returns HostShell, the brand is never read from a header; signupPath takes Pick<HostShell,'mode'>"
  - "getHostBrand() fails open to the neutral brand with displayName from the headers when the cached lookup is unavailable on a tenant host — never to another tenant's brand"
  - "TenantBranding (jsonb $type) is z.input of tenantBrandingSchema (loose) — honest about what a row may hold; ResolvedBranding is the complete render-time type"
  - "The suspended-status integration case owns a throwaway tenant rather than flipping tria-lab's status, so a dev server sharing the local database is never affected"

patterns-established:
  - "Brand contract lives in @tria/contracts/branding (pure, client-safe subpath); server code imports from the package root"
  - "Layout wrappers spread brandStyleVars(...) into style; the authenticated wrapper carries data-brand-root for tests and later shell code"

requirements-completed: [TENANT-02]

coverage:
  - id: D1
    description: "Public /entrar server-renders the host tenant's --brand-primary, display name and logo before any JavaScript; the other seed tenant's hex and name never appear"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/branding.spec.ts#tria-demo /entrar carries the demo brand in the first HTML (JS disabled)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/branding.spec.ts#tria-lab /entrar carries the lab brand and never the demo one (JS disabled)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A generic host renders the neutral TRIA brand (#2e6fd0), no seeded tenant"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/branding.spec.ts#a generic host renders the neutral TRIA brand, not a seeded tenant"
        status: pass
    human_judgment: false
  - id: D3
    description: "After login the authenticated (app) shell carries each member's own brand from bootstrap; neither the other tenant's hex nor the neutral hex appears"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/branding.spec.ts#after login the authenticated shell carries each member’s own brand"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/public/tenants/by-host answers the strict brand/host body for verified hosts only; unverified → 404, suspended → 200 'suspended', alias → isPrimary false + primaryHost"
    requirement: TENANT-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/hosts.test.ts (6 cases)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#i. the public host lookup answers about one tenant only; a suspended host answers with its status"
        status: pass
    human_judgment: false
  - id: D5
    description: "WCAG contrast maths, derivations, resolveBranding fallbacks and the strict schemas"
    requirement: TENANT-02
    verification:
      - kind: unit
        ref: "packages/contracts/tests/branding.test.ts (22 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "jsonb type widening produces no migration (pnpm db:generate is a no-op)"
    verification:
      - kind: other
        ref: "pnpm db:generate → 'No schema changes, nothing to migrate'; git status --porcelain -- supabase/migrations empty"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual adequacy of the branded login page (logo size, colored display name) — Phase 1 inline styles are still in place until 02-08 ports the prototype visuals"
    verification: []
    human_judgment: true
    rationale: "Look and feel is out of this tracer's scope; the end-of-phase verifier should eyeball tria-demo.localhost:3000/entrar vs tria-lab.localhost:3000/entrar once 02-08 lands"

# Metrics
duration: 95min
completed: 2026-09-16
status: complete
actuals:
  tokens: 27655
  tasks: 2
  commits: 2
plan_head_before: 8e05f0707fa7e8a67fe8fb7bc9e2d893610d36cc
---

# Phase 02 Plan 01: Branded Host Tracer Summary

**Seed brand → verified-only by-host answer → server-rendered `--brand-*` on `/entrar` and in the authenticated shell, proven for two tenants with JavaScript disabled; brand maths and the strict public contract pinned by unit + integration tests.**

## Performance

- **Duration:** 95 min (includes a transient API interruption between Task 1 and Task 2)
- **Started:** 2026-09-16T13:39:03Z
- **Completed:** 2026-09-16T15:14:17Z
- **Tasks:** 2
- **Files modified:** 22

## Accomplishments

- `@tria/contracts/branding` (client-safe subpath): D-25 fixed keys `primary`/`secondary` plus persisted derivations `onPrimary`/`primaryDark`/`onPrimaryDark`, WCAG 2.x `contrastRatio`, `deriveBrandColors`, `contrastReport`, `resolveBranding` (`{}` → neutral TRIA), `brandStyleVars` (five fixed CSS custom properties), `toHostBranding`, `absoluteBrandUrl`, `THEME_COOKIE`.
- `hostTenantSchema` now carries `status`, `isPrimary`, `primaryHost`, `branding` and stays `.strict()`; `bootstrapSchema.tenant.branding` is structured and answered resolved.
- `resolveTenantHost` resolves VERIFIED hosts only (`isNotNull(verifiedAt)`, D-36), returns the tenant status instead of filtering on it (D-32), looks up the primary host for aliases (D-35) and caches the resolved brand.
- Public pages: `getHostBrand()` reuses the proxy's bounded host cache; the `(auth)` layout sets the brand variables on `<main>` and renders the logo (or the display name, D-26); the `(app)` layout wraps the tenant branch in `[data-brand-root]` with variables from bootstrap. `TTL_HIT_MS` lowered to 60 s (the cache bust on Vercel).
- Seed: tria-demo `#7c3aed/#a78bfa`, tria-lab `#0f766e/#14b8a6`, SVG wordmarks under `apps/web/public/seed-logos/`; `pnpm db:generate` stays a no-op.
- Tests: `branding.spec.ts` (8/8 on mobile-chromium + desktop-chromium; the whole Phase 1 e2e suite stayed green, 76/76), `hosts.test.ts` (6 integration cases), `branding.test.ts` (22 unit cases), Phase 1 by-host assertions repaired; full API integration suite 84/84.

## Task Commits

1. **Task 1: End-to-end branded host (tracer)** — `8062f85` (feat)
2. **Task 2: Contract + integration tests, Phase 1 repairs** — `1f964c3` (test)

**Plan metadata:** see the final `docs(02-01)` commit.

## Files Created/Modified

- `packages/contracts/src/branding.ts` — brand schemas, WCAG maths, derivations, resolution, style vars
- `packages/contracts/src/hosts.ts` — widened strict `hostTenantSchema`, `TenantStatus`
- `packages/contracts/src/bootstrap.ts` — `tenant.branding: tenantBrandingSchema`
- `packages/contracts/src/index.ts`, `package.json` — exports + `./branding` subpath
- `packages/core/db/schema/tenants.ts` — jsonb `$type<TenantBranding>` from the contract (no SQL change)
- `packages/core/server/tenancy/tenant-host.ts` — verified-only, status/isPrimary/primaryHost/branding
- `apps/api/src/routes/public.ts` — by-host body + descriptions; `apps/api/src/routes/me.ts` — resolved branding
- `scripts/seed.ts` — `colors`/`logoUrl` per seed tenant, `branding` in the upsert
- `apps/web/public/seed-logos/*.svg` — fixtures
- `apps/web/lib/tenant-host.ts` — `HostTenant` (full) / `HostShell` (headers), `TTL_HIT_MS = 60_000`
- `apps/web/lib/host-brand.ts` — `getHostBrand()`
- `apps/web/app/(auth)/layout.tsx`, `apps/web/app/(app)/layout.tsx` — brand variables, logo/name, `[data-brand-root]`
- `apps/web/e2e/branding.spec.ts` — two-tenant isolation smoke
- `packages/contracts/tests/branding.test.ts`, `apps/api/tests/integration/hosts.test.ts` — new suites
- `apps/api/tests/integration/{isolation,bootstrap,signup}.test.ts` — Phase 1 assertion repairs

## Decisions Made

- **Loud on corrupt brand data:** `resolveBranding` throws on a malformed hex rather than silently substituting the neutral brand — the prohibition forbids showing TRIA's default to a configured tenant; a loud 500 degrades to the generic shell via the web cache's 10 s error TTL. The panel (02-14) validates with the same schema before saving.
- **Two host types on the web tier:** `HostTenant` (full by-host answer, `resolveHostTenant`/proxy) vs `HostShell` (the four headers, `getHostTenant`). The plan's "spread the parsed schema into the tenant variant" is honoured for `HostTenant`; header-only readers keep a narrower type because the headers are size-limited and never carry the brand.
- **Fail-open in `getHostBrand()`:** if the cached lookup is unavailable on a tenant host, the page renders the neutral brand with the display name from the headers — never another tenant's brand, never a crash of the login page.
- **`TenantBranding` = `z.input`** (loose jsonb shape) and `ResolvedBranding` (complete) are distinct types so callers cannot mistake a raw row for a renderable brand.
- **Hex regex without the `i` flag** (`/^#[0-9a-fA-F]{6}$/`) so zod-to-openapi serialises a valid `pattern` in `/v1/openapi.json` (verified by fetching the document).
- **Throwaway tenant for the suspended case** in `hosts.test.ts` instead of mutating tria-lab, so a dev server sharing the local database is never affected mid-run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two more Phase 1 exact-body assertions broke with the widened by-host body**
- **Found during:** Task 2 (running the integration suite)
- **Issue:** `bootstrap.test.ts` case 10 and `signup.test.ts` case 2 used `toEqual({ slug, displayName })`; the plan listed only `isolation.test.ts` for repair
- **Fix:** both switched to `toMatchObject({ slug, displayName })` (the exact key set is pinned in `hosts.test.ts`)
- **Files modified:** `apps/api/tests/integration/bootstrap.test.ts`, `apps/api/tests/integration/signup.test.ts`
- **Verification:** full API integration suite 84/84
- **Committed in:** `1f964c3`

**2. [Rule 2 - Missing critical] `toHostBranding` helper and an `absoluteBrandUrl`-style public subset in the contract**
- **Found during:** Task 1
- **Issue:** the plan asked `public.ts` to "strip iconUrl/iconVersion"; doing that inline in the route would duplicate the stripping in the manifest route (02-11)
- **Fix:** one pure `toHostBranding(resolved)` in `branding.ts`, used by the route and tested for the exact key set
- **Files modified:** `packages/contracts/src/branding.ts`, `apps/api/src/routes/public.ts`
- **Committed in:** `8062f85`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical). **Impact:** test repairs directly caused by the planned contract change; the helper removes a future duplication. No scope creep.

## TDD note (Task 2)

Task 2 is `tdd="true"` but follows the tracer that already shipped the implementation, so the contract tests could not fail on the target assertions (feature existed by plan order). The genuine RED evidence was the Phase 1 isolation case `i` failing with `expected 200 to be 404` against the new D-32 behaviour (captured before writing the new tests); GREEN = repaired assertions + new suites passing (contracts 33/33, integration 84/84). No REFACTOR commit was needed.

## Issues Encountered

- `pnpm e2e -- branding.spec.ts` and `pnpm test:integration -- hosts isolation bootstrap` do not forward the filter (pnpm passes `--` through, the runners ignore the rest); both ran their FULL suites, which is why the whole Phase 1 e2e (76) and API integration (84) suites are known green. Filtering works with `pnpm --filter @tria/web exec playwright test branding.spec.ts` / `pnpm --filter @tria/api exec vitest run tests/integration/hosts.test.ts`.
- A transient API/SSL interruption occurred between the Task 1 commit and Task 2; execution resumed from the committed state with no rework.

## Verification (plan-level)

- `pnpm --filter @tria/web exec playwright test branding.spec.ts` → 8 passed (both projects); full e2e run earlier → 76 passed.
- `pnpm --filter @tria/api exec vitest run tests/integration` → 84 passed; `pnpm --filter @tria/contracts test` → 33 passed; `pnpm test` (unit, all packages) green.
- `pnpm db:generate` → "No schema changes, nothing to migrate"; `supabase/migrations` clean.
- `pnpm lint && pnpm typecheck` → green across the monorepo.
- `curl .../by-host?host=tria-demo.localhost | jq` acceptance predicate → true; `/v1/openapi.json` → 200.

## Human-check notes for the end-of-phase verifier

- Open `http://tria-demo.localhost:3000/entrar` and `http://tria-lab.localhost:3000/entrar`: purple vs teal wordmark, "Comunidade: …" naming only that host's tenant. `http://localhost:3000/entrar` shows the plain "TRIA" wordmark. Visual polish arrives with 02-08.

## Known Stubs

None — every value rendered comes from the seed/database through the by-host answer or bootstrap.

## Next Phase Readiness

- The by-host contract (`isPrimary`/`primaryHost`) is ready for the 02-08 alias 308 in `proxy.ts`; `branding.iconUrls`/`faviconUrl` slots are ready for 02-11 (icons via sharp) and `THEME_COOKIE`/`contrastReport` for 02-14 (panel form, D-41 dual-mode warnings).
- `status: 'suspended'` is now visible to the public shell for the 02-13 branded "indisponível" screen.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All 7 created files exist on disk; task commits 8062f85 and 1f964c3 are in history; commits measured from plan_head_before (2).
