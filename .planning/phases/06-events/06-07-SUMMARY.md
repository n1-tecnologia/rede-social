---
phase: 06-events
plan: 07
subsystem: events
tags: [events, attendance, participantes, keyset, check-in-code, regenerate, hono, drizzle, pgtap, playwright, next]

requires:
  - phase: 06-events (06-03)
    provides: event_attendances with the status vocabulary, the two chip indexes, the guard trigger, the D-219 counts
  - phase: 06-events (06-04)
    provides: the manage card on the detail page, the ConfirmDialog control pattern, the edit read through event_secrets_staff_all
  - phase: 06-events (06-05)
    provides: app.events_check_in (the door code comparison), secretsFor / addEventsMember / attendanceFor e2e fixtures
  - phase: 06-events (06-06)
    provides: the rule that any side effect stays a POST (server action), never a GET a prefetch can follow
provides:
  - GET /v1/events/{id}/attendance (confirmed | present | not_going keysets) and GET /v1/events/{id}/attendance/summary, both under the literal events.attendance.read
  - POST /v1/events/{id}/checkin-code (D-217 regeneration) under the literal events.event.manage
  - listAttendance, getAttendanceSummary, regenerateCheckinCode (server exports)
  - ATTENDANCE_LISTS, attendanceQuerySchema, attendeeSchema, attendancePageSchema, attendanceSummarySchema, checkinCodeSchema (contracts)
  - CheckinCodeCard and AttendeeRow (module UI)
  - /eventos/[eventId]/participantes with ParticipantsList, RegenerateCodeControl, ActiveChipInView
  - the "Participantes" manage-card row with the '{n} confirmados · {m} presentes' sub-line
affects: [06-08, 06-09, phase-07-notifications, pilot-UAT]

actuals:
  tokens: 33305
  tasks: 2
  commits: 2
plan_head_before: 9d581430396846cc3f897bb73c8df2f00826c92a

tech-stack:
  added: []
  patterns:
    - "Three literal keyset statements picked in TypeScript, the list value never bound (the listEvents period rule, now for three chips)"
    - "A decoded cursor instant is regex-checked before it reaches ::timestamptz, so a tampered n degrades to page 1 instead of a 500"
    - "Regeneration draws two distinct CSPRNG candidates and the UPDATE keeps the one that differs from the stored code, so the new code is always new"
    - "A spelled accessible name as an sr-only twin of aria-hidden glyphs (ARIA refuses aria-label on a generic <p>)"
    - "An RSC page rendered in a component test by awaiting the default export with its loaders, bootstrap and navigation mocked"

key-files:
  created:
    - packages/modules/events/ui/CheckinCodeCard.tsx
    - packages/modules/events/ui/AttendeeRow.tsx
    - packages/modules/events/tests/participants-ui.test.tsx
    - apps/api/tests/integration/events-attendance.test.ts
    - apps/web/app/(app)/eventos/[eventId]/participantes/page.tsx
    - apps/web/app/(app)/eventos/[eventId]/participantes/ParticipantsList.tsx
    - apps/web/app/(app)/eventos/[eventId]/participantes/ParticipantsList.test.tsx
    - apps/web/app/(app)/eventos/[eventId]/participantes/RegenerateCodeControl.tsx
    - apps/web/app/(app)/eventos/[eventId]/participantes/ActiveChipInView.tsx
  modified:
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/ui/index.ts
    - packages/modules/events/tests/contracts.test.ts
    - packages/modules/events/tests/events-payload.test.ts
    - supabase/tests/141-event-attendances.sql
    - apps/api/tests/integration/isolation.test.ts
    - apps/web/lib/events.ts
    - apps/web/lib/events-view.ts
    - apps/web/lib/events-view.test.ts
    - apps/web/messages/pt-BR/events.json
    - apps/web/i18n/messages.test.ts
    - apps/web/app/(app)/eventos/actions.ts
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "06-07: regeneration is refused (bare 404) for an ONLINE event: the online card shows no code, Entrar is the online check-in, and rotating a code nobody can use would only confuse the audit trail"
  - "06-07: the regeneration server action does not return the new code to the client; the control calls router.refresh() and the RSC summary read shows it (the code travels only in the admin's RSC payload)"
  - "06-07: support_tenant does NOT see the door code or the list in V1 (RESEARCH open question 1). Widening is one manifest line (events.attendance.read for support_tenant) plus one ALTER POLICY on event_secrets_staff_all; asked at the pilot UAT"

patterns-established:
  - "Attendance chips: one literal statement per chip, riding its index by name (141 pins both), microsecond cursors, (instant, id) desc total order"
  - "Admin-only screens gate on the composed permission in bootstrap.permissions and call notFound() (never a role comparison), with the API's literal guard as the second gate"

requirements-completed: [EVENT-05]

coverage:
  - id: D1
    description: "The three attendance chips page exactly: fixture rows per chip, walkIn only on the walk-in, adjacency under a forced tie with limit=1, deep-equal repeated requests, empty and past-the-end answers"
    requirement: EVENT-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-attendance.test.ts#2, #4, #5, #6, #11"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/events-payload.test.ts#25-27"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pitfall 11: the summary names pendingConfirmedCount (going) and confirmedCount (going + checked_in), with presentCount and notGoingCount; a removed member still counts"
    requirement: EVENT-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-attendance.test.ts#3, #7"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/contracts.test.ts#25"
        status: pass
    human_judgment: false
  - id: D3
    description: "The chip statements ride event_attendances_tenant_event_status_idx and event_attendances_tenant_event_checkin_idx by name, with no Sort node"
    requirement: EVENT-05
    verification:
      - kind: other
        ref: "supabase/tests/141-event-attendances.sql fact 12 (pnpm supabase test db, 510/510)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Authorisation: a member is 403 on the list, the summary and the regeneration; a lab event id is a bare 404 on all three; the web route is notFound() without events.attendance.read"
    requirement: EVENT-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-attendance.test.ts#1, #10; isolation.test.ts f2"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events participantes 5"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-217 regeneration: a new code in the alphabet, different from the old one; the old code is 409 wrong_code, the new one checks in, check-ins are kept; the web control confirms and shows the new code"
    requirement: EVENT-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-attendance.test.ts#9"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events participantes 1-4 (step 4)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The Participantes screen: the code card first (spelled for screen readers), three counted chips, rows with the walk-in tag in Presentes, removed members, per-chip empties and errors, and the manage-card row '3 confirmados · 2 presentes'"
    requirement: EVENT-05
    verification:
      - kind: automated_ui
        ref: "apps/web/app/(app)/eventos/[eventId]/participantes/ParticipantsList.test.tsx (13 cases)"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/participants-ui.test.tsx (6 cases)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events participantes 1-4"
        status: pass
    human_judgment: false
  - id: D7
    description: "UI E11 backstop: three four-digit chips at 320px scroll horizontally without a clipped label, the active chip is whole on load, and the code is legible at arm's length at the door"
    requirement: EVENT-05
    verification:
      - kind: automated_ui
        ref: "ParticipantsList.test.tsx#1 (classes and DOM only; happy-dom has no layout)"
        status: pass
    human_judgment: true
    rationale: "The plan marks this truth `verification: backstop`: horizontal scroll and arm's-length legibility need a real phone, which waits on 01.1 (phones cannot reach *.localhost)"

duration: 23min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 07: Participantes Summary

**The organiser's attendance screen: three literal keyset chips (Confirmados = going only, Presentes with walk-ins tagged "Sem confirmação", Não vão) over their named indexes, one summary read carrying both "confirmados" numbers and the door code from the admin-only secrets table, and D-217 code regeneration behind a danger confirm.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-09-27T20:00:38Z
- **Completed:** 2026-09-27T20:24:22Z
- **Tasks:** 2
- **Files modified:** 28

## Accomplishments

- `GET /v1/events/{id}/attendance?list=confirmed|present|not_going` and `GET /v1/events/{id}/attendance/summary`, both under the literal `requirePermission('events.attendance.read')` (admin_tenant only in V1). `POST /v1/events/{id}/checkin-code` is under the literal `events.event.manage`.
- `listAttendance` runs three literal statements, and the list value is never bound. It checks the event in-lane first (a bare 404), uses the feed's member join (`removed` when the membership is gone, and the row still counts), microsecond cursors, and a total `(instant, id) desc` order. `141-event-attendances.sql` (plan 22 → 26) pins both chip plans by index name, with no Sort node.
- `getAttendanceSummary` is one statement. `pendingConfirmedCount` (going) and `confirmedCount` (going + checked_in) keep separate names (Pitfall 11). The code is read through `event_secrets_staff_all` and is null for an online event.
- `regenerateCheckinCode` always issues a new code and stamps `code_rotated_at`. After it runs, the old code gets `wrong_code` and existing check-ins stay. It emits nothing and logs no code.
- `/eventos/[eventId]/participantes`:
  - the code card comes first;
  - the chip nav holds three counted chips and scrolls horizontally, keeping the active chip in view;
  - rows are not links, and walk-ins carry "Sem confirmação" in Presentes only;
  - each chip has its own empty state, plus a first-load error and a load-more error;
  - pull-to-refresh and six row skeletons are included;
  - "Gerar novo código" appears only with the manage permission.
- The detail page's manage card has a "Participantes" row with "{n} confirmados · {m} presentes", taken from the same detail read.

## Task Commits

1. **Task 1: the attendance API, summary, regeneration, index pins and the integration battery.** `ff12253` (feat)
2. **Task 2: the Participantes screen, the module UI, the manage-card row, the catalog, the tests and the e2e.** `7064562` (feat)

**Plan metadata:** see the docs commits that follow.

## Files Created/Modified

- `packages/modules/events/contracts/index.ts`: the attendance contracts (list enum, attendee without email or role, page, summary with both counts, code).
- `packages/modules/events/server/service.ts`: `listAttendance`, `getAttendanceSummary`, `regenerateCheckinCode`.
- `packages/modules/events/server/routes.ts` / `index.ts`: the three routes with their literal guards, and the exports.
- `packages/modules/events/ui/CheckinCodeCard.tsx`, `AttendeeRow.tsx`: the presentational pieces, which ship no words.
- `supabase/tests/141-event-attendances.sql`: the volume fixture now mixes all four statuses (events inside the window), and fact 12 adds the two named-index pins.
- `apps/api/tests/integration/events-attendance.test.ts`: 12 cases. `isolation.test.ts`: the f2 host-mismatch loop gains both reads.
- `apps/web/lib/events.ts`: `getAttendance`, `loadAttendance`, `loadAttendanceSummary`, `regenerateCode`.
- `apps/web/lib/events-view.ts`: `attendeeView`, `spelledCode`, `attendanceListFromParam`, `participantsHref`, `ATTENDANCE_LIST_PARAMS`.
- `apps/web/app/(app)/eventos/actions.ts`: `loadMoreAttendanceAction`, `refreshAttendanceAction`, `regenerateCheckinCodeAction`.
- `apps/web/app/(app)/eventos/[eventId]/participantes/*`: the page, the list, the regenerate control, the active-chip helper and the component test.
- `apps/web/app/(app)/eventos/[eventId]/page.tsx`: the Participantes manage row.
- `apps/web/messages/pt-BR/events.json` plus `messages.test.ts`: the `participants.*`, `confirm.regenerate.*`, `toasts.codeRegenerated`, `state.walkIn`, `manage.participants*` and `errors.regenerate` keys, pinned.
- `apps/web/e2e/events.spec.ts` / `events-admin.ts`: the `events participantes` describe and the `eventsApiAs` helper.
- `scripts/check-static-routes.sh`: the route added to `REQUIRED_KEYS`.

## Decisions Made

- An online event's regeneration is a bare 404. The online card shows no code, and `Entrar` is the online check-in.
- The regeneration action does not hand the new code to the client. The control refreshes, and the RSC summary read shows the new code.
- `support_tenant` keeps no access in V1. The pilot is asked about it (see UAT questions).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Tree drift, orchestrator note 2] The pgTAP file is `supabase/tests/141-event-attendances.sql`, not 131**
- **Found during:** Task 1
- **Fix:** Extended 141 (plan 22 → 26). The acceptance grep was run against 141.
- **Committed in:** `ff12253`

**2. [Rule 3 - Blocking] The volume fixture in 141 had no check-ins**
- **Found during:** Task 1
- **Issue:** The `present` chip's partial index cannot be pinned on a fixture whose rows are all `going` / `not_going`. The volume events started in a day, so the guard refused any check-in.
- **Fix:** The volume events start in 30 minutes (inside the window), and `u % 4` mixes `not_going`, `going`, `checked_in` and `walk_in` with distinct instants. Fact 11 (the count aggregate on its index) still passes.
- **Committed in:** `ff12253`

**3. [Rule 2 - Missing validation] A tampered cursor instant would be a 500**
- **Found during:** Task 1
- **Issue:** `decodeCursor` only proves `n` is a string, so `n: 'abc'` reached `::timestamptz` and failed there.
- **Fix:** `listAttendance` accepts a cursor only when `n` matches the ISO microsecond shape. Anything else is page 1 (unit case 27). `listEvents` has the same latent gap. It is out of scope and left unchanged.
- **Committed in:** `ff12253`

**4. [Rule 2 - Correctness] A regenerated code is always different, and an online event is not rotated**
- **Found during:** Task 1
- **Issue:** One random draw repeats the stored code 1 time in 923,521, which would leave a leaked code working. An online event's code is never used.
- **Fix:** Two distinct candidates are drawn, and the UPDATE keeps whichever differs from the stored code. `event_format = 'in_person'` and a live-event `exists` guard the UPDATE (unit case 29, integration case 9).
- **Committed in:** `ff12253`

**5. [Rule 2 - SCHEMA-CONVENTIONS §(j) rule 2] The attendance reads join the isolation f2 loop**
- **Found during:** Task 1
- **Issue:** Every new endpoint needs its cross-tenant host case, and `isolation.test.ts` is not in the plan's list.
- **Fix:** Both GETs are in the f2 host-mismatch loop. The regeneration POST's host mismatch and the lab-id 404s are in `events-attendance.test.ts` case 10.
- **Committed in:** `ff12253`

**6. [Rule 2 - Missing test] Unit coverage for the new contracts and service paths**
- **Fix:** `contracts.test.ts` cases 23-26 and `events-payload.test.ts` cases 25-29 cover the literal statements, the list value never being bound, the 404 checked first, the over-fetch cursor, the tampered cursor, the two summary names, and the two distinct candidates.
- **Committed in:** `ff12253`

**7. [Rule 1 - Accessibility] The spelled code is an `sr-only` twin, not an `aria-label` on a `<p>`**
- **Found during:** Task 2 (Biome `useAriaPropsSupportedByRole`)
- **Issue:** ARIA does not support `aria-label` on a generic `<p>`, and screen readers ignore it there.
- **Fix:** The glyphs are `aria-hidden`, and an `sr-only` span carries "Código K, 7, Q, M". Both are pinned in `participants-ui.test.tsx`, and the e2e reads the glyphs through `data-testid="checkin-code"`.
- **Committed in:** `7064562`

**8. [Rule 2 - Missing critical] An `errors.regenerate` string and a `participants.region` label**
- **Found during:** Task 2
- **Issue:** A failed regeneration needs an error toast, and the list region needs an accessible name (the EventsList precedent). The UI-SPEC lists neither.
- **Fix:** Added "Não foi possível gerar um novo código. Tente novamente." and "Participantes do evento". Both are pinned in `messages.test.ts`.
- **Committed in:** `7064562`

**9. [Rule 3 - Adaptation] The chip counts use ICU `{count, number}`**
- **Found during:** Task 2
- **Issue:** The E11 backstop label "Confirmados · 1.204" needs pt-BR thousands grouping.
- **Fix:** `participants.filter.*` uses `{count, number}`, and `messages.test.ts` formats 1204 as "1.204".
- **Committed in:** `7064562`

**10. [Rule 2 - UI E11/overflow] `ActiveChipInView` keeps the active chip whole on load**
- **Found during:** Task 2
- **Issue:** At 320px with four-digit counts, "Não vão" can start outside the scrolled row. The plan requires it to be "fully visible on load".
- **Fix:** A render-nothing client sibling scrolls the NAV (never the page) when the active chip overflows its right edge. The nav is `relative`, so `offsetLeft` is measured against it. The nav markup, including `overflow-x-auto`, stays in `page.tsx`.
- **Committed in:** `7064562`

**11. [Rule 3 - Testability] `ParticipantsList.test.tsx` renders the RSC page itself**
- **Found during:** Task 2
- **Issue:** The chip nav (the E11 backstop's subject) lives in `page.tsx`, not in the client list.
- **Fix:** The test awaits the page's default export, with the loaders, bootstrap, navigation and actions mocked and the real catalog loaded. It renders the page inside a 320px container and a `ToastProvider`. There are 13 cases (7 page, 6 list). happy-dom has no layout, so the visual half of the backstop stays with the phone UAT.
- **Committed in:** `7064562`

**12. [Rule 3 - Adaptation] `AttendeeRow` takes `avatarUrl`, not a variant ladder**
- **Issue:** Every other avatar in the web app uses the stable `avatarUrlFor(assetId)` path (`/v1/media/{id}/w128`) with the `Avatar` primitive. `avatarVariantWidths` is still in the contract, as the plan specifies, and the web does not use it.
- **Committed in:** `7064562`

**13. [Rule 3 - Test mechanics] The e2e answers go through `eventsApiAs`, and the regenerate tap is retried until React owns it**
- **Found during:** Task 2 (the first e2e run)
- **Issue:** The plan says "answers written through the member APIs", and no e2e helper called the API as a throwaway tenant's member. The first run's regenerate tap landed before hydration and opened no dialog.
- **Fix:** Added `eventsApiAs` to `events-admin.ts`. It signs the member in through GoTrue's password grant and calls `PUT /rsvp` and `POST /check-in` with the tenant's host. The regenerate tap is wrapped in `expect(...).toPass`, like `typeCode`. Steps 1-3 were green on the first run.
- **Committed in:** `7064562`

**14. [Minor, plan example] 2026-10-11 is a Sunday**
- The sketch's "Check-in em sex., 11 de out." is illustrative. `events-view.test.ts` case 27 pins Intl's `dom., 11 de out.`, following 06-01's deviation 2.

---

**Total deviations:** 14. Rule 1: 1. Rule 2: 6. Rule 3: 6. Minor note: 1.
**Impact on plan:** All were needed for correctness, security, the gates or the current tree. There is no scope creep: the Início card (06-08) and the phase gates (06-09) are untouched.

## Issues Encountered

None. Every gate was green on the final run:
- module `test`, `typecheck` and `lint`;
- api `typecheck`, `pnpm boundaries`, and `db:generate` (no migration);
- `db:reset`, `db:seed`, and `supabase test db` (510/510);
- the attendance integration file (12/12) and the full integration suite (585/585);
- web `typecheck` and `lint`;
- web vitest on `app/(app)/eventos`, `lib/events-view` and `i18n` (529);
- `check-ui-literals`, the web `build` (the route builds as ƒ), and `check-static-routes` (50 guarded, 0 offenders);
- Playwright `events participantes|events admin` on mobile-chromium (5/5; desktop skips by design).

The throwaway tenant and its GoTrue users were removed (0 left), and no dev server was left running.

## UAT questions

- **Open pilot question (RESEARCH open question 1):** should `support_tenant` (staff at the door) see the door code and the attendee list? V1 says no. Widening it takes one manifest line (`events.attendance.read` for `support_tenant` in `packages/modules/events/module.ts`) plus one generated `ALTER POLICY` on `event_secrets_staff_all`. No web edit is needed, because the manage row and the screen are gated by permission.
- **Phone check (E11 backstop, waits on 01.1):** at 320px with four-digit counts, the chip row scrolls without a clipped label and the active chip is whole on load. At arm's length, the 24/700 code reads clearly at the door.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 7 of 9 Phase 6 plans are complete. 06-08 (the Início "Próximo evento" card and the calendar export) is next.
- Real-phone UAT of Participantes joins the queue that waits on 01.1.

## Self-Check: PASSED

- All nine created key files exist on disk.
- Commits `ff12253` and `7064562` are in `git log`.
- No stub patterns were found in the created files (the only "placeholders" match is the skeleton rows' Biome rationale).

---
*Phase: 06-events*
*Completed: 2026-09-27*
