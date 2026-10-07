---
phase: quick-261007-n1g
plan: 01
subsystem: events
tags: [events, schedule, jsonb, contracts, pgtap, legacy-fallback, release-order, pt-BR]
status: complete
requirements: [EVENT-01, EVENT-02, TENANT-03]
plan_head_before: 806d3f02e31219e5ba01026729007d705c36a9e3
commits: 3
dependency-graph:
  requires: [261007-gzu (optional response field precedent)]
  provides: [events.schedule column, schedule on the events contract, web form sending schedule as its own field]
  affects: [packages/modules/events, apps/api, apps/web events pages, docs/DEPLOY.md]
tech-stack:
  added: []
  patterns: [jsonb column with a per-item jsonpath CHECK, optional (not defaulted) request key, optional response key for strict-web release order, legacy read fallback with lazy migration on save]
key-files:
  created:
    - supabase/migrations/20261007194945_event_schedule.sql
    - supabase/migrations/meta/20261007194945_snapshot.json
    - supabase/tests/145-event-schedule.sql
    - apps/api/tests/integration/events-schedule.test.ts
  modified:
    - packages/modules/events/db/schema.ts
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/README.md
    - packages/modules/events/tests/contracts.test.ts
    - packages/modules/events/tests/events-payload.test.ts
    - supabase/migrations/meta/_journal.json
    - apps/web/lib/event-extras.ts
    - apps/web/lib/event-extras.test.ts
    - apps/web/lib/events-view.ts
    - apps/web/lib/events-view.test.ts
    - apps/web/app/(app)/eventos/EventForm.tsx
    - apps/web/app/(app)/eventos/EventForm.test.tsx
    - apps/web/app/(app)/eventos/[eventId]/editar/page.tsx
    - apps/web/app/(app)/eventos/[eventId]/page.tsx
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
    - docs/pendencias-backend.md
    - docs/DEPLOY.md
decisions:
  - "Storage: a column events.schedule (jsonb not null default '[]') with events_schedule_chk, not a table event_schedule_items"
  - "Shared limits and the normaliser live in the events module contracts, not packages/contracts"
  - "schedule is .optional() (not defaulted) on the request and .optional() on the detail and edit answers"
  - "Legacy text schedule stays readable; the first save from the form moves it into the column; no bulk data migration"
actuals:
  tokens: 20500
  tasks: 3
  commits: 3
metrics:
  completed: 2026-10-07
---

# Quick 261007-n1g: persist the event "Cronograma" in the database and the API

The event schedule typed in step 2 of the event form now lives in its own column, `events.schedule` (jsonb, up to 30 moments of day, time and title), validated by the API and independently by a database CHECK, tenant-isolated by the existing `events_tenant_isolation` policy, returned on the event detail and on the admin edit read, and no longer written into the 4000-character description. Events written before keep their text schedule readable and move to the column on their next save. Nothing was pushed; the migration exists only on the local stack.

## Storage decision: column, not table (D-01)

A column `schedule jsonb not null default '[]'` on `events`, with the shape CHECK `events_schedule_chk`. A table `event_schedule_items` was rejected for four reasons, all verified against the code:

1. The schedule is only written as a WHOLE with the event (the PUT is a whole-event replacement, D-214) and only read WITH the event; it is never queried, filtered, joined or paginated per item.
2. At most 30 items of about 100 bytes, so row size is a non-issue (the CHECK bounds the value at about 12 KB even for a direct writer).
3. A table would add a statement to the create, to the guarded update and to both reads, breaking the one-statement projection contract that `feed-query-budget.test.ts` measures and the scripted statement sequences of `events-payload.test.ts`, and it would need a second tenant-first index, a composite FK, a policy and its pgTAP. The unit tests assert the statement counts are unchanged (3 for create, 4 for update).
4. The column rides the existing `events_tenant_isolation` policy: no policy was added or widened, so there is no new surface to leak across tenants.

A table would pay off only if items needed identity (per-item reminders, per-session check-in); no source artifact asks for that, and the column can be split into a table later by an expand migration.

## What was built

**Task 1 (tracer, commit 8b8001c): the backend slice, POST body to a member's GET.**
- Drizzle column in `packages/modules/events/db/schema.ts` and the generated migration `20261007194945_event_schedule.sql` (one `ADD COLUMN` with `DEFAULT '[]'::jsonb NOT NULL` and one `ADD CONSTRAINT`), with a comment header (why, column-not-table, expand-only, release order). The CHECK is: jsonb array, at most 30 items, and no item failing the per-item jsonpath (object, integer day 1..31, time `HH:MM` 24 h, title 1..80 characters and not blank). A second `pnpm db:generate` reported "No schema changes, nothing to migrate".
- Contract (`packages/modules/events/contracts/index.ts`): `EVENT_SCHEDULE_MAX_ITEMS` (30), `EVENT_SCHEDULE_MAX_TITLE` (80), `EVENT_SCHEDULE_MAX_DAY` (31), `EVENT_SCHEDULE_TIME_RE`, strict `eventScheduleItemSchema`, pure `normaliseEventSchedule` (one-line titles, invalid and duplicate items dropped, stable sort by day then time, capped, idempotent); `schedule` on `eventInputSchema` (optional), `eventDetailSchema` and `eventEditSchema` (optional). `eventSummarySchema` is untouched (list and write answers carry no schedule).
- Service: `createEvent` and `updateEvent` write the normalised schedule as a JSON string cast to jsonb inside the existing insert and the existing guarded update (`schedule = n.schedule`, `e.schedule` and `n.schedule` in both sides of the `is distinct from` tuples, so an identical PUT still writes nothing and a schedule-only PUT is a change); `getEvent` and `getEventForEdit` read it through a `toSchedule` helper that rebuilds each item from exactly day, time and title. Logs carry only `scheduleItems` (a count).
- Route descriptions updated (POST/PUT 200/400, detail and edit 200).

**Task 2 (commit 5b660a8): the web.**
- `event-extras.ts`: `ScheduleItem` is the contract type; the three schedule caps in `EXTRAS_CAPS` and `normaliseSchedule` / `isScheduleTime` come from the contract (one definition); `composeEventDescription` ignores the programme; `splitEventDescription` still parses the legacy lines (its round-trip check uses an internal legacy-capable compose); new `effectiveSchedule(stored, legacy)`.
- `events-view.ts`: the page programme is `effectiveSchedule(event.schedule, legacy)`; both guard and branch use it, so the example still shows only for an engaged viewer with no programme.
- `EventForm.tsx`: `initial.schedule` seeds the moments (else the legacy block); the payload carries `schedule` only when it has moments; the `dirty` baseline is composed the same way, so an untouched legacy event is clean. The edit page passes `event.schedule ?? []`.

**Task 3 (commit 2b9e26f): docs and the cross-layer proof.**
- `docs/pendencias-backend.md` item 5 marked done by the backend (decision, legacy fallback); `docs/DEPLOY.md` new section "Event schedule (quick 261007-n1g)"; module README names the new exports.
- Two new e2e tests in the serial `events admin` describe (titles contain "cronograma"), plus a `scheduleFor` fixture helper.

## Compatibility reasoning

- **Contract location.** The real layout is not `packages/contracts`: `packages/contracts/src/events.ts` is the domain-event bus and "knows no module". Event schemas and limits live in `packages/modules/events/contracts/index.ts`, imported by the API and by apps/web as `@rede-social/module-events/contracts` (apps/web never imports `packages/db`). The shared schedule limits and the normaliser went there.
- **Optional response, release order migrations, then web, then API.** The web parses every API answer with strict schemas. `schedule` is `.optional()` on `eventDetailSchema` and `eventEditSchema` (the 261007-gzu `emailUnconfirmed` precedent), so the new web reads an old API's answers. The API always emits an array.
- **Request key omitted when empty.** `eventInputSchema.schedule` is `.optional()`, NOT `.default([])`: the form sends the parsed output, and a defaulted key would put `schedule: []` on every save, which an OLD strict API rejects. The form also omits the key when the list is empty. In the window between the web and the API releases, every save without a schedule still works; a save WITH a schedule is refused loudly by the old API (400) instead of being silently lost, and the old description path is deliberately not kept (D-03).
- **Stale-client consequence (T-n1g-07, accepted).** A PUT that omits `schedule` clears it (the established whole-event replacement rule, like `category`, `capacity`, `coverAssetId`). A stale cached client from before the web release that edits an event after the API release would therefore clear its schedule on save. The PWA update flow makes the window small, and the data is admin-authored and re-enterable. Recorded in `docs/DEPLOY.md`.

## Legacy fallback and lazy migration

No bulk data migration exists (verified at planning time: the local database holds no event with a Programação block; the fallback is covered by unit tests and e2e test 5, which inserts such an event). The page and the edit form read the stored field when it has items, else the old text schedule. Saving an old event from the form writes the field and a description without the programme lines. The form's `dirty` baseline is composed from the same normalisation, so an untouched legacy event does not look edited (unit test and e2e).

## Commands run and results

RED evidence (each run red before its implementation):
- `pnpm supabase test db` with `145-event-schedule.sql` and no column: `ERROR: column "schedule" of relation "events" does not exist`; 145 failed 30/30 (bad plan, 0 run).
- `vitest tests/contracts.test.ts` red: 5 failed, 33 passed; `tests/events-payload.test.ts` red: 7 failed, 35 passed.
- web: `lib/event-extras.test.ts` 4 failed, 11 passed; `lib/events-view.test.ts` 2 failed, 48 passed; `EventForm.test.tsx` 10 failed (the "no schedule key" case already passed).
- The HTTP integration file `events-schedule.test.ts` was written together with, not before, the implementation, so there is no red run for it.

Green evidence:
- `pnpm db:generate --name=event_schedule` wrote the migration, journal entry and snapshot; a second `pnpm db:generate` printed "No schema changes, nothing to migrate".
- `pnpm supabase migration up`: applied only `20261007194945_event_schedule.sql` (local stack).
- `pnpm supabase test db`: `145-event-schedule.sql ... ok` (30/30). The run as a whole is FAIL because of failures that are NOT from this change (see below).
- module-events: `vitest run` 12 files, 160 tests passed; typecheck and lint clean.
- api: `vitest run tests/integration/events-schedule.test.ts tests/integration/events-capacity.test.ts tests/integration/events.test.ts tests/integration/events-admin.test.ts` 4 files, 45 tests passed (9 of them the new file); typecheck and lint clean.
- web: full unit suite 107 files, 2151 tests passed; typecheck and lint clean.
- `TURBO_CACHE=local:r pnpm turbo run typecheck lint test --filter=@rede-social/module-events --filter=@rede-social/api --filter=@rede-social/web`: 11 of 11 tasks successful.
- `pnpm boundaries`: no issues found in 14 packages. `bash scripts/check-ui-literals.sh`: OK (no pt-BR catalog key was added or changed).
- `SEED_PASSWORD=Segredo123 pnpm --filter @rede-social/web exec playwright test events.spec.ts phase6-smoke.spec.ts --project=mobile-chromium`: 48 passed (2.9 m), including events admin tests 4 and 5 (the new cronograma tests). Ports 8787 and 3000 were free before the run and after it.

## Deviations from Plan

None in behaviour. Notes:
- **[Rule 3 - tooling]** `sed -i` on macOS and the missing `timeout` command broke two shell invocations (one re-run of Playwright was needed); no code impact.
- **Formatting.** `biome format --write` / `biome check --write` were run on my own files only (never repo-wide).
- **`scheduleFor` returns `{ schedule, description }`** (not just the schedule) so the e2e can assert in one read that the description holds no programme line; same file as the plan.

## Pre-existing pgTAP failures (not caused by this change, not touched)

`pnpm supabase test db` is FAIL as a whole both before and after the migration:
- `154-moderation-log.sql` test 28 (the known-red moderation-log fact, integration residue).
- `090-feed.sql` test 33 and `130-reels.sql` tests 10-13 (index-scan / seq-scan plan assertions on `feed_posts`). They failed in the very first run, BEFORE the migration existed, then passed in a second pre-migration run, then failed again after it: planner-dependent on the local database state, unrelated to events. I did not investigate or modify them.

## What cannot be verified locally (manual checks for the developer)

1. Apply the migration to homolog and production with the usual push (this change applied it to the local stack only). hml shares production's database, so one apply reaches both; confirm the column exists with its default afterwards (the read-only query is in `docs/DEPLOY.md`).
2. Release in the order migrations, then web, then API; in the short window between web and API confirm an event saved WITHOUT a schedule works and one WITH a schedule shows a generic error rather than losing data.
3. On a real phone (installed PWA), create an event with a two-day schedule and check the Programação tabs; reload the app once after the web release so no stale cached form clears a schedule on save.
4. Open one pre-existing event that has a schedule as text in production data (a tenant that used the front before this change): it must still show Programação, and after one save from the form the text block is gone and the schedule survives.

Also not exercised here: the real Vercel and Cloud Run behaviour in the web-first window and a stale installed PWA.

## E2E scope

Run: `events.spec.ts` (all events specs on mobile-chromium, including the two new cronograma tests) and `phase6-smoke.spec.ts`. Deliberately NOT run: the other specs of the events map group (events-prefetch, phase7-smoke, phase8-smoke, notifications, csp) and the platform-wizard catalog spec. The dev-server e2e is manual-only (`docs/deploy/ci.md`) and none of them touches the form's schedule path.

## Known Stubs

None. The labelled schedule EXAMPLE the detail page shows to an engaged viewer with no programme is pre-existing (REINE prototype) and unchanged.

## Threat Flags

None. No new endpoint, auth path or trust boundary: the column rides the existing events routes and policy. Threat register T-n1g-01 to T-n1g-06 are mitigated as planned (strict Zod item schema, service normaliser, database CHECK, pgTAP 145 cross-tenant negative with positive control, integration cases 6 and 7, count-only logging); T-n1g-07 accepted (stale client).

## Self-Check: PASSED

- Created files present: `supabase/migrations/20261007194945_event_schedule.sql`, `supabase/migrations/meta/20261007194945_snapshot.json`, `supabase/tests/145-event-schedule.sql`, `apps/api/tests/integration/events-schedule.test.ts` (all in commit 8b8001c).
- Commits present: 8b8001c, 5b660a8, 2b9e26f (`git rev-list --count 806d3f0..HEAD` = 3); none carries a Co-Authored-By or Claude attribution line; no file deletions in the range; nothing pushed.
