begin;
-- 180-store.sql — the store tables, the community gate and the purchase definer, executed inside
-- Postgres (08.2-01, STORE-08, STORE-11, STORE-20, COMM-02). Numbered 180 after 170 (08.1).
--
-- Sets are compared SORTED (`array(select unnest(…) order by 1)`): the answer is a set and no
-- caller relies on its order (P40).
--
-- 1. THE GATE TRUTH TABLE (truth 2, P38, P39, P74; rows of `app.community_locked_ids()` in a lane):
--    a community with no link is open to a member; a linked community is locked for a member who
--    holds no active entitlement to ANY of its products; holding one of its products opens it, and
--    revoking one of two held products keeps it open; `admin_tenant` and `support_tenant` always get
--    the empty set (by claim in the lane form, by membership in the `_for` form); a null or unknown
--    `tenant_role` claim takes the MEMBER branch even for an admin user (fails closed, T-08.2-13); a
--    community whose only product is archived stays locked for non-holders and opens for a holder
--    (A4); a product with no link changes no answer (P39).
--
-- 2. STORE OFF (P02, T-08.2-14): with the tenant's `store` row disabled, then deleted, every lane
--    gets the empty set, `community_viewer_ids` answers null, and the member reads every post.
--
-- 3. FEED_POSTS (truth 7, P40): in a locked community the member lane reads exactly ONE post, the
--    newest; two posts created at the same instant resolve to the higher id; staff read every post in
--    the same statement shape; a post outside any community and a post in an open community stay
--    visible. A story comment (`story_id` set, `post_id` null) stays visible (Pitfall 14's fixture).
--
-- 4. THE LEDGERS ARE READ-ONLY FROM A LANE (truth 4, P68, P69): member-lane insert, update and delete
--    on `store_orders` and `store_entitlements` raise 42501; a member selects only its own rows and an
--    `admin_tenant` lane every row of its tenant (none of another tenant's); each CHECK rejects a
--    violating row written as the service lane.
--
-- 5. THE DEFINER (P30, P31, P32, D-361): `app.store_purchase` buys a 0-cent product with
--    `amount_cents = 0`; a price one cent off either way is `price_changed` and writes nothing; an
--    archived product is `unavailable`; the right price is `purchased`, a replay `owned` with the
--    counts unchanged; a later price edit leaves the order's amount; no claims and another tenant's
--    product are `not_found`. Every function of this plan is SECURITY DEFINER with `search_path=''`,
--    and `app.store_purchase` is executable by `authenticated` and not by `anon`.
--
-- 6. P77: nothing above writes `community_members` (the V2 seam stays born-unused).
--
-- Fixture ids use the `18000000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(72);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-store-a', 'Loja A', '18000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-store-b', 'Loja B', '18000000-0000-4000-8000-000000000011');
select tests.auth_user('admin@store-a.local', '18000000-0000-4000-8000-000000000002');
select tests.auth_user('support@store-a.local', '18000000-0000-4000-8000-000000000003');
select tests.auth_user('m1@store-a.local', '18000000-0000-4000-8000-000000000004');
select tests.auth_user('m2@store-a.local', '18000000-0000-4000-8000-000000000005');
select tests.auth_user('member@store-b.local', '18000000-0000-4000-8000-000000000012');
select tests.member('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select tests.member('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select tests.member('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000012');

-- The store is ON for A only (B has no row: a missing row reads as disabled).
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('18000000-0000-4000-8000-000000000001', 'store', true);

-- Communities of A: C_open (no link), C_one (P1), C_two (P1 and P2), C_arch (only the archived P3).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug) values
  ('18000000-0000-4000-8000-0000000000c0', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Aberta', 'aberta'),
  ('18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Um', 'um'),
  ('18000000-0000-4000-8000-0000000000c2', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Dois', 'dois'),
  ('18000000-0000-4000-8000-0000000000c3', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Arquivo', 'arquivo');

-- Products of A (P_free has no link at all, P39) and one of B with the same name and price.
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'x', 1990, 'active'),
  ('18000000-0000-4000-8000-0000000000a2', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'P2', 500, 'active'),
  ('18000000-0000-4000-8000-0000000000a3', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'P3', 100, 'archived'),
  ('18000000-0000-4000-8000-0000000000a4', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Gratis', 0, 'active'),
  ('18000000-0000-4000-8000-0000000000b1', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000012', 'x', 1990, 'active');

insert into public.store_product_communities (tenant_id, product_id, community_id) values
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-0000000000c1'),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000a1', '18000000-0000-4000-8000-0000000000c2'),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000a2', '18000000-0000-4000-8000-0000000000c2'),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000a3', '18000000-0000-4000-8000-0000000000c3');

-- Posts: four in C_one with distinct instants (newest …0b14), two in C_two at the SAME instant (the
-- higher id …0b22 is the sample, P40), one in C_open and one outside any community.
insert into public.feed_posts (id, tenant_id, caption, author_user_id, community_id, created_at) values
  ('18000000-0000-4000-8000-000000000b11', '18000000-0000-4000-8000-000000000001', 'um-1', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c1', now() - interval '4 hours'),
  ('18000000-0000-4000-8000-000000000b12', '18000000-0000-4000-8000-000000000001', 'um-2', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c1', now() - interval '3 hours'),
  ('18000000-0000-4000-8000-000000000b13', '18000000-0000-4000-8000-000000000001', 'um-3', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c1', now() - interval '2 hours'),
  ('18000000-0000-4000-8000-000000000b14', '18000000-0000-4000-8000-000000000001', 'um-4', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c1', now() - interval '1 hour'),
  ('18000000-0000-4000-8000-000000000b21', '18000000-0000-4000-8000-000000000001', 'dois-1', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c2', now() - interval '30 minutes'),
  ('18000000-0000-4000-8000-000000000b22', '18000000-0000-4000-8000-000000000001', 'dois-2', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c2', now() - interval '30 minutes'),
  ('18000000-0000-4000-8000-000000000b30', '18000000-0000-4000-8000-000000000001', 'aberta', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000c0', now()),
  ('18000000-0000-4000-8000-000000000b00', '18000000-0000-4000-8000-000000000001', 'geral', '18000000-0000-4000-8000-000000000002', null, now());

-- A story comment (`story_id` set, `post_id` null): Pitfall 14's fixture for the comments gate.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths)
values ('18000000-0000-4000-8000-0000000000e1', '18000000-0000-4000-8000-000000000001',
        '18000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
values ('18000000-0000-4000-8000-0000000000e2', '18000000-0000-4000-8000-000000000001',
        '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000e1', 'image', '',
        now() - interval '1 hour', now() + interval '23 hours');
insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
values ('18000000-0000-4000-8000-0000000000e3', '18000000-0000-4000-8000-000000000001',
        '18000000-0000-4000-8000-0000000000e2', '18000000-0000-4000-8000-000000000002', 'story', 0, null, null, null);

-- B's paid order and active entitlement, written as the service lane (no write policy, no privilege).
select tests.as_service();
insert into public.store_orders (id, tenant_id, user_id, product_id, status, amount_cents, currency, paid_at) values
  ('18000000-0000-4000-8000-0000000000f1', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000012',
   '18000000-0000-4000-8000-0000000000b1', 'paid', 1990, 'BRL', now());
insert into public.store_entitlements (tenant_id, user_id, product_id, source, order_id) values
  ('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000012',
   '18000000-0000-4000-8000-0000000000b1', 'purchase', '18000000-0000-4000-8000-0000000000f1');
reset role;

-- ── 1. the truth table, before anyone holds anything ───────────────────────────────────────────
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.community_locked_ids()) order by 1),
  array['18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c2', '18000000-0000-4000-8000-0000000000c3']::uuid[],
  'member M1 with nothing: every linked community is locked, the unlinked C_open is not (P39)');
select is(array(select unnest(app.community_locked_ids_for('18000000-0000-4000-8000-000000000004')) order by 1), array(select unnest(app.community_locked_ids()) order by 1),
  'the explicit form agrees with the lane form for the same member');
select is(app.community_locked_ids_for('18000000-0000-4000-8000-000000000002'), '{}'::uuid[],
  'the explicit form: an admin_tenant by MEMBERSHIP gets the empty set');
select is(app.community_locked_ids_for('18000000-0000-4000-8000-000000000003'), '{}'::uuid[],
  'the explicit form: a support_tenant by MEMBERSHIP gets the empty set');
select is(app.community_viewer_ids('18000000-0000-4000-8000-0000000000c0'), null::uuid[],
  'community_viewer_ids: a community with no link is not gated (null)');
select is(app.community_viewer_ids('18000000-0000-4000-8000-0000000000c1'), '{}'::uuid[],
  'community_viewer_ids: a gated community nobody holds yet is the empty set, not null');

-- ── 3. feed_posts in the member lane ───────────────────────────────────────────────────────────
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c1' order by created_at desc, id desc $$,
  ARRAY['18000000-0000-4000-8000-000000000b14'],
  'locked C_one: the member reads exactly ONE post, the newest (D-354)');
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c2' $$,
  ARRAY['18000000-0000-4000-8000-000000000b22'],
  'locked C_two: two posts at the same instant resolve to the HIGHER id (P40)');
select is_empty(
  $$ select 1 from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c3' $$,
  'locked C_arch has no post, so there is no sample either');
select results_eq(
  $$ select id::text from public.feed_posts where community_id is null $$,
  ARRAY['18000000-0000-4000-8000-000000000b00'],
  'a post outside any community stays visible to the member');
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c0' $$,
  ARRAY['18000000-0000-4000-8000-000000000b30'],
  'a post of the open C_open stays visible to the member');
select results_eq(
  $$ select count(*)::int from public.feed_comments where id = '18000000-0000-4000-8000-0000000000e3' $$,
  ARRAY[1],
  'a story comment stays visible to the member with a locked community present (Pitfall 14)');
select is(
  coalesce(array(select unnest(app.feed_sample_post_ids()) order by 1), '{}'::uuid[]),
  array['18000000-0000-4000-8000-000000000b14', '18000000-0000-4000-8000-000000000b22']::uuid[],
  'feed_sample_post_ids: one newest post per locked community that has posts');

-- Null and unknown role claims fail CLOSED (T-08.2-13): even an admin USER takes the member branch.
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', null);
select is(array(select unnest(app.community_locked_ids()) order by 1),
  array['18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c2', '18000000-0000-4000-8000-0000000000c3']::uuid[],
  'a null tenant_role claim is treated as member');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', null);
select is(array(select unnest(app.community_locked_ids()) order by 1),
  array['18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c2', '18000000-0000-4000-8000-0000000000c3']::uuid[],
  'a null tenant_role claim for an admin USER still takes the member branch (the claim decides)');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'owner');
select is(array(select unnest(app.community_locked_ids()) order by 1),
  array['18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c2', '18000000-0000-4000-8000-0000000000c3']::uuid[],
  'an unknown tenant_role claim is treated as member');

-- Staff lanes: the empty set, and every post in the same statement shape (P74).
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.community_locked_ids(), '{}'::uuid[], 'admin_tenant lane: the empty set');
select results_eq(
  $$ select count(*)::int from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[4], 'admin_tenant lane: every post of the locked C_one');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.community_locked_ids(), '{}'::uuid[], 'support_tenant lane: the empty set');
select results_eq(
  $$ select count(*)::int from public.feed_posts where community_id in ('18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c2') $$,
  ARRAY[6], 'support_tenant lane: every post of both locked communities');

-- ── 1. holding products (entitlements written as the service lane) ─────────────────────────────
reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('18000000-0000-4000-8000-0000000000d1', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004',
   '18000000-0000-4000-8000-0000000000a1', 'grant', '18000000-0000-4000-8000-000000000002');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.community_locked_ids()) order by 1), array['18000000-0000-4000-8000-0000000000c3']::uuid[],
  'M1 holding P1: C_one and C_two open (P1 opens both), C_arch stays locked');
select results_eq(
  $$ select count(*)::int from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[4], 'M1 holding P1 reads every post of C_one');
select is(app.community_viewer_ids('18000000-0000-4000-8000-0000000000c1'),
  array['18000000-0000-4000-8000-000000000004']::uuid[],
  'community_viewer_ids(C_one): the holder only, never staff (they always read)');

reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('18000000-0000-4000-8000-0000000000d2', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004',
   '18000000-0000-4000-8000-0000000000a2', 'grant', '18000000-0000-4000-8000-000000000002');
update public.store_entitlements set status = 'revoked', revoked_at = now()
 where id = '18000000-0000-4000-8000-0000000000d1';
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.community_locked_ids()) order by 1),
  array['18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c3']::uuid[],
  'M1 held P1 and P2, P1 revoked: C_two stays open through P2 (P38), C_one locks again');

-- A4: an archived product still locks its community for non-holders and opens it for a holder.
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select ok('18000000-0000-4000-8000-0000000000c3'::uuid = any (app.community_locked_ids()),
  'C_arch (only an archived product) is locked for the non-holder M2');
reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('18000000-0000-4000-8000-0000000000d3', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005',
   '18000000-0000-4000-8000-0000000000a3', 'grant', '18000000-0000-4000-8000-000000000002');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select is(array(select unnest(app.community_locked_ids()) order by 1),
  array['18000000-0000-4000-8000-0000000000c1', '18000000-0000-4000-8000-0000000000c2']::uuid[],
  'M2 holding the archived P3: C_arch opens for the holder (A4)');

-- ── 2. store off: disabled, then no row at all ─────────────────────────────────────────────────
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '18000000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select is(app.community_locked_ids(), '{}'::uuid[], 'store disabled: M2 gets the empty set');
select results_eq(
  $$ select count(*)::int from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[4], 'store disabled: M2 reads every post of C_one (links exist, nothing is gated)');
select is(app.community_viewer_ids('18000000-0000-4000-8000-0000000000c1'), null::uuid[],
  'store disabled: community_viewer_ids answers null (not gated)');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select is(app.community_locked_ids(), '{}'::uuid[], 'store disabled: M1 gets the empty set');
reset role;
delete from public.tenant_modules
 where tenant_id = '18000000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select is(app.community_locked_ids(), '{}'::uuid[], 'no store row at all (P02): the empty set');
select is(app.community_locked_ids_for('18000000-0000-4000-8000-000000000005'), '{}'::uuid[],
  'no store row at all (P02): the explicit form agrees');
reset role;
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('18000000-0000-4000-8000-000000000001', 'store', true);

-- ── 5. the purchase definer, in M2's lane ──────────────────────────────────────────────────────
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select results_eq(
  $$ select outcome, order_id is not null from app.store_purchase('18000000-0000-4000-8000-0000000000a4', 0) $$,
  $$ values ('purchased'::text, true) $$,
  'a 0-cent product goes through the same function: purchased');
select results_eq(
  $$ select amount_cents, currency, status, provider from public.store_orders
      where product_id = '18000000-0000-4000-8000-0000000000a4' $$,
  $$ values (0, 'BRL'::text, 'paid'::text, 'none'::text) $$,
  '…and writes an order with amount_cents = 0 (P30)');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a1', 1991) $$,
  ARRAY['price_changed'], 'one cent ABOVE the stored price: price_changed (P30)');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a1', 1989) $$,
  ARRAY['price_changed'], 'one cent BELOW the stored price: price_changed (P30)');
select is_empty(
  $$ select 1 from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a1' $$,
  '…and neither refusal wrote an order');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a3', 100) $$,
  ARRAY['unavailable'], 'an archived product: unavailable (holders keep access; no NEW purchase)');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a1', 1990) $$,
  ARRAY['purchased'], 'the stored price: purchased');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a1', 1990) $$,
  ARRAY['owned'], 'a replay: owned (P32)');
select results_eq(
  $$ select (select count(*)::int from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a1'),
            (select count(*)::int from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a1'
                and user_id = '18000000-0000-4000-8000-000000000005') $$,
  $$ values (1, 1) $$,
  '…with ONE order and ONE entitlement after the replay (P32)');
select results_eq(
  $$ select amount_cents, currency from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a1' $$,
  $$ values (1990, 'BRL'::text) $$,
  'the order amount is the product price, copied verbatim (P31, D-361)');
select ok(not ('18000000-0000-4000-8000-0000000000c1'::uuid = any (app.community_locked_ids())),
  'after the purchase C_one is open for M2');

-- D-361: a later price edit (admin lane) leaves the existing order alone.
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select lives_ok(
  $$ update public.store_products set price_cents = 2500 where id = '18000000-0000-4000-8000-0000000000a1' $$,
  'the admin lane edits the price');
select results_eq(
  $$ select amount_cents from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1990], '…and the existing order keeps the amount it was bought at (D-361)');

-- No claims, and another tenant's product: not_found, nothing written (P68).
reset role;
select tests.as_tenant_without_claims();
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a2', 500) $$,
  ARRAY['not_found'], 'no claims: not_found (P68)');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000b1', 1990) $$,
  ARRAY['not_found'], 'a product of another tenant: not_found (T-08.2-15)');
reset role;
select results_eq(
  $$ select (select count(*)::int from public.store_orders where product_id in ('18000000-0000-4000-8000-0000000000a2', '18000000-0000-4000-8000-0000000000b1')),
            (select count(*)::int from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000b1') $$,
  $$ values (1, 1) $$,
  '…and neither call wrote anything (B keeps only its own order and entitlement)');

-- ── 4. the ledgers are read-only from a lane ───────────────────────────────────────────────────
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004',
             '18000000-0000-4000-8000-0000000000a1', 'paid', 0, 'BRL') $$,
  '42501', null, 'member lane: insert into store_orders is refused (P68)');
select throws_ok(
  $$ update public.store_orders set amount_cents = 0 where tenant_id = '18000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'member lane: update of store_orders is refused');
select throws_ok(
  $$ delete from public.store_orders where tenant_id = '18000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'member lane: delete from store_orders is refused');
select throws_ok(
  $$ insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004',
             '18000000-0000-4000-8000-0000000000a1', 'grant', '18000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'member lane: insert into store_entitlements is refused (a member cannot grant itself access)');
select throws_ok(
  $$ update public.store_entitlements set status = 'active' where tenant_id = '18000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'member lane: update of store_entitlements is refused');
select throws_ok(
  $$ delete from public.store_entitlements where tenant_id = '18000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'member lane: delete from store_entitlements is refused');
select results_eq(
  $$ select count(*)::int from public.store_entitlements $$,
  ARRAY[2], 'M1 selects only its OWN entitlements (P1 revoked, P2 active), none of M2''s');
select is_empty($$ select 1 from public.store_orders $$, 'M1 holds no order and selects none of M2''s');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int, bool_and(user_id = '18000000-0000-4000-8000-000000000005') from public.store_orders $$,
  $$ values (2, true) $$, 'M2 selects its own two orders and nothing else');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.store_entitlements $$,
  ARRAY[5], 'the admin_tenant lane selects every entitlement of its tenant');
select results_eq(
  $$ select count(*)::int, bool_and(tenant_id = '18000000-0000-4000-8000-000000000001') from public.store_orders $$,
  $$ values (2, true) $$, '…and every order of its tenant, none of B''s identical-looking one');
select is_empty(
  $$ select 1 from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000b1' $$,
  'B''s entitlement is not found through A''s admin lane');

-- P69: each CHECK rejects a violating row written as the service lane.
reset role;
select tests.as_service();
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-0000000000a2', 'paid', 500, 'USD') $$,
  '23514', null, 'store_orders_currency_chk: only BRL');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency, provider)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-0000000000a2', 'paid', 500, 'BRL', 'stripe') $$,
  '23514', null, 'store_orders_provider_chk: only none until a gateway exists');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-0000000000a2', 'refunded', 500, 'BRL') $$,
  '23514', null, 'store_orders_status_chk: pending, paid or revoked');
select throws_ok(
  $$ insert into public.store_orders (tenant_id, user_id, product_id, status, amount_cents, currency)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-0000000000a2', 'paid', -1, 'BRL') $$,
  '23514', null, 'store_orders_amount_chk: never negative');
select throws_ok(
  $$ insert into public.store_entitlements (tenant_id, user_id, product_id, source)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005', '18000000-0000-4000-8000-0000000000a2', 'purchase') $$,
  '23514', null, 'store_entitlements_source_order_chk: a purchase carries its order');
select throws_ok(
  $$ insert into public.store_entitlements (tenant_id, user_id, product_id, source)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005', '18000000-0000-4000-8000-0000000000a2', 'grant') $$,
  '23514', null, 'store_entitlements_source_grant_chk: a grant carries its granter');
select throws_ok(
  $$ insert into public.store_entitlements (tenant_id, user_id, product_id, source, order_id, granted_by_user_id)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000005', '18000000-0000-4000-8000-0000000000a2',
             'purchase', '18000000-0000-4000-8000-0000000000f1', '18000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'a purchase entitlement cannot also name a granter');
select throws_ok(
  $$ insert into public.store_products (tenant_id, created_by_user_id, name, price_cents)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'caro', 10000001) $$,
  '23514', null, 'store_products_price_chk: at most R$ 100.000,00');
reset role;

-- ── 5. definer posture and grants ──────────────────────────────────────────────────────────────
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('app.community_locked_ids()'::regprocedure,
                    'app.community_locked_ids_for(uuid)'::regprocedure,
                    'app.community_viewer_ids(uuid)'::regprocedure,
                    'app.media_asset_hidden(uuid)'::regprocedure,
                    'app.feed_sample_post_ids()'::regprocedure,
                    'app.store_purchase(uuid, integer)'::regprocedure)),
  'every function of this plan is SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.store_purchase(uuid, integer)', 'execute'),
  'app.store_purchase is executable by authenticated');
select ok(not has_function_privilege('anon', 'app.store_purchase(uuid, integer)', 'execute'),
  '…and not by anon (EXECUTE revoked from PUBLIC)');

-- ── 6. P77: the store never writes community_members ───────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from public.community_members where tenant_id = '18000000-0000-4000-8000-000000000001' $$,
  ARRAY[0], 'community_members carries no row for the tenant after links, grants and purchases (P77)');

select * from finish();
rollback;
