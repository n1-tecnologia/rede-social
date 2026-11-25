-- buyer_permissions_sample (11.1-03, D-893, D-892; T-11.1-10) — the free sample of a locked community never shows a
-- BUYER's post.
--
-- 08.2 shipped `app.feed_sample_post_ids()`: for every community in `app.community_locked_ids()`, the id of its newest
-- live post, which the restrictive `feed_posts_community_gate` admits as the ONE post a locked member still sees. Until
-- Phase 11.1 every post of an organization community was the organization's, so "newest live post" was safe. A buyer can
-- now publish into an organization community (`visibility = 'community'`, plan 11.1-02), so the newest post of a locked
-- community can be a buyer's, with the buyer's name and photo, and the sample would hand it to every member who has not
-- bought. D-893: the sample is ORGANIZATION content only, so the inner selection gains `p.visibility = 'tenant'` beside
-- `p.deleted_at is null`. A locked community whose newest tenant-visible post exists keeps the shipped all-or-nothing
-- sample (that post), and a locked community with none shows no sample at all.
--
-- `create or replace`, the same signature and attributes (SECURITY DEFINER, stable, `search_path = ''`), the same
-- lateral probe and order (`created_at desc, id desc`, P40); the grants are re-asserted. Reversible by one more
-- `create or replace` of the previous body; no data moves.

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
         and p.visibility = 'tenant'
       order by p.created_at desc, p.id desc
       limit 1) s
$$;
--> statement-breakpoint
revoke all on function app.feed_sample_post_ids() from public;--> statement-breakpoint
grant execute on function app.feed_sample_post_ids() to authenticated;
