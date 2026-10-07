---
phase: quick-261007-kyp
plan: 01
subsystem: web-pwa
tags: [pwa, install-gate, web-push, next-intl, pt-BR, auth-links]
status: complete
requirements: [PWA-01, PWA-02, NOTIF-03, AUTH-03]
dependency_graph:
  requires: [lib/push.ts (isIosLike, enablePush), components/pwa/InstallHint.tsx (isStandalone), components/push/PushControls.tsx, app/auth/confirm/route.ts]
  provides: [InstallGate (root layout, behind INSTALL_GATE), link_return marker cookie, FirstOpenAsk sheet]
  affects: [apps/web root layout, apps/web (app) layout, /auth/confirm, Playwright harness env]
tech_stack:
  added: []
  patterns: [hydration-neutral client gate, html data attribute + CSS failsafe, external store via useSyncExternalStore, allow-listed marker cookie]
key_files:
  created:
    - apps/web/lib/install-gate.ts
    - apps/web/lib/install-gate.test.ts
    - apps/web/lib/install-prompt.ts
    - apps/web/lib/install-prompt.test.ts
    - apps/web/lib/link-return.ts
    - apps/web/lib/link-return.test.ts
    - apps/web/components/pwa/InstallGate.tsx
    - apps/web/components/pwa/InstallGate.test.tsx
    - apps/web/components/push/FirstOpenAsk.tsx
    - apps/web/components/push/FirstOpenAsk.test.tsx
    - apps/web/messages/pt-BR/pwa.gate.json
  modified:
    - apps/web/app/layout.tsx
    - apps/web/app/globals.css
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/auth/confirm/route.ts
    - apps/web/app/auth/confirm/route.test.ts
    - apps/web/lib/env.ts
    - apps/web/lib/push.ts
    - apps/web/lib/push.test.ts
    - apps/web/components/push/PushControls.tsx
    - apps/web/components/pwa/InstallHint.tsx
    - apps/web/components/pwa/ServiceWorkerRegister.tsx
    - apps/web/playwright.config.ts
    - apps/web/.env.example
decisions:
  - "Gate is a hydration-neutral client wrapper in the root layout: first server HTML = the app; html data-install-gate=pending + coarse-pointer CSS hide + 4 s CSS failsafe avoids the flash."
  - "INSTALL_GATE (on in production builds, off under next dev, off in the Playwright harness) is the kill switch."
  - "/redefinir-senha and /aceitar-convite stay usable in a phone browser while the matching link_return marker stands (the one-time session lives only in that browser)."
  - "The first-open ask treats an unreadable store as already asked (nagging is worse than silence)."
  - "iosVersion reads the Version/ token only for Macintosh (iPadOS) user agents, never an Android WebView's Version/4.0."
metrics:
  duration: "about 10 minutes of executor time"
  completed: 2026-10-07
  tasks: 3
  files: 24
actuals:
  tokens: 22000
  tasks: 3
  commits: 3
plan_head_before: 88be2cb
---

# Phase quick-261007-kyp Plan 01: Install gate, link-return screen and first-open notification ask Summary

On a phone or tablet outside the installed PWA, every route now renders a branded pt-BR "Instale o app para continuar" screen (iOS steps, Android Instalar app button from an early-captured prompt, in-app browser instructions), confirmation and recovery links opened in a mobile browser land on "E-mail confirmado" / "Tudo certo por aqui", and the installed app asks for notifications once, from a button, through the existing push flow.

## What shipped

**Task 1 (d532f44) - the tracer: install gate.**
- `lib/install-gate.ts`: pure `detectPlatform`, `isInAppBrowser`, `iosVersion`, `iosBelow`, `decideInstallGate`, session skip flag helpers. Reuses `isIosLike` from `lib/push` (iPadOS rule exists once). Rule order desktop, standalone, in-app, iOS, Android; standalone precedes the in-app rule because a home-screen app's UA has no Safari token.
- `lib/install-prompt.ts`: `beforeinstallprompt` / `appinstalled` captured at module evaluation, `useSyncExternalStore`-ready snapshot, single-use `promptInstall` whose first action is `prompt()`.
- `components/pwa/InstallGate.tsx`: first render is `<>{children}</>`; decision read after mount; children are not mounted while the gate shows; `Continuar no navegador` only when `canContinue` (in-app browsers, iOS < 16.4) and the stored flag is honored only then.
- Wiring: `INSTALL_GATE` in `lib/env.ts`, `data-install-gate="pending"` on `<html>` plus CSS rule and failsafe in `globals.css`, `playwright.config.ts` sets `INSTALL_GATE ??= 'off'`, `.env.example` entry (the edit was accepted, no hook refused it), brand block via `getHostBrand` + `brandScope` + `AuthBrand`. Stale "no Android install-prompt listener" comments in `InstallHint.tsx` and `ServiceWorkerRegister.tsx` corrected.
- `messages/pt-BR/pwa.gate.json` (dotted file under the `pwa` namespace, leaves only added).

**Task 2 (b5a6936) - link return.**
- `lib/link-return.ts`: `LINK_RETURN_COOKIE`, `linkReturnFor`, strict `parseLinkReturn`, `linkReturnScreen` (`show | pass | null`), HttpOnly / SameSite=Lax / 600 s / no Domain options. Imports nothing but the cookie policy.
- `/auth/confirm` writes the marker only after a successful `verifyOtp`, before the existing `redirect(safeNext)`; the open-redirect guard, type allow-list and failure redirects are untouched.
- Root layout reads and allow-list parses the cookie; `InstallGate` precedence: not gated, then `pass` (password form runs in this browser), then link-return screen (outranks in-app instructions) with "Ainda não instalei o app" revealing the install screen.

**Task 3 (6cb98d8) - first-open notification ask.**
- `lib/push.ts`: `PUSH_FIRSTOPEN_ASKED_KEY`, `readFirstOpenAsked` (unreadable store = asked), `writeFirstOpenAsked`, `firstOpenAskDue`, `anotherModalOpen`; doc fact 6.
- `PushControls.tsx`: `usePushDevice` and `useEnable` exported, nothing else changed.
- `FirstOpenAsk.tsx`: standalone-only bottom sheet, 1500 ms delay, retries every 1000 ms (max 20) while another `[aria-modal="true"]` is open, CTA through `useEnable` -> `enablePush` (the permission prompt stays the first await of the tap; the component source has no `requestPermission` call), every exit path stores the answer. Mounted inside `AppShell` in `app/(app)/layout.tsx` only when the notifications module supplies a VAPID key. No new catalog strings.

## TDD evidence (real output, Vitest does not emit TAP)

RED runs were observed before each implementation; no counts are fabricated.
- Task 1: `vitest run lib/install-gate.test.ts lib/install-prompt.test.ts components/pwa/InstallGate.test.tsx` -> `Test Files  3 failed (3)  Tests  no tests`, each with `Failed to resolve import "./install-gate" / "./install-prompt" / "./InstallGate"` (missing modules). GREEN after implementation: `Test Files 3 passed (3)  Tests 36 passed (36)`.
- Task 2: red run showed 9 failed tests: `lib/link-return.test.ts` could not import `./link-return`; 3 route tests failed with `expected "vi.fn()" to be called 1 times, but got 0 times` (cookie not written); 6 `InstallGate` link-return tests failed (`TypeError: Cannot read properties of undefined (reading 'signup')` for the missing catalog leaves, and `Unable to find an element with the text: app-child` for the missing pass-through). The failure-case route tests passed vacuously before the implementation, as expected. GREEN: `Test Files 5 passed (5)  Tests 67 passed (67)`.
- Task 3: red run showed `FirstOpenAsk.test.tsx` failing with `Failed to resolve import "./FirstOpenAsk"` and 5 `lib/push.test.ts` tests failing (`expected undefined to be 'rede_push_firstopen_asked'`, `writeFirstOpenAsked is not a function`, and so on). GREEN: `Test Files 3 passed (3)  Tests 39 passed (39)`.

## Verification

- `pnpm --filter @rede-social/web exec vitest run` (whole web suite): 107 files, 2128 tests passed.
- `pnpm --filter @rede-social/web typecheck`: green. `pnpm --filter @rede-social/web lint` (Biome): green. `bash scripts/check-ui-literals.sh apps/web`: OK.
- `TURBO_CACHE=local:r pnpm turbo boundaries --filter='!@rede-social/boundary-fixture'`: no issues. `.turbo/cache` stayed at 168K.
- Negative greps: no `dangerouslySetInnerHTML` in the two components; no `requestPermission` code line in `FirstOpenAsk.tsx`; `git log -3` has no Co-Authored-By trailer; nothing left staged; only the pre-existing untracked files remain.
- NOT RUN / INCONCLUSIVE: the real-browser login spot check. The local Supabase stack answers, but port 3000 is held by an unrelated Next dev server (pid 16237, cwd `/Users/igorvboas/Documents/PSW/CoE Hiperautomacao`, redirects `/inicio` to `/login`), so Playwright's `reuseExistingServer` ran `login.spec.ts` against the wrong app and all 5 cases failed on that foreign app. This says nothing about the gate. Nothing was killed or reset. Re-run `SEED_PASSWORD=Segredo123 pnpm --filter @rede-social/web exec playwright test login.spec.ts --project=mobile-chromium` after freeing port 3000.

## Deviations from Plan

None - plan executed as written. Notes:
- Biome auto-formatting and one `noJsxLiterals` fix (the step number is rendered through a template string) were applied inside the same tasks.
- The ledger-based commit count is 4 (`rev-list 1aea9f0..HEAD`), but one of them, `88be2cb ci: dev-server e2e runs only from e2e-full.yml`, is a concurrent unrelated commit that landed on master before this plan's first commit. This plan made 3 commits (d532f44, b5a6936, 6cb98d8); `plan_head_before` is recorded as `88be2cb`, the HEAD at the first task commit (ledger file value: 1aea9f0).
- `lib/env.ts` default for `INSTALL_GATE` reads `process.env.NODE_ENV` at module load; Biome `noUndeclaredEnvVars` did not require a `turbo.json` entry, so `turbo.json` was left alone (note: `INSTALL_GATE` is therefore not in turbo's `e2e`/`build` env lists; the Playwright default still applies).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-kyp-01..10). The new `link_return` cookie is the one new surface and is covered by T-kyp-02/03 (allow-list, HttpOnly, host-only, 10 minutes).

## For docs/DEPLOY.md (not edited, it carries uncommitted developer changes)

Optional kill switch: `INSTALL_GATE=off` (server env on Vercel) disables the whole install gate without a deploy of code. Default is `on` in production builds and preview, `off` under `next dev`. Any hand-started `next start` or production build used for e2e must export `INSTALL_GATE=off`.

## Outstanding real-device checks (human, after the next homolog release)

Chromium cannot emulate display-mode standalone and phones cannot reach `*.localhost`, so these are unverified until done on devices:
1. iPhone Safari 17: gate shows the three steps, "Adicionar à Tela de Início" installs, the home-screen app opens straight into the app (no gate), and the first-open sheet appears once.
2. iPad with "Request desktop site" (Macintosh UA with touch) is gated and installs.
3. Android Chrome: the "Instalar app" button appears (early capture) and installs; after install in the same tab `appinstalled` shows "App instalado"; with the app already installed the manual steps show.
4. In-app browsers (Instagram, Facebook, TikTok): the "Abrir no navegador" screen and "Continuar no navegador" appear; iOS < 16.4 shows the escape.
5. Sign-up confirmation mail opened on a phone browser lands on "E-mail confirmado"; recovery and invite mails still let the password form run in that browser, then show "Tudo certo por aqui".
6. First-open sheet: permission prompt only after the tap; "Agora não" and a denial are never re-asked; the sheet waits for the profile nudge popup on Início.
7. Hand check of the gate in DevTools device emulation with `INSTALL_GATE=on pnpm dev`.

## Self-Check: PASSED

- Created files verified present: lib/install-gate.ts, lib/install-prompt.ts, lib/link-return.ts, components/pwa/InstallGate.tsx, components/push/FirstOpenAsk.tsx, messages/pt-BR/pwa.gate.json (and their tests).
- Commits verified in `git log`: d532f44, b5a6936, 6cb98d8.
