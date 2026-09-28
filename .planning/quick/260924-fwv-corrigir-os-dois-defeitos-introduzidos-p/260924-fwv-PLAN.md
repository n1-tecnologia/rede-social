---
phase: quick-260924-fwv
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/modules/communities/server/service.ts
  - apps/api/tests/integration/communities.test.ts
  - apps/web/app/(app)/comunidades/actions.test.ts
  - apps/web/components/stories/StoryVideo.tsx
  - apps/web/components/stories/StoryViewerHost.tsx
  - apps/web/components/stories/StoryVideo.test.tsx
  - apps/web/components/stories/StoryViewerHost.test.tsx
  - packages/modules/stories/ui/StoryViewer.tsx
  - packages/modules/stories/tests/story-viewer.test.tsx
autonomous: true
requirements: [COMM-01, STORY-02]
tags: [postgres, drizzle, hono, react, vitest, testing-library, stories, communities]

estimate:
  tokens: 90000
  raw_tokens: 90000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "CR-01: a community whose cover asset was retired through the shipped `DELETE /v1/media/{assetId}` still accepts every write — a `{status:'archived'}` PATCH answers 200, and afterwards the stored `communities.cover_asset_id` is null"
    - "CR-01 regression guard: a PATCH that SENDS a cover id the tenant cannot use still answers the bare 404 with no `details` key — communities.test.ts case 31's property is byte-unchanged"
    - "CR-01 regression guard: a PATCH identical to a stored row carrying a USABLE cover is still observably inert — no `updated_at` move and no `community.updated` event (case 31's first half, case 24)"
    - "CR-01: the self-heal is BOUNDED and each of its side effects is pinned — the healing PATCH writes the row (`updated_at` moves) and announces exactly one `community.updated` even though the request carried no cover claim, and an IDENTICAL PATCH immediately after is observably inert again"
    - "CR-02: a tap on `story-autoplay-badge` calls `play()` on the CURRENT story's element and on ZERO neighbour elements, when three adjacent video stories are mounted in the 3-wide window"
    - "CR-02: a neighbour `StoryVideo` leaving the window clears only its OWN play registration; the active story's badge still reaches its own element afterwards"
    - "Each of the two fixes carries a named test that fails before the fix and passes after it — neither fix ships on a suite that structurally cannot see it"
    - "CR-02's pre-fix failure is FORCED by the harness rather than sampled: the test makes a NEIGHBOUR the last writer of today's single `playRef`, so a green pre-fix run of case 14 is a defect in the test and is never read as evidence the bug is absent"
  artifacts:
    - "packages/modules/communities/server/service.ts — one shared cover lookup feeding a throwing `resolveCoverAsset` and a boolean `coverIsUsable`; `updateCommunity` branches on whether the REQUEST carried `coverAssetId`"
    - "apps/api/tests/integration/communities.test.ts — new case 33, the DOMESTIC stale cover, retired through the shipped DELETE endpoint"
    - "apps/web/components/stories/StoryVideo.tsx — `storyId` prop and a two-argument `onPlayRef(storyId, play | null)`"
    - "apps/web/components/stories/StoryViewerHost.tsx — `playRefs` record keyed by story id, `bindPlay(storyId, play | null)`, `onRequestPlay` resolving `item.id`"
    - "apps/web/components/stories/StoryViewerHost.test.tsx — new case 14, three adjacent video stories, per-element `play` spies"
    - "apps/web/app/(app)/comunidades/actions.test.ts — the archive case no longer documents the stale-cover 404 as the intended answer"
    - "packages/modules/stories/ui/StoryViewer.tsx and packages/modules/stories/tests/story-viewer.test.tsx — the two comments that named a Playwright spec as the regression gate for the badge and the error container name no gate at all, and state that the hit-testing half is asserted by no automated test (WR-09)"
  key_links:
    - "`resolveCoverAsset` and `coverIsUsable` MUST share ONE select statement — two copies of the (tenant_id, purpose='cover', kind='image', status='ready', deleted_at is null) tuple rule would eventually disagree, and the weaker one is the one a write path trusts"
    - "`bindPlay`'s `(storyId, play | null)` signature is byte-for-byte the shape `bindCountBump` already uses eight lines above it in the same file — the asymmetry between the two IS the bug, so the fix is the existing idiom, not a second one"
    - "`bindPlay` stays a `useCallback([], …)` and `storyId` is a plain string: `StoryVideo`'s listener effect takes both as dependencies (WR-01), so a fresh inline callback per render would be an unbounded attach/detach loop"
    - "`StoryVideo`'s `onPlayRef` prop has exactly TWO call sites — `StoryViewerHost.tsx:159` and `StoryVideo.test.tsx:211` (case 5). Both must move together or typecheck fails"
---

<objective>
Fix the two defects that Phase 5's own gap-closure round introduced and that the verifier reproduced
RED through shipped endpoints only:

- **CR-01** — `updateCommunity` re-validates the STORED cover on every PATCH, so once the community's
  own admin retires that cover through `DELETE /v1/media/{assetId}`, every later write (rename,
  description edit, archive, reactivate) 404s permanently and the BFF reports
  "Comunidade não encontrada" about a community that is open on the admin's screen.
- **CR-02** — `StoryViewerHost` holds ONE `playRef` for ALL mounted `StoryVideo`s while `StoryViewer`
  mounts a 3-wide neighbour window, so the play badge's gesture-synchronous `play()` reaches whichever
  element attached last — typically an offscreen neighbour — and a neighbour unmount nulls the active
  story's registration.

Purpose: this is the THIRD attempt at this phase. The previous two rounds each shipped fixes that
passed their own tests while breaking something those tests structurally could not see. So each fix
here ships with a test that fails before it and passes after, both tests are named below, and — the
lesson of the first two rounds — **CR-02's pre-fix failure is FORCED by the harness rather than
sampled**: the test chooses which element attaches last and chooses a neighbour, so a green pre-fix
run can only mean the test is broken, never that the bug is gone.

Also folded in: **WR-09**, the third item on GAP B's `missing:` list. Two comment blocks in the
stories module name a Playwright spec as the regression gate for the play badge and for the error
container's `pointer-events-none` half of the CR-04 fix; that spec asserts neither, a count the
verifier re-confirmed at zero. The verifier's own entry accepts "delete the claim" as the remedy, and
that is what Task 2 does — comment text only. It does NOT close SC-3c: the missing browser-level
coverage stays open and stays out of this run's scope, which the user set to CR-01 and CR-02.

Output: two production fixes, two new RED-then-GREEN test cases, one re-framed test comment, two
corrected coverage claims, and a scoped gate run over every suite the change can reach.
</objective>

<execution_context>
@./.claude/gsd-core/workflows/execute-plan.md
@./.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md

# The two defects, with the reproduced RED evidence and the `missing:` lists
@.planning/phases/05-communities-stories/05-VERIFICATION.md
@.planning/phases/05-communities-stories/05-REVIEW.md

# CR-01
@packages/modules/communities/server/service.ts
@apps/api/tests/integration/communities.test.ts

# CR-02
@apps/web/components/stories/StoryViewerHost.tsx
@apps/web/components/stories/StoryVideo.tsx
@packages/modules/stories/ui/StoryViewer.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: CR-01 — validate the cover the REQUEST asserts, never the one the row stores</name>
  <files>packages/modules/communities/server/service.ts, apps/api/tests/integration/communities.test.ts, apps/web/app/(app)/comunidades/actions.test.ts</files>
  <read_first>
    - `packages/modules/communities/server/service.ts` lines 274-310 (`resolveCoverAsset` and its docblock), 373-402 (`insertCommunity`, already correct), 434-500 (`updateCommunity`).
    - `apps/api/tests/integration/communities.test.ts` lines 851-965 (the cover-contract `describe`: `patch`, `post`, `makeCommunity`, `seedAsset`, `demoCommunityCount`, the `beforeAll` fixtures and the `afterAll` sweep) and 1052-1085 (case 31).
    - `apps/api/tests/integration/communities.test.ts` line 74 (the local `request` helper), the `./setup` imports it builds on (`adminSql`, `api`, `HOSTS`, `signInAs`) and the file-local `tokens` record (line ~44) that the `beforeAll` fills.
    - `apps/api/tests/integration/communities.test.ts` lines 47-52 and 110-120 (the file-level `created` list and the sweep that consumes it), 144-156 (the `community.updated` / `community.archived` subscriptions that fill `updatedEvents` / `archivedEvents`), and 813-834 (case 26 — the `updatedEvents.filter((e) => e.communityId === …)` idiom this task reuses, and the proof that a status-only archive emits NO `community.updated`).
    - `apps/web/app/(app)/comunidades/actions.test.ts` lines 96-148 (the `updateCommunityAction` describe, ending at the "pays for NO re-read" case).
    - `apps/web/app/(app)/comunidades/actions.ts` lines 235-245 (`coverAwareRefusal`) — READ ONLY. This file is NOT modified by this task; the server fix removes the cause, so the BFF's conservative `not_found` for a cover-silent submission stays exactly as it is and stays correct.
  </read_first>
  <behavior>
    RED first. Write the integration case BEFORE touching `service.ts`, run it, and confirm it fails
    with a 404 on the archive — that failure is the reproduction, not a formality.

    - New case 33 in the cover-contract describe, after case 32, named for the DOMESTIC stale cover
      (case 31 already owns the FOREIGN one). It seeds its OWN `image`/`cover`/`ready` asset via the
      existing `seedAsset(tenantIds.demo, 'admin@rede-demo.local', …)` rather than reusing
      `fixtures.ready`, so retiring it cannot poison any other case; `seedAsset` already pushes into
      `coverAssets`, so the block's `afterAll` collects the ASSET.
    - Fixture collection, stated exactly rather than by analogy: the COMMUNITY is collected by the
      FILE-level `created` list — `makeCommunity` pushes into it (line ~890) and the file sweep
      (lines 115-116) deletes by id. It is NOT collected by the block's cover-keyed `afterAll` at
      line ~967, because after the self-heal its `cover_asset_id` is null and that sweep matches on
      `cover_asset_id = any(coverAssets)`. That is the correct outcome, not a leak: the null is
      precisely what releases the foreign key that sweep exists to work around, so the asset delete
      succeeds and the file sweep removes the community afterwards.
    - Case 33 steps, all through shipped endpoints: `makeCommunity` with that asset (201, and the
      returned `coverAssetId` equals it) -> `DELETE /v1/media/{assetId}` as `tokens.demoAdmin` with
      `x-tenant-host: HOSTS.demo` (200) -> `GET /v1/communities/{id}` (still 200: the asymmetry
      "reads fine, writes 404" is named, not assumed) -> `PATCH { status: 'archived' }` (200, RED
      today at 404) -> read `cover_asset_id` back with `adminSql` (null) -> a REPEAT identical
      `PATCH { status: 'archived' }` (200) -> `PATCH { status: 'active' }` (200) -> `PATCH { name: … }`
      (200). Every one of those writes must be reachable, not just the archive.
    - PIN THE SELF-HEAL'S SIDE EFFECTS, not only its result. The healing PATCH carried NO cover claim,
      yet nulling the dangling reference makes `changedContent` true — so it writes the row, moves
      `updated_at` and announces a `community.updated`. Three consequences of a request that asserted
      nothing about the cover; each gets an assertion rather than a silent pass:
        * Before the archive PATCH, capture `updated_at::text` with `adminSql` (case 31's idiom,
          lines 1056-1057) and the length of `updatedEvents.filter((e) => e.communityId ===
          community.id)` (case 26's idiom, line 820), which is 0 for a freshly made community.
        * After it: `updated_at` is NOT equal to the captured value (the row really was written),
          that filtered `community.updated` list has length exactly 1 (the self-heal announced
          itself, once), and the matching `archivedEvents` filter has length exactly 1.
        * The REPEAT identical PATCH is the inertness half: 200, `updated_at` equal to the
          post-heal value, the filtered `community.updated` list still length 1, the filtered
          `archivedEvents` list still length 1. The self-heal fires ONCE and the row returns to the
          same observable inertness cases 24 and 31 own for rows that never dangled — the healing is
          a one-time repair, not a write on every PATCH forever.
    - Case 31 must keep every assertion it has, unchanged and passing: the re-sent USABLE cover is
      still inert (no `updated_at` move, no `community.updated`), and the re-sent FOREIGN cover is
      still a bare 404 with no `details` key and no community-count change.
    - Case 24 ("a PATCH identical to the stored row is a 200 that changes nothing") must keep passing.
    - In `actions.test.ts`, the case "pays for NO re-read when the submission carried no cover —
      archive included" keeps its assertions (a 404 on a cover-silent PATCH is still `not_found` and
      still costs no re-read) but its name and its comment must stop presenting the stale-cover
      archive as the intended source of that 404. Post-fix the API cannot produce that 404 at all, so
      the surviving meaning is "the community itself is gone". Add one sibling case: a successful
      `archiveCommunityAction` (stub `updateCommunity` resolving) returns `{ ok: true, … }` and never
      calls `loadCommunity` — the BFF adds no refusal of its own on the archive path.
  </behavior>
  <action>
Extract the single cover lookup in `resolveCoverAsset` into one private helper that returns the
`CoverAssetRow` or undefined, and build BOTH consumers on it: `resolveCoverAsset` keeps its exact
current throwing contract (undefined row -> bare `ApiError(404, 'NOT_FOUND')` with no details; a
present row failing the `purpose='cover'` / `kind='image'` / `status='ready'` tuple ->
`ApiError(400, 'VALIDATION_FAILED', { community: 'cover_invalid' })`; a null id returns immediately
with no lookup), and a new sibling `coverIsUsable(tx, ctx, coverAssetId)` answers a boolean off the
same row and the same tuple rule. ONE select statement, two callers — do not write a second query,
because two copies of this tuple rule would drift and the weaker copy is the one a write path trusts.

In `updateCommunity`, make the cover binding at line ~460 a `let` and branch on whether the REQUEST
carried the field, which is the whole fix:

- `input.coverAssetId !== undefined` (the client asserted an id, including an explicit `null`): call
  `resolveCoverAsset` exactly as today. `resolveCoverAsset` already returns early on `null`, so an
  explicit clear performs no lookup and is a no-op validation — that is correct and must stay. A
  re-sent unusable id keeps its 404, which is what preserves case 31.
- `input.coverAssetId === undefined` and the stored `before.cover_asset_id` is non-null: call
  `coverIsUsable`; if it answers false, reassign the local binding to null. A cover the tenant retired
  is "no cover", not a bricked community — drop the dangling reference rather than refusing every
  future write to the row. This request asserted nothing about the cover, so it must never 404 on one.
- `input.coverAssetId === undefined` and the stored value is already null: nothing to check.

Leave the `changedContent` comparison at lines ~471-474 structurally as it is: it compares the
EFFECTIVE resolved cover against `before.cover_asset_id`. A re-sent identical usable cover still
compares equal and stays inert; a real cover change still compares unequal and still registers; a
dangling stored cover now resolves to null, compares unequal, and is written away — which is the
self-heal the verifier's `missing:` list asks for. Do not weaken the inertness contract in any other
direction.

Leave `insertCommunity` (line ~382) untouched — a create always carries the field's meaning and is
already correct. Leave the update statement, the event emission and every 404 body untouched.

Replace the now-stale comment above the `resolveCoverAsset` call (the one asserting that validation
runs "whenever the RESOLVED cover is non-null") with one that states the new rule and why the stored
reference is self-healed rather than enforced. Update `resolveCoverAsset`'s docblock to name its new
boolean sibling.

Then write the tests described in the behavior block. If you mark this task's cycle with the repo's
TDD red-evidence gate, note the two known traps: `gsd_run check tdd-red-evidence <record.json>`
consumes TAP and Vitest emits none, so the run needs a throwaway normalizer (never fabricated
counts); and the record fields are TOP-LEVEL (`command`, `exitCode`, `targetTest`, `targetFile`,
`output`), NOT nested under an `evidence` key — nesting returns `INVALID_RED / invalid_record`.
  </action>
  <precondition>The local Supabase stack is up and the database is reset and seeded (`pnpm db:reset && pnpm db:seed`); `apps/api/.env.local` exists (generated by `scripts/local-env.sh`). Without it the integration suite cannot reach Postgres or GoTrue and the RED evidence is meaningless.</precondition>
  <verify>
    <automated>pnpm --filter @rede-social/api exec vitest run tests/integration/communities.test.ts</automated>
    <automated>pnpm --filter @rede-social/web exec vitest run "app/(app)/comunidades/actions.test.ts"</automated>
  </verify>
  <done>Case 33 fails with a 404 on the archive before the `service.ts` change and passes after it, with the stored `cover_asset_id` read back as null, the healing PATCH's `updated_at` move and its single `community.updated` both asserted, and the repeat identical PATCH asserted inert on `updated_at` and on both event counts; cases 24 and 31 pass unchanged; the whole `communities.test.ts` file is green; `actions.test.ts` is green and no longer documents the stale-cover archive 404 as intended behaviour.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CR-02 — key the play registration by story id, the shape bindCountBump already uses</name>
  <files>apps/web/components/stories/StoryVideo.tsx, apps/web/components/stories/StoryViewerHost.tsx, apps/web/components/stories/StoryViewerHost.test.tsx, apps/web/components/stories/StoryVideo.test.tsx, packages/modules/stories/ui/StoryViewer.tsx, packages/modules/stories/tests/story-viewer.test.tsx</files>
  <read_first>
    - `apps/web/components/stories/StoryViewerHost.tsx` lines 116-134 (`countBumpRef` / `bindCountBump` — the idiom to reuse — immediately followed by the unkeyed `playRef` / `bindPlay`), 147-192 (`viewerItems`, with `onRequestPlay` at 156 and the `StoryVideo` element at 159), 264-271 (how `StoryActions` registers and unregisters its own slot).
    - `apps/web/components/stories/StoryVideo.tsx` lines 36-51 (`StoryVideoProps`, `PlayableElement`, the component signature), 119-174 (the observer effect with `attach`, `detach`, `reconcile` and the `[onPlayRef]` dependency), 184-191 (the pause/mute effect that plays the ACTIVE story outside any gesture).
    - `packages/modules/stories/ui/StoryViewer.tsx` lines 348-362 (`mediaControls`: `paused` is `paused || k !== index`, so only the ACTIVE story is ever played by an effect), 200-215 (`autoplayBlocked` and the `paused` expression it ORs into — this is what makes case 14's pre-tap zero-call baseline deterministic, and also why the tap itself plays the active element on broken and fixed code alike), 288-298 (the UI-D-34 autoplay window: `canplay` arms a `autoplayCheckMs` = 400 ms timer that sets `blocked`), 500-512 (the `Math.abs(k - index) <= 1` neighbour window), 559-577 (the badge, its `data-testid` and its synchronous `current?.onRequestPlay?.()`).
    - For the WR-09 step only: `packages/modules/stories/ui/StoryViewer.tsx` lines 544-557 and `packages/modules/stories/tests/story-viewer.test.tsx` lines 405-418 — the two comment blocks that claim a browser-level regression gate the repo does not have.
    - `apps/web/components/stories/StoryViewerHost.test.tsx` lines 1-50 (imports and the hoisted mocks), 126-146 (the `@mux/mux-player-react` stand-in), 240-315 (`item()`, `host()`, the `beforeEach` `playbackToken` mock, `mountedPlayer`, `timeUpdate`), 405-448 (case 13, the only existing video case).
    - `apps/web/components/stories/StoryVideo.test.tsx` lines 205-228 (case 5, the only other `onPlayRef` call site).
  </read_first>
  <behavior>
    RED first, and the RED is FORCED rather than hoped for. Write case 14 BEFORE touching either
    component, run it, and confirm it fails. A green pre-fix run is a DEFECT IN THIS TEST and is
    never evidence the bug is absent — both earlier rounds of this phase shipped on suites that could
    not see the defect they were written to condemn. If the pre-fix run comes back green: stop,
    diagnose the harness (the forced attach order below did not take), and do not proceed to the
    component change or record any red evidence.

    New case 14 in `StoryViewerHost.test.tsx`, beside case 13:

    - THREE video stories with DISTINCT `id` and DISTINCT `mediaAssetId` values, mounted at
      `initialIndex: 1`, so the 3-wide window holds all three and story 1 is flanked on both sides.
      A single-story test cannot see this bug and a two-story test only covers one side of it.

    - FORCE THE ATTACH ORDER; DO NOT SAMPLE IT. Today's single `playRef` slot is written by EVERY
      mounted `StoryVideo`, the active one included, so the element the badge reaches is simply the
      last one to attach. If story 1 attached last, both neighbours would sit at zero calls and the
      assertion below would pass on today's broken code. So the test CHOOSES the last attacher, and
      chooses a neighbour:
        * In case 14 only, override the `beforeEach` token stub with a GATED
          `playbackToken.mockImplementation((assetId) => …)` that returns a promise whose `resolve`
          is stored in a `Map` keyed by `assetId`, and that resolves with the asset id echoed back as
          the `playbackId`, so an element can be traced to the story that asked for it.
        * Make `MuxPlayerStandIn` accept its props and put the `playbackId` it is handed on the
          element as `data-playback-id`. Additive; no existing case asserts a `playbackId` value.
        * After render, wait until all three gates exist (`playbackToken` has three calls), then
          release them ONE AT A TIME in the order STORY 1 (active), STORY 0, STORY 2 — each release
          inside `act`, each followed by a flush. Add a sibling to `mountedPlayer` that reuses its
          20-tick flush idiom but waits for a given COUNT of `mux-player` elements instead of the
          first one.
        * ASSERT the order instead of assuming it: after each release, assert the element count is
          1, then 2, then 3, and that the newly arrived element carries the `data-playback-id` of the
          story just released. These assertions hold both before and after the fix — they describe
          the harness, not the bug — and their whole job is to make a harness that stopped forcing
          the order fail LOUDLY instead of going quietly green.
      Story 2, a neighbour, is now necessarily the last writer of the single `playRef`, so pre-fix
      the badge necessarily reaches story 2's element.

    - Assign a `vi.fn()` to each of the three elements' `play` property once all three exist. The
      bound play closure in `attach` reads `element.play` at CALL time, so assigning after attach is
      fine.

    - Arm the badge: dispatch `canplay` on story 1's element inside `act`, then wait for
      `story-autoplay-badge` to appear (`waitFor` from `@testing-library/react`, real timers — the
      window is 400 ms and no test in this file uses fake timers).

    - Immediately before the tap, `mockClear()` all three spies and assert all three are at zero
      calls. This baseline is deterministic, not hopeful: `StoryViewer.tsx` line ~356 gives a
      neighbour `paused: paused || k !== index` so its effect only ever calls `pause()`, and the
      viewer's own `paused` at lines 208-214 ORs in `autoplayBlocked`, so the armed active story is
      paused too. Clearing also discards the one play the active element received on mount, before
      the badge armed.

    - Tap the badge with `fireEvent.click`. Assert story 0's spy has ZERO calls AND story 2's spy has
      ZERO calls AND story 1's spy has at least one.

    - NAME WHICH ASSERTION CARRIES THE RED, in the case comment. It is "story 2's spy is at zero" —
      the neighbour the harness forced to attach last. It is NOT "story 1 was played": the badge's
      own handler clears `blocked[currentId]`, which drops the viewer's `paused`, which re-runs
      `StoryVideo`'s pause/mute effect and plays the ACTIVE element on broken and fixed code alike.
      A reader who mistakes that half for the evidence will mis-read the next failure this case
      produces.

    - Then the owner-only-clear guard, in the same case: drive the viewer to index 2 with the existing
      `timeUpdate(story1Element, 5, 5)` idiom so story 0 leaves the window and its `detach()` runs;
      arm the badge on story 2 (`canplay` on its element, wait for the badge); clear the two surviving
      spies; tap; assert story 2's spy received a call and story 1's spy stayed at zero. State in the
      case comment that this half is a REGRESSION GUARD which passes today and CANNOT be promoted
      into a second RED: pre-fix the neighbour's `detach` does null the shared slot, but the same tap
      unblocks the viewer and the pause/mute effect plays the active element anyway, so the guard is
      blind to the clearing bug by construction. Record no claim to the contrary.

    - `StoryVideo.test.tsx` case 5 must keep its meaning under the new signature: the host is handed a
      callable on attach and a null on unmount, and the story id it is handed is the one the component
      was given. The last call's argument index moves from 0 to 1 and the id is asserted at index 0.
  </behavior>
  <action>
In `StoryVideo.tsx`: add a required `storyId: string` to `StoryVideoProps` and widen `onPlayRef` to
take `(storyId: string, play: (() => void) | null)`. Destructure `storyId` in the component signature.
In the observer effect, `attach` passes `storyId` alongside its bound play closure and `detach` passes
`storyId` with null. Add `storyId` to that effect's dependency array beside `onPlayRef`; both are
stable values, so this adds no churn. Document on the prop that the id is what makes the registration
per-story rather than per-mount. Do NOT change the observer mechanism, the listener set, the pause/mute
effect or the token fetch.

In `StoryViewerHost.tsx`: replace the single `playRef` with a `playRefs` record ref keyed by story id,
and make `bindPlay` a `useCallback([], …)` taking `(storyId, play)` that stores the callable when one
is given and deletes only THAT key when null is given — so only the owner can clear its own slot and a
neighbour leaving the window cannot clear a live registration. This is deliberately the same shape
`bindCountBump` uses eight lines above; do not invent a second idiom, and do not pass a fresh inline
callback per render, because `StoryVideo`'s listener effect takes `onPlayRef` as a dependency (review
WR-01) and a new identity per render would be an unbounded attach/detach loop. Change `onRequestPlay`
at line ~156 to resolve the CURRENT item's id out of the record, and pass `storyId={item.id}` to
`StoryVideo` at line ~159. Update the comment above the ref to say what the key buys and why the
unkeyed version played the wrong element, and drop the line in `bindCountBump`'s docblock that points
at `bindPlay` as the precedent — after this change they are the same shape and neither is the other's
exception.

Change no BEHAVIOUR in `packages/modules/stories/ui/StoryViewer.tsx`: the 3-wide window, the badge and
`onRequestPlay`'s synchronous invocation inside the click handler are all correct, and that synchrony
is the entire reason the seam exists (UI-D-34 / iOS grants playback to the gesture, not to a later
effect). The ONLY edit permitted in that file is the comment correction below, which touches no code.

Last, WR-09 — folded in here because it is a comment correction in the same component family, and
because the verifier's own entry for it accepts deleting the claim as the remedy. Two comment blocks,
at `packages/modules/stories/ui/StoryViewer.tsx` lines 544-557 and
`packages/modules/stories/tests/story-viewer.test.tsx` lines 405-418, name a Playwright spec by path
as the regression gate for the play badge and for the error container's `pointer-events-none` half of
the CR-04 fix. That spec asserts neither — the verifier independently re-counted zero references to
any of those three controls in it. Rewrite both blocks so they name no spec file at all and instead
state plainly that the hit-testing half is asserted by NO automated test (happy-dom does not
hit-test) and is carried as an open human check in the phase's verification pack. COMMENT TEXT ONLY:
no code change, no new test case, no Playwright work. Writing that missing browser coverage is the
other half of SC-3c and is deliberately NOT in this run's scope.

Then write the tests described in the behavior block. Same two TDD red-evidence traps as Task 1 if you
record evidence: Vitest emits no TAP for `gsd_run check tdd-red-evidence`, so it needs a throwaway
normalizer and never fabricated counts; and the record fields are TOP-LEVEL (`command`, `exitCode`,
`targetTest`, `targetFile`, `output`), NOT nested under an `evidence` key.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run components/stories/StoryViewerHost.test.tsx components/stories/StoryVideo.test.tsx</automated>
    <automated>pnpm --filter @rede-social/module-stories exec vitest run tests/story-viewer.test.tsx</automated>
    <automated>! grep -n "e2e/stories.spec.ts" packages/modules/stories/ui/StoryViewer.tsx packages/modules/stories/tests/story-viewer.test.tsx</automated>
  </verify>
  <done>Case 14 fails before the component changes — specifically on "story 2's spy is at zero", the neighbour the harness forced to attach last — and passes after them with both neighbours at zero calls and the current story's element played; the per-release element-count and `data-playback-id` assertions pass in both runs, proving the forced order held; case 13 and `StoryVideo.test.tsx` cases 1-8 all pass; no `StoryVideo` consumer passes an inline `onPlayRef`; neither stories-module file names a Playwright spec as a gate any more, and `story-viewer.test.tsx` is still green.</done>
</task>

<task type="auto">
  <name>Task 3: prove the two fixes broke nothing the previous two rounds broke silently</name>
  <files>(no files modified — gate run only)</files>
  <action>
Run the repo's scoped gates over everything the two fixes can reach, in this order, and fix any
fallout in the files Tasks 1 and 2 already own rather than widening the change:

1. `pnpm lint` (turbo lint across packages plus `scripts/check-ui-literals.sh`).
2. `pnpm turbo typecheck` — this is what catches a missed `onPlayRef` call site, since the prop's
   signature changed and it has exactly two consumers.
3. `pnpm --filter @rede-social/web test` — the WHOLE web unit suite, not only the two story files: the
   `MuxPlayerStandIn` and the `playbackToken` mock are shared by every case in
   `StoryViewerHost.test.tsx`.
4. `pnpm --filter @rede-social/module-stories test` — the stories MODULE's own unit suite. Task 2 edits two
   comments in that package, and this suite owns `StoryViewer` itself; a comment edit cannot change
   behaviour, which is exactly why the suite must confirm it did not.
5. `pnpm --filter @rede-social/api test` — the API unit suite.
6. `pnpm --filter @rede-social/api test:integration` — the WHOLE integration suite, not only
   `communities.test.ts`: `isolation.test.ts` carries the cross-tenant cover assertions that the
   `resolveCoverAsset` refactor sits underneath, and the tenant-isolation property must not have
   moved. Requires the seeded local stack.
7. `pnpm boundaries` — the module/kernel edges are untouched by design, so this is the assertion that
   they stayed untouched.

Do not run `pnpm verify` here: it resets and re-seeds the database, runs the full Playwright and PWA
suites and takes roughly 20 minutes. It is the phase exit gate and belongs to the re-verification
round that follows this plan, not to a quick fix.

Report each command's pass/fail verbatim in the summary. If any step fails, say which and why rather
than narrowing the command until it passes — the previous two rounds of this phase both shipped on
suites that could not see the defect, and a narrowed gate is that failure mode again.
  </action>
  <precondition>Tasks 1 and 2 are committed; the local Supabase stack is running and the database is seeded, or step 5 cannot run.</precondition>
  <verify>
    <automated>pnpm lint && pnpm turbo typecheck && pnpm --filter @rede-social/web test && pnpm --filter @rede-social/module-stories test && pnpm --filter @rede-social/api test && pnpm --filter @rede-social/api test:integration && pnpm boundaries</automated>
  </verify>
  <done>All seven commands exit zero, and the summary records each one's result verbatim including the suite counts, so a later reader can tell a real green from a narrowed one.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client -> API (`PATCH /v1/communities/{id}`) | Untrusted body decides which cover id, if any, is asserted |
| client -> API (`DELETE /v1/media/{assetId}`) | The shipped soft delete that creates the dangling reference in the first place |
| server payload -> browser (`StoryViewerHost`) | Story ids from the strip payload key the client-side play registration |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-Q01-01 | Information disclosure | `updateCommunity` cover self-heal (`coverIsUsable`) | medium | mitigate | The boolean answer is used ONLY to null a local binding and never reaches the response; the lookup runs in the tenant lane under `media_assets_tenant_select`, so a foreign row simply does not come back. A cover id the client SENDS still gets the byte-identical bare 404 with no `details` key (case 31 pins it), so the anti-oracle property D-23 buys is unchanged in both directions |
| T-Q01-02 | Tampering | `updateCommunity` cover binding | medium | mitigate | Omitting `coverAssetId` can only null a dangling reference — it can never WRITE an id, so a foreign or retired asset cannot be laundered onto a community by a cover-silent PATCH. The only path that writes a cover id still runs `resolveCoverAsset` and still throws |
| T-Q01-03 | Denial of service | `updateCommunity` per-request lookups | low | accept | The branch performs at most ONE indexed lookup per PATCH, the same count as today; the create path is unchanged |
| T-Q01-04 | Tampering | `playRefs` keying in `StoryViewerHost` | low | accept | The key is a story id the server already put in the viewer payload, used only to select a DOM `play()` closure in the member's own tab; it crosses no trust boundary and grants nothing |
| T-Q01-SC | Tampering | npm/pip/cargo installs | n/a | n/a | No package-manager install occurs in this plan (constraint: no new package), so no Package Legitimacy Audit and no legitimacy checkpoint is required. Any task that finds itself needing an install must stop and escalate rather than install |
</threat_model>

<verification>
- `pnpm --filter @rede-social/api exec vitest run tests/integration/communities.test.ts` — case 33 green, cases 24 and 31 green.
- `pnpm --filter @rede-social/web exec vitest run components/stories` — case 14 green, case 13 green, `StoryVideo` cases 1-8 green.
- `pnpm --filter @rede-social/module-stories test` — the comment-only WR-09 edit moved no behaviour in `StoryViewer`.
- `! grep -n "e2e/stories.spec.ts" packages/modules/stories/ui/StoryViewer.tsx packages/modules/stories/tests/story-viewer.test.tsx` — neither file claims a gate the repo does not have.
- `pnpm turbo typecheck` — proves both `onPlayRef` call sites moved together.
- `pnpm --filter @rede-social/api test:integration` — proves the `resolveCoverAsset` refactor did not move the cross-tenant isolation property in `isolation.test.ts`.
- `pnpm lint` and `pnpm boundaries` — no new UI literal, no new module edge.
</verification>

<success_criteria>
- A community whose cover was retired through `DELETE /v1/media/{assetId}` can be renamed, edited, archived and reactivated, and its stored `cover_asset_id` reads back null after the first such write.
- A PATCH that sends an unusable cover id still answers the bare 404 with no `details` key; a PATCH identical to a stored row with a usable cover is still observably inert.
- The self-heal is bounded and pinned: the healing PATCH moves `updated_at` and emits exactly one `community.updated`, and the identical PATCH after it moves nothing and emits nothing.
- With three adjacent video stories mounted, a tap on `story-autoplay-badge` calls `play()` on the current story's element and on neither neighbour's.
- Both fixes are pinned by a named test that was observed failing before the fix and passing after it — integration case 33 and `StoryViewerHost.test.tsx` case 14 — and case 14's pre-fix failure is forced by the harness (a neighbour is made the last attacher), so its RED cannot be an artefact of scheduling luck.
- Neither stories-module file claims a browser-level regression gate the repo does not have (WR-09). SC-3c's missing browser coverage stays open and out of scope.
- All seven gate commands in Task 3 exit zero.
</success_criteria>

<output>
Create `.planning/quick/260924-fwv-corrigir-os-dois-defeitos-introduzidos-p/260924-fwv-SUMMARY.md` when done.
</output>
