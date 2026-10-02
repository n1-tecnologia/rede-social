---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 03
subsystem: moderation
tags: [moderation, stories, comments, audit-log, keyset, infinite-scroll, focus, playwright, D-334, D-336, D-337, D-340]
status: complete

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-01: kernel moderation_log, recordModerationAction(tx), listModerationLog, moderation.manage, commentRemovalSchema, the feed moderation path, the Moderação page 1 and the moderation catalog"
  - phase: 05-stories
    provides: "flat story comments (feed_comments.story_id), deleteStoryComment, story.comment_deleted retraction, the story comment sheet over the viewer"
provides:
  - "deleteStoryComment(ctx, storyId, commentId, { canModerate }): author-or-moderator under a row lock, deleted_by_user_id, a story_comment log row in the same transaction"
  - "StoryComment.removal (optional, server-derived), and the story comment sheet with the moderation label, dialog and toasts"
  - "The full Moderação screen: chips on ?acao=, keyset InfiniteScroll with a generation guard, pull to refresh, loading.tsx, empty, filtered-empty, first-load and load-more errors, 403 toast plus refresh"
  - "loadMoreModerationLogAction(cursor, action) returning server-formatted row views; moderationLogLabels, parseModerationAction and MODERATION_LOG_FILTERS in lib/moderation-view"
  - "Comment removal finish on feed, community post, reel and story: four dialog copies, gone/failed toasts, count by 1 + server replyCount, focus to the next row or the composer"
  - "CommentDeleteOutcome ({ ok, code?: 'gone' | 'generic' }) exported from the feed UI; both delete actions map the bare 404 to gone"
  - "feed.comments.delete.bodyWithReplies and moderation.log.errors.forbidden catalog keys"
affects: [08-04, 08-05, 08-09, 08-10, 08-12]

actuals:
  tokens: 37900   # chars/4 over the realized diff (151,526 chars across 33 files)
  tasks: 3
  commits: 3
plan_head_before: bdd416337f0157bc17120f40f9ae809dedde9337

tech-stack:
  added: []
  patterns:
    - "A module's own admin path mirrors the feed's: lock for update, author-or-canModerate, one bare 404, recordModerationAction(tx) only when the actor is not the author, emit after commit"
    - "Server action returns FINISHED row views built with the page's own label builder, so page 7 reads exactly like page 1 and the client never formats a date"
    - "URL-bound filter: router.replace in a transition, skeletons while pending, render-time re-seed from the server's page, a generation state (committed through a layout effect) that drops stale load-more pages"
    - "Removal outcome toasts mount through one keyed ListToast component, so lists without a removal never need a ToastProvider"
    - "Programmatic focus after a removal: the row article is tabIndex=-1 and focused in a rAF after the dialog's focus trap lets go"

key-files:
  created:
    - apps/web/app/(app)/configuracoes/moderacao/ModerationLog.tsx
    - apps/web/app/(app)/configuracoes/moderacao/actions.ts
    - apps/web/app/(app)/configuracoes/moderacao/loading.tsx
    - apps/api/tests/integration/moderation-log.test.ts
    - packages/modules/stories/tests/story-comment-removal.test.ts
  modified:
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/server/service.ts
    - packages/modules/stories/server/routes.ts
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/CommentItem.tsx
    - packages/modules/feed/ui/index.ts
    - packages/modules/feed/tests/comments-removal.test.tsx
    - packages/core/server/moderation/read.ts
    - apps/web/app/(app)/configuracoes/moderacao/page.tsx
    - apps/web/components/admin/ModerationLogRow.tsx
    - apps/web/lib/moderation-view.ts
    - apps/web/lib/moderation-view.test.ts
    - apps/web/lib/registry.tsx
    - apps/web/lib/story-view.ts
    - apps/web/lib/stories.ts
    - apps/web/app/(app)/stories/story-actions.ts
    - apps/web/app/(app)/stories/[storyId]/page.tsx
    - apps/web/app/(app)/comunidades/[communityId]/page.tsx
    - apps/web/app/(app)/inicio/feed-actions.ts
    - apps/web/components/stories/StoryViewerHost.tsx
    - apps/web/components/stories/StoryViewerHost.test.tsx
    - apps/web/messages/pt-BR/feed.json
    - apps/web/messages/pt-BR/moderation.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/moderation.spec.ts
    - apps/web/e2e/admin.ts
    - apps/api/tests/integration/moderation-comments.test.ts
    - apps/api/tests/integration/stories.test.ts

key-decisions:
  - "The story comment DELETE keeps its shipped 204 whoever removed the row; deleteStoryComment's opts are REQUIRED (only the route calls it), so no caller can forget the permission read"
  - "Story-comment moderation reuses the feed's shared CommentsList through storyCommentsProps(..., tm); StoryViewer.tsx needed no change because the flat rows are the feed module's list"
  - "The Moderação rows stay copy-free (08-01's sentence-parts view) and are formatted on the SERVER for every page: page.tsx and loadMoreModerationLogAction share moderationLogLabels"
  - "?acao= carries the API's own action values; anything else reads as Tudo (no 400 from the URL)"
  - "A blank or whitespace-only stored reason is no reason, in both the kernel reader and the web view; an empty stored excerpt omits the excerpt block while the context line stays"
  - "A delete answering the bare 404 maps to code gone: the row leaves with the race toast. A demoted moderator also gets 404 there (the one-404 rule), so the row leaves for them too; the next refresh drops the control"
  - "After a removal focus goes to the next row, the previous one when it was the last, and the composer when none is left"

patterns-established:
  - "Pattern: a module admin-delete path = route reads permissionsForRequest first, service locks for update and calls recordModerationAction(tx) only for a non-author"
  - "Pattern: URL-filtered keyset list = chips with router.replace in a transition + render-time re-seed + generation-guarded InfiniteScroll + inline load-more error"

requirements-completed: [MODER-01, MODER-03]

coverage:
  - id: D1
    description: "A moderator removes a member's story comment: 204, stamped, count -1, one story_comment log row in the same transaction, the story author's notification retracted, the comment author not notified; own removal logs nothing; member/support/post-id/other-story/second removal all get the bare 404; a failing log insert rolls the removal back"
    requirement: MODER-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-comments.test.ts#story"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/moderation.spec.ts#story removal (mobile-chromium, desktop-chromium)"
        status: pass
      - kind: unit
        ref: "packages/modules/stories/tests/story-comment-removal.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/components/stories/StoryViewerHost.test.tsx#27, #28"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /v1/admin/moderation-log: limit=1 and limit=3 walks over tied created_at reproduce created_at desc, id desc exactly once; the action filter; the empty tenant; tampered, bogus and overlong cursors answer page 1; 403 for support and member; no cross-tenant row; TENANT_HOST_MISMATCH; isViewer and departed names; blank reason reads null"
    requirement: MODER-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-log.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Moderação screen: chips bound to ?acao= (unknown reads as Tudo), one scrolling chip line at 320px, filtered rows only of that action, every row variant and the blank-excerpt and blank-reason rules, the catalog pinned"
    requirement: MODER-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/moderation.spec.ts#log filters (mobile-chromium, desktop-chromium)"
        status: pass
      - kind: unit
        ref: "apps/web/lib/moderation-view.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#08-03"
        status: pass
    human_judgment: false
  - id: D4
    description: "UI E10/long-text backstop: a 280-character excerpt with line breaks and a long URL and a 500-character reason render whole, unclamped, within 320px"
    requirement: MODER-03
    verification:
      - kind: e2e
        ref: "apps/web/e2e/moderation.spec.ts#long excerpt and reason render whole at 320px"
        status: pass
    human_judgment: false
  - id: D5
    description: "Removal finish on every surface: four dialog copies (a reply never with-replies), count by 1 + server replyCount, 404 race removes with the gone toast, failure keeps the row with the failure toast, focus to the next row or the composer, last removal shows the shipped empty state; on feed, community post, reel and story; support and member get no control; own parity body"
    requirement: MODER-01
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/comments-removal.test.tsx"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/moderation.spec.ts#removal on a community post, removal on a reel, removal of a root with replies beyond the first page, removal failure and the 404 race, no moderation control for support or a member (both projects)"
        status: pass
    human_judgment: false
  - id: D6
    description: "UI E08/long-text backstop, database half: a root with 30 replies leaves with all 31 rows, 31 comment.deleted deliveries, the post count equals the live rows"
    requirement: MODER-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-comments.test.ts#cascade at scale"
        status: pass
    human_judgment: false
  - id: D7
    description: "The Moderação screen's loading skeletons, chip transition and pull to refresh feel right on a phone"
    verification: []
    human_judgment: true
    rationale: "Skeleton geometry, the transition's feel and the pull gesture are visual and gestural; no test asserts them. The 08-12 real-device pass covers it"

duration: 28min
completed: 2026-10-02
---

# Phase 8 Plan 03: Story-comment moderation, the full Moderação screen and the removal finish Summary

**Moderators now remove story comments through the stories module's own locked, logged delete path. Moderação has action chips on `?acao=`, keyset infinite scroll and every loading, empty and error state. Comment removal works the same way on the feed, community posts, reels and stories: author parity copy, race and failure toasts, the full reply cascade, and focus handling.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-10-02T13:32:59Z
- **Completed:** 2026-10-02T14:01:09Z
- **Tasks:** 3
- **Files modified:** 33

## Accomplishments

- **Stories admin path (D-336).** `deleteStoryComment` does the following in one `withTenantTx`:
  - locks the live row with `tenant_id` and `story_id` in the predicate;
  - decides author-or-`canModerate`, with one bare 404 for every miss;
  - stamps `deleted_by_user_id`;
  - writes the `story_comment` log row through `recordModerationAction(tx, …)`, only when the actor is not the author.

  Both comment routes read `moderation.manage` through `permissionsForRequest` before the service runs. `StoryComment` gains the optional server-derived `removal`.
- **Story sheet.** `storyCommentsProps` now carries the `moderation` namespace on all three story surfaces: Início, the deep link and the community strip. The shared list shows the moderation label, dialog and toast on story comments, and `story-view.ts` copies `removal` through.
- **Moderação (D-337).**
  - The chip row "Tudo · Comentários · Bloqueios · Desbloqueios · Papéis" is bound to `?acao=` and switches inside a transition, with 6 skeletons while it is pending.
  - `InfiniteScroll` pages through the log, guarded by a generation counter, with 3 skeletons while a page loads.
  - The list supports pull to refresh.
  - States: empty, filtered-empty, first-load error card and inline load-more error.
  - A 403 shows a toast and refreshes the page.
  - `loading.tsx` draws the header, the chip shape and 6 row skeletons.
  - Every row is formatted on the server by the same builder for page 1 and for every later page.
- **Removal finish (UI-D-276, UI-D-288).**
  - Four dialog copies, and a reply never gets the with-replies wording.
  - `feed.comments.delete.bodyWithReplies` is added; the shipped `body` is unchanged.
  - A 404 race removes the row and shows "Este comentário já tinha sido removido."
  - Any other failure keeps the row and shows "Não foi possível remover o comentário. Tente novamente."
  - Focus moves to the next comment row, or to the composer when none is left.

## Task Commits

1. **Task 1 (tracer): moderators remove story comments with an atomic story_comment log row** - `508231c` (feat)
2. **Task 2: full Moderação screen with action chips, keyset paging and every state** - `92df757` (feat)
3. **Task 3: finish comment removal on every surface** - `963c018` (feat)

**Plan metadata:** the docs(08-03) commit that adds this file.

## Files Created/Modified

- `packages/modules/stories/server/{service,routes}.ts`: the widened delete, `storyRemovalFor`, `removal` on every read, and the permission read in the routes.
- `packages/modules/stories/contracts/index.ts`: `removal: commentRemovalSchema.optional()`.
- `apps/web/app/(app)/configuracoes/moderacao/{page,ModerationLog,actions,loading}.tsx|ts`: the screen.
- `apps/web/lib/moderation-view.ts`: `parseModerationAction`, `MODERATION_LOG_FILTERS`, `moderationLogLabels`, and the blank-excerpt and blank-reason rules.
- `apps/web/components/admin/ModerationLogRow.tsx`: `ModerationLogSkeleton`.
- `packages/core/server/moderation/read.ts`: a whitespace-only reason reads as null.
- `packages/modules/feed/ui/{CommentsList,CommentItem}.tsx`: `CommentDeleteOutcome`, the four copies, `ListToast`, focus handling, and a focusable row.
- `apps/web/app/(app)/{inicio/feed-actions,stories/story-actions}.ts`: a 404 now returns `code: 'gone'`.
- `apps/web/lib/registry.tsx`: `deleteBodyWithReplies`, the failed and gone toasts, and `tm` on `storyCommentsProps`.
- Tests:
  - `moderation-log.test.ts` (12 cases, new);
  - `moderation-comments.test.ts`, which gains `describe('story')` (7 cases) and `describe('cascade at scale')`;
  - `stories.test.ts` #39;
  - `comments-removal.test.tsx` (18 cases);
  - `moderation-view.test.ts` (16 cases);
  - the i18n 08-03 block;
  - `StoryViewerHost.test.tsx` #27 and #28;
  - `moderation.spec.ts`: 9 tests × 2 projects.

## Decisions Made

See `key-decisions` in the frontmatter. The main ones:
- The story DELETE keeps its 204.
- Story moderation reuses the feed's shared list.
- Rows are formatted on the server for every page.
- `?acao=` carries the API's own values.
- A blank reason counts as no reason in two layers, the kernel reader and the web view.
- A bare 404 maps to `gone`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `stories.test.ts` #39 asserted the pre-D-336 refusal**
- **Found during:** plan-level verification (Task 3)
- **Issue:** #39 expected the demo **admin** to get a 404 when deleting someone else's story comment. That is exactly the behaviour D-336 changes, so the test failed with 204.
- **Fix:** The refused actor is now `support@rede-demo.local`, who does not hold `moderation.manage`. The admin case lives in `moderation-comments.test.ts` `describe('story')`.
- **Files modified:** `apps/api/tests/integration/stories.test.ts`
- **Verification:** the three plan-level integration files ran 108/108 after a reset, and the full suite ran 44 files with 740 tests.
- **Committed in:** `963c018`

**2. [Rule 2 - Missing critical] The kernel reader nulls a whitespace-only reason**
- **Found during:** Task 2
- **Issue:** The MODER-03 "empty" truth says a blank reason renders no "Motivo" line. The writer trims, but the reader returned any stored value as-is (the DB CHECK accepts `'   '`).
- **Fix:** The reader now uses `case when l.reason ~ '^[[:space:]]*$' then null …`, and the web view applies the same rule. The excerpt gets the same defensive rule in the view.
- **Files modified:** `packages/core/server/moderation/read.ts`, `apps/web/lib/moderation-view.ts`
- **Committed in:** `92df757`

**3. [Rule 3 - Blocking] The delete outcome needed a `gone` code across the module boundary**
- **Found during:** Task 3
- **Issue:** `onDeleteComment` answered `{ ok: boolean }`, so the list could not tell a 404 race from a failure.
- **Fix:** `CommentDeleteOutcome = { ok; code?: 'gone' | 'generic' }`. `deleteCommentAction` and `deleteStoryCommentAction` map an `ApiClientError` 404 to `gone`, and the `StoryViewerHost` binding type follows. Neither action file was in the plan's file list.
- **Committed in:** `963c018`

**4. [Adaptation] The story unit test is a contract test in the stories package; the rendering cases live in the web host test**
- **Found during:** Task 1
- **Issue:** The story comment rows are the feed module's `CommentsList`, which `packages/modules/stories` may not import (MOD-02, `turbo boundaries`). `StoryViewer.tsx` renders no comment rows.
- **Fix:**
  - `packages/modules/stories/tests/story-comment-removal.test.ts` proves the `removal` contract: the three values, absent, refused values and strict.
  - `StoryViewerHost.test.tsx` #27 and #28 render the real sheet with the real catalog: the moderation label and dialog for `'moderation'`, the own label for `'own'`, and no control for `null`.
  - `StoryViewer.tsx` was not changed.
- **Committed in:** `508231c`

**5. [Adaptation] The view keeps 08-01's resolved sentence parts instead of "sentence key plus facts"**
- **Found during:** Task 2
- **Issue:** The plan asks for the view to return a key that the component formats with `t()`. 08-01 had already established a copy-free view that returns resolved strong and plain parts, and rows on later pages arrive from a server action.
- **Fix:** Rows are formatted on the server, for page 1 and for every load-more, by the shared `moderationLogLabels` and `toModerationLogView`. The client never formats a date (UI-D-14) and never builds markup from a template.
- **Committed in:** `92df757`

**6. [Adaptation] The 403 copy lives in `moderation.log.errors.forbidden`**
- **Issue:** `admin.json` does not exist yet. This follows 08-01's interim rule.
- **Committed in:** `92df757`

---

**Total deviations:** 6 (1 bug, 1 missing critical, 1 blocking, 3 adaptations).
**Impact on plan:** No scope creep. Every truth holds.

## Issues Encountered

- **Fixture drift, not a regression.** After the full API integration suite, `stories.spec.ts`' comment-sheet test failed before any comment interaction: the story image never decoded. The cause is that `/v1/stories?limit=1` then returns a fixture story whose image has no stored object.
  - On a fresh `db:reset && db:seed` the same test passes.
  - This plan's two suites leave no stories behind; the newest story after them is the seed's.
  - This is the known "integration rows drift stories" condition, not a product change.
- **DB resets.** The developer consented on 2026-10-02 to `pnpm db:reset && pnpm db:seed` on the LOCAL stack for every Phase 8 plan, and a backup exists at `~/rede-social-local-backups/pre-08-reset.sql`. Four local resets ran in this plan; nothing touched the hosted Supabase, GCP or Vercel projects.
- **Process hygiene.** Playwright started and stopped its own API and web servers on every run. No `tsx watch` or `next dev` process was left running.

## Verification Run

- Task 1:
  - stories typecheck, lint and test (150) green; api typecheck green; `pnpm boundaries` no issues;
  - after a reset, `moderation-comments.test.ts -t story`: 7/7;
  - web typecheck and lint, and `check-ui-literals`, OK;
  - `playwright moderation.spec.ts -g "story removal"`: 2/2.
- Tracer feedback gate (interactive, `end-of-phase`, automated-only verify): the verify was green before expansion, with no checkpoint.
- Task 2: web typecheck and lint, `vitest lib/moderation-view i18n` (592), `check-ui-literals` and core typecheck and lint all green; `moderation-log.test.ts` 12/12.
- Task 3:
  - feed typecheck, lint and test (175) green;
  - `vitest i18n` green;
  - after a reset, `moderation-comments` 20/20;
  - `playwright moderation.spec.ts feed-comments.spec.ts`: 27 passed, with 9 desktop skips that are pre-existing and by design.
- Plan-level checks:
  - after a reset, `moderation-comments` + `moderation-log` + `stories` ran 108/108;
  - full `test:integration`: 44 files, 740 tests;
  - web vitest: 52 files, 1249 tests;
  - root `pnpm lint` green.

## Known Stubs

None.

## Threat Flags

None. Every new or changed surface is in the plan's threat model: the story DELETE (T-08-14, T-08-17), the log read (T-08-15), the cursor and `action` validation in the server action (T-08-16), and the excerpts and reasons, which render as React text only (T-08-18).

## User Setup Required

None. There are no migrations; the reader change is code only.

## Next Phase Readiness

- 08-04 and 08-05 write `member_blocked`, `member_unblocked` and `role_changed`. The screen already renders all three, with chips, and its unit and integration coverage includes seeded rows of each.
- The `admin.*` catalog plan should move `moderation.log.{back,roles,errors}` (including `errors.forbidden`) into `admin.json` as the UI-SPEC names them.

## Self-Check: PASSED

- The created files exist on disk: `ModerationLog.tsx`, `actions.ts`, `loading.tsx`, `moderation-log.test.ts` and `story-comment-removal.test.ts`.
- Commits `508231c`, `92df757` and `963c018` are in `git log`.

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*
