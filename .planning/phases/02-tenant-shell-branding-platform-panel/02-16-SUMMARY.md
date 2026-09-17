---
phase: 02-tenant-shell-branding-platform-panel
plan: 16
subsystem: testing / verification gate (Playwright smoke, build-output gate, CI, deploy docs)
tags: [verification, smoke, e2e, playwright, ci, pwa, docs, phase-gate, theme-toggle]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 07
    provides: "AppShell + buildNav ([data-shell-nav], aria-current text-brand), ThemeToggle + setTheme, platform-host neutral shell with the single /plataforma tab"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 08
    provides: "proxy.ts alias 308 + PUBLIC paths, (auth) layout brand vars + AuthBrand, /comunidade-indisponivel, tenant-fixtures.ts throwawayOrigin"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 10
    provides: "invite mail on verification (Subject 'Convite para administrar {name}'), *.localhost rule for GoTrue redirectTo"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 11
    provides: "root layout generateMetadata/generateViewport (manifest link, favicon, apple-touch-icon, theme-color), /m/[slug]/manifest.webmanifest, playwright.pwa.config.ts + pwa.spec.ts, neutral icon set"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 12
    provides: "platform panel (list, D-31 form, tenant tabs, Status tab ConfirmDialog), PlatformRail.themeSlot seam, platform-tenants.spec.ts selectors"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 13
    provides: "kernel.branding-derive-icons worker job, seed icon sets at /icons/1/, branding bucket migration"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 14
    provides: "Marca tab (logo upload, data-icons-status, colour save bumping iconVersion), e2e/worker.ts ensureWorker(), tokens.css alias scoping ([data-brand-root])"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 15
    provides: "Domínios tab (attach / Verificar agora / Primário), Módulos tab (six switches, feed), domains-admin.ts apiSession()"
provides:
  - "apps/web/e2e/phase2-smoke.spec.ts — serial phase smoke on a panel-provisioned throwaway tenant (5 tests; 3-5 skip on pixel-chromium): panel reachability + platform-rail theme row, D-31 create, D-36 neutral shell before verification, Domínios attach + Verificar agora, invite mail in Mailpit, first-HTML brand / theme-color / manifest / neutral icons, rendered CTA colour, Marca rebrand (logo → icons v1, primary → v2) followed by served HTML + manifest icons, member shell nav colour on iPhone 14 / Pixel 7 / desktop, alias 308, Status-tab suspend → branded /comunidade-indisponivel → reactivate, Feed toggle (panel path) + reference-module flip (nav + API-404 path) — the honest two-witness ROLE-04 proof, branded recovery mail"
  - "apps/web/e2e/branding.spec.ts — 'Phase 2 — served brand per host (phone + desktop)': B1 first HTML + rendered CTA + manifest/derived icons per seed tenant, B2 logged-in shell rendered nav colour + meta/link, B3 neutral generic host; 02-01's four tests untouched"
  - "apps/web/playwright.config.ts — projects mobile-chromium (iPhone 14), pixel-chromium (Pixel 7, testMatch anchored to branding + phase2-smoke), desktop-chromium; CI reporter github + html (PLAYWRIGHT_REPORT_DIR), outputDir (PLAYWRIGHT_OUTPUT_DIR), expect timeout 10 s; API + web webServer only"
  - "apps/web/app/(platform)/plataforma/layout.tsx — kernel ThemeToggle in PlatformRail.themeSlot (tria_theme strict read, app.nav.theme, 02-07 setTheme) — D-41 on the platform rail"
  - "scripts/check-static-routes.sh + root `check:static-routes` — build-output gate over .next/prerender-manifest.json + app-path-routes-manifest.json (REQUIRED_KEYS, GUARDED_PREFIXES, ALLOWED_STATIC ^/_ and ^/serwist/; exit 2 without a build, 1 with offenders)"
  - "root `verify` (the local exit gate, 11 steps) and `verify:smoke` (branding + phase2-smoke + invite + recovery specs, then the PWA @tracer half)"
  - ".github/workflows/ci.yml — single `checks` job mirroring `verify` step for step (pnpm lint with the UI literal guard, static-routes gate after the build, dev-server e2e on three projects, production-build PWA e2e with separate report/trace folders, artifacts on failure), workflow_call preserved for deploy-api.yml"
  - "docs/DEPLOY.md — Documents index, fake-provider / 308 / verified-only pointers, Supabase hosted auth settings (Email OTP Expiration = 86400), Storage buckets note, Phase 2 verification section (verify, verify:smoke, prerequisites, build-output gate, manual real-device check, deferred hosted proofs)"
  - "apps/api/turbo.json — boundaries.implicitDependencies ['@react-email/render'] so `pnpm boundaries` passes after a build (02-07/02-11 deferred item resolved)"
affects: [/gsd-verify-work for Phase 2 (UAT list below), Phase 01.1 runbook (hosted proofs), Phase 4 (feed tab in the smoke + REQUIRED_KEYS), Phase 7 (pwa.spec.ts install/push assertions), Phase 8 (catalog audit, admin_tenant brand editor), every later phase (pnpm verify is the exit gate)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff cf6b0f4..HEAD)
actuals:
  tokens: 20658
  tasks: 3
  commits: 4
plan_head_before: cf6b0f46e84a20e7f4fd73e1b21bb6f4b9943122

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-HTML proof without a JS-disabled context: `page.goto()`'s navigation response body IS the server HTML; attribute-order-independent tag helpers (metaContent / linkHref / imgSrc) read it, `getComputedStyle` proves the RENDERED colours afterwards"
    - "Phase smoke on a throwaway tenant driven from the panel: unique slug per run (`process.ppid` + project letter), beforeAll wipes leftovers, afterAll deletes users → tenant (cascade) and stops the worker it spawned; the seed tenants are never mutated"
    - "Cache-bounded assertions stay exact: when a change must outlive the 60 s web host cache the spec polls the first HTML up to 70 s and annotates the observed delay (testInfo.annotations) instead of loosening the assertion"
    - "Build-output gate = fixed required keys + guarded prefixes + strict static allow-list, exit 2 on absence — a moved route, a leaked static page and a missing build all fail loudly"
    - "One local exit gate script (`verify`) is the CI shape; spec filters go through `pnpm --filter @tria/web exec playwright test <spec>`, never `pnpm e2e -- <spec>`"

key-files:
  created:
    - apps/web/e2e/phase2-smoke.spec.ts
    - scripts/check-static-routes.sh
  modified:
    - apps/web/e2e/branding.spec.ts
    - apps/web/playwright.config.ts
    - apps/web/app/(platform)/plataforma/layout.tsx
    - apps/web/e2e/platform-tenants.spec.ts
    - apps/web/e2e/platform-domains.spec.ts
    - package.json
    - .github/workflows/ci.yml
    - docs/DEPLOY.md
    - apps/api/turbo.json
    - .gitignore

key-decisions:
  - "02-16: honest ROLE-04 witness — the panel path is proven with `feed` (switch → tenant_modules → member bootstrap within the 30 s flags TTL, nav unchanged because feed ships no tab before Phase 4) and the navigation + API-404 path with the reference module flipped by a spec-only SQL helper on the throwaway tenant (Exemplo tab + #exemplo slot + /v1/example/items 200/404 in the same API process); both halves are named in the assertions, never a fake pass"
  - "02-16: worker under e2e — playwright.config.ts keeps API + web only; the smoke calls ensureWorker() in beforeAll and stops it in afterAll (02-14 decision honoured)"
  - "02-16: one CI job mirroring `verify` step for step (D-12); the PWA production-build suite is appended after the dev-server e2e with PLAYWRIGHT_REPORT_DIR / PLAYWRIGHT_OUTPUT_DIR rather than a second job duplicating the eight local-stack steps"
  - "02-16: pixel-chromium runs only branding.spec.ts and phase2-smoke.spec.ts (testMatch anchored to the file name — an unanchored regex also matched platform-branding.spec.ts); smoke tests 3-5 skip there as layout-independent"
  - "02-16: `verify:smoke` uses `pnpm --filter @tria/web exec playwright test <specs>` instead of the plan's `pnpm e2e -- <specs>`: pnpm forwards the `--` and Playwright then ignores every filter and runs the whole suite (observed: a stray `pnpm e2e -- --list …` ran all 208 tests)"
  - "02-16: `apps/api/turbo.json` declares `@react-email/render` as an implicit boundary dependency — the only way `pnpm boundaries` can follow `pnpm turbo build` (dist/ is walked) in `verify` and CI; the finding was the bundled resend SDK's optional import, not project code"
  - "02-16: the served-HTML follow-up of a brand/status change is bounded by the 60 s web host cache (apps/web/lib/tenant-host.ts): observed 61 s (404-miss → verified), 55 s (rebrand), 58 s (suspend), 61 s (reactivate); the specs poll up to 70 s and record the delay — the assertions were not loosened"
  - "02-16: the acceptInvite catalog namespace stays as 02-10 shipped it (no rename this phase)"

patterns-established:
  - "Phase gate = criteria → commands: every ROADMAP success criterion maps to a step inside `pnpm verify`; whatever cannot be proven locally is a named `verification: backstop` item mirrored in docs/DEPLOY.md, never a green assertion"
  - "Panel-driven smoke shape (signIn → tab URL → role/testid selectors → by-host read → served HTML/manifest read) for later phases' admin surfaces"

requirements-completed: [TENANT-02, TENANT-06, TENANT-07, MOD-04, PWA-01, UI-03]

coverage:
  - id: D1
    description: "ROADMAP criterion 1 — served brand per host on iPhone 14, Pixel 7 and desktop: first HTML of /entrar carries the tenant's --brand-primary, theme-color, manifest link, favicon (= by-host faviconUrl), apple-touch-icon, logo and data-theme; rendered 'Entrar' CTA and the aria-current nav item paint rgb(primary); manifest names the tenant with its derived icons; the other tenant's primary and the neutral hex never appear; generic host neutral"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/branding.spec.ts#Phase 2 — served brand per host (B1 ×2, B2 ×2, B3) on mobile-chromium + pixel-chromium + desktop-chromium (15 passed)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/phase2-smoke.spec.ts#1 (e)/(g) + #2 (member shell) — panel-provisioned tenant, three projects"
        status: pass
    human_judgment: false
  - id: D2
    description: "ROADMAP criterion 1 build gate — no authenticated or host-branded route is prerendered: scripts/check-static-routes.sh passes on the Phase 2 build, exits 2 without a build, exits 1 on an injected static /inicio and on a removed required key; wired into `pnpm verify` and CI after the build"
    requirement: TENANT-02
    verification:
      - kind: other
        ref: "pnpm --filter @tria/web build && pnpm check:static-routes (OK, 25 guarded routes, static = /_global-error + /serwist/sw.js{,.map}); NEXT_DIR=/nonexistent → exit 2; injected routes['/inicio'] → exit 1 naming /inicio; deleted /(app)/perfil/page → 'route moved or renamed'"
        status: pass
    human_judgment: false
  - id: D3
    description: "ROADMAP criterion 2 — from the panel on a throwaway tenant: create (D-31) → attach + verify a fake-provider host (Verificar agora → Verificado, by-host 200 primary) → pending invite mailed on verification (Subject 'Convite para administrar {name}', From {name}, /auth/confirm link) → Marca logo + primary rebrand through the worker (icons v1 → v2) → by-host, served HTML and manifest follow"
    requirement: TENANT-07
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase2-smoke.spec.ts#1 @tracer (three projects)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Alias → primary 308 (path + query, no-store) and Status-tab suspension from the panel: the signed-in member's next /inicio lands on the branded /comunidade-indisponivel (main --brand-primary = tenant primary, no Supabase cookie), the cold /entrar hides its form, 'Reativar tenant' restores it"
    requirement: TENANT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase2-smoke.spec.ts#3 (mobile-chromium + desktop-chromium)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Module toggle without redeploy — honest two-witness ROLE-04/MOD-04 proof: Feed switch → tenant_modules.feed=false → member bootstrap drops feed within MODULE_FLAGS_TTL_MS with the nav still ['Início','Perfil'] (no phantom tab); reference module flipped by SQL → 'Exemplo' tab + #exemplo slot appear and /v1/example/items answers 200, flipped back → tab and slot gone, 404 MODULE_DISABLED — same API process; nav order Início first / Perfil last"
    requirement: MOD-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase2-smoke.spec.ts#4 (mobile-chromium + desktop-chromium)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Branded auth mail for a non-seed tenant end to end (GoTrue → hook → Mailpit): recovery Subject 'Redefina sua senha — {name}', From {name} <no-reply@…>, CTA background = persisted primary, uploaded logo as <img>, footer 'Enviado pela plataforma TRIA', plain-text /auth/confirm link; plus the invite mail of D3"
    requirement: TENANT-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase2-smoke.spec.ts#5 + #1 (d)"
        status: pass
    human_judgment: false
  - id: D7
    description: "PWA-01 automated half in the gate: per-tenant manifest + no-store headers, SW registered and controlling, /~offline precached and served offline, display-mode browser mirror — 02-11's production-build suite runs inside `pnpm verify` and CI on iPhone 14 / Pixel 7 / desktop; the panel-created tenant's manifest (name, theme_color, id, icons) is asserted by the smoke"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "pnpm --filter @tria/web e2e:pwa — 45 passed + 3 annotated skips (CDP display-mode emulation unsupported); phase2-smoke.spec.ts#1 (e)/(g) readManifest"
        status: pass
    human_judgment: false
  - id: D8
    description: "PWA-01 standalone half — the app installs and launches without browser chrome (tenant icon + name) from a real iOS Safari ('Adicionar à Tela de Início') and a real Android Chrome device over HTTPS"
    requirement: PWA-01
    verification: []
    human_judgment: true
    rationale: "verification: backstop — Playwright cannot install a PWA and the bundled Chromium ignores display-mode emulation (02-11); installability needs the hosted HTTPS origin from Phase 01.1. Recorded in docs/DEPLOY.md '## Phase 2 verification' manual table; never auto-passes"
  - id: D9
    description: "ROADMAP criterion 3 at phase level: `pnpm lint` (Biome + check-ui-literals.sh) green inside `pnpm verify`; @tria/ui 34 tests green; 'Igor Alves' absent from apps/** and packages/**; apps/web/lib/nav.ts absent; navigation built from bootstrap modules only (apps/web/lib/registry.tsx); D-33 approval recorded"
    requirement: UI-03
    verification:
      - kind: other
        ref: "pnpm verify step 1 (check-ui-literals: OK); git grep -q 'Igor Alves' -- apps packages ':!reference' → exit 1; test ! -e apps/web/lib/nav.ts; grep buildNav/modules apps/web/lib/registry.tsx; pnpm --filter @tria/ui test 34/34; grep 'approved: true' .planning/sketches/001-phase-02-designed-screens/README.md"
        status: pass
    human_judgment: false
  - id: D10
    description: "The platform rail carries the kernel ThemeToggle in the pinned bottom group next to 'Sair' (D-41): clicking sets html[data-theme=dark] at once, writes tria_theme=dark, and after a reload the SERVER HTML already carries data-theme=dark; the label truncates and the rail stays within the screen height (E03)"
    requirement: UI-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase2-smoke.spec.ts#1 (a) on desktop-chromium; platform-tenants.spec.ts + platform-domains.spec.ts still green on both projects"
        status: pass
    human_judgment: false
  - id: D11
    description: "`pnpm verify` — the whole local exit gate green one shot (lint + literal guard, typecheck/build/unit 278, static-routes gate, boundaries + negative, lane guard, pgTAP 98, integration 176, spike 3, e2e 170 passed + 38 skipped on three projects, e2e:pwa 45 + 3 skips) in 17 min 27 s; `pnpm verify:smoke` green in 14 min 12 s; .github/workflows/ci.yml mirrors it step for step (YAML parsed, greps, no hosted secret)"
    verification:
      - kind: other
        ref: "pnpm verify (exit 0, 1047 s, 2026-09-17T04:54Z–05:12Z); pnpm verify:smoke (exit 0, 852 s); node yaml.parse(ci.yml) 24 steps"
        status: pass
    human_judgment: false
  - id: D12
    description: "CI first green run on the PR with both Playwright runs and artifacts wired, in the documented order"
    verification: []
    human_judgment: true
    rationale: "The repository has no GitHub remote; ci.yml was validated locally (YAML parse + grep assertions + the identical `verify` sequence run locally) but never executed on a runner — the first PR run is the real gate"
  - id: D13
    description: "Hosted proofs: custom domain end-to-end on a real provider, Send Email Hook against Resend, check-static-routes.sh against a Vercel build, staging smoke on the TRIA-owned seed hosts"
    verification: []
    human_judgment: true
    rationale: "verification: backstop — Phase 01.1 runbook items linked from docs/DEPLOY.md; locally and in CI the gate runs against DOMAIN_PROVIDER=fake, AUTH_ALLOW_LIST=local, MAIL_TRANSPORT=local by design (prohibition: never a real provider)"

# Metrics
duration: 1h 47m
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 16: Phase-level verification gate Summary

**Phase 2's four ROADMAP criteria are now proven by commands inside one local exit gate (`pnpm verify`, green one shot in 17 min 27 s) mirrored step for step by CI: a panel-provisioned throwaway tenant is created, attached, verified, invited, rebranded through the worker, suspended, re-activated and module-toggled under Playwright on iPhone 14, Pixel 7 and desktop with its served HTML, manifest, icons and mails asserted (`phase2-smoke.spec.ts`); the seed tenants prove the served brand per host on the same three projects (`branding.spec.ts`); `scripts/check-static-routes.sh` fails the build when any authenticated or host-branded route goes static; 02-11's production-build PWA suite runs in the gate; the platform rail got its theme row; `docs/DEPLOY.md` is the finalised deploy index — with the real-device standalone install and the hosted provider flows recorded as explicit backstops, never a silent pass.**

## Performance

- **Duration:** 1h 47m (wall clock, including two full `pnpm verify` runs)
- **Started:** 2026-09-17T03:26:28Z
- **Completed:** 2026-09-17T05:13:14Z
- **Tasks:** 3 (1 tracer + 2 auto)
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments

- **Criterion 1 proven twice:** `branding.spec.ts` "Phase 2 — served brand per host" asserts, on the seed tenants and all three projects, the FIRST server HTML (`--brand-primary`, `theme-color`, manifest link, favicon = by-host `faviconUrl`, apple-touch-icon, seed logo, `data-theme`), the RENDERED "Entrar" CTA and active-nav colours, the manifest name/theme_color/derived icons, and the absence of the other tenant's and the neutral hex; `scripts/check-static-routes.sh` guards the build output (exit 2 without a build, 1 on an injected static `/inicio` or a removed required key) inside `verify` and CI.
- **Criterion 2 proven from the panel:** `phase2-smoke.spec.ts` creates a tenant on `/plataforma/novo`, attaches `<slug>.localhost` on Domínios, presses "Verificar agora", reads the invite in Mailpit, sees the neutral shell before and the tenant's brand after verification, uploads a logo and saves a new primary on Marca (icons v1 → v2 through the spawned worker), and watches by-host → served HTML → manifest follow; then alias 308, Status-tab suspend/reactivate with the branded unavailable screen, the honest two-witness ROLE-04 module proof (Feed from the panel; the reference module's tab, slot and 200/404 route by a spec-only SQL flip), and a branded recovery mail — on a tenant that is deleted afterwards.
- **Criterion 3 and 4 gates in the exit script:** `pnpm lint` (Biome + UI literal guard) and `@tria/ui` tests run inside `pnpm verify`; the prototype owner's name, `lib/nav.ts` and hardcoded nav are absent; `e2e:pwa` (production build, three projects) is the last `verify` step and a CI step with its own report/trace folders; the real-device standalone install is a named backstop in `must_haves` and `docs/DEPLOY.md`.
- **Platform rail theme row (D-41, 02-12 handoff):** `ThemeToggle` mounted in `PlatformRail.themeSlot` from the `(platform)` layout — cookie written at once, `data-theme="dark"` server-rendered after reload, label truncating in the pinned bottom group — without touching `PlatformRail.tsx`.
- **CI restructured around `verify`:** single `checks` job (`workflow_call` intact for `deploy-api.yml`), `timeout-minutes: 60`, `pnpm lint` (the literal guard finally runs in CI), static-routes gate after the build, dev-server e2e then PWA e2e, both Playwright reports and both trace folders uploaded on failure, no hosted secret; `docs/DEPLOY.md` gained the Documents index, the OTP-expiration and storage-bucket notes and the Phase 2 verification runbook.

## Task Commits

1. **Task 1 (tracer): Playwright three projects + platform-rail theme row + `phase2-smoke.spec.ts` tests 1-2** — `dcb383f` (feat)
2. **Task 2: smoke tests 3-5 (alias 308, suspend/reactivate, ROLE-04 witness, recovery mail) + `branding.spec.ts` served-brand block** — `a81eda3` (test)
3. **Task 3: `check-static-routes.sh`, `verify` / `verify:smoke`, `ci.yml`, `DEPLOY.md`, `apps/api/turbo.json`, `.gitignore`** — `6c5a477` (feat)
4. **Fix surfaced by the first full `pnpm verify`: platform-domains mobile `has:` locator** — `def1ce9` (fix)

**Plan metadata:** see the final `docs(02-16)` commit.

Tracer feedback gate (Task 1): interactive run, `human_verify_mode = end-of-phase`, automated-only `<verify>` → the chain (web typecheck, web lint, literal guard, `phase2-smoke.spec.ts` on all three projects, `platform-tenants.spec.ts` on desktop) was re-run on the committed state and passed before expansion.

## Verification (plan-level, as run)

| Gate | Result |
|---|---|
| `pnpm verify` (one shot, 2026-09-17T04:54Z → 05:12Z) | **exit 0 in 1047 s (17 min 27 s)** — lint 7/7 + `check-ui-literals: OK`; typecheck/build/test 15/15 (unit 278: core 116, contracts 57, ui 34, web 56, api 15); `check-static-routes: OK` (25 guarded routes; static = `/_global-error`, `/serwist/sw.js`, `/serwist/sw.js.map`; dynamic prerendered = `/serwist/[path]`); boundaries 336 files no issues; negative fixture rejected; lane guard OK; pgTAP 98/98; integration 176/176; spike 3/3; e2e **170 passed + 38 skipped** (208 across mobile-chromium, pixel-chromium, desktop-chromium); e2e:pwa **45 passed + 3 annotated skips** |
| `pnpm verify:smoke` | exit 0 in 852 s — 67 passed + 5 skipped (branding, phase2-smoke, invite, recovery on three projects) then PWA `@tracer` 18 passed + 3 skips |
| First `pnpm verify` attempt | exit 1 after 1147 s: `platform-domains.spec.ts` #6 on mobile timed out on the overflow probe (my Task 1 scoping made the `has:` inner locator non-relative) — fixed in `def1ce9`, then the one-shot green run above |
| Task 1 `<verify>` | web typecheck + lint + literal guard green; `phase2-smoke.spec.ts` 1-2 green on three projects (2.1 min each); `platform-tenants.spec.ts` desktop 6 passed + 1 phone-only skip |
| Task 2 `<verify>` | `branding.spec.ts` + `phase2-smoke.spec.ts` green on three projects (mobile 5/5, pixel 2 + 3 skips, desktop 5/5 — the desktop pass re-run alone after a stray concurrent run wiped `test-results/`, see Issues); `example.spec.ts shell.spec.ts` desktop 8/8 afterwards; `select count(*) … slug like 'e2e-smoke-%'` = 0; no `e2e-*` leftovers; ports 8790/3100 free |
| Task 3 `<verify>` | `bash -n`, script wiring node check, ci.yml/DEPLOY.md greps, `pnpm --filter @tria/web build && pnpm check:static-routes`, `pnpm verify:smoke` — all green |
| ROADMAP criterion 3 greps | `git grep -q "Igor Alves" -- apps packages ':!reference'` → exit 1; `test ! -e apps/web/lib/nav.ts` ✓; `check-ui-literals.sh` OK; `apps/web/lib/registry.tsx` derives nav/home from `bootstrap.modules`; `@tria/ui` 34/34 |
| CI | `.github/workflows/ci.yml` parsed with `yaml` (24 steps in the documented order, `workflow_call: {}`, single job, `timeout-minutes: 60`, no `needs:`), every acceptance grep green, no `RESEND_API_KEY` / `VERCEL_TOKEN` / `SUPABASE_PAT` outside comments; `actionlint` not installed. **Never executed** — the repository has no GitHub remote; recorded as D12 (human) |

**Observed by-host → served-HTML delays** (the 60 s web host cache in `apps/web/lib/tenant-host.ts`, annotated by the spec on every project): verify (404-miss → tenant) **61 s**, rebrand **55 s**, suspend **58 s**, reactivate **61 s**. The assertions are exact; only the wait is bounded (70 s). On Vercel this TTL is the documented cache bust (RESEARCH Pattern 1).

**`REQUIRED_KEYS` spelling:** no adjustment needed — the built manifest uses exactly the plan's keys (`/(app)/inicio/page`, `/(platform)/plataforma/tenants/[id]/marca/page`, `/m/[slug]/manifest.webmanifest/route`, `/~offline/page`, `/serwist/[path]/route`, …).

**CI wall clock of the first green run:** not available (no remote). Local proxy: `pnpm verify` 17 min 27 s on a MacBook Air with turbo cache warm for unchanged packages.

## The four backstops (verbatim from `must_haves`, never reported as passes)

1. The app installs and launches in standalone mode (no browser chrome, tenant icon + name) from a real iOS Safari ("Adicionar à Tela de Início") and a real Android Chrome device — provable only on an HTTPS origin, i.e. after Phase 01.1 provisions the hosted environment; recorded in `docs/DEPLOY.md` "## Phase 2 verification" as the manual check that closes PWA-01 at `/gsd-verify-work`.
2. Hosted custom-domain flow (Vercel Project Domains + Supabase Management API allow-list) for a real customer host — the smoke uses `DOMAIN_PROVIDER=fake` and `AUTH_ALLOW_LIST=local`; the hosted proof is the Phase 01.1 runbook item "Attach a real customer domain end-to-end" recorded by 02-09 and linked from the DEPLOY.md index.
3. Hosted branded auth mail through the Send Email Hook against a real Cloud Run API and Resend — locally every mail goes to Mailpit; the hosted proof is the `docs/deploy/auth-mail.md` runbook table once 01.1 provisions Secret Manager + `supabase config push`.
4. `scripts/check-static-routes.sh` against the Vercel production build output (`vercel build` locally or the deployment's `.next`) — CI proves the identical `next build` on the runner; the Vercel parity run is a Phase 01.1 runbook step recorded in DEPLOY.md.

## Files Created/Modified

- `apps/web/e2e/phase2-smoke.spec.ts` (new, 851 lines) — helpers `signIn`, `byHost`, `hexToRgb`, `metaContent`, `linkHref`, `imgSrc`, `firstHtml`, `declaresPrimary`, `readManifest`, `mailpitNewest`, `newContextLike`, `visibleNav`, `navLabels`, `activeNavColor`, `brandPrimary`, `entrarBg`, `waitForHydration`, `toast`, `iconVersionOf`, `setTenantModuleFlag` (spec-only SQL); constants `PRIMARY_1 #b91c1c`, `SECONDARY_1 #f87171`, `PRIMARY_2 #0e7490`; slug `e2e-smoke-<ppid><p>`, hosts `<slug>.localhost` + `<slug>-alias.localhost`; five tests.
- `apps/web/e2e/branding.spec.ts` — appended describe "Phase 2 — served brand per host (phone + desktop)" (B1/B2 per seed tenant, B3 generic) with duplicated helpers; `beforeAll` fails fast without the 02-13 seed icons; 02-01's tests byte-identical.
- `apps/web/playwright.config.ts` — three projects (pixel scoped by anchored `testMatch`), CI reporters, `outputDir`, `expect.timeout`, docblock.
- `apps/web/app/(platform)/plataforma/layout.tsx` — `themeSlot` with `SunMoon` icon + `app.nav.theme` label + `ThemeToggle`.
- `apps/web/e2e/platform-tenants.spec.ts`, `platform-domains.spec.ts` — switch counts scoped to `main` (the rail now carries a switch); relative `has:` locator.
- `scripts/check-static-routes.sh` (new, executable) — the build-output gate.
- `package.json` — `check:static-routes`, `verify`, `verify:smoke` (additions only).
- `.github/workflows/ci.yml` — restructured single job (see Accomplishments).
- `docs/DEPLOY.md` — 4 new sections + pointers; 60 table rows (was 57), 13 headings (was 9); no row or heading removed.
- `apps/api/turbo.json` — `boundaries.implicitDependencies`.
- `.gitignore` — `playwright-report-pwa/`, `test-results-pwa/`.

## Decisions Made

See `key-decisions` in the frontmatter (honest ROLE-04 witness, worker under e2e, one CI job, Pixel scope, `verify:smoke` command shape, implicit boundary dependency, cache-bounded polling, catalog namespace kept).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 02-12 / 02-15 specs counted the new rail switch**
- **Found during:** Task 1 (`platform-tenants.spec.ts` #3 on desktop: 7 switches instead of 6)
- **Issue:** mounting the theme row adds a `role="switch"` to the desktop rail; `page.getByRole('switch')` in the two panel specs counted it.
- **Fix:** counts scoped to `page.locator('main')` in `platform-tenants.spec.ts` (#3) and `platform-domains.spec.ts` (#6). Files outside `files_modified`; the plan's acceptance criterion ("02-12 still passes with the theme row") required it.
- **Verification:** both specs green on desktop and mobile.
- **Committed in:** `dcb383f` (and `def1ce9` for the follow-up below)

**2. [Rule 1 - Bug] `has:` inner locator made non-relative by fix 1**
- **Found during:** the first full `pnpm verify` (`platform-domains.spec.ts` #6 on mobile-chromium timed out at the overflow probe)
- **Issue:** `page.locator('ul', { has: switches.first() })` with the now `main`-scoped `switches` never matches — Playwright evaluates `has:` relative to the outer element.
- **Fix:** `has: page.getByRole('switch').first()` (relative), comment added.
- **Verification:** `platform-domains.spec.ts` mobile 6/6, then the one-shot green `pnpm verify`.
- **Committed in:** `def1ce9`

**3. [Rule 1 - Bug] The plan's `verify:smoke` command would run the whole suite**
- **Found during:** Task 3 (a `pnpm e2e -- --list …` probe launched the entire 208-test suite)
- **Issue:** pnpm forwards the `--` to `playwright test`, which then ignores every positional filter and `--grep`; `pnpm e2e -- branding.spec.ts …` and `e2e:pwa -- --grep @tracer` are both no-op filters (the 02-07/02-08/02-12 "does not filter" observation, now explained).
- **Fix:** `verify:smoke` = `pnpm --filter @tria/web exec playwright test branding.spec.ts phase2-smoke.spec.ts invite.spec.ts recovery.spec.ts && pnpm --filter @tria/web exec playwright test --config playwright.pwa.config.ts --grep @tracer` (72 + 21 tests listed; the acceptance strings are all present). DEPLOY.md documents the rule.
- **Committed in:** `6c5a477`

**4. [Rule 3 - Blocking] `pnpm boundaries` fails after `pnpm turbo build` (dist/ walked)**
- **Found during:** Task 3 (before the first `pnpm verify`: `apps/api/dist/main.js` → `cannot import package @react-email/render`, the 02-07/02-11 deferred item)
- **Issue:** the plan's `verify` order (build → boundaries) and the CI order could never be green with the artifact present; deleting build output inside a gate was rejected.
- **Fix:** `apps/api/turbo.json` `boundaries.implicitDependencies: ["@react-email/render"]` (the bundled resend SDK's optional import in a try/catch, not project code). File outside `files_modified`.
- **Verification:** `pnpm boundaries` 336 files no issues with `dist/` present; `boundaries:negative` still rejects the fixture; `pnpm verify` green.
- **Committed in:** `6c5a477`

**5. [Rule 2 - Missing critical] `.gitignore` for the PWA run folders**
- **Found during:** Task 3 (ci.yml `PLAYWRIGHT_REPORT_DIR=playwright-report-pwa`, `PLAYWRIGHT_OUTPUT_DIR=test-results-pwa`)
- **Fix:** `playwright-report-pwa/` and `test-results-pwa/` ignored next to the existing entries so a local `e2e:pwa` run with the CI knobs never lands in git. File outside `files_modified`.
- **Committed in:** `6c5a477`

**6. [Rule 1 - Bug] Pixel `testMatch` matched `platform-branding.spec.ts`**
- **Found during:** Task 2 (`branding.spec.ts` run listed `platform-branding` on pixel-chromium)
- **Fix:** `/[\\/](branding|phase2-smoke)\.spec\.ts$/` (anchored to the file name).
- **Committed in:** `a81eda3`

### Design adjustments (documented, not deviations from intent)

- **Serial timeout 300 s instead of 240 s:** test 1 carries two 60 s cache waits plus two worker derivations (2.1 min observed); test 3 two more waits (≈ 2.5 min). 300 s keeps a margin without loosening any assertion.
- **"Versão n" assertion:** the version caption is a sibling of the `[data-icons-status]` line (02-14 `DerivedIcons`), so the smoke asserts `getByText('Versão 2')` visible + `[data-icons-status="ready"]` visible instead of `toContainText` on the status element.
- **Icon fetch through Node `fetch`** (127.0.0.1 Storage URL) instead of `page.goto(i512)` — same proof (200 + `image/png`), no navigation away from the tenant page.
- **`newContextLike` is used by tests 3-4 only**; `aliasOrigin` by test 3 — both declared in Task 1 as the plan lists them.

---

**Total deviations:** 6 auto-fixed (4 × Rule 1, 1 × Rule 2, 1 × Rule 3) + 4 documented adjustments. **Impact on plan:** no scope change; four files outside `files_modified` touched (`platform-tenants.spec.ts`, `platform-domains.spec.ts`, `apps/api/turbo.json`, `.gitignore`), each required by an acceptance criterion or by the gate itself. No package installed (T-02-SC holds; lockfile untouched).

## Issues Encountered

- **Stray concurrent Playwright run (my mistake):** a `pnpm e2e -- --list …` probe (meant to list tests) started the whole suite in parallel with the Task 2 three-project run, deleted `test-results/` mid-run and made desktop test 3 fail at `memberContext.close()` (trace flush ENOENT) after all its assertions had passed. The stray run was killed, no throwaway tenant was left behind, and the desktop smoke was re-run alone (5/5). The finding became deviation 3.
- **First `pnpm verify` red** on the mobile overflow probe (deviation 2); the second run is the recorded one-shot green.
- **`turbo` cache:** `pnpm turbo typecheck build test` replayed cached unit results for unchanged packages (log timestamps from earlier in the session); the web build and the API build were fresh.
- The Vercel plugin's write hooks injected "run the skill" notices on every file write; they were not followed (no library API was in question — Playwright, bash and one JSX mount using 02-07's components).

## Known Stubs

None — every assertion reads real data; the backstops are explicit `verification: backstop` items, not stubs. (No `WINDOWS.md` entry added: no stub, skipped test or unrun `<verify>` was introduced by this plan; the PWA standalone skip is 02-11's annotated backstop.)

## Threat Flags

None beyond the plan's register: no new endpoint, auth path, schema or file access; the spec-only superuser SQL (`setTenantModuleFlag`) is scoped by slug to the throwaway tenant and skipped remotely (T-02-131); CI declares no hosted secret (T-02-130); the gate cannot pass by absence (T-02-129).

## Human verification — consolidated UAT list for `/gsd-verify-work` (end-of-phase)

Everything below is a judgment call or a hosted/real-device proof no command in this repository can assert. Items 1-3 come from this plan's `<human-check>`; 4-12 are carried over from the SUMMARYs of 02-01…02-15 so the verifier builds one list.

1. **Real-device standalone install (PWA-01 closure, backstop 1):** on a real iPhone (Safari → Compartilhar → "Adicionar à Tela de Início") and a real Android phone (Chrome install prompt), open a tenant host over HTTPS (hosted environment from Phase 01.1), install, launch — no browser chrome, the tenant's icon and name, status bar in the tenant primary; `document.documentElement.dataset.displayMode === 'standalone'`. Until the hosted origin exists this stays open (recorded in `docs/DEPLOY.md`).
2. **First green CI run on a PR** shows the 24 steps in the documented order with both Playwright runs (dev-server and PWA) and, on a forced failure, the `playwright-artifacts` upload with both report folders.
3. **Read `docs/DEPLOY.md` top to bottom** — every link resolves (`docs/deploy/auth-mail.md`, `packages/core/db/README.md`, the in-file sections), the Phase 2 verification section matches `package.json` `verify`.
4. **Branded login look (02-08, phone + desktop):** `http://tria-demo.localhost:3000/entrar` (purple, logo, "Comunidade: TRIA Demo") vs `tria-lab` (teal) vs `http://localhost:3000/entrar` (TRIA wordmark); sign-up eye toggle + three-segment meter + consents; suspended screen; 40+ character name wraps to ≤ 2 lines; dark theme on `/entrar`.
5. **Shell fidelity (02-07):** phone TopBar + glass BottomNav that shrinks on scroll; desktop 240 px rail + 680 px column; `/configuracoes` rows; `/perfil`; dark mode with no light flash on reload; 40-character display-name truncation (rename a seed tenant via `PATCH /v1/platform/tenants/{id}`).
6. **Platform panel screens vs the D-33 mockup (02-12, 02-14, 02-15):** `#tenant-list`, `#platform-shell-mobile`, `#new-tenant` (BrandPreview mini-shells, contrast pills with `#f5f7fb`), `#tenant-page-marca` (zones, upload progress, "Ícones sendo gerados…" → thumbs), `#tenant-page-dominios` (DNS table / stacked blocks, confirm dialogs), `#tenant-page-modulos`, `#tenant-page-admins` / `#tenant-page-status`; light and dark — neutral tokens only on the platform host; **new in 02-16:** the "Tema" row sits in the rail's bottom group above "Sair" and flips the panel's theme.
7. **Designer review still open (02-04):** the D-33 approval is the product owner's, provisional — confirm the design team's follow-up exists.
8. **Branded mails in Mailpit (02-06, 02-10):** `http://127.0.0.1:54324` — "Redefina sua senha — TRIA Demo" (purple accent + CTA, wordmark, footer, plain-text tab) and "Convite para administrar …" for a throwaway tenant (accented name as text, amber CTA); after `pnpm verify:smoke` the `Smoke <sfx>` tenant's invite and recovery mails show the uploaded lab SVG logo and the `#0e7490` CTA.
9. **Accept-invite screen (02-10):** follow an invite link from Mailpit to `/aceitar-convite` on the tenant host — branded heading "Você foi convidado(a) a administrar {tenant}", password + consents, expired link → `/convite-expirado`.
10. **Offline page and install hint (02-11):** airplane mode → navigate → `/~offline` vs mockup `#offline`; `InstallHint` (mount `<InstallHint open />` in a scratch page) vs `#install-hint`.
11. **Missing-catalog-key behaviour (02-04):** under `next dev` a deliberately missing key throws; under `next build && next start` the dotted key renders.
12. **Hosted proofs (backstops 2-4, Phase 01.1 runbook):** real customer domain end to end (`DOMAIN_PROVIDER=vercel`, `AUTH_ALLOW_LIST=supabase`), Send Email Hook against Resend, `check-static-routes.sh` on a Vercel build, staging smoke on the TRIA-owned seed hosts with `PLAYWRIGHT_BASE_URL` + `PLAYWRIGHT_API_URL`; set `otp_expiry = 86400` hosted.

## User Setup Required

None — no external service configuration required. Local prerequisites for `pnpm verify` are documented in `docs/DEPLOY.md` "## Phase 2 verification".

## Next Phase Readiness

- **Phase 2 is complete (16/16 plans):** every ROADMAP criterion has a command inside `pnpm verify`; the only open PWA-01 item is the real-device standalone check, which needs the hosted origin (Phase 01.1).
- **Phase 4 (feed):** extend `phase2-smoke.spec.ts` test 4 (a) with the feed tab + `GET /v1/feed/…` 404, keep or retire the reference-module witness, add `/(app)/feed/**` to `REQUIRED_KEYS`.
- **Every later phase:** new specs run automatically under `pnpm e2e`; new production-only PWA checks go to `pwa.spec.ts`; new authenticated routes go to `REQUIRED_KEYS`; never add a static allow-list entry outside `/_*` and `/serwist/*`.
- **Phase 01.1 runbook:** the four backstops + `otp_expiry = 86400`.
- **Phase 7 / 8:** `pwa.spec.ts` tags for install/push; `acceptInvite` namespace kept; the smoke's Marca/Status shapes reusable for ADMIN-01.
- No process left running by this plan: the `next dev` server I started on :3000 was stopped after the gate; the pre-existing `tsx watch` API on :8787 (pid 56293) was reused and left as found; ports 3100 and 8790 free; no `e2e-*` tenant or user remains in the local database.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 10 key files exist on disk; the four task commits (dcb383f, a81eda3, 6c5a477, def1ce9) are in `git log`; `git rev-list --count cf6b0f4..HEAD` = 4 (matches `commits: 4`).
