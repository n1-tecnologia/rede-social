---
phase: 05-communities-stories
verified: 2026-09-24T02:05:00Z
status: gaps_found
score: 13/15 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/05-communities-stories/05-01-PLAN.md"
  - ".planning/phases/05-communities-stories/05-01-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-02-PLAN.md"
  - ".planning/phases/05-communities-stories/05-02-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-03-PLAN.md"
  - ".planning/phases/05-communities-stories/05-03-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-04-PLAN.md"
  - ".planning/phases/05-communities-stories/05-04-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-05-PLAN.md"
  - ".planning/phases/05-communities-stories/05-05-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-06-PLAN.md"
  - ".planning/phases/05-communities-stories/05-06-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-07-PLAN.md"
  - ".planning/phases/05-communities-stories/05-07-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-08-PLAN.md"
  - ".planning/phases/05-communities-stories/05-08-SUMMARY.md"
  - ".planning/phases/05-communities-stories/05-REVIEW.md"
  - ".planning/phases/05-communities-stories/05-VALIDATION.md"
  - "apps/web/components/stories/StoryVideo.tsx"
  - "apps/web/components/stories/StoryViewerHost.tsx"
  - "packages/core/ui/MediaImage.tsx"
  - "packages/modules/communities/db/schema.ts"
  - "packages/modules/communities/server/service.ts"
  - "packages/modules/feed/server/service.ts"
  - "packages/modules/stories/db/schema.ts"
  - "packages/modules/stories/server/service.ts"
  - "packages/modules/stories/ui/StoryViewer.tsx"
  - "supabase/tests/110-communities-stories.sql"
covered_digest: "v1:sha256:1e194b8e3b8388d2b8033f6a2ac7712c91b54d73b9bae00d9d25b0a9e078d1ea"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "No Phase 5 write may persist or reveal another tenant's data (TENANT-05, D-23 existence-oracle rule, project core value 'zero leakage between tenants')"
    status: failed
    reason: "createCommunity and updateCommunity write the client-supplied coverAssetId straight into communities with NO validation. Every sibling write path in the same phase validates: publishStory resolves the asset inside withTenantTx and checks tenant, purpose and kind before answering a bare 404; feed's validateAssets checks kind, purpose and status. The communities FK is single-column (REFERENCES media_assets(id)) and Postgres referential integrity runs as the table owner, bypassing RLS — so another tenant's asset id persists. The 23503-vs-201 split is a cross-tenant existence oracle, and the 23503 surfaces as an unhandled 500."
    artifacts:
      - path: "packages/modules/communities/server/service.ts"
        issue: "insertCommunity (line ~324) and the PATCH branch (line ~399-419) interpolate input.coverAssetId with no SELECT against media_assets — no tenant check, no purpose = 'cover' check, no status check"
      - path: "packages/modules/communities/db/schema.ts"
        issue: "coverAssetId (line 76) is a single-column reference to mediaAssets.id, so RI alone cannot enforce the tenant"
    missing:
      - "Resolve the cover asset inside the same withTenantTx (RLS supplies the tenant) before the insert/update, exactly as publishStory does"
      - "Refuse a foreign, unknown or soft-deleted id with ONE bare 404 (no details payload) so no existence oracle remains"
      - "Refuse a real asset of this tenant carrying the wrong purpose/kind/status with the closed VALIDATION_FAILED code"
      - "An integration case in apps/api/tests/integration/isolation.test.ts proving a cross-tenant cover id answers 404, with its same-tenant positive control"
  - truth: "STORY-02: tapping a circle opens a full-screen viewer with segmented progress bars, auto-advance, tap-to-navigate and hold-to-pause (roadmap SC 3)"
    status: failed
    reason: "Both media paths into the viewer are defective, and the phase's green unit suite structurally cannot see either: story-viewer.test.tsx stubs the media prop with a plain div, so the real MediaImage and StoryVideo are never rendered under the viewer. IMAGE path — MediaImage's mount effect depends on [assetId, onReady, onFailed] while StoryViewer rebuilds controlsFor (and therefore onLoad/onError) on every render, and controls.onLoad sets a fresh object into mediaState; once the image is decoded the effect calls onReady on every pass and the pair spins without bound. VIDEO path — StoryVideo attaches canplay/playing/timeupdate/error in an effect keyed on [tokens, onPlayRef], but MuxPlayer is next/dynamic(..., { ssr: false }) so the mux-player element does not exist on the commit where tokens first becomes non-null; querySelector returns null, the effect returns early, and neither dep ever changes again."
    artifacts:
      - path: "packages/core/ui/MediaImage.tsx"
        issue: "Lines 77-87: the effect calls onReady?.() whenever img.complete && naturalWidth > 0, with onReady in its own dependency array. VERIFIER REPRO: a probe rendering MediaImage under a parent that rebuilds onReady each render (the viewer's exact shape) ran to FATAL ERROR: JavaScript heap out of memory after ~168 s."
      - path: "apps/web/components/stories/StoryVideo.tsx"
        issue: "Lines ~92-125: querySelector('mux-player') on the tokens-set commit, before the dynamic chunk has mounted the custom element; onPlayRef is a stable useCallback([]) in StoryViewerHost, so the effect never re-runs"
      - path: "packages/modules/stories/ui/StoryViewer.tsx"
        issue: "Line 416 — progress for a video is videoProgress[currentId] ?? 0, fed only by onTimeUpdate; with no listener it stays 0 forever and goNext is never reached. Line 300 — controlsFor is a render-time factory, which is what destabilises MediaImage's deps."
      - path: "packages/modules/stories/tests/story-viewer.test.tsx"
        issue: "Line 101 — media is stubbed as () => <div/>, so no test exercises the real media integration"
    missing:
      - "Stabilise the media control callbacks (useCallback/useEffectEvent or a ref) so MediaImage's effect deps cannot change every render, OR drop onReady/onFailed from MediaImage's dependency array and read them through a ref"
      - "Make StoryVideo resilient to the dynamic mount: attach via a ref callback on the player, a MutationObserver, or mux-player's own React event props rather than a one-shot querySelector"
      - "A test that renders the viewer over the REAL MediaImage and asserts a bounded render count after load"
      - "A test or e2e that opens a VIDEO story in the viewer and asserts the progress segment advances"
      - "CR-03: MediaImage returns the fallback without calling onFailed when the variant ladder is empty (widths.length === 0 → src === null → early return, and imgRef.current is null so the effect cannot report it). listCommunityHighlights deliberately omits the a.status = 'ready' filter, so a pinned not-ready asset reaches the viewer and leaves it in mediaState 'loading' forever — the clock is gated on currentState === 'ready', so there is no progress, no auto-advance, no error copy and no retry."
      - "CR-04: the autoplay play badge and the media-error retry are rendered INSIDE the div that carries onPointerDown/onPointerMove/onPointerUp, without pointer-events isolation, so a tap on either also runs the stage's tap-zone maths and advances the story"
deferred: []
human_verification:
  - test: "Open the story viewer on a phone (or a mobile emulation profile) with a cached/already-decoded story image and watch CPU and battery for 30 s"
    expected: "The bar fills smoothly and the tab stays idle between frames"
    why_human: "The verifier's unit probe OOMs, but the phase's Playwright run reported green on the 900 ms fill assertion — React yields between passive-effect cascades, so a short assertion can pass over a page that is already spinning. Only a real device/DevTools profile settles how bad it is in production."
  - test: "Publish a VIDEO story as admin_tenant, wait for it to become ready, then open it from the /inicio strip"
    expected: "The segment fills from the video's own time and auto-advances (or closes) when the video ends"
    why_human: "No unit test or e2e covers a video story inside the viewer; the seed fixture is image-only, so the failure is invisible to the suite."
  - test: "Pin a story whose video is still transcoding to a community, then open the community's Destaques circle"
    expected: "The viewer shows an error or a placeholder with a reachable close control — it must not sit in a permanent loading state"
    why_human: "Reaching this requires a real not-ready asset with an empty variant ladder; no fixture produces one."
  - test: "In the viewer, tap the centred play badge on a blocked-autoplay video, and tap the retry under the media-error copy"
    expected: "The badge starts playback and the retry re-attempts the media — neither advances to the next story"
    why_human: "Gesture-layer interaction ordering; grep can see the missing pointer-events isolation but not the resulting behaviour."
  - test: "Backstop (05-04): a 60-character community name at 24/700 on a 320px viewport"
    expected: "Wraps to at most three lines without clipping the cover above it"
    why_human: "Declared verification: backstop — a visual claim with no automated evidence in the phase"
  - test: "Backstop (05-05): a 40-character tenant display name on /inicio above the strip"
    expected: "The strip carries no tenant string; the welcome heading above it absorbs the length as Phase 2 pinned it"
    why_human: "Declared verification: backstop"
  - test: "Backstop (05-06): a 25-story sequence at 320px"
    expected: "Every progress segment stays at least 2px wide and the bar row does not wrap"
    why_human: "Declared verification: backstop"
  - test: "Backstop (05-08): a 90-character story caption and a 40-character community name in one history row at 320px"
    expected: "Both truncate with a title attribute while the row keeps its minimum height"
    why_human: "Declared verification: backstop"
  - test: "Backstop (05-08): twelve communities with 40-character names in the pin sheet"
    expected: "Each truncates while the switch stays fully reachable inside the 80%-height sheet"
    why_human: "Declared verification: backstop"
  - test: "Review the 14 flagged prohibitions carried unverified across the eight plans (see the Prohibitions section)"
    expected: "Each must-NOT is judged still honoured by the shipped code"
    why_human: "All 14 carry status: unverified with verification: flagged — they fail closed and need explicit human resolution"
---

# Phase 5: Communities & Stories Verification Report

**Phase Goal:** `admin_tenant` organizes content into communities and broadcasts 24 h stories; members browse communities with their posts and pinned stories, and watch stories in a full-screen viewer with the complete gesture set.
**Verified:** 2026-09-24T02:05:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Mode note (read first)

ROADMAP.md marks this phase `mode: mvp`, but the phase goal is not in User Story form. `gsd_run query user-story.validate` returns `valid: false` on all three slots, so the MVP-mode "User Flow Coverage" section cannot be produced honestly. Rather than refuse the verification the caller asked for, this report falls back to standard goal-backward verification against the roadmap's five Success Criteria, which are the stronger contract. Someone should either set a real User Story goal (`/gsd mvp-phase 05`) or drop `mode: mvp` from this phase, so the next verifier is not put in the same position.

## Goal Achievement

### Observable Truths

| # | Truth (roadmap Success Criterion / plan must-have) | Status | Evidence |
|---|---|---|---|
| 1 | SC-1a — `admin_tenant` creates, edits and archives a community (name, description, cover image) | ✓ VERIFIED | `createCommunity`/`updateCommunity`/archive in `packages/modules/communities/server/service.ts`; full-screen `/comunidades/nova` and `/comunidades/[communityId]/editar`; shared `CommunityForm.tsx` with `purpose: 'cover'` on the Phase 3 signed-upload hook (line 117). The capability exists end to end — its security defect is scored once, on truth 13. |
| 2 | SC-1b — the main feed merges tenant-wide and community posts in one query, one ordering | ✓ VERIFIED | `listFeed` switches the predicate on `communitiesEnabled` (service line 335-340) with the D-74 `and p.community_id is null` fallback; `feed_posts_tenant_created_all_idx` exists in `packages/modules/feed/db/schema.ts:151` and in migration `20260923185730_feed_communities.sql:46`; `supabase/tests/090-feed.sql:519` pins the index BY NAME in an `EXPLAIN` assertion with a `Seq Scan` negative at 510 |
| 3 | SC-1c / COMM-02 — every tenant member sees every community; `community_members` exists for V2 | ✓ VERIFIED | The list read never joins `community_members`; the table is declared in `communities/db/schema.ts:125-131` with `tenantIsolationPolicy` and `.enableRLS()`; `010-rls-coverage.sql:116` enumerates both tables with no exemption and `020-tenant-isolation.sql` carries their two-tenant cases with positive controls |
| 4 | SC-1d / COMM-04 — the admin posts directly into a community from its page | ✓ VERIFIED | `apps/web/app/(app)/comunidades/[communityId]/page.tsx:243` renders `ComposeFab` with `createHref={/criar?comunidade=${community.id}}`; `ComposerForm.tsx:115` resolves the destination server-side; `listCommunityFeed` and the archived-target refusal live in the feed service |
| 5 | SC-2 — member browses the community list (cover, name, description, post count) and opens a community to see its posts and its pinned stories | ✓ VERIFIED | `CommunitiesList.tsx` + `CommunityCard.tsx` + `CommunityCover.tsx` (gradient fallback); the community page renders the Destaques row from `listCommunityHighlights`; `110-communities-stories.sql` assertions 47-53 prove the highlights join. (Opening a Destaques circle lands in the viewer — see truth 8.) |
| 6 | SC-3a / STORY-01 — the admin publishes an image or short-video story with an optional caption from a phone | ✓ VERIFIED | `/stories/publicar` route + `StoryComposer.tsx` over the shipped `useSignedUpload`; `publishStory` resolves the asset inside the transaction and checks `purpose = 'story'` and kind (service lines 346-356); the ~60 s cap stays with the worker's async `duration_too_long` refusal |
| 7 | SC-3b — members see active stories in a horizontally scrollable strip | ✓ VERIFIED | `StoriesStrip.tsx`/`StoryCircle.tsx`; `apps/web/lib/registry.tsx:339-402` registers `stories: { home: [storiesHome] }` at order 5 with the `stories.story.publish` gate on the own-circle; `listActiveStories` filters `expires_at > now()` and `a.status = 'ready'` |
| 8 | SC-3c / STORY-02 — a full-screen viewer with progress bars, auto-advance, tap-to-navigate and hold-to-pause | ✗ FAILED | Image path: verifier probe of `MediaImage` under the viewer's render-time `controlsFor` factory ran to `FATAL ERROR: JavaScript heap out of memory` — an unbounded effect↔render loop. Video path: `StoryVideo` queries for `mux-player` on the commit where the `next/dynamic(ssr:false)` chunk has not mounted it, so no `canplay`/`timeupdate` listener ever attaches and `videoProgress` stays 0 (`StoryViewer.tsx:416`). Plus CR-03 (empty ladder → permanent `loading`, no `onFailed`) and CR-04 (badge/retry inside the gesture stage). |
| 9 | SC-4a / STORY-03 — a story leaves the strip 24 h after publishing, hidden by `expires_at`, record retained, no cron | ✓ VERIFIED | `stories.expires_at` is a plain `timestamptz` with the volatile default and a `check (expires_at > published_at)`; `stories_tenant_expires_idx` serves both the strip and the history; `110-communities-stories.sql` assertions 4 and the §307-335 block prove it under a transaction-controlled clock, including that the expired row is still selectable by id |
| 10 | SC-4b / STORY-04 — a pinned story stays visible on its communities after expiry until unpinned | ✓ VERIFIED | `story_community_pins` with its unique pair, community index, RLS and hard-delete docblock; `listCommunityHighlights` carries no expiry predicate; `110-communities-stories.sql` assertions 48-53 assert the invariant with the precondition, the deliberately-disagreeing strip predicate, and two positive controls |
| 11 | SC-5a — a member can like a story | ✓ VERIFIED | `likeStory` inserts by SELECTing the story rather than trusting the path parameter (service ~480); `feed_likes_story_uq` is the idempotency arbiter; the story branch of the like-counter trigger ships; `stories.spec.ts:470` exercises the heart end to end |
| 12 | SC-5b — a member can comment on a story; likes and replies on story comments are rejected by the API AND the DB | ✓ VERIFIED | The generated `target_kind` discriminator, the three-column self-FK and the two-column like FK, the null-guarded rewritten CHECKs and the Pitfall-1 probe are all in `110-communities-stories.sql` (throws_ok at 361, 396, 503, 517, 541, 554, 569…), each with its positive control; `listStoryComments` pages ascending on its own index; the service translates 23503/23514 into the two new closed codes |
| 13 | Phase-wide — no Phase 5 write may persist or reveal another tenant's data (TENANT-05, D-23, project core value) | ✗ FAILED | `createCommunity`/`updateCommunity` accept any `coverAssetId` in the platform with no tenant, purpose, kind or status check, against a single-column FK whose RI bypasses RLS. Every sibling write in the same phase validates. A random uuid → 23503 → unhandled 500; a real foreign asset id → 201. That difference is a cross-tenant existence oracle. |
| 14 | 05-02 — the D-33 / UI-04 design gate is real and enforced before the five prototype-less surfaces are coded | ✓ VERIFIED | `.planning/sketches/003-phase-05-designed-screens/{index.html,README.md}` exist; README frontmatter reads `approved: true` / `approved_by: Igor Vilas Boas` / `2026-09-23`; MANIFEST row 003 records the provisional approval; the six gated tasks carried `precondition` elements |
| 15 | MOD-04 — both new modules toggle in both directions with no migration and no route edit | ✓ VERIFIED | `apps/api/src/modules/registry.ts:27,29` register `communities` and `stories`; `apps/web/e2e/phase5-smoke.spec.ts` runs the enabled case, the disabled case per module (surface absent, routes 404), the flip-back-on case, and a rows-survived-every-flip case |

**Score:** 13/15 truths verified (0 present, behavior-unverified)

### Deferred Items

None. Phase 6 (Events), Phase 7 (Notifications/Chat) and Phase 8 (Moderation & Pilot Hardening) contain nothing that specifically addresses either gap. Phase 8's "isolation" go-live gate is a pilot-wide check, not a commitment to fix a Phase 5 write path, so under the conservative matching rule neither gap is deferred.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/modules/communities/db/schema.ts` | communities + community_members, RLS, activity keyset index, tenant-unique slug | ✓ VERIFIED | `tenantIsolationPolicy` on both; `coverAssetId` nullable as required |
| `packages/modules/communities/server/service.ts` | listCommunities (keyset), getCommunity, createCommunity, all in withTenantTx | ⚠️ HOLLOW | Exists, substantive, wired, real queries — but the cover-asset write path is unvalidated (gap 1) |
| `packages/modules/communities/server/routes.ts` | the three routes behind requireAuth → requireModule → requirePermission | ✓ VERIFIED | — |
| `packages/modules/communities/module.ts` | manifest: nav tab, community.created, admin default permission | ✓ VERIFIED | registered in the API registry |
| `packages/modules/communities/ui/{CommunityCard,CommunityCover,CommunityHeader,CommunityPickerSheet}.tsx` | list card, dual-geometry cover, owner-less header, shared picker body | ✓ VERIFIED | all four present and imported |
| `apps/web/app/(app)/comunidades/**` | list page, client list, form, [communityId] page, nova, editar, not-found, actions | ✓ VERIFIED | all present |
| `packages/modules/feed/db/schema.ts` | community_id FK + the third non-partial index | ✓ VERIFIED | `feed_posts_tenant_created_all_idx:151` |
| `packages/modules/feed/server/service.ts` | D-73/D-74 predicate switch, community summary join, listCommunityFeed | ✓ VERIFIED | `left join public.communities c` at 162 |
| `packages/modules/stories/db/schema.ts` | stories, expires_at window, counters, expiry index, story_community_pins | ✓ VERIFIED | RLS on both tables |
| `packages/modules/stories/server/service.ts` | listActiveStories, publishStory, deleteStory, listOwnStories, listCommunityHighlights, comments | ✓ VERIFIED | substantive, all inside withTenantTx |
| `packages/modules/stories/ui/{useStoryClock,StoryProgressBars,StoryViewer,StoryCircle,StoriesStrip,StoryHistoryRow,PinStorySheet}.tsx` | the viewer stack | ⚠️ HOLLOW | All present and wired; the viewer's media integration is defective (gap 2) |
| `apps/web/components/stories/StoryVideo.tsx` | the video bridge feeding the viewer's clock | ✗ STUB (behaviourally) | Renders, but its listener attachment never runs — the events it exists to forward are never forwarded |
| `packages/core/ui/MediaImage.tsx` | private-image renderer with ready/failed reporting | ⚠️ HOLLOW | Renders, but its effect deps make it unsafe under a render-time control factory, and its empty-ladder branch reports nothing |
| `apps/web/app/(app)/stories/**` | publicar, meus, [storyId], story-actions | ✓ VERIFIED | all present |
| `supabase/tests/110-communities-stories.sql` | counters, archive semantics, STORY-05 battery, pinned-survives-expiry | ✓ VERIFIED | 58 planned assertions, positive controls throughout |
| `supabase/tests/090-feed.sql` | fourth EXPLAIN assertion for the merged feed | ✓ VERIFIED | line 519 |
| `apps/web/e2e/{comunidades,stories,phase5-smoke}.spec.ts` | the three e2e specs | ✓ VERIFIED | present and substantive |
| `.planning/sketches/003-phase-05-designed-screens/**` | the D-33 gate package | ✓ VERIFIED | approved: true |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `apps/api/src/modules/registry.ts` | `packages/modules/{communities,stories}/module.ts` | MODULE_REGISTRY keys | ✓ WIRED (lines 27, 29) |
| `apps/web/lib/registry.tsx` | `packages/modules/stories/ui/StoriesStrip.tsx` | home[0] renderer at order 5 | ✓ WIRED (via `StoriesSurface`) |
| `packages/modules/feed/server/service.ts` | `communities` table | `left join public.communities` in the post projection | ✓ WIRED (line 162) |
| `packages/modules/feed/server/service.ts` | module flags | `communitiesEnabled` chooses the D-73/D-74 predicate | ✓ WIRED (line 335) |
| `apps/web/app/(app)/criar/ComposerForm.tsx` | `CommunityPickerSheet` | shared sheet body with a Check control | ✓ WIRED |
| `apps/web/app/(app)/comunidades/[communityId]/page.tsx` | `StoriesStrip` | Destaques row, pinned source, neutral ring | ✓ WIRED |
| `apps/web/app/(app)/comunidades/CommunityForm.tsx` | `useSignedUpload` | `purpose: 'cover'` | ✓ WIRED (line 117) — but the server never checks that purpose |
| `packages/modules/stories/ui/StoryViewer.tsx` | `useStoryClock` | viewer owns paused/index, hook owns elapsed | ✓ WIRED |
| `packages/modules/stories/ui/StoryViewer.tsx` | `CommentSheet` | the sheet's open state feeds the single paused boolean | ✓ WIRED |
| `StoryViewer` media slot | `MediaImage` / `StoryVideo` | `item.media(controlsFor(item, k))` | ✗ NOT_WIRED (behaviourally) — the image contract loops and the video contract never attaches |
| `packages/modules/stories/server/service.ts` | `story_community_pins` | the Destaques read joins pins with no expiry predicate | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
|---|---|---|---|---|
| `CommunitiesList.tsx` | community page | `getCommunities` → `/v1/communities` → keyset SQL | Yes | ✓ FLOWING |
| `comunidades/[communityId]/page.tsx` | posts | `listCommunityFeed` (real SQL) | Yes | ✓ FLOWING |
| `comunidades/[communityId]/page.tsx` | Destaques | `listCommunityHighlights` (pins join) | Yes | ✓ FLOWING |
| `/inicio` strip | stories | `listActiveStories` (`expires_at > now()`, `status = 'ready'`) | Yes | ✓ FLOWING |
| `/stories/meus` | own stories | `listOwnStories` (same index, range dropped) | Yes | ✓ FLOWING |
| `StoryViewer` | `videoProgress[currentId]` | `controls.onTimeUpdate`, fed only by `StoryVideo`'s listener | No — the listener never attaches | ✗ DISCONNECTED |
| `StoryViewer` | `mediaState[currentId]` for a not-ready asset | `MediaImage.onFailed` | No — the empty-ladder branch returns before reporting | ✗ DISCONNECTED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `MediaImage` is safe under a parent that rebuilds `onReady` every render (the viewer's shape) | purpose-built probe under `packages/core`, then removed | `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory` | ✗ FAIL |
| `MediaImage` settles on the error path | same probe, default happy-dom image | settles at `error`, one pass, no loop | ✓ PASS (the failure branch nulls `imgRef`, which is why only the success branch loops) |
| Phase-5 files carry no `TBD`/`FIXME`/`XXX` | grep over the 75 files changed in the phase's commits | no matches | ✓ PASS |
| Phase-5 files carry no `TODO`/`HACK`/`PLACEHOLDER` | same | no matches | ✓ PASS |
| Full workspace suite | not re-run | the orchestrator reports lint/typecheck/build/unit/pgTAP 285/integration 472/e2e 405 green | ? SKIP (single-run budget; the green result is recorded, not relied on — see below) |

**Why the green suite is not evidence here.** Four of the five critical defects live in code the suite structurally cannot reach: `story-viewer.test.tsx:101` stubs the `media` prop with a plain `<div/>`, no test renders `MediaImage` with an empty `widths` ladder, no test or fixture puts a VIDEO story in the viewer, and no test taps the play badge or the media-error retry. The Playwright viewer spec does open a real image — and can still pass, because React yields between passive-effect cascades, so a 900 ms fill assertion can run over a page that is already spinning. A green run and a broken viewer are compatible states here.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist in this repository and no PLAN or SUMMARY declares a probe path. Step 7c: SKIPPED (no probes declared or discoverable).

### Requirements Coverage

| Requirement | Source plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| COMM-01 | 05-02, 05-04 | create, edit and archive communities (name, description, cover image) | ✗ BLOCKED | Create/edit/archive all ship and work; the cover-image write accepts any asset id in the platform (gap 1) |
| COMM-02 | 05-01, 05-03 | every member sees every community; membership table exists for V2 | ✓ SATISFIED | Truth 3 |
| COMM-03 | 05-01, 05-04, 05-08 | browse the list (cover, name, description, post count); open a community to its posts and pinned stories | ✓ SATISFIED | Truths 5, 10 |
| COMM-04 | 05-03 | post directly into a community from its page | ✓ SATISFIED | Truth 4 |
| STORY-01 | 05-02, 05-05 | publish a story with an image or short video and an optional caption | ✓ SATISFIED | Truth 6 |
| STORY-02 | 05-02, 05-06 | strip + full-screen viewer with bars, auto-advance, tap-to-navigate, hold-to-pause | ✗ BLOCKED | Strip satisfied (truth 7); viewer failed (truth 8) |
| STORY-03 | 05-05 | 24 h visibility, then hidden by `expires_at`, record retained | ✓ SATISFIED | Truth 9 |
| STORY-04 | 05-02, 05-08 | pin to one or more communities; pinned survives expiry until unpinned | ✓ SATISFIED | Truth 10 |
| STORY-05 | 05-06, 05-07 | like and comment on a story; story comments cannot be liked or replied to | ✓ SATISFIED | Truths 11, 12 — the strongest work in the phase |

**Orphaned requirements:** none. All nine IDs REQUIREMENTS.md maps to Phase 5 are claimed by at least one plan's `requirements` frontmatter.

**Note on REQUIREMENTS.md:** COMM-01 and STORY-02 are already marked `[x]` / `Complete` in the traceability table. Both should revert to in-progress until the two gaps close.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/modules/communities/server/service.ts` | ~324, ~399-419 | Client-supplied foreign key written with no validation, inconsistent with every sibling write path in the same phase | 🛑 Blocker | Cross-tenant reference persisted; existence oracle; unhandled 500 |
| `packages/core/ui/MediaImage.tsx` | 77-87 | Effect calls a caller-supplied callback with that callback in its own dependency array | 🛑 Blocker | Unbounded render loop under any caller that rebuilds the callback per render |
| `apps/web/components/stories/StoryVideo.tsx` | ~92-125 | One-shot `querySelector` against a `next/dynamic(ssr:false)` child, keyed on deps that never change again | 🛑 Blocker | Video stories never progress or auto-advance |
| `packages/core/ui/MediaImage.tsx` | 89-96 | Silent early return (`src === null`) on a path the caller is waiting on a callback from | 🛑 Blocker | Viewer hangs in `loading` with no error copy and no retry |
| `packages/modules/stories/ui/StoryViewer.tsx` | ~497-530 | Interactive controls inside a container that owns the tap/drag pipeline, with no pointer-events isolation | ⚠️ Warning | Tapping the play badge or the error retry advances the story instead |
| `packages/modules/stories/ui/StoryViewer.tsx` | 300 | Render-time factory producing the control callbacks consumed as effect deps by children | ⚠️ Warning | Root cause of the image loop; also defeats three memos (review IN-03) |
| `scripts/check-static-routes.sh` | 66-69 | Gate updated for the four community routes but not for `/stories/publicar`, `/stories/meus`, `/stories/[storyId]` | ⚠️ Warning | Three new routes are outside the static-route gate |
| `packages/modules/stories/tests/story-viewer.test.tsx` | 101 | `media` stubbed with a plain div | ⚠️ Warning | The suite cannot observe the viewer's real media contract — this is why the phase shipped green with a broken viewer |

No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK` or `PLACEHOLDER` markers exist in any of the 75 files this phase touched. The debt-marker gate passes cleanly.

### Prohibitions (flagged, unverified)

All 14 prohibitions across the eight plans carry `status: unverified` with `verification: flagged`. Under the fail-closed rule none of them can be absorbed into a passing verdict; each needs explicit human resolution. Spot-reading the code, the two that look closest to the line are:

- 05-06's "the viewer must not mount two different meanings on the same tap" — honoured in intent (`DoubleTapHeart` is absent, the like is an explicit 44×44 control), but CR-04 means a tap on the play badge or the error retry currently does carry a second meaning: it advances.
- 05-04's "archiving must not retroactively hide content members have already seen" — appears honoured: archive is a write gate and a list gate, the merged feed carries no archive predicate, and the pgTAP archive cases are present.

The remaining twelve read as honoured on inspection, but that is a verifier's reading, not a resolution.

### Human Verification Required

#### 1. Real-device profile of the story viewer on an image story

**Test:** Open the viewer on a phone with a cached/decoded story image; watch CPU and memory for 30 s.
**Expected:** The bar fills smoothly and the tab is idle between frames.
**Why human:** The unit probe OOMs, yet the phase's Playwright run reported green on the 900 ms fill assertion. React yields between passive-effect cascades, so a short assertion can pass over a page that is already spinning. Only a device profile settles the production severity.

#### 2. A video story in the viewer

**Test:** Publish a video story as `admin_tenant`, wait for ready, open it from the `/inicio` strip.
**Expected:** The segment fills from the video's own time and auto-advances or closes when it ends.
**Why human:** Nothing in the suite or the seed covers a video story inside the viewer.

#### 3. A pinned, still-transcoding story on a community page

**Test:** Pin a story whose video is transcoding to a community; open its Destaques circle.
**Expected:** An error or placeholder with a reachable close control — never a permanent loading state.
**Why human:** Needs a real not-ready asset with an empty variant ladder; no fixture produces one.

#### 4. The play badge and the media-error retry

**Test:** Tap the centred play badge on a blocked-autoplay video; tap the retry under the media-error copy.
**Expected:** The badge starts playback, the retry re-attempts the media, and neither advances the story.
**Why human:** Gesture-layer ordering; grep sees the missing isolation, not the behaviour.

#### 5-9. The five declared `verification: backstop` claims

05-04's 60-character community name wrap; 05-05's 40-character tenant display name; 05-06's 25-story segment widths; 05-08's 90-character caption plus 40-character name in one history row; 05-08's twelve 40-character names in the pin sheet. All five are visual claims tagged `backstop` in the plans with no automated evidence in the phase. Per the abstain rule they are `insufficient_spec` and route to a human.

#### 10. The 14 flagged prohibitions

See the Prohibitions section above.

### Gaps Summary

Phase 5 built a great deal of genuinely excellent work and then left two holes that the phase's own green suite could not see.

The strongest parts are real and verified against the codebase, not against the SUMMARYs: the STORY-05 refusal is enforced declaratively in the database with a `target_kind` discriminator, two composite foreign keys and null-guarded CHECKs, probed both honestly and while lying, with positive controls in the same pgTAP block; STORY-03's expiry is a read predicate proved under a transaction-controlled clock, including that the expired row is still selectable by id; STORY-04's pinned-survives-expiry invariant is asserted alongside the strip predicate that deliberately disagrees with it, so neither half can pass alone; the merged feed's third index is pinned by name in an `EXPLAIN` assertion with a `Seq Scan` negative; and both modules pass a two-direction flag witness. RLS coverage for all four new tables is enumerated and negatively tested. There are no debt markers anywhere in the 75 files the phase touched.

Two things block the goal.

**The story viewer does not work.** This is the phase's headline surface and Success Criterion 3's second half. The image path contains an unbounded effect↔render loop — `MediaImage`'s mount effect takes `onReady`/`onFailed` as dependencies while `StoryViewer` manufactures fresh copies of both on every render, and once the image is decoded each effect pass calls back into state. A verifier probe reproducing exactly that composition ran to a JavaScript heap OOM. The video path never starts at all: `StoryVideo` looks for `mux-player` on the same commit that first renders it through `next/dynamic(ssr: false)`, finds nothing, and its dependency array guarantees it never looks again — so no `canplay`, no `timeupdate`, `videoProgress` frozen at zero, no auto-advance. Two further defects compound it: an empty variant ladder leaves the viewer in `loading` forever because `MediaImage` returns its fallback without calling `onFailed` (reachable through `listCommunityHighlights`, which deliberately omits the readiness filter), and the play badge and media-error retry sit inside the gesture stage, so tapping either advances the story instead of acting. The unit suite stubs the `media` prop with a plain `<div/>`, which is precisely why all of this shipped green.

**A Phase 5 write can persist and reveal another tenant's data.** `createCommunity` and `updateCommunity` write the client's `coverAssetId` with no check of any kind, against a single-column foreign key whose referential integrity runs as the table owner and therefore bypasses RLS. The same phase shows it knows better twice over: `publishStory` resolves the asset inside the transaction and checks tenant, purpose and kind before answering a bare 404, and the feed's `validateAssets` checks kind, purpose and status. The divergence also creates exactly the existence oracle D-23 exists to forbid — a random uuid raises 23503 and surfaces as a 500, while a real foreign asset id answers 201 — on a product whose stated core value is zero leakage between tenants.

Both gaps are narrow and local. Neither requires re-planning the phase; both require a fix, a test that would have caught it, and a re-verification.

---

_Verified: 2026-09-24T02:05:00Z_
_Verifier: Claude (gsd-verifier)_
