---
phase: 05-communities-stories
plan: 07
subsystem: api
tags: [stories, comments, constraints, generated-column, composite-fk, pitfall-1, pitfall-2, pitfall-8, D-82, D-83, machine-codes, STORY-05]

requires:
  - phase: 05-communities-stories
    provides: "05-05's stories table with feed_comments.story_id / feed_likes.story_id finally referential, and its hand-written-FK precedent; 05-06's StoryViewer with externallyPaused wired and fed by nothing, the disabled Comentar control, and app.feed_like_count()'s third branch"
  - phase: 04-feed
    provides: "feed_comments with its composite self-FK, unique (id, depth) and the two CHECKs; feed_likes with its typed nullable targets; CommentsList / CommentSheet / CommentItem / CommentInput; app.feed_comment_count(); the ONE cursor envelope in packages/core/server/paging.ts"
  - phase: 03-media-profiles
    provides: "avatarUrlFor and the member_profiles projection the removed-author row reads through"
  - phase: 01-foundations
    provides: "withTenantTx, tenantIsolationPolicy, requireAuth/requireModule, the module manifest and its EventMap declaration merging"
provides:
  - "feed_comments.target_kind — a STORED GENERATED discriminator that makes a comment's TARGET visible to a referential check"
  - "feed_comments_id_depth_kind_uq / feed_comments_id_kind_uq and the THREE-column feed_comments_parent_fk: a story comment is unreachable as a parent"
  - "feed_likes.comment_target_kind + feed_likes_comment_kind_chk + feed_likes_comment_fk: a story comment is unlikeable, at the index"
  - "Both CHECKs rewritten with an explicit `is not null` on every equality — Pitfall 1 and Pitfall 2 closed in the same statement"
  - "feed_comments_tenant_story_root_asc_idx — D-83's ascending index, with no Sort node"
  - "keysetComparison(direction) — the operator and the order as ONE value on the ONE cursor envelope"
  - "listStoryComments / createStoryComment / deleteStoryComment and GET/POST /v1/stories/{id}/comments, DELETE /v1/stories/{id}/comments/{commentId}"
  - "story_comment_no_reply / story_comment_not_likeable — two refusals, two codes, both translations of a SQLSTATE"
  - "The story branch of app.feed_comment_count(), on insert, on the soft-delete TRANSITION and on delete"
  - "CommentsList's `flat` variant, CommentSheet's `variant`, and StoryViewer's `overlay` — one list, now three containers"
  - "story.commented / story.comment_deleted, ids only, declaration-merged into the kernel EventMap"
  - "deleteStoryCommentsByBodyPrefix — the e2e fixture sweep"
affects: [05-08, 07-notifications, 08-moderation]

actuals:
  # chars/4 over the realized diff 5c9c717..HEAD (215,872 chars; lockfile and the drizzle snapshot
  # excluded) at SUMMARY write — the same scale the estimate used, reported whole and unrounded.
  tokens: 53968
  tasks: 3
  # MEASURED: git rev-list --count 5c9c717..HEAD was 6 at SUMMARY write (the six task commits);
  # 7 once this metadata commit lands, which is what a later `git rev-list` will read.
  commits: 7
plan_head_before: 5c9c7172fe00282e60a7a0ad4e08b69b6567e096

tech-stack:
  added: []
  patterns:
    - "A STORED GENERATED discriminator turns a polymorphic target into something a composite FOREIGN KEY can see — so 'this row may not point at that row' becomes an index lookup rather than a read-then-write trigger two concurrent inserts could both pass"
    - "A CHECK and a composite foreign key are ONE mechanism: SQL's three-valued logic makes a NULL branch SATISFIED, and MATCH SIMPLE skips a composite key with any null column. Written apart, each has the other's hole"
    - "The refusal is written INTO the insert: the service names the literal ('post', 0) rather than the parent's own columns, so the statement is built to be refused by the database and the service only translates the SQLSTATE"
    - "One cursor envelope, two directions: the comparison operator and the `order by` direction kept in ONE returned value so they cannot drift a statement apart (Pitfall 8)"
    - "A component chooses its shell from the HANDLERS it is given — withholding `onToggleLike` removes the heart entirely rather than disabling it, so the list needs no branch about what a comment looks like"
    - "A count that must move without re-creating a memoised array: the child REGISTERS its setter with the parent (the `bindPlay` shape), instead of the parent holding the state and invalidating every media render function"
    - "A plain async function cannot cross the RSC boundary — Next refuses to serialise it and takes the whole home slot down with it. Even a no-op handler passed to a client component has to be a server action"

key-files:
  created:
    - supabase/migrations/20260924005427_story_comment_rules.sql
    - packages/core/tests/paging.test.ts
    - packages/modules/stories/tests/story-comments-contract.test.ts
    - packages/modules/feed/tests/comments-list-flat.test.tsx
  modified:
    - packages/modules/feed/db/schema.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/CommentItem.tsx
    - packages/modules/feed/ui/CommentInput.tsx
    - packages/modules/feed/ui/CommentSheet.tsx
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/server/routes.ts
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/module.ts
    - packages/modules/stories/ui/StoryViewer.tsx
    - packages/core/server/paging.ts
    - apps/web/components/stories/StoryViewerHost.tsx
    - apps/web/components/stories/StoryViewerHost.test.tsx
    - apps/web/components/stories/StoriesSurface.tsx
    - apps/web/components/feed/PostDetail.tsx
    - apps/web/app/(app)/stories/story-actions.ts
    - apps/web/app/(app)/stories/[storyId]/page.tsx
    - apps/web/lib/stories.ts
    - apps/web/lib/story-view.ts
    - apps/web/lib/registry.tsx
    - apps/web/messages/pt-BR/stories.json
    - apps/web/e2e/stories.spec.ts
    - apps/web/e2e/admin.ts
    - apps/api/tests/integration/stories.test.ts
    - apps/api/tests/integration/feed-interactions.test.ts
    - apps/api/tests/integration/feed-query-budget.test.ts
    - supabase/tests/110-communities-stories.sql
    - supabase/tests/090-feed.sql
    - scripts/seed.ts

key-decisions:
  - "The whole STORY-05 machinery stayed in `packages/modules/feed/db/schema.ts` and drizzle-kit emitted every piece cleanly — the generated column, both uniques, both composite foreign keys, both CHECKs and the partial index. The plan's fallback (move only the resisting constraint to a `--custom` migration) was never needed, so nothing is split. What WAS hand-written is the ORDER: the generator emitted the foreign key before the uniques it references and the CHECKs before the backfill, and both orders abort."
  - "`story_comment_not_likeable` is translated in `packages/modules/feed/server/service.ts`, not in the stories module. Liking a comment is `POST /v1/feed/comments/{id}/like` — the feed's route — and inventing a story-comment-like endpoint just to hold a refusal would create the affordance the requirement removes. Both codes are enumerated together in the stories module's `STORY_COMMENT_ISSUES` so the web still has ONE exhaustive switch."
  - "`CommentsList`'s `postId` prop became `targetId`. A story id is not a post id, and the list never reads the value — it hands it straight back to the handlers. Four call sites, one rename, and the alternative was a prop that lies on one of the three surfaces."
  - "The comment sheet is INJECTED into `StoryViewer` as an `overlay` node, the resolution 05-06 reached for `LikeButton`. It is a CHILD of the dialog root rather than a sibling, and that placement is load-bearing twice: the viewer's focus trap enumerates its own descendants, and the sheet's Escape `stopPropagation` only shields the viewer's `onKeyDown` when the viewer is an ancestor."
  - "`CommentItem` renders NO heart when `onToggleLike` is absent, rather than a disabled one. The flat variant then removes the control by withholding a handler — the `StoryCircle` rule, so the list needs no conditional about what a comment looks like."
  - "The viewer's comment count moves through a setter the action row REGISTERS with the host, not through host state. Holding the delta in `StoryViewerHost` would change the identity of the memoised `viewerItems` on every comment, re-creating every media render function and re-mounting the image the member is looking at while the sheet is open."
  - "The sheet's copy is read from the FEED namespace at the composition point. `stories.json` gains exactly two strings, both refusals, and the e2e imports `feed.json` to assert it — so duplicating the comment copy into the stories namespace turns the walk red."
  - "`storyCommentSchema` carries no `likeCount`, `viewerLiked`, `replyCount` or `isReply`. Four fields that could only ever be zero would be four things a future reader would wire a control to; the payload's SHAPE is the product rule restated where it cannot be missed."

patterns-established:
  - "happy-dom's `Animation.cancel()` REJECTS the animation's `finished` promise and `motion` attaches no catch: unmounting a `BottomSheet` mid-transition raises an unhandled rejection that fails the whole Vitest run while every assertion passes. A suite about which nodes exist should mock `motion/react` into plain elements rather than wait the animation out."
  - "A plain async function passed as a prop to a client component from an RSC takes the WHOLE slot down — even a no-op. It has to be a server action."
  - "The seeded storage objects are not durable across an integration run: a `pnpm test:integration` pass leaves the demo tenant's fixed-id media assets with no `storage.objects` rows, and every viewer e2e then fails on a clock that never starts because the image never loads. `pnpm db:reset && pnpm db:seed` before a viewer e2e run; the failure looks exactly like a broken clock."

requirements-completed: [STORY-05]

coverage:
  - id: D1
    description: "STORY-05 in full: a member can comment on a story, and a reply to a story comment is refused by the DATABASE — honestly (23514 on the shape CHECK) and while lying (23503 on the three-column composite foreign key), each beside its positive control"
    requirement: STORY-05
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#31 STORY-05: a reply naming the story kind HONESTLY is refused by feed_comments_parent_shape_chk"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#32 STORY-05: a reply LYING about the parent kind is refused by the composite feed_comments_parent_fk"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#33 positive control: a reply to a POST comment is still accepted after the rewrite"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#33. a REPLY to a story comment is refused BY MACHINE CODE — the database raised it"
        status: pass
    human_judgment: false
  - id: D2
    description: "A like on a story comment is refused by the DATABASE, both honestly and while lying, and the NULL-discriminator bypass (Pitfall 2) is refused too — with a like on a post comment and a like on the story itself as positive controls"
    requirement: STORY-05
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#37 STORY-05: a like naming the story kind HONESTLY is refused by feed_likes_comment_kind_chk"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#38 STORY-05: a like LYING about the comment kind is refused by the composite feed_likes_comment_fk"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#39 PITFALL 2 CLOSED: a NULL discriminator no longer disables feed_likes_comment_fk"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#35. a LIKE on a story comment is refused BY MACHINE CODE, on the feed's own like route"
        status: pass
    human_judgment: false
  - id: D3
    description: "Pitfall 1 CLOSED: the probe that INSERTED against the real table — a depth-1 comment with a parent id and a NULL parent depth — now raises 23514, asserted in the Phase 4 acceptance file as well as this phase's"
    requirement: STORY-05
    verification:
      - kind: integration
        ref: "supabase/tests/090-feed.sql#6 PITFALL 1: a parent_id with a NULL parent_depth is REFUSED — a NULL check is no longer satisfied"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#36 PITFALL 1 CLOSED: a parent id with a NULL parent_depth no longer satisfies a NULL check"
        status: pass
      - kind: other
        ref: "cat *_story_comment_rules*.sql | grep -vE '^[[:space:]]*--' | grep -c 'is not null' => 17 (>= 6); 'create trigger' => 0; 'security definer' => 0; 'greatest(0' => 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Phase 4's behaviour is UNCHANGED by the rewrite: a reply still works, a reply to a reply is still refused with `reply_depth_exceeded` and not with STORY-05's code, a post comment is still likeable and still idempotent, and the generated discriminator really is 'post'"
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#16. a reply to a REPLY is still refused with Phase 4's OWN machine code, not STORY-05's"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#17. a post comment is still LIKEABLE, and the toggle is still idempotent"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-interactions.test.ts#18. the generated discriminator really is `post` for a post comment and its reply"
        status: pass
      - kind: integration
        ref: "pnpm test:integration — 29 files, 455/455 (was 440)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-83: the story's flat conversation runs OLDEST first, pages FORWARD on the one cursor envelope, and is served by its own ascending index with NO Sort node"
    requirement: STORY-05
    verification:
      - kind: unit
        ref: "packages/core/tests/paging.test.ts#2. the ASCENDING direction is `>` ordered `asc` — a story's flat conversation (D-83)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/paging.test.ts#3. the operator and the order always AGREE — a mismatched pair is the Pitfall-8 bug"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#47 D-83 / Pitfall 8: the ascending order comes OFF the index — no Sort node, never a Seq Scan"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#32. the list runs OLDEST first and pages FORWARD, never repeating and never skipping"
        status: pass
    human_judgment: false
  - id: D6
    description: "`stories.comment_count` is trigger-owned by the SINGLE existing counter function, follows the soft-delete TRANSITION, and reconciles against the rows for every story in the database"
    requirement: STORY-05
    verification:
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#42 stories.comment_count follows insert, SOFT delete, restore and hard delete — exactly once each"
        status: pass
      - kind: integration
        ref: "supabase/tests/110-communities-stories.sql#43 stories.comment_count equals count(*) of that story's live comment rows, for every story"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#38. DELETE soft-deletes the member's OWN comment and moves the count exactly ONCE"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-82: there is still exactly ONE comment list, and its flat variant renders no reply control, no replies toggle and no per-comment like — each paired with the inline variant still rendering it"
    requirement: STORY-05
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/comments-list-flat.test.tsx#1-3 (no reply control / no replies toggle / no per-comment like)"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/comments-list-flat.test.tsx#4. POSITIVE CONTROL: the SAME rows in the inline variant still render all three"
        status: pass
      - kind: other
        ref: "find packages apps -name '*CommentsList*.tsx' | wc -l => 1; grep -c 'export function CommentsList(' => 1"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#the sheet pauses the story… (toHaveCount(0) for data-comment-reply, data-replies-toggle and data-comment-like inside the sheet)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The story PAUSES while the sheet is open and resumes from its stored elapsed when it closes, through the same single paused boolean the hold gesture feeds"
    requirement: STORY-05
    verification:
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#10. opening the sheet PAUSES the story, and closing it resumes"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/stories.spec.ts#the sheet pauses the story, the new comment lands at the BOTTOM, and closing resumes"
        status: pass
    human_judgment: false
  - id: D9
    description: "UI empty/loading/error/partial/E06: the shipped empty copy, the three-row skeleton, the two error branches and the removed-author row are reused verbatim in the flat variant"
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/comments-list-flat.test.tsx#5-7 (empty copy + composer + region label; error-with-retry never reaching the empty copy; the removed-author row with no link)"
        status: pass
      - kind: other
        ref: "grep -c 'Comentários|Adicione um comentário…|Nenhum comentário ainda' apps/web/messages/pt-BR/stories.json => 0"
        status: pass
    human_judgment: false
  - id: D10
    description: "The flagged STORY-05 prohibition: the absent affordance is NOT the enforcement — a member calling the API directly gets the same answer a member tapping a button would"
    requirement: STORY-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/stories.test.ts#33 and #35 — both refusals reached by direct HTTP with no UI involved, asserted by machine code"
        status: pass
      - kind: other
        ref: "grep -vE '^[[:space:]]*(//|\\*|/\\*|--)' packages/modules/feed/db/schema.ts | grep -c 'before insert' => 0 — the rule is a constraint, not a trigger"
        status: pass
    human_judgment: false
  - id: D11
    description: "UI overflow / zero-one-many / long-text E06: the sheet caps at 80% of the screen height with its list scrolling inside and the input pinned; one row draws no separator above it; long text wraps in a min-width-zero body"
    verification:
      - kind: other
        ref: "The geometry is the shipped BottomSheet's and the shipped CommentItem's, unmodified — `CommentSheet` sets no height class and the flat variant changes no row markup"
        status: pass
    human_judgment: true
    rationale: "The sheet's 80% cap over a full-screen black viewer, the pinned input above the safe area on a real phone, and a long comment's wrap inside the sheet are visual judgements no assertion makes. The components are the shipped ones and their own geometry is asserted where it was introduced (04-08), so this is a look-at-it-once confirmation rather than unproven behaviour."

duration: 79min
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 07: STORY-05 as a Fact the Database Cannot Be Talked Out Of

**A product rule the roadmap states twice — "story comments cannot be liked or replied to" — stopped being prose: a stored generated discriminator, two composite foreign keys and two null-guarded CHECKs make both rows unrepresentable in Postgres, the API's 400 is a translation of the SQLSTATE, and the missing button is the least important of the three layers — with the flat comment surface that rule governs sliding over the viewer, pausing it while a member types.**

## Performance

- **Duration:** 79 min
- **Started:** 2026-09-24T00:50Z
- **Completed:** 2026-09-24T02:09Z
- **Tasks:** 3 of 3
- **Files modified:** 38

## Accomplishments

- **The refusal is DECLARATIVE, and it fails both honestly and while lying.** `feed_comments.target_kind` is a STORED GENERATED column, so a comment's target is visible to a referential check; `unique (id, depth, target_kind)` makes the triple nameable; and `feed_comments_parent_fk` is now three columns wide. A story comment's triple is `(id, 0, 'story')` and the shape CHECK pins a reply's parent to `'post'` — so an honest reply raises **23514** and a lying one raises **23503**, because no legal value finds it. Both are asserted, each beside a positive control that a constraint refusing everything could not satisfy.
- **Pitfall 1 is closed in the same statement, and the probe that INSERTED is the test.** Phase 4's `(parent_id is not null and parent_depth = 0 and depth = 1)` evaluated to `NULL` for a null `parent_depth`, a NULL CHECK is SATISFIED, and MATCH SIMPLE then skipped the composite key entirely — so a depth-1 reply whose parent was never checked to exist went in. Every equality in both rewritten CHECKs now carries an explicit `is not null`, and the identical statement is asserted to raise 23514 in **both** `090-feed.sql` (where the hole lived) and `110-communities-stories.sql`.
- **Pitfall 2 was the one that would actually have shipped.** The naive like CHECK accepted a row with a comment id and a NULL discriminator, and the foreign key was then skipped — the story comment was liked. The CHECK and the FK are one mechanism; neither closes it alone, and the null-discriminator probe is its own pgTAP case.
- **The API never pre-checks.** `createStoryCommentSchema` deliberately ACCEPTS a `parentId`, the insert names the LITERALS (`0`, `'post'`) rather than the parent's own columns, and the service catches the SQLSTATE on a NAMED constraint. There is no `if (parentId) throw` anywhere — an application check would pass its own tests with the constraint missing, and would be a read-then-write two concurrent requests could both pass.
- **Two refusals, two codes.** `story_comment_no_reply` and `story_comment_not_likeable` join Phase 4's `reply_depth_exceeded` in the closed vocabulary. A single shared code would make one of the two pt-BR sentences wrong for the member who reads it.
- **D-83's forward-running list has its own index and no Sort node.** `feed_comments_tenant_story_root_asc_idx` is pinned BY NAME in the pgTAP EXPLAIN block on a 400-row fixture, and the assertion that matters is the negative one: naming the index alone would still pass on a plan that scanned it and then sorted — which is exactly what reusing the DESC index produces, and what the `<` comparison cannot page.
- **One envelope, two directions.** `keysetComparison` returns the operator and the `order by` direction as ONE value, so a `>` cannot drift away from its `asc` half a statement later. Seven cases in the new `packages/core/tests/paging.test.ts` pin it, including totality — both halves are spliced raw into SQL, so "no answer" would put the word `undefined` into a query.
- **There is still exactly one comment list.** `flat` is a VALUE on the variant prop `CommentsList` already had. It withholds `onReply` and `onToggleLike` rather than branching on what a comment looks like, and `CommentItem` now renders no heart at all when the handler is absent. Every suppression is asserted in a PAIR with the inline variant still rendering it — without the second half, a list that had stopped drawing reply controls everywhere would pass.
- **The story waits while you type.** The sheet's open state feeds `externallyPaused` — the third source of the single pause boolean 05-06 wired and left fed by nothing — so hold-to-pause and sheet-is-open are one mechanism. The e2e measures it the way every other clock assertion in that file does: 900 ms of wall clock move the bar by less than 2px, and closing resumes from where it stopped rather than restarting.
- **The sheet's copy is the feed's, and the e2e is what keeps it that way.** `stories.json` gains exactly two strings, both refusals; the spec imports `feed.json` for the title, placeholder and empty line, so duplicating them into the stories namespace turns the walk red.
- **Gates:** `pnpm supabase test db` at **265** assertions (was 248), `pnpm test:integration` at **455** (was 440), the full Playwright suite at **378 passed / 1 failed** — the one failure being `media-video.spec.ts:491`, which `deferred-items.md` already records as flaky under full-suite parallelism and which passes in isolation (verified this run).

## Task Commits

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 (RED) | The failing paging-direction and story-comment contract suites + signature-only skeletons | `a0f0d05` | `packages/core/{server/paging.ts,tests/paging.test.ts}`, `packages/modules/stories/{contracts,tests/story-comments-contract.test.ts}` |
| 1 (GREEN) | The schema, the cursor direction, the story-comment service and its routes | `6bdf833` | `packages/modules/feed/{db/schema.ts,contracts,server/service.ts}`, `packages/modules/stories/{contracts,server,module.ts}`, `packages/core/server/paging.ts` |
| 2 | The migration, the comment counter's story branch and the pgTAP battery | `aebdd63` | `supabase/migrations/20260924005427_story_comment_rules.sql`, `supabase/tests/{090,110}-*.sql`, `scripts/seed.ts`, `apps/api/tests/integration/feed-query-budget.test.ts` |
| 3 (RED) | The failing flat-variant and comment-sheet suites + the `targetId` rename | `2f40ff6` | `packages/modules/feed/{tests/comments-list-flat.test.tsx,ui/**}`, `apps/web/components/stories/StoryViewerHost.test.tsx` |
| 3 (GREEN) | The flat surface, the sheet over the viewer, the data layer and the proof at both tiers | `3e82d4b` | `packages/modules/feed/ui/**`, `packages/modules/stories/ui/StoryViewer.tsx`, `apps/web/**`, `apps/api/tests/integration/{stories,feed-interactions}.test.ts` |
| 3 (fix) | The two sheet suites exited 1 while every assertion passed | `494b608` | `packages/modules/feed/tests/comments-list-flat.test.tsx`, `apps/web/components/stories/StoryViewerHost.test.tsx` |

## TDD Gate Compliance

Both TDD-marked tasks ran a full RED → GREEN cycle with machine-verified evidence.

| Task | Gate | Commit | Status |
|------|------|--------|--------|
| 1 | RED | `a0f0d05` `test(05-07)` | Pass — `check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| 1 | GREEN | `6bdf833` `feat(05-07)` | Pass — 7/7 paging, 12/12 story-comment contract, 197 for `@rede-social/core` |
| 1 | REFACTOR | — | Not performed; no cleanup was warranted |
| 3 | RED | `2f40ff6` `test(05-07)` | Pass — `check tdd-red-evidence` returned **`RED_EVIDENCE_OK`** (`target_test_failed`) |
| 3 | GREEN | `3e82d4b` `feat(05-07)` | Pass — 11/11 flat cases, 12/12 host cases, 122 for `@rede-social/module-feed` |
| 3 | REFACTOR | — | Not performed; `494b608` repaired a test-runner defect rather than cleaning up |

**Task 1 RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/paging.test.ts --reporter=tap-flat` (cwd `packages/core`)
- **Exit code:** 1 — 7 tests, 2 pass, 5 fail
- **Target test:** `tests/paging.test.ts > keysetComparison — one envelope, two directions (D-83 / Pitfall 8) > 1. the DESCENDING direction is \`<\` ordered \`desc\` — the feed, the strip and the root comments`
- **Expected:** `keysetComparison('desc')` returns `{ operator: '<', order: 'desc' }`
- **Actual:** `AssertionError: expected { operator: '>', order: 'desc' } to deeply equal { operator: '<', order: 'desc' }` — the RED skeleton returns a frozen mismatched pair

**Task 3 RED evidence, verbatim from the observed run:**

- **Command:** `pnpm exec vitest run tests/comments-list-flat.test.tsx --reporter=tap-flat` (cwd `packages/modules/feed`)
- **Exit code:** 1 — 11 tests, 6 pass, 5 fail
- **Target test:** `tests/comments-list-flat.test.tsx > CommentsList flat variant — the three affordances the database makes impossible > 1. renders NO reply control, on a row that would carry one in every other variant`
- **Expected:** the flat variant renders no `[data-comment-reply]` control on a root comment
- **Actual:** `AssertionError: expected <button type="button" …(2)></button> to have a length of +0 but got 1` — an unknown variant still behaved as `inline`

**Note on the TAP normalizer** (a standing environment fact, recorded by 05-01, 05-05 and 05-06 before this plan). `check tdd-red-evidence` parses a `node --test` TAP summary; Vitest never emits `# tests` / `# pass` / `# fail`. Both records were built from the REAL captured runs: Vitest's own `tap-flat` reporter supplied the `ok` / `not ok` lines verbatim, and a throwaway script DERIVED the three summary lines by counting them. No count was typed by hand.

Both RED phases were valid on the first capture — neither returned `unexpected_green` (05-06's repair) nor `fixture_or_load_failure`. That is because the skeletons were deliberately signature-only-and-wrong rather than absent: a frozen `keysetComparison`, a `parentId`-less create schema, a one-entry refusal vocabulary, and `'flat'` added to the variant union with no behaviour behind it. An absent symbol would have crashed the loader, which is `INVALID_RED`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] A plain async function cannot cross the RSC boundary, and it took the whole `/inicio` home slot down**

- **Found during:** Task 3, the first full e2e run — 18 of 21 story tests failed at once, including several that had passed in 05-06
- **Issue:** `storyCommentsProps` wired `onLoadReplies` / `onLikeComment` / `onUnlikeComment` (the three handlers a flat list never calls) to plain `async () => ({ ok: false })` functions defined in `lib/registry.tsx`. Next refuses to serialise a function into a client component, and the failure is not local: the strip's slot renderer threw and `/inicio` lost the strip entirely — the same blast radius as 05-06's `FORMATTING_ERROR`.
- **Fix:** the three moved into `story-actions.ts` as real server actions (`refuseStoryRepliesAction`, `refuseStoryCommentLikeAction`), with the reason written where the next reader will look. They are wired to a REFUSAL rather than a resolved no-op on purpose: if either ever runs, the flat variant has stopped suppressing a control and the list's error branch is the honest outcome.
- **Files modified:** `apps/web/lib/registry.tsx`, `apps/web/app/(app)/stories/story-actions.ts`
- **Verification:** the stories e2e went from 3 passed / 18 failed to 21 passed / 11 skipped.
- **Commit:** `3e82d4b`

**2. [Rule 1 - Bug] Two Vitest suites exited 1 while every assertion passed**

- **Found during:** Task 3, `pnpm turbo run test` after the task commit
- **Issue:** happy-dom's `Animation.cancel()` REJECTS the animation's `finished` promise, `motion` attaches no catch, and `cleanup()` unmounting a `BottomSheet` (or the composer's animated submit button) mid-transition raised six unhandled rejections. `@rede-social/module-feed` reported 122/122 and `@rede-social/web` 112/112 — and both exited non-zero. Piping the output through `grep` had hidden it earlier.
- **Fix:** `motion/react` is mocked into plain elements in the two suites that mount a sheet, with the reason in the docblock. Neither file is about animation. It also let the host's close assertion return to its stronger form — the sheet really does leave the DOM.
- **Files modified:** `packages/modules/feed/tests/comments-list-flat.test.tsx`, `apps/web/components/stories/StoryViewerHost.test.tsx`
- **Verification:** `pnpm turbo run test` — 8 tasks, all green, exit 0.
- **Commit:** `494b608`

**3. [Rule 3 - Blocker] The generated migration's statement ORDER aborts**

- **Found during:** Task 2, reading what `drizzle-kit generate` emitted
- **Issue:** the generator emitted `DROP CONSTRAINT feed_comments_id_depth_uq` before dropping the foreign key that depends on it, and added `feed_comments_parent_fk` before the unique constraints it references — and there is no way for it to know a BACKFILL has to run between the columns and the CHECKs.
- **Fix:** the file keeps every generated statement verbatim and reorders them into the sequence the research proved, with the two backfills inserted between. The drizzle SNAPSHOT is unaffected by SQL ordering, so `pnpm db:generate` is still a no-op — asserted.
- **Commit:** `aebdd63`

**4. [Rule 2 - Missing] Every existing reply and comment like had to learn to name its discriminator**

- **Found during:** Task 2, before `pnpm db:reset`
- **Issue:** the rewritten shape CHECK requires `parent_target_kind` to be non-null on a reply and the like CHECK requires `comment_target_kind` on a comment like. Every INSERT in the tree that wrote one of those rows would have started failing: the feed service's reply and comment-like statements, four pgTAP cases, the 250-row volume fixture, the query-budget fixture and two seed blocks.
- **Fix:** all of them now write the LITERAL `'post'` — never the parent's own column, which is what makes the refusal possible in the first place. `grep -rn "into public.feed_comments\|into feed_comments\|into public.feed_likes\|into feed_likes"` is the sweep that found them.
- **Commit:** `aebdd63`

**5. [Rule 1 - Bug] The e2e's own body-read failed on a bare-404 assertion**

- **Found during:** Task 3, the first integration run of the new block
- **Issue:** the "one bare 404" case read the response body twice (`await envelope(res)` for the code and again for `details`). A `Response` body is a stream: the second read threw `Body is unusable`.
- **Fix:** one read, both halves asserted off it — which is also the more honest shape, since the claim is about ONE envelope.
- **Commit:** `3e82d4b`

### Additions beyond the plan's literal wording

- **`CommentsList`'s `postId` became `targetId`.** The plan does not ask for it, but the flat variant hands a STORY id through that prop and the list never reads the value. Four call sites (`FeedList`, `PostDetail`, and the two `Omit<>`s that named the key).
- **`CommentItem` renders no heart when `onToggleLike` is absent.** The plan says "suppress … the per-comment like control at the list level"; suppressing it by withholding the handler is what keeps the list free of a conditional about what a comment looks like, and it is the rule `onReply` and `onDelete` already follow.
- **`StoryViewer` gained an `overlay` prop.** The plan's wording ("render the shipped `CommentSheet` over the viewer from `StoryViewer`") is the forbidden `module -> module` edge; see the unmet criteria below.
- **A registered count bumper rather than host state.** Holding the comment delta in `StoryViewerHost` would re-create the memoised `viewerItems` on every comment and re-mount the image being watched behind an open sheet.
- **Four integration cases beyond the plan's `<behavior>` list:** commenting on an EXPIRED story (A-4), the cross-tenant list AND create taking the same branch, the routes carrying no permission, and the `story.commented` payload's exact key set.
- **`deleteStoryCommentsByBodyPrefix` in `e2e/admin.ts`**, so the walk's own comment leaves no trace in `stories.comment_count`.

### Unmet acceptance criteria (recorded, not skipped)

1. **`packages/modules/stories/server/service.ts` contains `story_comment_not_likeable`.** It does not, as code. Liking a comment is `POST /v1/feed/comments/{commentId}/like` — the FEED's route — so its `23503`/`23514` translation lives in `packages/modules/feed/server/service.ts`, and inventing a story-comment-like endpoint purely to hold a refusal would create the affordance the requirement removes. The code IS named in this file, in the docblock that explains the split, and both codes are enumerated together in the stories module's exported `STORY_COMMENT_ISSUES` so the web has one exhaustive switch. The truth the criterion serves — "the API answers both refusals with distinct machine codes it translated rather than invented" — holds and is asserted by machine code in two integration cases.
2. **`packages/modules/stories/ui/StoryViewer.tsx` contains `CommentSheet` and passes the flat variant, and its paused expression references the sheet's open state.** The string appears only in the `overlay` prop's docblock. `CommentSheet` lives in `@rede-social/module-feed` and `turbo boundaries` denies a `module -> module` package edge — the identical wall 05-03, 05-05 and 05-06 hit, and the plan's own `key_links` names it. `StoryViewerHost` (in `apps/web`, which may reach both) composes the sheet, passes `variant="flat"`, and drives `externallyPaused` from its open state. The viewer participates through the `overlay` prop rather than through an import, and the behaviour is asserted at the host and in the browser.
3. **`grep -c "export function CommentsList" … prints 1`.** It prints **2**, and printed 2 before this plan as well: `CommentsListSkeleton` is exported from the same file (04-08). The exact-function form `grep -c "export function CommentsList("` prints 1, and `find … -name '*CommentsList*.tsx' | wc -l` prints 1 — there is still exactly one comment list.

**Total deviations:** 5 auto-fixed (2× Rule 1 bugs, 1× Rule 2 missing, 2× Rule 3 blockers) plus 6 documented additions and 3 recorded unmet greps. **Impact:** net positive — deviation 1 in particular caught a defect that had removed the stories strip from the home screen entirely, which no unit test would have seen, and deviation 2 caught two suites that were reporting green while failing their runner.

## Authentication Gates

None. Everything ran against the local Supabase stack. Task 2's precondition (the stack up and every earlier Phase 5 migration applied) was verified read-only before any SQL was written — `docker ps` listed `supabase_db_rede-social`, and `pnpm db:reset` then replayed all 31 migrations including this plan's. No task carried a precondition on the D-33 design gate, and `.planning/sketches/003-phase-05-designed-screens/README.md` is unmodified (`git diff --name-only 5c9c717..HEAD -- .planning/sketches` is empty).

## Known Stubs

None. The two seams 05-06 recorded in `.planning/WINDOWS.md` are both closed by this plan:

- **The viewer's `Comentar` control** is now live (entry **#37**, marked `fixed`).
- **`externallyPaused`** is fed by the comment sheet's open state.

`stories.comment_count` is no longer `0` for every story: the seed writes three flat comments per tenant on the newest active story, one of them by the soft-deleted member so the removed-author row has a story fixture too.

One thing this plan deliberately does NOT do, recorded so it is not mistaken for an omission: there is no story-comment LIKE route and no reply route. Their absence is the requirement, and `110-communities-stories.sql` proves the database refuses both even when the request is hand-written.

## Threat Flags

None. Every file this plan touched sits inside the threat model the plan registered:

- **T-05-40 / T-05-41** (crafted reply, crafted like) — both mitigated by composite foreign keys plus null-guarded CHECKs, and both asserted twice (honest and lying) with positive controls.
- **T-05-42** (the latent three-valued CHECK hole) — closed, with the probe that inserted asserted to fail in two files.
- **T-05-43** (a comment body in a log line or an event payload) — `story.commented` carries five keys, asserted by exact key set, and every log line in the service logs `bodyLength` rather than the body.
- **T-05-44** (stored XSS) — the shipped `CommentItem` and its shared `linkify` are reused unchanged; no raw-HTML sink is introduced.
- **T-05-45** (commenting on another tenant's story) — the story is resolved inside the tenant transaction before the insert; the cross-tenant list AND create both answer a bare 404, asserted.
- **T-05-46** (the data migration) — accepted and documented in the migration header, including what would need staging at scale.
- **T-05-47** (`stories.comment_count`) — one counter function, extended rather than duplicated, no clamp, reconciled against the rows for every story.
- **T-05-SC** — **zero external packages were installed.** `pnpm-lock.yaml` is unchanged by this plan.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @rede-social/module-feed typecheck && lint` | pass (40 files) |
| `pnpm --filter @rede-social/module-feed test` | pass — 8 files, 122/122 |
| `pnpm --filter @rede-social/module-stories typecheck && lint` | pass (21 files) |
| `pnpm --filter @rede-social/module-stories test` | pass — 5 files, 50/50 |
| `pnpm --filter @rede-social/core typecheck && test` | pass — 21 files, 197/197 (the paging suite included) |
| `pnpm --filter @rede-social/web typecheck && lint` | pass (257 files) |
| `pnpm --filter @rede-social/web test` | pass — 13 files, 112/112 |
| `pnpm --filter @rede-social/api typecheck` | pass |
| `pnpm turbo run lint typecheck` | pass — 19 tasks |
| `pnpm turbo run test` | pass — 8 tasks |
| `pnpm db:generate` against the committed migration | no-op ("No schema changes"); `git status --porcelain -- supabase/migrations` empty |
| `pnpm db:reset && pnpm db:seed` | pass — 5 stories, 3 story likes and 3 flat story comments per tenant |
| `pnpm supabase test db` | pass — 12 files, **265 tests**, `Result: PASS` (was 248) |
| `pnpm test:integration` | pass — 29 files, **455/455** (was 440) |
| `pnpm test:integration` (stories file alone) | pass — 41/41 |
| `pnpm test:integration` (feed-interactions alone) | pass — 18/18 |
| `bash scripts/check-ui-literals.sh` | pass |
| `pnpm --filter @rede-social/web exec playwright test stories.spec.ts` | pass — 21 passed, 11 skipped |
| `pnpm --filter @rede-social/web exec playwright test` (whole suite) | **378 passed, 1 failed, 69 skipped** (22.3 min) — the failure is the known flake below |
| `pnpm --filter @rede-social/web exec playwright test media-video.spec.ts -g "the player opens in a sheet"` | pass in isolation — confirms the flake |
| `pnpm boundaries` | pass — 544 files, 9 packages, no issues |
| `pnpm boundaries:negative` | pass — both layers reject the fixture |

## Issues Encountered

**One full-suite failure, and it is the documented flake.** `media-video.spec.ts:491` failed once in the whole-suite run and passed in isolation immediately after. `deferred-items.md` §1 already records it, and the prior-wave brief for this plan names it explicitly as not to be chased. Nothing here touches that surface.

**One environment fact worth carrying forward, because it cost a full e2e cycle to diagnose.** A `pnpm test:integration` pass leaves the demo tenant's fixed-id media assets with **no `storage.objects` rows** (66 objects after a seed, 15 after an integration run). Every viewer e2e then fails on a clock that never starts — `MediaImage` never reports `load`, so the segment stays at width 0 — and the symptom looks exactly like a broken clock rather than a missing byte. The isolation check that settled it was disabling the new comment binding and watching the test fail identically. **`pnpm db:reset && pnpm db:seed` before any viewer e2e run.**

The two `deferred-items.md` flakes are otherwise unchanged; nothing here fixes their underlying cause.

## Next Phase Readiness

Ready for 05-08, the last plan of the phase:

- **`05-08` (the history and the pins)** inherits a story that is fully interactive by id — readable, likeable AND commentable whether or not it has expired (A-4 is asserted for all three) — so a pinned expired story is a working surface rather than one that 400s. It also inherits `stories.comment_count` moving for real, which the history screen's counts row renders.
- **Phase 7 (notifications)** inherits `story.commented` with the story author over-carried on the payload, so a notification row can be built without re-reading the story, and `story.comment_deleted` for the moderation half.
- **Phase 8 (moderation)** inherits a soft-deleted story comment that keeps its row, its text and its timestamp, reachable through the tenant lane — the `deleted_at is null` predicate lives in the read query, never in the policy.
- **Gates:** `pnpm supabase test db` at 265 assertions, `pnpm test:integration` at 455, the Playwright suite at 378.

## Self-Check: PASSED

All four `key-files.created` entries exist on disk (`[ -f ]`), and all six task commits are reachable in `git log --all`: `a0f0d05`, `6bdf833`, `aebdd63`, `2f40ff6`, `3e82d4b`, `494b608`. `git rev-list --count 5c9c717..HEAD` measured **6** at SUMMARY write; `.planning/sketches/` is untouched.
