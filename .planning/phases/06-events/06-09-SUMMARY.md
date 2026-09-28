---
phase: 06-events
plan: 09
subsystem: events
tags: [events, timezone, tenant-timezone, feed, media, conventions, schema-conventions, smoke, exit-gate, playwright, seed, e2e-hygiene, D-66, UI-D-203, EVENT-01, EVENT-02, EVENT-03, EVENT-04, EVENT-05, EVENT-06]

requires:
  - phase: 06-events (06-01)
    provides: tenant.timezone on the bootstrap, the Eventos tab and list, events-admin.ts fixtures
  - phase: 06-events (06-03 to 06-08)
    provides: the detail, RSVP, admin form, check-in, online Entrar, Participantes, calendar export and Início card the smoke witnesses; the four SECURITY/definer/XOR/guard patterns §(l) documents
provides:
  - "apps/web/lib/feed-view.tsx: absoluteTimeFormatter(timeZone) memoised per zone; postCardView(post, now, tf, shareOrigin, timeZone) and commentView(comment, now, nowLabel, timeZone) take the zone as a required argument; postCardBase (the card without its absolute time) for the Reel mapping"
  - "MediaAssetRow's timeZone prop is required (DEFAULT_TENANT_TIME_ZONE removed); /configuracoes/midia passes bootstrap.tenant.timezone through MediaLibrary"
  - "packages/core/docs/SCHEMA-CONVENTIONS.md §(l) Secrets inside a tenant (four patterns, their why, reference names and test rules) and the §(k) checklist line pointing at it"
  - "apps/web/e2e/phase6-smoke.spec.ts: the Phase 6 witness (ENABLED / DISABLED / FLIP, the four ROADMAP criteria, the Manaus feed-clock shift)"
  - "apps/web/e2e/events-admin.ts: moveEventWindow, setTenantTimezone, sameDayWindowAt (pure) and sameDayWindow (a now-relative window kept on one tenant-local day within a case's bounds)"
  - "apps/web/e2e/admin.ts: memberVisibleStoryIds, memberVisibleHighlightStoryIds (the stories service's MEMBER_VISIBLE predicate)"
  - "scripts/seed.ts: events anchored to the tenant-local noon of the seed day"
  - "A green local exit gate (pnpm verify) with every Phase 6 spec, pgTAP file and integration file, and events-prefetch.spec.ts passing in e2e:pwa"
affects: [phase-07-notifications, phase-07-chat, phase-08-tenant-settings, pilot-UAT, 01.1-cloud]

actuals:
  tokens: 21127
  tasks: 2
  commits: 13
plan_head_before: 93c68f54814258095d8a351ee00fabf8be6b8fea

tech-stack:
  added: []
  patterns:
    - "Every tenant-app formatter takes the zone as a REQUIRED argument read from the server-parsed bootstrap (never from a request), so the type checker finds every caller; the platform panel's PANEL_TIME_ZONE stays the platform's own"
    - "Seed data that renders as calendar copy is anchored to a tenant-local wall-clock hour (noon of the seed day, computed in Postgres from the tenant's zone), never to floor(now, hour), so a seed run at any hour yields the same single-day shapes"
    - "A now-relative e2e fixture whose case measures local-day copy asks sameDayWindow for its window with the phase bounds it needs; the helper moves the window onto one local day or throws, and never bends the case"
    - "An e2e expectation about seeded rows that another spec may legitimately delete is read from the database with the service's own predicate (activeReadyStoryCount, memberVisibleStoryIds), not hard-coded"

key-files:
  created:
    - apps/web/lib/feed-view.test.ts
    - apps/web/e2e/phase6-smoke.spec.ts
    - .planning/phases/06-events/06-09-SUMMARY.md
  modified:
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/registry.tsx
    - apps/web/lib/reels.ts
    - apps/web/lib/reels.test.ts
    - apps/web/lib/events-view.ts
    - apps/web/app/(app)/post/[postId]/page.tsx
    - apps/web/app/(app)/comunidades/actions.ts
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/app/(app)/inicio/feed-actions.ts
    - apps/web/components/media/MediaAssetRow.tsx
    - apps/web/app/(app)/configuracoes/midia/MediaLibrary.tsx
    - apps/web/app/(app)/configuracoes/midia/page.tsx
    - packages/core/docs/SCHEMA-CONVENTIONS.md
    - apps/web/e2e/events-admin.ts
    - apps/web/e2e/events.spec.ts
    - apps/web/e2e/admin.ts
    - apps/web/e2e/stories.spec.ts
    - apps/web/e2e/comunidades.spec.ts
    - apps/web/e2e/reels.spec.ts
    - apps/web/e2e/phase2-smoke.spec.ts
    - apps/web/e2e/phase52-smoke.spec.ts
    - apps/web/e2e/media-video.spec.ts
    - apps/web/e2e/platform-branding.spec.ts
    - scripts/seed.ts
    - .planning/phases/06-events/deferred-items.md

key-decisions:
  - "06-09: every absolute timestamp in the tenant app is formatted in bootstrap.tenant.timezone; the zone is a required argument (postCardView, commentView, MediaAssetRow), server actions read it once per action through the request-cached getBootstrap(), and the Reel keeps a zone-free postCardBase because it never renders the absolute time"
  - "06-09: the seed anchors every event to the tenant-local noon of the seed day (a real Phase 6 seed bug: a seed after 22:00 São Paulo put the upcoming event at 22:00-00:00, a multi-day range)"
  - "06-09: phase52-smoke reads the surviving seeded Destaques pins from the database (the stories service's MEMBER_VISIBLE predicate) instead of restoring the seed in media-video's afterAll: that total reset is what media-video's empty-library assertions measure, phase3-smoke is a second destructive caller, and a faithful restore would rebuild eight tables' rows through their triggers"
  - "06-09: the only midnight-sensitive now-relative fixture (events check-in's live event) takes its window from sameDayWindow with the case's phase bounds (start 10-55 min ahead, at least 30 min long); the other now-relative fixtures assert no local-day copy or already accept both variants, so they were left alone"
  - "06-09 (carried from 06-06, for the next module): a side-effecting or externally redirecting route handler answers 204 no-store to RSC, Next-Router-Prefetch, Sec-Purpose: prefetch and Purpose: prefetch requests. Not written into SCHEMA-CONVENTIONS (it is a web-tier rule, not a schema one)"

patterns-established:
  - "Pattern: a module that keeps values its own tenant's members must not read follows SCHEMA-CONVENTIONS §(l): a separate table behind an inline role-claim policy, definers that return outcomes and filter by app.tenant_id()/app.user_id(), a cross-table XOR through a redundant discriminator with deferrable composite FKs, and a BEFORE trigger raising 23514 with a named constraint"
  - "Pattern: before a gate, rm -rf .turbo/cache apps/web/.next/dev and confirm >= 9 GB free; run it under a disk watchdog; clear apps/web/.next/dev again before any dev e2e that follows pnpm verify"

requirements-completed: [EVENT-01, EVENT-02, EVENT-03, EVENT-04, EVENT-05, EVENT-06]

coverage:
  - id: D1
    description: "Every tenant timestamp in the tenant's zone: the feed and media pins retired, the zone threaded from the bootstrap to every caller, a Manaus tenant reads a post one hour earlier than São Paulo"
    requirement: EVENT-02
    verification:
      - kind: unit
        ref: "apps/web/lib/feed-view.test.ts (7 tests: 2026-10-12T22:00Z is 19:00 in São Paulo and 18:00 in Manaus for cards and comments)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/phase6-smoke.spec.ts#8. the tenant clock reaches the feed: rede-demo switched to America/Manaus reads a post one hour earlier"
        status: pass
      - kind: other
        ref: "grep -rn America/Sao_Paulo apps/web/{lib,components,app} minus tests and lib/platform.ts prints nothing; grep DEFAULT_TENANT_TIME_ZONE apps/web prints nothing; pnpm --filter @rede-social/web typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "SCHEMA-CONVENTIONS §(l) Secrets inside a tenant, with the §(k) checklist line"
    verification:
      - kind: other
        ref: "grep -c '(l)' packages/core/docs/SCHEMA-CONVENTIONS.md >= 1; the section names event_secrets_staff_all, app.events_check_in and set constraints all immediate"
        status: pass
    human_judgment: true
    rationale: "A convention document's usefulness to the next module's author (Phase 7 chat/notifications) is a reading judgment no grep can make"
  - id: D3
    description: "phase6-smoke.spec.ts: ENABLED / DISABLED (404 MODULE_DISABLED, no tab, no card, no error card) / FLIP within the flags window, and the four ROADMAP Phase 6 criteria, one test each"
    requirement: EVENT-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase6-smoke.spec.ts (8/8 on mobile-chromium; case 1 also on desktop-chromium) in the green pnpm verify, 2026-09-27 23:12-23:50 São Paulo"
        status: pass
    human_judgment: false
  - id: D4
    description: "The local exit gate: pnpm verify green on a reset and seeded database, with events-prefetch.spec.ts passing in e2e:pwa"
    verification:
      - kind: other
        ref: "pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify -> exit 0 (lint; turbo 11 + 23 tasks; static routes 51 guarded / 0 offenders; boundaries + negative; guard:lanes; pgTAP 17 files / 510; integration 35 files / 590; spike 3/3; e2e 555 passed / 119 skipped / 0 failed; e2e:pwa 46 passed / 5 skipped, events-prefetch passed on iphone-chromium)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The seed's events anchored to the tenant-local noon, so no seeded event straddles midnight at any seed hour"
    requirement: EVENT-02
    verification:
      - kind: integration
        ref: "pnpm test:integration on a seed taken at 23:10 São Paulo: 35 files / 590 tests"
        status: pass
      - kind: e2e
        ref: "events.spec.ts lista/detalhe timezone cases and phase6-smoke case 1 in the green gate (seeded 23:12 São Paulo)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The gate's e2e hygiene: the check-in fixture kept on one local day at any hour, and the dev-overlay, cross-spec state and cache-race fixes (test-only, every assertion kept)"
    verification:
      - kind: e2e
        ref: "events.spec.ts#events check-in 1-4 at 23:09 (earliest-start branch), inside the gate (23:15-23:25) and at 00:00:30 (requested window): 4/4 each time"
        status: pass
      - kind: other
        ref: "sameDayWindowAt swept every 37 s over two days in America/Sao_Paulo, America/Manaus, Europe/Lisbon and America/New_York (DST switches included): never outside the bounds or the day, all four branches hit"
        status: pass
    human_judgment: false
  - id: D7
    description: "Phase 6 phone UAT (06-VALIDATION §Manual-Only Verifications, items 1-10): the admin form, RSVP, the code check-in and walk-in on a phone, Participantes, cancel, the .ics on iOS and Google on a real account, the online calendar hand-off in the installed PWA, support_tenant and the code, the three 320px backstops on hardware"
    verification: []
    human_judgment: true
    rationale: "Real-device and real-account behaviour; phones cannot reach *.localhost, so every item waits on the deferred cloud phase 01.1 and is carried to /gsd-verify-work"

duration: 5h 43m wall clock (see Performance)
completed: 2026-09-28
status: complete
---

# Phase 6 Plan 9: Phase close Summary

**Every tenant timestamp now renders on the tenant's own clock. SCHEMA-CONVENTIONS §(l) records the four secrets-inside-a-tenant patterns. The phase6-smoke witness covers the flag in both directions and all four ROADMAP criteria, and the local `pnpm verify` gate is green after a seed fix and seven test-only fixes.**

## Performance

- **Duration:** 5h 43m wall clock (2026-09-27T21:19:18Z to 2026-09-28T03:02Z). That includes two developer checkpoints (the B/C decision and the disk/fixtures decision), a session restart, and the ENOSPC stop. Active time in the earlier sessions was not recorded separately. This final continuation took about 58 min, about 38 of them the gate.
- **Started:** 2026-09-27T21:19:18Z
- **Completed:** 2026-09-28T03:02Z
- **Tasks:** 2 of 2
- **Files modified:** 27 (plus this SUMMARY)
- **Commits:** 13 (measured from `93c68f5`)

## Accomplishments

- **Timezone everywhere (Task 1):** the pinned São Paulo formatter in `feed-view.tsx` and `MediaAssetRow`'s default are gone. `postCardView`, `commentView` and `MediaAssetRow` take the zone as a required argument, and every caller passes `bootstrap.tenant.timezone`. `feed-view.test.ts` proves 19:00 in São Paulo is 18:00 in Manaus, and phase6-smoke case 8 shows a real tenant switched to Manaus reading a post one hour earlier.
- **§(l) Secrets inside a tenant:** covers the separate table behind `event_secrets_staff_all`, the outcome-returning definers `app.events_check_in` / `app.events_enter`, the deferrable-FK XOR (`event_secrets_event_fk`, `events_secrets_fk`, tested with `set constraints all immediate`), and the `app.event_attendance_guard()` 23514 trigger. Each pattern has its why and test rule, and the §(k) checklist points at the section.
- **phase6-smoke.spec.ts:** ENABLED on rede-demo; DISABLED on a per-run throwaway (404 `MODULE_DISABLED`, no tab, no card, no error card); FLIP within the flags-cache window with the row untouched; the four criteria (admin create/edit/cancel from the phone, member sees it upcoming/cancelled/past; RSVP count, in-window code check-in, walk-in; confirmed vs present; `.ics` + Google `TEMPLATE`).
- **Exit gate green:** `pnpm verify` exited 0 on a reset and seeded database (details in D4 above), and `events-prefetch.spec.ts` passed on `iphone-chromium` in the production-build run.
- **A real Phase 6 seed bug fixed:** a seed run after 22:00 São Paulo put the seeded upcoming event across midnight. The seed now anchors every event to the tenant-local noon.

## Task Commits

1. **Task 1: every tenant timestamp in the tenant's zone:** `37613ee` (feat)
2. **Task 2: §(l), the witness, the exit gate:**
   - `14671cd` (docs) SCHEMA-CONVENTIONS §(l)
   - `4674d8e` (test) phase6-smoke.spec.ts + events-admin helpers
   - `05507a9` (test) the five dev-overlay taps
   - `bd3b609` (docs) deferred items
   - `9f19c67` (test) B: phase2-smoke polls the manifest
   - `d5f5ee0` (test) C: phase52-smoke reads the surviving pins from the database
   - `d0cc21f` (test) stories.spec seen-state pin
   - `cb84d43` (test) media-video player locator
   - `836995f` (test) platform-branding reopens the Marca tab
   - `eceb0c2` (fix) seed events anchored to the tenant-local noon
   - `6331486` (docs) deferred items
   - `c3c05e1` (test) the check-in fixture on one local day

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md, ROADMAP.md, REQUIREMENTS.md and deferred-items.md.

## Files Created/Modified

- `apps/web/lib/feed-view.tsx`: `absoluteTimeFormatter(timeZone)`, the required zone, and `postCardBase`
- `apps/web/lib/feed-view.test.ts`: the São Paulo / Manaus shift for cards and comments
- `apps/web/lib/registry.tsx`, `app/(app)/post/[postId]/page.tsx`, `app/(app)/comunidades/{actions.ts,[communityId]/page.tsx}`, `app/(app)/inicio/feed-actions.ts`: every caller passes the bootstrap zone
- `apps/web/lib/reels.ts` (+ test): the Reel maps through the zone-free `postCardBase`
- `apps/web/lib/events-view.ts`: the doc comment reworded (it named the pin)
- `apps/web/components/media/MediaAssetRow.tsx`, `app/(app)/configuracoes/midia/{MediaLibrary.tsx,page.tsx}`: the required `timeZone` prop
- `packages/core/docs/SCHEMA-CONVENTIONS.md`: §(l) and the §(k) line
- `apps/web/e2e/phase6-smoke.spec.ts`: the witness
- `apps/web/e2e/events-admin.ts`: `moveEventWindow`, `setTenantTimezone`, `sameDayWindowAt`, `sameDayWindow`
- `apps/web/e2e/events.spec.ts`: the check-in `live` fixture on one local day
- `apps/web/e2e/admin.ts`, `phase52-smoke.spec.ts`: database-read Destaques pins
- `apps/web/e2e/{stories,comunidades,reels,phase2-smoke,media-video,platform-branding}.spec.ts`: the test-only gate fixes
- `scripts/seed.ts`: the noon anchor
- `.planning/phases/06-events/deferred-items.md`: the gate's record

## Decisions Made

See `key-decisions` in the frontmatter. The two with a real alternative:
- **C (phase52-smoke):** read the pins from the database rather than restore the seed in media-video's `afterAll`. The total reset is what media-video's empty-library assertions measure, phase3-smoke is a second destructive caller, and a faithful restore would rebuild eight tables' rows through their triggers. The developer authorized this option.
- **Fixtures:** fix only the one fixture whose case reads local-day copy. The 23:06 run showed it was the only one that failed, and every other now-relative fixture in events.spec and phase6-smoke either asserts no day copy or already accepts both the "today" and "another day" variants.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1: the Reel mapping split out as `postCardBase`**
- **Found during:** Task 1. **Issue:** `lib/reels.ts` maps posts through `postCardView` but never renders the absolute time, so a required zone would have forced a meaningless argument. **Fix:** `postCardBase` (the card without its absolute time) serves the Reel, and `postCardView` adds the time on top. **Commit:** `37613ee`

**2. [Rule 3 - Blocking] Task 1: server actions read the zone through `getBootstrap()`**
- **Found during:** Task 1. **Issue:** the feed, comment and community-post actions had no bootstrap in scope. **Fix:** one request-cached `getBootstrap()` per action, as the plan allowed. **Commit:** `37613ee`

**3. [Rule 1 - Doc] Task 1: `events-view.ts` doc comment reworded**
- It named the retired pin, which the plan's grep would have flagged. **Commit:** `37613ee`

**4. [Plan detail] Task 2: §(l) cites the existing pgTAP files**
- The testing rules point at `supabase/tests/140-events.sql`, `141-event-attendances.sql` and `142-event-checkin.sql` as the reference tests. No new pgTAP file was needed. **Commit:** `14671cd`

**5. [Plan detail] Task 2: the smoke's DISABLED route list drops the admin-only attendance summary**
- The member-shaped session asserts 404 `MODULE_DISABLED` on the routes a member can reach (`/v1/events`, `/v1/events/next`, `/v1/events/{id}`). An admin-only route says nothing about what a member learns. **Commit:** `4674d8e`

**6. [Plan detail] Task 2: the criteria tests use no cover image**
- Cover upload and derivation are proved by events.spec's admin describe. The witness avoids a worker dependency for criterion 1. **Commit:** `4674d8e`

**7. [Rule 3 - Blocking, test-only] Five taps under Next's dev overlay**
- `<nextjs-portal>` intercepted pointer events on the phone: stories "Excluir destaque", the comunidades tab, and three reels Início taps. Each is now a one-tap `dispatchEvent('click')`, assertions unchanged. **Commit:** `05507a9`

**8. [Rule 1, test-only, developer-authorized] B: phase2-smoke raced the manifest's cache**
- **Fix:** poll the manifest `theme_color` with the same 70 s budget. **Commit:** `9f19c67`

**9. [Rule 1, test-only, developer-authorized] C: phase52-smoke failed deterministically in any full run**
- Earlier specs hard-delete the seeded story video. **Fix:** read the member-visible pins with the service's predicate, condition the video pin on the story existing, and add an API == DB check (the choice is under Decisions). **Commit:** `d5f5ee0`

**10. [Rule 1, test-only] stories.spec: a late keepalive seen-write moved the tenant circle's start**
- **Fix:** mark every live tenant story seen before login, then check group 0 / index 0 before the gesture. **Commit:** `d0cc21f`

**11. [Rule 1, test-only] media-video: the player locator matched Next's dev-overlay "Console Error" dialog**
- **Fix:** exclude `[data-nextjs-dialog]`. **Commit:** `cb84d43`

**12. [Rule 1, test-only] platform-branding: a background `router.refresh()` remounted the form and dropped the Remover dialog**
- **Fix:** reopen the Marca tab once the icons are ready. The product-side race stays open as a Phase 2 record. **Commit:** `836995f`

**13. [Rule 1 - Bug] The seed put an event across local midnight when seeded after 22:00**
- A real Phase 6 seed bug that produced nine gate failures. **Fix:** a tenant-local noon anchor computed in Postgres. **Verified:** integration 35 / 590 on the new anchor, plus the green gate. **Commit:** `eceb0c2`

**14. [Rule 1, test-only, developer-authorized] The check-in fixture crossed the tenant's midnight in the evening**
- **Found during:** the post-seed-fix check, and reproduced live at 23:06 (only check-in 1 failed: `Data cut at 320px`, because the product printed a multi-day range).
- **Fix:** `sameDayWindowAt` / `sameDayWindow` in `events-admin.ts`. The check-in `live` fixture asks for 30..150 min within a start of 10..55 min ahead and at least 30 min long. Every assertion is unchanged.
- **Verification:** an exhaustive sweep across four zones including DST switches. The check-in cases passed at 23:09, inside the gate (23:15–23:25) and at 00:00:30.
- **Commit:** `c3c05e1`

---

**Total deviations:** 14 (3 Task 1 adjustments, 3 Task 2 plan-detail choices, 7 test-only gate fixes, 1 seed bug). **Impact on plan:** no scope creep into product code beyond Task 1 and the seed. Every gate fix is test-only and keeps its assertions. One product-side race was found and recorded, not fixed (Phase 2 scope).

## Issues Encountered

- **ENOSPC stop and the disk lesson:** the host disk hit 0 bytes during an earlier events check. Docker Desktop's VM disk grows across repeated `db:reset` and does not shrink on the host. `docker image prune -a -f` reclaimed 713.6 MB inside Docker but left the host at 7.9 GB. The green gate ran from 10.88 GiB free, after clearing `.turbo/cache` and `apps/web/.next/dev`, under a watchdog set to stop it below 2 GiB. It bottomed out at 5.58 GiB, a peak of about 5.3 GB. A stale `apps/web/.next/dev` after `pnpm verify` makes `next dev` answer 404 on admin and platform routes, so clear it before any dev e2e that follows a gate. Recorded, and kept open, in deferred-items.md.
- **Gate history:** runs 1–3 failed (1, 2 and 11 failures). All of those failures are fixed by the commits above, except the two intermittents below. Run 4 is green.
- **Still open (deferred-items.md):**
  - the Phase 2 `BrandingForm` background-remount product race;
  - the two undiagnosed intermittents, `feed-comments:298` on mobile and `media-video:460` on desktop, which both passed in the green gate;
  - the environment disk margin.

## User Setup Required

None: no external service configuration required.

## Next Phase Readiness

- Phase 6 is 9/9 plans complete. It is ready for `/gsd-verify-work` (phone UAT items 1–10, blocked on 01.1: phones cannot reach `*.localhost`) and phase close. The phase checkbox is not ticked here.
- For Phase 7 (notifications, chat): read SCHEMA-CONVENTIONS §(l) before adding any secret, definer or cross-table rule. Reuse the 06-06 route-handler rule: side-effecting or externally redirecting handlers answer `204 no-store` to RSC / `Next-Router-Prefetch` / `Sec-Purpose` / `Purpose` prefetches.
- T-06-58 stays accepted: an invalid IANA zone in `tenants.timezone` would throw in `Intl`. Phase 8's tenant settings editor must validate the zone.

## Self-Check: PASSED

- Files exist: `apps/web/lib/feed-view.test.ts`, `apps/web/e2e/phase6-smoke.spec.ts`, `packages/core/docs/SCHEMA-CONVENTIONS.md` §(l), `apps/web/e2e/events-admin.ts` (`sameDayWindow`)
- Commits found: `37613ee`, `14671cd`, `4674d8e`, `05507a9`, `bd3b609`, `9f19c67`, `d5f5ee0`, `d0cc21f`, `cb84d43`, `836995f`, `eceb0c2`, `6331486`, `c3c05e1` (13 = `git rev-list --count 93c68f5..HEAD`)
- Plan verification: feed-view vitest green inside the gate (7 tests); phase6-smoke green inside the gate; `pnpm verify` exit 0

---
*Phase: 06-events*
*Completed: 2026-09-28*
