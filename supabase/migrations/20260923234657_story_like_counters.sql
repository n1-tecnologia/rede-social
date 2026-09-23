-- story_like_counters — the STORY branch of the like counter Phase 4 reserved (STORY-05, 05-06).
--
-- THIS IS AN EXTENSION OF THE EXISTING FUNCTION, NOT A SECOND TRIGGER, and the distinction is the
-- whole point. `20260922162449_feed_counters.sql` created `app.feed_like_count()` with two branches
-- and said so in its own comment at lines 29-32: "`story_id` is the Phase 5 slot: a story like
-- matches neither branch today and adjusts nothing, which is correct until `stories.like_count`
-- exists." It exists now, so the reserved branch is filled in by REPLACING the function. There is
-- still exactly ONE trigger on `public.feed_likes` (`feed_likes_count`, created by that migration
-- and untouched here) and therefore exactly ONE writer of every like counter in the product.
--
-- A second trigger would be the tempting shape and would be wrong twice over: the two would fire in
-- name order rather than in a stated order, and a reader asking "what writes stories.like_count?"
-- would have to find both.
--
-- WHY THE POSTURE IS COPIED VERBATIM (`language plpgsql set search_path = ''`, fully-qualified
-- names, NO `security definer`): the function runs on the writer's OWN like row, inside the
-- writer's own tenant lane, against a table whose isolation policy the writer already satisfies. It
-- needs no elevated right, so it gets none — an elevated trigger here would be a standing way to
-- move another tenant's counter. The empty search_path plus schema-qualified names costs nothing
-- and makes it immune to a hostile search_path.
--
-- WHY THERE IS NO `greatest(0, …)` CLAMP: a decrement only ever fires on the DELETE of a row that
-- existed, so the counter cannot legitimately go below zero. A clamp would HIDE drift rather than
-- prevent it, and `110-communities-stories.sql` reconciles `stories.like_count` against
-- `count(*)` of the live like rows precisely so drift SURFACES (T-05-37).
--
-- WHY THERE IS NO SOFT-DELETE BRANCH HERE (contrast `app.feed_comment_count()`): a like has no
-- `deleted_at`. Unliking is a real DELETE, so `insert`/`delete` is the complete transition set, and
-- the existing trigger's `after insert or delete` needs no widening.
--
-- A SOFT-DELETED STORY KEEPS ITS COUNT, deliberately: `deleteStory` sets `deleted_at` and does not
-- touch `feed_likes`, so the rows members left survive for Phase 8 moderation and the counter still
-- matches them. Reconciliation counts live like rows per story, not per visible story.

create or replace function app.feed_like_count() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.post_id is not null then
      update public.feed_posts set like_count = like_count + 1 where id = new.post_id;
    elsif new.comment_id is not null then
      update public.feed_comments set like_count = like_count + 1 where id = new.comment_id;
    elsif new.story_id is not null then
      update public.stories set like_count = like_count + 1 where id = new.story_id;
    end if;
  elsif tg_op = 'DELETE' then
    -- A decrement only ever fires on the delete of a row that EXISTED, so the counter cannot go
    -- below zero. There is deliberately no `greatest(0, …)` clamp: a clamp would hide drift instead
    -- of letting the pgTAP reconciliation assertion surface it.
    if old.post_id is not null then
      update public.feed_posts set like_count = like_count - 1 where id = old.post_id;
    elsif old.comment_id is not null then
      update public.feed_comments set like_count = like_count - 1 where id = old.comment_id;
    elsif old.story_id is not null then
      update public.stories set like_count = like_count - 1 where id = old.story_id;
    end if;
  end if;
  return null;
end
$$;--> statement-breakpoint

-- The grant is re-stated because `create or replace function` resets nothing but is cheap to keep
-- idempotent; the roles are the same three the Phase 4 migration granted.
grant execute on function app.feed_like_count() to authenticated, service_role, api_user;--> statement-breakpoint

-- BACKFILL, once: every story like that landed before this branch existed adjusted nothing, so the
-- column and the rows it summarises start out of step. There is exactly one such row in any local
-- database (the pgTAP positive control runs inside a rolled-back transaction), but a backfill that
-- is correct at any volume is the same three lines as one that assumes zero.
update public.stories s
   set like_count = coalesce(counted.n, 0)
  from (select story_id, count(*)::int as n
          from public.feed_likes
         where story_id is not null
         group by story_id) counted
 where counted.story_id = s.id
   and s.like_count is distinct from counted.n;
