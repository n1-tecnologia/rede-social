---
phase: 06-events
plan: 04
subsystem: events
tags: [events, admin, form, edit, cancel, reactivate, cover, format-switch, deferred-fk, is-distinct-from, pgtap, playwright, D-212, D-213, D-214, UI-D-211, UI-D-212, ADMIN-04]

requires:
  - phase: 06-events (06-01)
    provides: events + event_secrets with the deferrable FKs, POST /v1/events, eventInputSchema, events-view.ts, /eventos, events-admin.ts fixtures
  - phase: 06-events (06-02)
    provides: sketch 006 (D-33 gate, approved provisionally 2026-09-27), surface 1 "formulario-*", the dialogs and "detalhe-cancelado-gestor-reativar"
  - phase: 06-events (06-03)
    provides: event_attendances + guard trigger, the /eventos/[eventId] detail page and its cancelled banner, SegmentedControl, the throwaway-tenant e2e pattern
provides:
  - "GET /v1/events/{id}/edit (manage only): stored instants converted back to tenant wall clock in SQL, plus the admin-only meeting URL"
  - "PUT /v1/events/{id}: whole-event replacement with eventInputSchema; row lock, cover assert-vs-self-heal, is-distinct-from no-op detection on both tables, format switch through the deferred FK"
  - "PATCH /v1/events/{id} { status }: guarded cancel (409 event_ended) and reactivate (409 reactivate_started); no delete route"
  - "event.updated (timesChanged), event.cancelled, event.reactivated after commit, ids and instants only"
  - "EventForm (create/edit) at /eventos/novo and /eventos/[eventId]/editar, gated on events.event.manage"
  - "the /eventos title-row create control and the manager's Próximos empty state; the detail's Gerenciar evento card and the banner's Reativar door"
  - "CancelEventControl / ReactivateEventControl islands; createEventAction, updateEventAction, cancelEventAction, reactivateEventAction"
  - "lib/events.ts createEvent, loadEventForEdit, updateEvent, setEventStatus; lib/events-view.ts tenantZoneLabel"
  - "e2e fixtures secretsFor and waitForReadyCover; a deleteEventsTenant that survives a real cover upload"
affects: [06-05, 06-06, 06-07, 06-08, 06-09, phase-07-notifications]

actuals:
  tokens: 45600
  tasks: 3
  commits: 4
plan_head_before: 094b3d2d64548469a3134482b2098d4987b6eb8a

tech-stack:
  added: []
  patterns:
    - "Whole-event replacement as two guarded UPDATEs (`… where (tuple) is distinct from (tuple)`) after a `for update` lock: zero rows on both = observably inert, one bit per table = one event"
    - "Format switch = two statements in one transaction, legal because event_secrets_event_fk is DEFERRABLE INITIALLY DEFERRED; pgTAP proves it with `set constraints all deferred`, the two statements, then `set constraints all immediate` as the check point"
    - "Status write as ONE guarded UPDATE per transition, disambiguated on zero rows by a single read (miss 404 / same status 200 / otherwise the named 409)"
    - "Wall clock back out in SQL: to_char(ts at time zone t.timezone, 'YYYY-MM-DD' | 'HH24:MI'), the exact inverse of the insert conversion"
    - "Server-computed form flags (canCancel, canReactivate, cancelledLocked, zone label) passed to a client form as booleans and strings"

key-files:
  created:
    - apps/api/tests/integration/events-admin.test.ts
    - apps/web/app/(app)/eventos/EventForm.tsx
    - apps/web/app/(app)/eventos/EventForm.test.tsx
    - apps/web/app/(app)/eventos/novo/page.tsx
    - apps/web/app/(app)/eventos/novo/not-found.tsx
    - apps/web/app/(app)/eventos/[eventId]/editar/page.tsx
    - apps/web/app/(app)/eventos/[eventId]/CancelEventControl.tsx
    - apps/web/app/(app)/eventos/[eventId]/ReactivateEventControl.tsx
  modified:
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/index.ts
    - packages/modules/events/module.ts
    - packages/modules/events/tests/contracts.test.ts
    - packages/modules/events/tests/events-payload.test.ts
    - supabase/tests/140-events.sql
    - apps/api/tests/integration/isolation.test.ts
    - apps/web/lib/events.ts
    - apps/web/lib/events-view.ts
    - apps/web/lib/events-view.test.ts
    - apps/web/messages/pt-BR/events.json
    - apps/web/i18n/messages.test.ts
    - apps/web/app/(app)/eventos/page.tsx
    - apps/web/app/(app)/eventos/EventsList.tsx
    - apps/web/app/(app)/eventos/actions.ts
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
    - apps/web/e2e/fixtures/README.md
    - scripts/check-static-routes.sh
    - .planning/WINDOWS.md

key-decisions:
  - "PUT answers the member-facing EventSummary (no URL key); only the manage-guarded edit read ever carries meetingUrl"
  - "A URL-only change (event_secrets moved, events did not) still emits event.updated with timesChanged false; events.updated_at stays put in that case"
  - "In edit mode the end prefill is OFF from the start (endTouched = true): the stored end is a value the admin chose, so moving the start never overwrites it"
  - "cancel/reactivate from the edit form land on the detail (router.push) with their toast; from the detail banner they refresh in place"
  - "A 404 on create/update with a cover is disambiguated in the BFF like communities 05-09 (create: the cover; update: re-read the event), mapped to form.errors.coverInvalid"
  - "/eventos/novo gets a not-found.tsx that re-exports the events not-found, so a member typing the URL sees the one events screen instead of Next's default"
  - "The discard confirm keeps the one-word 'Descartar' and the zone helper prints 'Horário Padrão de Brasília', both as approved in sketch 006"

patterns-established:
  - "E2E with a real cover upload: ensureWorker() in beforeAll, waitForReadyCover() before submit, and a teardown that deletes events, then media_assets, then the tenant"
  - "Hydration proof before typing on a form route: a filechooser event or a segmented toggle flipping aria-pressed"

requirements-completed: [EVENT-01]

coverage:
  - id: D1
    description: "The edit read returns tenant wall clock equal to what was posted (23:30 SP = 02:30Z next day) plus the admin's URL; a member gets 403"
    requirement: EVENT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-admin.test.ts#1. the edit read answers the wall clock that was posted"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#f2 (the edit read joins the host-mismatch loop)"
        status: pass
    human_judgment: false
  - id: D2
    description: "PUT replacement: one event.updated per content change with timesChanged false/true, an identical PUT writes nothing and emits nothing, both format switches persist with the response carrying no URL, and an RSVP survives the edit"
    requirement: EVENT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-admin.test.ts#2, #3, #4"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/events-payload.test.ts#10-13"
        status: pass
    human_judgment: false
  - id: D3
    description: "Format switch in the database: both directions satisfy event_secrets_event_fk when checked after the switch; events.format alone is refused 23503; a URL on an in-person secrets row is refused 23514 event_secrets_url_chk"
    requirement: EVENT-01
    verification:
      - kind: other
        ref: "pnpm supabase test db — supabase/tests/140-events.sql (plan 35; suite 16 files, 432 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Cover on edit: a foreign NEW cover is a bare 404, an unusable one cover_invalid, a retired stored cover self-heals to null once"
    requirement: EVENT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-admin.test.ts#5"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cancel/reactivate: 200/200 with one event.cancelled, the cancelled event stays in the member's list, RSVP on it 409 cancelled, one event.reactivated before the start, 409 reactivate_started after it, 409 event_ended after the end; member PUT/PATCH 403; a lab id a bare 404; no delete verb"
    requirement: EVENT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events-admin.test.ts#6-9"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/events-payload.test.ts#14-16"
        status: pass
    human_judgment: false
  - id: D6
    description: "EventForm behaviour: submit disabled when empty, the +2 h prefill past midnight that stops once the end is edited, only the visible side submitted, inline errors only after the first submit, the dirty X discard confirm, edit-mode rows per server flag"
    requirement: EVENT-01
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/eventos/EventForm.test.tsx (7 tests)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/events-view.test.ts#21 tenantZoneLabel; apps/web/i18n/messages.test.ts#06-04"
        status: pass
    human_judgment: false
  - id: D7
    description: "The whole admin path on a phone: icon-only 44x44 create control and manager empty state, create in person with a real cover and the prefill, create online with no URL byte in the page, edit in wall clock, a Presencial/Online round trip storing no link, cancel seen by the member (pill, banner, disabled pair), Reativar from the banner, member not-found on /eventos/novo and /editar"
    requirement: EVENT-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events admin (mobile-chromium, 3 tests)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts (events tracer|lista|detalhe|rsvp|admin, both projects: 31 passed, 7 skipped)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The form reads as the approved sketch 006 surface 1 on a real phone (390 and 320 px): the native date/time pickers on iOS Safari and Android Chrome, the counters, the cover preview, and the cancel/reactivate dialogs"
    requirement: EVENT-01
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved design and the OS-native picker behaviour need a human on a real device; real-device UAT is blocked locally until 01.1 (phones cannot reach *.localhost)"

duration: 25min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 04: The admin's half of EVENT-01 Summary

**The admin creates, edits and cancels events from a phone: a manage-only edit read that returns tenant wall clock in SQL, a whole-event `PUT` whose format switch rides the deferred FK and whose identical replay writes nothing, a guarded cancel/reactivate `PATCH` with three Phase 7 events, and the sketch-006 `EventForm` with the +2 h end prefill and a Presencial/Online switch that submits only the visible side.**

## Performance

- **Duration:** about 25 min (1,478 s)
- **Started:** 2026-09-27T18:28:02Z
- **Completed:** 2026-09-27T18:52:40Z
- **Tasks:** 3 of 3
- **Files modified:** 31 (3,612 insertions, 34 deletions), `.planning/WINDOWS.md` included

## Accomplishments

- **The write API (Task 1).** `GET /v1/events/{id}/edit`, `PUT /v1/events/{id}` and `PATCH /v1/events/{id}`, each behind the literal `requirePermission('events.event.manage')` (4 routes counting create). The PUT locks the row, resolves a CHANGED cover strictly and self-heals a retired stored one, then runs two `is distinct from` UPDATEs, so a replayed save moves no `updated_at` and emits nothing. The status write is one guarded UPDATE per transition. `event.updated` carries `timesChanged`; `event.cancelled` / `event.reactivated` fire once per transition. There is no delete route.
- **The database facts.** pgTAP `140-events.sql` now proves the format switch in both directions with the keys deferred and checked after the switch, plus two negative controls (plan 29 → 35).
- **The admin UI (Task 2).** `EventForm` in create and edit mode, the two gated routes, the title-row create anchor, the manager empty state, the detail's "Gerenciar evento" card and the banner's "Reativar evento", and the two confirm-first control islands. Every catalog string is pinned.
- **The phone proof (Task 3).** The `events admin` e2e walks the whole path in a throwaway tenant, with a real cover upload derived by a real worker.

## Task Commits

1. **Task 1: the admin's write API, pgTAP, the integration battery** - `d4fb237` (feat)
2. **Task 2: EventForm, the routes, the create control, the manage card, cancel/reactivate** - `e8822a6` (feat)
   - Docs follow-up: `e2d27f2` closed WINDOWS entry 53 (the manager empty state and "Criar evento" now render).
3. **Task 3: the `events admin` e2e on mobile-chromium** - `5f937b9` (test)

**Plan metadata:** the `docs(06-04)` commits that add this file and update STATE.md / ROADMAP.md.

## Verification run

- `pnpm --filter @tria/module-events typecheck`, `lint` and `test` (48 tests) passed. `pnpm --filter @tria/api typecheck` and `lint` passed. `pnpm boundaries` passed.
- `pnpm db:generate` wrote nothing, and `git status -- supabase/migrations` is clean (no schema change).
- `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: 16 files, 432 tests, PASS.
- `pnpm --filter @tria/api exec vitest run tests/integration/events-admin.test.ts`: 9 passed. `pnpm test:integration` (the whole folder): 33 files, 560 tests passed.
- `pnpm --filter @tria/web typecheck` and `lint`, and `vitest run "app/(app)/eventos" lib/events-view i18n` (405 tests) passed. `check-ui-literals` is OK. `pnpm --filter @tria/web build` passed with `/eventos/novo` and `/eventos/[eventId]/editar` dynamic (ƒ). `check-static-routes.sh`: 46 guarded routes, 0 offenders.
- `pnpm db:reset && pnpm db:seed && VIDEO_PROVIDER=fake playwright test events.spec.ts -g "events admin" --project=mobile-chromium`: 3 passed. The full events spec on both projects: 31 passed, 7 skipped (the phone-only cases on desktop).
- Teardown check after the e2e: 0 tenants, 0 GoTrue users and 0 orphan `media_assets` rows remain for `e2e-events-admin`.
- All acceptance greps pass: 4 manage literals in routes, no `method: 'delete'`, `timesChanged` in the contracts, one `'event.reactivated'`, 6 `is distinct from` in the service, 8 `set constraints all immediate` in 140, the anchor and no `role ===` in `/eventos/page.tsx`, `notFound()` in both routes, `eventInputSchema` in the form, one `longGeneric`, the REQUIRED_KEYS entry, one `describe('events admin'`, the literal `not.toContain('meet.example.test')`, and `secretsFor`.

## Decisions Made

See `key-decisions` in the frontmatter. In short:

- The PUT response is the member-facing summary, so the URL never travels back.
- A URL-only change still announces `event.updated` (with `timesChanged: false`).
- Edit mode never prefills the end.
- Cancel/reactivate from the form land on the detail; from the banner they refresh in place.
- A cover 404 on save is named `cover_invalid` by the BFF, as in communities.
- `/eventos/novo` shows the events not-found screen.
- The approved sketch wording is kept ("Descartar", "Horário Padrão de Brasília").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Tree drift] The pgTAP file is `supabase/tests/140-events.sql`**
- **Found during:** Task 1
- **Issue:** The plan names `130-events.sql`; 05.3 took 130 and 06-01 created `140-events.sql` (orchestrator note 2).
- **Fix:** Extended 140 (plan 29 → 35).
- **Committed in:** `d4fb237`

**2. [Rule 2 - SCHEMA-CONVENTIONS §(j) rule 2] The edit read joins the isolation f2 loop**
- **Found during:** Task 1
- **Issue:** Every new endpoint needs its cross-tenant host case; `isolation.test.ts` is not in the plan's list.
- **Fix:** Added `GET /v1/events/{id}/edit` to the GET-only f2 host-mismatch loop. The PUT/PATCH cross-tenant cases are events-admin case 9 (bare 404 on a lab id).
- **Committed in:** `d4fb237`

**3. [Rule 2 - Missing test] Unit coverage for the new service paths and contracts**
- **Found during:** Task 1
- **Fix:** `events-payload.test.ts` cases 10-16 (the three exact key sets, `timesChanged`, the identical-body no-op, the 404 and window mappings, the status refusals) and `contracts.test.ts` cases 15-17 (edit and status schemas, the XOR on a replacement).
- **Committed in:** `d4fb237`

**4. [Rule 2 - Missing critical] A `form.errors.coverInvalid` string**
- **Found during:** Task 2
- **Issue:** The API answers `cover_invalid` (and a bare 404 that the BFF resolves to it) on save, and the UI-SPEC form table has no line for it; falling back to the generic save line would hide the cause.
- **Fix:** Added `events.form.errors.coverInvalid` with the communities wording ("Não foi possível usar esta imagem de capa. Escolha outra.").
- **Committed in:** `e8822a6`

**5. [Rule 2 - UI E01/error] `/eventos/novo/not-found.tsx`**
- **Found during:** Task 2
- **Issue:** `notFound()` in `novo/page.tsx` would render Next's default 404, not the events screen the plan's e2e step 9 expects ("the not-found screen").
- **Fix:** `novo/not-found.tsx` re-exports `[eventId]/not-found`. `[eventId]/editar` already inherits it.
- **Committed in:** `e8822a6`

**6. [Rule 2 - Missing test] `tenantZoneLabel` test**
- **Found during:** Task 2
- **Issue:** `lib/events-view.test.ts` is in Task 2's verify path but not in its file list.
- **Fix:** Test 21 pins São Paulo ("Horário Padrão de Brasília"), Manaus ("Horário Padrão do Amazonas") and the fallback for an unknown zone.
- **Committed in:** `e8822a6`

**7. [Rule 3 - Adaptation] The name `Input` has no counter prop**
- **Found during:** Task 2
- **Issue:** UI-D-212 asks for a counter on "Nome do evento", but the shipped `Input` primitive has none (only `Textarea` does).
- **Fix:** The form renders the counter below the input with `Textarea`'s own classes (right-aligned, `tabular-nums`, `text-danger` at the cap, `aria-live="off"`). No primitive change.
- **Committed in:** `e8822a6`

**8. [Rule 3 - Adaptation] The cover tap row follows `CommunityForm`**
- **Found during:** Task 2
- **Issue:** The sketch draws a full-width "pick" row; the plan says to clone the CommunityForm chrome.
- **Fix:** An outline "Adicionar capa" / "Trocar capa" button (with the image icon) plus a ghost "Remover capa", as in `CommunityForm`. The hero preview renders on both breakpoints and the `FileDropZone` from `md`.
- **Committed in:** `e8822a6`

**9. [Rule 3 - Blocking] The e2e needs a real worker and a ready cover**
- **Found during:** Task 3
- **Issue:** The API accepts a cover only once it is `ready`, which the worker's derivation sets; the Playwright config starts no worker.
- **Fix:** `ensureWorker()` in `beforeAll` and a new `waitForReadyCover` helper polled before submit.
- **Committed in:** `5f937b9`

**10. [Rule 1 - Bug] `deleteEventsTenant` could not delete a tenant that owns media**
- **Found during:** Task 3 (the first green run failed in `afterAll`)
- **Issue:** `media_assets.tenant_id` does not cascade, and the interrupted teardown had already removed the memberships, stranding the GoTrue users.
- **Fix:** Delete the tenant's events, then its `media_assets`, then the tenant, and find the users by membership OR by the fixture's `@<slug>.local` domain. Verified: zero rows left after the next run. The plan's "`deleteEventsTenant` cleanup of GoTrue users" already existed from 06-01, so this is the only change to it.
- **Committed in:** `5f937b9`

**11. [Rule 3 - Test selector] The cover button is picked by tag**
- **Found during:** Task 3
- **Issue:** The sr-only file input carries the same accessible name as the visible button (a strict-mode violation).
- **Fix:** The spec targets `[data-event-form] button` with the text. No product change.
- **Committed in:** `5f937b9`

---

**Total deviations:** 11. Rule 1: 1. Rule 2: 5. Rule 3: 5.
**Impact on plan:** All were needed for correctness, the gates or the current tree. There is no scope creep: Participantes (06-07), the check-in CTAs (06-05), `Entrar` and the redirect re-check (06-06) and the calendar pair (06-08) remain those plans' work.

## Issues Encountered

- The browser logs "Service Worker registration blocked by Playwright" and an `unhandledRejection` reading `waiting`, as in 06-03. Both predate this plan and fail no test.
- `pnpm test:integration -- <x>` does not filter (orchestrator note 6), so the whole folder ran once; the single file ran through `pnpm --filter @tria/api exec vitest run`.
- The uploaded cover's bytes stay in the local Storage bucket after the e2e teardown (a few hundred bytes per run; no row points at them).

## Known Stubs

None. The detail's manage card comment names 06-07's "Participantes" row, which is that plan's work and does not affect this plan's goal.

## Threat Flags

None. The three new routes are the ones in the plan's threat model (T-06-19..T-06-26), each mitigated as registered.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 06-05 (in-person check-in) and 06-06 (online `Entrar`) add their CTAs to the action zone; the cancel path they must respect (`status = 'cancelled'`) is now reachable from the UI.
- 06-07 adds "Participantes" above "Editar evento" in the same manage `Card`, gated on `events.attendance.read`.
- Phase 7 subscribes to `event.updated` (re-arm on `timesChanged`), `event.cancelled` and `event.reactivated`, whose key sets are pinned by `events-payload.test.ts` and `events-admin.test.ts`.
- EVENT-01 stays Pending in REQUIREMENTS.md until 06-09 (which also declares it) finishes.
- Phase 6 progress: 4 of 9 plans complete (06-01..06-04). Real-phone UAT of the form (D8) waits on 01.1.

---
*Phase: 06-events*
*Completed: 2026-09-27*

## Self-Check: PASSED

- 8/8 key created files exist on disk.
- Commits `d4fb237`, `e8822a6`, `e2d27f2` and `5f937b9` are in `git log`; `git rev-list --count 094b3d2..HEAD` measured 4 before the docs commits.
- The sketch 006 README and MANIFEST were neither modified nor staged by this plan.
