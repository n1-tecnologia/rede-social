---
phase: 02-tenant-shell-branding-platform-panel
plan: 08
subsystem: web public pages (auth tree on @tria/ui), host routing (proxy.ts), suspended-tenant flow
tags: [auth-pages, proxy, host-routing, 308, branding, suspended, tria-ui, playwright, vitest, tracer]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "hostTenantSchema with status/isPrimary/primaryHost/branding, resolveHostTenant verified-only (D-36), getHostBrand(), brandStyleVars, seed brands, branding.spec.ts"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@tria/ui primitives (Button, IconButton, Input, Card, EmptyState, BottomSheet, useMediaQuery, cn) and tokens.css brand utilities"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 03
    provides: "TENANT_SUSPENDED envelope code answered by requireAuth before the blocked check; interim bootstrap mapping to /auth/blocked"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 04
    provides: "per-namespace pt-BR catalog + loader, scripts/check-ui-literals.sh, apps/web/vitest.config.ts, D-33 approved mockup (#suspended)"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 07
    provides: "<html data-theme> from the tria_theme cookie (D-41), e2e fixtures.ts login()/hosts, 86-spec baseline"
provides:
  - "apps/web/proxy.ts: verified non-primary host → 308 to the tenant's primary origin (scheme from x-forwarded-proto or the request, port from the browser-facing host, path + query from request.nextUrl, Cache-Control: no-store, isRegistrableHost + loop guard) before the Supabase client; PUBLIC entries /comunidade-indisponivel, /aceitar-convite, /convite-expirado, /manifest.webmanifest, /m/<slug>/manifest.webmanifest, /serwist/*, /~offline"
  - "apps/web/proxy.test.ts (8 vitest cases) + `@/` alias in apps/web/vitest.config.ts"
  - "(auth) layout on token utilities: brandStyleVars on <main>, AuthBrand (logo <img alt> as-is or display name text, data-testid=auth-brand-name), generateViewport themeColor = primary, generateMetadata title = display name; min-h-[var(--screen-h)] column max-w-sm"
  - "Shared (auth) components: AuthInput (client icon-name → lucide wrapper over @tria/ui Input), LinkButton (next/link styled as Button: brand|outline|ghost), SubmitButton (Button variant=brand size=lg fullWidth loading=pending), UnavailableCard (Card + TriangleAlert), PasswordField (Input + eye IconButton aria-pressed + 3-segment D-10 meter, autoComplete prop), RulesSheet (BottomSheet, desktopCard from md), ConsentFields (#acceptRules with the sheet, #acceptTerms with /termos · /privacidade)"
  - "/entrar ported: login.tenantHint line (D-22), h1 16/700 secondary with a logo, icon inputs, brand CTA, forgot link, divider, outline sign-up LinkButton; suspended host → UnavailableCard and nothing else; login action redirects to /comunidade-indisponivel before signInWithPassword (D-32)"
  - "/cadastro/[slug], /esqueci-senha, /redefinir-senha ported with Phase 1 paths, ids, hidden inputs and actions byte-identical; ?campos= allow-list name|email|password → Input error + signup.fieldErrors.{name,email} / passwordMin (T-02-49); suspended host → UnavailableCard; not-found on EmptyState"
  - "D-09 pattern for TENANT_SUSPENDED: lib/bootstrap.ts → /auth/suspended (no query) → signOut scope local → /comunidade-indisponivel (EmptyState, reads nothing, branded by the layout); unavailable.json"
  - "/acesso-suspenso, /endereco-invalido, /sem-comunidade on EmptyState + outline LinkButton with their Phase 1 disclosure contracts and data paths unchanged"
  - "e2e: tenant-fixtures.ts (createThrowawayTenant, setTenantStatus, deleteTenantBySlug, throwawayOrigin, closeTenantFixtures) and auth-pages.spec.ts (A alias 308, B unverified generic, C1/C2 suspended, D accented long name, E dark theme) — 14 cases on both projects"
affects: [02-09 domains (invalidateTenantHost keeps the 308 target fresh), 02-10 accept-invite (reuses PasswordField/ConsentFields/SubmitButton/LinkButton/UnavailableCard; /aceitar-convite + /convite-expirado already PUBLIC), 02-11 PWA (manifest + /serwist + /~offline already PUBLIC; (auth) layout emits themeColor via generateViewport), 02-13 suspended screen (already shipped here), 02-16 smoke (tenant-fixtures + auth-pages shapes), Phase 8 PWA-03 audit]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff)
actuals:
  tokens: 21260
  tasks: 3
  commits: 3
plan_head_before: b93d9162c0a414472cb56dbfbea6f7f827bcc7c7

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-rendered public pages hand lucide icons to client primitives by NAME (AuthInput icon='mail'), never as the forwardRef object — React Flight refuses to serialise a component into a 'use client' prop"
    - "Alias folding is a pure function of the by-host answer (primaryHostRedirect): host from primaryHost only, normalised + isRegistrableHost + !== current, path/query re-emitted from request.nextUrl, no-store on the 308"
    - "Suspended tenant = two halves: the page hides the form (UnavailableCard) and the action refuses before any GoTrue call; the API's TENANT_SUSPENDED still catches a token minted elsewhere"
    - "Public error screens are EmptyState + one outline LinkButton; each keeps its docblock disclosure rule (no props / no cookie / no header on the no-input screens) and is grep-gated"
    - "e2e specs that need a tenant state create a throwaway tenant + host (tenant-fixtures.ts) instead of mutating the seed tenants, so the 60 s host caches never cross-contaminate the suite"

key-files:
  created:
    - apps/web/app/(auth)/AuthBrand.tsx
    - apps/web/app/(auth)/AuthInput.tsx
    - apps/web/app/(auth)/LinkButton.tsx
    - apps/web/app/(auth)/UnavailableCard.tsx
    - apps/web/app/(auth)/ConsentFields.tsx
    - apps/web/app/(auth)/PasswordField.tsx
    - apps/web/app/(auth)/RulesSheet.tsx
    - apps/web/app/(auth)/comunidade-indisponivel/page.tsx
    - apps/web/app/auth/suspended/route.ts
    - apps/web/messages/pt-BR/unavailable.json
    - apps/web/proxy.test.ts
    - apps/web/e2e/tenant-fixtures.ts
    - apps/web/e2e/auth-pages.spec.ts
  modified:
    - apps/web/proxy.ts
    - apps/web/vitest.config.ts
    - apps/web/app/(auth)/layout.tsx
    - apps/web/app/(auth)/SubmitButton.tsx
    - apps/web/app/(auth)/entrar/page.tsx
    - apps/web/app/(auth)/entrar/actions.ts
    - apps/web/app/(auth)/cadastro/[slug]/page.tsx
    - apps/web/app/(auth)/cadastro/[slug]/not-found.tsx
    - apps/web/app/(auth)/esqueci-senha/page.tsx
    - apps/web/app/(auth)/redefinir-senha/page.tsx
    - apps/web/app/(auth)/acesso-suspenso/page.tsx
    - apps/web/app/(auth)/endereco-invalido/page.tsx
    - apps/web/app/(auth)/sem-comunidade/page.tsx
    - apps/web/lib/bootstrap.ts
    - apps/web/messages/pt-BR/signup.json

key-decisions:
  - "AuthInput client wrapper (icon by name) instead of passing lucide components from server pages: React Flight rejects a forwardRef object as a client prop ('Functions cannot be passed directly to Client Components'); PasswordField already lived in the client boundary so it imports Lock/Eye directly"
  - "AuthBrand stays a local stand-in for TenantLogo size='auth' even though apps/web now depends on @tria/core (02-07): TenantLogo lacks the data-testid and the break-words/text-center fallback the encoding truth needs; the swap is a follow-up once TenantLogo grows those"
  - "ConsentFields takes { rulesText, labels } only — the tenant name arrives already interpolated in the labels, so a tenantName prop would have been dead"
  - "RulesSheet picks BottomSheet's desktopCard through useMediaQuery('(min-width: 768px)') (sheet on phones, centred card on desktop) rather than a fixed boolean"
  - "The 'Comunidade: {tenant}' line stays on tenant hosts (planner note: D-22 + ROADMAP criterion 1 outrank the UI-SPEC row) and lives in /entrar only, never in the layout, so /endereco-invalido's body text names no tenant (D-23)"
  - "The dark-theme e2e polls the CTA colour: @tria/ui Button carries transition-colors (150 ms), so a one-shot computed read right after the attribute flip captures the start value"

patterns-established:
  - "Client-boundary icon naming: ICONS map inside a 'use client' file, pages pass a string union"
  - "Throwaway tenant fixture per describe block with a unique suffix, cleanup in afterAll (deleteUserByEmail → deleteTenantBySlug → closeAdmin/closeTenantFixtures)"

requirements-completed: [UI-03, TENANT-02, PWA-03]

coverage:
  - id: D1
    description: "On tria-demo/tria-lab hosts /entrar is branded before login (JS disabled): --brand-primary on <main>, logo <img alt> as-is, 'Comunidade: {name}' line; the other tenant's hex/name never appear; generic host neutral"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/branding.spec.ts (4 cases × 2 projects, JS disabled)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/login.spec.ts#/entrar shows the host tenant from the HOST, not from a cookie (D-22)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A verified non-primary host is answered with 308 to the primary preserving path + query, scheme/port derived, Cache-Control no-store; loop guard and unregistrable target never redirect; unverified host is generic"
    requirement: TENANT-02
    verification:
      - kind: unit
        ref: "apps/web/proxy.test.ts (8 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/auth-pages.spec.ts#A. alias host → primary origin (D-35) + #B. unverified host is generic (D-36)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase 1 public paths, field ids/names, hidden inputs and server actions unchanged: login/signup/recovery/blocked/host-mismatch/platform specs green after the port"
    requirement: UI-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/{login,signup,recovery,blocked,host-mismatch,platform}.spec.ts (full suite 100/100 on mobile-chromium + desktop-chromium)"
        status: pass
      - kind: other
        ref: "git diff --quiet HEAD -- the three unchanged actions.ts files (exit 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Suspended tenant (D-32/D-09): bootstrap 403 TENANT_SUSPENDED → /auth/suspended → signed out → branded /comunidade-indisponivel with no query; cold suspended host hides the /entrar and /cadastro forms behind the card"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/auth-pages.spec.ts#C1 bootstrap path + #C2 cold /entrar and /cadastro"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every visible string of the public pages comes from the catalog; no hex, legacy class or pt-BR literal in (auth) TSX"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (exit 0) + grep for hex literals under apps/web/app/(auth) (0 hits)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Accented, 40+ character display name renders verbatim (no truncated code point, no horizontal overflow) in the brand block and the tenant line; dark theme via <html data-theme> repaints the ground and the brand CTA without touching the root layout"
    requirement: UI-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/auth-pages.spec.ts#D. accented, long display name + #E. dark theme"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual fidelity of /entrar, /cadastro, /esqueci-senha, /redefinir-senha and the suspended screen against the prototype and the approved mockup on phone and desktop; E06 long-text backstop (a 40+ char name wraps to at most two centred lines)"
    requirement: UI-03
    verification: []
    human_judgment: true
    rationale: "Look and feel (spacing, weight, the divider, the eye toggle placement, two-line wrapping) is not provable by the automated checks, which only pin structure, tokens and overflow; human_verify_mode is end-of-phase"

# Metrics
duration: 15min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 08: Branded Public Pages, Alias 308 and the Suspended-Tenant Screen Summary

**The public auth tree ported onto `@tria/ui` in the prototype's language and branded per host before login; `proxy.ts` folds verified alias hosts into the primary origin with a 308 (unverified hosts stay generic); a suspended tenant refuses its members through `/auth/suspended` → branded `/comunidade-indisponivel` — pinned by 8 vitest cases and 14 new Playwright cases on both projects with the Phase 1 suite unchanged.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-17T00:00:22Z
- **Completed:** 2026-09-17T00:15:27Z
- **Tasks:** 3
- **Files modified:** 30 (13 created, 15 modified, 2 moved)

## Accomplishments

- **Branded public chrome:** `(auth)/layout.tsx` uses only token utilities, sets the five `--brand-*` variables on `<main>`, renders `AuthBrand` (logo as-is or display-name text, D-26), emits `themeColor` = tenant primary through `generateViewport` and the display name as `<title>`. Dark theme works through `<html data-theme>` alone (E in the new spec).
- **`/entrar` on `@tria/ui`:** tenant line (`login.tenantHint`, D-22), 16/700 title when a logo is present, `Mail`/`Lock` icon inputs, brand `SubmitButton`, forgot link, divider, outline "Criar nova conta". On a suspended host the form is replaced by `UnavailableCard` and the login action redirects to `/comunidade-indisponivel` before calling Supabase.
- **`proxy.ts`:** `primaryHostRedirect()` answers a verified non-primary host with a 308 to `primaryHost` (scheme from `x-forwarded-proto` or the request, port from the browser-facing host, path + query from `request.nextUrl`, `Cache-Control: no-store`, `isRegistrableHost` + loop guard) before the Supabase client; PUBLIC pre-registers the wave-5 paths. `proxy.test.ts` pins the eight routing cases.
- **Sign-up / forgot / reset ported** with byte-identical actions: shared `PasswordField` (eye `IconButton` with `aria-pressed`, three-segment D-10 meter, polite hint), `RulesSheet` on `BottomSheet`, `ConsentFields` (both consents unchecked + required), `?campos=` allow-list → `Input` error state with `signup.fieldErrors`.
- **Suspended tenant in the D-09 pattern:** `bootstrapRedirectPath('TENANT_SUSPENDED') → '/auth/suspended'` (the 02-03 interim `/auth/blocked` mapping is gone), a no-input sign-out Route Handler, and the branded `EmptyState` screen. `/acesso-suspenso`, `/endereco-invalido`, `/sem-comunidade` restyled on `EmptyState` + outline `LinkButton` with their disclosure contracts intact.
- **Tests:** `auth-pages.spec.ts` (A alias 308 + primary, B unverified, C1/C2 suspended, D encoding, E dark) on throwaway tenants via `tenant-fixtures.ts`; full e2e 100/100 on mobile-chromium + desktop-chromium; web unit 20/20; `pnpm lint`, `pnpm typecheck`, `pnpm build` green.

## Task Commits

1. **Task 1 (tracer): branded login on the primary host — /entrar, (auth) chrome, proxy 308** — `10544b6` (feat)
2. **Task 2: port /cadastro, /esqueci-senha, /redefinir-senha — PasswordField, RulesSheet, ConsentFields** — `6128fcd` (feat)
3. **Task 3: suspended tenant D-09 pattern + EmptyState screens + e2e part C** — `76c5956` (feat)

**Plan metadata:** see the final `docs(02-08)` commit.

Tracer feedback gate (Task 1): interactive run, `human_verify_mode = end-of-phase`, automated-only `<verify>` → the chain (typecheck, `vitest run proxy`, literal guard, `auth-pages + login + branding + platform` e2e 36/36) was re-run on the committed state and passed before expanding.

## Files Created/Modified

- `apps/web/proxy.ts` — `primaryHostRedirect()` (D-35), PUBLIC entries for the Phase 2 public paths
- `apps/web/proxy.test.ts` — 8 routing cases (308 Location/scheme/port/method, primary no-redirect, unverified generic + private guard, loop guard, unregistrable target, PUBLIC)
- `apps/web/vitest.config.ts` — `@/` alias so `proxy.ts` resolves under vitest
- `apps/web/app/(auth)/layout.tsx` — branded, token-only chrome; `generateMetadata`/`generateViewport`
- `apps/web/app/(auth)/AuthBrand.tsx` — logo `<img alt>` as-is or display name text (`data-testid="auth-brand-name"`), `hasLogo()`
- `apps/web/app/(auth)/AuthInput.tsx` — client wrapper mapping `icon: 'mail'|'lock'|'user'` to lucide for the server-rendered forms
- `apps/web/app/(auth)/LinkButton.tsx`, `SubmitButton.tsx`, `UnavailableCard.tsx` — shared public-page controls
- `apps/web/app/(auth)/PasswordField.tsx`, `RulesSheet.tsx` (moved from `cadastro/[slug]/`), `ConsentFields.tsx`
- `apps/web/app/(auth)/entrar/{page,actions}.tsx|ts` — ported login, D-32 early refusal
- `apps/web/app/(auth)/cadastro/[slug]/{page,not-found}.tsx` — ported sign-up, field errors, suspended card, EmptyState not-found
- `apps/web/app/(auth)/esqueci-senha/page.tsx`, `redefinir-senha/page.tsx` — ported (actions untouched)
- `apps/web/app/(auth)/comunidade-indisponivel/page.tsx`, `apps/web/app/auth/suspended/route.ts` — D-32 screen + sign-out handler
- `apps/web/app/(auth)/{acesso-suspenso,endereco-invalido,sem-comunidade}/page.tsx` — EmptyState restyles
- `apps/web/lib/bootstrap.ts` — `TENANT_SUSPENDED → /auth/suspended`
- `apps/web/messages/pt-BR/unavailable.json`, `signup.json` — `unavailable.{title,body}`, `signup.fieldErrors.{name,email}`
- `apps/web/e2e/tenant-fixtures.ts`, `apps/web/e2e/auth-pages.spec.ts` — throwaway-tenant helpers and the new spec

## Decisions Made

- **`AuthInput` icon-by-name wrapper** (see Deviations 1) — the only way a Server Component can hand a lucide icon to the client `Input`.
- **`AuthBrand` kept local** although `@tria/core` is now a web dependency: `TenantLogo` has neither the test id nor the wrapping fallback typography the encoding truth needs; the one-line swap stays a follow-up.
- **`ConsentFields` without `tenantName`:** labels arrive interpolated, so the prop would be dead code; the key-link in the plan is otherwise honoured (`<ConsentFields rulesText labels />` inside the form, ids unchanged).
- **`RulesSheet` desktop card via `useMediaQuery`** so the phone gets the sheet and `md+` the centred card, matching the UI-SPEC wording.
- **Tenant line only on `/entrar`** (planner note honoured): D-22 + ROADMAP criterion 1 outrank the UI-SPEC row, and keeping it out of the layout preserves D-23 on `/endereco-invalido`.
- **Dark-theme e2e polls the CTA colour** because `Button` transitions colours; polling reads the settled value, not the animation start.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lucide icons cannot be passed from server pages into the client `Input`**
- **Found during:** Task 1 (first render of the ported `/entrar`: `Functions cannot be passed directly to Client Components … render: function Mail`)
- **Issue:** the plan writes `Input icon={Mail}` from Server Components; `Input` is `'use client'` and a lucide icon is a `forwardRef` object, which React Flight refuses to serialise.
- **Fix:** `apps/web/app/(auth)/AuthInput.tsx` (`'use client'`), an `ICONS` map `{ mail, lock, user }` resolved inside the client boundary; pages pass `icon="mail"`. `PasswordField` (already client) imports `Lock`/`Eye`/`EyeOff` directly. One extra file outside `files_modified`.
- **Files modified:** `apps/web/app/(auth)/AuthInput.tsx` (new), `entrar/page.tsx`, `cadastro/[slug]/page.tsx`, `esqueci-senha/page.tsx`
- **Verification:** `/entrar` renders 200 with the icon inputs; login/signup/recovery specs green
- **Committed in:** `10544b6`

**2. [Rule 1 - Test bug] Dark-theme assertion read the CTA colour mid-transition**
- **Found during:** Task 1 (case E failed with the light primary while the probe already showed the dark derivation)
- **Issue:** `@tria/ui` `Button` has `transition-colors`; a single `getComputedStyle` right after flipping `data-theme` returns the start colour.
- **Fix:** `expect.poll` on the CTA's computed background against the probe value (the assertion intent is unchanged).
- **Committed in:** `10544b6`

### Documented, not fixed

- **Dev-server catalog memoisation:** `loadMessages` memoises per process, so `signup.fieldErrors` only resolved after restarting `next dev` (a 500 "Could not resolve `signup.fieldErrors.name`" in between). Expected behaviour of the 02-04 loader, worth remembering when adding keys while a dev server is running.
- **`grep -c "Criar nova conta"` on the generic host reports 1** — that is the whole catalog in the RSC payload, not a rendered link; `login.spec.ts` asserts the link count is 0.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test bug) + 2 documented. **Impact on plan:** no scope change; no new third-party package (T-02-SC holds).

## Issues Encountered

- `pnpm e2e -- <spec>` and `pnpm --filter @tria/web test -- proxy` do not filter (known from 02-01/02-07); scoped runs used `pnpm --filter @tria/web exec playwright test <spec>` and `pnpm --filter @tria/web exec vitest run proxy`.
- The acceptance grep "`role="status"` exactly once" counted the docblock; reworded the comment so the count is the rendered element only.

## D-33 / sketch deltas

`.planning/sketches/001-phase-02-designed-screens/README.md` shows `approved: true` (product owner, provisional) and `changes_requested: []`; the `#suspended` section (EmptyState with the alert icon on the dedicated page; brand block + Card with the form hidden on `/entrar`) is what shipped. No delta to apply.

## Known Stubs

None — every string comes from the catalog, every brand value from the by-host answer; no placeholder data on any page.

## Threat Flags

None beyond the plan's register: `/auth/suspended` (T-02-43, no input/no forwarding) and `/comunidade-indisponivel` (reads nothing, grep-gated) were planned; `AuthInput` adds no surface.

## Human-check notes for the end-of-phase verifier

1. **Branded login look (phone + desktop):** open `http://tria-demo.localhost:3000/entrar` (purple, logo, "Comunidade: TRIA Demo", 16/700 "Entrar" under the logo) and `http://tria-lab.localhost:3000/entrar` (teal); `http://localhost:3000/entrar` shows the 24/700 "TRIA" wordmark and 24/700 "Entrar". Compare with `reference/frontend-design/app/(auth)/login/page.tsx`: brand block → icon inputs → brand CTA → forgot link → divider "ou" → outline "Criar nova conta".
2. **Sign-up:** `/cadastro` on tria-demo — eye toggle sits inside the password field at the right, three neutral segments below until typing, both consents unchecked; "ver regras" opens a bottom sheet on the phone and a centred card on desktop; "Fechar" closes it.
3. **Suspended screen:** mark a throwaway tenant suspended (or run `auth-pages.spec.ts` C2 with `--headed`) and check `/entrar` shows the brand block + warning card with no form, and `/comunidade-indisponivel` shows the EmptyState with the outline "Voltar para login".
4. **E06 long-text backstop:** the `D.` case (`Associação São José da Comunidade Beneficente`, run `--headed` on mobile-chromium) should wrap to at most two centred lines in the brand block and in the "Comunidade:" line.
5. **Dark theme:** toggle "Tema escuro" in `/configuracoes`, sign out, and check `/entrar` — dark ground, lighter brand CTA.

## Next Phase Readiness

- **02-09:** the 308 target is only as fresh as the two 60 s host caches; `invalidateTenantHost` on set-primary/remove is what keeps a primary switch honest within the TTL.
- **02-10:** `PasswordField` (`autoComplete` prop, optional `error`), `ConsentFields`, `SubmitButton`, `LinkButton`, `UnavailableCard`, `AuthInput` are ready; `/aceitar-convite` and `/convite-expirado` are already PUBLIC.
- **02-11:** manifest, `/serwist/*` and `/~offline` are already PUBLIC; the `(auth)` layout emits `themeColor` via `generateViewport` — the root layout must not pin a static one.
- **Follow-up:** swap `AuthBrand` for `TenantLogo size="auth"` once it carries `data-testid="auth-brand-name"` and the wrapping fallback typography (or update `auth-pages.spec.ts` D).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 13 created files exist on disk; task commits 10544b6, 6128fcd and 76c5956 are in history; commits measured from plan_head_before b93d916 (3).
