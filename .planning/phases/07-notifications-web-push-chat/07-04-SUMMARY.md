---
phase: 07-notifications-web-push-chat
plan: 04
subsystem: notifications
tags: [notifications, producer-sources, retraction, keep-and-mark, pruning, sweeper, deep-links, comment-highlight, D-226, D-228, D-229, D-231, D-232, D-235, UI-D-251, UI-D-254]
status: complete

requires:
  - phase: 07-notifications-web-push-chat
    provides: "07-01: NotificationSource / NotificationRetraction, notificationsFanoutJob, app.notifications_fanout, FEED_NOTIFICATION_KINDS, cutOnWord, the notification-renderers map, NotificationItem, runNotificationJobs"
  - phase: 07-notifications-web-push-chat
    provides: "07-02: sketch 007 (the D-33 gate for Task 3)"
  - phase: 07-notifications-web-push-chat
    provides: "07-03: the live /notificacoes merge the removed row and generic row plug into"
provides:
  - "feed sources: comment.liked (in-app only) and comment.created replies; retractions post.deleted (subject) and comment.deleted (object)"
  - "stories sources: story.published (no source on story.highlighted) and story.commented; retractions story.deleted and story.comment_deleted; STORIES_NOTIFICATION_KINDS, storiesPushCopy"
  - "SQL: app.notifications_retract(text, text, uuid) (definer, tenant-scoped, payload -> {\"removed\": true}), app.notifications_prune(int) (invoker, service_role only), index notifications_created_idx"
  - "kernel: ModuleManifest.sweepFunctions, packages/core/server/jobs/sweep-functions.ts (registerSweepFunctions, registeredSweepFunctions, SWEEP_FUNCTION_NAME), the hourly sweeper's function pass"
  - "feed: GET /v1/feed/comments/{commentId}/thread (getCommentThread, commentThreadSchema, COMMENT_THREAD_REPLIES_CAP); CommentsList pinnedThread + highlightCommentId; CommentItem highlighted"
  - "web: registry entries for feed.comment_liked, feed.comment_replied, stories.story, stories.story_commented; genericNotificationRenderer; the removed variant; getCommentThread in lib/feed.ts; NoticeToast; /post/[postId]?comentario=; /inicio?aviso=story-expirado"
  - "catalog: notifications.kinds.{story,commentLiked,commentReplied,storyCommented,generic,removed}, notifications.fallback.{storyExpired,removed}, feed.comments.targetMissing"
affects: [07-05 event sources and reminder rows (actor-less variant ready), 07-06 push channel (push hints and tags already on every intent), 07-08 chat counters, phase 8 moderation (deleted content already leaves no text in the bell)]

actuals:
  tokens: 162981
  tasks: 3
  commits: 4
plan_head_before: 7440636a73695ffbd3fa4e698f7449006b405f16

tech-stack:
  added: []
  patterns:
    - "Keep-and-mark retraction: a domain delete event replaces the matching rows' payload with exactly {\"removed\": true}; the API answers removed: true with facts {}; the web renders a button"
    - "Kernel runs module SQL by NAME: manifest.sweepFunctions validated against ^[a-z_]+$ and executed through the admin lane with sql.identifier, one try/catch per name"
    - "Renderer href receives the request's one nowMs, so time-bounded targets (expired stories) are decided on the server"
    - "Pinned-first list: the host passes a pre-mapped thread; the list prepends its root and filters it out of every page by id, and dedupes replies on paging"
    - "One-shot notice toasts strip their own query parameter with history.replaceState (no server round trip, reload is silent)"
    - "e2e on post pages scopes list locators with filter({ visible: true }): the router can keep a hidden copy of the route"

key-files:
  created:
    - packages/modules/notifications/server/retract.ts
    - packages/modules/stories/server/notifications.ts
    - packages/modules/stories/server/notification-copy.ts
    - packages/modules/stories/tests/notification-sources.test.ts
    - packages/core/server/jobs/sweep-functions.ts
    - supabase/migrations/20260930141455_notifications_retract_prune.sql
    - supabase/migrations/20260930142350_notifications_prune_index.sql
    - supabase/migrations/20260930142352_notifications_prune.sql
    - apps/api/tests/integration/notifications-prune.test.ts
    - apps/web/components/feedback/NoticeToast.tsx
    - packages/modules/feed/tests/comments-list-highlight.test.tsx
  modified:
    - packages/modules/feed/server/notifications.ts
    - packages/modules/feed/server/notification-copy.ts
    - packages/modules/feed/module.ts
    - packages/modules/feed/tests/notification-sources.test.ts
    - packages/modules/stories/contracts/index.ts
    - packages/modules/stories/module.ts
    - packages/modules/notifications/server/fanout-job.ts
    - packages/modules/notifications/server/service.ts
    - packages/modules/notifications/server/sink.ts
    - packages/modules/notifications/db/schema.ts
    - packages/modules/notifications/module.ts
    - packages/core/server/media/sweep-job.ts
    - packages/core/server/modules/manifest.ts
    - apps/api/src/modules/registry.ts
    - supabase/tests/151-notifications.sql
    - apps/api/tests/integration/notifications.test.ts
    - packages/modules/notifications/ui/NotificationItem.tsx
    - packages/modules/notifications/tests/notification-item.test.tsx
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/routes.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/ui/CommentsList.tsx
    - packages/modules/feed/ui/CommentItem.tsx
    - packages/modules/feed/ui/index.ts
    - apps/web/lib/notification-renderers.tsx
    - apps/web/lib/notifications-view.ts
    - apps/web/lib/notifications-view.test.ts
    - apps/web/lib/feed.ts
    - apps/web/app/(app)/notificacoes/NotificationsSurface.tsx
    - apps/web/app/(app)/notificacoes/page.tsx
    - apps/web/app/(app)/notificacoes/actions.ts
    - apps/web/app/(app)/post/[postId]/page.tsx
    - apps/web/app/(app)/inicio/page.tsx
    - apps/web/messages/pt-BR/notifications.json
    - apps/web/messages/pt-BR/feed.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/notifications.spec.ts
    - apps/web/e2e/notifications-admin.ts

key-decisions:
  - "Retraction is keep-and-mark: app.notifications_retract replaces payload with exactly {\"removed\": true} (every fact and the excerpt dropped) in the payload's tenant only; the row renders 'Este conteúdo foi removido.' as a button"
  - "Personal-kind push tags: feed-comment-replied and stories-comment, both renotify true, urgency normal"
  - "Story push TTL is min(86400, seconds to expiry) with a floor of 1; a video story carries no preview"
  - "comment.liked requires the post to be live; story.commented notifies even when the story has expired (the tap then routes to Início's expired notice)"
  - "Sketch 007 (the D-33 gate for Task 3) was approved by the developer, igor.vboas, by hand on 2026-09-30 (approval_kind: provisional); the executor only committed that edit as-is (67ba861)"
  - "The comment-thread read returns the root, its replies up to REPLIES_MAX_PAGE_SIZE (25), the target appended when beyond the cap, and a repliesCursor so 'Ver mais respostas' continues the same keyset"
  - "A failed thread read renders the post plainly with NO toast: only a 404/400 claims the comment is gone"
  - "Reduced-motion highlight ends on pointerdown, keydown, wheel or touchmove, not on scroll, because the row's own scrollIntoView fires scroll"
  - "An unknown kind renders the generic row on the Bell disc (leading: 'glyph' even when the row names an actor); 07-01's filter is gone"

patterns-established:
  - "NotificationRenderer { glyph, glyphTone?, leading?: 'actor' | 'glyph', sentence(facts, t, actor), href(facts, nowMs) }"
  - "NoticeToast({ message, param, tone }) for any server-chosen one-shot notice keyed by a query parameter"

requirements-completed: [NOTIF-01, NOTIF-02]

coverage:
  - id: D1
    description: "Likes and replies on a member's comment, new stories and comments on a story reach exactly their audience once; staff keep personal kinds and never get broadcast kinds; authors never notify themselves; likes stay off push"
    requirement: NOTIF-01
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts; packages/modules/stories/tests/notification-sources.test.ts"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#notifications tipos"
        status: pass
    human_judgment: false
  - id: D2
    description: "Deleting a post, comment, story or story comment blanks the rows about it in its own tenant only (payload exactly {removed: true}); the list shows the removed button and a tap toasts"
    requirement: NOTIF-01
    verification:
      - kind: other
        ref: "pnpm supabase test db (151-notifications.sql, retract adjacency and idempotency)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts#notifications tipos (delete post / comment / story)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications tipos > deleting the post turns its rows into the removed button, and a tap toasts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Rows older than 90 days are pruned by the existing hourly sweeper through the notifications module's sweepFunctions; the boundary is exact and authenticated cannot call the prune"
    requirement: NOTIF-02
    verification:
      - kind: other
        ref: "pnpm supabase test db (151-notifications.sql prune cases)"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/notifications-prune.test.ts; apps/api/tests/integration/media-sweeper.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every row renders from its registry entry (comment liked with the like-toned heart, reply, story, story comment), an unknown kind degrades to the generic row, and a removed target is a button with no preview"
    requirement: NOTIF-02
    verification:
      - kind: unit
        ref: "apps/web/lib/notifications-view.test.ts; packages/modules/notifications/tests/notification-item.test.tsx"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications tipos > a like and a reply on the member comment reach the bell, and the reply lands tinted first"
        status: pass
    human_judgment: false
  - id: D5
    description: "A like or reply lands on /post/{id}?comentario= with the root thread first, the target centred and tinted 2.4 s, even 150 roots deep in a 200-comment post, never drawn twice; a foreign, deleted or junk comentario shows the post plus the missing toast (or nothing for junk)"
    requirement: NOTIF-02
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/comments-list-highlight.test.tsx"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications tipos > E08 backstop; > a foreign or deleted comentario shows the post and the missing toast; junk is ignored"
        status: pass
    human_judgment: false
  - id: D6
    description: "A story row past expiresAt lands on Início with 'Este story expirou.' once; any other aviso is ignored"
    requirement: NOTIF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications tipos > an expired story row lands on Início with \"Este story expirou.\" once"
        status: pass
    human_judgment: false
  - id: D7
    description: "E03/E08 long-text backstops seen on a real phone (60-char actor + 80-char excerpt at 320px; deep comment highlight)"
    requirement: NOTIF-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/notifications.spec.ts#notifications tipos > E03 backstop (mobile-chromium and desktop-chromium at 320px)"
        status: pass
    human_judgment: true
    rationale: "The plan marks both backstops as 'seen on a phone at the phase UAT'; real-device UAT is blocked locally until production hosts are used."

duration: 3h10m
completed: 2026-09-30
---

# Phase 7 Plan 04: Feed and stories notification kinds, retraction, pruning and deep links Summary

**Likes and replies on a member's comments, new stories and story comments reach the bell; deleted content is blanked to `{"removed": true}` in its own tenant; the hourly sweeper prunes rows past 90 days through a module-declared SQL function; and every tap lands on a real screen: the exact comment (pinned first and tinted, even deep in a long thread), the story, or a pt-BR notice.**

## Performance

- **Duration:** about 3h10m wall clock across two executors (includes the wait for the developer's sketch approval before Task 3)
- **Started:** 2026-09-30T14:09:52Z (plan base 7440636)
- **Completed:** 2026-09-30T17:25:00Z
- **Tasks:** 3 of 3
- **Files modified:** 55 (19 of them migration snapshots and SQL)

## Accomplishments

- Feed sources for `comment.liked` (in-app only, `push: null`) and replies, stories sources for `story.published` and `story.commented`; no source on `story.highlighted`, so a story born into a highlight notifies once.
- `app.notifications_retract` keeps each affected row and replaces its payload with exactly `{"removed": true}`, driven by `retractionsFor(event)` inside the fan-out transaction.
- `app.notifications_prune` (service_role only) runs from the existing hourly sweeper through the new `ModuleManifest.sweepFunctions` field, so the kernel never names a module table.
- `GET /v1/feed/comments/{commentId}/thread` plus the `?comentario=` pin and highlight on the post page. The pinned root never repeats as the list pages on, and a reply beyond the cap is still included.
- The web registry now covers every feed and stories kind. Unknown kinds fall back to a generic row and removed targets render as a button, so no row is filtered out and no tap lands on a broken route.

## Task Commits

1. **Task 1: Feed and stories notification kinds and their retractions** - `1da7bad` (feat)
2. **Task 2: [BLOCKING schema] 90-day pruning through the existing sweeper** - `1a635dc` (feat)
3. **D-33 gate record: the developer's approval of sketch 007** - `67ba861` (docs)
4. **Task 3: Every row renders and every tap lands** - `779be21` (feat)

**Plan metadata:** recorded in the docs commit that carries this SUMMARY.

## Files Created/Modified

- `packages/modules/{feed,stories}/server/notifications.ts`: the sources and retractions.
- `packages/modules/notifications/server/{retract.ts,fanout-job.ts,sink.ts,service.ts}`: retraction in the fan-out transaction, the singleton-key fix and `facts: {}` for removed rows.
- `supabase/migrations/2026093014*_notifications_*.sql`: the retract definer, the prune function and the `created_at` index.
- `packages/core/server/jobs/sweep-functions.ts` and `packages/core/server/media/sweep-job.ts`: the sweep-function name registry and the sweeper's function pass.
- `packages/modules/feed/server/{service,routes}.ts` and `contracts/index.ts`: the comment-thread read.
- `packages/modules/feed/ui/{CommentsList,CommentItem}.tsx`: the pinned thread and the highlight.
- `packages/modules/notifications/ui/NotificationItem.tsx`: the removed button variant.
- `apps/web/lib/{notification-renderers.tsx,notifications-view.ts,feed.ts}`: the kinds, the generic row, the removed row and `getCommentThread`.
- `apps/web/app/(app)/{post/[postId],inicio,notificacoes}/*`: `?comentario=`, `?aviso=story-expirado` and the removed-row toast.
- `apps/web/components/feedback/NoticeToast.tsx`: the one-shot notice.
- `apps/web/e2e/notifications{.spec,-admin}.ts`: the `notifications tipos` e2e and its fixtures.

## Decisions Made

- **Retraction: keep and mark.** The row stays and its payload becomes exactly `{"removed": true}`. The excerpt and every other fact are gone. The API answers `removed: true, facts: {}`, and the web renders "Este conteúdo foi removido." as a button that marks the row read and shows "Este conteúdo não está mais disponível.".
- **Push tags for personal kinds:** `feed-comment-replied` and `stories-comment`, both with `renotify: true` and `urgency: 'normal'`. Likes are never pushed (D-235).
- **Story push TTL** is `min(86400, seconds to expiry)`, floored at 1. A video story carries no preview.
- **`comment.liked` requires a live post.** `story.commented` notifies even after the story expires, and the tap then routes to Início's expired notice.
- **Post and comment DELETE answer `200 {deleted: true}`; story DELETE answers `204`.** These are the existing contracts, recorded because the integration tests assert them.
- **Sketch 007 approval (the D-33 precondition of Task 3):** the developer, **igor.vboas**, made this edit by hand in their own terminal on **2026-09-30**, with `approval_kind: provisional`. The executor checked it (`grep -q '^approved: true'` passed, and the diff touched only the five frontmatter keys) and committed it unchanged as `67ba861`. Neither the orchestrator nor an executor wrote the approval.
- **The thread read** returns the root, up to 25 replies (`REPLIES_MAX_PAGE_SIZE`), the target appended when it lies beyond them, and a `repliesCursor`. The list dedupes the out-of-order target when it pages on.
- **A failed thread read (5xx or transport) shows no toast.** Only a 404 or 400 claims the comment is gone.
- **Reduced-motion highlight** ends on `pointerdown`, `keydown`, `wheel` or `touchmove`. Listening to `scroll` would end it on the row's own `scrollIntoView`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The notification sink lost a second event while the first fan-out job was still queued**
- **Found during:** Task 1
- **Issue:** 07-01's sink enqueued `notifications.fanout` without a singleton key. The `short` policy unique index `job_common_i1` therefore dropped a second event that arrived while the first job was still in `created`, and its bell rows were lost.
- **Fix:** every sink enqueue now carries `singletonKey: <event>:<randomUUID>`. Idempotency stays in the fan-out dedupe key.
- **Files modified:** packages/modules/notifications/server/sink.ts
- **Committed in:** 1da7bad

**2. [Rule 2 - Missing critical] A removed row answers `facts: {}`**
- **Found during:** Task 1
- **Issue:** without this, the list API would forward `removed` as though it were a fact.
- **Fix:** the service returns an empty facts object for a removed row.
- **Files modified:** packages/modules/notifications/server/service.ts
- **Committed in:** 1da7bad

**3. [Rule 3 - Blocking] `app.notifications_prune` lives in its own custom migration**
- **Found during:** Task 2
- **Issue:** Task 1's `notifications_retract_prune` migration was already committed, so Task 2 could not append to it.
- **Fix:** used the plan's stated alternative, `20260930142352_notifications_prune.sql`. The index and custom migrations were generated 2 s apart to avoid a timestamp clash.
- **Committed in:** 1a635dc

**4. [Plan path] Renderers added to `apps/web/lib/notification-renderers.tsx`, not `registry.tsx`**
- **Found during:** Task 3
- **Issue:** 07-01 moved the renderers into that leaf module, which `registry.tsx` re-exports, so a unit test can import them without the server-action graph.
- **Fix:** added the new kinds there. `registry.tsx` is unchanged and still re-exports the map.
- **Committed in:** 779be21

**5. [Plan detail] `NoticeToast` strips its parameter with `history.replaceState`, not `router.replace`**
- **Found during:** Task 3
- **Issue:** `router.replace` would re-render the page on the server. On the post page that would drop the pinned thread under the member.
- **Fix:** used `window.history.replaceState(null, …)`, which Next syncs into its router with no server round trip. A reload still does not repeat the notice.
- **Committed in:** 779be21

**6. [Plan detail] The thread response adds `repliesCursor`**
- **Found during:** Task 3
- **Issue:** without a cursor, the pinned thread's "Ver mais respostas" could not continue the replies keyset.
- **Fix:** added `repliesCursor` next to the planned `{postId, root, replies, targetId}`.
- **Committed in:** 779be21

---

**Total deviations:** 6 (1 bug, 1 missing critical, 1 blocking, 3 plan-detail adjustments).
**Impact on plan:** all were needed for correctness or to follow the codebase's existing structure. No scope creep.

## Issues Encountered

- **A flaky existing e2e, outside this plan.** `feed-comments.spec.ts` "a failed comment list renders the inline error…" fails on the first cold run after `db:reset` + `db:seed`, on mobile only. Its `failNextActions` helper fails the next `POST` to `/inicio`, and the Mux playback-token action consumes that forced failure (`media.playback_token_failed` appears in the log). The test passes 3/3 in isolation and in a warm full-file run. Nothing here touches that spec, the media module or the feed card. Logged in `deferred-items.md` with a fix path. Every other test in the verify command passed on both projects (20 passed, 1 failed).
- **Hidden route copies in e2e.** Next can keep a hidden copy of a visited post page, so two e2e locators matched twice. Both are now scoped with `filter({ visible: true })`.
- **Env hosts.** The known env-host issue from `deferred-items.md` (tria-* hosts in `.env.local`) is unchanged. It did not affect any 07-04 test.

## Verification (final run)

- Module tests pass: `module-notifications` (26), `module-feed` (153, including 8 new highlight cases), `module-stories`.
- `pnpm boundaries`: OK.
- `pnpm db:generate`: no drift.
- `pnpm supabase test db`: 611/611, PASS.
- Integration: `notifications`, `notifications-prune`, `media-sweeper`, `stories` and `feed-interactions`, 134/134 passed.
- Web: `typecheck`, `lint`, `vitest lib/notifications-view i18n` (479), `check-ui-literals`, `build` and `check-static-routes` (0 offenders) all pass.
- Playwright `notifications tipos`: 12/12 on mobile-chromium and desktop-chromium. `feed-comments`: all pass except the flaky test logged above.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- 07-05 can register event sources and reminder rows. The actor-less leading form and `href(facts, nowMs)` are ready.
- 07-06 inherits a push hint and tag on every non-like intent.
- **Open for the phase UAT:** the E03 and E08 backstops are automated at 320px but still need a look on a real phone. Real-device UAT is blocked locally.

## Self-Check: PASSED
