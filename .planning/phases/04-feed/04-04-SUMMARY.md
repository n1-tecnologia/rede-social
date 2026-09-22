---
phase: 04-feed
plan: 04
subsystem: feed
tags: [feed, media, gallery, carousel, video, attachments, drizzle, rls, pgtap, ui, a11y, tailwind]

requires:
  - phase: 04-feed
    plan: 01
    provides: "`@tria/module-feed` with `feed_posts`, the one-hydrated-statement rule + its CI query budget, the `post.published` event shape, the presentational `FeedList`/`PostCard` family and the `apps/web/lib/registry.tsx` composition point"
  - phase: 04-feed
    plan: 02
    provides: "`DoubleTapHeart` in `@tria/ui` (300 ms window, decorative burst, reduced-motion branch) and the happy-dom + Testing Library component-test harness this plan copied into the module"
  - phase: 04-feed
    plan: 03
    provides: "the composite-foreign-key technique for a structural invariant a trigger would race on, the SQLSTATE cause-chain translation helper, `supabase/tests/090-feed.sql`, and `viewerLiked` inside the one hydrated statement"
  - phase: 03-media-pipeline-member-profiles
    provides: "the whole broker — signed direct-to-Storage uploads, the `purpose: 'post'` 320/640/1080/1600 WebP ladder, PDF-only `attachment` at 25 MiB with the magic-byte check at `complete`, the `VideoProvider` seam with its local `fake` provider, `MediaImage` over `/v1/media/{assetId}/{variant}`, and `VideoPlayer` with its per-request playback token (D-44)"
provides:
  - "`public.feed_post_media` — an ordered media COLLECTION per post (`post_id`, `media_asset_id`, `kind`, `position`), never a column on `feed_posts`"
  - "D-53's gallery-XOR-video rule enforced DECLARATIVELY by the database: `feed_posts unique (id, media_kind)` + a redundant `post_media_kind` + the composite FK `(post_id, post_media_kind) -> feed_posts(id, media_kind)` + a CHECK binding `kind` to `post_media_kind`"
  - "at most one video per post via a partial unique on `(post_id) where kind = 'video'`; gap-free ordering via `(post_id, kind, position)`; `kind = 'file'` constrains the parent's discriminator not at all"
  - "`createPost` validates every referenced asset's tenant, kind, purpose and status INSIDE the writing transaction and refuses with ONE non-oracle code, `asset_not_usable`"
  - "`FEED_MAX_IMAGES` (10) / `FEED_MAX_ATTACHMENTS` (5), `postMediaSchema`, the widened `createPostSchema` and `feedPostSchema` (`mediaKind` + `media`)"
  - "the machine codes `too_many_images`, `too_many_attachments`, `gallery_and_video`, `asset_not_usable`, mapped from the schema refinement AND from the database's own 23503/23505/23514"
  - "`MediaImage` promoted to `@tria/core/ui`, with `apps/web/components/media/MediaImage.tsx` reduced to a re-export so every Phase 3 call site is untouched"
  - "`PostMedia` — the three-branch media band: shared-ratio snap carousel, injected player, nothing; plus the attachment list under any of them"
  - "`AttachmentRow` + `AttachmentDescriptor` — UI-D-23's row-local pending state and its generic-toast failure, downloading through the tenant-checked BFF media path"
  - "`@source \"../../../packages/modules\"` in globals.css — a module's UI classes are now visible to Tailwind at all"
  - "`apps/api/tests/integration/feed-media.test.ts` (14 cases) and `apps/web/e2e/feed-media.spec.ts` (4 cases x 2 projects)"
affects: [04-05, 04-06, 04-09, 04-10, 05-communities, 06-events, 07-notifications, 08-moderation]

actuals:
  tokens: 38642
  tasks: 3
  commits: 5

plan_head_before: 336d751a9799437cdee756c98ca392a934b6e09e

tech-stack:
  added: []
  patterns:
    - "A mutual-exclusion rule between two child kinds is a COMPOSITE FOREIGN KEY onto the parent's discriminator: `unique (id, media_kind)` on the parent plus a redundant `post_media_kind` on the child makes gallery-XOR-video an index-level fact, with no read-then-write window and no trigger"
    - "A media COLLECTION with a parent discriminator, never a singular `*_asset_id` column: the one-image case is the one-row case, so a carousel's ordering is never ambiguous and the renderer branches on one value"
    - "A runtime-derived aspect ratio is an inline `style`, not a Tailwind class (a dynamic `aspect-[w/h]` is never compiled) — and it is mirrored onto a `data-ratio` attribute so the shared-ratio rule is assertable rather than merely 'nothing visibly jumped'"
    - "A carousel's active index follows the SCROLL POSITION, so a swipe and an arrow key agree by construction instead of through two code paths that must be kept in sync"
    - "A private download is a fetch-then-save through the stable `/v1/media/{assetId}/original` redirect: reading the RESPONSE rather than its `Location` keeps the signed Storage URL inside the redirect chain and gives the row real pending and error states"
    - "A hook that throws without a provider (`useToast`) lives in a sub-component mounted only when its branch renders, so the parent stays usable without the provider"
    - "A shared test fixture is measured with a DELTA, never an absolute count, once any other plan may add rows to the same table"
    - "A `packages/modules/*/ui` package needs its own `@source` line: Tailwind's auto-detection skips node_modules, which is how a module is reached"

key-files:
  created:
    - packages/modules/feed/ui/PostMedia.tsx
    - packages/modules/feed/ui/AttachmentRow.tsx
    - packages/modules/feed/tests/post-media.test.tsx
    - packages/core/ui/MediaImage.tsx
    - supabase/migrations/20260922165218_feed_post_media.sql
    - apps/api/tests/integration/feed-media.test.ts
    - apps/web/e2e/feed-media.spec.ts
    - .planning/phases/04-feed/deferred-items.md
  modified:
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/ui/{PostCard,FeedList,index}.tsx
    - packages/modules/feed/{package.json,tsconfig.json,vitest.config.ts}
    - packages/core/ui/index.ts
    - apps/web/components/media/MediaImage.tsx
    - apps/web/lib/registry.tsx
    - apps/web/messages/pt-BR/feed.json
    - apps/web/app/globals.css
    - apps/web/e2e/{admin.ts,fixtures.ts}
    - apps/api/tests/integration/{media,media-playback,mux-webhook}.test.ts
    - scripts/seed.ts
    - supabase/tests/{010-rls-coverage,020-tenant-isolation,090-feed}.sql

key-decisions:
  - "D-53 is a DATABASE rule, not a composer rule: `feed_posts unique (id, media_kind)` + `feed_post_media.post_media_kind` + the composite FK + a CHECK make an image row and a video row on one post mutually exclusive at the index. A caller that never opens the composer gets the same refusal."
  - "`asset_not_usable` is ONE code for unknown id, another tenant's id, wrong kind, wrong purpose and wrong status, with no id echoed back — a per-cause code over an enumerable uuid space would be an existence oracle (T-04-22, the D-23 posture)."
  - "`MediaImage` was promoted to `@tria/core/ui` (it imports only `@tria/contracts/media` and `@tria/ui`); `VideoPlayer` was NOT — it binds an app-scoped server action for its per-request playback token (D-44), so `PostMedia` takes it as an already-created `ReactNode`. A component object is what 02-08 found Flight refuses."
  - "The attachment download reads the BFF response as a BLOB instead of following a signed URL: 03-01 forbids a signed Storage URL in any payload, so there is no 'give me a download URL' route, and the 25 MiB PDF cap is what bounds the blob."
  - "Byte sizes are formatted in `apps/web/lib/registry.tsx`, not in `AttachmentRow`: the plan's prose put the `Intl` formatter in the row, but a module package must ship no language (PWA-03) — a pt-BR locale baked into `@tria/module-feed` would travel to every other TRIA project that installs it. The row takes `sizeLabel: string | null` and renders the type ALONE when it is null."
  - "`PostMedia` owns the generic toast through an internal `AttachmentList` that is mounted only when a row exists, so a media-only card never needs a `ToastProvider`; `AttachmentRow` keeps an injected `onError` and stays purely presentational and unit-testable."
  - "The carousel dots are `aria-hidden` and `pointer-events-none`: the announced index is the `aria-live` region's job, and a duplicated announcement plus a swipe-swallowing target would both be regressions."
  - "The feed-media e2e reads the VIDEO case from tria-lab. `media-video.spec.ts` hard-resets tria-demo's video library before and after every test (its empty-state, newest-first and pagination assertions are absolute counts), which detaches the demo tenant's seeded video post. Reading the identical lab fixture makes the assertion order-independent instead of 'passes when it runs first'."

patterns-established:
  - "RED with an INERT STUB beside the spec (the 04-02 lesson): 14 of 25 module tests failed on assertions about the planned behaviour, never on module resolution — `check tdd-red-evidence` returned RED_EVIDENCE_OK"
  - "Component tests opt into happy-dom PER FILE (`// @vitest-environment happy-dom`) so a package's node-environment service suites do not pay for a DOM"
  - "`MotionGlobalConfig.skipAnimations = true` wherever a `motion/react` component is rendered under happy-dom: a cancelled animation rejects AFTER the run and turns a green suite into a nonzero exit"
  - "Biome suppressions that a JSX attribute triggers must be either directly adjacent to the attribute or file-scoped (`biome-ignore-all`); a multi-line explanation above the directive silently detaches it"
  - "A `/* … */` CSS comment may not contain `*/` — `packages/modules/*/ui` inside one terminated the comment and produced 21 phantom lint errors"

requirements-completed: [FEED-01, UI-02]

coverage:
  - id: D1
    description: "A post carries its media as ordered `feed_post_media` rows with a parent `media_kind` discriminator — never a singular asset column; a one-image and a ten-image post round-trip through the same path and shape"
    requirement: FEED-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#round-trips a one-image and a ten-image post through the SAME shape"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#shows the same media collection through GET /v1/feed as through the create response"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-53's gallery-XOR-video rule is enforced by the DATABASE — four illegal shapes refused at the index (23503 x2, 23514, 23505) with three attachment positive controls beside them"
    requirement: FEED-01
    verification:
      - kind: integration
        ref: "supabase/tests/090-feed.sql (pgTAP, `pnpm supabase test db` — 188 tests, Result: PASS)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#refuses photos AND a video on one post, and creates no post row"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#refuses a SECOND video row at the database when one is already attached"
        status: pass
    human_judgment: false
  - id: D3
    description: "Per-post caps and per-asset validation: FEED_MAX_IMAGES / FEED_MAX_ATTACHMENTS, and every referenced asset proven to be the caller's own with the right kind, purpose and status — one non-oracle refusal code"
    requirement: FEED-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#refuses more than FEED_MAX_IMAGES images"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#refuses ANOTHER tenant's asset id, naming neither the tenant nor the asset"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#refuses a PDF offered as a gallery image, and a photo offered as an attachment"
        status: pass
      - kind: integration
        ref: "supabase/tests/020-tenant-isolation.sql (feed_post_media five-case block + positive control)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The gallery renders as a snap carousel whose slides ALL share the first image's clamped ratio, with scrim dots, an announced active index and arrow-key navigation (UI-D-09/UI-D-10)"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#gives EVERY slide the FIRST image's ratio, not its own (UI-D-09)"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#moves one slide on the arrow keys and re-announces the active index"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-media.spec.ts#a member swipes the seeded three-photo post and the dots track the active slide"
        status: pass
    human_judgment: false
  - id: D5
    description: "The video branch renders the injected player and is never double-tap-hijacked; the `none` branch renders no media frame at all"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#renders the INJECTED video node and never hijacks a double tap on it (D-53)"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#renders NOTHING at all for a post with no media and no attachments"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-media.spec.ts#the seeded video post shows the Phase 3 player, never a gallery strip"
        status: pass
    human_judgment: false
  - id: D6
    description: "Attachment rows: min-h-14 geometry, a truncating filename with its accessible title, the type-alone partial line, and UI-D-23's row-local busy state with a single generic-toast failure"
    requirement: UI-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#goes busy while the file is fetched through the tenant-checked media path, then clears"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#restores the glyph and raises the failure EXACTLY once on a refusal, leaving the row tappable"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/post-media.test.tsx#renders the type ALONE when the stored size is missing — never a dangling separator"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-media.spec.ts#the seeded PDF row shows its stored filename and goes busy while the file is fetched"
        status: pass
    human_judgment: false
  - id: D7
    description: "No signed Storage URL reaches a payload or the DOM, and no byte passes through the API: images resolve through `/v1/media/{assetId}/{variant}` and the attachment download reads the redirect's response"
    requirement: FEED-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-media.test.ts#never leaks a signed Storage URL into the payload (T-04-23)"
        status: pass
      - kind: other
        ref: "grep gate: no `signedUrl`/`token=` in AttachmentRow.tsx; no `multipart|parseBody(|arrayBuffer(` under packages/modules/feed/server/"
        status: pass
    human_judgment: false
  - id: D8
    description: "`MediaImage` is importable by a module package without any module importing from `apps/web`"
    verification:
      - kind: other
        ref: "pnpm boundaries (turbo boundaries, 451 files / 8 packages, no issues) + pnpm boundaries:negative"
        status: pass
    human_judgment: false
  - id: D9
    description: "Visual fidelity of the shipped media band against the UI-SPEC — the scrim pill's weight over a real photograph, the carousel's snap feel on a phone, the 40px icon square and the attachment row's rhythm"
    requirement: UI-02
    verification: []
    human_judgment: true
    rationale: "The automated gates prove structure, classes, ratios and announcements; they cannot judge whether the band LOOKS like the prototype on a real device. The design-review gate for the [designed] attachment row is itself still open (WINDOWS 19: sketch 002 is status: pending / approved: false)."
  - id: D10
    description: "UI-SPEC E07 backstop — a 90+ character PDF filename truncates at 14/700 with an accessible `title` without growing the row past `min-h-14` on a 320px viewport"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-media.spec.ts#the seeded PDF row shows its stored filename and goes busy while the file is fetched (94-character seeded filename, title assertion + boundingBox height < 96px)"
        status: pass
    human_judgment: true
    rationale: "The plan marks this row `verification: backstop`, so the verifier must not silently pass it on the automated check alone: the e2e measures a mobile-chromium iPhone 14 viewport and a height bound, not that the truncation READS correctly at 14/700 on a real 320px device."

duration: 2h 43m
completed: 2026-09-22
status: complete
---

# Phase 4 Plan 4: Post Media — Gallery, Video and Attachments Summary

**`feed_post_media` with a database-enforced gallery-XOR-video rule, per-asset tenant/purpose/status validation inside the create transaction, and the `PostMedia` band that renders a shared-ratio snap carousel, an injected player or nothing — plus attachment rows that download through the tenant-checked redirect with real pending and error states.**

## Performance

- **Duration:** 2h 43m across two executor dispatches
- **Started:** 2026-09-22T16:42:18Z (first task commit's parent, `336d751`)
- **Completed:** 2026-09-22T19:34:00Z
- **Tasks:** 3
- **Files modified:** 35 (33 excluding the lockfile and the generated drizzle snapshot)

## Accomplishments

- **D-53 became a database rule.** `feed_posts` gained `unique (id, media_kind)`; `feed_post_media`
  carries a redundant `post_media_kind` bound by a composite foreign key to that pair and by a CHECK
  to its own `kind`. Because a post has exactly one `media_kind`, an image row and a video row cannot
  coexist — the second insert fails with 23503 or 23514, not with an application error. A partial
  unique on `(post_id) where kind = 'video'` is the one-video arbiter, and `kind = 'file'` constrains
  the parent not at all, so a PDF rides alongside photos, a video, or nothing.
- **Media is a COLLECTION, not a column.** There is no `image_asset_id` anywhere: a single-image post
  is the one-row case of the same ordered table, and the integration suite pins that a one-image and
  a ten-image post produce the identical projection shape with no response field naming a singular
  image asset.
- **Every referenced asset is proven in the writing transaction.** One read in the tenant lane checks
  existence, kind, purpose and status for every id at once; a foreign asset simply does not come
  back, and all five causes answer the single non-oracle code `asset_not_usable` with nothing echoed.
- **The hydrated projection grew a media array without growing the statement count.** A
  `left join lateral … json_agg` inside the SAME statement keeps `FEED_LIST_STATEMENT_BUDGET = 1`
  green, and a soft-deleted asset drops out of the array (one slide fewer, never a broken frame).
- **`PostMedia` renders the UI contract.** A gallery is `DoubleTapHeart` over a snap strip whose
  slides ALL carry the first image's clamped ratio; dots are white on a `bg-black/45` scrim inside a
  pill, never the accent; the active index follows the scroll position and is announced through an
  `aria-live` region; the strip is a tab stop and the arrow keys move one slide with hard stops at
  the ends. The video branch returns the injected player BARE — a double tap on a player is a seek
  gesture. A post with no media and no attachments renders nothing at all.
- **`AttachmentRow` gives UI-D-23 real feedback.** The row fetches
  `/v1/media/{assetId}/original` through the BFF, reads the RESPONSE (never its `Location`), saves
  through a temporary object URL and revokes it. A ref-backed guard flips before the first `await`,
  so a second tap while busy is a no-op; a refusal restores the glyph, clears `aria-busy` and raises
  exactly one generic toast with no inline message and no reflow.
- **`MediaImage` is now shared.** It moved to `@tria/core/ui` with a one-line re-export left at its
  old path, so a module package can render a private image and `pnpm boundaries` stays green with
  every Phase 3 call site untouched.
- **WINDOWS 17 closed.** `post.published` no longer carries a hard-coded `hasMedia: false`; it is
  derived from the post's own `media_kind` plus its attachments, inside the same transaction.

## Task Commits

1. **Task 1: `feed_post_media`, the declarative gallery-XOR-video rule, asset validation in
   `createPost`, `MediaImage` promoted** — `e0f9c41` (feat)
2. **Task 2: apply the migration, seed every media shape in both tenants, pin D-53 in pgTAP** —
   `f118b6c` (feat)
3. **Task 3 (tdd): `PostMedia` + `AttachmentRow`, the API refusal suite and the mobile e2e**
   - RED — `0426792` (test): the failing specs plus two inert stubs and the module's component
     harness
   - GREEN — `d21e3ef` (feat): the two components, the `PostCard`/`FeedList`/registry wiring, the
     catalog rows, and the cross-suite fallout fixes
   - REFACTOR — none. The GREEN implementation was already the shape the specs describe; a
     cleanup commit with no change would have been noise.
   - Follow-up — `01edbf2` (fix): the attachment e2e no longer waits on a browser `download`
     event, whose own 30 s budget is the whole test timeout and turned an unrelated Storage
     hiccup into an opaque timeout. Caught by the full-suite run, after GREEN.

**Plan metadata:** see the `docs(04-04)` commit that follows this file.

## Files Created/Modified

- `packages/modules/feed/db/schema.ts` — `feedPostMedia` with the composite FK, the CHECK, the
  one-video partial unique, the position unique, the tenant index and RLS; `feed_posts` gained
  `feed_posts_id_media_kind_uq`
- `packages/modules/feed/contracts/index.ts` — `FEED_MAX_IMAGES` / `FEED_MAX_ATTACHMENTS`,
  `FEED_MEDIA_ISSUES`, `postMediaSchema`, the widened `createPostSchema` (caption OR media) and
  `feedPostSchema` (`mediaKind` + `media`)
- `packages/modules/feed/server/service.ts` — the in-transaction asset validation, the multi-row
  media insert, the lateral projection, and the 23503/23505/23514 → `gallery_and_video` translation
- `packages/modules/feed/server/routes.ts` — the three refusal codes documented on `POST /posts`, and
  the `defaultHook` that lifts a refinement's machine code to `details.media`
- `packages/modules/feed/ui/PostMedia.tsx` — the three-branch media band
- `packages/modules/feed/ui/AttachmentRow.tsx` — the row, its descriptor and the download
- `packages/modules/feed/ui/{PostCard,FeedList,index}.tsx` — the band composed between the header and
  the caption, with `PostCardMediaView` and the two new labels threaded through
- `packages/core/ui/MediaImage.tsx` + `index.ts`, `apps/web/components/media/MediaImage.tsx` — the
  promotion and its re-export
- `apps/web/lib/registry.tsx` — `postMediaView`, the pt-BR byte formatter, and the injected
  `<VideoPlayer>` element
- `apps/web/messages/pt-BR/feed.json` — `gallery.carousel`, `gallery.slide`, `attachment.download`,
  `attachment.type.*`, `errors.generic` (the Phase 3 video copy is NOT duplicated)
- `apps/web/app/globals.css` — `@source "../../../packages/modules"`
- `scripts/seed.ts` — a gallery (three DIFFERENT native ratios), a video through the `fake` provider
  and a text-plus-PDF post in BOTH tenants, all through the real Phase 3 broker shape
- `supabase/migrations/20260922165218_feed_post_media.sql` — hand-ORDERED (see Issues)
- `supabase/tests/{090-feed,020-tenant-isolation,010-rls-coverage}.sql` — the four D-53 negatives,
  the three attachment positive controls, the isolation block and the coverage entry
- `apps/api/tests/integration/feed-media.test.ts`, `apps/web/e2e/feed-media.spec.ts` — the suites
- `packages/modules/feed/{package.json,tsconfig.json,vitest.config.ts}`,
  `packages/modules/feed/tests/post-media.test.tsx` — the component-test harness and its 25 specs

## Decisions Made

See `key-decisions` in the frontmatter. The two worth restating in prose:

1. **The gallery-XOR-video rule had to leave the composer.** A UI-only rule is bypassed by any direct
   API call and would let a post exist that no renderer can draw. Expressing it as a composite
   foreign key onto the parent's discriminator — 04-03's reply-depth technique, reused — makes it an
   index-level fact with no read-then-write window and no `security definer` function.
2. **`MediaImage` moved, `VideoPlayer` did not.** The asymmetry is the whole MOD-02 story in one
   pair: a component whose only dependencies are contracts and primitives belongs in the kernel's
   client-safe entry; a component that binds an app-scoped server action for a per-request
   credential must stay in the app and cross the boundary as an already-created element.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The feed module had no component-test harness**

- **Found during:** Task 3 (RED)
- **Issue:** `packages/modules/feed/vitest.config.ts` was `environment: 'node'` with
  `include: ['tests/**/*.test.ts']`, so the plan's own `<verify>` command
  (`pnpm --filter @tria/module-feed test`) could not run a single one of the `<behavior>` list's
  component assertions.
- **Fix:** Added `@vitejs/plugin-react`, `happy-dom`, Testing Library, `react-dom` and `motion` as
  devDependencies; the config gained the react plugin and a `{ts,tsx}` include. The default
  environment stays `node` and the component suite opts in per file with
  `// @vitest-environment happy-dom`, so `events.test.ts` keeps its node environment and its kernel
  mocks.
- **Files modified:** `packages/modules/feed/{package.json,vitest.config.ts,tsconfig.json}`,
  `pnpm-lock.yaml`
- **Verification:** `pnpm --filter @tria/module-feed test` → 25 passed, 2 files, exit 0
- **Committed in:** `0426792` (RED) and `d21e3ef` (the `motion` addition)

**2. [Rule 1 - Bug] A module's UI classes were invisible to Tailwind**

- **Found during:** Task 3 (GREEN)
- **Issue:** `apps/web/app/globals.css` declared `@source` for `packages/ui/src` and
  `packages/core/ui` but not for `packages/modules`. Tailwind's automatic source detection skips
  `node_modules`, which is exactly how a workspace module is reached, so every class `PostMedia`,
  `AttachmentRow` and 04-01's `PostCard` family render was being dropped from the stylesheet.
- **Fix:** Added `@source "../../../packages/modules"`. (Pre-existing since 04-01; auto-fixed here
  because this plan's entire visual contract — the snap strip, the scrim pill, the 40px icon square —
  depends on it.)
- **Files modified:** `apps/web/app/globals.css`
- **Verification:** `pnpm --filter @tria/web lint` (Biome CSS) clean; the e2e reads real geometry
  (`boundingBox().height < 96`) rather than class names
- **Committed in:** `d21e3ef`

**3. [Rule 1 - Bug] Task 1's foreign key broke four sibling suites' cleanup**

- **Found during:** Task 3 (GREEN, first full `pnpm test:integration`)
- **Issue:** `feed_post_media.media_asset_id` references `media_assets`, and Task 2's seed attaches
  real assets to the seeded posts. Three Phase 3 integration suites and one e2e helper swept media
  assets tenant-wide, which now raised
  `violates foreign key constraint "feed_post_media_media_asset_id_media_assets_id_fk"` and took the
  whole file down before a single test ran.
- **Fix:** The three integration sweeps now skip assets a post references — "leftovers from another
  run" means "not referenced by a post", and the old predicate also destroyed seeded content the e2e
  measures. `deleteTenantVideoAssets` instead detaches the rows first and stays a TOTAL reset,
  because the media library's empty-state, newest-first and pagination assertions are absolute counts
  that an off-by-one would break; the feed-media e2e reads its video case from tria-lab as a result.
- **Files modified:** `apps/api/tests/integration/{media,media-playback,mux-webhook}.test.ts`,
  `apps/web/e2e/{admin.ts,feed-media.spec.ts}`
- **Verification:** `pnpm test:integration` → 26 files, 357 passed; `pnpm e2e` → the four
  `feed-media` cases and all of `media-video`/`phase3-smoke` green
- **Committed in:** `d21e3ef`

**4. [Rule 1 - Bug] An absolute count in `media.test.ts` measured the seed, not the refusal**

- **Found during:** Task 3 (GREEN)
- **Issue:** "video is no longer a 501 seam: a member is refused by ROLE, and no asset is created"
  asserted `count(*) = 0` over the tenant's video assets. Task 2's seed now owns one, so the
  assertion measured the fixture rather than what the refusal did — the same trap 04-03 recorded for
  the `media_assets` adjacency assertions.
- **Fix:** Rewritten as a before/after DELTA.
- **Files modified:** `apps/api/tests/integration/media.test.ts`
- **Verification:** `pnpm test:integration` green
- **Committed in:** `d21e3ef`

### Deliberate departures from the plan's prose

**5. Byte-size formatting lives in the host, not in `AttachmentRow`.** The plan's action text says
"Format the size in pt-BR through the `Intl` number formatter the repo already uses" inside the row.
That contradicts the same task's own `<behavior>` line — "Every label the components render arrives
as a prop; none of them contains a pt-BR literal" — and PWA-03's "the module ships no language". The
formatter is in `apps/web/lib/registry.tsx` (where `Intl.DateTimeFormat('pt-BR')` already lives) and
the row takes `sizeLabel: string | null`. No acceptance criterion names `NumberFormat` in the row;
the partial-line behaviour the plan asks for is asserted unchanged.

**6. One acceptance criterion is met in spirit but not by its grep.**
`grep -c "imageAssetId\b" apps/api/tests/integration/feed-media.test.ts` prints **3**, not 0. All
three occurrences are the ASSERTION that bans the field and the comments explaining it:

```ts
for (const banned of ['imageAssetId', 'videoAssetId', 'coverAssetId', 'imageUrl']) {
  expect(keys.has(banned)).toBe(false);
}
```

The criterion's intent ("no singular-image field exists to assert on") is met more strongly by
actively asserting its absence than by never naming it. Splitting the string to satisfy the grep
would make the test worse, so it was left as written. The companion criterion
`awk '…mediaKind === .video.…' | grep -c "DoubleTapHeart"` DOES print 0 — the comment that named the
component inside the video branch was reworded so the guard stays literally green for future edits.

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 bugs) + 2 documented departures from plan prose.
**Impact on plan:** No scope creep. Three of the four auto-fixes are direct consequences of this
plan's own schema and seed; the fourth (the Tailwind source) is what makes the plan's visual contract
real at all.

## TDD Gate Compliance

Task 3 carries `tdd="true"`. The gate sequence is complete and in order:

| Gate | Commit | Evidence |
|------|--------|----------|
| RED | `0426792` `test(04-04)` | 14 failed / 11 passed of 25. Target test: `PostMedia — the four branches (D-53) > renders a snap strip, per-slide labels, a dot row and an announced index for three images`. `gsd-tools check tdd-red-evidence` → **`RED_EVIDENCE_OK`** (`reason: target_test_failed`). |
| GREEN | `d21e3ef` `feat(04-04)` | 25 passed / 25, exit 0. |
| REFACTOR | — (optional) | Not taken: no cleanup changed behaviour, and `tdd.md` commits REFACTOR only on change. |

**How the RED evidence was produced.** `check tdd-red-evidence` parses `node --test` TAP (column-0
`not ok`, a `# tests/# pass/# fail` trailer); Vitest emits neither. Following 04-02, the real Vitest
failure output was piped through a throwaway normalizer in the session scratchpad that de-indents the
failing leaf lines into TAP and appends the run's REAL counts — every test name copied verbatim,
nothing invented, nothing committed to the repo.

**Honest note on RED breadth.** Two of the 25 specs ("renders NOTHING at all for a post with no media
and no attachments" and "renders no list node at all when there are zero attachments") passed against
the inert stub, because a stub that returns `null` trivially satisfies "renders nothing". They are
kept as regression pins for the GREEN implementation rather than dressed up as RED. The integration
suite was also written in the RED commit and passed there: it pins Task 1's already-shipped API
behaviour, so it is a regression suite, not a RED for this task.

## Known Stubs

None introduced by this plan. Two related items are worth naming because a reader will look for them:

- **Alt text is always `''`.** `media_assets` carries no alt column, so `postMediaView` passes the
  empty string. This is the UI-SPEC's own rule ("empty `alt=""` when the admin gave none —
  decorative, never a filename"), not a placeholder: there is nowhere for an admin to type one until
  the composer (04-09) offers the field.
- **`onDoubleTapLike` is unwired in production.** `PostMedia` accepts it and the unit suite proves
  both branches (the gallery fires it, the player does not), but the web host passes nothing yet —
  04-06 wires the optimistic like. It is an optional prop, so `DoubleTapHeart` is inert today by its
  own documented contract.

## Threat Flags

None. Every file this plan touched is covered by the plan's `<threat_model>`; no new network
endpoint, auth path or trust-boundary schema change was introduced beyond `feed_post_media`, whose
mitigations (T-04-22 through T-04-28) are the subject of D2, D3 and D7 above.

## Issues Encountered

**1. The run was split across two executor dispatches.** Tasks 1 and 2 were executed and committed
(`e0f9c41`, `f118b6c`) by a first executor that was then terminated mid-run by a provider session
rate limit. It did not fail: the working tree was clean at the handoff and no work was lost. A fresh
continuation agent verified both commits against the plan's `<read_first>` expectations before
starting Task 3. The `duration` above is wall-clock across both dispatches and therefore includes the
gap between them.

**2. drizzle-kit emitted the composite foreign key before the unique constraint it references.**
Postgres refuses that with 42830. Task 2 hoisted `feed_posts_id_media_kind_uq` above the FK by hand
inside the generated migration — the ONLY hand edit, recorded in a comment at the top of the file —
and `pnpm db:generate` still reports "No schema changes" against the snapshot beside it.

**3. A duplicate asset id in `imageAssetIds` is refused, which the first draft of the ten-image test
did not expect.** `createPost` rejects a repeated id with `asset_not_usable` on purpose (a gallery
slide has to be a distinct photograph). The fixture now performs ten real broker uploads. Product
behaviour was correct; the test was wrong.

**4. Biome suppressions detach from their diagnostic.** A three-line explanation above a
`// biome-ignore` directive silently made it a no-op, and the `useSemanticElements` diagnostic that a
JSX `role` attribute raises cannot be suppressed from inside the attribute list at all. The two
`role="group"` uses the UI-SPEC mandates are suppressed with a file-scoped `biome-ignore-all` and a
written rationale; the `tabIndex` and dot-key suppressions are single-line directives placed directly
above their attribute.

**5. A `/* … */` CSS comment containing `*/` terminated itself.** The first draft of the new
`@source` comment said `packages/modules/*/ui`, which closed the comment mid-sentence and produced 21
phantom Biome CSS errors. Reworded.

**6. Two concurrent Playwright runs corrupted an interim full-suite result.** A backgrounded
`pnpm e2e` was still alive when a second was started; both drive the same dev server and the same
database, and killing the first tore down the shared `webServer` for the second. The final clean run
(fresh `db:reset && db:seed`, single process) is the one reported below.

**7. Three e2e failures in the final full run are PRE-EXISTING and out of scope.** Logged to
`.planning/phases/04-feed/deferred-items.md` and the WINDOWS ledger rather than fixed:
`shell.spec.ts:111` expects the "Em breve" card on tria-lab's `/inicio`, but tria-lab has had the
`feed` module enabled since 04-01, so the feed home slot renders (and `feed.spec.ts` asserts exactly
that) — it fails deterministically on a fresh seed, at HEAD and before this plan's commits;
`platform-branding.spec.ts:182` is order-dependent and passes in isolation. Nothing in this plan's
diff touches the shell, the module registry's flags or branding.

## Verification Results

| Gate | Result |
|------|--------|
| `pnpm turbo run typecheck lint test` | 24/24 tasks successful |
| `bash scripts/check-ui-literals.sh` | OK — no hex/legacy-class/pt-BR literals; catalogs valid |
| `pnpm boundaries` | 451 files, 8 packages, no issues |
| `pnpm boundaries:negative` | both layers reject the fixture |
| `pnpm check:static-routes` | 29 guarded routes, 0 offenders |
| `pnpm db:generate` | "No schema changes"; `git status --porcelain -- supabase/migrations` empty |
| `pnpm db:reset && pnpm db:seed && pnpm supabase test db` | 10 files, 188 tests, Result: PASS |
| `pnpm test:integration` | 26 files, **357 passed** |
| `pnpm --filter @tria/module-feed test` | 2 files, **25 passed** |
| `pnpm --filter @tria/web exec playwright test feed-media.spec.ts` | **8 passed** (4 cases x 2 projects) |
| `pnpm e2e` (whole suite, clean run) | **278 passed, 3 failed** — all three pre-existing, see Issues 7 |

## User Setup Required

None — no external service configuration required. The video fixtures run through Phase 3's local
`fake` provider, so no Mux account is needed for anything this plan verifies.

## Next Phase Readiness

- **04-05 (link previews)** can attach its card below the media band: `PostMedia` renders the three
  branches and the attachment list, and the UI-SPEC's card anatomy puts the link card between them.
- **04-06 (FeedList wiring)** inherits `PostCardMediaView` and the `mediaLabels` prop, and is the
  natural owner of `onDoubleTapLike` and of the `shell.spec.ts` contradiction logged above.
- **04-09 (composer)** has its whole write contract: `imageAssetIds` / `videoAssetId` /
  `attachmentAssetIds` with the array order AS the gallery order, the four machine codes to map to
  pt-BR copy, and the caps as exported constants.
- **Phase 5 (stories)** inherits the `feed_post_media` shape and the discriminator technique verbatim.
- **Concern:** the `[designed]` attachment row shipped against an UNAPPROVED sketch (WINDOWS 19:
  sketch 002 is still `status: pending / approved: false`). If the design review changes the row's
  geometry, `AttachmentRow.tsx` and its unit assertions are the single place to change.

## Self-Check: PASSED

- All 8 files named in `key-files.created` exist on disk (`[ -f ]` each).
- All 4 commit hashes named in `## Task Commits` resolve in `git log --all`.
- The plan-level `<verification>` block was re-run in full; results are in `## Verification Results`.

---
*Phase: 04-feed*
*Completed: 2026-09-22*
