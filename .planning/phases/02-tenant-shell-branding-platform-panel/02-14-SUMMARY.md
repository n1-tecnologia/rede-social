---
phase: 02-tenant-shell-branding-platform-panel
plan: 14
subsystem: web platform panel — Marca tab (branding UI) + kernel BrandPreview + brand-alias scoping
tags: [branding, platform, panel, web, ui, upload, preview, kernel-ui, tokens, playwright, tdd]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 13
    provides: "POST …/branding/uploads (signed URL + uploadId), POST …/uploads/{uploadId}/complete (details.upload vocabulary), PUT …/branding/colors (confirmLowContrast gate), DELETE …/branding/icon, kernel.branding-derive-icons worker job, iconsUpToDate"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 12
    provides: "tenant page layout + TenantTabs, the marca stub, ColorField, ContrastFeedback, NewTenantForm.renderPreview seam, requirePlatformTenantDetail / platformRedirectPath, the server-action shape, FlashToast/ToastProvider"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 07
    provides: "TopBar / BottomNav geometry mirrored in miniature; [data-brand-root] on AppShell"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@rede-social/ui FileDropZone (onFile/onReject, progress, role=alert error slot), ConfirmDialog, useToast, Card/SectionTitle/Skeleton/Button; tokens.css"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "@rede-social/contracts/branding client-safe subpath (deriveBrandColors, contrastReport, brandStyleVars, hexColorSchema, NEUTRAL_BRAND)"
provides:
  - "Marca tab `/plataforma/tenants/{id}/marca` (stub replaced): Logo e ícone card (two FileDropZones), Cores card (ColorField x2 + kernel BrandPreview + ContrastFeedback + Salvar alterações), app-icons card with honest derivation status"
  - "Kernel `BrandPreview` in packages/core/ui (exported from @rede-social/core/ui): two [data-brand-scope][data-theme=light|dark] 200x140 inert mini-shells with inline brandStyleVars, strings as props, readout slot — reused by NewTenantForm and ready for Phase 8"
  - "tokens.css Layer 1b: derived brand aliases declared on :root, [data-brand-root], [data-brand-scope] and [style*=\"--brand-primary\"] (light + dark descendants + light-in-dark override); light neutrals also on [data-theme=\"light\"]"
  - "apps/web/lib/branding-view (BrandingView, toBrandingView) and apps/web/lib/upload (BRANDING_UPLOAD_ACCEPT, resolveMime, classifyFile, uploadToSignedUrl — XHR PUT with progress, no auth header)"
  - "Server actions marca/actions.ts: startBrandingUploadAction, completeBrandingUploadAction, saveBrandColorsAction, removeIconOverrideAction, getBrandingStatusAction (Zod-first, typed results, revalidatePath layout, 401/403 redirect outside try)"
  - "Components: BrandingForm (orchestrator + 3 s x 20 poll with stale-version drop), LogoUpload (+ useSignedUpload hook), IconOverrideUpload (ConfirmDialog removal), DerivedIcons (data-icons-status generating/ready/slow, four thumbs)"
  - "Catalog apps/web/messages/pt-BR/platformBranding.json (platformBranding.{title,assets,logo,icon,upload,errors,colors,preview,icons,toasts})"
  - "e2e: platform-branding.spec.ts (5 tests, both projects), e2e/worker.ts ensureWorker() (spawns ROLE=worker on 8790 or reuses), e2e/branding-admin.ts (insertVerifiedHost, getTenantBranding, closeBrandingAdmin)"
affects: [02-16 (phase smoke: reuse ensureWorker; assert rendered bg-brand on tenant hosts; (platform)/** incl. /marca dynamic), Phase 8 ADMIN-01 (BrandPreview + useSignedUpload flow under admin_tenant), Phase 3 media pipeline (TUS branch behind uploadToSignedUrl)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff 37ae8d5..501b998)
actuals:
  tokens: 26178
  tasks: 3
  commits: 4
plan_head_before: 37ae8d591ed8a759c8981bc6ec4d2d81568f6744

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Brand aliases follow the NEAREST brand scope: `var()` inside a custom property substitutes where it is declared, so tokens.css re-declares --brand-accent & co. on every element that can carry inline --brand-* ([data-brand-root], [data-brand-scope], [style*=\"--brand-primary\"]) instead of on :root only; proven by computed style under Playwright, never by reading the raw variable"
    - "Kernel preview component takes every string as a prop and computes derivations in the browser with the same pure contracts function the API persists with (deriveBrandColors → brandStyleVars) — the panel previews, the API persists"
    - "Signed upload from the panel: classifyFile (UX gate, no request) → server action start ({ kind, mime, size } only) → browser XHR PUT to Storage (content-type + x-upsert, no auth header) with progress → server action complete → typed view; every failure path returns the zone to idle with catalog copy"
    - "Honest async status: the app-icons card shows 'generating' until iconsUpToDate(view) and polls a read action every 3 s at most 20 times, dropping answers with an older iconVersion; after 60 s it says so instead of spinning"
    - "Key-remounted client form: the server page derives `key` from the view facts (iconVersion, iconsReady, logoUrl, iconUrl, colours) so a revalidated render resets client state with no effect-driven sync"
    - "e2e hydration probe: after a full navigation, wait for React's internal props key on the file input before setInputFiles — a change dispatched before hydration is silently lost"

key-files:
  created:
    - packages/core/ui/BrandPreview.tsx
    - packages/core/tests/brand-preview.test.tsx
    - apps/web/lib/branding-view.ts
    - apps/web/lib/branding-view.test.ts
    - apps/web/lib/upload.ts
    - apps/web/lib/upload.test.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/marca/actions.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/marca/loading.tsx
    - apps/web/components/platform/BrandingForm.tsx
    - apps/web/components/platform/LogoUpload.tsx
    - apps/web/components/platform/IconOverrideUpload.tsx
    - apps/web/components/platform/DerivedIcons.tsx
    - apps/web/messages/pt-BR/platformBranding.json
    - apps/web/e2e/platform-branding.spec.ts
    - apps/web/e2e/branding-admin.ts
    - apps/web/e2e/worker.ts
  modified:
    - packages/ui/src/styles/tokens.css
    - packages/ui/tests/tokens.test.ts
    - packages/core/ui/index.ts
    - apps/web/app/(platform)/plataforma/tenants/[id]/marca/page.tsx
    - apps/web/components/platform/NewTenantForm.tsx

key-decisions:
  - "tokens.css: the derived aliases were MOVED out of the :root-only block into the scoped block (`:root, [data-brand-root], [data-brand-scope], [style*=\"--brand-primary\"]`) and 02-04's per-element `*` / `[data-theme=\"dark\"] *` rules were replaced by the explicit scope selectors — a `*` rule would re-apply the dark pair to every descendant of a light frame nested in a dark page, defeating the light-in-dark override; `packages/ui/tests/tokens.test.ts` (outside files_modified) was updated to pin the new contract (documented deviation)"
  - "Strings of the Marca tab's client components come from useTranslations('platformBranding'/'platform') (02-12 pattern: ICU strings with arguments cannot cross the server→client boundary as functions); only the kernel BrandPreview receives plain-string labels as props from the page"
  - "The brand-scope frames carry literal `data-theme=\"light\"` / `data-theme=\"dark\"` attributes (two explicit figures sharing one inert `shell` node) so the CSS contract is greppable and the tokens rules match by literal attribute value"
  - "e2e/worker.ts spawns the root tsx binary with cwd apps/api (the shape of apps/api/tests/integration/worker.test.ts) rather than `pnpm --filter … exec` so SIGTERM reaches the worker process directly and nothing lingers on 8790"
  - "FileDropZone's own onReject (accept/maxBytes) and the hook's classifyFile both gate on the client; `accept` carries the extensions as well as the mimes so an SVG with an empty `type` (some browsers) still passes the primitive and resolveMime maps it"

patterns-established:
  - "Panel tab page contract: requirePlatformTenantDetail(id) first, a pure view mapper, a key-remounted client form receiving typed server actions"
  - "Reusable upload hook (`useSignedUpload`) shared by two zones with distinct `kind`; the signed URL never leaves the hook's closure"

requirements-completed: [UI-04, ROLE-03]

coverage:
  - id: D1
    description: "BrandPreview renders on /plataforma/novo and on the Marca tab: two [data-brand-scope] frames whose brand Button's RENDERED background equals the typed primary (light) and differs in the dark frame; the display name shows without a logo; the seed lab primary never appears on another tenant's page"
    requirement: "UI-04"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-branding.spec.ts#1. preview follows the form; low contrast warns; confirmation saves; the tenant host reflects the new primary (mobile-chromium + desktop-chromium)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/brand-preview.test.tsx (5 cases: two scopes light→dark, inline --brand-primary/--brand-primary-dark, name fallback, two <img> per frame with a logo, no Rede Social, no neutral hex, children once)"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/tokens.test.ts (scoped alias declarations light/dark/light-in-dark, :root fallbacks intact)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Colours saved end-to-end from the Marca tab through PUT …/branding/colors: save disabled until dirty + both valid; low contrast shows Baixo pills + warning + 'Salvar mesmo assim' gate; confirmed save sends confirmLowContrast; by-host answers the new primary on the very next request; a good pair saves with no checkbox"
    requirement: "ROLE-03"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-branding.spec.ts#1 (both projects)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/branding-view.test.ts (4 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Logo upload browser → signed Storage URL → complete: the zone shows the new logo, the app-icons card goes 'Ícones sendo gerados…' → 'Ícones gerados' with four thumbs and 'Versão n' once the worker ran, by-host carries the same icon URLs, the 512 PNG is fetchable; square-icon override upload → 'Gerados a partir do ícone quadrado' → Remover (ConfirmDialog) → iconUrl null and icons re-derived from the logo"
    requirement: "ROLE-03"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-branding.spec.ts#2. logo upload → icons generated → tenant host carries the icon URLs; square icon override → remove (both projects, worker spawned by ensureWorker)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/upload.test.ts (6 cases: accept list, classifyFile type/size/extension fallback, cap boundary)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Upload error states are local to the zone: gif and > 2 MB files show their copy with NO /branding/uploads request; an aborted PUT shows 'Falha no envio…'; an HTML payload named .png is refused by complete with 'O arquivo não é uma imagem válida…'; the persisted logoUrl is unchanged, the zone is idle and a later valid upload succeeds"
    requirement: "ROLE-03"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-branding.spec.ts#3. upload errors (both projects)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Phone layout: the two zones and the two mini-shells stack (same x, icon zone below the logo zone), no horizontal overflow; on /plataforma/novo the two frames are 200 px wide and stacked"
    requirement: "UI-04"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/platform-branding.spec.ts#4 and #5 (mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D6
    description: "All strings in the catalog, no hex literal in TSX, lint/typecheck/build green, the 02-12 suite still green with the modified NewTenantForm"
    requirement: "UI-04"
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (OK); pnpm lint (7/7); pnpm typecheck (8/8); pnpm build (/plataforma/tenants/[id]/marca ƒ); pnpm --filter @rede-social/web test (56); @rede-social/core (116); @rede-social/ui (34); playwright platform-tenants.spec.ts desktop (6 passed, 1 phone-only skip)"
        status: pass
    human_judgment: false
  - id: D7
    description: "End-of-phase human check: the Marca tab and the BrandPreview read as the approved D-33 mockup (`tenant-page-marca`, `new-tenant`), the mini-shells look like the real TopBar/login/BottomNav in miniature in both themes, the upload states (progress bar, 'Gerando ícones…', thumbs) look right"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to the mockup and the look of the mini-shells/thumbs are judgment calls the automated suite does not measure (human_verify_mode end-of-phase)"

# Metrics
duration: 20min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 14: Marca tab — BrandPreview, brand-alias scoping, signed logo/icon uploads, colours with contrast confirmation Summary

**The platform panel's Marca tab now rebrands a tenant end-to-end without touching the database: a kernel `BrandPreview` (two `[data-brand-scope]` light/dark mini-shells rendered with the tenant's real derived tokens — made possible by re-declaring the brand aliases on every brand scope in `tokens.css`), colours saved through `PUT …/branding/colors` behind the both-modes "Salvar mesmo assim" gate, the logo and the optional square icon uploaded straight from the browser to the API-minted signed Storage URL with progress, an honest "Ícones sendo gerados…" → "Ícones gerados" status driven by a bounded poll, and the public by-host answer carrying the new colours and icon URLs on the next request — proven on both Playwright projects with a spec that boots its own worker.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-09-17T03:01:48Z
- **Completed:** 2026-09-17T03:21:25Z
- **Tasks:** 3 (1 tracer + 1 TDD RED/GREEN + 1 e2e completion)
- **Files modified:** 21 (16 created, 5 modified)

## Accomplishments

- **Kernel `BrandPreview`** (`packages/core/ui`, exported from `@rede-social/core/ui`): two 200×140 `[data-brand-scope][data-theme=light|dark]` frames with `brandStyleVars(deriveBrandColors(colors))` inline, an inert mini TopBar (logo or display name + bell + avatar dot), a real `Button variant="brand"` "Entrar" and a glass-bar mini BottomNav; every string a prop, `role="img"` + aria labels, readout slot. Mounted in `NewTenantForm` by default (the `renderPreview` override stays) and in the Marca tab.
- **Brand aliases follow the nearest scope** (`tokens.css` Layer 1b): `--brand-accent`/`--brand-on-accent`/`--brand-primary-hover`/`--brand-primary-soft`/`--brand-gradient` declared on `:root, [data-brand-root], [data-brand-scope], [style*="--brand-primary"]`, the dark pair on `[data-theme="dark"]` and on those scopes under/carrying dark, and a last `[data-brand-scope][data-theme="light"]` override; light neutrals also on `[data-theme="light"]`. Proven by computed style: the light frame's CTA renders `rgb(124, 58, 237)` for `#7c3aed`, the dark frame differs.
- **Marca tab** replacing the 02-12 stub: `requirePlatformTenantDetail(id)` first → `toBrandingView` → key-remounted `BrandingForm` with the assets card (`LogoUpload`, `IconOverrideUpload`), the Cores card (ColorFields, preview, `ContrastFeedback`, "Salvar alterações" disabled until dirty + valid + confirmed when low) and `DerivedIcons`; `loading.tsx` skeletons shaped like the three cards.
- **Five server actions** (`marca/actions.ts`) validating with the contracts Zod before any request, returning typed results, revalidating the tenant layout after mutations and routing 401/403 through `platformRedirectPath` outside the try; `saveBrandColorsAction` surfaces the API's `confirmLowContrast: 'required'` report and never retries with the flag on its own.
- **Signed uploads from the browser** (`lib/upload.ts` + `useSignedUpload`): `classifyFile` UX gate (no request on a bad type/size), `start` → XHR `PUT` with `content-type` + `x-upsert: false` and no auth header, progress into the zone's brand bar, `complete` → view + toast; `details.upload` refusals map to pt-BR copy; one in-flight upload per zone; every failure returns the zone to idle.
- **Honest icon status**: `data-icons-status` generating/ready/slow, four 40×40 thumbs (favicon, 192, 512, maskable), "Versão n" and "Gerados a partir do logo / ícone quadrado"; the form polls `getBrandingStatusAction` every 3 s at most 20 times, drops stale answers (older `iconVersion`) and `router.refresh()`es on readiness.
- **e2e**: `platform-branding.spec.ts` (5 tests, 8 passed + 2 phone-only skips across both projects), `e2e/worker.ts` `ensureWorker()` (spawns `ROLE=worker` on 8790 with the root tsx binary or reuses one; stops it in `afterAll`), `e2e/branding-admin.ts`. The 02-12 suite still passes on desktop.

## Task Commits

1. **Task 1 (tracer): Marca tab colours end-to-end — BrandPreview + alias scoping → view mapper → actions → form → host reflection** — `0d1c27d` (feat)
2. **Task 2 (TDD RED): failing upload-helper tests** — `d766f97` (test)
3. **Task 2 (TDD GREEN): logo upload, square-icon override + Remover, app-icons card with bounded polling, worker helper, e2e test 2** — `ac34040` (feat)
4. **Task 3: Playwright completion — upload error states, mobile stacking, both projects + 02-12 suite green** — `501b998` (test)

**Plan metadata:** see the final docs commit.

## TDD Gate Compliance (Task 2, `tdd="true"`)

| Gate | Command | Result |
|------|---------|--------|
| RED | `pnpm --filter @rede-social/web exec vitest run lib/upload.test.ts` | exit 1 — `Cannot find module './upload'` (the helper did not exist; 6 tests could not run) — committed `d766f97` |
| GREEN | same | 6/6 passed — committed `ac34040` with the implementation |
| REFACTOR | — | not needed (no separate commit) |

## Verification (plan-level)

- `pnpm --filter @rede-social/ui test` → 34 passed (tokens contract re-pinned); `pnpm --filter @rede-social/core test` → 116 passed (111 + 5 brand-preview); `pnpm --filter @rede-social/web test` → 56 passed (46 + 4 branding-view + 6 upload).
- `pnpm --filter @rede-social/core typecheck && lint`, `pnpm --filter @rede-social/web typecheck && lint`, `bash scripts/check-ui-literals.sh` → green; root `pnpm lint` (7/7 + literals), `pnpm typecheck` (8/8), `pnpm build` (`/plataforma/tenants/[id]/marca` builds as ƒ dynamic).
- `pnpm exec playwright test platform-branding.spec.ts` (apps/web) → 8 passed, 2 skipped (phone-only on desktop) across `mobile-chromium` + `desktop-chromium`; the spec spawned and stopped its own worker (port 8790 free afterwards).
- `pnpm exec playwright test platform-tenants.spec.ts --project=desktop-chromium` → 6 passed, 1 phone-only skip (the modified `NewTenantForm` did not break the 02-12 create flow; its test 1 now lands on the real Marca tab).
- Every task's acceptance-criteria greps re-run and passing (the `--brand-primary` grep in the core test only failed on the shell tool's option parsing; the string is present).
- Manual read: no pt-BR literal in `components/platform/{BrandingForm,LogoUpload,IconOverrideUpload,DerivedIcons}.tsx`, `BrandPreview.tsx` or `marca/**`; the only hex literals of this plan live in `tokens.css` (values unchanged) and in the spec.

## Files Created/Modified

- `packages/ui/src/styles/tokens.css` — Layer 1b alias scoping (see Decisions); header comment updated; `:root` neutral block also `[data-theme="light"]`.
- `packages/ui/tests/tokens.test.ts` — the `:root` derivation assertions moved to the scoped block; new assertions for the dark descendant rule, the light-in-dark override and their source order.
- `packages/core/ui/BrandPreview.tsx` (+ `index.ts` export, `tests/brand-preview.test.tsx`).
- `apps/web/lib/branding-view.ts` / `.test.ts`, `apps/web/lib/upload.ts` / `.test.ts`.
- `apps/web/app/(platform)/plataforma/tenants/[id]/marca/{page,actions,loading}.tsx`.
- `apps/web/components/platform/{BrandingForm,LogoUpload,IconOverrideUpload,DerivedIcons}.tsx`; `NewTenantForm.tsx` mounts `BrandPreview` (+ `useTranslations('platformBranding')`).
- `apps/web/messages/pt-BR/platformBranding.json`.
- `apps/web/e2e/{platform-branding.spec,branding-admin,worker}.ts`.

## Decisions Made

- **Alias scoping without the `*` rule.** 02-04's per-element `*` / `[data-theme="dark"] *` rules made every descendant re-derive from its inherited `--brand-*`, which also re-applied the DARK pair to every element inside a light frame nested in a dark page. The plan's explicit scope selectors (`[data-brand-root]`, `[data-brand-scope]`, `[style*="--brand-primary"]`) cover every place `brandStyleVars` is spread (AppShell root, auth `<main>`, the preview frames) and let the `[data-brand-scope][data-theme="light"]` override win by source order. The `:root` block keeps the five raw fallbacks; the derived aliases live only in the scoped block (which still lists `:root`).
- **Client components read the catalog with `useTranslations`** (02-12 decision) — the page passes only the kernel `BrandPreview`'s plain-string labels (its props contract for Phase 8).
- **Literal `data-theme` attributes** on the two frames (one shared inert shell node) so the CSS contract is greppable.
- **Worker spawn shape** mirrors `worker.test.ts` (root tsx binary, cwd `apps/api`) so `SIGTERM` reaches the process itself.
- **Hydration probe in e2e**: after `page.goto`, wait for React's internal props key on the file input before `setInputFiles` (a change dispatched before hydration is lost — first run of test 3 showed no alert for exactly this reason).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `packages/ui/tests/tokens.test.ts` updated to the new alias contract (file outside `files_modified`)**
- **Found during:** Task 1 (tokens.css alias scoping)
- **Issue:** 02-02's test asserted the derived aliases inside the FIRST `:root` block and the dark accent pair inside the FIRST `[data-theme="dark"]` block; the plan moves both into scoped blocks, so the test contract changes with the plan (the orchestrator's note allowed this when documented).
- **Fix:** The `:root` case now pins the five raw fallbacks + the light neutrals + the `[data-theme="light"]` selector; a new case pins the scoped light block, the dark descendant block (`var(--theme-bg) 80%`), the light-in-dark override and their source order; the dark case pins the neutrals only.
- **Files modified:** `packages/ui/tests/tokens.test.ts`
- **Verification:** `pnpm --filter @rede-social/ui test` 34/34, `lint` clean.
- **Committed in:** `0d1c27d`

**2. [Rule 1 - Bug] e2e file pick lost before hydration**
- **Found during:** Task 3 (first run of test 3 on both projects)
- **Issue:** `setInputFiles` right after a full `page.goto` fired the change before React attached its handlers, so no error alert appeared (a debug run with a client-side navigation showed the zone working).
- **Fix:** `waitForHydration(page, selector)` (waits for React's internal props key on the input) before the picks in tests 2 and 3.
- **Files modified:** `apps/web/e2e/platform-branding.spec.ts`
- **Verification:** 8 passed + 2 skipped on both projects, twice.
- **Committed in:** `501b998`

### Design adjustments (documented, not deviations from intent)

- Test 3's "zone back to idle" is asserted on the hidden file input being enabled and no `progressbar` (the `FileDropZone` primitive has no button — its caption label triggers the input).
- `apps/web/e2e/worker.ts` spawns the root tsx binary directly instead of `pnpm --filter @rede-social/api exec tsx` (signal delivery; same entry and env-file).
- `BrandingForm` exposes `previewLabels` + `actions` props instead of the plan's full `labels` object (ICU strings with arguments cannot cross the server→client boundary; 02-12 pattern).
- The poll bound is expressed as `pollExhausted(attempts) = attempts >= 20` with `POLL_MS = 3000`.

---

**Total deviations:** 2 auto-fixed (2 × Rule 1)
**Impact on plan:** No scope change. One test file outside `files_modified` updated because the plan's own contract changed it; every other edit stayed inside the declared list.

## Issues Encountered

- The `:root`-only grep in 02-02's tokens test and the plan's "move the aliases out of `:root`" could not both hold; resolved by re-pinning the test to the scoped contract (deviation 1).
- The acceptance grep `grep -c "tus" apps/web/lib/upload.ts` also matches `xhr.status`; the hard criterion (`tus-js-client` = 0, no TUS import) holds and the docblock no longer names the library.

## Known Stubs

None — every zone, card and preview is wired to real data (`NewTenantForm` passes `logoUrl={null}` by design: no logo exists before the tenant is created).

## Threat Flags

None beyond the plan's register: no new endpoint or schema; uploads go browser → signed URL only (`FormData`/`multipart`/`base64` absent from the actions); every tenant image is an `<img src>` from an API-written URL with `referrerPolicy="no-referrer"`; no raw-HTML injection prop under `components/platform` or in `BrandPreview`.

## Human verification (end-of-phase, `human_verify_mode: end-of-phase`)

Compare with `.planning/sketches/001-phase-02-designed-screens/index.html`, signed in as the seeded super_admin on `http://rede-social.localhost:3000` with the API and a worker running (`ROLE=worker PORT=8790 pnpm --filter @rede-social/api dev`, or let the branding spec spawn one):

1. `/plataforma/novo` (`#new-tenant`): the BrandPreview card sits between the colour fields and the contrast pills — two mini-shells "Claro"/"Escuro" (200×140) showing the typed display name (placeholder "Nome da comunidade" while empty), the bell and avatar dot in the mini TopBar, the "Entrar" CTA in the typed primary (light) and the lighter derived primary (dark), the glass pill with the active chip. Type `#f5f7fb` as primary to see "Baixo" pills + the warning + "Salvar mesmo assim".
2. `/plataforma/tenants/{id}/marca` (`#tenant-page-marca`): "Logo e ícone" card with the two zones side by side (stacked on a phone) — the current logo `h-16` on the neutral ground, "Substituir logo" / "Enviar logo", the square-icon zone with the helper copy and, once set, the 64×64 rounded preview + "Remover"; "Cores" card with the two swatch fields, the preview and the pills; "Salvar alterações" disabled until a colour changes.
3. Upload a PNG logo: the 4 px brand bar and "{n}% enviado", then "Gerando ícones…", then the toast "Alterações salvas."; the app-icons card shows "Ícones sendo gerados…" (spinner) until the worker runs, then "Ícones gerados", the four thumbs (favicon 16 in a 40×40 box, 192, 512, maskable on the primary), "Versão n" and "Gerados a partir do logo". Without a worker the card says after ~60 s "Os ícones ainda estão sendo gerados. Atualize a página em alguns instantes." instead of spinning forever.
4. Dark theme (`rede_theme=dark` cookie): the light mini-shell keeps its light ground and light-mode CTA colour inside the dark page (the light-in-dark override), the dark one uses the derived dark primary.
5. Pick a `.gif` and a > 2 MB file: the zone shows the pt-BR message under it and the network tab shows no `/branding/uploads` call.

## Next Phase Readiness

- **02-16 (wave 7 smoke):** reuse `apps/web/e2e/worker.ts` (`ensureWorker()`); assert rendered `bg-brand` colour on tenant hosts (the alias fix applies to `[data-brand-root]` and the auth `<main>` too); `/plataforma/tenants/[id]/marca` builds as ƒ dynamic; after a rebrand the manifest/favicon per host follow by-host (02-11 route unchanged).
- **Phase 8 (ADMIN-01):** import `BrandPreview` from `@rede-social/core/ui` unchanged; copy the `useSignedUpload` flow against the tenant-scoped mounts; mount inside `[data-brand-root]` — nested `[data-brand-scope]` frames render correctly.
- **Phase 3 (media):** add the TUS branch behind `uploadToSignedUrl(signedUrl, file, { mime, onProgress, signal })` for the private bucket.
- No blockers. No package installed (lockfile untouched). No process left running (ports 3000/8790 free; the pre-existing API dev server on 8787 was reused).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

- Files: all 16 created and 5 modified files present on disk (see key-files).
- Commits: `0d1c27d`, `d766f97`, `ac34040`, `501b998` present in `git log`; `git rev-list --count 37ae8d5..HEAD` = 4 (matches `commits: 4`).
