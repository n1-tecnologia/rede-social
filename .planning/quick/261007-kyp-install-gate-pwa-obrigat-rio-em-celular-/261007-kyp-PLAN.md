---
phase: quick-261007-kyp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/lib/install-gate.ts
  - apps/web/lib/install-gate.test.ts
  - apps/web/lib/install-prompt.ts
  - apps/web/lib/install-prompt.test.ts
  - apps/web/lib/link-return.ts
  - apps/web/lib/link-return.test.ts
  - apps/web/lib/push.ts
  - apps/web/lib/push.test.ts
  - apps/web/lib/env.ts
  - apps/web/components/pwa/InstallGate.tsx
  - apps/web/components/pwa/InstallGate.test.tsx
  - apps/web/components/pwa/InstallHint.tsx
  - apps/web/components/pwa/ServiceWorkerRegister.tsx
  - apps/web/components/push/PushControls.tsx
  - apps/web/components/push/FirstOpenAsk.tsx
  - apps/web/components/push/FirstOpenAsk.test.tsx
  - apps/web/messages/pt-BR/pwa.gate.json
  - apps/web/app/layout.tsx
  - apps/web/app/globals.css
  - apps/web/app/(app)/layout.tsx
  - apps/web/app/auth/confirm/route.ts
  - apps/web/app/auth/confirm/route.test.ts
  - apps/web/playwright.config.ts
  - apps/web/.env.example
autonomous: true
requirements: [PWA-01, PWA-02, NOTIF-03, AUTH-03]
tags: [pwa, install-gate, web-push, next-intl, pt-BR, auth-links]

estimate:
  tokens: 110000
  raw_tokens: 110000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "On a phone or tablet outside the installed app (user agent says iOS or Android, or a Macintosh user agent with navigator.maxTouchPoints above 1 for iPadOS), every route of apps/web, the login and sign-up pages included, renders a full-screen install screen instead of the app, and none of the app's children are mounted while it shows. Desktop (Windows, Mac, Linux, ChromeOS, touch laptops included) and any standalone launch are never gated."
    - "iOS shows the three steps Compartilhar, Adicionar à Tela de Início, abrir pelo ícone. Android shows an Instalar app button wired to a beforeinstallprompt event that was captured and default-prevented at module evaluation (before any tap), plus manual menu steps when no event exists (app already installed, or a browser that never fires it) and an installed state after appinstalled. In-app browsers (Instagram, Facebook, TikTok, LinkedIn, Snapchat, LINE, WeChat, Pinterest, Twitter, Google app, Android WebView, iOS web views without a Safari token) show Abrir no Safari/Chrome instructions."
    - "The Continuar no navegador escape hatch exists only for in-app browsers and iOS older than 16.4, and is honored only there (sessionStorage flag read with try/catch); a stale flag never opens the gate for Safari 17 or Android Chrome."
    - "No hydration mismatch and no flash of the app: the first server HTML is the untouched app plus data-install-gate=pending on html (only when the gate is enabled); CSS hides body only for coarse-pointer devices in display-mode browser until the client decides, with a 4 s CSS failsafe so a failed hydration can never leave a blank screen."
    - "INSTALL_GATE (server env, on in production builds, off under next dev, explicit off in the Playwright harness) switches the whole gate off, so the 48 e2e spec files, which drive iPhone 14 and Pixel 7 user agents outside standalone, are not blocked."
    - "After /auth/confirm exchanges a link successfully, the route sets an HttpOnly, SameSite=Lax, 10-minute allow-listed marker cookie (signup | recovery | invite). A mobile non-standalone browser then shows E-mail confirmado (signup) or Tudo certo por aqui (recovery, invite) with a Ainda não instalei o app secondary button that reveals the install screen. /redefinir-senha and /aceitar-convite are exempt from the gate only while the matching marker is present, because the one-time session lives in that browser and the form must run there."
    - "In standalone mode only, once per device, a bottom sheet asks for notifications. Permission is requested only from a button tap through the existing enablePush flow (lib/push.ts via usePushDevice and useEnable from PushControls), never from an effect. Any answer (enabled, denied, Agora não, Escape, backdrop) is persisted in localStorage with try/catch, a stored answer or a denied permission is never asked again, an unreadable store reads as already asked, and the sheet never opens while another aria-modal dialog is open."
    - "Every user-facing string comes from the pt-BR catalog (messages/pt-BR/pwa.gate.json plus the reused notifications.softAsk.* and pwa.install.dismiss); scripts/check-ui-literals.sh passes."
    - "The detection logic is pure functions over a plain env object ({ userAgent, maxTouchPoints, standalone }), covered by Vitest cases for platform, standalone, in-app browser, iOS version and the gate decision."
  artifacts:
    - path: "apps/web/lib/install-gate.ts"
      provides: "pure detection and decision: detectPlatform, isInAppBrowser, iosVersion, iosBelow, decideInstallGate, skip-flag helpers"
      contains: "decideInstallGate"
    - path: "apps/web/lib/install-prompt.ts"
      provides: "early beforeinstallprompt / appinstalled capture, external-store snapshot, promptInstall"
      contains: "beforeinstallprompt"
    - path: "apps/web/lib/link-return.ts"
      provides: "marker cookie name, options, linkReturnFor, parseLinkReturn, linkReturnScreen (server and client safe, no push or UI imports)"
      contains: "linkReturnScreen"
    - path: "apps/web/components/pwa/InstallGate.tsx"
      provides: "client wrapper that decides after mount and renders the full-screen gate or the children"
      contains: "decideInstallGate"
    - path: "apps/web/messages/pt-BR/pwa.gate.json"
      provides: "pwa.gate.* catalog (steps, in-app, android, link return)"
      contains: "Instale o app para continuar"
    - path: "apps/web/components/push/FirstOpenAsk.tsx"
      provides: "one-time standalone-only notification sheet reusing the push flow"
      contains: "enable"
    - path: "apps/web/lib/push.ts"
      provides: "first-open ask key, readFirstOpenAsked, writeFirstOpenAsked, firstOpenAskDue, anotherModalOpen"
      contains: "firstOpenAskDue"
    - path: "apps/web/app/auth/confirm/route.ts"
      provides: "link-return marker written on a successful exchange"
      contains: "LINK_RETURN_COOKIE"
  key_links:
    - from: "apps/web/app/layout.tsx"
      to: "apps/web/components/pwa/InstallGate.tsx"
      via: "env.INSTALL_GATE === 'on' -> enabled prop, getHostBrand + brandScope -> brand props, parseLinkReturn(cookie) -> linkReturn prop, data-install-gate=pending on html"
    - from: "apps/web/app/globals.css"
      to: "apps/web/components/pwa/InstallGate.tsx"
      via: "html[data-install-gate=pending] rule; the component rewrites the attribute to open or gated after it decides"
    - from: "apps/web/app/auth/confirm/route.ts"
      to: "apps/web/app/layout.tsx"
      via: "link_return cookie written by the route, read and allow-list parsed by the root layout"
    - from: "apps/web/lib/install-gate.ts"
      to: "apps/web/lib/push.ts"
      via: "isIosLike (the one place the iPadOS rule lives) and isStandalone from InstallHint supplied by the component"
    - from: "apps/web/components/push/FirstOpenAsk.tsx"
      to: "apps/web/lib/push.ts"
      via: "usePushDevice and useEnable exported from PushControls, which call enablePush with the permission prompt as the first await of a tap"
    - from: "apps/web/playwright.config.ts"
      to: "apps/web/lib/env.ts"
      via: "process.env.INSTALL_GATE ??= 'off' inherited by every webServer the harness spawns"
---

<objective>
Install gate: on a phone or tablet that is not running the installed PWA, the app is replaced by a full-screen "instale o app" screen BEFORE login and sign-up. Plus two companions: the landing a confirmation or recovery e-mail link gets when it opens in a browser instead of the installed app, and a one-time notification ask on the first open of the installed app.

Request map (user text, quick task 261007-kyp):
(1) detect mobile/tablet by user agent plus maxTouchPoints > 1 (iPadOS reports as Mac), not standalone (display-mode standalone or navigator.standalone) -> full-screen install screen before login/sign-up; Android captures beforeinstallprompt early and offers "Instalar"; iOS gets a step-by-step coach mark; in-app browsers get "Abrir no Safari/Chrome" instructions; "continuar no navegador" ONLY for unsupported cases (in-app browsers, iOS < 16.4), otherwise hard; desktop never gated.
(2) confirmation / recovery links opened in a browser show an "E-mail confirmado, abra o app pelo ícone" style screen.
(3) in standalone, on first open, ask notification permission from a button, no re-nag after a denial, localStorage with try/catch, reuse the existing push code.
(4) pt-BR through the existing next-intl catalog; Vitest unit tests for the pure detection; Next 16 conventions (proxy.ts, async params, client gate, nothing gated on the server, no flash).

Purpose: a tenant's members must run the installed app (PWA-01 standalone, PWA-02/NOTIF-03 push only works for installed apps on iOS), so the browser tab stops being a way to use the product on a phone.

Output: pure detection module + tests, a captured install prompt module + tests, a link-return marker module + tests, the InstallGate client component + tests, the pt-BR catalog file, root layout / CSS / env wiring behind an INSTALL_GATE flag, the confirm route marker, and a FirstOpenAsk sheet built on the existing push flow.

Design decisions made at planning time (from reading the live code, not assumed):
- WHAT ALREADY EXISTS (reuse audit). `components/pwa/InstallHint.tsx` is an iOS-only coach mark opened from the push flow (exports `isStandalone`, `WindowLike`, `isIosSafari`); `lib/push.ts` owns the whole subscribe flow (`pushSupport`, `readPushState`, `enablePush` whose first await is the permission prompt, `syncPushOnOpen`, `disablePush`, `isIosLike` which already encodes "Macintosh with maxTouchPoints > 1 is iPadOS"); `components/push/PushControls.tsx` holds `SoftAsk` (the /notificacoes card, its own dismissal key `rede_push_softask_dismissed`) and `PushSettingRow`, over the private hooks `usePushDevice` and `useEnable`; `LiveShell` re-saves the subscription on every open; the BFF route `/api/push/subscriptions` and the API push module persist it. The existing doc comments in InstallHint.tsx and ServiceWorkerRegister.tsx state that no Android install-prompt listener exists; that stops being true here and those two comments are updated. NOTHING of the push flow is rewritten: the new ask exports the two hooks and reuses them, and standalone detection and the iPadOS rule are imported, not copied.
- THE GATE IS A CLIENT WRAPPER IN THE ROOT LAYOUT, SERVER-NEUTRAL. The first server HTML and the first client render are the same: the app's children inside a fragment (the same element position in every state, so going from pending to open never remounts them). Only after mount does it read userAgent, maxTouchPoints and the standalone check, and only then may it swap the children for the gate screen. Children are server-rendered either way, so the desktop and standalone first paint is untouched.
- NO FLASH WITHOUT BLANKING DESKTOP. A device is only unknown until hydration, so the root layout writes `data-install-gate="pending"` on `<html>` (only when the gate is enabled) and globals.css hides `body` under `@media (display-mode: browser) and (pointer: coarse)` while that value stands. Phones and tablets (coarse primary pointer, browser mode) never paint the app before the decision; desktop and standalone are never hidden. The component then rewrites the attribute to `open` or `gated` (the same pattern ServiceWorkerRegister uses for `data-display-mode`, and the html element already carries suppressHydrationWarning). A CSS animation reveals the body after 4 s no matter what, so a hydration failure cannot leave a blank phone.
- THE KILL SWITCH. The 48 Playwright spec files run the iPhone 14 and Pixel 7 device presets (and the desktop one) outside standalone; with the gate on they would all land on the install screen. `INSTALL_GATE` (server env `on | off`) is added to lib/env.ts: default `on` in a production build (Vercel production and preview, homolog, `next start` in the PWA suite), default `off` under `next dev` (so DevTools device emulation and a hand-started dev server used by the e2e keep working), `playwright.config.ts` sets `process.env.INSTALL_GATE ??= 'off'` the way it already does for CSP_MODE (every spawned webServer inherits it; an exported value wins). To try the gate locally, set INSTALL_GATE=on. The gate is covered by unit and component tests instead of a Playwright spec (Chromium cannot emulate display-mode standalone, see pwa.spec.ts, and one server cannot flip the flag per spec).
- CONFIRM / RECOVERY LINKS, AND WHY THE FORMS ARE EXEMPT. `/auth/confirm` is a route handler that exchanges the one-time token and redirects to `next` (`/inicio` for sign-up, `/redefinir-senha` for recovery, `/aceitar-convite` for an invite). The browser that clicked the mail link is not the installed app, and an iOS home-screen app has its own cookie jar, so the session that `verifyOtp` just created is only usable in THAT browser. The route therefore also writes a small marker cookie on success (value `signup`, `recovery` or `invite`, chosen from the OTP type and `next`; HttpOnly, SameSite=Lax, 10 minutes, no Domain so it stays on the origin that served the link). The root layout reads it (it already reads cookies, so the layout is already dynamic) and passes it to the gate. Sign-up confirmation is finished in the browser, so the gate shows "E-mail confirmado" and tells the member to open the app. Recovery and invite are NOT finished: the password form must still run in this browser, so the gate lets `/redefinir-senha` (marker recovery) and `/aceitar-convite` (marker invite) through while the matching marker stands, and shows the "Tudo certo por aqui" screen on any other path (which is where the form's own redirect to /inicio lands). Without this exemption a phone user could never finish a password reset, and the literal reading of the request ("show the confirmed screen for recovery links too") would break a core flow. The recovery and invite copy is hedged ("Se você acabou de ...") because the screen also shows if the form was abandoned. The marker only changes which screen a gated device shows; it authorizes nothing.
- THE "AINDA NÃO INSTALEI" PATH. A member can open a confirmation mail on a phone that never installed the app (signed up on a desktop, or inside an in-app browser). The link-return screen therefore carries a secondary button that swaps to the normal install screen for the device.
- ESCAPE HATCH SCOPE. `canContinue` is computed by the decision (true only for in-app browsers and iOS below 16.4), the button renders only when it is true, and the stored flag is honored only when it is true. The flag lives in sessionStorage (a new browser session asks again), read and written with try/catch.
- NOTIFICATION ASK RULES. Eligible when: standalone, push state `off` (supported, permission still `default`, not subscribed; `denied` and `on` and `unsupported` never qualify), the VAPID key present (the layout passes it only when the notifications module is on, as it does for LiveShell), and the stored answer absent. Opens after a short delay and only when no other `[aria-modal="true"]` dialog is open (the profile nudge popup rises 500 ms after Início and traps focus; two focus traps at once ping-pong), re-checking each second up to a cap; a skipped open leaves nothing stored, so the next open tries again. The CTA runs the existing `useEnable` -> `enablePush`; `on` and `denied` store their answer and close, `dismissed` and `failed` keep the sheet open (UI-D-255: a closed browser prompt changes nothing), "Agora não", Escape, backdrop and drag-down store `later`. A storage that cannot be read counts as already asked: when the answer cannot be remembered, nagging is worse than silence. The /notificacoes soft-ask card stays as the member's own second chance and is untouched. Copy reuses `notifications.softAsk.*` and `pwa.install.dismiss`; no new strings.
- NO NEW DEPENDENCIES. Nothing is installed; no package legitimacy gate applies.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@apps/web/AGENTS.md
@apps/web/app/layout.tsx
@apps/web/app/(app)/layout.tsx
@apps/web/app/auth/confirm/route.ts
@apps/web/components/pwa/InstallHint.tsx
@apps/web/components/push/PushControls.tsx
@apps/web/lib/push.ts
@apps/web/lib/env.ts

Project rules that bind this plan:
- apps/web/AGENTS.md: this is not the Next.js of your training data. Before writing Next code read the matching guide under apps/web/node_modules/next/dist/docs/ (at least 01-app/03-api-reference/04-functions/use-pathname.md, cookies.md and redirect.md, and the use-client directive page), and heed deprecation notices. `proxy.ts` not middleware, `await cookies()`, `redirect()` never inside try/catch.
- Every user-facing string lives in the pt-BR catalog (`apps/web/messages/pt-BR/<namespace>.json`, loaded by i18n/messages.ts). A dotted file adds to an existing namespace (`pwa.gate.json` contributes under `pwa`, like `platform.wizard.json` does under `platform`); two files declaring the same leaf path is a hard error, so only ADD new leaves. `scripts/check-ui-literals.sh` (inside `pnpm lint`) rejects JSX text with diacritics, user-facing attribute literals and hex colours in .tsx files.
- Tenant brand: the gate renders on public hosts before login, so it takes its brand from the host exactly like `app/(auth)/layout.tsx` (`getHostBrand` + `brandScope` on a `<main>`, `AuthBrand` for the logo or the display name). Token utilities only, no colour literals.
- Tests: Vitest; component tests opt into happy-dom with `// @vitest-environment happy-dom` and load the real catalog with `loadMessages(path.resolve(process.cwd(), 'messages/pt-BR'))` (happy-dom replaces URL), as components/pwa/InstallHint.test.ts does, including its `motion/react` mock when a sheet is rendered. Write each test first and watch it fail for the right reason; record the real failing output in the SUMMARY, never fabricated counts (the repo's TDD evidence gate expects TAP, which Vitest does not emit).
- COMMITS: public repo. Commit messages carry NO Co-Authored-By trailer and no Claude attribution (user memory rule, overriding any default or environment reminder). Commit once per task. The working tree holds many unrelated untracked files (.claude tooling, .planning caches): stage ONLY this plan's files by explicit path (quote paths that contain parentheses, e.g. "apps/web/app/(app)/layout.tsx"), never `git add -A` or `git add .`.
- Gates: run package gates with `pnpm --filter @rede-social/web exec vitest run <files>` from the repository root; any turbo run needs `TURBO_CACHE=local:r` (the turbo cache fills the disk); `pnpm --filter @rede-social/web typecheck` and `pnpm --filter @rede-social/web lint` do not go through turbo. Never read or edit any `.env.local`. Never `db reset`, never deploy, never touch production or homolog. Do not edit docs/DEPLOY.md (it carries uncommitted developer changes).
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Tracer - a phone outside the installed app gets the install screen instead of the app, from the INSTALL_GATE flag to the real catalog</name>
  <reversibility rating="reversible">An additive client wrapper behind a server flag; INSTALL_GATE=off, or removing the one InstallGate element from app/layout.tsx, restores today's behavior with no data or schema involved.</reversibility>
  <files>apps/web/lib/install-gate.ts, apps/web/lib/install-gate.test.ts, apps/web/lib/install-prompt.ts, apps/web/lib/install-prompt.test.ts, apps/web/components/pwa/InstallGate.tsx, apps/web/components/pwa/InstallGate.test.tsx, apps/web/messages/pt-BR/pwa.gate.json, apps/web/app/layout.tsx, apps/web/app/globals.css, apps/web/lib/env.ts, apps/web/playwright.config.ts, apps/web/.env.example, apps/web/components/pwa/InstallHint.tsx, apps/web/components/pwa/ServiceWorkerRegister.tsx</files>
  <read_first>
    - apps/web/AGENTS.md and the Next 16 guides it points to (use-pathname.md, use-client.md), before any Next code
    - apps/web/components/pwa/InstallHint.tsx (isStandalone, WindowLike, the header doc comment that says there is no Android install-prompt listener) and apps/web/components/pwa/InstallHint.test.ts lines 1-100 (the motion mock, the loadMessages-from-cwd catalog load, the typed Provider and createElement workarounds)
    - apps/web/lib/push.ts lines 60-100 (PushWindowLike, isIosLike, pushSupport) and apps/web/lib/push.test.ts lines 1-60 (the plain-object window helper and the UA constants to reuse in spirit)
    - apps/web/app/layout.tsx (all of it: generateMetadata, generateViewport, RootLayout, the provider and OfflineBanner order), apps/web/app/(auth)/layout.tsx and apps/web/app/(auth)/AuthBrand.tsx (the brand block to mirror), apps/web/lib/brand-scope.ts and lib/host-brand.ts (the HostBrand shape: tenant, branding.logoUrl, displayName)
    - apps/web/lib/env.ts, apps/web/playwright.config.ts lines 40-60 (the CSP_MODE block to mirror) and apps/web/.env.example
    - apps/web/messages/pt-BR/pwa.json and platform.wizard.json (dotted-file convention) and apps/web/i18n/messages.ts header comment (merge rules)
    - apps/web/app/globals.css lines 1-20, apps/web/components/pwa/ServiceWorkerRegister.tsx (the data-display-mode precedent and its doc comment)
  </read_first>
  <behavior>
    - install-gate.test.ts runs under happy-dom (it imports isIosLike from lib/push, whose import chain pulls UI modules) and uses plain env objects, never the real window.
    - detectPlatform: iPhone Safari, iPhone Chrome (CriOS), classic iPad user agent -> ios; a Macintosh user agent with maxTouchPoints 5 (iPadOS) -> ios; the same Macintosh user agent with maxTouchPoints 0 (a Mac) -> desktop; Android phone Chrome, Samsung Internet, an Android tablet user agent without the Mobile token -> android; Windows Chrome and Windows with maxTouchPoints 10 (touch laptop), Linux, CrOS -> desktop; an empty user agent -> desktop.
    - isInAppBrowser true for: Instagram on iOS, Facebook on Android (FBAN/FBAV and FB_IAB), TikTok, LinkedInApp, Snapchat, Line, MicroMessenger, Pinterest, Twitter, the Google app (GSA/), an Android WebView (the `; wv)` token), and an iOS user agent with no Safari token (a WKWebView). False for iPhone Safari, iPhone Chrome, iPhone Firefox, Android Chrome, Samsung Internet, a Mac Safari and a Windows Chrome.
    - iosVersion: iPhone `CPU iPhone OS 17_0` -> 17.0; iPad `CPU OS 16_3` -> 16.3; the iPadOS Macintosh user agent with `Version/16.4` -> 16.4; Android, a Mac without a Version token and garbage -> null. iosBelow(ua, 16, 4): 16.3 true, 16.4 false, 17.0 false, unknown (null) false.
    - decideInstallGate: Windows -> not gated; iPhone Safari 17 not standalone -> screen ios, canContinue false; iPhone Safari with standalone true -> not gated, including the iOS home-screen user agent that has no Safari token (standalone is evaluated BEFORE the in-app rule); iPadOS (Macintosh, touch 5, Version/17.0) -> ios, canContinue false; iPhone with `CPU iPhone OS 16_3` -> ios, canContinue true; Instagram on iPhone -> in-app, canContinue true; Android WebView -> in-app; Android Chrome -> android, canContinue false; a Mac with touch 0 -> not gated; Android standalone -> not gated.
    - Skip helpers: writeGateSkipped then readGateSkipped is true; a sessionStorage whose getItem throws reads false; one whose setItem throws makes writeGateSkipped return normally.
    - install-prompt.test.ts: each case isolates module state with vi.resetModules and a dynamic import. With no event the state is none and promptInstall answers unavailable. After window dispatches a beforeinstallprompt event (carrying prompt and userChoice spies) the state is available and the event's defaultPrevented is true (captured at import time, before any call). promptInstall calls prompt exactly once, answers the userChoice outcome (accepted or dismissed), and the event is single-use (the state is none again right after a dismissed answer; installed after an accepted one). appinstalled moves the state to installed. subscribeInstallPrompt notifies on every change and its returned function unsubscribes.
    - InstallGate.test.tsx (happy-dom, real catalog, next/navigation mocked for usePathname, a setDevice helper that stubs navigator.userAgent, navigator.maxTouchPoints and window.matchMedia, sessionStorage cleared after each case): (1) enabled=false on an iPhone user agent renders the child and writes no data-install-gate on html; (2) iPhone Safari outside standalone renders the h1 "Instale o app para continuar", the tenant name in the lead, the three iOS steps, no "Continuar no navegador", does NOT render the child, and html data-install-gate is gated; (3) the iPadOS Macintosh user agent with touch 5 renders the same iOS gate; (4) standalone iPhone renders the child and html is open; (5) a desktop user agent renders the child; (6) iOS 16.3 renders the gate WITH "Continuar no navegador", clicking it renders the child and writes the skip flag, and a fresh render with the flag present renders the child; (7) the Instagram in-app user agent renders the in-app screen with "Continuar no navegador", and clicking it renders the child; (8) Android Chrome with no captured prompt renders the manual Android steps, no "Instalar app" button and no "Continuar no navegador"; (9) Android Chrome after a beforeinstallprompt event renders the "Instalar app" button, clicking it calls prompt once, and an appinstalled event then renders "App instalado"; (10) a stale skip flag in sessionStorage does NOT open the gate for iPhone Safari 17 or Android Chrome; (11) react-dom/server renderToString of the enabled gate contains the child's text and not the gate title (the first HTML is the app, so hydration agrees).
  </behavior>
  <action>
    Use the project's Next 16 conventions throughout (see the Next guides in read_first). Tests first, each run red before its implementation (record the real failing output; the failure must be the missing module or the missing behavior, not a typo in the test).

    1. Write install-gate.test.ts, install-prompt.test.ts and InstallGate.test.tsx exactly per the behavior list. Run them and confirm they fail because the modules do not exist yet.

    2. Create apps/web/lib/install-gate.ts. No React, no DOM access at import time, no server-only imports; it imports `isIosLike` from `@/lib/push` so the iPadOS rule (a Macintosh user agent with more than one touch point) exists in one place. Exports, with these names: `GateEnv` (userAgent string, maxTouchPoints number, standalone boolean), `GatePlatform` ('ios' | 'android' | 'desktop'), `detectPlatform(env)` (iOS-like through isIosLike, else Android when the user agent contains Android, else desktop), `isInAppBrowser(userAgent)` (a documented token list covering the cases in the behavior list, plus the generic iOS rule: an iOS user agent without a Safari token is a web view), `iosVersion(userAgent)` (the `CPU (iPhone )?OS x_y` form first, then the `Version/x.y` token that the frozen iPadOS Macintosh user agent still carries; null when neither exists), `MIN_IOS_FOR_INSTALL` (16.4, the first iOS where a home-screen web app can receive Web Push), `iosBelow(userAgent, major, minor)` (unknown version is false, so the hatch never opens on a guess), `GateDecision`, `decideInstallGate(env)`, `GATE_SKIP_KEY` ('rede_install_gate_skip'), `readGateSkipped()` and `writeGateSkipped()` (sessionStorage, every access in try/catch; a throwing store reads false and never throws on write). `GateDecision` is a union: not gated; screen 'ios' with canContinue (true only when iosBelow MIN_IOS_FOR_INSTALL); screen 'android' with canContinue false; screen 'in-app' with canContinue true. Rule order inside decideInstallGate: desktop -> not gated; standalone -> not gated; in-app browser -> 'in-app'; iOS -> 'ios'; Android -> 'android'. The header doc comment states why standalone precedes the in-app rule (a home-screen app's user agent has no Safari token), the limits of user-agent sniffing (SFSafariViewController and Custom Tabs look like the real browser and are treated as it) and that this is a UX policy, not an authorization boundary.

    3. Create apps/web/lib/install-prompt.ts. Module scope: when `window` exists, register two listeners on it exactly once at import: `beforeinstallprompt` (call preventDefault so the browser's own mini-infobar stays out of the way, keep the event, notify) and `appinstalled` (drop the event, mark installed, notify). Exports: `InstallPromptState` ('none' | 'available' | 'installed'), `getInstallPromptState()` (a stable primitive snapshot for useSyncExternalStore), `subscribeInstallPrompt(listener)` (returns the unsubscribe), and `promptInstall()` returning 'accepted' | 'dismissed' | 'unavailable'. promptInstall is called straight from a click handler, so its first action on the stored event is calling prompt(): nothing is awaited before it (the browser requires the user gesture). It then consumes the event (single use), awaits userChoice, and marks installed on an accepted outcome. Doc comment: the event can fire only once per page load and only after the browser decides the app is installable, so the listener has to exist as early as the root layout's client chunk; a tab where the app is already installed never receives the event, which is why the Android screen also has manual steps.

    4. Create apps/web/messages/pt-BR/pwa.gate.json with the single root key `pwa` and one nested `gate` object (the loader's rule: root key equals the filename segment before the first dot). Leaves, all new (no collision with pwa.install.* or pwa.offline.*): title "Instale o app para continuar"; lead "{tenant} funciona como um aplicativo. Instale no seu aparelho e abra pelo ícone para entrar."; already "Já instalou? Abra o app pelo ícone na tela inicial."; install "Instalar app"; installing "Abrindo a instalação..."; installed.title "App instalado"; installed.body "Agora abra {tenant} pelo ícone na tela inicial do seu aparelho."; ios.stepsLabel "Como instalar no iPhone ou iPad"; ios.step1 "Toque no botão Compartilhar do navegador."; ios.step2 "Role a lista e toque em “Adicionar à Tela de Início”."; ios.step3 "Toque em Adicionar e abra o app pelo novo ícone."; ios.old "Este iPhone ou iPad tem um iOS anterior ao 16.4 e não instala o app com notificações. Atualize o iOS ou continue no navegador."; android.stepsLabel "Como instalar no Android"; android.step1 "Abra o menu do navegador (três pontinhos)."; android.step2 "Toque em “Instalar app” ou “Adicionar à tela inicial”."; android.step3 "Abra o app pelo novo ícone."; inApp.title "Abra no navegador para instalar"; inApp.body "Este navegador embutido não consegue instalar o app."; inApp.stepsLabel "Como abrir no navegador"; inApp.step1 "Toque no menu do canto da tela (três pontinhos ou o ícone de compartilhar)."; inApp.step2 "Escolha “Abrir no Safari” ou “Abrir no Chrome”."; inApp.step3 "No navegador, siga as instruções para instalar o app."; continue "Continuar no navegador".

    5. Create apps/web/components/pwa/InstallGate.tsx ('use client'). Props: enabled (boolean), brand ({ displayName, logoUrl: string | null }), brandStyle (Record<string, string>), brandAttributes (the AppBrandAttributes type from `@/lib/bg-tone`, type import only), children. Behavior: `env` state starts null; one mount effect reads `navigator.userAgent`, `navigator.maxTouchPoints ?? 0` and `isStandalone(window as WindowLike)` imported from `./InstallHint` (reuse, never re-implement) and `readGateSkipped()`, and stores them. The decision is DERIVED in render (`decideInstallGate(env)` once env is known), so a later pathname or prop change never needs an effect. The gate blocks when the decision is gated and not (canContinue and skipped). When `enabled` is false, env is still null, or nothing blocks, render exactly `<>{children}</>` (the same fragment position in every state so React never remounts the app when the state changes from pending to open). A second effect, only when enabled and env is known, sets `document.documentElement.dataset.installGate` to 'gated' or 'open'. The gate screen is a `<main {...brandAttributes} style={brandStyle}>` with `min-h-[var(--screen-h)]`, centred column, `bg-bg text-text`, token utilities only; first the brand block using `AuthBrand` from `@/app/(auth)/AuthBrand` (the logo exactly as the login page shows it, or the display name), then `<h1>` and the lead (`pwa.gate.title`, `pwa.gate.lead` with the tenant name) for the ios and android screens, or `pwa.gate.inApp.title` and `pwa.gate.inApp.body` for the in-app screen; an ordered list with an accessible name (`stepsLabel`) of three numbered steps with decorative lucide icons (Share and SquarePlus for iOS, EllipsisVertical and Download for Android) marked aria-hidden; the iOS screen adds the `ios.old` notice only when canContinue; the Android screen shows, from `useSyncExternalStore(subscribeInstallPrompt, getInstallPromptState, () => 'none')`, a full-width brand `Button` "Instalar app" (loading state while `promptInstall()` is pending) when the state is 'available', the three manual steps when it is 'none', and a `role="status"` installed message (`installed.title` and `installed.body`) when it is 'installed'; ios and android also show the `already` line; "Continuar no navegador" is a ghost `Button` rendered ONLY when the decision's canContinue is true, and its handler calls writeGateSkipped and sets the skipped state. No raw HTML injection, no hard-coded copy, every string through useTranslations('pwa') with keys under `gate.`. Doc comment: why the first render is neutral (hydration), how the pending attribute and the CSS rule avoid a flash, what the escape hatch covers and why a stored flag cannot open a hard gate, and that the app's children are not mounted while the gate shows.

    6. Wiring. (a) apps/web/lib/env.ts: add server var `INSTALL_GATE` as an enum of 'on' and 'off' whose default is 'on' when `process.env.NODE_ENV` is 'production' and 'off' otherwise, add it to runtimeEnv, and extend the header doc comment (what it switches, why the dev default is off, that the Playwright harness sets it off). (b) apps/web/app/layout.tsx: `const gateEnabled = env.INSTALL_GATE === 'on'`; only when enabled, await `getHostBrand()` and compute `brandScope(brand.branding)`; the brand for the gate is `brand.tenant?.displayName ?? NEUTRAL_DISPLAY_NAME` with `brand.tenant ? brand.branding.logoUrl : null` (mirror of the auth layout); put `data-install-gate="pending"` on `<html>` only when enabled (spread a conditional object so the attribute is absent otherwise); inside NextIntlClientProvider keep OfflineBanner where it is and wrap `{children}` in `<InstallGate ...>`; extend the layout's doc comment. (c) apps/web/app/globals.css after the imports: the rule `@media (display-mode: browser) and (pointer: coarse)` hiding `html[data-install-gate='pending'] body` with `visibility: hidden` and an animation named install-gate-failsafe lasting 1ms after a 4s delay with `forwards` fill, whose single keyframe sets `visibility: visible`; comment it (what, why coarse-pointer only, why the failsafe). (d) apps/web/playwright.config.ts: right after the CSP_MODE assignment add `process.env.INSTALL_GATE ??= 'off'` with a doc comment (every spec drives phone user agents outside standalone, the gate has its own unit and component tests, an exported value wins, a dev server you started yourself keeps its own env, which is off under next dev anyway). (e) apps/web/.env.example: a commented `# INSTALL_GATE=on` entry under the CSP_MODE block explaining default on in production builds, off under next dev, how to try the gate locally, and that the Playwright harness sets it off (if a hook refuses the edit, say so in the SUMMARY and keep the explanation in env.ts only).

    7. Comment-only edits: in InstallHint.tsx replace the sentence that says there is no Android install-prompt listener anywhere in apps/web with one that says the Android event is captured by lib/install-prompt.ts for the install gate and that this sheet still only serves the push flow; in ServiceWorkerRegister.tsx replace the "intentionally NO Android install-prompt listener here" sentence with a pointer to lib/install-prompt.ts (the listener lives in its own module, this component still only registers the worker and mirrors the display mode). No code changes in those two files.

    8. Run the gates in <verify>, then commit task 1 with explicit paths and a message such as: feat(quick-261007-kyp): install gate for phones and tablets outside the installed app. The message carries no co-author trailer of any kind.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/install-gate.test.ts lib/install-prompt.test.ts components/pwa/InstallGate.test.tsx components/pwa/InstallHint.test.ts lib/push.test.ts && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh apps/web</automated>
  </verify>
  <done>An iPhone, iPad (as Mac) or Android user agent outside standalone renders the install screen with real catalog copy and none of the app's children; desktop and standalone render the app untouched; the first server HTML contains the app and not the gate (renderToString case); Android's Instalar app button calls the captured prompt once and an appinstalled event shows the installed state; Continuar no navegador exists only for in-app browsers and iOS below 16.4 and a stale flag cannot open the hard gate; INSTALL_GATE exists in env.ts (default on in production builds, off under next dev) and the Playwright config sets it off; html carries data-install-gate=pending only when enabled and the component rewrites it to open or gated; the two stale doc comments are corrected; typecheck, Biome and the UI-literal check are green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Confirmation and recovery links opened in a browser land on "E-mail confirmado, abra o app pelo ícone"</name>
  <reversibility rating="reversible">One extra cookie on a successful link exchange plus one more branch in the gate component; removing the cookie write and the linkReturn prop restores the Task 1 behavior, and a stray cookie expires in 10 minutes.</reversibility>
  <files>apps/web/lib/link-return.ts, apps/web/lib/link-return.test.ts, apps/web/app/auth/confirm/route.ts, apps/web/app/auth/confirm/route.test.ts, apps/web/components/pwa/InstallGate.tsx, apps/web/components/pwa/InstallGate.test.tsx, apps/web/messages/pt-BR/pwa.gate.json, apps/web/app/layout.tsx</files>
  <read_first>
    - apps/web/app/auth/confirm/route.ts (all of it: sameOriginPath, OTP_TYPES, the success branch, the three failure redirects) and apps/web/app/auth/confirm/route.test.ts (the verifyOtp mock, the throwing redirect stub, the destination helper)
    - apps/web/lib/pending-confirmation.ts (the cookie module precedent: constants, strict decoder, options built from sessionCookieOptions) and apps/web/lib/supabase/cookie-options.ts
    - apps/web/app/(auth)/redefinir-senha/actions.ts and apps/web/app/(auth)/aceitar-convite/actions.ts header (both end with redirect('/inicio'), which is why the screen must show on that path)
    - apps/web/components/pwa/InstallGate.tsx and its test as left by Task 1; apps/web/app/layout.tsx as left by Task 1
    - the Next guides cookies.md and redirect.md under apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
  </read_first>
  <behavior>
    - link-return.test.ts (node environment; the module imports nothing from push or UI): linkReturnFor('signup', '/inicio') is signup; ('email', '/inicio') is signup; ('recovery', '/redefinir-senha') is recovery; ('recovery', '/aceitar-convite') is invite (the invite mail's recovery-type fallback, same rule as the route's failure branch); ('invite', '/aceitar-convite?x=1') and ('invite', '/inicio') are invite; ('magiclink', '/inicio'), ('', '/inicio') and an unknown type are null; a next that merely starts with /aceitar-convite but is another path (/aceitar-convite-x) is not an invite. parseLinkReturn accepts exactly signup, recovery and invite and answers null for undefined, an empty string, different casing, surrounding spaces and any other or over-long value. linkReturnScreen(null, anyPath) is null; signup shows on every path; recovery passes on /redefinir-senha and /redefinir-senha/anything but shows on /inicio and on /aceitar-convite and on /redefinir-senhax; invite passes on /aceitar-convite and shows on /redefinir-senha and /inicio. The cookie options are HttpOnly, SameSite lax, path /, maxAge 600, with no domain.
    - route.test.ts: add a `next/headers` mock whose cookies() returns an object with a hoisted `set` spy (the success branch now writes a cookie). A successful signup exchange sets cookie link_return = signup with the options above, and still lands on /inicio; recovery with next=/redefinir-senha sets recovery; type=recovery with next=/aceitar-convite sets invite and type=invite sets invite; every failed exchange (all four existing failure cases) never calls set; a missing token_hash or an unknown type never calls set. The five existing destination assertions keep passing unchanged.
    - InstallGate.test.tsx additions (the same harness as Task 1, plus a linkReturn prop): (1) linkReturn=signup on iPhone Safari outside standalone renders the title "E-mail confirmado" with the tenant name and the "Abra o app pelo ícone" body, not the install steps and not the child; (2) clicking "Ainda não instalei o app" then renders the iOS install steps; (3) linkReturn=signup on the Instagram in-app user agent renders the confirmed screen first (the marker outranks the in-app instructions), and the button then reveals the in-app instructions; (4) linkReturn=recovery with pathname /redefinir-senha renders the child (the form must run in this browser) and html is open; (5) linkReturn=recovery with pathname /inicio renders "Tudo certo por aqui" with the hedged body; (6) linkReturn=invite with pathname /aceitar-convite renders the child, and with /redefinir-senha renders the "Tudo certo por aqui" screen; (7) a marker with standalone true renders the child; (8) a marker on a desktop user agent renders the child; (9) linkReturn=null changes nothing from Task 1.
  </behavior>
  <action>
    Tests first, each run red before its implementation (record the real failing output).

    1. Write link-return.test.ts, the new cases in route.test.ts and the new cases in InstallGate.test.tsx per the behavior list; run them and confirm they fail for the right reason (missing module, missing cookie write, missing prop).

    2. Create apps/web/lib/link-return.ts: server and client safe, so it imports nothing but `sessionCookieOptions` from `@/lib/supabase/cookie-options` (never lib/push, never a UI package; the route handler and the root layout import it, and a 'use client' module graph must not leak into a route handler). Exports: `LINK_RETURN_COOKIE` ('link_return'), `LINK_RETURN_MAX_AGE_S` (600), `LinkReturn` ('signup' | 'recovery' | 'invite'), `linkReturnCookieOptions` (sessionCookieOptions with maxAge 600, no domain), `linkReturnFor(type, safeNext)` (invite when type is invite or the path of safeNext before any query is exactly /aceitar-convite, checked first; then recovery for type recovery; then signup for types signup and email; null otherwise), `parseLinkReturn(raw)` (strict allow-list, never echoes unknown input), and `linkReturnScreen(marker, pathname)` returning 'show' | 'pass' | null per the behavior list (pass only when the marker's own form path matches: recovery -> /redefinir-senha, invite -> /aceitar-convite, exact path or a path under it). Doc comment: what the marker is for, why the forms are exempt (the one-time session exists only in the browser that opened the link, an iOS home-screen app has its own cookie jar), why HttpOnly and host-only, and that forging it only changes which screen a gated device shows and authorizes nothing.

    3. Edit apps/web/app/auth/confirm/route.ts: import `cookies` from next/headers and the link-return exports; in the success branch (after verifyOtp reports no error and before `redirect(safeNext)`) compute `linkReturnFor(type, safeNext)` and, when it is not null, `(await cookies()).set(LINK_RETURN_COOKIE, value, linkReturnCookieOptions)`. The failure branches, the open-redirect guard, the OTP type allow-list and the redirect-outside-try rule stay exactly as they are. Add a paragraph to the handler's doc comment describing the marker. lib/route-handlers.inventory.ts stays as is (the handler still calls no API route).

    4. Extend apps/web/messages/pt-BR/pwa.gate.json (add the `linkReturn` object under `gate`; do not touch existing leaves): linkReturn.signup.title "E-mail confirmado"; linkReturn.signup.body "Sua conta em {tenant} está pronta. Abra o app pelo ícone na tela inicial do seu aparelho e entre com seu e-mail e senha."; linkReturn.recovery.title "Tudo certo por aqui"; linkReturn.recovery.body "Se você acabou de redefinir a senha, abra o app de {tenant} pelo ícone na tela inicial e entre com a nova senha."; linkReturn.invite.title "Tudo certo por aqui"; linkReturn.invite.body "Se você acabou de aceitar o convite, abra o app de {tenant} pelo ícone na tela inicial e entre com seu e-mail e senha."; linkReturn.notInstalled "Ainda não instalei o app".

    5. Edit apps/web/components/pwa/InstallGate.tsx: add the prop `linkReturn: LinkReturn | null` (type import from `@/lib/link-return`), read `usePathname()` from next/navigation, and add a `showInstall` state. Precedence, evaluated in render and only after `env` is known: not gated by the device decision -> children; gated and `linkReturnScreen(linkReturn, pathname)` is 'pass' -> children; gated and it is 'show' and the member has not pressed "Ainda não instalei o app" -> the link-return screen (same brand block and main wrapper as the install screens; title and body from `linkReturn.<marker>.*` with the tenant name; the instruction to open the app from its icon; the secondary ghost button `linkReturn.notInstalled`, which sets showInstall); otherwise the Task 1 install screen logic unchanged, including the escape hatch rules. The data-install-gate attribute follows the same blocked / not blocked result (pass counts as open). Keep the fragment-position rule for the children.

    6. Edit apps/web/app/layout.tsx: read the cookie through the cookies() call the layout already awaits, `parseLinkReturn(cookieStore.get(LINK_RETURN_COOKIE)?.value)`, and pass it as the `linkReturn` prop (null when the gate is disabled). Extend the layout doc comment by one sentence.

    7. Run the gates in <verify>, then commit task 2 with explicit paths and a message such as: feat(quick-261007-kyp): confirmation and recovery links land on an open-the-app screen in a mobile browser. The message carries no co-author trailer of any kind.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/link-return.test.ts app/auth/confirm/route.test.ts components/pwa/InstallGate.test.tsx lib/install-gate.test.ts lib/route-handlers.inventory.test.ts && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh apps/web</automated>
  </verify>
  <done>A successful /auth/confirm exchange writes the allow-listed 10-minute marker and still redirects exactly where it did; failed exchanges write nothing; on a mobile browser outside standalone a signup link lands on "E-mail confirmado" with a working "Ainda não instalei o app" path to the install screen, recovery and invite forms still render in that browser while their marker stands and show the hedged screen on any other path, the marker outranks the in-app instructions, and it changes nothing on desktop or in standalone; the route handler inventory test still passes; typecheck, Biome and the UI-literal check are green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: The installed app asks for notifications once, from a button, on its first open, through the existing push flow</name>
  <reversibility rating="reversible">One new client component mounted in the tenant shell, two hooks exported from PushControls and four small helpers added to lib/push.ts; removing the mount in app/(app)/layout.tsx restores today's behavior, and the stored answer is a UX flag that authorizes nothing.</reversibility>
  <files>apps/web/lib/push.ts, apps/web/lib/push.test.ts, apps/web/components/push/PushControls.tsx, apps/web/components/push/FirstOpenAsk.tsx, apps/web/components/push/FirstOpenAsk.test.tsx, apps/web/app/(app)/layout.tsx</files>
  <read_first>
    - apps/web/lib/push.ts (the header doc facts 1-5, enablePush, readPushState, readSoftAskDismissed and writeSoftAskDismissed as the storage precedent, the PushState type) and apps/web/lib/push.test.ts (the win() helper, fake subscription helpers, how the gesture rule is asserted)
    - apps/web/components/push/PushControls.tsx (usePushDevice, useEnable, SoftAsk's use of them, the PUSH_REGISTRATION_WAIT_MS timeout) and apps/web/app/(app)/notificacoes/page.tsx lines 60-80 (how SoftAsk receives vapidKey, tenantName, staff)
    - apps/web/app/(app)/layout.tsx (the tenant branch: notificationsOn, LiveShell's vapidPublicKey, AppShell and its children) and packages/core/ui/AppShell.tsx lines 60-140 (AppShell owns the ToastProvider and the [data-brand-root] element that carries the tenant's --brand-* variables, so the sheet must be rendered INSIDE AppShell's children, not beside it)
    - packages/ui/src/overlays/BottomSheet.tsx (props open, onClose, title; renders role dialog with aria-modal and focus trap; z-[55]) and apps/web/components/profile/ProfileNudgeOnArrival.tsx (the 500 ms popup that traps focus on Início)
    - apps/web/components/pwa/InstallHint.test.ts lines 1-100 (the motion/react mock to reuse) and apps/web/e2e/push-fake.ts (how Notification, PushManager and serviceWorker are faked)
    - apps/web/messages/pt-BR/notifications.json softAsk block and pwa.json install.dismiss ("Agora não")
  </read_first>
  <behavior>
    - lib/push.test.ts additions (happy-dom): `PUSH_FIRSTOPEN_ASKED_KEY` is 'rede_push_firstopen_asked'; readFirstOpenAsked is false with nothing stored, true after writeFirstOpenAsked for each of 'later', 'denied' and 'enabled', and TRUE when localStorage.getItem throws (an unreadable store means "do not nag"); writeFirstOpenAsked does not throw when setItem throws. firstOpenAskDue({ standalone, state, asked }) is true only for standalone true, state 'off', asked false; false for every other state ('checking', 'unsupported', 'ios-install', 'on', 'denied'), for standalone false and for asked true. anotherModalOpen answers true when the given root's querySelector for the aria-modal true selector returns an element and false when it returns null.
    - FirstOpenAsk.test.tsx (happy-dom, real catalog, the motion/react mock from InstallHint.test.ts, ToastProvider from @rede-social/ui around the component, fake timers, a fake push environment: window.Notification with permission and a requestPermission spy, window.PushManager, navigator.serviceWorker.ready resolving a registration whose pushManager has getSubscription and subscribe, a fetch stub that answers ok for the subscriptions POST, matchMedia answering standalone): (1) standalone, permission default, nothing stored: after the delay the sheet shows the notifications.softAsk title and the member body with the tenant name, and requestPermission has NOT been called (nothing prompts from an effect); (2) tapping "Ativar notificações" calls requestPermission once, saves the subscription through the BFF POST, stores the answer and closes the sheet; (3) tapping "Agora não" stores the answer and closes, and a fresh mount shows nothing (no re-nag); (4) requestPermission answering denied stores the answer, closes, and a fresh mount shows nothing; (5) permission already denied, or not standalone, or no VAPID key: the sheet never opens; (6) with an element carrying aria-modal true present in the document the sheet waits, and opens within the retry cadence after that element is removed; (7) the staff body is used when staff is true.
  </behavior>
  <action>
    Tests first, each run red before its implementation (record the real failing output).

    1. Write the lib/push.test.ts additions and FirstOpenAsk.test.tsx per the behavior list; run them and confirm they fail for the right reason.

    2. apps/web/lib/push.ts: add and export `PUSH_FIRSTOPEN_ASKED_KEY`, `readFirstOpenAsked()`, `writeFirstOpenAsked(choice)` where choice is 'later' | 'denied' | 'enabled' (the stored value is the choice plus nothing else), `firstOpenAskDue({ standalone, state, asked })` and `anotherModalOpen(root)` (the root only needs a querySelector method; the selector is the aria-modal true attribute selector the kernel already keys on to hide the BottomNav). Same style as readSoftAskDismissed: every storage access in try/catch, and an unreadable store reads as already asked. Extend the file's header doc with a short fact 6 describing the first-open ask and why it is separate from the soft-ask card (different surface, different key, the card remains the member's second chance).

    3. apps/web/components/push/PushControls.tsx: export `usePushDevice` and `useEnable` (add the export keyword, change nothing else) and add one sentence to the file's doc comment saying the first-open ask reuses them.

    4. Create apps/web/components/push/FirstOpenAsk.tsx ('use client'). Props: vapidKey (string), tenantName (string), staff (boolean). It calls `usePushDevice(vapidKey)` and `useEnable(vapidKey, registration)` from './PushControls', reads standalone through `isStandalone(window as WindowLike)` from '../pwa/InstallHint' and the stored answer through readFirstOpenAsked, both in an effect after mount (the server renders nothing). When firstOpenAskDue holds, a timer waits FIRST_OPEN_ASK_DELAY_MS (1500), then checks `anotherModalOpen(document)` every FIRST_OPEN_ASK_RETRY_MS (1000) for at most FIRST_OPEN_ASK_MAX_WAITS (20) attempts and opens the sheet at the first clear check; all timers are cleared on unmount and when eligibility is lost; a gave-up wait stores nothing. Export those three constants for the test. The sheet is `BottomSheet` from @rede-social/ui with `title` = notifications.softAsk.title and body = bodyStaff when staff else bodyMember with the tenant name; a decorative BellRing disc as in SoftAskCard; a full-width brand `Button` (`loading` while busy) labelled notifications.softAsk.cta whose handler sets busy and calls `enable(result => ...)` (nothing is awaited before it: the permission prompt stays the first await of the tap, per lib/push.ts fact 1); on 'on' store 'enabled', on 'denied' store 'denied', in both cases `setState(result)` and close; on 'dismissed' or 'failed' only clear busy and leave the sheet open (the shared hook already toasts the failure); a full-width ghost `Button` labelled pwa.install.dismiss ("Agora não") and the sheet's onClose (Escape, backdrop, drag-down) both store 'later' and close. Translations through useTranslations('notifications.softAsk') and useTranslations('pwa'); no new catalog strings. Doc comment: the eligibility rules, the delay and modal guard (the profile nudge popup also traps focus), that nothing prompts from an effect, and that a stored answer is a UX flag that authorizes nothing.

    5. Edit apps/web/app/(app)/layout.tsx (tenant branch only): compute `const vapidPublicKey = notificationsOn ? (env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null) : null` once, pass it to LiveShell as before, and render `<FirstOpenAsk vapidKey={vapidPublicKey} tenantName={tenant.displayName} staff={bootstrap.permissions.includes('chat.support')} />` only when it is not null, as a child of AppShell next to `{children}` (inside AppShell so it sits under the ToastProvider and the tenant's brand root). The platform branch stays untouched. Use the same `chat.support` permission string the layout already uses for `supportInbox`.

    6. Run the gates in <verify>, then commit task 3 with explicit paths (quote the one with parentheses) and a message such as: feat(quick-261007-kyp): ask for notifications once on the first open of the installed app. The message carries no co-author trailer of any kind.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/push.test.ts components/push/FirstOpenAsk.test.tsx components/pwa/InstallHint.test.ts && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh apps/web</automated>
  </verify>
  <done>In standalone, with the notifications module on, permission still default and no stored answer, the sheet opens after the delay (never while another modal is open), requests permission only from the button tap through enablePush, and stores its answer in every exit path; a denied permission, a stored answer, a non-standalone window, an unreadable store or a missing VAPID key never opens it; the /notificacoes soft-ask card and the Configurações switch behave as before; typecheck, Biome and the UI-literal check are green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> root layout (user agent, touch points, display mode, cookies) | everything the gate reads is client-controlled; it selects a screen and nothing else |
| mail link (browser) -> /auth/confirm -> marker cookie -> root layout | an unauthenticated GET sets a cookie that a later render reads |
| tenant host -> gate brand block | the public by-host answer supplies the logo and display name rendered before login |
| installed app -> push subscription flow | the permission prompt and the subscription POST reuse the existing authenticated BFF route |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-kyp-01 | Spoofing | user-agent and display-mode sniffing in lib/install-gate.ts | low | accept | the gate is a UX policy, not authorization: every API call still authenticates and tenant-scopes the session, so spoofing a user agent or desktop-mode gains no data and no capability; documented in the module header |
| T-kyp-02 | Tampering | link_return marker cookie forged or replayed | low | mitigate | value is parsed against a three-member allow-list (parseLinkReturn) and never echoed; HttpOnly, SameSite=Lax, 10 minutes, no Domain attribute; it can only change which screen a gated device shows or exempt the matching password form, which is already a public, session-gated page; unit tests cover unknown, mixed-case and over-long values and the path-prefix traps |
| T-kyp-03 | Information Disclosure | marker cookie contents and scope | low | mitigate | carries one of three fixed words, no e-mail, token or tenant id; host-only, so one tenant's marker never reaches another origin |
| T-kyp-04 | Tampering | open redirect through /auth/confirm after the change | high | mitigate | the sameOriginPath guard, the OTP type allow-list and the redirect-outside-try rule are untouched; the new code only adds a cookie write before the existing redirect; the five existing destination assertions stay in the test file |
| T-kyp-05 | Denial of Service | gate hides body on phones and could blank the screen if hydration fails | medium | mitigate | CSS-only 4 s failsafe animation reveals the body regardless of JavaScript; the rule applies only to coarse-pointer browser-mode devices while data-install-gate is pending; INSTALL_GATE=off removes it entirely |
| T-kyp-06 | Elevation of Privilege | escape hatch used to skip a hard gate | low | mitigate | canContinue is computed by the pure decision (in-app browsers and iOS below 16.4 only); the button renders only then and the stored flag is honored only then; component test (10) proves a stale flag cannot open the gate for Safari 17 or Android Chrome |
| T-kyp-07 | Tampering | notification prompt abuse / nagging | low | mitigate | the prompt is the first await of a button tap in the existing enablePush; any answer or Agora não is persisted with try/catch, denied permission and an unreadable store never ask; the sheet waits for other modals instead of stacking focus traps |
| T-kyp-08 | Tampering | injected markup in gate copy or brand block | low | mitigate | every string comes from the pt-BR catalog through next-intl; the brand block is the existing AuthBrand (a plain img and text node); no raw HTML injection anywhere; scripts/check-ui-literals.sh enforces catalog use |
| T-kyp-09 | Repudiation | none new: no audit-relevant action is added | low | accept | the gate and the ask change presentation only; sign-in, sign-up and subscription writes keep their existing server-side records |
| T-kyp-10 | Denial of Service | per-request host brand lookup added to the root layout | low | accept | getHostBrand is the same bounded in-memory cached lookup proxy.ts and the auth layout already use; it runs only when the gate is enabled |
</threat_model>

<verification>
After all three tasks (from the repository root; the local Supabase stack and API are NOT needed for items 1-4):
1. `pnpm --filter @rede-social/web exec vitest run` (the whole web unit suite) green. If a test in a file this plan did not touch fails, report it in the SUMMARY as pre-existing (name the file and the assertion) instead of fixing it here; a failure in a file this plan touched must be fixed.
2. `pnpm --filter @rede-social/web typecheck` and `pnpm --filter @rede-social/web lint` green, and `bash scripts/check-ui-literals.sh apps/web` exits 0.
3. `TURBO_CACHE=local:r pnpm turbo boundaries --filter='!@rede-social/boundary-fixture'` green (no new cross-package import was introduced; the gate imports only from @rede-social/ui, next, next-intl, lucide-react and apps/web itself).
4. Negative greps, filtered so comments cannot satisfy or break them: `grep -n 'dangerouslySetInnerHTML' apps/web/components/pwa/InstallGate.tsx apps/web/components/push/FirstOpenAsk.tsx` prints nothing; `grep -n 'requestPermission' apps/web/components/push/FirstOpenAsk.tsx | grep -v -E '^[0-9]+:\s*(//|\*|/\*)'` prints nothing (the prompt exists only in lib/push.ts enablePush); `test "$(git log -3 --format=%B | grep -ci 'co-authored-by')" = 0` succeeds.
5. Real-browser spot check, only if the local Supabase stack is already running (otherwise report it as not run, and never start, reset or reseed anything): the Playwright config now sets INSTALL_GATE=off for the servers it spawns, so run `SEED_PASSWORD=Segredo123 pnpm --filter @rede-social/web exec playwright test login.spec.ts --project=mobile-chromium` and confirm it still reaches and submits the login form (proves the iPhone 14 preset is not gated by the harness). If a dev server on port 3000 was already running, it keeps its own environment (off under next dev), which gives the same result. A hand check of the gate itself needs INSTALL_GATE=on in the shell that starts `pnpm dev` and Chrome DevTools device emulation (iPhone and Pixel presets, plus an iPad with "Request desktop site"); that check is recorded as a human-check, not automated, because Chromium cannot emulate display-mode standalone.
6. `git diff --cached --name-only` is empty, `git status --short` still lists the unrelated untracked files that existed before this plan, and `git log -3 --format=%B` carries no Co-Authored-By trailer.
Not run, by design: the full `pnpm verify` (its e2e stage already fails on pre-existing spec drift per STATE.md), the production-build PWA suite, any deploy, `db reset`, `supabase db push`, and any real-device install test (phones cannot reach *.localhost; the real-device pass is a developer step after the next homolog release).
</verification>

<success_criteria>
- A phone or tablet running the site in a browser tab (not the installed app) cannot reach login, sign-up or any other page: it gets a branded, pt-BR install screen (iOS steps, Android Instalar button with early-captured prompt, in-app Abrir no Safari/Chrome instructions); the escape hatch appears only for in-app browsers and iOS below 16.4; desktop and the installed app are never touched.
- The app never flashes before the decision on phones, desktop first paint is unchanged, hydration agrees (the first HTML is the app), and a failed hydration cannot blank the screen.
- Confirmation and recovery links opened in a mobile browser end on an "abra o app pelo ícone" screen, with a path to install instructions, while the recovery and invite password forms still work in that browser.
- The installed app asks for notification permission once, from a button, through the existing push flow, never re-asks after any answer, and never stacks on another modal.
- INSTALL_GATE keeps every Playwright spec runnable; every string is in the pt-BR catalog; the pure detection is unit-tested; typecheck, Biome and the UI-literal check are green; commits carry no Co-Authored-By trailer.
</success_criteria>

<output>
Create `.planning/quick/261007-kyp-install-gate-pwa-obrigat-rio-em-celular-/261007-kyp-SUMMARY.md` when done.
</output>

## Risks

- Size. Three tasks touch about 24 files (12 of them tests). Task 3 (the notification ask) is independent of Tasks 1-2 and can be shipped alone if the executor runs short of context; do not merge it into Task 2.
- Real devices are the only true proof. Chromium cannot emulate display-mode standalone, phones cannot reach *.localhost, and iOS home-screen storage isolation, the Android prompt event and the iPadOS user agent can only be confirmed on devices after a homolog release. The unit and component tests pin the logic, not the OS behavior; the SUMMARY must list the real-device checks as outstanding.
- Hard gate by request. A member on a phone whose browser can neither install nor is recognised as in-app (a private tab, an unusual browser) has no escape; that is the requested behavior. The install screen therefore always carries the "Já instalou? Abra o app pelo ícone" line, and Android has manual menu steps when no prompt event exists.
- Dead-link pages. A stale confirmation or recovery link opened on a phone browser lands on /verifique-seu-email or /esqueci-senha, which the gate covers with the install screen (no marker is written on a failed exchange); the member opens the installed app and asks for a new mail from there. This follows from the hard gate and is flagged here so it is not mistaken for a bug.
- Android, installed app, link opened in Chrome. Chrome and the WebAPK share cookies, so the marker and the session can also be visible in the installed app for ten minutes; the gate is not applied in standalone, so nothing changes there.
- A developer who starts `next start` or a production build by hand for e2e must export INSTALL_GATE=off (the default there is on); Playwright-spawned servers inherit it from playwright.config.ts. Operators do not need to set anything: the default is on in production builds, and DEPLOY.md is intentionally not edited (mention the optional INSTALL_GATE kill switch in the SUMMARY so it can be added to the deploy notes by hand).
- Gate and CSP. The gate adds no inline script and no inline style beyond the brand custom properties the auth layout already sets, so the enforced Content Security Policy needs no change.

## Coverage audit (quick task, no ROADMAP phase; source = the request text)

| Source item (request) | Covered by |
|---|---|
| Mobile/tablet detection: user agent plus navigator.maxTouchPoints > 1 for iPadOS; not standalone (display-mode or navigator.standalone) | Task 1 (detectPlatform reuses isIosLike; the component supplies isStandalone from InstallHint) |
| Replace the app with a full-screen install screen BEFORE login/signup | Task 1 (InstallGate wraps every route in the root layout; children not mounted while gated) |
| Android: capture beforeinstallprompt early, "Instalar" button calling prompt() | Task 1 (lib/install-prompt.ts module-scope capture; button in the Android screen) |
| iOS: step-by-step Compartilhar -> Adicionar à Tela de Início | Task 1 (iOS screen, three steps) |
| In-app browsers: "Abrir no Safari/Chrome" instructions | Task 1 (isInAppBrowser, in-app screen) |
| Escape hatch only for unsupported cases (in-app, iOS < 16.4); otherwise hard | Task 1 (canContinue from the decision, button and stored flag gated by it, test 10) |
| Desktop never gated | Task 1 (decision rule order, tests for Windows, Mac, touch laptop) |
| Confirmation / recovery links opened in a browser show an "E-mail confirmado, abra o app pelo ícone" style screen; hook into the existing confirm routes | Task 2 (marker written by /auth/confirm, root layout reads it, link-return screen; recovery and invite forms exempt, documented decision) |
| Ask notification permission on first open of the installed app, from a button, standalone only, no re-nag after denial, localStorage with try/catch | Task 3 (FirstOpenAsk, firstOpenAskDue, persisted answer) |
| Check existing push/subscription code and reuse it, do not duplicate | Objective (reuse audit) and Task 3 (usePushDevice and useEnable exported and reused, enablePush untouched, standalone and iPadOS rules imported) |
| All strings pt-BR through the existing next-intl catalog, matching its structure | Task 1 and Task 2 (messages/pt-BR/pwa.gate.json, dotted-file convention), Task 3 (reuses existing keys) |
| Vitest unit tests for the pure detection (platform, standalone, in-app, iOS version, gate decision) over a plain env object | Task 1 (install-gate.test.ts; standalone is the env flag, and isStandalone itself is already pinned by InstallHint.test.ts) |
| Next 16 conventions: proxy.ts not middleware, async params, client gate, nothing gated on the server, no flash of the app | Task 1 (neutral first render, pending attribute plus CSS, renderToString test); no middleware, no new params, no new route |
| Respect existing code conventions (layout, PWA/manifest/serwist setup, existing install prompt) | Context rules, Task 1 (mirrors the auth layout brand block, the ServiceWorkerRegister attribute pattern, the CSP_MODE harness pattern; stale doc comments corrected) |
| Commits: no Claude co-author line | Context rules, Verification items 4 and 6 |
| Not in the request, therefore not planned: a Playwright spec for the gate, manifest or service worker changes, new npm packages, any change to the /notificacoes soft-ask card or the Configurações switch, deploy notes in docs/DEPLOY.md | n/a |
