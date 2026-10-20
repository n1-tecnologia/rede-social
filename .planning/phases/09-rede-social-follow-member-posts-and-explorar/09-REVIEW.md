---
phase: 09-rede-social-follow-member-posts-and-explorar
reviewed: 2026-10-20T00:00:00Z
depth: standard
files_reviewed: 108
files_reviewed_list:
  - apps/api/src/app.ts
  - apps/api/src/modules/registry.ts
  - apps/api/src/routes/members.ts
  - apps/api/src/routes/platform/tenants.ts
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/page.tsx
  - apps/web/app/(app)/inicio/ExplorarBody.tsx
  - apps/web/app/(app)/inicio/ExplorarSkeleton.tsx
  - apps/web/app/(app)/inicio/InicioTabs.tsx
  - apps/web/app/(app)/inicio/feed-actions.ts
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/inicio/tabs.ts
  - apps/web/app/(app)/membros/MembersList.tsx
  - apps/web/app/(app)/membros/[membershipId]/not-found.tsx
  - apps/web/app/(app)/membros/[membershipId]/page.tsx
  - apps/web/app/(app)/membros/actions.ts
  - apps/web/app/(app)/membros/page.tsx
  - apps/web/app/(app)/perfil/SocialList.tsx
  - apps/web/app/(app)/perfil/page.tsx
  - apps/web/app/(app)/perfil/seguidores/loading.tsx
  - apps/web/app/(app)/perfil/seguidores/page.tsx
  - apps/web/app/(app)/perfil/seguindo/loading.tsx
  - apps/web/app/(app)/perfil/seguindo/page.tsx
  - apps/web/app/(app)/perfil/social-list-actions.ts
  - apps/web/app/(app)/post/[postId]/editar/page.tsx
  - apps/web/app/(app)/post/[postId]/page.tsx
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
  - apps/web/components/admin/ModerationLogRow.tsx
  - apps/web/components/feed/FeedSurface.tsx
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/feed/community-locked.ts
  - apps/web/components/feed/useDeletePost.ts
  - apps/web/components/media/useSignedUpload.ts
  - apps/web/components/platform/ModuleToggles.tsx
  - apps/web/components/platform/SocialLimitsSheet.tsx
  - apps/web/components/profile/MemberRow.tsx
  - apps/web/components/profile/MembersSkeleton.tsx
  - apps/web/components/reels/ReelsHost.tsx
  - apps/web/components/social/FollowControl.tsx
  - apps/web/components/social/LockedPostScreen.tsx
  - apps/web/components/social/MemberFollowRow.tsx
  - apps/web/components/social/SocialCountsBlock.tsx
  - apps/web/components/social/SocialProfileBlock.tsx
  - apps/web/components/social/follow-actions.ts
  - apps/web/components/social/post-focus.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/feed-write.ts
  - apps/web/lib/feed.ts
  - apps/web/lib/member-directory.ts
  - apps/web/lib/moderation-view.ts
  - apps/web/lib/notification-renderers.tsx
  - apps/web/lib/platform.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/social-limits.ts
  - apps/web/lib/social-settings.ts
  - apps/web/lib/social.ts
  - packages/contracts/src/access.ts
  - packages/contracts/src/moderation.ts
  - packages/contracts/src/modules.ts
  - packages/core/db/schema/media-assets.ts
  - packages/core/db/schema/moderation-log.ts
  - packages/core/db/social-gate.ts
  - packages/core/server/media/limits.ts
  - packages/core/server/media/member-policy.ts
  - packages/core/server/media/member-share.ts
  - packages/core/server/media/service.ts
  - packages/core/server/media/video/event-job.ts
  - packages/core/server/moderation/log.ts
  - packages/core/server/platform/modules.ts
  - packages/core/server/profiles/service.ts
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/module.ts
  - packages/modules/feed/server/notification-copy.ts
  - packages/modules/feed/server/notifications.ts
  - packages/modules/feed/server/routes.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/ui/CommentsList.tsx
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostMenu.tsx
  - packages/modules/feed/ui/index.ts
  - packages/modules/social/contracts/index.ts
  - packages/modules/social/db/schema.ts
  - packages/modules/social/module.ts
  - packages/modules/social/server/index.ts
  - packages/modules/social/server/routes.ts
  - packages/modules/social/server/service.ts
  - packages/modules/social/ui/FollowButton.tsx
  - packages/modules/social/ui/FollowCounts.tsx
  - packages/modules/social/ui/FollowListRow.tsx
  - packages/modules/social/ui/LockedPost.tsx
  - packages/modules/social/ui/index.ts
  - packages/modules/social/vitest.config.ts
  - scripts/seed.ts
  - supabase/migrations/20261019202758_social_module_key.sql
  - supabase/migrations/20261019204645_social_gate_seam.sql
  - supabase/migrations/20261019204728_social_follows.sql
  - supabase/migrations/20261019204737_social_functions.sql
  - supabase/migrations/20261019211658_feed_social_visibility.sql
  - supabase/migrations/20261019214205_feed_social_indexes.sql
  - supabase/migrations/20261019220306_feed_social_locked.sql
  - supabase/migrations/20261019221240_feed_social_media_gate.sql
  - supabase/migrations/20261019223247_media_duration_cap.sql
  - supabase/migrations/20261019225153_moderation_post_removed.sql
findings:
  critical: 0
  warning: 8
  info: 6
  total: 14
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-10-20
**Depth:** standard
**Files Reviewed:** 108
**Status:** issues_found

## Summary

The security core of the phase is sound. I traced every SECURITY DEFINER function, the restrictive
`feed_posts_social_gate` and `feed_posts_social_insert_gate` policies, the service-side
`memberPostVisible` fragment, the follow routes and the locked-post refusals. All of them are pinned to
`app.tenant_id()` and use `search_path = ''`. EXECUTE is granted to `authenticated` only. The `coalesce`
rule for the seam arrays is applied everywhere. The SQL gate and the service predicate agree with each
other. I found no cross-tenant read, no SQL injection and no API route that trusts a UI-only check.

The defects below are in three places:

1. **Revocation and side channels around the gate.** Media access, the reply notification and the
   single-profile read each have a hole.
2. **New member write and upload surface.** Several guards are weaker than they look.
3. **Client state.** One `FollowControl` bug breaks the invariant the design says must never break.

No finding is a clear BLOCKER. WR-01 and WR-02 are the two I would fix before enabling `social` for a
real tenant. Known items (a) the four comment-id routes and an admin, (b) no rate limiter and (c) the
blank `display_name` are not repeated here. WR-03 touches the no-rate-limiter theme from a new angle
and says so.

## Warnings

### WR-01: Removed, deleted or unfollowed content stays playable by asset id (`media_asset_hidden` ignores soft-deleted posts)

**File:** `supabase/migrations/20261019221240_feed_social_media_gate.sql:33-68` (the `p.deleted_at is null` predicates at lines 39 and 57). Related: `packages/core/server/media/service.ts:905-928`.

**Issue:** Both halves of `app.media_asset_hidden` only consider LIVE posts. Once a member's followers-only post is soft-deleted, by the author or by a moderator through SOCIAL-07, the video asset is attached to no live post. The function then answers `false`, as it does for "the composer's own preview". `playbackTokens` therefore mints a playback token for any tenant member who still holds the asset id.

That asset id is in every page payload the member loaded while they could see the post. It is also in browser and service-worker caches. The moderator takedown (D-475) exists to stop distribution. It does not stop playback of the removed video.

The same applies to a follower who unfollows or is removed: the gate closes for new reads of the post, but the capability survives.

Image variants are weaker still. `serveVariant` is a "zero-read id-capability" for every width variant, and `original` asks only the course gate. The migration header says "a video id is a capability", but the same is true of a photo, and member photos are the more privacy-sensitive content. Assumption A6 was accepted for organization content. It was not re-evaluated for audience-restricted member content.

**Fix:**
- In `media_asset_hidden`, treat an asset whose only carriers are soft-deleted posts of audience `followers` as hidden for every non-admin caller. Admins and the system lanes could keep access for moderation evidence.
- Ask `mediaAssetHidden` for image `original` and width variants of `post`-purpose assets too, not only video playback.
- If that adds too many reads, enqueue the provider and storage deletion in the same transaction as the moderator removal.

```sql
-- sketch: inside the first `exists`, drop `p.deleted_at is null` for followers posts
or (p.visibility = 'followers' and p.deleted_at is not null
    and coalesce(app.tenant_role(), '') <> 'admin_tenant')
```

### WR-02: Reply notification (in-app and push) leaks thread text to a user who lost access to a followers-only post

**File:** `packages/modules/feed/server/notifications.ts:383-420` (reply branch, only `lockedForRecipient` at line 418).

**Issue:** 09-07 added the social gate to `resolvePostCommented`: it checks `visibility`, `social_on` and `author_live`. The pre-existing reply branch was left unchanged ("The reply branch below is unchanged") and knows nothing about audience. Its recipient is the ROOT comment's author, who may be a follower-turned-stranger.

Sequence:
1. X follows A and comments on A's followers-only post.
2. X unfollows A. A can also block X, the author can be blocked, or `social` can be turned off.
3. Y replies to X's comment.
4. `resolveCommentCreated` builds an intent with `channels: ['in_app','push']`, `body: feedReplyPushCopy(actor, excerpt)` and `url: /post/{id}?comentario=...`.

X receives a push and a bell row carrying Y's reply excerpt, up to the excerpt cap, from a thread X can no longer read. This is exactly the "what can a stranger learn" axis the phase added. X then sees the locked screen on tap.

**Fix:** In the reply branch, select `p.visibility`, `p.author_user_id` and the same `social_on` and `author_live` columns that `resolvePostCommented` reads. For `visibility = 'followers'`, return `[]` unless `social_on` and `author_live` hold and the recipient is the post author or is in the author's live followers. The recipient check can be a definer lookup, or a read of `social_follows` in the worker lane through the kernel seam. A kernel-owned `app.social_can_read_post_as(user, post)` would be cleaner than a module table read from feed.

### WR-03: Member upload sub-budget is bypassed by choosing another upload purpose; pending member videos are never counted

**File:** `packages/core/server/media/service.ts:254-263` and `:478-489`; `packages/core/server/media/member-share.ts:24-61`.

**Issue:** Two gaps defeat the stated goal "a flood of member uploads cannot lock the organization out of its own 800 MiB and 3 hours" (`MEDIA_MEMBER_SHARE_OF_CEILING`).

1. The byte sub-budget applies only when `ctx.role === 'member' && body.purpose === 'post'`. `POST /v1/media/uploads` has no role or permission gate for images and files. A member can start `cover`, `story`, `attachment` or `avatar` uploads, up to 15 or 50 MiB each. They draw from the shared 800 MiB ceiling and never touch `memberPostBytesUsed`. A member needs no `social` module for this, but the phase added the stated protection and left it trivially routable around.
2. The video sub-budget sums `duration_seconds`, which is null until the ready event. `startVideoUpload` documents this as "necessarily approximate" for admins. Now any member whose tenant enabled member video can open an unbounded number of `pending` Mux direct uploads, each up to 500 MiB, before one is measured. The ready job deletes over-cap assets afterwards, but every upload still costs ingest and transcode. The "no rate limiter" item (b) is known. This is a new, unbounded, per-member provider-cost vector that did not exist when only admins could upload video.

**Fix:**
- Apply the member share to every member upload regardless of purpose.
  - Drop the `purpose === 'post'` condition on `memberPostBytesUsed`.
  - Rename it to `memberBytesUsed` and drop the `purpose = 'post'` filter in `member-share.ts`.
  - Alternatively, refuse `cover` and `story` for the role `member` in `startUpload`.
- Cap the number of non-terminal member videos per user, for example "at most 1 `pending` or `processing` video per member". Alternatively, charge each pending member video at its snapshotted `duration_cap_seconds` against the minutes sub-budget.

### WR-04: `FollowControl` captures `initialFollowing` once; a late-arriving state shows "Seguir" for someone the user follows

**File:** `apps/web/components/social/FollowControl.tsx:61` (also `SocialCountsBlock.tsx:53`).

**Issue:** `useState(initialFollowing === true)` runs on first render only. When the first render has `initialFollowing === null` (EP-43: the batch state read failed), the hook initialises `following` to `false`. The component then renders an empty spacer, so nothing is wrong yet. If the same row instance later receives `true` or `false`, the prop is ignored. This happens when `MembersList` re-renders after the pull-to-refresh or retry `router.refresh()`: rows are keyed by `membershipId` and stay mounted, and `follow.initialFollowing` is re-seeded.

Followed people then render "Seguir". The design states (EP-43 and the component doc) that this "can never show". Tapping it sends an idempotent PUT and flips to "Seguindo", so there is no data damage, but the screen lies.

`SocialCountsBlock` has the same class of bug: `followerCount` state ignores a new server prop after `router.refresh()`. The `follow_required` and community-locked reactions call `router.refresh()` on screens that may mount this block.

**Fix:** Re-key on the server value so a new answer remounts the control, or resync during render.

```tsx
<FollowControl key={`${member.membershipId}:${following ?? 'x'}`} ... />
```

or, inside the component:

```tsx
const [seen, setSeen] = useState(initialFollowing);
if (seen !== initialFollowing) { setSeen(initialFollowing); setFollowing(initialFollowing === true); }
```

### WR-05: Single-profile read still serves a blocked member (D-484 "a blocked member disappears" is not whole)

**File:** `packages/core/server/profiles/service.ts:303-316` (`getMemberProfile`), versus `:362-363` (`listMembers`, patched in this phase).

**Issue:** 09-02 added `m.blocked_at is null` to the directory because "status = 'active' covers the status-folded case; the column covers a block that did not move the status". `getMemberProfile` filters only `m.status = 'active' and m.deleted_at is null`. A member blocked through `blocked_at` without a status move keeps a readable `/membros/{id}` (name, bio, avatar, Instagram line) for every tenant member. Follow, counts, directory and Explorar all hide the same person.

The profile page also shows the base profile and silently omits the social block (`not-eligible`), so the UI looks inconsistent. A moderator who blocks a member for harassment expects the profile to go.

**Fix:** Add the same predicate to the single read. This is consistent with the one-line-`and` rule already stated at `listMembers`.

```sql
where mp.membership_id = ${membershipId}::uuid
  and m.status = 'active' and m.blocked_at is null and m.deleted_at is null
```

### WR-06: Ready job fails open for member videos when the provider reports no duration

**File:** `packages/core/server/media/video/event-job.ts:121-125`.

**Issue:** The cap check is `cap !== undefined && duration !== null && duration > cap`. A `video.asset.ready` event with `durationSeconds === null` skips rejection and the asset goes `ready` with `duration_seconds = NULL`.

For a member upload (`duration_cap_seconds` is set) that means:
- the snapshotted cap is not enforced;
- the asset contributes 0 to `memberPostSecondsUsed`, so it also evades the minutes budget;
- `validateAssets` (the publish-time guard, which relies on "the ready job rejects an over-long video") will accept it.

Mux normally sends a duration, so this is an edge. But the code explicitly handles `null`, and the failure mode is the opposite of the member-safe default.

**Fix:** When `row.durationCapSeconds !== null` (a member upload) and `duration === null`, treat it as unmeasurable: reject it, or mark it `failed`, and delete the provider asset. Alternatively, leave it `processing` and retry the event.

### WR-07: Member lane keeps full write privilege on `feed_posts` at the database layer; author-only and audience stability are enforced only in the service

**File:** `packages/modules/feed/db/schema.ts:246` (`tenantIsolationPolicy` is `for: 'all'`), with the new gates at `:259-290`.

**Issue:** Before this phase only `admin_tenant` could write `feed_posts`. Now every member of a `social` tenant holds `feed.post.create` and `feed.post.manage`, and the tenant-lane role is `authenticated` for them too. The isolation policy admits `update` and `delete` of any row in the tenant that the lane can see: organization posts, and followees' posts.

Only `updatePost`/`softDeletePost` WHERE clauses carry authorship (T-04-54). The new restrictive INSERT gate pins the audience at insert time. There is no update-time backstop: nothing stops an `update feed_posts set visibility = 'tenant'` or `author_user_id = ...` from a member lane if any statement in the service ever regresses.

The phase's own premise is "defense in depth" for the audience axis, and the audience column is the one value the whole feature protects.

**Fix:** Add two restrictive policies:
- `for update` with `using/with check (app.tenant_role() <> 'member' or (author_user_id = app.user_id() and visibility = 'followers'))`.
- `for delete` with `using (app.tenant_role() <> 'member' or author_user_id = app.user_id())`.

Repeat this for `feed_post_media` and `feed_comments` if they have the same "for all" shape. Add a pgTAP negative test for each.

### WR-08: Photo cap is re-judged at `complete` against the CURRENT tenant policy, contradicting "limits apply to new uploads only"

**File:** `packages/core/server/media/service.ts:434-439` (start) versus `:715-721` (complete).

**Issue:** The video cap is correctly snapshotted at start (`duration_cap_seconds`). The photo byte cap is not. `completeUpload` re-reads `memberMediaPolicyFor(ctx)` and rejects with `too_large` if the object exceeds the policy in force NOW. If the platform admin lowers `photoMaxBytes` between a member's `start` and `complete`, an upload that was legitimately accepted is rejected. The object is removed (`reject` deletes it).

When `social` is turned off in that window the policy is null and the cap silently reverts to the admin limit, which is wider. The platform sheet advertises "applies to new uploads only".

**Fix:** Snapshot `maxBytes` on the asset row (the same column pattern as `duration_cap_seconds`, or reuse `bytes` declared at start and check `info.size <= declaredBytes`). The start path already judged `body.size` against the cap, so `complete` only needs to enforce `info.size <= row.bytes`.

## Info

### IN-01: Pre-existing member-authored posts and `postingPolicy: 'members'` tenants are not migrated

**File:** `supabase/migrations/20261019211658_feed_social_visibility.sql:20`; `apps/web/lib/feed-view.tsx:253-268`.

**Issue:** The `visibility` default backfills every existing row as `'tenant'`. A tenant that previously set `settings.postingPolicy = 'members'` therefore loses member authoring on deploy, because the setting is no longer read. Its already-published member-authored posts stay organization posts, and `postAdminLabel` now gives them the admin crown. Before, the crown was suppressed for the `members` policy. I did not find such a tenant in the seed or migrations, so this is a risk to confirm for homolog and production rather than a certain defect.

**Fix:** Before enabling, run `select tenant_id from tenant_modules where module_key = 'feed' and settings->>'postingPolicy' = 'members'`. If any rows come back, decide whether to backfill those authors' posts to `followers` or keep the old behavior. Record the decision.

### IN-02: Stale API documentation says members cannot start uploads

**File:** `apps/api/src/routes/media.ts:132-134` (the 403 description "only an admin may start a video upload in V1; members publish nothing yet").

**Issue:** Since 09-06 a member may start a `post` video when `social` is effective and member video is enabled. The OpenAPI text is now wrong for a public contract.

**Fix:** Update the description to the three conditions (role `member`, purpose `post`, `social.video.enabled`).

### IN-03: `FollowListRow`, `FollowCounts` and "Encontrar pessoas" use plain `<a href>` (full document load)

**File:** `packages/modules/social/ui/FollowListRow.tsx:34`, `packages/modules/social/ui/FollowCounts.tsx` (the cell anchor), `apps/web/app/(app)/perfil/SocialList.tsx` (`<a href="/membros">`).

**Issue:** The module stays Next-free (MOD-02), but the host never injects a link component. Every tap on a list row, a count cell or the empty-state CTA is a hard navigation in an installed PWA: lost SPA state, a service-worker round trip and a visible flash.

**Fix:** Let the host pass a `linkAs` or `renderLink` prop (props-only, so MOD-02 holds), or move the anchors into `apps/web/components/social`.

### IN-04: `InicioTabs` imports `HubTabs` from the courses route folder

**File:** `apps/web/app/(app)/inicio/InicioTabs.tsx:4`.

**Issue:** `@/app/(app)/cursos/HubTabs` is a page-private component of another feature. Removing or renaming the courses route (MOD-03 reversibility) breaks Início. The comment elsewhere states "the `cursos/tabs.ts` shape" as precedent, so the coupling is deliberate, but it is a cross-feature import from an `app/` folder.

**Fix:** Move `HubTabs` to `apps/web/components/navigation/` or similar and import it from there in both places.

### IN-05: Member re-edit is blocked after a tenant lowers `photosPerPost`

**File:** `packages/modules/feed/server/service.ts:394-396` (`memberRules`, `updatePost` call at `:1414-1421`).

**Issue:** Any edit that replaces media (even adding one photo) re-applies the CURRENT `photosPerPost` to the whole set. A member with 4 photos on an old post can no longer touch its media once the cap is lowered to 2. Caption-only edits are fine. This conflicts mildly with "nothing already published is hidden by a later change".

**Fix:** In an edit, only count images that are not already attached to the post (`images.length - existingImageCount > allowance`), or compare against `max(policy.photosPerPost, existingImageCount)`.

### IN-06: `listSide` inner-joins `member_profiles`, so a follower without a profile row is counted but not listed

**File:** `packages/modules/social/server/service.ts:218`; `supabase/migrations/20261019204737_social_functions.sql:75-101` (`app.social_counts`).

**Issue:** `social_counts` counts live memberships. `listSide` additionally requires a `member_profiles` row. If any membership lacks a profile (the invite and accept paths create one, but the schema does not enforce it), the public count is higher than the private list. The postProjection also inner-joins profiles, so such an author's posts vanish from every feed.

**Fix:** Either have `social_counts` join `member_profiles` for consistency, or add a database constraint or trigger that guarantees one profile per membership. Add a pgTAP check that fails on any membership without a profile.

---

_Reviewed: 2026-10-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
