---
phase: 07-notifications-web-push-chat
plan: 03
subsystem: notifications
tags: [realtime, broadcast, private-channels, live-counters, badging, package-legitimacy, D-239, D-240, UI-D-253, UI-D-265]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-01: @rede-social/contracts/realtime topic builders, app.realtime_topic_allowed + the realtime.messages SELECT policy, app.realtime_signal, countersFor, runNotificationJobs, the seen/read own-topic signals"
provides:
  - "@supabase/realtime-js 2.116.0 (exact pin) in @rede-social/core and @rede-social/api (dev)"
  - "kernel UI: RealtimeProvider/useRealtime (one client per window, token-gated private joins, 60 s hidden disconnect, unmount disconnect), useRealtimeTopic, LiveCountersProvider/useLiveCounters, applyAppBadge, SlotBadgeLabelsProvider/useSlotBadgeLabel, createTokenSource/tokenFetcher"
  - "contracts: countersSchema / Counters (alias of bootstrapSchema.shape.counters)"
  - "API: GET /v1/me/counters"
  - "web: GET /api/realtime/token, GET /api/me/counters, components/shell/LiveShell.tsx, the live /notificacoes merge"
  - "tests: realtime.test.ts + realtime-helpers.ts (live SC 4), kernel realtime unit tests, token route test, e2e 'notifications ao vivo'"
affects: [07-04 retractions and generic row, 07-05 event sources, 07-06 push channel, 07-08 chat topics and counters, 07-09 chat half of the badge and slot label, 07-10 chat panes on the same provider, 07-11 DEPLOY private_only step]

actuals:
  tokens: 28800
  tasks: 3
  commits: 2
plan_head_before: 56fd02f789c1c569fd051aaccfaed60a02be0175

tech-stack:
  added: ["@supabase/realtime-js 2.116.0 (already in the lockfile transitively; now declared)"]
  patterns:
    - "One RealtimeClient per window in kernel UI; every channel private; listeners multiplexed per topic"
    - "Resolve the token (client.setAuth()) BEFORE the first subscribe, and again after a hidden-tab disconnect"
    - "Signals are ids only; every number and row is refetched through a BFF GET route or a server action"
    - "Refetch on signal, on every SUBSCRIBED and on every visibilitychange to visible (D-240), never replay"
    - "Host-supplied stateful slot labels through a client context (the kernel ships no words)"

key-files:
  created:
    - packages/core/ui/realtime/RealtimeProvider.tsx
    - packages/core/ui/realtime/token-source.ts
    - packages/core/ui/realtime/useRealtimeTopic.ts
    - packages/core/ui/realtime/LiveCountersProvider.tsx
    - packages/core/ui/realtime/app-badge.ts
    - packages/core/ui/realtime/SlotBadgeLabels.tsx
    - packages/core/tests/realtime-token-source.test.ts
    - packages/core/tests/realtime-app-badge.test.ts
    - packages/core/tests/live-counters.test.tsx
    - apps/api/tests/integration/realtime-helpers.ts
    - apps/api/tests/integration/realtime.test.ts
    - apps/web/app/api/realtime/token/route.ts
    - apps/web/app/api/realtime/token/route.test.ts
    - apps/web/app/api/me/counters/route.ts
    - apps/web/components/shell/LiveShell.tsx
  modified:
    - packages/core/package.json
    - apps/api/package.json
    - pnpm-lock.yaml
    - packages/core/ui/index.ts
    - packages/core/ui/TopBar.tsx
    - packages/core/ui/DesktopRail.tsx
    - packages/contracts/src/bootstrap.ts
    - apps/api/src/routes/me.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
    - apps/web/app/(app)/notificacoes/page.tsx
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/notifications.spec.ts
    - apps/web/e2e/shell.spec.ts

key-decisions:
  - "Task 1 gate: the developer approved @supabase/realtime-js@2.116.0 verbatim (\"approved\", 2026-09-30); installed with --save-exact, one version in the lockfile, 2.117.2 not installed"
  - "RealtimeProvider awaits client.setAuth() before any subscribe: realtime-js builds the first join payload synchronously, before its async accessToken callback resolves, so without it the first private join carries only the publishable key and is refused (observed live)"
  - "LiveShell joins tenant:<t>:all only while the notifications module is enabled; the user topic is always joined"
  - "The /notificacoes live merge ignores the own-topic seen/read markers and re-posts seen only when a row was actually added, so seen can never loop back into a refetch"
  - "The browser token fetch uses redirect: 'manual': proxy.ts redirects an expired session to /entrar, whose HTML would otherwise answer 200"
  - "Kernel realtime unit tests live in packages/core/tests/ (the package's vitest include), not beside the sources"

patterns-established:
  - "Live Realtime integration tests: connectAs (GoTrue token + setAuth), joinTopic (catch-all listener, 8 s settle), waitForBroadcast, expectNotSubscribed, signal (app.realtime_signal in a claims-scoped committed tx); one socket per refused join"
  - "Browser signal-drop e2e: page.routeWebSocket pass-through that discards only frames carrying the signal event"

requirements-completed: [NOTIF-02]

coverage:
  - id: D1
    description: "NOTIF-02 live bell: an admin publishing in another browser context moves the member's bell from 0 to 1 without a reload, within 15 s; a second tab drops its badge when the first opens Notificações"
    requirement: NOTIF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications ao vivo (cases 1-2, mobile-chromium and desktop-chromium)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/live-counters.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-240 catch-up: SUBSCRIBED and visibilitychange refetch; a dropped signal is caught up on refocus and not before; the open list merges new rows at the top"
    requirement: NOTIF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications ao vivo (cases 3-4)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/live-counters.test.tsx (SUBSCRIBED, visible, hidden 60 s, unmount)"
        status: pass
    human_judgment: false
  - id: D3
    description: "SC 4 live negatives against the real local Realtime service, each beside a positive control: foreign user topics, other tenant, support-inbox, malformed and upper-case topics, module off, blocked member, non-private join (A1), rolled-back signal (A3), browser send (read-only)"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/realtime.test.ts#realtime authorisation (live)"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/me/counters equals the bootstrap counters; BFF /api/me/counters and /api/realtime/token gates (Sec-Fetch-Site 403, 401 without a session, no-store, token never logged); token cached (20 heartbeats, 1 fetch)"
    requirement: NOTIF-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#15"
        status: pass
      - kind: unit
        ref: "apps/web/app/api/realtime/token/route.test.ts"
        status: pass
      - kind: unit
        ref: "packages/core/tests/realtime-token-source.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-239 app badge, UI-D-253 stateful slot name with an aria-hidden visual badge, UI-D-265 Realtime-down shows the server count and no connecting indicator"
    requirement: NOTIF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications ao vivo (cases 5-6)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/realtime-app-badge.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#07-03 navBadge"
        status: pass
    human_judgment: true
    rationale: "The real OS icon badge on an installed PWA (iOS/Android) and a screen reader's reading of the slot are only stubbed or asserted structurally here; real-device checks wait for the deployed app (phones cannot reach *.localhost)."

duration: 29min
completed: 2026-09-30
---

# Phase 7 Plan 03: Live Bell over Realtime Summary

**One private, token-gated Realtime client per window drives the bell: an admin's post reaches the member's badge in seconds without a reload, a missed signal is caught up on refocus, and every SC 4 negative is proved live against the local Realtime service beside a positive control.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-09-30T13:39:00Z
- **Completed:** 2026-09-30T14:08:00Z
- **Tasks:** 3 of 3 (Task 1 a decision gate, Tasks 2-3 committed)
- **Files modified:** 30

## Task 1: Package Legitimacy Gate (recorded decision)

- **Package and version:** `@supabase/realtime-js@2.116.0`, exact pin. The flagged 2.117.2 was not installed.
- **Presented:** 2026-09-30, by the orchestrator. The developer saw the one-row table from 07-RESEARCH.md §Package Legitimacy Audit: verdict SUS (`too-new`, caused by the 2.117.2 latest tag), pinned 2.116.0 published 2026-09-07, about 32M weekly downloads, repository github.com/supabase/supabase-js, npm link. Three statements came with it. The install adds no new code, because 2.116.0 was already in `pnpm-lock.yaml` through `@supabase/supabase-js@2.116.0`. It is CLAUDE.md's named subscribe-only client. 2.117.2 is not installed.
- **Pre-install state:** `git diff --quiet -- pnpm-lock.yaml packages/core/package.json apps/api/package.json` exited 0 when the gate was presented (the orchestrator verified it). I confirmed it again (`CLEAN`) before running `pnpm add`.
- **Developer's answer, verbatim:** "approved"
- **Result:** the lockfile only gained the two importer entries. `'@supabase/realtime-js@2.116.0'` is the only version resolved.

## Accomplishments

- Kernel live layer in `@rede-social/core/ui`. `RealtimeProvider` runs one `RealtimeClient` per window, joins privately, resolves the token before any join, disconnects after 60 s hidden, re-joins on visible and disconnects on unmount. `useRealtimeTopic`, `LiveCountersProvider`, `applyAppBadge` and `SlotBadgeLabelsProvider` complete the layer. `TopBar` and `DesktopRail` read the live counters when a provider is mounted and fall back to their static prop otherwise.
- `GET /v1/me/counters` runs the same flags and `countersFor` as the bootstrap in one tenant transaction. Its BFF twin `GET /api/me/counters` and the token route `GET /api/realtime/token` both require `Sec-Fetch-Site: same-origin` and a verified session, and answer `no-store`.
- `LiveShell` wraps only the tenant shell. `/notificacoes` merges new rows at the top on a signal, a re-join or a refocus.
- Live SC 4 suite: 7 cases against the real Realtime service. Browser proof: 6 new e2e cases on both projects.

## Observed Realtime Behaviour (local stack)

Join statuses from `realtime.test.ts` (run with `--reporter=verbose`):

| Case | Topic | Status |
|------|-------|--------|
| 1 positive | own `user:` / `all` | SUBSCRIBED / SUBSCRIBED |
| 2 | another demo member's `user:` | CHANNEL_ERROR |
| 2 | lab member's `user:` (other tenant) | CHANNEL_ERROR |
| 2 | `support-inbox` (member, not staff) | CHANNEL_ERROR |
| 2 | `tenant:bad:all` | CHANNEL_ERROR |
| 2 | upper-case-hex `all` | CHANNEL_ERROR |
| 3 | `all` with notifications disabled / own `user:` | CHANNEL_ERROR / SUBSCRIBED |
| 4 | own `user:` after `blocked_at` is set | CHANNEL_ERROR (a fresh client joins after the unblock) |
| 5 (A1) | private / `private: false` join of own `user:` | SUBSCRIBED / SUBSCRIBED; the public join received nothing |
| 6 (A3) | rolled-back `app.realtime_signal` | nothing within 2 s; the committed control arrived |
| 7 | browser `channel.send` | the client call answers `ok` (ack off), but no other subscriber received it; the definer control did |

Other findings:
- A refused private join is answered `Unauthorized: You do not have permissions to read from this Channel topic` about **5 s** after the `phx_join`. One socket handles its joins in order, so several refusals on one socket queue behind each other. realtime-js also re-joins a refused channel every ~5 s.
- Delivered signal payloads are `{ id, kind }`. `realtime.send` injects the message id, the same finding as 07-01.
- **No Realtime quota warning** (`too_many`, rate limit, `tenant_events`) appeared in the local Realtime logs during these runs.

## Task Commits

1. **Task 1: package legitimacy gate.** Decision only, no commit.
2. **Task 2: live bell over one private Realtime client per window.** `662ac9d` (feat)
3. **Task 3: live Notificações merge and the live-bell browser proof.** `7cfcab1` (feat)

**Plan metadata:** recorded in the final docs commit.

## Verification Results

- Task 2 static checks: core typecheck, lint, test (230 tests at that point); api typecheck and lint; web typecheck and lint; `pnpm boundaries` found no issues. Exit 0.
- Task 2 integration: `pnpm db:reset && pnpm db:seed`, then `realtime.test.ts` + `bootstrap.test.ts`: **24 passed** (7 realtime, 17 bootstrap).
- Task 3 unit: core **253 passed** (29 files); web `app/api/realtime` + `i18n` **460 passed**; `check-ui-literals` OK.
- Task 3 e2e: after reset and seed, `notifications.spec.ts -g "notifications ao vivo|notifications tracer|notifications lista"`: **25 passed, 1 skipped**. The skip is 07-01's 320px phone-only case, on desktop.
- Plan-level extras: `notifications.test.ts` **14 passed**; `shell.spec.ts` **10 passed** (its bell assertion now accepts the stateful name).
- The two known env-host failures (`phase2-smoke` case 1, `signup` case 2) are outside every command above, and none of the commands failed. `pnpm db:seed` still prints `platform=<old-brand>.localhost rede-demo=<old-brand>-demo.localhost rede-lab=<old-brand>-lab.localhost`, so the local env hosts have **not** been regenerated yet.
- No dev servers were left running: ports 3000, 8787 and 8790 are free.

## Decisions Made

See `key-decisions` above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] realtime-js sends the first join before its token is resolved**
- **Found during:** Task 2, the first live run
- **Issue:** On a fresh socket, realtime-js resolves the `accessToken` callback asynchronously in `connect()`. `subscribe()` builds the `phx_join` payload synchronously from the token it already holds, which is none. The first private join therefore carried only the publishable key (the Realtime log showed `iss=supabase-demo`) and was refused. The RESEARCH provider sketch has the same race.
- **Fix:** `RealtimeProvider` calls `client.setAuth()` once when the client is created, and again when it resumes after a hidden-tab disconnect. Every channel open waits for that promise, and a generation counter cancels opens made stale by a leave or a suspend. The test helper `connectAs` awaits `setAuth()` in the same way.
- **Files modified:** packages/core/ui/realtime/RealtimeProvider.tsx, apps/api/tests/integration/realtime-helpers.ts
- **Commit:** 662ac9d

**2. [Rule 3 - Blocking] Join settle window of 8 s and one socket per refused join**
- **Found during:** Task 2
- **Issue:** The service answers a refusal about 5 s after the join, so the planned 5 s window reported `TIMED_OUT`. Five refusals on one socket queued for about 25 s and delayed the positive control's signal.
- **Fix:** `JOIN_SETTLE_MS = 8000`, and case 2 joins its negatives in parallel, each on its own client. Every negative now lands as `CHANNEL_ERROR`. `expectNotSubscribed` still accepts either refusal status.
- **Files modified:** apps/api/tests/integration/realtime-helpers.ts, apps/api/tests/integration/realtime.test.ts
- **Commit:** 662ac9d

**3. [Rule 1 - Bug] Payload keys are `['id', 'kind']`, not `['kind']`**
- **Found during:** Task 2 (07-01's deviation 1 applies unchanged)
- **Fix:** Case 1 asserts `['id', 'kind']` and `kind === 'feed.post'`. The payload is still ids-only.
- **Commit:** 662ac9d

**4. [Rule 3 - Blocking] Kernel unit tests placed in `packages/core/tests/`**
- **Issue:** `packages/core/vitest.config.ts` includes only `tests/**/*.test.{ts,tsx}`, so tests placed beside the sources would never run under `pnpm --filter @rede-social/core test`.
- **Fix:** The tests are `packages/core/tests/realtime-token-source.test.ts`, `realtime-app-badge.test.ts` and `live-counters.test.tsx`, which is the package's existing convention.
- **Commit:** 7cfcab1

**5. [Rule 1 - Bug] Bell locators that matched the exact plain label**
- **Issue:** With unseen rows, the slot's accessible name is now "Notificações, N novas", so 07-01's `name: N.nav, exact: true` locators and `shell.spec.ts`'s `aria-label` equality would fail.
- **Fix:** Both specs match the catalog label alone or the label followed by `, …`, with the regex built from the catalog. `shell.spec.ts` is outside the plan's file list.
- **Commit:** 7cfcab1

**6. [Rule 2 - Missing critical] No loop between seen and the list's refetch**
- **Issue:** A seen POST signals the member's own topic. A list that refetched and re-posted seen on every signal could loop.
- **Fix:** The list ignores the own-topic `seen` and `read` markers and re-posts seen only when the merge actually added a row. Refetches are coalesced (busy/again).
- **Commit:** 7cfcab1

**7. [Rule 2 - Missing critical] `all` joined only while notifications is on**
- **Issue:** A refused channel is re-joined every ~5 s by realtime-js, which costs joins against the Free plan quota for nothing.
- **Fix:** `LiveShell` takes `notificationsEnabled` (from `bootstrap.modules`) and leaves `tenant:<t>:all` out when the module is off.
- **Commit:** 662ac9d

**8. [Rule 2 - Missing critical] Token and counter fetches refuse redirects**
- **Issue:** proxy.ts answers an expired session with a redirect to `/entrar`. A followed redirect is a 200 HTML page.
- **Fix:** `redirect: 'manual'`. Any non-2xx answer, wrong shape or network error yields `null` or keeps the last value.
- **Commit:** 662ac9d

**9. [Rule 3 - Blocking] `page.tsx` passes the topic ids**
- **Fix:** `/notificacoes` passes `bootstrap.tenant.id` and `bootstrap.user.id` to the surface. The file is outside the plan's list.
- **Commit:** 7cfcab1

**10. [Rule 3 - Test precision] The D-240 e2e drops only signal frames**
- **Issue:** Dropping every server frame would also drop heartbeat replies. That can force a reconnect, whose `SUBSCRIBED` refetch would bring the badge back before the refocus and make the test pass for the wrong reason.
- **Fix:** The `routeWebSocket` pass-through discards only frames that carry `notifications.changed` while the flag is set. The test waits until at least one frame was dropped, then asserts the badge is absent before the refocus.
- **Commit:** 7cfcab1

**Not changed, although listed in `files_modified`:** `packages/core/ui/AppShell.tsx`, because TopBar and DesktopRail read the context themselves, and `apps/web/messages/pt-BR/notifications.json`, because `navBadge` already existed and no new copy was needed. Case 1's admin publishes through the real composer at `/criar` in a second browser context, as the plan asked. The other publishes use 07-01's `publishPostAs` (the real API).

---

**Total deviations:** 10 auto-fixed (3 Rule 1, 3 Rule 2, 4 Rule 3)
**Impact on plan:** Deviation 1 is a real production bug in the planned provider shape: every first join would have been refused. The rest adjust test mechanics or add correctness guards. There is no scope creep.

## Issues Encountered

- Browser noise already present in 07-01's cases appears in the e2e logs too: `unhandledRejection: TypeError: Cannot read properties of undefined (reading 'waiting')`, probably the service-worker registration with `serviceWorkers: 'block'`, and mux-player token errors from seeded videos. It does not affect any assertion. I did not investigate it (out of scope).
- The env hosts are unchanged (`<old-brand>-*`), see Verification Results.

## Known Stubs

None added. 07-01's stub "notifications.navBadge ICU label not yet consumed by the shell bell" is now resolved: `LiveShell` supplies it as the bell slot's stateful name. It is marked `fixed` in `.planning/WINDOWS.md` (entry 57).

## Threat Flags

None beyond the plan's threat model. T-07-12, T-07-13, T-07-14, T-07-16, T-07-17, T-07-18 and T-07-19 are mitigated and tested. T-07-15 stays accepted as planned: a new join is refused (case 4), and an open socket keeps ids-only signals until its next token push.

## User Setup Required

None. No new env var: the provider receives the existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the layout.

## Next Phase Readiness

- 07-08, 07-09 and 07-10 can join `conv:` and `support-inbox` through `useRealtimeTopic` on the same provider. The provider already handles the token race, hidden-tab hygiene and re-join catch-up.
- 07-09 adds the chat label to `LiveShell`'s `SlotBadgeLabelsProvider` value and the chat count to the same `LiveCountersProvider`. The app badge already sums both counters.
- 07-11 DEPLOY must set `private_only` on the hosted Realtime (A1 is pinned locally only because every publish and every join is private).

---
*Phase: 07-notifications-web-push-chat*
*Completed: 2026-09-30*

## Self-Check: PASSED

All 15 created files exist on disk; both task commits (662ac9d, 7cfcab1) are in history.
