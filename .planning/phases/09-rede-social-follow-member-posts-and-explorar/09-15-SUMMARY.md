---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 15
subsystem: api
tags: [notifications, social, gap-closure, tracer, reply, wr-02, worker, vitest]

requires:
  - phase: 09-rede-social-follow-member-posts-and-explorar
    provides: "app.social_can_read_for(p_user, p_author), the oracle-free explicit-user social read test (plan 09-14); the 09-07 comment notice and its row-local social_on and author_live reads"
provides:
  - "socialCanReadFor, the explicit-user form of the social gate in the kernel seam file"
  - "the audience test of the reply branch of resolveCommentCreated: a reply to a followers-only thread notifies the root comment's author only while they may still read it (WR-02, SOCIAL-06)"
affects: [09-16, 09-17, notifications, phase-10-member-authoring, phase-11]

actuals:
  tokens: 6300
  tasks: 2
  commits: 3
plan_head_before: 67dbd87d1d8c33115d40a8e912f20c01e59876ea
commits: 3

tech-stack:
  added: []
  patterns:
    - "row-local tests first, one definer probe last: a reply decides on columns it already read, and pays one extra statement only when it is a followers reply that passed them"
    - "explicit-user kernel seam constant (socialCanReadFor) mirroring lockedCommunityIdsFor, so a module asks the kernel and never names another module's table"

key-files:
  created: []
  modified:
    - packages/core/db/social-gate.ts
    - packages/modules/feed/server/notifications.ts
    - packages/modules/feed/tests/notification-sources.test.ts
    - apps/api/tests/integration/moderation-posts.test.ts

key-decisions:
  - "The recipient test is the kernel seam, not a second mechanism: socialCanReadFor wraps app.social_can_read_for exactly as lockedCommunityIdsFor wraps app.community_locked_ids_for, and the feed names no social table (MOD-02). The worker lane cannot use the claims-based app.social_visible_author_ids(), which answers {} for its role."
  - "Fail closed on the visibility value: anything other than 'tenant' is treated as a followers post, so an unexpected value or a fixture without the column is refused unless the definer answers exactly true."
  - "The cheap tests run first: social_on and author_live come from the same statement as the reply, so a refusal on those grounds costs no extra statement; only a followers reply that passes them pays the one definer probe. An organization-post reply keeps exactly one statement."
  - "Rows written before a revocation are not retracted (Assumption A5 of 08.2, unchanged); the plan only stops writing new ones."
  - "No schema change: the SQL half shipped in plan 09-14 and the precondition (to_regprocedure of app.social_can_read_for is not null) held."

patterns-established:
  - "A thread-recipient notice on a followers post is gated at fan-out time, never at comment time, through the kernel explicit-user seam"

requirements-completed: [SOCIAL-06]

coverage:
  - id: D1
    description: "A follower-turned-stranger (unfollowed) who is replied to receives neither the bell row nor the queued push; a current follower, and the same person after following again, still does (WR-02 tracer)"
    requirement: SOCIAL-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-posts.test.ts#7. SOCIAL-06 / WR-02: a reply to an ex-follower's comment yields no bell row and no push; the follower's reply still does"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts#comment.created: the reply branch audience (WR-02, SOCIAL-06)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A reply is dropped when the post author is blocked or `social` is off at fan-out time, with a live control; the live admin_tenant moderator and the post author are still told"
    requirement: SOCIAL-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-posts.test.ts#8. and #9. (author blocked or social off; moderator and author inside the gate)"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/notification-sources.test.ts (statement counts 1/1/1/1/2, fail-closed visibility, post author kept, accented excerpt, community lock last)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Organization-post and community-lock replies are unchanged (one statement, same intent, dedupe key and push copy); the notification and store-gate suites stay green"
    requirement: SOCIAL-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/notifications.test.ts and store-gate.test.ts (with moderation-posts: 3 files, 81 tests)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-20
status: complete
---

# Phase 9 Plan 15: Reply notice audience gate Summary

**A reply to a comment on a followers-only member post now reaches the root comment's author only while the kernel seam `socialCanReadFor` says they may still read the thread, so an ex-follower, a blocked post author or a `social`-off tenant produce neither the bell row nor the push carrying the excerpt.**

## Performance

- **Duration:** 6 min (12:44 to 12:50 UTC)
- **Started:** 2026-10-20T12:44:10Z
- **Completed:** 2026-10-20T12:50:00Z
- **Tasks:** 2
- **Files modified:** 4 (two source, two test)

## Accomplishments

- **WR-02 closed (Task 1, tracer).** `socialCanReadFor(userId, authorUserId)` was added to `packages/core/db/social-gate.ts` (docblock table row plus the explanation that it has no kernel stub, is the explicit-user form for the worker, and answers about other users only to the system lane). The reply branch of `resolveCommentCreated` now selects `p.visibility`, `p.author_user_id as post_author_user_id`, `author_live` and `social_on` in its one existing statement, and for any visibility other than `tenant` returns `[]` when `social_on` or `author_live` is false, otherwise asks one more statement and returns `[]` unless the answer is exactly `true`. The community lock check and everything after are unchanged.
- **Every revocation shape pinned (Task 2).** Unit cases fix the statement counts (1 for tenant, social off, author not live and self-reply; 2 for a followers reply with a probe), the fail-closed visibility value, the post author being kept, the accented 80-grapheme excerpt and the community lock running last. Integration cases 8 and 9 cover author blocked and `social` off at fan-out time, the live moderator, and the post author.
- **Nothing else moved.** `service.ts`, `notification-copy.ts` and the feed contracts have an empty diff; no new kind, channel or push field.

## Case 9 moderator path: it ran in the integration suite

The `admin_tenant` comment on Helena's followers post was accepted by the API in this environment, so the moderator branch (probe true through the `admin_tenant` arm of the definer) is proved end to end, not only in unit cases. A real `support_tenant` as a recipient is covered by pgTAP 203 (plan 09-14), not re-tested here.

## Task Commits

1. **Task 1 (tracer), RED:** `f50b8860` (test) - unit audience cases, reply fixtures gain the new columns, integration case 7, Alvaro's push subscription
2. **Task 1, GREEN:** `cf425747` (feat) - `socialCanReadFor`, the reply-branch audience test, format fix to case 7
3. **Task 2:** `24790d0f` (test) - remaining unit cases, integration cases 8 and 9

**Plan metadata:** the docs commit that carries this SUMMARY, STATE.md and ROADMAP.md.

## Files Created/Modified

- `packages/core/db/social-gate.ts` - `socialCanReadFor` and the docblock row
- `packages/modules/feed/server/notifications.ts` - extended `CommentRepliedRow`, the widened reply statement, the audience test, the updated docblock
- `packages/modules/feed/tests/notification-sources.test.ts` - three fixtures carry `visibility: 'tenant'` and the new columns; describe 'comment.created: the reply branch audience (WR-02, SOCIAL-06)'
- `apps/api/tests/integration/moderation-posts.test.ts` - Alvaro's push subscription (created in `beforeAll`, deleted in `afterAll`), helpers `repliesFor`, `pushesOfReply`, `follow`, `unfollow`, cases 7, 8, 9

## Decisions Made

Planning decisions 1 to 5 were followed as written; they are listed under `key-decisions`.

## Verification results (real numbers)

| Check | Result |
|-------|--------|
| `@rede-social/module-feed` unit suite | 24 files, 327 tests, PASS (notification-sources: 41 tests, 32 existing plus 9 new) |
| `@rede-social/module-feed` typecheck, lint; `@rede-social/core` typecheck, lint; `@rede-social/api` typecheck, lint | clean |
| `pnpm boundaries` | clean, no issues in 1717 files |
| Integration, describe '09 notice' (RED, Task 1) | 1 failed, 6 passed, 13 skipped |
| Integration, describe '09 notice' (GREEN, Task 1) | 7 passed, 13 skipped |
| Integration, describe '09 notice' with cases 8 and 9 | 9 passed, 13 skipped |
| Integration: moderation-posts, notifications, store-gate (whole files) | 3 files, 81 tests, PASS, nothing skipped |
| `git diff --stat` on service.ts, notification-copy.ts, feed contracts | empty |
| Local data after the runs | Alvaro follows Helena, Marcos does not, Helena active, `social` on, `notifications` off (seed state), no extra push subscription |

No pgTAP was run: this plan changes no schema. No `db:reset`, no `db:seed`, nothing pushed.

## Deviations from Plan

None - plan executed exactly as written.

Small authoring notes, not deviations: the unit case for an unexpected visibility value asserts a refusal when the probe answers nothing (an unexpected value that the definer answers `true` for would be notified, the same as a real followers post, which is the intended fail-closed shape: the definer decides). Biome reformatted two long `commentOn` calls in the case 7 test; that formatting landed in the GREEN commit.

## TDD Gate Compliance

- Task 1 (tracer): genuine RED. Unit run: 3 failed, 33 passed in `notification-sources.test.ts` (the probe-true case failed on the statement count, expected 1 to be 2; the refusing probe and the absent/null probe cases failed with the intent still returned). Integration run: case 7 failed at `expect(afterUnfollow).toHaveLength(1)` with 2 rows, after the positive control (Alvaro follows Helena, row and queued push) passed; that is the leak, on the planned assertion. GREEN: 36 unit tests and 7 integration tests passed.
- Task 2: no genuine RED. The plan marks it `tdd="true"`, but it adds regression cases for behavior the Task 1 GREEN already implemented (statement counts, other revocation shapes), so every new case passed on first run. They were not weakened or reshaped to appear red. Their discriminating power for the probe layer comes from Task 1's RED; the row-local layer (`social_on`, `author_live`) is pinned by the statement-count unit cases, because in integration the definer independently refuses those shapes (defense in depth), so cases 8 and 9 would pass even if the row-local tests were removed.
- `gsd_run check tdd-red-evidence` was not run: it parses `node --test` TAP, which Vitest never emits, and `workflow.tdd_mode` is false. No evidence record was fabricated; the raw failing output was kept in the session scratchpad only.

## Issues Encountered

None blocking. Disk free was 8.7 GiB before and 8.3 GiB after the integration runs, above the 3 GiB stop threshold.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the only new surface is a call to the already-hardened `app.social_can_read_for` (T-09-51, T-09-52), now consumed by the worker. Register status: T-09-55 mitigated (audience test, unit cases, integration cases 7 to 9), T-09-56 mitigated (the feed file names no social table, `pnpm boundaries` clean), T-09-57 mitigated (`readable === true` required, null and absent probes covered), T-09-58 and T-09-SC accepted as planned. Prohibition PR-9: no notice row and no push is created for a recipient who fails the audience test, and no retraction, new kind or "lost access" message was added.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 09-16 and 09-17 are next in the gap round. Nothing was pushed or deployed; the four 09-14 migrations are still local only.
- Residual (unchanged, Assumption A5): notice rows written before a revocation are not retracted.

## Self-Check: PASSED

- Modified files exist: `packages/core/db/social-gate.ts`, `packages/modules/feed/server/notifications.ts`, `packages/modules/feed/tests/notification-sources.test.ts`, `apps/api/tests/integration/moderation-posts.test.ts`.
- Commits present in `git log`: f50b8860, cf425747, 24790d0f; `commits: 3` measured from `plan_head_before` 67dbd87d.
- Acceptance greps re-run and passing: `export const socialCanReadFor` and `social_can_read_for` in the seam file; `socialCanReadFor` and the seam import in `notifications.ts`; `social_on` count 6 (4 or more required); no `social_follows` in the feed file; empty diff for `notification-copy.ts`, the feed contracts and `service.ts`; three reply fixtures carry `visibility: 'tenant'`; case 7 restores the follow row in a `finally`; Alvaro's subscription is deleted in `afterAll`.
- Both verify commands of both tasks exit 0.

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-20*
