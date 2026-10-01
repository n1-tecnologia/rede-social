---
phase: 07-notifications-web-push-chat
reviewed: 2026-10-01T00:32:18Z
depth: standard
scope: "area B — packages/modules/{notifications,chat,feed,stories,events} and packages/ui (diff 80ef5b8..HEAD)"
files_reviewed: 101
files_reviewed_list:
  - packages/modules/chat/contracts/index.ts
  - packages/modules/chat/db/schema.ts
  - packages/modules/chat/module.ts
  - packages/modules/chat/package.json
  - packages/modules/chat/server/first-name.ts
  - packages/modules/chat/server/index.ts
  - packages/modules/chat/server/notification-copy.ts
  - packages/modules/chat/server/notifications.ts
  - packages/modules/chat/server/routes.ts
  - packages/modules/chat/server/service.ts
  - packages/modules/chat/tests/chat-composer.test.tsx
  - packages/modules/chat/tests/contracts.test.ts
  - packages/modules/chat/tests/first-name.test.ts
  - packages/modules/chat/tests/inbox-row.test.tsx
  - packages/modules/chat/tests/message-list.test.tsx
  - packages/modules/chat/tests/notification-sources.test.ts
  - packages/modules/chat/tests/thread-header.test.tsx
  - packages/modules/chat/tsconfig.json
  - packages/modules/chat/turbo.json
  - packages/modules/chat/ui/ChatComposer.tsx
  - packages/modules/chat/ui/DaySeparator.tsx
  - packages/modules/chat/ui/InboxRow.tsx
  - packages/modules/chat/ui/MessageBubble.tsx
  - packages/modules/chat/ui/MessageList.tsx
  - packages/modules/chat/ui/ThreadHeader.tsx
  - packages/modules/chat/ui/index.ts
  - packages/modules/chat/vitest.config.ts
  - packages/modules/events/contracts/index.ts
  - packages/modules/events/module.ts
  - packages/modules/events/server/index.ts
  - packages/modules/events/server/notification-copy.ts
  - packages/modules/events/server/notifications.ts
  - packages/modules/events/server/reminders.ts
  - packages/modules/events/server/service.ts
  - packages/modules/events/server/system-context.ts
  - packages/modules/events/tests/events-payload.test.ts
  - packages/modules/events/tests/notification-sources.test.ts
  - packages/modules/events/tests/reminders.test.ts
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/module.ts
  - packages/modules/feed/server/index.ts
  - packages/modules/feed/server/notification-copy.ts
  - packages/modules/feed/server/notifications.ts
  - packages/modules/feed/server/routes.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/tests/comments-list-highlight.test.tsx
  - packages/modules/feed/tests/linkify-reexport.test.ts
  - packages/modules/feed/tests/notification-sources.test.ts
  - packages/modules/feed/ui/CommentItem.tsx
  - packages/modules/feed/ui/CommentsList.tsx
  - packages/modules/feed/ui/index.ts
  - packages/modules/feed/ui/linkify.tsx
  - packages/modules/notifications/contracts/index.ts
  - packages/modules/notifications/db/schema.ts
  - packages/modules/notifications/module.ts
  - packages/modules/notifications/package.json
  - packages/modules/notifications/server/channels/in-app.ts
  - packages/modules/notifications/server/channels/push.ts
  - packages/modules/notifications/server/channels/registry.ts
  - packages/modules/notifications/server/channels/types.ts
  - packages/modules/notifications/server/fanout-job.ts
  - packages/modules/notifications/server/index.ts
  - packages/modules/notifications/server/push-subscriptions.ts
  - packages/modules/notifications/server/push/endpoint.ts
  - packages/modules/notifications/server/push/payload.ts
  - packages/modules/notifications/server/push/send-job.ts
  - packages/modules/notifications/server/push/transport.ts
  - packages/modules/notifications/server/retract.ts
  - packages/modules/notifications/server/routes.ts
  - packages/modules/notifications/server/service.ts
  - packages/modules/notifications/server/sink.ts
  - packages/modules/notifications/server/system-context.ts
  - packages/modules/notifications/tests/channels.test.ts
  - packages/modules/notifications/tests/contracts.test.ts
  - packages/modules/notifications/tests/notification-item.test.tsx
  - packages/modules/notifications/tests/push-channel.test.ts
  - packages/modules/notifications/tests/push-endpoint.test.ts
  - packages/modules/notifications/tests/push-payload.test.ts
  - packages/modules/notifications/tests/push-switch-row.test.tsx
  - packages/modules/notifications/tests/push-transport.test.ts
  - packages/modules/notifications/tests/soft-ask-card.test.tsx
  - packages/modules/notifications/tsconfig.json
  - packages/modules/notifications/turbo.json
  - packages/modules/notifications/ui/NotificationItem.tsx
  - packages/modules/notifications/ui/NotificationList.tsx
  - packages/modules/notifications/ui/PushSwitchRow.tsx
  - packages/modules/notifications/ui/SoftAskCard.tsx
  - packages/modules/notifications/ui/index.ts
  - packages/modules/notifications/vitest.config.ts
  - packages/modules/stories/contracts/index.ts
  - packages/modules/stories/module.ts
  - packages/modules/stories/server/notification-copy.ts
  - packages/modules/stories/server/notifications.ts
  - packages/modules/stories/tests/notification-sources.test.ts
  - packages/ui/package.json
  - packages/ui/src/index.ts
  - packages/ui/src/primitives/Badge.tsx
  - packages/ui/src/text/linkify.tsx
  - packages/ui/src/text/url.ts
  - packages/ui/tests/button.test.tsx
  - packages/ui/tests/linkify.test.tsx
findings:
  critical: 0
  warning: 6
  info: 7
  total: 13
status: issues_found
---

# Phase 7: Code Review Report, Area B (modules + ui)

**Reviewed:** 2026-10-01T00:32:18Z
**Depth:** standard
**Files Reviewed:** 101
**Status:** issues_found

## Summary

This review covers the Phase 7 diff (`80ef5b8..HEAD`) in the notifications, chat, feed, stories and events modules and in `packages/ui`. The SQL definers in `supabase/migrations` were read only to confirm how the module code calls them; reviewing the definers themselves is area A's job.

What holds up:
- Tenant scoping is applied twice: by RLS and by an explicit `tenant_id` predicate in each statement.
- Fan-out dedupe works through `on conflict … do nothing`, and push goes only to newly inserted rows.
- Chat `seq` ordering is correct. A BEFORE trigger assigns it under the conversation row lock, and the catch-up reads use `seq > N`.
- Read positions only move forward, using `greatest(…, least(seq, last_seq))`.
- The push endpoint allow-list, the `PUSH_PATH` same-origin rule and the 3072-byte payload bound are sound.
- `linkify` only produces `http(s)` links.

No blockers were found. The real weaknesses are in four places:
- **Deleted text can survive in notifications and pushes:**
  - a retraction can race the fan-out it is meant to blank;
  - a push queued before a delete is not re-checked when it is sent;
  - a story comment deleted through the feed route is never retracted.
- **The chat RLS write policies are wider than the "policies still leak nothing" claim in the schema comment.**
- **A ChatComposer race can overwrite what the member typed.**
- **Reminder signals go out one per user, which can exceed the Free-plan Realtime rate.**

## Warnings

### B-WR-01: A retraction can run before the fan-out it should blank commit, leaving the excerpt in the bell

**File:** `packages/modules/notifications/server/fanout-job.ts:44-58`, `packages/modules/feed/server/notifications.ts:57-91`, `packages/modules/stories/server/notifications.ts:126-153`
**Issue:** The fan-out for the producing event (`post.published`, `comment.created`, `comment.liked`, `story.commented`) and the retraction for the deleting event (`post.deleted`, `comment.deleted`, `story.comment_deleted`) are separate `notifications.fanout` jobs, each in its own transaction. The sources re-check `deleted_at is null` when they run their SELECT. But under READ COMMITTED this sequence is possible:
1. Fan-out T1 reads the live row.
2. The delete commits.
3. Retraction job T2 runs `app.notifications_retract`. Its UPDATE cannot see T1's uncommitted INSERTs, so it changes 0 rows.
4. T1 commits its rows, with the full excerpt.

Nothing ever retracts those rows again. This needs two workers processing the queue at the same time. The worker uses `boss.work` per instance, and `deploy-api.yml` sets no `--max-instances`, so two workers run together during every deploy overlap and on any scale-out.

The same window affects a large `members` broadcast, whose single INSERT can take a while. It breaks the phase rule "no text leaks after delete" (07-04).
**Fix:** Close the window on the write side so ordering stops mattering. Inside the fan-out transaction, after `deliverIntent`, re-check that the subject or object is still live. If it is not, retract in the same transaction. For example, after each source resolves:
```ts
for (const intent of intents) {
  await deliverIntent(tx, tenantId, intent);
}
// Belt-and-braces: a delete that committed after our SELECT is caught here, under our own snapshot of committed data.
for (const retraction of retractionsForSubjectsGone(tx, intents)) { … }
```
A simpler option is for every source to take `for share` on the target row (for example `select … from feed_posts p … for share of p`). The delete's UPDATE then waits for the fan-out to commit, and the retraction job, which is enqueued after the delete commits, is guaranteed to see the inserted rows.

### B-WR-02: A queued or retried push still delivers deleted text, and the rendered body sits in `pgboss.job`

**File:** `packages/modules/notifications/server/push/send-job.ts:68-199`, `packages/modules/notifications/server/channels/push.ts:84-97`
**Issue:** The push body is rendered at fan-out time and carried verbatim in the `notifications.push-send` job. It can contain:
- a post excerpt;
- a comment or reply excerpt;
- a story comment;
- up to 100 characters of a support chat message.

`runPushSend` never checks whether the notification was retracted or the chat message soft-deleted before sending. Retries are re-enqueued with `startAfter` delays of 30 s, 2 min and 8 min. So a reply deleted one minute after posting can still land on lock screens about ten minutes later, after the bell row was blanked.

The body also persists in `pgboss.job` and its archive for the queue's retention period. That contradicts the module rule "push text … is NEVER stored", and it survives retraction.
**Fix:** Carry `subject` and `object` (or the `dedupeKey`) in `PushSendJob`. In step 1 of `runPushSend`, skip the send when the target is gone. For in-app-backed kinds, that means any row with this `dedupe_key` has `payload->>'removed' = 'true'`. For chat, it means `chat_messages.deleted_at is not null`. Also give the push-send queue a short `deleteAfter`/retention so rendered bodies do not linger.

### B-WR-03: A story comment deleted through the feed route is never retracted

**File:** `packages/modules/feed/server/notifications.ts:309-312`, `packages/modules/stories/server/notifications.ts:209-218`, `packages/modules/feed/server/service.ts:1592-1606`
**Issue:**
- Story comments live in `feed_comments`.
- `deleteComment` (`DELETE /v1/feed/comments/{id}`) soft-deletes any of the author's own `feed_comments` rows. Unlike `deleteStoryComment`, it has no `post_id is not null` predicate, so it also deletes story comments.
- It emits `comment.deleted`, whose retraction matches `{ on: 'object', type: 'comment' }`.
- The `stories.story_commented` row stores its object as `type: 'story_comment'`.

So when a commenter deletes their story comment through the feed endpoint, the story author's bell keeps the comment excerpt. A crafted request is enough, because the endpoint accepts any of the caller's own comment ids.
**Fix:** Do one or both of the following:
- In the stories module, also retract on the feed's event. `retractionsFor` already supports several retractions per event:
```ts
{
  event: 'comment.deleted',
  match: (payload) => ({ on: 'object', type: 'story_comment', id: payload.commentId }),
} satisfies NotificationRetraction<'comment.deleted'>,
```
- Restrict the feed's `deleteComment` to post comments with `and post_id is not null`, so story comments can only be deleted through the stories route, which emits `story.comment_deleted`.

### B-WR-04: The chat RLS write policies allow joining any conversation, and rewriting or deleting it, from the member lane

**File:** `packages/modules/chat/db/schema.ts:107-112`, `:141-146`, `:191-196`
**Issue:** The schema comment (fact 7) says "a dropped participant predicate in the API must still leak nothing". The `for: 'all'` policies do not deliver that:
- **Read escalation through `chat_participants`.** The WITH CHECK is `tenant_id = app.tenant_id() and (user_id = app.user_id() or STAFF)`. It never checks that the lane can see `conversation_id`, and the FK check bypasses RLS. A member lane can therefore `insert into chat_participants (conversation_id = <another member's thread>, user_id = self)`. `chat_conversations_access`, and through it `chat_messages_access`, then grant full read of that thread.
- **`chat_messages` WITH CHECK pins `author_user_id` but not `author_side`.** A member-lane insert with `author_side = 'staff'` sets `last_staff_seq` and `staff_last_read_seq` through the definer trigger. That clears "awaiting" for the whole team, and the message renders as a team bubble with the member's first name.
- **`chat_conversations` allows UPDATE and DELETE by the creator.** The member lane can rewrite `kind` (moving the thread out of the staff inbox), `last_seq` and `staff_last_read_seq`, or delete the conversation and cascade-delete its messages. That contradicts "moderation keeps the row".

None of these is reachable through today's API routes, which is why this is a WARNING and not a BLOCKER. But the comment explicitly relies on this policy as the second layer.
**Fix:** Split the policies by command:
```ts
pgPolicy('chat_participants_insert', { for: 'insert', to: authenticatedRole,
  withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id()
    and exists (select 1 from public.chat_conversations c
                 where c.id = conversation_id and c.tenant_id = app.tenant_id()
                   and c.created_by_user_id = app.user_id())` }),
pgPolicy('chat_messages_insert', { for: 'insert', to: authenticatedRole,
  withCheck: sql`tenant_id = app.tenant_id() and author_user_id = app.user_id()
    and (author_side = 'member' or ${STAFF_ROLE})
    and exists (select 1 from public.chat_conversations c where c.id = conversation_id)` }),
```
Then give `chat_conversations` SELECT and INSERT only, with counters written exclusively by the definer trigger and staff read through a definer or a column-restricted update. Add no DELETE policy, and give `chat_participants` UPDATE only on the participant's own `last_read_*`. Add pgTAP negatives for each case.

### B-WR-05: ChatComposer restores the failed draft over text typed while the send was pending

**File:** `packages/modules/chat/ui/ChatComposer.tsx:86-105`, `:139-155`
**Issue:**
1. `send()` clears the field and awaits `onSend`.
2. The `Textarea` is not disabled while `pending`, so the member can keep typing.
3. If the send fails, `setValue(draft)` replaces the whole field with the old draft. Anything typed during the request is silently lost.

This contradicts the component's own promise that "a network blip never costs the member what they wrote". It is likely on a slow mobile network, which is the case the rule exists for.
**Fix:** Merge rather than overwrite:
```ts
if (!accepted) {
  setValue((current) => (current.trim() === '' ? draft : `${draft}\n${current}`));
  setFailed(true);
}
```
Alternatively, set `readOnly={pending}` on the field so nothing can be typed while the send is in flight.

### B-WR-06: The `users` audience publishes one Realtime message per recipient, so reminders can exceed the Free-plan rate

**File:** `packages/modules/notifications/server/channels/in-app.ts:41-51`, `packages/modules/events/server/notifications.ts:225-246`
**Issue:** The adapter carefully publishes a single `tenant:<t>:all` signal for `members` broadcasts because of the Free plan's 100 msg/s limit. But a `users` audience loops `app.realtime_signal` once per newly inserted recipient. `event.reminder_due` uses a `users` audience containing every `going` attendee, so one reminder fan-out for a 400-person event publishes 400 Broadcast messages in one transaction. That is well over the per-second quota the project runs on (CLAUDE.md: Free plan for the pilot). Realtime then throttles or drops messages tenant-wide, including the `chat.message` and `chat.unread` signals, which chat freshness depends on.
**Fix:** Above a small threshold, for example 20 recipients, publish one tenant-wide `notifications.changed` on `topicSuffix.all()` instead of per-user signals. Clients without a new row just refetch a count, which is cheap. Alternatively, drop per-user signals for reminder kinds, since the D-240 refetch on visibility already keeps the bell honest:
```ts
if (audience.type === 'members' || delivered.length > USER_SIGNAL_FANOUT_MAX) {
  await tx.execute(sql`select app.realtime_signal(${topicSuffix.all()}, …)`);
} else { for (const userId of delivered) … }
```

## Info

### B-IN-01: A row with no href and no removed flag is tagged `data-removed="true"`

**File:** `packages/modules/notifications/ui/NotificationItem.tsx:155-167`
**Issue:** The button branch is taken for `removed || href === null`, but it always sets `data-removed="true"`. An unknown or generic kind with no route is therefore reported as removed to tests and styling hooks, even though it is not removed.
**Fix:** Use `data-removed={removed ? 'true' : undefined}`.

### B-IN-02: Helpers are duplicated across files

**File:** `packages/modules/notifications/server/channels/in-app.ts:63-66`, `channels/push.ts:15-20`, `push/send-job.ts:34`, `server/sink.ts:12`, `server/retract.ts:8`, `notifications/server/service.ts:33-61`, `chat/server/service.ts:611-636`
**Issue:**
- The UUID regex and `pgUuidArray` are copied three to five times. The `send-job` copy skips the UUID filter and relies on the schema instead.
- `decodeInstantCursor` / `isCursorInstant` exists twice, once in notifications and once in chat.

These copies will drift.
**Fix:** Move them to `@rede-social/core/server/paging` and a small `sql-arrays` helper.

### B-IN-03: The 1-hour reminder copy is wrong when the job runs late

**File:** `packages/modules/events/server/notification-copy.ts:60`, `packages/modules/events/server/reminders.ts:152`
**Issue:** A reminder may fire up to `EVENT_REMINDER_LATE_TOLERANCE_MINUTES` (30) late, but the body always says "Em 1 hora: … começa às HH:mm". The time shown is correct; only the "in 1 hour" lead is inaccurate.
**Fix:** Derive the lead from `seconds_left`, or drop the "Em 1 hora" prefix.

### B-IN-04: Deterministic payload errors are treated as retryable and counted as subscription failures

**File:** `packages/modules/notifications/server/push/send-job.ts:136-150`
**Issue:** If `buildPushPayload` throws (an off-path URL, or fixed fields over the size bound), the `catch` maps it to `retry`. The job then re-enqueues it three times, and each time `push_subscription_report(…, 'failed')` increments `failure_count` on a perfectly healthy subscription.
**Fix:** Build the payload outside the transport `try`. On a build error, classify it as `dropped` and log `push.bad_payload` with the kind.

### B-IN-05: The comment highlight replays on remount, and the pinned root can be stale

**File:** `packages/modules/feed/ui/CommentItem.tsx:134-155`, `packages/modules/feed/ui/CommentsList.tsx:251-263`, `:314`
**Issue:**
- Collapsing and re-expanding the pinned thread remounts the highlighted reply. `useState(highlighted)` plus the effect then calls `scrollIntoView` again and re-tints the row, yanking the page.
- `withPinned` always re-prepends the original `pinnedThread.root` prop. After the member deletes or likes the pinned root, the retry path (`loadFirstPage`) re-inserts a stale or deleted copy.
- With `initialError` set, the pinned thread is not shown at all until the retry succeeds.
**Fix:** Track "already highlighted" in a ref in `CommentsList` and pass `highlighted` only on first render. Keep the pinned root in state, removing it on delete, rather than re-reading the prop.

### B-IN-06: Chat pushes silently depend on the notifications module flag

**File:** `packages/modules/notifications/server/sink.ts:45-46`, `packages/modules/chat/module.ts:19-22`
**Issue:** `chat.message_sent` pushes go through the notifications sink, which returns early when `notifications` is disabled. A tenant with chat on and notifications off therefore gets no support-reply pushes and no member-message pushes to staff. Neither manifest nor the admin UI says so.
**Fix:** Document the dependency in the chat manifest, or declare it as a module dependency so the platform panel cannot enable chat-with-push without notifications.

### B-IN-07: A failed badge count sends `badge: 0`, which can clear a correct app badge

**File:** `packages/modules/notifications/server/push/send-job.ts:115-129`
**Issue:** When `resolveCounters` throws, the payload still carries `badge: 0`. If the service worker applies the payload badge (07-07), the home-screen badge is cleared even though there are unread items.
**Fix:** Make `badge` optional in the payload, using `-1` or omitting the field when the count is unknown. Have the service worker leave the badge untouched in that case.

---

_Reviewed: 2026-10-01T00:32:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
