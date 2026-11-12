---
phase: 10-rede-social-member-stories-and-communities
reviewed: 2026-11-12T00:00:00Z
depth: deep
files_reviewed: 84
files_reviewed_list:
  - apps/api/src/modules/registry.ts
  - apps/web/app/(app)/comunidades/CommunitiesList.tsx
  - apps/web/app/(app)/comunidades/CommunityForm.tsx
  - apps/web/app/(app)/comunidades/CommunityLimitNotice.tsx
  - apps/web/app/(app)/comunidades/[communityId]/CommunityPosts.tsx
  - apps/web/app/(app)/comunidades/[communityId]/DeleteCommunityControl.tsx
  - apps/web/app/(app)/comunidades/[communityId]/destaques/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/editar/page.tsx
  - apps/web/app/(app)/comunidades/[communityId]/page.tsx
  - apps/web/app/(app)/comunidades/actions.ts
  - apps/web/app/(app)/comunidades/nova/page.tsx
  - apps/web/app/(app)/comunidades/page.tsx
  - apps/web/app/(app)/criar/ComposerForm.tsx
  - apps/web/app/(app)/criar/actions.ts
  - apps/web/app/(app)/criar/page.tsx
  - apps/web/app/(app)/inicio/ExplorarBody.tsx
  - apps/web/app/(app)/inicio/ExplorarSkeleton.tsx
  - apps/web/app/(app)/inicio/ExplorarStoriesRow.tsx
  - apps/web/app/(app)/inicio/page.tsx
  - apps/web/app/(app)/stories/highlight-actions.ts
  - apps/web/app/(app)/stories/meus/StoryHistoryList.tsx
  - apps/web/app/(app)/stories/meus/page.tsx
  - apps/web/app/(app)/stories/publicar/StoryComposer.tsx
  - apps/web/app/(app)/stories/publicar/page.tsx
  - apps/web/app/(app)/stories/story-actions.ts
  - apps/web/app/(platform)/plataforma/tenants/[id]/modulos/page.tsx
  - apps/web/components/admin/ModerationLogRow.tsx
  - apps/web/components/feed/PostDetail.tsx
  - apps/web/components/platform/SocialLimitsSheet.tsx
  - apps/web/components/stories/HighlightManager.tsx
  - apps/web/components/stories/StoriesSurface.tsx
  - apps/web/components/stories/StoryViewerHost.tsx
  - apps/web/components/stories/StoryVisibilityNotice.tsx
  - apps/web/lib/communities.ts
  - apps/web/lib/feed-view.tsx
  - apps/web/lib/moderation-view.ts
  - apps/web/lib/platform.ts
  - apps/web/lib/registry.tsx
  - apps/web/lib/social-limits.ts
  - apps/web/lib/stories.ts
  - apps/web/lib/story-view.ts
  - packages/contracts/src/moderation.ts
  - packages/core/db/schema/moderation-log.ts
  - packages/core/server/communities/action-gate.ts
  - packages/core/server/communities/member-policy.ts
  - packages/core/server/media/member-policy.ts
  - packages/core/server/media/member-share.ts
  - packages/core/server/media/service.ts
  - packages/core/server/moderation/log.ts
  - packages/core/server/safety/index.ts
  - packages/core/server/safety/limits.ts
  - packages/modules/communities/contracts/index.ts
  - packages/modules/communities/db/schema.ts
  - packages/modules/communities/module.ts
  - packages/modules/communities/server/routes.ts
  - packages/modules/communities/server/service.ts
  - packages/modules/communities/ui/CommunityCard.tsx
  - packages/modules/communities/ui/CommunityHeader.tsx
  - packages/modules/feed/contracts/index.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/server/notifications.ts
  - packages/modules/feed/server/service.ts
  - packages/modules/feed/ui/FeedList.tsx
  - packages/modules/feed/ui/PostCard.tsx
  - packages/modules/feed/ui/PostMenu.tsx
  - packages/modules/social/contracts/index.ts
  - packages/modules/stories/contracts/index.ts
  - packages/modules/stories/db/schema.ts
  - packages/modules/stories/server/notifications.ts
  - packages/modules/stories/server/routes.ts
  - packages/modules/stories/server/service.ts
  - packages/modules/stories/ui/HighlightSheet.tsx
  - packages/modules/stories/ui/StoriesStrip.tsx
  - packages/modules/stories/ui/StoryCircle.tsx
  - packages/modules/stories/ui/index.ts
  - scripts/seed.ts
  - supabase/migrations/20261111143858_member_communities_functions.sql
  - supabase/migrations/20261111143948_member_communities.sql
  - supabase/migrations/20261111144148_feed_community_audience.sql
  - supabase/migrations/20261111144205_feed_member_update_allowlist.sql
  - supabase/migrations/20261111145716_member_stories.sql
  - supabase/migrations/20261111150352_story_media_gate.sql
  - supabase/migrations/20261111151218_moderation_member_content.sql
  - supabase/migrations/20261111163020_member_stories_authors.sql
findings:
  critical: 0
  warning: 6
  info: 5
  total: 11
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-11-12
**Depth:** deep (cross-file: migrations -> kernel seams -> module services -> routes -> web screens)
**Files Reviewed:** 84
**Status:** issues_found

## Summary

I traced the eight migrations, the community creator rule and its 403/404 order, the per-member limit lock, the story
audience gate, the moderation paths and the member-community leakage paths into Início, Explorar and Reels.

What holds up under review:

- The two new security-definer functions pin `search_path = ''`, qualify every name, pin `tenant_id = app.tenant_id()`,
  are revoked from PUBLIC and granted to `authenticated` only.
- The per-member limit is race-proof: the advisory lock is taken before the count in both create and reactivate paths, and
  I found no lock-order cycle with the `for update of c` row lock.
- No member-community post reaches Início, Explorar or Reels "Todos". The Explorar and Reels fragments both name
  `p.visibility = 'followers'` / `'tenant'` literals, and the moderator branch of `memberPostVisible` is not used by those
  two lists.
- Every moderation log write happens in the same transaction as the write it records, and the writer refuses a
  subject/action pair the CHECK would refuse.
- Notification sources fail closed for `'community'` posts and non-`'tenant'` stories.

I found no cross-tenant leak and no data-loss path. The findings are defense-in-depth gaps in the database layer, one
unreachable moderation control, one regression in the module-off behaviour of a web door, and a few contract/copy drifts.

## Warnings

### WR-01: A moderator's removal of a member-community post is unreachable from the UI (`removal` flag never set for `'community'`)

**File:** `packages/modules/feed/server/service.ts:317` (consumer: `packages/modules/feed/ui/PostMenu.tsx`, `apps/web/components/feed/PostDetail.tsx:210`)
**Issue:** Plan 10-06 (A3, MCOMM-11) widened `softDeletePostInTx` so a holder of `moderation.manage` can remove a single post
inside a member community (`p.visibility in ('followers', 'community')`, line 1721). `toPost` still emits
`removal: 'moderation'` only for `row.visibility === 'followers'`:

```ts
...(canModerate && row.visibility === 'followers' && row.author_user_id !== viewerUserId
  ? { removal: 'moderation' as const }
  : {}),
```

The menu decides its rows from that flag ("the menu decides its rows and wording from the post's own data, never a role"),
so a moderator looking at a post in a member community gets no "Remover" row. The server path works, but the only
remedy a moderator can reach in the UI is archiving or removing the whole community, which is exactly what A3 set out to
avoid. The plan 10-05 and 10-06 summaries record this as "a later plan" and no later plan in the reviewed set closes it
(`FeedList.tsx` only widens `memberPost`).
**Fix:**
```ts
...(canModerate &&
  (row.visibility === 'followers' || row.visibility === 'community') &&
  row.author_user_id !== viewerUserId
  ? { removal: 'moderation' as const }
  : {}),
```
Add a case to the feed read tests: a moderator listing a member community's page sees `removal: 'moderation'` on the
creator's post.

### WR-02: `viewer.actions.story` reuses `canPublish` (post rule), so the community "+ Seu story" door appears where stories cannot be published

**File:** `packages/modules/communities/server/service.ts:293-301`, consumed at `apps/web/app/(app)/comunidades/[communityId]/page.tsx:351-357`
**Issue:** `viewerOf` sets `actions.story: canPublish`, and `canPublish` is `flags.canPostOrg` (feed permissions) for an
organization community and `isOwner && flags.canManageOwn` for a member one. The story rule is a different permission
set: `canCurate` (`stories.story.manage` / `isOwner && stories.story.publish`) is computed two lines above and not used for
`actions.story`. The web replaced the old gate (`STORY_PERMISSIONS.publish && STORY_PERMISSIONS.manage`) with
`!archived && viewer.actions.story`.

Module-off consequence (review area 6): with the `stories` module off and `communities` on, an admin
(`feed.post.create` + `content.publish`) or a member creator (`manage_own`, composed with `social` + `communities` only)
still has `actions.story === true`. The community page then draws the dashed "Seu story" circle pointing at
`/stories/publicar?comunidade=...`, and that route redirects to `/inicio` because the `stories.story.publish` permission
is not composed (`apps/web/app/(app)/stories/publicar/page.tsx:76`). Before this phase the door required the story
permissions and was absent.
**Fix:** compute the story action from the story keys:
```ts
const canStory = member ? isOwner && flags.canPublishStory : flags.canCurateOrg && flags.canPostOrg;
// ...
actions: { like: true, comment: true, share: true, post: canPublish, story: canStory },
```
(or keep `canPublish && flags.canPublishStory` for member rows). Add a viewer-flag unit case with the `stories` module off.

### WR-03: No row-level write guard on `stories`, `story_highlights`, `story_highlight_items`; member write lane now exists

**File:** `packages/modules/stories/db/schema.ts:174, 282, 320`; `supabase/migrations/20261111145716_member_stories.sql`
**Issue:** Phase 10 opens the member lane to `stories` (publish, delete, curate). The only policies that write-gate the
table are `stories_tenant_isolation` (`FOR ALL`, tenant predicate only) and the new insert gate. There is no UPDATE or
DELETE gate pinning author or audience, unlike `communities` (four restrictive gates in this same phase) and `feed_posts`
(the member update allow-list trigger, rewritten in this phase). At the database layer any `authenticated` member lane
can therefore `UPDATE stories SET visibility = 'tenant'` on a story it can read (widening a followers-only story to the
organization's audience), soft-delete another member's story, or insert and delete highlight items in a community it does not own.
Today the API's service checks (`deleteStory` permitted test, `curatableStory`, `resolveHighlightPlace`) are the only layer.

This is within one tenant, so it is not a cross-tenant leak, but the project rule is "RLS defense-in-depth on every
table" and the Phase 9 advisory this phase closes for posts (T-10-05) is the same class. `story_highlights` and
`story_highlight_items` also carry no `social` or owner term.
**Fix:** add restrictive UPDATE/DELETE policies (or an invoker guard trigger like `feed_posts_member_update_guard`) for the
member claim: a member may change only `deleted_at`/`deleted_by` on a row where `author_user_id = app.user_id()`, never
`visibility`, `author_user_id`, `media_asset_id`; and member writes to highlights/items only where the highlight's
community is a member community it created. Cover with a pgTAP negative test per policy.

### WR-04: `feed_posts_social_insert_gate` does not enforce the creator rule for staff lanes; the service docblock claims it does

**File:** `supabase/migrations/20261111144148_feed_community_audience.sql:19`; claim at `packages/modules/feed/server/service.ts:1207`
**Issue:** The staff branch of the insert gate is `app.tenant_role() <> 'member' and visibility = 'tenant'`, with no
`community_id` or `kind` condition. `resolveCommunityTarget` documents "An admin can therefore never publish in a member
community (RLS `feed_posts_social_insert_gate` says the same)". It does not: at the database an `admin_tenant` lane can insert a
`'tenant'` post with `community_id` of a member community. Such a row passes `feed_posts_social_gate`
(`visibility = 'tenant'`) and the `communities` gates, and it would appear in Início (`p.visibility = 'tenant'`
with communities on) next to the organization's own voice, i.e. member-community content leaking into the main feed
under the "Administrador" mark. The API path is closed (403 at the service), so this is a missing second layer plus a
false comment that will mislead the next reviewer.
**Fix:** add to the staff branch a community kind term, e.g.
```sql
or (app.tenant_role() <> 'member' and visibility = 'tenant'
    and (community_id is null or exists (
      select 1 from public.communities c
       where c.id = community_id and c.tenant_id = app.tenant_id() and c.kind = 'organization')))
```
and correct the docblock if the term is not added.

### WR-05: `app.media_asset_hidden` does not close the video of a hidden member community's post

**File:** `supabase/migrations/20261111150352_story_media_gate.sql:44-132` (blocks A and C, lines 47-64 and 114-131)
**Issue:** D-708 says a blocked or departed creator's content leaves every read, and this migration is the "video is not
playable outside the audience" gate for stories. For feed posts the first leg (A) hides an asset only for locked
communities and `'followers'` posts. A `'community'` post whose community is in `app.member_community_hidden_ids()` is
still hidden by RLS for reads, but its video asset answers `false` here (not hidden), so `playbackTokens` mints a token for
anyone who still holds the asset id. The story legs of the same function do apply the hidden-community term
(`c.id <> all (... member_community_hidden_ids())`, line 100), so the two halves are inconsistent. Photos stay the accepted
id-capability residual; video is the one path the function exists to close.
**Fix:** add a leg to the hiding group, and to the `not exists` exemption C, for a live post whose
`community_id = any (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[]))`, mirroring the story branch.
Add a pgTAP case: a blocked creator's community video answers hidden.

### WR-06: Story viewer's "Destacar" / curator menu is keyed on `stories.story.manage`, not on the API's per-community flag

**File:** `apps/web/app/(app)/comunidades/[communityId]/page.tsx:405` (also `apps/web/app/(app)/stories/[storyId]/page.tsx:108`)
**Issue:** The page's own comment (line 172) says every control is decided by the API's `viewer` flags and nothing else, but
the viewer is given `canCurate: bootstrap.permissions.includes(STORY_PERMISSIONS.manage)`. In a MEMBER community:
(a) an admin holding `stories.story.manage` gets the curator menu ("Destacar", delete) on the member's stories, and
"Destacar" can only fail (`curatableStory` answers the bare 404 for a member story, the catalog offers organization places only);
(b) the creator, who holds `stories.story.publish` but not `manage`, gets no curator menu on their own highlight stories, even
though `viewer.canCurate` is true for them on this very page (line 288 uses it for the manage circles).
**Fix:** pass the community's flag: `canCurate: viewer.canCurate`, and keep the moderator delete for a member story on the
`memberMenu.canModerate` path.

## Info

### IN-01: Stale comment: a member's `limit_reached` is a 400, not a 409

**File:** `apps/web/app/(app)/comunidades/actions.ts:303`
**Issue:** The docblock says the create "answers with a `409` once they own as many active communities as allowed". The API
(`communities/server/service.ts:835`, contract `communities/contracts/index.ts` docblock) answers
`400 VALIDATION_FAILED { community: 'limit_reached' }`. The code maps by `details.community` so behaviour is right, but the
comment will mislead a reader who filters on status.
**Fix:** change "a `409`" to "a `400 VALIDATION_FAILED`".

### IN-02: Stale OpenAPI text on the media start route

**File:** `apps/api/src/routes/media.ts:129`
**Issue:** The 403 description still says "A member may start a video only for purpose `post` ... Every other video start
(story, lesson) ... is refused". Plan 10-07 widened it to `post` and `story` (`memberVideoPurposeAllowed`). Published
contract text now disagrees with `startUpload`.
**Fix:** update the description to "`post` or `story`".

### IN-03: `listStoryAuthors` accepts a `scope.isMember` it never reads

**File:** `packages/modules/stories/server/service.ts:526-530`
**Issue:** The parameter type declares `isMember` and the docblock says the route's guard reads it, but the function only
branches on `canModerate`. Dead input invites a future caller to rely on it.
**Fix:** drop `isMember` from the parameter type, or document that it is informational only.

### IN-04: Staff UPDATE of `communities` can change `kind`

**File:** `supabase/migrations/20261111143948_member_communities.sql:17`
**Issue:** `communities_member_update_gate` WITH CHECK pins `kind = 'member'` only for the member claim; the staff branch is
`app.tenant_role() <> 'member'` with no `kind` condition, so a staff lane can flip a row's kind (the position CHECK only
requires sentinel position 1000000 for a member row). No API path does this, but `kind` is stamped-at-creation by design (D-707) and nothing
at the database says it is immutable.
**Fix:** add `kind = (select c.kind ...)` is not expressible in a policy; use a small `before update` trigger refusing
`new.kind is distinct from old.kind`, or document the stamp as service-only.

### IN-05: Abuse limiters are per instance

**File:** `packages/core/server/safety/limits.ts:24-42`
**Issue:** `communityCreateLimiter` and `storyPublishLimiter` are in-process (the report-limiter pattern). Cloud Run with
several instances multiplies the 10/hour and 30/hour ceilings by the instance count. The plan flags the numbers as
adopted, not the scaling; the true bound on community creation is the per-member active limit (race-proof), so this is
low impact for communities and only a soft ceiling for stories.
**Fix:** none required for release; note the per-instance behaviour in `docs/DEPLOY.md` next to the numbers.

---

_Reviewed: 2026-11-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
