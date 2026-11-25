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
-- 3. CATALOG AND DEFAULTS (D-890, D-891): the five link flags and `story_highlights.open_to_buyers` exist, are NOT NULL and
--    carry the defaults; a link or a highlight written naming no flag reads today's behaviour; two writes for one product
--    and community collide on the unique index and leave one row.
-- 4. THE SCOPE MAP TRUTH TABLE (`app.community_buyer_scope`, D-886, D-887, D-892): one product, two products with equal
--    flags (one entry), two products whose flags differ (the union), a revoked entitlement (`{}` at the next statement)
--    and a new active one, the `store` module off, staff by claim, a null role and a lane with no claims (`{}`), the same
--    user under another tenant's claim, a member-created, an archived and a soft-deleted community that carry a link, and
--    `openHighlight` only while an open highlight exists.
-- 5. THE WRAPPERS: `app.community_action_allowed` answers true only for the five lowercase names (never `openHighlight`, a
--    case variant, a padded name, an empty string or a null) and never null; `app.community_action_denied_ids` is the lane
--    form (staff: empty set; a null role denies; a community with no link is never in it).
-- 6. THE EQUIVALENCE INVARIANT: for every community and every action, the map, the allowed wrapper and the denied-ids
--    membership agree with the union computed straight from the links and the active entitlements, for seven lanes.
-- 7. THE CATALOG: all three functions are SECURITY DEFINER, stable, with an empty `search_path`, executable by
--    `authenticated` and not by `anon`; the stub-first order left the final bodies in place and the policy still depends
--    on the same function.
-- 8. THE POST GATE MATRIX: member-created, archived, soft-deleted and un-linked communities, another tenant's community and
--    a forged tenant stamp are refused with 42501; two products whose flags differ give the union; the positive control.
--
-- 20. THE CROSS-TENANT MATRIX (11.1-11, BPERM-25, D-886): every function and every gate of plans 02 to 04 driven as a member of
--    tenant A against tenant B's rows and as the same user under tenant B's claim, each negative beside a positive control.
-- 21. EMPTY AND SAME-NAME (11.1-11): a tenant that owns nothing answers empty or false and never errors; two tenants with a
--    community of the same name and slug and one shared user never answer for each other; the answers do not depend on order.
-- 22. THE META CHECK (11.1-11): the new functions and the policies that call them are listed from the catalog and compared with
--    what section 20 exercised, so a function or a gate added later cannot ship without a cross-tenant negative.
--
-- Fixture ids use the `24100000-…` prefix and the tenants `pgtap-bperm-a` / `pgtap-bperm-b`. Like its siblings, this
-- file ROLLS BACK.
select plan(304);

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

-- ── fixture for sections 3 to 8 (as the migration role; section 2 put every state back) ────────
select tests.auth_user('m3@bperm-a.local', '24100000-0000-4000-8000-000000000006');
select tests.auth_user('m4@bperm-a.local', '24100000-0000-4000-8000-000000000007');
select tests.auth_user('m5@bperm-a.local', '24100000-0000-4000-8000-000000000008');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000006');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000007');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008');
-- CA (c1, above): organization, linked to P1 and P6 (equal flags). CA2 (c2): organization, linked to P2 and P3 (different
-- flags). CNL (c3): organization, NO link. CM (c4): a MEMBER community made by the plain member, carrying a link. CAR (c5):
-- organization, archived, linked. CDEL (c6): organization, soft-deleted, linked.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position, status, deleted_at) values
  ('24100000-0000-4000-8000-0000000000c2', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Dois produtos', 'dois-produtos', 'organization', 1, 'active', null),
  ('24100000-0000-4000-8000-0000000000c3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Sem produto', 'sem-produto', 'organization', 2, 'active', null),
  ('24100000-0000-4000-8000-0000000000c4', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005', 'De membro', 'de-membro', 'member', 1000000, 'active', null),
  ('24100000-0000-4000-8000-0000000000c5', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Arquivada', 'arquivada', 'organization', 3, 'archived', null),
  ('24100000-0000-4000-8000-0000000000c6', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Apagada', 'apagada', 'organization', 4, 'active', now());
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24100000-0000-4000-8000-0000000000a2', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P2', 100, 'active'),
  ('24100000-0000-4000-8000-0000000000a3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P3', 100, 'active'),
  ('24100000-0000-4000-8000-0000000000a5', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P5', 100, 'active'),
  ('24100000-0000-4000-8000-0000000000a6', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P6', 100, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id, can_like, can_comment, can_share, can_post, can_story) values
  -- P6 -> CA with the SAME flags as P1 -> CA (like, comment, share, post on; story off)
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a6', '24100000-0000-4000-8000-0000000000c1', true, true, true, true, false),
  -- P2 -> CA2: like only. P3 -> CA2: post only. The union holds like and post.
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a2', '24100000-0000-4000-8000-0000000000c2', true, false, false, false, false),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a3', '24100000-0000-4000-8000-0000000000c2', false, false, false, true, false),
  -- P5 -> a member community, an archived and a soft-deleted organization community, each with post on
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a5', '24100000-0000-4000-8000-0000000000c4', true, true, true, true, true),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a5', '24100000-0000-4000-8000-0000000000c5', true, true, true, true, false),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a5', '24100000-0000-4000-8000-0000000000c6', true, true, true, true, false);
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  -- M1 also holds P6 (equal flags with P1 on the same community)
  ('24100000-0000-4000-8000-0000000000e3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-0000000000a6', 'grant', '24100000-0000-4000-8000-000000000002'),
  -- M3 holds P2 and P3 (the union), M4 holds P1 (the revoke subject), M5 holds P5
  ('24100000-0000-4000-8000-0000000000e4', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000006', '24100000-0000-4000-8000-0000000000a2', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000000e5', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000006', '24100000-0000-4000-8000-0000000000a3', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000000e6', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000007', '24100000-0000-4000-8000-0000000000a1', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000000e7', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008', '24100000-0000-4000-8000-0000000000a5', 'grant', '24100000-0000-4000-8000-000000000002');
-- one highlight of CA, written naming no flag (section 3 reads its default)
insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id) values
  ('24100000-0000-4000-8000-0000000000f1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000c1', 'Aula', 0, '24100000-0000-4000-8000-000000000002');

-- ── 3. catalog and defaults ────────────────────────────────────────────────────────────────────
select is(
  (select string_agg(a.attname::text || ':' || a.attnotnull::text || ':' || pg_get_expr(d.adbin, d.adrelid), ',' order by a.attname::text)
     from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.store_product_communities'::regclass
      and a.attname::text in ('can_like', 'can_comment', 'can_share', 'can_post', 'can_story')),
  'can_comment:true:true,can_like:true:true,can_post:true:false,can_share:true:true,can_story:true:false',
  '3: the five link flags are NOT NULL with the defaults like, comment, share on and post, story off');
select is(
  (select a.attnotnull::text || ':' || pg_get_expr(d.adbin, d.adrelid)
     from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.story_highlights'::regclass and a.attname::text = 'open_to_buyers'),
  'true:false', '3: story_highlights.open_to_buyers is NOT NULL and defaults to false');
select results_eq(
  $$ select can_like, can_comment, can_share, can_post, can_story from public.store_product_communities
      where product_id = '24100000-0000-4000-8000-0000000000b1' $$,
  $$ values (true, true, true, false, false) $$,
  '3: BPERM-01 empty: a link written naming no flag reads true, true, true, false, false');
select results_eq(
  $$ select open_to_buyers from public.story_highlights where id = '24100000-0000-4000-8000-0000000000f1' $$,
  ARRAY[false], '3: …and a highlight written naming no flag is closed to buyers');
select throws_ok(
  $$ insert into public.store_product_communities (tenant_id, product_id, community_id, can_story)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a1', '24100000-0000-4000-8000-0000000000c1', true) $$,
  '23505', null, '3: BPERM-01 adjacency: a second write for the same product and community collides on the unique index');
select results_eq(
  $$ select count(*)::int, bool_and(can_post), bool_and(not can_story) from public.store_product_communities
      where product_id = '24100000-0000-4000-8000-0000000000a1' and community_id = '24100000-0000-4000-8000-0000000000c1' $$,
  $$ values (1, true, true) $$,
  '3: …and the one row keeps its stored flags (the migration and the collision leave a stored flag untouched)');

-- ── 4. the scope map truth table ───────────────────────────────────────────────────────────────
-- M1: P1 and P6 on the SAME community with equal flags -> ONE entry (adjacency); a closed highlight exists
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is((select app.community_buyer_scope()),
  '{"24100000-0000-4000-8000-0000000000c1": {"like": true, "comment": true, "share": true, "post": true, "story": false, "openHighlight": false}}'::jsonb,
  '4: BPERM-03: two products with equal flags on one community give ONE map entry with those flags, openHighlight false');
select is((select count(*)::int from jsonb_object_keys((select app.community_buyer_scope()))), 1,
  '4: …exactly one key (the other tenant''s community, the un-linked and member-created ones are absent)');
select is((select count(distinct s)::int from (select app.community_buyer_scope() as s from generate_series(1, 3)) q), 1,
  '4: BPERM-03 idempotency: the function is stable, repeated calls return the same map');
reset role;
-- M3: two products whose flags differ -> the union (like from P2, post from P3)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000006');
select is((select app.community_buyer_scope()),
  '{"24100000-0000-4000-8000-0000000000c2": {"like": true, "comment": false, "share": false, "post": true, "story": false, "openHighlight": false}}'::jsonb,
  '4: D-886: two products with different flags give the union (like from one, post from the other)');
reset role;
-- M5: the member-created and the soft-deleted community are absent; the archived organization one stays (like the access OR)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008');
select is((select app.community_buyer_scope()),
  '{"24100000-0000-4000-8000-0000000000c5": {"like": true, "comment": true, "share": true, "post": true, "story": false, "openHighlight": false}}'::jsonb,
  '4: D-880: a member-created and a soft-deleted community that carry a link are absent; an archived organization one is not (the gate refuses it)');
reset role;
-- M2: no entitlement at all
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: BPERM-03 empty: a member with no entitlement gets the empty map');
reset role;
-- openHighlight follows an open highlight of the community, and only while it exists
update public.story_highlights set open_to_buyers = true where id = '24100000-0000-4000-8000-0000000000f1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is((select app.community_buyer_scope() -> '24100000-0000-4000-8000-0000000000c1' ->> 'openHighlight'), 'true',
  '4: D-884: openHighlight is true while an open highlight exists in the community');
reset role;
update public.story_highlights set open_to_buyers = false where id = '24100000-0000-4000-8000-0000000000f1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is((select app.community_buyer_scope() -> '24100000-0000-4000-8000-0000000000c1' ->> 'openHighlight'), 'false',
  '4: …and false again once the highlight is closed');
reset role;
-- revoke: M4 holds P1 -> the entitlement is revoked -> the map is empty at the next statement; a new active one returns it
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000007');
select isnt((select app.community_buyer_scope()), '{}'::jsonb, '4: D-887: M4 holding P1 has a non-empty map (positive control)');
reset role;
update public.store_entitlements set status = 'revoked', revoked_at = now() where id = '24100000-0000-4000-8000-0000000000e6';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000007');
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: BPERM-05: the entitlement revoked, the map is empty at the next statement');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, 'like'), false,
  '4: …and the wrapper answers false for even the default like');
reset role;
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24100000-0000-4000-8000-0000000000e8', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000007', '24100000-0000-4000-8000-0000000000a1', 'grant', '24100000-0000-4000-8000-000000000002');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000007');
select isnt((select app.community_buyer_scope()), '{}'::jsonb, '4: …a new active entitlement returns the grant');
reset role;
-- the store module off: nothing is granted
update public.tenant_modules set enabled = false
 where tenant_id = '24100000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: the store module off gives the empty map');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '24100000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select isnt((select app.community_buyer_scope()), '{}'::jsonb, '4: …and the module back on returns the grant (positive control)');
reset role;
-- staff by claim, a null role and a lane with no claims hold no product grant even with an entitlement of their own
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: D-892: the admin_tenant lane gets the empty map');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000003', 'support_tenant');
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: …the support_tenant lane too');
reset role;
-- the buyer's own claim with the role stripped: the explicit member claim is required
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', null);
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: a null role holds no grant even for the buyer of P1');
reset role;
select tests.as_tenant_without_claims();
select is((select app.community_buyer_scope()), '{}'::jsonb, '4: a lane with no claims gets the empty map');
reset role;
-- BPERM-25: the same user under tenant B's claim holds only tenant B's grant
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select is((select app.community_buyer_scope()),
  '{"24100000-0000-4000-8000-0000000000d1": {"like": true, "comment": true, "share": true, "post": false, "story": false, "openHighlight": false}}'::jsonb,
  '4: BPERM-25: the buyer under tenant B''s claim holds only tenant B''s community, never tenant A''s');
reset role;

-- ── 5. the wrappers ────────────────────────────────────────────────────────────────────────────
-- an OPEN highlight exists in CA while the allowed wrapper is asked: 'openHighlight' must still answer false
update public.story_highlights set open_to_buyers = true where id = '24100000-0000-4000-8000-0000000000f1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select results_eq(
  $$ select coalesce(a.x, 'zz-null') collate "C", app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, a.x)
       from (values ('like'), ('comment'), ('share'), ('post'), ('story'), ('openHighlight'), ('Like'), ('POST'), ('post '), (''), (null::text)) a(x)
      order by 1 $$,
  $$ values (''::text collate "C", false), ('Like', false), ('POST', false), ('comment', true), ('like', true),
            ('openHighlight', false), ('post', true), ('post ', false), ('share', true), ('story', false), ('zz-null', false) $$,
  '5: BPERM-04: only the five lowercase names answer, and only through a product grant: openHighlight (while an open highlight exists), case variants, a padded name, an empty string and a null answer false');
select is(app.community_action_allowed(null, 'post'), false, '5: BPERM-04 empty: a null community answers false, never null');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000ff'::uuid, 'post'), false, '5: …a bogus community id answers false');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c3'::uuid, 'like'), false, '5: …an organization community with no linked product answers false (D-892)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c4'::uuid, 'post'), false, '5: …a member-created community answers false (D-880) though it carries a link');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1'::uuid, 'like'), false, '5: …another tenant''s community answers false (BPERM-25)');
-- the lane form: communities that carry a link and where the action is NOT held. M1 holds like in CA only.
select is(array(select unnest(app.community_action_denied_ids('like')) order by 1),
  array['24100000-0000-4000-8000-0000000000c2', '24100000-0000-4000-8000-0000000000c5', '24100000-0000-4000-8000-0000000000c6']::uuid[],
  '5: denied_ids(like) for M1 holds the linked organization communities where like is not held; the held one, the un-linked one and the member-created one are not in it');
select is(array(select unnest(app.community_action_denied_ids('story')) order by 1),
  array['24100000-0000-4000-8000-0000000000c1', '24100000-0000-4000-8000-0000000000c2', '24100000-0000-4000-8000-0000000000c5', '24100000-0000-4000-8000-0000000000c6']::uuid[],
  '5: denied_ids(story) adds the community where story is not held');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.community_action_denied_ids('like'), '{}'::uuid[], '5: D-892: staff by claim get the empty denied set');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, 'post'), false, '5: …and the allowed wrapper never grants staff (they hold every action by role, not by product)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.community_action_denied_ids('like'), '{}'::uuid[], '5: …the support_tenant lane too');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', null);
select is(array(select unnest(app.community_action_denied_ids('like')) order by 1),
  array['24100000-0000-4000-8000-0000000000c1', '24100000-0000-4000-8000-0000000000c2', '24100000-0000-4000-8000-0000000000c5', '24100000-0000-4000-8000-0000000000c6']::uuid[],
  '5: D-888: a null role takes the member branch and denies every linked organization community, the buyer''s own included');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, 'like'), false, '5: …and the allowed wrapper answers false for a null role');
reset role;
select tests.as_tenant_without_claims();
select is(app.community_action_denied_ids('like'), '{}'::uuid[], '5: a lane with no claims has no tenant, so the denied set is empty (the tenant policies match nothing)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1'::uuid, 'like'), false, '5: …and the allowed wrapper answers false');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_denied_ids('like'), '{}'::uuid[], '5: BPERM-25: under tenant B''s claim the buyer holds like in B''s community, so nothing of B is denied and tenant A is not reached');
select is(array(select unnest(app.community_action_denied_ids('post'))), array['24100000-0000-4000-8000-0000000000d1']::uuid[],
  '5: …and post (off in B) denies exactly B''s community');
reset role;
update public.story_highlights set open_to_buyers = false where id = '24100000-0000-4000-8000-0000000000f1';

-- ── 6. the equivalence invariant ───────────────────────────────────────────────────────────────
-- For one lane (user, tenant, role): for every fixture community and every action, the map, the allowed wrapper and the
-- denied-ids membership are compared with the union computed straight from the links and the active entitlements. The
-- claims are set WITHOUT switching role (the definers bypass RLS themselves), so the direct union reads every row.
create function pg_temp.equiv(p_user uuid, p_tenant uuid, p_role text) returns bigint
language plpgsql as $$
declare
  v_bad bigint;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user::text, 'role', 'authenticated', 'tenant_id', p_tenant::text, 'tenant_role', p_role)::text, true);
  select count(*) into v_bad
    from (values ('24100000-0000-4000-8000-0000000000c1'::uuid), ('24100000-0000-4000-8000-0000000000c2'::uuid),
                 ('24100000-0000-4000-8000-0000000000c3'::uuid), ('24100000-0000-4000-8000-0000000000c4'::uuid),
                 ('24100000-0000-4000-8000-0000000000c5'::uuid), ('24100000-0000-4000-8000-0000000000c6'::uuid),
                 ('24100000-0000-4000-8000-0000000000d1'::uuid), ('24100000-0000-4000-8000-0000000000ff'::uuid),
                 (null::uuid)) c(id)
   cross join (values ('like'), ('comment'), ('share'), ('post'), ('story')) a(x)
   cross join lateral (
     select coalesce((
              select bool_or(case a.x when 'like' then l.can_like when 'comment' then l.can_comment
                                      when 'share' then l.can_share when 'post' then l.can_post else l.can_story end)
                from public.store_product_communities l
                join public.store_entitlements e on e.tenant_id = l.tenant_id and e.product_id = l.product_id
                join public.communities cc on cc.id = l.community_id and cc.tenant_id = l.tenant_id
               where l.community_id = c.id and l.tenant_id = p_tenant
                 and e.user_id = p_user and e.status = 'active'
                 and p_role = 'member' and cc.kind = 'organization' and cc.deleted_at is null
                 and exists (select 1 from public.tenant_modules tm
                              where tm.tenant_id = p_tenant and tm.module_key = 'store' and tm.enabled)), false) as want,
            (coalesce(p_role, '') not in ('admin_tenant', 'support_tenant')
              and exists (select 1 from public.store_product_communities l
                            join public.communities cc on cc.id = l.community_id and cc.tenant_id = l.tenant_id
                           where l.community_id = c.id and l.tenant_id = p_tenant and cc.kind = 'organization'
                             and exists (select 1 from public.tenant_modules tm
                                          where tm.tenant_id = p_tenant and tm.module_key = 'store' and tm.enabled))) as linked
   ) w
   where coalesce((app.community_buyer_scope() -> c.id::text ->> a.x) = 'true', false) is distinct from w.want
      or app.community_action_allowed(c.id, a.x) is distinct from w.want
      or coalesce(c.id = any (app.community_action_denied_ids(a.x)), false) is distinct from (w.linked and not w.want);
  perform set_config('request.jwt.claims', '', true);
  return v_bad;
end
$$;
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000001', 'member'), 0::bigint,
  '6: the buyer of P1 and P6: the map, the allowed wrapper and the denied set equal the direct union for every community and action');
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000006', '24100000-0000-4000-8000-000000000001', 'member'), 0::bigint,
  '6: the holder of P2 and P3 (the union): all three agree');
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000008', '24100000-0000-4000-8000-000000000001', 'member'), 0::bigint,
  '6: the holder of P5 (member-created, archived and soft-deleted links): all three agree');
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000001', 'member'), 0::bigint,
  '6: the member with no entitlement: all three agree');
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000011', 'member'), 0::bigint,
  '6: BPERM-25: the buyer under tenant B''s claim: all three agree');
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000001', 'admin_tenant'), 0::bigint,
  '6: the admin_tenant lane: all three agree (nothing granted, nothing denied)');
select is(pg_temp.equiv('24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000001', null), 0::bigint,
  '6: the buyer with a null role: all three agree (no grant, every linked community denied)');

-- ── 7. the catalog ─────────────────────────────────────────────────────────────────────────────
select ok((select prosecdef and provolatile = 's' and 'search_path=""' = any (proconfig)
             from pg_proc where oid = to_regprocedure('app.community_buyer_scope()')),
  '7: community_buyer_scope is SECURITY DEFINER, stable, with an empty search_path');
select ok((select prosecdef and provolatile = 's' and 'search_path=""' = any (proconfig)
             from pg_proc where oid = to_regprocedure('app.community_action_allowed(uuid, text)')),
  '7: community_action_allowed is SECURITY DEFINER, stable, with an empty search_path');
select ok((select prosecdef and provolatile = 's' and 'search_path=""' = any (proconfig)
             from pg_proc where oid = to_regprocedure('app.community_action_denied_ids(text)')),
  '7: community_action_denied_ids is SECURITY DEFINER, stable, with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.community_buyer_scope()', 'EXECUTE')
          and not has_function_privilege('anon', 'app.community_buyer_scope()', 'EXECUTE'),
  '7: community_buyer_scope is executable by authenticated and not by anon');
select ok(has_function_privilege('authenticated', 'app.community_action_allowed(uuid, text)', 'EXECUTE')
          and not has_function_privilege('anon', 'app.community_action_allowed(uuid, text)', 'EXECUTE'),
  '7: community_action_allowed is executable by authenticated and not by anon');
select ok(has_function_privilege('authenticated', 'app.community_action_denied_ids(text)', 'EXECUTE')
          and not has_function_privilege('anon', 'app.community_action_denied_ids(text)', 'EXECUTE'),
  '7: community_action_denied_ids is executable by authenticated and not by anon');
select ok((select pg_get_functiondef(oid) like '%community_buyer_scope%' from pg_proc where oid = to_regprocedure('app.community_action_allowed(uuid, text)')),
  '7: the replaced body of community_action_allowed is the product-grant one, not the constant-false stub');
select ok((select pg_get_functiondef(oid) like '%store_product_communities%' from pg_proc where oid = to_regprocedure('app.community_action_denied_ids(text)')),
  '7: the stub-first order left the STORE body of community_action_denied_ids in place');
select ok(exists (select 1 from pg_depend d join pg_policy p on p.oid = d.objid and d.classid = 'pg_policy'::regclass
                   where d.refobjid = to_regprocedure('app.community_action_allowed(uuid, text)')
                     and p.polname = 'feed_posts_social_insert_gate'),
  '7: feed_posts_social_insert_gate still depends on the same function (create or replace kept the OID)');

-- ── 8. the post gate matrix ────────────────────────────────────────────────────────────────────
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008', 'em membro', 'community', '24100000-0000-4000-8000-0000000000c4') $$,
  '42501', null, '8: D-880: a buyer flagged post on a link to a MEMBER-created community is refused (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008', 'em arquivada', 'community', '24100000-0000-4000-8000-0000000000c5') $$,
  '42501', null, '8: …in an archived organization community (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000008', 'em apagada', 'community', '24100000-0000-4000-8000-0000000000c6') $$,
  '42501', null, '8: …in a soft-deleted organization community (42501)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'sem link', 'community', '24100000-0000-4000-8000-0000000000c3') $$,
  '42501', null, '8: D-892: an organization community with no linked product grants no member post (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'de outro tenant', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '42501', null, '8: BPERM-25: tenant A''s row naming tenant B''s community is refused (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', 'carimbo forjado', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '42501', null, '8: …and a forged tenant stamp is refused (42501)');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'com produto', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '8: the buyer of P1 and P6 publishes into CA (positive control for the refusals above)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000006');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000006', 'uniao', 'community', '24100000-0000-4000-8000-0000000000c2') $$,
  '8: D-886: the holder of P2 (post off) and P3 (post on) publishes into CA2: the union grants post');
reset role;

-- ── fixture for sections 9 to 13 (as the migration role) ────────────────────────────────────────
-- U9 (…09) holds P7 and P8. CL7 (c7): organization, linked to P7 with like and comment OFF. CL8 (c8): organization, linked to
-- P8 with like and comment ON. Posts: PL7 in CL7, PL8 in CL8, PL3 in CA3 (c3, no link), PLN with no community. Comments: one
-- on each of PL7 and PL8 and PLN, plus a STORY comment (no post).
select tests.auth_user('u9@bperm-a.local', '24100000-0000-4000-8000-000000000009');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('24100000-0000-4000-8000-0000000000c7', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Sem curtir', 'sem-curtir', 'organization', 5),
  ('24100000-0000-4000-8000-0000000000c8', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Com curtir', 'com-curtir', 'organization', 6);
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24100000-0000-4000-8000-0000000000a7', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P7', 100, 'active'),
  ('24100000-0000-4000-8000-0000000000a8', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P8', 100, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id, can_like, can_comment, can_share, can_post, can_story) values
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a7', '24100000-0000-4000-8000-0000000000c7', false, false, true, false, false),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a8', '24100000-0000-4000-8000-0000000000c8', true, true, true, false, false);
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24100000-0000-4000-8000-0000000000e9', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-0000000000a7', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000000ea', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-0000000000a8', 'grant', '24100000-0000-4000-8000-000000000002');
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, community_id) values
  ('24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'pl7', 'tenant', '24100000-0000-4000-8000-0000000000c7'),
  ('24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'pl8', 'tenant', '24100000-0000-4000-8000-0000000000c8'),
  ('24100000-0000-4000-8000-000000000b73', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'pl3', 'tenant', '24100000-0000-4000-8000-0000000000c3'),
  ('24100000-0000-4000-8000-000000000b74', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'pln', 'tenant', null);
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body) values
  ('24100000-0000-4000-8000-000000000d71', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000002', 'c7'),
  ('24100000-0000-4000-8000-000000000d72', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000002', 'c8'),
  ('24100000-0000-4000-8000-000000000d73', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b74', '24100000-0000-4000-8000-000000000002', 'cn');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('24100000-0000-4000-8000-000000000aa1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}');
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at) values
  ('24100000-0000-4000-8000-000000000ab1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002',
   '24100000-0000-4000-8000-000000000aa1', 'image', 'historia', now() - interval '1 hour', now() + interval '23 hours');
insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body) values
  ('24100000-0000-4000-8000-000000000d74', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000ab1', '24100000-0000-4000-8000-000000000002', 'comentario da historia');

-- ── 9. the like gate (11.1-03, D-888, D-891, D-892; BPERM-06) ───────────────────────────────────
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000b71') $$,
  '42501', null, '9: BPERM-06: a buyer whose union lacks like is refused a like on a post of that community (42501)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000b71') $$,
  '42501', null, '9: …and the refusal repeats identically (idempotent)');
select is((select count(*)::int from public.feed_likes where post_id = '24100000-0000-4000-8000-000000000b71'), 0,
  '9: …and leaves no row');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000b72') $$,
  '9: the same buyer likes a post of the community whose product holds like (positive control)');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000b74') $$,
  '9: …and a post with no community (positive control)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000d71', 'post') $$,
  '42501', null, '9: D-891: the heart on a comment of that community follows like and is refused (42501)');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000d72', 'post') $$,
  '9: …and the heart on a comment of the community that holds like passes (positive control)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000d74', 'post') $$,
  '23503', null, '9: Pitfall 1: a heart on a STORY comment passes the policy and reaches the foreign key (23503), never a 42501');
reset role;
-- the member with no entitlement: locked in CL7 (linked, not held), refused through the locked term; CA3 has no link
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000b71') $$,
  '42501', null, '9: a locked member is still refused (the locked term survives the rewrite)');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-000000000b73') $$,
  '9: D-892: a like on a post of an organization community with NO linked product passes (never denied)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000b71') $$,
  '9: D-892: staff by claim like a post of the same community (the denied set is empty for them)');
reset role;
select ok((select with_check like '%community_locked_ids%' and with_check like '%community_action_denied_ids%' and lower(with_check) like '%left join%'
             from pg_policies where schemaname = 'public' and tablename = 'feed_likes' and policyname = 'feed_likes_community_gate'),
  '9: the policy carries the locked term, the denied term and the left join of the comment branch');
-- BPERM-25: another tenant's lane never reaches tenant A's post, and the gates leak nothing
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000b72') $$,
  '42501', null, '9: BPERM-25: the buyer under tenant B''s claim is refused a like on tenant A''s post (42501)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000000b72') $$,
  '42501', null, '9: …and so is a row stamped with tenant A');
reset role;
-- the flag flips: a like passes once the flag is on; deleting a like the buyer already gave is never gated
update public.store_product_communities set can_like = true where product_id = '24100000-0000-4000-8000-0000000000a7';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', '24100000-0000-4000-8000-000000000b71') $$,
  '9: with the flag turned on the same like passes');
reset role;
update public.store_product_communities set can_like = false where product_id = '24100000-0000-4000-8000-0000000000a7';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select lives_ok(
  $$ delete from public.feed_likes where user_id = '24100000-0000-4000-8000-000000000009' and post_id = '24100000-0000-4000-8000-000000000b71' $$,
  '9: BPERM-06: deleting a like is not an insert, the gate does not touch it (the service guard owns it)');
select is((select count(*)::int from public.feed_likes where user_id = '24100000-0000-4000-8000-000000000009' and post_id = '24100000-0000-4000-8000-000000000b71'), 0,
  '9: …and the like is gone');
reset role;

-- ── 10. the comment insert gate (11.1-03, D-888, D-892; BPERM-07) ───────────────────────────────
-- A reply fixture on the CL7 comment (the organization's heart on the CL7 post came from section 9), then the matrix as U9 (comment off in
-- CL7, on in CL8).
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('24100000-0000-4000-8000-000000000d75', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71',
   '24100000-0000-4000-8000-000000000002', 'resposta', 1, '24100000-0000-4000-8000-000000000d71', 0, 'post');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000009', 'raiz') $$,
  '42501', null, '10: BPERM-07: a buyer whose union lacks comment is refused a root comment on a post of that community (42501)');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000009', 'resposta',
             1, '24100000-0000-4000-8000-000000000d71', 0, 'post') $$,
  '42501', null, '10: …and a reply (42501)');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000009', 'raiz') $$,
  '42501', null, '10: …the refusal repeats identically (idempotent)');
select is((select count(*)::int from public.feed_comments where post_id = '24100000-0000-4000-8000-000000000b71' and author_user_id = '24100000-0000-4000-8000-000000000009'), 0,
  '10: …and leaves no row');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000009', 'raiz em c8') $$,
  '10: the same buyer comments on a post of the community whose product holds comment (positive control)');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000009', 'resposta em c8',
             1, '24100000-0000-4000-8000-000000000d72', 0, 'post') $$,
  '10: …and replies there (positive control)');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000009', 'raiz em c8') $$,
  '10: …twice: comments carry no uniqueness, an allowed insert repeated never raises a duplicate key');
select is((select count(*)::int from public.feed_comments where post_id = '24100000-0000-4000-8000-000000000b72' and author_user_id = '24100000-0000-4000-8000-000000000009' and parent_id is null), 2,
  '10: …and leaves two roots');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b74', '24100000-0000-4000-8000-000000000009', 'sem comunidade') $$,
  '10: a comment on a post with no community passes');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000ab1', '24100000-0000-4000-8000-000000000009', 'na historia') $$,
  '10: a STORY comment (no post) passes the new gate');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b73', '24100000-0000-4000-8000-000000000005', 'sem produto') $$,
  '10: D-892: a comment on a post of an organization community with NO linked product passes (never denied)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000002', 'da organizacao') $$,
  '10: D-892: staff by claim comment on the same community (the denied set is empty for them)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000004', 'de B em A') $$,
  '42501', null, '10: BPERM-25: the buyer under tenant B''s claim is refused a comment on tenant A''s post (42501)');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000004', 'carimbo de A') $$,
  '42501', null, '10: …and so is a row stamped with tenant A');
reset role;
select ok((select not (permissive = 'PERMISSIVE') and cmd = 'INSERT' and with_check like '%community_action_denied_ids%'
             from pg_policies where schemaname = 'public' and tablename = 'feed_comments' and policyname = 'feed_comments_community_insert_gate'),
  '10: the new policy is restrictive, for insert, and calls the denied-ids scope');
select ok((select qual like '%community_locked_ids%' and qual not like '%community_action_denied_ids%'
             from pg_policies where schemaname = 'public' and tablename = 'feed_comments' and policyname = 'feed_comments_community_gate'),
  '10: UI-D-890: the select gate of comments is untouched (the locked term only, no denied term)');
-- the flag flips: a comment passes once the flag is on (the statement's own snapshot sees the committed flag)
update public.store_product_communities set can_comment = true where product_id = '24100000-0000-4000-8000-0000000000a7';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000009', 'agora pode') $$,
  '10: BPERM-07 concurrency: with the flag turned on the same comment passes at the next statement');
reset role;
update public.store_product_communities set can_comment = false where product_id = '24100000-0000-4000-8000-0000000000a7';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select is((select count(*)::int from public.feed_comments where post_id = '24100000-0000-4000-8000-000000000b71' and author_user_id = '24100000-0000-4000-8000-000000000009'), 1,
  '10: D-887: the flag turned off again leaves the comment already written in place and readable');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000009', 'de novo nao') $$,
  '42501', null, '10: …and a new comment is refused again (42501)');
reset role;
delete from public.feed_comments where post_id = '24100000-0000-4000-8000-000000000b71' and author_user_id = '24100000-0000-4000-8000-000000000009';

-- ── 11. reading is never reduced (UI-D-890) ────────────────────────────────────────────────────
-- U9 holds NO like and NO comment in CL7; U10 holds all five there through another product. Both read the same rows.
select tests.auth_user('u10@bperm-a.local', '24100000-0000-4000-8000-00000000000a');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-00000000000a');
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24100000-0000-4000-8000-0000000000a9', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P9', 100, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id, can_like, can_comment, can_share, can_post, can_story) values
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000a9', '24100000-0000-4000-8000-0000000000c7', true, true, true, true, true);
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24100000-0000-4000-8000-0000000000eb', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-00000000000a', '24100000-0000-4000-8000-0000000000a9', 'grant', '24100000-0000-4000-8000-000000000002');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select results_eq(
  $$ select (select count(*)::int from public.feed_posts where community_id = '24100000-0000-4000-8000-0000000000c7'),
            (select count(*)::int from public.feed_comments where post_id = '24100000-0000-4000-8000-000000000b71'),
            (select count(*)::int from public.feed_likes where post_id = '24100000-0000-4000-8000-000000000b71') $$,
  $$ values (1, 3, 1) $$,
  '11: UI-D-890: a buyer with no like and no comment reads the post, its comments (root, reply and the organization''s) and its likes');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c7'::uuid, 'like'), false,
  '11: …and holds neither flag (the control for the count above)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-00000000000a');
select results_eq(
  $$ select (select count(*)::int from public.feed_posts where community_id = '24100000-0000-4000-8000-0000000000c7'),
            (select count(*)::int from public.feed_comments where post_id = '24100000-0000-4000-8000-000000000b71'),
            (select count(*)::int from public.feed_likes where post_id = '24100000-0000-4000-8000-000000000b71') $$,
  $$ values (1, 3, 1) $$,
  '11: …the same counts for a buyer holding all five flags');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c7'::uuid, 'like'), true,
  '11: …who does hold them (the control)');
reset role;

-- ── 12. the free sample never shows a buyer's post (11.1-03, D-893, D-892) ───────────────────────
-- CL8 (c8) is locked for the plain member (linked to P8, which only U9 holds). Its newest live post is a BUYER's
-- `visibility = 'community'` post (b82, one minute after the organization's b72). CL9 (c9) is linked to a product nobody
-- holds and carries ONLY a buyer's post (b91): a locked community with no tenant-visible post shows no sample.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('24100000-0000-4000-8000-0000000000c9', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'So de comprador', 'so-de-comprador', 'organization', 7);
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24100000-0000-4000-8000-0000000000aa', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'P10', 100, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id) values
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000000aa', '24100000-0000-4000-8000-0000000000c9');
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, community_id, created_at) values
  ('24100000-0000-4000-8000-000000000b82', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', 'do comprador em c8', 'community', '24100000-0000-4000-8000-0000000000c8', now() + interval '1 minute'),
  ('24100000-0000-4000-8000-000000000b91', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009', 'so do comprador', 'community', '24100000-0000-4000-8000-0000000000c9', now());
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.feed_posts where id = '24100000-0000-4000-8000-000000000b82'), 0,
  '12: D-893: a member who has not bought never reads the buyer''s post by id');
select results_eq(
  $$ select id from public.feed_posts where community_id = '24100000-0000-4000-8000-0000000000c8' $$,
  ARRAY['24100000-0000-4000-8000-000000000b72'::uuid],
  '12: …nor by list: the locked community shows only the organization''s newest post, the sample');
select is(
  array(select s.id from unnest(app.feed_sample_post_ids()) s(id)
         where s.id = any (array['24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000b72', '24100000-0000-4000-8000-000000000b73',
                                 '24100000-0000-4000-8000-000000000b74', '24100000-0000-4000-8000-000000000b82', '24100000-0000-4000-8000-000000000b91']::uuid[])
         order by s.id),
  array['24100000-0000-4000-8000-000000000b71', '24100000-0000-4000-8000-000000000b72']::uuid[],
  '12: …the sample holds the organization''s post of each locked community that has one, never the buyer''s newer post, and none for the community that has only a buyer''s post');
select is((select p.caption from public.feed_posts p
            where p.id = any (app.feed_sample_post_ids()) and p.community_id = '24100000-0000-4000-8000-0000000000c1'),
  'da organizacao', '12: …and CA, which holds several buyer posts beside the organization''s, samples the organization''s');
select is((select count(*)::int from public.feed_posts where id = '24100000-0000-4000-8000-000000000b91'), 0,
  '12: a locked community with no tenant-visible post shows no sample (the buyer''s only post is hidden by id)');
select is((select count(*)::int from public.feed_posts where community_id = '24100000-0000-4000-8000-0000000000c9'), 0,
  '12: …nor by list');
select is((select count(*)::int from public.feed_posts where community_id = '24100000-0000-4000-8000-0000000000c7'), 1,
  '12: a plain organization community keeps the shipped sample (its newest tenant post)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
select results_eq(
  $$ select id from public.feed_posts where community_id = '24100000-0000-4000-8000-0000000000c8' order by id $$,
  ARRAY['24100000-0000-4000-8000-000000000b72'::uuid, '24100000-0000-4000-8000-000000000b82'::uuid],
  '12: the buyer (who holds P8, so CL8 is unlocked for them) reads both the organization''s post and the buyer''s post');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select is((select count(*)::int from public.feed_posts where id in ('24100000-0000-4000-8000-000000000b82', '24100000-0000-4000-8000-000000000b91')), 2,
  '12: staff read the buyer''s posts (no lock for staff)');
reset role;
select ok((select prosecdef and provolatile = 's' and 'search_path=""' = any (proconfig)
             from pg_proc where oid = to_regprocedure('app.feed_sample_post_ids()')),
  '12: the replaced sample function is still SECURITY DEFINER, stable, with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.feed_sample_post_ids()', 'EXECUTE')
          and not has_function_privilege('anon', 'app.feed_sample_post_ids()', 'EXECUTE'),
  '12: …executable by authenticated and not by anon (the grants survived)');
select ok((select pg_get_functiondef(oid) like '%visibility = ''tenant''%' from pg_proc where oid = to_regprocedure('app.feed_sample_post_ids()')),
  '12: …and selects only tenant-visible posts');

-- ── 13. the gates are InitPlans, never a per-row SubPlan (T-11.1-12) ───────────────────────────
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000009');
do $$
declare
  v_plan text;
  v_line text;
begin
  v_plan := '';
  for v_line in execute
    'explain select p.id from public.feed_posts p
      where p.community_id is null
         or p.community_id <> all (coalesce((select app.community_action_denied_ids(''like'')), ''{}''::uuid[]))'
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  perform set_config('tests.plan_denied', v_plan, true);
end
$$;
reset role;
select matches(current_setting('tests.plan_denied'), 'InitPlan',
  '13: the denied-ids idiom of the like and comment gates is evaluated as an InitPlan (once per statement)');
select doesnt_match(current_setting('tests.plan_denied'), '(?<!Init)SubPlan',
  '13: …and never as a per-row SubPlan');
select ok((select with_check ~* 'coalesce\(\(\s*select app\.community_action_denied_ids\(''like''::text\)'
             from pg_policies where schemaname = 'public' and tablename = 'feed_likes' and policyname = 'feed_likes_community_gate'),
  '13: the stored like policy carries the coalesce-select idiom');
select ok((select with_check ~* 'coalesce\(\(\s*select app\.community_action_denied_ids\(''comment''::text\)'
             from pg_policies where schemaname = 'public' and tablename = 'feed_comments' and policyname = 'feed_comments_community_insert_gate'),
  '13: …and so does the stored comment policy');

-- ── fixture for sections 14 to 19 (11.1-04, as the migration role) ──────────────────────────────
-- BS1 and BS2 hold PS (the `story` flag on in CS, CArch and CDel); BS3 holds PN (linked to CS with `story` off). CS is an
-- active organization community, CArch is archived and CDel soft-deleted (both linked to PS), CNoLink has no product, CMem is
-- a MEMBER community created by BS1. Highlights: hOpen and hOpen2 (CS, open), hClosed (CS, closed), hMem (CMem, open), hArch,
-- hDel, hInicio (no community, open), hNoLink (CNoLink, open). Tenant B: CB with the open highlight hB, linked to PBS (`story`
-- off) which BS1 also holds there. Every story is a followers story of its author.
select tests.auth_user('bs1@bperm-a.local', '24100000-0000-4000-8000-000000001401');
select tests.auth_user('bs2@bperm-a.local', '24100000-0000-4000-8000-000000001402');
select tests.auth_user('bs3@bperm-a.local', '24100000-0000-4000-8000-000000001403');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402');
select tests.member('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001403');
select tests.member('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position, status, deleted_at) values
  ('24100000-0000-4000-8000-0000000014c1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Historias', 'historias', 'organization', 20, 'active', null),
  ('24100000-0000-4000-8000-0000000014c2', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'Da BS1', 'da-bs1', 'member', 1000000, 'active', null),
  ('24100000-0000-4000-8000-0000000014c3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Arquivada H', 'arquivada-h', 'organization', 21, 'archived', null),
  ('24100000-0000-4000-8000-0000000014c4', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Apagada H', 'apagada-h', 'organization', 22, 'active', now()),
  ('24100000-0000-4000-8000-0000000014c5', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'Sem produto H', 'sem-produto-h', 'organization', 23, 'active', null),
  ('24100000-0000-4000-8000-0000000014d1', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'Historias B', 'historias-b', 'organization', 20, 'active', null);
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('24100000-0000-4000-8000-0000000014a1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'PS', 100, 'active'),
  ('24100000-0000-4000-8000-0000000014a2', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'PN', 100, 'active'),
  ('24100000-0000-4000-8000-0000000014a3', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'PBS', 100, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id, can_story) values
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014a1', '24100000-0000-4000-8000-0000000014c1', true),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014a1', '24100000-0000-4000-8000-0000000014c3', true),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014a1', '24100000-0000-4000-8000-0000000014c4', true),
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014a2', '24100000-0000-4000-8000-0000000014c1', false),
  ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014a3', '24100000-0000-4000-8000-0000000014d1', false);
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24100000-0000-4000-8000-0000000014e1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-0000000014a1', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000014e2', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402', '24100000-0000-4000-8000-0000000014a1', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000014e3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001403', '24100000-0000-4000-8000-0000000014a2', 'grant', '24100000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-0000000014e4', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-0000000014a3', 'grant', '24100000-0000-4000-8000-000000000012');
insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id, open_to_buyers) values
  ('24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c1', 'H aberto', 1, '24100000-0000-4000-8000-000000000002', true),
  ('24100000-0000-4000-8000-0000000014f2', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c1', 'H fechado', 2, '24100000-0000-4000-8000-000000000002', false),
  ('24100000-0000-4000-8000-0000000014f3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c2', 'H da BS1', 1, '24100000-0000-4000-8000-000000001401', true),
  ('24100000-0000-4000-8000-0000000014f4', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c3', 'H arquivada', 1, '24100000-0000-4000-8000-000000000002', true),
  ('24100000-0000-4000-8000-0000000014f5', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c4', 'H apagada', 1, '24100000-0000-4000-8000-000000000002', true),
  ('24100000-0000-4000-8000-0000000014f6', '24100000-0000-4000-8000-000000000001', null, 'H inicio', 1, '24100000-0000-4000-8000-000000000002', true),
  ('24100000-0000-4000-8000-0000000014f7', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c5', 'H sem produto', 1, '24100000-0000-4000-8000-000000000002', true),
  ('24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014d1', 'H aberto B', 1, '24100000-0000-4000-8000-000000000012', true),
  ('24100000-0000-4000-8000-0000000014f9', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c1', 'H aberto 2', 3, '24100000-0000-4000-8000-000000000002', true);
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('24100000-0000-4000-8000-000000001501', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001502', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001503', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001504', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001505', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001506', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001507', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001508', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-000000001509', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-00000000150a', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001403', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-00000000150b', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}');
-- 1451..1457: BS1's stories in A; 1461, 1462: BS2's; 1471: BS3's; 1481: BS1's story in tenant B
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at) values
  ('24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001501', 'image', 's1451', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001452', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001502', 'image', 's1452', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001453', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001503', 'image', 's1453', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001454', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001504', 'image', 's1454', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001455', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001505', 'image', 's1455', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001456', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001506', 'image', 's1456', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001457', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-000000001507', 'image', 's1457', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001461', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402', '24100000-0000-4000-8000-000000001508', 'image', 's1461', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001462', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402', '24100000-0000-4000-8000-000000001509', 'image', 's1462', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001471', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001403', '24100000-0000-4000-8000-00000000150a', 'image', 's1471', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000001481', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-00000000150b', 'image', 's1481', 'followers', now() - interval '1 hour', now() + interval '23 hours');

-- ── 14. the item insert gate (11.1-04, D-883, D-884, D-885; BPERM-02, BPERM-12) ───────────────────
-- THE PATH: BS1 saves THEIR OWN story into an open highlight of an active organization community, holding `story`.
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001401') $$,
  '14: D-884: a buyer holding story saves their own story into an open highlight of an organization community');
-- the highlight closed: the same save is refused, then accepted again once it is reopened (positive control)
reset role;
update public.story_highlights set open_to_buyers = false where id = '24100000-0000-4000-8000-0000000014f9';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f9', '24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: a highlight with open_to_buyers = false refuses the buyer (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f2', '24100000-0000-4000-8000-000000001452', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: …the highlight that was never open refuses the buyer too (42501)');
reset role;
update public.story_highlights set open_to_buyers = true where id = '24100000-0000-4000-8000-0000000014f9';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f9', '24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001401') $$,
  '14: …and the reopened highlight accepts the same save (the control)');
reset role;
-- the link flag off (BS3 holds PN, whose link has story = false; BS1 holds PS with it off after the flip)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001403');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001471', '24100000-0000-4000-8000-000000001403') $$,
  '42501', null, '14: a buyer whose link has can_story = false is refused (42501)');
reset role;
update public.store_product_communities set can_story = false where product_id = '24100000-0000-4000-8000-0000000014a1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001452', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: the flag flipped off for BS1 refuses the same save (42501)');
reset role;
update public.store_product_communities set can_story = true where product_id = '24100000-0000-4000-8000-0000000014a1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001452', '24100000-0000-4000-8000-000000001401') $$,
  '14: …and the flag back on accepts it (the control)');
-- someone else's story (D-885)
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001461', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: D-885: a buyer cannot save ANOTHER member''s story into an open highlight (42501)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001461', '24100000-0000-4000-8000-000000001402') $$,
  '14: …while its author, also a buyer, saves it (the control)');
reset role;
-- social off: the insert alternative carries its own social term
update public.tenant_modules set enabled = false
 where tenant_id = '24100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001453', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: social off refuses the buyer (42501): the gate carries its own social term');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '24100000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001453', '24100000-0000-4000-8000-000000001401') $$,
  '14: …and social back on accepts it (the control)');
-- an archived, a soft-deleted, an un-linked and a null-community highlight, all open
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f4', '24100000-0000-4000-8000-000000001454', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: an open highlight of an ARCHIVED community refuses the buyer (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f5', '24100000-0000-4000-8000-000000001454', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: …of a SOFT-DELETED community (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f7', '24100000-0000-4000-8000-000000001454', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: …of a community with NO linked product (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f6', '24100000-0000-4000-8000-000000001454', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: …and the Inicio highlight (no community, 42501)');
-- the member-created community: a product grant never reaches it; its creator still does (ITEM_OWNER)
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f3', '24100000-0000-4000-8000-000000001462', '24100000-0000-4000-8000-000000001402') $$,
  '42501', null, '14: D-883: an open highlight of a MEMBER community is closed to a buyer who is not its creator (42501)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f3', '24100000-0000-4000-8000-000000001454', '24100000-0000-4000-8000-000000001401') $$,
  '14: …while its creator saves their own story there as before (the control, the owner path)');
reset role;
-- a revoked entitlement refuses, a re-activated one accepts (D-895)
update public.store_entitlements set status = 'revoked', revoked_at = now() where id = '24100000-0000-4000-8000-0000000014e1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001455', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '14: D-895: a revoked entitlement refuses the buyer (42501)');
reset role;
update public.store_entitlements set status = 'active', revoked_at = null where id = '24100000-0000-4000-8000-0000000014e1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001455', '24100000-0000-4000-8000-000000001401') $$,
  '14: …and the re-activated entitlement accepts it (the control)');
reset role;
-- staff inserts are unchanged: into a closed highlight, any story
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f2', '24100000-0000-4000-8000-000000001462', '24100000-0000-4000-8000-000000000002') $$,
  '14: staff still insert an item into a closed highlight');
reset role;

-- ── 15. the item delete gate (11.1-04, D-884, D-885, D-887, D-895; BPERM-02, BPERM-12) ─────────────
-- State left by section 14: hOpen holds 1451 (BS1), 1452 (BS1), 1453 (BS1), 1455 (BS1) and 1461 (BS2); hOpen2 holds 1451;
-- hMem holds 1454; hClosed holds 1462 (saved by staff). A refused delete is a USING filter: it raises nothing and matches
-- zero rows, so each refusal is asserted by the row staying (read back as the migration role).
-- another buyer's item stays
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001451' $$,
  '15: D-885: a buyer deleting ANOTHER buyer''s item raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001451'), 1,
  '15: …and the item stays');
-- the highlight closed after the save: the item stays, and a staff delete removes it
update public.story_highlights set open_to_buyers = false where id = '24100000-0000-4000-8000-0000000014f1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001453' $$,
  '15: D-887: a highlight closed after the save: the buyer''s delete raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001453'), 1,
  '15: …and the item stays in the closed highlight');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001453' $$,
  '15: …and a staff delete removes it');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001453'), 0,
  '15: …(the row is gone)');
update public.story_highlights set open_to_buyers = true where id = '24100000-0000-4000-8000-0000000014f1';
-- the link flag turned off
update public.store_product_communities set can_story = false where product_id = '24100000-0000-4000-8000-0000000014a1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001455' $$,
  '15: D-895: the link flipped to can_story = false: the buyer''s delete raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001455'), 1,
  '15: …and the item stays (only an administrator removes it)');
update public.store_product_communities set can_story = true where product_id = '24100000-0000-4000-8000-0000000014a1';
-- the entitlement revoked (a refund): the item stays, the story is still the author's to soft-delete (D-887)
update public.store_entitlements set status = 'revoked', revoked_at = now() where id = '24100000-0000-4000-8000-0000000014e1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001452' $$,
  '15: D-895: the entitlement revoked: the buyer''s delete raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001452'), 1,
  '15: …and the item stays');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ update public.stories set deleted_at = now() where id = '24100000-0000-4000-8000-000000001452' $$,
  '15: D-887: …yet the author can still soft-delete the story itself');
reset role;
select ok((select deleted_at is not null from public.stories where id = '24100000-0000-4000-8000-000000001452'),
  '15: …and the story reads deleted');
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001452'), 1,
  '15: …while its item is untouched (nothing is hidden automatically)');
update public.store_entitlements set status = 'active', revoked_at = null where id = '24100000-0000-4000-8000-0000000014e1';
-- the community archived
update public.communities set status = 'archived' where id = '24100000-0000-4000-8000-0000000014c1';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001455' $$,
  '15: an archived community: the buyer''s delete raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001455'), 1,
  '15: …and the item stays');
update public.communities set status = 'active' where id = '24100000-0000-4000-8000-0000000014c1';
-- the buyer's own item goes, another buyer's does not (the positive controls)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001461' $$,
  '15: a buyer deleting the item of BS2''s story from an open highlight raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001461'), 1,
  '15: …and it stays (D-885: only the author''s own item)');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001455' $$,
  '15: with the grant, an open highlight and an active community the buyer deletes their own item…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001455'), 0,
  '15: …and it is gone (the control)');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001461' $$,
  '15: …and its author, also a buyer, deletes theirs');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001461'), 0,
  '15: …(gone)');
-- the creator's own path (a member community) is unchanged
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f3' and story_id = '24100000-0000-4000-8000-000000001454' $$,
  '15: the creator of a member community still removes their own item as before');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f3' and story_id = '24100000-0000-4000-8000-000000001454'), 0,
  '15: …(gone)');
-- staff delete any item, in an open and in a closed highlight
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ delete from public.story_highlight_items where story_id in ('24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001462') $$,
  '15: staff delete any item (a buyer''s in two highlights, and one in a closed highlight)');
reset role;
select is((select count(*)::int from public.story_highlight_items where story_id in ('24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001462')), 0,
  '15: …(gone)');

-- ── 16. the highlight level stays creator-only (11.1-04, D-884; T-11.1-14) ───────────────────────
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c1', 'do comprador', 9, '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '16: a buyer cannot create a highlight in an organization community (42501)');
select throws_ok(
  $$ insert into public.story_highlights (tenant_id, community_id, title, position, created_by_user_id, open_to_buyers)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c1', 'aberto pelo comprador', 9, '24100000-0000-4000-8000-000000001401', true) $$,
  '42501', null, '16: …nor one that is already open (42501)');
select lives_ok(
  $$ update public.story_highlights set title = 'renomeado', position = 9, open_to_buyers = false, cover_story_id = '24100000-0000-4000-8000-000000001457'
      where id = '24100000-0000-4000-8000-0000000014f1' $$,
  '16: a buyer renaming, reordering, re-covering and closing an open highlight raises nothing…');
select lives_ok(
  $$ delete from public.story_highlights where id = '24100000-0000-4000-8000-0000000014f1' $$,
  '16: …nor does deleting it…');
reset role;
select results_eq(
  $$ select title, position, open_to_buyers, cover_story_id from public.story_highlights where id = '24100000-0000-4000-8000-0000000014f1' $$,
  $$ values ('H aberto'::text, 1, true, null::uuid) $$,
  '16: …and the highlight is untouched: same title, position, open flag and no cover, still there');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ update public.story_highlight_items set added_at = '2000-01-01' where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001452' $$,
  '16: a member updating an item raises nothing…');
reset role;
select ok((select added_at > now() - interval '1 day' from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001452'),
  '16: …and the item is untouched (a member never updates an item)');
-- the positive controls: staff create, update and delete a highlight and update an item
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.story_highlights (id, tenant_id, community_id, title, position, created_by_user_id)
     values ('24100000-0000-4000-8000-0000000014fa', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014c1', 'da equipe', 9, '24100000-0000-4000-8000-000000000002') $$,
  '16: staff create a highlight in the same community (the control)');
select lives_ok(
  $$ update public.story_highlights set title = 'renomeado pela equipe', open_to_buyers = false where id = '24100000-0000-4000-8000-0000000014f1' $$,
  '16: …rename and close an open one…');
select lives_ok(
  $$ delete from public.story_highlights where id = '24100000-0000-4000-8000-0000000014fa' $$,
  '16: …and delete one');
select lives_ok(
  $$ update public.story_highlight_items set added_at = '2000-01-01' where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001452' $$,
  '16: …and update an item');
reset role;
select results_eq(
  $$ select title, open_to_buyers from public.story_highlights where id = '24100000-0000-4000-8000-0000000014f1' $$,
  $$ values ('renomeado pela equipe'::text, false) $$,
  '16: …and the staff update took effect');
select is((select count(*)::int from public.story_highlights where id = '24100000-0000-4000-8000-0000000014fa'), 0,
  '16: …and the staff delete too');
update public.story_highlights set title = 'H aberto', open_to_buyers = true where id = '24100000-0000-4000-8000-0000000014f1';

-- ── 17. cross-tenant (11.1-04, BPERM-25; T-11.1-16) ──────────────────────────────────────────────
-- BS1 is a member of A and of B. In B the link of PBS carries story = false; the A link grants nothing there.
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000001481', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '17: BPERM-25: the same user holds no story grant in B through tenant A''s link (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001481', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '17: …tenant B''s lane cannot save into tenant A''s open highlight (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '17: …nor forge tenant A''s id on the row (42501)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000001451', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '17: tenant B''s open highlight grants nothing to tenant A''s buyer (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000001481', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '17: …and a row stamped with tenant B''s id from tenant A''s lane is refused (42501)');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000001457', '24100000-0000-4000-8000-000000001401') $$,
  '17: the same buyer in tenant A, with the grant, saves into tenant A''s open highlight (the control)');
reset role;
-- B's link turned on: B's own buyer path works, and tenant A's lane cannot remove it; tenant B's lane cannot remove A's item
update public.store_product_communities set can_story = true where product_id = '24100000-0000-4000-8000-0000000014a3';
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000001481', '24100000-0000-4000-8000-000000001401') $$,
  '17: with B''s own link on, the buyer saves into B''s open highlight (the control)');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001457' $$,
  '17: tenant B''s lane deleting tenant A''s item raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f1' and story_id = '24100000-0000-4000-8000-000000001457'), 1,
  '17: …and A''s item stays');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f8' and story_id = '24100000-0000-4000-8000-000000001481' $$,
  '17: tenant A''s lane deleting tenant B''s item raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f8' and story_id = '24100000-0000-4000-8000-000000001481'), 1,
  '17: …and B''s item stays');
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ delete from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f8' and story_id = '24100000-0000-4000-8000-000000001481' $$,
  '17: …while B''s own buyer removes it (the control)');
reset role;
select is((select count(*)::int from public.story_highlight_items where highlight_id = '24100000-0000-4000-8000-0000000014f8' and story_id = '24100000-0000-4000-8000-000000001481'), 0,
  '17: …(gone)');

-- ── 18. a locked member never reads a story a buyer saved in a community highlight (11.1-04, D-894; T-11.1-15) ──
-- 1457 (BS1's followers story) sits in hOpen of CS (linked to PS and PN). 1456 (BS1's) is saved, as the migration role, in hNoLink
-- (CNoLink: NO linked product, so nobody is locked out of it). The plain member (…05) holds no entitlement: locked out of CS.
insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id) values
  ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f7', '24100000-0000-4000-8000-000000001456', '24100000-0000-4000-8000-000000000002');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001402');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 1,
  '18: D-716: an unlocked buyer (BS2, who does not follow BS1) reads the story saved in the highlight by id');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001403');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 1,
  '18: …and so does a member who holds only PN (any linked product unlocks the community)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 1,
  '18: …and staff (no lock for staff)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 1,
  '18: …and the author');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 0,
  '18: D-894: a member locked out of CS cannot read the saved story by id');
select is((select count(*)::int from public.stories where id in ('24100000-0000-4000-8000-000000001457', '24100000-0000-4000-8000-000000001456')), 1,
  '18: …nor in a list: of the two saved stories only the one in the community with no linked product is returned');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001456'), 1,
  '18: …and that one (no linked product, nobody locked out) reads as today');
reset role;
-- the grant lifts the lock at the next statement, a revoked one puts it back
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('24100000-0000-4000-8000-0000000014e5', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005', '24100000-0000-4000-8000-0000000014a1', 'grant', '24100000-0000-4000-8000-000000000002');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 1,
  '18: the same member holding PS reads the story (the control: the lock term, not the audience, was the refusal)');
reset role;
update public.store_entitlements set status = 'revoked', revoked_at = now() where id = '24100000-0000-4000-8000-0000000014e5';
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 0,
  '18: …and the refunded one is locked out again at the next statement');
reset role;
-- tenant B never reaches it
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001457'), 0,
  '18: BPERM-25: the same user under tenant B''s claim does not read tenant A''s story');
reset role;
-- a story shown on the organization's strip stays readable to a locked member (no regression of an organization story)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility)
     values ('24100000-0000-4000-8000-000000001491', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000aa1', 'image', 'da organizacao', 'tenant') $$,
  '18: staff publish an organization story');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000001491'), 1,
  '18: …which the locked member still reads (branch 1 is untouched)');
reset role;

-- ── 19. the locked term stays an InitPlan (11.1-04, T-11.1-15) ──────────────────────────────────
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
do $$
declare
  v_plan text;
  v_line text;
begin
  v_plan := '';
  for v_line in execute 'explain (verbose, costs off) select s.id from public.stories s where s.tenant_id = ''24100000-0000-4000-8000-000000000001'''
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  perform set_config('tests.plan_story', v_plan, true);
end
$$;
reset role;
select matches(current_setting('tests.plan_story'), 'InitPlan[^\n]*\n[^\n]*\n[^\n]*community_locked_ids',
  '19: the locked-community term of the story audience gate is evaluated as an InitPlan (once per statement)');
select ok((select qual ~* 'story_highlight_items.*coalesce\(\(\s*select app\.community_locked_ids\(\)'
             from pg_policies where schemaname = 'public' and tablename = 'stories' and policyname = 'stories_audience_gate'),
  '19: the stored policy carries the coalesce-select idiom, and the term sits inside branch 3 (after the highlight items join)');

-- ── fixture for sections 20 to 22 (11.1-11, as the migration role) ──────────────────────────────
-- Every state the earlier sections may have left is put back explicitly, so these sections read from a known truth:
-- M1 (…04, "the buyer") holds P1 and P6 in A (CA: like, comment, share, post on) and PB in B (CB: like, comment, share on, post
-- off); BS1 (…1401) holds PS in A (CS: story on) and PBS in B (CB-historias: story off). Posts and comments of each tenant's
-- administrator, four fresh stories of BS1 (two per tenant) and one open-highlight item per tenant carry the cross cases.
-- `bperm_covered` records, as the file runs, which function and which gate each cross-tenant case exercised: section 22
-- compares it with the catalog.
create temp table bperm_covered (kind text not null, name text not null);
update public.communities set status = 'active', deleted_at = null
 where id in ('24100000-0000-4000-8000-0000000000c1', '24100000-0000-4000-8000-0000000000d1',
              '24100000-0000-4000-8000-0000000014c1', '24100000-0000-4000-8000-0000000014d1');
update public.tenant_modules set enabled = true
 where tenant_id in ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000011')
   and module_key in ('social', 'store');
update public.store_product_communities
   set can_like = true, can_comment = true, can_share = true, can_post = true, can_story = false
 where product_id in ('24100000-0000-4000-8000-0000000000a1', '24100000-0000-4000-8000-0000000000a6')
   and community_id = '24100000-0000-4000-8000-0000000000c1';
update public.store_product_communities
   set can_like = true, can_comment = true, can_share = true, can_post = false, can_story = false
 where product_id = '24100000-0000-4000-8000-0000000000b1' and community_id = '24100000-0000-4000-8000-0000000000d1';
update public.store_product_communities set can_story = true
 where product_id = '24100000-0000-4000-8000-0000000014a1' and community_id = '24100000-0000-4000-8000-0000000014c1';
update public.store_product_communities set can_story = false
 where product_id = '24100000-0000-4000-8000-0000000014a3' and community_id = '24100000-0000-4000-8000-0000000014d1';
update public.store_entitlements set status = 'active', revoked_at = null
 where id in ('24100000-0000-4000-8000-0000000000e1', '24100000-0000-4000-8000-0000000000e2', '24100000-0000-4000-8000-0000000000e3',
              '24100000-0000-4000-8000-0000000014e1', '24100000-0000-4000-8000-0000000014e4');
update public.story_highlights set open_to_buyers = true
 where id in ('24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-0000000014f8');
-- the post of A carries an explicit, later `created_at`: every row of this file shares one `now()`, and the sample picks the
-- newest tenant post of the locked community (ties would fall to a random uuid)
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, community_id, created_at) values
  ('24100000-0000-4000-8000-000000002001', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'cross A', 'tenant', '24100000-0000-4000-8000-0000000000c1', now() + interval '2 hours'),
  ('24100000-0000-4000-8000-000000002011', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'cross B', 'tenant', '24100000-0000-4000-8000-0000000000d1', now());
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body) values
  ('24100000-0000-4000-8000-000000002002', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000002001', '24100000-0000-4000-8000-000000000002', 'cross A'),
  ('24100000-0000-4000-8000-000000002012', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000002011', '24100000-0000-4000-8000-000000000012', 'cross B');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('24100000-0000-4000-8000-0000000020a1', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-0000000020a2', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-0000000020a3', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}'),
  ('24100000-0000-4000-8000-0000000020a4', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640}');
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, visibility, published_at, expires_at) values
  ('24100000-0000-4000-8000-000000002021', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-0000000020a1', 'image', 's2021', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000002022', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-0000000020a2', 'image', 's2022', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000002023', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-0000000020a3', 'image', 's2023', 'followers', now() - interval '1 hour', now() + interval '23 hours'),
  ('24100000-0000-4000-8000-000000002024', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401', '24100000-0000-4000-8000-0000000020a4', 'image', 's2024', 'followers', now() - interval '1 hour', now() + interval '23 hours');
insert into public.story_highlight_items (id, tenant_id, highlight_id, story_id, added_by_user_id) values
  ('24100000-0000-4000-8000-000000002031', '24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000002021', '24100000-0000-4000-8000-000000001401'),
  ('24100000-0000-4000-8000-000000002032', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000002022', '24100000-0000-4000-8000-000000001401');

-- ── 20. the cross-tenant matrix of every new function and gate (11.1-11, BPERM-25, D-886; T-11.1-40) ──────
-- Every negative below is a member of tenant A against tenant B's rows, or the SAME user under tenant B's claim, and each sits
-- beside a positive control in the same tenant (the grant answers there, so the absence is isolation, not a broken fixture).

-- 20a. the three functions. M1 (…04) under A's claim.
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1', 'post'), true,
  '20a: control: M1 holds post in A''s community CA under A''s claim');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1', 'like'), false,
  '20a: …and tenant B''s community CB answers false for every action under A''s claim (like)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1', 'post'), false,
  '20a: …(post)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1', 'post'),
          app.community_action_allowed('24100000-0000-4000-8000-0000000020ff', 'post'),
  '20a: a foreign community answers exactly what a community that exists nowhere answers');
select is((select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000000c1'), true,
  '20a: control: the scope map carries A''s community under A''s claim');
select is((select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000000d1'), false,
  '20a: …and never names tenant B''s community');
select is((select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000000d1')
         , (select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000020ff'),
  '20a: …a foreign community key is absent exactly like one that exists nowhere');
select ok(not ('24100000-0000-4000-8000-0000000000d1'::uuid = any (app.community_action_denied_ids('like'))),
  '20a: the denied-ids lane form never names tenant B''s community under A''s claim');
reset role;
-- the same user under B's claim: B's own grant answers, A's never does
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1', 'like'), true,
  '20a: control: the same user holds like in B''s community under B''s claim');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1', 'like'), false,
  '20a: BPERM-25: …and A''s community answers false under B''s claim (like)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1', 'post'), false,
  '20a: …(post, the very action A''s link grants)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1', 'post'), false,
  '20a: …and B''s own link grants no post, so A''s post grant did not leak across (post in CB)');
select is((select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000000d1'), true,
  '20a: control: B''s map carries B''s community');
select is((select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000000c1'), false,
  '20a: …and not A''s');
select is((select count(*)::int from jsonb_object_keys((select app.community_buyer_scope()))), 1,
  '20a: …one key in all: the map holds only the claim''s tenant');
select ok('24100000-0000-4000-8000-0000000000d1'::uuid = any (app.community_action_denied_ids('post')),
  '20a: control: the denied-ids form names B''s community for post (B''s link ticks nothing there)');
select ok(not ('24100000-0000-4000-8000-0000000000c1'::uuid = any (app.community_action_denied_ids('post'))),
  '20a: …and never A''s community');
reset role;
-- staff fail closed in both tenants, and a lane with a tenant of its own but nothing in it answers empty
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000002', 'admin_tenant');
select is((select app.community_buyer_scope()), '{}'::jsonb, '20a: staff of A: the scope map is empty (fail closed)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'admin_tenant');
select is((select app.community_buyer_scope()), '{}'::jsonb, '20a: staff of B: the scope map is empty (fail closed)');
reset role;
insert into bperm_covered values
  ('function', 'community_action_allowed'), ('function', 'community_action_denied_ids'), ('function', 'community_buyer_scope');

-- 20b. the post gate (`feed_posts_social_insert_gate`)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'cruzado', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '42501', null, '20b: a buyer of A posting into tenant B''s community (A''s id on the row) is refused (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', 'cruzado', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '42501', null, '20b: …and with tenant B''s id forged on the row (42501)');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'controle A', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '20b: control: the same buyer posts into A''s own community');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', 'cruzado', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '20b: BPERM-25: under B''s claim A''s post grant opens nothing in A''s community (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', 'cruzado', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '20b: …nor with A''s id forged on the row (42501)');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', 'sem flag em B', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '42501', null, '20b: …and B''s own link ticks no post, so the buyer is refused in B too (42501)');
reset role;
update public.store_product_communities set can_post = true
 where product_id = '24100000-0000-4000-8000-0000000000b1' and community_id = '24100000-0000-4000-8000-0000000000d1';
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', 'controle B', 'community', '24100000-0000-4000-8000-0000000000d1') $$,
  '20b: control: with B''s own post flag on the same buyer posts into B''s community');
reset role;
update public.store_product_communities set can_post = false
 where product_id = '24100000-0000-4000-8000-0000000000b1' and community_id = '24100000-0000-4000-8000-0000000000d1';
insert into bperm_covered values ('policy', 'feed_posts_social_insert_gate');

-- 20c. the like gate (`feed_likes_community_gate`), on a post and on a comment heart
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002011') $$,
  '42501', null, '20c: a buyer of A liking a post of tenant B is refused (42501)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002012', 'post') $$,
  '42501', null, '20c: …and a heart on a comment of tenant B (42501)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002011') $$,
  '42501', null, '20c: …with tenant B''s id forged on the row (42501)');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002001') $$,
  '20c: control: the same buyer likes A''s post');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002002', 'post') $$,
  '20c: control: …and hearts A''s comment');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002001') $$,
  '42501', null, '20c: BPERM-25: the same user under B''s claim cannot like A''s post (42501)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002002', 'post') $$,
  '42501', null, '20c: …nor heart A''s comment (42501)');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004', '24100000-0000-4000-8000-000000002011') $$,
  '20c: control: under B''s claim the same user likes B''s post');
reset role;
insert into bperm_covered values ('policy', 'feed_likes_community_gate');

-- 20d. the comment gate (`feed_comments_community_insert_gate`)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000002011', '24100000-0000-4000-8000-000000000004', 'cruzado') $$,
  '42501', null, '20d: a buyer of A commenting on a post of tenant B is refused (42501)');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000002011', '24100000-0000-4000-8000-000000000004', 'cruzado') $$,
  '42501', null, '20d: …with tenant B''s id forged on the row (42501)');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000002001', '24100000-0000-4000-8000-000000000004', 'controle A') $$,
  '20d: control: the same buyer comments on A''s post');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000002001', '24100000-0000-4000-8000-000000000004', 'cruzado') $$,
  '42501', null, '20d: BPERM-25: the same user under B''s claim cannot comment on A''s post (42501)');
select lives_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000002011', '24100000-0000-4000-8000-000000000004', 'controle B') $$,
  '20d: control: under B''s claim the same user comments on B''s post');
reset role;
insert into bperm_covered values ('policy', 'feed_comments_community_insert_gate');

-- 20e. the item insert gate (`story_highlight_items_member_insert_gate`)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000002023', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '20e: a buyer of A saving A''s story into tenant B''s open highlight is refused (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000002024', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '20e: …nor with tenant B''s id forged on the row, B''s own story included (42501)');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000002023', '24100000-0000-4000-8000-000000001401') $$,
  '20e: control: the same buyer saves their own story into A''s open highlight');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f1', '24100000-0000-4000-8000-000000002024', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '20e: BPERM-25: under B''s claim A''s open highlight takes nothing (42501)');
select throws_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000002024', '24100000-0000-4000-8000-000000001401') $$,
  '42501', null, '20e: …and A''s story grant opens nothing in B (B''s link ticks no story: 42501)');
reset role;
update public.store_product_communities set can_story = true
 where product_id = '24100000-0000-4000-8000-0000000014a3' and community_id = '24100000-0000-4000-8000-0000000014d1';
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select lives_ok(
  $$ insert into public.story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000014f8', '24100000-0000-4000-8000-000000002024', '24100000-0000-4000-8000-000000001401') $$,
  '20e: control: with B''s own story flag on the same user saves B''s story into B''s open highlight');
reset role;
insert into bperm_covered values ('policy', 'story_highlight_items_member_insert_gate');

-- 20f. the item delete gate (`story_highlight_items_member_delete_gate`; a USING-filtered delete raises nothing, the row STAYS)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok($$ delete from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002032' $$,
  '20f: a buyer of A deleting tenant B''s item raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002032'), 1,
  '20f: …and B''s item stays');
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select lives_ok($$ delete from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002031' $$,
  '20f: BPERM-25: the same user under B''s claim deleting A''s item raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002031'), 1,
  '20f: …and A''s item stays');
update public.store_product_communities set can_story = false
 where product_id = '24100000-0000-4000-8000-0000000014a3' and community_id = '24100000-0000-4000-8000-0000000014d1';
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select lives_ok($$ delete from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002032' $$,
  '20f: B''s own link without the story flag: the buyer''s own item delete raises nothing…');
reset role;
select is((select count(*)::int from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002032'), 1,
  '20f: …and the item stays (the grant must hold in B, not in A)');
update public.store_product_communities set can_story = true
 where product_id = '24100000-0000-4000-8000-0000000014a3' and community_id = '24100000-0000-4000-8000-0000000014d1';
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select lives_ok($$ delete from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002032' $$,
  '20f: control: with B''s story flag on the buyer removes their own item in B…');
reset role;
select is((select count(*)::int from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002032'), 0,
  '20f: …(gone)');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select lives_ok($$ delete from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002031' $$,
  '20f: control: under A''s claim the same user removes their own item in A…');
reset role;
select is((select count(*)::int from public.story_highlight_items where id = '24100000-0000-4000-8000-000000002031'), 0,
  '20f: …(gone)');
insert into bperm_covered values ('policy', 'story_highlight_items_member_delete_gate');

-- 20g. the audience gate (`stories_audience_gate`) and the free sample (`app.feed_sample_post_ids`)
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000001401');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000002021'), 1,
  '20g: control: BS1 reads their own story of A under A''s claim');
select is((select count(*)::int from public.stories where id in ('24100000-0000-4000-8000-000000002022', '24100000-0000-4000-8000-000000002024')), 0,
  '20g: …and no story of tenant B (not even their own B stories)');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000001401');
select is((select count(*)::int from public.stories where id = '24100000-0000-4000-8000-000000002022'), 1,
  '20g: control: the same user reads their own story of B under B''s claim');
select is((select count(*)::int from public.stories where id in ('24100000-0000-4000-8000-000000002021', '24100000-0000-4000-8000-000000002023')), 0,
  '20g: BPERM-25: …and no story of tenant A under B''s claim');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000005');
select ok('24100000-0000-4000-8000-000000002001'::uuid = any (app.feed_sample_post_ids()),
  '20g: control: the locked member of A gets A''s newest tenant post as the sample of CA');
select ok(not ('24100000-0000-4000-8000-000000002011'::uuid = any (app.feed_sample_post_ids())),
  '20g: …and the sample never carries tenant B''s post');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select ok(not ('24100000-0000-4000-8000-000000002001'::uuid = any (app.feed_sample_post_ids())),
  '20g: BPERM-25: under B''s claim the sample never carries tenant A''s post');
reset role;

-- ── 21. empty tenants and same-name communities (11.1-11, BPERM-25 empty and adjacency) ───────────────────
-- A third tenant that owns no community, no product and no entitlement, with one member: everything answers empty or false.
select tests.tenant('pgtap-bperm-c', 'Permissoes C', '24100000-0000-4000-8000-000000002101');
select tests.auth_user('c1@bperm-c.local', '24100000-0000-4000-8000-000000002102');
select tests.member('24100000-0000-4000-8000-000000002101', '24100000-0000-4000-8000-000000002102');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('24100000-0000-4000-8000-000000002101', 'social', true), ('24100000-0000-4000-8000-000000002101', 'store', true);
select tests.as_tenant('24100000-0000-4000-8000-000000002101', '24100000-0000-4000-8000-000000002102');
select lives_ok($$ select app.community_buyer_scope() $$, '21: BPERM-25 empty: the scope function runs in a tenant that owns nothing (no error)');
select is((select app.community_buyer_scope()), '{}'::jsonb, '21: …and answers the empty map');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1', 'like'), false,
  '21: …every action on a community of another tenant answers false (like)');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000020ff', 'post'), false,
  '21: …and on one that exists nowhere (post)');
select is(app.community_action_denied_ids('like'), '{}'::uuid[], '21: …the denied-ids form is the empty array');
select is(app.feed_sample_post_ids(), '{}'::uuid[], '21: …and the free sample is empty');
select is((select count(*)::int from public.communities), 0, '21: …no community is visible');
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, author_user_id, caption, visibility, community_id)
     values ('24100000-0000-4000-8000-000000002101', '24100000-0000-4000-8000-000000002102', 'vazio', 'community', '24100000-0000-4000-8000-0000000000c1') $$,
  '42501', null, '21: …and a post into a community of another tenant is refused (42501)');
reset role;
-- same name, same slug, two tenants, one user holding a product in each (the buyer, …04)
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, kind, position) values
  ('24100000-0000-4000-8000-0000000020d2', '24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000012', 'Base A', 'base-a', 'organization', 5);
insert into public.store_product_communities (tenant_id, product_id, community_id, can_post) values
  ('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-0000000000b1', '24100000-0000-4000-8000-0000000020d2', true);
select is((select count(distinct (name, slug))::int from public.communities
            where id in ('24100000-0000-4000-8000-0000000000c1', '24100000-0000-4000-8000-0000000020d2')), 1,
  '21: BPERM-25 adjacency: the two communities carry the SAME name and slug');
select is((select count(distinct tenant_id)::int from public.communities
            where id in ('24100000-0000-4000-8000-0000000000c1', '24100000-0000-4000-8000-0000000020d2')), 2,
  '21: …in two different tenants');
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1', 'post'), true,
  '21: control: under A''s claim the grant answers for A''s community');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000020d2', 'post'), false,
  '21: …and never for the same-named community of tenant B, though B''s link ticks post for this very user');
select is((select app.community_buyer_scope() ? '24100000-0000-4000-8000-0000000020d2'), false,
  '21: …nor does A''s map name it');
reset role;
select tests.as_tenant('24100000-0000-4000-8000-000000000011', '24100000-0000-4000-8000-000000000004');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000020d2', 'post'), true,
  '21: control: under B''s claim B''s link answers for B''s community');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000c1', 'post'), false,
  '21: …and never for the same-named community of tenant A, though A''s link ticks post for this very user');
reset role;
-- ordering: the claim is applied before any lookup, so the answers do not depend on the order the ids are asked in
select tests.as_tenant('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000004');
select is(
  (select jsonb_object_agg(q.id::text, app.community_action_allowed(q.id, 'post'))
     from (values ('24100000-0000-4000-8000-0000000000c1'::uuid), ('24100000-0000-4000-8000-0000000020d2'::uuid),
                  ('24100000-0000-4000-8000-0000000000d1'::uuid), ('24100000-0000-4000-8000-0000000020ff'::uuid)) q(id)),
  (select jsonb_object_agg(q.id::text, app.community_action_allowed(q.id, 'post'))
     from (values ('24100000-0000-4000-8000-0000000020ff'::uuid), ('24100000-0000-4000-8000-0000000000d1'::uuid),
                  ('24100000-0000-4000-8000-0000000020d2'::uuid), ('24100000-0000-4000-8000-0000000000c1'::uuid)) q(id)),
  '21: BPERM-25 ordering: asking for the same ids in the opposite order gives the same answers');
select is(app.community_action_allowed('24100000-0000-4000-8000-0000000000d1', 'post'),
          app.community_action_allowed('24100000-0000-4000-8000-0000000020ff', 'post'),
  '21: …and a foreign id answers like one that does not exist (false either way)');
reset role;

-- ── 22. the meta check: no new function or gate ships without a cross-tenant case (11.1-11, T-11.1-40) ───
-- `bperm_covered` was filled by sections 20 above, one row per function and per gate the cross cases exercised. The catalog is
-- read here: every function that reads the buyer flags (or the scope) and every policy that calls one of them must be in it.
select is(
  array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app'
           and p.prosrc ~* 'community_buyer_scope|community_action_allowed|community_action_denied_ids|can_like|can_comment|can_share|can_post|can_story|open_to_buyers'
         order by 1),
  array(select name from bperm_covered where kind = 'function' order by 1),
  '22: every app function that reads the buyer flags or the scope is named in the cross-tenant matrix (a function added later without a negative fails here)');
select is(
  array(select policyname::text from pg_policies
         where schemaname = 'public'
           and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'community_buyer_scope|community_action_allowed|community_action_denied_ids|open_to_buyers'
         order by 1),
  array(select name from bperm_covered where kind = 'policy' order by 1),
  '22: every policy that calls one of them is named in the cross-tenant matrix (a gate added later without a negative fails here)');
select is((select count(*)::int from bperm_covered where kind = 'function'), 3,
  '22: the three functions of plan 02 are all covered');
select is((select count(*)::int from bperm_covered where kind = 'policy'), 5,
  '22: the five insert and delete gates of plans 02 to 04 are all covered');

select * from finish();
rollback;
