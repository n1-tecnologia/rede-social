-- 09-03 Wave 0 plan-measurement spike (RESEARCH Wave 0 gaps, Assumptions A1-A5, Pitfall 4; T-09-11).
-- MEASUREMENT ONLY: no production file changes. The whole script runs inside ONE transaction that ends
-- in `rollback;`, so the local stack keeps no row, index or statistic from it.
--
-- Run: psql postgres://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <this file>
-- (after `pnpm db:reset && pnpm db:seed`). Generated from a template; this file is the plain SQL.
--
-- Fixture: one tenant (`social` enabled), 60 members + 1 admin, 20000 member posts (visibility
-- 'followers', skewed authors: member 1 writes about a quarter, members 58..60 about half a percent
-- each; one post in six is a ready video), 2000 organization posts (visibility 'tenant', 50 of them
-- ready videos) plus 400 organization posts in 4 communities. F50 (member 30) follows 50 prolific
-- authors; F3 (member 31) follows the 3 rarest authors (58, 59, 60). Each read is measured twice:
-- BASE = only the indexes that exist today, WITH = plus the candidates I1 and I2, ORG = plus I3 and I4.
--   I1 (tenant, created_at desc, id desc) where visibility = 'followers'
--   I2 (tenant, author, created_at desc, id desc) where visibility = 'followers'
--   I3 (tenant, created_at desc, id desc) where visibility = 'tenant'
--   I4 (tenant, created_at desc, id desc) where visibility = 'tenant' and community_id is null
--   TRAIL state: I1 is replaced by I1b (tenant, created_at desc, id desc, author) where visibility =
--   'followers' (RESEARCH A2: a trailing key column filtered inside the index scan).
-- Reads run as the `authenticated` role with the tenant claims, so RLS (including the new restrictive
-- `feed_posts_social_gate`) is part of every plan.
\set ON_ERROR_STOP on
\pset pager off
begin;
select setseed(0.4242);

insert into public.tenants (id, slug, display_name, rules_text, rules_version)
values ('09030000-0000-4000-8000-000000000001', 'spike-09-03', 'Spike 09-03', 'x', 1);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('09030000-0000-4000-8000-0000' || lpad(to_hex(g), 8, '0'))::uuid, 'authenticated', 'authenticated',
       'spike' || g || '@spike-09-03.local', '', now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()
  from generate_series(0, 60) g;

insert into public.memberships (tenant_id, user_id, role, status)
select '09030000-0000-4000-8000-000000000001', ('09030000-0000-4000-8000-0000' || lpad(to_hex(g), 8, '0'))::uuid, case when g = 0 then 'admin_tenant' else 'member' end, 'active'
  from generate_series(0, 60) g;

insert into public.tenant_modules (tenant_id, module_key, enabled) values ('09030000-0000-4000-8000-000000000001', 'social', true)
on conflict (tenant_id, module_key) do update set enabled = true;

insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description)
select ('09030000-0000-4000-8000-c0' || lpad(to_hex(g), 10, '0'))::uuid, '09030000-0000-4000-8000-000000000001', ('09030000-0000-4000-8000-0000' || lpad(to_hex(0), 8, '0'))::uuid,
       'Spike ' || g, 'spike-' || g, ''
  from generate_series(1, 4) g;

-- 20000 member posts: skewed authors, one in six a video, spread over about 8 days.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind, created_at)
select ('09030000-0000-4000-8000-a0' || lpad(to_hex(g), 10, '0'))::uuid, '09030000-0000-4000-8000-000000000001',
       ('09030000-0000-4000-8000-0000' || lpad(to_hex(least(60, 1 + floor(60 * power(random(), 3))::int)), 8, '0'))::uuid,
       'membro ' || g, 'followers', case when g % 6 = 0 then 'video' else 'none' end,
       now() - ((g * 35) || ' seconds')::interval
  from generate_series(1, 20000) g;

-- 2000 organization posts by the admin (every 50th a video), interleaved in time.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind, created_at)
select ('09030000-0000-4000-8000-b0' || lpad(to_hex(g), 10, '0'))::uuid, '09030000-0000-4000-8000-000000000001', ('09030000-0000-4000-8000-0000' || lpad(to_hex(0), 8, '0'))::uuid,
       'organizacao ' || g, 'tenant', case when g % 50 = 0 then 'video' else 'none' end,
       now() - ((g * 350 + 17) || ' seconds')::interval
  from generate_series(1, 2000) g;

-- 400 organization posts inside 4 communities.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, community_id, visibility, created_at)
select ('09030000-0000-4000-8000-b1' || lpad(to_hex(g), 10, '0'))::uuid, '09030000-0000-4000-8000-000000000001', ('09030000-0000-4000-8000-0000' || lpad(to_hex(0), 8, '0'))::uuid,
       'comunidade ' || g, ('09030000-0000-4000-8000-c0' || lpad(to_hex((g % 4) + 1), 10, '0'))::uuid,
       'tenant', now() - ((g * 1700 + 91) || ' seconds')::interval
  from generate_series(1, 400) g;

-- A ready video asset for every video post (member and organization), so the Reels read is real.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes)
select ('09030000-0000-4000-8000-d0' || lpad(to_hex(row_number() over ()), 10, '0'))::uuid,
       '09030000-0000-4000-8000-000000000001', author_user_id, 'video', 'post', 'ready', 'fake', 'video/mp4', 1
  from public.feed_posts where tenant_id = '09030000-0000-4000-8000-000000000001' and media_kind = 'video';

insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
select '09030000-0000-4000-8000-000000000001', p.id, 'video', a.id, 'video', 0
  from (select id, row_number() over () as n from public.feed_posts where tenant_id = '09030000-0000-4000-8000-000000000001' and media_kind = 'video') p
  join (select id, row_number() over () as n from public.media_assets where tenant_id = '09030000-0000-4000-8000-000000000001') a on a.n = p.n;

-- The follow graph: F50 (member 30) follows 50 prolific authors; F3 (member 31) follows the 3 rarest;
-- everyone else follows 5 pseudo-random authors.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '09030000-0000-4000-8000-000000000001', ('09030000-0000-4000-8000-0000' || lpad(to_hex(30), 8, '0'))::uuid, ('09030000-0000-4000-8000-0000' || lpad(to_hex(g), 8, '0'))::uuid from generate_series(1, 51) g where g <> 30;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '09030000-0000-4000-8000-000000000001', ('09030000-0000-4000-8000-0000' || lpad(to_hex(31), 8, '0'))::uuid, ('09030000-0000-4000-8000-0000' || lpad(to_hex(g), 8, '0'))::uuid from generate_series(58, 60) g;
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select distinct '09030000-0000-4000-8000-000000000001'::uuid, ('09030000-0000-4000-8000-0000' || lpad(to_hex(f), 8, '0'))::uuid, ('09030000-0000-4000-8000-0000' || lpad(to_hex(t), 8, '0'))::uuid
  from (select f, 1 + ((f * 7 + k * 13) % 60) as t from generate_series(1, 60) f, generate_series(1, 5) k) s
 where f not in (30, 31) and f <> t;

analyze public.feed_posts; analyze public.memberships; analyze public.member_profiles;
analyze public.social_follows; analyze public.media_assets; analyze public.feed_post_media;
analyze public.communities;

\echo
\echo '=== FIXTURE ==='
select count(*) filter (where visibility = 'followers') as member_posts,
       count(*) filter (where visibility = 'tenant') as org_posts,
       count(*) filter (where media_kind = 'video') as video_posts
  from public.feed_posts where tenant_id = '09030000-0000-4000-8000-000000000001';
select m.n as member, count(p.*) as posts
  from (values (30), (31), (58), (59), (60), (1), (2), (10)) m(n)
  left join public.feed_posts p on p.author_user_id = ('09030000-0000-4000-8000-0000' || lpad(to_hex(m.n), 8, '0'))::uuid group by m.n order by m.n;
select 'F50 follows' as who, count(*) as n from public.social_follows where follower_user_id = ('09030000-0000-4000-8000-0000' || lpad(to_hex(30), 8, '0'))::uuid
union all
select 'F50 followed authors total posts', count(*) from public.feed_posts p
  where p.author_user_id in (select followee_user_id from public.social_follows where follower_user_id = ('09030000-0000-4000-8000-0000' || lpad(to_hex(30), 8, '0'))::uuid)
union all
select 'F3 follows', count(*) from public.social_follows where follower_user_id = ('09030000-0000-4000-8000-0000' || lpad(to_hex(31), 8, '0'))::uuid
union all
select 'F3 followed authors total posts', count(*) from public.feed_posts p
  where p.author_user_id in (select followee_user_id from public.social_follows where follower_user_id = ('09030000-0000-4000-8000-0000' || lpad(to_hex(31), 8, '0'))::uuid);
\echo
\echo '################ BASE ################'
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== BASE A ANY_SET F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f50c_ts, p.id::text as f50c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== BASE A ANY_SET F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== BASE A ANY_SET F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f3c_ts, p.id::text as f3c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== BASE A ANY_SET F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== BASE B LATERAL_TOPN F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== BASE B LATERAL_TOPN F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== BASE B LATERAL_TOPN F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== BASE B LATERAL_TOPN F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-000000000000', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo
\echo '=== BASE C MODERATOR all members page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-000000000000'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or true)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== BASE D INICIO merged (communities on) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== BASE D INICIO community_id is null ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.community_id is null and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== BASE D REELS today (video path, visibility tenant) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant' and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== BASE D REELS plan 04 (video path, shared member fragment) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false))) and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;

reset role;
create index spike_i1 on public.feed_posts (tenant_id, created_at desc nulls first, id desc nulls first)
  where visibility = 'followers';
create index spike_i2 on public.feed_posts (tenant_id, author_user_id, created_at desc nulls first, id desc nulls first)
  where visibility = 'followers';
analyze public.feed_posts;
\echo
\echo '################ WITH ################'
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== WITH A ANY_SET F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f50c_ts, p.id::text as f50c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== WITH A ANY_SET F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== WITH A ANY_SET F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f3c_ts, p.id::text as f3c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== WITH A ANY_SET F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== WITH B LATERAL_TOPN F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== WITH B LATERAL_TOPN F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== WITH B LATERAL_TOPN F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== WITH B LATERAL_TOPN F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-000000000000', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo
\echo '=== WITH C MODERATOR all members page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-000000000000'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or true)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== WITH D INICIO merged (communities on) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== WITH D INICIO community_id is null ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.community_id is null and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== WITH D REELS today (video path, visibility tenant) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant' and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== WITH D REELS plan 04 (video path, shared member fragment) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false))) and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
select p.created_at::text as f3deep_ts, p.id::text as f3deep_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 219 limit 1 \gset
\echo
\echo '=== WITH A ANY_SET F3 page 21 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f3deep_ts'::timestamptz, :'f3deep_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== WITH B LATERAL_TOPN F3 page 21 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f3deep_ts'::timestamptz, :'f3deep_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;

reset role;
create index spike_i3 on public.feed_posts (tenant_id, created_at desc nulls first, id desc nulls first)
  where visibility = 'tenant';
create index spike_i4 on public.feed_posts (tenant_id, created_at desc nulls first, id desc nulls first)
  where visibility = 'tenant' and community_id is null;
analyze public.feed_posts;
\echo
\echo '################ ORG ################'
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== ORG A ANY_SET F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f50c_ts, p.id::text as f50c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== ORG A ANY_SET F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== ORG A ANY_SET F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f3c_ts, p.id::text as f3c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== ORG A ANY_SET F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== ORG B LATERAL_TOPN F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== ORG B LATERAL_TOPN F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== ORG B LATERAL_TOPN F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== ORG B LATERAL_TOPN F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-000000000000', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo
\echo '=== ORG C MODERATOR all members page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-000000000000'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or true)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== ORG D INICIO merged (communities on) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== ORG D INICIO community_id is null ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.community_id is null and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== ORG D REELS today (video path, visibility tenant) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant' and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== ORG D REELS plan 04 (video path, shared member fragment) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false))) and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;

reset role;
drop index spike_i1;
create index spike_i1b on public.feed_posts (tenant_id, created_at desc nulls first, id desc nulls first, author_user_id)
  where visibility = 'followers';
analyze public.feed_posts;
\echo
\echo '################ TRAIL ################'
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== TRAIL A ANY_SET F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f50c_ts, p.id::text as f50c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== TRAIL A ANY_SET F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== TRAIL A ANY_SET F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
select p.created_at::text as f3c_ts, p.id::text as f3c_id
  from feed_posts p join memberships ms on ms.user_id = p.author_user_id
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   
 order by p.created_at desc, p.id desc offset 43 limit 1 \gset
\echo
\echo '=== TRAIL A ANY_SET F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false)))
   and (p.created_at, p.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== TRAIL B LATERAL_TOPN F50 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== TRAIL B LATERAL_TOPN F50 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f50c_ts'::timestamptz, :'f50c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001f', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== TRAIL B LATERAL_TOPN F3 page 1 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (null::timestamptz is null or (q.created_at, q.id) < (null::timestamptz, null::uuid))
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
\echo
\echo '=== TRAIL B LATERAL_TOPN F3 page 5 ==='
explain (analyze, buffers, costs off, summary on)
with followed as (select unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as author_id),
     picked as (
       select t.id, t.created_at from followed f
       cross join lateral (
         select q.id, q.created_at from feed_posts q
          where q.author_user_id = f.author_id and q.deleted_at is null
            and q.visibility = 'followers' and q.community_id is null
            and (q.created_at, q.id) < (:'f3c_ts'::timestamptz, :'f3c_id'::uuid)
          order by q.created_at desc, q.id desc limit 11) t
       order by t.created_at desc, t.id desc limit 12)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from picked k join feed_posts p on p.id = k.id
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001f'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where (select app.social_enabled())
   and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
 order by p.created_at desc, p.id desc limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-000000000000', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo
\echo '=== TRAIL C MODERATOR all members page 1 ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-000000000000'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.visibility = 'followers' and p.community_id is null and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or true)))
   and (null::timestamptz is null or (p.created_at, p.id) < (null::timestamptz, null::uuid))
 order by p.created_at desc, p.id desc
 limit 12;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '09030000-0000-4000-8000-00000000001e', 'role', 'authenticated', 'tenant_id', '09030000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo
\echo '=== TRAIL D INICIO merged (communities on) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== TRAIL D INICIO community_id is null ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and p.community_id is null and p.visibility = 'tenant'
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== TRAIL D REELS today (video path, visibility tenant) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and p.visibility = 'tenant' and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;
\echo
\echo '=== TRAIL D REELS plan 04 (video path, shared member fragment) ==='
explain (analyze, buffers, costs off, summary on)
select p.id, p.created_at, p.caption, p.community_id, c.name as community_name, c.slug as community_slug,
       p.like_count, p.comment_count, (pl.id is not null) as viewer_liked, p.author_user_id, p.visibility,
       p.media_kind, pm.media, lp.status as link_preview_status, ms.id as membership_id,
       mp.display_name, mp.avatar_asset_id
  from feed_posts p
  join memberships ms on ms.user_id = p.author_user_id
  join member_profiles mp on mp.membership_id = ms.id
  left join feed_likes pl on pl.post_id = p.id and pl.user_id = '09030000-0000-4000-8000-00000000001e'::uuid
  left join feed_link_previews lp on lp.id = p.link_preview_id
  left join public.communities c on c.id = p.community_id and c.tenant_id = p.tenant_id
  left join lateral (
    select coalesce(json_agg(json_build_object('assetId', m.media_asset_id, 'kind', m.kind, 'position', m.position,
                                               'status', a.status, 'width', a.width, 'height', a.height)
                             order by (m.kind = 'file'), m.position), '[]'::json) as media
      from feed_post_media m join media_assets a on a.id = m.media_asset_id
     where m.post_id = p.id) pm on true
 where p.deleted_at is null
   and (p.community_id is null or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))) and (p.visibility = 'tenant'
        or ((select app.social_enabled())
            and ms.status = 'active' and ms.blocked_at is null and ms.deleted_at is null
            and (p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) or false))) and p.media_kind = 'video'
   and exists (select 1 from feed_post_media vm join media_assets va on va.id = vm.media_asset_id
                where vm.post_id = p.id and vm.kind = 'video' and va.status = 'ready')
 order by p.created_at desc, p.id desc
 limit 12;

reset role;
\echo
\echo '=== DONE (rolled back) ==='
rollback;
