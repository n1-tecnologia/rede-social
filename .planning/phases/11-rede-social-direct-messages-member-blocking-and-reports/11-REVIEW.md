---
phase: 11-rede-social-direct-messages-member-blocking-and-reports
reviewed: 2026-11-21T00:00:00Z
depth: standard
files_reviewed: 113
files_reviewed_list:
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/admin/report-removal.ts
  - apps/api/src/routes/admin/reports.ts
  - apps/api/src/routes/safety.ts
  - apps/web/app/(app)/comunidades/[communityId]/CommunityMenu.tsx
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/configuracoes/bloqueados/BlockedList.tsx
  - apps/web/app/(app)/configuracoes/bloqueados/loading.tsx
  - apps/web/app/(app)/configuracoes/bloqueados/page.tsx
  - apps/web/app/(app)/configuracoes/denuncias/DirectMessageReportRow.tsx
  - apps/web/app/(app)/configuracoes/denuncias/ReportsQueue.tsx
  - apps/web/app/(app)/configuracoes/denuncias/ResolveSheet.tsx
  - apps/web/app/(app)/configuracoes/denuncias/actions.ts
  - apps/web/app/(app)/configuracoes/denuncias/error.tsx
  - apps/web/app/(app)/configuracoes/denuncias/loading.tsx
  - apps/web/app/(app)/configuracoes/denuncias/page.tsx
  - apps/web/app/(app)/configuracoes/page.tsx
  - apps/web/app/(app)/conversas/ConversationsList.tsx
  - apps/web/app/(app)/conversas/[conversationId]/loading.tsx
  - apps/web/app/(app)/conversas/[conversationId]/not-found.tsx
  - apps/web/app/(app)/conversas/[conversationId]/page.tsx
  - apps/web/app/(app)/conversas/actions.ts
  - apps/web/app/(app)/conversas/com/[membershipId]/not-found.tsx
  - apps/web/app/(app)/conversas/com/[membershipId]/page.tsx
  - apps/web/app/(app)/conversas/error.tsx
  - apps/web/app/(app)/conversas/loading.tsx
  - apps/web/app/(app)/conversas/page.tsx
  - apps/web/app/(app)/layout.tsx
  - apps/web/app/(app)/membros/MembersList.tsx
  - apps/web/app/(app)/membros/actions.ts
  - apps/web/app/(app)/membros/page.tsx
  - apps/web/app/(app)/post/[postId]/page.tsx
  - apps/web/app/api/chat/direct/[conversationId]/route.ts
  - apps/web/app/api/chat/direct/route.ts
  - apps/web/components/chat/ComposerStateStrip.tsx
  - apps/web/components/chat/DirectThreadFrame.tsx
  - apps/web/components/chat/DirectThreadPane.tsx
  - apps/web/components/chat/MessageMenuSheet.tsx
  - apps/web/components/feed/FeedSurface.tsx
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/feed/ReportAndBlock.tsx
  - apps/web/components/feed/safety-actions.ts
  - apps/web/components/shell/LiveShell.tsx
  - apps/web/components/social/FollowControl.tsx
  - apps/web/components/social/MemberFollowRow.tsx
  - apps/web/components/social/SocialCountsBlock.tsx
  - apps/web/components/social/SocialProfileBlock.tsx
  - apps/web/components/social/follow-actions.ts
  - apps/web/components/stories/StoryViewerHost.tsx
  - apps/web/lib/blocks.ts
  - apps/web/lib/chat-nav.ts
  - apps/web/lib/chat-view.ts
  - apps/web/lib/chat.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/notification-renderers.tsx
  - apps/web/lib/registry.tsx
  - apps/web/lib/reports-view.ts
  - apps/web/lib/reports.ts
  - apps/web/lib/route-handlers.inventory.ts
  - apps/web/lib/social.ts
  - apps/web/lib/story-view.ts
  - apps/web/messages/pt-BR/chat.json
  - apps/web/messages/pt-BR/moderation.json
  - apps/web/messages/pt-BR/notifications.json
  - apps/web/messages/pt-BR/safety.json
  - apps/web/messages/pt-BR/social.json
  - packages/contracts/src/moderation.ts
  - packages/core/db/schema/content-reports.ts
  - packages/core/server/notifications/source.ts
  - packages/core/server/safety/blocks.ts
  - packages/core/server/safety/index.ts
  - packages/core/server/safety/limits.ts
  - packages/core/server/safety/reports.ts
  - packages/core/ui/nav.ts
  - packages/modules/chat/contracts/index.ts
  - packages/modules/chat/db/schema.ts
  - packages/modules/chat/server/direct.ts
  - packages/modules/chat/server/index.ts
  - packages/modules/chat/server/notification-copy.ts
  - packages/modules/chat/server/notifications.ts
  - packages/modules/chat/server/routes.ts
  - packages/modules/chat/server/service.ts
  - packages/modules/chat/ui/InboxRow.tsx
  - packages/modules/chat/ui/MessageList.tsx
  - packages/modules/communities/contracts/index.ts
  - packages/modules/communities/server/index.ts
  - packages/modules/communities/server/routes.ts
  - packages/modules/communities/server/service.ts
  - packages/modules/communities/ui/CommunityHeader.tsx
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/ui/CommentItem.tsx
  - packages/modules/feed/ui/CommentsList.tsx
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/MenuRow.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostMenu.tsx
  - packages/modules/notifications/contracts/index.ts
  - packages/modules/notifications/module.ts
  - packages/modules/notifications/server/index.ts
  - packages/modules/notifications/server/push/payload.ts
  - packages/modules/notifications/server/report-notice.ts
  - packages/modules/notifications/ui/NotificationItem.tsx
  - packages/modules/social/contracts/index.ts
  - packages/modules/social/db/schema.ts
  - packages/modules/social/module.ts
  - packages/modules/social/server/index.ts
  - packages/modules/social/server/notifications.ts
  - packages/modules/social/server/service.ts
  - packages/modules/stories/contracts/index.ts
  - packages/modules/stories/server/index.ts
  - packages/modules/stories/server/service.ts
  - supabase/migrations/20261119155818_direct_pair_gates.sql
  - supabase/migrations/20261119155903_direct_pairs.sql
  - supabase/migrations/20261119155914_direct_open.sql
  - supabase/migrations/20261119160110_direct_policies.sql
  - supabase/migrations/20261119162341_direct_triggers.sql
  - supabase/migrations/20261119162800_direct_notice.sql
  - supabase/migrations/20261119173204_block_effects.sql
  - supabase/migrations/20261119173313_follow_block_policy.sql
  - supabase/migrations/20261119194425_report_subjects.sql
  - supabase/migrations/20261119194436_report_subjects_functions.sql
  - supabase/migrations/20261119194821_chat_support_conversation_gate.sql
  - supabase/migrations/20261119194838_direct_participants_policy.sql
  - supabase/migrations/20261119195211_report_voice_gate.sql
findings:
  critical: 0
  warning: 5
  info: 5
  total: 10
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-11-21
**Depth:** standard
**Files Reviewed:** 113 (the config's `files` list is 113 paths, of which 25 were read in full, 54 only as their diff against `adc12ee6`, and 34 not opened beyond the diff stat or a key check)
**Status:** issues_found

## Summary

I read the 13 migrations in full, together with the API routes and core safety services, the chat direct service and notification sources, the report, block and social services, the web server actions, BFF routes and pages, and the main client components. The small UI files (loading and error screens, `ComposerStateStrip`, `DirectThreadFrame`, `MessageMenuSheet`, most of the feed and chat UI modules) I saw only as diffs or not at all.

I found no cross-tenant leak and no direct-message leak between members who are not a pair.

What I checked and found sound:
- **Pair gate and creator.** Every definer pins the tenant from the claims, and `pair_open_in` is revoked from every lane.
- **Staff exclusion (D-482).** Both the pair gate and the send trigger refuse staff.
- **Send and block ordering.** The send trigger and `member_block_create` take the same conversation row lock, and the send trigger re-reads `member_blocks` after the lock wait.
- **First-send race.** `direct_conversation_open` handles twenty concurrent first sends through `on conflict` on the partial unique index.
- **Participant rows (D-731).** Staff can no longer read participant rows of direct conversations.
- **Reported messages and recordings.** `content_report_create` pins the reporter to the pair and refuses own content, and the voice gate lets the administrator hear a recording only through a report.
- **Push.** `direct_message_notice` answers only the worker lane and recomputes `deliverable` at fan-out; push copy and the report notice never name the blocker, the reason or the reported subject.
- **Web.** Server actions return closed codes with Zod run before the request, and no API message reaches the DOM.
- **Catalogs.** All the `t()` keys I spot-checked exist.

The findings below are privacy and robustness gaps, not exploitable isolation failures.

> Orchestrator note (not part of the reviewer's text): the scope the orchestrator passed was 125 non-test source files (the base was `adc12ee6`, the phase's plan commit, because the default phase-directory anchor would have swept in 3362 files from 2026-09-25). The reviewer reports 113 paths and says 34 of them were not opened beyond the diff stat or a key check, so treat the "nothing found" statements for the small UI files as low-confidence.

## Warnings

### WR-01: A blocked member can still learn who blocked them, and enumerate it in bulk

**File:** `packages/modules/social/server/service.ts:317-353` (follow state), `packages/modules/social/server/service.ts:385-399` (member social profile), `packages/modules/chat/server/direct.ts:340-366` (`getDirectWith`)

**Issue:** T-11-03 says the blocked member is never told, and the code comments say "no field says blocked me". In practice the facts are equivalent to that flag. For a live-member target, `canFollow` and `canMessage` are false only when a block stands in either direction. `getDirectWith` answers `composer: 'closed'` for a pair with no conversation, and it too can only mean a block. `POST /v1/social/follows/state` takes up to 50 membership ids per call, with no block-specific limiter. A blocked member can therefore list everyone who blocked them in a handful of requests.

D-722 does require a `closed` strip for the blocked side of an existing conversation. It does not require this directory-wide, conversation-less enumeration.

**Fix:**
- Make the decision explicit. If silent blocks are the goal, stop returning `canFollow`/`canMessage: false` for the blocked side: return `true` and let the follow and send refuse with the neutral 404 and `direct_closed`. For `getDirectWith`, return `open` when no conversation exists and let the first send be the one refusal.
- Otherwise record in the threat register that a block is detectable and enumerable, and rate-limit `follows/state`.

### WR-02: `chat.direct` is gated, but the realtime `conv:` topic gate ignores the pair-readable rule

**File:** `supabase/migrations/20260930123213_realtime_authorization.sql:129-139` (`app.realtime_topic_allowed`, not replaced by this phase)

**Issue:** The `conv:` branch authorises any participant of a conversation in a tenant with `chat` enabled. `chat_conversations_select` now also requires `app.direct_pair_readable` (`social` on, both users live or anonymised, D-483). The topic gate was not updated. A participant of a direct pair that has become unreadable keeps the subscription and the 72 h replay of ids-only `{conversationId, seq}` signals. That reveals activity metadata after the REST side hid the pair.

I did not trace what a signal would carry in that state, so the practical impact is probably small, but this is defence in depth.

**Fix:** In the `conv:` branch, add `and (c.direct_low_user_id is null or app.direct_pair_readable(c.direct_low_user_id, c.direct_high_user_id))`. The function is a definer, and the topic function already runs under the caller's claims.

### WR-03: The idempotent voice short-circuit can answer success for a different conversation

**File:** `packages/modules/chat/server/direct.ts:233-236`, `packages/modules/chat/server/voice-sql.ts` (`storedVoiceMessage`)

**Issue:** `sendDirectVoiceOnce` runs `storedVoiceMessage(tx, ctx, mediaId)` before resolving the target. That lookup matches the caller's own message that carries the asset in any conversation: a support case, or a direct conversation with another member. If a take was already stored there, a `POST /direct/voice-messages` to someone else returns 201 with that other conversation's id and message, `created: false`, and delivers nothing to the named recipient.

The web pane then runs `adoptSent` with the foreign conversation id, replaces the URL with `/conversas/{id}`, and joins that topic. For a support conversation id that page is a 404. Only a crafted call, a retry against a different recipient, or two tabs can trigger this. It is still an idempotency answer for a request that was not the stored one.

**Fix:** After the prior lookup, compare the stored conversation with the pair:
```ts
const target = await resolveDirectTarget(tx, ctx, input.toMembershipId);
const conv = await directConversationOf(tx, ctx, target.userId);
if (prior && prior.conversationId === conv) return {...fresh:false};
if (prior) throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'voice_invalid' });
```
Alternatively, select `kind` and `direct_low_user_id` in `storedVoiceMessage` and reject a non-matching row. Keep `assertVoiceUsable` ahead of the target lookup (T-11-27).

### WR-04: A-11-ROLE residual: staff can still create blocks through the API

**File:** `supabase/migrations/20261119173204_block_effects.sql:37-96` (`app.member_block_create`), `apps/api/src/routes/safety.ts:103-166`, `packages/modules/feed/server/service.ts:262-280` (`reportRiders`, whose own docblock records the residual)

**Issue:** Only the riders and the screens hide "Bloquear" from `admin_tenant` and `support_tenant`. The definer and the `/v1/blocks*` routes do not check the caller's role. A staff account can create `member_blocks` rows, which feed `is_blocked_by_viewer` into its own lists. That includes the story comment list, which now carries `not app.is_blocked_by_viewer(c.author_user_id)`. A moderator who blocks a member therefore stops seeing that member's comments and can no longer moderate them from the lists. The effect is self-inflicted, but it defeats the "staff are never blockers" rule.

**Fix:** Add `if app.tenant_role() <> 'member' then raise exception using errcode = 'BL001'` to `member_block_create`, or add a `requirePermission` guard. The recorded reason for leaving it open ("the definer is not narrowed") is a choice, not a constraint.

### WR-05: Unblocking is throttled by the same 60-per-hour limiter as blocking

**File:** `apps/api/src/routes/safety.ts:196-201` (`unblockByMembershipRoute`), `packages/core/server/safety/limits.ts:19`

**Issue:** `DELETE /v1/blocks/members/{membershipId}` consumes the shared `blockLimiter`, and every attempt counts, including refused ones. After 60 block or unblock calls in an hour, a member cannot lift their own block (the strip's "Desbloquear", the profile button) until the window passes. `DELETE /v1/blocks/{userId}` has no limiter at all, so the two unblock routes behave differently.

**Fix:** Do not rate-limit unblock, or use a separate and higher limiter for it. At minimum, make both unblock routes consistent.

## Info

### IN-01: `GET /v1/blocks` and the web list still carry user ids

**File:** `packages/core/server/safety/blocks.ts:171-240` (`listBlocks`), `apps/web/lib/blocks.ts:30-60` (`BlockedMemberView.userId`), `apps/web/app/(app)/configuracoes/bloqueados/BlockedList.tsx:85`

**Issue:** Plan 27 added membership-id block routes "so no user id travels" (T-11-34, and the rule that a user id is a cross-community identity). The blocked list still returns each blocked member's `userId`, puts it in the RSC payload, and keys the unblock by it. A person in several tenants can correlate accounts through that id.

**Fix:** Return the membership id in `listBlocks` and unblock through `unblockMemberByMembership`. A departed member has none, so keep a user-id fallback only for that case.

### IN-02: `direct_message_notice` is not tied to the event's conversation

**File:** `packages/modules/chat/server/notifications.ts:158, 262-302`, `supabase/migrations/20261119162800_direct_notice.sql:22-73`

**Issue:** The direct branch calls the definer with `payload.messageId` only. The push tag and URL are then built from `payload.conversationId`. The support branch binds both ids, and the definer's own result does not return `conversation_id`. The events are server-emitted, so this cannot be abused today.

**Fix:** Add `conversation_id` to the definer's return columns and compare it with `payload.conversationId` before building the intent.

### IN-03: The send trigger trusts RLS to tie the author to the pair

**File:** `supabase/migrations/20261119162341_direct_triggers.sql:46-50`

**Issue:** The guard checks `pair_open_in` and the staff side but does not check that `new.author_user_id` is one of `v_low` or `v_high`. Today the participant `WITH CHECK` on `chat_messages_insert` guarantees it, because only the two members are participants. A future definer or admin-lane insert would skip that guarantee.

**Fix:** Add `or new.author_user_id not in (v_low, v_high)` to the `DM001` condition.

### IN-04: Report `content_available` ignores the parent post or story

**File:** `packages/core/server/safety/reports.ts:372-387`

**Issue:** For `post_comment` and `story_comment` the queue checks only that the comment is live. `subjectIsReadable` at filing time does check the parent. An administrator can get a "view content" link for a comment whose post or story was removed.

**Fix:** Join the parent (`feed_posts.deleted_at is null`, `stories.deleted_at is null`) in the `exists`.

### IN-05: Transient "pair back" state after unblocking from the profile

**File:** `apps/web/components/social/SocialCountsBlock.tsx:82-100`

**Issue:** After `onUnblocked`, `showFollow = unblocked || canFollow !== false` shows Seguir and Enviar mensagem even when the other side also blocked (a mutual block). They stay until the refreshed facts arrive. The server refuses a follow or send in that window, so only the UX is affected.

**Fix:** After a successful unblock, drop the optimistic `unblocked` override once `router.refresh()` settles. Alternatively, show nothing until the refreshed facts arrive.

---

_Reviewed: 2026-11-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
