---
phase: 05-communities-stories
plan: 04
subsystem: api
tags: [communities, community-page, form, archive, counters, triggers, D-67, D-69, D-70, D-77, UI-D-35, UI-D-37, UI-D-38, UI-D-43, UI-D-44]

requires:
  - phase: 05-communities-stories
    provides: "05-01's @tria/module-communities (the table, the contracts, the list route, CommunityCard and the Comunidades tab); 05-02's approved sketch 003 and the UI-D-46 vocabulary amendment; 05-03's listCommunityFeed, FeedList.suppressCommunity and the 400 { community: 'archived' } write branch"
  - phase: 04-feed
    provides: "PostCard/FeedList/ComposeFab, the ONE cursor envelope, the /criar composer chrome and its discard flow, feed_posts with community_id and its foreign key"
  - phase: 03-media-profiles
    provides: "MediaImage, useSignedUpload with purpose: 'cover', FileDropZone and the whole upload state machine"
provides:
  - "CommunityCover — one component, two geometries (aspect-[16/7] / h-36) and two branches (MediaImage + veil, or the --brand-gradient fallback), with the UI-D-35 card/page asymmetry enforced inside it"
  - "CommunityHeader — UI-D-43's header minus D-67's owner block, with optional action / statusPill / note slots"
  - "/comunidades/[communityId] — the RSC community page: header, the Destaques slot 05-08 fills, the hairline, the identical PostCard list with the D-71 label suppressed, and the ComposeFab entry"
  - "/comunidades/nova and /comunidades/[communityId]/editar over ONE CommunityForm (UI-D-38)"
  - "PATCH /v1/communities/{communityId} — edit, archive and reactivate as one status write"
  - "updateCommunitySchema, updateCommunity(), community.updated and community.archived"
  - "app.community_post_stats() on feed_posts — the ONE writer of communities.post_count and communities.last_activity_at, plus the one-shot backfill"
  - "supabase/tests/110-communities-stories.sql — the Phase 5 acceptance file (18 assertions)"
  - "The archive semantics, settled: a WRITE gate and a LIST gate, never a feed gate"
affects: [05-05, 05-06, 05-07, 05-08, 06-events]

actuals:
  # chars/4 over the realized diff c15bc7a..HEAD (158,377 chars) at SUMMARY write — the same scale
  # the estimate used, reported whole rather than flattered down.
  tokens: 39594
  tasks: 3
  # MEASURED: git rev-list --count c15bc7a..HEAD was 6 at SUMMARY write (the six task commits);
  # 7 once this metadata commit lands, which is what a later `git rev-list` will read.
  commits: 7
plan_head_before: c15bc7a49295c6509d62952eb787163a50560de6

tech-stack:
  added: []
  patterns:
    - "A trigger that RAISES a denormalised maximum on the way up (no scan) and RE-DERIVES it on the way down, with the invariant stated once in the migration header and asserted once in pgTAP"
    - "One presentational component with a `geometry` prop carrying an asymmetry that two call sites would otherwise have to remember"
    - "A form component whose preview renders the REAL production component rather than a copy of its classes, which is what makes 'exactly what members will see' true instead of approximately true"
    - "A RED commit that ships signature-only component skeletons so the assertions — not the module loader — are what fail (the difference between RED_EVIDENCE_OK and fixture_or_load_failure)"

key-files:
  created:
    - packages/modules/communities/ui/CommunityCover.tsx
    - packages/modules/communities/ui/CommunityHeader.tsx
    - packages/modules/communities/tests/community-page-ui.test.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/not-found.tsx
    - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.tsx
    - apps/web/app/(app)/comunidades/[communityId]/editar/page.tsx
    - apps/web/app/(app)/comunidades/nova/page.tsx
    - apps/web/app/(app)/comunidades/CommunityForm.tsx
    - supabase/migrations/20260923204828_communities_counters.sql
    - supabase/tests/110-communities-stories.sql
  modified:
    - packages/modules/communities/contracts/index.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/communities/server/routes.ts
    - packages/modules/communities/server/index.ts
    - packages/modules/communities/module.ts
    - packages/modules/communities/ui/CommunityCard.tsx
    - packages/modules/communities/ui/index.ts
    - apps/web/lib/communities.ts
    - apps/web/lib/feed.ts
    - apps/web/app/(app)/comunidades/actions.ts
    - apps/web/app/(app)/comunidades/CommunitiesList.tsx
    - apps/web/messages/pt-BR/communities.json
    - apps/web/e2e/comunidades.spec.ts
    - apps/api/tests/integration/communities.test.ts
    - apps/api/tests/integration/feed.test.ts
    - scripts/seed.ts
    - scripts/check-static-routes.sh

key-decisions:
  - "Archive is settled as a WRITE gate and a LIST gate, never a feed gate. The list gains one predicate it already had, the feed query is untouched, and the three consequences (absent from the list, still readable by id, refuses new posts) are asserted as three predicates in pgTAP with their positive controls."
  - "`last_activity_at` is RAISED on an insert (`greatest(last_activity_at, new.created_at)` — no scan, and a backdated post cannot pull a community's activity backwards) and RE-DERIVED on a decrement, because the maximum may have moved. The invariant is `greatest(created_at, coalesce(max(live post.created_at), created_at))` and 110 asserts exactly it."
  - "The trigger watches `community_id` as well as `deleted_at`, even though D-72 forbids moving a published post: a counter that is only correct while the API is disciplined breaks the first time a migration or a psql session writes the column."
  - "`communities.region` became the UI-SPEC's own string (\"Publicações de {community}\") and the list's landmark moved to `communities.list.region`. 05-01 had taken the spec's key for a different surface."
  - "CommunityPosts delegates to the shipped FeedSurface/FeedList rather than rebuilding a list: the sentinel, the append-never-replace paging, PullToRefresh, the comment sheet, the menu and the four list states all arrive already tested, and `suppressCommunity` is fixed inside it because there is no correct `false` on that surface."
  - "The cover preview renders on BOTH breakpoints. The approved drawing puts it inside the desktop drop zone; the shipped `FileDropZone` takes no children, so it sits directly above it — same two things, same order, and the primitive stays the one every other upload surface uses."
  - "The RED commits ship signature-only skeletons for genuinely new components. With no module at all the loader fails and `check tdd-red-evidence` returns `fixture_or_load_failure`, which is not RED; with a skeleton the named target test fails on its own assertion."

patterns-established:
  - "A seed fixture added for a NEW state must be checked against every existing fixture SELECTION: 'the last community' silently became the archived one and its restore would have un-archived the seed under three other assertions"
  - "An API capability is not shipped until something navigates to it — the edit route and the reactivate path both existed and were unreachable from a browser until a follow-up pass"
  - "A unit test that asserts a loaded bitmap under happy-dom is measuring the environment; assert the rendered BRANCH instead (05-01's e2e lesson, restated at unit scale)"

requirements-completed: [COMM-01, COMM-03]

coverage:
  - id: D1
    description: "COMM-01: an admin creates, edits, archives and reactivates a community from a phone, through full-screen /comunidades/nova and /comunidades/[communityId]/editar routes that reuse the composer's chrome"
    requirement: COMM-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#an admin creates a cover-less community, lands on its page, and archives it"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#archive → reactivate → archive is a round trip the list follows each way"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#19. an admin edits name and description; a member is refused 403 (T-05-18)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#23. reactivating is one PATCH back to active, and the row returns to the list"
        status: pass
    human_judgment: false
  - id: D2
    description: "COMM-03: a member opens a community and sees its posts, rendered by the IDENTICAL PostCard with the D-71 label suppressed, paged on the shipped InfiniteScroll sentinel over the same keyset envelope"
    requirement: COMM-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#list → card → page → a post, with the D-71 label suppressed inside the community"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-header.test.tsx#4. suppressCommunity renders the time alone even when a community IS supplied"
        status: pass
    human_judgment: false
  - id: D3
    description: "A community page header is cover + name + description with NO human owner credit — no overlapping avatar, no credit line, no verified badge (D-67, UI-D-43)"
    verification:
      - kind: unit
        ref: "packages/modules/communities/tests/community-page-ui.test.tsx#5. renders the cover, the back control, the name and the description — and nothing else"
        status: pass
      - kind: other
        ref: "acceptance grep: VerifiedBadge / credit-line literals outside comments in CommunityHeader.tsx => 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "A cover-less community renders the tenant's --brand-gradient, never a neutral grey block: the card's fallback carries name and description in var(--brand-on-primary) with no black scrim, and the page's carries no text at all (D-69, UI-D-35)"
    verification:
      - kind: unit
        ref: "packages/modules/communities/tests/community-page-ui.test.tsx#2. a NULL cover takes the gradient branch and, on the card, carries the host fallback overlay"
        status: pass
      - kind: unit
        ref: "packages/modules/communities/tests/community-page-ui.test.tsx#3. the PAGE geometry is h-36 and its gradient fallback carries NO text at all"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#a cover-less community renders the brand gradient, not a broken image"
        status: pass
    human_judgment: false
  - id: D5
    description: "Archive is a WRITE gate and a LIST gate, never a feed gate: an archived community keeps its posts in the merged feed, disappears from /comunidades, still opens by direct link read-only with the neutral pill and its note, refuses new posts, and is reversible with one PATCH"
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#archive is not a FEED gate / IS a list gate / is NOT a read gate (three predicates, each with its control)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#21. archiving removes it from the LIST, keeps it readable by id, and refuses new posts"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#an ARCHIVED community is absent from the list, and its page still opens read-only"
        status: pass
    human_judgment: false
  - id: D6
    description: "post_count and last_activity_at are written ONLY by a trigger on feed_posts — after insert, after update of deleted_at branching on the TRANSITION, and after delete — with search_path='', no elevated privilege and no greatest(0,…) clamp"
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#1-9 (insert, backdated insert, soft delete, restore, hard delete, move)"
        status: pass
      - kind: other
        ref: "acceptance grep: `security definer` => 0 and `greatest(0` => 0 outside comments in the migration"
        status: pass
    human_judgment: false
  - id: D7
    description: "A soft-deleted post moves the count: post_count after a soft delete equals count(*) of that community's live posts, asserted by reconciliation over EVERY community so drift surfaces rather than hides (Pitfall 10)"
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#reconciliation: every community's post_count equals the live posts it summarises"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#reconciliation: last_activity_at is greatest(created_at, newest live post) for every community"
        status: pass
    human_judgment: false
  - id: D8
    description: "The admin's compose entry is the shipped ComposeFab with href=\"/criar?comunidade={id}\", visible only on feed.post.create AND an active community; desktop renders a header-row brand button instead (D-70, UI-D-44)"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#the admin’s compose entry pre-fills the destination; a member has none"
        status: pass
    human_judgment: false
  - id: D9
    description: "Unknown, other-tenant and soft-deleted community ids all render the IDENTICAL \"Comunidade não encontrada\" screen — no existence oracle (D-23 / UI-D-16, T-05-20)"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/communities.test.ts#20. an unknown or other-tenant id is a BARE 404 with no details key (T-05-20)"
        status: pass
      - kind: other
        ref: "not-found.tsx takes no props and reads no param; loadCommunity collapses 404 and 400 to one `not-found`"
        status: pass
    human_judgment: false
  - id: D10
    description: "D-76's keyset ordering is served by communities_tenant_activity_idx, pinned BY NAME on a 400-row volume fixture with the no-sequential-scan half in the same captured plan"
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#D-76: the community list keyset is served by communities_tenant_activity_idx, BY NAME"
        status: pass
    human_judgment: false
  - id: D11
    description: "The form's UI states — E13 empty (placeholders, gradient preview, submit gated on Nome, no error before first submit), loading (aria-busy pending labels, the Phase 3 upload machine), error (field error, role=alert card, archiving failure toasts) and partial (the edit form IS the create form bound to values)"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#an admin creates a cover-less community… (the disabled submit, the gradient preview and the create title)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#an archived community offers Reativar where an active one offers Arquivar"
        status: pass
    human_judgment: true
    rationale: "The empty, populated and structural-difference states are exercised, and the error states are typechecked and exhaustive (`messageFor` cannot compile without copy for a new code). But no automated case induces a cover-upload failure, an at-cap counter turning text-danger, or a server refusal on the form, and none observes the pending `aria-busy` label mid-flight. A human should fill the form with a 280-character description, refuse an upload (an oversized non-image), and submit with a name of exactly COMMUNITY_MAX_NAME."
  - id: D12
    description: "UI overflow/long-text E11: a 60-character community name at 24/700 on a 320px viewport wraps to at most three lines without clipping the cover above it"
    verification: []
    human_judgment: true
    rationale: "Backstop row, explicitly flagged `verification: backstop` in the plan. The wrapping RULE is asserted at unit scale (the name node carries neither `truncate` nor `line-clamp`) and the seed ships a 60-character community, but how many lines it actually occupies at 320px is a rendered-pixel judgement no assertion here makes. A human should open `/comunidades/{the 60-character community}` at a 320px viewport."

duration: 51min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 04: The Community Page and COMM-01's Write Half Summary

**A community became a place: the screen a member lands on when they tap a card, the one form an admin creates, edits, archives and reactivates it with, and the two denormalised columns the list's ordering and the card's count have been promising since 05-01 — now written by a trigger and reconciled by a test that can see drift.**

## Performance

- **Duration:** 51 min
- **Started:** 2026-09-23T20:30:14Z
- **Completed:** 2026-09-23T21:21:23Z
- **Tasks:** 3 of 3
- **Files modified:** 28

## Accomplishments

- **`/comunidades/[communityId]` exists, and it is the feed's own column.** `CommunityPosts` delegates to the shipped `FeedSurface` → `FeedList` → `PostCard`, so the community page inherits the `InfiniteScroll` sentinel, append-never-replace paging, `PullToRefresh`, the comment sheet, the overflow menu and the four list states already tested on `/inicio` — over the identical keyset envelope, because `GET /v1/feed?communityId=` is the same projection with one predicate (05-03). The only thing the page adds is `suppressCommunity`, fixed inside the component because there is no correct `false` on that surface.
- **`CommunityCover` carries UI-D-35's asymmetry so two call sites do not have to remember it.** One component, two geometries and two branches: on the CARD the name is always overlaid, so the cover-less fallback must carry it; on the PAGE the name always renders below, so the fallback carries no text at all. The rule lives in the component (`geometry === 'card' && fallbackOverlay`), which is what stops the page's fallback ever doubling the name.
- **D-67's three drops are structural, not an omission.** `CommunityHeader` has no avatar, no credit line and no badge, and the acceptance grep proves the two names are absent from its rendered output. The name takes the Title role with the full width and WRAPS — `truncate` there would hide the one string the screen exists to name.
- **Archive's meaning is settled and proved inside Postgres.** A WRITE gate and a LIST gate, never a feed gate. `110-communities-stories.sql` asserts the three predicates verbatim from the three statements that use them — the merged feed still returns the archived container's posts, the list does not return the container, and the by-id read does — each with its positive control in the same block. The feed query was not touched at all, which is the point: the measured alternative (an id IN-list) plans as a sequential scan plus a sort, and the denormalised one costs a table-wide UPDATE plus a fourth index plus a new class of drift.
- **`post_count` and `last_activity_at` are database facts now.** `app.community_post_stats()` is the only writer: `after insert or delete or update of deleted_at, community_id`, `set search_path = ''`, fully-qualified names, deliberately NOT elevated, and with no `greatest(0, …)` clamp. `last_activity_at` is raised on the way up in one statement with no scan and re-derived on the way down because the maximum may have moved — the invariant is stated once in the migration header and asserted once in pgTAP, over every community in the database rather than only this file's fixture. A one-shot backfill reconciled the rows 05-01 left at their `0` default.
- **The counter survives a mixed sequence, including one the API forbids.** Inserts, a backdated insert, a soft delete, a restore, a hard delete and a move between containers — all six exercised, and the move handled even though `updatePostSchema` is `.strict()` and has no `communityId` key, because a counter that is only correct while the API is disciplined is not a counter.
- **One form, two routes, and the edit form really is the create form bound to values.** The cover picker previews the REAL `CommunityCover` gradient block rather than a copy of its classes, so "the admin sees exactly what members will see" is true rather than approximately true, and D-69 becomes a choice instead of a consolation. Zero upload code was written: `useSignedUpload` with `purpose: 'cover'` is the whole byte path.
- **The seed ships an ARCHIVED community per tenant.** UI-D-37's read-only state now has a fixture no spec has to create by archiving something first — which is what keeps `comunidades.spec.ts` re-runnable in any order and leaves the shared seed exactly as it found it.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 (RED) | The failing `CommunityCover` / `CommunityHeader` tests | `d55f5fc` | `packages/modules/communities/tests/community-page-ui.test.tsx` |
| 1 (GREEN) | The cover, the header, the page, the post list and the catalog | `b44d21a` | `packages/modules/communities/ui/**`, `apps/web/app/(app)/comunidades/[communityId]/**`, `apps/web/lib/feed.ts` |
| 2 (RED) | The failing `PATCH /v1/communities` cases | `b5dbfba` | `apps/api/tests/integration/communities.test.ts` |
| 2 (GREEN) | The schema, the service, the route, the events and the shared form | `a3c956e` | `packages/modules/communities/{contracts,server,module}.ts`, `apps/web/app/(app)/comunidades/{CommunityForm.tsx,nova,…/editar}` |
| 3 | The trigger, the pgTAP acceptance file, the seed fixture and the e2e walk | `7842ceb` | `supabase/migrations/20260923204828_communities_counters.sql`, `supabase/tests/110-communities-stories.sql`, `scripts/seed.ts`, `apps/web/e2e/comunidades.spec.ts` |
| 3 (fix) | The edit entry point and the reactivate control | `9d4ea3d` | `packages/modules/communities/ui/CommunityHeader.tsx`, `apps/web/app/(app)/comunidades/**` |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | `d55f5fc` `test(05-04)` | Pass — `gsd-tools check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| RED | `b5dbfba` `test(05-04)` | Pass — **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| GREEN | `b44d21a`, `a3c956e` `feat(05-04)` | Pass — 19/19 module-communities, 408/408 integration |
| REFACTOR | — | Not performed; no cleanup was warranted, and the reference commits REFACTOR only on change |

**RED evidence for Task 1, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/community-page-ui.test.tsx --reporter=tap-flat` (cwd `packages/modules/communities`)
- **Exit code:** 1 — 8 tests, 0 pass, 8 fail
- **Target test:** `tests/community-page-ui.test.tsx > CommunityCover — one component, two geometries, two branches (UI-D-35) > 1. a cover asset takes the IMAGE branch, at the card geometry, with the host overlay on top`
- **Expected:** `CommunityCover` with a cover asset renders `MediaImage` inside an explicit-ratio `aspect-[16/7]` box carrying the host overlay
- **Actual:** `TestingLibraryElementError: Unable to find an element by: [data-testid="community-cover-image"]` — the component renders nothing at all

**RED evidence for Task 2, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/integration/communities.test.ts --reporter=tap-flat` (cwd `apps/api`)
- **Exit code:** 1 — 26 tests, 18 pass, 8 fail
- **Target test:** `tests/integration/communities.test.ts > PATCH /v1/communities/{id} — edit, archive and reactivate (COMM-01, UI-D-37) > 19. an admin edits name and description; a member is refused 403 (T-05-18)`
- **Expected:** `PATCH /v1/communities/{id}` refuses a member with 403 (`requirePermission`) and lets an admin write name and description, returning 200
- **Actual:** `AssertionError: expected 404 to be 403` — there is no `PATCH` route on `/v1/communities` at all, so Hono answers 404 for every caller

**Note on the RED-phase skeletons (Task 1).** The two new component modules land in the `test(05-04)` commit as signature-only files whose bodies `return null`. That is deliberate and is what makes the RED valid: with no module at all the loader fails and `check tdd-red-evidence` classifies the run as `fixture_or_load_failure`, which is explicitly NOT RED (#3770). With a skeleton the named target test fails on its own assertion, which is.

**Note on the TAP normalizer (a standing environment fact, not a plan artifact).** `check tdd-red-evidence` parses a `node --test` TAP summary; Vitest never emits `# tests` / `# pass` / `# fail`. Both records were built from the REAL captured runs: Vitest's own `tap-flat` reporter supplied the `ok` / `not ok` lines verbatim, and a throwaway script DERIVED the three summary lines by counting them. No count was typed by hand.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 05-01 took the UI-SPEC's `communities.region` key for a different surface**

- **Found during:** Task 1
- **Issue:** The UI-SPEC's Copywriting Contract names `communities.region` as the COMMUNITY PAGE's post-list landmark ("Publicações de {community}"), and this plan's acceptance criteria require that string. 05-01 had already used the key for the LIST's landmark ("Comunidades de {tenant}"), so the spec's own name was occupied by a different surface.
- **Fix:** `communities.region` now carries the spec's string; the list's landmark moved to `communities.list.region`. `CommunitiesList.tsx` and the `list()` locator in `comunidades.spec.ts` follow it, each with the reason restated.
- **Files modified:** `apps/web/messages/pt-BR/communities.json`, `apps/web/app/(app)/comunidades/CommunitiesList.tsx`, `apps/web/e2e/comunidades.spec.ts`
- **Verification:** `comunidades.spec.ts` 16/16 immediately after the move; `bash scripts/check-ui-literals.sh` green.
- **Commit:** `b44d21a`

**2. [Rule 1 - Bug] A unit assertion was measuring happy-dom rather than the component**

- **Found during:** Task 1 GREEN
- **Issue:** The RED test asserted `getByAltText('cover-alt')` inside the image branch. `MediaImage`'s documented contract is that an object it cannot fetch degrades to the neutral `bg-bg-tertiary` box — and under happy-dom NOTHING fetches, so the assertion could only ever fail. It was asserting the test environment, which is 05-01's e2e lesson restated at unit scale.
- **Fix:** The assertion is now the rendered BRANCH: a `data-testid="community-cover-media"` wrapper plus the photograph branch's own veil (`from-black/85`), which the gradient branch must never carry.
- **Files modified:** `packages/modules/communities/tests/community-page-ui.test.tsx`, `packages/modules/communities/ui/CommunityCover.tsx`
- **Verification:** 8/8 in the file, 19/19 in the package.
- **Commit:** `b44d21a`

**3. [Rule 1 - Bug] `feed.test.ts`'s "the last community" silently became the ARCHIVED one**

- **Found during:** Task 3, the first full integration run after the seed gained its archived fixture
- **Issue:** `demoCommunities()` read every community of the demo tenant with no status filter, and case 16 picked `communities[communities.length - 1]`. The archived fifth sorts last, so the case archived an already-archived container, found none of its posts in the feed (it has none by design) — and its `finally` RESTORED it to `active`, leaving the shared seed in a state three assertions in `communities.test.ts` depend on it not being in. Four tests failed, only one of them in the file that caused it.
- **Fix:** `demoCommunities()` filters `status = 'active'` and returns the trigger-owned `post_count`; case 16 picks a container that actually HAS posts, so the "archiving leaves them in the feed" half cannot pass vacuously.
- **Files modified:** `apps/api/tests/integration/feed.test.ts`
- **Verification:** `pnpm test:integration` — 408/408, twice, across a `db:reset` + `db:seed`.
- **Commit:** `7842ceb`

**4. [Rule 2 - Missing critical] Nothing navigated to the edit form, and archiving was reversible only through the API**

- **Found during:** the close-out review against the plan's own `<done>` ("an admin creates, edits, archives and REACTIVATES a community from a phone")
- **Issue:** `/comunidades/[communityId]/editar` existed and no surface linked to it; `reactivateCommunityAction` existed and no control called it. Both capabilities were shipped and unreachable from a browser, which means COMM-01 was not true end to end for the only actor it names.
- **Fix:** `CommunityHeader` gained an optional 44×44 `action` slot at `top-3 right-3`, mirroring the back control, which the community page fills with the admin's edit LINK gated on `communities.community.manage`. The edit form swaps its `ghost text-danger` archive row for an `outline` reactivate row when the community is archived, so a status change has exactly one place to happen either way.
- **Files modified:** `packages/modules/communities/ui/CommunityHeader.tsx`, `apps/web/app/(app)/comunidades/{CommunityForm.tsx,[communityId]/page.tsx,[communityId]/editar/page.tsx}`, `apps/web/e2e/comunidades.spec.ts`
- **Verification:** three new e2e cases including a full archive → reactivate → archive round trip; `comunidades.spec.ts` 30/30.
- **Commit:** `9d4ea3d`

**5. [Rule 3 - Blocker] The cover preview was hidden on desktop, where the approved drawing shows it**

- **Found during:** Task 3, the desktop-chromium e2e run
- **Issue:** The preview was `md:hidden` and the desktop showed a bare `FileDropZone`. The approved sketch puts the gradient preview INSIDE the desktop drop zone, and UI-D-38's whole argument for the preview — "the admin sees exactly what members will see" — is not a phone affordance.
- **Fix:** The preview renders on both breakpoints, with the desktop drop zone directly beneath it. The shipped `FileDropZone` takes no children, so nesting it as the drawing does was not available without forking the primitive; the two things are on screen in the same order.
- **Files modified:** `apps/web/app/(app)/comunidades/CommunityForm.tsx`
- **Verification:** `comunidades.spec.ts` on both projects.
- **Commit:** `7842ceb`

### Additions beyond the plan's literal wording

- **A one-shot backfill inside the counters migration.** The plan specifies the trigger; without the backfill every community created before it would sit at `post_count = 0` forever and 110's reconciliation would be red on a real database. It is deliberately not guarded by `where post_count = 0` — a row whose count was already wrong is exactly the row it needs to fix.
- **`last_activity_at` is re-derived on the decrement branches.** The plan's `<action>` describes increment/decrement only, but its own acceptance criterion asks 110 to reconcile `last_activity_at` against the newest live post. A monotone-only column cannot satisfy that after a soft delete, so the decrement branches re-derive it and the invariant is stated in the migration header.
- **`not-found.tsx` for the community route.** The plan's file list stops at `page.tsx`; `notFound()` needs a boundary, and the `/post/[postId]` shape this route copies has one. Without it the miss would render Next's default rather than the one screen D-23 requires.
- **`scripts/check-static-routes.sh` gained the four community routes.** The file's own docblock says "Extend when a new authenticated route ships"; 05-01 had not, so `/comunidades` could have gone static with nothing going red.
- **`apps/web/lib/feed.ts` learned `communityId` rather than gaining a second fetch function**, which is what keeps the "ONE fetch implementation per resource" rule (D-58) intact across the two surfaces.

**Total deviations:** 5 auto-fixed (3× Rule 1 bugs, 1× Rule 2 missing-critical, 1× Rule 3 blocker) plus 5 documented additions. **Impact:** net positive — deviation 3 repaired an assertion that had stopped measuring what it names, and deviation 4 closed the gap between an API capability and a shipped feature.

## Authentication Gates

None. Everything ran against the local Supabase stack, whose health and applied migrations were verified before Task 3 began (its `<precondition>`).

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| The Destaques (pinned-story) slot is `const highlights: ReactNode = null` | `apps/web/app/(app)/comunidades/[communityId]/page.tsx` | **Intentional, and named by the plan itself** ("an empty placeholder this plan leaves for 05-08 to fill, rendering nothing when there is nothing pinned"). `null` renders the section AND its `SectionTitle` as absent, which is the CORRECT empty rendering per UI-SPEC E12/empty — a member sees a page with a header, a hairline and posts, never a broken or reserved surface. 05-08 (STORY-04 / D-68) supplies the circle row. Recorded in `.planning/WINDOWS.md`. |

Nothing else. The plan's goal is achieved with the stub in place: COMM-03 is "a member opens a community and sees its posts", and pinned stories do not exist yet in any module.

## Threat Flags

None. Every file this plan touched sits inside the threat model the plan registered (T-05-18 … T-05-24, T-05-SC), and each mitigation is implemented and asserted:

| Threat | Mitigation shipped | Asserted by |
|--------|--------------------|-------------|
| T-05-18 elevation on PATCH / archive | the route literal `requirePermission('communities.community.manage')` | `communities.test.ts#19` (member 403) |
| T-05-19 a foreign tenant's cover asset id | the write runs in the tenant lane under `communities_tenant_isolation`; the payload carries an asset id and a ladder, never a signed URL | `020-tenant-isolation.sql` (05-01), `MediaImage`'s stable `/v1/media/{assetId}/{variant}` path |
| T-05-20 id enumeration on the page route | one bare 404 for unknown / foreign / removed; `not-found.tsx` takes no props and reads no param | `communities.test.ts#20` |
| T-05-21 stored XSS in name/description | plain text in JSX, no raw-HTML API anywhere in the community surfaces | `grep dangerouslySetInnerHTML` over the new files => 0 |
| T-05-22 tampering with the counters | trigger-owned with no application writer, and no clamp | `110-communities-stories.sql` (two reconciliation assertions) |
| T-05-23 the trigger's privileges | not elevated, `set search_path = ''`, fully-qualified names | acceptance grep: `security definer` => 0 |
| T-05-24 oversized cover upload | `MEDIA_LIMITS.image.cover` enforced at `POST /v1/media/uploads`; bytes never transit Cloud Run | the Phase 3 upload machine, reused unchanged |
| T-05-SC npm/pnpm installs | **zero external packages added** | `pnpm-lock.yaml` untouched |

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @tria/module-communities typecheck && lint` | pass (18 files) |
| `pnpm --filter @tria/module-communities test` | pass — 19/19 (3 files) |
| `pnpm --filter @tria/module-feed test` | pass — 111/111 |
| `pnpm --filter @tria/api typecheck && lint` | pass (60 files) |
| `pnpm --filter @tria/web typecheck && lint` | pass (243 files) |
| `pnpm --filter @tria/web build` | pass — all four community routes build as `ƒ` (dynamic) |
| `bash scripts/check-static-routes.sh` | pass — 36 guarded routes, 0 offenders |
| `pnpm db:generate` against the committed migration | no-op ("No schema changes"), `git status --porcelain -- supabase/migrations` empty |
| `pnpm db:reset && pnpm db:seed` | pass — 5 communities per tenant (1 archived), counters reconciled by the trigger |
| `pnpm supabase test db` | pass — 12 files, **229** tests (was 211), `Result: PASS` |
| `pnpm test:integration` | pass — 28 files, **408/408** |
| `pnpm --filter @tria/web exec playwright test comunidades.spec.ts` | pass — **30/30** (mobile + desktop) |
| `pnpm --filter @tria/web exec playwright test feed.spec.ts shell.spec.ts phase4-smoke.spec.ts` | pass — 41 passed, 3 skipped |
| `pnpm --filter @tria/web exec playwright test phase2-smoke.spec.ts` | pass — 12 passed, 3 skipped |
| `bash scripts/check-ui-literals.sh` | pass |
| `pnpm boundaries` | pass — 507 files, 8 packages, no issues |
| `pnpm boundaries:negative` | pass — both layers reject the fixture |

## Issues Encountered

None outstanding. Two standing facts worth carrying forward:

- **`pnpm db:seed` cannot REPAIR a mutated seed row.** Every community insert is `on conflict (id) do nothing`, so a test that changes a seeded community's status and fails before restoring it leaves the fixture wrong until `pnpm db:reset`. Deviation 3 is exactly that failure mode; the fix removes the cause, but the seed's inability to repair is pre-existing and out of this plan's scope.
- **The two flaky Playwright cases recorded in `.planning/phases/05-communities-stories/deferred-items.md`** (`media-video.spec.ts:491`, `platform-branding.spec.ts:130`) were not re-run here and are unaffected by this plan.

## Next Phase Readiness

Ready for **05-05 onward**:

- `CommunityCover` and `CommunityHeader` are exported from `@tria/module-communities/ui`; the header's `action`, `statusPill` and `note` slots are the seams a later plan fills without touching the component.
- **The Destaques slot is one `const` away from working.** `apps/web/app/(app)/comunidades/[communityId]/page.tsx` already renders `SectionTitle` "Destaques" + the row + the hairline the moment `highlights` is non-null; 05-08 supplies the node and nothing else on that page changes.
- `communities.post_count` and `communities.last_activity_at` are live database facts, so `/comunidades`' ordering is finally driven by real activity and the card's count is real.
- The seed's archived community (`Mutirao de 2025 (encerrado)`, demo id `…c5`) is the fixture any later plan needs for a read-only container.
- `supabase/tests/110-communities-stories.sql` is the Phase 5 acceptance file the stories plans extend; it currently carries 18 assertions and rolls back like its siblings.
- **The D-33 design gate is open** (`approved: true`, provisional), so 05-05..05-08 are unblocked on it.

## Self-Check: PASSED

All 11 `key-files.created` entries exist on disk (`[ -f ]`), and all six task commits are reachable in `git log --all`: `d55f5fc`, `b44d21a`, `b5dbfba`, `a3c956e`, `7842ceb`, `9d4ea3d`.
