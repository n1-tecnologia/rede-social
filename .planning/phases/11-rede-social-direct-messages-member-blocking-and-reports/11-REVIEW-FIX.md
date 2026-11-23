---
phase: 11
fixed_at: 2026-11-23T21:30:00Z
review_path: .planning/phases/11-rede-social-direct-messages-member-blocking-and-reports/11-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-11-23
**Source review:** .planning/phases/11-rede-social-direct-messages-member-blocking-and-reports/11-REVIEW.md
**Iteration:** 1

**Scope (owner decision 2026-11-23):** only WR-03 and WR-05. WR-01, WR-02, WR-04 and all IN-xx are accepted risks (AR-11-01, AR-11-03, AR-11-02) and were not touched. No migration was needed.

**Summary:**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-05: Unblocking is throttled by the same 60-per-hour limiter as blocking

**Status:** fixed (the smaller option: no limiter on either unblock route)
**Commit:** 1eeda641
**Files modified:** `apps/api/src/routes/safety.ts`, `packages/core/server/safety/limits.ts` (comment only), `apps/api/tests/integration/block-by-membership.test.ts`
**Applied fix:** `DELETE /v1/blocks/members/{membershipId}` no longer consumes `blockLimiter` (its 429 response doc is gone, and the 429 doc of `POST /v1/blocks/members/{membershipId}` now says "more than 60 blocks"). `DELETE /v1/blocks/{userId}` already had no limiter, so both unblock routes now behave the same. No new limiter was added.
**Test:** test 4 of `block-by-membership.test.ts` (it pinned the old behavior) now spends the limiter with 60 block attempts, checks that the 61st block is 429, then lifts blocks through both unblock routes (200 `changed: true`), repeats them (200 `changed: false`) and checks that blocking is still 429. It fails against the old route (expected 429 to be 200).

### WR-03: The idempotent voice short-circuit can answer success for a different conversation

**Status:** fixed (logic change, so: requires human verification)
**Commit:** 5306e214
**Files modified:** `packages/modules/chat/server/direct.ts`, `apps/api/tests/integration/direct-chat-voice.test.ts`
**Applied fix:** new `storedDirectVoiceFor` in `direct.ts`. When the caller already has a message for the take, it resolves the named recipient and the pair's conversation, and answers the stored message (`created: false`) only when that conversation is the stored one. Anything else, including a recipient that no longer resolves (staff, own membership, removed, administrator-blocked, unknown) and a pair the database closed, is the one `400 VALIDATION_FAILED { chat: 'voice_invalid' }`, so every refusal has the same body. Both the first read in `sendDirectVoiceOnce` and the re-read after the `23505` single-use index loss use it. A take with no stored message follows the old path unchanged (`assertVoiceUsable` before the target and pair lookup, then the limiter, open and insert), so refusals for the asset still never reveal a block (T-11-27).
**Behavior to know:** for a take that already has a stored message, the pair is looked at before `assertVoiceUsable`. That is safe because the stored message proves the caller owns the take, and every failure on that branch is the same `voice_invalid` body. One consequence: a retry of a stored take to a pair that was blocked or closed since is now 400 `voice_invalid` instead of the old 201 (it reads as "no conversation" for the caller). Say so if you would rather have `direct_closed` (409) there.
**Web pane:** `DirectThreadPane.adoptSent` takes the `conversationId` of the answer. The legitimate retry (same recipient, same take) still answers 201 `created: false` with the pair's conversation id (asserted in the test), and the wrong-recipient case now reaches the pane as the existing `voice_invalid` refusal, never a foreign conversation id. No web file was changed.
**Test:** new test `3b` in `direct-chat-voice.test.ts`: a take stored in A-to-B is refused for C, for an unknown membership and for A's own membership (all byte-equal to the refusal of an unknown media id), nothing is delivered (C pair has 0 rows, the take has one message, no `chat.message_sent` event), the same-recipient retry is still 201 `created: false` with the same message and conversation ids, and a take stored in A's support case is refused for a direct recipient with no direct row created. It fails against the old code (expected 201 to be 400).

## What ran

Executed in the main checkout on `master` (not an isolated worktree): the task required running typecheck and integration tests against the local stack, and a hand-made worktree has no `node_modules`. No push, no reset or reseed, nothing under `supabase` was run, `.env.local` was not read. Only path-scoped `git add` was used; no trailers.

- `pnpm typecheck` in `apps/api` and `packages/modules/chat`: clean (after each finding).
- `biome check` on every touched file: clean.
- Unit tests: `packages/modules/chat` 332 passed; `apps/api` 146 passed.
- Integration (local Supabase stack and ffmpeg were up), run directly with vitest from `apps/api`: `tests/integration/block-by-membership.test.ts` 9/9 passed; `tests/integration/direct-chat-voice.test.ts` 6/6 passed (5 existing plus new 3b). Each new test was also run against the pre-fix code and failed there.
- Not run: the other direct-chat integration files, `apps/web` tests, pgTAP (no SQL changed).

---

_Fixed: 2026-11-23_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
