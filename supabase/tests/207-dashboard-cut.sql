begin;
-- 207-dashboard-cut.sql — Phase 09.1-11 (PAY-16, D-498, D-489; T-09.1-53 .. T-09.1-55): the owner
-- dashboard's active-member population without the members whose subscription is not active, executed
-- inside Postgres. `supabase/migrations/*_dashboard_exclude_cut.sql` re-creates four definer functions:
-- `app.dashboard_member_actions`, `app.dashboard_member_rows`, `app.dashboard_area_members` (their member
-- CTEs) and `app.dashboard_area_overview` (the KPI `members.count` / `members.newMembers`).
--
-- Four tenants with the SAME layout (admin, m1 granted, m2 with no access row, m3 blocked and with no
-- access row, m4 joined recently and granted by a gateway row, m5 joined recently with no access row):
--   X (gate ON)               m2 and m5 are cut (m3 too, but it is blocked); m1 and m4 are the active members.
--   G (no payments row)       nobody is cut: the old population (m1, m2, m4, m5) exactly.
--   H (module DISABLED, gate true)  the same as G (the set is empty when the module is off).
--   Y (gate ON)               the identity of X's m2 is a granted member here (P30).
--
-- 1. THE SET: `app.access_cut_user_ids` for X is {m2, m3, m5}, for G and H empty.
-- 2. DIRECT FUNCTIONS (claims set, no lane switch): the member rows and the counted actions of X leave
--    out m2 and m5; G and H equal the old predicate (inline copy), row for row.
-- 3. THE BUILD: member snapshot rows, `activeMembers30`, `growth.joined`, the engagement counts and the
--    overview KPI of X drop by exactly the cut members; G and H keep every figure; `previous` stays; the
--    other areas' payload keys (finance, support) are identical between X and G (money and conversations,
--    not members).
-- 4. THE RETURN AND THE CUT AFTER THE BUILD (P29, P34): a member returned by a new access row reappears at
--    the next build and brings the figures to the ungated minus one; a member cut AFTER a build stays in that
--    build's figures; rebuilding the same day twice yields the same payload.
-- 5. P30: the identity cut in X is a member of Y's rows, and X's cut does not touch Y's counts.
-- 6. POSTURE (T-09.1-54): the four functions keep their signatures, definer, empty search_path, volatility
--    and the owner-only ACL of their untouched siblings.
--
-- Fixture ids use the `20700000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(60);

-- ── helpers (rolled back with the file) ────────────────────────────────────────────────────────
create function pg_temp.d() returns date
language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date - 1 $$;
create function pg_temp.at(p_k int, p_time time default '12:00') returns timestamptz
language sql as $$ select ((pg_temp.d() - p_k)::timestamp + p_time) at time zone 'America/Sao_Paulo' $$;
-- id(t, n): tenant t (1..4), item n (0 = the tenant itself).
create function pg_temp.id(p_t int, p_n int) returns uuid
language sql as $$ select ('20700000-0000-4000-8000-' || lpad(to_hex(p_t * 4096 + p_n), 12, '0'))::uuid $$;
-- Items: 1 admin, 2 m1, 3 m2, 4 m3, 5 m4, 6 m5, 10..15 the six posts.
create function pg_temp.build(p_tenant uuid) returns boolean
language plpgsql as $$
declare
  v boolean;
begin
  perform tests.as_tenant(p_tenant, '00000000-0000-0000-0000-000000000000', 'support_tenant');
  v := app.dashboard_build_snapshot(pg_temp.d());
  reset role;
  return v;
end
$$;
-- The owner of the functions with a tenant claim and no lane role: the definers run as the owner anyway.
create function pg_temp.claims(p_tenant uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-000000000000', 'role', 'authenticated',
                      'tenant_id', p_tenant::text, 'tenant_role', 'support_tenant')::text, true)
$$;
create function pg_temp.rebuild(p_tenant uuid) returns boolean
language plpgsql as $$
begin
  delete from public.dashboard_snapshots where tenant_id = p_tenant and snapshot_day = pg_temp.d();
  return pg_temp.build(p_tenant);
end
$$;
create function pg_temp.payload(p_tenant uuid) returns jsonb
language sql as $$
  select s.payload from public.dashboard_snapshots s
   where s.tenant_id = p_tenant and s.snapshot_day = pg_temp.d()
$$;
create function pg_temp.members_n(p_tenant uuid, p_key text) returns int
language sql as $$ select (pg_temp.payload(p_tenant) -> 'members' ->> p_key)::int $$;
create function pg_temp.kpi(p_tenant uuid, p_key text) returns int
language sql as $$ select (pg_temp.payload(p_tenant) -> 'overview' -> 'members' ->> p_key)::int $$;
create function pg_temp.rows_n(p_tenant uuid) returns int
language sql as $$ select count(*)::int from public.dashboard_member_snapshots where tenant_id = p_tenant $$;
create function pg_temp.engaged_total(p_tenant uuid) returns int
language sql as $$
  select coalesce(sum(value::int), 0)::int
    from jsonb_each_text(pg_temp.payload(p_tenant) -> 'members' -> 'engagement' -> 'counts')
$$;
create function pg_temp.users_of_rows(p_tenant uuid) returns uuid[]
language plpgsql as $$
declare
  v uuid[];
begin
  perform pg_temp.claims(p_tenant);
  select coalesce(array_agg(r.user_id order by r.user_id), '{}') into v from app.dashboard_member_rows(pg_temp.d()) r;
  return v;
end
$$;
create function pg_temp.users_of_actions(p_tenant uuid) returns uuid[]
language plpgsql as $$
declare
  v uuid[];
begin
  perform pg_temp.claims(p_tenant);
  select coalesce(array_agg(distinct a.user_id order by a.user_id), '{}') into v
    from app.dashboard_member_actions(null, pg_temp.d()) a;
  return v;
end
$$;
create function pg_temp.old_population(p_tenant uuid) returns uuid[]
language sql as $$
  select coalesce(array_agg(ms.user_id order by ms.user_id), '{}')
    from public.memberships ms
   where ms.tenant_id = p_tenant and ms.role = 'member' and ms.status = 'active'
     and ms.blocked_at is null and ms.deleted_at is null
$$;
create function pg_temp.layout(p_t int, p_slug text, p_with_dual boolean default false) returns void
language plpgsql as $$
declare
  v_tenant uuid := pg_temp.id(p_t, 0);
  v_admin uuid := pg_temp.id(p_t, 1);
  v_user uuid;
  g int;
begin
  perform tests.tenant(p_slug, 'Corte ' || p_slug, v_tenant);
  update public.tenants set timezone = 'America/Sao_Paulo' where id = v_tenant;
  perform tests.auth_user('admin@' || p_slug || '.local', v_admin);
  perform tests.member(v_tenant, v_admin, 'admin_tenant');
  for g in 1..6 loop
    insert into public.feed_posts (id, tenant_id, caption, author_user_id, created_at)
    values (pg_temp.id(p_t, 9 + g), v_tenant, 'Aviso.', v_admin, pg_temp.at(150));
  end loop;
  -- m1..m5 are items 2..6. The dual identity of tenant Y is X's m2 (item 3 of tenant 1).
  for g in 2..6 loop
    v_user := pg_temp.id(p_t, g);
    if p_with_dual and g = 3 then
      v_user := pg_temp.id(1, 3);
    elsif p_with_dual then
      continue;
    else
      perform tests.auth_user('m' || (g - 1) || '@' || p_slug || '.local', v_user);
    end if;
    perform tests.member(v_tenant, v_user);
    -- m1..m3 joined 100 days ago, m4 and m5 five days ago.
    update public.memberships set joined_at = case when g in (5, 6) then pg_temp.at(5) else pg_temp.at(99) end
     where tenant_id = v_tenant and user_id = v_user;
    -- every member likes on five different recent days (m3 is blocked below, but acts anyway).
    insert into public.feed_likes (tenant_id, user_id, post_id, created_at)
    select v_tenant, v_user, pg_temp.id(p_t, 9 + k), pg_temp.at(k - 1) from generate_series(1, 5) as k;
  end loop;
  -- m3 (item 4) is blocked.
  update public.memberships set status = 'blocked', blocked_at = now()
   where tenant_id = v_tenant and user_id = pg_temp.id(p_t, 4);
end
$$;

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select pg_temp.layout(1, 'dcut-x');
select pg_temp.layout(2, 'dcut-g');
select pg_temp.layout(3, 'dcut-h');
select pg_temp.layout(4, 'dcut-y', true);
insert into public.tenant_modules (tenant_id, module_key, enabled, settings) values
  (pg_temp.id(1, 0), 'payments', true, '{"gate": true}'),
  (pg_temp.id(3, 0), 'payments', false, '{"gate": true}'),
  (pg_temp.id(4, 0), 'payments', true, '{"gate": true}');
-- X: m1 has a manual release, m4 an active gateway row; m2, m3 and m5 have nothing. Y: the dual identity
-- (X's m2) is released there.
insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values
  (pg_temp.id(1, 0), 'm1@dcut-x.local', 'manual', 'active', null, null),
  (pg_temp.id(1, 0), 'm4@dcut-x.local', 'gateway', 'active', 'fake_gw', 'dcut-r4'),
  (pg_temp.id(4, 0), 'm2@dcut-x.local', 'manual', 'active', null, null);

-- ── 1. the set ─────────────────────────────────────────────────────────────────────────────────
select is(
  (select array_agg(u order by u) from unnest(app.access_cut_user_ids(pg_temp.id(1, 0))) as u),
  array[pg_temp.id(1, 3), pg_temp.id(1, 4), pg_temp.id(1, 6)]::uuid[],
  'X: the cut set is m2, m3 and m5 (m1 and m4 are released; m3 is blocked as well, which the population and the Membros flag handle on their own)');
select is(cardinality(app.access_cut_user_ids(pg_temp.id(2, 0))), 0, 'G (no payments row): nobody is cut');
select is(cardinality(app.access_cut_user_ids(pg_temp.id(3, 0))), 0, 'H (module disabled, gate true): nobody is cut');
select is(cardinality(app.access_cut_user_ids(pg_temp.id(4, 0))), 0, 'Y: the dual identity is released, nobody is cut');

-- ── 2. the functions called directly ───────────────────────────────────────────────────────────
select is(pg_temp.users_of_rows(pg_temp.id(1, 0)), array[pg_temp.id(1, 2), pg_temp.id(1, 5)]::uuid[],
  'X: dashboard_member_rows lists m1 and m4 only (m2 and m5 are cut, m3 is blocked)');
select is(pg_temp.users_of_actions(pg_temp.id(1, 0)), array[pg_temp.id(1, 2), pg_temp.id(1, 5)]::uuid[],
  'X: dashboard_member_actions has the actions of m1 and m4 only');
select is(pg_temp.users_of_rows(pg_temp.id(2, 0)), pg_temp.old_population(pg_temp.id(2, 0)),
  'G: dashboard_member_rows equals the old predicate row for row');
select is(cardinality(pg_temp.users_of_rows(pg_temp.id(2, 0))), 4, 'G: four active members (m1, m2, m4, m5)');
select is(pg_temp.users_of_actions(pg_temp.id(2, 0)), pg_temp.old_population(pg_temp.id(2, 0)),
  'G: dashboard_member_actions equals the old predicate (every active member acted)');
select is(pg_temp.users_of_rows(pg_temp.id(3, 0)), pg_temp.old_population(pg_temp.id(3, 0)),
  'H (module disabled): dashboard_member_rows equals the old predicate');
select is(pg_temp.users_of_actions(pg_temp.id(3, 0)), pg_temp.old_population(pg_temp.id(3, 0)),
  'H (module disabled): dashboard_member_actions equals the old predicate');
select ok(not (pg_temp.id(1, 3) = any (pg_temp.users_of_rows(pg_temp.id(1, 0)))),
  'P30: the identity cut in X has no member row in X');
select ok(pg_temp.id(1, 3) = any (pg_temp.users_of_rows(pg_temp.id(4, 0))),
  'P30: the same identity is a member row in Y (granted there)');
select is(cardinality(pg_temp.users_of_rows(pg_temp.id(4, 0))), 1, 'Y: exactly one active member row');
select ok(not (pg_temp.id(1, 4) = any (pg_temp.users_of_rows(pg_temp.id(1, 0)))),
  'D-489: the blocked and cut member is out of the population, and only once (it is simply absent)');

-- ── 3. the build ───────────────────────────────────────────────────────────────────────────────
select is(pg_temp.build(pg_temp.id(1, 0)), true, 'X builds its yesterday');
select is(pg_temp.build(pg_temp.id(2, 0)), true, 'G builds its yesterday');
select is(pg_temp.build(pg_temp.id(3, 0)), true, 'H builds its yesterday');
select is(pg_temp.build(pg_temp.id(4, 0)), true, 'Y builds its yesterday');
select is(pg_temp.rows_n(pg_temp.id(1, 0)), 2, 'X: two member snapshot rows');
select is(pg_temp.rows_n(pg_temp.id(2, 0)), 4, 'G: four member snapshot rows');
select is(pg_temp.rows_n(pg_temp.id(3, 0)), 4, 'H: four member snapshot rows');
select is(pg_temp.rows_n(pg_temp.id(4, 0)), 1, 'Y: one member snapshot row (the dual identity)');
select is(pg_temp.members_n(pg_temp.id(1, 0), 'activeMembers30'), 2, 'X: activeMembers30 is 2');
select is(pg_temp.members_n(pg_temp.id(2, 0), 'activeMembers30'), 4, 'G: activeMembers30 is 4');
select is(pg_temp.members_n(pg_temp.id(3, 0), 'activeMembers30'), 4, 'H: activeMembers30 is 4');
select is((pg_temp.payload(pg_temp.id(1, 0)) -> 'members' -> 'growth' ->> 'joined')::int, 1,
  'X: growth.joined counts m4 only (m5 is cut)');
select is((pg_temp.payload(pg_temp.id(2, 0)) -> 'members' -> 'growth' ->> 'joined')::int, 2,
  'G: growth.joined counts m4 and m5');
select is(pg_temp.engaged_total(pg_temp.id(1, 0)), 2, 'X: the engagement bands add up to the 2 active members');
select is(pg_temp.engaged_total(pg_temp.id(2, 0)), 4, 'G: the engagement bands add up to the 4 active members');
select is((pg_temp.payload(pg_temp.id(1, 0)) -> 'members' -> 'engagement' -> 'counts' ->> 'new')::int, 1,
  'X: one new member (m4)');
select is((pg_temp.payload(pg_temp.id(2, 0)) -> 'members' -> 'engagement' -> 'counts' ->> 'new')::int, 2,
  'G: two new members (m4 and m5)');
select is(pg_temp.kpi(pg_temp.id(1, 0), 'count'), 2, 'X: the overview KPI count is 2');
select is(pg_temp.kpi(pg_temp.id(2, 0), 'count'), 4, 'G: the overview KPI count is 4');
select is(pg_temp.kpi(pg_temp.id(3, 0), 'count'), 4, 'H: the overview KPI count is 4');
select is(pg_temp.kpi(pg_temp.id(1, 0), 'newMembers'), 1, 'X: the overview KPI newMembers is 1');
select is(pg_temp.kpi(pg_temp.id(2, 0), 'newMembers'), 2, 'G: the overview KPI newMembers is 2');
select is(pg_temp.kpi(pg_temp.id(1, 0), 'previous'), pg_temp.kpi(pg_temp.id(2, 0), 'previous'),
  'the 30-day baseline (previous) is the same in X and G');
select is(pg_temp.payload(pg_temp.id(1, 0)) -> 'finance', pg_temp.payload(pg_temp.id(2, 0)) -> 'finance',
  'the finance area is identical in X and G (money, not members)');
select is(pg_temp.payload(pg_temp.id(1, 0)) -> 'support', pg_temp.payload(pg_temp.id(2, 0)) -> 'support',
  'the support area is identical in X and G (conversations, not members)');
select is(pg_temp.members_n(pg_temp.id(4, 0), 'activeMembers30'), 1,
  'P30: Y counts the dual identity as one active member although X cut it');

-- ── 4. the return, the cut after the build, the rebuild ────────────────────────────────────────
-- A cut AFTER the build (P29): m1's release is removed; the stored figures stay as built.
delete from public.access_grants where tenant_id = pg_temp.id(1, 0) and email = 'm1@dcut-x.local';
select is(pg_temp.kpi(pg_temp.id(1, 0), 'count'), 2, 'P29: a member cut after the build stays in that build''s figures');
select is(cardinality(app.access_cut_user_ids(pg_temp.id(1, 0))), 4, 'the live cut set already holds m1, m2, m3 and m5');
-- The next build excludes m1 too.
select is(pg_temp.rebuild(pg_temp.id(1, 0)), true, 'X rebuilds');
select is(pg_temp.rows_n(pg_temp.id(1, 0)), 1, 'the next build leaves m4 as the only active member');
select is(pg_temp.kpi(pg_temp.id(1, 0), 'count'), 1, 'the next build counts one active member');
-- A return: m1 and m2 get a release again.
insert into public.access_grants (tenant_id, email, source, status) values
  (pg_temp.id(1, 0), 'm1@dcut-x.local', 'manual', 'active'),
  (pg_temp.id(1, 0), 'm2@dcut-x.local', 'manual', 'active');
select is(pg_temp.rebuild(pg_temp.id(1, 0)), true, 'X rebuilds after the return');
select is(pg_temp.rows_n(pg_temp.id(1, 0)), 3, 'a returned member reappears at the next build (m1, m2, m4)');
select is(pg_temp.kpi(pg_temp.id(1, 0), 'count'), pg_temp.kpi(pg_temp.id(2, 0), 'count') - 1,
  'with one cut left (m5) the KPI is the ungated figure minus exactly one');
select is(pg_temp.members_n(pg_temp.id(1, 0), 'activeMembers30'), pg_temp.members_n(pg_temp.id(2, 0), 'activeMembers30') - 1,
  'activeMembers30 is the ungated figure minus exactly one');
select is((pg_temp.payload(pg_temp.id(1, 0)) -> 'members' -> 'growth' ->> 'joined')::int, 1,
  'growth.joined still leaves out the cut m5');
-- Rebuilding the same day twice yields the same payload (P34).
create temp table first_build as select pg_temp.payload(pg_temp.id(1, 0)) as p;
select is(pg_temp.rebuild(pg_temp.id(1, 0)), true, 'X rebuilds a third time');
select is(pg_temp.payload(pg_temp.id(1, 0)), (select p from first_build),
  'P34: rebuilding the same day yields the same payload');

-- ── 5. posture (T-09.1-54) ─────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef and 'search_path=""' = any(p.proconfig)
      and p.provolatile = 's' and p.prolang = (select oid from pg_language where lanname = 'sql')
      and p.proname in ('dashboard_member_actions', 'dashboard_member_rows', 'dashboard_area_members',
                        'dashboard_area_overview')),
  4, 'the four functions are SECURITY DEFINER, stable, sql, with an empty search_path');
select is(
  (select array_agg(p.proname::text || '/' || p.pronargs || '/' || coalesce(cardinality(p.proargnames), 0)
                    || '/' || p.prorettype::regtype::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('dashboard_member_actions', 'dashboard_member_rows', 'dashboard_area_members',
                        'dashboard_area_overview')),
  array['dashboard_area_members/1/1/jsonb', 'dashboard_area_overview/1/1/jsonb',
        'dashboard_member_actions/2/11/record', 'dashboard_member_rows/1/16/record'],
  'the signatures and return shapes are unchanged');
select ok(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated', 'service_role', 'api_user']) as r,
          unnest(array['app.dashboard_member_actions(date, date)', 'app.dashboard_member_rows(date)',
                       'app.dashboard_area_members(date)', 'app.dashboard_area_overview(date)']) as f),
  'the four functions are executable by no lane role');
select is(
  (select count(distinct p.proacl::text)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('dashboard_member_actions', 'dashboard_member_rows', 'dashboard_area_members',
                        'dashboard_area_overview', 'dashboard_area_content', 'dashboard_area_finance')),
  1, 'the ACL of the four equals the ACL of their untouched siblings');
select ok(
  (select bool_and(has_function_privilege('authenticated', 'app.dashboard_build_snapshot(date)', 'execute'))),
  'the builder keeps its grant to authenticated');
select ok(
  not has_function_privilege('anon', 'app.dashboard_build_snapshot(date)', 'execute'),
  'the builder is not executable by anon');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'dashboard_build_snapshot'),
  1, 'there is still one builder (untouched, no payload version bump)');

select * from finish();
rollback;
