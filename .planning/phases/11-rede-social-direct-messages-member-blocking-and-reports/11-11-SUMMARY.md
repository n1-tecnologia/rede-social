---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
plan: 11
subsystem: api
tags: [follow-graph, member-block, neutral-refusal, profile-facts, follow-notice, notification-source, D-722, D-724, D-725, D-726, D-727, CHAT-06, CHAT-07]
requires:
  - phase: 11-03
    provides: "app.members_blocked_between (caller-relative), app.social_pair_open (worker lane only), app.pair_open_in"
  - phase: 11-07
    provides: "the block deletes both follow rows; social_follows_insert_member refuses a blocked pair (the 42501 backstop)"
provides:
  - "followMember refuses a blocked pair (either direction) with the identical bare 404 NOT_FOUND an unknown, staff or removed target gets"
  - "optional canFollow, canMessage, blockedByViewer on the social profile and on each follow-state item (strict schemas, new keys)"
  - "the event social.followed (ids only), emitted after commit only when the insert created a row"
  - "SOCIAL_NOTIFICATION_KINDS.followed and socialNotificationSources, registered through the social manifest"
  - "the follow notice: one in-app bell row per ordered pair, push null, dropped unless the pair is open at fan-out time"
affects: [11-18, 11-21, 11-23]
tech-stack:
  added: []
  patterns:
    - "a block refusal is one more `and not app.members_blocked_between(...)` beside LIVE_MEMBER: no new code, no oracle"
    - "profile facts as booleans of what is offered; a blocked member's answer equals a pair that cannot interact"
    - "a notification source that asks the worker-only open-pair definer, with the dedupe key as the once-per-pair rule"
key-files:
  created:
    - packages/modules/social/server/notifications.ts
    - packages/modules/social/tests/notification-sources.test.ts
    - apps/api/tests/integration/social-block.test.ts
    - apps/api/tests/integration/direct-notifications.test.ts
  modified:
    - packages/modules/social/server/service.ts
    - packages/modules/social/server/index.ts
    - packages/modules/social/contracts/index.ts
    - packages/modules/social/module.ts
    - packages/modules/social/README.md
    - packages/modules/social/tests/service.test.ts
    - packages/modules/social/tests/contracts.test.ts
    - packages/modules/social/tests/module.test.ts
    - apps/api/tests/integration/social.test.ts
key-decisions:
  - "followState answers false, false, false for every id that is not a live other member (unknown, staff, another tenant's, the caller), so the facts are no existence oracle either"
  - "canFollow and canMessage are the same social question today and travel as two names; the web composes canMessage with chat.direct"
  - "the resolver reads the follower's live member membership and the open-pair answer in ONE tenant-pinned statement; a missing membership and a closed pair are the same empty answer"
  - "the intent does not re-check that the follow row still exists at fan-out time (the plan lists only the open pair and the follower membership as drop cases); a follow undone before the worker runs still rings once"
requirements-completed: [CHAT-07, CHAT-06]
duration: 11 min
completed: 2026-11-19
status: complete
commits: 3
plan_head_before: 6bc6add31d93f3de91f52dc8f11ae8360942ff52
actuals:
  tokens: 70000
  tasks: 3
  commits: 3
coverage:
  - id: D1
    description: "A blocked pair cannot follow each other; the refusal is byte-identical to the answer for an unknown membership id, with no details"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-block.test.ts#1. after a block the follow is the plain 404 from both sides"
        status: pass
    human_judgment: false
  - id: D2
    description: "The profile and the follow state carry canFollow, canMessage and blockedByViewer; only the blocker reads blockedByViewer, the blocked member reads the all-false words of a pair that cannot interact"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-block.test.ts#2 and #3, apps/api/tests/integration/social.test.ts"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/contracts.test.ts, service.test.ts (the profile facts)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A follow rings the followee's bell once per ordered pair (follow, unfollow, follow again is one row), in-app only, never a push, never to a blocked pair, social off, a removed follower or staff"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#1 to #9"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/notification-sources.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ten parallel PUTs leave one follow, answer 200 each, queue one social.followed job and leave one bell row; a repeat PUT queues nothing"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#3 and #4"
        status: pass
    human_judgment: false
  - id: D5
    description: "A member post still notifies nobody and a first-level comment on it still tells its author (D-726, D-477); the shipped feed notification suites stay green"
    requirement: CHAT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/direct-notifications.test.ts#10, feed-social.test.ts (53)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A block in one tenant changes nothing for the same two users in another tenant, for the follow, the facts and the notice"
    requirement: CHAT-07
    verification:
      - kind: integration
        ref: "social-block.test.ts (cross-tenant) and direct-notifications.test.ts (follow notice cross-tenant)"
        status: pass
    human_judgment: false
---

# Phase 11 Plan 11: Follow graph under a member block, the profile facts and the follow notice Summary

A member block now reaches the follow graph through the API: a follow across a block is the plain 404 of any unknown target, the profile and the per-id state read finished `canFollow`, `canMessage` and `blockedByViewer` facts that never say "blocked me", and a new follow rings the followee's bell once per pair with no push.

## What was built

- **Task 1 (d5bc394d, tracer).** `followMember` adds `and not app.members_blocked_between(m.user_id)` to the target lookup and to the insert's select, so a blocked pair in either direction is the bare `404 NOT_FOUND` with no details (the 42501 catch to `MODULE_DISABLED` stays only as the plan 07 backstop). `getMemberSocial` and `followState` gain the three optional booleans on new keys of the existing strict schemas (`memberFactFields`). The profile reads them from one statement (`members_blocked_between`, `is_blocked_by_viewer`); the follow state reads them per id in the same statement as `following`. The insert now `returning id` and queues `social.followed` after the transaction only when a row came back.
- **Task 2 (57c0cdcc).** `SOCIAL_NOTIFICATION_KINDS`, the `SocialFollowed` event (declaration-merged into `EventMap`) and `server/notifications.ts`: one tenant-pinned statement reads the follower's live `member` membership id and `app.social_pair_open(follower, followee)`; the intent is the followee's, the follower excluded, key `social.followed:{follower}:{followee}`, subject the follower's membership, facts exactly `{ membershipId }`, `channels: ['in_app']`, `push: null`. Registered through the manifest; README documents the event, the source and the two kernel imports.
- **Task 3 (dba352b8).** Cross-checks in `social-block.test.ts`: both private lists skip a blocked pair and still page one by one, unfollow of a blocked or removed target stays 200, counts carry no deleted follow, the lab follow of the same two users survives a demo block.

## Verification run

| Gate | Result |
|------|--------|
| `module-social` vitest (8 files) | 85/85 |
| `apps/api` unit (`tests/unit`, includes `module-readmes`, `registry`, `mounts`, `admin-lane-inventory`) | 138/138 |
| `social-block.test.ts` | 7/7 |
| `direct-notifications.test.ts` | 11/11 |
| `social-module`, `social` (after the Rule 1 fix), `feed-social` (53), `reports-blocks` (22), `notifications` + `notifications-prune` (33) | green |
| `isolation.test.ts` | 92/96; the 4 reds are b3, b8 and two events cases (stale seeded stories and events, pre-existing) |
| `turbo typecheck` web + api + module-social (`TURBO_CACHE=local:r`, concurrency 4) | clean |
| `turbo test --filter=@rede-social/web` | 416 files, 10068 tests, all pass |
| `pnpm boundaries`, `check-ui-literals.sh`, `pnpm guard:lanes`, biome on the edited files | OK |
| pgTAP | not run: no migration or SQL file changed in this plan |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug caused by my change] `social.test.ts` asserted the exact old shapes with strict `toEqual`**
- **Found during:** Task 3 (the shipped social suites rerun)
- **Issue:** the plan said the shipped suites pass unchanged, but three cases there compare the profile and the follow-state items with `toEqual`, and the answer now carries the three facts.
- **Fix:** the three expectations gain `canFollow`, `canMessage`, `blockedByViewer` (a live member offered both; self, staff, another tenant's and unknown ids all false).
- **Files modified:** `apps/api/tests/integration/social.test.ts`
- **Commit:** dba352b8

**2. [Rule 3 - ordering] README and the event emit landed in Task 1's commit, not Task 2's**
- **Found during:** Task 1 (`module-readmes.test.ts` reads every `emit` under `server/**`)
- **Issue:** emitting `social.followed` in `followMember` (Task 1's `returning id` change) made the README drift test red until the README listed the event and the `events/bus` kernel import.
- **Fix:** the Events emitted section and the kernel import were written in Task 1's commit; the source, manifest and the rest of the README followed in Task 2.
- **Commit:** d5bc394d

**Total deviations:** 2 (1 Rule 1, 1 ordering). **Impact:** none on behaviour.

## Known limits

- The resolver does not check that the follow row still exists at fan-out time. A follow undone before the worker runs still produces the bell row; the plan lists only the closed pair and a missing follower membership as drop cases, and "never retracted when undone" points the same way.
- `isolation.test.ts` still shows 4 red cases (stories b3/b8, two events cases) caused by the stale seeded stories and events, not by this plan.

## Known Stubs

None.

## Threat Flags

None. The new surface is the follow notice (a bell row through the existing fan-out); it is covered by T-11-15 (tested: blocked, social off, removed, staff, cross-tenant) and T-11-13 (dedupe key).

## Self-Check: PASSED

- Files exist: `packages/modules/social/server/notifications.ts`, `packages/modules/social/tests/notification-sources.test.ts`, `apps/api/tests/integration/social-block.test.ts`, `apps/api/tests/integration/direct-notifications.test.ts`.
- Commits exist: d5bc394d, 57c0cdcc, dba352b8 (`git log` from `plan_head_before`, count 3).
- Acceptance: `grep members_blocked_between packages/modules/social/server/service.ts` and `grep social.followed packages/modules/social/module.ts packages/modules/social/server/notifications.ts` match; `social-module.test.ts` passes unchanged; the new test compares the 404 bodies byte for byte (with the request id normalised).
