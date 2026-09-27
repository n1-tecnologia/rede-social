---
phase: 06-events
plan: 05
subsystem: events
tags: [events, check-in, walk-in, security-definer, guess-bound, venue-code, pgtap, playwright, motion, D-208, D-209, D-216, D-217, UI-D-207, UI-D-208, EVENT-04]

requires:
  - phase: 06-events (06-01)
    provides: events + event_secrets (the admin-only checkin_code), generateCheckinCode, events-view.ts, EventCover geometry "ticket", events-admin.ts fixtures
  - phase: 06-events (06-02)
    provides: sketch 006 surface 3 (ingresso-*) and the action-zone rows, approved provisionally 2026-09-27 (the D-33 gate for Task 2)
  - phase: 06-events (06-03)
    provides: event_attendances + the guard trigger that re-checks the check-in window for every writer, GET /v1/events/{id} with viewerCheckedInAt, the detail page and EventActions, the checked-in banner
  - phase: 06-events (06-04)
    provides: the cancel path (status = 'cancelled') the check-in must refuse, secretsFor, the throwaway-tenant e2e with media teardown
provides:
  - "event_checkin_attempts: the guess counter, self-select only, written only by the definer"
  - "app.events_check_in(uuid, text) SECURITY DEFINER: returns checked_in / walk_in / already / wrong_code / too_many_attempts / not_open / closed / cancelled / not_found, never raises"
  - "POST /v1/events/{id}/check-in (events.attendance.respond): 200 { outcome, checkedInAt }, 409 { event }, bare 404; mapped only after withTenantTx resolved"
  - "event.checked_in (MOD-03): once per member per event, { tenantId, eventId, userId, walkIn, via, startsAt }"
  - "contracts: EVENT_CHECKIN_MAX_FAILED, EVENT_CHECKIN_FAILED_WINDOW_MINUTES, checkinSchema, checkinResultSchema, CHECKIN_OUTCOMES, EventCheckedIn"
  - "@tria/module-events/ui EventTicket and EventInfoGrid layout=\"ticket\""
  - "/eventos/[eventId]/check-in with CheckinForm; checkInEventAction; lib/events.ts checkIn; events-view eventTicketView + checkedInLine"
  - "the in-person 'Fazer check-in' CTA in the action zone (P1/P2; disabled when cancelled; gone once checked in)"
  - "e2e fixtures addEventsMember, attendanceFor; secretsFor now returns checkinCode"
affects: [06-06, 06-07, 06-08, 06-09, phase-07-notifications]

actuals:
  tokens: 117110
  tasks: 2
  commits: 2
plan_head_before: f7351efe6c0f499418c04202cbc66b1720900f4c

tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER that RETURNS its business refusal: the service returns the row out of withTenantTx and throws only after commit, so a side-effect of the refusal (the guess counter) survives"
    - "Definer hardening: owner postgres, set search_path = '', every statement filters app.tenant_id()/app.user_id(), #variable_conflict use_column + table aliases for RETURNS TABLE, revoke from public, grant to authenticated"
    - "A write-free table (no insert/update/delete policy) whose only writer is a definer function; the member lane gets a self-select policy"
    - "Upsert with do update ... where checked_in_at is null + a re-read on zero rows: a racing second write answers 'already' instead of an empty set"
    - "A client island that swaps in place on success and focuses its heading, with a data-animate hook so the reduced-motion branch is testable"

key-files:
  created:
    - supabase/migrations/20260927185909_event_checkin_attempts.sql
    - supabase/migrations/20260927185926_event_check_in_function.sql
    - supabase/tests/142-event-checkin.sql
    - apps/api/tests/integration/events-checkin.test.ts
    - packages/modules/events/ui/EventTicket.tsx
    - packages/modules/events/tests/event-ticket.test.tsx
    - apps/web/app/(app)/eventos/[eventId]/check-in/page.tsx
    - apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.tsx
    - apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.test.tsx
  modified:
    - packages/modules/events/db/schema.ts
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/module.ts
    - packages/modules/events/tests/contracts.test.ts
    - packages/modules/events/tests/events-payload.test.ts
    - packages/modules/events/ui/EventInfoGrid.tsx
    - packages/modules/events/ui/index.ts
    - supabase/migrations/meta/_journal.json
    - supabase/tests/020-tenant-isolation.sql
    - apps/api/tests/integration/isolation.test.ts
    - apps/web/lib/events.ts
    - apps/web/lib/events-view.ts
    - apps/web/lib/events-view.test.ts
    - apps/web/messages/pt-BR/events.json
    - apps/web/i18n/messages.test.ts
    - apps/web/app/(app)/eventos/actions.ts
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventActions.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "app.events_check_in returns starts_at on every outcome after the event was found (not only on success): it is not secret and costs nothing; not_found returns nulls"
  - "The guess bound counts ONLY wrong codes: an already-present member re-submitting (any code) answers already before the counter is read, so a present member never spends or trips the bound"
  - "The ticket's Data cell prints the date without the weekday ('12 de out.'; multi-day prints its range). The cover overline keeps the full contract date"
  - "The not-open-yet {when} is two catalog fillers (checkin.opensAt 'às {time}', checkin.opensOn 'em {date}, às {time}') so no pt-BR words are built in TypeScript"
  - "checkInEventAction formats the done line on the server in the tenant zone (checkedInLine, shared with the detail banner), so the client done state never formats an instant"
  - "already is a success in the UI (the done state with the ORIGINAL stamp); the refusals map to five catalog lines, and a race (window closed / cancelled) shows the inline line then router.refresh()"
  - "EVENT-04 stays Pending in REQUIREMENTS.md: requirements.ready-ids reports 0/1 ready because 06-06, 06-08 and 06-09 also declare it"

patterns-established:
  - "Pattern: a definer-backed write is proved in pgTAP by calling it from tenant A's lane with tenant B's id (not_found AND nothing of B's written, read as the service lane) beside A's own positive control"
  - "Pattern: 'the guess committed' is proved in integration by N refusals in N SEPARATE requests and then reading the counter through adminSql"

requirements-completed: [EVENT-04]

coverage:
  - id: D1
    description: "event_checkin_attempts and app.events_check_in inside Postgres: privilege facts, going->checked_in keeping responded_at, walk-in from no row and from not_going, already without spending a guess, the 5-wrong-then-right bound and its 15-minute reset, the 61/59-minute opening edge, ends_at = now() closed, cancelled, online not_found, the cross-tenant refusal with its positive control, and a member lane that cannot write the counter"
    requirement: "EVENT-04"
    verification:
      - kind: integration
        ref: "supabase/tests/142-event-checkin.sql (plan 43; pnpm supabase test db: 17 files, 484 tests)"
        status: pass
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (event_checkin_attempts cases + B-lane symmetry, plan 148)"
        status: pass
    human_judgment: false
  - id: D2
    description: "POST /v1/events/{id}/check-in end to end: 200 checked_in / walk_in / already with the same stamp, five wrong codes in five requests then 409 too_many_attempts with failed_count 5, 409 checkin_not_open / checkin_closed / cancelled, bare 404 for online, lab and unknown ids, 400 for a malformed id or empty code, the concurrent pair recording one row, event.checked_in once with the exact six keys; the lab crossing and the host mismatch in isolation b4"
    requirement: "EVENT-04"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-checkin.test.ts (7 tests)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b4 (check-in crossing + host mismatch)"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/events-payload.test.ts#17-20 and contracts.test.ts#18-20"
        status: pass
    human_judgment: false
  - id: D3
    description: "The check-in screen: the ported boarding-pass ticket (cover, Data/Horário/Local row, perforation), the code form with its E08 states (empty, loading, wrong code kept and selected, bound lock, race refusals, done with focus and the spring, reduced motion), the not-open-yet / closed / cancelled states, online not-found"
    requirement: "EVENT-04"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/eventos/[eventId]/check-in/CheckinForm.test.tsx (8 tests)"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/event-ticket.test.tsx (6 tests)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/events-view.test.ts#22-25; apps/web/i18n/messages.test.ts#06-05"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events check-in (mobile-chromium, 4 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The action zone's 'Fazer check-in': one brand <a> in person P1/P2 (with the pair in P1, the read-only line in P2), disabled when cancelled, absent in P0/P3, online, and once checked in; the banner replaces every CTA for a walk-in too"
    requirement: "EVENT-04"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx#6a-6e (24 tests in the file)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events check-in 1-3; full events.spec.ts: 35 passed, 11 skipped"
        status: pass
    human_judgment: false
  - id: D5
    description: "UI E08 long-text backstop: the 60-character venue truncates in the Local cell at 320px on one line, the three columns stay equal, the Data cell is not cut at 390 or 320, and the ticket stays inside its 16px gutters"
    requirement: "EVENT-04"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events check-in 1 (mobile-chromium, 390 and 320)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The ticket and the check-in flow read as the approved sketch 006 surface 3 on a real phone (iOS Safari keyboard with autoCapitalize characters, the spring, the notches), and the code is usable when read aloud at a venue"
    requirement: "EVENT-04"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved design, the on-screen keyboard behaviour and the venue experience need a human on a real device; real-device UAT is blocked locally until 01.1 (phones cannot reach *.localhost)"
  - id: D7
    description: "Prohibition (flagged-unverified): 'Presente' is never recordable without being at the venue or opening the meeting link; no self check-in, no code-free path, no member-readable code, and no render, list, calendar export or unfurl records presence"
    requirement: "EVENT-04"
    verification:
      - kind: integration
        ref: "supabase/tests/142-event-checkin.sql facts 1, 5, 11; 141 fact 3 (member lane cannot write checked_in)"
        status: pass
    human_judgment: true
    rationale: "The in-person half is proved (code required, bounded, member lane cannot write presence, code never in a member payload); the online half (Entrar, D-218 render-records-nothing) and the calendar export are 06-06 and 06-08, so the prohibition stays open until those land"

duration: 29min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 05: EVENT-04 in person, the venue code Summary

**A member at the venue types the code the organiser reads aloud and becomes present: `app.events_check_in`, a SECURITY DEFINER function that compares the code where it lives, returns every refusal as an outcome so a wrong guess still counts (5 per 15 minutes), and records `checked_in` after a `Vou` or a walk-in otherwise; behind it `POST /v1/events/{id}/check-in`, `event.checked_in`, and the prototype's boarding-pass ticket with the typed-code form, reached from a single brand "Fazer check-in" in the action zone.**

## Performance

- **Duration:** about 29 min (1,733 s)
- **Started:** 2026-09-27T18:56:47Z
- **Completed:** 2026-09-27T19:25:40Z
- **Tasks:** 2 of 2
- **Files modified:** 36 (13,313 insertions, 37 deletions; about 11,000 of the insertions are the two drizzle-kit meta snapshots)

## Accomplishments

- **The comparison lives in Postgres (Task 1).** `event_checkin_attempts` has a self-select policy and no write policy. `app.events_check_in(p_event_id, p_code)` runs as its owner with `search_path = ''`. Every statement in it filters `app.tenant_id()` / `app.user_id()`, and it normalises the guess (uppercase; spaces and hyphens stripped).
- **The function's order.** It refuses `cancelled`, then `not_open` / `closed` (the D-209 window). It answers `already` before touching the counter. It checks the 5-in-15-minutes bound, then compares against `event_secrets`. A mismatch is counted and returned. A match is one upsert (`going` becomes `checked_in` and keeps `responded_at`; otherwise `walk_in`), and a racing loser re-reads and answers `already`. The function never raises, so the counter increment commits.
- **The route (Task 1).** `checkInEvent` returns the row out of `withTenantTx` and maps it afterwards: 200 `{ outcome, checkedInAt }`, `409 { event }` for the five refusals, and a bare 404 for `not_found`. It emits `event.checked_in` only on the first check-in.
- **Tests (Task 1).**
  - pgTAP 142 proves every outcome, the privilege facts, the cross-tenant refusal with its positive control, and that the member lane cannot touch the counter.
  - 020 adds the counter's isolation cases.
  - The integration file proves the five-requests bound and the concurrent pair.
- **The ticket (Task 2).** `EventTicket` (cover, the 3-column Data / Horário / Local row, the perforation, a slot) and `EventInfoGrid layout="ticket"` live in the module. `/eventos/[id]/check-in` renders one state from one request instant. `CheckinForm` implements every E08 row, and on success swaps in place to the 56px brand circle (the `motion/react` spring, still under reduced motion), which takes focus.
- **The CTA (Task 2).** In person, in P1/P2, the action zone gets ONE brand `<a>` "Fazer check-in". It is disabled when the event is cancelled and gone once the member is checked in.
- **The phone proof (Task 2).** A 4-test e2e runs in a throwaway tenant: answer Vou, then open the ticket; a wrong code; the right code; the detail banner; a walk-in recorded as `walk_in`; the not-open-yet sentence; and online not-found. It also measures the 60-character venue backstop at 390 and 320 px.

## Task Commits

1. **Task 1 [BLOCKING schema]: the code check-in inside Postgres, the route, `event.checked_in`, pgTAP 142, the isolation gate.** `0bc5cd5` (feat)
2. **Task 2: the check-in screen, the CTA, the e2e.** `d67676e` (feat)

**Plan metadata:** the `docs(06-05)` commits that add this file and update STATE.md / ROADMAP.md.

## Verification run

- `pnpm --filter @tria/module-events typecheck`, `lint` and `test` pass (61 tests). `pnpm --filter @tria/api typecheck` and `lint` pass. `pnpm boundaries` reports no issues.
- `pnpm db:generate` wrote nothing after the commit, and `git status -- supabase/migrations` is clean.
- `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: 17 files, 484 tests, PASS (142 plans 43; 020 went from 139 to 148).
- `pnpm --filter @tria/api exec vitest run tests/integration/events-checkin.test.ts`: 7 passed. `pnpm test:integration` (the whole folder, which does not filter): 34 files, 567 tests passed.
- `pnpm --filter @tria/web typecheck` and `lint` pass. `vitest run "app/(app)/eventos" lib/events-view i18n`: 441 passed. `check-ui-literals` is OK.
- `pnpm --filter @tria/web build` passes, with `/eventos/[eventId]/check-in` dynamic (ƒ). `check-static-routes.sh`: 47 guarded routes, 0 offenders.
- Playwright:
  - `-g "events check-in" --project=mobile-chromium`: 4 passed.
  - `-g "events check-in|events rsvp|events detalhe"`: 17 passed, 7 skipped.
  - The whole `events.spec.ts`: 35 passed, 11 skipped (the phone-only cases on desktop).
- Teardown check: 0 `e2e-events-*` tenants, 0 GoTrue users and 0 events remain.
- Every acceptance grep passes:
  - `security definer`, `set search_path = ''`, the revoke and the grant each appear once outside comments;
  - the tenant filter appears 11 times, and `raise exception` 0 times;
  - there are 0 write policies on `event_checkin_attempts`, and `app.events_check_in` appears 3 times in the service;
  - `pseudoqr|qrscanner|localStorage` matches nothing in the ticket code;
  - there is one `from 'motion/react'` and no `framer-motion`;
  - `notFound()` appears 3 times in the page, and the REQUIRED_KEYS entry once.

## Decisions Made

See `key-decisions` in the frontmatter. In short:

- The function returns `starts_at` on every found outcome.
- Only wrong codes spend the bound, and a member who is already present never does.
- The ticket's Data cell drops the weekday.
- The `{when}` fillers are catalog keys.
- The done line is formatted on the server.
- `already` shows the done state.
- EVENT-04 stays Pending until 06-06, 06-08 and 06-09 land.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Tree drift] The pgTAP file is `supabase/tests/142-event-checkin.sql`, not 132**
- **Found during:** Task 1 (orchestrator note 2)
- **Issue:** 05.3 took 130, and Phase 6 shifted to 14x (140 events, 141 attendances).
- **Fix:** Created 142. The migration headers, the schema docblock and this summary name 142. The fixture ids use the `1e200000-…` prefix, which is free of 140's and 141's.
- **Committed in:** `0bc5cd5`

**2. [Rule 1 - Bug avoided] `#variable_conflict use_column` and table aliases in the definer**
- **Found during:** Task 1
- **Issue:** `returns table (outcome, checked_in_at, starts_at)` declares OUT variables named like the columns of `event_attendances` and `events`. Unqualified references would be ambiguous or would silently bind to the variable.
- **Fix:** Every column is alias-qualified and `#variable_conflict use_column` is set. The attempts upsert names its arbiter as `on conflict on constraint event_checkin_attempts_pkey`.
- **Committed in:** `0bc5cd5`

**3. [Rule 2 - SCHEMA-CONVENTIONS §(j) rule 2] The check-in route joins isolation case b4**
- **Found during:** Task 1
- **Issue:** Every new endpoint needs its cross-tenant case, and `isolation.test.ts` is not in the plan's list. The f2 host-mismatch loop is GET-only.
- **Fix:** b4 now POSTs a lab event's REAL code (read through adminSql) and asserts a bare 404 with nothing written on the lab side. It also asserts that the POST presented on the lab host is `403 TENANT_HOST_MISMATCH`.
- **Committed in:** `0bc5cd5`

**4. [Rule 2 - Missing test] Unit coverage for the new contract and service paths**
- **Found during:** Task 1
- **Fix:** `contracts.test.ts` cases 18-20 cover the strict schema, the 200 outcomes, no code key, and the bound mirrors. `events-payload.test.ts` cases 17-20 cover the six keys, `already` emitting nothing, every refusal mapped after the transaction, and the bare 404.
- **Committed in:** `0bc5cd5`

**5. [Rule 2 - Missing coverage] pgTAP facts beyond the plan's eleven**
- **Found during:** Task 1
- **Fix:** Fact 1 also asserts that `authenticated` CAN execute (the positive control) and that a lane with no claims gets `not_found`. Fact 5 also proves that a wrong code after the 15-minute reset restarts the count at 1. Fact 10 also sends a WRONG code with B's id and asserts no attempts row appears on B's side.
- **Committed in:** `0bc5cd5`

**6. [Rule 3 - Adaptation] Two extra catalog keys, `checkin.opensAt` and `checkin.opensOn`**
- **Found during:** Task 2
- **Issue:** UI-SPEC's `notOpenYet` carries `{when}`, which is "às 18:00" or "em {date}, às 18:00". The plan's key list has no home for those words, and building pt-BR in `events-view.ts` would put copy outside the catalog.
- **Fix:** Added two filler keys, both pinned and formatted in `messages.test.ts`.
- **Committed in:** `d67676e`

**7. [Rule 1 - Layout, orchestrator note 4] The ticket's Data cell prints the date without the weekday**
- **Found during:** Task 2
- **Measurement:** Chromium on the built page (mobile-chromium, seeded demo event), a one-off probe that was not committed:

  | Date form | Width | Text width | Cell width | Result |
  |---|---|---|---|---|
  | Contract (`sáb., 12 de out.`, 14/700) | 390px | 103-104px | 106px | fits, 2px to spare (does NOT reproduce the drawing's 390px finding) |
  | Contract (`sáb., 12 de out.`, 14/700) | 320px | 103-104px | 83px | cut to "sáb., 12 de o…" |
  | Weekday-free (`12 de out.`) | 390px and 320px | within the cell | 106px / 83px | fits at both |

- **Fix:** The Data cell uses the existing `formatDayMonth` (a multi-day event prints its existing range form). The cover overline above keeps the full contract date. No new token or size.
- **Verification:** The `events check-in` e2e asserts the Data and Horário values are not cut at 390 and 320, and that the 60-character Local value is.
- **Committed in:** `d67676e`

**8. [Rule 3 - Adaptation] `secretsFor` also returns `checkinCode`; `addEventsMember` and `attendanceFor` are new fixtures**
- **Found during:** Task 2
- **Issue:** The plan reads the code "through `secretsFor`", which returned only format and URL. `createEventsTenant` makes one member, and the walk-in step needs a second. The walk-in status is admin-only in the UI.
- **Fix:** Extended the helper and added the two fixtures. The 06-04 admin spec's exact `toEqual` on `secretsFor` became `toMatchObject` (same two fields asserted).
- **Committed in:** `d67676e`

**9. [Rule 3 - Test selector] The form's alert is scoped to the ticket**
- **Found during:** Task 2 (the first e2e run)
- **Issue:** The page carries another `role="alert"` (Next's route announcer), so `getByRole('alert')` counted 1 before any submit.
- **Fix:** The spec looks for the alert inside `event-ticket`. No product change.
- **Committed in:** `d67676e`

**10. [Rule 2 - Testability] `data-animate` on the done circle**
- **Found during:** Task 2
- **Issue:** Under `MotionGlobalConfig.skipAnimations` the spring's transform cannot be observed reliably in happy-dom.
- **Fix:** The circle carries `data-animate="spring" | "still"`, which `CheckinForm.test.tsx` asserts. The spring plays only for a check-in made on the page, never under reduced motion, and never on a page that loads already done.
- **Committed in:** `d67676e`

**11. [Rule 3 - Adaptation] `EventActions.test.tsx` cases 1f and 1i updated**
- **Found during:** Task 2
- **Issue:** Both cases asserted "renders nothing" for rows where UI-D-207 now draws the check-in CTA: in person, P2 unanswered, and the cancelled P2 disabled CTA.
- **Fix:** They now assert no RSVP row, and they keep the "nothing" assertion for the online variants, which belong to 06-06.
- **Committed in:** `d67676e`

---

**Total deviations:** 11. Rule 1: 2. Rule 2: 4. Rule 3: 5.
**Impact on plan:** All were needed for correctness, the gates, the current tree or the approved drawing. There is no scope creep: `Entrar` and the online check-in (06-06), `Participantes` with the code card (06-07) and the Início card's CTA (06-08) remain those plans' work.

## Issues Encountered

- The browser logs "Service Worker registration blocked by Playwright" and an `unhandledRejection` reading `waiting`, as in 06-03 and 06-04. Both predate this plan and fail no test.
- `pnpm test:integration -- <x>` does not filter (orchestrator note 7). The single file ran through `pnpm --filter @tria/api exec vitest run`, and the whole folder ran once.
- Disk stayed at about 8.6-8.9 GB free throughout, and `.turbo/cache` was not touched.

## Known Stubs

None.

## Threat Flags

None. The new route, the SECURITY DEFINER function and the write-free table are the surfaces in the plan's threat model (T-06-27..T-06-34). Each `mitigate` is implemented and proved: T-06-27 by pgTAP 5 and integration 4, T-06-28 by pgTAP 10 and isolation b4, T-06-29 by pgTAP 1, T-06-30 by pgTAP 11 and 020, T-06-31 by `checkinResultSchema` having no code key, T-06-32 by pgTAP 6-8, and T-06-34 by integration 7.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 06-06 (online `Entrar`) can clone `app.events_check_in`'s posture for `app.events_enter`, and should emit `event.checked_in` with `via: 'online'` (the payload type already allows it). The `EventActions` table documents where `Entrar` slots in.
- 06-07 (`Participantes`) reads `checked_in` / `walk_in` / `checkin_via` as written here, and shows the code that members now type.
- 06-08 (the Início card) links its P1/P2 CTA to `/eventos/{id}/check-in`, which exists now.
- EVENT-04 stays Pending in REQUIREMENTS.md until 06-06, 06-08 and 06-09 (which also declare it) finish.
- Phase 6 progress: 5 of 9 plans complete (06-01 through 06-05). Real-phone UAT of the ticket (D6) waits on 01.1.

---
*Phase: 06-events*
*Completed: 2026-09-27*

## Self-Check: PASSED

- All 9 key created files exist on disk.
- Commits `0bc5cd5` and `d67676e` are in `git log`. `git rev-list --count f7351ef..HEAD` measured 2 before the docs commits.
- The sketch 006 README and MANIFEST were neither modified nor staged by this plan.
