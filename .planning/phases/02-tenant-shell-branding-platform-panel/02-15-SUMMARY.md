---
phase: 02-tenant-shell-branding-platform-panel
plan: 15
subsystem: web platform panel — Domínios and Módulos tabs of the tenant page (super_admin, platform host)
tags: [platform, panel, web, ui, domains, modules, server-actions, useActionState, useOptimistic, playwright, tracer]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 09
    provides: "/v1/platform/tenants/{id}/domains (attach), …/{domainId}/verify | /primary | /restart, DELETE …/{domainId}; contracts domains.ts (attachDomainBodySchema, tenantDomainSchema, tenantDomainsListSchema, DOMAIN_STATE_REASONS); fake provider (needs-txt / never-verifies hooks)"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 05
    provides: "PUT /v1/platform/tenants/{id}/modules/{key} (z.enum(REAL_TENANT_DEFAULT_MODULES) param, setModuleBodySchema, moduleFlags.invalidate, MODULE_FLAGS_TTL_MS = 30 s), platformTenantDetailSchema.modules"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 12
    provides: "tenants/[id]/layout.tsx (header host link / 'Sem domínio', TenantTabs), the dominios/modulos stubs, lib/platform.ts (requirePlatformTenantDetail, formatPanelDate, platformRedirectPath), action conventions, platform.moduleNames/moduleDescriptions, e2e admin.ts helpers"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@rede-social/ui Button, IconButton, Input, StatusPill, Card, SectionTitle, Skeleton, EmptyState, Switch, ConfirmDialog, useToast"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 04
    provides: "per-namespace pt-BR catalog loader, scripts/check-ui-literals.sh, D-33 approved mockup sections tenant-page-dominios / tenant-page-modulos"
provides:
  - "Domínios tab apps/web/app/(platform)/plataforma/tenants/[id]/dominios/{page,loading,actions}: attach form + one DomainCard per host in API order (primary first) or EmptyState; server actions attachDomainAction (useActionState, bound tenantId, AttachDomainState with catalog keys invalid/taken/platformHost, value kept on error), verifyDomainAction, setPrimaryDomainAction, removeDomainAction, restartDomainAction (DomainActionResult; z.uuid() on both ids, 401/403 redirect after the try, layout revalidation after every state-changing answer incl. 409 expired)"
  - "Módulos tab apps/web/app/(platform)/plataforma/tenants/[id]/modulos/{page,loading,actions}: six rows from REAL_TENANT_DEFAULT_MODULES joined with detail.modules (missing key → off), setModuleAction (z.enum(REAL_TENANT_DEFAULT_MODULES) + setModuleBodySchema before PUT, SetModuleResult)"
  - "Components apps/web/components/platform/: AttachDomainForm (controlled Input id=host + Globe, useFormStatus submit 'Adicionando…', generic alert card, success toast + clear), DomainCard (exports DomainStatus, DomainCardView, DomainActionError, DomainActionResult, DomainAction; pills, last-check line, DnsRecordsTable unless verified, action row per status, ConfirmDialog brand for set-primary / danger for remove, disabled Remover + helper on primary-with-aliases, lastError line), DnsRecordsTable (exports DnsRecordView; text-only cells keyed type|name, desktop table / phone stacked blocks, CopyValueButton copying the PROP value with icon swap + role=status live region + toast), ModuleToggles (useOptimistic + per-row busy, Ativado/Desativado pill, revert + error toast)"
  - "apps/web/lib/platform-domains.ts (server-only): toDomainCardView(domain, total), domainStatusTone, mapDomainActionError(ApiClientError) → expired | notExpired | notVerified | removePrimary | notFound | generic, DOMAIN_ACTION_ERRORS"
  - "Catalog: platformDomains.json (title, add, helper, empty, status, primary, card, dns, confirm, toasts, errors) and platformModules.json (title, helper, enabled, disabled, toggle, toasts) — two new namespaces, platform.json untouched"
  - "e2e apps/web/e2e/platform-domains.spec.ts (6 serial tests × 2 projects = 12 passed) + e2e/domains-admin.ts (apiSession → fetchApi with Bearer + x-tenant-host, expireDomain, getDomainStatus, closeDomainsAdmin)"
affects: [02-16 (module-toggle smoke can drive /modulos + getByRole('switch', { name: /Feed/ }); check-static-routes must list (platform)/plataforma/tenants/[id]/{dominios,modulos} — both build as ƒ dynamic), Phase 8 (DomainCard / DnsRecordsTable / ModuleToggles take strings + actions as props and can be remounted under the admin_tenant lane)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff)
actuals:
  tokens: 19879
  tasks: 3
  commits: 3
plan_head_before: 7aadaad4f672544b66d1b2a9c5f3b7c45d510607

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Row actions share one `runDomainAction(tenantId, domainId, init, readRow, event)` body: uuid gate → apiFetch → parse the row on 2xx (`readRow` adapts object / list / 204 answers) → `mapDomainActionError` on 4xx with a layout revalidation (a 409 can mean the row just changed) → `redirect()` after the try for 401/403"
    - "Client label contracts carry pre-interpolated strings for ICU keys with arguments (confirmRemoveTitle, confirmPrimaryTitle, lastErrorLabel) and ONE raw template (`t.raw('errors.verifyFailed')`) interpolated client-side by a 3-line `interpolate()` when the argument (the API's lastError) is only known after the action"
    - "Optimistic switch rows: `useOptimistic(rows, patch)` inside `startTransition(async …)` with a `Set` of pending keys for per-row `aria-busy`; the revalidated `rows` prop carries the committed value, a failed action reverts automatically when the transition ends"
    - "Provider-supplied strings (DNS type/name/value, lastError) render only as React text children; the clipboard receives the prop, never `textContent`"
    - "Serial Playwright suites that share a tenant across tests keep `tenantId`/hosts in module scope, build state through the UI helpers (`attachHost`, `removeHost`) and clean up by slug + e-mail in `afterAll`"

key-files:
  created:
    - apps/web/app/(platform)/plataforma/tenants/[id]/dominios/actions.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/dominios/loading.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/loading.tsx
    - apps/web/components/platform/AttachDomainForm.tsx
    - apps/web/components/platform/DomainCard.tsx
    - apps/web/components/platform/DnsRecordsTable.tsx
    - apps/web/components/platform/ModuleToggles.tsx
    - apps/web/lib/platform-domains.ts
    - apps/web/messages/pt-BR/platformDomains.json
    - apps/web/messages/pt-BR/platformModules.json
    - apps/web/e2e/platform-domains.spec.ts
    - apps/web/e2e/domains-admin.ts
  modified:
    - apps/web/app/(platform)/plataforma/tenants/[id]/dominios/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx

key-decisions:
  - "02-15: the four row actions share `runDomainAction` instead of four copies of the fetch/envelope/redirect ladder — `mapDomainActionError` is therefore called once (the plan's grep gate expected ≥ 4 call sites; the behaviour per action is pinned by e2e tests 2-3 and the API layer assertion instead)"
  - "02-15: `AttachDomainForm` keeps the host as CONTROLLED state synced from `AttachDomainState.value` (02-12's pattern) rather than `defaultValue` + `form.reset()`: React 19 resets an uncontrolled form after every action, which would race the echoed value on an error"
  - "02-15: both `ConfirmDialog`s stay mounted (rendered only when the card can set-primary / remove) and are driven by `open={dialog === …}` so the overlay's exit animation runs; only one `role=dialog` exists at a time"
  - "02-15: Módulos rows show the Ativado/Desativado state as a `StatusPill` (success / neutral) with the helper line at the bottom of the card, following the approved `tenant-page-modulos` mockup (D-33) over the plan's '12 tertiary text above the list' wording"
  - "02-15: `setModuleAction` also revalidates `/plataforma` so the tenant list's module count agrees on the next navigation (mirrors `setTenantStatusAction`)"
  - "02-15: a verified host with a `lastError` keeps 'Verificar agora' (02-09 re-runs only the idempotent allow-list add + claim-before-send invites); `failed` (in the enum, never set by 02-09) renders like pending with the danger pill"

patterns-established:
  - "Tab page contract (02-12 → 02-15): `await requirePlatformTenantDetail(id)` first, `getTranslations(<own namespace>)`, view built on the server (`toXView`), every label a string prop, actions passed as props; `loading.tsx` mirrors the tab's geometry"
  - "Panel mutation = server action that (1) validates ids/keys/body with the API's own Zod, (2) calls `apiFetch`, (3) maps the envelope to catalog keys, (4) `revalidatePath(tenant layout)`, (5) `redirect()` outside the try — toasts happen client-side, no navigation"

requirements-completed: [TENANT-07, ROLE-04, MOD-04, UI-04]

coverage:
  - id: D1
    description: "Attach a customer host from the Domínios tab: the case variant is normalised, the card shows 'Primário' + 'Aguardando DNS', the CNAME/TXT records as text with 'Copiar valor' (clipboard receives the routing target), by-host 404 before verification; 'Verificar agora' flips the card to 'Verificado', hides the DNS table, toasts, the header links the host and by-host answers 200 with isPrimary true"
    requirement: TENANT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts#1 (mobile-chromium + desktop-chromium; clipboard readText on desktop)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-35 from the panel: 'Tornar primário' only on a verified alias, ConfirmDialog with the host, promoted host first with 'Primário', header link flips; the primary's 'Remover' is disabled with the helper AND the API refuses DELETE with 409 primary_with_aliases; removing the alias leaves one card whose 'Remover' is enabled; by-host 404 for the removed host"
    requirement: TENANT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts#2"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-34 lifecycle: a never-verifies host fails 'Verificar agora' with 'A verificação falhou: …', a past deadline makes the next check flip it to 'Expirado' (toast 'O prazo de verificação expirou…', 'Reiniciar verificação' replaces 'Verificar agora'), restart returns it to 'Aguardando DNS' with the DNS table; DB status pinned at each step"
    requirement: TENANT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts#3"
        status: pass
    human_judgment: false
  - id: D4
    description: "Add-form errors keep the typed value: invalid host, a seeded tenant's host → 'Este domínio já está em uso.' with no owner name in the page, the platform host → 'Este endereço é reservado pela plataforma.', re-adding the tenant's own host is idempotent (toast, still one card)"
    requirement: TENANT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts#4"
        status: pass
    human_judgment: false
  - id: D5
    description: "Overflow backstop: a 57-character label host never widens its card (scrollWidth <= clientWidth), the heading carries a title; on the phone the DNS table is replaced by stacked blocks and the page has no horizontal scroll"
    requirement: UI-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts#5 (both projects; phone branch on mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Módulos tab: exactly six switches (Feed, Comunidades, Stories, Eventos, Chat de suporte, Notificações) all on for a new tenant, the reference key never listed; disabling Feed flips the switch at once, toasts, sets tenant_modules.enabled = false and a member's GET /v1/me/bootstrap on the tenant's verified host loses 'feed' within the 30 s bound; a reload renders the server state; re-enabling brings it back; example stays false; no horizontal overflow on the phone"
    requirement: ROLE-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts#6"
        status: pass
    human_judgment: false
  - id: D7
    description: "MOD-04 / D-19 in the panel: rows iterate REAL_TENANT_DEFAULT_MODULES only; setModuleAction validates the key with z.enum(REAL_TENANT_DEFAULT_MODULES) before any request; ModuleToggles knows no module list"
    requirement: MOD-04
    verification:
      - kind: other
        ref: "grep gates: no TOGGLEABLE_MODULES / REAL_TENANT_DEFAULT_MODULES in ModuleToggles.tsx; no '@rede-social/contracts' import in components/platform/*.tsx; e2e #6 getTenantModuleFlag(slug, 'example') === false"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every visible string of both tabs lives in platformDomains.json / platformModules.json (+ 02-12's moduleNames/moduleDescriptions); both routes build as ƒ dynamic; 02-12's platform-tenants spec still green; lint, typecheck, build, web unit suite green"
    requirement: UI-04
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (OK); pnpm lint && pnpm typecheck && pnpm build; pnpm --filter @rede-social/web test (46 passed); playwright platform-tenants.spec.ts --project=desktop-chromium (6 passed, 1 phone-only skip)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The Domínios cards and the Módulos rows read as the approved tenant-page-dominios / tenant-page-modulos mockup sections on phone and desktop"
    requirement: UI-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-domains.spec.ts (structure, pills, table vs stacked blocks, action sets per status)"
        status: pass
    human_judgment: true
    rationale: "Visual fidelity (spacing, pill geometry, the DNS table look) is a judgment call the automated suite does not measure — see 'Human verification' below"

# Metrics
duration: 13min
completed: 2026-09-17
status: complete
---

# Phase 2 Plan 15: Platform Panel Screens III (Domínios + Módulos) Summary

**The tenant page's Domínios and Módulos tabs replace 02-12's stubs: a super_admin attaches a customer host, reads the CNAME/TXT records as text and copies them, verifies on demand, promotes / removes / restarts hosts behind confirmations, and flips any of the six modules optimistically — every path wired through server actions to 02-09's and 02-05's routes and proven end to end by 12 Playwright cases on phone and desktop (attach → Verificar agora → Verificado + by-host 200; toggle → tenant_modules flag + member bootstrap within the 30 s bound).**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-17T02:38:26Z
- **Completed:** 2026-09-17T02:51:37Z
- **Tasks:** 3 (1 tracer + 2 auto)
- **Files modified:** 15 (13 created, 2 stubs replaced)

## Accomplishments

- **Domínios tab** (`tenants/[id]/dominios`): always-visible attach form (`useActionState`, controlled `#host`, field errors invalid / taken / platform-host with the typed value kept, generic alert card, "Adicionando…" pending, success toast + clear); one `DomainCard` per host in API order with host 16/700 (truncate + title), "Primário" brand pill, status pill (Aguardando DNS / Verificado / Expirado / Falhou), "Última verificação {date}" or "Ainda não verificado" (server-formatted), the `DnsRecordsTable` (desktop table / phone stacked blocks, text-only cells keyed `type|name`, 44×44 copy buttons writing the prop value with a 1.5 s icon swap, `role=status` live region and toast, failure → error toast) plus the helper line while unverified, and the action row per status; `EmptyState` below the form for zero hosts; `loading.tsx` with the form + two card skeletons.
- **Lifecycle from the panel** (D-34/D-35): "Verificar agora" (spinner/aria-busy, success toast or "A verificação falhou: {reason}…", 409 expired → "O prazo de verificação expirou…"), "Reiniciar verificação" on expired hosts, "Tornar primário" (brand `ConfirmDialog` naming the host) only on verified aliases, "Remover" (danger `ConfirmDialog`) disabled with the helper on the primary while aliases exist — and the server action independently maps the API's 409 `primary_with_aliases` to the same message; `lastError` rendered as 12 px danger text.
- **Módulos tab** (`tenants/[id]/modulos`): six `Switch` rows in `REAL_TENANT_DEFAULT_MODULES` order (name 14/700 from `platform.moduleNames`, description 12 tertiary, Ativado/Desativado pill), the "As mudanças valem em até 30 segundos, sem novo deploy." helper, `useOptimistic` toggles with per-row `aria-busy`, "Alterações salvas." / generic error with automatic revert; `setModuleAction` validates `z.enum(REAL_TENANT_DEFAULT_MODULES)` + `setModuleBodySchema` before `PUT …/modules/{key}` and revalidates the tenant layout + list; a key missing from the tenant's set renders off; `loading.tsx` with six row skeletons.
- **Server seam** `lib/platform-domains.ts`: `toDomainCardView` decides `canRemove` / `canSetPrimary` / `showVerify` / `showRestart` and formats dates; `mapDomainActionError` switches on `DOMAIN_STATE_REASONS`; client components never import the contracts barrel.
- **Catalog**: two new namespaces (`platformDomains`, `platformModules`) — `platform.json` untouched, `check-ui-literals.sh` green.
- **Proof**: `platform-domains.spec.ts` (6 serial tests × 2 projects, 12 passed) with `domains-admin.ts` (`apiSession`, `expireDomain`, `getDomainStatus`); 02-12's `platform-tenants.spec.ts` still green; lint, typecheck, build (both routes ƒ dynamic) and the 46 web unit tests green.

## Task Commits

1. **Task 1 (tracer)** — `ca9f95c` feat(02-15): tracer — Domínios tab: attach form, domain cards with DNS records + copy, Verificar agora under Playwright
2. **Task 2** — `54c9426` test(02-15): Domínios expansion — set primary, remove (refused on both layers), expired → restart, add-form errors, overflow backstop on both projects
3. **Task 3** — `2575765` feat(02-15): Módulos tab — six optimistic Switch rows, setModuleAction over PUT /modules/{key}, ROLE-04 proven via member bootstrap

## Verification

- `pnpm --filter @rede-social/web exec playwright test platform-domains.spec.ts` → 12 passed (6 tests on `mobile-chromium` + `desktop-chromium`) against the local stack with the fake provider (no worker — "Verificar agora" is the only verification path).
- `pnpm --filter @rede-social/web exec playwright test platform-tenants.spec.ts --project=desktop-chromium` → 6 passed, 1 skipped (phone-only) — 02-12's tab order / access refusals unaffected by the replaced stubs.
- `pnpm lint` (incl. `check-ui-literals.sh`), `pnpm typecheck`, `pnpm build` (`/plataforma/tenants/[id]/dominios` and `/modulos` build as ƒ), `pnpm --filter @rede-social/web test` → 46 passed.
- Acceptance greps verified: catalog node checks exit 0 for both files; `DnsRecordsTable.tsx` has `navigator.clipboard.writeText(`, `role="status"`, `aria-live="polite"`, `` `${record.type}|${record.name}` `` and zero `dangerouslySetInnerHTML` / `innerText` / `textContent`; no `'@rede-social/contracts'` import in `components/platform/*.tsx`; `requirePlatformTenantDetail(` precedes `toDomainCardView(` / `REAL_TENANT_DEFAULT_MODULES.map(` in both pages; no `tabPendingTitle`, no `use cache`, no `TOGGLEABLE_MODULES` in the pages / `ModuleToggles`; every spec string of the three tasks present. One gate not met literally — see Deviations.
- Tracer feedback gate (Task 1): automated `<verify>` re-run green on both projects before expansion.

## Deviations from Plan

### Design adjustments (documented, not deviations from intent)

**1. `mapDomainActionError(` is called once, not ≥ 4 times, in `dominios/actions.ts`**
- **Found during:** Task 1/2
- **Issue:** The plan's acceptance grep expects each of the four row actions to call `mapDomainActionError(` itself. The four actions share `runDomainAction` (uuid gate → fetch → `readRow` → envelope mapping → revalidate → redirect-after-try), so the mapping lives in one place.
- **Resolution:** Kept the shared body (less duplicated error handling to drift); the per-action behaviour the gate stands for — 404 → `notFound`, 409 `expired` / `not_expired` / `not_verified` / `primary_with_aliases` → the mapped toast — is pinned by e2e tests 2 and 3 and by the API-layer 409 assertion in test 2.
- **Files:** `apps/web/app/(platform)/plataforma/tenants/[id]/dominios/actions.ts`

**2. Task 1 shipped the full `DomainCard` (set-primary / remove / restart branches and both `ConfirmDialog`s) and the bodies of all four row actions**
- The plan let Task 1 stub the three remaining actions and wire only "Verificar agora"; implementing the branches once (behind the same props contract) avoided a second pass over the card. Task 2 then only renamed the two pre-interpolated confirm titles to the plan's `confirmRemoveTitle` / `confirmPrimaryTitle` identifiers and added tests 2-5.

**3. Módulos state pill + helper placement follow the approved mockup**
- `tenant-page-modulos` shows "Ativado"/"Desativado" as success/neutral pills and the helper at the bottom of the card; the plan's wording ("12 tertiary text", helper "above the list") was superseded by D-33's visual authority. Strings and behaviour are unchanged.

**4. `AttachDomainForm` is controlled**
- React 19 resets an uncontrolled `<form action>` after every action; a `defaultValue={state.value}` + `reset()` design would race the echoed value on errors. The host input mirrors 02-12's controlled pattern, synced from `AttachDomainState.value` and cleared on `nonce`.

### Auto-fixed Issues

None — no bugs, blocking issues or missing critical functionality were found in 02-09 / 02-05 / 02-12 while wiring the tabs. No package was installed.

## Human verification (end-of-phase, `human_verify_mode: end-of-phase`)

Compare against `.planning/sketches/001-phase-02-designed-screens/index.html` on the platform host, signed in as the seeded super_admin (create a tenant from `/plataforma/novo`, then attach a host such as `app.exemplo.test` and, separately, `never-verifies.exemplo.test`):

1. **Domínios, desktop (≥ 768 px)** — `#tenant-page-dominios`: the inline form (Globe input + brand "Adicionar domínio") under the tabs; each card: host 16/700 + "Primário" (brand) + status pill + "Última verificação dd/MM/yyyy HH:mm"; while unverified the bordered Tipo/Nome/Valor table with a 44×44 copy button at the end of each Valor cell and the helper line; the action row (outline "Verificar agora" / "Reiniciar verificação", ghost "Tornar primário", ghost danger "Remover" disabled with the helper on the primary while other hosts exist); "Último erro: …" in 12 px danger when present. Empty state card "Nenhum domínio ainda" below the form for a tenant with no host.
2. **Domínios, phone (< 768 px)**: the form stacks (full-width button), the DNS table becomes stacked Tipo / Nome / Valor blocks (no horizontal scroll, long TXT values break), the action row wraps.
3. **Confirmations**: "Tornar {host} o domínio primário?" (brand, CheckCircle icon) and "Remover {host}?" (danger, TriangleAlert) vs the two overlay demos; both footer buttons disable with the spinner while pending.
4. **Módulos** — `#tenant-page-modulos`: six `min-h-14` rows (name 14/700, description 12 tertiary, Ativado/Desativado pill, switch), helper line at the bottom; toggling flips the switch immediately with the "Alterações salvas." toast.
5. **Light and dark**: neutral platform tokens only on the platform host.

## Known Stubs

None — every control is wired to its server action and every string to the catalog. (`DomainActionResult.status` after a DELETE is a fixed `'verified'` placeholder the caller never reads; documented in the action.)

## Threat Flags

None beyond the plan's register (T-02-90…T-02-99): no new endpoint, auth path, file access or schema surface. The only new client-side capability is `navigator.clipboard.writeText` of a server-parsed DNS value (T-02-95, mitigated as planned).

## Handoffs

- **02-16**: `scripts/check-static-routes.sh` must include `(platform)/plataforma/tenants/[id]/{dominios,modulos}` (both already build as ƒ dynamic); the module-toggle smoke can drive `/plataforma/tenants/{id}/modulos` with `getByRole('switch', { name: /Feed/ })` and then assert the tenant shell's nav; a branding smoke can attach a fake host through the Domínios UI (`attachHost` helper shape in `platform-domains.spec.ts`).
- **Phase 8**: `DomainCard`, `DnsRecordsTable`, `ModuleToggles` receive strings and actions as props and can be remounted under a tenant-admin route with tenant-lane actions.

## Self-Check: PASSED

- Files: all 15 paths under `key-files` exist on disk.
- Commits: `ca9f95c`, `54c9426`, `2575765` present in `git log`; `commits: 3` measured from `plan_head_before` 7aadaad.
- No stray dev server left listening on :3000; the `tsx watch` API on :8787 (pre-existing) untouched.
