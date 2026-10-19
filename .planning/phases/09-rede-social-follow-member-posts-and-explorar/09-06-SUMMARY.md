---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 06
subsystem: api
tags: [social, media, limits, authoring-rules, duration, platform-settings, D-473, D-474]

requires:
  - phase: 09-03
    provides: "the member stamp (visibility followers), the restrictive insert policy reading app.social_enabled(), createPost/updatePost with the audience from the role"
  - phase: 09-05
    provides: "the shared interaction gate and the playback gate, follow_required, app.media_asset_hidden with the social rule"
provides:
  - "socialSettingsSchema (tolerant read with prefault defaults), socialSettingsPatchSchema (.strict(), partial), socialSettingsAnswerSchema, SOCIAL_SETTINGS_DEFAULTS and the four caps taken from the admin limits (SOCIAL_MAX_PHOTO_BYTES, SOCIAL_MAX_VIDEO_BYTES, SOCIAL_MAX_VIDEO_SECONDS, SOCIAL_MAX_PHOTOS_PER_POST)"
  - "kernel seam packages/core/server/media/member-policy.ts (MemberMediaPolicy, setMemberMediaPolicy, memberMediaPolicyFor), filled by apps/api/src/modules/registry.ts only while social is effective"
  - "GET and PUT /v1/platform/tenants/{id}/modules/social/settings in the super_admin lane, merged key by key into the stored blob (patchModuleSettings, readModuleSettings, mergeSettingsPatch in packages/core/server/platform/modules.ts)"
  - "startUpload: a member post photo is held to min(admin cap, photoMaxBytes); a member post video starts only when video.enabled, with the byte cap min(admin cap, video.maxBytes) and the duration cap snapshotted on the asset"
  - "media_assets.duration_cap_seconds (nullable, expand-only, CHECK > 0), read by applyReady as coalesce(duration_cap_seconds, static cap) with the strict > comparison"
  - "completeUpload re-judges a member post photo against the tenant cap (declare-small-upload-large is refused and the object removed)"
  - "member sub-budget: MEDIA_MEMBER_SHARE_OF_CEILING = 0.5 over member-owned post uploads, in packages/core/server/media/member-share.ts (FLAGGED FOR THE USER, removable)"
  - "FEED_MEMBER_ISSUES (member_no_attachments, member_no_community, member_video_off) as details.member; memberRules, validateAssets(memberOwnerId) and the 42501-to-403 mapping in createPost/updatePost"
affects: [09-07, 09-08, 09-09, 09-12, 09-13]

actuals:
  tokens: 30400
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "a kernel seam filled by the app registry (setPermissionResolver again): the media broker asks memberMediaPolicyFor(ctx), null means no member allowance"
    - "settings written by key-wise merge under a row lock, never by replacing the blob; the nesting is why a bare jsonb || would be wrong"
    - "a cap snapshotted on the row at start and read with coalesce at the later judgment, so limits apply to new uploads only"
    - "a separate closed refusal set (details.member) so no existing exhaustive web switch changes before the composer plan"

key-files:
  created:
    - packages/core/server/media/member-policy.ts
    - packages/core/server/media/member-share.ts
    - packages/core/tests/member-media-policy.test.ts
    - packages/core/tests/module-settings-merge.test.ts
    - apps/api/tests/integration/social-media.test.ts
    - supabase/migrations/20261019223247_media_duration_cap.sql
    - supabase/migrations/meta/20261019223247_snapshot.json
  modified:
    - packages/modules/social/contracts/index.ts
    - packages/modules/social/tests/contracts.test.ts
    - packages/core/server/media/limits.ts
    - packages/core/server/media/service.ts
    - packages/core/server/media/video/event-job.ts
    - packages/core/server/platform/modules.ts
    - packages/core/db/schema/media-assets.ts
    - apps/api/src/modules/registry.ts
    - apps/api/src/routes/platform/tenants.ts
    - apps/api/tests/isolation-inventory.ts
    - apps/api/tests/unit/registry.test.ts
    - apps/api/tests/integration/media.test.ts
    - apps/api/tests/integration/feed-social.test.ts
    - packages/modules/feed/contracts/index.ts
    - packages/modules/feed/server/service.ts
    - packages/modules/feed/tests/contracts.test.ts
    - packages/modules/feed/tests/member-stamp.test.ts
    - packages/modules/feed/README.md
    - supabase/migrations/meta/_journal.json

key-decisions:
  - "Planning decision 1 (kernel seam): memberMediaPolicyFor(ctx) in the kernel, setMemberMediaPolicy at import in the registry; null when social is not effective"
  - "Planning decision 2 (separate refusal set): FEED_MEMBER_ISSUES carried as details.member; FEED_MEDIA_ISSUES and FEED_COMMUNITY_ISSUES unchanged, apps/web typecheck clean"
  - "Planning decision 3 (sub-budget): member-owned post uploads draw from floor(0.5 * ceiling) of each pool, bytes with the same strict > as the whole-ceiling check, seconds with >=; avatars and admin uploads never count"
  - "Planning decision 4 (merge, never replace): the settings write merges the patch key by key under a row lock and writes settings || <changed top-level keys>"
  - "Planning decision 5 (42501 for members only): a member insert refused by the social policy inside the flags-cache window is 403 FORBIDDEN; any other 42501 stays a 500"
  - "Planning decision 6 (bytes at start, duration at ready): a member video is judged by declared size at start; the provider reports no byte count at ready, so duration is the authoritative cost control"
  - "GET on a tenant with no social row answers the defaults (the panel can render the sheet before the module is on); an unknown tenant and PUT on a tenant with no social row are the bare 404"
  - "memberRules runs before the transaction opens on create (stronger than the plan's 'top of the transaction'): a refused member costs no lane, no asset read and no community read"

patterns-established:
  - "Defaults for nested settings use zod 4 prefault({}) at each level so an empty blob parses to the full defaults"
  - "A seam test re-imports the module (vi.resetModules) because the resolver is module state"

requirements-completed: [SOCIAL-03, SOCIAL-05, SOCIAL-02, SOCIAL-10]

coverage:
  - id: D1
    description: "Tracer: a super_admin lowers a tenant's member photo cap with PUT .../modules/social/settings; a lab member's 2 MiB post photo is then 413 too_large with maxBytes 1048576, a 500 KiB one and one of exactly the cap are accepted, one byte over is refused, the lab admin's 2 MiB photo and a rede-demo member's are unaffected, and a tenant admin or member calling the platform routes gets 403"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 tracer (11 cases)"
        status: pass
      - kind: unit
        ref: "packages/modules/social/tests/contracts.test.ts#socialSettingsSchema and socialSettingsPatchSchema; packages/core/tests/member-media-policy.test.ts (3 cases); apps/api/tests/unit/registry.test.ts#19"
        status: pass
    human_judgment: false
  - id: D2
    description: "Settings contract and platform edit: defaults 5 MiB x 4 photos, video off 60 s and 100 MiB; caps equal the admin limits; out-of-range, fractional, mistyped and unknown values are 400 VALIDATION_FAILED and write nothing; a partial patch merges into the stored blob (siblings and stray keys survive), saving twice is identical; a malformed stored blob reads as the defaults on GET and in the broker; unknown tenant and a tenant with no social row are the bare 404"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 tracer 8, 9, 10, 11"
        status: pass
      - kind: unit
        ref: "packages/core/tests/module-settings-merge.test.ts (5 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Member video: refused 403 with no asset row while video is off, while social is off, for story and lesson purposes and for support; allowed for a post video when the tenant enables it, with the byte cap the lower of the admin cap and video.maxBytes and the duration cap snapshotted on the asset"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 video 1, 2, 3, 4"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/media.test.ts (demo-member video refusal unchanged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Duration is judged at ready against the snapshot with a strict greater-than: exactly the cap is ready, one second more is rejected with duration_too_long and the provider asset deleted; lowering the cap after the start does not change that asset and a new start takes the new cap; a replayed or later ready event does not re-judge; two simultaneous starts both pass"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 video 5, 6, 7, 8; apps/api/tests/integration/mux-webhook.test.ts (unchanged, green)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Completion re-judge and idempotency: a member photo declared small and uploaded over the tenant cap is rejected too_large at complete and the object removed; complete twice returns the same asset and enqueues one derive job"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 video 9, 10"
        status: pass
    human_judgment: false
  - id: D6
    description: "Member sub-budget: member-owned post photos draw from half the 800 MiB ceiling and post videos from half the 3 h ceiling; the start that lands exactly on the half is accepted, the next is 413 quota_exceeded; an avatar of the member is not counted; the admin's start is accepted at the same moment"
    requirement: SOCIAL-05
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 video 11, 12"
        status: pass
    human_judgment: true
    rationale: "The 0.5 share is a planner default beyond the written decisions, flagged for the user; the tests prove it does what it says, not that half is the right number."
  - id: D7
    description: "Limits apply to new uploads only: with video turned off and every cap narrowed, a member video post stays in the follower's Explorar and its playback tokens are still minted"
    requirement: SOCIAL-10
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 video 13"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-473 authoring rules through the real POST and PATCH: attachments are member_no_attachments and a community is member_no_community before any asset or community lookup (a random id is not a 404); video off is member_video_off; five images against four is too_many_images, four publish; a caption at FEED_MAX_CAPTION publishes and one more is refused; another member's or the admin's asset, and a processing or rejected video, are asset_not_usable; an edit re-sending the existing video passes with video off and a new video does not; the admin path (attachment plus community) publishes unchanged"
    requirement: SOCIAL-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 rules 1-8; feed-social.test.ts#09-06 member authoring rules leave a text post alone"
        status: pass
      - kind: unit
        ref: "packages/modules/feed/tests/member-stamp.test.ts#createPost member authoring rules (6 cases); packages/modules/feed/tests/contracts.test.ts#FEED_MEMBER_ISSUES (3 cases)"
        status: pass
    human_judgment: false
  - id: D9
    description: "EP-08: with social switched off in the database while the flags cache still holds the old permission, a member's POST /v1/feed/posts is 403 FORBIDDEN and writes no row; after the cache is invalidated the permission guard answers 403"
    requirement: SOCIAL-02
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/social-media.test.ts#09 rules 9"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-10-19
plan_head_before: 343635afb844e802940a6e0912e623fe3f3fa052
commits: 6
status: complete
---

# Phase 9 Plan 06: Member media limits, member video and the member authoring rules Summary

**A super_admin sets each tenant's member photo cap, photo count and (off by default) member video through a key-wise-merged settings route; the media broker holds member photos to the lower of the admin cap and the tenant cap at start and at complete, lets a member start a post video only where allowed with its duration cap snapshotted on the asset and judged at the provider's ready event, a member flood is bounded to half of each tenant pool, and a member post cannot carry a PDF, a community, a video the tenant does not allow, a foreign asset or a video that is not ready.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-10-19T22:24:37Z
- **Completed:** 2026-10-19T22:45Z (approximate; this SUMMARY and the tracking commit follow)
- **Tasks:** 3 (one tracer, TDD; one [BLOCKING schema], TDD; one TDD)
- **Files modified:** 26 including one generated drizzle snapshot (9952 lines)

## Accomplishments

- **Tracer (Task 1).** On rede-lab (`social` on) the super_admin `PUT /v1/platform/tenants/{lab}/modules/social/settings { media: { photoMaxBytes: 1048576 } }` answers 200 with the effective settings; a lab member's 2 MiB `post` photo is then 413 `VALIDATION_FAILED` with `details.media = 'too_large'` and `maxBytes = 1048576`, a 500 KiB one and exactly 1 MiB are 201, 1 MiB + 1 is 413, the lab admin's 2 MiB photo and a rede-demo member's are 201, and a lab member or admin calling either platform route is 403 with nothing moved. The registry fills the kernel seam only while `social` is effective; a malformed stored blob reads as the defaults (5 MiB) on GET and in the broker.
- **Member video, the snapshot and the sub-budget (Task 2).** `media_assets.duration_cap_seconds` is stored at start (60 by default, the tenant's value otherwise) and `applyReady` judges `coalesce(duration_cap_seconds, static cap)` with the strict `>`; a video of exactly 60 s is `ready`, 61 s is `rejected` (`duration_too_long`, provider asset deleted), lowering the cap to 30 s after the start does not change that asset and a new start stores 30. Video start is 403 (no row) with video off, with `social` off, for `story`/`lesson` and for support. `completeUpload` re-judges a member photo against the tenant cap. Member `post` uploads draw from half of each ceiling.
- **Authoring rules (Task 3).** Through the real routes: attachments and a community are 400 with `details.member` before any lookup, video off is `member_video_off`, five images against four is `too_many_images`, another member's or the admin's asset and a `processing`/`rejected` member video are `asset_not_usable`, an edit re-sending the post's own video passes after video is turned off, the admin path is unchanged, and `social` switched off inside the cache window is 403 `FORBIDDEN` with no row.

## Task Commits

1. **Task 1 (tracer, TDD): the settings contract, the seam, the registry composition, the platform routes and startUpload**
   - RED: `ff6e05cd` (test)
   - GREEN: `6334b2fb` (feat)
2. **Task 2 (TDD, [BLOCKING schema]): member video, the duration snapshot, the completion re-judge and the member sub-budget**
   - RED: `4d77a39f` (test)
   - GREEN: `2202233c` (feat)
3. **Task 3 (TDD): the member authoring rules in createPost and updatePost**
   - RED: `e48a94cf` (test)
   - GREEN: `c1d511a0` (feat)

**Plan metadata:** committed separately (docs: complete plan, then state and roadmap).

## TDD Gate Compliance

All three tasks: `test(09-06)` precedes `feat(09-06)` (`ff6e05cd` then `6334b2fb`, `4d77a39f` then `2202233c`, `e48a94cf` then `c1d511a0`). No REFACTOR commit. `workflow.tdd_mode` is not enabled in `.planning/config.json`, so `check tdd-red-evidence` was not run (it parses node TAP and Vitest never emits it); the real runs are quoted instead.

RED evidence (real Vitest runs, nothing fabricated):
- Task 1, integration: `vitest run tests/integration/social-media.test.ts -t "09 tracer"` against the previous code: `Tests 9 failed | 2 passed (11)`. Failures on the planned behavior: the PUT/GET routes answered `expected 404 to be 200`, the member's 2 MiB photo `expected 201 to be 413`. The two passing cases are the 403 refusals (the platform guard already covers every `/v1/platform/*` path) and the unaffected rede-demo member. Unit half: `module-social` `contracts.test.ts` 8 failed with `TypeError: Cannot read properties of undefined (reading 'safeParse')` and `member-media-policy.test.ts` 3 failed to import the missing seam; those are missing-export failures, weaker than the integration RED, which is the genuine one.
- Task 2: `-t "09 video"`: `Tests 9 failed | 4 passed | 11 skipped (24)`. Failures: `expected 403 to be 201` (member video start), `expected 403 to be 413`, `expected 201 to be 413` (sub-budget), `expected 200 to be 400` (complete over the tenant cap). The four passes (video off, social off, replay no-op, "limits apply to new uploads only") characterize behavior that already held.
- Task 3: `-t "09 rules"`: `Tests 8 failed | 1 passed | 24 skipped (33)`; failures `expected undefined to be 'member_no_attachments'`, `expected 404 to be 400` (community looked up), `expected 201 to be 400` (video, five images, foreign and unready assets) and `expected 500 to be 403` (EP-08: the raw 42501 surfaced as a 500, logged as `new row violates row-level security policy "feed_posts_social_insert_gate"`). The one pass is the admin path. Unit: `member-stamp.test.ts` 5 of 6 new cases failed on assertions (the sixth, the admin-path guard, passes by design), `contracts.test.ts` 2 failed with `FEED_MEMBER_ISSUES is not iterable`. The module-feed `typecheck` fails in the RED commit on the missing `FEED_MEMBER_ISSUES` export and is green in GREEN.

## Files Created/Modified

- `packages/modules/social/contracts/index.ts` - the settings schemas, defaults and the four caps (taken from `MEDIA_LIMITS`)
- `packages/core/server/media/member-policy.ts` - the kernel seam (MOD-02)
- `packages/core/server/media/member-share.ts` - the two sub-budget sums (removable)
- `packages/core/server/media/limits.ts` - `MEDIA_MEMBER_SHARE_OF_CEILING`
- `packages/core/server/media/service.ts` - member photo cap, member video start, snapshot, complete re-judge, sub-budget blocks
- `packages/core/server/media/video/event-job.ts` - `durationCapSeconds` through `Resolved`/`resolveAsset`/`applyReady`
- `packages/core/server/platform/modules.ts` - `mergeSettingsPatch`, `readModuleSettings`, `patchModuleSettings`
- `packages/core/db/schema/media-assets.ts` + migration `20261019223247_media_duration_cap.sql` (+ journal, snapshot) - one nullable column and one CHECK
- `apps/api/src/modules/registry.ts` - `setMemberMediaPolicy` composition; `apps/api/src/routes/platform/tenants.ts` - the two routes; `apps/api/tests/isolation-inventory.ts` - both entries under `PLATFORM_LANE`
- `packages/modules/feed/contracts/index.ts` - `FEED_MEMBER_ISSUES`; `packages/modules/feed/server/service.ts` - `memberRules`, `isInsufficientPrivilege`, `validateAssets(memberOwnerId)`, `EditableRow.video_asset_id`; `packages/modules/feed/README.md` - the kernel dependency line
- Tests: `social-media.test.ts` (new: 09 tracer 11, 09 video 13, 09 rules 9), `member-media-policy.test.ts`, `module-settings-merge.test.ts`, `registry.test.ts` case 19, `contracts.test.ts` (social and feed), `member-stamp.test.ts`, `feed-social.test.ts` (1 case), `media.test.ts` (comment only)

## Decisions Made

Planning decisions 1-6 were followed as written (see `key-decisions`). Beyond them: GET on a tenant with no `social` row answers the defaults (the plan's task text said defaults, the truth list said bare 404; the unknown tenant and the PUT on a tenant with no row are the 404), and `memberRules` runs before the transaction on create.

### The member sub-budget, flagged for the user (RESEARCH Open Question 2)

`MEDIA_MEMBER_SHARE_OF_CEILING = 0.5` is a default I chose, not a written decision. A member's `post` photos can draw at most `floor(0.5 * 800 MiB)` = 400 MiB and their `post` videos at most 5400 s of the 10800 s (3 h) pool; past it a member's start is 413 `quota_exceeded`, an admin's start is untouched until the whole ceiling. "Member-owned" is the uploader's CURRENT membership role. To drop it, remove:

1. `packages/core/server/media/member-share.ts` (whole file);
2. `MEDIA_MEMBER_SHARE_OF_CEILING` in `packages/core/server/media/limits.ts` (line 69 and its docblock);
3. in `packages/core/server/media/service.ts`: the import of `MEDIA_MEMBER_SHARE_OF_CEILING` (line 45), the import of `./member-share` (line 54), the seconds block (comment starting `member sub-budget`, about lines 254-264, inside `startVideoUpload`) and the bytes block (about lines 478-488, inside `startUpload`);
4. in `apps/api/tests/integration/social-media.test.ts`: cases `11.` and `12.` (`EP-17 sub-budget`) and the helpers only they use (`seededAssetIds`, `MEMBER_SHARE`, `memberPostBytes`, `memberPostSeconds`, `seedMemberAsset` and the `afterEach` loop that deletes `seededAssetIds`).

Nothing else references it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `settings = settings || patch` is a shallow concatenation**
- **Found during:** Task 1 (designing the platform write; pinned by tracer case 9)
- **Issue:** patching `{ media: { video: { enabled: true } } }` with a bare `jsonb ||` replaces the whole `media` object and silently drops the tenant's `photoMaxBytes` and `photosPerPost`; the plan's own EP-16 truth ("does not touch other keys of the blob") needs the nesting honoured.
- **Fix:** `mergeSettingsPatch` merges nested plain objects key by key and returns only the top-level keys the patch names; `patchModuleSettings` locks the row (`for update`) and writes `settings || <those keys>`, so a stray key of another phase and the legacy feed blob stay untouched and two admins editing different keys cannot lose each other's write.
- **Files modified:** `packages/core/server/platform/modules.ts`
- **Verification:** `module-settings-merge.test.ts` (5 cases), tracer case 9 (stray key and siblings survive, second save identical)
- **Committed in:** `6334b2fb`

**2. [Rule 1 - Bug, in my own test] `writeSettings` double-encoded the jsonb**
- **Found during:** Task 1 GREEN run (case 9: `expected [ …(2) ] to deeply equal`)
- **Issue:** `${JSON.stringify(x)}::jsonb` through postgres.js stored a JSON string scalar, and the suite's `afterAll` restore wrote the lab `social` row back as the string `"{}"`. The local lab row was left corrupt for one run.
- **Fix:** `adminSql.json(settings)`; the corrupt local row was repaired with one `update ... set settings = '{}'::jsonb` and the suite re-run (11 passed). The next `db:reset` replaced it anyway.
- **Files modified:** `apps/api/tests/integration/social-media.test.ts`
- **Committed in:** `6334b2fb`

**3. [Rule 3 - Blocking] The feed README drift test lists kernel imports**
- **Found during:** Task 3 (`pnpm --filter @rede-social/api test`, `module-readmes.test.ts` case 2)
- **Issue:** the feed module now imports `@rede-social/core/server/media/member-policy`.
- **Fix:** one line in the README's kernel dependency list.
- **Files modified:** `packages/modules/feed/README.md`
- **Committed in:** `c1d511a0`

**4. [Rule 3 - Blocking] Existing unit tests need the seam**
- **Found during:** Task 3 RED
- **Issue:** a member `createPost` now reads the policy and a null policy is 403, so the 09-03 member-stamp cases need a registered policy.
- **Fix:** `member-stamp.test.ts` mocks `@rede-social/core/server/media/member-policy` with one fixed policy and counts how many tenant-lane transactions open (zero for a member refusal).
- **Committed in:** `e48a94cf`

### Beyond the written plan

- `packages/core/tests/module-settings-merge.test.ts` is a new test file the plan does not list (the merge fix needed a database-free proof).
- The plan's behavior line "`applyReady` with a stored cap of 60 and 60 s accepts, 61 s rejects; null cap uses the static limit" is proved through the integration job handler (`09 video` 5-7, `mux-webhook.test.ts` for the null-cap path), not through a mocked unit test of `applyReady`.

---

**Total deviations:** 1 production bug found in the plan's own SQL sketch (Rule 1), 1 own-test bug (Rule 1), 2 blocking adjustments (Rule 3), 2 additions beyond the file list
**Impact on plan:** none on scope; no architectural change. The sub-budget and the merge fix are the only behavior beyond the literal text, and both are reported above.

## Issues Encountered

- A `zsh` array was needed to pass a file list to `git add` (word splitting differs from bash); the first commit attempt failed on a single concatenated pathspec and nothing was staged.
- `biome check --write` over the whole test directory reported no fixes while having reformatted the file earlier in the same command chain; no impact.

## Verification Results

- Task 1 verify: `module-social` 40 passed, `core` 450 passed, `api` unit 73 passed, typecheck and lint clean for all three, `pnpm boundaries`: "Checked 1656 files in 18 packages, no issues found". After `pnpm db:reset && pnpm db:seed`: `vitest run tests/integration/social-media.test.ts -t "09 tracer"`: `Tests 11 passed`.
- Task 2 verify: `pnpm db:generate` printed "No schema changes, nothing to migrate"; reset, seed, `pnpm supabase test db`: `Files=38, Tests=2044, Result: PASS` (unchanged, no pgTAP was added: the column has no policy); `VIDEO_PROVIDER=fake vitest run tests/integration/social-media.test.ts tests/integration/media.test.ts tests/integration/mux-webhook.test.ts`: `Test Files 3 passed, Tests 89 passed`; `core` 455 passed, typecheck and lint clean.
- Task 3 verify: `module-feed` 290 passed (22 files), typecheck and lint clean; `api` typecheck, lint, unit 73 passed; `@rede-social/web typecheck` (`next typegen && tsc --noEmit`) clean (the web's exhaustive switches did not change); `pnpm boundaries`: "Checked 1658 files in 18 packages, no issues found"; after reset and seed: `vitest run` of `social-media`, `feed-social`, `feed-media`, `feed-unfurl`, `feed-edit-delete`: `Test Files 5 passed, Tests 115 passed`. The module-feed `unfurl-guard` suites are inside the 290 and `feed-unfurl.test.ts` is inside the 115 (T-09-21).
- Acceptance greps: `socialSettingsSchema` in the social contracts, `setMemberMediaPolicy` in the registry, `memberMediaPolicyFor` in the service, `patchModuleSettings` in `modules.ts`, `grep -c "modules/social/settings" apps/api/tests/isolation-inventory.ts` prints 2, `09 tracer`/`09 video`/`09 rules` in `social-media.test.ts`, one `*_media_duration_cap.sql` sorting after `*_feed_social_media_gate.sql` with `grep -ciE "drop table|drop column|rename|alter column .* type"` printing 0, `durationCapSeconds` in `event-job.ts`, `MEDIA_MEMBER_SHARE_OF_CEILING` in `service.ts`, `FEED_MEMBER_ISSUES` in the feed contracts and `member_no_attachments` in the feed service.
- Beyond the plan: pgTAP again after the last reset (`Files=38, Tests=2044, Result: PASS`), then the full `pnpm --filter @rede-social/api test:integration` (after pgTAP, as the project memory requires): `Test Files 75 passed (75)`, `Tests 1517 passed (1517)` (1483 after plan 05).
- Not run: the Playwright e2e suite, the web Vitest suite, `turbo typecheck`/`build`, any dev-server UI, any cloud command. Nothing was pushed, `supabase db push` was not run, no Mux or Supabase cloud project was touched, and `social` was toggled only on the local seed tenants (restored in `finally`/`afterAll`).

**`db:reset` ran three times, all local, each followed by `pnpm db:seed`:** (1) Task 1's verify, (2) Task 2's verify chain (the pgTAP run followed it directly), (3) Task 3's verify. The local database is NOT reset after the final full integration run, so it carries that run's residue: run `pnpm db:reset && pnpm db:seed` before the next pgTAP run.

## Known Stubs

None. No RED commit shipped a stub: every failing test imports only symbols that exist or fails on an assertion, apart from the missing-export unit failures noted above.

## Threat Flags

None new. The only new surface is the two platform routes (T-09-30: `requireSuperAdmin` lane, 403 cases for admin and member, strict patch schema), the member video start (T-09-18, T-09-19) and the member rules (T-09-20), all inside the plan's threat model. T-09-21 (SSRF through member links) is unchanged: the unfurl guard suites are green.

## Observations for later plans (not fixed here)

- **Plan 09 (web):** the composer needs copy for `details.member` (`member_no_attachments`, `member_no_community`, `member_video_off`); `postWriteIssue` reads an unknown key as the generic refusal until then. The 201 of a member video `start` now returns the EFFECTIVE `maxBytes` (the tenant's), not the admin's, so the pick-time gate can read it from the start answer or from `GET .../modules/social/settings` via the platform sheet (plan 12).
- **Plan 12 (platform sheet):** GET answers the defaults for a tenant that has never had `social`, so the limits sheet can render before the module is enabled; PUT needs the row, so enable the module first (the toggle creates it).
- **A completed photo is re-judged against the CURRENT tenant cap:** a tenant that lowers `photoMaxBytes` between a member's `start` and `complete` makes that in-flight photo `too_large`. The signed URL carries no size, so the alternative (snapshotting a photo cap) was not in the plan; only video carries a snapshot.
- **Sub-budget granularity:** it keys on the uploader's current membership role, so promoting a member to admin moves their old uploads out of the members' share.
- **Plan 13 DEPLOY.md:** the migration `20261019223247_media_duration_cap.sql` is expand-only and applies after plan 05's; prod `supabase db push` is not part of this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 09-07. The settings contract, the seam, the platform routes, the effective member policy and the `details.member` vocabulary have their final names; the sub-budget needs the user's decision before release.

## Self-Check: PASSED

- Created files exist (`member-policy.ts`, `member-share.ts`, both core tests, `social-media.test.ts`, the migration and its snapshot): FOUND
- Commits `ff6e05cd`, `6334b2fb`, `4d77a39f`, `2202233c`, `e48a94cf`, `c1d511a0`: FOUND
- RED before GREEN for all three tasks (`git log --grep` on `^test\(0*9-0*6\)` and `^feat\(0*9-0*6\)`): confirmed
- No attribution trailer in the six commit messages: confirmed (0 matches in `343635af..HEAD`)

---
*Phase: 09-rede-social-follow-member-posts-and-explorar*
*Completed: 2026-10-19*
