-- feed_member_update_guard (09-14, WR-07; SOCIAL-03, SOCIAL-06; D-473, T-04-54 [informational]; T-09-49,
-- T-09-50) — a BEFORE UPDATE guard on `public.feed_posts` for the MEMBER lane.
--
-- WHY A GUARD AND NOT AN UPDATE POLICY (the review's WR-07 sketched a restrictive UPDATE policy narrowed
-- to the author; it was replaced on purpose, in this order):
--   1. The counter triggers `app.feed_like_count()` and `app.feed_comment_count()`
--      (`20260922162449_feed_counters.sql`) are NOT security definer: they run with the invoker's rights
--      and `update public.feed_posts set like_count = like_count + 1` / `comment_count = comment_count + 1`
--      as the member who liked or commented, on a post that member did not write.
--   2. An UPDATE whose USING fails is FILTERED, not refused: it matches zero rows and raises nothing. A
--      restrictive UPDATE policy narrowed to the author would therefore make every non-author's counter
--      update match zero rows WITHOUT an error, and `like_count` / `comment_count` would drift silently
--      for every post a member reacts to. A guard that compares OLD and NEW can tell the two columns the
--      counters own from every other column, which a row filter cannot.
-- WHY ONLY `feed_posts` IS GUARDED: `feed_comments` has two legitimate writers of rows the actor did not
-- write, an author soft-deleting their root comment together with every live reply (replies by OTHER
-- members included, D-334), and the like counter moving `feed_comments.like_count` as the invoker. A guard
-- there would refuse both. The audience of a comment is already enforced through `feed_posts` by
-- `feed_comments_community_gate`; a comment gets the DELETE policy only (`*_feed_social_member_write_gate`).
-- WHO IS NOT HELD: staff and the system lanes. The function returns NEW at once unless the claim is
-- `member`, so the moderator's takedown (`deleted_at` and `deleted_by_user_id` by an `admin_tenant`), the
-- notifications worker and the migration role are untouched; a lane with no role claim is not a member
-- lane and is already shut out of the table by the tenant isolation policy.
--
-- THE RULE for a `member` claim:
--   * on a post it did not write (`OLD.author_user_id` distinct from `app.user_id()`, which also covers a
--     null user), only `like_count` and `comment_count` may change: every other column of the row must be
--     unchanged, so a caption, a media_kind, a link preview or a soft delete of someone else's post is
--     refused;
--   * on ANY post, `author_user_id`, `visibility`, `community_id` and `tenant_id` may not change: the
--     audience, the author and the container of a post are fixed at insert (D-469, D-473). The author
--     keeps editing the caption and media_kind and soft-deleting their own post.
-- A violation raises SQLSTATE 42501 with a fixed message that names no row data.
--
-- SECURITY INVOKER (the default, said here on purpose): the guard reads only OLD, NEW and the claims, so it
-- needs no elevated right, and a definer would be a standing way to bypass the policies it backs up.
-- `set search_path = ''` and fully qualified names anyway (the counters precedent). No single-row pick
-- clause (pgTAP 040 pins the set of app functions that use one). Expand-only: one function and one trigger,
-- nothing dropped or renamed.

create or replace function app.feed_posts_member_update_guard() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if coalesce(app.tenant_role(), '') <> 'member' then
    return new;
  end if;

  if old.author_user_id is distinct from app.user_id()
     and (to_jsonb(new) - array['like_count', 'comment_count'])
         is distinct from (to_jsonb(old) - array['like_count', 'comment_count']) then
    raise exception 'a member may only move the counters of a post it did not write'
      using errcode = '42501';
  end if;

  if new.author_user_id is distinct from old.author_user_id
     or new.visibility is distinct from old.visibility
     or new.community_id is distinct from old.community_id
     or new.tenant_id is distinct from old.tenant_id then
    raise exception 'a member may not change the author, audience, community or tenant of a post'
      using errcode = '42501';
  end if;

  return new;
end
$$;--> statement-breakpoint

grant execute on function app.feed_posts_member_update_guard() to authenticated, service_role, api_user;--> statement-breakpoint

create trigger feed_posts_member_update_guard
  before update on public.feed_posts
  for each row execute function app.feed_posts_member_update_guard();
