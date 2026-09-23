---
phase: 04-feed
plan: 06
subsystem: ui
tags: [feed, infinite-scroll, pull-to-refresh, optimistic-ui, like, server-actions, next-intl, playwright]

requires:
  - phase: 04-feed (04-01)
    provides: the feed tracer, FeedList/PostCard, apps/web/lib/feed.ts and the home-slot registry entry
  - phase: 04-feed (04-02)
    provides: InfiniteScroll/useInfiniteScroll, PullToRefresh/usePullToRefresh, DoubleTapHeart, the --color-like token
  - phase: 04-feed (04-03)
    provides: POST/DELETE /v1/feed/posts/{id}/like, the trigger-owned counters and the viewerLiked join
  - phase: 04-feed (04-04)
    provides: PostMedia with its onDoubleTapLike seam and the injected VideoPlayer element
  - phase: 04-feed (04-05)
    provides: the link-preview card under the media band
  - phase: 03-profiles (03-05)
    provides: the MembersList/loadMoreMembersAction pagination pattern this widget copies
provides:
  - "buildPostMeta + formatCountLabel: the pure meta-row builder that drops zero counts and abbreviates past a thousand"
  - "LikeButton + useOptimisticLike: the 44x44 like control and the one-request-in-flight optimistic engine"
  - "PostActions: the three-control action row"
  - "PostCard: header + media + caption + the action-and-meta row, with tap and double-tap on ONE toggle"
  - "FeedList: the four-state home-slot widget with pull-to-refresh and the infinite-scroll sentinel"
  - "loadMoreFeedAction / refreshFeedAction / likePostAction / unlikePostAction"
  - "likePost / unlikePost in apps/web/lib/feed.ts"
  - "apps/web/lib/feed-view.tsx: the ONE FeedPost -> PostCardView mapping shared by page 1 and every page after it"
  - "the e2e that drives a real double tap, a real pull gesture and two intercepted failures"
  - "seed fixtures: 18 filler posts per tenant, an edited post, a 40-character member and the post they authored"
affects: [04-07 comments, 04-08 share, 04-09 composer, 05-communities, 07-realtime]

actuals:
  tokens: 39971
  tasks: 3
  commits: 4

plan_head_before: 29e97d2220daf14027b9a4d56215f83b99a83c45

tech-stack:
  added: []
  patterns:
    - "Optimistic engine as a HOOK, not component state: useOptimisticLike is called by the card so the button, the double tap and the meta-row count read one truth"
    - "A count template crosses the module boundary as DATA: the catalog is read with next-intl's t.raw() and the module fills {count} with an Intl-formatted number for the host's locale, so the module still ships no words"
    - "One view mapper (apps/web/lib/feed-view.tsx) shared by the server-rendered page and the load-more server action — the D-58 single-fetch rule extended to the MAPPING"
    - "A sentinel retry re-arms the observer instead of fetching itself: re-enabling rebuilds the IntersectionObserver, which fires for an already-intersecting target"

key-files:
  created:
    - packages/modules/feed/ui/meta.ts
    - packages/modules/feed/ui/LikeButton.tsx
    - packages/modules/feed/ui/PostActions.tsx
    - packages/modules/feed/tests/meta.test.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/app/(app)/inicio/feed-actions.ts
    - apps/web/e2e/feed-admin.ts
  modified:
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/feed/ui/PostCard.tsx
    - packages/modules/feed/ui/PostHeader.tsx
    - packages/modules/feed/ui/index.ts
    - apps/web/lib/feed.ts
    - apps/web/lib/registry.tsx
    - apps/web/messages/pt-BR/feed.json
    - apps/web/e2e/feed.spec.ts
    - apps/web/e2e/fixtures.ts
    - apps/web/e2e/shell.spec.ts
    - scripts/seed.ts

key-decisions:
  - "No client data-cache library: Phase 3's server-action pagination stays the one paging paradigm (the plan's own decision, recorded rather than made silently)"
  - "The view mapper moved out of lib/registry.tsx into lib/feed-view.tsx so the home slot and the load-more action share ONE mapping without a registry <-> actions import cycle"
  - "Count copy crosses as a {count} TEMPLATE read with t.raw(), not an interpolated string: the optimistic count changes without a round trip, so the placeholder has to survive the catalog lookup"
  - "The >999 meta-row backstop is pinned as a STRING by a unit test, not by a seeded post: pgTAP reconciles every post's like_count against its live feed_likes rows, so a four-digit fixture would need 1000+ auth users or a hand-written counter that turns that assertion red"
  - "The sentinel retry only re-arms the observer — calling loadMore() as well loaded two pages per tap (caught by the e2e)"

patterns-established:
  - "Meta row as data: buildPostMeta returns SEGMENTS and the component supplies the aria-hidden separator, so a leading/trailing/doubled middot is structurally impossible"
  - "A rejected server action and a refused one are the same outcome in the widget: both set the failure state, because a dead network must not spin the sentinel forever"
  - "e2e copy is read from apps/web/messages/pt-BR/*.json with an import attribute, never inlined as a pt-BR literal"

requirements-completed: [FEED-02, FEED-04, UI-02]

coverage:
  - id: D1
    description: "buildPostMeta drops zero counts and never emits an empty segment across the full zero/one/many cross-product (UI-D-21)"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/meta.test.ts#buildPostMeta (UI-D-21: the 18-case zero/one/many cross-product)"
        status: pass
    human_judgment: false
  - id: D2
    description: "formatCountLabel returns null at zero, picks the singular at one and abbreviates past a thousand for the reader's locale"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/meta.test.ts#formatCountLabel (UI-D-21: a count below 1 has no segment at all)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The infinite-scroll sentinel appends exactly one page per intersection, stops at the last page and never duplicates a row"
    requirement: FEED-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#the sentinel appends one page per intersection and then stops"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pull-to-refresh re-reads page 1 through the same fetch implementation and replaces the list without showing skeletons"
    requirement: FEED-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#pull-to-refresh re-reads page 1 and replaces the list"
        status: pass
    human_judgment: false
  - id: D5
    description: "A failed page keeps every loaded card and offers an inline retry at the sentinel"
    requirement: FEED-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#a failed page keeps every loaded card and offers a retry at the sentinel"
        status: pass
    human_judgment: false
  - id: D6
    description: "A tap likes optimistically and the server's count is what stays; a second tap unlikes"
    requirement: FEED-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#a tap fills the heart and adds the count; a second tap takes both away"
        status: pass
    human_judgment: false
  - id: D7
    description: "A double tap on the gallery likes exactly ONCE — one row, one count, confirmed by a reload"
    requirement: FEED-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#a double tap on the gallery likes exactly ONCE, not twice"
        status: pass
    human_judgment: false
  - id: D8
    description: "A failed like reverts, raises the generic toast and never removes the card"
    requirement: FEED-04
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#a failed like reverts, toasts, and never removes the card"
        status: pass
    human_judgment: false
  - id: D9
    description: "The edited marker follows the relative time with no date of its own, and the meta row does not clip at 320px"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#the edited marker follows the time, and the row stays inside a 320px viewport"
        status: pass
    human_judgment: false
  - id: D10
    description: "A 40-character display name truncates beside the avatar in the post header at 320px"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#a 40-character display name truncates beside the avatar"
        status: pass
    human_judgment: false
  - id: D11
    description: "A community with nothing published renders the feed's OWN empty card (member and admin copy differ) and never the kernel Em breve placeholder (UI-D-20)"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#a member reads the feed OWN empty card, not the kernel \"Em breve\" placeholder"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed.spec.ts#the admin of the same community reads the author variant of the copy"
        status: pass
    human_judgment: false
  - id: D12
    description: "Four validated server actions that go through lib/feed.ts, return a catalog key and call redirect() outside the catch"
    requirement: FEED-02
    verification:
      - kind: integration
        ref: "pnpm --filter @tria/web build && bash scripts/check-static-routes.sh && pnpm boundaries"
        status: pass
    human_judgment: false
  - id: D13
    description: "The action row, the meta row and the like affordance match the UI-SPEC's visual contract (44x44 geometry, the -ml-2.5 optical offset, the like token, the 12px tabular-nums meta row) on a real phone"
    requirement: UI-02
    verification: []
    human_judgment: true
    rationale: "Geometry, optical alignment and colour are judged by eye; the e2e proves behaviour and the presence of the tokens, not that the row LOOKS like the prototype."
  - id: D14
    description: "The meta row with counts above 999 plus the edited marker stays readable at 320px (UI-SPEC E02 overflow/long-text backstops)"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/meta.test.ts#abbreviates a count past a thousand, so a 12px row cannot be blown open by a big number"
        status: pass
    human_judgment: true
    rationale: "Only the abbreviated STRING is pinned. The pixels were never rendered: pgTAP reconciles every post's like_count against its live feed_likes rows, so a >999 seeded fixture would need 1000+ auth users. Recorded as WINDOWS 24."

duration: 82min
completed: 2026-09-23
status: complete
---

# Phase 04 Plan 06: The feed as a member actually uses it — Summary

**Infinite scroll, pull-to-refresh, an optimistic like that reverts cleanly and a gallery double tap that likes exactly once, all riding the one fetch implementation and four validated server actions.**

## Performance

- **Duration:** 82 min
- **Started:** 2026-09-23T00:25:00Z
- **Completed:** 2026-09-23T01:47:00Z
- **Tasks:** 3 of 3
- **Files modified:** 18 (7 created, 11 modified)

## Accomplishments

- **The card became the prototype's card.** `PostCard` now composes header, media, caption and the action-and-meta row: three fixed 44x44 controls on the left (`-ml-2.5`, glyph 20), the 12px `tabular-nums` meta row on the right, joined by `aria-hidden` middots. `PostHeader` gained the overflow control, rendered only when the host passes a handler (04-09 owns the menu).
- **The meta row is data, not JSX conditionals.** `buildPostMeta` returns the present segments in order and `formatCountLabel` returns `null` at zero, so a brand-new post shows its time alone (UI-D-21) and a stray middot is structurally impossible — the component only ever puts a separator *between* two segments it has. 18-case cross-product test.
- **One toggle, three entry points.** `useOptimisticLike` holds the state the like button flips, the gallery double tap triggers and the meta-row count prints. One request in flight, the server's `{ liked, likeCount }` replaces the optimistic pair on response, a rejection restores exactly what was on screen and raises the generic toast — the card is never removed.
- **`FeedList` became the four-state widget.** Pull-to-refresh replaces page 1, the sentinel appends, a refused page keeps every loaded card and offers a retry at the sentinel, the two empty variants and the first-load error are the rest. Every string is still a prop; the module reads no catalog.
- **One mapping for every page.** `apps/web/lib/feed-view.tsx` turns `FeedPost` into `PostCardView` for both the server-rendered first page and the load-more server action, so the time zone, the injected `VideoPlayer` element and the profile route cannot drift between page 1 and page 2.
- **A real mobile browser proves it.** 26 e2e cases across the two projects: three real pages walked by the sentinel, a synthesised touch pull, a `dblclick` on the gallery strip, two intercepted server-action failures, the 320px overflow and truncation backstops, and both empty-state variants against a throwaway tenant with nothing published.
- **The assigned deferred item is closed.** `shell.spec.ts`'s tria-lab case now asserts the registered feed slot instead of the `Em breve` placeholder.

## Task Commits

1. **Task 1 (RED): the failing 18-case meta-row cross-product** — `823a853` (test)
2. **Task 1 (GREEN): the action row, the optimistic like and the meta-row builder** — `ad8ebd8` (feat)
3. **Task 2: the paging widget, the four server actions and the home-slot wiring** — `13d6cfe` (feat)
4. **Task 3: drive the real interactions on a mobile browser** — `dd0987f` (test)

No REFACTOR commit: the GREEN implementation of `meta.ts` was already the shape the test described, and a refactor commit with no change is noise.

## Files Created/Modified

- `packages/modules/feed/ui/meta.ts` — `buildPostMeta` (segments, no React, no separator) and `formatCountLabel` (null at zero, compact past a thousand, `Intl.PluralRules` on the original count)
- `packages/modules/feed/ui/LikeButton.tsx` — the controlled 44x44 heart (`aria-pressed`, `text-like [&_svg]:fill-like`, a pulse that stands down under reduced motion, a polite `sr-only` live region) and `useOptimisticLike`
- `packages/modules/feed/ui/PostActions.tsx` — the three-control row, no fourth
- `packages/modules/feed/ui/PostCard.tsx` — now a client component: owns the optimistic state, wires `PostMedia`'s double tap to the same toggle, renders the meta row and makes the comment segment the control that opens the sheet
- `packages/modules/feed/ui/PostHeader.tsx` — the optional overflow control
- `packages/modules/feed/ui/FeedList.tsx` — the widget: `PullToRefresh` + the card column + `InfiniteScroll` + the inline page error + the two empties + the first-load error, plus the exported `FeedCardSkeleton`/`FeedListSkeleton`
- `packages/modules/feed/tests/meta.test.ts` — the table-driven cross-product
- `apps/web/lib/feed-view.tsx` — the shared `FeedPost` -> `PostCardView` mapper, the pt-BR timestamp/byte formatters and the injected `VideoPlayer` element
- `apps/web/lib/feed.ts` — `likePost` / `unlikePost` beside `getFeed`
- `apps/web/app/(app)/inicio/feed-actions.ts` — the four actions
- `apps/web/lib/registry.tsx` — the home slot passes the seeded page, the actions, the locale and the labels
- `apps/web/messages/pt-BR/feed.json` — `actions.*`, `meta.likes/comments/edited`, `errors.loadMore`
- `apps/web/e2e/feed.spec.ts`, `apps/web/e2e/feed-admin.ts`, `apps/web/e2e/fixtures.ts` — the interaction suite and the empty-feed tenant fixture
- `apps/web/e2e/shell.spec.ts` — the deferred-item fix
- `scripts/seed.ts` — 18 filler posts per tenant, the edited post with real likes, the 40-character member and their post

## Decisions Made

1. **No client data-cache library.** The plan's own decision, executed as written: `apps/web/lib/feed.ts` + server actions is the one paging paradigm, and Phase 7 (Realtime invalidation) is where a cache is worth revisiting.
2. **`postCardView` lives in `apps/web/lib/feed-view.tsx`, not in `lib/registry.tsx`.** Both the home slot and `feed-actions.ts` need it; keeping it in the registry would have required `feed-actions.ts` to import the registry while the registry imports the actions — a module cycle across a `'use server'` boundary. Registry still calls it (`postCardView(post, now, tf)`), so the timezone-pinned formatting is one call away rather than inline.
3. **Count copy crosses the module boundary as a template.** `tf.raw('meta.likes.one')` yields `"{count} curtida"`; the module fills `{count}` with `Intl.NumberFormat(locale, { notation: 'compact' })` and picks the form with `Intl.PluralRules(locale)`. Interpolating in the catalog was impossible: an optimistic like changes the number with no round trip, so the placeholder has to survive the lookup. The module still ships no words — only the locale tag and the templates arrive as props.
4. **`renderMedia` is an optional override with a real default.** A function cannot cross the RSC boundary from the server composition point, and `lib/registry.tsx` is the only file in `apps/web` allowed to import a module's `ui` package (D-42), so a client wrapper that could supply one would break that rule. The default is `item.media` — the node the host already built on the server, which survives both boundaries an item crosses (a server component's props and a server action's return value). The prop stays as the seam for a host that must build a media node client-side.
5. **The >999 backstop is a unit test, not a fixture.** See the deviation below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A rejected load-more or refresh left the widget with no failure state**
- **Found during:** Task 3 (writing the intercepted-failure case)
- **Issue:** `FeedList` awaited `onLoadMore()` / `onRefresh()` without a `try`. `useInfiniteScroll` deliberately swallows a rejection so it cannot reach render, so a server action that never reached the server (a dead network, the exact case the e2e intercepts) would leave `pageFailed` false — the sentinel would keep spinning and no retry would ever be offered.
- **Fix:** Both call sites now catch, log a shape-only line and fall through to the same `{ ok: false }` path a refusal takes.
- **Files modified:** `packages/modules/feed/ui/FeedList.tsx`
- **Verification:** `apps/web/e2e/feed.spec.ts` › "a failed page keeps every loaded card and offers a retry at the sentinel" and › "a failed like reverts, toasts, and never removes the card"
- **Committed in:** `dd0987f`

**2. [Rule 1 - Bug] The sentinel retry loaded two pages per tap**
- **Found during:** Task 3 (the retry assertion read 30 cards where 20 were expected)
- **Issue:** `retryPage` cleared `pageFailed` *and* called `loadMore()`. Clearing the flag re-enables the sentinel, whose effect rebuilds the `IntersectionObserver`, which fires immediately for a target already on screen — so the tap produced the sentinel's page plus the retry's page.
- **Fix:** `retryPage` now only clears the flag. The retry control renders at the sentinel, so the sentinel is by construction in view and re-arming it is the load.
- **Files modified:** `packages/modules/feed/ui/FeedList.tsx`
- **Verification:** the same e2e case, now asserting exactly `pageSize * 2` after the retry
- **Committed in:** `dd0987f`

**3. [Rule 1 - Bug] `shell.spec.ts`'s tria-lab case had a SECOND wrong assertion, not just the `Em breve` one**
- **Found during:** Task 3 (fixing the assigned deferred item)
- **Issue:** `page.getByRole('link', { name: 'Exemplo' })` was expected to be absent, but Playwright's `name` option is a case-insensitive SUBSTRING match by default, and 04-05's seeded link posts auto-link `https://noticias.exemplo.invalid/…` and `https://sem-metadados.exemplo.invalid/…`. Two captions on the lab feed therefore read as "Exemplo" links. This assertion — not the `Em breve` one — was the first line to fail, which is why the deferred note's diagnosis was incomplete.
- **Fix:** scoped to the nav tree with `exact: true`; `#exemplo` still covers "the widget is absent anywhere on the page".
- **Files modified:** `apps/web/e2e/shell.spec.ts`
- **Verification:** `pnpm --filter @tria/web exec playwright test shell.spec.ts` — 10 passed, both projects
- **Committed in:** `dd0987f`

### Planned work adjusted

**4. [Rule 3 - Blocker] The planned high-count seed fixture would have turned a pgTAP assertion red**
- **Found during:** Task 3 (seeding "a post with counts above 999")
- **Issue:** `supabase/tests/090-feed.sql` asserts, for EVERY post in the database, that `like_count` equals the live `feed_likes` rows. `feed_likes` is unique per `(user_id, post_id)` and `user_id` foreign-keys to `public.users` -> `auth.users`, so a four-digit count needs 1000+ real auth users; writing the counter by hand instead would make that reconciliation fail. Nor can the e2e fake it: the feed is fetched by the Next SERVER, so no browser interception can inflate the payload.
- **Resolution:** the seed writes a genuinely edited post whose counts are whatever its real like rows produce (10 in demo, 4 in lab), the e2e asserts the edited marker and the meta row's overflow at 320px against it, and the >999 abbreviation is pinned as a STRING by `meta.test.ts`. The unrendered pixel half is recorded as **WINDOWS 24** and as `human_judgment: true` on coverage `D14`.
- **Files modified:** `scripts/seed.ts`, `packages/modules/feed/tests/meta.test.ts`, `apps/web/e2e/feed.spec.ts`
- **Verification:** `pnpm db:reset && pnpm db:seed && bash scripts/supabase.sh test db` — 199 tests, all pass, with the new fixtures in place
- **Committed in:** `dd0987f`

**5. [Rule 3 - Blocker] `apps/web/lib/feed-view.tsx` added (not in `files_modified`)**
- **Found during:** Task 2
- **Issue:** the plan asks the load-more action to build the same view the home slot builds, but putting the mapper in `lib/registry.tsx` creates a `registry -> feed-actions -> registry` cycle across a `'use server'` boundary.
- **Resolution:** a third module both import. It imports only TYPES from `@tria/module-feed/ui`, so `lib/registry.tsx` remains the single composition point that imports a module's `ui` package for real (D-42, verified by `pnpm boundaries`).
- **Committed in:** `13d6cfe`

---

**Total deviations:** 5 (3 Rule 1 bugs, 2 Rule 3 blockers)
**Impact on plan:** No scope creep. Two of the three bugs were found by the e2e the plan itself asked for, which is the loop working. The two blockers are fixture/structure adjustments forced by invariants other plans established (the pgTAP counter reconciliation, the MOD-02 single-importer rule); both are documented and neither weakens a check.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| The empty-state and desktop create CTA render only when the host passes `createHref` | `packages/modules/feed/ui/FeedList.tsx` | `/criar` arrives in 04-09. A button that 404s is worse than no button. Already tracked as **WINDOWS 18**; the e2e asserts the CTA's absence deliberately. |
| `onOpenComments`, `onShare`, `onMore` are optional and unwired by the host | `apps/web/lib/registry.tsx` | 04-07 (comment sheet), 04-08 (share) and 04-09 (overflow menu) supply them. The controls render and are inert rather than absent, because "the action row is always present" is the UI-SPEC contract (E09/empty). |
| The mobile create FAB does not exist | — | 04-09 (D-57/UI-D-17). "The FAB is suppressed while the empty-state CTA is on screen" is therefore untestable this plan. |

## Threat Flags

None — the plan's `<threat_model>` covers every surface this plan added. T-04-38 (forged id/cursor) is enforced by `feedQuerySchema`/`z.uuid()` in `feed-actions.ts`; T-04-39 by the server value replacing the optimistic pair; T-04-40 by the shape-only logs; T-04-41 by the sentinel's re-entrancy guard plus the stand-down on failure; T-04-42 by the actions returning `code: 'generic'` and never text.

## TDD Gate Compliance

| Gate | Commit | Evidence |
|------|--------|----------|
| RED | `823a853` (`test(04-06)`) | `pnpm --filter @tria/module-feed test` exited 1 with **24 failing tests, all in `tests/meta.test.ts`, all on assertions for the planned behaviour** (`expected [] to deeply equal [ 'REL' ]` etc.). `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` / `target_test_failed` for target test `buildPostMeta (UI-D-21: the 18-case zero/one/many cross-product) > a brand-new post is its relative time and nothing else`. Counts (91 tests / 67 pass / 24 fail) were normalised from the real Vitest run through a throwaway `/tmp` TAP scratchpad — Vitest emits no `node --test` TAP trailer — and nothing of that scratchpad was committed. |
| GREEN | `ad8ebd8` (`feat(04-06)`) | `pnpm --filter @tria/module-feed test` — 91 passed. |
| REFACTOR | — (none) | The GREEN implementation already had the shape the test described; an empty refactor commit would be noise. Recorded here rather than faked. |

Only Task 1 carried `tdd="true"`. Tasks 2 and 3 are `type="auto"` and were committed once each.

## Issues Encountered

- **The e2e's server-action POST counter conflated two producers.** The video card mounts its own playback-token action (D-44) on page 1, so the raw count after login is never zero. The paging test now takes a baseline once the first page has settled and measures the DELTA the sentinel adds — which is the thing under test anyway.
- **`getByRole('img').first()` inside a card matches the AVATAR, not the gallery.** The double-tap case was dispatching its gesture outside `DoubleTapHeart`. Fixed by targeting `data-testid="post-gallery-strip"` explicitly.
- **Playwright loads specs as ESM,** so the catalog imports needed `with { type: 'json' }`.
- **Pull-to-refresh has no Playwright primitive.** `usePullToRefresh` binds real `touchstart`/`touchmove`/`touchend` listeners, and Playwright's `touchscreen` API has no drag, so the gesture is synthesised with `new Touch(...)` / `new TouchEvent(...)` dispatched on a card inside the wrapper. Documented in the helper.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 04-07 (comments).** The seams it needs are in place and typed: `PostCard`'s `onOpenComments` (already wired to both the comment `IconButton` and the comment-count segment in the meta row), the `comments` count templates in the catalog, `formatCountLabel` for the comment row's own like count, and the 40-character seeded member whose comment-row wrapping is 04-07's half of that backstop.

**Carried forward:**
- The empty-state / desktop create CTA stays unrendered until 04-09 supplies `createHref` (WINDOWS 18).
- The >999 meta-row pixels have never been rendered (WINDOWS 24) — the abbreviated string is unit-pinned.
- `seededFeedPaging.total` is the DEMO tenant's 27; the lab tenant has 26 (it has no 40-character member). A future plan that seeds another post must update the fixture.

---
*Phase: 04-feed*
*Completed: 2026-09-23*

## Self-Check: PASSED

All 7 created files exist on disk; all 4 task commits (`823a853`, `ad8ebd8`, `13d6cfe`, `dd0987f`) are in the log. Plan-level verification re-run at close-out: `@tria/module-feed` typecheck/lint/test (91 passed, `tests/meta.test.ts` named), `@tria/web` typecheck/lint/build, `check-ui-literals`, `check-static-routes`, `pnpm boundaries`, `supabase test db` (199 tests), and `playwright test feed.spec.ts` (23 passed / 3 skipped-by-project, 28.5s — inside the T2 five-minute ceiling) plus `shell.spec.ts` (10 passed).
