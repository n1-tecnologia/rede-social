---
phase: 09-rede-social-follow-member-posts-and-explorar
reviewed: 2026-10-20T00:00:00Z
depth: standard
round: gap-round (plans 09-14..09-17), diff 86cc57e9..HEAD
files_reviewed: 31
files_reviewed_list:
  - apps/api/src/routes/media.ts
  - apps/api/tests/integration/media-playback.test.ts
  - apps/api/tests/integration/moderation-posts.test.ts
  - apps/api/tests/integration/social-media.test.ts
  - apps/web/components/social/FollowControl.test.tsx
  - apps/web/components/social/FollowControl.tsx
  - apps/web/components/social/SocialCountsBlock.test.tsx
  - apps/web/components/social/SocialCountsBlock.tsx
  - docs/DEPLOY.md
  - packages/core/db/social-gate.ts
  - packages/core/server/media/member-share.ts
  - packages/core/server/media/service.ts
  - packages/core/server/media/video/duration-verdict.ts
  - packages/core/server/media/video/event-job.ts
  - packages/core/tests/media-duration-verdict.test.ts
  - packages/modules/feed/db/schema.ts
  - packages/modules/feed/server/notifications.ts
  - packages/modules/feed/tests/notification-sources.test.ts
  - packages/modules/social/README.md
  - supabase/migrations/20261020123217_social_audience_revocation.sql
  - supabase/migrations/20261020123622_feed_social_member_write_gate.sql
  - supabase/migrations/20261020123631_feed_member_update_guard.sql
  - supabase/migrations/20261020123859_social_can_read_for.sql
  - supabase/migrations/meta/20261020123217_snapshot.json
  - supabase/migrations/meta/20261020123622_snapshot.json
  - supabase/migrations/meta/20261020123631_snapshot.json
  - supabase/migrations/meta/20261020123859_snapshot.json
  - supabase/migrations/meta/_journal.json
  - supabase/tests/201-feed-social-gate.sql
  - supabase/tests/202-feed-member-write-gate.sql
  - supabase/tests/203-social-can-read-for.sql
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
---

# Phase 9: Code Review Report (gap round, re-review)

**Reviewed:** 2026-10-20
**Depth:** standard
**Files Reviewed:** 31 (the gap-round diff `86cc57e9..HEAD` only)
**Status:** issues_found

## Summary

The four gap plans do what they claim. I checked each claim against the source, not the SUMMARYs:

- `app.media_asset_hidden` now keeps a soft-deleted followers post's video closed. The `A or B and not C` rule is correct: a live visible carrier still wins, and the staff exemption holds only while `social` is on.
- The update guard does not block the like/comment counter triggers, the soft-delete path, or the moderator.
- `app.social_can_read_for` is `SECURITY DEFINER` with `search_path = ''`. Every statement pins `tenant_id = app.tenant_id()`, EXECUTE is revoked from PUBLIC and granted to `authenticated` only, and the whole body is wrapped in `coalesce(…, false)`, so it cannot answer null. It cannot be used as a follow-graph oracle by a non-system lane.
- `FollowControl` and `SocialCountsBlock` use the sanctioned render-phase "adjust state when a prop changes" pattern. All hooks run before the early return, there is no loop (the `seen` copy converges in one extra render), and a re-render with the same prop does not clobber a confirmed tap.
- Drizzle schema, generated SQL, snapshots and journal agree (the snapshot chain `prevId` links, the policy sets match).
- The DEPLOY.md migration list matches `ls supabase/migrations` (14 files, same order).
- The pgTAP `plan(n)` counts equal the assertion counts in 201, 202 and 203.
- No `autonhealth` mention and no Claude attribution in any changed file or in the commits since 86cc57e9.

No critical issues. The findings below are one sibling of the closed WR-02 leak, one incomplete backstop in the new update guard, one new lockout vector created by widening the member byte share, one fail-open ordering in the new `unmeasurable` branch, and one false release-gate statement in DEPLOY.md.

## Warnings

### WR-01: DEPLOY.md claims the Phase 8 step 1 grep "printed nothing" for files 11 to 14; it prints two hits

**File:** `docs/DEPLOY.md:2143-2148` (also `supabase/migrations/20261020123622_feed_social_member_write_gate.sql:10`, `supabase/migrations/20261020123631_feed_member_update_guard.sql:39`)
**Issue:** The doc says the grep `drop (table|column)|rename|set not null|alter column .* type` "prints nothing for these fourteen files; it was re-run over files 11 to 14 for this release and printed nothing". The documented command is `grep -inE` (DEPLOY.md:1073). I ran it over `supabase/migrations/20261020*.sql`:

```
20261020123622_...member_write_gate.sql:10:-- Expand-only: five `CREATE POLICY`, nothing dropped or renamed.
20261020123631_...member_update_guard.sql:39:-- nothing dropped or renamed.
```

`rename` matches the word "renamed" in two comments. The operator who follows the release step literally gets two hits on a step whose rule is "anything else means stop and ask". Either they stop a legitimate release, or they learn to ignore the gate. The false "printed nothing" statement is the same class of defect the doc exists to prevent. The migrations themselves are expand-only.
**Fix:** Reword the two SQL comments so the grep is clean (for example "nothing removed or altered"), and keep the doc claim. Do not edit the already-recorded migration timestamps. If the migration files are considered frozen, change the doc to say the two hits are comment text. Re-run the exact `grep -inE` before recording the claim.

### WR-02: The member update guard lets the author clear `deleted_at` / `deleted_by_user_id` (undo a moderator takedown) and rewrite the counters of their own post

**File:** `supabase/migrations/20261020123631_feed_member_update_guard.sql:41-62` (and `packages/modules/feed/db/schema.ts:289-305` which describes it as the audience backstop)
**Issue:** For a post the member wrote (`old.author_user_id = app.user_id()`) the first branch is skipped. The second branch pins only `author_user_id`, `visibility`, `community_id` and `tenant_id`. Everything else is free for the author in the member lane, including:

- `deleted_at := null` and `deleted_by_user_id := null` on a post a moderator removed (D-475, SOCIAL-07). The takedown is then reversible by the person it was applied to.
- `like_count` / `comment_count` set to arbitrary values.
- `created_at` / `published_at`-style ordering columns.

Today `updatePost` filters on `deleted_at is null` (service.ts:1459-1466) and no member route clears `deleted_at`, so this is not reachable through the API. But the phase's own stated purpose (WR-07, "if any statement in the service ever regresses") is a database backstop, and the takedown is the one write the backstop most needs to hold. The adjacent column-drift concern is also open: a future column that the author must not edit (for example a pin or moderation state) is silently editable by default, because the author branch is a deny-list of four columns instead of an allow-list.
**Fix:** In the guard, make the author's edit set an allow-list, or at minimum forbid undeleting and the audit column:

```sql
-- after the author/audience check
if old.deleted_at is not null
   and (new.deleted_at is distinct from old.deleted_at
        or new.deleted_by_user_id is distinct from old.deleted_by_user_id) then
  raise exception 'a member may not change a removed post' using errcode = '42501';
end if;
-- and, for the author, restrict the writable set:
if (to_jsonb(new) - array['caption','media_kind','link_preview_id','edited_at',
                          'deleted_at','deleted_by_user_id','like_count','comment_count'])
   is distinct from
   (to_jsonb(old) - array['caption','media_kind','link_preview_id','edited_at',
                          'deleted_at','deleted_by_user_id','like_count','comment_count']) then
  raise exception 'a member may not change that column' using errcode = '42501';
end if;
```

Add a pgTAP case to 202 for "author cannot restore a post the admin removed".

### WR-03: `comment.liked` still notifies a comment author who lost access to a followers-only post (sibling of the closed WR-02)

**File:** `packages/modules/feed/server/notifications.ts:212-255` (`resolveCommentLiked`)
**Issue:** 09-15 closed the audience hole on the reply branch, but the like branch reads the same kind of thread and does not select `visibility` at all. Sequence: X follows A and comments on A's followers post, X unfollows A (or A is blocked, or `social` is turned off), Y (a follower) likes X's comment. `resolveCommentLiked` returns a bell row for X with `subject: { type: 'post', id }`, `object: { type: 'comment', id }`, the actor (Y), and a link into a post X can no longer read. The excerpt is X's own text, so no foreign text leaks, but the notice still reveals that activity exists on a thread X is shut out of and who took part in it. This is the same "what can a stranger learn" axis WR-02 was filed under. The like kind is not pushed (D-235), so it is in-app only, which is why it is a warning and not higher. Accepted residual A5 covers rows written before a revocation; this row is written after.
**Fix:** Select `p.visibility`, `p.author_user_id`, the `author_live` and `social_on` columns exactly as `resolveCommentCreated` does, and apply the same `socialCanReadFor(row.author_user_id, row.post_author_user_id)` probe when `visibility !== 'tenant'`. Factor the "followers audience check" into one helper used by both resolvers so a third resolver cannot forget it. Add the matching cases to `notification-sources.test.ts`.

### WR-04: Widening the member byte share to every purpose lets one member lock all members out of photo and avatar uploads for up to 24 hours with declared-size starts

**File:** `packages/core/server/media/member-share.ts:35-50`, `packages/core/server/media/service.ts:478-489` (`startUpload` image branch)
**Issue:** `memberBytesUsed` sums `media_assets.bytes` of every non-deleted, non-video row owned by any current `member`, whatever its status. A `pending` row counts at its DECLARED size, and the signed upload URL carries no size, so a member never has to upload a byte. One member can call `POST /v1/media/uploads` repeatedly with the largest allowed declared size (for example 15 MiB, purpose `attachment` or `post`), until `memberBytesUsed + size > floor(0.5 * 800 MiB)`, which is roughly 27 requests. From then on every member's `start` is refused with `quota_exceeded`, including the new case 09-16 added: avatars and covers. The rows are only reclaimed by the pending sweeper after 24 hours, and a `rejected` row keeps counting until the sweeper collects it. The old purpose-`post`-only rule had the same shape for post photos; widening the rule to avatars turns a "no new post photos" outage into a "no profile photo for anybody" one. DEPLOY.md documents this price for video ("a few members starting videos at once can fill the share") but not for bytes, and the open "no rate limit" item is the only mitigation.
**Fix:** Bound one member's share of the member share, or stop counting what is not stored. Options, cheapest first:
- Count only rows that are `processing`/`ready` plus the caller's OWN pending rows (a stranger's unconfirmed declared size should not block anyone else).
- Add a per-member pending cap (for example at most 3 pending image rows per `owner_user_id`) inside the same transaction.
- Exempt `avatar` from the member share (a few hundred KB, one live per member), which also fixes the profile-photo side effect.

State the residual in the DEPLOY.md item either way.

### WR-05: The fail-closed `unmeasurable` branch deletes the provider asset before checking the row is not already `ready`

**File:** `packages/core/server/media/video/event-job.ts:157-176` (same ordering in the pre-existing `too_long` branch at `:134-155`)
**Issue:** `applyReady` calls `deleteProviderAsset(providerAssetId)` first and only then runs the conditional update (`status not in ('ready','deleted')`), whose `stale` result is discarded. `Resolved` does not carry the row status. If a ready event with `durationSeconds === null` is delivered for a MEMBER video that already went `ready` with a measured duration (a reconcile poll that races the webhook and gets no `duration` from the provider, or a redelivery whose payload lacks it), the row correctly stays `ready` (`stale`), but the Mux asset behind its `playback_id` is deleted. The result is a `ready` row whose playback fails permanently, with the data gone at the provider and no signal in the DB. WR-06 made this reachable for the first time for member rows: before, a null duration never reached the delete.
**Fix:** Do the conditional update first and delete the provider asset only when it changed a row:

```ts
const updated = await withAdminTx(/* set failed ... returning id */);
if (updated.length > 0) {
  const providerAssetId = event.providerAssetId ?? row.providerAssetId;
  if (providerAssetId) await deleteProviderAsset(providerAssetId);
}
return updated.length === 0 ? 'stale' : 'failed';
```

Apply the same reorder to `too_long`. If the delete must precede (to avoid a window where a `failed` row's asset lives), select `status` in `resolveAsset` and return `'stale'` before any provider call when it is `ready`. Add a test: ready row plus ready event with null duration leaves the row ready and calls no `deleteAsset`.

## Info

### IN-01: Comments claim "a null role makes the predicate null, which denies"; for an author's own row the predicate is true

**File:** `packages/modules/feed/db/schema.ts:296` and `:401`, `supabase/migrations/20261020123622_feed_social_member_write_gate.sql:6`
**Issue:** The restrictive delete and media policies read `app.tenant_role() <> 'member' or author_user_id = app.user_id()`. With a null role the left side is null, and `null or true` is true, so a null-role session whose `app.user_id()` matches the row's author passes; only a non-matching row (`null or false` = null) is denied. The same lane is also not held at all by the update guard (`coalesce(app.tenant_role(), '') <> 'member'` returns `new`). The comment overstates the fail-closed property. No exploit: a null-role session is already shut out of these tables by the tenant isolation policy, which is what actually carries the claim.
**Fix:** Reword the comments ("a null role does not reach these tables; tenant isolation already refuses it"), or write the predicates as `coalesce(app.tenant_role(), 'member') <> 'member' or ...` so a null role is held like a member.

### IN-02: `socialCanReadFor` is documented as never raising, but a malformed id throws at the cast

**File:** `packages/core/db/social-gate.ts:64-73`
**Issue:** The docblock says the function answers false and "never null for a well-formed pair". The TypeScript helper casts with `${userId}::uuid`; a malformed or empty id raises `invalid input syntax for type uuid` in the caller's transaction, aborting it. Today both ids come from `feed_comments` / `feed_posts` rows, so the input is always a uuid, and the notification test covers the fail-closed null answer. It is only a trap for the next caller (a route that passes a request field).
**Fix:** Keep the cast, but state in the docblock that ids must come from the database, or accept `uuid` branded types.

---

## Carried forward from round 1 (not re-reviewed)

Source for every line: `git show 86cc57e9:.planning/phases/09-rede-social-follow-member-posts-and-explorar/09-REVIEW.md`. These items were not touched by plans 09-14..09-17 and stay open. They do not count toward the totals in the frontmatter.

- WR-05: Single-profile read still serves a blocked member (D-484 "a blocked member disappears" is not whole), `packages/core/server/profiles/service.ts:303-316` vs `:362-363` -- open.
- IN-01: Pre-existing member-authored posts and `postingPolicy: 'members'` tenants are not migrated, `supabase/migrations/20261019211658_feed_social_visibility.sql:20` -- open.
- IN-03: `FollowListRow`, `FollowCounts` and "Encontrar pessoas" use plain `<a href>` (full document load), `packages/modules/social/ui/FollowListRow.tsx:34` -- open.
- IN-04: `InicioTabs` imports `HubTabs` from the courses route folder, `apps/web/app/(app)/inicio/InicioTabs.tsx:4` -- open.
- IN-05: Member re-edit is blocked after a tenant lowers `photosPerPost`, `packages/modules/feed/server/service.ts:394-396` -- open.
- IN-06: `listSide` inner-joins `member_profiles`, so a follower without a profile row is counted but not listed, `packages/modules/social/server/service.ts:218` -- open.

### Round-1 items the gap round claims to close, with verdicts from the code

- WR-01 (removed or deleted followers video stays playable): **closed** for video playback. `media_asset_hidden` branch B keeps a soft-deleted followers post's video closed for follower, stranger and author, exempts only live staff while `social` is on, and a live visible carrier still wins. The photo-variant half is the accepted residual A6 and is not counted.
- WR-02 (reply notice leaks to a follower-turned-stranger): **closed** for the reply branch (`resolveCommentCreated` probes `socialCanReadFor`, fails closed on null, row-local tests first). The sibling `comment.liked` resolver has the same hole and is new WR-03 above.
- WR-03 (member sub-budget bypass, pending videos uncounted): **partly**. The byte share now covers every purpose and a pending member video is charged at `duration_cap_seconds`, replaced by the measured seconds at ready and released at rejected or failed (video rows stay `pending` until ready, so there is no uncharged `processing` window). But the wider byte share opens the lockout in new WR-04, and the quota remains a read-then-insert soft quota (acknowledged in DEPLOY.md).
- WR-04 (`FollowControl` captures `initialFollowing` once): **closed**. Render-phase resync on a changed prop in both components, no effect, no loop, hooks all ahead of the early return. `SocialCountsBlock` correctly leaves `followingCount` and `viewerFollows` as props.
- WR-06 (ready job fails open for member videos with no duration): **partly**. `judgeDuration` fails closed and the unit test covers the matrix, but the branch deletes the provider asset before the conditional update (new WR-05).
- WR-07 (member lane keeps full write privilege on `feed_posts`): **partly**. The five restrictive DELETE/media policies and the BEFORE UPDATE guard pin author, audience, community and tenant and leave the counter triggers, soft delete and moderator paths working (I traced `feed_like_count`, `feed_comment_count`, `feed_posts_community_stats`, `deletePost`, `updatePost`, `setPostLinkPreview`). The author branch is a four-column deny-list, so a takedown can be undone by the author and counters can be rewritten (new WR-02).
- WR-08 (photo cap re-judged at complete against the current policy): **closed**. `completeUpload` judges against `min(static limit, row.bytes)` (the size accepted at start), strict `>`, so a lowered policy or `social` turned off neither rejects an accepted upload nor widens the ceiling.
- IN-02 (stale API doc says members cannot start uploads): **closed**. The 403 description in `apps/api/src/routes/media.ts` now states the real member-video rule.

---

_Reviewed: 2026-10-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
