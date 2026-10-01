---
phase: 07-notifications-web-push-chat
fixed_at: 2026-10-01T01:50:00Z
review_path: .planning/phases/07-notifications-web-push-chat/07-REVIEW.md
iteration: 1
findings_in_scope: 21
fixed: 21
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-10-01T01:50:00Z
**Source review:** `07-REVIEW.md`. The findings are in `07-REVIEW-A-server.md`, `07-REVIEW-B-modules.md` and `07-REVIEW-C-web.md`.
**Iteration:** 1
**Scope:** critical and warning findings. The 21 info items were not in scope.

**Summary:**
- Findings in scope: 21 (2 critical, 19 warnings)
- Fixed: 21, in 19 commits. A-CR-01, A-WR-01 and B-WR-04 share one commit, and so do A-WR-02 and A-WR-03. C-CR-01 has a follow-up commit that fixes the typing of its e2e helper.
- Skipped: 0
- Partial scope inside a fix: B-WR-02 (the chat half), C-WR-06 (the `?erro=sair` sub-point) and A-CR-01 (the optional composite FK). See each entry.

## Fixed Issues

### A-CR-01: `chat_participants_access` lets a member enroll in any conversation of their tenant
### A-WR-01: `chat_messages_access` / `chat_conversations_access` are `FOR ALL`
### B-WR-04: The chat RLS write policies allow joining, rewriting or deleting from the member lane

**Files modified:** `packages/modules/chat/db/schema.ts`, `supabase/migrations/20261001004630_chat_rls_per_command.sql` (generated), `supabase/migrations/20261001004638_chat_rls_grants.sql` (custom), `supabase/migrations/meta/20261001004630_snapshot.json`, `supabase/migrations/meta/20261001004638_snapshot.json`, `supabase/migrations/meta/_journal.json`, `supabase/tests/152-chat.sql`, `supabase/tests/020-tenant-isolation.sql`, `apps/api/tests/integration/chat.test.ts`
**Commit:** ad81b72
**Applied fix:** The three `FOR ALL` policies are now one policy per command. No committed migration was edited.
- **`chat_participants`:**
  - SELECT is unchanged.
  - INSERT only lets a lane add itself, with role `member`, to a conversation it created.
  - UPDATE only covers the lane's own row. A column grant limits it to `last_read_seq` and `last_read_at`, so a member cannot move its row into another thread.
  - There is no DELETE policy. Staff get no INSERT branch, because D-225 says staff never hold participant rows.
- **`chat_messages`:**
  - SELECT is unchanged.
  - INSERT is allowed only as yourself. `author_side = 'staff'` needs a staff claim and a support thread. `author_side = 'member'` needs a participant row.
  - There is no UPDATE or DELETE, and the UPDATE privilege is revoked.
- **`chat_conversations`:**
  - SELECT is unchanged.
  - INSERT creates only your own conversation, with zero counters.
  - UPDATE is staff-only on support threads. A column grant limits it to `staff_last_read_seq`, which `markConversationRead` writes and `for update of c` needs.
  - There is no DELETE.
- `TRUNCATE` is revoked from `authenticated` on all three tables.
- **pgTAP 152 fact 8** adds 20 assertions:
  - M2's participant self-insert into M1's thread is refused.
  - Moving its own participant row into M1's thread is refused.
  - M2 cannot read M1's messages or join M1's `conv:` topic.
  - `author_side = 'staff'` from a member is refused.
  - Re-authoring or deleting a message is refused.
  - Rewinding `last_seq` is refused for a member and for staff.
  - Deleting a conversation is refused.
  - Creating a conversation with preset counters, or in another member's name, is refused.
  - Staff cannot enrol members.
  - Positive controls cover each side.
- **Test updates:**
  - pgTAP 020 now uses the updatable columns.
  - The Pitfall 4 staff-literal pin in `chat.test.ts` now reads the four new policies.
- `pnpm db:generate` reports no drift.
- Not done: the optional composite FK `(conversation_id, tenant_id)`. Every write path already pins the tenant through the policies and the definer trigger.

### C-CR-01: The chat catch-up cursor skips messages, so a reply from the other side is lost for the session

**Files modified:** `apps/web/app/(app)/suporte/ThreadPane.tsx`, `apps/web/lib/chat-cursor.ts` (new), `apps/web/lib/chat-cursor.test.ts` (new), `apps/web/e2e/chat.spec.ts`
**Commits:** 384f722, 72b890f (follow-up that fixes the typing of the e2e frame holder)
**Applied fix:** A dedicated catch-up cursor replaces "the highest seq on screen".
- Only a catch-up page moves it freely.
- An own send moves it only when its seq is exactly `cursor + 1`. A send past a gap leaves the cursor where it is and runs a catch-up.
- The catch-up dedupes by id. A replayed signal is a seq at or below the cursor.
- The read mark uses the cursor.
- **Tests:**
  - New unit tests in `lib/chat-cursor.ts` reproduce the race.
  - New e2e `chat 4b` holds the staff reply's `chat.message` frame until the member's own send has answered, then releases it. The reply must appear once, before the member's message, with no refocus or reload.
  - 4b **failed on the previous ThreadPane** ("Expected 1, Received 0") and passes with the fix on both projects.

### C-WR-04: A failed chat read mark is never retried

**Files modified:** `apps/web/app/(app)/suporte/ThreadPane.tsx`
**Commit:** 1912ba0
**Applied fix:** A non-ok answer now throws into the existing rollback, so `readSeqRef` steps back and the next refocus or append retries the mark.

### B-WR-05: ChatComposer restores the failed draft over text typed while the send was pending

**Files modified:** `packages/modules/chat/ui/ChatComposer.tsx`, `packages/modules/chat/tests/chat-composer.test.tsx`
**Commit:** 39ca346
**Applied fix:** On failure the draft goes back in front of whatever was typed meanwhile: `draft\ncurrent`, or the draft alone when the field is blank. A new unit test types during a pending send and then fails it.

### A-WR-02: One module's counter failure aborts the whole bootstrap
### A-WR-03: The counters resolver opens a second pooled connection while holding one

**Files modified:** `apps/api/src/modules/registry.ts`, `packages/core/server/modules/counters.ts`, `packages/modules/notifications/server/push/send-job.ts`, `apps/api/tests/integration/bootstrap.test.ts`
**Commit:** 47cb153
**Applied fix:**
- **A-WR-02:** each contributor runs in its own savepoint (`tx.transaction`). A failure falls back to that contributor's zeros and logs `counters.contributor_failed`. Integration test 17 swaps the chat contributor for `select 1/0`. The bootstrap and `/v1/me/counters` still answer 200, and the badge reads `count`.
- **A-WR-03:** the kernel seam is now `resolveCounters(ctx)`. The registry resolver reads the module flags first and then opens its own tenant lane, so the push badge calls it outside any transaction.

### A-WR-04: Retractions are dropped while `notifications` is disabled

**Files modified:** `packages/modules/notifications/server/sink.ts`, `packages/modules/notifications/server/fanout-job.ts`, `apps/api/tests/integration/notifications.test.ts`
**Commit:** 26f59ed
**Applied fix:**
- The sink still enqueues an event when any producer retracts on it, even with the module off.
- The fan-out job reads the flag when it runs. Sources run only while the module is enabled, and retractions always run.
- New integration test: a post is deleted while the module is off, and its rows become `{removed: true}`. The existing "publish enqueues nothing while off" test still passes.

### B-WR-03: A story comment deleted through the feed route is never retracted

**Files modified:** `packages/modules/feed/server/service.ts`, `apps/api/tests/integration/notifications.test.ts`
**Commit:** f62ac60
**Applied fix:**
- The review offered two fixes. The first one, a stories retraction on `comment.deleted`, cannot type-check: `comment.deleted` is declared only in the feed module's `EventMap`, and stories does not depend on feed.
- The second one is applied instead: `deleteComment` now only deletes post comments (`post_id is not null`). A story comment id gets the same bare 404, so story comments can only be deleted through the stories route, which emits `story.comment_deleted`. The web already uses that route.
- New integration test: the feed route answers 404 and the comment stays. The stories route deletes it and blanks the row.

### B-WR-01: A retraction can run before the fan-out it should blank commits

**Files modified:** `packages/modules/feed/server/notifications.ts`, `packages/modules/stories/server/notifications.ts`, `apps/api/tests/integration/notifications.test.ts`
**Commit:** c5e6052
**Applied fix:** These sources now lock what they read with `for share`:
- `post.published`: the post;
- `comment.liked` and `comment.replied`: the comment and the post;
- `story.published`: the story;
- `story.commented`: the comment and the story.

The soft delete's UPDATE therefore waits for the fan-out to commit. The retraction is enqueued after the delete commits, so it always sees the fan-out's rows. The target tables' policies are tenant-only, so the system lane passes the UPDATE-policy check that `FOR SHARE` needs.

New integration test: during an open fan-out lane, the soft delete hits `lock_timeout` (55P03). Once the lane commits, the delete goes through.

### B-WR-02: A queued or retried push still delivers deleted text, and the body sits in `pgboss.job`

**Files modified:** `supabase/migrations/20261001010456_notifications_push_withdrawn.sql` (custom) and its snapshot, `supabase/migrations/meta/_journal.json`, `supabase/tests/151-notifications.sql`, `packages/modules/notifications/server/push/send-job.ts`, `packages/modules/notifications/server/channels/push.ts`, `packages/modules/notifications/contracts/index.ts`, `packages/core/server/jobs/boss.ts`, `packages/modules/notifications/tests/push-channel.test.ts`, `apps/api/tests/integration/push.test.ts`
**Commit:** 7312b47
**Applied fix:**
- **New definer.** `app.notifications_withdrawn(dedupe_key, user_ids)` is hardened (`search_path ''`, tenant from the claim, `authenticated` only) and keyed on `notifications_tenant_user_dedupe_uq`. It returns true when a recipient's row under the push's dedupe key was retracted. pgTAP 151 fact 12 adds 6 assertions.
- **Send-time check.** `runPushSend` calls the definer first. If it returns true, the job logs `push.withdrawn` and sends nothing.
- **Short retention.** Push-send jobs, both the first send and retries, ask pg-boss for `deleteAfterSeconds: 300` and `retentionSeconds: 6 h` (`PUSH_SEND_JOB_KEEP`). `enqueueInTx` now passes those per-job options through.
- **Test.** New integration test: a post deleted between fan-out and send sends nothing, and the job carries the short retention.
- **Partial:** chat pushes write no notification row, so they are not re-checked. Chat has no delete path in V1. Phase 8 moderation must add a check when it introduces message deletion.

### A-WR-05: `RealtimeProvider` can re-attach to a channel that is still leaving

**Files modified:** `packages/core/ui/realtime/RealtimeProvider.tsx`, `packages/core/tests/realtime-rejoin.test.tsx` (new)
**Commit:** fba6753
**Applied fix:** `close()` stores each topic's `removeChannel` promise, and `open()` waits for it (along with the auth token) before it attaches. The new unit test uses a fake client whose leave finishes only on demand. A re-join creates no channel until the leave completes, and then a fresh channel joins.

### A-WR-06: pgTAP Realtime assertions become `skip()` when no partition exists

**Files modified:** `supabase/tests/150-realtime-authorization.sql`, `supabase/tests/152-chat.sql`, `.github/workflows/ci.yml`
**Commit:** 1ace522
**Applied fix:** The review's preferred fix was to create the partition inside the test, but that is not possible. `realtime.messages` belongs to `supabase_realtime_admin`, and the migration role gets "permission denied for schema realtime" (verified). Instead:
- the 37 `skip()` branches (32 in 150, 5 in 152; 151 had none) are now `fail()` with a named reason;
- CI waits up to 120 s for the Realtime service's partition covering today before `supabase test db`.

Locally the three files run with 0 skips: 44, 53 and 72 ok.

### A-WR-07: The bootstrap contract makes `conversationsBadge` required

**Files modified:** `packages/contracts/src/bootstrap.ts`, `packages/contracts/tests/bootstrap.test.ts` (new), `docs/DEPLOY.md`
**Commit:** 936f0b1
**Applied fix:**
- `conversationsBadge` is now `.default('count')`. A missing field reads as the kernel default, and a value outside the enum is still refused. The API still always sends it.
- The contract comment now states the rule for future additive fields.
- DEPLOY.md step 7 describes the softer failure mode and keeps the recommended deploy order.

### B-WR-06: The `users` audience publishes one Realtime message per recipient

**Files modified:** `packages/modules/notifications/server/channels/in-app.ts`, `packages/modules/notifications/tests/in-app-signals.test.ts` (new)
**Commit:** 6c870db
**Applied fix:** Above `USER_SIGNAL_FANOUT_MAX` (20) new recipients, the adapter publishes ONE `notifications.changed` on `tenant:<t>:all` instead of one message per user. Unit tests cover 20 recipients (per-user) and 21 recipients (one `all`).

### C-WR-01: Push surfaces and `/notificacoes` ignore the `notifications` module toggle

**Files modified:** `apps/web/app/(app)/layout.tsx`, `apps/web/app/(app)/configuracoes/page.tsx`, `apps/web/app/(app)/notificacoes/page.tsx`, `apps/web/e2e/push.spec.ts`
**Commit:** 6145939
**Applied fix:** When the module is off:
- LiveShell gets no VAPID key;
- Configurações renders no push row;
- `/notificacoes` calls `notFound()`, as `reels/page.tsx` does.

New e2e on rede-lab (module off): no push row, no subscription POST, and the not-found screen.

### C-WR-02: Requiring `Sec-Fetch-Site` breaks the GET BFF routes on Safari/iOS before 16.4

**Files modified:** `apps/web/lib/notifications-bff.ts`, `apps/web/app/api/realtime/token/route.ts`, `apps/web/app/api/me/counters/route.ts`, `apps/web/app/api/chat/inbox/route.ts`, `apps/web/app/api/chat/conversations/[conversationId]/messages/route.ts`, `apps/web/app/api/realtime/token/route.test.ts`
**Commit:** fbe6338
**Applied fix:** A shared `sameOriginGet` gate now covers all four routes.
- **Header present:** it must be `same-origin`.
- **Header absent:**
  - The request is refused when `Origin` is `null` or names another host.
  - With no `Origin` at all, the request moves on to the session check.
- **Why the fallback is safe:**
  - A cross-origin `fetch` always sends an `Origin`.
  - A header-less `<script>` or `<img>` request carries no `SameSite=Lax` session cookie, so it gets a 401.
  - Page script cannot read a same-origin JSON body cross-origin anyway.
- **Tests:** the route tests now cover a foreign or `null` Origin (403) and no metadata with no Origin or the same Origin (200 with the token).
- **Needs your judgement:** this changes the documented gate of the token route (T-07-12).

### C-WR-03: Notifications list paging has no generation guard, and mark-all failure discards taps

**Files modified:** `apps/web/app/(app)/notificacoes/NotificationsSurface.tsx`
**Commit:** 583619c
**Status:** fixed: requires human verification. This is a race fix with no automated test that triggers the race. The notifications e2e suite passes.
**Applied fix:**
- Every applied refresh bumps a `generation` ref. A load-more that started before the refresh drops its page.
- A failed mark-all removes only the ids its optimistic step added, and keeps any row tapped while the request was in flight.

### C-WR-05: The push state can stay on "checking" forever

**Files modified:** `apps/web/components/push/PushControls.tsx`, `apps/web/e2e/push-fake.ts`, `apps/web/e2e/push.spec.ts`
**Commit:** 45047ed
**Applied fix:** After 5 s still in `checking`, the row switches to `unsupported`. A worker that activates later still brings in the real state. The e2e push fake gains a `neverReady` option, and new e2e `push 4b` checks the fallback.

### C-WR-06: Pushes for the previous member keep arriving after a sign-out other than "Sair"

**Files modified:** `apps/web/components/push/ForgetSignedOutDevice.tsx` (new), `apps/web/app/(auth)/entrar/page.tsx`, `apps/web/app/(auth)/acesso-suspenso/page.tsx`, `apps/web/e2e/push.spec.ts`
**Commit:** 3bd9f93
**Applied fix:**
- `/entrar`, when rendered with no session (checked with `getClaims()` on the server), and `/acesso-suspenso` both mount `ForgetSignedOutDevice`.
- On mount it calls `disablePush(await pushRegistrationWithin())` and `navigator.clearAppBadge?.()`. Both are bounded and their errors are swallowed.
- New e2e `push 8c`: a signed-in visit to `/entrar` keeps the subscription, and `/entrar` after the cookies are cleared drops it.
- **Partial:** the review's side note is not addressed. When `logout()` itself fails (`?erro=sair`), push has already been turned off without telling the member.

## Verification

**Where the gates ran:** the main checkout (`<repo root>`, branch `master`), against the local Supabase stack. No review-fix worktree was created.
- `workflow.use_worktrees` is not set in `.planning/config.json`. It defaults to true, so this departs from the agent's default flow.
- The reason: a hand-rolled worktree has no `node_modules` and cannot share the single local Supabase stack, while every fix needed migrations applied plus vitest, pgTAP and Playwright runs in between. Project memory also records that execution here is always sequential with no isolation.
- Files were staged by explicit path in every commit. The developer's `locais.md` and the untracked `.claude/` and `.planning/` files were not touched.
- These results reproduce from the tree as committed.

**Final gates, run after all fixes:**
- `pnpm db:reset && pnpm db:seed`: all three new migrations applied through the Supabase CLI.
- `pnpm db:generate`: "No schema changes, nothing to migrate".
- `pnpm supabase test db`: PASS, 21 files and 731 tests (725 before these fixes).
- `pnpm lint` (Biome on 13 packages plus check-ui-literals): OK.
- `pnpm typecheck`: 14/14 successful.
- `pnpm boundaries`: no issues in 870 files across 13 packages.
- `pnpm test` (unit, 12 tasks): all passed.
- `pnpm test:integration`: 42 files, 708 tests passed.
- **Playwright e2e** (`chat.spec.ts`, `notifications.spec.ts`, `push.spec.ts`, `phase7-smoke.spec.ts`, both projects): 108 passed, 5 skipped and 1 failed.
  - The failure was `notifications lista › at 320px the mark-all label stays on one line` on mobile-chromium (measured 212 px against < 12).
  - It passed when the same specs ran just before, and it passed twice when re-run on its own.
  - No fix touches that layout, so it looks like a timing flake. It is worth watching.
  - The dev servers that Playwright started were stopped. Nothing is left listening on :3000 or :8787.

**Commits made without a passing gate:** c5e6052 (B-WR-01) and 384f722 (C-CR-01) each went in with a type error in their own new test, found by the typecheck afterwards. B-WR-01's was amended into the commit before anything was built on it. C-CR-01's was fixed in follow-up commit 72b890f.

---

_Fixed: 2026-10-01T01:50:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
