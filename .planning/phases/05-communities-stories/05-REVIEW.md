---
phase: 05-communities-stories
scope: gap-closure (plans 05-09, 05-10, 05-11, 05-12)
review_pass: 2
reviewed: 2026-09-24T13:03:37Z
depth: standard
diff_base: ad72a0a5861e9ac3dd55a4ee2ea1e7d530d1e377
files_reviewed: 17
files_reviewed_list:
  - apps/api/tests/integration/communities.test.ts
  - apps/api/tests/integration/isolation.test.ts
  - apps/web/app/(app)/comunidades/CommunityForm.tsx
  - apps/web/app/(app)/comunidades/actions.test.ts
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/components/stories/StoryVideo.test.tsx
  - apps/web/components/stories/StoryVideo.tsx
  - apps/web/components/stories/StoryViewerHost.test.tsx
  - apps/web/messages/pt-BR/communities.json
  - packages/core/tests/media-image.test.tsx
  - packages/core/ui/MediaImage.tsx
  - packages/modules/communities/contracts/index.ts
  - packages/modules/communities/server/service.ts
  - packages/modules/stories/tests/story-viewer-media.test.tsx
  - packages/modules/stories/tests/story-viewer.test.tsx
  - packages/modules/stories/ui/StoryViewer.tsx
  - scripts/check-static-routes.sh
findings:
  critical: 2
  warning: 9
  info: 4
  total: 15
status: issues_found
---

# Phase 5 (gap closure): Code Review Report

**Reviewed:** 2026-09-24T13:03:37Z
**Depth:** standard
**Scope:** INCREMENTAL — this pass replaces the previous `05-REVIEW.md` body and covers ONLY the 17
files the four gap-closure plans (05-09..05-12) changed since `ad72a0a`. The first-pass review of the
phase's eight original plans is superseded by this document; its findings were addressed by the work
under review here.
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Three of the four gap-closure claims hold up under trace.

**05-09's anti-oracle property is real and well pinned.** `resolveCoverAsset` runs inside the caller's
`withTenantTx` (first statement of `insertCommunity`, before `changedContent` in `updateCommunity`),
`media_assets_tenant_select` is `tenant_id = app.tenant_id() and deleted_at is null` so a foreign row
is genuinely invisible rather than denied, and both refusal paths throw the identical
`new ApiError(404, 'NOT_FOUND')` with no `details`. `errorEnvelope` only spreads `details` when set,
so the two bodies are byte-identical modulo `requestId` — which `isolation.test.ts` b5 asserts as an
equality rather than two literal checks. No log line, event or error message on the refusal path
names the asset, the tenant or the slug. The 400-vs-404 split is a within-tenant distinction only.
I could not construct a cross-tenant oracle.

**05-10's render-loop fix closes the loop at both ends.** `MediaImage`'s effect array is values-only
(`[assetId, src]`), the reports go through refs, and `StoryViewer`'s two memos produce control objects
whose identity survives an unrelated re-render. The `src === null` branch now reports.

**05-11's observer is correctly scoped and correctly torn down** (`observer.disconnect()` + `detach()`
in the cleanup, `found === playerRef.current` guard against double-attach, all four listeners removed
on detach — `StoryVideo.test.tsx` case 5 proves the last one).

But the gap closure introduced two new defects of its own, both of which the new tests step around:

1. **05-09 made every community with a retired cover asset permanently un-editable and
   un-archivable**, answering "Comunidade não encontrada" about a community the admin is looking at.
   `DELETE /v1/media/{assetId}` is a live, reachable endpoint; nothing nulls `communities.cover_asset_id`
   when it fires; and `updateCommunity` now re-validates the STORED cover on every PATCH — including
   one that only writes `status`.
2. **05-11 activated `onPlayRef`, and the host registers all mounted video neighbours into a single
   shared ref**, so the play badge calls `play()` on the wrong element — or on nothing at all after a
   neighbour unmounts. This is precisely the iOS gesture-scoped play that UI-D-34 exists for.

Beyond those, the phase leaves a set of latent-but-real React hazards (refs written during render, an
impure state updater, a callback identity taken as an effect dependency) and two comments that assert
coverage or a security posture the code does not have.

`scripts/check-static-routes.sh` (05-12) is correct: all three added keys match real route files.
`communities.json` is valid JSON and its one added key is consumed.

## Critical Issues

### CR-01: A retired cover asset permanently bricks every write to its community — and lies about why

**File:** `packages/modules/communities/server/service.ts:460-469` (with
`apps/web/app/(app)/comunidades/actions.ts:240-245` and `CommunityForm.tsx:226-237`)

**Issue:**
`updateCommunity` resolves the cover from the stored row when the body omits the field:

```ts
const coverAssetId =
  input.coverAssetId === undefined ? before.cover_asset_id : input.coverAssetId;
// …
await resolveCoverAsset(tx, ctx, coverAssetId);
```

`before.cover_asset_id` is read from `communities.cover_asset_id` directly (the projection's
`left join media_assets` does not feed it), so it is still the stale uuid after the asset is retired.
`resolveCoverAsset` then runs under `media_assets_tenant_select`, which carries `deleted_at is null`,
finds nothing, and throws a bare `404 NOT_FOUND`.

`DELETE /v1/media/{assetId}` is a shipped, reachable endpoint
(`packages/core/server/media/service.ts:656`, `set status='deleted', deletedAt = now()`), and
`assertMayRetire` explicitly permits the owner — i.e. the same admin who uploaded the cover and
created the community. Nothing nulls the community's reference; the FK is `on delete no action` and
this is a soft delete.

Consequences once that happens:

- The community still **reads** fine (the `left join` drops the row and the card falls back to the
  gradient), so nothing signals a problem.
- **Every** PATCH now 404s: rename, description edit, archive, reactivate.
- `archiveCommunityAction` / `reactivateCommunityAction` send `{ status }` only, so
  `body.data.coverAssetId` is `undefined` → `coverAwareRefusal` short-circuits on
  `submittedCoverAssetId === null` and returns `not_found`. `CommunityForm.messageFor('not_found')`
  toasts `t('notFound.title')` = **"Comunidade não encontrada"** — a false statement about a
  community that is open on the admin's screen and still in the list.
- The only escape is to open the edit form and remove the cover (that path does send
  `coverAssetId`, gets `cover_invalid`, and `coverAssetId: null` is accepted). Nothing in the UI
  tells the admin that, and it is not reachable from the archive control at all.

`communities.test.ts` case 31 covers the *foreign* stale cover (an id the API can no longer produce,
written by hand) and asserts the 404 is correct there. It does not cover the same-tenant retired
asset, which is the case an ordinary admin can reach from the product in two clicks. `actions.test.ts`
case "pays for NO re-read when the submission carried no cover — archive included" asserts the
`not_found` answer for archive as if it were the intended one.

**Fix:** validate only what the request actually asserts, and self-heal a stored reference that no
longer resolves. Keep case 31's property by still refusing a re-SENT bad id:

```ts
// packages/modules/communities/server/service.ts, inside updateCommunity's tx
let coverAssetId =
  input.coverAssetId === undefined ? before.cover_asset_id : input.coverAssetId;

if (input.coverAssetId !== undefined) {
  // The caller ASSERTED this id. A miss is their problem and their 404 (case 31 keeps its answer).
  await resolveCoverAsset(tx, ctx, coverAssetId);
} else if (coverAssetId !== null) {
  // Only the STORED reference. A cover the tenant retired is "no cover", not a broken community:
  // drop the dangling reference instead of refusing every future write to the row.
  const stillUsable = await coverIsUsable(tx, ctx, coverAssetId); // resolveCoverAsset, boolean-shaped
  if (!stillUsable) coverAssetId = null;
}
```

Add an integration case: seed a `cover/image/ready` asset, create a community with it,
`update public.media_assets set status='deleted', deleted_at=now()`, then assert
`PATCH { status: 'archived' }` → 200 and the stored `cover_asset_id` is null.

---

### CR-02: The play badge plays the wrong video (or none), because every mounted neighbour writes the same `playRef`

**File:** `apps/web/components/stories/StoryVideo.tsx:142-157` (with
`apps/web/components/stories/StoryViewerHost.tsx:134-137,156-158` and
`packages/modules/stories/ui/StoryViewer.tsx:503,565-571`)

**Issue:**
Before 05-11 the one-shot `querySelector` almost never found the element, so `onPlayRef` was
effectively never called. 05-11's observer makes it fire reliably — and exposes that the host holds
**one** ref for **all** mounted videos:

```tsx
// StoryViewerHost.tsx
const playRef = useRef<(() => void) | null>(null);
const bindPlay = useCallback((play: (() => void) | null) => { playRef.current = play; }, []);
// …passed unchanged to EVERY StoryVideo:
<StoryVideo assetId={item.mediaAssetId} controls={controls} onPlayRef={bindPlay} />
```

`StoryViewer` mounts the neighbour window `Math.abs(k - index) <= 1`, i.e. up to three stories at
once. With two or three adjacent video stories:

- **Last writer wins.** All mounted bridges call `onPlayRef(element.play)` on attach. The badge's
  `current?.onRequestPlay?.()` → `playRef.current?.()` therefore calls `play()` on whichever element
  attached last — typically the *next* story's offscreen video, not the one the member tapped.
- **A neighbour unmount nulls a live registration.** `detach()` runs `onPlayRef?.(null)`
  unconditionally, so when story `k+1` leaves the window it clears the ref that story `k` owns. The
  badge then does nothing at all.

The whole reason `onRequestPlay` is called synchronously inside the click handler is iOS: playback is
granted to the gesture, not to a later effect. When the wrong element receives it, the correct
element only gets the effect-driven `element.play()` from
`StoryVideo.tsx:184-191` — outside the gesture — which is exactly the call iOS rejects. So on the
platform this feature exists for, the recovery path silently fails.

No test covers it: `StoryVideo.test.tsx` case 5 renders one bridge; `StoryViewerHost.test.tsx` case 13
renders one video plus one image; `story-viewer.test.tsx` case 12a uses a stub `onRequestPlay` and
never goes through `StoryVideo`.

**Fix:** key the registration by story, and make detach idempotent per owner. Give `StoryVideo` the
story id and have the host keep a map:

```tsx
// StoryViewerHost.tsx
const playRefs = useRef<Record<string, (() => void) | null>>({});
const bindPlay = useCallback((storyId: string, play: (() => void) | null) => {
  if (play) playRefs.current[storyId] = play;
  else delete playRefs.current[storyId];   // only the OWNER can clear its own slot
}, []);
// …
onRequestPlay: () => playRefs.current[item.id]?.(),
media: (controls) => <StoryVideo storyId={item.id} … onPlayRef={bindPlay} />,
```

and in `StoryVideo`, `onPlayRef?.(storyId, …)` / `onPlayRef?.(storyId, null)`. This is the shape
`bindCountBump` in the same file already uses — the asymmetry between the two is the bug.

Add a case to `StoryViewerHost.test.tsx`: two video stories, `canplay` + the autoplay window on
story 0, tap the badge, assert story 0's element received `play()` and story 1's did not; then
advance so story 0's neighbour unmounts and assert the badge still works.

## Warnings

### WR-01: `onPlayRef` is an effect dependency — an inline callback from any future consumer is an infinite render loop

**File:** `apps/web/components/stories/StoryVideo.tsx:174`

**Issue:** The listener effect is `}, [onPlayRef]);` while every other volatile input to that effect
(`controls`) is deliberately read through `controlsRef` for exactly this reason. If a consumer passes
an inline `onPlayRef={(p) => …}`:

cleanup → `detach()` → effect body → `reconcile()` finds the element (`playerRef.current` is now null)
→ `attach()` → `setAttachments(c => c + 1)` → re-render → new `onPlayRef` identity → effect re-runs →
… unbounded, with a DOM listener churn per pass.

The only shipped caller passes a `useCallback([])`, so this is latent today — but 05-10's own docblock
states the rule ("a component that destabilises its children is a defect waiting for the next consumer
to rediscover, so it is fixed at BOTH ends") and this file did not apply it to its own prop. It is the
same failure class as GAP 2, one prop over.

**Fix:**

```ts
const onPlayRefRef = useRef(onPlayRef);
useEffect(() => { onPlayRefRef.current = onPlayRef; });
// …inside attach/detach: onPlayRefRef.current?.(…)
useEffect(() => { /* … */ }, []);   // mount-scoped, like the observer it owns
```

(If CR-02 is fixed by adding a `storyId` argument, keep that one as a plain value dependency.)

---

### WR-02: `element.play()` rejections are unhandled promise rejections

**File:** `apps/web/components/stories/StoryVideo.tsx:143, 190`

**Issue:** `void element.play?.()` in both `attach`'s bound play and the pause/mute effect. `play()`
rejects with `NotAllowedError` when autoplay is blocked and `AbortError` when a `pause()` interrupts
it — and "autoplay is blocked" is the *expected* path this whole component models (UI-D-34). `void`
suppresses the lint rule, not the rejection: the browser logs an unhandled rejection, Sentry (wired in
both apps per CLAUDE.md) records it as an error, and under Vitest an unhandled rejection can fail an
unrelated run — the same hazard `StoryViewerHost.test.tsx:59-67` already documents for `motion/react`.

**Fix:**

```ts
const startPlayback = (element: PlayableElement) => {
  // A refused play is the UI-D-34 STATE, reported by the `playing` event's absence — never a throw.
  Promise.resolve(element.play?.()).catch(() => {});
};
```

---

### WR-03: `MediaImage`'s failure latch is never released, so a recovered asset stays on the fallback forever

**File:** `packages/core/ui/MediaImage.tsx:75-76, 110-133`

**Issue:** `failedId` is only ever *set*. The `src === null` branch latches it:

```ts
if (src === null) { setFailedId(assetId); onFailedRef.current?.(); return; }
```

If the same `assetId` later receives a populated `widths` (the exact scenario 05-10 cites as reachable:
`listCommunityHighlights` omits the `status = 'ready'` filter, so a still-transcoding asset arrives with
`widths: []` and gains variants when the worker finishes), `src` becomes a real URL and the effect
re-runs — but `failed` is still `failedId === assetId`, so line 135 returns the fallback and the `<img>`
is never mounted. The component is permanently stuck on the "no photo" state for an asset that is now
fine. The same latch survives a transient `onError` followed by a `widths`/`baseWidth` change.

`media-image.test.tsx` case 4 re-renders with identical props, which cannot see this.

**Fix:** clear the latch at the top of the effect, before the branches decide:

```ts
useEffect(() => {
  // A new `src` for this asset is a new attempt: the previous verdict does not carry over.
  setFailedId((current) => (current === assetId ? null : current));
  if (src === null) { … }
  …
}, [assetId, src]);
```

Add a case: render with `widths={[]}`, assert the fallback and one `onFailed`; re-render the same
`assetId` with `widths={WIDTHS}` and assert an `<img>` exists and `onReady` fired.

---

### WR-04: `resolveCoverAsset`'s docblock denies the tenant comparison the statement three lines below actually makes

**File:** `packages/modules/communities/server/service.ts:260-262` vs `281-287` (and the file docblock
at `:20-30`)

**Issue:** The docblock says, of this exact lookup:

> "The read runs in the tenant lane, so `media_assets_tenant_select` is what makes a foreign id simply
> not come back; **there is nothing here that compares tenant ids**, so no later edit can turn this
> into a 403…"

The statement is:

```sql
select kind, purpose, status from media_assets
 where id = ${coverAssetId}::uuid
   and tenant_id = ${ctx.tenantId}::uuid   -- ← this file comparing tenant ids
   and deleted_at is null
```

The behaviour is correct — this is the same defence-in-depth predicate every other statement in the
file carries, and RLS supplies the real guarantee — but the comment asserts the opposite of the code,
in the one file whose correctness argument rests on being read literally. A maintainer who believes
the comment will either delete the predicate ("RLS covers it") or, worse, read the file-level claim at
`:20-30` ("the tenant is … never a value this file compares") as licence to add a hand comparison
somewhere it is not backed by a policy. CLAUDE.md names hand-compared tenant ids as an explicit
anti-pattern; a comment that mis-describes which layer is load-bearing is a real maintenance hazard.

**Fix:** say what the code does.

```
 *  - The read carries the tenant predicate AND runs in the tenant lane. `media_assets_tenant_select`
 *    (`tenant_id = app.tenant_id() and deleted_at is null`) is the layer that MUST hold; the explicit
 *    `tenant_id =` beside it is defence in depth, not the guarantee. Neither branch ever compares a
 *    tenant id to decide the SHAPE of the answer, which is the property D-23 needs: a miss is a miss.
```

Apply the same correction to the file docblock at `:20-30`.

---

### WR-05: Three components write to refs during render

**File:** `packages/modules/stories/ui/StoryViewer.tsx:319-320`; `packages/core/ui/MediaImage.tsx:84-87`;
`apps/web/components/stories/StoryVideo.tsx:73-74`

**Issue:**

```ts
const liveRef = useRef({ index, goNext });
liveRef.current = { index, goNext };          // during render
```

React's documented rule is that render must be pure and refs must not be written during it. The
"latest ref" idiom is common and mostly works, but this stack is Next 16 with `reactCompiler: true`
and React 19.3 concurrent features (`<Activity>`, View Transitions, Instant Navigations) — where a
render can be started, interrupted and discarded without committing. A discarded render still mutates
these refs, so a subsequent `onTimeUpdate` can compare `k` against an `index` that was never
committed and call a `goNext` bound to it. React's compiler also memoises on the assumption that render
is side-effect free.

`MediaImage`'s and `StoryVideo`'s refs are lower risk (they hold caller callbacks whose *behaviour* is
what matters), but `StoryViewer`'s `liveRef` holds the decision input for "has this video ended, and am
I the story on screen" — the one place a stale value causes a visible wrong action (auto-advancing the
wrong story).

**Fix:** React 19.3 ships `useEffectEvent`, which is the sanctioned replacement and keeps the memo
dependency arrays exactly as they are:

```ts
const advanceIfCurrent = useEffectEvent((k: number) => { if (k === index) goNext(); });
// …inside onTimeUpdate:
if (ratio >= 1) advanceIfCurrent(k);
```

Failing that, assign in a commit-phase effect (`useEffect(() => { liveRef.current = { index, goNext }; })`)
— correct under concurrent rendering, and sufficient here because every read happens in an event
handler after commit.

---

### WR-06: The media-error retry calls `setMediaState` from inside `setAttempt`'s updater

**File:** `packages/modules/stories/ui/StoryViewer.tsx:591-596`

**Issue:**

```tsx
onClick={() =>
  setAttempt((state) => {
    setMediaState((media) => ({ ...media, [currentId]: 'loading' }));   // side effect in an updater
    return { ...state, [currentId]: (state[currentId] ?? 0) + 1 };
  })
}
```

State updaters must be pure. React double-invokes them in StrictMode (dev), and runs them during the
render phase, so this queues a render-phase update from inside another component's reconciliation
work. It happens to survive today because the inner update is idempotent and targets the same
component — but it is a documented invariant violation, and `react-compiler` is enabled, which
assumes updaters are pure.

**Fix:** two independent calls in the handler, where they belong:

```tsx
onClick={() => {
  setMediaState((media) => ({ ...media, [currentId]: 'loading' }));
  setAttempt((state) => ({ ...state, [currentId]: (state[currentId] ?? 0) + 1 }));
}}
```

---

### WR-07: Retry re-mounts the media but leaves four per-story state maps stale

**File:** `packages/modules/stories/ui/StoryViewer.tsx:184-189, 591-596`

**Issue:** The retry bumps `attempt[currentId]` (re-keying the wrapper, remounting the media) and resets
`mediaState` — but `videoProgress`, `canPlay`, `playing` and `blocked` all keep the failed attempt's
values for that story id. Visible effects:

- `progress = isVideo ? (videoProgress[currentId] ?? 0) : clock.progress` (line 457): after a retry the
  segment shows the *previous* attempt's fill over a video that has restarted at 0.
- `blocked[currentId]` surviving a retry keeps `paused` true (line 208-214) until an `onPlaying`
  arrives, so a retried video that loads cleanly can sit with the badge up.

**Fix:** clear the story's slice in every map the retry invalidates:

```tsx
const retry = (id: string) => {
  setMediaState((s) => ({ ...s, [id]: 'loading' }));
  setVideoProgress(({ [id]: _drop, ...rest }) => rest);
  setCanPlay(({ [id]: _c, ...rest }) => rest);
  setPlaying(({ [id]: _p, ...rest }) => rest);
  setBlocked(({ [id]: _b, ...rest }) => rest);
  setAttempt((s) => ({ ...s, [id]: (s[id] ?? 0) + 1 }));
};
```

---

### WR-08: A PATCH re-sending the stored cover in a different uuid case is no longer inert

**File:** `packages/modules/communities/server/service.ts:471-481`

**Issue:** `changedContent` compares in JavaScript:

```ts
coverAssetId !== before.cover_asset_id
```

Postgres returns `cover_asset_id` canonically lowercased. `communities.test.ts` case 32 proves the
service accepts an upper-case spelling of the same uuid and stores it correctly — but for a community
that *already* carries that cover, `'AAAA…' !== 'aaaa…'` is `true`, so the no-op guard is skipped: the
`update` runs, `updated_at` moves and a `community.updated` event is emitted for a request that changed
nothing. That contradicts the contract case 31 asserts ("observably inert, not merely idempotent in its
response body") for the only spelling it tests.

**Fix:** compare the uuids as uuids, not as strings — let the case that already uses `::uuid` decide:

```ts
const sameCover =
  (coverAssetId ?? null) === null && before.cover_asset_id === null
    ? true
    : coverAssetId !== null &&
      before.cover_asset_id !== null &&
      coverAssetId.toLowerCase() === before.cover_asset_id.toLowerCase();
const changedContent = name !== before.name || description !== before.description || !sameCover;
```

and extend case 32 to run the upper-case PATCH against a community that already holds that cover,
asserting `updated_at` does not move.

---

### WR-09: Two comments cite an e2e regression gate that does not exist

**File:** `packages/modules/stories/ui/StoryViewer.tsx:554-557`;
`packages/modules/stories/tests/story-viewer.test.tsx:412-418`

**Issue:** Both files defer the un-unit-testable half of the CR-04 fix to `apps/web/e2e/stories.spec.ts`:

> "the other half of the fix — the error container being `pointer-events-none` so a tap on the COPY
> still falls through to the stage — is not observable here. It is a real-browser property, covered by
> `apps/web/e2e/stories.spec.ts` (run as a gate in 05-11 Task 3)."

`apps/web/e2e/stories.spec.ts` exists but contains no reference to `story-autoplay-badge`,
`story-media-error` or the retry control anywhere in its 818 lines, and `git log ad72a0a..HEAD --
apps/web/e2e/stories.spec.ts` is empty — it was not touched by the gap closure. The two behaviours the
comments name as "covered elsewhere" are covered nowhere: nothing asserts that the badge/retry are
hit-testable above the stage, and nothing asserts that a tap on the error *copy* still advances.

**Fix:** either add the three cases to `stories.spec.ts` (badge tap starts playback and does not
advance; retry tap re-mounts and does not advance; a tap on the error copy *does* advance), or delete
the claim and mark the property as unverified. A comment that names a gate which does not exist is
worse than no comment: the next reviewer stops looking.

## Info

### IN-01: `playAttempt` is write-only state

**File:** `packages/modules/stories/ui/StoryViewer.tsx:190, 567, 573`

`setPlayAttempt(v => v + 1)` fires in the badge's click handler, and the value is only ever read as
`data-play-attempt` **on the badge itself** — which unmounts in the same commit, because the handler
also clears `blocked[currentId]`. `story-viewer.test.tsx:12a` documents this ("`data-play-attempt`
lives ON the badge, so it unmounts with it") and asserts the pre-tap value only. The state and its
attribute can never be observed changing. Either move `data-play-attempt` onto the dialog root so it
is a usable probe, or drop both.

### IN-02: `CommunityForm.messageFor` is documented as exhaustive and is not

**File:** `apps/web/app/(app)/comunidades/CommunityForm.tsx:150-171`

The docblock says "Exhaustive over what the actions can answer: a new refusal code cannot compile
without copy", but the parameter is `(code: string)` with a `default:` arm, so a new `CommunityIssue`
compiles silently and falls through to `t('errors.save')` — which is how `cover_invalid` needed a
hand-fix here in the first place. Narrow the parameter to
`CommunityIssue | 'not_found' | 'generic'` and drop the `default` in favour of a
`const _never: never = code` exhaustiveness check, or correct the comment.

### IN-03: `createCommunity`'s slug-retry loop re-runs the cover lookup up to ten times

**File:** `packages/modules/communities/server/service.ts:326-335, 382`

`resolveCoverAsset` is the first statement of `insertCommunity`, which is correct (it must belong to
the transaction that writes). But on a slug collision the whole transaction is retried, so a
pathological ten-way collision performs ten identical indexed lookups. Harmless today; worth a note in
the docblock so a future reader does not mistake it for an accident, or hoist a `coverChecked` flag
across attempts within the same request.

### IN-04: A changed `assetId` leaves `StoryVideo` rendering the previous story's `playbackId`

**File:** `apps/web/components/stories/StoryVideo.tsx:76-97, 195-211`

The token effect keys on `[assetId]` but never clears `tokens` on change, so between an `assetId`
change and the new token resolving, `<MuxPlayer playbackId={old} …>` stays mounted with a credential
for a different asset. Not reachable today — `StoryViewer` gives each item its own wrapper and
`StoryVideo` instance — but one `key` change away from being reachable. Add
`setTokens(null)` at the top of the effect.

---

_Reviewed: 2026-09-24T13:03:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard — incremental pass over the 05-09..05-12 gap-closure scope_
