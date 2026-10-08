-- feed_community_sample (08.2-01, D-354, D-356, STORE-13; RESEARCH Pattern 2, Code Examples) — the
-- ONE post a member still sees in a community that is locked for them: its newest live post.
--
-- `app.feed_sample_post_ids()` answers, for every community in `app.community_locked_ids()` (the
-- kernel seam; '{}' while the store is off or has no body), the id of that community's newest live
-- post in this tenant, ordered `created_at desc, id desc` (two posts created at the same instant
-- resolve deterministically to the higher id, P40). The generated `*_store.sql` migration's
-- restrictive `feed_posts_community_gate` policy admits exactly these ids from a locked community.
--
-- WHY SECURITY DEFINER. It reads `feed_posts`, and an INVOKER function called from a `feed_posts`
-- policy would recurse into that same policy. As a definer it runs as its owner, which bypasses RLS,
-- so EVERY statement pins `tenant_id = app.tenant_id()` itself: a lane with no tenant claim gets the
-- empty set, and a community id of another tenant matches no row.
--
-- Called through the policy as `coalesce((select app.feed_sample_post_ids()), '{}'::uuid[])`, an
-- InitPlan evaluated once per statement (RESEARCH Pitfall 1). Each lateral probe stops at the first
-- row of `feed_posts_tenant_community_created_idx`.
--
-- Hardening: `search_path = ''`, fully qualified names; EXECUTE revoked from PUBLIC and granted to
-- `authenticated` only.

create or replace function app.feed_sample_post_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
    from unnest(app.community_locked_ids()) as lc(id)
    cross join lateral (
      select p.id
        from public.feed_posts p
       where p.tenant_id = app.tenant_id()
         and p.community_id = lc.id
         and p.deleted_at is null
       order by p.created_at desc, p.id desc
       limit 1) s
$$;
--> statement-breakpoint
revoke all on function app.feed_sample_post_ids() from public;--> statement-breakpoint
grant execute on function app.feed_sample_post_ids() to authenticated;
