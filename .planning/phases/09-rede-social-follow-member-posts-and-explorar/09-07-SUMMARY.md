---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 07
subsystem: api
tags: [social, moderation, notifications, post-removal, comment-notice, D-475, D-476, D-477]

requires:
  - phase: 09-03
    provides: "feed_posts.visibility and deleted_by_user_id, the member stamp, the D-476 guard on post.published, the restrictive select policy feed_posts_social_gate"
  - phase: 09-05
    provides: "memberPostVisible(canModerate), the live-author rule for a blocked author (bare 404 for the admin), the shared interaction gate"
  - phase: 08-01
    provides: "recordModerationAction, the append-only moderation_log, the deleteComment shape this plan copies"
provides:
  - "MODERATION_ACTIONS gains 'post_removed' and MODERATION_SUBJECT_TYPES gains 'feed_post'; the two moderation_log CHECKs are rewritten in one expand-only migration (20261019225153_moderation_post_removed.sql)"
  - "softDeletePost(ctx, postId, { canModerate }): one transaction, row lock, moderator branch for a followers post of a live author, deleted_by_user_id stamp, same-transaction log row, post.deleted after commit"
  - "FeedPost.removal = 'moderation' (optional, never null), emitted to a holder of moderation.manage on Explorar and the post link for someone else's member post"
  - "feed.post_commented: one personal in_app + push intent for the author of a member post on a first-level comment, subject post and object comment"
  - "web: the postCommented notification renderer and catalog key, the post_removed log row (sentence, context line, Trash2 glyph, Publicações filter chip)"
affects: [09-08, 09-09, 09-10, 09-11, 09-12, 09-13]

tech-stack:
  added: []
  patterns:
    - "A new audit action widens the log CHECKs by DROP and ADD of the two constraints, every comparison NULL-guarded with coalesce; DDL does not fire the immutability triggers"
    - "The root-comment branch of resolveCommentCreated is one statement that reads the audience, social flag and author liveness from the row, locks for share of c, p, and returns [] for everything that is not a live member post"
    - "A web test that proves a worker-lane notice enables the notifications module on the lab seed tenant (it is off there) and gives the recipient a fake push subscription"

key-files:
  created:
    - supabase/migrations/20261019225153_moderation_post_removed.sql
    - supabase/migrations/meta/20261019225153_snapshot.json
    - apps/api/tests/integration/moderation-posts.test.ts
    - packages/core/tests/moderation-log.test.ts
  modified:
    - packages/contracts/src/moderation.ts
    - packages/contracts/tests/moderation.test.ts
    - packages/core/db/schema/moderation-log.ts
    - packages/core/server/moderation/log.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/server/notifications.ts
    - packages/modules/feed/server/notification-copy.ts
    - packages/modules/feed/tests/contracts.test.ts
    - packages/modules/feed/tests/notification-sources.test.ts
    - apps/api/tests/integration/moderation-log.test.ts
    - apps/api/tests/integration/notifications.test.ts
    - supabase/tests/154-moderation-log.sql
    - supabase/migrations/meta/_journal.json
    - apps/web/lib/notification-renderers.tsx
    - apps/web/lib/notifications-view.test.ts
    - apps/web/messages/pt-BR/notifications.json
    - apps/web/lib/moderation-view.ts
    - apps/web/lib/moderation-view.test.ts
    - apps/web/components/admin/ModerationLogRow.tsx
    - apps/web/messages/pt-BR/moderation.json
    - apps/web/i18n/messages.test.ts

key-decisions:
  - "Planning decision 1 (copy deleteComment): lock the row for update, decide author-or-moderator inside the lock, stamp deleted_by_user_id, log only when the actor is not the author, emit after commit; canModerate is read by the route before the transaction (T-08-08)"
  - "Planning decision 2 (followers predicate and live author): the moderator branch is p.visibility = 'followers' plus an exists over the author's active, unblocked, undeleted membership; this keeps T-04-54 for organization posts and keeps the plan-04 default (a blocked author's post is not moderated until unblocked); FLAGGED for the user"
  - "Planning decision 3 (one resolver, no second source): the root-comment case lives in resolveCommentCreated, same for share locks, subject post and object comment so post.deleted and comment.deleted already retract it"
  - "Planning decision 4 (push copy, FLAGGED): title is the tenant's name and the actor rides in the body ('{actor} comentou na sua publicação: {excerpt}', no colon when the excerpt is empty, 'Alguém' fallback, cut on a word at 100 graphemes), the house convention of feed.comment_replied; UI-D-506's title/body split is not expressible in NotificationPushHint and the kernel is not changed"
  - "Planning decision 5 (compile-keeping web): the renderer, the catalog key, the log row, the glyph and the filter chip are all fully specified copy and geometry, no new colour, no sketch gate"
  - "Planning decision 6 (removal key): emitted only as 'moderation', never null"
  - "The moderation-log context line for a post removal is 'Publicação removida' (the UI-SPEC chip text, key log.context.feedPost) and the filter chip is 'Publicações' (log.filters.posts); the plan's text said 'publicação' for the context, the UI-SPEC string wins"

patterns-established:
  - "removal on a post is a presentation hint; softDeletePost's statement is the authority"
  - "The worker-lane resolver reads app.social_enabled() and the author's liveness from the same statement as the comment and post it locks"

requirements-completed: [SOCIAL-07, SOCIAL-08, SOCIAL-10]

coverage:
  - id: D1
    description: "Tracer: the lab admin removes Helena's member post with DELETE /v1/feed/posts/{id}: 200 with the exact body {\"deleted\":true}, deleted_at and deleted_by_user_id stamped, exactly one moderation_log row (post_removed, feed_post, target Helena, actor and target anchored to their two memberships, excerpt = the caption) in the same transaction, Helena gets no notification, the post leaves Explorar for the follower, the author and the moderator and the post link is the bare 404 for all three; a repeat removal is the bare 404 with no second row"
    requirement: SOCIAL-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-posts.test.ts#09 tracer (3 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-475 scope and races: a colleague admin gets the bare 404 on an organization post and no log row while removing a member post in the same second succeeds; the author's own delete is stamped with no log row; support is 403 and a non-author member is refused; a blocked author's post is the bare 404 until unblocked; a media-only post logs the empty excerpt; a long caption is cut inside 280 with the ellipsis; a removal wins an author edit; two simultaneous moderator removals write one log row; a forced log-insert failure leaves the post live, emits no post.deleted and writes no row; removal reaches the moderator only"
    requirement: SOCIAL-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-posts.test.ts#09 scope (10 cases)"
        status: pass
      - kind: unit
        ref: "packages/core/tests/moderation-log.test.ts (4 cases); packages/modules/feed/tests/contracts.test.ts#feedPostSchema.removal (3 cases); packages/contracts/tests/moderation.test.ts#moderation vocabulary"
        status: pass
    human_judgment: false
  - id: D3
    description: "Widened CHECKs in Postgres: a valid post_removed row (and one with an empty excerpt) is accepted by the tenant lane under the same insert policy; a post_removed row without a subject, a feed_post subject on a comment removal, a post_comment subject on a post removal, a subject on a block and an unknown action are all 23514; update, delete are refused in the tenant lane, the admin lane and for the owner on a post_removed row; adjacency across tenants holds"
    requirement: SOCIAL-07
    verification:
      - kind: pgtap
        ref: "supabase/tests/154-moderation-log.sql (41 tests, plan 28 to 41)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/moderation-log.test.ts (the route lists and filters post_removed, post_hidden is a 400)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-477 notice: a first-level comment by someone else on a member post is exactly one feed.post_commented in-app row (facts postId, commentId, excerpt, dedupe key feed.post_commented:{commentId}) and one queued push for its author; nothing for the author commenting on their own post, a like, a reply beyond today's feed.comment_replied, a comment on an organization post, social off, a blocked or removed author; deleting the comment blanks its row to {removed:true} and leaves the sibling notice, and the moderator removing the post blanks every notice about it; publishing a member post notifies nobody (D-476 re-asserted)"
    requirement: SOCIAL-08
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-posts.test.ts#09 notice (6 cases); apps/api/tests/integration/notifications.test.ts (root comments on an admin post, unchanged)"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts (root comment on a member post 6 cases, push copy 2 cases)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Web compile-keeping: the notification registry renders feed.post_commented (MessageCircle, commenter's avatar, sentence with the quoted excerpt, link /post/{id}?comentario={id}, retracted row is the removed row), the moderation log renders post_removed ('removeu uma publicação de', context line, excerpt block omitted when empty, Trash2 glyph, Publicações chip), and the exhaustive maps and catalog pins stay green"
    requirement: SOCIAL-08
    verification:
      - kind: unit
        ref: "apps/web/lib/notifications-view.test.ts (3 cases); apps/web/lib/moderation-view.test.ts (3 new cases and 3 updated); apps/web/i18n/messages.test.ts pins; pnpm --filter @rede-social/web typecheck and exec vitest run (171 files, 3851 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "UI E10 backstop: the 80-character excerpt and the sentence wrap inside the notification row without moving the relative time at 320px"
    requirement: SOCIAL-08
    verification:
      - kind: unit
        ref: "excerpt clamp to FEED_EXCERPT_MAX proved in notification-sources.test.ts; the 320px layout itself was not rendered"
        status: pass
    human_judgment: true
    rationale: "The server clamp and the row anatomy are tested; whether the wrapped sentence keeps the time in its slot at 320px needs a visual check (plan truth marked verification: backstop). No browser was opened."
  - id: D7
    description: "PR-3 prohibition: a member post and a follow notify nobody beyond the single comment notice (no follower fan-out, no like notice, no broadcast)"
    requirement: SOCIAL-08
    verification:
      - kind: integration
        ref: "moderation-posts.test.ts#09 notice 2 and 6; feed-social.test.ts D-476 cases (unchanged, green)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-10-19
plan_head_before: b9f1d2beaf101b7395d14451f193a8b1ddbfc9b7
commits: 5
status: complete
---

# Phase 9 Plan 07: Moderator removal of member posts and the comment notice Summary

**A holder of `moderation.manage` removes any live member post (soft delete, `deleted_by_user_id` stamp, an append-only `post_removed` log row in the same transaction, the author not told, organization posts still author-only), and the author of a member post gets exactly one in-app row and one push for each first-level comment by someone else, retracted with the comment or the post.**

## Performance

- **Duration:** about 25 min
- **Started:** 2026-10-19T22:44Z (approximate; not recorded at start)
- **Completed:** 2026-10-19
- **Tasks:** 3 (one tracer, TDD; one TDD; one [BLOCKING schema])
- **Files:** 27 touched including one generated drizzle snapshot (9952 lines)

## Accomplishments

- **Tracer (Task 1).** On rede-lab (`social` on) the admin's `DELETE /v1/feed/posts/{Helena's post}` answers 200 with exactly `{"deleted":true}`. `adminSql` then shows `deleted_at` set, `deleted_by_user_id` = the admin and exactly one `moderation_log` row (`post_removed`, `feed_post`, the post id, target Helena, the caption as excerpt, both parties anchored to their memberships). Helena's notification count is unchanged after the jobs run, the post is gone from the follower's, the author's and the moderator's Explorar, and the post link is the bare 404 for all three.
- **Scope and races (Task 1).** An organization post is still removable only by its own author: a second admin gets the bare 404 and no log row while removing a member post in the same second works. An author deleting their own member post stamps `deleted_by_user_id` and logs nothing; support is 403; a blocked author's post is the bare 404 for the admin until unblocked (the plan-04 default, flagged). A media-only post logs the empty string; a long caption is cut inside 280 with the ellipsis. A removal wins an author edit (sequential 404), two simultaneous removals leave one log row, and a trigger that fails the log insert leaves the post live, emits no `post.deleted` and writes no row.
- **Vocabulary and migration (Task 1).** `post_removed` and `feed_post` are appended to the contract lists, the `ModerationEntry` union gets the variant, and one generated expand-only migration drops and re-adds the two CHECKs. `moderation_log_subject_chk` now requires a subject for both removal actions and binds `feed_post` to `post_removed` with every comparison NULL-guarded. The immutability triggers are untouched.
- **`removal` (Task 1).** `FeedPost.removal` is `z.enum(['moderation']).optional()`, spread only when the viewer is a moderator on Explorar or the post link and the post is a member post they did not write. `canManage` stays author-only.
- **The notice (Task 2).** The root branch of `resolveCommentCreated` is one statement that locks the comment and its post `for share`, reads the audience, `app.social_enabled()` and the author's liveness from the row, and returns one intent: audience that user, commenter excluded, `dedupeKey` `feed.post_commented:{commentId}`, subject post, object comment, channels `['in_app','push']`, url `/post/{id}?comentario={commentId}`. The reply branch is byte for byte what it was. The retractions needed no change.
- **Web (Tasks 2 and 3).** The renderer registry knows `feed.post_commented` and the moderation log knows `post_removed`; both go through the existing geometry with no new colour.
- **pgTAP 154 (Task 3).** 28 to 41 tests; every earlier assertion untouched.

## Task Commits

1. **Task 1 (tracer, TDD): vocabulary, CHECKs, writer, moderator branch of softDeletePost, removal key**
   - RED: `a379b390` (test)
   - GREEN: `78016c91` (feat)
2. **Task 2 (TDD): feed.post_commented, its copy and the web renderer**
   - RED: `4dd5c162` (test)
   - GREEN: `9401d658` (feat)
3. **Task 3 ([BLOCKING schema]): pgTAP 154, the log read route cases and the log's web view**
   - `e5aefd0a` (feat; not TDD-marked)

**Plan metadata:** committed separately (this SUMMARY, then state and roadmap).

## TDD Gate Compliance

Tasks 1 and 2: `test(09-07)` precedes `feat(09-07)` (`a379b390` then `78016c91`, `4dd5c162` then `9401d658`). No REFACTOR commit. `workflow.tdd_mode` is not enabled, so `check tdd-red-evidence` was not run (it parses node TAP and Vitest never emits it); the real runs are quoted.

RED evidence (real Vitest runs):
- Task 1 unit: `moderation.test.ts` 1 failed | 22 passed (the five-action list); `moderation-log.test.ts` 3 failed | 1 passed (the post_removed variant wrote a null subject and excerpt); `contracts.test.ts` 1 failed | 20 passed (the `removal` key refused by the strict schema).
- Task 1 integration (`moderation-posts.test.ts`, against the previous code): `13 tests | 12 failed`. Failures on the planned behavior: `expected undefined to be 'moderation'` (no `removal` key), `alvaro: expected [...] to not include <postId>` and `expected 404 to be 200` (the admin could not remove), `expected [ 404, 404 ] to deeply equal [ 200, 404 ]` (two removals), `expected null to be <helena>` (no `deleted_by_user_id` stamp). The one passing case was the support/member refusal, which already held.
- Task 2 unit: `notification-sources.test.ts` `6 failed | 26 passed (32)`: `feedPostCommentedPushCopy` undefined, the kind absent, the root comment read nothing.
- Task 2 integration: `09 notice` `4 failed | 2 passed` (the two passes are the guard cases that hold before and after: no notice for an organization post, none for a member post at publish).
- Task 2 web: `5 failed` (renderer absent, catalog key absent). These web tests were run red but committed together with their GREEN code in `9401d658`, not in the RED commit, because the working tree could not be split without a stash (prohibited here). Task 3's web tests (`7 failed`) were likewise run red and committed in `e5aefd0a`, which is not a TDD task.

## Files Created/Modified

See `key-files`. The migration is 16 lines (header plus the DROP and ADD of the two constraints); `grep -ciE "drop table|drop column|rename|alter column .* type"` prints 0 and `grep -c post_removed` prints 6.

## Decisions Made

Planning decisions 1-6 were followed as written (see `key-decisions`). Beyond them:

- **The moderation-log context line** reads "Publicação removida" (the UI-SPEC chip text `moderation.kinds.postRemoved`, put at the existing catalog path `log.context.feedPost`) and the filter chip reads "Publicações" (`log.filters.posts`). The plan's task text said the context label should be "publicação"; the UI-SPEC wording won.
- **`ModerationLog.tsx` needed no edit.** It maps `MODERATION_LOG_FILTERS` and reads `t('filters.<key>')`, so the new chip appears from the view's list and the catalog.
- **`notifications.test.ts`** gained one assertion (the root-comment guard now also forbids `feed.post_commented` on an organization post). The existing case that a root comment on an admin post notifies nobody is unchanged.

### Flagged for the user

1. **Push copy** (planning decision 4). The banner is titled with the tenant's name and reads "{actor} comentou na sua publicação: {excerpt}" in the body, not UI-D-506's actor-in-title split. Reason: `NotificationPushHint.title` is `'tenant' | 'team'` only; splitting the actor into the title would need a kernel change this phase does not justify.
2. **A blocked or removed author's post is not removable by a moderator** until the author is unblocked (planning decision 2, the plan-04 default). It is one `exists` in `softDeletePost` and one conjunct in `memberPostVisible` away from the other answer. Note that the admin cannot even read that post (bare 404), so removal without reading would be odd.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, in my own test] Explorar was requested with `limit=50`**
- **Found during:** Task 1 RED run
- **Issue:** `GET /v1/feed?scope=explorar&limit=50` is a 400 (the page cap is below 50), so the first RED run failed for the wrong reason.
- **Fix:** `limit=25`, re-ran to get a RED that fails on the planned behavior.
- **Files modified:** `apps/api/tests/integration/moderation-posts.test.ts`
- **Committed in:** `a379b390`

**2. [Rule 3 - Blocking] The lab seed has `notifications` off**
- **Found during:** Task 2 GREEN run (the `09 notice` cases found no row after the resolver existed)
- **Issue:** `notificationsSink` enqueues nothing for a tenant without the `notifications` module, and rede-lab has it off, so every notice case, and Task 1's "Helena is told nothing", would pass or fail vacuously.
- **Fix:** the suite turns `notifications` on for rede-lab in `beforeAll` (previous row written back in `afterAll`, flags cache invalidated) and gives Helena a fake push subscription (the kernel pushes only to users with a device), deleted in `afterAll`. No change to `setup.ts`.
- **Files modified:** `apps/api/tests/integration/moderation-posts.test.ts`
- **Committed in:** `9401d658`

**3. [Rule 1 - Bug, existing test encoded the old model] "A ROOT comment yields nothing, without even reading"**
- **Found during:** Task 2 RED
- **Issue:** the unit case in `notification-sources.test.ts` asserted zero statements for a root comment. The root branch now reads once to learn the audience (an organization post still yields `[]`).
- **Fix:** the case asserts `[]` and exactly one read for an organization post.
- **Committed in:** `4dd5c162`

**4. [Rule 3 - Blocking, ordering] The web typecheck was red between Task 1 and Task 3**
- **Found during:** Task 1 verification
- **Issue:** widening `ModerationAction` in Task 1 (as planned) breaks the two exhaustive web maps (`GLYPHS`, `TEMPLATE_KEY`) until Task 3's web edit; Task 1 and Task 2 verify lists put `@rede-social/web typecheck` on Task 2.
- **Fix:** none needed beyond Task 3; the web typecheck, lint, `check-ui-literals.sh` and the full web Vitest run are all green after `e5aefd0a`. The commits `78016c91` and `9401d658` therefore have a red web typecheck on their own.
- **Verification:** `pnpm --filter @rede-social/web typecheck` clean; `exec vitest run` 171 files, 3851 tests passed.

### Beyond the written plan

- `packages/core/tests/moderation-log.test.ts` is a new file the plan lists but "if present"; no writer test file existed, so it was created (4 cases with a fake transaction and `PgDialect` rendering).

---

**Total deviations:** 2 own-test or existing-test corrections (Rule 1), 2 blocking adjustments (Rule 3)
**Impact on plan:** none on scope; no architectural change.

## Issues Encountered

- A `zsh` array was needed to pass file lists to `git add` and `git commit` (the first attempt treated the list as one pathspec; nothing was staged).
- `biome` reformatted a long OpenAPI description string and one test expression; fixed with `biome check --write` in the package before committing.

## Verification Results

- Task 1 verify: `contracts` 185 passed, `core` 459 passed, `module-feed` 293 passed (later 301), typecheck and lint clean for `core`, `module-feed` and `api`, `pnpm boundaries`: "Checked 1660 files in 18 packages, no issues found". After `pnpm db:reset && pnpm db:seed`: `vitest run` of `moderation-posts`, `moderation-comments`, `moderation-log`, `feed-edit-delete` (and `feed-social`): `Test Files 5 passed, Tests 104 passed`.
- Task 2 verify: `module-feed` 301 passed, typecheck and lint clean; `web exec vitest run lib/notifications-view i18n` passed; `check-ui-literals.sh`: "OK". After reset and seed: `vitest run tests/integration/moderation-posts.test.ts tests/integration/notifications.test.ts`: `Test Files 2 passed, Tests 47 passed`.
- Task 3 verify: `pnpm db:generate` printed "No schema changes, nothing to migrate"; after reset and seed, `pnpm supabase test db`: `Files=38, Tests=2057, Result: PASS` (2044 before, +13); `moderation-log.test.ts` 13 passed; `web exec vitest run lib/moderation-view components/admin i18n` passed (1278 tests), `web typecheck` clean, `web lint` clean (1 pre-existing info), `check-ui-literals.sh` OK.
- Final chain after the last reset and seed: pgTAP `Files=38, Tests=2057, Result: PASS` first, then the full `VIDEO_PROVIDER=fake pnpm --filter @rede-social/api test:integration`: `Test Files 76 passed (76)`, `Tests 1537 passed (1537)` (1517 after plan 06). `contracts` 185, `core` 459, `module-feed` 301, `api` unit 73, all with clean typecheck and lint; full web Vitest: `Test Files 171 passed`, `Tests 3851 passed`.
- Acceptance greps: all passed (`*_moderation_post_removed.sql` is one file sorting after `*_media_duration_cap.sql`; `post_removed` in the contracts, writer and service; `deleted_by_user_id` in the service; `09 tracer`/`09 notice` in the new suite; `post_commented` in the feed contract and source; `postCommented` in the renderer and catalog; `post_removed` appears 20 times in `154-moderation-log.sql`; `postRemoved` in `moderation.json`).
- Not run: the Playwright e2e suite, the 320px visual check of the notice row (D6, backstop), `turbo typecheck/build`, any dev server, any cloud command. Nothing was pushed, `supabase db push` was not run, `social` was toggled only on the local seed tenant (restored in `afterAll`) and `notifications` only on rede-lab (restored).

**`db:reset` ran five times, all local, each followed by `pnpm db:seed`:** (1) before the first Task 1 RED integration run, (2) after the migration existed, for the Task 1 GREEN integration run, (3) Task 2's verify, (4) Task 3's pgTAP run, (5) the final chain before the full integration suite. The local database is NOT reset after the final full integration run, so it carries that run's residue (including `moderation_log` rows, which are append-only): run `pnpm db:reset && pnpm db:seed` before the next pgTAP run.

## Known Stubs

None.

## Threat Flags

None new. T-09-22 (a moderator removing an organization post: `visibility = 'followers'` in the lock statement, EP-22 case), T-09-23 (a removal without its log row: one transaction under a row lock, the forced-failure case, pgTAP 154), T-09-24 (a member post or comment broadcast beyond its single notice: PR-3 cases) and T-09-25 (a notice excerpt surviving a takedown: subject post and object comment, retraction cases) are covered; T-09-42 is accepted as planned (the 100-grapheme push body goes only to the post's own author, the same exposure `feed.comment_replied` has).

## Observations for later plans (not fixed here)

- **Web plans (09-08 onward):** `FeedPost.removal` is on the wire but no screen reads it yet. UI-D-497's "Remover publicação" row in `PostMenu` and the confirm dialog are web work; a `DELETE /v1/feed/posts/{id}` by a moderator needs no new action, the same route answers.
- **Dashboard:** the owner dashboard's moderation counts filter `action = 'comment_removed'` (`20261019032741_dashboard_support_functions.sql`, `dashboard-owner-support.test.ts`), so a `post_removed` row is not counted there. Whether it should be is a product call for a later plan.
- **Moderation log empty state** still reads "Quando você remover um comentário ou bloquear o acesso de alguém" (unchanged, not in this plan's catalog list).
- **09-05 residual, still open:** the four comment-id routes (`likeComment`, `unlikeComment`, `listReplies`, `getCommentThread`) rely on RLS inheritance for the moderator and so let an admin who already holds a blocked author's comment id read its replies. This plan did not touch them.
- **Comment-count vs notice:** a moderator removing a member post does not cascade to its comments; the existing `post.deleted` retraction blanks every notice about the post, and the comments stay soft-visible only through the removed post, which is itself a 404.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 09-08. The vocabulary, the removal and notice server work and the web compile-keeping pieces have their final names. The push-copy deviation and the live-author default need the user's eyes before release.

## Self-Check: PASSED

- Created files exist: `supabase/migrations/20261019225153_moderation_post_removed.sql`, its snapshot, `apps/api/tests/integration/moderation-posts.test.ts`, `packages/core/tests/moderation-log.test.ts`: FOUND
- Commits `a379b390`, `78016c91`, `4dd5c162`, `9401d658`, `e5aefd0a`: FOUND
- RED before GREEN for Tasks 1 and 2 (`git log --grep` on `^test\(0*9-0*7\)` and `^feat\(0*9-0*7\)`): confirmed
- No attribution trailer in the five commit messages: confirmed (0 matches for "co-authored" or "claude" in `b9f1d2be..HEAD`)

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-19*
