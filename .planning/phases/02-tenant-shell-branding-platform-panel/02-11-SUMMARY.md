---
phase: 02-tenant-shell-branding-platform-panel
plan: 11
subsystem: web PWA (manifest, service worker, offline, install hint)
tags: [pwa, serwist, manifest, service-worker, offline, install-hint, playwright, vitest, tracer]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "@tria/contracts/branding (resolveBranding, NEUTRAL_BRAND, LIGHT_BG, iconUrls fixed keys), apps/web/lib/host-brand.ts getHostBrand() (host-authoritative brand), seed brands demo #7c3aed / lab #0f766e"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@tria/ui EmptyState, Button, BottomSheet; tokens (--safe-top, --screen-h, neutral surfaces)"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 04
    provides: "per-namespace pt-BR catalog + loader, scripts/check-ui-literals.sh, apps/web/vitest.config.ts, D-33 approved mockup (#offline, #install-hint)"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 07
    provides: "root layout with <html data-theme> from the tria_theme cookie (D-41), ThemeToggle that rewrites meta[name=theme-color] at runtime"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 08
    provides: "proxy.ts PUBLIC pre-registered /m/<slug>/manifest.webmanifest, /serwist/*, /~offline; proxy.test.ts harness; alias → primary 308"
provides:
  - "@serwist/turbopack 9.5.12 + serwist 9.5.12 + esbuild 0.28.2 wired: next.config withSerwist(withNextIntl), experimental.useOffline, headers() no-store for /serwist/* and the manifest; tsconfig lib + WebWorker; build green under TypeScript 7.0.2 (no TS 6 alias)"
  - "app/sw.ts caching contract (T-02-70): precache = build assets + /~offline; NetworkOnly for navigations/documents, RSC payloads, server actions, /auth/*, /v1/*, /api/*, /m/*, /serwist/*; CacheFirst next-static (128 entries / 30 d); bounded SWR brand-assets (/icons/, /seed-logos/, public branding bucket, 32 entries / 7 d); dev = NetworkOnly everything; skipWaiting + clientsClaim (silent updates)"
  - "app/serwist/[path]/route.ts: createSerwistRoute, native esbuild, /~offline precached with a per-build revision (VERCEL_GIT_COMMIT_SHA → git HEAD → random)"
  - "apps/web/lib/manifest.ts: NEUTRAL_MANIFEST_SLUG '_tria', MANIFEST_FILE, NEUTRAL_ICONS, IconSet, manifestPath, isManifestSlug, isAllowedIconUrl, iconsFor (whole-set neutral fallback, T-02-72), shortName (≤ 12), buildManifest (id '/?tenant=<slug>', start_url/scope '/', standalone, pt-BR, background #f5f7fb), neutralManifest"
  - "app/m/[slug]/manifest.webmanifest/route.ts: host-authoritative (slug must equal the host's tenant slug, _tria only on non-tenant hosts), force-dynamic, application/manifest+json, Cache-Control private, no-store, no cookies (T-02-71)"
  - "Root layout generateMetadata (title template, applicationName, manifest link, favicon + apple-touch-icon from the same allow-listed set, appleWebApp, formatDetection) + generateViewport (theme-color = brand primary / neutral, viewportFit cover, no zoom lock); 02-07 theme cookie rendering unchanged"
  - "components/pwa/ServiceWorkerRegister (SerwistProvider swUrl /serwist/sw.js, scope /, updateViaCache none, module; cacheOnNavigation=false, reloadOnOnline=false; <html data-display-mode='standalone'|'browser'> mirror of matchMedia('(display-mode: standalone)'))"
  - "components/pwa/OfflineBanner (next/offline useOffline → role=status aria-live=polite, neutral tokens, under --safe-top, z-[90]); mounted once in the root layout"
  - "app/~offline: neutral pt-BR fallback page (EmptyState WifiOff + outline RetryButton → location.reload()), outside (app)/(auth), no session/brand root (T-02-74)"
  - "components/pwa/InstallHint (BUILT, UNMOUNTED — Phase 7 PWA-02): BottomSheet coach mark with Share icon, 'Entendi' (no persistence) / 'Agora não' (tria_install_hint_dismissed, 14 days); exports isIosSafari, isStandalone, shouldShowInstallHint, INSTALL_HINT_DISMISSED_KEY, INSTALL_HINT_DISMISS_MS"
  - "Neutral TRIA icon set apps/web/public/icons/tria-{48,192,512,maskable-512,apple-180}.png (#2e6fd0, mark inside the 80% safe zone on the maskable)"
  - "Catalog pwa.json: pwa.offline.{title,body,retry,banner}, pwa.install.{title,body,confirm,dismiss}"
  - "proxy.ts: manifest PUBLIC slug class widened to [a-z0-9_-] so the reserved _tria is public (one line)"
  - "Tests: lib/manifest.test.ts (8), components/pwa/InstallHint.test.ts (10), proxy.test.ts cases 9-11, e2e/pwa.spec.ts (@tracer/@offline/@install, 45 passed + 3 annotated skips on iphone-chromium / pixel-chromium / desktop-chromium) via playwright.pwa.config.ts (production build on :3100, `pnpm --filter @tria/web e2e:pwa`); vitest.config.ts oxc.jsx automatic"
affects: [02-13 icon derivation (writes branding.iconUrls under the public branding bucket — isAllowedIconUrl accepts exactly that origin/prefix), 02-14 Marca tab (branding save must invalidate the host cache so manifest/theme-color follow), 02-16 CI (add e2e:pwa production job, fold /~offline, /m/*, /serwist/* into check-static-routes.sh, keep the real-device standalone check manual), Phase 7 PWA-02 (mount InstallHint gated on shouldShowInstallHint; data-display-mode + isStandalone are the iOS push gate), Phase 8 (optional SW update toast via useSerwist)]

# Actuals (#2632) — estimateTokens scale (chars/4 over the realized diff, lockfile + PNGs excluded)
actuals:
  tokens: 16265
  tasks: 3
  commits: 4
plan_head_before: 2f5a08ff264675ad7fd9a9480d027469e21d0a3b

# Tech tracking
tech-stack:
  added: ["@serwist/turbopack@9.5.12", "serwist@9.5.12", "esbuild@0.28.2 (dev)"]
  patterns:
    - "Manifest and head icons come from ONE allow-listed set (lib/manifest.ts iconsFor): a single foreign/other-bucket URL drops the whole derived set to the neutral TRIA icons — never a mixed set"
    - "The HOST decides the manifest; the [slug] in the URL is only checked for equality with the host's tenant slug (404 otherwise) — no lookup keyed by the path segment"
    - "Service-worker runtime rules are hand-written and allow-list shaped: everything that can carry a session (documents, RSC, actions, auth/API) is NetworkOnly; only hashed build chunks and public brand assets are ever stored; SerwistProvider's cacheOnNavigation/reloadOnOnline are explicitly false"
    - "PWA plumbing is only testable on a production build: playwright.pwa.config.ts builds + starts on :3100 and pwa.spec.ts self-skips under the default dev-server suite (PWA_PROD)"
    - "A feature designed for a later phase (InstallHint) ships as an unmounted component with its decision logic as exported pure functions pinned by unit tests"

key-files:
  created:
    - apps/web/app/sw.ts
    - apps/web/app/serwist/[path]/route.ts
    - apps/web/app/m/[slug]/manifest.webmanifest/route.ts
    - apps/web/app/~offline/page.tsx
    - apps/web/app/~offline/RetryButton.tsx
    - apps/web/components/pwa/ServiceWorkerRegister.tsx
    - apps/web/components/pwa/OfflineBanner.tsx
    - apps/web/components/pwa/InstallHint.tsx
    - apps/web/components/pwa/InstallHint.test.ts
    - apps/web/lib/manifest.ts
    - apps/web/lib/manifest.test.ts
    - apps/web/messages/pt-BR/pwa.json
    - apps/web/e2e/pwa.spec.ts
    - apps/web/playwright.pwa.config.ts
    - apps/web/public/icons/tria-48.png
    - apps/web/public/icons/tria-192.png
    - apps/web/public/icons/tria-512.png
    - apps/web/public/icons/tria-maskable-512.png
    - apps/web/public/icons/tria-apple-180.png
  modified:
    - apps/web/app/layout.tsx
    - apps/web/next.config.ts
    - apps/web/tsconfig.json
    - apps/web/package.json
    - apps/web/proxy.ts
    - apps/web/proxy.test.ts
    - apps/web/vitest.config.ts
    - pnpm-lock.yaml

key-decisions:
  - "TS 7 spike passed: `next build` with @serwist/turbopack succeeds under typescript@7.0.2 — the TS 6 alias fallback was NOT needed and was not installed"
  - "tsconfig `lib` + `WebWorker` type-checks cleanly next to DOM/DOM.Iterable; the triple-slash fallback in app/sw.ts was not needed"
  - "Standalone-mode emulation: Chromium 153 (Playwright 1.63) ignores the `display-mode` feature in Emulation.setEmulatedMedia (prefers-color-scheme works through the same call, so the probe is valid) and headless `--app=` launch does not report standalone either; the e2e keeps the 'browser' half as a passing assertion on all three projects and the 'standalone' half skips with the annotation 'CDP display-mode emulation unsupported — real-device check required' on iphone/pixel — the real-device install check stays the definitive PWA-01 standalone proof"
  - "The /~offline page and pwa.json were pulled forward from Task 2 into the Task 1 commit (Rule 3): the worker precaches /~offline and a 404 precache entry fails the install, so the tracer's own 'SW controlling' assertion could not pass without the page; D-33 approval was already in place"
  - "Refused manifest URLs are asserted as 404 OR 307→/entrar: a slug the proxy PUBLIC class rejects (e.g. `not a slug`) never reaches the route and is bounced by the auth gate — both are refusals and neither is a manifest"
  - "vitest.config.ts gained `oxc: { jsx: { runtime: 'automatic' } }` (Vite 8 transforms with oxc, not esbuild) so InstallHint.test.ts can import the .tsx module for its pure helpers under node while tsconfig keeps `jsx: preserve` for Next"
  - "InstallHint lives in apps/web/components/pwa/ (UI-SPEC inventory says @tria/core/ui) to keep wave-5 files disjoint; Phase 7 may hoist it when wiring PWA-02. Catalog namespace is pwa.offline.*/pwa.install.* in one pwa.json (UI-SPEC lists offline/install) per the plan"

patterns-established:
  - "Adding a PWA-served public path = one anchored PUBLIC regex in proxy.ts + a NetworkOnly prefix in app/sw.ts when the answer can be tenant- or session-bound"
  - "Per-tenant head metadata belongs to the ROOT layout's generateMetadata/generateViewport reading getHostBrand(), so the login page carries the brand before any session; deeper layouts only override what they own"
  - "e2e for a production-only behaviour gets its own Playwright config (build + start on a spare port) and a file-level self-skip under the default suite"

requirements-completed: [PWA-01, PWA-03]

coverage:
  - id: D1
    description: "Per-tenant manifest: GET /m/tria-demo/manifest.webmanifest on the demo host answers 200 application/manifest+json, private no-store, name 'TRIA Demo', short_name ≤ 12, theme_color #7c3aed, background #f5f7fb, id '/?tenant=tria-demo', start_url/scope '/', standalone, pt-BR, three PNG icons (192 any, 512 any, 512 maskable); the lab host answers 'TRIA Lab' / #0f766e / '/?tenant=tria-lab'"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the demo host serves its own no-store manifest (D-25, D-28) — 3 projects"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the lab host serves its own manifest and head links"
        status: pass
      - kind: unit
        ref: "apps/web/lib/manifest.test.ts (8 cases: id scheme, shortName cut, slug validation, neutral manifest, icon allow-list, whole-set fallback)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Host-authoritative manifest (T-02-71): /m/tria-lab on the demo host, /m/tria-demo on generic/platform hosts, /m/_tria on a tenant host and an invalid slug are all refused; /m/_tria answers the neutral TRIA manifest (id '/?tenant=_tria', /icons/tria-* only) on generic and platform hosts; the route is force-dynamic and never prerendered"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#cross-host manifests are refused (T-02-71); _tria answers only on non-tenant hosts"
        status: pass
      - kind: other
        ref: "pnpm --filter @tria/web build → /m/[slug]/manifest.webmanifest listed as ƒ (dynamic); .next/prerender-manifest.json routes = [/_global-error, /serwist/sw.js, /serwist/sw.js.map]"
        status: pass
    human_judgment: false
  - id: D3
    description: "Root layout metadata: /entrar before login links /m/tria-demo/manifest.webmanifest, meta theme-color #7c3aed, link rel=icon + apple-touch-icon from the same set, apple-mobile-web-app-title 'TRIA Demo'; the lab host links its own manifest and #0f766e; 02-07's data-theme rendering unchanged"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#/entrar (before login) links the tenant manifest, icons, theme-color and app title"
        status: pass
      - kind: e2e
        ref: "pnpm e2e (dev server, 100 passed) — shell.spec.ts D-41 dark-theme cases still green"
        status: pass
    human_judgment: false
  - id: D4
    description: "Service worker: /serwist/sw.js is 200 JavaScript, Cache-Control no-store, Service-Worker-Allowed /; the registration has scope '/' and updateViaCache 'none'; after ready + one reload the controller's scriptURL ends with /serwist/sw.js; a normal tab renders <html data-display-mode='browser'>"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the service-worker script is served no-store with Service-Worker-Allowed: /"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the service worker registers with updateViaCache none and controls the page after a reload"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#a normal tab mirrors display-mode: browser onto <html data-display-mode>"
        status: pass
    human_judgment: false
  - id: D5
    description: "Standalone mode (ROADMAP criterion 4): the installed app launches without browser chrome on a real iPhone (Safari → Compartilhar → Adicionar à Tela de Início) and a real Android phone (Chrome install), with the tenant name + icon on the home screen and theme-color = tenant primary; <html data-display-mode='standalone'> once launched"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#data-display-mode follows display-mode: standalone (CDP emulation on the mobile projects) — SKIPPED with annotation 'CDP display-mode emulation unsupported — real-device check required'"
        status: unknown
    human_judgment: true
    rationale: "Playwright cannot install a PWA and the bundled Chromium ignores display-mode emulation; 02-VALIDATION.md Manual-Only Verifications — real-device install + launch is the definitive proof (flagged assumption edge PWA-01/unclassified)"
  - id: D6
    description: "Offline fallback: /~offline is precached per build; with the context offline a navigation to /inicio renders 'Você está offline' + 'Verifique sua conexão e tente novamente.' + outline 'Tentar novamente', no data-brand-root; once online the retry lands on /entrar"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#/~offline is precached per build"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#an offline navigation renders the neutral offline page; retry lands on /entrar once online"
        status: pass
    human_judgment: false
  - id: D7
    description: "Caching policy (T-02-70): after login and visits to /inicio and /configuracoes, Cache Storage holds no /inicio, /configuracoes, /perfil, /entrar entry, nothing with _rsc=, /v1/, /auth/ or /m/, and the only document-like entry is /~offline"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the service worker never stores authenticated documents, RSC payloads or API/auth answers (T-02-70)"
        status: pass
      - kind: other
        ref: "grep gates: defaultCache=0 and NetworkFirst=0 in app/sw.ts; cacheOnNavigation={false} + reloadOnOnline={false} in ServiceWorkerRegister.tsx"
        status: pass
    human_judgment: false
  - id: D8
    description: "Offline banner: role=status aria-live=polite 'Você está offline. Alguns conteúdos podem não estar disponíveis.' appears when the context goes offline and disappears when connectivity returns; no reload"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the offline banner follows connectivity on an open page"
        status: pass
    human_judgment: false
  - id: D9
    description: "Public plumbing (T-02-77): cookie-less GET /m/tria-demo/manifest.webmanifest, /m/_tria/manifest.webmanifest, /serwist/sw.js and /~offline are not redirected; /inicio, a traversal suffix and an upper-case slug still redirect to /entrar; PUBLIC has one entry each for the manifest, /serwist/ and /~offline"
    requirement: PWA-01
    verification:
      - kind: unit
        ref: "apps/web/proxy.test.ts#9-11 (PWA PUBLIC entries)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#public plumbing (T-02-77): manifest and SW are reachable without a session, /inicio is not"
        status: pass
    human_judgment: false
  - id: D10
    description: "Icon provenance (T-02-72) + neutral set: /icons/tria-192.png and tria-maskable-512.png are served as image/png; the demo manifest's icons are all /icons/tria-* or all under /storage/v1/object/public/branding/ (never mixed); the five PNGs have the exact dimensions 48/192/512/512/180"
    requirement: PWA-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the neutral icon set is served cookie-less as image/png"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the demo manifest icons are all neutral or all from the branding bucket — never mixed (T-02-72)"
        status: pass
      - kind: other
        ref: "sharp metadata at generation: tria-48 48x48, tria-192 192x192, tria-512 512x512, tria-apple-180 180x180, tria-maskable-512 512x512"
        status: pass
    human_judgment: false
  - id: D11
    description: "InstallHint built, unmounted: exported helpers behave per UI-SPEC (iOS Safari only, not standalone, 14-day dismissal, NaN = not dismissed); no dialog and no 'Adicione à Tela de Início' on /entrar, /inicio, /configuracoes; no InstallHint import under apps/web/app|lib|proxy.ts; no Android install-prompt listener"
    requirement: PWA-01
    verification:
      - kind: unit
        ref: "apps/web/components/pwa/InstallHint.test.ts (10 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/pwa.spec.ts#the install hint is built but unmounted: no dialog and no hint copy on any page"
        status: pass
      - kind: other
        ref: "grep -rlE InstallHint apps/web/app apps/web/lib apps/web/proxy.ts | wc -l → 0; grep -rli beforeinstallprompt apps/web (ts/tsx) → 0"
        status: pass
    human_judgment: false
  - id: D12
    description: "PWA-03: every offline/banner/install string lives in apps/web/messages/pt-BR/pwa.json (UTF-8, literal accents, typographic quotes) and scripts/check-ui-literals.sh passes over the new .tsx"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "pnpm lint → check-ui-literals: OK (no hex/legacy-class/pt-BR literals; catalog files valid)"
        status: pass
    human_judgment: false
  - id: D13
    description: "The iOS coach mark and the offline page match the approved D-33 mockup (#install-hint, #offline): 56px bg-brand/10 circle with Share 28, 16/700 title, 14 secondary body with inline Share 16, brand 'Entendi' + ghost 'Agora não'; EmptyState WifiOff 64px circle, 16/700 heading, one outline button, centred max-w-sm"
    requirement: PWA-01
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to the approved mockup is a design judgment; the automated checks cover structure and copy only"

# Metrics
duration: 21min
completed: 2026-09-17
status: complete
---

# Phase 02 Plan 11: Installable PWA — per-tenant manifest, Serwist service worker, offline fallback, unmounted install hint Summary

**Host-authoritative per-tenant manifest (`/m/<slug>/manifest.webmanifest`, `id '/?tenant=<slug>'`, brand `theme_color`, allow-listed icons) + a `@serwist/turbopack` service worker that never stores authenticated data, a pt-BR `/~offline` fallback with a `useOffline` banner, `<html data-display-mode>`, and the iOS install hint built but unmounted — proven on iPhone 14 / Pixel 7 / Desktop Chrome against a production build**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-17T00:48:08Z
- **Completed:** 2026-09-17T01:09:05Z
- **Tasks:** 3
- **Files modified:** 27 (19 created, 8 modified)

## Accomplishments
- PWA-01 manifest half: every route — `/entrar` before login included — links the host tenant's own manifest, favicon, apple-touch-icon and `theme-color`; the manifest route answers only the host's slug (cross-host and `_tria`-on-tenant requests are refused), `force-dynamic`, `private, no-store`, no cookies.
- PWA-01 service worker: `/serwist/sw.js` served `no-store` + `Service-Worker-Allowed: /`, registered with `updateViaCache: 'none'`, `cacheOnNavigation`/`reloadOnOnline` off; precache = build assets + `/~offline`; documents, RSC payloads, server actions, `/auth`, `/v1`, `/api`, `/m`, `/serwist` are NetworkOnly — asserted after a real login that Cache Storage holds no authenticated entry.
- Offline: neutral `/~offline` page served for any navigation while offline (no brand root), `OfflineBanner` on every route, `experimental.useOffline` retries blocked navigations/actions.
- Standalone signal `<html data-display-mode>` from `matchMedia('(display-mode: standalone)')`; the `InstallHint` (iOS coach mark) ships unmounted with its decision helpers unit-tested for Phase 7.
- Build shape verified under TypeScript 7.0.2 with no alias: `/serwist/[path]` static, the manifest route dynamic, no authenticated route prerendered.

## Task Commits

1. **Task 1 (tracer): installable tenant shell — packages, next.config, sw.ts + serwist route, lib/manifest + route, root metadata/viewport + ServiceWorkerRegister, proxy `_tria`, neutral icons, playwright.pwa.config + `@tracer`** - `b1be5e5` (feat)
2. **Task 2: offline expansion — OfflineBanner + layout mount + `@offline` e2e** - `97330bf` (feat)
3. **Task 3: install expansion — InstallHint (unmounted) + helpers/tests, vitest oxc jsx, `@install` e2e** - `88350a7` (feat)
4. **Docblock reword so the OfflineBanner no-reload grep gate reads clean** - `1e0c627` (docs)

**Plan metadata:** see the final `docs(02-11)` commit.

## Files Created/Modified
- `apps/web/app/sw.ts` — Serwist worker: precache + explicit runtime rules (NetworkOnly / CacheFirst `next-static` / SWR `brand-assets`), `/~offline` fallback, dev = NetworkOnly.
- `apps/web/app/serwist/[path]/route.ts` — `createSerwistRoute` (native esbuild), `/~offline` precached with a per-build revision.
- `apps/web/lib/manifest.ts` (+ `.test.ts`) — manifest builder, neutral slug/icons, `isAllowedIconUrl`, `iconsFor`, `shortName`.
- `apps/web/app/m/[slug]/manifest.webmanifest/route.ts` — host-authoritative manifest, 404 on slug/host mismatch.
- `apps/web/app/layout.tsx` — `generateMetadata` + `generateViewport` from `getHostBrand()`; mounts `ServiceWorkerRegister` and `OfflineBanner`; 02-07 theme cookie rendering intact.
- `apps/web/components/pwa/ServiceWorkerRegister.tsx`, `OfflineBanner.tsx`, `InstallHint.tsx` (+ `InstallHint.test.ts`).
- `apps/web/app/~offline/page.tsx`, `RetryButton.tsx` — neutral offline page.
- `apps/web/messages/pt-BR/pwa.json` — `pwa.offline.*`, `pwa.install.*`.
- `apps/web/public/icons/tria-{48,192,512,maskable-512,apple-180}.png` — neutral TRIA set.
- `apps/web/next.config.ts` — `withSerwist`, `experimental.useOffline`, `headers()`; `apps/web/tsconfig.json` — `WebWorker` lib; `apps/web/package.json` — pins + `e2e:pwa`.
- `apps/web/proxy.ts` (one line: `[a-z0-9_-]` manifest slug class) + `proxy.test.ts` cases 9-11.
- `apps/web/e2e/pwa.spec.ts`, `apps/web/playwright.pwa.config.ts` — production-build PWA suite; `apps/web/vitest.config.ts` — `oxc.jsx` automatic.

## Decisions Made
- **TS 7 spike (RESEARCH Pitfall 4):** `next build` with `@serwist/turbopack` passes under `typescript@7.0.2`; the `@typescript/typescript6` alias was neither needed nor installed (no legitimacy checkpoint required).
- **tsconfig `lib` + `WebWorker`** type-checks next to `DOM`/`DOM.Iterable`; the triple-slash fallback was not needed.
- **Standalone emulation outcome — SKIPPED (annotated).** Chromium 153 bundled with Playwright 1.63 ignores the `display-mode` feature in `Emulation.setEmulatedMedia` (verified: the same call flips `prefers-color-scheme`, so the probe is valid; headless `--app=` launch does not report standalone either). `pwa.spec.ts` keeps the `browser` mirror as a passing assertion on all three projects and the standalone case skips on iphone/pixel with the annotation "CDP display-mode emulation unsupported — real-device check required".
- **`/~offline` pulled into Task 1 (Rule 3):** the worker precaches `/~offline`; precaching a 404 fails the install, so the tracer's "SW controlling" assertion could not pass without the page. D-33 approval was already in place, so the page + `pwa.json` were created in Task 1 and Task 2 kept the banner, mount and `@offline` e2e.
- **Refused manifest URLs = 404 or 307→`/entrar`:** a slug the proxy's PUBLIC class rejects never reaches the route (bounced by the auth gate); the e2e accepts either refusal and asserts the answer is never `manifest+json`.
- **`vitest.config.ts` `oxc.jsx`** (Vite 8 transforms with oxc, not esbuild): lets `InstallHint.test.ts` import the `.tsx` module for its pure helpers under node without rendering.
- **D-33 deltas:** none — the sketch README has `changes_requested: []` and `02-UI-SPEC.md` carries no "Design review deltas" section for `offline`/`install-hint`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `/~offline` page + `pwa.json` created in Task 1 instead of Task 2**
- **Found during:** Task 1 (tracer e2e — "SW controlling" timed out on `navigator.serviceWorker.ready`)
- **Issue:** `app/serwist/[path]/route.ts` precaches `/~offline` with a revision; the page did not exist yet, the precache fetch 404'd and the worker's install failed, so the tracer's `<verify>` could not pass.
- **Fix:** Created `app/~offline/page.tsx`, `RetryButton.tsx` and `messages/pt-BR/pwa.json` (Task 2 artifacts, D-33 already approved) inside Task 1; Task 2 delivered the banner, mount and e2e.
- **Files modified:** apps/web/app/~offline/page.tsx, apps/web/app/~offline/RetryButton.tsx, apps/web/messages/pt-BR/pwa.json
- **Verification:** `@tracer` 18 passed / 3 skipped after the fix; full suite 45 passed / 3 skipped.
- **Committed in:** b1be5e5

**2. [Rule 1 - Bug] Refusal assertion for an invalid slug**
- **Found during:** Task 3 (`@install` e2e)
- **Issue:** `/m/not a slug/manifest.webmanifest` is not PUBLIC, so the proxy 307s to `/entrar`; the request fixture followed the redirect and saw a 200 from the login page instead of the 404 the plan wrote.
- **Fix:** `maxRedirects: 0` + accept 404 or 307-to-`/entrar`, and assert the body is never `manifest+json`.
- **Files modified:** apps/web/e2e/pwa.spec.ts
- **Verification:** full `e2e:pwa` green on three projects.
- **Committed in:** 88350a7

**3. [Rule 3 - Blocking] `apps/web/vitest.config.ts` extended (outside `files_modified`, sanctioned by the orchestrator notes)**
- **Found during:** Task 3 (`InstallHint.test.ts` failed to parse JSX: tsconfig `jsx: preserve`)
- **Issue:** the web vitest config transformed no JSX, so importing `InstallHint.tsx` for its pure helpers failed at import analysis.
- **Fix:** `oxc: { jsx: { runtime: 'automatic' } }` (Vite 8 uses oxc; the `esbuild` key is ignored). No new dependency.
- **Files modified:** apps/web/vitest.config.ts
- **Verification:** `pnpm --filter @tria/web test` 41/41.
- **Committed in:** 88350a7

**4. [Rule 1 - Bug] Test expectation for `shortName`**
- **Found during:** Task 1 (unit test)
- **Issue:** my first expectation for `shortName('Associação Beneficente São José')` was wrong; the contract (≤ 12 chars, no trailing space) yields `'Associação B'`.
- **Fix:** corrected the expectation and added a case where the 12th character is a space (`'Associação'`).
- **Files modified:** apps/web/lib/manifest.test.ts
- **Committed in:** b1be5e5

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 bugs in my own tests). **Impact on plan:** artifacts and contracts unchanged; the offline page simply landed one commit earlier than planned.

## Issues Encountered
- **Standalone emulation unsupported** (see Decisions): the automated suite proves the `browser` half and the mirror mechanism; the `standalone` half is a manual real-device check.
- **`pnpm boundaries`** reported the pre-existing stale `apps/api/dist/main.js` finding recorded by 02-07 (`@react-email/render` inside the bundled resend SDK); removing the git-ignored artifact makes the check pass (`263 files, no issues`). Not caused by this plan; already listed in `deferred-items.md`.
- The Vercel plugin's post-write validator flagged `headers()`/`cookies()` mentions inside docblocks as un-awaited request APIs — false positives (the `next.config` `headers()` option and comment text); the real `cookies()` call in the root layout is awaited (02-07 code, unchanged).

## Flagged assumption for `/gsd-verify-work` (edge PWA-01/unclassified)
The planner ASSUMED PWA-01's acceptance surface is (a) a valid per-tenant manifest, (b) the SW registered and controlling, (c) `display-mode: standalone` detected, (d) the offline fallback served. (a), (b), (d) are asserted end-to-end in `pwa.spec.ts` on three projects. (c) is only half-automatable: the `browser` value and the `matchMedia` mirror are asserted; the `standalone` value cannot be emulated by the bundled Chromium and Playwright cannot install a PWA — **the real-device check below is the definitive proof.**

## Manual verification (human_verify_mode = end-of-phase; 02-VALIDATION.md "Manual-Only Verifications")
1. On a real iPhone, open the demo host in Safari → Compartilhar → "Adicionar à Tela de Início" → launch from the home screen: no browser chrome, name "TRIA Demo", the TRIA/derived icon, status bar in the tenant primary; in Web Inspector `document.documentElement.dataset.displayMode === 'standalone'`.
2. On a real Android phone (Chrome), open the demo host → install prompt / "Adicionar à tela inicial" → launch: standalone window, `theme-color` = `#7c3aed`, maskable icon not cropped.
3. Visual fidelity of `/~offline` (airplane mode → navigate) and of `InstallHint` (temporarily mount `<InstallHint open />` in a scratch page) against `.planning/sketches/001-phase-02-designed-screens/index.html#offline` / `#install-hint`.

## Known Stubs
None. `InstallHint` is deliberately unmounted (PWA-02 wiring is Phase 7) — a documented phase boundary, not a stub; its behaviour is fully implemented and tested.

## Threat Flags
None beyond the plan's `<threat_model>` — the new surfaces (`/m/[slug]/manifest.webmanifest`, `/serwist/*`, `/~offline`, Cache Storage rules, the `_tria` PUBLIC widening, echoed icon URLs) are all registered there (T-02-70 … T-02-79, T-02-SC).

## User Setup Required
None — no external service configuration required. `pnpm --filter @tria/web e2e:pwa` builds and starts the app on :3100 itself (kill a stale server with `lsof -ti:3100 | xargs kill`).

## Next Phase Readiness
- **02-13** writes `branding.iconUrls.*` + `faviconUrl` as absolute URLs under `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/…` — exactly the origin/prefix `isAllowedIconUrl` accepts; any other shape falls back to the neutral set (the e2e "never mixed" case will show the derived icons once seed derivation runs).
- **02-14** must call `invalidateTenantHost` on a branding save so the manifest/`theme-color` follow within the 60 s TTL.
- **02-16** adds `e2e:pwa` to CI (production build job), folds `/~offline`, `/m/*`, `/serwist/*` into `check-static-routes.sh` (`/serwist/[path]` is legitimately static) and keeps the real-device standalone check in the manual list.
- **Phase 7 (PWA-02)** mounts `InstallHint` gated on `shouldShowInstallHint` before requesting push permission; `data-display-mode` / `isStandalone()` are the iOS "installed" signals. **Phase 8** may add an update toast via `useSerwist()`.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-17*

## Self-Check: PASSED

All 19 created files exist on disk and the four task commits (b1be5e5, 97330bf, 88350a7, 1e0c627) are in git history.
