---
phase: 04-feed
part: A
scope: packages/**
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 58
files_reviewed_list:
  - packages/boundary-fixture/package.json
  - packages/boundary-fixture/src/index.ts
  - packages/contracts/src/modules.ts
  - packages/contracts/tests/platform.test.ts
  - packages/core/docs/SCHEMA-CONVENTIONS.md
  - packages/core/server/platform/modules.ts
  - packages/core/server/platform/tenants.ts
  - packages/core/server/rbac/permissions.ts
  - packages/core/tests/app-shell.test.tsx
  - packages/core/tests/nav.test.ts
  - packages/core/ui/MediaImage.tsx
  - packages/core/ui/index.ts
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/module.ts
  - packages/modules/feed/package.json
  - packages/modules/feed/server/index.ts
  - packages/modules/feed/server/jobs.ts
  - packages/modules/feed/server/routes.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/server/unfurl/guard.ts
  - packages/modules/feed/server/unfurl/job.ts
  - packages/modules/feed/tests/events.test.ts
  - packages/modules/feed/tests/meta.test.ts
  - packages/modules/feed/tests/post-media.test.tsx
  - packages/modules/feed/tests/share.test.ts
  - packages/modules/feed/tests/unfurl-guard.test.ts
  - packages/modules/feed/tsconfig.json
  - packages/modules/feed/turbo.json
  - packages/modules/feed/ui/AttachmentRow.tsx
  - packages/modules/feed/ui/CommentInput.tsx
  - packages/modules/feed/ui/CommentItem.tsx
  - packages/modules/feed/ui/CommentSheet.tsx
  - packages/modules/feed/ui/CommentsList.tsx
  - packages/modules/feed/ui/ComposeFab.tsx
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/LikeButton.tsx
  - packages/modules/feed/ui/LinkPreviewCard.tsx
  - packages/modules/feed/ui/PostActions.tsx
  - packages/modules/feed/ui/PostCaption.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostHeader.tsx
  - packages/modules/feed/ui/PostMedia.tsx
  - packages/modules/feed/ui/PostMenu.tsx
  - packages/modules/feed/ui/index.ts
  - packages/modules/feed/ui/linkify.tsx
  - packages/modules/feed/ui/meta.ts
  - packages/modules/feed/ui/sharePost.ts
  - packages/modules/feed/vitest.config.ts
  - packages/ui/src/hooks/useInfiniteScroll.ts
  - packages/ui/src/index.ts
  - packages/ui/src/layout/InfiniteScroll.tsx
  - packages/ui/src/overlays/DoubleTapHeart.tsx
  - packages/ui/src/primitives/PageHeader.tsx
  - packages/ui/src/styles/tokens.css
  - packages/ui/tests/double-tap-heart.test.tsx
  - packages/ui/tests/infinite-scroll.test.tsx
  - packages/ui/tests/tokens.test.ts
findings:
  critical: 2
  warning: 12
  info: 9
  total: 23
status: issues_found
---

# Phase 04 (Part A — `packages/**`): Code Review Report

**Reviewed:** 2026-09-23
**Depth:** standard
**Files Reviewed:** 58
**Status:** issues_found

## Summary

Part A covers `@rede-social/module-feed`, the kernel (`@rede-social/core`, `@rede-social/ui`, `@rede-social/contracts`) and the
boundary fixture. The tenant-isolation posture in the service layer is genuinely strong: every read
and write runs inside `withTenantTx`, no function compares tenant ids, the 404 branches are bare, and
the declarative constraint work (`feed_post_media_kind_fk`, `feed_comments_parent_fk`,
`feed_likes_*_uq`) puts the race-prone rules where a concurrent writer cannot lose them. The SSRF
guard is pinned at the socket layer and the mapped-IPv4 regression that the phase context flags is
correctly fixed for the spellings the test suite exercises.

Two defects are nevertheless shipping-blockers.

The first is the one the phase context asked for directly: **`updatePost` was hardened against the
"FK checks bypass RLS" hole and `setPostLinkPreview` was not.** That function is exported on the
module's public `./server` surface, writes `link_preview_id` from an unvalidated caller-supplied
uuid, and — unlike every other write path in the file — carries **no `author_user_id` predicate at
all**, so it can restamp any post in the tenant. It currently has no caller, which is the only reason
it is not live.

The second is in the caption renderer: `PostCaption` truncates the caption string and **then**
linkifies it, which is the opposite of what its own comment claims. A link in the collapsed state
therefore points at a *prefix* of the URL the author wrote — a different host in the general case —
and the href silently changes when the reader taps "… mais".

Beyond those, the review found a cluster of client-state defects that the module's own docblocks
contradict (a failed "load more" that destroys the comment page it promised to keep, a delete refusal
that produces no feedback at all, meta segments identified by string value, a render-phase
`setTimeout`), and three gaps in the SSRF policy that the current test suite cannot see because every
fixture is on the loopback.

I also want to flag a review-methodology problem in `packages/ui/tests/infinite-scroll.test.tsx`: it
proves the scroll-root wiring by handing the hook a **pre-populated** `{ current: element }` ref, a
shape the real shell never produces on first render. The hook reads `scrollRoot.current` during
render, so in production the first observer is built with `root: null` and is never rebuilt
(A-WR-09). The test asserts the code was written, not that it works.

Dependencies on the other partitions are called out inline; I did not read or review
`apps/**`, `supabase/**` or `scripts/**`.

## Critical Issues

### A-CR-01: `setPostLinkPreview` has no authorship predicate and stamps an unvalidated FK id

**File:** `packages/modules/feed/server/service.ts:1419-1446` (exported at
`packages/modules/feed/server/index.ts:17`)

**Issue:** This is the same class of hole `updatePost` was explicitly fixed for, left open in the
sibling function, on the module's *published* server entry point.

Two independent gaps:

1. **No `author_user_id = ctx.userId`.** Every other post write in this file carries it, and both
   docblocks call it load-bearing ("`author_user_id = ctx.userId` is the AUTHORISATION, and it lives
   in the statement rather than in a branch above it … Replacing it with a role comparison would
   silently widen the route to every admin", lines 643-653; restated at 806-819 for the delete). This
   function's `where` is only `id = … and deleted_at is null`, so any caller reaching it can clear or
   set the preview on **a colleague's post in the same tenant** and stamp `edited_at = now()` on it —
   exactly the T-04-54 case the other two predicates exist to refuse.
2. **`linkPreviewId` is written with no tenant-lane re-read.** `updatePost:736-743` re-selects the id
   from `feed_link_previews` before stamping it, with the comment "referential checks run as the
   referenced table's owner and would not see RLS at all". Line 1427 writes
   `link_preview_id = ${linkPreviewId}::uuid` straight through. RLS on `feed_link_previews` does
   still hide another tenant's row from the *read* projection, so this is a dangling-reference and
   integrity defect rather than a confirmed data leak — but it is the identical construct that was
   judged unacceptable 700 lines earlier.

It also emits no `post.edited` event and writes no `emit(...)` at all, so a change made through it is
invisible to the Phase 7/8 subscribers that every other write path feeds.

Finally it is **dead**: `grep -rn setPostLinkPreview apps packages` returns only its declaration and
its re-export. Nothing calls it.

**Fix:** delete it — 04-09 folded the remove-prévia affordance into `updatePost`'s
`input.linkPreviewId === null` branch (lines 733-743), so this function has no remaining job. If it
must stay, it needs both missing halves:

```ts
export async function setPostLinkPreview(
  ctx: RequestContext,
  postId: string,
  linkPreviewId: string | null,
): Promise<void> {
  const rows = await withTenantTx(ctx, async (tx) => {
    if (linkPreviewId !== null) {
      // The tenant lane decides, not the foreign key — RI runs as the referenced table's owner.
      const visible = await tx.execute<{ id: string }>(
        sql`select id from feed_link_previews where id = ${linkPreviewId}::uuid limit 1`,
      );
      if (!visible[0]) throw new ApiError(400, 'VALIDATION_FAILED', { media: 'asset_not_usable' });
    }
    return tx.execute<{ id: string }>(sql`
      update feed_posts
         set link_preview_id = ${linkPreviewId}::uuid,
             edited_at = now()
       where id = ${postId}::uuid
         and author_user_id = ${ctx.userId}::uuid   -- THE AUTHORISATION (T-04-54)
         and deleted_at is null
     returning id`);
  });
  if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND');
  // …and emit('post.edited', …) so Phase 7/8 see it.
}
```

**Cross-partition note:** Part B should confirm no `apps/api` route wires this in; if one does, this
is live and exploitable by any holder of `feed.post.manage`.

---

### A-CR-02: `PostCaption` truncates then linkifies, so a collapsed caption links to a *different* URL

**File:** `packages/modules/feed/ui/PostCaption.tsx:27-33`

**Issue:** The code does the opposite of what its own comment says.

```ts
// Truncate FIRST, then link: a URL cut in half must not become a clickable half-URL.
const shown = truncated ? caption.slice(0, truncateAt) : caption;
return (<p …>{linkify(shown)}…</p>);
```

Truncating first and linkifying the result is precisely how a half-URL *becomes* a clickable
half-URL: `linkify` matches `https?:\/\/[^\s<>"']+` against the already-sliced string, so the
surviving prefix is turned into a real `<a href>`.

With `FEED_CAPTION_TRUNCATE_AT = 100` (`contracts/index.ts:34`), a caption ending in
`https://exemplo.com.br/artigo/2026` can render, while collapsed, as
`href="https://exemplo.com"` — a **different registrable domain** from the one the author wrote. The
href then changes under the reader when they tap "… mais". Two consequences:

- **Correctness:** members navigate to a destination nobody authored. The unfurl card beside it
  (built from `firstUrlIn(caption)` over the *full* caption) describes the real target, so the card
  and the link disagree — the exact "a preview card under a URL the caption did not turn blue" shape
  that `linkify.tsx:22-27` says the shared matcher exists to prevent.
- **Security:** it is a controllable primitive. A caption author picks the padding so the 100th
  character falls at a boundary of their choosing, giving a collapsed href and an expanded href that
  point at different hosts they control. In V2, where any member posts, this is a phishing vector
  inside a branded tenant surface.

Secondary: `String.prototype.slice` counts UTF-16 code units, so the cut can land between a surrogate
pair and render a lone surrogate (the same unit `FEED_MAX_CAPTION` is documented against at
`contracts/index.ts:28-31`, but that comment is about *rejection*, not about *cutting*).

**Fix:** linkify the whole caption and truncate at a node boundary, so no partial match can ever
become an `href`:

```ts
const nodes = linkify(caption);                 // match against the FULL text, always
const shown = truncated ? clampNodes(nodes, truncateAt) : nodes;
// clampNodes walks the node list, slicing only plain-string runs and DROPPING (never cutting)
// an <a> whose full url does not fit — a link is rendered whole or not at all.
```

If the node walk is too much for this phase, the minimum safe fix is to drop a trailing partial URL
from `shown` before linkifying:

```ts
const raw = truncated ? caption.slice(0, truncateAt) : caption;
// A URL that the cut interrupted is not a URL: strip the dangling match entirely.
const shown = truncated ? raw.replace(/https?:\/\/[^\s<>"']*$/, '') : raw;
```

## Warnings

### A-WR-01: the SSRF deny list omits IPv6 multicast, 6to4 and Teredo

**File:** `packages/modules/feed/server/unfurl/guard.ts:62-71`

**Issue:** The IPv4 half blocks multicast (`224.0.0.0/4`) and reserved (`240.0.0.0/4`); the IPv6 half
blocks neither. Three concrete gaps:

- **`ff00::/8` (IPv6 multicast)** — `ff02::1` (all-nodes, link-local) and `ff05::` (site-local
  scope) are reachable from a Cloud Run instance's own interfaces and are not in the list. The
  asymmetry with `224.0.0.0/4` is unexplained.
- **`2002::/16` (6to4)** — `2002:7f00:1::` and `2002:a9fe:a9fe::` are *routable* spellings that embed
  `127.0.0.1` and `169.254.169.254`. `checkBlocked` only unwraps `::ffff:0:0/96`, so a 6to4 address
  passes both branches.
- **`2001::/32` (Teredo)** and **`::/96` (deprecated IPv4-compatible, e.g. `::7f00:1`)** — same
  shape, lower likelihood on a modern kernel but free to block.

The unit suite cannot catch any of these: every `isBlockedAddress` case at
`tests/unfurl-guard.test.ts:191-210` enumerates the addresses the list already names.

**Fix:**

```ts
for (const [cidr, prefix] of [
  ['::', 96],        // unspecified + deprecated IPv4-compatible (::7f00:1 is 127.0.0.1)
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],     // multicast — the IPv6 half of 224.0.0.0/4
  ['64:ff9b::', 96],
  ['2001::', 32],    // Teredo
  ['2002::', 16],    // 6to4 — 2002:7f00:1:: IS 127.0.0.1
  ['2001:db8::', 32],
] as const) blockList.addSubnet(cidr, prefix, 'ipv6');
```

Widening `::` from /128 to /96 keeps the unspecified address blocked and adds the IPv4-compatible
range; add a negative test for `2002:7f00:1::` and `ff02::1` alongside the existing table.

---

### A-WR-02: the redirect chain is unbounded

**File:** `packages/modules/feed/server/unfurl/job.ts:112` and `:158`

**Issue:** Both outbound calls pass `redirect: 'follow'` with no hop limit, so undici applies the
fetch-spec default of **20** redirects. The project's own stack contract (`CLAUDE.md`, "Supporting
Libraries" → `open-graph-scraper`) specifies "SSRF allow-list (block private IPs, follow **≤3
redirects**, 5 s timeout)". Two of the three are implemented; the redirect cap is not.

Every hop is address-guarded, so this is not an SSRF bypass — but 20 hops against an
attacker-controlled host is a worker-time amplification (20 × connect + headers) bounded only by the
5 s `AbortSignal`, and a redirect loop consumes a worker slot for the whole window. The
`unfurl-guard.test.ts:273-287` case proves the *second* hop is guarded; nothing bounds the *count*.

**Fix:** cap it on the Agent, which applies to both call sites at once:

```ts
return new Agent({
  connect: connector,
  maxRedirections: 3,          // CLAUDE.md: follow ≤3 redirects
  maxResponseSize: policy.maxResponseSize,
  …
});
```

and assert it in the `pins the production policy numbers` test.

---

### A-WR-03: `unmapV4`'s hex fallback mis-decodes compressed mapped spellings

**File:** `packages/modules/feed/server/unfurl/guard.ts:93-102`

**Issue:** The fallback takes the **last two colon-separated groups** as the two 16-bit halves of the
IPv4 address:

```ts
const hex = /:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
```

That is only correct when both halves are written out. For a compressed spelling like `::ffff:1`
(which *is* in `::ffff:0:0/96`, and whose true IPv4 is `0.0.0.1`), the regex captures `ffff` and `1`
and returns **`255.255.0.1`** — a completely different address. Today that happens to land in
`240.0.0.0/4` and is still refused, so the bug is latent rather than exploitable; it stops being
latent the moment someone trims the reserved range, and it means the function's contract ("both
unwrap to `127.0.0.1`", line 92) is false for a whole spelling family.

No test covers a compressed mapped form — `tests/unfurl-guard.test.ts:202-205` only exercises the
dotted spelling.

**Fix:** decode the low 32 bits of the address rather than pattern-matching its tail:

```ts
function unmapV4(address: string): string | null {
  if (!V4_MAPPED_RANGE.check(address, 'ipv6')) return null;
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted?.[1]) return dotted[1];
  // Expand the "::" and take the last two groups by POSITION, not by what the tail looks like.
  const [head, tail = ''] = address.split('::');
  const groups = [...head.split(':'), ...tail.split(':')].filter((g) => g.length > 0);
  const low = groups.slice(-2);            // padded left by the "::" expansion
  const [hi, lo] = [low.at(-2) ?? '0', low.at(-1) ?? '0'].map((g) => Number.parseInt(g, 16));
  …
}
```

Add `expect(isBlockedAddress('::ffff:1', 6)).toBe(true)` and a positive control
(`::ffff:5db8:d822` = `93.184.216.34` → `false`) to the table.

---

### A-WR-04: a failed "load more" destroys the comment page it promised to keep

**File:** `packages/modules/feed/ui/CommentsList.tsx:255-272` (specifically line 267)

**Issue:** `loadMore`'s failure path sets `setListError(true)`, and the render chain at lines 648-707
checks `listError` **before** it renders rows:

```ts
if (loading) … else if (listError) { /* full-height error panel */ } else if (items.length === 0) …
```

So failing to append page 2 replaces every already-loaded comment with the centred error card. That
contradicts the function's own header ("**APPEND:** every row already on screen keeps its order and
its DOM position", line 254) and the component docblock's UI-D-22 rule ("A failed load renders an
inline error plus a retry **WHERE THE ROWS WOULD BE**", lines 34-40). It also diverges from the
sibling implementation: `FeedList.loadMore` (`FeedList.tsx:301-319`) correctly uses a *separate*
`pageFailed` flag and keeps every card.

The retry then compounds it — `loadFirstPage` refetches page 1, so the member loses both the page
they were reading and their scroll position.

**Fix:** give the paging failure its own flag, mirroring `FeedList`:

```ts
const [pageFailed, setPageFailed] = useState(false);
// in loadMore:
if (!page.ok) { setPageFailed(true); return; }
setPageFailed(false);
// …and render the inline line + retry AT the "load more" control (lines 692-704),
// never through the `listError` arm.
```

---

### A-WR-05: a refused comment delete is silently swallowed — `onError` can never fire

**File:** `packages/modules/feed/ui/CommentsList.tsx:506-541`

**Issue:** `confirmDelete` catches its own rejection and then early-returns on a refusal:

```ts
try { deleted = (await onDeleteComment(target.id)).ok; }
catch (error) { console.error('feed.comment.delete_failed', …); }
if (!deleted) return;                                     // ← nothing else happens
```

Because it never re-throws, the `onError` handler wired at line 751 is unreachable, and
`ConfirmDialog`'s `finally` (`ConfirmDialog.tsx:68-73`) closes the dialog regardless. The member taps
"Excluir", the dialog closes, the comment is still there, and **no toast, no inline message and no
`aria-live` announcement is produced**. There is no way to tell a refused delete from a delete that
worked but whose row the list failed to remove.

This is inconsistent with the sibling implementation one file over: `PostMenu.confirmDelete`
(`PostMenu.tsx:128-137`) uses `try/finally` **without** a catch precisely so the rejection reaches
`onError`, and `FeedList`'s docblock states the rule explicitly ("`onDelete` must REJECT on refusal",
`FeedList.tsx:70-71`).

**Fix:** let the refusal propagate and hand it to the dialog, matching `PostMenu`:

```ts
const confirmDelete = useCallback(async () => {
  const target = confirming;
  if (!target) return;
  const { ok } = await onDeleteComment(target.id);   // a rejection reaches ConfirmDialog.onError
  if (!ok) throw new Error('comment_delete_refused');
  … // existing removal + onCountChange(-1)
}, …);
```

and replace the `console.error`-only `onError` at line 751 with the host's generic error surface
(the list already takes `labels.submitErrorLabel` for the composer; a delete needs the same).

---

### A-WR-06: the post meta row identifies segments by string value

**File:** `packages/modules/feed/ui/PostCard.tsx:232-247`

**Issue:** Two places treat a rendered label as an identity:

```ts
{segments.map((segment, index) => (
  <Fragment key={segment}>                                       // ← line 233
    {index > 0 ? <span aria-hidden>·</span> : null}
    {commentLabel !== null && segment === commentLabel && onOpenComments ? ( // ← line 235
```

`segments` comes from `buildPostMeta`, which returns four independently-sourced strings
(`meta.ts:44-48`). Nothing guarantees they are distinct:

- **Duplicate React key.** If two segments coincide — e.g. a host catalog whose `edited` label
  happens to equal a formatted count, or `likes.other === comments.other` in a future locale —
  React warns and may reconcile the wrong Fragment.
- **Worse: the wrong segment becomes the button.** `segment === commentLabel` makes the *like*
  segment the comments button whenever `likeLabel === commentLabel`. Since both are produced by
  `formatCountLabel` from host-supplied templates, one catalog typo (`likes.other` copied into
  `comments.other`) turns the like count into a control that opens the comment sheet, and the real
  comment count into inert text. The module cannot validate the host's catalog, so the coupling is
  unenforceable.

`tests/meta.test.ts` uses deliberately distinct stand-ins (`L1/Ln` vs `C1/Cn`, lines 23-24), so the
collision is untested.

**Fix:** carry identity in the data instead of inferring it from the text — return tagged segments
from `buildPostMeta`:

```ts
export type MetaSegment = { key: 'likes' | 'comments' | 'time' | 'edited'; text: string };
export function buildPostMeta(input: PostMetaInput): MetaSegment[] { … }

// PostCard:
{segments.map((segment, index) => (
  <Fragment key={segment.key}>
    {index > 0 ? <span aria-hidden>·</span> : null}
    {segment.key === 'comments' && onOpenComments ? <button …>{segment.text}</button>
                                                  : <span>{segment.text}</span>}
```

---

### A-WR-07: `LikeButton` schedules a timer during render and never clears it on unmount

**File:** `packages/modules/feed/ui/LikeButton.tsx:137-144`

**Issue:**

```ts
if (seenPulse !== pulseKey) {
  setSeenPulse(pulseKey);
  if (!reduceMotion) {
    setPulsing(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPulsing(false), PULSE_MS);   // ← side effect in render
  }
}
```

The "adjust state during render" pattern React documents covers `setState` only; `setTimeout` is an
uncancelled side effect in the render phase. Two consequences:

- Under StrictMode's double-render (dev) and under a render React *discards* (concurrent
  rendering, a Suspense retry, a transition that is interrupted), the timer is still scheduled — so
  a pulse can be armed for a render that never commits, and `clearTimeout` on the ref only cancels
  the most recent one.
- There is **no cleanup effect**, so unmounting a card mid-pulse (paging the feed, closing the
  sheet) leaves a live timer that calls `setPulsing` on a dead component.

Note the same file's sibling `DoubleTapHeart` gets this right — it has an unmount cleanup
(`DoubleTapHeart.tsx:38-43`) — so this is an inconsistency inside the phase, not a house style.

**Fix:** move the schedule into an effect keyed on `pulseKey`, and clean it up:

```ts
useEffect(() => {
  if (pulseKey === 0 || reduceMotion) return;
  setPulsing(true);
  const id = setTimeout(() => setPulsing(false), PULSE_MS);
  return () => clearTimeout(id);
}, [pulseKey, reduceMotion]);
```

---

### A-WR-08: a double tap on an already-liked post UNLIKES it, under a filled-heart burst

**File:** `packages/modules/feed/ui/PostCard.tsx:205` → `PostMedia.tsx:193` →
`packages/ui/src/overlays/DoubleTapHeart.tsx:45-58`

**Issue:** `PostMedia` receives `onDoubleTapLike={toggle}` — the *toggle*, not a "like". So a second
double tap on a post the viewer already liked removes the like, while `DoubleTapHeart` renders the
80px filled `--color-like` heart burst (`DoubleTapHeart.tsx:66-85`) that universally signals "you
just liked this". The gesture and its own feedback disagree.

This is not the shared-state rule the card documents ("One toggle, three entry points … the same
optimistic state", `PostCard.tsx:132-136`) — sharing the *state* is right; sharing the *direction* is
what is wrong. Every platform this gesture is borrowed from makes double-tap idempotent-to-like and
puts the un-like on the button alone, for exactly this reason: a fat-fingered third tap on a media
band silently removes a like the member never intended to remove, with no undo and no toast.

`packages/ui/tests/double-tap-heart.test.tsx` asserts the burst renders and that the handler fires
once; it cannot see the direction, because the wrapper only knows "a double tap happened".

**Fix:** expose a like-only entry from the hook and wire the gesture to it:

```ts
// LikeButton.tsx — the engine already knows the current value
const likeOnly = useCallback(() => { if (!currentRef.current.liked) toggle(); }, [toggle]);
return { state, toggle, likeOnly, pulseKey };

// PostCard.tsx
<PostMedia … onDoubleTapLike={likeOnly} />   // the BUTTON keeps `toggle`
```

If the toggle behaviour is deliberate, the burst must not render on the un-like arm — an animation
that says "liked" on a removal is worse than no animation.

---

### A-WR-09: `useInfiniteScroll` resolves the scroll root during render, so it is `null` on mount

**File:** `packages/ui/src/hooks/useInfiniteScroll.ts:57` (and `:86`)

**Issue:**

```ts
const observerRoot = root !== undefined ? root : (scrollRoot?.current ?? null);  // read at RENDER
useEffect(() => { … new IntersectionObserver(cb, { root: observerRoot, … }) … },
          [observerRoot, rootMargin, threshold, hasMore, enabled]);
```

`scrollRoot` is a `RefObject<HTMLElement | null>` whose `.current` the shell assigns during the
**commit** phase. On the first render of any consumer, `scrollRoot.current` is still `null`, so
`observerRoot` is `null` and the observer is created against the **viewport**, not the shell's
`.app-scroll` container. Mutating a ref does not schedule a re-render, so `observerRoot` is never
recomputed and the effect never re-runs: the wrong root is permanent for the life of the component.

The consequence is a degraded, not dead, sentinel (viewport intersection still fires geometrically),
but `rootMargin: '200px'` is then measured against the viewport rather than the scrollport, so the
prefetch distance is wrong and the behaviour differs between the app shell and a plain page — which
is the exact coupling the hook's own docblock says it exists to remove (lines 30-34).

**This is invisible to the test suite by construction.** `packages/ui/tests/infinite-scroll.test.tsx`
proves the wiring by passing `scrollRef={{ current: contextElement }}` (lines 161, 179) — a ref that
is *already populated at render time*, which no real DOM ref ever is on first paint.

**Fix:** resolve the root inside the effect, where refs are attached, and re-arm on mount:

```ts
useEffect(() => {
  const sentinel = sentinelRef.current;
  if (!sentinel || !hasMore || !enabled) return;
  const resolvedRoot = root !== undefined ? root : (scrollRoot?.current ?? null);
  const observer = new IntersectionObserver(cb, { root: resolvedRoot, rootMargin, threshold });
  …
}, [root, scrollRoot, rootMargin, threshold, hasMore, enabled]);
```

and add a test that mounts the provider with a ref attached to a real rendered element
(`<div ref={scrollRef}>`), not a hand-built object.

---

### A-WR-10: `CommentInput` guards re-entrancy with state where the repo's own lesson says use a ref

**File:** `packages/modules/feed/ui/CommentInput.tsx:90-101`

**Issue:**

```ts
const canSubmit = trimmed.length > 0 && !pending;          // computed at render
const submit = async (event?: FormEvent) => {
  if (!canSubmit) return;
  setPending(true);
  const accepted = await onSubmit(trimmed);
```

`canSubmit` is a value captured in the closure at render time, and `setPending(true)` only takes
effect after a commit. `AttachmentRow` in the same module explicitly rejects this pattern:

> "A REF, not the state below: the guard has to flip before the first `await`, because a second click
> can land before React commits `pending` (the **04-02 re-entrancy lesson**)." — `AttachmentRow.tsx:47-49`

The stakes are higher here than for a download: `createPostSchema`'s sibling `createCommentSchema`
has no idempotency key and the contracts file says so of the create path ("Deliberately NOT
idempotent … two identical requests create two distinct posts", `contracts/index.ts:116-118`). Two
Enter presses inside one commit window therefore produce **two comments**, two `comment.created`
events and a `comment_count` of 2.

The submit *button* is also `disabled={!canSubmit}`, but the `<form onSubmit>` path (Enter, and
`requestSubmit` from any host wrapper) bypasses the button entirely.

**Fix:** flip a ref before the first `await`, exactly as `AttachmentRow` does:

```ts
const inFlight = useRef(false);
const submit = async (event?: FormEvent) => {
  event?.preventDefault();
  if (inFlight.current || trimmed.length === 0) return;
  inFlight.current = true;
  setPending(true);
  try {
    if (await onSubmit(trimmed)) setValue('');
  } finally {
    inFlight.current = false;
    setPending(false);
  }
};
```

---

### A-WR-11: the platform tenant detail enumerates the *defaults* list, not the *toggleable* one

**File:** `packages/core/server/platform/tenants.ts:319-322`, against
`packages/contracts/src/modules.ts:2-26`

**Issue:** `getTenantDetail` builds the panel's module list from `REAL_TENANT_DEFAULT_MODULES`, while
every write path uses `TOGGLEABLE_MODULES` (`createTenant` at `tenants.ts:213-219`, and
`setModuleEnabled` accepts any `ModuleKey`, `modules.ts:23`). The contract's own docblock states the
two lists answer different questions and predicts they will diverge:

> "The two lists stay SEPARATE names because they answer different questions … and the day a module
> ships behind a paid tier, only the second one changes." — `contracts/src/modules.ts:14-18`

On that day, `createTenant` still writes a `tenant_modules` row for the paid key, `setModuleEnabled`
still flips it, and `moduleFlags` still honours it — but the panel stops rendering it, so a
`super_admin` can neither see nor toggle a module that is live for the tenant. A read that silently
drops a row the writes maintain is a latent correctness defect, not a style question.

**Fix:** read the vocabulary, not the default set:

```ts
modules: TOGGLEABLE_MODULES.map((key) => ({ key, enabled: enabledByKey.get(key) ?? false })),
```

`TOGGLEABLE_MODULES` is already imported at line 14.

---

### A-WR-12: `isUniqueViolation` reports an unnamed 23505 as a slug conflict

**File:** `packages/core/server/platform/tenants.ts:74-87` (line 82)

**Issue:**

```ts
if (e.code === '23505') {
  const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
  return name === '' || name.includes(constraintNeedle);   // ← empty name ⇒ MATCH
}
```

`name === ''` makes any unique violation whose constraint name the driver did not surface match
*whatever needle was asked for*. `createTenant`'s transaction (lines 201-227) performs three inserts:
`tenants`, a batch into `tenant_modules` (unique on `(tenant_id, module_key)`), and
`createPendingInvite`. A 23505 from either of the latter two is therefore reported to the caller as
`400 VALIDATION_FAILED { slug: 'taken' }` — a field error on a field that is fine, on a form the
`super_admin` then cannot get past.

This is the same defensive shape `isReplyDepthViolation` and `isMediaShapeViolation` in the feed
service deliberately avoid — both require an exact name match and let anything else surface as a 500,
with the rationale spelled out ("an unrelated integrity error must still surface as a 500 rather than
being mistranslated into a 400 the client would act on", `service.ts:586-594`, `:952-958`). The
kernel helper is the odd one out.

**Fix:** require the name, and scope the classification to the one statement that can raise it:

```ts
if (e.code === '23505') {
  return typeof e.constraint_name === 'string' && e.constraint_name.includes(constraintNeedle);
}
```

If the driver genuinely omits `constraint_name` on this path, narrow the `try` to the `tenants`
insert instead of wrapping the whole transaction.

## Info

### A-IN-01: a zero-width space is embedded in a source comment

**File:** `packages/modules/feed/db/schema.ts:49`

The glob in the docblock is written `packages/modules/*<U+200B>/db/schema.ts` — a zero-width space
sits between `*` and `/` so the sequence does not terminate the block comment. It works, but it is
invisible in every editor, it breaks a copy-paste of the glob into a shell, and it will not be
matched by a grep gate written against the literal path. Prefer escaping the comment differently
(`packages/modules/<module>/db/schema.ts`, or a line comment).

---

### A-IN-02: `LinkCandidate.url` is written and never read

**File:** `packages/modules/feed/server/service.ts:413`, set at `:437`

`resolveLinkCandidate` returns `{ url: raw, hash, normalised }`; both `upsertLinkPreview` and every
other consumer use only `hash` and `normalised`. Drop `url` from the type so nobody later assumes the
raw (un-normalised, un-hashed) spelling is what gets stored.

---

### A-IN-03: dead empty-string guards around `trimMatchedUrl`

**Files:** `packages/modules/feed/contracts/index.ts:186-189`,
`packages/modules/feed/ui/linkify.tsx:41`

`FEED_URL_PATTERN` requires at least one character after `https?://`, and
`FEED_URL_TRAILING_PUNCTUATION` cannot consume the scheme, so `trimMatchedUrl` can never return `''`.
Both `if (url.length > 0)` / `if (url.length === 0) continue` branches are unreachable. Harmless, but
they read as a live rule.

---

### A-IN-04: `tokens.test.ts`'s `block()` helper is a textual first-match

**File:** `packages/ui/tests/tokens.test.ts:15-21`

`block(selector)` takes `css.indexOf(selector)` — the first textual occurrence *anywhere in the file,
comments included* — then slices to the first `}`. `block('[data-theme="dark"]')` (line 113) happens
to hit the right rule only because of the current source order in `tokens.css`; reordering the file
silently re-points the assertion at a different block, and a selector mentioned in a comment (as
`[data-brand-scope][data-theme="light"]` is at `tokens.css:124`) can capture the match. Anchor on a
line-start regex instead.

---

### A-IN-05: `MediaImage` emits `srcSet=""` for an empty ladder

**File:** `packages/core/ui/MediaImage.tsx:69-71`

When `widths` is empty the component returns the fallback (`src === null`), so the empty `srcSet` is
currently unreachable — but the computation runs unconditionally and would emit `srcSet=""` the
moment `baseWidth` is passed with an empty ladder. Guard it: `srcSet={srcSet || undefined}`.

---

### A-IN-06: eight `console.error` calls in module UI, with no logger seam

**Files:** `CommentsList.tsx:235,263,282,333,410,494,513,751`, `FeedList.tsx:287,310`,
`AttachmentRow.tsx:73`, `PostMenu.tsx:174`

Each is deliberate ("the raw value goes to the console only; the member sees the generic message,
T-03-51") and none logs member content — the pattern is consistent and the values are `String(error)`.
Noted only because the module otherwise takes every capability by injection (share surfaces,
clipboard, media node, every label): a `onLogError?` prop or a `@rede-social/ui` logger would let the host
route these to Sentry, which is where a production failure needs to land.

---

### A-IN-07: `listPlatformTenants` does not clamp `limit`

**File:** `packages/core/server/platform/tenants.ts:103`

`const limit = query.limit ?? DEFAULT_LIMIT` with no upper bound; a caller passing `limit: 100000`
gets an unbounded page. The feed and comment queries clamp in their own Zod schemas
(`FEED_MAX_PAGE_SIZE`, `COMMENTS_MAX_PAGE_SIZE`) and the function's docblock says the service is
reachable from places that do not go through a route. **Cross-partition dependency:** Part B should
confirm `platformTenantsQuery` bounds `limit` at the route; if it does, a defensive
`Math.min(query.limit ?? DEFAULT_LIMIT, 100)` here still costs nothing.

---

### A-IN-08: the attachment download filename is used unsanitised

**File:** `packages/modules/feed/ui/AttachmentRow.tsx:66`

`anchor.download = attachment.filename` takes `media_assets.filename` — an admin-supplied string —
straight through. Browsers sanitise path separators on the `download` attribute, so this is not a
path-traversal, but a filename containing a right-to-left override or a double extension
(`relatório.pdf‮gpj.exe`) reaches the save dialog verbatim. Strip control characters and
directory separators before assigning.

---

### A-IN-09: the reply chip can read "Respondendo a " with no name

**File:** `packages/modules/feed/ui/CommentsList.tsx:544`

`startReply` does `name: comment.author.displayName ?? ''`, which is exactly the UI-D-24 removed-author
case (`displayName` is null precisely then). The chip then interpolates an empty name into
`labels.replyChip`. `CommentItem` already resolves this correctly for the row
(`CommentItem.tsx:104`, falling back to `labels.removedAuthor`); the chip should use the same value —
pass the resolved display name down, or repeat the `authorRemoved ? labels.item.removedAuthor : …`
fallback here.

---

_Reviewed: 2026-09-23_
_Reviewer: Claude (gsd-code-reviewer), Part A — `packages/**`_
_Depth: standard_
