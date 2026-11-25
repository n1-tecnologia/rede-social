begin;
-- 242-buyer-permissions-plans.sql — the plan shape of the buyer-permissions read idioms (11.1-07; BPERM-15, T-11.1-26;
-- D-886, D-888). 241-buyer-permissions.sql belongs to plans 02, 03, 04 and 11, so the plan pins of the READ side live here
-- (plan 08 appends the feed and Reels pins to this file).
--
-- 1. THE COMMUNITY PROJECTION IDIOM: `communityProjection` selects `(select app.community_buyer_scope()) -> c.id::text` as a
--    scalar column. Over twelve organization communities of the buyer's tenant the statement plans the function as an
--    `InitPlan`, never as a per-row `SubPlan` and never as a join to a function scan.
-- 2. EVALUATED ONCE: with function tracking on, the same select over the twelve communities calls the scope function exactly
--    ONCE in the transaction (an InitPlan is evaluated once per statement, a per-row form would call it twelve times), and
--    the buyer's column is non-null for the two linked communities and null for the ten that carry no link.
--
-- Fixture ids use the `24200000-…` prefix and the tenant `pgtap-bperm-plans`. Like its siblings, this file ROLLS BACK.
select plan(7);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-bperm-plans', 'Permissoes planos', '24200000-0000-4000-8000-000000000001');
select tests.auth_user('admin@bperm-plans.local', '24200000-0000-4000-8000-000000000002');
select tests.auth_user('buyer@bperm-plans.local', '24200000-0000-4000-8000-000000000004');
select tests.member('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000004');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('24200000-0000-4000-8000-000000000001', 'social', true),
  ('24200000-0000-4000-8000-000000000001', 'store', true);
-- twelve organization communities; the product links the first two
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position)
select ('242c0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       '24200000-0000-4000-8000-000000000001',
       '24200000-0000-4000-8000-000000000002',
       'Comunidade ' || g, 'comunidade-' || g, 'organization', g
  from generate_series(1, 12) g;
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24200000-0000-4000-8000-0000000000a1', '24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000002', 'P1', 1990, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id, can_post) values
  ('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-0000000000a1', '242c0000-0000-4000-8000-000000000001', true),
  ('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-0000000000a1', '242c0000-0000-4000-8000-000000000002', false);
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24200000-0000-4000-8000-0000000000e1', '24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000004',
   '24200000-0000-4000-8000-0000000000a1', 'grant', '24200000-0000-4000-8000-000000000002');
analyze public.communities;
-- function call counts are only collected when asked for, and the setting is superuser-only (the migration role here)
set local track_functions = 'all';

-- ── 1. the projection idiom plans as an InitPlan ───────────────────────────────────────────────
select tests.as_tenant('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000004');
do $$
declare
  v_plan text := '';
  v_line text;
begin
  -- exactly the column `communityProjection` adds, over the table the projection reads, in the member lane
  for v_line in execute
    'explain (costs off) select c.id, (select app.community_buyer_scope()) -> c.id::text as buyer_scope
       from public.communities c
      where c.status = ''active''
      order by c.position, c.last_activity_at desc, c.id desc limit 25'
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  perform set_config('tests.plan_scope', v_plan, true);
end
$$;
select matches(current_setting('tests.plan_scope'), 'InitPlan',
  '1: the buyer scope column of the community projection is evaluated as an InitPlan (once per statement)');
select doesnt_match(current_setting('tests.plan_scope'), '(?<!Init)SubPlan',
  '1: …and never as a per-row SubPlan');
select doesnt_match(current_setting('tests.plan_scope'), 'Function Scan|Nested Loop|Hash Join|Merge Join',
  '1: …and never as a join to a function scan (the list stays one statement over `communities`)');
reset role;

-- ── 2. evaluated once, and the column carries the buyer's entries ──────────────────────────────
select tests.as_tenant('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000004');
do $$
declare
  v_before bigint;
  v_after bigint;
  v_linked int;
  v_rows int;
begin
  v_before := coalesce(pg_stat_get_xact_function_calls('app.community_buyer_scope()'::regprocedure), 0);
  select count(*), count(q.buyer_scope)
    into v_rows, v_linked
    from (select c.id, (select app.community_buyer_scope()) -> c.id::text as buyer_scope
            from public.communities c
           where c.status = 'active') q;
  v_after := coalesce(pg_stat_get_xact_function_calls('app.community_buyer_scope()'::regprocedure), 0);
  perform set_config('tests.scope_rows', v_rows::text, true);
  perform set_config('tests.scope_linked', v_linked::text, true);
  perform set_config('tests.scope_calls', (v_after - v_before)::text, true);
end
$$;
select is(current_setting('tests.scope_rows'), '12', '2: the projection select returns the twelve communities');
select is(current_setting('tests.scope_calls'), '1',
  '2: …and calls the scope function exactly once for them (an InitPlan; a per-row form would call it twelve times)');
select is(current_setting('tests.scope_linked'), '2',
  '2: …and the buyer column is non-null for the two linked communities only (the ten without a link read no entry)');
reset role;
-- the same select in a staff lane reads no entry at all: the column is null for every row
select tests.as_tenant('24200000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000002', 'admin_tenant');
select is(
  (select count(q.buyer_scope)::int
     from (select c.id, (select app.community_buyer_scope()) -> c.id::text as buyer_scope
             from public.communities c where c.status = 'active') q),
  0, '2: a staff lane reads no buyer entry on any row (staff keep today''s values)');
reset role;

select * from finish();
rollback;
