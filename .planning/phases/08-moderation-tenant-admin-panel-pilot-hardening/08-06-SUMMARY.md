---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 06
subsystem: tenant-admin
tags: [branding, tenant-lane, display-name, contrast, reuse, uploads, hono, nextjs, D-339, D-342, UI-D-279, UI-D-284]
status: complete

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-02: BrandingForm keyed on the tenant only and adopting a refreshed view in place (WINDOWS #71), the form this plan reuses unchanged"
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-05: the /v1/admin router, the Administração group in Configurações, admin.json, the UI-D-284 refusal posture"
  - phase: 02-tenant-branding
    provides: "the platform branding kernel services (setBrandingColors, startBrandingUpload, completeBrandingUpload, removeIconOverride, invalidateAllTenantHosts), updateTenant, the derive-icons worker job"
provides:
  - "adminBrandingSchema, adminTenantBodySchema, adminBrandingUploadParamsSchema, tenantDisplayNameSchema, TENANT_DISPLAY_NAME_MAX, DISPLAY_NAME_ISSUES in @rede-social/contracts/branding"
  - "GET /v1/admin/branding, PUT /v1/admin/branding/colors, POST /v1/admin/branding/uploads, POST /v1/admin/branding/uploads/{uploadId}/complete, DELETE /v1/admin/branding/icon, PATCH /v1/admin/tenant (all tenant.manage, all on ctx.tenantId)"
  - "toBrandingView(BrandingSource): one mapper for the platform detail and the admin subset"
  - "/configuracoes/marca (page, loading, actions with the five BrandingActions plus saveDisplayNameAction) and DisplayNameCard"
  - "Configurações 'Marca' row (palette icon), app.settings.rows.brand, admin.brand.*"
affects: [08-07, 08-12, 08.1]

actuals:
  tokens: 24100   # chars/4 over this plan's added lines in apps/, packages/ and scripts/ (96,356 chars, 21 files)
  tasks: 2
  commits: 2      # MEASURED: git rev-list --count d4203b1..HEAD (no concurrent quick-task commit landed in the range)
plan_head_before: d4203b144a61776a0880d6bea863b1d198e684ea

tech-stack:
  added: []
  patterns:
    - "Tenant-lane reuse of a platform editor: the same component, server actions with the same signatures that IGNORE the tenantId argument, API routes with no tenant id that pass ctx.tenantId to the platform kernel services"
    - "A per-route @hono/zod-openapi hook that turns a refusal about one field into details.{field} and falls back to the shared issue list"
    - "A server action that leaves for a 403 FORBIDDEN destination revalidates the layout first, so a prefetched copy of the destination cannot show what the caller just lost"

key-files:
  created:
    - apps/api/src/routes/admin/branding.ts
    - apps/api/src/routes/admin/tenant.ts
    - apps/api/tests/integration/admin-branding.test.ts
    - apps/web/app/(app)/configuracoes/marca/page.tsx
    - apps/web/app/(app)/configuracoes/marca/loading.tsx
    - apps/web/app/(app)/configuracoes/marca/actions.ts
    - apps/web/components/admin/DisplayNameCard.tsx
    - apps/web/components/admin/DisplayNameCard.test.tsx
    - apps/web/e2e/admin-branding.spec.ts
  modified:
    - packages/contracts/src/branding.ts
    - packages/contracts/src/platform.ts
    - packages/contracts/tests/branding.test.ts
    - apps/api/src/routes/admin/index.ts
    - apps/web/lib/branding-view.ts
    - apps/web/lib/branding-view.test.ts
    - apps/web/app/(app)/configuracoes/page.tsx
    - packages/core/ui/nav.ts
    - apps/web/messages/pt-BR/admin.json
    - apps/web/messages/pt-BR/app.json
    - apps/web/e2e/branding-admin.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "adminBrandingSchema is an explicit strict object in branding.ts, not a .pick of platformTenantDetailSchema: platform.ts imports branding.ts, so the pick would be a circular import"
  - "The display-name rule moved to branding.ts as tenantDisplayNameSchema and platform.ts reuses it: one value for both lanes, so ADMIN-01 encoding parity holds by construction and is also pinned by a test"
  - "Zod 4 counts a string's length in code points (an emoji is one, a combining accent is one more); the parity test pins that, and the name card counts the same way"
  - "The tenant-lane Marca form is keyed on the tenant only, not on the display name: BrandingForm already adopts a refreshed view (name included) in place since 08-02, and keying on the name would remount it on every name save and drop a colour being typed"
  - "A 403 FORBIDDEN from any BrandingForm action redirects to /configuracoes?erro=sem-permissao, which toasts admin.errors.forbidden: the unchanged form has no outcome for it. The name card handles forbidden itself (toast and refresh into notFound)"
  - "PATCH /v1/admin/tenant answers details.displayName = 'required' | 'too_long' through a per-route hook; any other key keeps the shared issue list"
  - "The e2e subject is a throwaway community and its admin, never rede-demo (a brand change sits in both 60 s host caches); the API integration suite runs the flow on admin@rede-demo.local and restores the seed rows, Storage objects and derivation jobs afterwards"

patterns-established:
  - "Pattern: an integration suite that must change a seed tenant snapshots its rows and Storage object names in beforeAll and puts both back in afterAll"

requirements-completed: [ADMIN-01]

coverage:
  - id: D1
    description: "Tracer: the admin saves new colours on the tenant lane. 200 no-store with the three brand facts only; rede-demo's row changes and rede-lab's does not; the next bootstrap carries the new primary; the shell's --brand-primary follows on the next navigation"
    requirement: ADMIN-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-branding.test.ts#branding tracer"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-branding.spec.ts#branding tracer (mobile + desktop)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/branding-view.test.ts#toBrandingView on the tenant lane; packages/contracts/tests/branding.test.ts#adminBrandingSchema"
        status: pass
    human_judgment: false
  - id: D2
    description: "No tenant id anywhere: the paths carry none, a body carrying one is a 400, the actions ignore the form's argument, a rede-lab uploadId completed from rede-demo is the same 404 as an unknown id and changes nothing, rede-lab's admin edits rede-lab only"
    requirement: ADMIN-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-branding.test.ts#branding tracer > no tenant id can ride along; #uploads on the tenant lane > a rede-lab uploadId"
        status: pass
      - kind: other
        ref: "grep -cE 'tenants/\\{id\\}|:id\\b' apps/api/src/routes/admin/branding.ts = 0; grep -c platformRedirectPath marca/actions.ts = 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Same pipeline as the platform editor: the contrast gate (400 with the report, then a confirmed save), logo and icon uploads, worker derivation of the icon set and favicon, icon override removal, the 413 size cap"
    requirement: ADMIN-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-branding.test.ts#branding tracer > a failing contrast pair; #uploads on the tenant lane"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-branding.spec.ts#a logo upload derives the icons; #the square icon override (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Last write wins between the super_admin's platform route and the admin's route, in both orders"
    requirement: ADMIN-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-branding.test.ts#last write wins between the super_admin and the admin (D-342)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Display name: strict { displayName } body (status, slug, modules refused), required and too_long refusals, a valid name with accents and emoji saved for demo only; the platform and admin rules accept and refuse the same samples"
    requirement: ADMIN-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-branding.test.ts#display name"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/branding.test.ts#display name parity: platform update vs tenant lane"
        status: pass
    human_judgment: false
  - id: D6
    description: "Permissions and lanes: tenant.manage on every route (support and member 403), TENANT_HOST_MISMATCH on the lab host, the Marca row and page absent for a member, the page notFound() on the platform host, a lost permission lands on Configurações with the forbidden toast"
    requirement: ADMIN-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/admin-branding.test.ts#gates on every route"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-branding.spec.ts#a member sees no Marca row; #a lost permission (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Name card (UI E11): disabled until the trimmed value differs and is valid, required error for empty and spaces-only, typing stops at 60, 'Salvando…' while pending, 'Nome salvo.' and the preview follows, a failure toasts and keeps the value, a server field error, the forbidden toast"
    requirement: ADMIN-01
    verification:
      - kind: unit
        ref: "apps/web/components/admin/DisplayNameCard.test.tsx"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/admin-branding.spec.ts#the name card (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Freshness backstops: a colour typed while the icon poll runs survives the poll's refresh and saves (E12 loading, WINDOWS #71); the tenant's /entrar shows the new colour within 70 s of a save (E12 partial, automated half)"
    requirement: ADMIN-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/admin-branding.spec.ts#a logo upload derives the icons; a colour typed while the icon poll runs survives its refresh; #after a save, the tenant's login screen shows the new colour within 70 s (mobile + desktop)"
        status: pass
    human_judgment: false
  - id: D9
    description: "E12 partial, real-device half: the installed PWA picks up the new manifest (name, colour, icons) on its next launch"
    verification: []
    human_judgment: true
    rationale: "Real-device install behaviour. It belongs to the D-345 real-device checklist (08-12), which is blocked until run; phones cannot reach *.localhost"
  - id: D10
    description: "The Marca screen's look on a phone and on desktop: freshness note, name card with its secondary save above the unchanged form, the skeleton matching the cards"
    verification: []
    human_judgment: true
    rationale: "Visual fit against UI-D-279 and the prototype is a judgment no test asserts"

duration: 27min
completed: 2026-10-02
---

# Phase 8 Plan 06: The tenant lane's Marca editor Summary

**Admins now edit their community's name, logo, square icon and colours from Configurações → Marca with the super_admin's editor, unchanged. New `/v1/admin/branding/*` routes and `PATCH /v1/admin/tenant` carry no tenant id. They pass the session's `ctx.tenantId` to the same kernel services the platform uses, so the contrast gate, icon derivation and host invalidation are identical, and whichever lane saves last wins.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-10-02T15:18:49Z
- **Completed:** 2026-10-02T15:46:24Z
- **Tasks:** 2
- **Files modified:** 21 (9 created, 12 modified)

## Accomplishments

- **Contract** (`@rede-social/contracts/branding`):
  - `adminBrandingSchema` is `{ tenant: { displayName, branding, contrast } }`, strict at both levels;
  - `adminTenantBodySchema` is `{ displayName }`, strict;
  - `tenantDisplayNameSchema` is the one display-name rule; the platform's create and update bodies now use it too.
- **API** (`apps/api/src/routes/admin/branding.ts`, `tenant.ts`), all behind `requireAuth` and `tenant.manage`:
  - `GET /`, `PUT /colors`, `POST /uploads`, `POST /uploads/{uploadId}/complete` and `DELETE /icon`;
  - `PATCH /v1/admin/tenant`, which answers `details.displayName: 'required' | 'too_long'` on a name refusal;
  - every answer is `no-store` and every log line carries ids only.
- **Web:**
  - `/configuracoes/marca` shows the freshness note, then `DisplayNameCard`, then the unchanged `BrandingForm` with all five tenant-lane actions;
  - the page answers `notFound()` without `tenant.manage` and on the platform host;
  - `loading.tsx` draws one skeleton per card;
  - "Marca" (`palette`) is the first Administração row and is rendered only for `tenant.manage` holders.
- **UI-D-284:**
  - a 403 `FORBIDDEN` from a form action lands on Configurações with "Você não tem mais permissão para esta ação.";
  - the name card toasts it itself and refreshes into `notFound()`.

## Task Commits

1. **Task 1 (tracer): the admin changes the colours from Marca and the shell shows them.** `e1e39f3` (feat)
2. **Task 2: uploads, the display name, last write wins, the gates and the freshness backstops.** `4c764f7` (feat)

**Plan metadata:** the docs(08-06) commit that adds this file.

## Files Created/Modified

See `key-files` in the frontmatter. The main ones:
- `apps/api/src/routes/admin/branding.ts`: the five brand routes, plus `brandOf`, which reads the brand through `getTenantDetail(ctx.tenantId)`.
- `apps/api/src/routes/admin/tenant.ts`: the rename route and its field hook.
- `apps/web/app/(app)/configuracoes/marca/actions.ts`: the tenant-lane actions, which ignore `tenantId`.
- `apps/web/components/admin/DisplayNameCard.tsx`: the name card.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug avoided] The form key leaves out the display name**
- **Found during:** Task 1.
- **Issue:** UI-D-279 says "the tenant-lane formKey includes `displayName`". That key would remount `BrandingForm` on every name save and drop a colour being typed, which is the WINDOWS #71 failure 08-02 fixed.
- **Fix:**
  - The form is keyed on the tenant only.
  - The new name still reaches the preview: since 08-02 the form adopts a refreshed view (name included) in place.
  - The e2e name case asserts that the preview shows the new name.
- **Committed in:** `e1e39f3`.

**2. [Rule 2 - Missing critical] A 403 `FORBIDDEN` from the unchanged form had no UI-D-284 path**
- **Found during:** Task 1.
- **Issue:** `BrandingForm`'s result types have no "forbidden" outcome, so a demoted admin would only have seen the generic error.
- **Fix:**
  - The tenant-lane actions redirect to `/configuracoes?erro=sem-permissao`, which toasts `admin.errors.forbidden` (`configuracoes/page.tsx`).
  - Before that redirect the layout is revalidated (Task 2), so a prefetched copy of Configurações cannot show the Marca row under the toast.
- **Verification:** e2e "a lost permission" (mobile and desktop).
- **Committed in:** `e1e39f3`, `4c764f7`.

**3. [Rule 2 - Missing critical] Unit test for the name card**
- **Issue:** the failure toast, the server field error and the forbidden path cannot be forced from e2e.
- **Fix:** `DisplayNameCard.test.tsx`, 6 cases, using the real `admin.json`.
- **Committed in:** `4c764f7`.

**4. [Adaptation] `adminBrandingSchema` is an explicit object, and the name rule lives in `branding.ts`**
- **Issue:** `platform.ts` imports `branding.ts`, so a `.pick` of `platformTenantDetailSchema` inside `branding.ts` would be a circular import. The plan allows the explicit object.
- **Fix:** the display-name rule became `tenantDisplayNameSchema` in `branding.ts`, and `platform.ts` reuses it verbatim.
- **Committed in:** `e1e39f3`.

**5. [Adaptation] The e2e subject is a throwaway community, not `admin@rede-demo.local`**
- **Issue:** the tracer truth names the seed admin. A brand change, however, sits in both 60 s host caches, and `tenant-fixtures.ts` forbids flipping seed tenants in e2e.
- **Fix:**
  - The spec uses `createMembersTenant(…, 0)`: its own admin and a host unique per run and per project.
  - The API integration suite runs the same flow on `admin@rede-demo.local` and restores the seed rows, the Storage objects it added and its derivation jobs in `afterAll`. This is the 08-05 deviation 6 precedent.
- **Committed in:** `e1e39f3`, `4c764f7`.

**6. [Finding] Zod 4 measures string length in code points**
- **Found during:** Task 2 (the parity test).
- **Issue:** a sample of 59 characters plus an emoji (61 UTF-16 code units) was accepted.
- **Fix:**
  - The parity test pins the real rule: an emoji counts as one character, a combining accent as one more.
  - My contract comment says so, and the name card counts the same way.
- **Not changed:** `platform.ts` `createTenantBodySchema`'s older comment ("UTF-16 code units") is inaccurate.

**7. [Test fix] The Marca row locators are exact**
- **Found during:** Task 2, full spec run.
- **Issue:** after the name case renames the tenant to "Marca Ação 🎉 …", the shell's brand link also matched `name: 'Marca'`.
- **Fix:** the row and heading locators use `exact: true`. No product change.

**8. [Adaptation] Files outside the plan's list**
- `packages/contracts/src/platform.ts`: reuses the shared name rule.
- `apps/web/e2e/branding-admin.ts`: gains `getTenantDisplayName`.
- `apps/web/components/admin/DisplayNameCard.test.tsx`.

**9. [Acceptance grep] `grep -c DisplayNameCard page.tsx` prints 3, not 1**
- The three lines are the import, the JSX and the doc comment.
- An import plus a usage cannot print 1. The intent (the card is rendered by the page) holds.

---

**Total deviations:** 9 (1 Rule 1, 2 Rule 2, 4 adaptations, 1 finding, 1 test fix).
**Impact on plan:** No scope creep. Every truth holds, except that the real-device half of E12/partial is the 08-12 checklist's by plan.

## Issues Encountered

- **DB resets.** The developer consented on 2026-10-02 (this execution session) to `pnpm db:reset && pnpm db:seed` on the LOCAL Supabase stack for every Phase 8 plan. A backup exists at `~/rede-social-local-backups/pre-08-reset.sql`. This plan ran two local resets, before each integration proving run. Nothing touched the hosted Supabase, GCP or Vercel projects, and nothing was deployed or pushed.
- **Concurrent session.** No `quick-261002-f4y` commit landed between `d4203b1` and this plan's commits.
- **Process hygiene.** Playwright started and stopped its own API, web and worker processes on every run. No `tsx watch`, `next dev` or worker process was left running (checked).
- **Leftover jobs from the e2e tracer.** Its colour saves on throwaway tenants queue `kernel.branding-derive-icons` jobs. When a run has no worker, those jobs stay `created` after the tenant is deleted, and a later worker resolves them as `tenant_gone`. They are harmless.

## Verification Run

- **Task 1:**
  - contracts test (87);
  - api typecheck and lint;
  - `vitest lib/branding-view` (6);
  - after a reset, `admin-branding.test.ts -t "branding tracer"`: 5/5;
  - web typecheck and lint;
  - `check-ui-literals` OK;
  - `playwright admin-branding.spec.ts -g "branding tracer"`: 2/2 (mobile and desktop).
  - The tracer feedback gate (interactive, `end-of-phase`, automated-only verify) passed on that green run, so expansion continued with no checkpoint.
- **Task 2:**
  - contracts test (99);
  - api typecheck;
  - after a reset, `admin-branding.test.ts` + `platform-branding.test.ts`: 40/40;
  - web typecheck and lint;
  - `check-ui-literals` OK;
  - `playwright admin-branding.spec.ts platform-branding.spec.ts`: 24 passed and 2 skipped (the platform spec's two phone-only cases on desktop, by design).
- **Plan level:**
  - web vitest: 56 files, 1336 tests;
  - root `pnpm lint` green;
  - `pnpm boundaries`: no issues.
- **Not run:** `scripts/check-static-routes.sh` needs a production `next build`. The new `REQUIRED_KEYS` entry is checked at the 08-12 gate's `pnpm verify`.
- **Acceptance greps:**
  - `ctx.tenantId` in `branding.ts`: 7;
  - `{id}` / `:id` paths: 0;
  - `BrandingForm` in the Marca page: 4;
  - `BrandingForm.tsx` diff since the task base: none;
  - `platformRedirectPath` in the Marca actions: 0;
  - `adminTenantBodySchema` in `tenant.ts`: 3, and the contract defines it with `.strict()`;
  - `/uploads` in `branding.ts`: 2;
  - `last write wins` in the integration test: 2.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-08-31: no tenant id on any path, body or answer; proven by the integration and the greps.
- T-08-32: the strict name body; the `status`, `slug` and `modules` cases are refused.
- T-08-33: a foreign `uploadId` is the same 404 as an unknown one.
- T-08-34: the shipped 413 cap applies.
- The new `GET /v1/admin/branding` reads through `getTenantDetail` (an admin-lane read) keyed by `ctx.tenantId`, and answers only the three brand facts.

## User Setup Required

None. There are no migrations. The routes and the screen ship with the next release.

## Next Phase Readiness

- ADMIN-01 is complete on the tenant lane. 08-07 (Regras) can follow the same Marca chrome and the name card's pattern.
- 08-12's D-345 real-device checklist should include the E12/partial row: after a brand save, the installed PWA picks up the new name, colour and icon on its next launch.

## Self-Check: PASSED

- Created files exist: `admin/branding.ts`, `admin/tenant.ts`, `admin-branding.test.ts`, `marca/{page,loading,actions}.tsx|ts`, `DisplayNameCard.tsx`, `DisplayNameCard.test.tsx`, `admin-branding.spec.ts`.
- Commits `e1e39f3` and `4c764f7` are in `git log`, and neither carries a co-author trailer.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
