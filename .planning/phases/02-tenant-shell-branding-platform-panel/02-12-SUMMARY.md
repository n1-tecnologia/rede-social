---
phase: 02-tenant-shell-branding-platform-panel
plan: 12
subsystem: web platform panel (super_admin provisioning UI on the platform host)
tags: [platform, panel, tenants, next-app-router, server-actions, useActionState, playwright, vitest, tracer]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "@rede-social/contracts/branding (hexColorSchema, deriveBrandColors, contrastReport, NEUTRAL_BRAND) — client-safe subpath"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@rede-social/ui primitives (Button, Input, Chip, StatusPill, Card, Tabs, PageHeader, Switch, EmptyState, Skeleton, Avatar, SectionTitle, IconButton), overlays (ConfirmDialog, ToastProvider/useToast), useDebounce, tokens"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 03
    provides: "contracts platform.ts (platformTenantsSchema/QuerySchema, createTenantBodySchema, setTenantStatusBodySchema, platformTenantDetailSchema.strict), invites.ts, domains.ts, REAL_TENANT_DEFAULT_MODULES"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 04
    provides: "per-namespace pt-BR catalog + loader (throws on missing keys), scripts/check-ui-literals.sh, D-33 approved mockup (#tenant-list, #tenant-list-empty, #new-tenant, #tenant-page-admins, #tenant-page-status, #platform-shell-mobile, #feedback)"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 05
    provides: "API /v1/platform/tenants (list q/status/cursor/limit, create → 201 detail / 400 {slug:'taken'} / details.issues, get → 404 NOT_FOUND, status), Cache-Control: no-store, requireSuperAdmin()"
  - phase: 01
    provides: "apps/web/lib/api.ts apiFetch (Bearer + x-tenant-host, no-store), lib/bootstrap.ts ApiClientError + loadOrRedirect (redirect after try/catch), lib/tenant-host.ts getHostTenant, proxy.ts auth gate, e2e fixtures (hosts, users, SEED_PASSWORD, admin.ts sql())"
provides:
  - "Route group apps/web/app/(platform)/plataforma/**: layout (host gate notFound() BEFORE any fetch → requirePlatformAccess() → ToastProvider + PlatformRail + 1040 px column), page (list: title row + single brand CTA, TenantToolbar, Suspense-streamed TenantTable with 5-row skeleton), novo/page (D-31 form), error.tsx (reset), not-found.tsx ('Tenant não encontrado' + 'Voltar para a lista' inside the panel rail), tenants/[id]/{layout (header: back + crumb, name 24/700 + status pill + slug text + verified primary host link or 'Sem domínio'; TenantTabs; FlashToast under Suspense), page (→ /marca), loading.tsx, admins/page, status/page, marca|modulos|dominios stubs}"
  - "Server actions apps/web/app/(platform)/plataforma/actions.ts: createTenantAction (createTenantBodySchema.safeParse first → POST → catalog KEYS for field errors incl. details.slug === 'taken' → redirect /plataforma/tenants/{id}/marca?toast=created OUTSIDE the try), setTenantStatusAction (revalidatePath layout + list, {ok}|{ok:false,code}), loadMoreTenantsAction (platformTenantsQuerySchema, rows pre-rendered on the server), signOutPlatform (D-08 local scope); CreateTenantState type"
  - "Platform RPC client apps/web/lib/platform.ts: getPlatformTenants(qs) cached by the SERIALISED query, getPlatformTenantDetail(id), requirePlatformTenants(query = {}) (no-arg callers in (app) keep working), requirePlatformAccess(), requirePlatformTenantDetail(id) (z.uuid() gate → 404/NOT_FOUND → notFound() after the catch), platformRedirectPath, buildTenantsQuery, toTenantRow/TenantRowView (modulesLabel + createdAtLabel pre-rendered), primaryVerifiedHost, formatPanelDate (pt-BR, America/Sao_Paulo), PANEL_PAGE_SIZE 25, PANEL_TIME_ZONE"
  - "Components apps/web/components/platform/: PlatformRail (desktop 240 px sticky rail + mobile 48 px top bar, themeSlot for 02-16), TenantTable (+TenantTableSkeleton; stretched row link by id with accessible name 'name (slug)', desktop table / mobile Card rows, load-more append via useTransition, EmptyState for empty vs no-match), TenantToolbar (debounced 300 ms search → ?q= with router.replace, status chips as links, never reads client search params), TenantTabs (fixed order marca·modulos·dominios·admins·status over @rede-social/ui Tabs), NewTenantForm (useActionState, slugify suggestion while untouched, ColorField ×2, ContrastFeedback with 'Salvar mesmo assim' gate, six Switch rows all on, renderPreview slot for 02-14), ColorField (44 px swatch over a native colour input, last valid hex), ContrastFeedback (+hasLowContrast; AA/Baixo pills, per-check warning copy), StatusCard (ConfirmDialog suspend / direct reactivate, toasts), AdminsCard (invite state pills, admins list, typed resend slot for 02-10), FlashToast (?toast=created → 'Tenant criado.' then strips the param)"
  - "apps/web/lib/slugify.ts (+5 vitest cases): NFD → strip marks → lower → [^a-z0-9]+ → '-' → trim → 40 chars"
  - "Catalog platform.json: nav, tenantStatus, moduleNames, moduleDescriptions, list, new (+contrast, errors), tenant (+tabs), admins, status, toasts, errors; platform.tenants re-valued to 'Tenants'; existing title/loginTitle/placeholder/modulesCount kept"
  - "e2e apps/web/e2e/platform-tenants.spec.ts (7 tests × 2 projects, 13 passed + 1 phone-only skip): list → create → tenant page → status flip; form errors incl. duplicate slug with values preserved; module switches + contrast gate + Admins tab long-e-mail overflow backstop; ?q=/?status=/?limit= + load-more + both empties; adjacency by slug/id; 320 px tabs backstop; access refusals (anonymous, tenant host 404, member on platform host signed out, unknown/non-uuid id). admin.ts gains deleteTenantBySlug, getTenantModuleFlag"
affects: [02-10 (Admins tab: fill AdminsCard `resend` slot from admins/page.tsx; strings admins.resend/resendPending/resendHelper exist), 02-14 (replace tenants/[id]/marca/page.tsx; reuse ColorField + ContrastFeedback; mount BrandPreview through NewTenantForm.renderPreview), 02-15 (replace modulos/page.tsx + dominios/page.tsx; reuse platform.moduleNames/moduleDescriptions), 02-16 (mount ThemeToggle in PlatformRail.themeSlot; add (platform)/** to check-static-routes — all routes already build as ƒ dynamic)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff)
actuals:
  tokens: 30148
  tasks: 3
  commits: 3
plan_head_before: 4c58c05c42c2e67febe22e8dea3bb7b6df5eb537

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Panel authorisation = host gate then API probe: `getHostTenant().mode !== 'platform' → notFound()` runs before any fetch; `requirePlatformAccess()` (GET /v1/platform/tenants?limit=1) is the only proof of super_admin; every page/tab re-proves through requirePlatformTenants/requirePlatformTenantDetail so each concurrently rendered segment ends with its own NEXT_REDIRECT"
    - "Server actions return catalog KEYS, never copy: the client component translates with useTranslations('platform'); functions never cross the server→client prop boundary (client panel components read the catalog directly, like OfflineBanner/error.tsx already do)"
    - "React `cache` keyed by a primitive: getPlatformTenants(qs) takes the serialised query string so the layout probe (limit=1) and the list page (q/status/limit) dedupe per distinct query"
    - "Dates and ICU plurals are rendered on the server and carried as strings on the row view (TenantRowView.createdAtLabel/modulesLabel) — client rows never format time"
    - "Two-copy responsive DOM (desktop table + mobile cards) is asserted in e2e through role locators (hidden copies excluded) and a `filter({ visible: true })` helper for text"
    - "e2e suites that build cross-test state use a per-run deterministic suffix (`process.ppid`) + lookup-or-create helpers, because Playwright restarts the worker (and runs afterAll) after any failed test"

key-files:
  created:
    - apps/web/app/(platform)/plataforma/layout.tsx
    - apps/web/app/(platform)/plataforma/page.tsx
    - apps/web/app/(platform)/plataforma/actions.ts
    - apps/web/app/(platform)/plataforma/error.tsx
    - apps/web/app/(platform)/plataforma/not-found.tsx
    - apps/web/app/(platform)/plataforma/novo/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/layout.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/loading.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/admins/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/status/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/dominios/page.tsx
    - apps/web/components/platform/PlatformRail.tsx
    - apps/web/components/platform/TenantTable.tsx
    - apps/web/components/platform/TenantToolbar.tsx
    - apps/web/components/platform/TenantTabs.tsx
    - apps/web/components/platform/NewTenantForm.tsx
    - apps/web/components/platform/ColorField.tsx
    - apps/web/components/platform/ContrastFeedback.tsx
    - apps/web/components/platform/StatusCard.tsx
    - apps/web/components/platform/AdminsCard.tsx
    - apps/web/components/platform/FlashToast.tsx
    - apps/web/lib/slugify.ts
    - apps/web/lib/slugify.test.ts
    - apps/web/e2e/platform-tenants.spec.ts
  modified:
    - apps/web/lib/platform.ts
    - apps/web/messages/pt-BR/platform.json
    - apps/web/e2e/admin.ts

key-decisions:
  - "Tenant page header renders its own 44×44 back control + tertiary 'Tenants' crumb instead of @rede-social/ui PageHeader: PageHeader owns an h1, and the mockup's 24/700 display name must be the page's single h1 (Playwright `getByRole('heading', { level: 1, name })` would hit strict-mode on two h1s). The Novo tenant page keeps PageHeader (its title IS the h1)"
  - "Client panel components read the catalog with useTranslations('platform') directly (StatusCard, NewTenantForm, ContrastFeedback, TenantToolbar, TenantTabs, FlashToast, error.tsx) instead of receiving label props: ICU strings with arguments (confirmTitle, contrast ok/low/warning) would otherwise need functions crossing the server→client boundary, which Next forbids. @rede-social/ui primitives still receive every string as a prop"
  - "The three tab-route stubs (marca/modulos/dominios) were pulled forward from Task 2 into the Task 1 commit (Rule 3): createTenantAction redirects to /marca, so without the stub the tracer landed on a 404 and could not prove the path"
  - "`LinkButton` from app/(auth)/LinkButton.tsx is reused for every anchor-styled-as-button in the panel (Novo tenant CTA, Descartar, not-found CTA, empty-state CTA) rather than adding a component outside files_modified; the (auth) file is a plain server-safe component with no route-group coupling"
  - "Rail active state uses the existing `bg-brand-soft` token (the plan's `bg-chip` does not exist in tokens.css); no token added"
  - "TenantToolbar only echoes ?limit= when the URL carried an explicit valid limit — the server default (25) is never written into the URL by search/filter navigations"
  - "`accent-brand` on the 'Salvar mesmo assim' checkbox and `after:` pseudo-element stretched links keep every colour in tokens; no hex reaches TSX (check-ui-literals green), swatch colours pass hexColorSchema before touching `style`"

patterns-established:
  - "Panel page contract: server page parses searchParams field-by-field with safeParse (invalid values dropped, never 500), builds the row view with catalog plurals, and streams the client table behind a keyed Suspense boundary"
  - "Typed slots for later plans: AdminsCard `resend?: ReactNode` (02-10), NewTenantForm `renderPreview?` (02-14), PlatformRail `themeSlot?` (02-16) — later plans mount without changing this plan's props contract"
  - "notFound() from a shared loader: the uuid gate throws before any request; the API 404 is caught, flagged, and notFound() is called after the catch (same rule as loadOrRedirect for redirect())"

requirements-completed: [ROLE-03, ROLE-05, UI-04, PWA-03]

coverage:
  - id: D1
    description: "On the platform host the super_admin lists tenants from GET /v1/platform/tenants (name + slug, verified primary host or 'Sem domínio', modulesCount plural, Ativo/Suspenso pill, dd/MM/yyyy), each row a link by id with accessible name 'name (slug)', and the single brand CTA 'Novo tenant'"
    requirement: ROLE-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#1. list → create → tenant page → status flip (mobile-chromium + desktop-chromium)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The D-31 form creates a tenant end-to-end: slug suggested by slugify while untouched and immutable afterwards (no slug input on the tenant page), colours + live contrast readout with the 'Salvar mesmo assim' gate, six module switches (all on, `example` never offered nor sent), first-admin e-mail; success redirects to /plataforma/tenants/{id}/marca with the toast 'Tenant criado.'"
    requirement: ROLE-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#1 (create + 'Tenant criado.' + getTenantModuleFlag events=true/example=false) and #3 (Baixo pill, checkbox gate, Stories off → stories=false, feed=true, example=false)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/slugify.test.ts (5 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Form errors are field-level and preserve valid values: empty name, slug 'São José', bad e-mail, and the API's duplicate-slug 400 → 'Este slug já está em uso.' with #displayName / #adminEmail untouched"
    requirement: ROLE-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#2. form errors"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tenant page: header (name 24/700, status pill, slug text, host link or 'Sem domínio'), five tabs in the fixed order Marca·Módulos·Domínios·Admins·Status, Status tab suspend (ConfirmDialog) / reactivate flipping the header pill with toasts, Admins tab (pending invite pill, empty admins row, no overflow with a 60-character e-mail)"
    requirement: ROLE-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#1 (tabs order, suspend/reactivate, pill flip, toast), #3 (Admins tab + scrollWidth <= clientWidth backstop), #6 (five tabs visible at 320 px, mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D5
    description: "List search/filter/pagination are API-side: ?q= substring, 'Nenhum tenant encontrado' with the query preserved, debounced typing writes ?q=, ?status=suspended lists only suspended with the chip current, ?limit=1 + 'Carregar mais' appends until nextCursor is null; two same-name tenants stay distinct by slug and id"
    requirement: ROLE-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#4. search, status filter, cursor pagination and the empty states; #5. adjacency"
        status: pass
    human_judgment: false
  - id: D6
    description: "Access: anonymous → /entrar; a member on a tenant host gets HTTP 404 (no panel chrome, no API call); a member on the platform host is signed out and never sees the panel or a tenant name; unknown uuid or non-uuid id → 'Tenant não encontrado' + 'Voltar para a lista' inside the rail; Phase 1 platform/login flows unchanged"
    requirement: ROLE-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts#7. access refusals (both projects); apps/web/e2e/platform.spec.ts + login.spec.ts (18 passed)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every visible panel string comes from platform.json (no pt-BR literal or hex in TSX); the panel builds as dynamic routes; lint/typecheck/build green"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (OK); pnpm lint && pnpm typecheck && pnpm build (all /plataforma/** routes ƒ); pnpm --filter @rede-social/web test (46 passed)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The screens read as the approved D-33 mockup on phone and desktop (240 px rail + 1040 px column; mobile top bar; table → Card rows below md; neutral platform brand; contrast pills; Admins/Status cards)"
    requirement: UI-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-tenants.spec.ts (mobile-chromium exercises the card rows and top bar; desktop-chromium the table and rail)"
        status: pass
    human_judgment: true
    rationale: "Visual fidelity to the mockup (spacing, weights, pill geometry, rail look) is a judgment call the automated suite does not measure — see 'Human verification' below"

# Metrics
duration: 24min
completed: 2026-09-16
status: complete
---

# Phase 2 Plan 12: Platform Panel Screens I Summary

**A super_admin on the platform host now provisions a tenant from the browser — list → D-31 form (slug suggestion, live contrast readout, module switches) → tenant page with five tabs → suspend/reactivate — against the real 02-05 API, host-gated and API-authorised, proven on phone and desktop by 13 Playwright cases.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-09-17T01:14:05Z
- **Completed:** 2026-09-17T01:38:11Z
- **Tasks:** 3 (1 tracer + 2 auto)
- **Files modified:** 30

## Accomplishments

- `(platform)/plataforma/**` route group with the mockup's rail/top bar and 1040 px column; the layout gates the host (`notFound()` before any fetch) and proves authorisation with `GET /v1/platform/tenants?limit=1` — the only proof, claims never consulted.
- Tenant list: search (debounced → `?q=`), status chips, cursor pagination ("Carregar mais" appends through a server action), 5-row skeleton behind Suspense, both empty states, desktop table ↔ mobile Card rows, stretched row links by id.
- "Novo tenant" (D-31) on `useActionState`: slug suggested by `slugify` while untouched (immutable afterwards — no slug input on the tenant page), `ColorField` swatches over native colour inputs, `ContrastFeedback` (AA/Baixo pills + "Salvar mesmo assim" gate that never blocks the API), six `Switch` rows all on with the reference module never listed, field-level errors mapped from the same Zod the API runs plus the API's `{ slug: 'taken' }`.
- Tenant page frame: header (name, pill, slug, verified host link / "Sem domínio"), `TenantTabs` in the fixed order, `?toast=created` flash toast, `loading.tsx`, in-rail not-found for unknown/non-uuid ids; Admins tab (invite state pills, admins list, typed `resend` slot for 02-10) and Status tab (`ConfirmDialog` suspend, direct reactivate, layout revalidation flips the header pill); Marca/Módulos/Domínios typed stubs for 02-14/02-15.
- `lib/platform.ts` grew into the platform RPC client (query-keyed `cache`, detail fetch, `requirePlatformAccess`, `requirePlatformTenantDetail`, row/date helpers) with the Phase 1 callers untouched; `platform.json` carries every panel string; `check-ui-literals.sh`, lint, typecheck, build and the full web unit suite are green.

## Task Commits

1. **Task 1 (tracer)** — `7f7b404` feat(02-12): tracer — platform panel list, D-31 create form, tenant page with five tabs, status flip under Playwright
2. **Task 2** — `3591a88` feat(02-12): expansion — full D-31 form, list toolbar + cursor pagination + empties, tenant not-found/loading/error, Admins tab, flash toast
3. **Task 3** — `b02b936` test(02-12): Playwright completion — form errors, module wiring + contrast gate, search/filter/pagination/empties, adjacency, 320px tabs and long e-mail backstops, access refusals

## Verification

- `pnpm --filter @rede-social/web exec playwright test platform-tenants.spec.ts` → 13 passed, 1 skipped (test 6 is phone-only) on `mobile-chromium` + `desktop-chromium`.
- `pnpm --filter @rede-social/web exec playwright test platform.spec.ts login.spec.ts` → 18 passed (Phase 1 flows unaffected). An earlier full `pnpm e2e` run during Task 1 passed all 100 pre-existing cases.
- `pnpm --filter @rede-social/web test` → 46 passed (41 + 5 slugify). `pnpm lint` (incl. `check-ui-literals.sh`), `pnpm typecheck`, `pnpm build` green; every `/plataforma/**` route builds as ƒ dynamic.
- Acceptance greps of all three tasks verified (layout `notFound()` line 32 before `requirePlatformAccess()` line 34; no `TOGGLEABLE_MODULES`, no contracts barrel, no `dangerouslySetInnerHTML`/`<img>` in `components/platform/*.tsx`; no `<Input` on the tenant header; catalog node check exits 0).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tab-route stubs pulled forward into Task 1**
- **Found during:** Task 1 e2e (first run)
- **Issue:** `createTenantAction` redirects to `/plataforma/tenants/{id}/marca`; without the Task-2 stub the tracer landed on Next's 404 and could not assert the tenant page.
- **Fix:** Created `marca/modulos/dominios/page.tsx` (each re-proves the detail + "Em breve" EmptyState) in the Task 1 commit.
- **Files modified:** the three stub pages
- **Commit:** `7f7b404`

**2. [Rule 1 - Bug] e2e cross-test state vs Playwright worker restarts**
- **Found during:** Task 3 (first full run: 5 failures)
- **Issue:** A random module-level suffix and a `Set` of created slugs were lost when Playwright restarted the worker after a failure (and the old worker's `afterAll` deleted the tenants the later tests depended on); Next's route announcer is a permanent `role=alert`, so `getByRole('alert')` was never 0.
- **Fix:** Deterministic per-run suffix (`process.ppid` + project letter), `ensureTenant` lookup-or-create helper, `afterAll` deleting the known slug set, form-scoped alert locator.
- **Files modified:** `apps/web/e2e/platform-tenants.spec.ts`
- **Commit:** `b02b936`

### Design adjustments (documented, not deviations from intent)

- Tenant page header does not use `PageHeader` (it would add a second `h1`); it renders the same 44×44 back control + tertiary crumb the mockup shows and keeps the display name as the only `h1`.
- Client panel components read the catalog through `useTranslations('platform')` rather than label props (functions cannot cross the server→client boundary; established pattern in `error.tsx`/`OfflineBanner`).
- `app/(auth)/LinkButton.tsx` is reused for anchor-styled buttons instead of adding a file outside `files_modified`.
- `bg-brand-soft` replaces the plan's non-existent `bg-chip` token for the active rail item.
- `TenantToolbar` omits `?limit=` unless the URL carried an explicit one.

## Human verification (end-of-phase, `human_verify_mode: end-of-phase`)

Compare against `.planning/sketches/001-phase-02-designed-screens/index.html`:

1. **Desktop** (≥ 768 px) on the platform host, signed in as the seeded super_admin: `/plataforma` — 240 px rail (wordmark "Rede Social / Plataforma", "Tenants" active in brand-soft, "Sair" at the bottom), title row "Tenants" + the single brand "Novo tenant", toolbar (search 360 px + Todos/Ativos/Suspensos chips), table in a Card (5 columns, hover row, whole row clickable). Check `#tenant-list`.
2. **Phone** (< 768 px): 48 px top bar (wordmark, "Tenants" chip, sign-out icon), full-width "Novo tenant", Card rows with name + pill / slug · host / chevron. Check `#platform-shell-mobile` and the phone frame of `#tenant-list`.
3. `/plataforma/novo`: field order and helpers, two swatches with the hex fields, contrast pills (type `#f5f7fb` as primary to see "Baixo" + the warning + "Salvar mesmo assim"), six switch rows, "Descartar" left / "Criar tenant" right. Check `#new-tenant` (the BrandPreview mini-shells arrive with 02-14).
4. Tenant page header + tabs + Admins/Status cards vs `#tenant-page-admins` / `#tenant-page-status`; the suspend dialog vs the overlay demo.
5. Light and dark (toggle the theme cookie via the tenant app's ThemeToggle or set `rede_theme=dark`): neutral tokens only, no tenant colour anywhere on the platform host.

## Known Stubs

| File | Reason | Resolved by |
|------|--------|-------------|
| `apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx` | Typed tab-route stub ("Em breve" EmptyState) so the tab never 404s | 02-14 |
| `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx` | Same | 02-15 |
| `apps/web/app/(platform)/plataforma/tenants/[id]/dominios/page.tsx` | Same | 02-15 |
| `apps/web/components/platform/AdminsCard.tsx` (`resend` slot, unused) | "Reenviar convite" control is 02-10's lifecycle | 02-10 |
| `apps/web/components/platform/NewTenantForm.tsx` (`renderPreview` slot, unused) | BrandPreview mini-shells | 02-14 |
| `apps/web/components/platform/PlatformRail.tsx` (`themeSlot`, unused) | kernel ThemeToggle | 02-16 |

These are intentional seams declared by the plan; none blocks this plan's goal (provisioning end-to-end is proven).

## Threat Flags

None beyond the plan's register: no new endpoint, no upload, no raw HTML; hex values reach `style` only after `hexColorSchema`; the external host link is built solely from the verified `tenant_domains.host` with `rel="noopener noreferrer"`.

## Notes for later plans

- 02-10: `admins/page.tsx` already formats `sentAtLabel`/`acceptedAtLabel`; pass the resend button (+ `admins.resendHelper`) as `resend`.
- 02-14/02-15: replace the stub pages in place; `requirePlatformTenantDetail(id)` is React-cached with the layout so a second call costs nothing.
- 02-16: `PlatformRail` expects a `themeSlot` node; `(platform)/**` routes all read headers/cookies and already build dynamic.
- The e2e suite must be run from `apps/web` with `pnpm exec playwright test <spec>` to scope a single spec — `pnpm e2e -- <spec>` at the root runs the whole suite (observed during Task 1).

## Self-Check: PASSED

- Files: all 27 created files and 3 modified files present on disk (see key-files).
- Commits: `7f7b404`, `3591a88`, `b02b936` present in `git log`; `git rev-list --count 4c58c05..HEAD` = 3 (matches `commits: 3`).
