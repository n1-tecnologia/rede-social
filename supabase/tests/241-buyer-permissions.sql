begin;
-- 241-buyer-permissions.sql — the buyer's permissions per product and community, executed inside Postgres
-- (11.1-02; BPERM-01..05, BPERM-09, BPERM-11, BPERM-25; D-880..D-882, D-886, D-887, D-890..D-892).
--
-- 1. THE TRACER PATH: a member of tenant A with an ACTIVE entitlement for a product linked to an ORGANIZATION
--    community with `can_post = true`, `social` and `store` on, inserts a `visibility = 'community'` post into it and
--    it is accepted; `app.community_action_allowed(community, 'post')` is true for that lane and false for the same
--    user under tenant B's claim.
-- 2. THE POST GATE: the same insert is refused 42501 with `can_post = false`, with no entitlement, with `social` off,
--    in an archived and in a soft-deleted community, and with the stamp `visibility = 'tenant'`; a staff insert into the
--    same community still passes. Every negative sits beside a positive control (the state is put back, then the
--    insert passes again).
--
-- Fixture ids use the `24100000-…` prefix and the tenants `pgtap-bperm-a` / `pgtap-bperm-b`. Like its siblings, this
-- file ROLLS BACK.
select plan(14);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-bperm-a', 'Permissoes A', '24100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-bperm-b', 'Permissoes B', '24100000-0000-4000-8000-000000000011');
select tests.auth_user('admin@bperm-a.local', '24100000-0000-4000-8000-000000000002');
select tests.auth_user('support@bperm-a.local', '24100000-0000-4000-8000-000000000003');
select tests.auth_user('buyer@bperm-a.local', '24100000-0000-4000-8000-000000000004');
select tests.auth_user('plain@bperm-a.local', '24100000-0000-4000-8000-000000000005');
select tests.auth_user('admin@bperm-b.local', '24100000-0000-4000-8000-000000000012');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
-- the buyer is ALSO a member of tenant B (BPERM-25: the same user under another claim)
select tests.member('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select tests.member('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'admin_tenant');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('24100000-0000-4000-8000-000000000001', 'social', true),
  ('24100000-0000-4000-8000-000000000001', 'store', true),
  ('24100000-0000-4000-8000-000000000011', 'social', true),
  ('24100000-0000-4000-8000-000000000011', 'store', true);
-- CA: the organization community of A that the buyer's product opens. CB: tenant B's organization community.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('24100000-0000-4000-8000-0000000000c1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Base A', 'base-a', 'organization', 0),
  ('24100000-0000-4000-8000-0000000000d1', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'Base B', 'base-b', 'organization', 0);
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24100000-0000-4000-8000-0000000000a1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P1', 1990, 'active'),
  ('24100000-0000-4000-8000-0000000000b1', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'PB', 1990, 'active');
-- P1 -> CA with the post flag on (like and comment and share keep their defaults); PB -> CB, flags at the defaults
insert into public.store_product_communities (tenant_id, product_id, community_id, can_post) values
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a1', '24100000-0000-4000-8000-0000000000c1', true);
insert into public.store_product_communities (tenant_id, product_id, community_id) values
  ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000000b1', '24100000-0000-4000-8000-0000000000d1');
-- the buyer holds P1 in A and PB in B (two tenants, one user)
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24100000-0000-4000-8000-0000000000e1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004',
   '24100000-0000-4000-8000-0000000000a1', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000000e2', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004',
   '24100000-0000-4000-8000-0000000000b1', 'grant', '24100000-0000-4000-8000-000000000012');

-- ── 1. the tracer path ─────────────────────────────────────────────────────────────────────────
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, 'post'), true,
  '1: the buyer of P1 holds post in CA (the union over active entitlements)');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'do comprador', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '1: the buyer publishes a visibility community post into the organization community');
select results_eq(
  $$ select visibility from public.feed_posts where caption = 'do comprador' $$,
  ARRAY['community'::text], '1: …and the row reads visibility community (never tenant)');
reset role;
-- BPERM-25: the same user under tenant B's claim does not reach tenant A's community
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, 'post'), false,
  '1: BPERM-25: the same user under tenant B''s claim does not hold post in tenant A''s community');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1'::uuid, 'post'), false,
  '1: …and holds no post in B''s own community either (PB carries the defaults: post off) — a positive control for the claim');
reset role;

-- ── 2. the post gate ───────────────────────────────────────────────────────────────────────────
-- a forged stamp: a member can never stamp 'tenant'
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'forjado', 'tenant', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: a buyer cannot stamp visibility tenant (42501)');
reset role;
-- no entitlement: the plain member is refused, the buyer (above) is not
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005', 'sem produto', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: a member with no entitlement is refused (42501)');
reset role;
-- the flag off
update public.store_product_communities set can_post = false
 where product_id = '24100000-0000-4000-8000-0000000000a1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'sem a flag', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: can_post = false refuses the buyer (42501)');
reset role;
update public.store_product_communities set can_post = true
 where product_id = '24100000-0000-4000-8000-0000000000a1';
-- social off
update public.tenant_modules set enabled = false
 where tenant_id = '24100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'social off', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: social off refuses the buyer (42501): the gate carries its own social term');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '24100000-0000-4000-8000-000000000001' and module_key = 'social';
-- archived community
update public.communities set status = 'archived' where id = '24100000-0000-4000-8000-0000000000c1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'arquivada', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: an archived community refuses the buyer (42501)');
reset role;
update public.communities set status = 'active' where id = '24100000-0000-4000-8000-0000000000c1';
-- soft-deleted community
update public.communities set deleted_at = now() where id = '24100000-0000-4000-8000-0000000000c1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'apagada', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '2: a soft-deleted community refuses the buyer (42501)');
reset role;
update public.communities set deleted_at = null where id = '24100000-0000-4000-8000-0000000000c1';
-- the positive control after every state was put back
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'de novo', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '2: with every state put back the buyer publishes again (positive control)');
reset role;
-- the staff positive control: the organization voice into the same community still passes
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'da organizacao', 'tenant', '24100000-0000-4000-8000-0000000000c1') $$,
  '2: an admin_tenant inserts the organization post into the same community (positive control)');
reset role;
-- the buyer of tenant B (no post flag there) is refused in B's community
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', 'em B', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '42501', null, '2: BPERM-25: the buyer''s post flag lives in tenant A only; in tenant B the same user is refused (42501)');
reset role;

select * from finish();
rollback;
