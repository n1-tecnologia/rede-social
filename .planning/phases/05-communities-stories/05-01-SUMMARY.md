---
phase: 05-communities-stories
plan: 01
subsystem: api
tags: [communities, module-package, keyset, rls, nav-tab, hono, drizzle, pgtap, playwright]

requires:
  - phase: 04-feed
    provides: "@tria/module-feed as the reference module scaffold, packages/core/server/paging.ts (the ONE cursor envelope), InfiniteScroll, the query-budget harness and the two-tenant isolation gate"
  - phase: 03-media-profiles
    provides: "media_assets + MediaImage (the stable /v1/media/{assetId}/{variant} path) and the MembersList append-never-replace paging state machine"
  - phase: 01-foundations
    provides: "withTenantTx, tenantIsolationPolicy, requireAuth/requireModule/requirePermission, the module manifest and MODULE_REGISTRY"
provides:
  - "@tria/module-communities — a real workspace package with the five-export map (./module, ./contracts, ./server, ./ui, ./db)"
  - "communities + community_members: RLS, tenant isolation policies, the partial DESC-NULLS-FIRST activity index and the per-tenant slug unique"
  - "GET /v1/communities (keyset on last_activity_at), GET /v1/communities/{id}, POST /v1/communities"
  - "The Comunidades navigation tab, declared by the manifest and driven by the module flag (D-40, D-77)"
  - "/comunidades — the RSC list route, the InfiniteScroll client list and the pt-BR catalog namespace"
  - "CommunityCard — the ported card-magazine list card with the --brand-gradient cover fallback"
  - "community.created (ids only) declaration-merged into the kernel EventMap"
affects: [05-02, 05-03, 05-04, 05-05, 05-06, 05-07, 05-08, 06-events]

actuals:
  tokens: 37306
  tasks: 3
  # MEASURED: git rev-list --count <plan_head_before>..HEAD at close-out — the four task commits
  # (two feat, one test, one fix) plus this metadata commit.
  commits: 5
plan_head_before: cec45ab3a88d7e86617830e20effec33caf66eb0

tech-stack:
  added: []
  patterns:
    - "A second module package proved the feed's scaffold is copyable: five exports, three scripts, one registry line, one app.ts mount"
    - "Trigger-owned denormalised ordering column (last_activity_at) as the keyset key, instead of an unpageable aggregate"
    - "A list endpoint that CLAMPS limit rather than refusing it — the tab-reachable variant of the feed's stricter posture"

key-files:
  created:
    - packages/modules/communities/package.json
    - packages/modules/communities/contracts/index.ts
    - packages/modules/communities/db/schema.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/communities/server/routes.ts
    - packages/modules/communities/module.ts
    - packages/modules/communities/ui/CommunityCard.tsx
    - packages/modules/communities/tests/events.test.ts
    - supabase/migrations/20260923171503_communities.sql
    - apps/web/lib/communities.ts
    - apps/web/app/(app)/comunidades/page.tsx
    - apps/web/app/(app)/comunidades/CommunitiesList.tsx
    - apps/web/app/(app)/comunidades/actions.ts
    - apps/web/messages/pt-BR/communities.json
    - apps/api/tests/integration/communities.test.ts
    - apps/web/e2e/comunidades.spec.ts
  modified:
    - apps/api/src/modules/registry.ts
    - apps/api/src/app.ts
    - apps/api/package.json
    - apps/web/package.json
    - scripts/seed.ts
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/020-tenant-isolation.sql
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - apps/api/tests/integration/modules.test.ts

key-decisions:
  - "packages/core/db/schema/index.ts was NOT modified: the kernel may not import a module (turbo boundaries denies kernel -> module), and drizzle.config.ts already globs packages/modules/*/db/schema.ts. The plan's instruction rested on a false premise — the feed tables are not re-exported there either."
  - "apps/api/src/app.ts gained the /v1/communities mount. The plan's file list omitted it, but routes are mounted eagerly for the chained AppType, so without it the endpoint would not exist."
  - "communityQuerySchema CLAMPS limit (catch + transform) instead of refusing it like feedQuerySchema. This list is reachable from a navigation TAB, so a hand-edited ?limit= must land on a page, not an error screen. T-05-04 holds either way — no client value widens the read."
  - "communitySummarySchema carries coverVariantWidths beside coverAssetId. MediaImage needs the ladder for srcSet, and hydrating it in the SAME statement is what keeps the page at one statement."
  - "010-rls-coverage.sql needed its presence CATALOGUE extended, not its plan(N): the file has four fixed assertions and is catalogue-driven, so plan(4) was already correct."

patterns-established:
  - "Tie-bearing seed fixtures need ONE clock read for the batch — a per-row Date.now() silently destroys a deliberate ordering tie (caught by the RED run)"
  - "A query budget gains a FLOOR and a shape guard (a cover must be present) so the hydration join is really measured, never zero"
  - "An e2e positive control asserts the rendered BRANCH, not a loaded bitmap, when the shared local stack's Storage state depends on which suite ran first"

requirements-completed: [COMM-02, COMM-03]

coverage:
  - id: D1
    description: "A member opens the Comunidades tab and sees every active community of their tenant as a card-magazine card carrying cover, name, description and post count, newest-activity first"
    requirement: COMM-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#the tab is in the shell and reaches the list, which shows the tenant's communities"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#the cards carry COMM-03's four fields, in the server's activity order"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#1. the seed is the fixture: four active communities, in the activity order the index carries"
        status: pass
    human_judgment: false
  - id: D2
    description: "The community list is keyset-paged on the trigger-ready last_activity_at column, and the page boundary neither repeats nor skips a row under a deliberate activity tie"
    requirement: COMM-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#2. ?limit=2 pages the four exactly once each, and nextCursor is non-null exactly when more exist"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#3. the deliberate last_activity_at TIE is broken by id desc, and neither row repeats or is skipped"
        status: pass
    human_judgment: false
  - id: D3
    description: "limit is clamped server-side in both directions and a tampered cursor degrades to page 1 rather than 500"
    requirement: COMM-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#4. limit is CLAMPED server-side in both directions — no client value can widen the page"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#5. a tampered or foreign cursor degrades to page 1 rather than 500 (T-05-05)"
        status: pass
    human_judgment: false
  - id: D4
    description: "COMM-02 is a POLICY value: every member of the tenant receives the identical item-id set regardless of role, because the read never joins community_members — which exists with RLS so V2-CONT-02 is a policy change"
    requirement: COMM-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#6. a member and an admin of the same tenant receive the byte-identical item-id set"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#7. …and a member of the OTHER tenant receives zero of them (positive control included)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both new tables are covered by the two-tenant isolation gate with positive controls, and the cross-tenant/unknown id answer is one bare 404 with no details key"
    requirement: COMM-02
    verification:
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (plan 73 -> 85; twelve new assertions, six per table)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#8. a demo session never reads a lab community by id — and the lab still can"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b2. communities: the other tenant's community id is 404 NOT_FOUND with no details (05-01)"
        status: pass
    human_judgment: false
  - id: D6
    description: "@tria/module-communities is registered under the communities key; turning the module off removes the tab and 404s every route, turning it on restores both with no migration and no route edit"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#10. with communities OFF: every route 404s and the bootstrap carries neither the tab nor the permission"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#11. …and turning it back ON restores both, with no migration and no route edit"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/modules.test.ts#1. tria-demo lists the six seeded keys; tria-lab only feed + events"
        status: pass
    human_judgment: false
  - id: D7
    description: "POST /v1/communities is guarded by a permission, not a role: a member gets 403, an admin 201, and two creates with the same name both succeed with distinct slugs — never a 409"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#12. a member is refused 403; an admin creates 201 and the row heads the next list read"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#13. two creates with the SAME name both succeed, with distinct ids and distinct slugs — never 409"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#14. an empty name is refused with the closed machine code, and the caps are UTF-16 code units"
        status: pass
    human_judgment: false
  - id: D8
    description: "A cover-less community renders the --brand-gradient block carrying its name, never bg-tertiary and never a broken-image glyph (D-69, UI-D-35)"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#a cover-less community renders the brand gradient, not a broken image"
        status: pass
    human_judgment: false
  - id: D9
    description: "One page of /comunidades costs a bounded and NON-ZERO number of statements — the budget carries a ceiling and a floor"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#costs at most 1 statement against the community tables"
        status: pass
    human_judgment: false
  - id: D10
    description: "community.created is emitted exactly once, after commit, never on rollback, and carries ids only"
    verification:
      - kind: unit
        ref: "packages/modules/communities/tests/events.test.ts#1. a committed create queues ONE event and the subscriber receives it once after flush"
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/events.test.ts#2. a create whose transaction throws queues NOTHING and delivers nothing (rollback)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#16. one successful create delivers one event; a refused create delivers none"
        status: pass
    human_judgment: false
  - id: D11
    description: "The card drops the prototype's activity badge, member count and last-activity timestamp (D-75, UI-D-42), and the container acquires no human owner byline (D-67)"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#the D-75 drops are absent: no activity badge, no member count, no timestamp"
        status: pass
      - kind: other
        ref: "grep -c 'Novas interações|activityBadge|memberCount' packages/modules/communities/ui/CommunityCard.tsx => 0"
        status: pass
    human_judgment: false
  - id: D12
    description: "The list's loading, error, load-more-error and empty states (three card skeletons, one sentinel skeleton, inline danger + retry at the sentinel, member/admin empty variants with the D-77 always-visible tab)"
    verification: []
    human_judgment: true
    rationale: "The four states are implemented and typechecked, but only the populated path has an automated observation. The empty state needs a tenant with zero communities and the two error states need an induced failure — both land with 05-04's community page and form work, which owns the same states. A human should exercise them at end-of-phase verification."

duration: 28min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 01: Communities Tracer Summary

**`@tria/module-communities` shipped end to end — a workspace package with two RLS-isolated tables, a keyset list paged on a trigger-ready `last_activity_at`, a permission-guarded create, the `Comunidades` navigation tab the registry drives, and the `/comunidades` route a real browser reaches on a phone viewport.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-09-23T17:04:40Z
- **Completed:** 2026-09-23T17:32:45Z
- **Tasks:** 3 of 3
- **Files modified:** 34

## Accomplishments

- **The module-package shape is proved, not asserted.** Adding a second module cost exactly what MOD-03 promised: a copied scaffold, ONE line in `MODULE_REGISTRY`, one `.route()` in `app.ts`, and nothing else. Every remaining Phase 5 plan now has a shape to copy rather than a shape to design.
- **`communities` + `community_members` exist with RLS, a policy each, the partial `DESC NULLS FIRST` activity index and the per-tenant slug unique.** The generated migration is exactly what `drizzle-kit generate` reproduces (`pnpm db:generate` is a no-op against it) and is purely additive.
- **The two-tenant isolation gate grew from 73 to 85 pgTAP assertions** — six per new table, each with its positive control in the same block, and both tenants seeded with the SAME slug and description so a read that filtered on a value could not pass by looking plausible.
- **COMM-02 is expressed as an absence.** `listCommunities` never joins `community_members`; the integration suite asserts a member and an admin of one tenant receive the byte-identical ordered id list, and that the table really is empty while the list is unaffected.
- **The keyset is total under a deliberate tie.** The seed writes two communities sharing a `last_activity_at`; walking `?limit=2` returns each exactly once, ordered by `id desc`.
- **The tab is the manifest's.** Turning `communities` off 404s all three routes and strips both the nav entry and the permission from `/v1/me/bootstrap`; turning it on restores both — asserted in both directions, with no migration and no route edit.
- **A real browser on an iPhone 14 viewport taps `Comunidades`, sees four cards in the server's activity order, and sees the cover-less community painted with the tenant's `--brand-gradient`** — asserted by computed background rather than by screenshot.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 (tracer) | Module package, schema, service, routes, manifest, registry, card, web tier, catalog | `7e3b2c4` | `packages/modules/communities/**`, `apps/api/src/{app,modules/registry}.ts`, `apps/web/{lib/communities.ts,app/(app)/comunidades/**,messages/pt-BR/communities.json}` |
| 2 | Migration + the isolation gate on both tables + seed fixtures | `33f5fc9` | `supabase/migrations/20260923171503_communities.sql`, `supabase/tests/{010,020}*.sql`, `scripts/seed.ts` |
| 3 (RED) | The failing tests that prove the slice | `77eeef8` | `apps/api/tests/integration/{communities,isolation,feed-query-budget}.test.ts`, `packages/modules/communities/tests/events.test.ts`, `apps/web/e2e/comunidades.spec.ts` |
| 3 (GREEN) | The two defects RED exposed | `33bc9e7` | `scripts/seed.ts`, `apps/api/tests/integration/modules.test.ts`, `apps/web/e2e/comunidades.spec.ts` |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `77eeef8` `test(05-01)` | Pass — `gsd-tools check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| GREEN | `33bc9e7` `fix(05-01)` | Pass — 6/6 module, 391/391 integration, 20/20 isolation, 10/10 e2e |
| REFACTOR | — | Not performed; no cleanup was warranted, and the reference commits REFACTOR only on change |

**RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/integration/communities.test.ts --reporter=tap-flat` (cwd `apps/api`)
- **Exit code:** 1 — 16 tests, 15 pass, 1 fail
- **Target test:** `GET /v1/communities — keyset paging on last_activity_at (COMM-03, D-76) > 3. the deliberate last_activity_at TIE is broken by id desc, and neither row repeats or is skipped`
- **Expected:** two seeded communities share an identical `last_activity_at`, so the tied group is defined and has length 2
- **Actual:** `AssertionError: the seed writes two communities with an identical last_activity_at: expected undefined to be defined`

**Note on the TAP normalizer (a standing environment fact, not a plan artifact).** `check tdd-red-evidence` parses a `node --test` TAP summary; Vitest never emits `# tests` / `# pass` / `# fail`. The record was built from the REAL captured run: Vitest's own `tap-flat` reporter supplied the `ok` / `not ok` lines verbatim, and a throwaway script DERIVED the three summary lines by counting those lines. No count was typed by hand and nothing was fabricated.

**Note on the GREEN commit type.** The Task-3 cycle's GREEN commit is `fix(05-01)` rather than `feat(05-01)`: it repaired two real defects (a seed fixture that had no tie, and a stale ordering assertion) rather than adding behaviour. A `feat(05-01)` commit exists for the plan from Tasks 1 and 2, so the `git log` gate check finds both patterns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] `packages/core/db/schema/index.ts` was NOT modified**

- **Found during:** Task 1, step 3
- **Issue:** The plan says to re-export `communities`/`community_members` from `packages/core/db/schema/index.ts` "the way the feed tables are". The feed tables are **not** re-exported there, and doing it would make the KERNEL import a MODULE — which `turbo boundaries` denies (`kernel: dependencies.deny: ["module"]`) and which `pnpm boundaries` would have failed on.
- **Fix:** Skipped the re-export. It is also unnecessary: `apps/api/drizzle.config.ts` already globs `packages/modules/*/db/schema.ts`, and `010-rls-coverage.sql` reads the pg catalogue rather than a TS barrel.
- **Files modified:** none (the file was left untouched)
- **Verification:** `pnpm boundaries` green (491 files, 8 packages); `pnpm db:generate` produced the migration from the module's own schema file.
- **Commit:** `7e3b2c4`

**2. [Rule 3 - Blocker] `apps/api/src/app.ts` gained the `/v1/communities` mount**

- **Found during:** Task 1, step 7
- **Issue:** The plan's `<files>` list omits `app.ts`, but routes are mounted EAGERLY there for the chained `AppType` (the manifest's `routes` is a lazy import the worker reads). Without the mount the three endpoints would not exist and Task 3's entire behaviour list would be unreachable.
- **Fix:** Added the import and `.route('/v1/communities', communitiesRoutes)` with a docblock mirroring the feed's.
- **Files modified:** `apps/api/src/app.ts`
- **Verification:** `pnpm test:integration -- communities` — 16/16 cases against live routes.
- **Commit:** `7e3b2c4`

**3. [Rule 1 - Bug] The seeded "deliberate tie" was not a tie**

- **Found during:** Task 3 RED (this is the defect the RED gate caught)
- **Issue:** `scripts/seed.ts` computed `new Date(Date.now() - minutesAgo * 60_000)` once per community INSIDE the loop, so the two rows that share a `minutesAgo` landed milliseconds apart. The keyset tie-break — the single most load-bearing property of D-76's ordering — had nothing to prove.
- **Fix:** One clock read (`communityClock`) for the whole batch, with both the `last_activity_at` and the `created_at` derived from it.
- **Files modified:** `scripts/seed.ts`
- **Verification:** `select last_activity_at, count(*) … having count(*) > 1` returns one tied pair per tenant; the target test now passes.
- **Commit:** `33bc9e7`

**4. [Rule 1 - Bug] `modules.test.ts` pinned a bootstrap order that this plan legitimately changed**

- **Found during:** Task 3 RED
- **Issue:** The assertion pinned the enabled-module list as purely alphabetical — true only while NO enabled key carried a `nav` entry. `communities` now declares `nav.order: 20`, so it sorts ahead of the manifest-less keys (`MODULE_KEY_ORDER_FALLBACK = 1000`). The ordering RULE is unchanged; the assertion was encoding its old input.
- **Fix:** Updated the expected order and ADDED an assertion on the nav entry itself (`placement: 'tab'`, `href: '/comunidades'`, `order: 20`), so the tab's payload is now pinned rather than merely not-contradicted.
- **Files modified:** `apps/api/tests/integration/modules.test.ts`
- **Verification:** `pnpm test:integration` — 391/391.
- **Commit:** `33bc9e7`

**5. [Rule 1 - Bug] The e2e cover positive control asserted a loaded bitmap**

- **Found during:** Task 3 GREEN (the e2e run)
- **Issue:** The control asserted a visible `<img>` inside the covered card. It failed — not because the card is wrong, but because the shared local stack's `media` bucket was empty: `pnpm db:seed` uploads 38 objects, and the integration suite's `media-sweeper.test.ts` removes them before the e2e runs. `MediaImage`'s documented contract is that a missing object degrades to the neutral `bg-bg-tertiary` box, so the assertion was measuring suite order rather than the card.
- **Fix:** The control now asserts the rendered BRANCH (`data-testid="community-cover-image"` present, gradient fallback absent) plus the symmetric negative on the cover-less card.
- **Files modified:** `apps/web/e2e/comunidades.spec.ts`
- **Verification:** `pnpm --filter @tria/web exec playwright test comunidades.spec.ts` — 10 passed.
- **Commit:** `33bc9e7`

**6. [Rule 3 - Blocker] `010-rls-coverage.sql` needed its catalogue extended, not its `plan(N)`**

- **Found during:** Task 2
- **Issue:** The plan says the file "needs only its `plan(N)` adjusted for the two new tables". It has four FIXED assertions and is catalogue-driven, so `plan(4)` was already correct; what needed extending was assertion 4's presence list.
- **Fix:** Added `('communities'), ('community_members')` to the presence catalogue with the rationale for why the born-unused table is listed, and retitled the assertion `Phases 1-5`.
- **Files modified:** `supabase/tests/010-rls-coverage.sql`
- **Verification:** `pnpm supabase test db` — 207 tests, all successful.
- **Commit:** `33f5fc9`

### Additions beyond the plan's literal wording

- **`communitySummarySchema.coverVariantWidths`.** The plan's field list stops at `coverAssetId`, but `MediaImage` needs the variant ladder for its `srcSet` and the plan's own query-budget truth requires the cover to be hydrated in the SAME statement. The field is the hydration, projected.
- **`refreshCommunitiesAction`.** `PullToRefresh` needs a page-1 re-read; routing it through the same `getCommunities` keeps the "ONE fetch implementation per resource" rule intact.
- **`slugify` is exported** from `server/index.ts` so its encoding rules are unit-testable without a stack.

**Total deviations:** 6 auto-fixed (3× Rule 1 bugs, 3× Rule 3 blockers) plus 3 documented additions. **Impact:** none negative — two of the Rule 1 fixes repaired fixtures/assertions that would otherwise have certified guarantees that had stopped being measured, which is the RED gate working as designed.

## Authentication Gates

None. Everything ran against the local Supabase stack, which was already healthy (the Task 2 precondition was verified read-only before the task began).

## Known Stubs

None. The only deliberately deferred work is UI that later plans own by design and that this plan never claims: the community page (`/comunidades/[communityId]`), the create/edit form (`/comunidades/nova`, `…/editar`) and the archive control. `CommunitiesList`'s admin empty state links to `/comunidades/nova`, a route 05-04 creates — the link is inert only for an admin on a tenant with zero communities, and both seed tenants have four.

`post_count` and `last_activity_at` sit at their column defaults until 05-03 installs the trigger. That is not a stub: the schema docblock declares both trigger-owned, no application statement writes them, and `0` / creation-time is the correct answer for a community with no posts.

## Threat Flags

None. Every file this plan touched sits inside the threat model the plan already registered: the three new routes are the `<threat_model>`'s own T-05-01..T-05-06 surface, and no new network egress, auth path, file access pattern or trust-boundary schema change was introduced. Per T-05-SC, **zero external packages were installed** — `pnpm install` only linked the new workspace package.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @tria/module-communities typecheck` | pass |
| `pnpm --filter @tria/module-communities lint` | pass (13 files) |
| `pnpm --filter @tria/module-communities test` | pass — 6/6 |
| `pnpm --filter @tria/api typecheck && lint` | pass (60 files) |
| `pnpm --filter @tria/web typecheck && lint` | pass (237 files) |
| `pnpm db:generate` against the committed migration | no-op ("No schema changes"), `git status --porcelain -- supabase/migrations` empty |
| `pnpm db:reset && pnpm db:seed` | pass — 4 communities per tenant, 1 cover-less each, 1 activity tie each |
| `pnpm supabase test db` | pass — 11 files, 207 tests, `Result: PASS` |
| `pnpm test:integration` | pass — 28 files, 391/391 |
| `pnpm test:integration -- isolation` | pass — 20/20 |
| `pnpm --filter @tria/web exec playwright test comunidades.spec.ts` | pass — 10/10 (mobile + desktop) |
| `pnpm boundaries` | pass — 491 files, 8 packages, no issues |
| `bash scripts/check-ui-literals.sh` | pass |

## Issues Encountered

None outstanding. One standing ENVIRONMENT fact worth carrying forward (it is not a defect in this plan and needs no fix here): the local `media` bucket is emptied by `media-sweeper.test.ts`, so any e2e that depends on seeded image BYTES must either re-seed first or assert a structural branch instead. This plan's spec does the latter.

## Next Phase Readiness

Ready for **05-02** (same wave, shares no file with this plan) and for the wave-2 plans that build on the module:

- `@tria/module-communities` is the shape 05-05 (stories) copies: five exports, three scripts, one registry line, one mount.
- `communities.post_count` / `last_activity_at` are declared trigger-owned and await 05-03's function on `feed_posts`.
- `listCommunities`' `communityProjection` is the statement 05-04's community page extends; the query budget already carries a ceiling and a floor for it.
- `feed_posts.community_id` still carries no foreign key — `communities` exists now, so the plan that adds the reference can.
- **D-33 design gate still armed:** sketch 003 needs `approved: true` before waves 3-7 run. This plan is wave 1 and is unaffected.

## Self-Check: PASSED

All 12 `key-files` entries exist on disk (`[ -f ]`), and all four task commits are reachable in `git log --all`: `7e3b2c4`, `33f5fc9`, `77eeef8`, `33bc9e7`.
