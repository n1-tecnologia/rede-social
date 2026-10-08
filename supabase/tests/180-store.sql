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
-- 7. THE FEED GATE (08.2-03, STORE-15, STORE-17; P41, P57, P60; T-08.2-01, T-08.2-02,
--    T-08.2-22), with C_one locked for M1 (P1 revoked): the restrictive `feed_comments` policy hides
--    every comment of C_one's sample and hidden posts (roots and replies) from M1 while the admin
--    reads them, an open post's comment and the STORY comment stay visible (Pitfall 14, P57); in M1's
--    lane `insert into feed_likes` for the sample or for a hidden comment raises 42501 and for an
--    open post succeeds (P60); `app.feed_locked_post_community` answers C_one for a hidden post and
--    null for the sample, an open post, a deleted post, another tenant's post and every staff lane;
--    `app.media_asset_hidden` is true only for an asset attached solely to a hidden post (false for
--    the sample's asset, for an asset shared with an open post, for the admin lane, for another
--    tenant's lane and with the store disabled); on a 500-post volume fixture the member-lane merged
--    feed plans the gate as an `InitPlan` and still walks `feed_posts_tenant_created_all_idx`, and
--    the community page still walks `feed_posts_tenant_community_created_idx` (P41, STORE-11).
--
-- 8. GRANT AND REVOKE (08.2-06, D-359, D-360; T-08.2-06, T-08.2-07, T-08.2-12): `app.store_grant` in
--    the admin lane is `granted` (source grant, no order, granted by the caller), then
--    `already_active`; a membership of B, a blocked and a removed membership and a product of B are
--    `not_found` and write nothing; the `support_tenant` and member lanes get `forbidden` from both
--    definers and write nothing; `app.store_revoke` with another product id is `not_found`, then
--    `revoked` with the purchase's order revoked too (rows kept), twice is `not_found`, a grant revoke
--    touches no order, and a re-purchase writes a new order and entitlement; no claims is `not_found`;
--    both are SECURITY DEFINER with `search_path=''`, executable by `authenticated`, not by `anon`.
--
-- 9. THE SHARED IDENTITY T (D-309, STORE-21; P70, P71): T is `member` of A and of B; each has the store
--    ON and a locked community with the same name and identical posts. T buys in A: A's opens in T's
--    A lane, B's stays locked in T's B lane (sample only, no A post), T's A order and entitlement are
--    invisible in B, B's admin cannot grant with T's A membership id (and can with T's B one), and
--    with B's store OFF T reads every B post.
--
-- Fixture ids use the `18000000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(134);

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

-- ── 7. the feed gate (08.2-03): comments, likes, the definer lookups, the InitPlan ─────────────
-- State here: the store is ON for A; M1 holds P2 only (P1 revoked), so C_one is LOCKED for M1 and
-- its sample is …0b14; C_two is open for M1 through P2.
reset role;
-- Comments written before the check (as the migration role): the admin's root and reply on the
-- sample …0b14, a root on the hidden …0b13, a root on the open …0b30.
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('18000000-0000-4000-8000-000000000c71', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b14',
   '18000000-0000-4000-8000-000000000002', 'raiz da amostra', 0, null, null, null),
  ('18000000-0000-4000-8000-000000000c73', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b13',
   '18000000-0000-4000-8000-000000000002', 'raiz oculta', 0, null, null, null),
  ('18000000-0000-4000-8000-000000000c74', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b30',
   '18000000-0000-4000-8000-000000000002', 'raiz aberta', 0, null, null, null);
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('18000000-0000-4000-8000-000000000c72', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b14',
   '18000000-0000-4000-8000-000000000002', 'resposta na amostra', 1, '18000000-0000-4000-8000-000000000c71', 0, 'post');

-- A deleted post of C_one (older than the sample), and a post of tenant B.
insert into public.feed_posts (id, tenant_id, caption, author_user_id, community_id, created_at, deleted_at) values
  ('18000000-0000-4000-8000-000000000b15', '18000000-0000-4000-8000-000000000001', 'um-apagado', '18000000-0000-4000-8000-000000000002',
   '18000000-0000-4000-8000-0000000000c1', now() - interval '5 hours', now()),
  ('18000000-0000-4000-8000-000000000bb1', '18000000-0000-4000-8000-000000000011', 'b', '18000000-0000-4000-8000-000000000012',
   null, now(), null);

-- Media: …0e4 only on the hidden …0b13, …0e5 on the sample …0b14, …0e6 on BOTH the hidden …0b12 and
-- the open …0b30. Gallery posts (the `feed_post_media_kind_fk` pair).
update public.feed_posts set media_kind = 'gallery'
 where id in ('18000000-0000-4000-8000-000000000b12', '18000000-0000-4000-8000-000000000b13',
              '18000000-0000-4000-8000-000000000b14', '18000000-0000-4000-8000-000000000b30');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  ('18000000-0000-4000-8000-0000000000e4', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('18000000-0000-4000-8000-0000000000e5', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}'),
  ('18000000-0000-4000-8000-0000000000e6', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/jpeg', 1024, '{640}');
insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position) values
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b13', 'gallery', '18000000-0000-4000-8000-0000000000e4', 'image', 0),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b14', 'gallery', '18000000-0000-4000-8000-0000000000e5', 'image', 0),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b12', 'gallery', '18000000-0000-4000-8000-0000000000e6', 'image', 0),
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000b30', 'gallery', '18000000-0000-4000-8000-0000000000e6', 'image', 0);

-- P57: comments in M1's lane.
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select count(*)::int from public.feed_comments where id = '18000000-0000-4000-8000-0000000000e3' $$,
  ARRAY[1], 'P57: the story comment stays visible to M1 while C_one is locked (Pitfall 14)');
select is_empty(
  $$ select 1 from public.feed_comments where post_id = '18000000-0000-4000-8000-000000000b14' $$,
  'P57: no comment of the SAMPLE is visible to M1 (root and reply), although the post is');
select is_empty(
  $$ select 1 from public.feed_comments where parent_id = '18000000-0000-4000-8000-000000000c71' $$,
  'P57: the sample root''s replies are invisible by parent id too (the listReplies path)');
select is_empty(
  $$ select 1 from public.feed_comments where post_id = '18000000-0000-4000-8000-000000000b13' $$,
  'P57: no comment of a HIDDEN post is visible to M1');
select results_eq(
  $$ select count(*)::int from public.feed_comments where post_id = '18000000-0000-4000-8000-000000000b30' $$,
  ARRAY[1], 'P57: an open post''s comment stays visible to M1');

-- P60: likes in M1's lane. The restrictive insert check is the backstop behind the service guard.
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-000000000b14') $$,
  '42501', null, 'P60: a like on the SAMPLE raises 42501 in M1''s lane (feed_likes_community_gate)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-000000000c71', 'post') $$,
  '42501', null, 'P60: a like on a comment of the sample (hidden by the comments gate) raises 42501');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004', '18000000-0000-4000-8000-000000000b30') $$,
  'P60: a like on an open post still succeeds in M1''s lane');

-- app.feed_locked_post_community in M1's lane (STORE-17).
select is(app.feed_locked_post_community('18000000-0000-4000-8000-000000000b13'), '18000000-0000-4000-8000-0000000000c1'::uuid,
  'feed_locked_post_community: a hidden post of C_one answers C_one');
select is(app.feed_locked_post_community('18000000-0000-4000-8000-000000000b14'), null::uuid,
  'feed_locked_post_community: the SAMPLE answers null (it is readable)');
select is(app.feed_locked_post_community('18000000-0000-4000-8000-000000000b30'), null::uuid,
  'feed_locked_post_community: an open post answers null');
select is(app.feed_locked_post_community('18000000-0000-4000-8000-000000000b15'), null::uuid,
  'feed_locked_post_community: a DELETED post of C_one answers null (the bare 404)');
select is(app.feed_locked_post_community('18000000-0000-4000-8000-000000000bb1'), null::uuid,
  'feed_locked_post_community: tenant B''s post answers null in A''s lane (T-08.2-22)');

-- app.media_asset_hidden in M1's lane (Pattern 7).
select is(app.media_asset_hidden('18000000-0000-4000-8000-0000000000e4'), true,
  'media_asset_hidden: an asset attached only to a hidden post is hidden');
select is(app.media_asset_hidden('18000000-0000-4000-8000-0000000000e5'), false,
  'media_asset_hidden: the sample''s asset is not hidden');
select is(app.media_asset_hidden('18000000-0000-4000-8000-0000000000e6'), false,
  'media_asset_hidden: an asset shared by a hidden and an open post is not hidden');

-- Staff, another tenant, and the store off.
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.feed_comments
      where post_id in ('18000000-0000-4000-8000-000000000b14', '18000000-0000-4000-8000-000000000b13') $$,
  ARRAY[3], 'P57: the admin lane reads every comment of the sample and the hidden post');
select is(app.feed_locked_post_community('18000000-0000-4000-8000-000000000b13'), null::uuid,
  'feed_locked_post_community: null in the admin lane (staff are never locked out)');
select is(app.media_asset_hidden('18000000-0000-4000-8000-0000000000e4'), false,
  'media_asset_hidden: false in the admin lane');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000012');
select is(app.media_asset_hidden('18000000-0000-4000-8000-0000000000e4'), false,
  'media_asset_hidden: tenant B''s lane reads nothing of A (every statement pins app.tenant_id(), T-08.2-22)');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '18000000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
select is(app.media_asset_hidden('18000000-0000-4000-8000-0000000000e4'), false,
  'media_asset_hidden: false for every asset while the store is disabled');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '18000000-0000-4000-8000-000000000001' and module_key = 'store';

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'app.feed_locked_post_community(uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'app.feed_locked_post_community(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.feed_locked_post_community(uuid)', 'execute'),
  'feed_locked_post_community: SECURITY DEFINER, empty search_path, executable by authenticated only');

-- P41: the InitPlan and the indexes, on a volume fixture. 500 posts of A, older than every post
-- above, interleaved across the open C_open, the locked C_one and no community, then ANALYZEd.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, community_id, created_at)
select ('18f00000' || lpad(to_hex(g), 24, '0'))::uuid,
       '18000000-0000-4000-8000-000000000001',
       '18000000-0000-4000-8000-000000000002',
       'volume ' || g,
       case g % 3 when 0 then null
                  when 1 then '18000000-0000-4000-8000-0000000000c0'::uuid
                  else '18000000-0000-4000-8000-0000000000c1'::uuid end,
       now() - interval '6 hours' - (g || ' minutes')::interval
  from generate_series(1, 500) g;
analyze public.feed_posts;

-- EXPLAIN cannot be a subquery, and M1's lane cannot write a temp table the migration role owns, so
-- the plans travel out of the lane through transaction-local settings.
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000004');
do $$
declare
  v_plan text;
  v_line text;
begin
  -- The member-lane MERGED feed exactly as `listFeed` shapes it: no tenant predicate (RLS adds
  -- it), the `NOT_LOCKED` predicate with the kernel fragment verbatim, the keyset order and limit.
  v_plan := '';
  for v_line in execute
    'explain select p.id, p.created_at from public.feed_posts p
      where p.deleted_at is null
        and (p.community_id is null
             or p.community_id <> all (coalesce((select app.community_locked_ids()), ''{}''::uuid[])))
      order by p.created_at desc, p.id desc limit 11'
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  perform set_config('tests.plan_merged', v_plan, true);

  -- The community page of the OPEN C_open (the predicate `listCommunityFeed` pages on).
  v_plan := '';
  for v_line in execute
    'explain select p.id, p.created_at from public.feed_posts p
      where p.deleted_at is null
        and p.community_id = ''18000000-0000-4000-8000-0000000000c0''
      order by p.created_at desc, p.id desc limit 11'
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  perform set_config('tests.plan_community', v_plan, true);
end
$$;
reset role;
select matches(current_setting('tests.plan_merged'), 'InitPlan',
  'P41: the member-lane merged feed evaluates the gate as an InitPlan (once per statement, never per row)');
select matches(current_setting('tests.plan_merged'), 'feed_posts_tenant_created_all_idx',
  'P41: …and still walks feed_posts_tenant_created_all_idx (D-73''s index)');
select doesnt_match(current_setting('tests.plan_merged'), 'Seq Scan on feed_posts',
  'P41: …and never sequentially scans feed_posts');
select matches(current_setting('tests.plan_community'), 'feed_posts_tenant_community_created_idx',
  'P41: the member-lane community page still walks feed_posts_tenant_community_created_idx');

-- ── 8. grant and revoke (08.2-06, D-359, D-360, STORE-09, STORE-20; T-08.2-06, T-08.2-07, T-08.2-12) ─
-- Fresh fixtures, as the migration role: M3 (active), M4 (blocked) and M5 (removed) members of A with
-- fixed membership ids; the shared identity T (section 9) is `member` of A and of B; B gets an admin.
-- P_g (…a5) is granted, P_r (…a6) is bought and revoked.
reset role;
select tests.auth_user('m3@store-a.local', '18000000-0000-4000-8000-000000000006');
select tests.auth_user('m4@store-a.local', '18000000-0000-4000-8000-000000000007');
select tests.auth_user('m5@store-a.local', '18000000-0000-4000-8000-000000000008');
select tests.auth_user('admin@store-b.local', '18000000-0000-4000-8000-000000000013');
select tests.auth_user('t@store-ab.local', '18000000-0000-4000-8000-000000000020');
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at) values
  ('18000000-0000-4000-8000-0000000008a3', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000006', 'member', 'active', null, null),
  ('18000000-0000-4000-8000-0000000008a4', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000007', 'member', 'blocked', now(), null),
  ('18000000-0000-4000-8000-0000000008a5', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000008', 'member', 'active', null, now()),
  ('18000000-0000-4000-8000-0000000008a0', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000020', 'member', 'active', null, null),
  ('18000000-0000-4000-8000-0000000008b0', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000020', 'member', 'active', null, null),
  ('18000000-0000-4000-8000-0000000008b3', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000013', 'admin_tenant', 'active', null, null);
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Concedido', 700, 'active'),
  ('18000000-0000-4000-8000-0000000000a6', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Revogado', 900, 'active');

-- The admin lane of A.
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select outcome, entitlement_id is not null from app.store_grant('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000008a3') $$,
  $$ values ('granted'::text, true) $$,
  'store_grant in the admin lane: granted, with the new entitlement id');
select results_eq(
  $$ select user_id::text, source, status, order_id is null, granted_by_user_id::text from public.store_entitlements
      where product_id = '18000000-0000-4000-8000-0000000000a5' $$,
  $$ values ('18000000-0000-4000-8000-000000000006'::text, 'grant'::text, 'active'::text, true, '18000000-0000-4000-8000-000000000002'::text) $$,
  '…an entitlement source grant, no order, granted by the calling admin (D-360)');
select results_eq(
  $$ select g.outcome, g.entitlement_id = e.id
       from app.store_grant('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000008a3') g
       join public.store_entitlements e on e.product_id = '18000000-0000-4000-8000-0000000000a5' and e.status = 'active' $$,
  $$ values ('already_active'::text, true) $$,
  'store_grant again: already_active, answering the active entitlement (P34)');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000008b0') $$,
  ARRAY['not_found'], 'a membership of tenant B (T''s B membership): not_found (T-08.2-06)');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000008a4') $$,
  ARRAY['not_found'], 'a blocked membership: not_found');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000008a5') $$,
  ARRAY['not_found'], 'a removed (soft-deleted) membership: not_found');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000b1', '18000000-0000-4000-8000-0000000008a3') $$,
  ARRAY['not_found'], 'a product of tenant B: not_found');
reset role;
select results_eq(
  $$ select count(*)::int from public.store_entitlements
      where product_id in ('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000000b1')
        and user_id <> '18000000-0000-4000-8000-000000000012' $$,
  ARRAY[1], '…and none of the refusals wrote an entitlement (only M3''s grant exists)');

-- The support_tenant and member lanes call the definers directly: forbidden, nothing written (T-08.2-12).
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a6', '18000000-0000-4000-8000-0000000008a3') $$,
  ARRAY['forbidden'], 'support_tenant lane: store_grant is forbidden');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', null);
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a6', '18000000-0000-4000-8000-0000000008a3') $$,
  ARRAY['forbidden'], 'a null tenant_role claim for an admin USER: store_grant is forbidden (the claim decides, fails closed)');
reset role;
select set_config('tests.grant_a5',
  (select id::text from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a5' and status = 'active'), true);
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq(
  format($$ select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a5', %L) $$, current_setting('tests.grant_a5')),
  ARRAY['forbidden'], 'support_tenant lane: store_revoke of a real entitlement is forbidden');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000006');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a6', '18000000-0000-4000-8000-0000000008a3') $$,
  ARRAY['forbidden'], 'member lane: a member granting itself is forbidden');
select results_eq(
  format($$ select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a5', %L) $$, current_setting('tests.grant_a5')),
  ARRAY['forbidden'], 'member lane: store_revoke is forbidden');
reset role;
select results_eq(
  $$ select (select count(*)::int from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a6'),
            (select status from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a5') $$,
  $$ values (0, 'active'::text) $$,
  '…and neither lane wrote or revoked anything');

-- Revoke a purchase (D-359): M3 buys P_r in its lane, the admin revokes it.
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000006');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a6', 900) $$,
  ARRAY['purchased'], 'M3 buys P_r');
reset role;
select set_config('tests.buy_a6',
  (select id::text from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a6' and status = 'active'), true);
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  format($$ select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a5', %L) $$, current_setting('tests.buy_a6')),
  ARRAY['not_found'], 'store_revoke with ANOTHER product id in the call: not_found (no IDOR, T-08.2-07)');
select results_eq(
  format($$ select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a6', %L) $$, current_setting('tests.buy_a6')),
  ARRAY['revoked'], 'store_revoke of the purchase: revoked');
select results_eq(
  $$ select e.status, e.revoked_at is not null, e.revoked_by_user_id::text, o.status, o.revoked_at is not null, o.revoked_by_user_id::text
       from public.store_entitlements e join public.store_orders o on o.id = e.order_id
      where e.product_id = '18000000-0000-4000-8000-0000000000a6' $$,
  $$ values ('revoked'::text, true, '18000000-0000-4000-8000-000000000002'::text, 'revoked'::text, true, '18000000-0000-4000-8000-000000000002'::text) $$,
  '…the entitlement AND its order are revoked, stamped with the admin, and kept as history (STORE-09)');
select results_eq(
  format($$ select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a6', %L) $$, current_setting('tests.buy_a6')),
  ARRAY['not_found'], 'store_revoke twice: not_found');
select results_eq(
  format($$ select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a5', %L) $$, current_setting('tests.grant_a5')),
  ARRAY['revoked'], 'store_revoke of a grant: revoked');
select results_eq(
  $$ select count(*)::int from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a5' $$,
  ARRAY[0], '…and a grant revoke touches no order');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000006');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a6', 900) $$,
  ARRAY['purchased'], 'after the revoke M3 may buy P_r again (both arbiters are free)');
reset role;
select results_eq(
  $$ select (select count(*)::int from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a6'),
            (select count(*)::int from public.store_orders where product_id = '18000000-0000-4000-8000-0000000000a6' and status = 'paid'),
            (select count(*)::int from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a6'),
            (select count(*)::int from public.store_entitlements where product_id = '18000000-0000-4000-8000-0000000000a6' and status = 'active') $$,
  $$ values (2, 1, 2, 1) $$,
  '…a NEW order and a NEW entitlement beside the revoked ones (D-359)');
select tests.as_tenant_without_claims();
select results_eq(
  $$ select (select outcome from app.store_grant('18000000-0000-4000-8000-0000000000a5', '18000000-0000-4000-8000-0000000008a3')),
            (select outcome from app.store_revoke('18000000-0000-4000-8000-0000000000a6', '18000000-0000-4000-8000-0000000000d1')) $$,
  $$ values ('not_found'::text, 'not_found'::text) $$,
  'no claims: both definers answer not_found');
reset role;
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('app.store_grant(uuid, uuid)'::regprocedure, 'app.store_revoke(uuid, uuid)'::regprocedure)),
  'store_grant and store_revoke are SECURITY DEFINER with an empty search_path');
select ok(
  has_function_privilege('authenticated', 'app.store_grant(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.store_revoke(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.store_grant(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.store_revoke(uuid, uuid)', 'execute'),
  '…executable by authenticated and not by anon');

-- ── 9. the shared identity T (D-309, STORE-21; P70, P71) ───────────────────────────────────────
-- T is `member` of A and of B. Each tenant has the store ON and a locked community with the SAME
-- name and the SAME two captions (P70): only ids tell them apart. T buys A's product in A's lane.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('18000000-0000-4000-8000-000000000011', 'store', true);
insert into public.communities (id, tenant_id, created_by_user_id, name, slug) values
  ('18000000-0000-4000-8000-0000000000ca', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Exclusiva', 'exclusiva'),
  ('18000000-0000-4000-8000-0000000000cb', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000013', 'Exclusiva', 'exclusiva');
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('18000000-0000-4000-8000-0000000000a7', '18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000002', 'Exclusiva', 1500, 'active'),
  ('18000000-0000-4000-8000-0000000000b2', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000013', 'Exclusiva', 1500, 'active'),
  ('18000000-0000-4000-8000-0000000000b3', '18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000013', 'Avulso', 300, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id) values
  ('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-0000000000a7', '18000000-0000-4000-8000-0000000000ca'),
  ('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-0000000000b2', '18000000-0000-4000-8000-0000000000cb');
insert into public.feed_posts (id, tenant_id, caption, author_user_id, community_id, created_at) values
  ('18000000-0000-4000-8000-000000000ba1', '18000000-0000-4000-8000-000000000001', 'exclusivo antigo', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000ca', now() - interval '2 hours'),
  ('18000000-0000-4000-8000-000000000ba2', '18000000-0000-4000-8000-000000000001', 'exclusivo novo', '18000000-0000-4000-8000-000000000002', '18000000-0000-4000-8000-0000000000ca', now() - interval '1 hour'),
  ('18000000-0000-4000-8000-000000000bb2', '18000000-0000-4000-8000-000000000011', 'exclusivo antigo', '18000000-0000-4000-8000-000000000013', '18000000-0000-4000-8000-0000000000cb', now() - interval '2 hours'),
  ('18000000-0000-4000-8000-000000000bb3', '18000000-0000-4000-8000-000000000011', 'exclusivo novo', '18000000-0000-4000-8000-000000000013', '18000000-0000-4000-8000-0000000000cb', now() - interval '1 hour');

select tests.as_tenant('18000000-0000-4000-8000-000000000001', '18000000-0000-4000-8000-000000000020');
select results_eq(
  $$ select outcome from app.store_purchase('18000000-0000-4000-8000-0000000000a7', 1500) $$,
  ARRAY['purchased'], 'T buys A''s product in A''s lane');
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000ca' order by created_at desc, id desc $$,
  ARRAY['18000000-0000-4000-8000-000000000ba2', '18000000-0000-4000-8000-000000000ba1'],
  'T''s A lane: A''s exclusive community is open, both posts (P70)');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000020');
select ok('18000000-0000-4000-8000-0000000000cb'::uuid = any (app.community_locked_ids()),
  'T''s B lane: B''s community with the same name stays LOCKED (D-309)');
select results_eq(
  $$ select id::text from public.feed_posts
      where community_id in ('18000000-0000-4000-8000-0000000000ca', '18000000-0000-4000-8000-0000000000cb')
      order by created_at desc, id desc $$,
  ARRAY['18000000-0000-4000-8000-000000000bb3'],
  'T''s B lane: only B''s sample (its newest post); no post of A''s community, despite identical captions (P70)');
select results_eq(
  $$ select (select count(*)::int from public.store_orders), (select count(*)::int from public.store_entitlements) $$,
  $$ values (0, 0) $$,
  'T''s B lane: T''s A order and entitlement are invisible (T holds nothing in B)');
reset role;
select tests.as_tenant('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000013', 'admin_tenant');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000b2', '18000000-0000-4000-8000-0000000008a0') $$,
  ARRAY['not_found'], 'B''s admin lane: granting with T''s A membership id is not_found (T-08.2-06, SC 8)');
select results_eq(
  $$ select outcome from app.store_grant('18000000-0000-4000-8000-0000000000b3', '18000000-0000-4000-8000-0000000008b0') $$,
  ARRAY['granted'], 'positive control: B''s admin grants an unlinked B product to T''s B membership');
select results_eq(
  $$ select count(*)::int, bool_and(e.tenant_id = '18000000-0000-4000-8000-000000000011' and e.product_id = '18000000-0000-4000-8000-0000000000b3')
       from public.store_entitlements e where e.user_id = '18000000-0000-4000-8000-000000000020' $$,
  $$ values (1, true) $$,
  '…B''s admin lane sees exactly that one entitlement of T, none from A');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '18000000-0000-4000-8000-000000000011' and module_key = 'store';
select tests.as_tenant('18000000-0000-4000-8000-000000000011', '18000000-0000-4000-8000-000000000020');
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '18000000-0000-4000-8000-0000000000cb' order by created_at desc, id desc $$,
  ARRAY['18000000-0000-4000-8000-000000000bb3', '18000000-0000-4000-8000-000000000bb2'],
  'P71: with the store OFF in B, T reads every B post exactly as before the phase');
select is(app.community_locked_ids(), '{}'::uuid[],
  'P71: …and nothing is locked for T in B (A''s entitlement is irrelevant there)');
reset role;

select * from finish();
rollback;
