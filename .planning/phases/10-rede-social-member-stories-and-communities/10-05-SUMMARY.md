---
phase: 10-rede-social-member-stories-and-communities
plan: 05
subsystem: api
tags: [member-communities, tracer, owner-seam, escopo-seam, permissions, limit, moderation, D-706, D-707, D-709, D-710, D-711, D-713, D-718]

requires:
  - phase: 10-03
    provides: "communities.kind, the sentinel position, the restrictive insert/update gates, the 'community' post audience, app.community_action_allowed (constant-false stub)"
  - phase: 10-04
    provides: "moderation_log accepting community_archived and community_removed with subject community; recordModerationAction entries"
provides:
  - "member permission composition: communities.community.create, communities.community.manage_own (requires communities), stories.story.publish (requires stories), member-only, idempotent"
  - "createCommunity stamps kind member, creator and the sentinel position from the session; 42501 from RLS maps to 403 for members"
  - "post owner seam: resolveCommunityTarget answers 404, then ordered owner branches (creator, organization voice, reserved Escopo branch 3), then 403, then archived 400, and returns the audience to stamp ('community' or 'tenant')"
  - "kernel communityActionAllowed (Escopo seam, false for every input today) and the five-name COMMUNITY_ACTIONS vocabulary"
  - "per-member limit: communities.maxPerMember in the social settings (default 3, 0 to 20), kernel seam memberCommunityPolicyFor filled by the registry, advisory-locked count, limit_reached on create and on reactivation"
  - "communityCreateLimiter (10/h) and storyPublishLimiter (30/h, used by plan 07)"
  - "owner predicate on update and delete (404 miss, 403 not yours), creator's archived list scoped to own rows, moderator's archive/removal log rows in the same transaction"
affects: [10-06, 10-07, 10-08, 10-09, 10-11, 10-12, escopo phase (after Phase 11)]

actuals:
  tokens: 29700
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Kernel policy seam filled by the registry (setMemberCommunityPolicy, the setMemberMediaPolicy inversion): the communities module never imports the social package"
    - "Owner predicate on a PLAIN read before the locking read: the member lane's UPDATE policy hides a non-owned row from a for update read, which would turn 403 into 404"
    - "Per-member pg_advisory_xact_lock(hashtextextended('communities:own:' || tenant || ':' || user, 0)) then count under the lock"
    - "Reserved seam branch calling one kernel function that returns true only for a literal true"

key-files:
  created:
    - packages/core/server/communities/action-gate.ts
    - packages/core/server/communities/member-policy.ts
    - packages/core/tests/community-action-gate.test.ts
    - packages/core/tests/member-community-policy.test.ts
    - apps/api/tests/integration/member-communities.test.ts
    - apps/api/tests/integration/moderation-member-content.test.ts
  modified:
    - apps/api/src/modules/registry.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/feed-social.test.ts
    - apps/api/tests/integration/setup.ts
    - apps/api/tests/integration/social-media.test.ts
    - packages/core/server/safety/limits.ts
    - packages/core/server/safety/index.ts
    - packages/modules/communities/module.ts
    - packages/modules/communities/contracts/index.ts
    - packages/modules/communities/server/service.ts
    - packages/modules/communities/server/routes.ts
    - packages/modules/communities/tests/contracts.test.ts
    - packages/modules/communities/README.md
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/tests/contracts.test.ts
    - packages/modules/feed/tests/member-stamp.test.ts
    - packages/modules/feed/ui/PostCard.tsx
    - packages/modules/feed/README.md
    - packages/modules/social/contracts/index.ts
    - packages/modules/social/tests/contracts.test.ts
    - packages/modules/stories/README.md
    - apps/web/lib/platform.ts
    - apps/web/lib/social-limits.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/components/platform/SocialLimitsSheet.test.tsx

key-decisions:
  - "A2 embodied: new member-only keys communities.community.create and communities.community.manage_own plus stories.story.publish for members, composed in the app-tier registry (no static role grant, no staff role); admin_tenant keeps communities.community.manage, so reorder, the all-creators archived list and the store form stay the admin's"
  - "A6 embodied: createAttemptLimiter ceilings of 10 community creations and 30 story publications per member per hour, per process, keyed user:{tenant}:{user}; every attempt counts; the 11th creation answers 429 RATE_LIMITED. The numbers are the planner's, not Igor's"
  - "A8 embodied: an admin editing a member community's name, description or cover is allowed and NOT logged; only a non-creator manager's archive or removal of a member community writes a row"
  - "Escopo seam stays dead code: branch 3 of resolveCommunityTarget calls communityActionAllowed, which asks the constant-false SQL stub, so no refusal, read or write of Phase 10 changed; a post granted that way would be stamped 'community', never 'tenant'"
  - "Ownership of a write requires kind = 'member' as well as created_by_user_id = ctx.userId (stricter than the plan's literal text): a creator of an ORGANIZATION community (an admin later demoted to member) does not regain it through manage_own; branch 1 of the post seam also requires the caller to be a member, so an admin is never an owner"
  - "The reactivation limit check counts the CREATOR's active rows, whoever flips the status (a moderator reactivating is held to the creator's allowance); with social off there is no policy and no check"
  - "memberPostVisible names the 'followers' audience in its member clause (RESEARCH Pitfall 1) and takes includeCommunity for the single-post reads, so a community post is readable and interactive tenant-wide (D-701) while never reaching Reels Todos, Inicio or Explorar"

patterns-established:
  - "A role read stays only where it is a stamp backed by an RLS insert gate (the kind and audience stamp); every other decision is a permission composed in the registry plus an ownership predicate in the statement"
  - "Append-only log tests scope assertions by a subject id (or a per-run unique name) and never delete log rows"

requirements-completed: [MCOMM-01, MCOMM-05, MCOMM-06, MCOMM-10, MPUB-01, MPUB-02, MPUB-03, MPUB-05]

coverage:
  - id: D1
    description: "Tracer: a member creates a community stamped kind member (creator, sentinel position), posts in it (audience community), and a second member and the lab admin get 403 naming it; the post is on the community page only, never in Inicio, Explorar or Reels Todos (a followed creator's community video included)"
    requirement: MCOMM-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-communities.test.ts#10 tracer (8 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Permission composition: three member-only keys, idempotent, absent for staff and when social or the owning module is off; Escopo kernel wrapper true only for a literal true"
    requirement: MPUB-02
    verification:
      - kind: unit
        ref: "apps/api/tests/unit/registry.test.ts#23-25; packages/core/tests/community-action-gate.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Member post rules in a community (photos at the limit, one video, no PDF, order kept, empty post 400) and the social-off window (RLS 42501 maps to 403, never 500)"
    requirement: MPUB-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-social.test.ts#10 community post; member-communities.test.ts#EP-41"
        status: pass
    human_judgment: false
  - id: D4
    description: "Per-member limit: boundary, N+1 parallel creates leave exactly N rows, two members do not block each other, reactivation is held to it, 429 on the 11th attempt, social setting parsed with default 3"
    requirement: MCOMM-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-communities.test.ts#10 limit (7 cases)"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/contracts.test.ts#communities.maxPerMember; packages/core/tests/member-community-policy.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "Creator lifecycle: edit, archive, reactivate, delete an archived community; non-owner 403, miss 404; archived list scoped to own rows; productIds refused"
    requirement: MCOMM-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/member-communities.test.ts#10 lifecycle (6 cases)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Moderator's archive and removal of a member community write one log row in the same transaction (rollback proven with a forced failure), none for the creator, an organization community, a repeat or a text edit; works with social off"
    requirement: MCOMM-10
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/moderation-member-content.test.ts (9 cases)"
        status: pass
    human_judgment: false
  - id: D7
    description: "With social off the member permissions leave the composed set (403 after the cache window) and the SQL gate closes the window for inserts; the admin's moderation keeps working"
    requirement: MPUB-05
    verification:
      - kind: integration
        ref: "member-communities.test.ts#EP-41; moderation-member-content.test.ts#D-718"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-11-11
status: complete
plan_head_before: de79eb27bc48c3e3f906817b39189e29e356ad9c
commits: 6
---

# Phase 10 Plan 05: The Creator Rule in the API Summary

**A member of a `social` tenant now creates a community stamped as theirs, within a race-proof per-member limit, publishes the member post inside it, edits, archives, reactivates and deletes their own, and nobody else (an admin included) can publish there; a moderator's archive or removal of a member community leaves its log row in the same transaction, and the Escopo seam for a buyer's product is reserved as dead code.**

## Performance

- **Duration:** about 30 min
- **Completed:** 2026-11-11
- **Tasks:** 3 of 3 (each with a red commit first); the tracer feedback gate ran green (automated verify only, no human check) before the expansion tasks
- **Files:** 6 created, 26 modified

## Accomplishments

- **Tracer (Task 1):** `permissionsFor` composes the three member keys; `createCommunity` stamps `kind`, creator and the sentinel position from the session; `resolveCommunityTarget` is the post owner seam with the reserved Escopo branch 3 and returns the audience to stamp; `memberPostVisible` stops a followed creator's community video from reaching Reels Todos; `member_no_community` is no longer raised.
- **Limit (Task 2):** `communities.maxPerMember` in the social settings, the `memberCommunityPolicyFor` kernel seam, the advisory-locked count on create and reactivation, `limit_reached`, the two attempt limiters.
- **Lifecycle and trace (Task 3):** owner predicate on update and delete, creator's archived list, `recordModerationAction` for a moderator's archive or removal.
- **Verification (fresh `pnpm db:reset && pnpm db:seed`):** pgTAP 65 files, 4463 tests PASS; the eight integration files below, 230 tests PASS; unit: social 67, feed 333, communities 68, core 1792, api 134; typecheck for module-social, core, module-communities, module-feed, api; `pnpm boundaries` clean; Biome clean.

## Task Commits

1. **Task 1 RED:** `f9437232` (test): failing unit pins, the registry cases, the create/edit contract, the Escopo wrapper and the tracer integration file (14 cases failing on 403 versus 201 and the missing module).
2. **Task 1 GREEN:** `d14a02ca` (feat): composition, kind stamp, owner seam, derived audience, kernel `communityActionAllowed`, README imports.
3. **Task 2 RED:** `13ef20f7` (test): failing seam, limiter, settings and limit integration cases.
4. **Task 2 GREEN:** `2afb6d9d` (feat): settings, seam, advisory-locked limit, limiters, web type plumbing.
5. **Task 3 RED:** `916b2a21` (test): failing lifecycle and moderation cases (15 failing on 403 and on the absent log rows).
6. **Task 3 GREEN:** `45b42831` (feat): owner predicates, routes, archived list, moderation rows.

**Plan metadata:** this SUMMARY is committed separately. STATE.md and ROADMAP.md were not touched. Nothing was pushed and no hosted project was touched.

## Decisions Made

A2, A6 and A8 are embodied as listed under `key-decisions`; so are the four decisions beyond the plan's text (kind in the ownership predicate, the creator's allowance on reactivation, the includeCommunity flag, and the Escopo branch staying dead).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] rede-lab has `communities` and `stories` OFF in the seed**
- **Found during:** Task 1 RED (first run answered 404 `MODULE_DISABLED`, not 403)
- **Issue:** the plan assumes the tracer runs on rede-lab with `social` on; the seed leaves `communities` and `stories` off there.
- **Fix:** `setup.ts` `ToggleableInTests` gains `communities` and `stories`, with `withCommunitiesEnabled` and `withStoriesEnabled`; the new suites enable them in `beforeAll` and restore them in `afterAll`. (`setup.ts` is not in the plan's file list.)
- **Commit:** `f9437232`

**2. [Rule 3 - Blocking] Three module README drift tests were red**
- **Found during:** Task 1 verify (`pnpm --filter @rede-social/api test`)
- **Issue:** `module-readmes.test.ts` failed for `communities` (plan 03's `social-gate` import) and `stories` (plan 04's `social-gate` import), both left by the schema plans, and for `feed` (my new `action-gate` import).
- **Fix:** the three READMEs list the kernel imports; Task 2 and 3 added `member-policy`, `safety/limits` and `moderation/log` to the communities README.
- **Commits:** `d14a02ca`, `2afb6d9d`, `45b42831`

**3. [Rule 3 - Blocking] Two existing tests pinned the removed refusal**
- **Found during:** Task 1
- **Issue:** `member-stamp.test.ts` and `social-media.test.ts` (case 2) asserted `member_no_community` before any lookup.
- **Fix:** rewritten to the new contract (the lane is opened; unknown id is 404, an organization community is 403, nothing written). The issue word stays in `FEED_MEMBER_ISSUES` and is marked historical.
- **Commit:** `d14a02ca`

**4. [Rule 1 - Plan text inaccurate] No visibility predicate was added to the community page**
- **Issue:** the plan says the community page's `p.visibility = 'tenant'` becomes `in ('tenant','community')`. `listCommunityFeed` carries no visibility predicate at all, and the shape check already guarantees that a post with a community id is `'tenant'` or `'community'`.
- **Fix:** none needed; a docblock records it. Adding a term would have changed the plan the community index serves.

**5. [Rule 1 - Bug avoided] `memberPostVisible` needed an `includeCommunity` flag**
- **Issue:** the plan's literal change (the member clause becomes `p.visibility = 'followers' and ...`) would have made a community post a 404 in `getPost`, and made likes and comments on it fail in `assertPostInteractive`, both of which share the fragment.
- **Fix:** the list lanes (Reels Todos, Explorar) use the strict form; `getPost` and `assertPostInteractive` pass `includeCommunity = true`, which adds `or p.visibility = 'community'` (readable with `social` on or off, as the RLS gate already allows).
- **Commit:** `d14a02ca`

**6. [Rule 2 - Stricter than the plan] Ownership includes `kind = 'member'`; branch 1 requires a member caller**
- **Issue:** `created_by_user_id = ctx.userId` alone lets an admin demoted to member regain an organization community through `manage_own`, and lets a creator whose role became admin pass branch 1 into an RLS 42501 that is only mapped for members.
- **Fix:** both terms added, in `assertMayWriteCommunity` and `resolveCommunityTarget`.
- **Commits:** `d14a02ca`, `45b42831`

**7. [Rule 1 - Plan text inaccurate] EP-22: `PATCH {}` is 200 and inert, not 400**
- **Found during:** Task 3 RED (a throwaway probe against the real route)
- **Issue:** the plan says an empty object answers 400 "as today". Today an empty JSON object is a 200 that writes nothing and moves nothing (the no-op PATCH rule); the 400 cases are no JSON body and a blank name (`name_required`).
- **Fix:** behaviour kept (changing it would break the inert-PATCH contract); the test asserts the real behaviour and the two real 400s.

**8. [Rule 3 - Blocking] Web type plumbing the contract changes forced**
- **Found during:** Task 2 (`apps/web` typecheck)
- **Issue:** `socialSettingsAnswerSchema` and `SOCIAL_SETTINGS_DEFAULTS` gained `communities`, and `FeedAudience` gained `'community'`, which broke five web sites beyond the two moderation maps owned by plan 10-11.
- **Fix:** `lib/platform.ts` default settings, `lib/social-limits.ts` takes `Pick<SocialSettings, 'media'>`, `SocialLimitsSheet.test.tsx` fixture, `PostCard.tsx` audience type, and `postAdminLabel` returns no mark for `'community'` (a community post is a member's, never the Administrador's). Web typecheck is back to exactly the two expected errors (`ModerationLogRow.tsx`, `moderation-view.ts`), and the affected web unit tests pass (64).
- **Commit:** `2afb6d9d`

**9. [Rule 3 - Blocking] Limit cases and fixtures**
- The default allowance of 3 made the create-rule cases (many creations by one member) hit `limit_reached`; those describes now sweep between cases, and a top-level `beforeEach` resets `communityCreateLimiter`. The moderation EP-37 listing scopes by a per-run unique name because the log is append-only.

**Total deviations:** 9 (Rule 1 x3, Rule 2 x1, Rule 3 x5). **Impact:** no scope change; items 4, 5 and 7 correct plan text that did not match the code, item 6 tightens D-706.

## Issues Encountered

- A throwaway probe request (`PATCH {}` as a demo admin) healed a dangling seed cover on a local demo community; the local database was reset and seeded afterwards, so nothing carried over.
- `gsd_run check tdd-red-evidence` was not used (Vitest emits no TAP): RED is evidenced per commit above. The `community-action-gate` unit test fails on import before the module exists, as any new-module test must.
- The flaky pin in plan 03's `232-feed-community-audience.sql` test 56 did not recur.
- `pnpm db:two` and `db:migrate-all --dry-run` were not run (no migration in this plan).

## User Setup Required

None. The local database was reset and seeded (Igor's word of 2026-11-11, local only) and is left clean after the final integration run.

## Next Phase Readiness

Notes for the plans after this one:

- **Plan 07 (stories):** the registry now composes `stories.story.publish` for members (with `social` and `stories` on). The story service does not stamp `stories.visibility` yet, so a member's `POST /v1/stories` reaches the insert gate with the default `'tenant'` and is refused by RLS; until plan 07 stamps `'followers'` and maps the member 42501 to 403, that request answers 500 instead of 403. Nothing is deployed. `storyPublishLimiter` is declared and unused.
- **Plan 06 (reads):** `reorderCommunities` still needs `kind = 'organization'` (Pitfall 3); `toCommunity` projects neither `kind` nor the creator (the write paths select them through the projection's `extra` column only, and `CommunitySummary` is unchanged); the community page, Início, Explorar and Reels Todos are already correct for the `'community'` audience.
- **Plan 12 (web):** `FeedList` still sets `memberPost` only for `'followers'`, so the author's delete wording for a member's community post is the organization one until the UI plan decides; the Administrador mark is already suppressed for `'community'`. The new `limit_reached` word and the API-first deploy order matter: an older web parsing the strict settings answer falls back to default limits in the platform sheet (cosmetic) until the web deploys.
- **Moderation of posts in a member community** is not part of this plan (D-711 logs community archive and removal; `toPost` still emits `removal: 'moderation'` for `'followers'` posts only).
- **OQ-3 residual (unchanged):** the data records no actor for an archive, so a creator can reactivate a community a moderator archived; the moderator's remedy is delete.

## Known Stubs

None added. `app.community_action_allowed` (plan 03) remains the intentional constant-false Escopo seam; branch 3 of `resolveCommunityTarget` calls it and is never taken in Phase 10.

## Threat Flags

None beyond the plan's threat model. Mitigations in place: T-10-14 (owner seam and predicates, 403 versus 404, positive controls), T-10-15 (`.strict()` bodies, stamped kind and creator, RLS gates), T-10-16 (advisory lock, reactivation check, limiter, parallel test), T-10-17 (log in the same transaction, forced-failure rollback test), T-10-18 (SQL gate plus 42501 to 403 for members only, EP-41), T-10-19 (no creator field is projected).

## Self-Check: PASSED

- FOUND: `packages/core/server/communities/action-gate.ts`, `packages/core/server/communities/member-policy.ts`, `packages/core/tests/community-action-gate.test.ts`, `packages/core/tests/member-community-policy.test.ts`, `apps/api/tests/integration/member-communities.test.ts` (`10 tracer`, `10 limit`, `10 lifecycle`), `apps/api/tests/integration/moderation-member-content.test.ts`
- FOUND commits: `f9437232`, `d14a02ca`, `13ef20f7`, `2afb6d9d`, `916b2a21`, `45b42831`
- Acceptance greps: `manage_own` in `registry.ts` and `module.ts`; the literal `requirePermission('communities.community.manage', 'communities.community.create')` and the `manage`/`manage_own` pair in `routes.ts`; `member_no_community` count 0 in the feed service; `hashtextextended` and `limit_reached` present; `setMemberCommunityPolicy`, `communityCreateLimiter`, `storyPublishLimiter`, `recordModerationAction`, `community_removed` present; `communityActionAllowed` referenced only by the feed service
- `commits: 6` measured with `git rev-list --count de79eb27..HEAD` before this SUMMARY commit; no `Co-Authored-By` trailer in any commit of the plan
