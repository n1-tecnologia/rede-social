---
phase: 06-events
plan: 03
subsystem: events
tags: [events, rsvp, attendance, guard-trigger, rls, pgtap, detail-page, SegmentedControl, server-action, playwright, D-201, D-203, D-204, D-205, D-206, D-216, D-219, UI-D-203, UI-D-204, UI-D-206, UI-D-207]

requires:
  - phase: 06-events (06-01)
    provides: events + event_secrets tables, GET /v1/events list, events-view.ts formatter, EventCover/EventPoster, /eventos list, events-admin e2e fixtures
  - phase: 06-events (06-02)
    provides: sketch 006 (D-33 design gate), approved provisionally 2026-09-27, which gated Task 3
provides:
  - "event_attendances (one row per member per event; going / not_going / checked_in / walk_in) with self-only RSVP write policies and no delete policy"
  - "app.event_attendance_guard(): the BEFORE INSERT OR UPDATE trigger that refuses late, cancelled, locked, out-of-window and row-moving writes for every writer"
  - "GET /v1/events/{id} (viewer state + D-219 counts, no other member's identity) and PUT /v1/events/{id}/rsvp (one upsert, 409 codes by constraint name, event.rsvp after commit)"
  - "counts and viewer state on every /v1/events list item, still one statement"
  - "/eventos/[eventId]: header pill, 16/10 hero, banners, clamped description, info grid, Abrir no Maps, loading, not-found"
  - "@tria/ui SegmentedControl (role=group, aria-pressed, no arrow-key writes)"
  - "EventActions island: the RSVP rows of the action zone, optimistic press, refusal toasts, boundary refresh"
  - "rsvpEventAction / putRsvp / eventActionState; rsvp.* and errors.cancelled catalog keys"
  - "seeded answers and check-ins in both tenants; e2e helpers insertEvent({description}), tenantIdBySlug, deleteEventsByTitlePrefix, moveEventStart"
affects: [06-04, 06-05, 06-06, 06-07, 06-08, 06-09, phase-07-notifications]

actuals:
  tokens: 123830
  tasks: 3
  commits: 5
plan_head_before: b2df42753ec97af041e54779bff4cf632b6f7529

tech-stack:
  added: []
  patterns:
    - "Guard trigger raising SQLSTATE 23514/23503 with a named constraint, mapped by the service's guardIssue cause-chain walk exactly like a CHECK violation"
    - "Optimistic press keyed to the server answer it replaced ({ value, from }): the override holds until the refreshed server answer differs, with no effect to clear it and no flash back"
    - "Boundary refresh: one setTimeout in an effect aimed at the next of checkinOpensAt/startsAt/endsAt within 24 h, 1 s past it, re-armed by the server-computed phase"
    - "Time-travel fixtures: write attendance while the event is in a legal window, then UPDATE the event's times (moveEventStart in e2e, adminSql in integration)"

key-files:
  created:
    - supabase/migrations/20260927154326_event_attendances.sql
    - supabase/migrations/20260927154335_event_attendance_guard.sql
    - supabase/tests/141-event-attendances.sql
    - apps/api/tests/integration/events-rsvp.test.ts
    - packages/modules/events/ui/EventHero.tsx
    - packages/modules/events/ui/EventInfoGrid.tsx
    - packages/modules/events/tests/event-detail-ui.test.tsx
    - packages/ui/src/primitives/SegmentedControl.tsx
    - packages/ui/tests/segmented-control.test.tsx
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/app/(app)/eventos/[eventId]/loading.tsx
    - apps/web/app/(app)/eventos/[eventId]/not-found.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventDescription.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventRefresh.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventActions.tsx
    - apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx
  modified:
    - packages/modules/events/db/schema.ts
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/module.ts
    - packages/modules/events/ui/EventPoster.tsx
    - packages/ui/src/index.ts
    - supabase/tests/020-tenant-isolation.sql
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - apps/web/app/(app)/eventos/actions.ts
    - apps/web/app/(app)/eventos/EventsList.tsx
    - apps/web/lib/events.ts
    - apps/web/lib/events-view.ts
    - apps/web/messages/pt-BR/events.json
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
    - scripts/seed.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "The RSVP-close rule lives only in the database (guard trigger, now() >= starts_at); the web action and island never consult the clock to allow or refuse an answer"
  - "EventActions reads its labels through useTranslations instead of receiving them as props (the refusal toasts need client-side strings anyway); the page passes only eventActionState (phase, flags, answer, ISO instants)"
  - "Optimistic RSVP press is a local override keyed to the server answer it replaced, not useOptimistic, so success keeps the new answer pressed until the refreshed server answer lands"
  - "attendance_locked (a check-in landed meanwhile) shows the generic RSVP failure toast and refreshes into the checked-in banner; rsvp_closed and cancelled toast their own lines and refresh"
  - "A checked-in viewer (walk-in included) gets no RSVP row in any phase, and a cancelled event past its start gets none either (UI-SPEC action-zone table and sketch 006); the banner above says it"
  - "SegmentedControl renders the visible label itself when `label` is passed (aria-labelledby its id), or accepts a caller-rendered element via `labelId`"
  - "EVENT-02 and EVENT-03 stay Pending: requirements.ready-ids reports 0/2 ready because 06-08 and 06-09 also declare them"

patterns-established:
  - "Pattern: a [designed] D-33 surface is coded only after `grep -q '^approved: true'` on its sketch README passes (the task's precondition)"
  - "Pattern: throwaway-tenant e2e for write flows (createEventsTenant + insertEvent relative to DB now() + deleteEventsTenant in afterAll), phone project only, serial"

requirements-completed: []

coverage:
  - id: D1
    description: "event_attendances with self-only RSVP policies and the guard trigger: late, cancelled, locked, out-of-window, row-moving and unknown-event writes refused by constraint name for every writer, including the starts_at = now() boundary"
    requirement: "EVENT-03"
    verification:
      - kind: integration
        ref: "supabase/tests/141-event-attendances.sql (pnpm supabase test db: 16 files, 426 tests)"
        status: pass
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (event_attendances isolation cases + B-lane symmetry)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /v1/events/{id} and PUT /v1/events/{id}/rsvp: toggle with repeat-no-write, one event.rsvp per change, 409 rsvp_closed / cancelled / attendance_locked, bare 404 cross-tenant, D-219 counts on list and detail, no other member's identity, the held-cancel race, one-statement list budget"
    requirement: "EVENT-03"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-rsvp.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b4 and f2"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts (events list case)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/eventos/[eventId] detail page: header pill, hero overline, banners, 6-line clamped description with Ver mais, info grid in the tenant timezone, Abrir no Maps link (no embed), one not-found screen"
    requirement: "EVENT-02"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events detalhe (mobile-chromium + desktop-chromium)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/events-view.test.ts (tests 12-19) and packages/modules/events/tests/event-detail-ui.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "@tria/ui SegmentedControl: role=group named by the question, aria-pressed options with one shared selected style, focus movement never calls onChange, disabled keeps the stored answer, busy sets aria-busy"
    requirement: "EVENT-03"
    verification:
      - kind: unit
        ref: "packages/ui/tests/segmented-control.test.tsx (9 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The RSVP pair on the detail page: every RSVP row of the action-zone table, optimistic press with revert + toast on refusal, refresh into the P2 read-only line on rsvp_closed, boundary refresh; the count moves 0 -> 1 -> 0 and the answer survives a reload"
    requirement: "EVENT-03"
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx (18 tests)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events rsvp (mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Seeded answers and check-ins in both tenants (3 confirmed on the upcoming event, 2 present on the recent past one), visible as poster count lines and detail pills"
    requirement: "EVENT-02"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events lista 06-03 poster case and events detalhe seeded cases"
        status: pass
    human_judgment: false
  - id: D7
    description: "The pair and the detail read as the approved sketch 006 on a real phone (390x844 and 320px), including the E04 long-text backstop"
    requirement: "EVENT-03"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved design and on-device feel need a human; real-device UAT is blocked locally until 01.1 (phones cannot reach *.localhost)"

duration: 164min wall-clock (about 40min active)
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 03: Event detail page (EVENT-02) and RSVP (EVENT-03) Summary

**`event_attendances` guarded by a `FOR SHARE` trigger that refuses late answers for every writer, a one-upsert RSVP API with named 409s, the `/eventos/{id}` detail page, and a `Vou` / `Não vou` `SegmentedControl` that answers optimistically, reverts on the database's refusal and refreshes itself at the next event boundary**

## Performance

- **Duration:** 2h 44m wall-clock (9,807 s from the plan start to the metadata close). About 40 min of that was execution: Tasks 1-2 took about 26 min (12:39 to 13:05 -03:00, by commit times), and Task 3 plus the close took about 14 min (15:10 to 15:24 -03:00). The remaining ~2h 04m was the wait for the D-33 review of sketch 006.
- **Started:** 2026-09-27T15:39:26Z
- **Completed:** 2026-09-27T18:23:30Z
- **Tasks:** 3 of 3
- **Files modified:** 44 (outside `.planning/`)

## Accomplishments

- **The attendance row and its guard (Task 1).** One `event_attendances` row per member per event with the D-216 status set. The member lane can write only its own `going`/`not_going` (RLS). `app.event_attendance_guard()` reads the event `FOR SHARE` and refuses, by constraint name, these writes from every writer: an answer at or after `starts_at`, a write on a cancelled event, a status change on a checked-in row, a check-in outside its window, a moved row, and an unknown event.
- **The API (Task 1).** `GET /v1/events/{id}` returns the viewer's state and the D-219 counts, and nobody else's identity. `PUT /v1/events/{id}/rsvp` is one upsert with repeat-no-write and emits `event.rsvp` after commit only when the answer changed. The list gets counts in the same single statement.
- **The detail page (Task 2).** A port of the prototype: header pill, 16/10 hero, cancelled and checked-in banners, clamped description, info grid in the tenant timezone, `Abrir no Maps` as a plain link, loading and one not-found screen.
- **The RSVP pair (Task 3).** The new `@tria/ui` `SegmentedControl`, plus the `EventActions` island for the RSVP rows of the action-zone contract. A tap presses optimistically and marks the group busy. On success the page refreshes with no toast. On a refusal the press reverts and a toast names the cause (`encerraram`, `cancelado`, generic); a race also refreshes. One timer refreshes the page at the next boundary within 24 h. `rsvpEventAction` and `putRsvp` carry the write.

## Task Commits

1. **Task 1 [BLOCKING schema]: attendance row, guard, detail + RSVP API, event.rsvp, seed, pgTAP 141, 020, isolation, budget.** `15bf5f8` (feat)
2. **Task 2: the /eventos/{id} detail page and the poster count line / viewer pills.** `d30b3f5` (feat)
   - Docs follow-up: `c7c94ec` closed WINDOWS entry 52 (the poster href now resolves).
3. **Task 3: SegmentedControl, EventActions with the boundary refresh, rsvpEventAction, the `events rsvp` e2e.** `5567c84` (feat)

In between, the orchestrator committed `239bd88` (docs(06): record the provisional D-33 approval of sketch 006); see "D-33 approval provenance" below.

**Plan metadata:** recorded by the final docs commit for this SUMMARY, STATE.md and ROADMAP.md.

## D-33 approval provenance

Task 3's precondition was `grep -q '^approved: true' .planning/sketches/*-phase-06-designed-screens/README.md`. The first executor stopped there at a `blocking-human` checkpoint after committing Tasks 1-2.

The developer, Igor Vilas Boas, answered "aprovo pode continuar". **On that instruction, the orchestrator (not the developer's own hand, and not this executor) wrote the approval** into `.planning/sketches/006-phase-06-designed-screens/README.md`: `status: approved`, `approved: true`, `approved_by: Igor Vilas Boas`, `approved_at: 2026-09-27`, `approval_kind: provisional`, `changes_requested: []`. It also updated the MANIFEST row and committed both as `239bd88`.

This executor re-ran the grep (exit 0), coded the pair as drawn in sketch 006 (`segmented-control-seis-estados`, `zona-de-acao-todas-as-linhas`), and neither modified nor staged the README or the MANIFEST.

The approval is **provisional**, so the phase UAT should confirm the pair on a real phone (coverage D7).

## Files Created/Modified

Task 3's files (Tasks 1-2 are listed in the frontmatter `key-files`):

- `packages/ui/src/primitives/SegmentedControl.tsx`: the recorded two-option answer primitive.
- `packages/ui/src/index.ts`: barrel export.
- `packages/ui/tests/segmented-control.test.tsx`: 9 tests (group and label, pressed state, click, keys never write, disabled, busy).
- `apps/web/app/(app)/eventos/[eventId]/EventActions.tsx`: the action-zone island (RSVP rows).
- `apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx`: 18 tests (every RSVP row, the answer flow, the boundary timer).
- `apps/web/app/(app)/eventos/[eventId]/page.tsx`: fills the action-zone slot with `EventActions {...eventActionState(event, view)}`.
- `apps/web/app/(app)/eventos/actions.ts`: `rsvpEventAction` (validates with `rsvpSchema`; maps `details.event`; redirects outside the try).
- `apps/web/lib/events.ts`: `putRsvp` (`PUT /v1/events/{id}/rsvp`).
- `apps/web/lib/events-view.ts`: `EventActionState` and `eventActionState`.
- `apps/web/lib/events-view.test.ts`: test 20 (`eventActionState`).
- `apps/web/messages/pt-BR/events.json`: `rsvp.{label,going,notGoing,windowHint,answeredGoing,answeredNotGoing,errors.{failed,closed}}` and `errors.cancelled`.
- `apps/web/i18n/messages.test.ts`: pins the nine new strings.
- `apps/web/e2e/events.spec.ts`: describe `events rsvp` (toggle and count, reload, late tap).
- `apps/web/e2e/events-admin.ts`: `moveEventStart`.

## Decisions Made

See `key-decisions` in the frontmatter. In short:

- The database is the only authority on whether an answer is still allowed.
- The island reads its catalog strings itself.
- The optimistic press is keyed to the answer it replaced.
- `attendance_locked` shows the generic toast plus a refresh.
- A checked-in viewer, or a cancelled event past its start, gets no RSVP row.
- EVENT-02 and EVENT-03 stay Pending until 06-08 and 06-09 close.

## Deviations from Plan

### Auto-fixed Issues (Tasks 1-2, carried from the first executor)

**1. [Rule 3 - Blocking] The pgTAP file is `supabase/tests/141-event-attendances.sql`, not 131**
- **Found during:** Task 1
- **Issue:** 05.3 took 130, and 06-01 had already shifted events to 140.
- **Fix:** Numbered it 141; both migration headers point at 141.
- **Committed in:** `15bf5f8`

**2. [Rule 3 - Blocking] `EventSummary` gained required fields**
- **Found during:** Task 1
- **Issue:** Web typecheck broke on `apps/web/lib/events-view.test.ts`'s fixture.
- **Fix:** Updated the fixture inside Task 1 to keep the web typecheck green.
- **Committed in:** `15bf5f8`

**3. [Rule 2 - Missing critical] Split check-in window refusal message**
- **Found during:** Task 1
- **Issue:** One message could not tell the web tier whether the window had not opened yet or had closed.
- **Fix:** The guard's `checkin_window` raise carries `checkin_not_open` before the window and `checkin_closed` after it, and `guardIssue` maps `checkin_closed` by message. `event_attendances_immutable` is deliberately unmapped: no API path can move a row, so reaching it stays a 500.
- **Committed in:** `15bf5f8`

**4. [Rule 3 - Blocking] 020's cross-tenant write case expects 23503, not 42501**
- **Found during:** Task 1
- **Issue:** The case asserts 23503 `event_not_found`. The BEFORE trigger runs before RLS WITH CHECK and cannot see tenant B's event through tenant A's lane.
- **Fix:** Asserted the earlier refusal. The write is still refused, one layer earlier.
- **Committed in:** `15bf5f8`

**5. [Rule 3 - Blocking] Seed mix adapted to three named members**
- **Found during:** Task 1
- **Issue:** tria-lab has three named members, not the number the plan's mix assumed.
- **Fix:** The same mix in both tenants:
  - named0: `going` on #1, `checked_in` on #3;
  - named1: `going` on #1, `walk_in` on #4;
  - named2: `not_going` on #1, `going` on #4;
  - member@: `going` on #1, `checked_in` on #4, and `going` on #5 before the cancel.

  An event that already has attendance rows is skipped (idempotency).
- **Committed in:** `15bf5f8`

**6. [Rule 2 - Missing critical] Extra isolation assertions**
- **Found during:** Task 1
- **Fix:** `isolation.test.ts` b4 also checks that a PUT RSVP on a lab id is a bare 404 with nothing written, and the f2 host-mismatch loop now includes the detail path.
- **Committed in:** `15bf5f8`

**7. [Rule 3 - Blocking] The events budget constant in `feed-query-budget.test.ts` is not exported**
- **Found during:** Task 1
- **Issue:** Biome's `noExportsInTest`.
- **Committed in:** `15bf5f8`

**8. [Rule 3 - Blocking] `EventsList.tsx` now passes `meta` through**
- **Found during:** Task 2
- **Issue:** The file was not in the plan's list, but the poster count line needed it.
- **Committed in:** `d30b3f5`

**9. [Rule 3 - Blocking] Added the `[eventId]/EventRefresh.tsx` client island**
- **Found during:** Task 2
- **Issue:** `PullToRefresh` needs a client callback, and the page is an RSC.
- **Committed in:** `d30b3f5`

**10. [Rule 3 - Blocking] Extended `apps/web/e2e/events-admin.ts` (a Task 3 file) during Task 2**
- **Found during:** Task 2
- **Fix:** Added `insertEvent({ description })`, `tenantIdBySlug` and `deleteEventsByTitlePrefix` for the E04 fixture.
- **Committed in:** `d30b3f5`

**11. [Rule 1 - Bug] The `events lista` Passados assertion now expects `Presente`**
- **Found during:** Task 2
- **Issue:** member@ is checked in on the seeded past event.
- **Committed in:** `d30b3f5`

**12. The detail's count cell shows the ICU count string ("3 confirmados", "Ninguém confirmou ainda"), not a bare number**
- **Found during:** Task 2
- **Note:** Task 3's e2e watches exactly those strings.
- **Committed in:** `d30b3f5`

**13. The hero photo is not greyscaled for a cancelled event**
- **Found during:** Task 2
- **Note:** UI-D-202 specifies greyscale for the poster only; the detail carries the danger banner instead.
- **Committed in:** `d30b3f5`

**14. `pnpm test:integration -- <x>` does not filter**
- **Found during:** Tasks 1-2
- **Note:** The whole folder ran once instead of the plan's three filtered calls.

### Auto-fixed Issues (Task 3)

**15. [Rule 3 - Blocking] Biome `useSemanticElements` rejects `<div role="group">`**
- **Found during:** Task 3
- **Issue:** Lint failed, but UI-D-206 fixes the markup as `<div role="group">`, and the plan's acceptance grep pins `role="group"`.
- **Fix:** A scoped `biome-ignore` with the rationale: a `<fieldset>` needs a `<legend>` and brings its own min-width and border quirks inside a grid.
- **Files modified:** `packages/ui/src/primitives/SegmentedControl.tsx`
- **Verification:** `pnpm --filter @tria/ui lint` is clean.
- **Committed in:** `5567c84`

**16. [Rule 3 - Blocking] The web workspace has no jest-dom**
- **Found during:** Task 3
- **Issue:** `EventActions.test.tsx`, first drafted with jest-dom matchers, failed with "Invalid Chai property".
- **Fix:** Plain DOM assertions (`getAttribute`, `.disabled`, `textContent`, `innerHTML`), the house style for web tests. No dependency added.
- **Files modified:** `apps/web/app/(app)/eventos/[eventId]/EventActions.test.tsx`
- **Verification:** 18/18 pass.
- **Committed in:** `5567c84`

**17. [Rule 3 - Adaptation] `EventActions` takes no label props**
- **Found during:** Task 3
- **Issue:** The plan lists "the labels" among the island's props. The refusal toasts need catalog strings on the client anyway.
- **Fix:** The island calls `useTranslations('events')`, the `ReactivateCommunity` precedent. The RSC passes only `eventActionState` (phase, format, cancelled, answer, checkedIn, the three ISO instants).
- **Files modified:** `EventActions.tsx`, `events-view.ts`
- **Committed in:** `5567c84`

**18. [Rule 2 - Missing critical] Test coverage for the new strings and the props builder**
- **Found during:** Task 3
- **Issue:** `apps/web/i18n/messages.test.ts` and `apps/web/lib/events-view.test.ts` are not in Task 3's file list.
- **Fix:** Pinned the nine new catalog strings (as Task 2 did for its keys) and added test 20 for `eventActionState`.
- **Committed in:** `5567c84`

**19. [Rule 2 - Missing critical] RSVP write guards**
- **Found during:** Task 3
- **Fix:** Tapping the already-pressed answer writes nothing (the island short-circuits). `rsvpEventAction` also `revalidatePath('/eventos')` on success so the poster's count line is fresh on the way back, and it treats a stored status that differs from the answer sent as `failed`.
- **Committed in:** `5567c84`

**20. [Rule 3 - Adaptation] The `events rsvp` e2e runs on the phone only, in serial mode**
- **Found during:** Task 3
- **Fix:** It runs on `mobile-chromium` only, with its tenant provisioned in a `beforeAll` gated on the project, so one throwaway tenant (`e2e-events-rsvp`) serves the toggle and the late-tap race. Desktop reports both tests skipped. The tenant is deleted in `afterAll`; this was verified (0 rows remain).
- **Committed in:** `5567c84`

---

**Total deviations:** 20. Rule 1: 1. Rule 2: 4. Rule 3: 11. Documented notes with no rule: 4 (12, 13, 14, and the parity wording in 17).
**Impact on plan:** All were needed to pass the gates or to match the current tree and the approved sketch. There is no scope creep: the check-in CTAs (06-05), `Entrar` and the online hints (06-06), and the calendar pair (06-08) remain those plans' work.

## Issues Encountered

- The browser logs "Service Worker registration blocked by Playwright" followed by an `unhandledRejection` reading `waiting`, and mux-player logs playback-token errors from the seeded fake video. Both predate this plan, and no test failed on either.

## Verification (plan-level `<verification>`)

- `pnpm db:generate` shows no schema changes, and `git status -- supabase/migrations` is clean.
- `pnpm db:reset && pnpm db:seed`: PASS. `pnpm supabase test db`: 16 files, 426 tests, PASS.
- `pnpm test:integration` (the whole folder, once): 32 files, 551 tests, PASS. This covers events, events-rsvp, isolation and feed-query-budget.
- `pnpm --filter @tria/ui test`: 82 passed. `pnpm --filter @tria/module-events test`: 38 passed. `vitest run lib/events-view i18n "app/(app)/eventos"`: 329 passed.
- `pnpm --filter @tria/web build`: PASS, with `/eventos` and `/eventos/[eventId]` dynamic (ƒ). `check-static-routes.sh`: 44 guarded routes, 0 offenders.
- `VIDEO_PROVIDER=fake playwright test events.spec.ts`: 28 passed, 4 skipped (the phone-only E03/E04 and `events rsvp` cases on desktop). This covers the `events tracer`, `events lista`, `events detalhe` and `events rsvp` describes.
- Typecheck and lint are clean for `@tria/ui` and `@tria/web`, and `check-ui-literals.sh` passes.
- The Task 3 acceptance greps all pass:
  - `role="group"` appears 1 time and `aria-pressed` 2 times;
  - `ArrowRight|ArrowLeft` appears 0 times outside comments;
  - the barrel references `SegmentedControl` 3 times;
  - `Date.now()` appears 1 time outside comments, inside the boundary `useEffect`;
  - `rsvpEventAction` appears 1 time in `actions.ts`.

## Known Stubs

None. The action zone's comment naming 06-05 and 06-06 marks slots for later plans that do not affect this plan's goal.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 06-04 (the create/edit form) can reuse `SegmentedControl` for Presencial / Online through `labelId` or `label`.
- 06-05 (in-person check-in) writes `checked_in` / `walk_in` through a SECURITY DEFINER function. The guard trigger already polices the window, and `EventActions` has room below the pair for the `Fazer check-in` CTA.
- 06-06 (online `Entrar`) and 06-07 (`Participantes`) read `event_attendances` and the counts as built here.
- EVENT-02 and EVENT-03 stay Pending in REQUIREMENTS.md until 06-08 and 06-09 finish.
- Real-phone UAT for the pair (D7) waits on 01.1, as in 05.2 and 05.3.

---
*Phase: 06-events*
*Completed: 2026-09-27*

## Self-Check: PASSED

All seven key created files exist on disk, and all five commits in `b2df427..HEAD` are present (`15bf5f8`, `d30b3f5`, `c7c94ec`, `239bd88`, `5567c84`). `239bd88` is the orchestrator's approval commit, not this plan's code, and is counted in `commits: 5` because the count is measured from `plan_head_before`. The sketch 006 README and MANIFEST are untouched by this plan's commits.
