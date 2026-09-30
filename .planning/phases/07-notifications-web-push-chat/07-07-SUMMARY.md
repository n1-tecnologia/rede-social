---
phase: 07-notifications-web-push-chat
plan: 07
subsystem: notifications
tags: [web-push, service-worker, serwist, pwa, ios, install-hint, badging, logout, D-232, D-233, D-234, D-236, D-239, UI-D-255, UI-D-256, UI-D-257, UI-D-266, UI-D-267]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-06 POST/DELETE /v1/notifications/push-subscriptions, pushSubscriptionInputSchema/pushSubscriptionDeleteSchema (strict), pushPayloadSchema {v:1,…}, push.fake.test allowed under PUSH_TRANSPORT=fake, NEUTRAL_PUSH_ICON; 07-03 LiveShell (setAuth before subscribe); 07-02 sketch 007 (approved 2026-09-30, provisional)"
provides:
  - "apps/web/lib/push-sw.ts: PUSH_FALLBACK, parsePushPayload, isPushPayloadV1 (a zod-free mirror of pushPayloadSchema), resolveClickUrl, mustAlwaysShow, decidePushDisplay, focusOrOpen, subscriptionBody"
  - "app/sw.ts: push, notificationclick and pushsubscriptionchange listeners (one waitUntil each)"
  - "apps/web/lib/push.ts: isIosLike, pushSupport, readPushState, enablePush, disablePush, syncPushOnOpen, urlBase64ToUint8Array, PUSH_SOFTASK_DISMISSED_KEY, pushRegistration(Within), types PushState/PushSupport"
  - "BFF POST/DELETE /api/push/subscriptions (same origin, 4 KiB, session, strict schema, one forward, no-store)"
  - "module UI: SoftAskCard, PushSwitchRow (+ PushRowState)"
  - "web: components/push/PushControls.tsx (SoftAsk, PushSettingRow), components/shell/LogoutForm.tsx, InstallHint variant 'install' | 'push' + onClose"
  - "kernel UI: BeforeLogoutProvider, useBeforeLogout, useLogoutSubmit, runBeforeLogout, BEFORE_LOGOUT_TIMEOUT_MS"
  - "env NEXT_PUBLIC_VAPID_PUBLIC_KEY (web, optional) with a LOCAL-ONLY test public key in apps/web/.env.example, .github/workflows/ci.yml and scripts/local-env.sh"
  - "catalog: notifications.softAsk.*, notifications.push.{switchLabel,state.*,toasts.*,errors.failed}, pwa.install.push.*"
affects: [07-08 chat push (the SW already routes /suporte urls), 07-09 staff inbox (the soft-ask staff body keys on chat.support), 07-11 real-device test plan and DEPLOY.md (Vercel NEXT_PUBLIC_VAPID_PUBLIC_KEY)]

actuals:
  tokens: 31000
  tasks: 3
  commits: 3
plan_head_before: 7f3beaa82c08d8acb3235cfd4dd5d17cf71c853c

tech-stack:
  added: []
  patterns:
    - "Service-worker decisions in a pure, import-free module the worker bundle wraps; the zod contract is mirrored by hand and a unit test pins the mirror against the real schema"
    - "Tap-only permission flow: the registration and the VAPID key are ready before the tap, the prompt is the first await, the BFF save comes last"
    - "Kernel seam for a host cleanup before a kernel-owned server-action form (BeforeLogoutProvider + useLogoutSubmit: prevent, bounded cleanup, requestSubmit once)"
    - "E2E fake push stack via addInitScript (Notification, PushManager, serviceWorker.ready) with state persisted in localStorage, everything after the browser real"

key-files:
  created:
    - apps/web/lib/push-sw.ts
    - apps/web/lib/push-sw.test.ts
    - apps/web/lib/push.ts
    - apps/web/lib/push.test.ts
    - apps/web/app/api/push/subscriptions/route.ts
    - apps/web/app/api/push/subscriptions/route.test.ts
    - apps/web/components/push/PushControls.tsx
    - apps/web/components/shell/LogoutForm.tsx
    - apps/web/e2e/push.spec.ts
    - packages/core/ui/BeforeLogout.tsx
    - packages/core/tests/before-logout.test.tsx
    - packages/modules/notifications/ui/SoftAskCard.tsx
    - packages/modules/notifications/ui/PushSwitchRow.tsx
    - packages/modules/notifications/tests/soft-ask-card.test.tsx
    - packages/modules/notifications/tests/push-switch-row.test.tsx
  modified:
    - apps/web/app/sw.ts
    - apps/web/components/pwa/InstallHint.tsx
    - apps/web/components/pwa/InstallHint.test.ts
    - apps/web/components/shell/LiveShell.tsx
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/(app)/notificacoes/page.tsx
    - apps/web/lib/env.ts
    - apps/web/.env.example
    - apps/web/messages/pt-BR/notifications.json
    - apps/web/messages/pt-BR/pwa.json
    - apps/web/i18n/messages.test.ts
    - packages/core/ui/DesktopRail.tsx
    - packages/core/ui/index.ts
    - packages/modules/notifications/ui/index.ts
    - .github/workflows/ci.yml
    - scripts/local-env.sh

key-decisions:
  - "The service worker imports no zod: isPushPayloadV1 mirrors the strict pushPayloadSchema by hand (the zod import made the worker 496 KB instead of 44 KB); push-sw.test.ts case 14 pins the mirror against the real schema on 26 payloads"
  - "The subscription body is built by subscriptionBody() ({endpoint, keys, userAgent<=512}): the API schema is .strict() and a browser's toJSON() also carries expirationTime, which would be refused"
  - "The fallback banner icon is /icons/rede-social-192.png (07-06's NEUTRAL_PUSH_ICON), not the plan's /icons/icon-192.png, which does not exist"
  - "The LOCAL-ONLY test VAPID public key is BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k (private half never printed, discarded); it lives in apps/web/.env.example, .github/workflows/ci.yml (build step) and scripts/local-env.sh (which CI uses to write apps/web/.env.local before the e2e)"
  - "enablePush replaces an existing subscription made with another VAPID key after the prompt (pushManager.subscribe would otherwise throw InvalidStateError)"
  - "disablePush returns { unsubscribed, deleted } and never throws; the switch treats unsubscribed=false as the E06 error (revert to on + the error toast), logout ignores it"
  - "The soft-ask staff body keys on bootstrap.permissions including 'chat.support' (today only support_tenant; 07-08 moves it to the chat manifest for admin_tenant too)"

patterns-established:
  - "A logout form that must clean up first uses useLogoutSubmit(cleanup) from @rede-social/core/ui; the tenant shell provides the cleanup through BeforeLogoutProvider"

requirements-completed: [NOTIF-03, PWA-02]

coverage:
  - id: D1
    description: "Service worker: total payload parse with the UI-D-267 fallback, the WebKit-always-shows foreground rule (Chromium/Firefox quiet when focused and visible, posting push-received), setAppBadge from the payload badge, the tenant banner with title/body/icon/tag/renotify and data.url, a same-origin click target (focus+navigate or open), pushsubscriptionchange re-subscribe + BFF POST"
    requirement: NOTIF-03
    verification:
      - kind: unit
        ref: "apps/web/lib/push-sw.test.ts (14 cases)"
        status: pass
      - kind: other
        ref: "pnpm --filter @rede-social/web build; .next/server/app/serwist/sw.js.body contains notificationclick, pushsubscriptionchange and the fallback (44 KB)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The client flow: isIosLike (iPhone, iPad, iPadOS as a Mac with touch), pushSupport/readPushState branches, requestPermission as the FIRST await then subscribe then the POST, denied/dismissed, save-failure rollback, key-mismatch resync with no prompt, disablePush bounded to 2 s"
    requirement: NOTIF-03
    verification:
      - kind: unit
        ref: "apps/web/lib/push.test.ts (15 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "BFF /api/push/subscriptions: 403 cross-origin, 413 body, 401 no session, 400 strict schema, one parsed forward, API 4xx kept, 5xx/transport 502, logs never hold the endpoint"
    requirement: NOTIF-03
    verification:
      - kind: unit
        ref: "apps/web/app/api/push/subscriptions/route.test.ts (S1-S5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Configurações switch (six states + busy) and the soft-ask card (member/staff body, dismissal for good, absent when subscribed and on /configuracoes), both saving and deleting the push_subscriptions row through the real BFF and API"
    requirement: NOTIF-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/push.spec.ts#1-2, 3, 4, 6, 6b, 7 (mobile-chromium and desktop-chromium)"
        status: pass
      - kind: unit
        ref: "packages/modules/notifications/tests/push-switch-row.test.tsx, soft-ask-card.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "PWA-02 / D-234: iOS or iPadOS outside standalone opens the InstallHint push variant (one Entendi, no Agora não, no dismissal written) from both the switch and the soft-ask, and never prompts"
    requirement: PWA-02
    verification:
      - kind: unit
        ref: "apps/web/components/pwa/InstallHint.test.ts#11, 12; apps/web/lib/push.test.ts#1, 3, 4"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/push.spec.ts#5 (iPhone 14 UA on both projects)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Logout on a shared device: Configurações Sair and the desktop rail Sair unsubscribe and delete the row before signing out, bounded to 2 s; no page load ever prompts (D-233)"
    requirement: NOTIF-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/push.spec.ts#8, 8b, 9"
        status: pass
      - kind: unit
        ref: "packages/core/tests/before-logout.test.tsx"
        status: pass
    human_judgment: false
  - id: D7
    description: "Real delivery and the iOS standalone path on real phones: the banner on Android Chrome and iPhone (tenant name, icon, collapse by tag, foreground quiet on Android), the OS prompt from the Home Screen app on iOS 16.4+, the real-device iPad UA"
    requirement: PWA-02
    verification: []
    human_judgment: true
    rationale: "Playwright cannot emulate iOS standalone and no automated run reaches a real push service (PUSH_TRANSPORT=fake); these are the 07-11 real-device test plan rows (UI E07/partial, E14/partial, E14/long-text backstops), blocked until run against production."

duration: 26min
completed: 2026-09-30
---

# Phase 7 Plan 07: Web Push, browser half Summary

**A member turns push on or off with one tap in Configurações or on a one-time soft-ask card on `/notificacoes`. The permission prompt is the first await of that tap. iPhones and iPads outside the Home Screen app get the `InstallHint` push sheet instead of a prompt. The service worker shows the tenant-branded banner (or stays quiet in front on Chromium and Firefox), sets the icon badge, never navigates off-origin and re-subscribes itself. Logging out on a shared device forgets that device first, bounded to 2 s.**

## Performance

- **Duration:** about 26 min
- **Started:** 2026-09-30T18:26:44Z
- **Completed:** 2026-09-30T18:52:36Z
- **Tasks:** 3 of 3
- **Files modified:** 32 (15 created, 17 modified)

## Accomplishments

- **Service worker.** `app/sw.ts` gains `push`, `notificationclick` and `pushsubscriptionchange` listeners. Each does all of its work inside one `waitUntil`. Every decision is in the pure `lib/push-sw.ts`:
  - The payload parse is total. A missing, unparseable, non-v1 or off-origin payload shows the "Nova notificação" fallback, which opens `/inicio`.
  - WebKit always shows. Chromium and Firefox with a focused, visible window post `push-received` instead.
  - `setAppBadge` is set from the payload's badge.
  - A click focuses and navigates a same-origin window, or opens one.
  - The built worker is 44 KB. It imports no zod.
- **Client flow.** `lib/push.ts` is shared by both entry points.
  - `isIosLike` catches iPadOS (a Mac with more than one touch point).
  - `enablePush` awaits `Notification.requestPermission()` first. Its callers obtain the registration and the key on mount.
  - A save failure unsubscribes again.
  - `syncPushOnOpen` re-saves on every open with permission granted, and replaces a subscription made with another key without a prompt.
  - `disablePush` never throws and bounds each step to 2 s.
- **BFF.** `POST`/`DELETE /api/push/subscriptions` clones the stories-views gates. It validates with the API's own strict schemas, forwards once and logs by shape only.
- **UI.**
  - `SoftAskCard` and `PushSwitchRow` are props-only module components.
  - `PushControls` composes them: `SoftAsk` above the list on `/notificacoes`, and `PushSettingRow` in place of the "Em breve" pill on tenant hosts.
  - `InstallHint` has a `push` variant with one "Entendi" and no dismissal written.
- **Logout.** The kernel's new `BeforeLogoutProvider`/`useLogoutSubmit` lets the desktop rail's "Sair" await `LiveShell`'s "forget this device" cleanup. The Configurações form uses the web's `LogoutForm`. Both are bounded to 2 s.
- **Proof.**
  - Unit: 14 push-sw cases, 15 push cases, 5 BFF cases, 2 InstallHint push cases, the catalog pins, 16 module UI cases and 4 kernel seam cases.
  - E2E: `push.spec.ts` passes 17 of 18 on the two projects. The 18th is the desktop-only rail case, skipped on the phone by design.

## Task Commits

1. **Task 1: Service-worker push handling** - `44a17b8` (feat)
2. **Task 2: Turning push on and off, the iOS gate, the BFF, sync on open and logout unsubscribe** - `be537e6` (feat)
3. **Task 3: The browser flows with a mocked PushManager** - `54650af` (test)

**Plan metadata:** recorded in the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/lib/push-sw.ts` and `app/sw.ts`: the worker's decisions and listeners.
- `apps/web/lib/push.ts`: support, state, enable, disable, resync and the dismissal key.
- `apps/web/app/api/push/subscriptions/route.ts`: the BFF door.
- `apps/web/components/push/PushControls.tsx`, `components/shell/LogoutForm.tsx`, `components/shell/LiveShell.tsx`, `components/pwa/InstallHint.tsx`: the web composition.
- `packages/modules/notifications/ui/{SoftAskCard,PushSwitchRow}.tsx`: the designed surfaces 3 and 4 of sketch 007.
- `packages/core/ui/BeforeLogout.tsx` and `DesktopRail.tsx`: the logout seam.
- `apps/web/app/(app)/{layout,configuracoes/page,notificacoes/page}.tsx`: the mounts.
- `apps/web/lib/env.ts`, `.env.example`, `.github/workflows/ci.yml`, `scripts/local-env.sh`: the optional public key.
- `apps/web/messages/pt-BR/{notifications,pwa}.json`: the catalog keys, verbatim from the UI-SPEC.

## Decisions Made

See `key-decisions`. Two notes:

- **The D-33 gate.** Task 2's precondition `grep -q '^approved: true' .planning/sketches/007-phase-07-designed-screens/README.md` passed. The sketch was approved by igor.vboas on **2026-09-30** (`approval_kind: provisional`, commit 67ba861), and the README was not edited.
- **The local test VAPID public key.** It is recorded in `apps/web/.env.example`, in `.github/workflows/ci.yml` (the typecheck/build/test step) and in `scripts/local-env.sh`. Its private half was never printed and is discarded; local and CI push run `PUSH_TRANSPORT=fake`. Production gets its own pair (07-11, DEPLOY.md).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Performance/critical] The service worker mirrors the payload schema instead of importing zod**
- **Found during:** Task 1 (the first build)
- **Issue:** Importing `pushPayloadSchema` bundled zod into the worker, taking it from 44 KB to 496 KB. Every client re-downloads the worker on each update check. The plan itself says "the SW bundle must stay small".
- **Fix:** `isPushPayloadV1` checks the exact strict shape (the keys, types, `PUSH_PATH`/`PUSH_TAG` regexes and bounds). `push-sw.test.ts` case 14 asserts it agrees with `pushPayloadSchema.safeParse` on 26 payloads.
- **Committed in:** 44a17b8

**2. [Rule 1 - Bug] `subscription.toJSON()` would be refused by the strict API schema**
- **Found during:** Task 1
- **Issue:** The plan POSTs `subscription.toJSON()`. A browser's `toJSON()` carries `expirationTime`, and `pushSubscriptionInputSchema` is `.strict()`, so every real save would have been a 400.
- **Fix:** `subscriptionBody()` sends `{ endpoint, keys: { p256dh, auth }, userAgent }`, with the user agent cut to 512 characters. The page and the worker both use it. The BFF test pins an `expirationTime` body as 400.
- **Committed in:** 44a17b8, be537e6

**3. [Rule 1 - Bug] The fallback icon path**
- **Fix:** The fallback uses `/icons/rede-social-192.png` (07-06's `NEUTRAL_PUSH_ICON`) instead of the plan's `/icons/icon-192.png`, which does not exist.
- **Committed in:** 44a17b8

**4. [Rule 1 - Bug] A subscription made with another VAPID key blocks `subscribe`**
- **Fix:** After the prompt, `enablePush` unsubscribes a subscription whose `applicationServerKey` differs before subscribing, and reuses one made with the same key. Unit case 9 covers it.
- **Committed in:** be537e6

**5. [Rule 3 - Blocking] `apps/web/.env.local` cannot be written by the agent (orchestrator instruction)**
- **Issue:** Task 2 asks the executor to add the key to the developer's untracked `apps/web/.env.local`, and Task 3's precondition requires it. A hook blocks `.env*` files other than `.env.example`.
- **Fix:** Every local build and Playwright run received the key inline, as `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<key> … playwright test push.spec.ts`. Playwright's `webServer` inherits the process env, and the process env wins over `.env.local` in both Next and the Playwright config loader. Case 1 reaching `off` (not `unsupported`) proves the key reached the app. The developer must add the line themselves (see User Setup).
- **Also:** the key was added to `scripts/local-env.sh`. CI writes `apps/web/.env.local` with that script before the dev-server e2e, so without it `push.spec.ts` would see no key in CI.
- **Committed in:** be537e6

**6. [Rule 3 - Blocking] Files outside `files_modified`**
- `apps/web/app/(app)/layout.tsx` passes `vapidPublicKey` to `LiveShell`.
- `packages/core/tests/before-logout.test.tsx` gives unit proof for the new kernel seam, including the 2 s bound.
- The `SoftAsk` mount went into `notificacoes/page.tsx`, which the plan allowed. `NotificationsSurface.tsx` is untouched.
- **Committed in:** be537e6

**7. [Test design] Changes to the e2e spec**
- The phone project is an iPhone 14, so the non-iOS cases browse with the Pixel 7 UA. The iOS case uses the iPhone 14 UA on both projects.
- The staff body uses a throwaway `support_tenant` member. No support user is seeded, and `admin_tenant` holds no `chat.support` until 07-08.
- A desktop-only case 8b proves the rail's "Sair" too.
- **Committed in:** 54650af

**8. [Acceptance-grep shape] `enablePush` takes `input: EnablePushInput`**
- The criterion's `sed … /^}/` range stops at a destructured parameter's closing `}: {` line. With the type alias, the range reaches the body, and its first `await` is `requestPermission()`.
- **Committed in:** be537e6

---

**Total deviations:** 8 (4 Rule 1/2 correctness, 2 Rule 3 blocking, 2 test/shape).
**Impact on plan:** Deviations 1 to 4 were needed for the push path to work at all against the 07-06 contracts, or to keep the worker small. There is no scope creep.

## Issues Encountered

- None blocking. Both e2e runs passed on the first attempt after a `db:reset` + `db:seed` (the seed still prints the pre-rename `tria-*` hosts, a known deferred item).
- **Copy note for UI review.** A failed turn-off (unsubscribe timing out) reuses `notifications.push.errors.failed` ("Não foi possível ativar…"), the only error string the UI-SPEC defines for the row.

## Verification (final runs)

- `pnpm --filter @rede-social/web exec vitest run lib/push-sw lib/push components/pwa app/api/push i18n`: 5 files, 540 tests, pass. The full web unit suite has 47 files and 1,105 tests, all passing.
- `pnpm --filter @rede-social/module-notifications test`: 9 files, 105 tests, pass. `pnpm --filter @rede-social/core test`: 30 files, 257 tests, pass.
- Typecheck (web, core, module) and lint (web, core, module) pass. `bash scripts/check-ui-literals.sh` passes, and `pnpm boundaries` checked 808 files with no issues.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<test key> pnpm --filter @rede-social/web build` passes. `bash scripts/check-static-routes.sh` checked 52 routes with 0 offenders, and `/api/push/subscriptions` is dynamic.
- `pnpm db:reset && pnpm db:seed && NEXT_PUBLIC_VAPID_PUBLIC_KEY=<test key> VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test push.spec.ts notifications.spec.ts` gives **64 passed, 2 skipped**. The skips are 8b on the phone by design and the existing desktop skip in `notifications.spec.ts`.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register:
- T-07-42, 43, 44, 45, 46, 48 and 49 are mitigated and tested.
- T-07-47 and T-07-SC are accepted as planned.
- The worker's `pushsubscriptionchange` POST goes through the same gated BFF route.

## User Setup Required

Add this line to the untracked `apps/web/.env.local`. It is the LOCAL-ONLY test public key, and it is safe to keep:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJHs89NeHI8M9hJQWfvb1_irumrdO-cNFTwQZUHrWx3Lp3smi-NAifeRu5Pm4rWfwmQCL5GvEdK8_PVtNafxV1k
```

Alternatively, regenerate the file with `bash scripts/local-env.sh > apps/web/.env.local`, which now emits it. Without the line, every push surface shows "Este navegador não recebe notificações." and `push.spec.ts` fails unless the key is exported.

## Next Phase Readiness

- 07-08's chat kinds need no web change for push: the worker shows any v1 payload and opens its `/suporte…` URL. The soft-ask staff body already keys on `chat.support`.
- 07-11 needs the following:
  - Put the production `vapid-public-key-prod` value on Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
  - Run the real-device rows: the Android banner and foreground quiet, the iPhone/iPad Safari gate, the prompt from the Home Screen app on iOS 16.4+, and a 2,000-character chat body.

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All fifteen created key files exist on disk, and the three task commits (`44a17b8`, `be537e6`, `54650af`) are in history.
