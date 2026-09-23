---
phase: 05-communities-stories
plan: 05
subsystem: api
tags: [stories, module-package, expires-at, home-slot, publish, media, keyset, pgtap, playwright, D-78, D-79, D-80, D-81, UI-D-25, UI-D-26, UI-D-27, UI-D-28, UI-D-39, UI-D-47]

requires:
  - phase: 05-communities-stories
    provides: "05-01's proved module-package shape (five exports, one registry line, one app.ts mount); 05-02's approved sketch 003; 05-04's counter migration, which this plan's migration lands after"
  - phase: 04-feed
    provides: "packages/core/server/paging.ts (the ONE cursor envelope), feed_comments.story_id / feed_likes.story_id with their num_nonnulls CHECKs and partial unique index, the query-budget harness, the two-tenant isolation gate and the /criar composer chrome"
  - phase: 03-media-profiles
    provides: "MEDIA_LIMITS with the story purpose and its 60 s cap already in it, useSignedUpload with both the direct-PUT and the provider branches, MediaImage, FileDropZone and the worker that measures a video's duration after ingest"
  - phase: 01-foundations
    provides: "withTenantTx, tenantIsolationPolicy, requireAuth/requireModule/requirePermission, the module manifest, MODULE_REGISTRY and HomeSlots"
provides:
  - "@tria/module-stories — a real workspace package with the five-export map (./module, ./contracts, ./server, ./ui, ./db)"
  - "stories: RLS, its isolation policy, the volatile-default expires_at window, both CHECKs and the partial keyset index that serves the strip AND the admin history"
  - "feed_comments_story_fk / feed_likes_story_fk — the two Phase 4 slots, finally referential"
  - "GET /v1/stories (keyset on expires_at), GET /v1/stories/mine, GET /v1/stories/{id}, POST /v1/stories, DELETE /v1/stories/{id}"
  - "The order-5 /inicio home slot and NO navigation tab (UI-D-25, D-80)"
  - "StoryCircle / StoriesStrip — the 64x64 unit in three ring variants and the row that returns null when there is nothing to draw"
  - "/stories/publicar — the two-state full-screen publish route over the shipped signed-upload hook"
  - "story.published / story.deleted, declaration-merged into the kernel EventMap"
  - "activeReadyStoryCount + deleteStoriesByCaptionPrefix — e2e fixtures that measure the strip rather than mirror a seed constant"
affects: [05-06, 05-07, 05-08, 06-events, 07-notifications]

actuals:
  # chars/4 over the realized diff e2b16ad..HEAD (235,482 chars, lockfile and drizzle snapshot
  # excluded) at SUMMARY write — the same scale the estimate used, reported whole.
  tokens: 58871
  tasks: 3
  # MEASURED: git rev-list --count e2b16ad..HEAD was 6 at SUMMARY write (the six task commits);
  # 7 once this metadata commit lands, which is what a later `git rev-list` will read.
  commits: 7
plan_head_before: e2b16ad98db7e3f7f6a715f18c2cf0522b59581c

tech-stack:
  added: []
  patterns:
    - "A TTL as a VOLATILE COLUMN DEFAULT plus a window CHECK, because Postgres refuses the generated column outright (`timestamptz + interval` is STABLE, not IMMUTABLE)"
    - "Ordering by the column the range predicate is ON, so one partial index both filters and delivers the order — and the same index serves the unranged admin read"
    - "A presentational component whose interactive shell is chosen by the PRESENCE of a handler: no handler yet means an inert span, never a button that does nothing"
    - "An e2e that reads its expected count from the database predicate instead of mirroring a seed constant, so another spec's legitimate reset cannot make it order-dependent"

key-files:
  created:
    - packages/modules/stories/package.json
    - packages/modules/stories/tsconfig.json
    - packages/modules/stories/turbo.json
    - packages/modules/stories/vitest.config.ts
    - packages/modules/stories/module.ts
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/db/schema.ts
    - packages/modules/stories/server/index.ts
    - packages/modules/stories/server/routes.ts
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/ui/StoryCircle.tsx
    - packages/modules/stories/ui/StoriesStrip.tsx
    - packages/modules/stories/ui/index.ts
    - packages/modules/stories/tests/events.test.ts
    - packages/modules/stories/tests/stories-strip.test.tsx
    - supabase/migrations/20260923214059_stories.sql
    - apps/web/lib/stories.ts
    - apps/web/components/stories/StoriesSurface.tsx
    - apps/web/app/(app)/stories/publicar/page.tsx
    - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
    - apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx
    - apps/web/app/(app)/stories/story-actions.ts
    - apps/web/messages/pt-BR/stories.json
    - apps/api/tests/integration/stories.test.ts
    - apps/web/e2e/stories.spec.ts
  modified:
    - packages/modules/feed/db/schema.ts
    - apps/api/src/app.ts
    - apps/api/src/modules/registry.ts
    - apps/api/package.json
    - apps/web/package.json
    - apps/web/lib/registry.tsx
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/isolation.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - apps/api/tests/integration/media.test.ts
    - apps/api/tests/integration/media-playback.test.ts
    - apps/api/tests/integration/mux-webhook.test.ts
    - apps/web/e2e/admin.ts
    - apps/web/e2e/feed.spec.ts
    - supabase/tests/010-rls-coverage.sql
    - supabase/tests/020-tenant-isolation.sql
    - supabase/tests/110-communities-stories.sql
    - scripts/seed.ts

key-decisions:
  - "`feed_comments.story_id` and `feed_likes.story_id` got their foreign keys as HAND-WRITTEN SQL inside the generated migration, not as `.references(() => stories.id)`. A column-level reference needs `@tria/module-stories` in the feed's package.json, and `turbo boundaries` denies a module -> module package edge. The same resolution 05-03 reached for `feed_posts_community_fk`; the plan's two `.references(` acceptance greps are therefore unmet by construction and recorded as such."
  - "`packages/core/db/schema/index.ts` was NOT modified, for the reason 05-01 recorded: the kernel may not import a module, and `drizzle.config.ts` already globs `packages/modules/*/db/schema.ts`."
  - "`listOwnStories` is the MANAGING view of the tenant's stories, not an author filter. The plan says it is 'the SAME query with and without the range', and an author predicate would be a second shape the one index would serve badly — and would hide a co-admin's story from the person responsible for moderating it."
  - "`storySummarySchema` carries `mediaVariantWidths`, `mediaStatus` and `mediaFailureReason` beside `mediaAssetId`. The ladder is what `MediaImage` needs for `srcSet` in the SAME statement (Pitfall 11); the other two are what the history screen renders the `Processando` / `Recusado` pill from."
  - "A `StoryCircle` with no `onOpen` renders as an inert `<span>`, not a disabled button. 05-06 owns the viewer route, and shipping a tappable circle that does nothing would be a dead affordance — the 04-09 `createHref` posture."
  - "The post-pick frame sits at `z-[52]`: above the shell's `z-50` BottomNav, which really did intercept the `Publicar` tap, and below `ConfirmDialog`/`BottomSheet` at `z-[55]`, so the discard dialog still opens over it."
  - "The duration helper reads `>= 60 -> minutes`, the rule `useSignedUpload` applies to the duration REFUSAL. The approved drawing shows '60 s'; consistency with the sentence a member reads at the moment of failure won, and the approval is provisional."

patterns-established:
  - "A new NOT NULL foreign key to a widely-referenced table (`media_assets`) breaks every cleanup sweep that knew about only the previous referencing table — four of them here, in three API suites and one e2e fixture. The grep that finds them is `delete from public.media_assets`."
  - "A full-screen overlay rendered INSIDE the app shell has to name its rung of the z-ladder explicitly; `z-50` is already taken by the navigation."
  - "`revalidatePath` clears the server cache and `router.refresh()` clears the client Router Cache. A write that navigates BACK to a page the user came from needs both; a write that navigates to a new route needs neither."
  - "Adding a node to `/inicio` moves every card below it, and a gesture test whose action performs its own scroll then straddles the gesture window. Settle the position first (the 05-03 remedy, one plan later)."

requirements-completed: [STORY-01, STORY-03]

coverage:
  - id: D1
    description: "STORY-03: a story is visible for 24 h and then hidden by an expires_at predicate while the ROW IS RETAINED — no cron, no sweeper, no status transition, no job"
    requirement: STORY-03
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#19 the strip predicate returns only the story whose window is still open"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#20 the expired story is HIDDEN, never deleted — the row is retained"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#21 no column of the expired row was rewritten — expiry is a predicate, not a write"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#3. the EXPIRED story is absent from the strip, present in the history, and resolves by id"
        status: pass
      - kind: other
        ref: "grep -rhvE '^[[:space:]]*(//|\\*|/\\*|--)' packages/modules/stories/ | grep -c 'pg_cron\\|schedule(' => 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "expires_at is a plain timestamptz with the volatile default now() + interval '24 hours', NOT a generated column, and stories_expiry_window_chk stops a hand-written row inverting the window"
    requirement: STORY-03
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#22-23 the CHECK refuses an inverted window, with its positive control"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#24 the default window is exactly 24 h, derived from the same transaction timestamp"
        status: pass
      - kind: other
        ref: "cat supabase/migrations/*_stories*.sql | grep -vE '^[[:space:]]*--' | grep -c 'generated always as' => 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every strip read ORDERS BY the column it RANGES ON, served by stories_tenant_expires_idx — and the SAME index serves the admin history with the range dropped"
    requirement: STORY-03
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#27 the strip ranges AND orders on expires_at, served by stories_tenant_expires_idx BY NAME"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#28 the admin history drops the range and rides the SAME index — neither plan is a Seq Scan"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#19. the history is the SAME order as the strip, with the range simply dropped"
        status: pass
    human_judgment: false
  - id: D4
    description: "STORY-01: an admin publishes an image or a short video from a phone on a full-screen /stories/publicar route — pick, caption, publish — reusing the Phase 3 signed-upload path unchanged"
    requirement: STORY-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#an admin taps the own-circle, publishes a photo, and sees it at the head of the strip"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx#3. after a pick the screen becomes the story FRAME: object-contain media + caption + Publicar"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx#4. publishing an image sends the asset id and the caption, then leaves for /inicio"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#10. a member is refused 403; an admin publishes 201 and the story heads the strip"
        status: pass
      - kind: other
        ref: "grep -c 'createSignedUploadUrl|tus-js-client|upchunk' StoryComposer.tsx => 0 (no new upload code)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The ~60 s cap is enforced ASYNCHRONOUSLY by the existing worker: a rejected video leaves the story permanently out of the strip with its reason visible on the admin's own screens, never silently gone"
    requirement: STORY-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#14. publishing on a PROCESSING video succeeds: the row exists, the strip does not show it"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#15. …and when the worker REFUSES it for duration, it stays out of the strip with its reason"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#16. a duration EXACTLY at the cap is accepted, and the story enters the strip"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx#5. a VIDEO carries the processing note — the 24 h window starts at publish, not at ready"
        status: pass
    human_judgment: false
  - id: D6
    description: "UI-D-26: with no active story a MEMBER gets no DOM node at all and the /inicio column closes up, while an ADMIN gets the Seu story circle alone"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/stories-strip.test.tsx#1. zero stories and NO publish permission renders no DOM node at all"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/stories-strip.test.tsx#2. zero stories WITH the publish permission renders exactly one circle — the own-circle"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-78 / D-79 / UI-D-28: one circle per active story newest-first with no seen/unseen state anywhere, and the admin's leading circle is an anchor resolved from a PERMISSION, never a role"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/stories-strip.test.tsx#3. N stories plus the permission is N+1 circles, own-circle FIRST, newest-first order kept"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/stories-strip.test.tsx#8. the own variant is an anchor (never a button) and wears the Plus badge"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#a MEMBER sees the tenant's active stories and NO publish door"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#an ADMIN additionally sees the leading \"Seu story\" circle, and it is a LINK"
        status: pass
      - kind: other
        ref: "grep -c 'story_views|localStorage' over packages/modules/stories/ and apps/web/components/stories/ => 0"
        status: pass
    human_judgment: false
  - id: D8
    description: "A story whose media asset is not ready NEVER enters the strip, while the admin's own list still shows it"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#4. a story on a NON-READY asset is absent from the strip and present in the history (R-P8)"
        status: pass
    human_judgment: false
  - id: D9
    description: "TENANT-05: stories are covered by the two-tenant isolation gate on all six axes with positive controls, and every cross-tenant miss is one bare 404 with no details key"
    verification:
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (plan 85 -> 91; six new assertions on stories)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/isolation.test.ts#b3. stories: the other tenant's story id is 404 NOT_FOUND with no details (05-05)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#9. a demo session never reads a lab story by id — and the lab still can"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#11. another tenant's asset is a bare 404; an unknown id answers identically"
        status: pass
    human_judgment: false
  - id: D10
    description: "MOD-04 / UI-D-25: the module flag governs the routes and the order-5 home slot in BOTH directions, with no migration and no route edit, and the module declares no nav entry"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#20. with stories OFF every route 404s and the bootstrap carries neither slot nor permission"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#21. …and turning it back ON restores both, with no migration and no route edit"
        status: pass
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#1. every registered key equals its manifest key (tripwire now ['communities','feed','stories'] + the order-5 slot and absent nav)"
        status: pass
    human_judgment: false
  - id: D11
    description: "One page of the strip costs a bounded and NON-ZERO number of statements — the budget carries a ceiling and a floor, with media and viewerLiked hydrated in the same statement"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#costs at most 1 statement against the story tables"
        status: pass
    human_judgment: false
  - id: D12
    description: "story.published is emitted exactly once, after commit, never on rollback, and carries ids and flags only — never a caption"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/events.test.ts#1. a committed publish queues ONE event and the subscriber receives it once after flush"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/events.test.ts#2. the payload is ids and flags ONLY — the caption never leaves the row (T-05-29)"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/events.test.ts#3. a publish whose transaction throws queues NOTHING and delivers nothing (rollback)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#10. …exactly one event, after commit, ids and flags only"
        status: pass
    human_judgment: false
  - id: D13
    description: "UI-D-47: the strip keeps identical geometry on desktop inside the 680px column — no arrows, no fade masks, no grid reflow, and its horizontal overscroll is contained"
    verification:
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#the strip keeps IDENTICAL geometry on desktop — no arrows, no fade mask (UI-D-47)"
        status: pass
    human_judgment: false
  - id: D14
    description: "UI-D-39's two states drawn exactly as the approved sketch fixes them, at the real geometry and in both themes — the neutral pre-pick screen, the black post-pick frame, the three loading skeletons and the transparent caption overlay"
    verification:
      - kind: unit
        ref: "packages/modules/stories/tests/stories-strip.test.tsx#4. loading draws three skeleton circles and no listitem"
        status: pass
    human_judgment: true
    rationale: "The structural claims are asserted (the two states, the object-contain frame, the counter, the skeletons at the real geometry), but 'it looks like the drawing' is a visual judgement no assertion makes: the ring weights, the scrim gradient, the 12/400 label and the dark-theme rendering need a human eye at end-of-phase verification. The design approval on sketch 003 is also provisional (product owner, not designer), so a later designer delta is a polish pass rather than a regression."

duration: 91min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 05: The Stories Module and STORY-01's Publish Flow Summary

**`@tria/module-stories` shipped end to end — a 24 h broadcast whose expiry is a read predicate rather than a job, a strip that both ranges and orders on one index, an order-5 `/inicio` slot that renders nothing at all for a member with nothing live, and a full-screen publish route that reuses the Phase 3 upload machine without writing a byte of new media code.**

## Performance

- **Duration:** 91 min
- **Started:** 2026-09-23T21:31Z
- **Completed:** 2026-09-23T23:02Z
- **Tasks:** 3 of 3
- **Files modified:** 46

## Accomplishments

- **STORY-03 is a fact inside Postgres, proved under a clock the test controls.** Two stories, one published 25 hours ago and one an hour ago, inside a single transaction whose `now()` is fixed: the strip predicate returns exactly the active one, the expired ROW is still selectable by id, and a third assertion proves no column of it was rewritten. There is no job, no sweeper, no status transition and no cascade anywhere in the module — `grep -c 'pg_cron\|schedule('` over the whole package prints 0.
- **`expires_at` is a volatile default and the migration header says why.** The tempting `generated always as (published_at + interval '24 hours') stored` is refused by Postgres outright (`timestamptz + interval` is STABLE, not IMMUTABLE); a column default may be volatile, and `now()` is the transaction timestamp, so both stamps derive from one instant. `stories_expiry_window_chk` supplies the invariant the generated column would have given for free, and pgTAP asserts the refusal with its positive control.
- **One partial index serves two reads, pinned by name in an EXPLAIN pair.** The strip ranges on `expires_at` and orders on it; D-84's history drops the range and rides the same structure. Both plans are asserted to contain `stories_tenant_expires_idx` and neither to contain `Seq Scan on stories`, on a 400-row fixture the file builds and `analyze`s itself.
- **The two Phase 4 slots are referential at last.** `feed_comments.story_id` and `feed_likes.story_id`, reserved in Phase 4 with their `num_nonnulls` CHECKs and docblocked as Phase 5's inheritance, now carry real foreign keys — as hand-written SQL, because a drizzle `.references()` needs a `module -> module` package edge `turbo boundaries` denies.
- **The strip's empty state is an absence, and that is asserted as one.** A member with no active story gets NO DOM node: `expect(container).toBeEmptyDOMElement()`. An admin gets the own-circle alone, because it is the only publish door. There is no seen/unseen state, no read marker and no `localStorage` anywhere in the module — the phase's prohibition, held structurally.
- **STORY-01 works on a phone, in a real browser, against the real pipeline.** An admin taps the own-circle, lands on `/stories/publicar`, picks a real JPEG, types a caption, publishes, and the new circle appears at the head of the strip once the worker has derived its ladder — then the spec removes what it wrote so the shared seed is found as it was left.
- **The asynchronous duration refusal is exercised through the REAL worker.** A story is published on a still-`processing` video; `mediaProviderEventJob` then measures a duration one second over the cap, flips the asset to `rejected`/`duration_too_long` and deletes the provider asset; the story stays permanently out of the strip while the admin's own list shows it with the machine code the `media` catalog already has copy for. The exactly-at-cap case is the positive control.
- **The full Playwright suite is green** — 369 passed, 59 skipped, 0 failed — including the two specs `deferred-items.md` had recorded as flaky under full-suite parallelism.

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 (RED) | The failing strip test + the signature-only skeletons | `e29c1e8` | `packages/modules/stories/{package.json,tsconfig.json,turbo.json,vitest.config.ts,ui/**,tests/stories-strip.test.tsx}` |
| 1 (GREEN) | The module: schema, service, routes, manifest, registry, strip, web wiring, catalog | `2d327a0` | `packages/modules/stories/**`, `apps/api/src/{app,modules/registry}.ts`, `apps/web/{lib/{stories.ts,registry.tsx},components/stories/,messages/pt-BR/stories.json}` |
| 2 | Migration + the two hand-written FKs + STORY-03 under a controlled clock + the seed | `f6e78b7` | `supabase/migrations/20260923214059_stories.sql`, `supabase/tests/{010,020,110}*.sql`, `scripts/seed.ts` |
| 3 (RED) | The failing publish-screen test + the suites that pin STORY-01 | `f82e8a0` | `apps/web/app/(app)/stories/publicar/StoryComposer.{tsx,test.tsx}`, `apps/api/tests/integration/{stories,isolation,feed-query-budget,media,media-playback,mux-webhook}.test.ts`, `packages/modules/stories/tests/events.test.ts`, `apps/web/e2e/stories.spec.ts` |
| 3 (GREEN) | The publish flow and the three defects the tests caught | `50cf06e` | `apps/web/app/(app)/stories/**`, `apps/web/lib/stories.ts`, `apps/web/e2e/{stories,feed}.spec.ts` |
| 3 (GREEN, cont.) | The second FK collision, and a strip count that is measured rather than mirrored | `e1f5bd8` | `apps/web/e2e/{admin.ts,stories.spec.ts}` |

## TDD Gate Compliance

Both TDD-marked tasks ran a full RED → GREEN cycle with machine-verified evidence.

| Task | Gate | Commit | Status |
|------|------|--------|--------|
| 1 | RED | `e29c1e8` `test(05-05)` | Pass — `check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| 1 | GREEN | `2d327a0` `feat(05-05)` | Pass — 8/8 strip cases |
| 1 | REFACTOR | — | Not performed; no cleanup was warranted |
| 3 | RED | `f82e8a0` `test(05-05)` | Pass — `check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| 3 | GREEN | `50cf06e` `feat(05-05)` | Pass — 6/6 composer cases, 21/21 integration, 11 e2e |
| 3 | REFACTOR | — | Not performed; the three fixes in `50cf06e` repaired defects rather than cleaning up |

**Task 1 RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run --reporter=tap-flat` (cwd `packages/modules/stories`)
- **Exit code:** 1 — 8 tests, 0 pass, 8 fail
- **Target test:** `tests/stories-strip.test.tsx > StoriesStrip — the /inicio home slot (UI-D-25..UI-D-28, D-78) > 1. zero stories and NO publish permission renders no DOM node at all (UI-D-26)`
- **Expected:** UI-D-26 — a member with no active story gets NO DOM node at all; the container renders empty and the `/inicio` column closes up
- **Actual:** `expect(element).toBeEmptyDOMElement()` received `"<div></div>"` — the RED skeleton renders an unconditional node

**Task 3 RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run "app/(app)/stories/publicar/StoryComposer.test.tsx" --reporter=tap-flat` (cwd `apps/web`)
- **Exit code:** 1 — 6 tests, 0 pass, 6 fail
- **Target test:** `app/(app)/stories/publicar/StoryComposer.test.tsx > StoryComposer — the two-state publish screen (UI-D-39, D-81) > 1. before a pick: both pickers, the duration helper, and NO Publicar control at all`
- **Expected:** UI empty/E07 — before a pick the screen offers both picker rows and the interpolated duration helper, and no `Publicar` control exists at all
- **Actual:** `TestingLibraryElementError: Unable to find an element with the text: Escolher foto` — the RED skeleton renders an empty div

**Note on the TAP normalizer** (a standing environment fact, not a plan artifact, and the same one 05-01 recorded). `check tdd-red-evidence` parses a `node --test` TAP summary; Vitest never emits `# tests` / `# pass` / `# fail`. Both records were built from the REAL captured runs: Vitest's own `tap-flat` reporter supplied the `ok` / `not ok` lines verbatim, and a throwaway script DERIVED the three summary lines by counting them. No count was typed by hand and nothing was fabricated.

**One RED phase had to be repaired before it counted** (fail-fast rule 2, working as designed). Task 3's first run returned `fixture_or_load_failure`: the test imported `@testing-library/jest-dom/vitest`, which `apps/web` does not depend on, so the module loader — not an assertion — was what failed. Dropping the import (the existing web tests use plain matchers) turned it into a real RED. No production code was written between the invalid run and the valid one.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] The two Phase 4 foreign keys are hand-written SQL, not `.references()`**

- **Found during:** Task 1, before any edit (the plan's `<action>` names the mechanism explicitly)
- **Issue:** The plan says to give `feedComments.storyId` and `feedLikes.storyId` their real `.references(() => stories.id)`, and lists `packages/modules/feed/package.json` among the files to modify. That requires `"@tria/module-stories": "workspace:*"` in the feed package, and `turbo.json`'s `"module": { "dependencies": { "allow": ["kernel", "contracts", "tooling"] } }` denies a `module -> module` package edge. 05-03 verified this empirically for the identical shape and `packages/boundary-fixture` exists to prove the rule bites. The plan's acceptance criteria therefore ask for two mutually exclusive facts: the references present AND `pnpm boundaries` exit 0.
- **Fix:** The architectural invariant won. `feed_comments_story_fk` and `feed_likes_story_fk` are declared in `supabase/migrations/20260923214059_stories.sql` as hand-written SQL appended to the generated half, with a header stating why and recording that both validations are trivial today (every `story_id` is NULL) while 05-07's migration on the same tables will not be. The feed's schema docblocks were updated at all three sites so a reviewer reading the TS finds the constraint named and explained.
- **Files modified:** `packages/modules/feed/db/schema.ts` (docblocks only), `supabase/migrations/20260923214059_stories.sql`
- **Verification:** both constraints exist in `pg_constraint`; `110-communities-stories.sql` asserts each in both directions (a 23503 for an orphan, a positive control for a real story); `pnpm db:generate` is a no-op; `pnpm boundaries` green (527 files, 9 packages); `pnpm boundaries:negative` green.
- **Unmet acceptance criteria (recorded, not skipped):** `packages/modules/feed/db/schema.ts` contains no new `.references(` calls resolving to `stories`, and `packages/modules/feed/package.json` does not contain `"@tria/module-stories"`. Both are the direct consequence of this fix, and the `must_haves` truth they served — "`feed_comments.story_id` and `feed_likes.story_id` … gain their real foreign keys to `stories.id` in this plan" — is satisfied.
- **Commit:** `2d327a0`, `f6e78b7`

**2. [Rule 3 - Blocker] `packages/core/db/schema/index.ts` was NOT modified**

- **Found during:** Task 1
- **Issue:** The plan says to re-export `stories` from the kernel's schema barrel. That would make the KERNEL import a MODULE, which `turbo boundaries` denies — the same false premise 05-01 recorded and correctly declined.
- **Fix:** Skipped. It is also unnecessary: `apps/api/drizzle.config.ts` already globs `packages/modules/*/db/schema.ts`, and `010-rls-coverage.sql` reads the pg catalogue rather than a TS barrel (its presence list did gain `('stories')`, which is the honest place for it — the table's two foreign keys live outside the TS schema, so nothing in TypeScript would notice if it stopped being created).
- **Files modified:** none (the file was left untouched); `supabase/tests/010-rls-coverage.sql` instead
- **Commit:** `2d327a0`, `f6e78b7`

**3. [Rule 3 - Blocker] `apps/api/src/app.ts` gained the `/v1/stories` mount**

- **Found during:** Task 1
- **Issue:** The plan's `<files>` list omits `app.ts`, but routes are mounted EAGERLY there for the chained `AppType` (the manifest's `routes` is a lazy import the worker reads). Without it none of the five endpoints would exist. The identical omission 05-01 recorded.
- **Fix:** Added the import and `.route('/v1/stories', storiesRoutes)` with a docblock mirroring the communities mount's.
- **Verification:** `pnpm test:integration -- stories` — 21/21 against live routes.
- **Commit:** `2d327a0`

**4. [Rule 1 - Bug] The new NOT NULL foreign key broke four cleanup sweeps**

- **Found during:** Task 3, the first full integration run and then the first full e2e run
- **Issue:** `stories.media_asset_id` references `media_assets`, and four sweeps hard-delete assets while knowing about only the previous referencing table (`feed_post_media`). Three API suites died in `beforeAll` with `update or delete on table "media_assets" violates foreign key constraint "stories_media_asset_id_media_assets_id_fk"`, taking 67 of their own tests with them; `apps/web/e2e/admin.ts`'s `deleteTenantVideoAssets` did the same to `media-video.spec.ts` and `phase3-smoke.spec.ts`, in isolation as well as in the suite.
- **Fix:** `media.test.ts`, `media-playback.test.ts` and `mux-webhook.test.ts` now exclude `(select media_asset_id from public.stories)` for exactly the reason their own comments already gave for `feed_post_media`. `deleteTenantVideoAssets` is different: it is documented as a HARD, TOTAL reset, and the admin media library lists every `kind = 'video'` asset regardless of purpose — so leaving a story's video behind would break the empty-library assertion instead. It therefore deletes the naming stories first. `stories.media_asset_id` is NOT NULL, so there is no detach available; the story goes with the asset, exactly as the seeded video POST already does.
- **Files modified:** `apps/api/tests/integration/{media,media-playback,mux-webhook}.test.ts`, `apps/web/e2e/admin.ts`
- **Verification:** `pnpm test:integration` — 29 files, 431/431; `playwright test media-video.spec.ts phase3-smoke.spec.ts stories.spec.ts` — 48 passed.
- **Commits:** `f82e8a0`, `e1f5bd8`

**5. [Rule 1 - Bug] The shell's BottomNav intercepted the `Publicar` tap**

- **Found during:** Task 3, the first e2e run of the publish round trip
- **Issue:** The post-pick frame was `fixed inset-0 z-50`, the same rung the shell's floating `BottomNav` occupies. Playwright reported `<span …> from <nav data-shell-nav="bottom"> subtree intercepts pointer events` and retried for 30 s. A member on a phone would have had the same experience with no error message.
- **Fix:** The frame moved to `z-[52]` — above the nav, below `ConfirmDialog` / `BottomSheet` at `z-[55]`, so the discard dialog still opens over it. The class is hoisted to a named constant with the ladder spelled out, because the number is a decision rather than a value.
- **Commit:** `50cf06e`

**6. [Rule 1 - Bug] The admin landed back on the strip they had just left**

- **Found during:** Task 3, the same e2e run
- **Issue:** `publishStoryAction` calls `revalidatePath('/inicio')`, which clears the SERVER cache. The client Router Cache still held the `/inicio` payload the admin navigated away from, so `router.push('/inicio')` re-rendered it without their own story. The composer never hit this because it navigates to `/post/{id}`, a route that did not exist yet.
- **Fix:** `router.refresh()` after the push, with a docblock saying which cache each one clears and why neither is redundant.
- **Commit:** `50cf06e`

**7. [Rule 1 - Bug] The strip moved a card into a gesture window in `feed.spec.ts`**

- **Found during:** Task 3, the four-spec regression batch
- **Issue:** `a double tap on the gallery likes exactly ONCE, not twice` failed reproducibly. `DoubleTapHeart` counts two `pointerup`s on the same wrapper inside 300 ms; `dblclick` scrolls its target into view as part of the action, and with the strip added above the feed the card starts below the fold on desktop, so the scroll landed inside the gesture window and the second tap missed.
- **Proved causal rather than assumed:** the identical batch passes with `stories` disabled for the demo tenant (71 passed, twice) and fails with it enabled (three times). The spec passes alone in both configurations, which is why a single run would have read as flakiness.
- **Fix:** the spec settles the position before the gesture (`scrollIntoViewIfNeeded` + `toBeInViewport`), the 05-03 remedy for the same class of move. Strictly outside this plan's files; fixed rather than deferred because this plan's diff is what moved the card.
- **Commit:** `50cf06e`

**8. [Rule 1 - Bug] The stories e2e mirrored a seed constant another spec may legitimately change**

- **Found during:** Task 3, while fixing deviation 4
- **Issue:** `deleteTenantVideoAssets` now removes the demo tenant's seeded story VIDEO along with its asset. A spec that mirrored "3 active stories" would then pass or fail depending on whether `media-video.spec.ts` had run first — the one thing an e2e must never measure. This is exactly the failure mode 05-04 recorded ("a seed fixture added for a NEW state must be checked against every existing fixture SELECTION").
- **Fix:** `activeReadyStoryCount(tenantSlug)` reads the `listActiveStories` predicate from the database once per file, guarded by `expect(count).toBeGreaterThan(0)` so it cannot pass vacuously at zero. `pnpm db:seed` restores the removed fixture (`on conflict (id) do nothing` re-inserts a row that was deleted rather than mutated).
- **Commit:** `e1f5bd8`

### Additions beyond the plan's literal wording

- **`storySummarySchema.mediaVariantWidths` / `mediaStatus` / `mediaFailureReason`.** The plan's field list stops at `mediaAssetId`. The ladder is what `MediaImage` needs for `srcSet` in the SAME statement the query-budget truth requires; the other two are what makes Pitfall 5's "the rejection is visible on the admin's own screens" assertable at the HTTP surface rather than only in the database.
- **`GET /v1/stories/{storyId}`.** The plan's route list has four entries. The detail read is what 05-06's viewer opens from the history and what the isolation gate's by-id case needs; without it the cross-tenant 404 could only be asserted on a list, which is a weaker claim.
- **`durationLabel` mirrors `useSignedUpload`'s formatter.** The approved drawing shows "Vídeo de até 60 s."; the shipped refusal for the same cap says "1 min". One of the two had to give, and consistency with the sentence a member reads at the moment of failure won. Recorded as a provisional-approval delta rather than a silent change.
- **`activeReadyStoryCount` / `deleteStoriesByCaptionPrefix` in `e2e/admin.ts`.** See deviations 4 and 8.

**Unmet acceptance grep (recorded, not skipped):** `grep -vE "^[[:space:]]*(//|\*|/\*)" StoryComposer.tsx | grep -c "maxBytes\|maxDurationSeconds"` prints 1, not 0. The single occurrence is `MEDIA_LIMITS.video.story?.maxDurationSeconds ?? 0` — a READ of the contract's cap, which is what the criterion's own words ask for ("the caps are read, never redeclared"); the grep is over-broad because reading a field necessarily names it. `@tria/contracts/media` exports no accessor that would avoid it. The underlying truth holds and is independently provable: there is no numeric cap literal anywhere in the file, and the unit test derives its expected string from `MEDIA_LIMITS` too, so a cap change moves both sides or fails.

**Total deviations:** 8 auto-fixed (5× Rule 1 bugs, 3× Rule 3 blockers) plus 4 documented additions and 3 recorded unmet greps. **Impact:** net positive — four of the five Rule 1 fixes repaired real defects that a member or an admin would have hit (a dead `Publicar` button, a stale home screen, and two suites that could not start), and the fifth removed an order dependency before it could become one.

## Authentication Gates

None. Everything ran against the local Supabase stack, which was already healthy — both preconditions (the design gate and the applied migrations) were verified read-only before their tasks began.

## Known Stubs

Two, both deliberate seams for later plans in this phase, and both recorded in `.planning/WINDOWS.md`:

1. **`apps/web/components/stories/StoriesSurface.tsx` binds no `onOpen`.** 05-06 owns `/stories/[storyId]`; until it exists a circle renders as an inert `<span>` rather than as a button that does nothing when tapped (the 04-09 `createHref` posture — the affordance stays absent so nothing links to a 404). `StoryCircle` already accepts the handler and becomes a `<button>` the moment one is passed, so 05-06's change is one prop at the composition point.
2. **The publish header's "Seus stories" action points at `/stories/meus`,** a route 05-08 creates. It is the one inert link on that screen. Rendering it now rather than adding it later is deliberate: a text action that appeared only once its destination existed would be a second thing for 05-08 to remember.

`GET /v1/stories/mine` and `DELETE /v1/stories/{id}` are shipped, guarded, tested and currently have no UI — that is not a stub but 05-08's inheritance, exactly as `communities.post_count` was 05-03's.

`like_count` and `comment_count` sit at `0` until 05-07 installs the counter triggers. Not a stub either: the schema docblock declares both trigger-owned, no application statement writes them, and `0` is the correct answer for a story nobody has touched.

## Threat Flags

None. Every file this plan touched sits inside the threat model the plan registered: the five new routes are T-05-25..T-05-32's own surface, thumbnails render through the existing `/v1/media/{assetId}/{variant}` broker so no signed Storage URL enters a payload (T-05-27), and the `story.published` payload is asserted to be five ids and flags with the caption asserted absent twice over (T-05-29).

Per **T-05-SC, zero external packages were installed** — `pnpm install` only linked the new workspace package, and `pnpm-lock.yaml`'s only change is that link.

One boundary worth naming for the record, since it is new: `apps/web/e2e/admin.ts` gained a superuser helper that deletes rows by caption prefix. It is test-only, lives in the e2e fixtures beside eleven others of the same kind, and is unreachable from application code.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @tria/module-stories typecheck` | pass |
| `pnpm --filter @tria/module-stories lint` | pass (15 files) |
| `pnpm --filter @tria/module-stories test` | pass — 15/15 |
| `pnpm --filter @tria/module-feed typecheck && lint` | pass |
| `pnpm --filter @tria/api typecheck && lint` | pass (61 files) |
| `pnpm --filter @tria/web typecheck && lint` | pass (251 files) |
| `pnpm turbo run test` (all packages) | pass — 7 tasks, 560 tests |
| `pnpm db:generate` against the committed migration | no-op ("No schema changes") |
| `pnpm db:reset && pnpm db:seed` | pass — 5 stories per tenant (3 active, 1 expired, 1 on a processing asset) |
| `pnpm supabase test db` | pass — 12 files, **245 tests**, `Result: PASS` (was 207) |
| `pnpm test:integration` | pass — 29 files, **431/431** |
| `pnpm test:integration -- stories` | pass — 21/21 |
| `pnpm --filter @tria/web exec playwright test stories.spec.ts` | pass — 11 passed, 1 skipped |
| `pnpm --filter @tria/web exec playwright test` (whole suite) | pass — **369 passed, 59 skipped, 0 failed** (21.3 min) |
| `pnpm boundaries` | pass — 527 files, 9 packages, no issues |
| `pnpm boundaries:negative` | pass — both layers reject the fixture |
| `bash scripts/check-ui-literals.sh` | pass |
| `bash scripts/check-static-routes.sh` | pass — 36 guarded routes, 0 offenders |

## Issues Encountered

None outstanding. Two environment facts worth carrying forward:

- **A synthesised 1×1 PNG is not a usable upload fixture.** The variant worker decodes with sharp and fails on it (`vipspng: libpng read error`), leaving the asset `processing` forever — at which point R-P8 correctly keeps the story out of the strip and the publish flow looks broken. Use `e2e/fixtures/post-a.jpg`, the real photo the shipped media specs upload.
- **An e2e that publishes an image needs `ensureWorker()`.** Variant derivation runs in the worker role, not the API, and the Playwright config starts only the API and the web app.

The two flaky cases `deferred-items.md` records (`media-video.spec.ts:491`, `platform-branding.spec.ts:130`) passed in this plan's full-suite run; nothing here fixes their underlying cause (the service-worker `registration?.waiting` rejection that opens Next's error overlay), so they stay recorded.

## Next Phase Readiness

Ready for the remaining Phase 5 plans:

- **05-06 (the viewer)** inherits `StoryCircle`'s `onOpen` seam, `StoriesSurface` as the client shell to bind it in, `GET /v1/stories/{storyId}` for a single-item sequence, and `STORY_DURATION_MS = 5000` in the contracts.
- **05-07 (STORY-05's comments and likes)** inherits both foreign keys, `storySummarySchema.viewerLiked` already projected in one statement, and the `like_count` / `comment_count` columns declared trigger-owned and awaiting their functions. Its migration on `feed_comments` / `feed_likes` will NOT have this plan's trivial validation — the header of `*_stories.sql` says so.
- **05-08 (the history and the pins)** inherits `GET /v1/stories/mine` with `mediaStatus` / `mediaFailureReason` already on the payload, `DELETE /v1/stories/{id}`, `STORY_PERMISSIONS.manage`, the neutral `StoryCircle` ring variant for the Destaques row, and the `/stories/meus` link that already points at it.
- **Seed and gates:** both tenants carry five stories in the three states every later plan needs; `pnpm supabase test db` is at 245 assertions and `pnpm test:integration` at 431.

## Self-Check: PASSED

All 20 sampled `key-files` entries exist on disk (`[ -f ]`), and all six task commits are reachable in `git log --all`: `e29c1e8`, `2d327a0`, `f6e78b7`, `f82e8a0`, `50cf06e`, `e1f5bd8`.
