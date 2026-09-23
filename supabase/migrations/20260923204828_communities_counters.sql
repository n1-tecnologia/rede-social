-- communities_counters — the ONE writer of `communities.post_count` and
-- `communities.last_activity_at`, i.e. everything about those two columns that drizzle-kit cannot
-- model. Its companion `20260923171503_communities.sql` is the GENERATED half (both tables, both
-- policies, the partial DESC-NULLS-FIRST activity index, the per-tenant slug unique and the status
-- check — drizzle-kit 0.31.10 emitted every one of them cleanly, so nothing was moved out of it and
-- `pnpm db:generate` stays a no-op).
--
-- WHY THESE COUNTERS LIVE IN A TRIGGER AT ALL: `communities.post_count` is what COMM-03's card
-- prints and `communities.last_activity_at` is the key D-76's keyset ORDERS BY, which means the
-- second one is load-bearing for correctness and not only for display. An application-side
-- `update … set post_count = post_count + 1` is a second statement that must also succeed; the day
-- it does not, the count drifts from the rows it summarises and the list's order drifts from
-- reality, and nothing notices. The schema docblock in
-- `packages/modules/communities/db/schema.ts` declares both columns trigger-owned; this file is
-- what makes that declaration true, and no service function anywhere names either column in a
-- `set` list.
--
-- WHY THE FUNCTION DOES NOT RUN WITH THE DEFINER'S RIGHTS (the same posture as
-- `app.feed_like_count()` in 20260922162449_feed_counters.sql, and for the same reason): it runs on
-- the writer's OWN rows, inside the writer's own tenant lane, against a table carrying a permissive
-- `for all` isolation policy the writer already satisfies — a member who may insert a post into a
-- community may already see that community. It needs no elevated right, so it gets none: an
-- elevated trigger here would be a standing way to move another tenant's counter. `set search_path
-- = ''` plus fully-qualified names is kept anyway, so the function cannot be hijacked by a schema
-- shadowing attack (T-05-23).
--
-- WHY THERE IS NO `greatest(0, …)` CLAMP ON THE COUNT: a clamp would hide drift instead of letting
-- the pgTAP reconciliation assertion in `supabase/tests/110-communities-stories.sql` surface it. A
-- negative `post_count` is a bug report; a clamped zero is a bug that never gets reported (T-05-22).
--
-- WHY `last_activity_at` IS RECOMPUTED ON THE WAY DOWN BUT ONLY RAISED ON THE WAY UP: the invariant
-- this file maintains is
--
--     last_activity_at = greatest(created_at, coalesce(max(live post.created_at), created_at))
--
-- which is exactly what 110's reconciliation asserts. On an insert, `greatest(last_activity_at,
-- new.created_at)` preserves it in one statement with no scan — a backdated post cannot pull a
-- community's activity backwards, and a new post raises it. On a decrement the maximum may have
-- MOVED, so it is re-derived from the live rows; `created_at` is the floor, which is what keeps a
-- post-less community sorting by when it was created rather than floating to the top on a null
-- (fact 1 of the schema docblock).
--
-- WHY THE UPDATE BRANCH WATCHES `community_id` AS WELL AS `deleted_at`: the feed counters' branch
-- is `after update of deleted_at`, and that alone is what a soft delete needs. D-72 forbids moving a
-- published post between communities and `updatePostSchema` has no such key, so the API cannot
-- produce that update today. The trigger handles it anyway — a counter that is only correct while
-- the API is disciplined is a counter that breaks the first time a migration, a backfill or a psql
-- session writes the column directly. Soft delete is an UPDATE of `deleted_at`, never a DELETE
-- (D-61), so the branch reads the TRANSITION rather than the new value.

create or replace function app.community_post_stats() returns trigger
  language plpgsql set search_path = '' as $$
declare
  v_old_counts boolean := false;
  v_new_counts boolean := false;
begin
  if tg_op = 'INSERT' then
    v_new_counts := new.community_id is not null and new.deleted_at is null;
  elsif tg_op = 'DELETE' then
    v_old_counts := old.community_id is not null and old.deleted_at is null;
  else
    v_old_counts := old.community_id is not null and old.deleted_at is null;
    v_new_counts := new.community_id is not null and new.deleted_at is null;
    -- Nothing that this counter can see changed: the post counted before and counts now, for the
    -- same container. `update of deleted_at, community_id` still fires for a write that sets
    -- `deleted_at` to the value it already had, and that must not double-count.
    if v_old_counts and v_new_counts and old.community_id = new.community_id then
      v_old_counts := false;
      v_new_counts := false;
    end if;
  end if;

  if v_old_counts then
    update public.communities c
       set post_count = c.post_count - 1,
           last_activity_at = greatest(
             c.created_at,
             coalesce(
               (select max(p.created_at)
                  from public.feed_posts p
                 where p.community_id = c.id
                   and p.deleted_at is null),
               c.created_at))
     where c.id = old.community_id;
  end if;

  if v_new_counts then
    update public.communities c
       set post_count = c.post_count + 1,
           last_activity_at = greatest(c.last_activity_at, new.created_at)
     where c.id = new.community_id;
  end if;

  return null;
end
$$;--> statement-breakpoint

grant execute on function app.community_post_stats() to authenticated, service_role, api_user;--> statement-breakpoint

drop trigger if exists feed_posts_community_stats on public.feed_posts;--> statement-breakpoint

create trigger feed_posts_community_stats
  after insert or delete or update of deleted_at, community_id on public.feed_posts
  for each row execute function app.community_post_stats();--> statement-breakpoint

-- The BACKFILL, once: every community already in the database is reconciled to the invariant above,
-- so the trigger's first increment starts from a true number rather than from the `0` default the
-- 05-01 migration left behind. Written as one statement over `communities` (not a loop), and
-- deliberately NOT guarded by `where post_count = 0`: a row whose count was already wrong is
-- exactly the row this needs to fix.
update public.communities c
   set post_count = coalesce(live.count, 0),
       last_activity_at = greatest(c.created_at, coalesce(live.newest, c.created_at))
  from (select c2.id,
               (select count(*) from public.feed_posts p
                 where p.community_id = c2.id and p.deleted_at is null) as count,
               (select max(p.created_at) from public.feed_posts p
                 where p.community_id = c2.id and p.deleted_at is null) as newest
          from public.communities c2) as live
 where live.id = c.id;
