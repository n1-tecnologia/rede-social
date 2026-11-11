-- 10-08-spike.sql: A10 (second half), the authors read measured BEFORE its form and index are final.
-- Run: psql postgres://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <this file>
-- (after `pnpm db:reset && pnpm db:seed`; the script is ONE transaction that ENDS IN `rollback;`, so it leaves
-- nothing behind: no tenant, no row and none of the candidate indexes).
--
-- Forms for the authors read (Explorar story row, D-714, D-717):
--   G (GROUPED)  one grouped statement over the live member stories: `author_user_id = any (SOCIAL_VISIBLE_AUTHOR_IDS)`
--                (member) or every live member (moderator), `story_views` aggregated, constant `v.tenant_id`.
--   L (LATERAL)  a LATERAL over the followed set (member) or over the live memberships (moderator) taking the live
--                stories of each author and aggregating them there.
-- Index states: BASE (today's indexes), I1 (the planner default),
--   I1 = stories_tenant_author_expires_idx (tenant_id, author_user_id, expires_at desc nulls first, id desc nulls first)
--          where deleted_at is null and visibility = 'followers'
--   I2 = the same columns WITHOUT the partial predicate.
-- Fixture (tenant P, `social` on): 200 members and one admin; 8000 LIVE member stories ('followers', skewed: members 1..5
-- wrote 100 each, the rest spread over members 6..200), 3000 EXPIRED member stories, 500 SOFT-DELETED ones, 3000
-- organization stories ('tenant'); viewer VA (member 190) follows 50 authors (1..50, the five heavy ones included) and
-- has seen a third of their live stories; viewer VB (member 191) follows 3 authors (51..53); moderator lane = the admin.
\set ON_ERROR_STOP on
\timing off
begin;

insert into public.tenants (id, slug, display_name, rules_text, rules_version)
values ('10800000-0000-4000-8000-000000000001', 'spike-10-08', 'Spike 10-08', 'Regras.', 1);
insert into public.tenant_modules (tenant_id, module_key, enabled) values ('10800000-0000-4000-8000-000000000001', 'social', true);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'spike-' || n || '@10-08.local', '',
       now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()
  from (select '10800000-0000-4000-8000-000000000002'::uuid as u, 'admin' as n
        union all
        select ('10800000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid, 'm' || g from generate_series(1, 200) g) x;
insert into public.memberships (tenant_id, user_id, role, status)
select '10800000-0000-4000-8000-000000000001'::uuid, '10800000-0000-4000-8000-000000000002'::uuid, 'admin_tenant', 'active'
union all
select '10800000-0000-4000-8000-000000000001'::uuid, ('10800000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid, 'member', 'active' from generate_series(1, 200) g;

-- VA (member 190) follows authors 1..50; VB (member 191) follows 51..53.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '10800000-0000-4000-8000-000000000001'::uuid, '10800000-0000-4000-8001-0000000000be'::uuid, ('10800000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(1, 50) g
union all
select '10800000-0000-4000-8000-000000000001'::uuid, '10800000-0000-4000-8001-0000000000bf'::uuid, ('10800000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(51, 53) g;

insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths)
values ('10800000-0000-4000-8000-0000000000a1', '10800000-0000-4000-8000-000000000001', '10800000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');

-- 8000 LIVE member stories: 500 from the five heavy authors, 7500 over authors 6..200.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
select ('10800000-0000-4000-8002-' || lpad(to_hex(g), 12, '0'))::uuid, '10800000-0000-4000-8000-000000000001',
       case when g <= 500 then ('10800000-0000-4000-8001-' || lpad(to_hex(((g - 1) % 5) + 1), 12, '0'))::uuid else ('10800000-0000-4000-8001-' || lpad(to_hex(6 + (g % 195)), 12, '0'))::uuid end,
       '10800000-0000-4000-8000-0000000000a1', 'image', 'vivo ' || g, 'followers',
       now() - (g * 10.7 || ' seconds')::interval,
       now() - (g * 10.7 || ' seconds')::interval + interval '24 hours'
  from generate_series(1, 8000) g;
-- 3000 EXPIRED member stories (window closed 1 to 5 days ago).
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
select ('10800000-0000-4000-8003-' || lpad(to_hex(g), 12, '0'))::uuid, '10800000-0000-4000-8000-000000000001',
       ('10800000-0000-4000-8001-' || lpad(to_hex(1 + (g % 200)), 12, '0'))::uuid,
       '10800000-0000-4000-8000-0000000000a1', 'image', 'expirado ' || g, 'followers',
       now() - interval '25 hours' - (g * 2.4 || ' minutes')::interval,
       now() - interval '1 hour' - (g * 2.4 || ' minutes')::interval
  from generate_series(1, 3000) g;
-- 500 SOFT-DELETED member stories inside the window.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at, deleted_at)
select ('10800000-0000-4000-8004-' || lpad(to_hex(g), 12, '0'))::uuid, '10800000-0000-4000-8000-000000000001',
       ('10800000-0000-4000-8001-' || lpad(to_hex(1 + (g % 200)), 12, '0'))::uuid,
       '10800000-0000-4000-8000-0000000000a1', 'image', 'removido ' || g, 'followers',
       now() - (g * 40 || ' seconds')::interval,
       now() - (g * 40 || ' seconds')::interval + interval '24 hours', now()
  from generate_series(1, 500) g;
-- 3000 organization stories.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
select ('10800000-0000-4000-8005-' || lpad(to_hex(g), 12, '0'))::uuid, '10800000-0000-4000-8000-000000000001', '10800000-0000-4000-8000-000000000002',
       '10800000-0000-4000-8000-0000000000a1', 'image', 'org ' || g, 'tenant',
       now() - (g * 43.2 || ' minutes')::interval,
       now() - (g * 43.2 || ' minutes')::interval + interval '24 hours'
  from generate_series(1, 3000) g;

-- seen marks: VA saw a third of the live stories of its 50 followees; VB saw some of its three.
insert into public.story_views (tenant_id, user_id, story_id)
select '10800000-0000-4000-8000-000000000001', '10800000-0000-4000-8001-0000000000be'::uuid, s.id from public.stories s
 where s.tenant_id = '10800000-0000-4000-8000-000000000001' and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and s.author_user_id in (select followee_user_id from public.social_follows where follower_user_id = '10800000-0000-4000-8001-0000000000be'::uuid)
   and (('x' || substr(md5(s.id::text), 1, 4))::bit(16)::int % 3) = 0;
insert into public.story_views (tenant_id, user_id, story_id)
select '10800000-0000-4000-8000-000000000001', '10800000-0000-4000-8001-0000000000bf'::uuid, s.id from public.stories s
 where s.tenant_id = '10800000-0000-4000-8000-000000000001' and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and s.author_user_id in (select followee_user_id from public.social_follows where follower_user_id = '10800000-0000-4000-8001-0000000000bf'::uuid)
   and (('x' || substr(md5(s.id::text), 1, 4))::bit(16)::int % 2) = 0;

analyze public.stories; analyze public.story_views; analyze public.memberships; analyze public.member_profiles;
analyze public.social_follows; analyze public.media_assets;

\echo '=== fixture sanity (as the migration role)'
select 'live member stories' as k, count(*) from public.stories where tenant_id = '10800000-0000-4000-8000-000000000001' and visibility = 'followers' and deleted_at is null and expires_at > now();
select 'expired member stories' as k, count(*) from public.stories where tenant_id = '10800000-0000-4000-8000-000000000001' and visibility = 'followers' and expires_at <= now();
select 'soft-deleted' as k, count(*) from public.stories where tenant_id = '10800000-0000-4000-8000-000000000001' and deleted_at is not null;
select 'org stories' as k, count(*) from public.stories where tenant_id = '10800000-0000-4000-8000-000000000001' and visibility = 'tenant';

-- the cursor of moderator page 5: the 80th row of the moderator ordering (captured with \gset)
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;

select membership_id as after_id, latest_published_at as after_n from (
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 order by max(s.published_at) desc, am.id
 offset 79 limit 1
) q \gset
\echo 'page-5 cursor:' :after_n :after_id
reset role;

\echo '=================== STATE BASE (today''s indexes) ==================='
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8001-0000000000be', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo '>>> STATE BASE'
\echo '--- [BASE] R1 member 50 followees, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id)) as has_unseen,
       (s.author_user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
   and s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   and not app.is_blocked_by_viewer(s.author_user_id)
 group by am.id, ap.display_name, ap.avatar_asset_id, s.author_user_id
 order by is_self desc, has_unseen desc, max(s.published_at) desc, am.id
 limit 200;
\echo '--- [BASE] R1 member 50 followees, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, (am.user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as is_self
  from unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as f(uid)
  join public.memberships am on am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.user_id = f.uid
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = f.uid and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where (select app.social_enabled()) and agg.story_count > 0
   and not app.is_blocked_by_viewer(f.uid)
 order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
 limit 200;
\echo '--- [BASE] R5 Inicio strip with member stories present (existing form)'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, ap.avatar_asset_id, s.media_asset_id, s.media_kind, a.variant_widths, a.status,
       s.caption, s.published_at, s.expires_at, (s.expires_at > now()) as is_active, s.like_count, s.comment_count,
       exists (select 1 from public.feed_likes l where l.story_id = s.id and l.user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as viewer_liked,
       (select count(*)::int from public.story_highlight_items hi where hi.story_id = s.id) as highlight_count,
       exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id
  left join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id and am.status = 'active' and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001' and s.deleted_at is null and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8001-0000000000bf', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo '--- [BASE] R2 member 3 followees, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid and v.story_id = s.id)) as has_unseen,
       (s.author_user_id = '10800000-0000-4000-8001-0000000000bf'::uuid) as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
   and s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   and not app.is_blocked_by_viewer(s.author_user_id)
 group by am.id, ap.display_name, ap.avatar_asset_id, s.author_user_id
 order by is_self desc, has_unseen desc, max(s.published_at) desc, am.id
 limit 200;
\echo '--- [BASE] R2 member 3 followees, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, (am.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid) as is_self
  from unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as f(uid)
  join public.memberships am on am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.user_id = f.uid
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = f.uid and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where (select app.social_enabled()) and agg.story_count > 0
   and not app.is_blocked_by_viewer(f.uid)
 order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
 limit 200;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo '--- [BASE] R3 moderator page 1, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 order by max(s.published_at) desc, am.id
 limit 21;
\echo '--- [BASE] R3 moderator page 1, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, false as is_self
  from public.memberships am
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = am.user_id and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
   and (select app.social_enabled()) and agg.story_count > 0
 order by agg.latest desc, am.id
 limit 21;
\echo '--- [BASE] R4 moderator page 5, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 having (max(s.published_at) < :'after_n'::timestamptz or (max(s.published_at) = :'after_n'::timestamptz and am.id > :'after_id'::uuid))
 order by max(s.published_at) desc, am.id
 limit 21;
\echo '--- [BASE] R4 moderator page 5, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, false as is_self
  from public.memberships am
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = am.user_id and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
   and (select app.social_enabled()) and agg.story_count > 0
   and (agg.latest < :'after_n'::timestamptz or (agg.latest = :'after_n'::timestamptz and am.id > :'after_id'::uuid))
 order by agg.latest desc, am.id
 limit 21;
reset role;
create index spike_i1 on public.stories (tenant_id, author_user_id, expires_at desc nulls first, id desc nulls first) where deleted_at is null and visibility = 'followers';
analyze public.stories;
\echo '=================== STATE I1 (partial) ==================='
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8001-0000000000be', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo '>>> STATE I1'
\echo '--- [I1] R1 member 50 followees, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id)) as has_unseen,
       (s.author_user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
   and s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   and not app.is_blocked_by_viewer(s.author_user_id)
 group by am.id, ap.display_name, ap.avatar_asset_id, s.author_user_id
 order by is_self desc, has_unseen desc, max(s.published_at) desc, am.id
 limit 200;
\echo '--- [I1] R1 member 50 followees, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, (am.user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as is_self
  from unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as f(uid)
  join public.memberships am on am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.user_id = f.uid
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = f.uid and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where (select app.social_enabled()) and agg.story_count > 0
   and not app.is_blocked_by_viewer(f.uid)
 order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
 limit 200;
\echo '--- [I1] R5 Inicio strip with member stories present (existing form)'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, ap.avatar_asset_id, s.media_asset_id, s.media_kind, a.variant_widths, a.status,
       s.caption, s.published_at, s.expires_at, (s.expires_at > now()) as is_active, s.like_count, s.comment_count,
       exists (select 1 from public.feed_likes l where l.story_id = s.id and l.user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as viewer_liked,
       (select count(*)::int from public.story_highlight_items hi where hi.story_id = s.id) as highlight_count,
       exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id
  left join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id and am.status = 'active' and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001' and s.deleted_at is null and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8001-0000000000bf', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo '--- [I1] R2 member 3 followees, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid and v.story_id = s.id)) as has_unseen,
       (s.author_user_id = '10800000-0000-4000-8001-0000000000bf'::uuid) as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
   and s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   and not app.is_blocked_by_viewer(s.author_user_id)
 group by am.id, ap.display_name, ap.avatar_asset_id, s.author_user_id
 order by is_self desc, has_unseen desc, max(s.published_at) desc, am.id
 limit 200;
\echo '--- [I1] R2 member 3 followees, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, (am.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid) as is_self
  from unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as f(uid)
  join public.memberships am on am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.user_id = f.uid
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = f.uid and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where (select app.social_enabled()) and agg.story_count > 0
   and not app.is_blocked_by_viewer(f.uid)
 order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
 limit 200;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo '--- [I1] R3 moderator page 1, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 order by max(s.published_at) desc, am.id
 limit 21;
\echo '--- [I1] R3 moderator page 1, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, false as is_self
  from public.memberships am
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = am.user_id and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
   and (select app.social_enabled()) and agg.story_count > 0
 order by agg.latest desc, am.id
 limit 21;
\echo '--- [I1] R4 moderator page 5, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 having (max(s.published_at) < :'after_n'::timestamptz or (max(s.published_at) = :'after_n'::timestamptz and am.id > :'after_id'::uuid))
 order by max(s.published_at) desc, am.id
 limit 21;
\echo '--- [I1] R4 moderator page 5, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, false as is_self
  from public.memberships am
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = am.user_id and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
   and (select app.social_enabled()) and agg.story_count > 0
   and (agg.latest < :'after_n'::timestamptz or (agg.latest = :'after_n'::timestamptz and am.id > :'after_id'::uuid))
 order by agg.latest desc, am.id
 limit 21;
reset role;
drop index public.spike_i1;
create index spike_i2 on public.stories (tenant_id, author_user_id, expires_at desc nulls first, id desc nulls first);
analyze public.stories;
\echo '=================== STATE I2 (no predicate) ==================='
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8001-0000000000be', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo '>>> STATE I2'
\echo '--- [I2] R1 member 50 followees, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id)) as has_unseen,
       (s.author_user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
   and s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   and not app.is_blocked_by_viewer(s.author_user_id)
 group by am.id, ap.display_name, ap.avatar_asset_id, s.author_user_id
 order by is_self desc, has_unseen desc, max(s.published_at) desc, am.id
 limit 200;
\echo '--- [I2] R1 member 50 followees, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, (am.user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as is_self
  from unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as f(uid)
  join public.memberships am on am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.user_id = f.uid
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = f.uid and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where (select app.social_enabled()) and agg.story_count > 0
   and not app.is_blocked_by_viewer(f.uid)
 order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
 limit 200;
\echo '--- [I2] R5 Inicio strip with member stories present (existing form)'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, ap.avatar_asset_id, s.media_asset_id, s.media_kind, a.variant_widths, a.status,
       s.caption, s.published_at, s.expires_at, (s.expires_at > now()) as is_active, s.like_count, s.comment_count,
       exists (select 1 from public.feed_likes l where l.story_id = s.id and l.user_id = '10800000-0000-4000-8001-0000000000be'::uuid) as viewer_liked,
       (select count(*)::int from public.story_highlight_items hi where hi.story_id = s.id) as highlight_count,
       exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000be'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id
  left join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id and am.status = 'active' and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001' and s.deleted_at is null and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8001-0000000000bf', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
\echo '--- [I2] R2 member 3 followees, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid and v.story_id = s.id)) as has_unseen,
       (s.author_user_id = '10800000-0000-4000-8001-0000000000bf'::uuid) as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
   and s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))
   and not app.is_blocked_by_viewer(s.author_user_id)
 group by am.id, ap.display_name, ap.avatar_asset_id, s.author_user_id
 order by is_self desc, has_unseen desc, max(s.published_at) desc, am.id
 limit 200;
\echo '--- [I2] R2 member 3 followees, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, (am.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid) as is_self
  from unnest(coalesce((select app.social_visible_author_ids()), '{}'::uuid[])) as f(uid)
  join public.memberships am on am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.user_id = f.uid
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8001-0000000000bf'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = f.uid and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where (select app.social_enabled()) and agg.story_count > 0
   and not app.is_blocked_by_viewer(f.uid)
 order by is_self desc, agg.has_unseen desc, agg.latest desc, am.id
 limit 200;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10800000-0000-4000-8000-000000000002', 'role', 'authenticated',
  'tenant_id', '10800000-0000-4000-8000-000000000001', 'tenant_role', 'admin_tenant')::text, true);
set local role authenticated;
\echo '--- [I2] R3 moderator page 1, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 order by max(s.published_at) desc, am.id
 limit 21;
\echo '--- [I2] R3 moderator page 1, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, false as is_self
  from public.memberships am
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = am.user_id and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
   and (select app.social_enabled()) and agg.story_count > 0
 order by agg.latest desc, am.id
 limit 21;
\echo '--- [I2] R4 moderator page 5, G'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       count(*)::int as story_count,
       to_char(max(s.published_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen,
       false as is_self
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
  join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id
       and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.visibility = 'followers' and s.deleted_at is null and s.expires_at > now()
   and (select app.social_enabled())
 group by am.id, ap.display_name, ap.avatar_asset_id
 having (max(s.published_at) < :'after_n'::timestamptz or (max(s.published_at) = :'after_n'::timestamptz and am.id > :'after_id'::uuid))
 order by max(s.published_at) desc, am.id
 limit 21;
\echo '--- [I2] R4 moderator page 5, L'
explain (analyze, buffers, costs off)
select am.id as membership_id, ap.display_name, ap.avatar_asset_id,
       agg.story_count, to_char(agg.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as latest_published_at,
       agg.has_unseen, false as is_self
  from public.memberships am
  left join public.member_profiles ap on ap.membership_id = am.id
  cross join lateral (
    select count(*)::int as story_count, max(s.published_at) as latest,
           bool_or(not exists (select 1 from public.story_views v where v.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and v.user_id = '10800000-0000-4000-8000-000000000002'::uuid and v.story_id = s.id)) as has_unseen
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id and a.status = 'ready'
     where s.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and s.author_user_id = am.user_id and s.visibility = 'followers'
       and s.deleted_at is null and s.expires_at > now()
  ) agg
 where am.tenant_id = '10800000-0000-4000-8000-000000000001'::uuid and am.status = 'active' and am.blocked_at is null and am.deleted_at is null
   and (select app.social_enabled()) and agg.story_count > 0
   and (agg.latest < :'after_n'::timestamptz or (agg.latest = :'after_n'::timestamptz and am.id > :'after_id'::uuid))
 order by agg.latest desc, am.id
 limit 21;
reset role;

rollback;
