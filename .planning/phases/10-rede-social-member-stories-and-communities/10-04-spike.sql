-- 10-04-spike.sql — A10: the shape of BRANCH 3 of `stories_audience_gate` (D-716), measured before it is final.
-- Run: psql postgres://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <this file>
-- (after `pnpm db:reset && pnpm db:seed`; the whole script is ONE transaction that ENDS IN ROLLBACK, so it
-- leaves nothing behind and the two candidate policies never reach the database).
--
-- Candidates for the third door of the policy (the highlight of a readable community):
--   E (EXISTS_JOIN)  the shipped per-row form: `exists (select 1 from story_highlight_items i join
--                    story_highlights h ... where i.story_id = stories.id and h.community_id is not null and
--                    exists (select 1 from communities c ...))`, the inner `communities` read under the
--                    caller's RLS (so `communities_member_hidden_gate` applies).
--   D (IDS_DEFINER)  `id = any (coalesce((select app.story_highlight_readable_ids()), '{}'::uuid[]))`, a
--                    SECURITY DEFINER function returning the story ids held by a highlight of a community the
--                    caller can read, read once per statement as an InitPlan (the `09-03` ids-array form).
--
-- Fixture (tenant P, `social` on): 62 members (50 authors, 2 viewers), 3000 organization stories (`'tenant'`,
-- one every 43.2 minutes), 6000 member stories (`'followers'`, one every 3.36 minutes, so ~430 of them sit
-- inside the 24 hour window), 40 communities (15 of them member communities), 400 highlights (300 in a
-- community, 100 in Inicio), 3000 highlight items, viewer V20 who follows 20 authors and viewer V2 who follows
-- 2, and ONE member story (S200) carrying 200 comments. Reads (as the `authenticated` member lane):
--   (a) the Inicio strip read (`visibility = 'tenant'`, the expiry window, the projection's subselects,
--       the constant-tenant `story_views_uq` form), with 6000 member stories present;
--   (b) a member story read by id;
--   (c) the comments page of S200 (`feed_comments_tenant_story_root_asc_idx`, its per-row story gate);
--   (d) the strip read of the stranger-ish viewer V2 (follows 2).
\set ON_ERROR_STOP on
\timing off
begin;

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
insert into public.tenants (id, slug, display_name, rules_text, rules_version)
values ('10400000-0000-4000-8000-000000000001', 'spike-10-04', 'Spike 10-04', 'Regras.', 1);
insert into public.tenant_modules (tenant_id, module_key, enabled)
values ('10400000-0000-4000-8000-000000000001', 'social', true);

-- admin (…0002) and 62 members (…8001-<g>)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'spike-' || n || '@10-04.local', '',
       now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()
  from (select '10400000-0000-4000-8000-000000000002'::uuid as u, 'admin' as n
        union all
        select ('10400000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid, 'm' || g
          from generate_series(1, 62) g) x;
insert into public.memberships (tenant_id, user_id, role, status)
select '10400000-0000-4000-8000-000000000001'::uuid, '10400000-0000-4000-8000-000000000002'::uuid, 'admin_tenant', 'active'
union all
select '10400000-0000-4000-8000-000000000001'::uuid, ('10400000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid, 'member', 'active'
  from generate_series(1, 62) g;

-- viewer V20 = member 60 follows authors 1..20; viewer V2 = member 61 follows authors 41 and 42.
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
select '10400000-0000-4000-8000-000000000001'::uuid, '10400000-0000-4000-8001-00000000003c'::uuid,
       ('10400000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid
  from generate_series(1, 20) g
union all
select '10400000-0000-4000-8000-000000000001'::uuid, '10400000-0000-4000-8001-00000000003d'::uuid,
       ('10400000-0000-4000-8001-' || lpad(to_hex(g), 12, '0'))::uuid
  from generate_series(41, 42) g;

insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths)
values ('10400000-0000-4000-8000-0000000000a1', '10400000-0000-4000-8000-000000000001',
        '10400000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');

-- 40 communities: 1..25 organization (admin), 26..40 member communities (created by members 1..15).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position)
select ('10400000-0000-4000-8004-' || lpad(to_hex(g), 12, '0'))::uuid,
       '10400000-0000-4000-8000-000000000001',
       case when g <= 25 then '10400000-0000-4000-8000-000000000002'::uuid
            else ('10400000-0000-4000-8001-' || lpad(to_hex(g - 25), 12, '0'))::uuid end,
       'Comunidade ' || g, 'c-' || g,
       case when g <= 25 then 'organization' else 'member' end,
       case when g <= 25 then g else 1000000 end
  from generate_series(1, 40) g;

-- 3000 organization stories (default visibility 'tenant'), 6000 member stories ('followers').
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
select ('10400000-0000-4000-8002-' || lpad(to_hex(g), 12, '0'))::uuid,
       '10400000-0000-4000-8000-000000000001', '10400000-0000-4000-8000-000000000002',
       '10400000-0000-4000-8000-0000000000a1', 'image', 'org ' || g, 'tenant',
       now() - (g * 43.2 || ' minutes')::interval,
       now() - (g * 43.2 || ' minutes')::interval + interval '24 hours'
  from generate_series(1, 3000) g;
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at)
select ('10400000-0000-4000-8003-' || lpad(to_hex(g), 12, '0'))::uuid,
       '10400000-0000-4000-8000-000000000001',
       ('10400000-0000-4000-8001-' || lpad(to_hex(((g - 1) % 50) + 1), 12, '0'))::uuid,
       '10400000-0000-4000-8000-0000000000a1', 'image', 'membro ' || g, 'followers',
       now() - (g * 3.36 || ' minutes')::interval,
       now() - (g * 3.36 || ' minutes')::interval + interval '24 hours'
  from generate_series(1, 6000) g;

-- 400 highlights: 300 in a community, 100 in Inicio. 3000 items spread over them.
insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id)
select ('10400000-0000-4000-8005-' || lpad(to_hex(g), 12, '0'))::uuid,
       '10400000-0000-4000-8000-000000000001',
       case when g <= 300 then ('10400000-0000-4000-8004-' || lpad(to_hex(((g - 1) % 40) + 1), 12, '0'))::uuid end,
       'Destaque ' || g, g, '10400000-0000-4000-8000-000000000002'
  from generate_series(1, 400) g;
insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
select '10400000-0000-4000-8000-000000000001',
       ('10400000-0000-4000-8005-' || lpad(to_hex((g % 400) + 1), 12, '0'))::uuid,
       case when g % 2 = 0 then ('10400000-0000-4000-8003-' || lpad(to_hex((g % 6000) + 1), 12, '0'))::uuid
            else ('10400000-0000-4000-8002-' || lpad(to_hex((g % 3000) + 1), 12, '0'))::uuid end,
       '10400000-0000-4000-8000-000000000002'
  from generate_series(1, 3000) g;

-- S200: member story 1 (author member 1) with 200 root comments by members 1..50.
insert into public.feed_comments (tenant_id, story_id, author_user_id, body, created_at)
select '10400000-0000-4000-8000-000000000001', '10400000-0000-4000-8003-000000000001',
       ('10400000-0000-4000-8001-' || lpad(to_hex(((g - 1) % 50) + 1), 12, '0'))::uuid,
       'comentario ' || g, now() - ((201 - g) || ' minutes')::interval
  from generate_series(1, 200) g;

analyze public.stories;
analyze public.story_highlights;
analyze public.story_highlight_items;
analyze public.communities;
analyze public.feed_comments;
analyze public.social_follows;
analyze public.memberships;

-- the viewer's own seen marks (a handful, so viewer_seen has something to probe)
insert into public.story_views (tenant_id, user_id, story_id)
select '10400000-0000-4000-8000-000000000001', '10400000-0000-4000-8001-00000000003c',
       ('10400000-0000-4000-8002-' || lpad(to_hex(g), 12, '0'))::uuid
  from generate_series(1, 10) g;
analyze public.story_views;

-- ── the four reads, as a function of the viewer ─────────────────────────────────────────────────
-- (set_config, then `set local role`: exactly the lane `withTenantTx` builds.)

\echo '=================== FORM E (EXISTS_JOIN, the policy as shipped) ==================='
\echo '--- rows visible to V20 / V2 (sanity, form E)'
select set_config('request.jwt.claims', json_build_object('sub', '10400000-0000-4000-8001-00000000003c', 'role', 'authenticated',
  'tenant_id', '10400000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
select 'E V20 rows' as k, count(*) from public.stories;
select 'E V20 member rows' as k, count(*) from public.stories where visibility = 'followers';
\echo '--- (a) E: Inicio strip, V20'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, ap.avatar_asset_id, s.media_asset_id, s.media_kind, a.variant_widths, a.status,
       s.caption, s.published_at, s.expires_at, (s.expires_at > now()) as is_active, s.like_count, s.comment_count,
       exists (select 1 from public.feed_likes l where l.story_id = s.id and l.user_id = '10400000-0000-4000-8001-00000000003c'::uuid) as viewer_liked,
       (select count(*)::int from public.story_highlight_items hi where hi.story_id = s.id) as highlight_count,
       exists (select 1 from public.story_views v where v.tenant_id = '10400000-0000-4000-8000-000000000001'::uuid
                and v.user_id = '10400000-0000-4000-8001-00000000003c'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id
  left join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id and am.status = 'active' and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10400000-0000-4000-8000-000000000001' and s.deleted_at is null
   and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
\echo '--- (b) E: a member story by id, V20 (author member 5, followed)'
explain (analyze, buffers, costs off)
select s.id, s.caption, s.like_count, s.comment_count from public.stories s
 where s.id = '10400000-0000-4000-8003-000000000005';
\echo '--- (c) E: the comments page of S200, V20 (follows author 1)'
explain (analyze, buffers, costs off)
select c.id, c.body, c.created_at from public.feed_comments c
 where c.tenant_id = '10400000-0000-4000-8000-000000000001' and c.story_id = '10400000-0000-4000-8003-000000000001'
   and c.parent_id is null and c.deleted_at is null
 order by c.created_at, c.id limit 26;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10400000-0000-4000-8001-00000000003d', 'role', 'authenticated',
  'tenant_id', '10400000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
select 'E V2 rows' as k, count(*) from public.stories;
\echo '--- (d) E: Inicio strip, V2 (follows 2)'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, s.media_asset_id, s.caption, s.published_at, s.expires_at,
       exists (select 1 from public.story_views v where v.tenant_id = '10400000-0000-4000-8000-000000000001'::uuid
                and v.user_id = '10400000-0000-4000-8001-00000000003d'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
 where s.tenant_id = '10400000-0000-4000-8000-000000000001' and s.deleted_at is null
   and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
\echo '--- (c2) E: the comments page of S200, V2 (does NOT follow author 1; the story is a highlight story or hidden)'
explain (analyze, buffers, costs off)
select c.id, c.body, c.created_at from public.feed_comments c
 where c.tenant_id = '10400000-0000-4000-8000-000000000001' and c.story_id = '10400000-0000-4000-8003-000000000001'
   and c.parent_id is null and c.deleted_at is null
 order by c.created_at, c.id limit 26;
reset role;

-- ── candidate D: swap the policy inside this transaction ────────────────────────────────────────
create function app.story_highlight_readable_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct i.story_id), '{}'::uuid[])
    from public.story_highlight_items i
    join public.story_highlights h on h.id = i.highlight_id and h.tenant_id = i.tenant_id
    join public.communities c on c.id = h.community_id and c.tenant_id = h.tenant_id
   where i.tenant_id = app.tenant_id()
     and h.community_id is not null
     and c.deleted_at is null
     and c.id <> all (coalesce(app.member_community_hidden_ids(), '{}'::uuid[]))
$$;
revoke all on function app.story_highlight_readable_ids() from public;
grant execute on function app.story_highlight_readable_ids() to authenticated;
drop policy stories_audience_gate on public.stories;
create policy stories_audience_gate on public.stories as restrictive for select to authenticated
  using (visibility = 'tenant'
    or ((select app.social_enabled()) and ((select (app.tenant_role() = 'admin_tenant' or app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid))
         or author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))))
    or id = any (coalesce((select app.story_highlight_readable_ids()), '{}'::uuid[])));

\echo '=================== FORM D (IDS_DEFINER, ids array as an InitPlan) ==================='
select set_config('request.jwt.claims', json_build_object('sub', '10400000-0000-4000-8001-00000000003c', 'role', 'authenticated',
  'tenant_id', '10400000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
select 'D V20 rows' as k, count(*) from public.stories;
select 'D V20 member rows' as k, count(*) from public.stories where visibility = 'followers';
\echo '--- (a) D: Inicio strip, V20'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, ap.avatar_asset_id, s.media_asset_id, s.media_kind, a.variant_widths, a.status,
       s.caption, s.published_at, s.expires_at, (s.expires_at > now()) as is_active, s.like_count, s.comment_count,
       exists (select 1 from public.feed_likes l where l.story_id = s.id and l.user_id = '10400000-0000-4000-8001-00000000003c'::uuid) as viewer_liked,
       (select count(*)::int from public.story_highlight_items hi where hi.story_id = s.id) as highlight_count,
       exists (select 1 from public.story_views v where v.tenant_id = '10400000-0000-4000-8000-000000000001'::uuid
                and v.user_id = '10400000-0000-4000-8001-00000000003c'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
  join public.media_assets a on a.id = s.media_asset_id
  left join public.memberships am on am.tenant_id = s.tenant_id and am.user_id = s.author_user_id and am.status = 'active' and am.deleted_at is null
  left join public.member_profiles ap on ap.membership_id = am.id
 where s.tenant_id = '10400000-0000-4000-8000-000000000001' and s.deleted_at is null
   and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
\echo '--- (b) D: a member story by id, V20'
explain (analyze, buffers, costs off)
select s.id, s.caption, s.like_count, s.comment_count from public.stories s
 where s.id = '10400000-0000-4000-8003-000000000005';
\echo '--- (c) D: the comments page of S200, V20'
explain (analyze, buffers, costs off)
select c.id, c.body, c.created_at from public.feed_comments c
 where c.tenant_id = '10400000-0000-4000-8000-000000000001' and c.story_id = '10400000-0000-4000-8003-000000000001'
   and c.parent_id is null and c.deleted_at is null
 order by c.created_at, c.id limit 26;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '10400000-0000-4000-8001-00000000003d', 'role', 'authenticated',
  'tenant_id', '10400000-0000-4000-8000-000000000001', 'tenant_role', 'member')::text, true);
set local role authenticated;
select 'D V2 rows' as k, count(*) from public.stories;
\echo '--- (d) D: Inicio strip, V2 (follows 2)'
explain (analyze, buffers, costs off)
select s.id, s.author_user_id, s.media_asset_id, s.caption, s.published_at, s.expires_at,
       exists (select 1 from public.story_views v where v.tenant_id = '10400000-0000-4000-8000-000000000001'::uuid
                and v.user_id = '10400000-0000-4000-8001-00000000003d'::uuid and v.story_id = s.id) as viewer_seen
  from public.stories s
 where s.tenant_id = '10400000-0000-4000-8000-000000000001' and s.deleted_at is null
   and s.visibility = 'tenant' and s.expires_at > now()
 order by s.expires_at desc, s.id desc limit 26;
\echo '--- (c2) D: the comments page of S200, V2'
explain (analyze, buffers, costs off)
select c.id, c.body, c.created_at from public.feed_comments c
 where c.tenant_id = '10400000-0000-4000-8000-000000000001' and c.story_id = '10400000-0000-4000-8003-000000000001'
   and c.parent_id is null and c.deleted_at is null
 order by c.created_at, c.id limit 26;
reset role;

rollback;
