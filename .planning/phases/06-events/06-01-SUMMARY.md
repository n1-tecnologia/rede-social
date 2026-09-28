---
phase: 06-events
plan: 01
subsystem: events
tags: [events, tracer, module-package, drizzle, rls, event_secrets, deferrable-fk, timezone, keyset, pgtap, nextjs, intl]

requires:
  - phase: 05-communities-stories
    provides: the communities module package shape, the cover tuple rule (05-09), the keyset envelope and the Chip/InfiniteScroll list machinery (05.1)
  - phase: 05.3-reels
    provides: the current registry/nav state (Reels tab at order 30, D-121 requires) this plan extends
provides:
  - "@rede-social/module-events package (module, contracts, db, server, ui) registered as `events`, Eventos tab at order 40"
  - "events + event_secrets tables with the D-213 CHECKs, the admin-only event_secrets_staff_all policy and two hand-written deferrable FKs"
  - "POST /v1/events (requirePermission('events.event.manage'), wall clock -> UTC in SQL) and GET /v1/events?period=upcoming|past (two literal keyset statements)"
  - "event.published domain event (ids and instants only)"
  - "bootstrap.tenant.timezone"
  - "apps/web/lib/events-view.ts, the one Intl formatter for events; /eventos with Próximos/Passados chips, paging, states"
  - "140-events.sql pgTAP facts, 020 isolation cases for both tables, isolation.test b4, bootstrap timezone case"
  - "apps/web/e2e/events-admin.ts fixtures (createEventsTenant, insertEvent, deleteEventsTenant, readEventInstants, closeEventsAdmin)"
affects: [06-03, 06-04, 06-05, 06-06, 06-07, 06-08, 06-09, 07-notifications, 01.1-deploy]

actuals:
  tokens: 88462
  tasks: 3
  commits: 3

plan_head_before: 395e32478bd89f6666a74fcbcdbf9a855fd13f32

tech-stack:
  added: []
  patterns:
    - "Role-gated secrets table: a second table behind an inline tenant_role policy, because an admin and a member are the same DB role"
    - "Deferrable composite FK carrying an XOR across two tables through a redundant discriminator, plus a deferrable existence FK"
    - "Wall-clock input converted to UTC inside the insert (`(date || ' ' || time)::timestamp at time zone t.timezone`)"
    - "Server-side poster views: every events string formatted on the server from one Date.now() per request/action"

key-files:
  created:
    - packages/modules/events/module.ts
    - packages/modules/events/contracts/index.ts
    - packages/modules/events/db/schema.ts
    - packages/modules/events/server/service.ts
    - packages/modules/events/server/routes.ts
    - packages/modules/events/server/checkin-code.ts
    - packages/modules/events/ui/EventCover.tsx
    - packages/modules/events/ui/EventPoster.tsx
    - supabase/migrations/20260927145318_events.sql
    - supabase/tests/140-events.sql
    - apps/web/lib/events.ts
    - apps/web/lib/events-view.ts
    - apps/web/app/(app)/eventos/page.tsx
    - apps/web/app/(app)/eventos/EventsList.tsx
    - apps/web/app/(app)/eventos/actions.ts
    - apps/web/app/(app)/eventos/loading.tsx
    - apps/web/messages/pt-BR/events.json
    - apps/api/tests/integration/events.test.ts
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/events-admin.ts
  modified:
    - packages/contracts/src/bootstrap.ts
    - apps/api/src/routes/me.ts
    - apps/api/src/app.ts
    - apps/api/src/modules/registry.ts
    - packages/ui/src/index.ts
    - scripts/seed.ts
    - supabase/tests/020-tenant-isolation.sql
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/bootstrap.test.ts
    - apps/api/tests/integration/modules.test.ts
    - apps/web/e2e/shell.spec.ts
    - apps/web/e2e/phase2-smoke.spec.ts
    - apps/web/e2e/phase4-smoke.spec.ts
    - apps/web/e2e/phase5-smoke.spec.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "D-217 store: event_secrets behind the inline policy `tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'` (no helper function, no column privileges)"
  - "Every event gets a check-in code at create time for both formats (checkin_code NOT NULL), drawn with crypto.randomInt from the 31-symbol alphabet"
  - "period is a closed enum (400 on PAST/soon), limit clamps 1..25; a start already in the past is accepted and lands in Passados"
  - "Wall-clock input is validated as a real calendar day/time in Zod, so an impossible date is a 400, never a 500 at the ::timestamp cast"
  - "event.published carries ids and instants only; Phase 7 reads the title through a published events contract"
  - "The pgTAP file is 140-events.sql because 130 belongs to 05.3's reels"

patterns-established:
  - "pgTAP deferred-FK proof: lives_ok('set constraints all immediate') as the retroactive positive control, then one-statement CTE pairs (pg_temp.event_pair) under immediate keys"
  - "Events web strings: lib/events-view.ts takes (tz, nowMs, t); client components receive EventPosterView, never an instant"

requirements-completed: [EVENT-01, EVENT-02]

coverage:
  - id: D1
    description: "Tracer: an admin's POST /v1/events becomes a poster on every member's Eventos tab (module package -> registry -> tab -> RSC route)"
    requirement: EVENT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events.test.ts#events tracer"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events tracer (mobile-chromium, desktop-chromium)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Schema facts inside Postgres: the five CHECKs, the deferred FKs under immediate mode, the immediate delete cascade, the role-gated secrets policy (member 0 / admin 1), both list statements on their index by name"
    requirement: EVENT-01
    verification:
      - kind: other
        ref: "pnpm supabase test db — supabase/tests/140-events.sql (29 assertions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TENANT-05 for events and event_secrets: 020 cases with positive controls and B-lane symmetry; isolation.test b4 and /v1/events in the f2 host-mismatch loop"
    requirement: EVENT-02
    verification:
      - kind: other
        ref: "pnpm supabase test db — supabase/tests/020-tenant-isolation.sql (plan 131)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b4. events"
        status: pass
    human_judgment: false
  - id: D4
    description: "bootstrap.tenant.timezone carries tenants.timezone and follows it (Sao_Paulo -> Manaus); the wall clock is converted in the tenant zone (19:00 SP = 22:00Z, 23:00Z after the switch)"
    requirement: EVENT-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/bootstrap.test.ts#1a. Phase 6"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/events.test.ts#8. the wall clock is converted in the TENANT zone"
        status: pass
    human_judgment: false
  - id: D5
    description: "API battery: both keysets (tie by id), in-progress in upcoming, cancelled in both lists, clamps, hostile cursor, closed period, member 403 / admin 201, every refusal code, URL only in event_secrets, past start, create idempotency, cover rule, event.published once, MOD-04 toggle"
    requirement: EVENT-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/events.test.ts#events list and create (13 cases)"
        status: pass
      - kind: unit
        ref: "packages/modules/events/tests/*.test.* (25 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "/eventos list: Próximos/Passados chips as server-read links, silent D-93 fallback, the in-progress 'Agora' pill and live overline, the cancelled pill with a grayscale photo, Passados most recent first, tenant wall clock on a Manaus device, empties and error states"
    requirement: EVENT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#events lista (mobile-chromium, desktop-chromium)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/events-view.test.ts; apps/web/app/(app)/eventos/EventsList.test.tsx; apps/web/i18n/messages.test.ts#06 — events list strings"
        status: pass
    human_judgment: false
  - id: D7
    description: "The Eventos tab in every nav list (demo Início · Comunidades · Reels · Eventos · Perfil, lab Início · Reels · Eventos · Perfil) and in the bootstrap ordering"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/shell.spec.ts, phase2-smoke.spec.ts, phase4-smoke.spec.ts, phase5-smoke.spec.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/modules.test.ts#1, #2, #13"
        status: pass
    human_judgment: false
  - id: D8
    description: "E03 long-text backstop on a real phone: the 120-character title clamps to two lines and the 60-character venue truncates inside the 4/5 poster"
    requirement: EVENT-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/events.spec.ts#E03 long text (mobile-chromium, 320px)"
        status: pass
    human_judgment: true
    rationale: "The must-have names a phone check at the phase UAT on top of the 320px e2e; real-device UAT waits for Phase 01.1 (phones cannot reach *.localhost)"

duration: 49min
completed: 2026-09-27
status: complete
---

# Phase 6 Plan 01: Events tracer Summary

**`@rede-social/module-events` with `events` + an admin-only `event_secrets` store tied by deferrable FKs, `POST /v1/events` converting the admin's wall clock to UTC inside Postgres in the tenant's zone, the upcoming/past keyset `GET /v1/events`, `bootstrap.tenant.timezone`, and the `/eventos` tab with Próximos/Passados chips, all proved by pgTAP, the two-tenant gate, an API battery and e2e.**

## Performance

- **Duration:** 49 min
- **Started:** 2026-09-27T14:44:56Z
- **Completed:** 2026-09-27T15:34:10Z
- **Tasks:** 3 (1 tracer + 2 expansions)
- **Files modified:** 54 (9,624 insertions, 32 deletions; the drizzle snapshot is most of it)

## Accomplishments

- A new module package, registered in the API tier: the Eventos tab at nav order 40, `defaultRolePermissions` (admin: manage + attendance.read + respond; support and member: respond), and a shape-only `event.published` subscriber.
- Two tables. The meeting URL and the check-in code live only in `event_secrets`, and a member lane reads zero rows of it (pgTAP fact 8). The D-213 venue-XOR-URL rule holds across both tables through `event_secrets_event_fk (tenant_id, event_id, event_format)`, and `events_secrets_fk` makes "every event has its secrets row" true at commit time.
- `createEvent` writes both halves in one `withTenantTx` and converts `{ date, time }` with `… at time zone t.timezone` inside the insert. It maps `events_window_chk` to `end_before_start` and emits `event.published` after commit. `listEvents` runs two literal statements, each served by its index, which pgTAP pins by name.
- The web side: `lib/events.ts` (one fetch implementation), `lib/events-view.ts` (every string via `Intl` pinned to the tenant zone, from one `nowMs`), `EventCover` in 4 geometries and `EventPoster` in the module UI, and `/eventos` with chips, `EventsList` (paging, pull-to-refresh, skeletons, both empties, both error states), `actions.ts` and `loading.tsx`.
- Seed: seven identical-looking events per tenant with secrets. They cover upcoming with a cover, online, in progress and multi-day, past, both cancelled cases, and a 120-character title / 60-character venue with no cover.

## Task Commits

1. **Task 1 (tracer): module package, tables, create/list API, bootstrap timezone, seed, /eventos, tracer tests**: `3452346` (feat)
2. **Task 2 [BLOCKING schema]: 140-events pgTAP, 020 isolation cases, isolation b4, bootstrap timezone case**: `ca73cdf` (test)
3. **Task 3: chips, paging, states, API battery, nav lists, list e2e**: `24bf6b9` (feat)

**Plan metadata:** see the `docs(06-01)` commit that adds this file.

Tracer gate: interactive run, `end-of-phase`, automated-only `<verify>`. All three verify commands were re-run green before expansion. ⚡ Tracer verified end-to-end — expanding.

## Verification run

- `pnpm --filter @rede-social/module-events typecheck/lint/test` passed (25 tests). `pnpm --filter @rede-social/api typecheck/lint/test` passed (19 unit tests). `pnpm boundaries` passed.
- `pnpm db:generate` wrote nothing, and `git status -- supabase/migrations` is clean.
- `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: PASS, 15 files, 396 tests.
- `pnpm test:integration` (the whole folder, after reset + seed): 31 files, 541 tests passed.
- `pnpm --filter @rede-social/web typecheck/lint`, `vitest run lib/events-view i18n "app/(app)/eventos"` (262 tests), `check-ui-literals`, `build` and `check-static-routes` (43 guarded, 0 offenders) all passed.
- `VIDEO_PROVIDER=fake playwright test events.spec.ts shell.spec.ts phase2-smoke.spec.ts phase5-smoke.spec.ts phase4-smoke.spec.ts`: 55 passed, 4 skipped. The skips are the desktop 320px backstop and pixel-project scoping.

## Decisions Made

- The D-217 store shape, the inline role literal, every code generated at create time, the full `EVENT_ISSUES` vocabulary, the non-clamping `period`, and past starts being accepted all follow planning decisions 1-7 as written.
- **Nav order 40, no home slot yet** (planning decision 9). The Início card lands with its renderer in 06-08.
- **Impossible wall clocks are a generic 400.** `wallClockSchema` refines to a real calendar day and time, and the superRefine skips `end_before_start` when either side is impossible, so the generic issue is not hidden behind a machine code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The pgTAP file is `140-events.sql`, not `130-events.sql`**
- **Found during:** Task 2
- **Issue:** 05.3 took `130-reels.sql`. The plan says to use the next free number in that case.
- **Fix:** Created `supabase/tests/140-events.sql`. The migration header points at it.
- **Committed in:** `ca73cdf`

**2. [Rule 1 - Bug in the plan's example] 2026-10-12 is a Monday**
- **Found during:** Task 1/3 (formatter)
- **Issue:** The plan's formatter example `sáb., 12 de out.` for `2026-10-12T22:00Z` is not the real weekday. Intl renders `seg., 12 de out.`.
- **Fix:** `events-view.test.ts` pins `seg., 12 de out.`. The weekday always comes from `Intl`.
- **Committed in:** `24bf6b9`

**3. [Rule 3 - Tree drift] The lab nav is `Início · Reels · Eventos · Perfil`**
- **Found during:** Task 3
- **Issue:** The plan expected lab `Início · Eventos · Perfil`, but 05.3 turned `reels` on for rede-lab, and it contributes because `feed` is on.
- **Fix:** Followed the current tree. `shell.spec.ts` lab list is `['Início', 'Reels', 'Eventos', 'Perfil']`, and the demo lists are `['Início', 'Comunidades', 'Reels', 'Eventos', 'Perfil']`. The phase2 feed-off list is `['Início', 'Comunidades', 'Eventos', 'Perfil']`.
- **Committed in:** `24bf6b9`

**4. [Rule 3 - Blocking] `phase4-smoke.spec.ts` also asserts the demo nav**
- **Found during:** Task 3
- **Issue:** This spec is not in the plan's file list, but its two demo nav assertions would fail with the new tab. Its feed-only throwaway tenant stays `['Início', 'Perfil']`.
- **Fix:** Updated its two demo lists and ran it with the e2e set (8/8 green).
- **Committed in:** `24bf6b9`

**5. [Rule 2 - Missing validation] Impossible wall clocks**
- **Found during:** Task 1
- **Issue:** The plan's regex-only `wallClockSchema` would let `2026-02-30` or `24:00` reach `::timestamp` and answer a 500.
- **Fix:** Added a real-calendar refine, and `end_before_start` is only compared between real wall clocks. `contracts.test.ts` case 7 pins it.
- **Committed in:** `3452346`

**6. [Rule 3 - Blocking] No generic error keys in `common`**
- **Found during:** Task 3
- **Issue:** UI-D-216 says the first-load error uses "existing `common` keys", but `common.json` has none.
- **Fix:** Added `events.errors.{title,generic,retry}` next to `errors.loadMore`, in the communities wording.
- **Committed in:** `24bf6b9`

**7. [Rule 2 - SCHEMA-CONVENTIONS §(j) rule 2] `/v1/events` joins the f2 host-mismatch loop, and b4 reuses a free letter**
- **Found during:** Task 2
- **Issue:** Every new endpoint needs its cross-tenant host case. The `b4` letter was retired in 05.2-11 and marked "stays unused".
- **Fix:** Added `/v1/events` to the f2 loop. The plan's `b4. events` case takes the free letter, and its comment records the reuse.
- **Committed in:** `ca73cdf`

**8. [Rule 3 - Blocking] Tab tap under `next dev` on the phone project**
- **Found during:** Task 1 (tracer e2e)
- **Issue:** On mobile, Next's dev issues pill (`<nextjs-portal>`) sits over the BottomNav and intercepts the coordinate click. This is the artifact already recorded in the stories and reels specs.
- **Fix:** The tracer dispatches the click at the tab element (`dispatchEvent('click')`), with a comment.
- **Committed in:** `3452346`

**9. [Rule 2 - Test gap] Added `EventsList.test.tsx`**
- **Found during:** Task 3
- **Issue:** Task 3's verify runs `vitest run … "app/(app)/eventos"`, but the plan listed no test under that path.
- **Fix:** Added a component test modelled on `CommunitiesList.test.tsx` that uses the real catalog. It covers the order of views, both empties and the first-load error.
- **Committed in:** `24bf6b9`

**10. [Minor] `InfiniteScroll` uses the viewport root**
- **Issue:** The plan says "the root from `useScrollContainer()`", but the shipped `CommunitiesList` (the analog) passes no root. Reading a ref's `.current` in render is also a React Compiler hazard.
- **Fix:** Followed `CommunitiesList`. The IntersectionObserver still clips against the scrolling ancestor.

---

**Total deviations:** 10 (1 plan-example bug, 3 missing validation or test gaps, 5 blocking or tree-drift adaptations, 1 minor analog alignment). **Impact:** all are correctness or tree-alignment changes. There is no scope creep and no sibling module's work was overwritten.

## Issues Encountered

- **Stale flag left behind by an interrupted run.** `modules.test.ts` case 13 turns `chat` on for rede-lab and restores it at its end. Its first run, before the list update, failed mid-case, so later runs briefly saw lab `chat` enabled. The flag was set back to its seeded value, and every later full run (after reset + seed) was green. This was test state only; no code changed.
- `pnpm test:integration -- <name>` does not filter (orchestrator note 3), so each verify ran the whole folder.

## Known Stubs

| File | Line | Stub | Resolution |
|------|------|------|------------|
| apps/web/lib/events-view.ts | eventPosterView `href` | Each poster links to `/eventos/{id}`, which resolves to Next's not-found until the detail route exists | 06-03 adds `/eventos/[eventId]` (planned in this plan's action) |
| apps/web/app/(app)/eventos/EventsList.tsx | empty Próximos | Only the member body is rendered; the manager body and "Criar evento" CTA are absent | 06-04 adds the create control and the manager empty state (UI E03/empty truth) |

## Notes for Phase 7

- **Event payloads carry ids and instants only.** `event.published` is exactly `{ tenantId, eventId, actorUserId, format, startsAt, endsAt }`, pinned by `events-payload.test.ts` and `events.test.ts` case 12. Reminder and "new event" copy needs the title from a read through a published events contract, not from the payload (RESEARCH open question 2, planning decision 8).
- **The API must deploy before the web.** `bootstrapSchema.tenant.timezone` is now required, so a web build that parses the bootstrap against an older API would fail to parse it (Phase 01.1 deploy note).

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 06-03 through 06-09 can build on the module package, the schema (the attendance table joins `events_tenant_id_uq`), the keyset list, the formatter module and `events-admin.ts`.
- Out of this plan's file list and left for a later plan: replacing the pinned `America/Sao_Paulo` in `apps/web/lib/feed-view.tsx` and `apps/web/components/media/MediaAssetRow.tsx` with `bootstrap.tenant.timezone`.
- Phase 6 progress: 2 of 9 plans complete (06-01, 06-02). The D-33 review of sketch 006 is still with the developer and gates no 06-01 task.

---
*Phase: 06-events*
*Completed: 2026-09-27*

## Self-Check: PASSED

- 20/20 key created files found on disk.
- Commits `3452346`, `ca73cdf` and `24bf6b9` were found in `git log`.
- The measured count `git rev-list --count 395e324..HEAD` was 3 before this docs commit.
