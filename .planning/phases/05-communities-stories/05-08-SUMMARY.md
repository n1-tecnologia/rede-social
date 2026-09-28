---
phase: 05-communities-stories
plan: 08
subsystem: api
tags: [stories, pins, highlights, admin-history, exit-gate, D-68, D-84, UI-D-29, UI-D-40, UI-D-41, STORY-04, COMM-03]
status: complete

requires:
  - phase: 05-communities-stories
    provides: "05-04's community page with its named `highlights` stub; 05-05's stories table, StoriesStrip and StoryCircle with its two ring variants; 05-06's `/stories/[storyId]` viewer and the StoriesSurface/StoryViewerHost host-injection pattern; 05-07's story comments, which make a pinned expired story a fully interactive surface"
  - phase: 05-communities-stories
    provides: "05-03's CommunityPickerSheet, whose trailing control was factored as a prop for exactly this sheet, and its `archived` refusal code"
  - phase: 04-feed
    provides: "the ONE cursor envelope in packages/core/server/paging.ts, likePost's idempotent-toggle shape, PostMenu's sheet-row geometry and its no-quoting confirmation rule"
  - phase: 03-media-profiles
    provides: "MediaImage and its degraded branch; the `media` catalog's Processando/Recusado vocabulary; MembersList's append-never-replace state machine"
  - phase: 01-foundations
    provides: "withTenantTx, tenantIsolationPolicy, requireAuth/requireModule/requirePermission, the module manifest and its EventMap declaration merging"
provides:
  - "`story_community_pins` — STORY-04's join, with its unique pair as the idempotency arbiter, its community-scoped ordering index, RLS, and a hand-written cross-module FK to `public.communities`"
  - "`pinStory` / `unpinStory` — idempotent in BOTH directions with no conflict status anywhere, resolving both ids inside the tenant transaction, emitting only on a real TRANSITION"
  - "`listCommunityHighlights` — the read whose ABSENT expiry predicate IS the mechanism of STORY-04"
  - "`listStoryPins` — the pin sheet's initial state, ids only"
  - "`storySummarySchema.pinnedCommunityCount` — UI-D-40's indicator, counted in the same statement"
  - "`StoryHistoryRow` (UI-D-40) and `PinStorySheet` (UI-D-41), the latter over an INJECTED list body"
  - "`/stories/meus` — D-84's admin history, the home of pin/unpin and delete"
  - "UI-D-29's two doors: the publish screen's trailing action (already wired by 05-05) and the settings administration row"
  - "The community page's Destaques row: the same StoriesStrip, the neutral ring, opening the viewer (D-68)"
  - "`apps/web/e2e/phase5-smoke.spec.ts` — the per-phase two-direction module-flag witness for BOTH keys"
  - "A `pnpm verify` chain that can actually pass: it re-seeds between the integration and e2e stages"
affects: [07-notifications, 08-moderation]

tech-stack:
  added: []
  patterns:
    - "A join table as the promoted representation of a SURFACE-scoped visibility rule: the pin ROW is the expiry override, and the community read carries no expiry predicate at all"
    - "Component injection across a denied module->module edge, for the THIRD time in this phase: `PinStorySheet` takes `CommunityPickerSheet` as `renderList`, as `StoryViewer` takes `overlay`"
    - "Events that count TRANSITIONS rather than requests, in both directions of a toggle (`returning id` is the discriminator)"

key-files:
  created:
    - packages/modules/stories/ui/StoryHistoryRow.tsx
    - packages/modules/stories/ui/PinStorySheet.tsx
    - packages/modules/stories/tests/story-pins.test.ts
    - packages/modules/stories/tests/story-history-row.test.tsx
    - packages/modules/stories/tests/pin-story-sheet.test.tsx
    - apps/web/app/(app)/stories/meus/page.tsx
    - apps/web/app/(app)/stories/meus/StoryHistoryList.tsx
    - apps/web/e2e/phase5-smoke.spec.ts
    - supabase/migrations/20260924022607_story_community_pins.sql
  modified:
    - packages/modules/stories/db/schema.ts
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/server/{routes,service}.ts
    - packages/modules/stories/module.ts
    - packages/modules/stories/ui/index.ts
    - packages/modules/communities/ui/CommunityPickerSheet.tsx
    - apps/web/lib/{stories,story-view}.ts
    - apps/web/app/(app)/stories/story-actions.ts
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/messages/pt-BR/{stories,app}.json
    - supabase/tests/{110-communities-stories,020-tenant-isolation}.sql
    - scripts/seed.ts
    - apps/api/tests/integration/{stories,isolation}.test.ts
    - apps/web/e2e/{stories,comunidades}.spec.ts
    - package.json

key-decisions:
  - "The pin ROW is the expiry override, not a column on the story: STORY-04 says 'one or more communities', which no boolean can represent, and a denormalised flag would be a second writer of a fact the join already holds"
  - "Unpin is a HARD delete — the one place Phase 5 departs from soft-delete — because a pin carries no authored content and no moderation evidence, and a soft-deleted pin would need an extra predicate threaded through every join"
  - "`story.pinned` and `story.unpinned` count TRANSITIONS, not requests: a repeat pin and an unpin of nothing both answer 200 and announce nothing"
  - "An archived community refuses a new PIN but still accepts an UNPIN: archiving gates new content, and gating removal too would strand a pin forever"
  - "`CommunityPickerSheet` renders an inert row when no `onSelect` is given — a `Switch` inside a `<button>` is invalid HTML and two tab stops for one row"

requirements-completed: [STORY-04, COMM-03]

coverage:
  - deliverable: "story_community_pins with its unique pair, its ordering index and its cross-module FK"
    verification:
      - kind: pgtap
        ref: "supabase/tests/110-communities-stories.sql#story_community_pins_uq refuses a second row for the same (story, community) pair"
        status: pass
      - kind: pgtap
        ref: "supabase/tests/020-tenant-isolation.sql#story_community_pins six-axis isolation block"
        status: pass
    human_judgment: false
  - deliverable: "A pinned story is visible on its community page for EVERY value of now()"
    verification:
      - kind: pgtap
        ref: "supabase/tests/110-communities-stories.sql#STORY-04: a pinned story is visible on its community page for EVERY value of now()"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#24. THE INVARIANT: the pinned EXPIRED story is on the community page while the strip refuses it"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#a member opens the pinned EXPIRED story from Destaques, and the same story is absent from /inicio"
        status: pass
    human_judgment: false
  - deliverable: "Idempotent pin/unpin with no conflict status, the archived refusal and the bare 404"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-pins.test.ts#10 cases"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#22-37"
        status: pass
    human_judgment: false
  - deliverable: "The community Destaques row — the same strip, the neutral ring, opening the viewer (D-68)"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/comunidades.spec.ts#a community with pins renders the row AND its section title; one without renders neither"
        status: pass
    human_judgment: false
  - deliverable: "\"Seus stories\" (UI-D-40) with its row menu, its delete and its two doors (UI-D-29)"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/story-history-row.test.tsx#11 cases"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#the two doors UI-D-29 specifies both reach the history, and the \"+\" circle still publishes"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#a story the walk published is deleted from the history, dialog and toast included"
        status: pass
    human_judgment: false
  - deliverable: "The pin sheet (UI-D-41): one immediate toggle per row, no save button, reverting in place"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/pin-story-sheet.test.tsx#11 cases"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#the pin sheet toggles ONE community immediately, with no save button anywhere"
        status: pass
    human_judgment: false
  - deliverable: "The per-phase two-direction module-flag witness for communities AND stories"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/phase5-smoke.spec.ts#12 cases across both projects"
        status: pass
    human_judgment: false
  - deliverable: "The phase exit gate: pnpm verify green end to end"
    verification:
      - kind: command
        ref: "pnpm verify"
        status: pass
    human_judgment: false
  - deliverable: "The visual fidelity of the two prototype-less surfaces against sketch 003"
    human_judgment: true
    rationale: "Geometry, spacing and the feel of the row list and the pin sheet against the approved drawing are a design judgement no assertion makes. The structural claims (min-h-14, tabular-nums, truncate, 44px rows, the switch, the absence of a save button) are asserted; how it LOOKS is the product owner's call at UAT."

metrics:
  duration: "2h 12m"
  completed: "2026-09-24"

actuals:
  tokens: 81698
  tasks: 3
  commits: 6
  plan_head_before: ad50e43bac3714fd26a395779b50c06d6fcbae3d
---

# Phase 5 Plan 08: Community Pins, "Seus stories" and the Phase Exit Gate Summary

`story_community_pins` makes a 24-hour broadcast outlive its own clock on the community pages an admin chose, and `/stories/meus` gives that editorial act — and the delete beside it — the one screen Phase 5 had no prototype for.

## Performance

- **Duration:** 2h 12m
- **Started:** 2026-09-24T02:18Z
- **Completed:** 2026-09-24T04:30Z
- **Tasks:** 3 of 3
- **Files modified:** 35

## Accomplishments

- **The invariant is a proved fact inside Postgres, not a claim in prose.** `110-communities-stories.sql` pins the EXPIRED story from 05-05's controlled-clock fixture to a community and asserts the highlights join returns it — *a pinned story is visible on its community page for EVERY value of `now()`* — **beside the STRIP predicate refusing the same row in the same transaction**. The two surfaces are therefore proved to disagree DELIBERATELY rather than by accident, and an UNPINNED active story is the positive control in the same block: it is returned by the strip and NOT by the highlights join, so a permissive query could not pass. If a future phase reintroduces a global liveness predicate on the community path, that assertion goes red the instant it lands.
- **Read the `where` clause for what is NOT in it.** `listCommunityHighlights` carries no `expires_at > now()` at all, and no readiness filter either. That absence is the whole mechanism of STORY-04, said in the service docblock, in the schema's reviewer docblock (item 6) and in the migration header, because the "improvement" a later reader will reach for is exactly the predicate that would break the requirement.
- **The toggle is idempotent in both directions and there is no conflict status anywhere in the feature.** `story_community_pins_uq` is the arbiter, not application code: `on conflict … do nothing` means a repeat pin inserts nothing and answers 200 with the identical body, and an unpin of something never pinned removes nothing and answers 200 too. A 409 would have surfaced as an error toast on a gesture the admin has every right to repeat, and would have made the sheet's optimistic switch revert on a state that is already true.
- **The events count TRANSITIONS rather than requests, in BOTH directions.** `returning id` on the insert and on the delete is what distinguishes "a row moved" from "the unique pair absorbed the write", and only the first announces anything. Phase 7 builds a notification row straight from these payloads; a duplicate announcement of a state that never changed is a lie it cannot detect.
- **An archived community refuses a new pin and still accepts an unpin**, and the asymmetry is the point. Archiving gates NEW content; if it gated removal too, a story pinned before the archive would stay highlighted on that page forever with no affordance to take it down. Asserted as a pair in one integration case: the refusal carries 05-03's own `archived` code, and the unpin of an archived container succeeds.
- **D-68 is answered YES on a real screen.** The community page's `highlights` stub — `null` since 05-04 — is now the SAME `StoriesStrip` the `/inicio` home slot renders, with the pinned data source and the neutral ring (UI-D-27), opening the viewer on that community's own pinned sequence. One component, two data sources, two ring variants, no tabbed page.
- **Every circle is identical whether its story is active or expired** (D-79, A-4). The ring variant is a property of the ROW, never of the story; `isActive` still rides the payload because the viewer needs it for the expired-mid-view case. pgTAP case 53 asserts that a pinned active and a pinned expired story come back from ONE query distinguished only by the projected flag.
- **"Seus stories" is a row list because the two things it exists for are the counts and the pinned state** — a grid of 9:16 crops would hide both, and would have nowhere to put the `Processando`/`Recusado` pill (Pitfall 5). The COUNT is the presence test for the pin indicator, never a null check: a story pinned nowhere renders no indicator at all.
- **The pin sheet's whole product rule is a negative one, and it is asserted as an absence.** There is no save button and no form: STORY-04 is a set of independent facts, one row per community, and a `Salvar` would invent a transaction the schema does not have. Every toggle is its own immediate request, optimistic, reverting in place with the row STILL THERE — because the commonest failure is a community archived between render and tap, and vanishing the row mid-gesture would be worse than the failure.
- **UI-D-29's two doors are both live and the "+" circle kept its single tap.** The publish screen's trailing action already pointed at `/stories/meus` (05-05 wired it deliberately, as a known stub); the settings administration group gains its row, gated on the composed `stories.story.manage` permission rather than on the role beside it.
- **The phase's two module flags are witnessed independently, in both directions.** `phase5-smoke.spec.ts` flips `communities` and `stories` one at a time on a throwaway tenant and asserts the corresponding surface disappears and returns — a single combined flip would have passed on an implementation where one module's routes were gated by the other's flag — and then shows the seeded tenant's rows untouched.
- **Gates:** `pnpm supabase test db` at **285** assertions (was 265), `pnpm test:integration` at **472** (was 455), the module suite at **82**, and the full `pnpm verify` **green end to end**: 405 e2e passed / 69 skipped / **0 failed**, plus 45 PWA e2e passed.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 (RED) | The failing pin-toggle suite and its signature-only skeletons | `d04a852` | `packages/modules/stories/{tests/story-pins.test.ts,contracts/index.ts,server/service.ts}` |
| 1 (GREEN) | The pin table, the idempotent pair, the highlights read and the Destaques row | `0b44f8a` | `packages/modules/stories/{db/schema.ts,server/**,module.ts}`, `apps/web/lib/stories.ts`, `apps/web/app/(app)/comunidades/[communityId]/page.tsx` |
| 2 | The migration, the invariant under a controlled clock, the isolation block and the seed | `b9366a6` | `supabase/migrations/20260924022607_story_community_pins.sql`, `supabase/tests/{110,020}-*.sql`, `scripts/seed.ts`, `apps/api/tests/integration/{stories,isolation}.test.ts` |
| 3 (RED) | The failing history-row and pin-sheet suites, with their skeletons | `ed592e6` | `packages/modules/stories/{tests/*.test.tsx,ui/{StoryHistoryRow,PinStorySheet}.tsx,ui/index.ts}` |
| 3 (GREEN) | "Seus stories", the pin sheet, the two doors and the phase smoke witness | `bfe3129` | `packages/modules/stories/ui/**`, `packages/modules/communities/ui/CommunityPickerSheet.tsx`, `apps/web/app/(app)/stories/meus/**`, `apps/web/e2e/**` |
| 3 (fix) | The exit gate could not pass as composed | `3ebcc5b` | `package.json`, `apps/web/e2e/comunidades.spec.ts`, `deferred-items.md` |

## TDD Gate Compliance

Both TDD-marked tasks ran a full RED → GREEN cycle with machine-verified evidence.

| Task | Gate | Commit | Status |
|------|------|--------|--------|
| 1 | RED | `d04a852` `test(05-08)` | Pass — `check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| 1 | GREEN | `0b44f8a` `feat(05-08)` | Pass — 10/10 pin cases, 60 for `@rede-social/module-stories` |
| 1 | REFACTOR | — | Not performed; no cleanup was warranted |
| 3 | RED | `ed592e6` `test(05-08)` | Pass — `check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| 3 | GREEN | `bfe3129` `feat(05-08)` | Pass — 11/11 history-row, 11/11 pin-sheet, 82 for `@rede-social/module-stories` |
| 3 | REFACTOR | — | Not performed; `3ebcc5b` repaired the verify chain and a suite-order dependency, not the code |

**Task 1 RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/story-pins.test.ts --reporter=tap-flat` (cwd `packages/modules/stories`)
- **Exit code:** 1 — 10 tests, 0 pass, 10 fail
- **Target test:** `tests/story-pins.test.ts > STORY-04 — pinning a story to a community, idempotently and in both directions > 1. a pin creates one row and answers the story pinned-community count`
- **Expected:** `pinStory` resolves `{ pinned: true, pinnedCommunityCount: 1 }` — the row is created inside the tenant transaction and the count is read back from the rows
- **Actual:** `AssertionError: expected { pinned: false, pinnedCommunityCount: 0 } to deeply equal { pinned: true, pinnedCommunityCount: 1 }` — the RED skeleton returns a frozen mismatched pair

**Task 3 RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/story-history-row.test.tsx tests/pin-story-sheet.test.tsx --reporter=tap-flat` (cwd `packages/modules/stories`)
- **Exit code:** 1 — 21 tests, 4 pass, 17 fail
- **Target test:** `tests/pin-story-sheet.test.tsx > PinStorySheet — UI-D-41, one switch per community and no Salvar anywhere > 3. one toggle is ONE immediate call carrying the id and the direction`
- **Expected:** moving one row's `Switch` calls `onToggle` exactly once with `('c2', true)` — every pin is its own immediate request, never a batch behind a save button
- **Actual:** `TestingLibraryElementError: Unable to find an accessible element with the role "switch" and name "pin-c2"` — the RED skeleton renders `null`, so there is no control to move

**Note on the TAP normalizer** (a standing environment fact, recorded by 05-01, 05-05, 05-06 and 05-07 before this plan). `check tdd-red-evidence` parses a `node --test` TAP summary; Vitest never emits `# tests` / `# pass` / `# fail`. Both records were built from the REAL captured runs: Vitest's own `tap-flat` reporter supplied the `ok` / `not ok` lines verbatim, and a throwaway script DERIVED the three summary lines by counting them. No count was typed by hand.

Both RED phases were valid on the first capture — neither returned `unexpected_green` nor `fixture_or_load_failure` — because the skeletons were deliberately signature-only-and-wrong rather than absent: frozen `{ pinned: false, pinnedCommunityCount: 0 }` pairs, a `StoryHistoryRow` rendering a bare `<div>` and a `PinStorySheet` returning `null`. An absent symbol would have crashed the loader, which is `INVALID_RED`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The pin sheet showed every story the FIRST story's pins**

- **Found during:** Task 3, the first full `stories.spec.ts` run
- **Issue:** `PinStorySheet` seeded its optimistic state with `useState(() => new Set(pinnedCommunityIds))`. The sheet stays MOUNTED while it is closed (so its exit animation can play), so that initialiser runs exactly once — for the first story the admin ever opens it on — and every story after that inherits the first one's pins. The e2e caught it directly: a story the seed HAD pinned opened with its switch off.
- **Fix:** re-seed during render when the `pinnedCommunityIds` identity changes (React's documented alternative to an effect, the `MembersList` idiom). A regression case was added to the suite — case 11, "re-opening on ANOTHER story RE-SEEDS the switches from the new prop".
- **Files modified:** `packages/modules/stories/ui/PinStorySheet.tsx`, `packages/modules/stories/tests/pin-story-sheet.test.tsx`
- **Verification:** the pin walk went from failing on both projects to passing on both; module suite 81 → 82.
- **Commit:** `bfe3129`

**2. [Rule 2 - Missing] A `Switch` inside a `<button>` is invalid HTML and two tab stops for one row**

- **Found during:** Task 3, composing `PinStorySheet` over `CommunityPickerSheet`
- **Issue:** the shared picker wraps each row in a `<button>`. Its docblock already anticipated "omitted, the rows are inert and only `trailing` acts", but the row was still rendered as a button — so the pin sheet would have nested one interactive element inside another: invalid per the HTML content model, two tab stops per row, and a tap on the switch bubbling into a row handler that should not exist.
- **Fix:** `CommunityPickerSheet` renders the row as a plain flex container when `onSelect` is absent, with the identical class list so the two sheets stay pixel-identical. The "Publicar em" picker (which passes `onSelect`) is unchanged in both behaviour and markup. The reason is written into the component's docblock.
- **Files modified:** `packages/modules/communities/ui/CommunityPickerSheet.tsx`
- **Verification:** `@rede-social/module-communities` 19/19 still green; the pin sheet's row renders exactly the geometry UI-D-41's drawing shows.
- **Commit:** `bfe3129`

**3. [Rule 3 - Blocker] `pnpm verify` could not pass as composed — the chain destroys its own e2e fixture**

- **Found during:** Task 3, the FIRST full exit-gate run
- **Issue:** six viewer-clock e2e cases timed out (`the first bar fills`, the tap/hold/swipe cases, the comment sheet). 05-07 had already recorded the cause as a standing environment fact — a `pnpm test:integration` pass leaves the demo tenant's fixed-id media assets with no `storage.objects` rows, so `MediaImage` never reports `load` and the clock never starts — but nobody had run the FULL chain, in which `test:integration` runs immediately before `e2e`. Confirmed rather than assumed: `select count(*) from public.media_assets where tenant='rede-demo' and kind='video'` returned **0** after the run.
- **Fix:** `pnpm db:reset && pnpm db:seed` now sits between `spike:supavisor` and `e2e` in the `verify` script. The e2e suite legitimately requires a seeded database and the integration suite legitimately destroys part of it; making that explicit is what the standing environment fact prescribes, and CI runs the same chain.
- **Files modified:** `package.json`
- **Verification:** the six failures went to zero on the next run; the gate is now green end to end.
- **Commit:** `3ebcc5b`

**4. [Rule 1 - Bug] A Destaques assertion depended on the order the suite happened to run in**

- **Found during:** Task 3, the same first exit-gate run
- **Issue:** `comunidades.spec.ts` asserted exactly TWO circles on the pinned community. The seed pins two stories there — the expired image and an active VIDEO — but `media-video.spec.ts` performs a hard, total reset of the demo tenant's video library and takes that video's ASSET with it. The highlights read inner-joins `media_assets`, so under a full-suite run the video's circle is legitimately gone and the count is 1. `stories.spec.ts` already refuses to mirror the strip's size for this exact reason; the new spec had not inherited the lesson.
- **Fix:** the assertion is now "at least one circle", with the reason written beside it. The claim the exact count carried — that an active and an expired pinned story come back from ONE query distinguished only by the projected flag — is asserted where it CAN be exact: `110-communities-stories.sql` case 53 and `stories.test.ts` case 29.
- **Files modified:** `apps/web/e2e/comunidades.spec.ts`
- **Commit:** `3ebcc5b`

**5. [Rule 3 - Blocker] The third gate run died on `No space left on device`**

- **Found during:** the exit-gate re-runs
- **Issue:** three full `pnpm verify` passes filled the disk; `.turbo/cache` alone held **8.5 GB**.
- **Fix:** `rm -rf .turbo/cache` and the Playwright `test-results/` directories — all three gitignored build artifacts, removed by path rather than by any blanket git operation. Nothing tracked was touched.
- **Files modified:** none.

### Additions beyond the plan's literal wording

- **`storySummarySchema` gained `pinnedCommunityCount`.** UI-D-40's row renders it, and fetching it per row would be the N+1 `feed-query-budget.test.ts` has a ceiling for. It is counted in the shared projection, so it rides the strip's read too, unread — one projection serving three surfaces is what stops the three disagreeing about what a story is.
- **`storyProjection` gained an `extra` parameter.** The Destaques read needs the two PIN columns its cursor is built from (`p.id`, `p.pinned_at`). The alternative was a second copy of the column list, which is the drift the shared projection exists to prevent.
- **`loadOwnStories` and `loadCommunityHighlights` in `apps/web/lib/stories.ts`**, plus `getStoryPins`, `pinStory`/`unpinStory`, `deleteStory` and `storyPinIssue`. `loadCommunityHighlights` NEVER rethrows (the `loadStories` posture) because the row is a widget above a post list on a shared-link-reachable page; `loadOwnStories` DOES surface its failure, because there the history IS the screen and UI E08/error asks for the empty state plus a retry.
- **`loadStoryPinsAction` is a server action rather than a direct lib call.** `StoryHistoryList` is a client component and `apiFetch` reads the session cookie through `next/headers` — the 05-07 lesson about what may cross the RSC boundary, applied before it could bite.
- **Four integration cases beyond the plan's `<behavior>` list:** the per-story pin count on the history payload, the soft-delete removing a story from every community's highlights at once (T-05-52), the `limit` clamp and hostile cursor on the highlights read (T-05-53), and the pin events' exact key set.
- **Three pgTAP assertions beyond the plan's list:** the explicit precondition that the pinned story really IS expired under this transaction's clock (so assertion 49 cannot be read as "the pin worked because the story was live"), the unique-pair refusal, and the soft-delete case.
- **`deferred-items.md` gains entries 4 and 5** — the third full-suite-parallelism flake, and the context for the `verify` change.

### Unmet acceptance criteria (recorded, not skipped)

1. **The migration contains `create table "story_community_pins"`.** It contains `CREATE TABLE "story_community_pins"` — drizzle emits SQL keywords uppercase, and the generated half of the file is kept BYTE FOR BYTE so `pnpm db:generate` stays a provable no-op. The criterion holds case-insensitively; lowercasing the statement would have broken the property the two-half structure exists to guarantee.
2. **"Re-export from the kernel's schema index."** Not done, and it cannot be: `packages/core/db/schema/index.ts` exports only KERNEL tables, because the kernel must not depend on a module (`turbo boundaries` denies `kernel -> module`). Module schemas are picked up by `apps/api/drizzle.config.ts`'s `packages/modules/*/db/schema.ts` glob instead — which is how `stories` itself has been wired since 05-05, and why the migration generated correctly with no index change at all.
3. **`packages/modules/stories/ui/PinStorySheet.tsx` reads the community summary shape from `@rede-social/module-communities/contracts`.** It does not, and must not: the plan's own `key_links` names the edge `turbo boundaries` denies. The row shape is declared in this module's OWN contracts as `StoryPinCommunity` (and as `PinStoryCommunityRow` beside the component), and the list BODY is injected by `apps/web` — the identical resolution 05-03, 05-05, 05-06 and 05-07 each reached. The literal `CommunityPickerSheet` does appear in the file, as the name of the injected type (`CommunityPickerSheetBody`) and in the docblock explaining the injection.
4. **The publish screen's trailing action was to be given its destination.** It already had it: 05-05 shipped `historyHref="/stories/meus"` deliberately, recording the then-dangling link as a known stub rather than hiding the control. This plan only had to create the destination, and `stories.spec.ts` now walks the door.

**Total deviations:** 5 auto-fixed (2× Rule 1 bugs, 1× Rule 2 missing, 2× Rule 3 blockers) plus 6 documented additions and 4 recorded unmet criteria. **Impact:** net positive — deviation 3 in particular turned a gate that could never have passed into one that does, and deviations 1 and 4 were both caught by the e2e rather than by a unit test, which is exactly the division of labour the phase's test tiers are for.

## Authentication Gates

None. Everything ran against the local Supabase stack. Task 2's precondition (the stack up and every earlier Phase 5 migration applied) was verified read-only before any SQL was written — `docker ps` listed `supabase_db_rede-social`, and `pnpm db:reset` then replayed all 32 migrations including this plan's.

Both design-gate preconditions (Tasks 1 and 3) were checked read-only before either task began: `grep -c '^approved: true' .planning/sketches/003-phase-05-designed-screens/README.md` printed **1**, with `status: approved` and `approval_kind: provisional`. **`.planning/sketches/` is unmodified** — `git diff --name-only ad50e43..HEAD -- .planning/sketches` is empty.

## Known Stubs

None. The one seam this plan inherited — 05-05's deliberately dangling "Seus stories" link on the publish screen — is closed by the route this plan creates, and `stories.spec.ts` walks it.

One thing this plan deliberately does NOT do, recorded so it is not mistaken for an omission: there is no "unpin from here" affordance on the community page itself. Pinning is an editorial act with ONE home (D-84), and a second entry point on a member-facing surface would put a destructive-ish admin control where every member can see it.

## Threat Flags

None. Every file this plan touched sits inside the threat model the plan registered:

- **T-05-48** (elevation of privilege on the pin routes) — the literal `requirePermission('stories.story.manage')` on both writes and on the pins read; a member receives 403 on all three, asserted, and the history route itself bounces a member rather than rendering a list the API would refuse.
- **T-05-49** (pinning into another tenant's community) — BOTH ids are resolved inside the same `withTenantTx` transaction before the insert, the pin row carries its own `tenant_id` under RLS, and three crossings (own story/foreign community, foreign story/own community, both foreign) each answer one bare 404 in the integration suite, with the positive control in the same test.
- **T-05-50** (a pinned expired story reachable by a member) — accepted, because it IS the requirement; the admin's unpin is the control and the history's pin indicator is what surfaces it.
- **T-05-51** (highlights leaking another tenant's story) — the join is constrained on the tenant id as well as the story id; `020-tenant-isolation.sql` covers the pin table on all six axes AND asserts the highlights JOIN aimed at the other tenant's community id returns nothing, with a positive control.
- **T-05-52** (a story deleted while pinned) — soft-deleted, the highlights read filters removed stories, the pin rows remain as the record of where it had been. Asserted in pgTAP and in integration case 35.
- **T-05-53** (DoS on the highlights read) — the limit clamps server-side, the community-scoped index serves the ordering, one statement per page.
- **T-05-54** (a half-applied pin batch) — there is no batch, which is why there is no save button.
- **T-05-SC** — **zero external packages were installed.** `pnpm-lock.yaml` is unchanged by this plan.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @rede-social/module-stories typecheck && lint` | pass (26 files) |
| `pnpm --filter @rede-social/module-stories test` | pass — 8 files, **82/82** (was 50) |
| `pnpm --filter @rede-social/module-communities test` | pass — 19/19 |
| `pnpm --filter @rede-social/web typecheck && lint` | pass (259 files) |
| `pnpm --filter @rede-social/web test` | pass — 13 files, 112/112 |
| `pnpm --filter @rede-social/api typecheck && lint` | pass |
| `pnpm turbo run lint typecheck build test` | pass — 19 tasks |
| `pnpm db:generate` against the committed migration | no-op ("No schema changes"); `git status --porcelain -- supabase/migrations` empty |
| `pnpm db:reset && pnpm db:seed` | pass — 5 stories, 3 likes, 3 comments and **2 community pins (1 on the EXPIRED story)** per tenant |
| `pnpm supabase test db` | pass — 12 files, **285 tests**, `Result: PASS` (was 265) |
| `pnpm test:integration` | pass — 29 files, **472/472** (was 455) |
| `bash scripts/check-ui-literals.sh` | pass |
| `bash scripts/check-static-routes.sh` | pass — 38 guarded routes, 0 offenders |
| `pnpm boundaries` | pass — 552 files, 9 packages, no issues |
| `pnpm boundaries:negative` | pass — both layers reject the fixture |
| `pnpm guard:lanes` | pass |
| `pnpm --filter @rede-social/web exec playwright test stories.spec.ts comunidades.spec.ts phase5-smoke.spec.ts` | pass — **77 passed**, 11 skipped, all three files listed |
| **`pnpm verify` (the phase exit gate)** | **PASS, exit 0** — 405 e2e passed / 69 skipped / **0 failed** (25.2 min), plus 45 PWA e2e passed / 3 skipped |

### The full-suite runs, reported honestly

The exit gate was run FOUR times. The first three results are reported here rather than only the green one, because two of them found real defects and the third found a real environment limit.

| Run | Result | What it found |
|-----|--------|---------------|
| 1 | exit 1 — 397 passed, **8 failed** | 6× the viewer clock (deviation 3: the chain destroys its own fixture), 1× the Destaques count (deviation 4), 1× `media-video.spec.ts:491` — the flake `deferred-items.md` §1 already records |
| 2 | exit 1 — 404 passed, **1 failed** | Only `feed.spec.ts:321`, the double-tap like — **verified to pass in isolation immediately afterwards** (2 passed) and newly recorded as `deferred-items.md` §4. Nothing in this plan touches the feed's like path, the gallery or `DoubleTapHeart`. `media-video.spec.ts:491` passed this time |
| 3 | exit 1 — aborted at the build stage | `No space left on device`: `.turbo/cache` had grown to 8.5 GB across the runs (deviation 5) |
| 4 | **exit 0 — 405 passed, 0 failed** | The gate, green |

**On the two documented flakes, named as the brief asked.** `media-video.spec.ts:491` failed in run 1 and passed in runs 2 and 4; it passes in isolation and `deferred-items.md` §1 records its cause (Next's dev error overlay is itself a `role="dialog"`, opened by an unrelated service-worker unhandled rejection). `platform-branding.spec.ts:130` did not fail in any of the four runs. Neither was chased.

## Issues Encountered

**The full Playwright suite is now long enough to be a resource problem, not just a time one.** Four passes filled 8.5 GB of turbo cache and exhausted the disk. `deferred-items.md` §3 already flags the suite's duration; the disk cost is worth adding to that ledger when Phase 8's hardening looks at it.

**`pnpm verify` is now the only honest way to know the suite is green**, and it takes ~30 minutes. The phase-scoped runs stay fast (the three Phase 5 specs together are 5 minutes), so the working loop is unchanged — but the exit gate is a deliberate, once-per-phase cost, which is exactly what `05-VALIDATION.md` §Sampling Rate specifies.

## Next Phase Readiness

**Phase 5 is complete.** All eight plans have summaries; STORY-01..05, COMM-01..04 and the phase's two module flags are all witnessed.

- **Phase 6 (events)** inherits a `communities` module whose page is now a full container surface — header, Destaques, posts — and a shipped picker-sheet list body whose trailing control is a prop that two different sheets already use differently.
- **Phase 7 (notifications)** inherits `story.pinned` and `story.unpinned` with ids only and TRANSITION semantics, so a subscriber counting them is counting real state changes, plus `story.liked`/`story.commented` with the recipient over-carried.
- **Phase 8 (moderation)** inherits a soft-deleted story that leaves every community's highlights at once while its pin rows remain as the record of where it had been, and a pin table whose deliberate HARD delete is documented in the schema, the migration and this summary so it is not "fixed" into a soft delete.
- **The V2 door STORY-04 leaves open:** a pin carries `pinned_by_user_id`, so "who highlighted this" is answerable the day a product surface asks.
- **Gates:** `pnpm supabase test db` at 285, `pnpm test:integration` at 472, the Playwright suite at 405, `pnpm verify` green.

## Self-Check: PASSED

All nine `key-files.created` entries exist on disk (`[ -f ]`), and all six task commits are reachable in `git log --all`: `d04a852`, `0b44f8a`, `b9366a6`, `ed592e6`, `bfe3129`, `3ebcc5b`. `git rev-list --count ad50e43..HEAD` measured **6** at SUMMARY write, from the ledger base recorded in the frontmatter. `.planning/sketches/` is untouched.
