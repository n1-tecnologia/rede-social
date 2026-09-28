---
phase: 04-feed
plan: 07
subsystem: ui
tags: [feed, comments, replies, bottom-sheet, optimistic-ui, rls, left-join, playwright]

requires:
  - phase: 04-03
    provides: "the comment/like data model, the one-level cap enforced by composite self-FK, listComments/listReplies and their statement budgets"
  - phase: 04-06
    provides: "the action row, the optimistic-like pattern, the `onOpenComments` seam and `apps/web/lib/feed-view.tsx`"
  - phase: 04-02
    provides: "the kernel UI primitives — BottomSheet, ConfirmDialog, Avatar, IconButton, Skeleton, Button"
provides:
  - "`CommentsList` — the ONE comment list, rendered in a bottom sheet over the feed and (04-08) inline on the post page"
  - "`CommentSheet`, `CommentItem`, `CommentInput`, `CommentsListSkeleton` and their prop types"
  - "a comment projection that survives a soft-deleted membership: LEFT-joined author, `author_removed`, nulled identity"
  - "`commentAuthorSchema` + `commentSchema.authorRemoved` — a comment's author is nullable where a post's is not"
  - "six comment clients in `apps/web/lib/feed.ts` and six server actions in `inicio/feed-actions.ts`"
  - "`commentView` — the ONE `FeedComment` → `CommentView` mapping"
  - "the shared `linkify`, now used by both the caption and the comment body"
  - "`apps/web/e2e/feed-comments.spec.ts` and the removed-author seed fixture"
affects: [04-08, 05-communities, 07-notifications, 08-moderation]

actuals:
  tokens: 33000
  tasks: 3
  commits: 3
  plan_head_before: 61a606125f7119e8435f6a09fc9ab55676321dcf

tech-stack:
  added: []
  patterns:
    - "One component, two containers, one `variant` prop — the D-59 shape for any surface that appears both in a sheet and inline"
    - "Mutually-exclusive render branches as a single if/else-if chain, so a false state is unreachable rather than merely unlikely"
    - "A LEFT join carrying the lifecycle predicate in the JOIN condition, so a removed relation nulls every identifying column in one step"
    - "A per-item delta map in the list, so a child surface can move a parent's server-owned count without rewriting the parent's rows"

key-files:
  created:
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/CommentItem.tsx
    - packages/modules/feed/ui/CommentInput.tsx
    - packages/modules/feed/ui/CommentSheet.tsx
    - packages/modules/feed/ui/linkify.tsx
    - apps/web/e2e/feed-comments.spec.ts
  modified:
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/feed/ui/PostCaption.tsx
    - packages/modules/feed/ui/index.ts
    - apps/web/lib/feed.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/registry.tsx
    - apps/web/app/(app)/inicio/feed-actions.ts
    - apps/web/messages/pt-BR/feed.json
    - apps/web/e2e/fixtures.ts
    - apps/api/tests/integration/feed-interactions.test.ts
    - scripts/seed.ts

key-decisions:
  - "A comment's author is a DIFFERENT schema from a post's (`commentAuthorSchema`), because a comment outlives its author's membership and a post does not — sharing one schema would force a post card to tolerate a null name, where a null name is a bug rather than a state"
  - "The membership lifecycle predicate (`ms.deleted_at is null`) rides the JOIN condition rather than a projected CASE, so `authorRemoved` and the three nulls are produced together and no code path can hand a client a removed member's name"
  - "`linkify` was extracted from `PostCaption` into its own module the moment a second surface needed it: the prohibition is that a comment's auto-linked URL must carry the SAME scheme restriction and rel attributes the caption uses, and one implementation satisfies that more strongly than two identical copies"
  - "The comment row's overflow control opens the confirmation DIRECTLY rather than an intermediate menu — with exactly one action in V1 a second layer over the sheet buys nothing and leaves the control named 'Mais opções' when it does precisely one thing. Phase 8's 'Denunciar' is when it becomes a menu"
  - "`FeedList` owns ONE `CommentSheet` for the whole column and a per-post comment-count delta, rather than a sheet per card: a sheet per card would mount a dialog, a focus trap and a confirmation dialog for every post on screen"
  - "The optimistic row is built from DATA the host passes (`viewer`, `nowLabel`), never from a builder function — a server component may hand a client component values and server actions, and nothing else"

patterns-established:
  - "Two surfaces, one implementation: the container difference is a `variant` prop on the shared component, never a second component"
  - "An error branch and an empty branch that would assert contradictory facts are written as one if/else-if chain and proven exclusive by a scoped grep, not by inspection"
  - "Optimistic rows carry `pending` and render their controls inert: a like or a delete addressed to an id the server has never seen would be a guaranteed 404"
  - "An e2e that writes deletes what it wrote through the UI, so a spec against the shared seed stays re-runnable in any order"

requirements-completed: [FEED-05, FEED-06, UI-02]

coverage:
  - id: D1
    description: "A comment whose author's membership was soft-deleted keeps its row, its text, its replies and its place in the trigger-maintained count — nameless and unlinkable (UI-D-24)"
    requirement: FEED-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#12. the comment survives the membership, nameless and unlinkable — and a live author does not"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#13. the live member's reply under that root is still returned, with its own author intact"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#14. the post's trigger-maintained commentCount still counts the removed author's comment"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#the row survives with the fixed label and no profile link, and its reply is still listed"
        status: pass
    human_judgment: false
  - id: D2
    description: "One `CommentsList` renders in a bottom sheet over the feed without navigating away, listing roots newest-first with replies behind a per-root toggle (D-59, D-60, D-62)"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#tapping the comment control opens the sheet without navigating away, and lists the roots"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#a thread expands on demand, and its reply can neither be replied to nor expanded (D-60)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The one-level reply cap is VISIBLE: an expanded reply renders no reply affordance and no toggle of its own — 04-03's open coverage item D13"
    requirement: FEED-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#a thread expands on demand, and its reply can neither be replied to nor expanded (D-60)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A new comment is appended optimistically, reconciled against the server's row, and the card's meta comment count follows it; a member deletes their own comment behind the confirmation and the count follows back (D-61)"
    requirement: FEED-05
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#a new comment lands at the top and the card's meta count follows it, and delete puts both back"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#liking a comment and liking a reply take the same path, and someone else's row offers no delete"
        status: pass
    human_judgment: false
  - id: D5
    description: "The reply chip targets a root and is independent of the text: dismissing it makes the identical gesture create a root comment (UI-02 / partial E12)"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#the reply chip targets a root, and dismissing it makes the next submit a root comment"
        status: pass
    human_judgment: false
  - id: D6
    description: "A failed comment load renders an inline error plus a retry where the rows would be and NEVER the empty-comments copy; a failed replies load does the same beneath the toggle without collapsing the thread (UI-D-22)"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#a failed comment list renders the inline error and retry where the rows would be"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#a failed replies load retries under the toggle without collapsing the thread"
        status: pass
      - kind: other
        ref: "awk '/^  } else if \\(listError\\) \\{/,/^  } else if \\(items.length === 0\\) \\{/' packages/modules/feed/ui/CommentsList.tsx | grep -c emptyLabel  → 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "Comment likes ride the same idempotent toggle as post likes, on roots and replies alike (FEED-06)"
    requirement: FEED-06
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#liking a comment and liking a reply take the same path, and someone else's row offers no delete"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#7. liking a comment and liking a reply take the same idempotent path"
        status: pass
    human_judgment: false
  - id: D8
    description: "Loading N root comments issues ZERO reply requests, and neither `reply_count` nor `viewer_liked` added a statement — the 04-03 budgets hold at FEED_LIST=1 / FEED_DETAIL=3"
    requirement: FEED-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#costs at most 3 statements for the post plus its comments"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-query-budget.test.ts#a \"ver respostas\" tap costs at most 1 statement"
        status: pass
    human_judgment: false
  - id: D9
    description: "A 40-character display name wraps with the comment text inside a comment row at 320px — the comment-row half of the 04-06 long-text backstop, against the same seeded member"
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-comments.spec.ts#the long display name wraps with the comment text instead of clipping the row"
        status: pass
    human_judgment: false
  - id: D10
    description: "No HTML-injection sink in any comment component; an auto-linked URL in a comment carries the caption's own scheme restriction and link relationship attributes (T-04-43)"
    verification:
      - kind: other
        ref: "grep -rc dangerouslySetInnerHTML packages/modules/feed/ui/  → 0; CommentItem and PostCaption both call the single `linkify` in packages/modules/feed/ui/linkify.tsx"
        status: pass
    human_judgment: false
  - id: D11
    description: "Every string the comment components render arrives as a prop from the pt-BR catalog"
    requirement: UI-02
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
      - kind: other
        ref: "grep -c 'useTranslations\\|getTranslations' on CommentsList/CommentItem/CommentInput  → 0 each"
        status: pass
    human_judgment: false
  - id: D12
    description: "Sheet-specific geometry a test cannot judge: the 0.8 height cap, the pinned composer above the mobile keyboard, the safe-area padding, and the submit glyph's spring-in"
    requirement: UI-02
    verification: []
    human_judgment: true
    rationale: "The sheet's height, the composer's behaviour with the on-screen keyboard raised, and the spring timing are visual/physical properties of a real device. Playwright's viewport has no software keyboard, so no automated check can distinguish 'pinned above the keyboard' from 'pinned to the bottom of a viewport that has no keyboard'."

duration: 35 min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 07: Comments, Replies and the Comment Sheet — Summary

**One `CommentsList` in two containers, with replies collapsed behind a per-root toggle that loads its own page, a one-level cap the UI refuses as visibly as the database does, and a comment projection that keeps a removed author's thread instead of orphaning it.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-23T01:52:11Z
- **Completed:** 2026-09-23T02:27:39Z
- **Tasks:** 3 of 3
- **Files modified:** 19 (6 created, 13 modified)

## Accomplishments

- **The comment projection now survives its author.** `commentProjection` reaches `memberships`/`member_profiles` through a LEFT join carrying `ms.deleted_at is null` in the JOIN condition, so a soft-deleted membership yields `author_removed: true` together with a null `membership_id`, `display_name` and `avatar_asset_id` in one step. The inner join it replaced would have dropped the row, orphaned every reply hanging off it by `parent_id`, and left the trigger-maintained `comment_count` describing a comment nobody could see. Three integration cases and one e2e case now hold that shut, each with a live-author positive control on the same page.
- **`CommentsList` is the single implementation both surfaces share (D-59).** It renders inside `CommentSheet` over the feed today and inline on `/post/[id]` in 04-08; the only difference between the two is a `variant` prop that pins the composer inside the sheet's scrollport. There is no second comment renderer anywhere in the tree.
- **The one-level cap is now visible, which is the coverage item 04-03 left open (D13).** A row rendered with `isReply` gets no reply control and no toggle of its own — and the e2e asserts both absences on a real reply in a real browser. Until this plan, the cap existed only as a database constraint nobody could see refusing anything.
- **UI-D-22 is enforced by construction, not by care.** The list body is one if/else-if chain (`loading` → `listError` → `empty` → rows), so there is no path on which a failed load reaches the empty copy and tells a member that a post they know has comments has none. The e2e asserts it as an absence, and a scoped grep proves the branches cannot overlap.
- **Replies load per root, on demand.** Rendering N roots issues zero reply requests; `reply_count` (already hydrated by 04-03 in the same statement) drives the ICU-plural toggle, and expanding one root costs exactly one bounded request. The 04-03 statement budgets are unchanged and still asserted in CI.
- **The auto-linker is now shared.** `linkify` moved out of `PostCaption` into its own module the moment a second surface needed it, so the caption and the comment body cannot drift on which schemes may become an `href` or which `rel` goes on it.

## Task Commits

1. **Task 1: the comment projection survives a removed author** — `4debbaf` (feat)
2. **Task 2: one CommentsList in two containers, and the six comment actions** — `322984d` (feat)
3. **Task 3: drive the comment surface on a real mobile browser** — `8d5c43a` (test)

**Commits measured, not narrated:** `git rev-list --count 61a6061..HEAD` = **3**.

## Files Created/Modified

### Created
- `packages/modules/feed/ui/CommentsList.tsx` — THE list: roots newest-first, per-root reply expansion, the three loading states, both UI-D-22 inline errors, the empty state, optimistic create with reconciliation, and the shared delete confirmation. Exports `CommentsListSkeleton`.
- `packages/modules/feed/ui/CommentItem.tsx` — one row, capped at one level by `isReply`, with the removed-author variant and the own-comment delete control.
- `packages/modules/feed/ui/CommentInput.tsx` — the composer: 16px field (the iOS zoom guard), the trimmed-value submit gate, the spring-in glyph, the in-flight spinner, and the dismissible reply chip.
- `packages/modules/feed/ui/CommentSheet.tsx` — the bottom-sheet container. Contains no height class at all (UI-D-18).
- `packages/modules/feed/ui/linkify.tsx` — the one render-time auto-linker for member text.
- `apps/web/e2e/feed-comments.spec.ts` — nine mobile cases; 26 s against the T2 five-minute ceiling.

### Modified
- `packages/modules/feed/server/service.ts` — the LEFT-joined comment projection, `author_removed`, and the docblock that says why an inner join is a bug here.
- `packages/modules/feed/contracts/index.ts` — `commentAuthorSchema` (nullable identity) and `commentSchema.authorRemoved`; `replyCount` documented against the toggle it drives.
- `packages/modules/feed/ui/FeedList.tsx` — owns one `CommentSheet` for the column and a per-post comment-count delta; `commentCountApplied` returns the original object when nothing applies.
- `packages/modules/feed/ui/PostCaption.tsx` — now calls the shared `linkify`.
- `apps/web/lib/feed.ts` — `getComments`, `getReplies`, `createComment`, `deleteComment`, `likeComment`, `unlikeComment`, each parsed with its contract schema. Still the only feed request module.
- `apps/web/lib/feed-view.tsx` — `commentView`, the one `FeedComment` → `CommentView` mapping, and where UI-D-24 becomes a null `profileHref`.
- `apps/web/app/(app)/inicio/feed-actions.ts` — the six actions, with `reply_depth_exceeded` mapped to its own result code rather than surfaced raw.
- `apps/web/lib/registry.tsx` — `commentsProps` composes the labels, the viewer and the six server actions.
- `apps/web/messages/pt-BR/feed.json` — every comment row from the UI-SPEC Copywriting Contract.
- `apps/web/e2e/fixtures.ts` — `seededComments`, mirrored from the seed.
- `apps/api/tests/integration/feed-interactions.test.ts` — the three UI-D-24 cases (12, 13, 14).
- `scripts/seed.ts` — the removed-author member, their root, a live member's reply under it, and a live-author root beside it as the positive control, in both tenants.

## Decisions Made

1. **A comment's author schema is not a post's.** `commentAuthorSchema` nullable, `feedPostAuthorSchema` unchanged. A post is written by the tenant's admin and the card's whole identity claim (D-52) rests on that person being present; a comment outlives its author's membership. Sharing one schema would have forced the looser rule onto the post card, where a null name is a bug rather than a state.
2. **The lifecycle predicate rides the JOIN condition.** `left join memberships ms on ms.user_id = c.author_user_id and ms.deleted_at is null` makes `authorRemoved` simply `ms.id is null`, and nulls the three identifying columns in the same step. A projected `CASE` would have left three places to forget.
3. **One overflow control, one destination.** The comment row's delete control opens the confirmation directly. D-61 asks for "the row's own overflow control, behind a confirmation dialog"; with exactly one action in V1, an intermediate menu adds a second layer over the sheet for nothing and leaves the control named "Mais opções" when it does precisely one thing. Phase 8's "Denunciar" is when it becomes a menu.
4. **One sheet per column, not per card.** `FeedList` holds the single `CommentSheet` and tracks which post it is open on. A sheet per card would mount a dialog, a focus trap and a confirmation dialog for every post on screen, and paging the feed would multiply them.
5. **The card's meta count moves by a tracked DELTA, not by rewriting rows.** A delta map keyed by post id is added to the server's value at render and cleared on every refresh — because a refresh legitimately replaces the list with the server's authoritative counts, at which point any delta is stale by construction.
6. **The optimistic row is built from data, not from an injected builder.** A server component may hand a client component values and server actions and nothing else, so `CommentsList` takes `viewer` + `nowLabel` and assembles the pending row itself. The one clock it reads is `new Date()` inside the submit handler — an event, not a render, so UI-D-14's hydration rule is untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `buildOptimistic` could not be a prop: a plain function cannot cross the RSC boundary**

- **Found during:** Task 2
- **Issue:** The plan's list shape implied the host would build the optimistic row. `lib/registry.tsx` is a server component and `CommentsList` is a client component; React Flight accepts values and server actions across that boundary, not arbitrary functions. A `buildOptimistic` prop would have failed at runtime the first time a member typed a comment.
- **Fix:** Replaced it with `viewer: CommentViewer` + `labels.nowLabel` — data the host already has — and the list assembles the pending row itself.
- **Files modified:** `packages/modules/feed/ui/CommentsList.tsx`, `apps/web/lib/registry.tsx`
- **Verification:** `pnpm --filter @rede-social/web build` (the Next build reports server/client boundary errors) and the e2e case that submits a comment and waits for `aria-busy` to clear.
- **Committed in:** `322984d`

**2. [Rule 2 — Missing critical] `linkify` extracted into a shared module**

- **Found during:** Task 2
- **Issue:** The plan asked the comment body to use "the same render-time URL auto-linking the caption uses", and the plan's own prohibition names drift on the scheme restriction and the `rel` attributes as the risk. `linkify` was a private function inside `PostCaption.tsx`; copying it into `CommentItem.tsx` would have created exactly the two-implementations condition the prohibition warns about.
- **Fix:** Moved it to `packages/modules/feed/ui/linkify.tsx` with the three rules it holds documented there; `PostCaption` and `CommentItem` both call it. `PostCaption.tsx` is not in the plan's `files_modified`, so this widened the file list by one modification and one creation.
- **Files modified:** `packages/modules/feed/ui/linkify.tsx` (new), `packages/modules/feed/ui/PostCaption.tsx`, `packages/modules/feed/ui/CommentItem.tsx`
- **Verification:** `grep -rc dangerouslySetInnerHTML packages/modules/feed/ui/` → 0; `pnpm --filter @rede-social/module-feed test` (91 pass, including the existing caption tests).
- **Committed in:** `322984d`

**3. [Rule 3 — Blocking] `commentView` added to `feed-view.tsx`, a file the plan did not list**

- **Found during:** Task 2
- **Issue:** Both `inicio/feed-actions.ts` and (potentially) `lib/registry.tsx` need the `FeedComment` → `CommentView` mapping. Putting it in `registry.tsx` would have recreated the `registry ↔ feed-actions` cycle across the `'use server'` boundary that 04-06 broke by creating `feed-view.tsx` in the first place.
- **Fix:** `commentView` lives beside `postCardView` in `apps/web/lib/feed-view.tsx` — one mapping, the established home for it.
- **Files modified:** `apps/web/lib/feed-view.tsx`
- **Verification:** `pnpm --filter @rede-social/web build` and `pnpm boundaries` both green.
- **Committed in:** `322984d`

**4. [Rule 2 — Missing critical] A live-author root seeded on the same post as the removed-author thread**

- **Found during:** Task 1
- **Issue:** The plan's seed asked for one removed-author comment plus one reply. With that alone, the root list for that post contains a single row, and the "a LIVE author's comment reports `authorRemoved: false`" positive control the same task asks for had nothing on the page to assert against — it would have had to reach to a different post, which is exactly the vacuous-pass shape 03-08's positive-control rule exists to prevent.
- **Fix:** A third seeded row: a live member's root comment on the same post. `SEED_REMOVED_AUTHOR_COMMENT_IDS` is now `[root, reply, liveRoot]`.
- **Files modified:** `scripts/seed.ts`, `apps/api/tests/integration/feed-interactions.test.ts`, `apps/web/e2e/fixtures.ts`
- **Verification:** integration case 12 and the UI-D-24 e2e case both assert the control explicitly by its seeded id.
- **Committed in:** `4debbaf`

**5. [Rule 3 — Blocking] `onDeleteComment` returns `{ ok: boolean }`, not `boolean`**

- **Found during:** Task 2
- **Issue:** Every other web action in this app returns a result envelope; a bare `boolean` would have been the one exception, and it did not typecheck against `deleteCommentAction`.
- **Fix:** The module's prop type is `Promise<{ ok: boolean }>`, and the list treats a rejection and a refusal identically — the row leaves only on a confirmed delete.
- **Files modified:** `packages/modules/feed/ui/CommentsList.tsx`
- **Verification:** `pnpm --filter @rede-social/web typecheck`; the e2e delete case.
- **Committed in:** `322984d`

**6. [Rule 2 — Missing critical] `reply_depth_exceeded` earned its own catalog sentence**

- **Found during:** Task 2
- **Issue:** The plan asks the action to map the API's reply-depth refusal to its own catalog key, but the list had only one submit-error label. Showing "Não foi possível publicar seu comentário" for a refusal the member can actually act on (reply to the root instead) tells them nothing.
- **Fix:** `CommentCreateOutcome` carries an optional `code`, the list picks between `submitErrorLabel` and a new `replyDepthErrorLabel`, and `feed.errors.replyDepth` was added to the catalog. The raw machine code still never reaches the DOM (T-04-42).
- **Files modified:** `packages/modules/feed/ui/CommentsList.tsx`, `apps/web/lib/registry.tsx`, `apps/web/messages/pt-BR/feed.json`
- **Verification:** `bash scripts/check-ui-literals.sh`; `pnpm --filter @rede-social/web typecheck`.
- **Committed in:** `322984d`

### Acceptance criteria whose literal grep differs from its intent

Two criteria are written as greps that cannot return the stated number against a correct implementation. Both were verified against their **intent** with a substitute command, reported here rather than silently passed:

1. **Task 1** — `grep -c "inner join memberships\|join memberships ms on"` was to "count no inner join". The alternation's second branch also matches the LEFT join that replaced it (`left join memberships ms on …`), so it returns 1 for a correct implementation. Verified instead with `grep -c "inner join memberships" packages/modules/feed/server/service.ts` → **0**, plus the three integration cases that prove the behaviour.
2. **Task 2** — `awk '/initialError|listError/,/^  \}/' CommentsList.tsx | grep -c emptyLabel` was to print 0. The awk range opens on the first prose mention in the file's docblock and never closes where the criterion assumed, so it spans the props type as well and returns 2 — both hits being a type declaration and a comment, neither a reachable branch. Verified instead with a range scoped to the branch itself: `awk '/^  } else if \(listError\) \{/,/^  } else if \(items.length === 0\) \{/' | grep -c emptyLabel` → **0**, and the reverse (`errorLabel` inside the empty branch) → **0**.

A third criterion passes only through documentation and is reported for the same reason: **Task 2**'s `grep -c 'rel="noopener noreferrer nofollow"' CommentItem.tsx` returns 1, but the hit is a docblock line — the real anchor lives in the shared `linkify.tsx` (deviation 2). `grep -rc 'rel="noopener noreferrer nofollow"' packages/modules/feed/ui/linkify.tsx` → 1, and `CommentItem` imports it.

---

**Total deviations:** 6 auto-fixed (Rule 2 × 3, Rule 3 × 3). No Rule 4 escalations.
**Impact on plan:** All six were required for correctness or for the plan's own stated guarantees. Three widened the file list (`linkify.tsx` created, `PostCaption.tsx` and `feed-view.tsx` modified); none changed what the plan delivers.

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `profileHref: null` for the viewer's optimistic comment row | `apps/web/lib/registry.tsx` | 162 | **Intentional, and not resolved by a later plan.** The bootstrap payload carries the viewer's profile (`displayName`, `avatarUrl`) but not their `membershipId`, so there is no id to build `/membros/{id}` from. The consequence is bounded to the lifetime of a pending row — typically under a second — after which the server's reconciled row supplies the real link. A pending row's controls are already inert by design, so rendering its author name as plain text is the honest state rather than a missing feature. Adding `membershipId` to the bootstrap is a kernel contract change with no other consumer asking for it; it would be Rule 4 work, not this plan's. |

No other stubs: no `TODO`/`FIXME`, no placeholder copy, no component wired to an empty data source.

## Issues Encountered

**`feed.spec.ts` flakes under repeated runs — pre-existing, not caused by this plan.** A combined run of the four feed specs failed once on `feed-media.spec.ts:35` (desktop) and once on `feed.spec.ts:332` (desktop) — a different test each time. Isolating the cause: `playwright test feed.spec.ts --repeat-each=3`, with **no 04-07 spec in the run at all**, fails 10 of 69, again on different tests each pass, all of them timing assertions on a server-action round trip. A single pass of every feed spec together is green, and `feed-comments.spec.ts` is 9/9 green on three separate runs. The cause is the local `next dev` server under sustained load, not the feature — no failure is reproducible in isolation and none names a wrong value, only a value that had not arrived yet. Logged as item 4 in `.planning/phases/04-feed/deferred-items.md`; out of scope by the scope-boundary rule (this plan did not touch `feed.spec.ts`).

**The shared seed was left exactly as found.** Every write the new e2e makes is deleted through the UI before the test ends; `select count(*) from feed_comments where body like 'e2e comentario%' and deleted_at is null` → 0 after the full run.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready for 04-08 (the post page).** `CommentsList` already takes `initialItems` / `initialCursor` / `initialError` and `variant="inline"`, so `/post/[id]` seeds it server-side and renders it beneath the card with no new component. `CommentsListSkeleton` is exported for that route's loading boundary. The `partial E10,E13` UI-SPEC row's E13 half (the post renders in full even when its comments fail) is 04-08's to lift; the E10 half is closed here.

**Ready for Phase 8 (MODER-01).** The delete route is the one Phase 8 widens with a permission, `canDelete` already rides each row from the server, and the comment row's single-action overflow control is where "Denunciar" joins and turns it into a menu.

**Ready for Phase 7 (notifications).** `comment.created` and `comment.liked` already carry the recipient ids; nothing in this plan changed the event payloads.

**One note for whoever touches the comment projection next:** the LEFT join's `ms.deleted_at is null` is load-bearing in the JOIN condition specifically. Moving it into the `WHERE` clause would silently restore the inner-join behaviour this plan removed — the row would disappear again, and every reply under it with it.

## Self-Check: PASSED

- All six created files exist on disk (`[ -f ]` verified).
- All three task commits found in `git log --oneline --all`.
- `git rev-list --count 61a6061..HEAD` = 3, matching the `commits:` frontmatter.
- Plan-level verification re-run at close-out: `pnpm --filter @rede-social/module-feed typecheck lint test` (91 pass), `pnpm --filter @rede-social/web typecheck lint build`, `bash scripts/check-ui-literals.sh`, `bash scripts/check-static-routes.sh`, `pnpm boundaries`, `pnpm test:integration -- feed` (369 pass), `playwright test feed-comments.spec.ts --project=mobile-chromium` (9 pass, 26 s) — all green.

---
*Phase: 04-feed*
*Completed: 2026-09-23*
