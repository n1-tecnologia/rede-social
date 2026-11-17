---
phase: quick-261117-d1o
plan: 01
subsystem: media
tags: [temporary, media, video, feed, quick]
status: complete
commits: 2
plan_head_before: e609ff21181b4764e31de855022e1ee9c19c8200
key-files:
  modified:
    - packages/contracts/src/media.ts
    - packages/contracts/tests/media.test.ts
    - packages/modules/social/tests/contracts.test.ts
    - apps/web/lib/social-limits.test.ts
    - apps/web/components/platform/SocialLimitsSheet.test.tsx
    - apps/api/tests/integration/mux-webhook.test.ts
    - apps/api/tests/integration/media.test.ts
    - apps/api/tests/integration/social-media.test.ts
    - apps/web/e2e/social-platform.spec.ts
actuals:
  tasks: 2
  commits: 2
completed: 2026-11-17
---

# Quick 261117-d1o: TEMPORARY 4 GiB / 9000 s feed post video Summary

The post entry of `MEDIA_LIMITS.video` in `packages/contracts/src/media.ts` moved from 500 MiB / 300 s to 4 GiB / 9000 s (2 h 30), marked TEMPORARY in a comment that names the old values. Every test that pinned the old numbers now derives from the table, except one explicit TEMPORARY pin.

## Commits

| Task | SHA | Message |
|------|-----|---------|
| 1 | ecd30e18 | feat(quick-261117-d1o): temporarily allow a 4 GiB / 2 h 30 feed post video |
| 2 | e4042a91 | test(quick-261117-d1o): derive the integration and e2e post-video pins from the shared limits |

Neither commit has a trailer. Nothing was pushed or deployed.

## Task 1 evidence

- The explicit post pin in `packages/contracts/tests/media.test.ts` failed first against the old constant (1 failed, 14 passed, expected 4294967296 and got 524288000). The constant was changed afterwards.
- Vitest after the change:
  - `@rede-social/contracts`: 20 files, 614 tests, all passed.
  - `@rede-social/module-social`: 7 files, 67 tests, all passed.
  - `@rede-social/web` (`lib/social-limits.test.ts` and `components/platform/SocialLimitsSheet.test.tsx`): 2 files, 42 tests, all passed.
- `tsc --noEmit` exits 0 for contracts and module-social. `biome check` exits 0 on the five files.
- The old-pin gate over the three derived test files prints nothing. The positive grep on the constant finds exactly one match.

## Task 2 evidence

- `tsc --noEmit` for `@rede-social/api` exits 0. It covers the three integration files, which the api tsconfig includes. `biome check` exits 0 on the four files, including the e2e spec.
- The old-pin gate over the four files prints nothing.
- `MEDIA_LIMITS` is imported in `media.test.ts` and `social-media.test.ts`. `SOCIAL_MAX_VIDEO_SECONDS` is imported in `social-platform.spec.ts`.
- The trailer check over both commit messages prints 0.

## NOT run

- The four files edited in Task 2 were NOT executed: `apps/api/tests/integration/mux-webhook.test.ts`, `media.test.ts`, `social-media.test.ts` and `apps/web/e2e/social-platform.spec.ts`. They need the local Supabase stack or Playwright. Only type-check and lint ran on them.
- No db reset, no integration suite, no e2e, no root `pnpm test`, no turbo task and no `next build` ran.
- In `media.test.ts` the post assertion now starts a post video one byte past the post cap and expects a 413 with the post cap. That is a behavior change in that test, not a pure rename of numbers, so it is worth a real run.

## Accepted side effect (D-474)

`SOCIAL_MAX_VIDEO_BYTES` and `SOCIAL_MAX_VIDEO_SECONDS` derive from the post entry. The range a super_admin may set for MEMBER video in the platform social form is now 1 to 4096 MB and 1 to 9000 s. The defaults (60 s, 100 MiB) and every saved tenant value are unchanged.

## Limits that still bound the goal (deliberately untouched)

- The feed video budget (`MEDIA_TENANT_VIDEO_SECONDS_CEILING`, 3 h) is shared by every non-lesson video of the tenant. A 2 h video leaves about 1 h for the rest.
- The upload window (`VIDEO_UPLOAD_TTL_S`, 1 h) is unchanged. A 4 GiB upload on a slow link may not finish inside it.

## Stale doc comment left alone

`apps/web/components/media/VideoUploadField.tsx` (line ~20) still says "500 MiB / 5 min pair" for the post purpose. It is a doc comment, not UI text, and was left alone as the plan said.

## Deviations from Plan

None. The plan was executed as written. Biome reformatted one hunk in Task 1 and one in Task 2, and the diffs show only the intended hunks.

## REVERT RECIPE

1. In `packages/contracts/src/media.ts`, set the post entry of `MEDIA_LIMITS.video` back to `500 * 1024 * 1024` and `300`, and delete the TEMPORARY comment above it.
2. In `packages/contracts/tests/media.test.ts`, flip the explicit TEMPORARY post pin back to 500 MiB and 300 s.
3. Every other pin in this change derives from the table or from the social constants and needs no edit.

The change is found by `grep -rn "TEMPORARY" packages/contracts/src/media.ts`.

## Self-Check: PASSED

Both commits exist (ecd30e18, e4042a91). `git rev-list --count` from the recorded base gives 2. All nine files are committed, and only the unrelated `apps/web/e2e/chat-admin.ts` (the Phase 12.4 execution's file) remains modified in the tree.
