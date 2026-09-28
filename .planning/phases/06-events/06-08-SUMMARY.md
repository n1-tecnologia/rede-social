---
phase: 06-events
plan: 08
subsystem: events
tags: [events, calendar, ics, rfc5545, google-calendar, home-slot, inicio, next-event, boundary-refresh, tdd, playwright, D-202, D-209, D-211, UI-D-203, UI-D-210, UI-D-214, EVENT-06]

requires:
  - phase: 06-events (06-03)
    provides: the detail page and its action zone, the viewer's own row and the two D-219 counts in the shared projection, EventActions' anchor shapes and its boundary-refresh pattern
  - phase: 06-events (06-05)
    provides: the /check-in ticket the Início card's "Fazer check-in" opens
  - phase: 06-events (06-06)
    provides: the /entrar gate (a calendar tap on /entrar is counted inside the window and survives a login), the plain Entrar anchor shape, the side-effecting-route prefetch rule
  - phase: 06-events (06-02)
    provides: sketch 006 surface 5 (inicio-*) and the calendar pair in the detail action zone, approved provisionally 2026-09-27 (the D-33 gate for Task 2), and the 320px calendar-pair finding
provides:
  - "apps/web/lib/events-calendar.ts: ICS_PRODID, GOOGLE_DETAILS_MAX, CalendarEvent, utcStamp, icsEscape, foldIcsLine, calendarLocation, buildIcs, googleCalendarHref"
  - "GET /eventos/{eventId}/agenda.ics (route handler, force-dynamic): a pure member-lane read served as text/calendar, attachment evento.ics, private no-store"
  - "The detail page's calendar pair 'Adicionar à agenda' (Google Agenda + Arquivo .ics), P0-P2, never when cancelled or ended; EventDetailView.calendar"
  - "contracts: nextEventSchema, NextEvent; server: getNextEvent; route GET /v1/events/next (no permission, registered before /{eventId})"
  - "eventsModule home: [{ order: 7 }]; WEB_MODULE_REGISTRY.events = { home: [eventsHome] }"
  - "packages/modules/events/ui/NextEventCard.tsx (module UI: no words, no route, no clock; the CTA is a sibling slot)"
  - "apps/web/lib/events.ts loadNextEvent; apps/web/lib/events-view.ts nextEventCardView, NextEventCardView, NextEventCta"
  - "apps/web/components/events/NextEventRefresh.tsx (renders nothing; one router.refresh at the next boundary within 24 h)"
  - "catalog: events.calendar.{label,google,ics}, events.home.{title,open}, events.when.{todayAt,tomorrowAt,live}"
  - "e2e fixtures: createEventsTenant(slug, password, extraModules), moveEventStartSeconds, cancelEventNow"
affects: [06-09, phase-07-notifications, pilot-UAT]

actuals:
  tokens: 26753
  tasks: 2
  commits: 4
plan_head_before: 73a3126e196be7f21eb1322a1bfa9ba349898c2a

tech-stack:
  added: []
  patterns:
    - "RFC 5545 folding on UTF-8 byte length, walked by code point (TextEncoder per character), so a fold never splits an accent or a surrogate pair"
    - "A calendar export is a pure read: no prefetch 204 is needed because nothing has a side effect; the online LOCATION is the app's own gated /entrar, never the meeting URL"
    - "A home-slot renderer that never rejects: its loader swallows every failure into null, and the renderer catches its own composition errors, so homeSlotsFor never draws the generic error card for it"
    - "A render-nothing refresh island keyed by the server's phase, so it re-arms after each refresh (the EventActions precedent), with the boundaries as ISO strings from the server"
    - "Integration cases that order rows run in a throwaway tenant (the modules.test pattern), so no seeded row moves; seeded lanes are only read and compared with the database's own answer"

key-files:
  created:
    - apps/web/lib/events-calendar.ts
    - apps/web/lib/events-calendar.test.ts
    - apps/web/app/(app)/eventos/[eventId]/agenda.ics/route.ts
    - apps/web/components/events/NextEventRefresh.tsx
    - packages/modules/events/ui/NextEventCard.tsx
    - packages/modules/events/tests/next-event-card.test.tsx
    - .planning/phases/06-events/deferred-items.md
  modified:
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/lib/events-view.ts
    - apps/web/lib/events-view.test.ts
    - apps/web/lib/events.ts
    - apps/web/lib/registry.tsx
    - apps/web/messages/pt-BR/events.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
    - scripts/check-static-routes.sh
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/module.ts
    - packages/modules/events/ui/index.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/events.test.ts
    - apps/api/tests/integration/modules.test.ts
    - apps/api/tests/integration/isolation.test.ts

key-decisions:
  - "06-08: the calendar pair stacks below sm and sits side by side from it: at half width the anchors are 157px at 390 and 122px at 320, and 'Google Agenda' wraps at both widths (measured). This is the drawing's own first option, with an existing breakpoint and no new token"
  - "06-08: the Início card carries no inset of its own (no mx-4 / px-4): /inicio's column already insets its slots by 16px like the feed cards below, so a second mx-4 would misalign it"
  - "06-08: the .ics route has no prefetch 204: it is a pure member-lane read with no side effect and no off-site redirect (the 06-06 rule is for side-effecting or externally redirecting handlers). Three parallel downloads leave attendance unchanged, even for an online event inside its window"
  - "06-08: the calendar export closes 06-06's meeting-URL prohibition (D8): the serializer reads only the fields CalendarEvent names, the online LOCATION and the Google location are /eventos/{id}/entrar, and unit and e2e cases prove neither output carries the meeting host"
  - "06-08: GET /v1/events/next reuses the upcoming projection with status = 'active', so a cancelled sooner event never hides the real next one; an event in progress is returned while it runs"

patterns-established:
  - "Pattern: every export of an event to a third party (calendar file, calendar link) routes an online event through /eventos/{id}/entrar and never through the stored URL"
  - "Pattern: a home slot that must never be the reason /inicio errors renders null on every failure and logs <module>.<read>_failed with its shape only"

requirements-completed: [EVENT-06, EVENT-02, EVENT-04]

coverage:
  - id: D1
    description: "The RFC 5545 serializer and the Google link as pure functions: UTC stamps, TEXT escaping, 75-octet folding that never splits a character, one VCALENDAR with one VEVENT, CONFIRMED/CANCELLED, the hostile-title single-VEVENT case, online LOCATION /entrar with no meeting host, TEMPLATE link with UTC dates, no ctz and details capped at 1000"
    requirement: EVENT-06
    verification:
      - kind: unit
        ref: "apps/web/lib/events-calendar.test.ts (18 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /eventos/{id}/agenda.ics: text/calendar + attachment evento.ics + private no-store, UTC times, the venue, CRLF lines; online /entrar with no meeting host; three parallel downloads are three well-formed files and record nothing (even for an online event in its window); a malformed id is a 404"
    requirement: EVENT-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events agenda 1-4 (mobile-chromium)"
        status: pass
      - kind: other
        ref: "pnpm --filter @rede-social/web build && bash scripts/check-static-routes.sh (52 guarded, 0 offenders; /eventos/[eventId]/agenda.ics is dynamic)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The calendar pair on the detail page: shown in P0-P2 for every member whatever their answer, hidden when cancelled or ended; Google opens in a new context with rel noopener noreferrer, the .ics is a download; each label on one line at 390 and 320 (stacked) and side by side at 700"
    requirement: EVENT-06
    verification:
      - kind: unit
        ref: "apps/web/lib/events-view.test.ts#30; apps/web/i18n/messages.test.ts#06-08 calendar"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events agenda 1 and 4"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/events/next: null with nothing coming (an ended event does not count), the soonest active event with the viewer state and counts and no URL or code key, a cancelled sooner event skipped, an in-progress event returned, each seeded lane its own tenant's next event, and the host mismatch refused"
    requirement: EVENT-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events.test.ts#next 1-5 (19 in the file); isolation.test.ts f2 (27); pnpm test:integration 35 files, 590 tests"
        status: pass
    human_judgment: false
  - id: D5
    description: "MOD-04: eventsModule declares home [{ order: 7 }], strictly between the stories row (5) and the feed (10), and the bootstrap carries it verbatim; WEB_MODULE_REGISTRY.events supplies the renderer"
    requirement: EVENT-02
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts (19 api unit tests)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/modules.test.ts (events entry: nav + home verbatim)"
        status: pass
    human_judgment: false
  - id: D6
    description: "NextEventCard and its view: one row anchor with the host label, the CTA a sibling below it (never nested), the gradient thumb, the pill slot; the Início when-line (Hoje/Amanhã/date/Acontecendo agora) in the tenant zone, the pill, and check-in mode (in-person ticket until checked in, online Entrar kept to rejoin)"
    requirement: EVENT-04
    verification:
      - kind: unit
        ref: "packages/modules/events/tests/next-event-card.test.tsx (7); apps/web/lib/events-view.test.ts#31-36; i18n/messages.test.ts#06-08 Início"
        status: pass
    human_judgment: false
  - id: D7
    description: "Início end to end: no card and the feed with nothing coming; a 120-character in-person title at two lines and no CTA, then 'Fazer check-in' appearing at the window's real opening WITHOUT a reload, whole at 320px, opening the ticket; the online Entrar anchor (target _blank, data-no-prefetch, no meeting host, nothing recorded by the render); Entrar kept after an online check-in with the Presente pill; a Manaus device reading the São Paulo wall clock"
    requirement: EVENT-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events inicio 1-5 (mobile-chromium)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Prohibition closed: the raw meeting URL never reaches the calendar file or the Google link"
    requirement: EVENT-04
    verification:
      - kind: unit
        ref: "events-calendar.test.ts#calendarLocation online, #buildIcs online, #googleCalendarHref online (a stray meetingUrl field is ignored)"
        status: pass
      - kind: e2e
        ref: "events.spec.ts#events agenda 2 and 3 (file, Google href and page content never contain meet.example.test)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Google Calendar honours the TEMPLATE link's UTC Z dates with no ctz (RESEARCH A2), a phone's calendar app imports the .ics with the right times, and the card and the pair read as the approved sketch 006 on a real phone (E09 long-text and E05+E09 timezone backstops)"
    requirement: EVENT-06
    verification: []
    human_judgment: true
    rationale: "A2 has no automated oracle (a real Google account is needed), calendar-app import and visual fidelity need a device, and real-device UAT is blocked locally until 01.1 (phones cannot reach *.localhost)"

duration: 45min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 08: the calendar export and the Início "Próximo evento" card Summary

**A member can put any upcoming event into Google Calendar or any `.ics` calendar in one tap. The file is an RFC 5545 serialisation, tested byte by byte: UTC times, escaped text, 75-octet folding that never splits an accent. For an online event, the location is the app's own gated `/entrar`, never the meeting link. Início now shows the tenant's next active event at home-slot order 7. When the check-in window opens, the same card grows "Fazer check-in" (in person) or `Entrar` (online) without a reload.**

## Performance

- **Duration:** about 45 min (2,692 s)
- **Started:** 2026-09-27T20:28:48Z
- **Completed:** 2026-09-27T21:13:40Z
- **Tasks:** 2 of 2
- **Files modified:** 26 (1,966 insertions, 13 deletions)

## Accomplishments

- **The calendar serializer (Task 1, TDD).** `apps/web/lib/events-calendar.ts` holds six pure, server-side functions:
  - `utcStamp` turns an instant into `YYYYMMDDTHHMMSSZ`.
  - `icsEscape` escapes the backslash first, then `;`, `,` and every line break.
  - `foldIcsLine` folds at 75 octets by UTF-8 length, walking code points.
  - `calendarLocation` gives venue plus address in person, or `{origin}/eventos/{id}/entrar` online.
  - `buildIcs` builds one VCALENDAR with one VEVENT: `UID {id}@{host}`, `DTSTAMP` from the caller's `nowMs`, `CONFIRMED` or `CANCELLED`, and CRLF line ends.
  - `googleCalendarHref` builds the `action=TEMPLATE` link with UTC dates and no time-zone parameter. `details` is capped at 1,000 characters and keeps the detail URL whole.

  The functions read only the fields `CalendarEvent` names, so a stray meeting-URL key never reaches the output.
- **The `.ics` route (Task 1).** `GET /eventos/{id}/agenda.ics` is a pure read of the member-lane `loadEvent`. It serves `text/calendar; charset=utf-8`, `attachment; filename="evento.ics"` and `private, no-store`. The origin is `primaryHostOrigin()`, falling back to the request origin. A malformed id, an unknown event or another tenant's event gets a 404, and a transport failure gets a 502.
- **The calendar pair (Task 1).** After the action zone, the detail page shows "Adicionar à agenda" with two outline anchors: "Google Agenda" (built on the server, opened in a new context) and "Arquivo .ics" (a download). It shows in P0-P2 for every member whatever their answer, and is hidden when the event is cancelled or ended.
- **`GET /v1/events/next` (Task 2).** It reuses the upcoming projection (the viewer's own row and the two counts, in one statement) with `status = 'active' and ends_at > now()`, soonest first, `limit 1`. It needs no permission and is registered before `/{eventId}`.
- **The home slot (Task 2).** `eventsModule` declares `home: [{ order: 7 }]`, between stories (5) and the feed (10). `registry.test.ts` pins the order against both neighbours, and `modules.test.ts` checks the bootstrap copy verbatim.
- **`NextEventCard` (Task 2).** This module UI has one row anchor holding the thumb, the overline, a two-line title, the place, the count plus pill, and a chevron. The CTA is a sibling slot below the row. The card ships no words, no route and no clock.
- **The web renderer (Task 2).**
  - `loadNextEvent` turns every failure into `null` and logs `events.next_failed` with its shape only.
  - `nextEventCardView` builds the when-line, place, count, pill and check-in mode in the tenant's zone.
  - `eventsHome` renders the card with `EventActions`' exact anchors: the brand check-in link, or the plain `Entrar` with `target="_blank"` and `data-no-prefetch`. It catches its own errors and never rejects.
  - `NextEventRefresh` schedules one `router.refresh()` at the next boundary within 24 h, and re-arms on the server's phase.

## Task Commits

1. **Task 1 RED: failing calendar-export tests against an inert stub.** `30fea12` (test)
2. **Task 1 GREEN: the RFC 5545 serializer and the Google template link.** `c0aa144` (feat)
3. **Task 1: the `agenda.ics` route and the calendar pair on the detail page.** `39ca884` (feat)
4. **Task 2: the Início "Próximo evento" card, from `GET /v1/events/next` to the boundary refresh.** `9aa37c0` (feat)

**Plan metadata:** the `docs(06-08)` commits that add this file and update STATE.md / ROADMAP.md.

## TDD Gate Compliance

Task 1 carries `tdd="true"`. Its gate sequence in `git log`:

- **RED:** `30fea12 test(06-08): …`. `events-calendar.test.ts` (18 cases) ran against a deliberately inert, self-documented stub `events-calendar.ts` (every export answers `''`), so every case failed on an assertion rather than an import error.
  - **Command:** `pnpm --filter @rede-social/web exec vitest run lib/events-calendar --reporter=json`
  - **Result:** exit code 1, with **18 tests, 0 passed, 18 failed** (the run's real counts).
  - **Target test:** `buildIcs a hostile title with an embedded newline and BEGIN:VEVENT stays ONE escaped SUMMARY in ONE VEVENT`, which failed with `AssertionError: expected [] to have a length of 1 but got +0`.
  - **Normalization:** a throwaway scratchpad normalizer (never committed) turned the real Vitest JSON into column-0 `not ok N - <name>` lines plus the `# tests 18` / `# pass 0` / `# fail 18` trailer. The record's fields are top-level.
  - **Gate verdict:** `gsd-tools check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`).
- **GREEN:** `c0aa144 feat(06-08): …` replaced the stub, and the same 18 cases passed.
- **REFACTOR:** there was no separate commit. The Biome format fix happened before the GREEN commit, and nothing further needed cleaning.

Task 2 is `type="auto"` (not TDD). Its tests were written alongside the implementation.

## Files Created/Modified

- `apps/web/lib/events-calendar.ts` / `.test.ts`: the serializer, the Google link and their 18 cases.
- `apps/web/app/(app)/eventos/[eventId]/agenda.ics/route.ts`: the download.
- `apps/web/app/(app)/eventos/[eventId]/page.tsx`: `CalendarPair`, `exportOrigin()`, and the server-built Google href.
- `apps/web/lib/events-view.ts` / `.test.ts`: `EventDetailView.calendar` (case 30) and `nextEventCardView` (cases 31-36).
- `apps/web/lib/events.ts`: `loadNextEvent`.
- `apps/web/lib/registry.tsx`: `eventsHome`, `nextEventCta` and `events: { home: [eventsHome] }`.
- `apps/web/components/events/NextEventRefresh.tsx`: the boundary-refresh island.
- `apps/web/messages/pt-BR/events.json` / `i18n/messages.test.ts`: the calendar, home and when keys, pinned and formatted.
- `packages/modules/events/{contracts,server/*,module.ts,ui/*}`: `nextEventSchema`, `getNextEvent`, `GET /next`, `home: [{ order: 7 }]` and `NextEventCard`.
- `packages/modules/events/tests/next-event-card.test.tsx`: 7 cases.
- `apps/api/tests/{unit/registry,integration/events,integration/modules,integration/isolation}.test.ts`: the order pin, the `next` describe, the verbatim bootstrap entry, and the f2 host case.
- `apps/web/e2e/events.spec.ts` / `events-admin.ts`: the `events agenda` and `events inicio` describes, plus three fixtures.
- `scripts/check-static-routes.sh`: the `agenda.ics` route in `REQUIRED_KEYS`.

## Verification run

- **Web.**
  - `vitest run lib/events-calendar lib/events-view i18n`: 483 passed.
  - `typecheck` and `lint` pass (337 files).
  - `check-ui-literals`: OK.
  - `build` passes, with `/eventos/[eventId]/agenda.ics` built as ƒ.
  - `check-static-routes`: 52 guarded, 0 offenders.
- **Module.** `typecheck`, `lint` and `test` pass (8 files, 89 tests).
- **API.** `typecheck`, unit `test` (19) and `lint` pass. `pnpm boundaries`: 689 files in 11 packages, no issues.
- **Database.** `pnpm db:reset && pnpm db:seed`, then `pnpm test:integration`: 35 files, 590 tests passed. `events.test.ts` passes 19 on its own and `isolation.test.ts` passes 27.
- **Playwright (mobile-chromium, VIDEO_PROVIDER=fake).**
  - On a fresh seed, `-g "events agenda|events inicio"`: 9 passed. The 9 on the other projects skip by design (one throwaway tenant, on the phone).
  - The regression run (the whole `events.spec.ts` plus feed, stories, shell and the phase smokes): events, feed and shell all green. The stories results are in Issues Encountered.
- **Teardown.** 0 `e2e-*` tenants and 0 fixture GoTrue users remain. No server is left on :3000 or :8787.
- **Acceptance greps.**
  - `ctz` outside comments: 0. `'use client'` in `events-calendar.ts`: 0. `/entrar` in `events-calendar.ts`: 4.
  - In the route: `text/calendar; charset=utf-8` appears 1 time and `private, no-store` 1 time.
  - `home: [{ order: 7 }]`: 1. `events: { home: [eventsHome] }`: 1.
  - `next/link` in the card and the registry: 0. `status = 'active'` in the service: 6. `'use client'` in `NextEventRefresh.tsx`: 1.

## Decisions Made

See `key-decisions` in the frontmatter. In short:

- The pair stacks below `sm` (deviation 1).
- The card has no inset of its own (deviation 2).
- The `.ics` route is a pure read, so it needs no prefetch guard.
- The export closes 06-06's meeting-URL prohibition.
- `next` skips cancelled events and returns one in progress.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Layout, orchestrator note 4] The calendar pair stacks below `sm`**
- **Found during:** Task 1 (the `events agenda` e2e measurement)
- **Measurement:** Chromium on the dev build, member detail page. Each value is the number of lines the label takes.

  | Layout | Width | Anchor width | "Google Agenda" | "Arquivo .ics" |
  |---|---|---|---|---|
  | Before: `grid-cols-2` | 390px | 157px | 2 lines | 1 line |
  | Before: `grid-cols-2` | 320px | 122px | 2 lines | 2 lines |
  | After: `grid-cols-1 sm:grid-cols-2` | 390px / 320px | full width | 1 line | 1 line (stacked) |
  | After | 700px (≥ `sm`) | half width | 1 line | 1 line (side by side) |

- **Issue:** UI-SPEC row E06 says the two labels fit a half-width outline button at 320px. The drawing found they do not at 320, and the measurement shows "Google Agenda" wraps at 390 too.
- **Fix:** the drawing's own first option, `grid grid-cols-1 gap-3 sm:grid-cols-2`, uses an existing breakpoint and no new token or size. Test 1 of the `events agenda` e2e asserts one-line labels with no overflow, stacked at 390 and 320, and side by side at 700.
- **Committed in:** `39ca884`

**2. [Rule 1 - Layout] The Início card has no `mx-4` / `px-4` of its own**
- **Found during:** Task 2
- **Issue:** UI-D-214 draws `SectionTitle px-4` and `Card mx-4`, but `/inicio`'s column already insets its slots by `px-4` on a phone, and the feed's cards carry no margin of their own. The plan's classes would have doubled the inset to 32px and misaligned the card from the feed below. In the sketch, the card and the feed card share the 16px edge.
- **Fix:** `NextEventCard` renders the heading and the `Card` with no horizontal inset, and the host column provides it. This is documented in the component.
- **Committed in:** `9aa37c0`

**3. [Rule 2 - SCHEMA-CONVENTIONS §(j) rule 2] `/v1/events/next` joins the isolation f2 host-mismatch loop**
- **Found during:** Task 2
- **Issue:** Every new endpoint needs its cross-tenant host case, and `isolation.test.ts` is not in the plan's list (the 06-01 to 06-07 precedent).
- **Fix:** The path was added to the f2 loop: 403 `TENANT_HOST_MISMATCH` with no tenant name or id in the body. `events.test.ts` `next` case 5 also asserts the mismatch.
- **Committed in:** `9aa37c0`

**4. [Rule 3 - Test hygiene, project note on seed drift] The `next` ordering cases run in a throwaway tenant**
- **Found during:** Task 2
- **Issue:** Proving "the soonest active", "a cancelled sooner one skipped" and "none gives null" on the seeded tenants would have moved seeded rows that other files count.
- **Fix:** The describe provisions its own tenant with `events` on and one member, and removes it afterwards (events, membership, user, tenant). The seeded lanes are only read, and each is compared with the database's own "soonest active not-ended" answer for its tenant. The first run's teardown order was wrong (the membership blocked the tenant delete). It was fixed, and the one leftover throwaway tenant and user were removed by hand. No `e2e-*` rows remain.
- **Committed in:** `9aa37c0`

**5. [Rule 3 - Test mechanics] Three e2e fixtures**
- **Found during:** Task 2
- **Issue:** `createEventsTenant` enabled only `events`, but the plan's Início spec needs `feed` too. `insertEvent`'s `make_interval(mins => …)` takes whole minutes, and the live switch needs the window to open about 25 s ahead.
- **Fix:** `createEventsTenant(slug, password, extraModules = [])`, `moveEventStartSeconds(eventId, seconds)` and `cancelEventNow(eventId)`. Existing callers are unchanged.
- **Committed in:** `9aa37c0`

**6. [Rule 1 - Correctness] `NextEventRefresh` also takes the server's `phase`**
- **Found during:** Task 2
- **Issue:** With only `boundaries` as a prop, the effect's dependencies never change after the first `router.refresh()`, because the instants stay put. The timer would not re-arm for the next boundary (the start, then the end).
- **Fix:** A `phase` prop is the re-arm trigger, which is the `EventActions` precedent. The island still renders nothing, and the clock is read only inside the effect.
- **Committed in:** `9aa37c0`

**7. [Rule 2 - Robustness] `eventsHome` catches its own composition errors, and `loadNextEvent` never navigates**
- **Found during:** Task 2
- **Issue:** The plan's loader swallows read failures, but a throw while composing (a formatter, the translator) would still reject into `homeSlotsFor`'s generic error card (UI E09/error).
- **Fix:** The renderer wraps its body in a try/catch that logs `events.next_failed` with `stage: 'render'` and returns `null`. The loader handles a refusal, a 5xx, a transport error and an invalid body the same way, and never calls `redirect()`: the page's bootstrap owns session problems.
- **Committed in:** `9aa37c0`

**8. [Rule 2 - Hardening] `.ics` route details**
- **Found during:** Task 1
- **Fix:**
  - A transport failure answers `502` (the browser's own download error, UI E06/error).
  - The response carries `X-Content-Type-Options: nosniff`.
  - `LOCATION` is omitted when empty, and an empty description gives just the detail URL in `DESCRIPTION`, with no leading blank lines.
  - Orchestrator note 5 was confirmed: the handler has no side effect and no external redirect, so the prefetch 204 guard does not apply.
- **Committed in:** `c0aa144`, `39ca884`

**9. [Rule 3 - Adaptation, orchestrator notes 1-2] Plan age**
- The home orders were re-confirmed against the current tree (stories 5, feed 10), so 7 still sits strictly between them, and `registry.test.ts` now pins both neighbours. The concurrency e2e is stronger than the plan's version: it also downloads an ONLINE event inside its window, where following `/entrar` would record a walk-in, and shows the export records nothing.

---

**Total deviations:** 9. Rule 1: 3. Rule 2: 3. Rule 3: 3.
**Impact on plan:** These changes were needed for correctness, the approved drawing, the gates or the current tree. There is no scope creep: 06-09's phase gates are untouched.

## Issues Encountered

- **Stories regression triage.** I ran `feed`, `stories`, `shell` and the phase smokes, because the seeded demo's `/inicio` now carries the card. That run started right after the full integration suite, with no reset in between. It showed 9 stories failures, and I triaged each one rather than assuming a cause:
  - On a freshly reset and seeded database, with the card registered, 7 of them pass. They were seed drift from the integration run, as the project notes on integration and seed drift predict.
  - The Phase 05.2 smoke passes 6/6 when run whole. Its step 4 cannot run alone under `-g`, because it depends on steps 1-3.
  - One is pre-existing: the stories manage-screen test ("add the EXPIRED story…") fails because Next's dev overlay (`<nextjs-portal>`) intercepts a tap on `/stories/destaques`. An A/B probe on a fresh seed with the events home slot unregistered failed identically, so the card is not the cause. It is logged in `deferred-items.md`.
- **Disk.** Free space fell to 4.4 GB after the first dev e2e runs. `apps/web/.next/dev` (Turbopack's gitignored dev cache inside the repo, regenerated by the next `next dev`; no dev server was running) held 3.0 GB, so I removed it, which brought free space back to 7.4 GB. `.turbo/cache` was empty. Nothing outside the repo was touched. It ended at 6.7 GB.
- One `pnpm db:reset` exited 1 transiently during the A/B probe. The immediate re-run succeeded, and every result above comes from a reset that succeeded.
- The browser logs "Service Worker registration blocked by Playwright" and an `unhandledRejection` reading `waiting` in the dev e2e, as in 06-03 through 06-07. Neither fails a test.

## Known Stubs

None. The RED stub in `events-calendar.ts` was fully replaced by the GREEN commit.

## Threat Flags

None. The new surfaces are covered by the plan's threat model:
- the `.ics` route and the Google link: T-06-50, T-06-51, T-06-52 and T-06-54;
- `GET /v1/events/next`: T-06-53;
- the Início renderer's never-reject behaviour: T-06-55.

Each `mitigate` item is implemented and proved by the unit, integration and e2e cases listed in `coverage`. T-06-56 (A2) is accepted, as planned, and waits on the phone UAT.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 8 of 9 Phase 6 plans are complete (06-01 through 06-08). 06-09, the phase gates, is next.
- EVENT-06 is complete. EVENT-02 and EVENT-04 are also declared by 06-09, so `requirements.ready-ids` decides whether they flip to Complete now.
- Real-phone UAT waits on 01.1 (phones cannot reach `*.localhost`). It covers:
  - Google Calendar honouring the UTC `…Z` dates (A2);
  - a phone calendar importing the `.ics`;
  - a calendar tap on `/entrar` reaching the installed PWA;
  - the Início card's look against sketch 006 surface 5.

---
*Phase: 06-events*
*Completed: 2026-09-27*

## Self-Check: PASSED

- All 7 created key files exist on disk.
- Commits `30fea12`, `c0aa144`, `39ca884` and `9aa37c0` are in `git log`. `git rev-list --count 73a3126..HEAD` measured 4 before the docs commit.
- The sketch 006 README and `MANIFEST.md` were neither modified nor staged by this plan.
