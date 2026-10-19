-- feed_social_locked (09-05, SOCIAL-06, D-469, D-483, D-484; RESEARCH Pattern 6) - the feed's two
-- definer lookups over member posts the caller's lane CANNOT see.
--
-- A followers-only member post is invisible to a stranger under the restrictive policy
-- `feed_posts_social_gate`, so "hidden from me" and "absent" look the same to a `select`. D-469 wants
-- ONE difference: a stranger who opens a shared link learns WHO the author is (the web offers "Siga
-- para ver"), and nothing else. Both functions therefore read rows RLS hides, are SECURITY DEFINER,
-- and EVERY statement pins `tenant_id = app.tenant_id()` itself (the `feed_gate_lookups` posture): a
-- lane with no tenant claim gets null / false and an id of another tenant matches no row. Each answers
-- ONE fact, never content.
--
--   1. `app.feed_social_locked_author(p_post) uuid`: the author's USER id, only for a live post of this
--      tenant whose audience is `followers`, while `social` is on, whose author is a live member who is
--      not the caller and not in `app.social_visible_author_ids()` (the caller's followees), and only
--      for a caller whose claim role is `member`. The claim-role condition is how a real
--      `support_tenant` (who cannot follow, D-467), an admin (who reads through the moderator rule and
--      never needs a locked answer) and the system lanes get null: a locked answer would be a dead end
--      for them. The service reads the author's name and avatar in the caller's own lane afterwards, so
--      the one place that decides what a stranger may learn is the service's select list.
--
--   2. `app.feed_social_locked_comment(p_comment) boolean`: true when the comment is a live POST comment
--      of this tenant whose post answers (1) with an author. A comment-id route (like, unlike, replies,
--      thread) needs to choose 403 over 404 and nothing else (UI-D-500: a refusal mid-session is a
--      reaction, not a generic error), so it gets a boolean, never an author.
--
-- Accepted disclosure (T-09-15, the 08.2 T-08.2-09 posture): "this unguessable uuid is a post by X",
-- same tenant only, member callers only.
--
-- Hardening (the T-06-29 posture): `search_path = ''`, fully qualified names; EXECUTE revoked from
-- PUBLIC and granted to `authenticated` only. The seam functions are called as the caller's own.

create or replace function app.feed_social_locked_author(p_post uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.author_user_id
    from public.feed_posts p
    join public.memberships m
      on m.user_id = p.author_user_id and m.tenant_id = p.tenant_id
   where p.id = p_post
     and p.tenant_id = app.tenant_id()
     and p.deleted_at is null
     and p.visibility = 'followers'
     and app.tenant_role() = 'member'
     and (select app.social_enabled())
     and m.role = 'member'
     and m.status = 'active'
     and m.blocked_at is null
     and m.deleted_at is null
     and p.author_user_id <> app.user_id()
     and p.author_user_id <> all (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   limit 1
$$;
--> statement-breakpoint
revoke all on function app.feed_social_locked_author(uuid) from public;--> statement-breakpoint
grant execute on function app.feed_social_locked_author(uuid) to authenticated;--> statement-breakpoint

create or replace function app.feed_social_locked_comment(p_comment uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.feed_comments c
     where c.id = p_comment
       and c.tenant_id = app.tenant_id()
       and c.post_id is not null
       and c.deleted_at is null
       and app.feed_social_locked_author(c.post_id) is not null)
$$;
--> statement-breakpoint
revoke all on function app.feed_social_locked_comment(uuid) from public;--> statement-breakpoint
grant execute on function app.feed_social_locked_comment(uuid) to authenticated;
