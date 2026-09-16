---
phase: 02-tenant-shell-branding-platform-panel
plan: 07
subsystem: ui (member shell, navigation registry, theme, kernel pages)
tags: [shell, navigation, registry, theme, cookie, nextjs, react, playwright, happy-dom, tdd, tracer]

# Dependency graph
requires:
  - phase: 02-01
    provides: "@tria/contracts/branding (resolveBranding, brandStyleVars, THEME_COOKIE), bootstrap.tenant.branding, [data-brand-root] convention, seed brands"
  - phase: 02-02
    provides: "@tria/ui primitives (Avatar, Badge, Button, Card, EmptyState, PageHeader, SectionTitle, StatusPill, Switch, ToastProvider, ScrollContainerContext), tokens.css (.app-scroll, .glass-bar, --safe-*, --screen-h, --nav-height, --theme-chip)"
  - phase: 02-03
    provides: "@tria/core/ui entry with TenantLogo, Biome lane forbidding server/db imports, happy-dom .tsx tests in packages/core/tests"
  - phase: 02-04
    provides: "per-namespace pt-BR catalog + deterministic loader, scripts/check-ui-literals.sh, D-33 design-review approval of #desktop-shell-home and #settings"
  - phase: 01-06/01-07
    provides: "ModuleManifest/ModuleNav, MODULE_REGISTRY + enabledModulesForBootstrap, GET /v1/me/bootstrap, the example module and its ExampleWidget"
provides:
  - "Registry extension (additive): ModuleNav.placement ('tab'|'topbar'), ModuleNav.badge ('unreadNotifications'|'unreadConversations'), ModuleManifest.home: { order }[]; bootstrapSchema mirrors both; enabledModulesForBootstrap emits home; example manifest declares home: [{ order: 90 }] with its nav object untouched"
  - "@tria/core/ui: buildNav / isNavItemActive / activeTabKey / iconFor (nav.ts), AppShell, TopBar, BottomNav, DesktopRail, ScrollRoot, HomeSlots, ThemeToggle (+ TenantLogo from 02-03); data attributes [data-brand-root], [data-shell-nav=bottom|rail], main#app-scroll.app-scroll, SVG filter #liquid-glass"
  - "apps/web/lib/registry.tsx — the web composition point: WEB_MODULE_REGISTRY (module key → home-slot renderers), moduleLabelResolver(t) via t.has('<key>.nav'), homeSlotsFor(bootstrap) with Promise.allSettled and a per-slot generic error card"
  - "(app)/layout.tsx on AppShell for tenant hosts (brand + nav from the bootstrap only) and the platform host (neutral brand, single 'Tenants' tab → /plataforma, no redirect); generateViewport with viewportFit cover + themeColor = tenant primary"
  - "Kernel pages: /inicio (TenantLogo + 'Bem-vindo(a) à {tenant}' + HomeSlots / 'Em breve' card), /configuracoes (theme toggle, Em breve rows, version, Sair; Preferências + Sair on the platform host), /perfil (avatar, name, e-mail, role pill, settings row; platform → /inicio)"
  - "Theme (D-41): root layout renders <html data-theme> from the tria_theme cookie (strict 'dark' allow-list), setTheme server action (z.enum, Path=/, SameSite=Lax, Max-Age 31536000, Secure in prod, not HttpOnly), ThemeToggle synced across instances through <html data-theme>"
  - "logout hardened: a rejected signOut lands on /configuracoes?erro=sair → ActionToast (generic error) through the shell's ToastProvider; scope 'local' unchanged (D-08)"
  - "apps/web/app/error.tsx — neutral generic error boundary (EmptyState + outline 'Tentar novamente' → reset())"
  - "Catalog: app.nav.{home,profile,mainNav,notifications,support,theme,settings,openProfile}, app.home.{welcome,soonTitle,soonBody}, app.error.{title,body,retry}, app.settings.*, app.profile.*, example.nav"
  - "Tests: packages/core/tests/nav.test.ts (6), app-shell.test.tsx (9), apps/api/tests/unit/registry.test.ts cases 7-9, apps/web/e2e/shell.spec.ts (5 cases × 2 projects), fixtures.signOut(), Phase 1 specs repaired for the D-42 home"
affects: [02-08 auth pages (no shell), 02-11 PWA (root layout metadata/SerwistProvider, manifest theme_color), 02-12 platform panel (/plataforma reached from the neutral shell's Tenants tab; platform.tenants label), 02-13 suspended screen, 02-16 smoke (toggle a module → tab disappears; check-static-routes.sh), Phase 3 profile (/perfil, 'Editar perfil' row), Phases 4-7 module manifests (nav.placement, nav.badge, home[]), Phase 7 notifications/chat (topbar slots, badge counters)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff, lockfile excluded)
actuals:
  tokens: 26719
  tasks: 3
  commits: 4
plan_head_before: bb4f37b5b21e5c7755c7b5714b233cd2e8fcecbf

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Navigation is a pure function of bootstrap.modules (buildNav): kernel Início first / Perfil last are unconditional (D-16), module tabs exist only because the tenant's flags put them in the bootstrap (MOD-04); nothing in apps/web or packages hard-codes a tab list"
    - "Manifest data stays serialisable: icons are names mapped to lucide components only inside packages/core/ui/nav.ts (LayoutGrid fallback, Bell for notifications — never Heart)"
    - "Home slots: the manifest declares { order } positions, the web composition point (apps/web/lib/registry.tsx) supplies the renderer per key/index, Promise.allSettled isolates a failing slot"
    - "One shell, both trees: AppShell renders TopBar+BottomNav (md:hidden) and DesktopRail (hidden md:flex) around ONE ScrollRoot; children render once; brand vars and [data-brand-root] on the shell root"
    - "Theme = cookie → <html data-theme> on the first HTML; the client toggle mutates the attribute and every ThemeToggle reads it through useSyncExternalStore + MutationObserver (single source of truth)"
    - "Module labels resolve from the module's own catalog namespace (<key>.nav) before the manifest label; every shell string reaches @tria/core/ui as a prop (PWA-03)"

key-files:
  created:
    - packages/core/ui/nav.ts
    - packages/core/ui/AppShell.tsx
    - packages/core/ui/ScrollRoot.tsx
    - packages/core/ui/TopBar.tsx
    - packages/core/ui/BottomNav.tsx
    - packages/core/ui/DesktopRail.tsx
    - packages/core/ui/HomeSlots.tsx
    - packages/core/ui/ThemeToggle.tsx
    - packages/core/tests/nav.test.ts
    - packages/core/tests/app-shell.test.tsx
    - apps/web/lib/registry.tsx
    - apps/web/app/error.tsx
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/(app)/configuracoes/ActionToast.tsx
    - apps/web/app/(app)/perfil/page.tsx
    - apps/web/e2e/shell.spec.ts
  modified:
    - packages/core/server/modules/manifest.ts
    - packages/contracts/src/bootstrap.ts
    - packages/modules/example/module.ts
    - apps/api/src/modules/registry.ts
    - apps/api/tests/unit/registry.test.ts
    - packages/core/ui/index.ts
    - apps/web/package.json
    - apps/web/app/layout.tsx
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/(app)/actions.ts
    - apps/web/app/(app)/inicio/page.tsx
    - apps/web/messages/pt-BR/app.json
    - apps/web/messages/pt-BR/example.json
    - apps/web/e2e/fixtures.ts
    - apps/web/e2e/{login,logout,session,signup,recovery,blocked,host-mismatch,example,platform}.spec.ts
    - .planning/phases/02-tenant-shell-branding-platform-panel/deferred-items.md
    - pnpm-lock.yaml

key-decisions:
  - "app.json shape: the kernel tab label moved to app.nav.home ('Início') because app.home became the welcome/soon object — a JSON key cannot be both a string and an object; the D-07 placeholder keys app.modules / app.none were removed with the placeholder page"
  - "ThemeToggle holds no local state: <html data-theme> is the single source of truth read through useSyncExternalStore + MutationObserver, so the settings row and the rail row can never disagree (the first cut with useState failed the desktop e2e exactly that way)"
  - "activeTabKey returns null when no tab matches (e.g. /configuracoes) instead of defaulting to the first tab like the prototype, so aria-current='page' is never claimed by Início on a non-tab route"
  - "[data-shell-nav='rail'] sits on the rail's <nav> (the labelled landmark), not the <aside>; visibility assertions work either way and the tests read the aria-label from the same node"
  - "The BottomNav scroll listener is registered with { capture: true, passive: true } (react-best-practices client-passive-event-listeners); collapse-to-single-button and media mode were not ported, as planned"
  - "logout treats a returned signOut error as a failure (throw → ?erro=sair); supabase-js already swallows session-missing 401/403/404, so only real transport failures reach the toast"
  - "example.spec.ts's TRIA Lab h1 swap was applied in Task 1 (not Task 3) because Task 1's verify chain runs that spec and the failure was a direct consequence of the D-42 heading"

patterns-established:
  - "Adding a module tab/slot/home widget = manifest nav.placement/badge/home + one WEB_MODULE_REGISTRY entry; no shell code changes"
  - "Kernel pages under (app) branch on getHostTenant().mode and call requireBootstrap() / requirePlatformTenants() so every concurrent segment ends in the same redirect"
  - "e2e: fixtures.signOut(page, origin) is the only way specs sign out; scope Sair to main so the desktop rail's second button never trips strict mode"

requirements-completed: [UI-03, MOD-04, PWA-03]

coverage:
  - id: D1
    description: "Both seed tenants render their own registry-driven shell at 390px (TopBar + BottomNav) and 1280px (rail + column) from the bootstrap alone: logo, --brand-primary, tabs of ENABLED modules (demo Início · Exemplo · Perfil, lab Início · Perfil), the example home slot vs the Em breve card, no cross-tenant hex or TRIA mark, children rendered once"
    requirement: UI-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts#tria-demo: logo, brand, Início · Exemplo · Perfil, the example home slot, one tree visible (mobile-chromium + desktop-chromium)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts#tria-lab: no Exemplo tab, no #exemplo, the \"Em breve\" card, the lab brand (both projects)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/app-shell.test.tsx (9 cases: logo fallback text, <img> ×2 and no TRIA, children once, BottomNav aria, disabled module absent, topbar slot + badge, HomeSlots)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Navigation composition (MOD-04/D-40): kernel Início first / Perfil last, module tabs by order then key, topbar placement with badge keys, catalog label resolver, longest-match active state with ties to the first tab, iconFor with neutral fallback"
    requirement: MOD-04
    verification:
      - kind: unit
        ref: "packages/core/tests/nav.test.ts (6 cases)"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#7-9 (home passthrough, no home key, topbar nav passthrough)"
        status: pass
      - kind: integration
        ref: "pnpm test:integration (119/119; modules.test.ts example nav assertion untouched)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Light/dark theme (D-41): toggling on /configuracoes flips <html data-theme>, persists tria_theme (not HttpOnly, SameSite=Lax), the server HTML already says dark with JavaScript disabled, the rail switch stays in step"
    requirement: UI-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts#D-41: dark theme from /configuracoes survives a JS-disabled reload (no flash) and a JS reload (both projects)"
        status: pass
    human_judgment: false
  - id: D4
    description: "/configuracoes Sair signs this device out (D-08) and /perfil shows e-mail + role with the Perfil tab / TopBar avatar marked aria-current"
    requirement: UI-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts#D-08: \"Sair\" on /configuracoes signs this device out and /inicio then lands on /entrar"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts#/perfil: e-mail + role, Perfil tab current, TopBar avatar current on the phone"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every shell/home/settings/profile string is in app.json (module label in example.nav); scripts/check-ui-literals.sh and the hex / legacy-class / tab-list greps are clean"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (OK); grep hex in packages/core/ui + apps/web/app = 0; Heart in packages/core/ui = 0; apps/web/lib/nav.ts absent"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every authenticated route is dynamic (root layout reads cookies()): /inicio, /configuracoes, /perfil absent from prerender-manifest routes; Phase 1 flows still pass against the new shell"
    verification:
      - kind: other
        ref: "pnpm --filter @tria/web build + node check over apps/web/.next/prerender-manifest.json (routes = ['/_global-error'])"
        status: pass
      - kind: e2e
        ref: "pnpm e2e — 86 passed on mobile-chromium + desktop-chromium (login, logout, session, signup, recovery, blocked, host-mismatch, example, platform, branding, shell)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual fidelity of the shell against the approved mockup (#desktop-shell-home, #settings) and the prototype TopBar/BottomNav: rail geometry, glass pill scroll reaction, settings rows, dark mode look on phone and desktop; 40-character display-name truncation/wrapping (backstop truths)"
    verification: []
    human_judgment: true
    rationale: "human_verify_mode is end-of-phase; look and feel (and the long-name screenshot fixture the plan marks as backstop) need a human eye at /gsd-verify-work — see Human verification notes below"

# Metrics
duration: 36min
completed: 2026-09-16
status: complete
---

# Phase 02 Plan 07: Registry-Driven Branded App Shell Summary

**Responsive `AppShell` in `@tria/core/ui` (prototype TopBar + glass BottomNav on the phone, 240px rail + 680px column on desktop) whose brand, tabs, TopBar slots and home widgets come only from `GET /v1/me/bootstrap` through the additive `nav.placement` / `nav.badge` / `home[]` registry extension; `/inicio` welcome + home slots, `/configuracoes` with a flash-free cookie-backed dark mode and "Sair", `/perfil` as the tab target — proven on both seed tenants at 390px and 1280px with the full e2e suite green.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-09-16T23:18:59Z
- **Completed:** 2026-09-16T23:55:00Z
- **Tasks:** 3
- **Files modified:** 41 (16 created)

## Accomplishments

- Registry extended without breaking anything: `ModuleNav.placement/badge`, `ModuleManifest.home`, the bootstrap schema mirror, `enabledModulesForBootstrap` spreading `home`, the example manifest declaring `home: [{ order: 90 }]` with its `nav` object byte-identical (integration suite 119/119).
- `buildNav` makes navigation a pure function of the enabled-module list (kernel Início/Perfil unconditional, MOD-04): the demo tenant reads Início · Exemplo · Perfil, the lab tenant Início · Perfil, and toggling a module changes the tabs with no shell code (02-16's smoke target).
- The shell reproduces the prototype's `--safe-*` / scroll-root contract (`main#app-scroll`, `ScrollContainerContext`, `#liquid-glass` mounted once, `--nav-height: 0px` on desktop) with both trees rendered and CSS-switched at `md`, children rendered exactly once.
- Dark mode with no flash: `tria_theme` → `<html data-theme>` on the first HTML (asserted with JavaScript disabled), `ThemeToggle` instances synchronised through the DOM attribute, `meta[name=theme-color]` updated from tokens.
- Phase 1 e2e repaired for the D-42 home (`signOut()` fixture, `/perfil` facts, `toContainText`), root error boundary added, every guard green: `pnpm lint` + literal guard, `pnpm boundaries`, `turbo lint typecheck test` 21/21, web build with all authenticated routes dynamic, `pnpm e2e` 86/86 on both projects.

## Task Commits

1. **Task 1 (tracer, TDD) RED** — `5c4ea95` (test): registry/buildNav/AppShell/HomeSlots cases + types + throwing skeletons (RED_EVIDENCE_OK for both suites via `check tdd-red-evidence` over vitest `tap-flat` output)
2. **Task 1 GREEN** — `9751bc5` (feat): registry spread, nav.ts, shell components, web composition point, `(app)` layout on AppShell, `/inicio`, catalog, `shell.spec.ts`
3. **Task 2** — `290ec52` (feat): theme cookie + `setTheme`, `ThemeToggle`, `/configuracoes` + `ActionToast`, `/perfil`, hardened `logout`, rail Tema row, e2e cases
4. **Task 3** — `3217e92` (test): `error.tsx`, `signOut()` fixture, Phase 1 spec repairs, platform tab href assertion, deferred items

**Plan metadata:** see the final docs commit.

## TDD Gate Compliance

- RED: `5c4ea95` `test(02-07): RED — …` — target tests failed on behaviour (`Error: not implemented` / `entry.home` undefined), not on load; classifier verdict `RED_EVIDENCE_OK` for `packages/core` (15 tests, 15 failing) and `apps/api` (9 tests, 1 failing: case 7).
- GREEN: `9751bc5` `feat(02-07): GREEN — …` — 15/15 core, 9/9 api unit, shell e2e green.
- REFACTOR: none needed (Biome formatting applied before GREEN).
- Note: the gsd classifier reads node:test-style TAP; vitest's `tap-flat` output was passed through a 10-line adapter (scratchpad only) that appends the `# tests/# pass/# fail` trailer — results copied verbatim.

## Files Created/Modified

- `packages/core/server/modules/manifest.ts` — `ModuleNavPlacement`, `ModuleNavBadge`, `ModuleHomeSlot`; docblocks on every new field
- `packages/contracts/src/bootstrap.ts` — `modules[].nav.placement/badge`, `modules[].home`
- `apps/api/src/modules/registry.ts` — spreads `manifest.home`
- `packages/modules/example/module.ts` — `home: [{ order: 90 }]`
- `packages/core/ui/nav.ts` — `buildNav`, `isNavItemActive`, `activeTabKey`, `iconFor`, types
- `packages/core/ui/AppShell.tsx`, `ScrollRoot.tsx`, `TopBar.tsx`, `BottomNav.tsx`, `DesktopRail.tsx`, `HomeSlots.tsx`, `ThemeToggle.tsx`, `index.ts`
- `apps/web/lib/registry.tsx` — `WEB_MODULE_REGISTRY`, `moduleLabelResolver`, `homeSlotsFor`
- `apps/web/app/layout.tsx` — `data-theme` from the cookie, `suppressHydrationWarning`
- `apps/web/app/(app)/layout.tsx` — AppShell wiring for both hosts, `generateViewport`
- `apps/web/app/(app)/actions.ts` — `setTheme`, hardened `logout`
- `apps/web/app/(app)/inicio/page.tsx`, `configuracoes/page.tsx`, `configuracoes/ActionToast.tsx`, `perfil/page.tsx`
- `apps/web/app/error.tsx` — root error boundary
- `apps/web/messages/pt-BR/app.json`, `example.json` — new namespaces / `example.nav`
- `apps/web/e2e/shell.spec.ts`, `fixtures.ts` (+ `signOut`), nine repaired Phase 1 specs
- `apps/api/tests/unit/registry.test.ts`, `packages/core/tests/nav.test.ts`, `packages/core/tests/app-shell.test.tsx`

## Decisions Made

See `key-decisions` in the frontmatter. Design-review deltas: `02-UI-SPEC.md` has no `## Design review deltas` section (the D-33 approval was recorded with no change list), so the shell and settings were coded to the approved `#desktop-shell-home` / `#settings` mockup as-is.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two `ThemeToggle` instances drifted apart**
- **Found during:** Task 2 (desktop e2e: the rail switch stayed `aria-checked=false` after the settings switch flipped)
- **Issue:** the plan's toggle kept local `useState`; with the rail and the settings row both mounted on desktop they disagreed.
- **Fix:** `useSyncExternalStore` over a `MutationObserver` on `<html data-theme>`; no local state.
- **Files modified:** `packages/core/ui/ThemeToggle.tsx`
- **Verification:** `shell.spec.ts` D-41 case on `desktop-chromium`
- **Committed in:** `290ec52`

**2. [Rule 1 - Bug] `example.spec.ts` lab `h1` assertion repaired in Task 1**
- **Found during:** Task 1 verify (`example.spec.ts` case 3 failed on the D-42 heading)
- **Fix:** `toHaveText('TRIA Lab')` → `toContainText('TRIA Lab')` (the exact swap Task 3 prescribes, applied one task early so Task 1's verify chain is honest).
- **Committed in:** `9751bc5`

**3. [Rule 2 - Catalog shape] `app.home` string → `app.nav.home`**
- **Found during:** Task 1 (catalog)
- **Issue:** the plan keeps `app.home = "Início"` AND adds `app.home = { welcome, … }` — impossible in one JSON object.
- **Fix:** kernel tab label at `app.nav.home`; `app.modules` / `app.none` (D-07 placeholder strings) removed with the placeholder page.
- **Committed in:** `9751bc5`

### Documented, not fixed

- **Stale `apps/api/dist/` tripped `pnpm boundaries`** (bundled `resend` optional import of `@react-email/render`). Removed the gitignored artifact; a durable exclusion is a `turbo.json`/CI concern — logged in `deferred-items.md`.
- **Plan grep `Igor Alves|brand-ig-mark|MAIN_TABS` reports 1 file:** `packages/ui/tests/tokens.test.ts`, 02-02's negative assertion that tokens.css does NOT contain the class. A guard, not a use; left untouched.
- **`themeToggle={<ThemeToggle …/>}` literal:** satisfied in both layout branches (the element is inlined twice rather than built once) purely to match the acceptance grep.

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 catalog shape) + 3 documented. **Impact on plan:** none on scope; no new third-party packages (only the workspace dependency `@tria/core` in `apps/web`).

## Issues Encountered

- `pnpm e2e -- shell.spec.ts …` forwards the `--` to Playwright, which then ran the whole suite (12 min). Use `pnpm --filter @tria/web exec playwright test <spec>` for a scoped run.
- The gsd `tdd-red-evidence` classifier expects node:test TAP; vitest's nested `tap` reporter reads as "zero tests discovered". `--reporter=tap-flat` plus the summary trailer classifies correctly.

## Known Stubs

| Stub | File | Reason / owner |
|------|------|----------------|
| "Editar perfil" row with an `Em breve` pill | `apps/web/app/(app)/configuracoes/page.tsx` | Static kernel row by design (D-42); Phase 3 wires the profile module. Recorded in `.planning/WINDOWS.md`. |
| "Notificações" row with an `Em breve` pill | same | Phase 7 wires push preferences (D-42). |
| Platform-host shell `counters: 0/0`, `avatar.alt: ''` | `apps/web/app/(app)/layout.tsx` | The platform host has no membership; the panel (02-12) owns its own chrome content. |
| `version` falls back to `'dev'` | `apps/web/app/(app)/configuracoes/page.tsx` | `NEXT_PUBLIC_APP_VERSION` / `VERCEL_GIT_COMMIT_SHA` are set by the deploy (02-16 / CI). |

None of these blocks the plan's goal.

## Threat Flags

None beyond the plan's register: no new endpoint, auth path or schema; the new server action `setTheme` is the T-02-30/T-02-35 surface the plan already dispositions (two-value enum, non-sensitive cookie).

## Human verification notes (end-of-phase, D7)

- Phone (390px): TopBar with the seed logo + name, floating glass BottomNav (Início · Exemplo · Perfil on tria-demo) that shrinks after ~20px of downward scroll and restores on upward scroll; `/configuracoes` rows; `/perfil` avatar block.
- Desktop (1280px): 240px rail (logo, Início/Perfil rows, bottom group Configurações / Tema / Sair), centred 680px column, no TopBar/BottomNav; settings groups inside a Card.
- Dark mode on both: flip "Tema escuro", reload — no light flash; the glass bar and rail repaint.
- Backstop truths (long display name): rename a seed tenant to a 40-character name via the 02-05 `PATCH /v1/platform/tenants/{id}` and check TopBar truncation, the two-line welcome heading and the rail's `line-clamp-2`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 02-08 (auth visuals) and 02-11 (PWA) can build on `apps/web/app/layout.tsx` as it now stands (theme cookie read; no metadata beyond neutral defaults, no SerwistProvider yet).
- 02-12 mounts `/plataforma`; the neutral shell's single tab already points there and `platform.spec.ts` test 1 asserts the href without clicking it.
- 02-16 can turn the prerender-manifest check into `scripts/check-static-routes.sh` and prove "toggle a module → its tab disappears" with `PUT /v1/platform/tenants/{id}/modules/{key}` + `shell.spec.ts`-style assertions.
- Later module manifests declare `nav.placement`, `nav.badge` and `home[]`; the web side adds one `WEB_MODULE_REGISTRY` entry per module.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All 10 key files exist on disk and all four task commits (5c4ea95, 9751bc5, 290ec52, 3217e92) are in the git log.
