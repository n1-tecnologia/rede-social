---
phase: 12-formulario-de-perfil-do-tenant
plan: 11
subsystem: web
tags: [profile-form, web-plumbing, redirect, open-redirect, proxy, platform-row, D-580, D-581, D-583, D-596, UI-D-587, UI-D-594, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 01 the approved sketch gate, plan 02 the module key, the gate error code and the platform catalog, plan 05 the bootstrap profileForm block"
provides:
  - "safeNextPath, REQUEST_PATH_HEADER, AUTH_PATH_PREFIXES, PROFILE_FORM_PATH: the same-origin relative path rule with the (auth) and form exclusions, derived from the route folders"
  - "x-rede-path request header set by proxy.ts per request (inbound copy deleted)"
  - "bootstrapRedirectPath case PROFILE_FORM_PENDING and the requireBootstrap pending redirect before any (app) segment renders"
  - "counters BFF third refusal flow and landOnFormFlow for an open app"
  - "iconFor('clipboard-list') and the profile_form confirmDisable extra with the platform.profile_form.disableDialog catalog block"
affects: [12-12, 12-13, 12-14, 12-15, 12-16, 12-17, 12-18, profile-form]

actuals:
  tokens: 9200
  tasks: 3
  commits: 3
plan_head_before: 296679670671c346335ed4466762772df67d8234

tech-stack:
  added: []
  patterns:
    - "A destination that crosses a request boundary travels in a proxy-owned request header (delete inbound, set from the request's own URL) and is validated where it is used, never where it is written"
    - "Open-redirect rule applied to the raw value and to exactly one decode of it; the exclusion list is derived from the route folders and pinned by a test that reads them"
    - "A counters refusal gets its own landOn*Flow helper; the location is always the bootstrapRedirectPath mapping of the code, and each helper reads its own response clone"

key-files:
  created:
    - apps/web/lib/safe-next-path.ts
    - apps/web/lib/safe-next-path.test.ts
    - apps/web/components/shell/LiveShell.form.test.ts
  modified:
    - apps/web/proxy.ts
    - apps/web/proxy.test.ts
    - apps/web/lib/bootstrap.ts
    - apps/web/lib/bootstrap.test.ts
    - apps/web/app/api/me/counters/route.ts
    - apps/web/app/api/me/counters/route.test.ts
    - apps/web/components/shell/LiveShell.tsx
    - apps/web/lib/push.test.ts
    - packages/core/ui/nav.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
    - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.test.tsx
    - apps/web/components/platform/ModuleToggles.test.tsx
    - apps/web/messages/pt-BR/platform.profile_form.json
    - apps/web/i18n/messages.test.ts

key-decisions:
  - "Planner assumption (a) kept: the next destination travels in x-rede-path set by proxy.ts, read with headers() in requireBootstrap and validated by safeNextPath; the rede_continue cookie stays for cold logged-out deep links only"
  - "bootstrapRedirectPath carries no destination for PROFILE_FORM_PENDING (tenant name only), so a non-render refusal lands on /inicio after saving"
  - "The safeNextPath control-character class also covers the C1 range (U+007F to U+009F), beyond the C0 range continue-path.ts refuses"

patterns-established:
  - "safeNextPath(raw) is total and idempotent: it returns the raw (still encoded) value or null, never a decoded one"
  - "landOnFormFlow mirrors landOnPendingFlow: status 403, one code, a location that starts with the flow's own path, a full navigation, nothing signed out"

requirements-completed: [PFORM-01, PFORM-12, PFORM-15, PFORM-26]

coverage:
  - id: D1
    description: "A gated member opening a deep link is redirected, before any shell renders, to /completar-perfil?next=<validated link>; a hostile or missing header degrades to the bare form"
    requirement: "PFORM-12"
    verification:
      - kind: unit
        ref: "apps/web/lib/bootstrap.test.ts#requireBootstrap: the pending-form redirect (12-11, D-581, D-583, PFORM-15)"
        status: pass
      - kind: unit
        ref: "apps/web/proxy.test.ts#proxy.ts — the x-rede-path request header (12-11)"
        status: pass
    human_judgment: false
  - id: D2
    description: "safeNextPath accepts only a same-origin relative path: encoded, look-alike, over-length, control-character, (auth) and form values are refused after one decode; the exclusion list is derived from the route folders"
    requirement: "PFORM-15"
    verification:
      - kind: unit
        ref: "apps/web/lib/safe-next-path.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "An open app is taken to the form at its next counters refetch through the BFF refusal envelope, only to a /completar-perfil path; Sair under the gate never stalls"
    requirement: "PFORM-12"
    verification:
      - kind: unit
        ref: "apps/web/app/api/me/counters/route.test.ts#GET /api/me/counters: the required form (12-11, PFORM-12, T-12-28)"
        status: pass
      - kind: unit
        ref: "apps/web/components/shell/LiveShell.form.test.ts#landOnFormFlow"
        status: pass
      - kind: unit
        ref: "apps/web/lib/push.test.ts#12b. Sair under the profile-form gate"
        status: pass
    human_judgment: false
  - id: D4
    description: "The platform Módulos row confirms before turning profile_form off, in the shipped danger dialog with the UI-SPEC copy and the clipboard icon; enabling is silent"
    requirement: "PFORM-01"
    verification:
      - kind: unit
        ref: "apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.test.tsx#Módulos page - the profile_form row (UI-D-594)"
        status: pass
      - kind: unit
        ref: "apps/web/components/platform/ModuleToggles.test.tsx#12-11 - ModuleToggles: the profile_form row"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false
  - id: D5
    description: "The platform row dialog and the redirect landing read right on a real screen (visual fidelity to sketch 016 and the UI-SPEC)"
    requirement: "PFORM-26"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity and the end-to-end gate walk are the Playwright and manual proofs of plan 18 (rows M1..M7); no screenshot was taken here"

duration: 6min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 11: Web plumbing for the profile form gate Summary

**A gated member is redirected to /completar-perfil before any shell renders, carrying only a same-origin destination validated by safeNextPath from a proxy-owned x-rede-path header; an open app follows the counters refusal to the form, and the platform row confirms before the module is turned off.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-30T01:28:00Z
- **Completed:** 2026-10-30T01:34:00Z
- **Tasks:** 3
- **Files modified:** 17

## Accomplishments

- Tracer (Task 1): `safeNextPath` (one decode, 500 cap, `(auth)` and form exclusions derived from the route folders), the `x-rede-path` header set in `proxy.ts` with any inbound copy deleted, the `PROFILE_FORM_PENDING` mapping, and the `requireBootstrap` redirect outside any try/catch. A hostile header redirects to the bare form with no `next`.
- Task 2: the counters BFF recognises the code and answers `{ error: { code }, location }` with the mapped location (never one from the API body); `landOnFormFlow` navigates only on 403 plus that code plus a `/completar-perfil` prefix; `disablePush` is pinned against a 403 on its DELETE (it already resolved `deleted: false`, no source change needed).
- Task 3: `iconFor('clipboard-list')`, the `profile_form` `confirmDisable` extra (danger tone, UI-D-594 copy verbatim) and the catalog block with its lookups; enabling opens no dialog.

## Task Commits

1. **Task 1: [tracer] pending member with a deep link goes to the form with a validated next** - `87194a63` (feat)
2. **Task 2: open app to the form, Sair under the gate** - `ba65a29f` (feat)
3. **Task 3: platform row confirms before turning the module off** - `1dd94fb9` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/lib/safe-next-path.ts` - the destination rule, `REQUEST_PATH_HEADER`, `AUTH_PATH_PREFIXES`, `PROFILE_FORM_PATH`
- `apps/web/proxy.ts` - sets `x-rede-path` per request in `buildRequestHeaders`
- `apps/web/lib/bootstrap.ts` - `PROFILE_FORM_PENDING` mapping and the pending redirect
- `apps/web/app/api/me/counters/route.ts` - third refusal flow
- `apps/web/components/shell/LiveShell.tsx` - `landOnFormFlow`, three clones in `onCountersRefused`
- `packages/core/ui/nav.ts` - `clipboard-list` icon
- `apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx` - the `profile_form` extra
- `apps/web/messages/pt-BR/platform.profile_form.json` - `platform.profile_form.disableDialog`
- Tests: `safe-next-path.test.ts`, `bootstrap.test.ts`, `proxy.test.ts`, `route.test.ts`, `LiveShell.form.test.ts` (new sibling), `push.test.ts`, modules `page.test.tsx`, `ModuleToggles.test.tsx`, `messages.test.ts`

## Decisions Made

- Followed planner assumption (a) as recorded. The error-code mapping carries no path, which is acceptable for the rare non-render case.
- Hardened beyond `continue-path.ts`: the control-character class includes the C1 range and a list of slash/backslash look-alikes (U+2044, U+2215, U+2216, U+29F5, U+29F8, U+29F9, U+FF0F, U+FF3C, U+FE68), tested on the raw and the decoded value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Counters refusal helpers share one response body**
- **Found during:** Task 2
- **Issue:** `onCountersRefused` cloned the response only for the blocked helper and passed the original to the pending helper; a third helper would read an already consumed body.
- **Fix:** each of the first two helpers gets its own `response.clone()`, the form helper takes the original.
- **Files modified:** `apps/web/components/shell/LiveShell.tsx`
- **Verification:** `LiveShell.pending.test.ts`, `LiveShell.form.test.ts`
- **Committed in:** `ba65a29f`

### Plan-sanctioned variations

- The LiveShell cases live in the sibling file `LiveShell.form.test.ts` (the plan allowed either; `LiveShell.pending.test.ts` is unchanged). The Task 2 verify command does not name the sibling, so it was run explicitly as well.

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** None on scope; the fix is required for the third helper to work.

## Issues Encountered

None. `disablePush` needed no source change: a non-ok DELETE already resolves `deleted: false`.

## Verification

- Sketch guard (`approved: true`) passes for every task.
- Task verifies green: `safe-next-path`, `bootstrap`, `proxy` (122 tests); counters route, `LiveShell.pending`, `LiveShell.form`, `push` (36); modules page, `ModuleToggles`, `messages` (1517); `bash scripts/check-ui-literals.sh` clean.
- Acceptance greps pass (`x-rede-path` in `proxy.ts`, `safeNextPath` in `bootstrap.ts`, `PROFILE_FORM_PENDING` in the BFF and `LiveShell`, `clipboard-list` in `nav.ts` and the modules page, the catalog `confirm` string).
- Whole `apps/web` vitest (266 files, 5915 tests) and `packages/core` vitest (94 files, 1376 tests) green; `tsc --noEmit` clean in `apps/web` and `packages/core/ui`. `turbo typecheck` and `next build` were not run (disk).

## Known Stubs

None.

## Threat Flags

None. T-12-27 and T-12-28 are mitigated as planned (single decode, same-origin only, proxy deletes inbound header, location from the mapping, prefix check in the shell).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 12 (the completion page) can rely on `safeNextPath`, `PROFILE_FORM_PATH` and the `?next=` / `?t=` query shapes; it must not call `requireBootstrap`.
- Visual fidelity of the redirect landing and the platform dialog is for the Playwright and manual proofs of plan 18.

## Self-Check: PASSED

- Created files exist; commits `87194a63`, `ba65a29f`, `1dd94fb9` exist; no commit message carries a trailer or tool attribution; `.planning/sketches` untouched.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*
