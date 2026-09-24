---
phase: 05-communities-stories
reviewed: 2026-09-24T00:00:00Z
depth: standard
files_reviewed: 155
files_reviewed_list:
  - apps/api/package.json
  - apps/api/src/app.ts
  - apps/api/src/modules/registry.ts
  - apps/api/tests/integration/communities.test.ts
  - apps/api/tests/integration/feed-interactions.test.ts
  - apps/api/tests/integration/feed-query-budget.test.ts
  - apps/api/tests/integration/feed.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - apps/api/tests/integration/media-playback.test.ts
  - apps/api/tests/integration/media.test.ts
  - apps/api/tests/integration/modules.test.ts
  - apps/api/tests/integration/mux-webhook.test.ts
  - apps/api/tests/integration/stories.test.ts
  - apps/api/tests/unit/registry.test.ts
  - apps/web/app/(app)/comunidades/CommunitiesList.tsx
  - apps/web/app/(app)/comunidades/CommunityForm.tsx
  - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.tsx
  - apps/web/app/(app)/comunidades/[communityId]/editar/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/not-found.tsx
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/app/(app)/comunidades/nova/page.tsx
  - apps/web/app/(app)/comunidades/page.tsx
  - apps/web/app/(app)/configuracoes/page.tsx
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/actions.ts
  - apps/web/app/(app)/criar/page.tsx
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/membros/MembersList.tsx
  - apps/web/app/(app)/membros/[membershipId]/not-found.tsx
  - apps/web/app/(app)/membros/page.tsx
  - apps/web/app/(app)/post/[postId]/editar/page.tsx
  - apps/web/app/(app)/post/[postId]/not-found.tsx
  - apps/web/app/(app)/stories/[storyId]/page.tsx
  - apps/web/app/(app)/stories/meus/StoryHistoryList.tsx
  - apps/web/app/(app)/stories/meus/page.tsx
  - apps/web/app/(app)/stories/publicar/StoryComposer.test.tsx
  - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
  - apps/web/app/(app)/stories/publicar/page.tsx
  - apps/web/app/(app)/stories/story-actions.ts
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/media/AvatarUploadField.test.ts
  - apps/web/components/stories/StoriesSurface.tsx
  - apps/web/components/stories/StoryVideo.tsx
  - apps/web/components/stories/StoryViewerHost.test.tsx
  - apps/web/components/stories/StoryViewerHost.tsx
  - apps/web/e2e/admin.ts
  - apps/web/e2e/comunidades.spec.ts
  - apps/web/e2e/feed-composer.spec.ts
  - apps/web/e2e/feed-media.spec.ts
  - apps/web/e2e/feed.spec.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/media-video.spec.ts
  - apps/web/e2e/members.spec.ts
  - apps/web/e2e/phase2-smoke.spec.ts
  - apps/web/e2e/phase4-smoke.spec.ts
  - apps/web/e2e/phase5-smoke.spec.ts
  - apps/web/e2e/shell.spec.ts
  - apps/web/e2e/stories.spec.ts
  - apps/web/i18n/messages.test.ts
  - apps/web/lib/communities.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/feed-write.ts
  - apps/web/lib/feed.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/relative-time.ts
  - apps/web/lib/stories.ts
  - apps/web/lib/story-view.ts
  - apps/web/lib/tenant-host.ts
  - apps/web/messages/pt-BR/app.json
  - apps/web/messages/pt-BR/communities.json
  - apps/web/messages/pt-BR/feed.json
  - apps/web/messages/pt-BR/media.json
  - apps/web/messages/pt-BR/members.json
  - apps/web/messages/pt-BR/profile.json
  - apps/web/messages/pt-BR/stories.json
  - apps/web/package.json
  - package.json
  - packages/core/server/paging.ts
  - packages/core/tests/paging.test.ts
  - packages/core/ui/MediaImage.tsx
  - packages/modules/communities/contracts/index.ts
  - packages/modules/communities/db/schema.ts
  - packages/modules/communities/module.ts
  - packages/modules/communities/package.json
  - packages/modules/communities/server/index.ts
  - packages/modules/communities/server/routes.ts
  - packages/modules/communities/server/service.ts
  - packages/modules/communities/tests/community-page-ui.test.tsx
  - packages/modules/communities/tests/community-picker-sheet.test.tsx
  - packages/modules/communities/tests/events.test.ts
  - packages/modules/communities/tsconfig.json
  - packages/modules/communities/turbo.json
  - packages/modules/communities/ui/CommunityCard.tsx
  - packages/modules/communities/ui/CommunityCover.tsx
  - packages/modules/communities/ui/CommunityHeader.tsx
  - packages/modules/communities/ui/CommunityPickerSheet.tsx
  - packages/modules/communities/ui/index.ts
  - packages/modules/communities/vitest.config.ts
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/server/index.ts
  - packages/modules/feed/server/routes.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/tests/comments-list-flat.test.tsx
  - packages/modules/feed/tests/community-contract.test.ts
  - packages/modules/feed/tests/events.test.ts
  - packages/modules/feed/tests/post-header.test.tsx
  - packages/modules/feed/ui/CommentInput.tsx
  - packages/modules/feed/ui/CommentItem.tsx
  - packages/modules/feed/ui/CommentSheet.tsx
  - packages/modules/feed/ui/CommentsList.tsx
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostHeader.tsx
  - packages/modules/stories/contracts/index.ts
  - packages/modules/stories/db/schema.ts
  - packages/modules/stories/module.ts
  - packages/modules/stories/package.json
  - packages/modules/stories/server/index.ts
  - packages/modules/stories/server/routes.ts
  - packages/modules/stories/server/service.ts
  - packages/modules/stories/tests/events.test.ts
  - packages/modules/stories/tests/pin-story-sheet.test.tsx
  - packages/modules/stories/tests/stories-strip.test.tsx
  - packages/modules/stories/tests/story-clock.test.ts
  - packages/modules/stories/tests/story-comments-contract.test.ts
  - packages/modules/stories/tests/story-history-row.test.tsx
  - packages/modules/stories/tests/story-pins.test.ts
  - packages/modules/stories/tests/story-viewer.test.tsx
  - packages/modules/stories/tsconfig.json
  - packages/modules/stories/turbo.json
  - packages/modules/stories/ui/PinStorySheet.tsx
  - packages/modules/stories/ui/StoriesStrip.tsx
  - packages/modules/stories/ui/StoryCircle.tsx
  - packages/modules/stories/ui/StoryHistoryRow.tsx
  - packages/modules/stories/ui/StoryProgressBars.tsx
  - packages/modules/stories/ui/StoryViewer.tsx
  - packages/modules/stories/ui/index.ts
  - packages/modules/stories/ui/useStoryClock.ts
  - packages/modules/stories/vitest.config.ts
  - packages/ui/src/index.ts
  - scripts/check-static-routes.sh
  - scripts/seed.ts
  - supabase/migrations/20260923171503_communities.sql
  - supabase/migrations/20260923185730_feed_communities.sql
  - supabase/migrations/20260923204828_communities_counters.sql
  - supabase/migrations/20260923214059_stories.sql
  - supabase/migrations/20260923234657_story_like_counters.sql
  - supabase/migrations/20260924005427_story_comment_rules.sql
  - supabase/migrations/20260924022607_story_community_pins.sql
  - supabase/tests/010-rls-coverage.sql
  - supabase/tests/020-tenant-isolation.sql
  - supabase/tests/090-feed.sql
  - supabase/tests/110-communities-stories.sql
findings:
  critical: 5
  warning: 11
  info: 5
  total: 21
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-09-24
**Depth:** standard
**Files Reviewed:** 155
**Status:** issues_found

## Summary

Phase 5 ships two new feature modules (`@tria/module-communities`, `@tria/module-stories`), the
feed's community wiring, a full-screen story viewer, story likes/comments, and story→community
pinning.

**The server tier is the strong half of this phase.** Every read and write in
`packages/modules/stories/server/service.ts` and `packages/modules/communities/server/service.ts`
goes through `withTenantTx`, carries the explicit `tenant_id` predicate beside RLS, and collapses
every miss to a bare `404 NOT_FOUND` with no `details` — `resolvePinTarget`, `likeStory`,
`createStoryComment` and `listStoryComments` all resolve the target row inside the lane before
writing, which is exactly D-23/TENANT-04. Route guards are permissions (never role comparisons) and
the read/write asymmetry on pins and highlights is deliberate and correct. `turbo boundaries` is
respected everywhere I checked: no `module -> module` package edge exists, the cross-module foreign
keys are hand-written SQL inside the generated migrations, and the two cross-module compositions
(`CommentSheet` as `overlay`, `CommunityPickerSheet` as `renderList`) are injected by `apps/web`. The
`feed_comments_parent_shape_chk` / `feed_likes_comment_kind_chk` rewrite in
`20260924005427_story_comment_rules.sql` correctly null-guards every equality, and `depth` is
`notNull`, so the three-valued hole Phase 4 left really is closed. The deliberate absences the scope
note calls out — no expiry predicate on `listCommunityHighlights`, no `DoubleTapHeart` — are exactly
as documented and are **not** reported.

**The client tier is where this phase breaks.** Five defects in the media/viewer path are reported
as BLOCKERs. Three of them (CR-02, CR-03, CR-04) are in the story viewer, which is the flagship
surface of the phase; all three are invisible to `story-viewer.test.tsx` because that suite stubs the
`media` render function and never simulates a tap on the play badge or the retry control. CR-05 makes
video stories inert. CR-01 is a server-side validation gap: `coverAssetId` is the only asset id in
the codebase written to a table without the tenant/purpose check that `publishStory` and the feed's
`validateAssets` both perform.

**Scope note on depth.** The following files received line-by-line analysis:
`packages/modules/stories/**` (all of `server/`, `ui/`, `contracts/`, `db/`),
`packages/modules/communities/server/**` + `contracts/` + `db/` + `ui/CommunityPickerSheet.tsx`,
`packages/core/ui/MediaImage.tsx`, `packages/core/server/paging.ts`, the seven Phase 5 migrations,
`packages/modules/feed/server/service.ts` (diff), `apps/api/src/app.ts` + `modules/registry.ts`
(diff), `apps/web/lib/{stories,communities,story-view,registry,relative-time}.*`,
`apps/web/components/stories/**`, `apps/web/app/(app)/{stories,comunidades,criar}/**`, and
`scripts/check-static-routes.sh`. The `*.test.ts(x)`, `e2e/*.spec.ts` and `supabase/tests/*.sql`
files were read for coverage gaps rather than audited line by line; message catalogs were checked
exhaustively for placeholder/`t()` mismatches (none found — every templated key is read through
`.raw` and interpolated by `fill()` or by `next-intl` on the server).

---

## Critical Issues

### CR-01: A community cover accepts ANY media asset id in the platform — cross-tenant reference, existence oracle, and an unhandled 500

**File:** `packages/modules/communities/server/service.ts:323-331`, `packages/modules/communities/server/service.ts:399-424`

**Issue:**
`insertCommunity` writes `input.coverAssetId` straight into `communities.cover_asset_id`, and
`updateCommunity` does the same in its `set` list. Neither resolves the asset first. Compare with the
two other asset-accepting writes in the codebase, both of which DO:

- `packages/modules/stories/server/service.ts:337-352` — `publishStory` selects the asset inside the
  transaction `where id = … and tenant_id = ctx.tenantId and deleted_at is null`, 404s on a miss, and
  refuses a wrong `purpose`/`kind` with `400 { story: 'media_invalid' }`.
- `packages/modules/feed/server/service.ts:487-520` — `validateAssets` reads `kind, purpose, status`
  in the tenant lane and refuses a mismatch.

The communities path does none of that. Three consequences:

1. **The only guard is the foreign key `communities_cover_asset_id_media_assets_id_fk`** (declared in
   `supabase/migrations/20260923171503_communities.sql:34`), which references `media_assets(id)` with
   **no tenant column**. Postgres referential-integrity checks run as the referenced table's owner
   and bypass RLS, so a `cover_asset_id` belonging to *another tenant* satisfies the constraint and
   is persisted. `communities_tenant_isolation` never sees it — it scopes `communities`, not the
   referenced row.
2. **That difference is observable, which makes it an existence oracle over the whole platform's
   `media_assets` table.** A random uuid raises `23503`, which is not an `ApiError`, so
   `errorEnvelope` (`packages/core/server/http/api-error.ts:64-68`) turns it into
   `500 INTERNAL`. A uuid that is a real asset *of any tenant* answers `201`. An admin holding
   `communities.community.manage` in tenant A can therefore enumerate tenant B's asset ids one
   request at a time. This is precisely the oracle D-23/TENANT-04 removes everywhere else in the
   phase.
3. **`purpose`, `kind` and `status` are unchecked**, so a `branding`/`avatar`/`file` asset — or a
   `rejected` one — can be installed as a community cover. `CommunityForm` uploads with
   `purpose: 'cover'`, but a server action is a public endpoint and nothing re-states the rule.

Secondary: an unhandled `23503` is a 5xx for a caller error, and it reaches the client as the
`generic` code in `writeRefusal` (`apps/web/app/(app)/comunidades/actions.ts:185-196`), so the admin
sees "Não foi possível salvar" with no way to understand or fix it.

**Fix:** resolve the cover inside the same transaction, exactly as `publishStory` does. Add a helper
and call it from both `insertCommunity` and the `updateCommunity` transaction before the write:

```ts
/** The cover check, in the tenant lane — the `publishStory` posture, restated for COMM-01. */
async function resolveCoverAsset(tx: Tx, ctx: RequestContext, coverAssetId: string): Promise<void> {
  const rows = await tx.execute<{ kind: string; purpose: string; status: string }>(sql`
    select kind, purpose, status
      from media_assets
     where id = ${coverAssetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
     limit 1`);
  const asset = rows[0];
  // Unknown, another tenant's, or soft-deleted — ONE indistinguishable answer, no details (D-23).
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (asset.kind !== 'image' || asset.purpose !== 'cover') {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'cover_invalid' });
  }
}
```

Call sites:

```ts
// insertCommunity(), before the INSERT
if (input.coverAssetId != null) await resolveCoverAsset(tx, ctx, input.coverAssetId);

// updateCommunity()'s transaction, before the UPDATE — only when the key is PRESENT,
// so `coverAssetId: null` (the D-69 remove affordance) stays a plain write.
if (input.coverAssetId != null) await resolveCoverAsset(tx, ctx, input.coverAssetId);
```

Add `cover_invalid` to `COMMUNITY_ISSUES` in `packages/modules/communities/contracts/index.ts:50` and
its pt-BR copy to `apps/web/messages/pt-BR/communities.json` under `communities.errors`, so the new
code cannot compile without a sentence (the `asCommunityIssue` switch in
`apps/web/app/(app)/comunidades/actions.ts:176-178` is exhaustive by hand and must be widened too).

---

### CR-02: `MediaImage`'s new effect deps produce an unbounded re-render loop in the story viewer

**File:** `packages/core/ui/MediaImage.tsx:77-87`, `apps/web/components/stories/StoryViewerHost.tsx:173-174`, `packages/modules/stories/ui/StoryViewer.tsx:300-320,462-469`

**Issue:**
Phase 5 widened `MediaImage`'s mount effect from `}, [assetId]);` to
`}, [assetId, onReady, onFailed]);` and added a `complete && naturalWidth > 0 → onReady()` branch.
Its one and only caller passes callbacks that are **recreated on every render**:

```ts
// StoryViewer.tsx:300 — a plain function called during render, not memoised
const controlsFor = (item: StoryViewerItem, k: number): StoryMediaControls => ({
  onLoad: () => setMediaState((state) => ({ ...state, [item.id]: 'ready' })),   // fresh arrow
  onError: () => setMediaState((state) => ({ ...state, [item.id]: 'error' })),  // fresh arrow
  …
});
…
{item.media(controlsFor(item, k))}        // line 467 — new object per render
```

```tsx
// StoryViewerHost.tsx:173 — the node the viewer renders
<MediaImage … onReady={controls.onLoad} onFailed={controls.onError} />
```

The resulting cycle, once the image has decoded:

1. `onLoad` (or the new `complete` branch) calls `onReady` → `setMediaState(s => ({...s, [id]:'ready'}))`.
2. The updater always allocates a **new object**, so `Object.is` never bails out and a re-render is
   scheduled — even though the value is already `'ready'`.
3. The re-render produces fresh `onLoad`/`onError` closures.
4. `MediaImage`'s effect deps changed → the effect re-runs → `img.complete && naturalWidth > 0` →
   `onReady()` → step 2.

This is the textbook React passive-update loop. React 19 trips
`NESTED_PASSIVE_UPDATE_LIMIT` and throws *"Maximum update depth exceeded"* out of
`flushPassiveEffects`, taking the viewer down with it; even where it merely warns, the surface spins
CPU on a full-screen media view on a phone. `story-viewer.test.tsx` cannot see it — the suite passes
its own stub `media: (c) => …` (line 101) and never mounts `MediaImage`. `MediaImage` has no unit
test of its own, and no other caller passes these props (`grep -rn "onReady" packages apps` returns
`MediaImage.tsx` and `StoryViewerHost.tsx:173` only).

**Fix:** make the signals idempotent at the source *and* stabilise the callbacks. Both halves are
needed — either alone leaves a latent loop for the next caller.

```ts
// packages/core/ui/MediaImage.tsx — report READY at most once per asset.
const reportedRef = useRef<string | null>(null);
useEffect(() => {
  const img = imgRef.current;
  if (reportedRef.current === assetId) return;
  if (img?.complete && img.naturalWidth === 0) {
    reportedRef.current = assetId;
    setFailedId(assetId);
    onFailedRef.current?.();
    return;
  }
  if (img?.complete && img.naturalWidth > 0) {
    reportedRef.current = assetId;
    onReadyRef.current?.();
  }
  // deps are the ASSET only; the callbacks ride refs, so an unstable caller cannot re-arm this.
}, [assetId]);
```
(with `const onReadyRef = useRef(onReady); onReadyRef.current = onReady;` and the same for
`onFailed` — the identical idiom `StoryVideo.tsx:64-65` already uses for `controls`.)

```ts
// packages/modules/stories/ui/StoryViewer.tsx — never schedule a render for a value that did not move.
onLoad: () =>
  setMediaState((state) => (state[item.id] === 'ready' ? state : { ...state, [item.id]: 'ready' })),
onError: () =>
  setMediaState((state) => (state[item.id] === 'error' ? state : { ...state, [item.id]: 'error' })),
```

Apply the same `state[k] === v ? state : {...}` guard to `onCanPlay`, `onPlaying` and
`onTimeUpdate`'s `setVideoProgress`, which have the same shape.

---

### CR-03: A story whose media ladder is empty hangs the viewer forever with no error and no retry

**File:** `packages/core/ui/MediaImage.tsx:89-97`

**Issue:**

```ts
const ladder = widths.length > 0 ? widths : [];
const base = baseWidth ?? ladder[0];
const src = base === undefined ? null : mediaVariantUrl(assetId, `w${base}`);
…
if (failed || src === null)
  return <>{fallback ?? <span className={cn('block bg-bg-tertiary', ratio, className)} />}</>;
```

The `src === null` branch (empty `widths`, i.e. an asset whose worker has not derived a ladder)
renders the neutral box **without calling `onFailed`** — only the `onError` DOM handler and the
`complete && naturalWidth === 0` branch do. In the story viewer that means
`mediaState[currentId]` stays `'loading'` forever, so:

- `paused: paused || currentState !== 'ready' || isVideo` (`StoryViewer.tsx:231`) keeps the clock
  stopped — the segment never fills and the story never auto-advances;
- `currentState === 'error'` is false (`StoryViewer.tsx:517`), so the `mediaError` copy and the
  `retry` control are **not** rendered either.

The member is left on a grey rectangle with no progress, no message and no recovery. This is
reachable on the live surfaces: `toStory` maps a null ladder to `[]`
(`packages/modules/stories/server/service.ts:147`, docblocked as "an asset whose worker has not
derived a ladder yet"), and `listCommunityHighlights` deliberately carries **no** `a.status = 'ready'`
filter (`service.ts:1091-1108`) precisely so a still-transcoding pinned story stays on the community
page. Opening that circle produces exactly this dead end.

**Fix:** treat "no renderable source" as a failure, reported once:

```ts
// beside the mount effect, so the signal fires whether the box was skipped or the fetch failed
useEffect(() => {
  if (src === null) onFailedRef.current?.();
}, [src]);
```

(`onFailedRef` per CR-02.) With that, `StoryViewer` takes the `currentState === 'error'` branch and
the member gets `labels.mediaError` + `labels.retry`, which is what UI loading/E03 already asks for.

---

### CR-04: The play badge and the media-error retry button sit INSIDE the gesture stage — tapping either advances the story instead of acting

**File:** `packages/modules/stories/ui/StoryViewer.tsx:437-537` (badge at 498-515, retry at 517-536)

**Issue:**
Both controls are rendered as children of the element that owns the tap/hold/drag pipeline:

```tsx
<div ref={stageRef} data-testid="story-stage" className="absolute inset-0"
     onPointerDown={onPointerDown} onPointerMove={onPointerMove}
     onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
  … pager … veil …
  <div className="pointer-events-none absolute inset-0 flex"> … tap zones … </div>
  {isVideo && autoplayBlocked ? (
    <button data-testid="story-autoplay-badge" onClick={…} className="absolute top-1/2 left-1/2 z-[4] …" />
  ) : null}
  {currentState === 'error' ? (
    <div data-testid="story-media-error" className="absolute inset-0 z-[4] …">
      <button onClick={…}>{labels.retry}</button>
    </div>
  ) : null}
</div>
```

The tap zones above them are correctly `pointer-events-none`, but these two are **not**. A pointer
press on either bubbles to the stage, so `onPointerDown` records `press.current` and `onPointerUp`
classifies it as a tap (short, still) and runs the zone maths at
`StoryViewer.tsx:362-371`. The badge is `top-1/2 left-1/2`, so `zone ≈ 0.5 > PREVIOUS_ZONE` →
`goNext()`. The error panel is `inset-0`, so a tap anywhere in its right two-thirds does the same.

Worse: `onPointerDown` calls `target.setPointerCapture(event.pointerId)` on the **stage**
(`StoryViewer.tsx:333-340`). While a pointer is captured by an ancestor, the browser dispatches the
subsequent `click` at the capture target, not at the button — so the badge's `onClick`
(`setBlocked(false)` + `onRequestPlay()`) and the retry's `onClick` may never fire at all.

Net effect: UI-D-34's "one tap starts both" is unreachable — tapping the play badge skips the story
the member was trying to start, and the media-error retry skips instead of retrying.

**Fix:** move both controls out of the stage, as siblings alongside `StoryProgressBars` and the
header row (which are already outside it and work correctly), or neutralise the gesture for them:

```tsx
// Option A (preferred — matches how every other control on this surface is placed):
// close </div> for the stage BEFORE the badge, then render:
{isVideo && autoplayBlocked ? (
  <button data-testid="story-autoplay-badge" … className="absolute top-1/2 left-1/2 z-[5] …" />
) : null}
{currentState === 'error' ? (
  <div data-testid="story-media-error" className="absolute inset-0 z-[5] …"> … </div>
) : null}
```

```tsx
// Option B (if they must stay inside the stage): stop the gesture at the control.
const swallow = (e: React.PointerEvent) => e.stopPropagation();
<button … onPointerDown={swallow} onPointerUp={swallow} onPointerCancel={swallow} … />
```

Add the missing coverage: `story-viewer.test.tsx:328-352` asserts only that the badge and the retry
control *render*; neither is ever tapped. A `fireEvent.pointerDown/pointerUp` over the badge that
asserts `data-story-index` is unchanged would have caught this.

---

### CR-05: `StoryVideo` attaches its media listeners before `<mux-player>` exists, and never re-tries — video stories never advance

**File:** `apps/web/components/stories/StoryVideo.tsx:13,97-124,136-154`

**Issue:**
`MuxPlayer` is a `next/dynamic(..., { ssr: false })` component (line 13), and it is only rendered
once `tokens` is set:

```tsx
{tokens ? <MuxPlayer … /> : null}
```

`next/dynamic` begins loading the chunk when the lazy component **first renders**, i.e. in the same
commit where `tokens` becomes non-null. The module cannot have resolved yet, so that commit renders
nothing in its place. The listener effect runs immediately after that commit:

```ts
useEffect(() => {
  const element = frameRef.current?.querySelector<PlayableElement>('mux-player');
  if (!element) return;          // ← always taken on the tokens-arrival commit
  … addEventListener('canplay' | 'playing' | 'timeupdate' | 'error') …
  onPlayRef?.(() => { void element.play?.(); });
  …
}, [tokens, onPlayRef]);
```

`tokens` does not change again and `onPlayRef` is a stable `useCallback`
(`StoryViewerHost.tsx:132-134`), so **the effect never re-runs** and the listeners are never
attached. Consequences for every video story:

- `controls.onCanPlay` / `onPlaying` never fire → `mediaState` stays `'loading'`;
- `controls.onTimeUpdate` never fires → `videoProgress[currentId]` stays `undefined`, so
  `progress = videoProgress[currentId] ?? 0` (`StoryViewer.tsx:416`) is pinned at 0 and the
  `ratio >= 1 → goNext()` auto-advance never happens;
- the UI-D-34 autoplay check (`StoryViewer.tsx:290-298`) requires `canPlay[video.id]`, which is never
  set, so the play badge never renders either.

A video story therefore sits forever at an empty progress bar with no badge and no error. (The
sibling effect at lines 128-134 *does* eventually find the element, because it re-runs on
`controls.paused`/`controls.muted` changes — which is why muting still works and masks the problem.)

**Fix:** react to the element appearing instead of guessing when it will. Either give `MuxPlayer` a
ref/callback-ref, or observe the frame:

```ts
const [element, setElement] = useState<PlayableElement | null>(null);

// The custom element is mounted by a lazily-imported component, so WAIT for it rather than
// querying once: `next/dynamic` resolves its chunk after the commit that first renders it.
useEffect(() => {
  const frame = frameRef.current;
  if (!frame || !tokens) return;
  const found = frame.querySelector<PlayableElement>('mux-player');
  if (found) { setElement(found); return; }
  const observer = new MutationObserver(() => {
    const el = frame.querySelector<PlayableElement>('mux-player');
    if (el) { setElement(el); observer.disconnect(); }
  });
  observer.observe(frame, { childList: true, subtree: true });
  return () => observer.disconnect();
}, [tokens]);

useEffect(() => {
  if (!element) return;
  … addEventListener/removeEventListener as today, keyed on `element` …
}, [element, onPlayRef]);
```

Then key the pause/mute effect on `element` too, replacing its `tokens` dependency.

---

## Warnings

### WR-01: "Seus stories" first-load error → the retry is dead and the screen lies with "Nenhum story ainda"

**File:** `apps/web/app/(app)/stories/meus/StoryHistoryList.tsx:147-166,222-240`

**Issue:** when the server read fails, `page` is `null`, so the page passes
`initialCursor={page?.nextCursor ?? null}` and `initialError` (`meus/page.tsx:69-71`). The error
card's retry does:

```ts
onClick={() => { setFailed(false); loadMore(); }}
```

but `loadMore` starts with `if (!cursor) return;` and `cursor` is `null`. So the tap clears the error
flag, fetches nothing, and `items.length === 0 && !failed` falls through to the **empty** branch —
the admin is told "Nenhum story ainda / Publique seu primeiro story" when the tenant may have dozens.
`CommunitiesList.tsx:146-148` gets this right (`retryFirst` calls `refresh()`, i.e. page 1), which is
the precedent this file departs from.

**Fix:** add a page-1 action and call it for the first-load error, mirroring
`refreshCommunitiesAction`:

```ts
// story-actions.ts
export async function refreshOwnStoriesAction(): Promise<StoryHistoryPageResult> { /* loadOwnStories() */ }

// StoryHistoryList.tsx
const retryFirst = useCallback(() => {
  startLoadMore(async () => {
    const page = await refreshOwnStoriesAction();
    if (!page.ok) return;               // stay on the error card
    setFailed(false);
    setItems(page.items);
    setCursor(page.nextCursor);
  });
}, []);
```
and use `retryFirst` in `errorState` when `items.length === 0`, keeping `loadMore` for the
append-failure card at line 294.

### WR-02: The UI-D-34 autoplay check never re-arms, so a second failed play is a silent dead end

**File:** `packages/modules/stories/ui/StoryViewer.tsx:290-298,498-515`

**Issue:** the effect that sets `blocked[id] = true` depends on `[current, canPlay, playing, autoplayCheckMs]`.
Tapping the badge sets `blocked[id] = false` and bumps `playAttempt` — neither is a dependency, so
the timer is never re-armed. If the second `play()` also fails (iOS Low Power Mode, the exact case
the badge exists for), `blocked` stays `false`, `playing` stays `false`, and the member gets no badge
and no progress with no way back.

**Fix:** add `playAttempt` to the dependency array and reset `playing[id]` when the badge is tapped,
so the check re-runs:

```ts
}, [current, canPlay, playing, autoplayCheckMs, playAttempt]);
```

### WR-03: A state setter is called inside another setter's updater function

**File:** `packages/modules/stories/ui/StoryViewer.tsx:525-530`

**Issue:**

```tsx
onClick={() =>
  setAttempt((state) => {
    setMediaState((media) => ({ ...media, [currentId]: 'loading' }));   // side effect in an updater
    return { ...state, [currentId]: (state[currentId] ?? 0) + 1 };
  })
}
```

React updater functions must be pure; they may be invoked more than once (StrictMode double-invokes
them in development) and are not guaranteed to run at all if the update is discarded. The nested
`setMediaState` happens to be idempotent today, which is the only reason this is a Warning and not a
Blocker.

**Fix:** sequence the two calls in the handler:

```tsx
onClick={() => {
  setMediaState((media) => ({ ...media, [currentId]: 'loading' }));
  setAttempt((state) => ({ ...state, [currentId]: (state[currentId] ?? 0) + 1 }));
}}
```

### WR-04: "Previous" at the first story is silently inert for a VIDEO

**File:** `packages/modules/stories/ui/StoryViewer.tsx:239-246,416`

**Issue:** `goPrevious()` at `index === 0` calls `clock.restart()`. For a video the clock is not the
source of truth — `progress = isVideo ? (videoProgress[currentId] ?? 0) : clock.progress` — and
nothing seeks the element back to `currentTime = 0`. So on a single-video sequence (the very common
`/stories/{id}` deep-link case) the left tap zone and `ArrowLeft` do nothing at all, with no visible
response. D-78's "the START RESTARTS" is only implemented for images.

**Fix:** add a `seek(0)` hook to `StoryMediaControls` (or extend `onRequestPlay` into a
`onRequestRestart`) and call it from `goPrevious` when `isVideo && index === 0`, alongside
`clock.restart()`; reset `videoProgress[currentId]` to 0 in the same handler.

### WR-05: `void element.play()` swallows the autoplay rejection

**File:** `apps/web/components/stories/StoryVideo.tsx:115,133`

**Issue:** `HTMLMediaElement.play()` returns a promise that **rejects** with `NotAllowedError` when
autoplay is refused — the exact iOS case UI-D-34 was written for. `void` marks the value as
intentionally discarded but attaches no handler, so the rejection surfaces as an unhandled promise
rejection (a Sentry noise source) and the component learns nothing from it.

**Fix:**

```ts
element.play?.()?.catch(() => controlsRef.current.onError());
```
or, if a refusal should keep the badge rather than the error copy, `.catch(() => {/* the UI-D-34
badge is the answer; onPlaying never fires */})` with an explicit comment.

### WR-06: `relativeFrom` throws a `RangeError` on a malformed timestamp and takes the whole server render down

**File:** `apps/web/lib/relative-time.ts:24-32`

**Issue:** `new Date(iso).getTime()` yields `NaN` for an unparseable string; every `elapsed < …`
comparison is then false and control reaches
`relativeTime.format(-Math.floor(NaN / YEAR), 'year')`, i.e. `format(NaN)`, which
`Intl.RelativeTimeFormat` throws a `RangeError` for. The inputs come straight off the wire and are
validated as bare strings, not ISO datetimes — `storySummarySchema.publishedAt: z.string()`
(`packages/modules/stories/contracts/index.ts`), `storyCommentSchema.createdAt` likewise. Every call
site is inside a server component (`registry.tsx:355`, `[communityId]/page.tsx:159`,
`story-view.ts:81,158`), so one bad row takes out `/inicio` or a community page rather than one card.

**Fix:** tighten the contract and make the formatter total:

```ts
export function relativeFrom(iso: string, now: number): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return '';   // an unrenderable timestamp is no label, never a crash
  const elapsed = now - at;
  …
}
```
and change the contract fields to `z.iso.datetime({ offset: true })` so a malformed payload is a
parse failure the `loadStories`/`loadFeed` catch already handles.

### WR-07: Three community write actions accept an unvalidated `communityId`

**File:** `apps/web/app/(app)/comunidades/actions.ts:242-286`

**Issue:** `updateCommunityAction`, `archiveCommunityAction` and `reactivateCommunityAction` take
`communityId: string` from the client with no `z.uuid()` check, unlike every story action
(`story-actions.ts:91,156,239,306,336-338`). The value reaches
`revalidatePath(`/comunidades/${communityId}`)` (line 266) unsanitised. `encodeURIComponent` in
`lib/communities.ts:186` keeps it out of the API path, and the API's own `z.uuid()` param refuses it,
so the impact is bounded — but the phase's stated posture ("a server action is a public endpoint and
its argument is untrusted") is not applied uniformly.

**Fix:**

```ts
const id = z.uuid().safeParse(communityId);
if (!id.success) return { ok: false, code: 'not_found' };
```
at the top of `updateCommunityAction`, and use `id.data` for both the request and the two
`revalidatePath` calls.

### WR-08: `check-static-routes.sh` gained the community routes but not the three new `/stories/*` routes

**File:** `scripts/check-static-routes.sh:54-81`

**Issue:** `REQUIRED_KEYS` was extended with the four `/(app)/comunidades/…` keys (lines 63-69) but
not with `/(app)/stories/[storyId]/page`, `/(app)/stories/publicar/page` or
`/(app)/stories/meus/page`. Those routes are still covered by the `GUARDED_PREFIXES` staticness check
(they start with `/(app)/`), so they cannot be silently prerendered — but they lose the
"route moved or renamed — update REQUIRED_KEYS" tripwire the comment at line 53 says the list exists
for. `/stories/[storyId]` is a share/deep-link target and is therefore exactly as permanent as
`/post/[postId]`, which is on the list.

**Fix:**

```bash
  // Phase 5: the story deep link (a shared/pushState target, therefore effectively permanent), the
  // publish door and the admin history. All three read the session and the host per request.
  '/(app)/stories/[storyId]/page',
  '/(app)/stories/publicar/page',
  '/(app)/stories/meus/page',
```

### WR-09: No composite `(tenant_id, …)` foreign key on either cross-module container reference

**File:** `supabase/migrations/20260923185730_feed_communities.sql:48-50`, `supabase/migrations/20260924022607_story_community_pins.sql:62`

**Issue:** both hand-written FKs reference `public.communities(id)` on the id alone:

```sql
ALTER TABLE "public"."feed_posts"
  ADD CONSTRAINT "feed_posts_community_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id");

ALTER TABLE "story_community_pins" ADD CONSTRAINT "story_community_pins_community_fk"
  FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade;
```

Referential-integrity checks bypass RLS, so the database alone does **not** prevent a post or a pin in
tenant A naming a community in tenant B — the only thing that does is the service layer
(`resolveCommunityTarget`, `resolvePinTarget`), which is layer 2 of a posture the phase documents as
three layers deep. The failure would be quiet rather than loud: `app.community_post_stats()`
(`20260923204828_communities_counters.sql:73-92`) runs as the invoker against RLS-scoped
`public.communities`, so its `update … where c.id = new.community_id` would match zero rows and
`post_count`/`last_activity_at` would drift with no error anywhere.

**Fix:** add `unique (tenant_id, id)` on `communities` (logically redundant, exactly as
`feed_comments_id_depth_kind_uq` is) and widen both FKs to the pair — the same technique
`20260924005427_story_comment_rules.sql` already uses to make a row's target nameable:

```sql
ALTER TABLE "public"."communities" ADD CONSTRAINT "communities_tenant_id_uq" UNIQUE ("tenant_id","id");
ALTER TABLE "public"."feed_posts" DROP CONSTRAINT "feed_posts_community_fk";
ALTER TABLE "public"."feed_posts" ADD CONSTRAINT "feed_posts_community_fk"
  FOREIGN KEY ("tenant_id","community_id") REFERENCES "public"."communities"("tenant_id","id");
-- and the same pair for story_community_pins_community_fk (keeping ON DELETE CASCADE)
```
Add the cross-tenant negative probe to `supabase/tests/020-tenant-isolation.sql`.

### WR-10: A community past the 250-row picker ceiling can be pinned to but never unpinned from the UI

**File:** `apps/web/lib/communities.ts:101-118`, `apps/web/app/(app)/stories/meus/StoryHistoryList.tsx:358-376`

**Issue:** `listAllCommunities()` walks at most `PICKER_MAX_PAGES * COMMUNITY_MAX_PAGE_SIZE = 250`
communities and silently returns the truncated set. `PinStorySheet` renders one row per entry of
`rows` and reads `pinnedCommunityIds` only to decide each switch's state
(`PinStorySheet.tsx:180-186`). A story pinned to a community beyond the ceiling therefore has a pin
id in `pinnedCommunityIds` with **no row to render it on**: the admin cannot see that the pin exists
and cannot turn it off, while `pinnedCommunityCount` on the history row keeps counting it. The
truncation is documented at `lib/communities.ts:94-99`, but this consequence is not.

**Fix (minimal):** in `StoryHistoryList`, surface any pinned id that has no matching row — e.g. keep
the loop but append the unmatched ids as rows carrying only the id, or refuse to open the sheet and
fire the generic toast when `pinTarget.pinned.some(id => !communities.find(c => c.id === id))`. The
honest fix is to read the pin sheet's rows from a dedicated paged read rather than from the composer
picker's ceiling-limited one.

### WR-11: `listStoryComments`' `memberships` join carries no tenant predicate

**File:** `packages/modules/stories/server/service.ts:576-580`

**Issue:**

```sql
left join memberships ms on ms.user_id = c.author_user_id and ms.deleted_at is null
left join member_profiles mp on mp.membership_id = ms.id
```

The join has no `ms.tenant_id = c.tenant_id` condition; it is correct today only because
`memberships`' RLS policy restricts the lane to one tenant. The schema is explicitly built for V2's
multi-tenant membership (CLAUDE.md: "Schema must anticipate V2 … multi-tenant membership"), and the
day a `super_admin`/service-role path or a widened policy makes two membership rows visible for one
user, this `left join` becomes a row multiplier — the same comment appears twice in the page and
`nextCursor` skips rows. The feed's projection carries the identical shape, so this is pre-existing,
but Phase 5 copied it into a second module. Note the contrast with
`packages/modules/feed/server/service.ts:161-162`, where the `left join public.communities` **does**
carry `c.tenant_id = p.tenant_id` with a docblock explaining why.

**Fix:** state the predicate, for the reason the feed's community join states its own:

```sql
left join memberships ms
       on ms.user_id = c.author_user_id
      and ms.tenant_id = c.tenant_id
      and ms.deleted_at is null
```

---

## Info

### IN-01: Two `limit` postures inside one module's contracts

**File:** `packages/modules/stories/contracts/index.ts:84-96` vs `:354-365`

`storyQuerySchema.limit` uses `.catch().transform(clamp)` (a bad value degrades to the default) while
`storyCommentsQuerySchema.limit` uses `.min(1).max(50)` (a bad value 400s). Both postures are
defensible and both are docblocked, but a reader of the module sees two answers to the same question
three hundred lines apart. Worth a one-line cross-reference in each docblock.

### IN-02: Both counter backfills leave "count is non-zero, rows are zero" unreconciled

**File:** `supabase/migrations/20260923234657_story_like_counters.sql:70-77`, `supabase/migrations/20260924005427_story_comment_rules.sql:174-181`

Both backfills join `stories` to a grouped subquery, so a story with **no** matching rows produces no
join row and its column is never touched. A story carrying a stale non-zero `like_count` with zero
live likes stays wrong. Harmless today (the columns were just created at `0`), but the headers claim
"a backfill that is correct at any volume", which this shape is not.

Fix: `left join` from `stories` with `coalesce(counted.n, 0)`, or add
`or (s.like_count <> 0 and not exists (select 1 from public.feed_likes l where l.story_id = s.id))`.

### IN-03: Three `useMemo`/`useCallback` memos are defeated by unstable props

**File:** `apps/web/components/stories/StoryViewerHost.tsx:147-192`, `packages/modules/stories/ui/StoryViewer.tsx:417-420`

`viewerItems` depends on `toast` (a context value) and `comments` (an object literal built fresh by
`storyCommentsProps` on every server render, then stable across client renders), and `positionLabel`
depends on `labels` (an object literal). The memos are correct but mostly inert. Not a correctness
issue on its own — but it is what makes CR-02's unstable-callback chain possible, so it is worth
fixing together with it.

### IN-04: `slugify` matches combining marks by literal characters rather than by escape

**File:** `packages/modules/communities/server/service.ts:212`

`.replace(/[̀-ͯ]/g, '')` embeds raw U+0300–U+036F in the source. It works, but the range is invisible
in most editors and survives a copy/paste only by luck. `/[̀-ͯ]/g` is the same regex and is
readable; `\p{Diacritic}` with the `u` flag is stricter still.

### IN-05: `deleteStoryComment` emits its event on a path where the row may already have been deleted

**File:** `packages/modules/stories/server/service.ts:857-884`

The `update … returning id` correctly 404s when nothing matched, so the event only fires on a real
transition — but unlike `deleteStory` (which reads `removed.id` from the returning row) this function
emits with the *path* `commentId` rather than the returned one. Functionally identical today;
mentioning it only because the surrounding code is otherwise consistent about "emit what the database
returned, never what the caller sent".

---

_Reviewed: 2026-09-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
