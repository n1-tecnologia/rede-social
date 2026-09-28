---
phase: 06-events
plan: 06
subsystem: events
tags: [events, online, entrar, security-definer, route-handler, prefetch, open-redirect, continue-path, playwright, D-207, D-210, D-211, D-218, UI-D-207, UI-D-209, EVENT-04]

requires:
  - phase: 06-events (06-01)
    provides: events + event_secrets (the admin-only meeting_url), the https CHECK, events-admin.ts fixtures (insertEvent, deleteEventsTenant)
  - phase: 06-events (06-02)
    provides: sketch 006 surface 4 (detalhe-online-p1, entrar-dicas-e-pesos, entrar-recusas-*) and the action-zone rows, approved provisionally 2026-09-27 (the D-33 gate for Task 2)
  - phase: 06-events (06-03)
    provides: event_attendances (checkin_via 'code' | 'online'), the guard trigger that re-checks the window for every writer, the detail page, EventActions, the checked-in banner
  - phase: 06-events (06-05)
    provides: the SECURITY DEFINER posture (app.events_check_in), the outcome-returned-then-mapped service shape, event.checked_in, pgTAP 142, the check-in integration file, addEventsMember / attendanceFor
provides:
  - "app.events_enter(uuid) SECURITY DEFINER: returns (outcome, meeting_url, attendance_status, starts_at); outcomes forward / recorded / already / confirm_first / ended / cancelled / not_found; the URL only on the three passing outcomes"
  - "POST /v1/events/{id}/enter (events.attendance.respond): 200 { outcome, meetingUrl }, bare 404; event.checked_in via online on recorded only"
  - "contracts: ENTER_OUTCOMES, ENTER_PASSING_OUTCOMES, enterResultSchema (strict, https, URL exactly on passing outcomes), EnterResult"
  - "GET /eventos/{id}/entrar route handler: prefetch + framework fetch 204, 303 to the stored https URL (no-store, no-referrer), refusals to /entrar/aviso, never a destination from the request"
  - "/eventos/{id}/entrar/aviso?motivo=encerrado|cancelado|confirmar: the one refusal layout"
  - "EventActions online rows: outline Entrar (P0 after Vou), Lock hint (P0 otherwise), brand Entrar (P1/P2, and to rejoin once checked in), disabled when cancelled"
  - "isContinuablePath accepts /eventos/{uuid} and /eventos/{uuid}/entrar (calendar links survive a login)"
  - "lib/events.ts enterEvent; lib/events-view.ts EVENT_ID_RE, ENTER_NOTICE_REASONS, ENTER_NOTICE_FOR, EventActionState.startTime"
  - "e2e: events entrar (dev, 5 tests) and events-prefetch.spec.ts (production build, PWA_PROD)"
affects: [06-07, 06-08, 06-09, phase-07-notifications]

actuals:
  tokens: 69403
  tasks: 2
  commits: 2
plan_head_before: 12988b8a4a945e2d92ee35004b2928941fbb043e

tech-stack:
  added: []
  patterns:
    - "A side-effecting GET behind a POST: the route handler reaches the side effect only through an API POST, and answers 204 to anything that is not a person's top-level navigation (Sec-Purpose / Purpose / Next-Router-Prefetch / RSC)"
    - "The external redirect target comes only from the database's answer, re-checked https at the edge; internal redirects use a relative Location so the tenant host is kept"
    - "A proof that needs production (Next prefetches only in production) lives in its own spec under playwright.pwa.config.ts and self-skips unless PWA_PROD=1"
    - "Playwright routes only the first url of a redirect chain: a navigation that must land on an unresolvable external host is proved by its navigation request and redirectedFrom(), not by a fulfilled page"

key-files:
  created:
    - supabase/migrations/20260927193130_event_enter_function.sql
    - supabase/migrations/meta/20260927193130_snapshot.json
    - apps/web/app/(app)/eventos/[eventId]/entrar/route.ts
    - apps/web/app/(app)/eventos/[eventId]/entrar/route.test.ts
    - apps/web/app/(app)/eventos/[eventId]/entrar/aviso/page.tsx
    - apps/web/lib/continue-path.test.ts
    - apps/web/e2e/events-prefetch.spec.ts
  modified:
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/tests/contracts.test.ts
    - packages/modules/events/tests/events-payload.test.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/142-event-checkin.sql
    - apps/api/tests/integration/events-checkin.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/web/lib/events.ts
    - apps/web/lib/events-view.ts
    - apps/web/lib/events-view.test.ts
    - apps/web/lib/continue-path.ts
    - apps/web/messages/pt-BR/events.json
    - apps/web/i18n/messages.test.ts
    - apps/web/app/(app)/eventos/[eventId]/EventActions.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/e2e/events.spec.ts
    - apps/web/playwright.pwa.config.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "app.events_enter forwards (records nothing) before the window for a member whose answer is going OR who is already present (an event moved later after a check-in); everyone else gets confirm_first"
  - "/entrar answers 204 no-store to ANY Next framework data fetch (the RSC header), not only to announced prefetches: a server action's redirect() makes the Next server fetch the target with RSC: 1 and follow its redirects, which recorded the check-in server-side and made the deployment GET the admin-supplied meeting URL"
  - "enterEvent parses the answer with enterResultSchema and maps a passing outcome without a URL (or a refusal with one) to 500, never to a response"
  - "The Entrar refusal constants (EVENT_ID_RE, ENTER_NOTICE_REASONS, ENTER_NOTICE_FOR) live in lib/events-view.ts, not lib/events.ts, so the route handler is unit-testable without the API client's env"
  - "The e2e proves arrival at the meeting host by the browser's navigation request (redirectedFrom /entrar), because Playwright routes only the first url of a redirect chain"
  - "EVENT-04 stays Pending in REQUIREMENTS.md: 06-08 and 06-09 also declare it"

patterns-established:
  - "Pattern: every side-effecting GET route handler answers 204 no-store to Sec-Purpose / Purpose prefetch, Next-Router-Prefetch and RSC before doing anything"
  - "Pattern: an external 303 target is read only from the database's answer and re-parsed with new URL() + protocol check at the edge"

requirements-completed: [EVENT-04]

coverage:
  - id: D1
    description: "app.events_enter inside Postgres: privilege facts, P0 going forward with the URL and nothing written, P0 unanswered confirm_first with no URL and no row, in-window walk_in and checked_in (responded_at kept) via online, already with the URL and one row, ended / cancelled with no URL, in-person not_found, and the cross-tenant refusal with B's rows unchanged and A's positive control"
    requirement: "EVENT-04"
    verification:
      - kind: integration
        ref: "supabase/tests/142-event-checkin.sql facts 12-20 (plan 65; pnpm supabase test db: 17 files, 506 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /v1/events/{id}/enter end to end: every outcome over online events, meetingUrl null on confirm_first / ended / cancelled, event.checked_in once with via online and walkIn from the recorded status, the concurrent pair recording one row (recorded + already), a bare 404 for the lab's online event, an in-person event and an unknown id, 400 for a malformed id; isolation b4 crossing and host mismatch"
    requirement: "EVENT-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-checkin.test.ts#enter (6 tests; file 13 passed)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b4 (enter crossing + host mismatch; 27 passed)"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/contracts.test.ts#21-22; events-payload.test.ts#21-24"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /eventos/{id}/entrar: prefetch and framework fetches 204 without calling the API, 303 to exactly the stored https URL with no-store and no-referrer, non-https stored URLs answer like not-found, refusals to their aviso reason, not-found / error to the detail, bootstrap refusals to their path, malformed ids never reach the API, and no destination read from the query or headers"
    requirement: "EVENT-04"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/eventos/[eventId]/entrar/route.test.ts (18 tests)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events entrar 1-4 (mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The online rows of the action zone and the aviso refusal page: every (format x phase x answer x checked-in x cancelled) row with at most one brand fill, every Entrar a plain <a target=_blank rel=noopener noreferrer data-no-prefetch>, no meeting URL in any href or text, the three aviso screens and the D-93 fallback"
    requirement: "EVENT-04"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx#7a-7i (EventActions 33 tests)"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#06-06; apps/web/lib/events-view.test.ts#20"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events entrar 1-4; full events.spec.ts + events-prefetch.spec.ts on dev: 40 passed, 18 skipped"
        status: pass
    human_judgment: false
  - id: D5
    description: "A logged-out calendar tap on /eventos/{id}/entrar bounces to login, and after signing in the member lands in the meeting, counted as a walk-in via online (the widened continue path)"
    requirement: "EVENT-04"
    verification:
      - kind: unit
        ref: "apps/web/lib/continue-path.test.ts (29 tests)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events entrar 5 (mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-218 on a production build: rendering, settling and hovering the detail of an in-window online event issues no request to /entrar and records no attendance; a real tap then records via online"
    requirement: "EVENT-04"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events-prefetch.spec.ts via playwright.pwa.config.ts (iphone-chromium: 1 passed, 2 skipped by design)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The online variant reads as the approved sketch 006 surface 4 on a real phone, and a calendar app's tap on the exported /entrar link reaches the installed PWA's session (RESEARCH A3: on iOS the PWA cookie jar is separate from Safari's)"
    requirement: "EVENT-04"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved design and the iOS/Android calendar-app hand-off need a real device; real-device UAT is blocked locally until 01.1 (phones cannot reach *.localhost)"
  - id: D8
    description: "Prohibition (flagged-unverified): the raw meeting URL never reaches a member outside the moment the gate lets them through (no page, payload, DOM attribute, catalog string, log line, event payload, .ics or Google link)"
    requirement: "EVENT-04"
    verification:
      - kind: integration
        ref: "142 facts 14/17/18/19/20 (null URL on every refusal); events-checkin.test.ts#enter 1, 4, 6"
        status: pass
      - kind: e2e
        ref: "events.spec.ts#events entrar: detail, list and aviso page.content() never contain meet.example.test"
        status: pass
    human_judgment: true
    rationale: "The gate, the pages and the logs are proved here; the calendar export (.ics and the Google link) is 06-08's, so the prohibition stays open until that plan lands"

duration: 25min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 06: EVENT-04 online, `Entrar` Summary

**For an online event, tapping `Entrar` is the check-in. `app.events_enter` (SECURITY DEFINER) decides at the instant of the tap whether the member may go through, records the online check-in inside the window, and releases the meeting URL only when the answer is yes. The web's `GET /eventos/{id}/entrar` turns that answer into a 303 to the stored https URL, or into one of three named refusal screens. It answers 204 to prefetches and framework fetches, and never reads a destination from the request. A production-build spec proves that rendering the detail records nothing.**

## Performance

- **Duration:** about 25 min (1,506 s)
- **Started:** 2026-09-27T19:30:31Z
- **Completed:** 2026-09-27T19:55:37Z
- **Tasks:** 2 of 2
- **Files modified:** 29 (7,279 insertions, 39 deletions; about 5,500 of the insertions are the drizzle-kit meta snapshot)

## Accomplishments

- **The gate lives in Postgres (Task 1).** `app.events_enter(p_event_id)` follows the 06-05 posture:
  - it runs as its owner with `search_path = ''`;
  - every statement filters `tenant_id = app.tenant_id()` and, where relevant, `user_id = app.user_id()`;
  - it returns outcomes and never raises;
  - it is revoked from public and granted to `authenticated`.
- **The order of the checks.** `not_found` (no claims, not online, another tenant's), then `cancelled`, then `ended`. Before the window, `forward` (after `Vou`, recording nothing) or `confirm_first`. Inside the window, `already` (rejoin) or one upsert that records `checked_in` / `walk_in` with `checkin_via = 'online'`. A racing loser re-reads and answers `already`. The URL is read from `event_secrets` only on the three passing outcomes.
- **The route (Task 1).** `POST /v1/events/{id}/enter` is guarded by `requirePermission('events.attendance.respond')`. `enterEvent` maps the row after `withTenantTx`: a bare 404 for `not_found`, 200 `{ outcome, meetingUrl }` otherwise, parsed by the strict `enterResultSchema`, whose refine requires the URL exactly on `forward` / `recorded` / `already`. `event.checked_in` fires with `via: 'online'` on `recorded` only. The log line carries the outcome, never the URL.
- **Tests (Task 1).** pgTAP 142 gains facts 12-20 (plan 43 → 65). The integration file gains a 6-test `enter` describe, which includes the concurrent pair. Isolation b4 adds the enter crossing and its host mismatch. The unit suites gain contract cases 21-22 and service cases 21-24.
- **`/entrar` (Task 2).** The route handler:
  - answers `204 no-store` to `Sec-Purpose` / `Purpose` prefetch, `Next-Router-Prefetch` and any `RSC` fetch;
  - sends a malformed id to the detail;
  - calls `enterEvent`;
  - answers 303 to the database's https URL (re-parsed with `new URL()`), with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`;
  - sends refusals to `/entrar/aviso?motivo=encerrado|cancelado|confirmar`, and not-found and errors to the detail.

  It reads no query parameter and no header as a destination.
- **The aviso page (Task 2).** One `PageHeader` + `EmptyState plain` layout, using `CalendarClock` / `CalendarX2` / `Lock` and the catalog's title and body, with an outline "Ver evento". Any `motivo` other than one of the three exact values redirects to the detail.
- **The online rows (Task 2).** `EventActions` draws, exactly as the sketch does:
  - P0 after `Vou`: an outline `Entrar` and "A transmissão começa às {time}." (the server passes `startTime`);
  - P0 otherwise: the `Lock` hint;
  - P1/P2: a brand `Entrar` and "Ao entrar, sua presença é registrada.";
  - once checked in, in the window: the brand `Entrar` alone, to rejoin;
  - cancelled, P1/P2: a disabled `Entrar`.

  Every `Entrar` is a plain `<a target="_blank" rel="noopener noreferrer" data-no-prefetch>`.
- **Calendar links survive a login (Task 2).** `isContinuablePath` also accepts `/eventos/{uuid}` and `/eventos/{uuid}/entrar` (lowercase only). The open-redirect rules are unchanged, and the new `continue-path.test.ts` pins both.
- **The proofs (Task 2).**
  - The dev e2e `events entrar` (5 tests) runs every outcome through `page.request.get(…, { maxRedirects: 0 })`, checks the prefetch 204s and the aviso screens, asserts that no page contains the meeting host, and runs the logged-out calendar tap end to end.
  - `events-prefetch.spec.ts` on the production build proves that a render, `networkidle` and a hover fire no `/entrar` request and record nothing, and that a real tap then records via online.

## Task Commits

1. **Task 1 [BLOCKING schema]: `app.events_enter`, `POST /v1/events/{id}/enter`, `event.checked_in` via online, pgTAP 142 facts 12-20, the integration and isolation cases.** `e7d073d` (feat)
2. **Task 2: `/entrar`, the aviso page, the online action-zone rows, the continue path, the dev and production e2e.** `ed44242` (feat)

**Plan metadata:** the `docs(06-06)` commit that adds this file and updates STATE.md / ROADMAP.md.

## Verification run

- **Module and API.**
  - `pnpm --filter @rede-social/module-events typecheck`, `lint` and `test` pass (67 tests).
  - `pnpm --filter @rede-social/api typecheck`, `lint` and unit tests pass (19 tests).
  - `pnpm boundaries` reports no issues.
- **Migrations.** `pnpm db:generate` printed "No schema changes". After the commit, `git status -- supabase/migrations` is clean.
- **Database.**
  - `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: 17 files, 506 tests, PASS (142 plans 65).
  - `pnpm --filter @rede-social/api exec vitest run tests/integration/events-checkin.test.ts`: 13 passed. `isolation.test.ts`: 27 passed. `pnpm test:integration` (the whole folder): 34 files, 573 tests passed.
- **Web.**
  - `pnpm --filter @rede-social/web typecheck` and `lint` pass.
  - `vitest run lib/continue-path "app/(app)/eventos" i18n lib/events-view`: 509 passed. The whole web unit suite: 36 files, 848 passed.
  - `check-ui-literals` is OK.
  - `pnpm --filter @rede-social/web build` passes, with `/eventos/[eventId]/entrar` and `/entrar/aviso` dynamic (ƒ). `check-static-routes.sh`: 49 guarded routes, 0 offenders.
- **Playwright.**
  - `-g "events entrar" --project=mobile-chromium`: 5 passed.
  - The whole `events.spec.ts` + `events-prefetch.spec.ts` on dev, both projects: 40 passed and 18 skipped (the phone-only cases on desktop, plus the prefetch spec self-skipping without `PWA_PROD`).
  - `playwright test --config playwright.pwa.config.ts events-prefetch.spec.ts`: 1 passed on iphone-chromium, and 2 skipped by design (one throwaway tenant, one project).
- **Teardown check.** 0 `e2e-events-*` tenants, 0 GoTrue users and 0 events remain. No server was left listening on :3000, :3100 or :8787.
- **Acceptance greps.**
  - Migration: `security definer`, `set search_path = ''`, the revoke and the grant each appear once outside comments; `raise exception` appears 0 times; `tenant_id = v_t` appears 6 times.
  - Routes and service: `requirePermission('events.attendance.respond')` appears 3 times, and no log call mentions a URL.
  - Route handler: `Sec-Purpose` 2, `status: 204` 1, `https:` 3, `searchParams` 0.
  - `EventActions.tsx`: no `next/link`; `data-no-prefetch` 3.
  - `eventos` in `continue-path.ts`: 3. `events-prefetch` in the PWA config: 1. The REQUIRED_KEYS entry: 1.

## Decisions Made

See `key-decisions` in the frontmatter. In short:

- Before the window, a present member is forwarded like a `Vou`.
- Every framework (`RSC`) fetch gets the prefetch 204 (deviation 1).
- A gate answer with the wrong shape is a 500, never a response.
- The refusal constants live in `events-view.ts`.
- The e2e proves arrival at the meeting host by the navigation request.
- EVENT-04 stays Pending until 06-08 and 06-09 land.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] `/entrar` answers 204 to any Next framework fetch (`RSC`), not only to announced prefetches**
- **Found during:** Task 2 (the logged-out calendar e2e)
- **Issue:** After the login, the login server action's `redirect('/eventos/{id}/entrar')` makes the Next server fetch that target with `RSC: 1`, to inline its payload (`action-handler.js` `createRedirectRenderResult`). That `fetch` follows redirects. The server itself therefore reached the gate, recorded the check-in, and then issued a GET to the admin-supplied meeting URL from inside the deployment. The dev log showed `failed to get redirect response … ENOTFOUND meet.example.test`: a blind server-side request to a tenant-admin URL.
- **Fix:** `isNotANavigation` returns 204 no-store for `RSC` (and `Next-Router-Prefetch`) as well as `Sec-Purpose` / `Purpose` prefetch. The framework gets a non-flight answer and falls back to a real document navigation, so only the browser's own top-level GET reaches the gate and follows the 303. The header comment documents why.
- **Verification:** `route.test.ts` pins the 204 for `RSC: 1` and asserts that the API is not called. The e2e logged-out test still lands in the meeting, counted, and the server's `ENOTFOUND` log line is gone. A hand-made `RSC: 1` request from Playwright is answered 307 by Next itself (a missing cache-busting parameter) before the handler runs, so that case is unit-tested rather than e2e-tested.
- **Committed in:** `ed44242`

**2. [Rule 3 - Tree drift, orchestrator note 2] The pgTAP file is `supabase/tests/142-event-checkin.sql`, not 132**
- **Found during:** Task 1
- **Fix:** Extended 142 (plan 43 → 65, fixtures `…f1`-`…f9`). The migration header and this summary name 142.
- **Committed in:** `e7d073d`

**3. [Rule 2 - SCHEMA-CONVENTIONS §(j) rule 2] The enter route joins isolation case b4**
- **Found during:** Task 1
- **Issue:** Every new endpoint needs its cross-tenant case, and `isolation.test.ts` is not in the plan's list.
- **Fix:** b4 POSTs `/enter` on every lab event from the demo lane and asserts a bare 404, no `meet.example.test` in the body, and nothing written. It also asserts that the POST presented on the lab host is `403 TENANT_HOST_MISMATCH`.
- **Committed in:** `e7d073d`

**4. [Rule 2 - Missing test] Unit coverage for the enter contract and service paths**
- **Found during:** Task 1
- **Fix:** `events-payload.test.ts` cases 21-24 cover `recorded` emitting via online, `forward` / `already` emitting nothing, refusals with a null URL, a mis-shaped gate answer giving a 500, and the bare 404.
- **Committed in:** `e7d073d`

**5. [Rule 1 - Test hygiene] The integration `enter` describe does not move the seeded lab event**
- **Found during:** Task 1
- **Issue:** The first draft moved the lab's online event into the window, which drifts seed state other files count (the memory note on seed drift).
- **Fix:** The lab event stays where the seed put it. From the demo lane it must be a bare 404, which is never the lab's own `confirm_first`. The DB was reset before Task 2's runs.
- **Committed in:** `e7d073d`

**6. [Rule 2 - Missing test] `entrar/route.test.ts`**
- **Found during:** Task 2
- **Issue:** The plan pins the handler only through greps and the e2e. The open-redirect negatives and the non-https re-check were not unit-proved.
- **Fix:** 18 tests with `enterEvent` mocked: the prefetch families, the exact 303 target and its headers, non-https / garbage stored URLs going to the detail, every refusal, not-found / error / bootstrap redirects, malformed and uppercase ids, and query / Referer / forged headers ignored.
- **Committed in:** `ed44242`

**7. [Rule 3 - Testability] The refusal constants live in `lib/events-view.ts`**
- **Found during:** Task 2
- **Issue:** `lib/events.ts` imports `apiFetch` (env at import), which made the route handler untestable without the server env.
- **Fix:** `EVENT_ID_RE`, `ENTER_NOTICE_REASONS` and `ENTER_NOTICE_FOR` sit in `events-view.ts` (pure). `enterEvent` stays in `lib/events.ts`.
- **Committed in:** `ed44242`

**8. [Rule 3 - Test mechanics] The meeting host is proved by the navigation request, not by `context.route`**
- **Found during:** Task 2 (the first e2e run)
- **Issue:** Playwright routes only the FIRST url of a redirect chain, so `context.route('https://meet.example.test/**')` never fulfilled the 303's target. The page ended on `chrome-error://`, although the trace showed the correct `303 → https://meet.example.test/agora`.
- **Fix:** Test 5 and the production spec wait for the browser's navigation request to the stored URL and assert that its `redirectedFrom()` is `/eventos/{id}/entrar`. The plan's other assertions (attendance recorded via online, no page containing the host) are unchanged.
- **Committed in:** `ed44242`

**9. [Rule 3 - Adaptation] The prefetch capture matches `/eventos/{id}/entrar`, on the context**
- **Found during:** Task 2
- **Issue:** The plan's `/\/entrar(\?|$)/` also matches the login page `/entrar` the spec itself visits.
- **Fix:** The capture starts after the login and matches `/eventos/[^/?#]+/entrar(\?|$)` on the pathname. It runs on the BROWSER CONTEXT (not the page), so service-worker traffic counts too. The same test's positive control proves the matcher sees a real tap. The spec runs on one PWA project only (`iphone-chromium`), because web and API cache host → tenant for 60 s.
- **Committed in:** `ed44242`

**10. [Rule 3 - Adaptation] `EventActionState` gains `startTime`, and 06-05's online "nothing" assertions became the 06-06 rows**
- **Found during:** Task 2
- **Fix:**
  - `EventDetailView` and `EventActionState` carry the start as the tenant's `HH:MM` for the P0 hint, so the island formats nothing. `events-view.test.ts` case 20 pins it.
  - `EventActions.test.tsx` cases 1f and 1i, which asserted "nothing" for the online rows 06-05 left to this plan, now assert the in-person halves. The online rows are 7a-7i, including the exhaustive 96-combination sweep.
- **Committed in:** `ed44242`

**11. [Rule 3 - Adaptation] `grep -c events-prefetch playwright.pwa.config.ts` must print 1**
- **Found during:** Task 2 (the acceptance greps)
- **Fix:** The config's doc comment says "the events prefetch spec", so only `testMatch` carries the literal.
- **Committed in:** `ed44242`

---

**Total deviations:** 11. Rule 1: 1. Rule 2: 4. Rule 3: 6.
**Impact on plan:** Deviation 1 closes a real server-side request that the plan's mechanism would otherwise have shipped. The rest adapt to the current tree or strengthen the proofs. There is no scope creep: `Participantes` (06-07), the Início card's `Entrar` and the calendar export (06-08) remain those plans' work.

## Issues Encountered

- The browser logs "Service Worker registration blocked by Playwright" and an `unhandledRejection` reading `waiting` in the dev e2e, as in 06-03 through 06-05. Both predate this plan and fail no test.
- The first integration run of the `enter` describe moved the seeded lab online event (see deviation 5). `pnpm db:reset && pnpm db:seed` ran before every Task 2 check.
- Disk went from 8.6 GB to 5.9 GB free during the production run, then settled at 6.9 GB. `.turbo/cache` was not touched. The production build writes the normal gitignored `apps/web/.next`, which was left in place.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: ssrf-via-framework-fetch | apps/web/app/(app)/eventos/[eventId]/entrar/route.ts | Next's server-action redirect handling fetches the redirect target server-side with `RSC: 1` and follows redirects. A side-effecting GET that 303s to an external, admin-supplied URL would therefore be executed by the server and would make it GET that URL. It is mitigated here by the `RSC` 204 (deviation 1). Any future route handler that redirects externally must do the same. |

The other surfaces (the definer function, the enter route, the `/entrar` GET, the widened continue cookie) are in the plan's threat model (T-06-35..T-06-43). Each `mitigate` is implemented and proved:
- **T-06-35:** pgTAP null-URL facts, the integration null-URL cases, and the e2e page-content checks.
- **T-06-36:** `route.test.ts`'s open-redirect negatives, `searchParams` 0, and the https re-check.
- **T-06-37:** the production spec and the 204 cases.
- **T-06-38:** pgTAP 20 and isolation b4.
- **T-06-40:** `Referrer-Policy: no-referrer`, asserted in the unit test and the e2e.
- **T-06-41:** `continue-path.test.ts`.
- **T-06-42:** the concurrent pair.
- **T-06-43:** pgTAP 12.

T-06-39 is accepted, as planned.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 06-07 (`Participantes`) reads `checkin_via = 'online'` rows as written here, and shows its online note in place of the code.
- 06-08 (the Início card and the calendar export) reuses this plan's `Entrar` anchor shape (a plain `<a>` with `data-no-prefetch`, never `next/link`). Its calendar exports carry `…/eventos/{id}/entrar`, which now survives a logged-out tap. That plan owns the calendar half of the meeting-URL prohibition (D8).
- EVENT-04 stays Pending in REQUIREMENTS.md until 06-08 and 06-09 (which also declare it) finish.
- Phase 6 progress: 6 of 9 plans complete (06-01 through 06-06). Real-phone UAT of the online variant and of the calendar-app hand-off (D7) waits on 01.1.

---
*Phase: 06-events*
*Completed: 2026-09-27*

## Self-Check: PASSED

- All 7 key created files exist on disk.
- Commits `e7d073d` and `ed44242` are in `git log`. `git rev-list --count 12988b8..HEAD` measured 2 before the docs commit.
- The sketch 006 README and MANIFEST were neither modified nor staged by this plan.
