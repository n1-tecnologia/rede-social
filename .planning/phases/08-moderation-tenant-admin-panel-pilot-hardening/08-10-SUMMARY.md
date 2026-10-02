---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 10
subsystem: testing
tags: [isolation, tenant-05, inventory, gate, realtime, storage, pgtap, turbo-boundaries, D-344]
status: complete
requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-01..08-07 admin lane (/v1/admin/moderation-log, members, branding, tenant, rules) and the widened comment-removal routes; 08-08 /api/csp-report"
  - phase: 07-notifications-web-push-chat
    provides: "the phase 7 sweep shape (07-11), realtime-helpers.ts live joins, app.realtime_topic_allowed"
  - phase: 03-media-pipeline
    provides: "cases j..p and the T-03-56 positive-control rule"
provides:
  - "apps/api/tests/isolation-inventory.ts: ISOLATION_INVENTORY (all 120 non-ALL routes of app.routes, case id or reasoned exemption), REALTIME_TOPIC_INVENTORY, STORAGE_BUCKET_INVENTORY"
  - "apps/api/tests/unit/isolation-inventory.test.ts: route-table equality both ways, case ids resolved against it() titles, reason length, exemption families, topic kinds parsed from REALTIME_TOPIC_PATTERN, buckets parsed from supabase/migrations with pgTAP 060/070 present, and the web gate's text parse pinned"
  - "isolation.test.ts: 'phase 8 sweep', 'inventory sweep: me and media', 'inventory sweep: feed', 'inventory sweep: stories and communities', 'inventory sweep: events', 'storage sweep'"
  - "realtime.test.ts describe('cross-tenant (live)'): all four topic kinds refused cross-tenant with notifications and chat ON for rede-lab"
  - "apps/web/lib/route-handlers.inventory.ts (ROUTE_HANDLER_INVENTORY, 20 handlers) and its node:fs walk test"
  - "apps/web/turbo.json: the API map is a web test input"
affects: [08-11, 08-12, 08.1]
actuals:
  tokens: 32754   # chars/4 over the added lines of this plan's two code commits (131,014 chars)
  tasks: 2
  commits: 2      # MEASURED: git rev-list --count b69256c..HEAD at SUMMARY time; no concurrent-session commit landed in the range
plan_head_before: b69256cfd8f5260e75db2d473002f998ad5dbc44
tech-stack:
  added: []
  patterns:
    - "The route table is the inventory: app.routes is compared both ways with a checked-in map whose values must resolve to real it() titles, so an unclassified route, a stale entry or a renamed case fails the fast unit suite"
    - "Every cross-tenant crossing is compared byte for byte (requestId stripped) with the same call on an unknown id, so a 404 that differs from 'nothing here' fails as an oracle"
    - "Non-route surfaces are inventoried from their own source of truth: topic kinds from the contract regex, buckets from the migrations"
    - "A cross-package test read goes through node:fs text plus a parity assertion in the owning package, never an import (turbo boundaries), with the file declared as a turbo test input"
key-files:
  created:
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/unit/isolation-inventory.test.ts
    - apps/web/lib/route-handlers.inventory.ts
    - apps/web/lib/route-handlers.inventory.test.ts
  modified:
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/realtime.test.ts
    - apps/web/turbo.json
key-decisions:
  - "The web inventory reads the API map as TEXT, not by import: turbo boundaries (a CI step) refuses an import that leaves @rede-social/web; the API unit test asserts the same regex yields exactly Object.keys(ISOLATION_INVENTORY), and apps/web/turbo.json lists the file as a test input"
  - "GET /v1/feed/comments/{id}/replies is 200-only by contract, so its cross-tenant proof is the byte-identical empty page an unknown id gets while a live lab reply exists, not a 404"
  - "The moderation_log invariant is asserted as: no row anywhere names an actor or target membership of ANOTHER tenant, and every row this sweep wrote is anchored in memberships of its own tenant (departed memberships, hard-deleted by auth-user cascades, cannot be anchored and are not cross-tenant)"
  - "Exemptions stay inside six families (health, openapi, public, hooks, webhooks, platform); GET /v1/public/tenants/by-host maps to case i and the two platform branding upload routes map to the storage sweep instead of being exempted"
requirements-completed: [MODER-01, MODER-02, MODER-03, ADMIN-01, ADMIN-02, ADMIN-03]
coverage:
  - id: D1
    description: "Every API route is classified (case id or reasoned exemption) and an unclassified route, stale entry or dangling case id fails pnpm turbo test"
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/isolation-inventory.test.ts"
        status: pass
      - kind: other
        ref: "mutation check: deleting the PUT /v1/admin/rules entry and renaming a case id turned 2 of 6 cases red; restored"
        status: pass
    human_judgment: false
  - id: D2
    description: "Phase 8 sweep: log, members (read/block/unblock/role), feed and story comment removal, branding/colors/uploads/icon, tenant name, rules; lab ids bare 404 beside the demo control, every route 403 on the lab host, rede-lab tenant row snapshot-identical, moderation_log membership invariant"
    requirement: MODER-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#phase 8 sweep"
        status: pass
    human_judgment: false
  - id: D3
    description: "Inventory sweeps close the pre-Phase-8 routes that had no cross-tenant case (me and media, feed writes/likes/comments, stories and communities curation, events manage routes)"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#inventory sweep"
        status: pass
    human_judgment: false
  - id: D4
    description: "Storage sweep: every route that mints or serves a Storage URL answers the other tenant's id like an unknown one, beside the owner's own call; pgTAP 060/070 still pin the bucket policies"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#storage sweep"
        status: pass
      - kind: other
        ref: "pnpm supabase test db (Files=22, Tests=764, Result: PASS)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Realtime: a rede-demo session is refused on rede-lab's all, user:, support-inbox and conv: topics with both modules ON for rede-lab, beside the demo's own topic and the lab owners' joins; refused channels receive nothing"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/realtime.test.ts#cross-tenant"
        status: pass
    human_judgment: false
  - id: D6
    description: "Web route-handler inventory: all 20 app/**/route.ts handlers classified; each proxied route is in the API inventory; a new handler fails the test"
    verification:
      - kind: unit
        ref: "apps/web/lib/route-handlers.inventory.test.ts"
        status: pass
      - kind: other
        ref: "TURBO_CACHE=local:r pnpm boundaries (no issues found)"
        status: pass
    human_judgment: false
duration: 26min
completed: 2026-10-02
---

# Phase 8 Plan 10: The Isolation Inventory Gate Summary

**The route table is now the isolation inventory: all 120 API routes, every Realtime topic kind, both Storage buckets and all 20 web route handlers are each mapped to a live cross-tenant case or a reasoned exemption, and a route added without its case fails the fast unit suite.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-10-02T18:32:34Z
- **Completed:** 2026-10-02T18:59:19Z
- **Tasks:** 2 (Task 1 a tracer, verified end to end before expansion)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- **API inventory gate.** `apps/api/tests/isolation-inventory.ts` classifies every non-`ALL` route of `app.routes`: 98 map to a case id, 22 are exempt. 16 of the 22 are the super_admin lane and the rest are health, openapi, two public routes, hooks and webhooks. The unit check fails on an unmapped route, a stale entry, a case id with no matching `it()` title, a reason under 10 characters, or an exemption outside those families. A mutation run confirmed it: deleting one entry and renaming one case id turned two checks red.
- **Phase 8 sweep.** The sweep covers the admin routes and both comment-removal routes. For each one, a lab id gets the same bare 404 as an unknown id. That 404 is compared byte for byte, without the `requestId`. Each crossing sits next to its demo positive control. The lab membership row, rede-lab's tenant row (branding, display name, rules text and version) and both lab comments stay unchanged. Every route returns 403 `TENANT_HOST_MISMATCH` on the lab host. Two extra checks run against the whole `moderation_log` table: no row names a membership from another tenant, and each of the 6 demo rows plus the lab row written by the sweep belongs to a membership in its own tenant.
- **Inventory sweeps.** 36 routes that existed before Phase 8 had no cross-tenant case of their own, mostly writes and manage-only reads that f2's GET-only loop never reached. Four new cases cover them: me and media, feed, stories and communities, and events. Each uses the same rule: unknown-id equality, a lab trace that must not change, a demo positive control in the same test, and the lab-host 403.
- **Storage sweep.** It covers media uploads, upload completion, variant, playback and delete, plus the admin and platform branding uploads. In each case a demo session gets the other tenant's id answered exactly like an unknown id. Next to it, the owner makes the same call and it succeeds: the lab completes its own upload and gets its own Location, playback, delete and logo. pgTAP still passes (`Files=22, Tests=764, Result: PASS`).
- **Realtime.** A rede-demo member is refused on rede-lab's `all`, `user:<lab member>` and `conv:<lab conversation>`, and the demo support user is refused on rede-lab's `support-inbox`. The refused channels receive nothing after signals are sent on all four topics. Notifications and chat are turned on for rede-lab during the case and restored afterwards. The lab's own member and support user join the same four topics, so each refusal comes from the tenant check and not from a disabled module. The demo member's own topic joins as the positive control.
- **Web route handlers.** `ROUTE_HANDLER_INVENTORY` maps the 20 handlers. 12 forward to an API route that is itself in the API inventory. 8 are exempt: the CSP report sink, the Realtime token hand-off, four auth redirects, the per-tenant manifest and the service-worker route.

## Task Commits

1. **Task 1 (tracer): the API inventory, its unit check, the phase 8 sweep and the inventory sweeps** - `e99955f` (test)
2. **Task 2: Realtime cross-tenant joins, the storage sweep, topic/bucket inventories and the web route-handler inventory** - `d7a85cf` (test)

**Plan metadata:** recorded in the docs commit that adds this SUMMARY.

## Files Created/Modified

- `apps/api/tests/isolation-inventory.ts`: `ISOLATION_INVENTORY`, `REALTIME_TOPIC_INVENTORY`, `STORAGE_BUCKET_INVENTORY`, plus a header explaining how to add a route and why the map is checked in rather than generated.
- `apps/api/tests/unit/isolation-inventory.test.ts`: the nine machine checks. It needs no database and runs inside `pnpm turbo test`.
- `apps/api/tests/integration/isolation.test.ts`: shared sweep helpers (`send`, `sansRequestId`, `expectBareNotFound`, `expectHostRefused`, `closeJobsSince`, fixture seeders) and the six new cases, each with a route table in the 07-11 comment style.
- `apps/api/tests/integration/realtime.test.ts`: `describe('cross-tenant (live)')`.
- `apps/web/lib/route-handlers.inventory.ts` and `.test.ts`: the web map and its `node:fs` walk.
- `apps/web/turbo.json`: the web `test` task now lists `$TURBO_ROOT$/apps/api/tests/isolation-inventory.ts` as an input, alongside `$TURBO_DEFAULT$`.

## Decisions Made

See `key-decisions` in the frontmatter. Two more points:
- The calendar `.ics` handler is mapped to the route it forwards to (`GET /v1/events/:eventId`) instead of being exempted as a host-scoped asset. It calls `loadEvent` with the caller's own Bearer token, so the API's case b4 is the real proof.
- Each sweep writes its demo-side changes through a throwaway member or a fresh row and removes them in `finally`. It also restores rede-demo's tenant row, deletes the Storage objects it added and closes the pg-boss jobs it queued. This way no later suite runs a fan-out for a row this file has already deleted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The web test cannot import the API map; it reads it as text**
- **Found during:** Task 2
- **Issue:** The plan's first choice was a relative import of `ISOLATION_INVENTORY` into the web test. `pnpm boundaries` (a CI step) rejects it: "import `../../api/tests/isolation-inventory` leaves the package".
- **Fix:** I used the plan's fallback in a lighter form. Instead of a generated JSON export, the web test reads the API map with `node:fs` and parses the keys with a regex. The API unit test checks that the same regex over the same file returns exactly `Object.keys(ISOLATION_INVENTORY)`, so the parse cannot drift. `apps/web/turbo.json` now lists the file as a web `test` input. `turbo --dry=json` shows `../api/tests/isolation-inventory.ts` in the task inputs and the root `env` list kept. This file is not in the plan's `files_modified`.
- **Verification:** `pnpm boundaries` reports no issues found; both unit tests pass.
- **Committed in:** `d7a85cf`

**2. [Rule 1 - Bug in the test design] The replies route has no 404 branch by contract**
- **Found during:** Task 1, first run of the feed sweep
- **Issue:** `GET /v1/feed/comments/{id}/replies` returns `200 { items: [], nextCursor: null }` for any id the lane cannot see. Its OpenAPI contract declares 200 only. Expecting a 404 was wrong, and nothing leaks.
- **Fix:** The case now inserts a live lab reply under the lab comment. It then asserts that the demo lane gets a page byte-identical to the one an unknown id gets, empty and without the reply id. As a positive control, the demo's own reply is listed under its own comment.
- **Committed in:** `e99955f`

**3. [Interpretation] The moderation_log invariant leaves departed memberships out**
- **Issue:** The truth says every row's actor and target belong to memberships of the row's own tenant. The table has no foreign keys, by design, and fixture cleanups delete auth users, which deletes their memberships through the cascade. Older rows can therefore point at memberships that no longer exist.
- **Fix:** Two assertions. Across the whole table, no row may name a membership that exists in another tenant. And every row this sweep wrote must have both memberships present in its own tenant.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test-design bug), plus 1 recorded interpretation.
**Impact on plan:** The scope grew past the plan in four places, each a stronger version of what was planned: the 36 routes added to the inventory sweeps, the topic-kind and bucket inventories, mapping the by-host route and the platform branding uploads to cases instead of exempting them, and mapping `.ics` to the route it forwards to.

## Issues Encountered

- rede-lab's seeded primary colour is `#0f766e`, which was the first colour the sweep wrote to the demo. The snapshot already proved isolation, but I switched the demo write to `#9d174d` so the evidence cannot be misread.
- Older cases b5 (`POST /v1/communities`) and b6 (`POST /v1/stories`) still leave `notifications.fanout` jobs in `created` state on every run. This was already happening before this plan. `realtime.test.ts`'s own sweep closes those jobs. The new cases close everything they queue.
- Machine load was low during this run (load average 2-9). No timeouts, no reruns needed.

## DB Reset Consent

The developer consented on 2026-10-02 to running `pnpm db:reset && pnpm db:seed` on the LOCAL Supabase stack for all Phase 8 plans. A backup is at `~/rede-social-local-backups/pre-08-reset.sql`. This plan reset the local stack four times: a baseline, the Task 1 verify, the Task 1 tracer re-run, and the Task 2 verify. Nothing ran against hosted Supabase, GCP or Vercel.

## Verification Run

- `pnpm --filter @rede-social/api exec vitest run tests/unit/isolation-inventory.test.ts`: 9/9 passed
- `pnpm --filter @rede-social/web exec vitest run lib/route-handlers.inventory`: 4/4 passed
- `pnpm db:reset && pnpm db:seed && pnpm supabase test db`: Files=22, Tests=764, Result: PASS
- `vitest run tests/integration/isolation.test.ts tests/integration/realtime.test.ts`: 50/50 passed (the baseline before this plan was 43)
- `pnpm --filter @rede-social/api test`: 57/57 passed. `pnpm --filter @rede-social/web test`: 1382/1382 passed.
- `tsc --noEmit` passes for api and web, `biome check` is clean for both packages, and `pnpm boundaries` reports no issues.
- No API or web server processes left running.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- The isolation half of the go-live gate (ROADMAP SC 4) is green on a reset and seeded database. 08.1's exit gate re-runs this suite with its shared-identity fixture (D-344).
- 08-11 and 08-12 can run next. 08-12's gate run can cite `isolation-inventory.test.ts`, the six new cases, `realtime.test.ts` `cross-tenant` and the pgTAP result above.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*

## Self-Check: PASSED

- FOUND: apps/api/tests/isolation-inventory.ts, apps/api/tests/unit/isolation-inventory.test.ts, apps/web/lib/route-handlers.inventory.ts, apps/web/lib/route-handlers.inventory.test.ts
- FOUND: commits e99955f, d7a85cf (`git rev-list --count b69256c..HEAD` = 2 before this docs commit)
- Acceptance: `phase 8 sweep` appears in isolation.test.ts (1 match); `/v1/admin` appears 15 times in the inventory; 26 `exempt` lines, none with an empty reason; `cross-tenant` appears 6 times in realtime.test.ts, and that case names `support-inbox` and `conv:`; `csp-report` appears once in the web inventory
- Counts measured from the module itself: 120 entries, 98 cases (phase 8 sweep 14, storage sweep 9, inventory sweeps 36), 22 exempt (16 platform)

