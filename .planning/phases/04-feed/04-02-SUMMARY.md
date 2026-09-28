---
phase: 04-feed
plan: 02
subsystem: ui
tags: [ui, kernel-primitives, tokens, intersection-observer, gestures, design-gate, motion, tailwind-v4, vitest, D-33]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    provides: "@rede-social/ui with tokens.css, ScrollContainerContext/useScrollContainer, Skeleton, useMediaQuery, the overlay conventions on motion/react, and the happy-dom + Testing Library harness"
  - phase: 04-feed
    provides: "04-01's feed tracer settled the paging contract the sentinel has to agree with: GET /v1/feed REFUSES an over-large ?limit with 400 rather than clamping it"
provides:
  - "`InfiniteScroll` + `useInfiniteScroll` in @rede-social/ui: IntersectionObserver sentinel whose root comes from ScrollContainerContext (prop-overridable), with a ref-backed re-entrancy guard and a render contract that shows nothing once there is no next page"
  - "`DoubleTapHeart` in @rede-social/ui: 300 ms double-tap window, 900 ms decorative burst, pointer-events-none overlay, reduced-motion branch"
  - "the one Phase 4 token `--color-like` (#ef4444, both themes) with its text-/fill-/bg- utilities"
  - "sketch 002 — the D-33 / UI-04 static mockup package for the six [designed] Phase 4 surfaces, registered in the sketch manifest"
affects: [04-04 attachment row, 04-05 link preview card, 04-06 FeedList wiring, 04-09 composer, 05 communities list, 07 notifications list]

actuals:
  tokens: 29783
  tasks: 3
  commits: 6
plan_head_before: 9965b997e0fce69d6310313b69c637405ac2c577

tech-stack:
  added: []
  patterns:
    - "Kernel-first paging: the sentinel primitive lives in @rede-social/ui, not in the feed module, because Phase 5's community list and Phase 7's notification list need the identical thing"
    - "Scroll-root injection: a scroll-aware primitive resolves its root from ScrollContainerContext with an explicit prop override, never from a document lookup — the coupling the context exists to remove"
    - "Ref-backed re-entrancy guard: the guard flips BEFORE the first await, because an observer callback can fire again before React commits the isLoading state"
    - "Controllable browser-API stubs in unit tests instead of polyfills: the test asserts on the options the hook passed to the constructor, which is exactly what a polyfill would hide"
    - "Motion payload exposed as a data attribute (data-double-tap-burst=spring|opacity) so the reduced-motion branch is assertable without reaching into the animation library"

key-files:
  created:
    - packages/ui/src/hooks/useInfiniteScroll.ts
    - packages/ui/src/layout/InfiniteScroll.tsx
    - packages/ui/src/overlays/DoubleTapHeart.tsx
    - packages/ui/tests/infinite-scroll.test.tsx
    - packages/ui/tests/double-tap-heart.test.tsx
    - .planning/sketches/002-phase-04-designed-screens/index.html
    - .planning/sketches/002-phase-04-designed-screens/README.md
  modified:
    - packages/ui/src/styles/tokens.css
    - packages/ui/src/index.ts
    - packages/ui/tests/tokens.test.ts
    - .planning/sketches/MANIFEST.md

key-decisions:
  - "--color-like is declared THREE times on purpose — light block, dark block, @theme inline — each with the literal #ef4444, rather than the file's usual raw `--theme-*` + alias layering. The per-theme declarations are what make the 'identical in both themes' contract explicit and testable; the theme-block declaration is what makes text-like/fill-like/bg-like compile. An `@theme inline` alias pointing at itself would be circular, and a single `--theme-like` raw value would have satisfied the contract but not the plan's own grep gate."
  - "The DoubleTapHeart burst glow is mixed from the token (color-mix(in oklch, var(--color-like), transparent 40%)) instead of the prototype's rgba(239,68,68,0.6) literal. check-ui-literals.sh would not have flagged the rgba form, but it is still a hard-coded colour outside tokens.css."
  - "The gesture listens on pointerup, not click, so a single tap reaches the child's own click handler untouched and the wrapper adds no role and no tab stop — the keyboard/AT path to the same action is the LikeButton beside it (UI-D-07)."
  - "The mockup loads NO external asset at all, including no remote webfont — a departure from sketch 001, which linked Google Fonts. The plan's action text and threat T-04-10 both require zero network, so Manrope comes from @font-face src: local() and falls back to the system stack."
  - "The tracked `?limit` reconciliation from 04-01 needs no code here: neither InfiniteScroll nor useInfiniteScroll knows about page size — the consumer (04-06's FeedList) owns the fetch and therefore owns keeping its page size at or under FEED_MAX_PAGE_SIZE."

patterns-established:
  - "TDD on a brand-new module: the RED commit ships a deliberately inert stub alongside the test so the failure is an assertion failure on the planned behaviour, not a module-resolution crash (INVALID_RED)"
  - "Design-gate packages are review artifacts under .planning/, self-contained, and asserted to be referenced by zero files under apps/ and packages/"

requirements-completed: [UI-02]

coverage:
  - id: D1
    description: "useInfiniteScroll resolves its IntersectionObserver root from ScrollContainerContext (prop-overridable, null outside the shell) and never from a document lookup"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#uses the shell scroll container from context as the observer root"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#falls back to the document (root null) when rendered outside the shell"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#lets an explicit root prop override both the context and the document"
        status: pass
      - kind: other
        ref: "grep -c getElementById packages/ui/src/hooks/useInfiniteScroll.ts packages/ui/src/layout/InfiniteScroll.tsx => 0, 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The sentinel loads exactly one page at a time: a burst of intersections while a page is in flight calls onLoadMore once, and it never loads while hasMore is false or enabled is false"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#calls onLoadMore exactly once across two intersections while the page is still in flight"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#never observes and never loads while there is no next page"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#never observes while disabled"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#clears the loading flag when onLoadMore rejects, without rethrowing into render"
        status: pass
    human_judgment: false
  - id: D3
    description: "InfiniteScroll renders nothing once there is no next page, and exactly one fixed-height skeleton block while a page is in flight"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#renders no DOM node at all once there is no next page (no terminal spacer, no end-of-list copy)"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#renders exactly one skeleton block while a page is in flight, never two"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/infinite-scroll.test.tsx#renders a default fixed-height skeleton block that cannot exceed its container"
        status: pass
    human_judgment: false
  - id: D4
    description: "--color-like is the one new Phase 4 token: declared in both theme layers and in the theme block, its own value rather than an alias of --color-danger or of the tenant accent, with working text-/fill-/bg- utilities"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/ui/tests/tokens.test.ts#is declared in the light block and in the dark block, with the same value"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/tokens.test.ts#is its own value — never an alias of the destructive token or of the tenant accent"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/tokens.test.ts#adds no second Phase 4 token"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh => exit 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "DoubleTapHeart fires once per 300 ms double tap, renders a decorative pointer-events-none burst for 900 ms carrying text-like/fill-like at size 80, passes a single tap through to the child, and drops the scale keyframes under reduced motion"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#fires onDoubleTap exactly once for two taps inside the 300 ms window and renders the burst"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#does not fire for two taps 400 ms apart"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#does not fire for a single tap and lets the child keep its own click handler"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#is decorative and never swallows a tap meant for the child"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#is removed after its 900 ms life"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#carries the like token on the glyph, never a hex or a legacy prototype class"
        status: pass
      - kind: unit
        ref: "packages/ui/tests/double-tap-heart.test.tsx#still renders the burst but drops the scale keyframes for an opacity-only fade"
        status: pass
    human_judgment: false
  - id: D6
    description: "The sketch 002 package exists, is self-contained, carries every required copy string and the real token values, draws no third-party frame, is registered in the manifest and is referenced by no application code"
    verification:
      - kind: other
        ref: "plan 04-02 Task 3 <verify><automated> (test -f both files, manifest row, required copy strings, zero references from apps/ and packages/) => exit 0"
        status: pass
      - kind: other
        ref: "grep -c '<script src=|<link rel=\"stylesheet\" href=' index.html => 0; grep -c iframe index.html => 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-33 / UI-04 design review: the six [designed] Phase 4 surfaces read as the prototype's own language in light and dark under at least two tenant brands, and the design team receives the D-51 answer and the open-question-3 request"
    verification: []
    human_judgment: true
    rationale: "This is the review gate itself — a human opens index.html in a browser, judges the visual language, and records the outcome in the sketch README frontmatter. Nothing automated can substitute. workflow.human_verify_mode is end-of-phase, so it is carried into the phase UAT rather than raised mid-flight; the sketch README stays status: pending / approved: false until then, and it is recorded as an open entry in .planning/WINDOWS.md."

# Metrics
duration: 15 min
completed: 2026-09-22
status: complete
---

# Phase 4 Plan 02: Kernel primitives and the D-33 design gate — Summary

**`@rede-social/ui` gains the last unported prototype primitive (`InfiniteScroll`/`useInfiniteScroll`, rooted in the shell's scroll context rather than a document lookup), the `DoubleTapHeart` gesture, the single `--color-like` token, and the static mockup package the composer/link-card/attachment-row surfaces must pass before anyone codes them.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-22T15:49:38Z
- **Completed:** 2026-09-22T16:05:15Z
- **Tasks:** 3 of 3
- **Files modified:** 11 (7 created, 4 modified)

## Accomplishments

- **`useInfiniteScroll` + `InfiniteScroll` ship from `@rede-social/ui`.** The observer root is `useScrollContainer()?.current ?? null` with an explicit `root` prop override, so the primitive works inside the app shell's scrollport and outside it. The prototype's hardcoded element-id lookup is gone, and the acceptance gate greps for it. It lives in the kernel package rather than the feed module because Phase 5's community list and Phase 7's notification list need the identical thing.
- **One page at a time, proven.** The re-entrancy guard is a ref that flips before the first `await`, not the `isLoading` state, because an IntersectionObserver callback can fire again before React commits. Two intersections while a page is pending call `onLoadMore` once; a rejection clears the flag without reaching render (the consumer owns its retry line).
- **The render contract holds the E17 probes.** `hasMore: false` renders no DOM node at all — no terminal spacer, no "fim da lista" copy — and a page in flight renders exactly one fixed-height, `overflow-hidden` placeholder card, never two.
- **`--color-like` is the one new token**, `#ef4444` in both themes, with `text-like` / `fill-like` / `bg-like` compiling from the theme block. It is its own value, not an alias of `--color-danger` and not the tenant accent — a Phase 8 destructive-palette change cannot move the heart, and a brand-coloured heart would lose a universally-read affordance.
- **`DoubleTapHeart` is ported against this repo's primitives**, not the prototype's: `motion/react`, the shipped `useMediaQuery`, the token instead of `text-red-500`/`#ef4444`. The burst is `pointer-events-none` and `aria-hidden`, so it can never swallow a tap meant for the child and never reaches the accessibility tree.
- **Sketch 002 is the D-33 / UI-04 review package** for the six `[designed]` surfaces: `/criar` in five states, `/post/[id]/editar`, the mobile FAB and the desktop compose CTA and the suppressed-FAB empty feed, the four `LinkPreviewCard` states, five `AttachmentRow` variations, and the two post menus with their three confirmation dialogs — every string verbatim from the Copywriting Contract, every colour from the real `tokens.css`.
- **The design team's two messages are on record** in the sketch README: PROTOTYPE.md open question 2 is answered "drop titles and type chips" (D-51), and open question 3's composer designs are exactly what the package is requesting.

## Task Commits

1. **Task 1: InfiniteScroll + useInfiniteScroll (TDD)**
   - RED — `46e6b31` `test(04-02): drive the InfiniteScroll sentinel from a stubbed observer`
   - GREEN — `9368ba1` `feat(04-02): implement InfiniteScroll and useInfiniteScroll in the kernel`
   - REFACTOR — none; no cleanup was warranted, so no empty commit was made.
2. **Task 2: `--color-like` + DoubleTapHeart (TDD)**
   - RED — `bb03568` `test(04-02): pin the --color-like token and the DoubleTapHeart gesture`
   - GREEN — `dd4d7ec` `feat(04-02): add the --color-like token and port DoubleTapHeart`
   - REFACTOR — none.
3. **Task 3: D-33 / UI-04 review gate** — `6507cd0` `docs(04-02): draw the six [designed] Phase 4 surfaces as sketch 002`

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | RED evidence |
|------|-----|-------|----------|--------------|
| 1 | `46e6b31` | `9368ba1` | — (no change) | `RED_EVIDENCE_OK` — target test "calls onLoadMore exactly once across two intersections while the page is still in flight" failed on its assertion, exit 1, 11 failed / 44 passed |
| 2 | `bb03568` | `dd4d7ec` | — (no change) | `RED_EVIDENCE_OK` — target test "fires onDoubleTap exactly once for two taps inside the 300 ms window and renders the burst" failed on its assertion, exit 1, 9 failed / 59 passed |

No gate violations. Both RED phases were verified with `gsd-tools check tdd-red-evidence` before any production edit. Two adaptations were needed to use that gate with this repo's test runner and are documented as deviations 1 and 2 below.

## Files Created/Modified

- `packages/ui/src/hooks/useInfiniteScroll.ts` — **created.** IntersectionObserver sentinel hook: root from `ScrollContainerContext` (prop-overridable), `rootMargin: '200px'`, `threshold: 0`, ref-backed loading guard, observer recreated only on `root`/`rootMargin`/`threshold`/`hasMore`/`enabled`, disconnected on cleanup. The callback is held in a ref so a new function identity per render does not tear down and re-fire the observer.
- `packages/ui/src/layout/InfiniteScroll.tsx` — **created.** Sentinel + skeleton wrapper. `null` when `hasMore` is false; a `skeleton` prop overrides the default `[proto]`-shaped placeholder card.
- `packages/ui/src/overlays/DoubleTapHeart.tsx` — **created.** 300 ms `pointerup` window, burst keyed by id, cleared after 900 ms with a 400 ms opacity exit, spring `damping 8 / stiffness 200`, reduced-motion branch exposed as `data-double-tap-burst`.
- `packages/ui/src/styles/tokens.css` — **modified.** `--color-like: #ef4444` in the light block, the dark block and `@theme inline`, each with its UI-D-08 rationale in prose. Nothing else touched.
- `packages/ui/src/index.ts` — **modified.** Three new export groups in the existing alphabetical grouping, types alongside.
- `packages/ui/tests/infinite-scroll.test.tsx` — **created.** 13 tests on a controllable `IntersectionObserver` stub.
- `packages/ui/tests/double-tap-heart.test.tsx` — **created.** 9 tests on fake timers with a stubbed `matchMedia`.
- `packages/ui/tests/tokens.test.ts` — **modified.** Four assertions for the new token.
- `.planning/sketches/002-phase-04-designed-screens/index.html` — **created.** Single self-contained mockup, ~9 screens, light/dark + brand picker.
- `.planning/sketches/002-phase-04-designed-screens/README.md` — **created.** Sketch frontmatter (`status: pending`), the design question, the two messages for the design team, the fixed upstream decisions, and the review checklist.
- `.planning/sketches/MANIFEST.md` — **modified.** Row 002 plus the Phase 4 reference points.

## Decisions Made

1. **`--color-like` is declared three times, literally.** The file's neutrals use a raw `--theme-*` layer plus a `--color-*` alias; its semantic colours (`--color-danger` and friends) live only in `@theme inline`. This token needed both shapes: per-theme declarations so the "same value in both themes" contract is explicit and testable, and a theme-block declaration so the utilities compile. Aliasing the theme entry back at `--color-like` would be circular, so all three carry the literal. The comment at each site says why.
2. **The burst glow is mixed from the token, not the prototype's rgba.** `check-ui-literals.sh` only matches `#rrggbb` inside a string, so `rgba(239,68,68,0.6)` would have passed — but it is still a colour that lives outside `tokens.css` and would not follow the token if it moved.
3. **`pointerup`, not `click`.** Listening on `click` at the wrapper would put the gesture surface in the child's activation path; `pointerup` bubbles the same way but leaves the child's own `onClick` entirely alone, which is what the "never swallows a tap" prohibition asks for.
4. **No webfont in the mockup.** Sketch 001 linked Google Fonts; the plan's action text ("no network fetch") and threat T-04-10 ("loads no external asset") are explicit, so 002 uses `@font-face src: local('Manrope')` and documents the trade in its README.
5. **The 04-01 `?limit` reconciliation is a no-op for this plan.** Neither new module knows about page size — `useInfiniteScroll` only decides *when* to ask. The obligation to stay at or under `FEED_MAX_PAGE_SIZE` belongs to 04-06's `FeedList`, which owns the fetch; it is recorded here so that plan inherits it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] `gsd-tools check tdd-red-evidence` could not read this repo's test output**

- **Found during:** Task 1 (RED gate)
- **Issue:** The gate's parser is written for `node --test`: it matches `^not ok N - <name>` anchored at column 0 and reads a `# tests / # pass / # fail` trailer. This repo runs Vitest 5, whose TAP reporter nests and indents leaf assertions and emits no trailer. Every attempt classified as `INVALID_RED` for a formatting reason (`invalid_record`, then `zero_tests_discovered`, then `fixture_or_load_failure`) even though the RED itself was sound.
- **Fix:** A small, throwaway normalizer (`/tmp`, not committed) that de-indents the failing **leaf** lines from `vitest run --reporter=tap`, drops the suite containers, and appends the run's real counts. Test names and counts are copied verbatim — nothing is invented; only the TAP shape is adapted.
- **Files modified:** none in the repo.
- **Verification:** both RED records then classified `RED_EVIDENCE_OK`, each naming the intended target test.
- **Committed in:** n/a (tooling adaptation, no repo change).

**2. [Rule 3 — Blocker] A brand-new module cannot produce a valid RED from tests alone**

- **Found during:** Task 1, again in Task 2
- **Issue:** With no module on disk, the RED run fails at import resolution. Per #3770 that is a load failure, i.e. `INVALID_RED`, and must not authorize GREEN.
- **Fix:** Each RED commit ships the new module as a deliberately inert stub (documented as such in its own doc comment) alongside the test, so the run fails on assertions about the planned behaviour instead of crashing at load. Both stubs were fully replaced in the following GREEN commit.
- **Files modified:** `packages/ui/src/hooks/useInfiniteScroll.ts`, `packages/ui/src/layout/InfiniteScroll.tsx`, `packages/ui/src/overlays/DoubleTapHeart.tsx` (stub forms, superseded in GREEN).
- **Verification:** 11 (Task 1) and 9 (Task 2) assertion failures in the named target files, zero load errors.
- **Committed in:** `46e6b31`, `bb03568`.

**3. [Rule 1 — Bug] A doc comment defeated its own acceptance gate**

- **Found during:** Task 1 (acceptance-criteria loop)
- **Issue:** The hook's doc comment named the prototype's anti-pattern verbatim (`document.getElementById('app-scroll')`), which made `grep -c getElementById useInfiniteScroll.ts` return 1 instead of the required 0. The grep is the mechanical guard that the lookup is not used; a comment that trips it makes the guard useless for every future reader.
- **Fix:** Reworded to "a lookup of the shell's scroll element by id". The reasoning is unchanged; the token is gone.
- **Files modified:** `packages/ui/src/hooks/useInfiniteScroll.ts`
- **Verification:** `grep -c getElementById` → 0 for both files; suite still 55/55.
- **Committed in:** `9368ba1`.

**4. [Rule 3 — Blocker] An unnecessary Biome suppression failed lint**

- **Found during:** Task 2
- **Issue:** A `biome-ignore lint/a11y/noStaticElementInteractions` on the gesture wrapper suppressed a rule this config does not enable, and Biome reports an ineffective suppression as a warning.
- **Fix:** Removed the suppression, kept the reasoning as a plain comment.
- **Files modified:** `packages/ui/src/overlays/DoubleTapHeart.tsx`
- **Verification:** `pnpm --filter @rede-social/ui lint` clean.
- **Committed in:** `dd4d7ec`.

**5. [Rule 2 — Missing critical] The mockup drops sketch 001's remote webfont**

- **Found during:** Task 3
- **Issue:** Copying sketch 001's shape would have carried its `<link href="https://fonts.googleapis.com/...">`, contradicting the plan's "no network fetch" and threat T-04-10's "loads no external asset".
- **Fix:** No remote asset at all; `@font-face` with `src: local('Manrope')` and a documented system fallback, explained at the top of the file and in the README.
- **Files modified:** `.planning/sketches/002-phase-04-designed-screens/index.html`, `.../README.md`
- **Verification:** `grep -c '<script src=|<link rel="stylesheet" href='` → 0.
- **Committed in:** `6507cd0`.

---

**Total deviations:** 5 auto-fixed (3 × Rule 3 blockers, 1 × Rule 1 bug, 1 × Rule 2 missing critical).
**Impact on plan:** None on scope. Two are tooling adaptations needed to run the TDD gate honestly against Vitest; three are small corrections inside the planned files. No task was skipped, no acceptance criterion was waived.

## Reconciliation with 04-01

04-01 closed with an open convention: `GET /v1/feed` **refuses** an over-large `?limit` with 400 (`.max(FEED_MAX_PAGE_SIZE)`) rather than clamping it. That behaviour is settled and unchanged by this plan. It required **no code here**: neither `InfiniteScroll` nor `useInfiniteScroll` carries a page size — they decide *when* to ask, not *what* to ask for. The obligation to keep the requested page at or under `FEED_MAX_PAGE_SIZE` lands on the consumer that owns the fetch, which is 04-06's `FeedList`. Recorded so that plan inherits it explicitly rather than rediscovering it against a 400.

## Issues Encountered

None beyond the deviations above. The full plan verification is green:

- `pnpm --filter @rede-social/ui typecheck` — clean
- `pnpm --filter @rede-social/ui lint` — clean (Biome, 43 files)
- `pnpm --filter @rede-social/ui test` — **68 passed / 68**, 5 files, the summary naming both `infinite-scroll.test.tsx` and `double-tap-heart.test.tsx`
- `bash scripts/check-ui-literals.sh` — OK
- `grep -rc framer-motion packages/ui/src/` — 0 in every file

## Outstanding Human Verification

**The D-33 / UI-04 design review of sketch 002 has NOT been performed.** `workflow.human_verify_mode` is `end-of-phase`, so Task 3's `<human-check>` is carried into the phase UAT rather than raised as a mid-flight checkpoint. Concretely:

- `.planning/sketches/002-phase-04-designed-screens/README.md` frontmatter is `status: pending`, `approved: false`, `approval_kind: null`.
- An `unrun-verify` entry is open in `.planning/WINDOWS.md` against `index.html`.
- **04-04 (attachment row), 04-05 (link-preview card) and 04-09 (composer, edit screen, FAB, "…" menu) are the plans that code these surfaces.** Following the 02-04 precedent, a provisional product-owner approval is enough to unblock them; a later designer delta is a polish follow-up, not a blocker. Record the outcome in the README frontmatter when it happens.

To review: `open .planning/sketches/002-phase-04-designed-screens/index.html`, toggle light/dark, and step through at least two brand presets.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Ready for the rest of Phase 4. What is unblocked:

- **04-06 (`FeedList`)** can wire `InfiniteScroll` + `PullToRefresh` around the card column immediately; it owns the copy, the retry line and keeping its page size at or under `FEED_MAX_PAGE_SIZE`.
- **The post card family** (`LikeButton`, `PostMedia`) can use `text-like`/`fill-like` and wrap the gallery in `DoubleTapHeart`.
- **04-04, 04-05 and 04-09** have a drawing to code against, subject to the review gate above.
- Phase 5's community list and Phase 7's notification list inherit the paging primitive with no feed coupling.

No blockers.

---
*Phase: 04-feed*
*Completed: 2026-09-22*

## Self-Check: PASSED

- All 8 files named in `key-files.created` exist on disk.
- All 6 commits (`46e6b31`, `9368ba1`, `bb03568`, `dd4d7ec`, `6507cd0`, `dc1abe6`) exist in `git log`.
- `commits: 6` is MEASURED — `git rev-list --count 9965b99..HEAD` — and includes this plan's metadata commit alongside the 5 task commits.
- `requirements.mark-complete` was intentionally NOT run: `requirements.ready-ids` reports `0/1` because a sibling plan in phase 04 also declares `UI-02` and has no SUMMARY yet. `UI-02` marks complete when the last declaring plan finishes.
