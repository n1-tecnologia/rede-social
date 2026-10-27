begin;
-- 112-community-soft-delete.sql — a SOFT-DELETED community's publications leave the feed, as the
-- facts only the database can prove (09.3-06, PEND-05, PEND-13, D-555, D-556). The integration file
-- `feed-community-delete.test.ts` proves every route end to end; this file owns the definer, the
-- RESTRICTIVE policy `feed_posts_deleted_community_gate`, the 403 trap and the cross-tenant negatives.
--
-- 1. THE DEFINER. `app.community_deleted_ids()` is SECURITY DEFINER with an empty `search_path`,
--    executable by `authenticated` and not by `anon`.
--
-- 2. THE SET, PER TENANT (T-09.3-33, T-09.3-37). In A's lane it is exactly A's two deleted
--    communities, in B's lane exactly B's one, '{}' for a tenant with none and for a lane with no
--    claims: A never sees B's id and B never sees A's.
--
-- 3. THE POLICY exists: RESTRICTIVE, SELECT, `authenticated`.
--
-- 4. THE POSTS, per lane: a member without the product, a member who HOLDS the product of a deleted
--    community, the admin and tenant B's admin read the organisation post, the live community's posts
--    and (by the store gate) what they read today, and NO post of a deleted community. B's lane
--    reads its own non-deleted post (positive control) and none of A's. Positive controls run
--    BEFORE the soft delete (the entitled member reads the community's posts).
--
-- 5. COMMENTS AND LIKES. A comment of a hidden post is invisible to a member and to the admin (the
--    comments gate tests the post through an inner `exists`); `insert into feed_likes` for the
--    hidden post or for that comment raises 42501; a like on a live post succeeds.
--
-- 6. THE 403 TRAP (T-09.3-32). `app.feed_locked_post_community` answered the community id for a
--    deleted community that an ARCHIVED product still links (it stays in `community_locked_ids()`);
--    with the new `not exists` it answers null, so the route ends in the bare 404. The answer for a
--    live locked community is unchanged (positive control).
--
-- 7. CROSS-TENANT WRITE. A lane of B updating A's community `deleted_at` touches zero rows.
--
-- 8. RECOVERY (D-556). Clearing `deleted_at` brings the posts, the comment and the set back.
--
-- 9. NOTHING IS ERASED. The counts of posts, comments and likes of the deleted community, and the
--    posts' counters, are identical before and after the soft delete.
--
-- Fixture ids use the `11200000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(30);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-del-a', 'Exclusao A', '11200000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-del-b', 'Exclusao B', '11200000-0000-4000-8000-000000000011');
select tests.tenant('pgtap-del-c', 'Exclusao C', '11200000-0000-4000-8000-000000000021');
select tests.auth_user('admin@del-a.local', '11200000-0000-4000-8000-000000000002');
select tests.auth_user('m1@del-a.local', '11200000-0000-4000-8000-000000000004');
select tests.auth_user('m2@del-a.local', '11200000-0000-4000-8000-000000000005');
select tests.auth_user('admin@del-b.local', '11200000-0000-4000-8000-000000000012');
select tests.auth_user('m@del-c.local', '11200000-0000-4000-8000-000000000022');
select tests.member('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004');
select tests.member('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000005');
select tests.member('11200000-0000-4000-8000-000000000011', '11200000-0000-4000-8000-000000000012', 'admin_tenant');
select tests.member('11200000-0000-4000-8000-000000000021', '11200000-0000-4000-8000-000000000022');

-- The store is ON for A only.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('11200000-0000-4000-8000-000000000001', 'store', true);

-- Communities of A: C_live (c1, no link), C_gone (c2, active product a1), C_gone2 (c3, only the
-- ARCHIVED product a2), C_locked (c4, active product a3, never deleted). B_gone (cb) belongs to B.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug) values
  ('11200000-0000-4000-8000-0000000000c1', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'Viva', 'viva'),
  ('11200000-0000-4000-8000-0000000000c2', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'Apagada', 'apagada'),
  ('11200000-0000-4000-8000-0000000000c3', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'Apagada dois', 'apagada-dois'),
  ('11200000-0000-4000-8000-0000000000c4', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'Trancada', 'trancada'),
  ('11200000-0000-4000-8000-0000000000cb', '11200000-0000-4000-8000-000000000011', '11200000-0000-4000-8000-000000000012', 'Apagada de B', 'apagada-b');

insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('11200000-0000-4000-8000-0000000000a1', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'P1', 1990, 'active'),
  ('11200000-0000-4000-8000-0000000000a2', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'P2', 500, 'archived'),
  ('11200000-0000-4000-8000-0000000000a3', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'P3', 700, 'active');
insert into public.store_product_communities (tenant_id, product_id, community_id) values
  ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-0000000000a1', '11200000-0000-4000-8000-0000000000c2'),
  ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-0000000000a2', '11200000-0000-4000-8000-0000000000c3'),
  ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-0000000000a3', '11200000-0000-4000-8000-0000000000c4');

-- Posts: an organisation post, one in C_live, an OLDER and a NEWER (the sample) in each of C_gone,
-- C_gone2 and C_locked, one in B_gone and one organisation post of B.
insert into public.feed_posts (id, tenant_id, caption, author_user_id, community_id, created_at) values
  ('11200000-0000-4000-8000-000000000b00', '11200000-0000-4000-8000-000000000001', 'geral', '11200000-0000-4000-8000-000000000002', null, now()),
  ('11200000-0000-4000-8000-000000000b01', '11200000-0000-4000-8000-000000000001', 'viva', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c1', now()),
  ('11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000001', 'apagada-antiga', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c2', now() - interval '2 hours'),
  ('11200000-0000-4000-8000-000000000b12', '11200000-0000-4000-8000-000000000001', 'apagada-nova', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c2', now() - interval '1 hour'),
  ('11200000-0000-4000-8000-000000000b21', '11200000-0000-4000-8000-000000000001', 'apagada2-antiga', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c3', now() - interval '2 hours'),
  ('11200000-0000-4000-8000-000000000b22', '11200000-0000-4000-8000-000000000001', 'apagada2-nova', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c3', now() - interval '1 hour'),
  ('11200000-0000-4000-8000-000000000b31', '11200000-0000-4000-8000-000000000001', 'trancada-antiga', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c4', now() - interval '2 hours'),
  ('11200000-0000-4000-8000-000000000b32', '11200000-0000-4000-8000-000000000001', 'trancada-nova', '11200000-0000-4000-8000-000000000002', '11200000-0000-4000-8000-0000000000c4', now() - interval '1 hour'),
  ('11200000-0000-4000-8000-000000000bb1', '11200000-0000-4000-8000-000000000011', 'b-apagada', '11200000-0000-4000-8000-000000000012', '11200000-0000-4000-8000-0000000000cb', now()),
  ('11200000-0000-4000-8000-000000000bb2', '11200000-0000-4000-8000-000000000011', 'b-geral', '11200000-0000-4000-8000-000000000012', null, now());

-- A comment on a C_gone post (root, by the admin), a comment on the live post, and M1's like on a
-- C_gone post: the rows that must survive the delete.
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  ('11200000-0000-4000-8000-000000000c71', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000b11',
   '11200000-0000-4000-8000-000000000002', 'raiz da apagada', 0, null, null, null),
  ('11200000-0000-4000-8000-000000000c72', '11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000b01',
   '11200000-0000-4000-8000-000000000002', 'raiz da viva', 0, null, null, null);
insert into public.feed_likes (tenant_id, user_id, post_id) values
  ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004', '11200000-0000-4000-8000-000000000b11');

-- M2 holds P1 (opens C_gone) and P3 (opens C_locked); written as the service lane.
select tests.as_service();
insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000005', '11200000-0000-4000-8000-0000000000a1', 'grant', '11200000-0000-4000-8000-000000000002'),
  ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000005', '11200000-0000-4000-8000-0000000000a3', 'grant', '11200000-0000-4000-8000-000000000002');
reset role;

-- What the soft delete must not change (section 9), captured before it.
create temp table before_counts as
select (select count(*) from public.feed_posts where community_id in ('11200000-0000-4000-8000-0000000000c2', '11200000-0000-4000-8000-0000000000c3'))::int as posts,
       (select count(*) from public.feed_comments where post_id in ('11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000b21'))::int as comments,
       (select count(*) from public.feed_likes where post_id in ('11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000b21'))::int as likes,
       (select like_count from public.feed_posts where id = '11200000-0000-4000-8000-000000000b11') as like_count,
       (select comment_count from public.feed_posts where id = '11200000-0000-4000-8000-000000000b11') as comment_count;
grant select on before_counts to public;

-- ── positive controls, BEFORE the soft delete ──────────────────────────────────────────────────
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000005');
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '11200000-0000-4000-8000-0000000000c2' order by id $$,
  ARRAY['11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000b12'],
  'before: M2, who holds P1, reads both posts of C_gone');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004');
select is(app.feed_locked_post_community('11200000-0000-4000-8000-000000000b21'), '11200000-0000-4000-8000-0000000000c3'::uuid,
  'before: the OLDER post of C_gone2 answers C_gone2 (locked through the archived product), the 403 the fix removes');
select is(app.feed_locked_post_community('11200000-0000-4000-8000-000000000b11'), '11200000-0000-4000-8000-0000000000c2'::uuid,
  'before: the OLDER post of C_gone answers C_gone (locked through the active product)');
reset role;

-- ── the soft delete (as the migration role) ────────────────────────────────────────────────────
update public.communities set deleted_at = now()
 where id in ('11200000-0000-4000-8000-0000000000c2', '11200000-0000-4000-8000-0000000000c3',
              '11200000-0000-4000-8000-0000000000cb');

-- ── 1. the definer ─────────────────────────────────────────────────────────────────────────────
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'app.community_deleted_ids()'::regprocedure)
  and has_function_privilege('authenticated', 'app.community_deleted_ids()', 'execute')
  and not has_function_privilege('anon', 'app.community_deleted_ids()', 'execute'),
  'community_deleted_ids: SECURITY DEFINER, empty search_path, executable by authenticated only');

-- ── 2. the set, per tenant ─────────────────────────────────────────────────────────────────────
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004');
select is(array(select unnest(app.community_deleted_ids()) order by 1),
  array['11200000-0000-4000-8000-0000000000c2', '11200000-0000-4000-8000-0000000000c3']::uuid[],
  'A''s lane: exactly A''s two deleted communities, never B''s');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000011', '11200000-0000-4000-8000-000000000012', 'admin_tenant');
select is(array(select unnest(app.community_deleted_ids()) order by 1),
  array['11200000-0000-4000-8000-0000000000cb']::uuid[],
  'B''s lane: exactly B''s deleted community, never A''s');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000021', '11200000-0000-4000-8000-000000000022');
select is(app.community_deleted_ids(), '{}'::uuid[], 'a tenant with no deleted community gets the empty set');
reset role;
select tests.as_tenant_without_claims();
select is(app.community_deleted_ids(), '{}'::uuid[], 'a lane with no claims gets the empty set');
reset role;

-- ── 3. the policy ──────────────────────────────────────────────────────────────────────────────
select is(
  (select permissive || '/' || cmd || '/' || roles::text from pg_policies
    where schemaname = 'public' and tablename = 'feed_posts' and policyname = 'feed_posts_deleted_community_gate'),
  'RESTRICTIVE/SELECT/{authenticated}',
  'feed_posts_deleted_community_gate is a RESTRICTIVE select policy for authenticated');

-- ── 4. the posts, per lane ─────────────────────────────────────────────────────────────────────
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004');
select results_eq(
  $$ select id::text from public.feed_posts where id::text like '11200000-%' order by id $$,
  ARRAY['11200000-0000-4000-8000-000000000b00', '11200000-0000-4000-8000-000000000b01', '11200000-0000-4000-8000-000000000b32'],
  'M1 (no product): the organisation post, the live post and the locked sample, NO post of a deleted community');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000005');
select results_eq(
  $$ select id::text from public.feed_posts where id::text like '11200000-%' order by id $$,
  ARRAY['11200000-0000-4000-8000-000000000b00', '11200000-0000-4000-8000-000000000b01',
        '11200000-0000-4000-8000-000000000b31', '11200000-0000-4000-8000-000000000b32'],
  'M2 (holds P1): still no post of C_gone although its product is held; C_locked is open for M2');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select id::text from public.feed_posts where id::text like '11200000-%' order by id $$,
  ARRAY['11200000-0000-4000-8000-000000000b00', '11200000-0000-4000-8000-000000000b01',
        '11200000-0000-4000-8000-000000000b31', '11200000-0000-4000-8000-000000000b32'],
  'the admin lane of A: every live post, none of a deleted community');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000011', '11200000-0000-4000-8000-000000000012', 'admin_tenant');
select results_eq(
  $$ select id::text from public.feed_posts where id::text like '11200000-%' order by id $$,
  ARRAY['11200000-0000-4000-8000-000000000bb2'],
  'the admin lane of B: its own non-deleted post only (B''s deleted community and all of A hidden)');
reset role;

-- ── 5. comments and likes ──────────────────────────────────────────────────────────────────────
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004');
select is_empty(
  $$ select 1 from public.feed_comments where id = '11200000-0000-4000-8000-000000000c71' $$,
  'M1: the comment of a deleted community''s post is invisible');
select results_eq(
  $$ select count(*)::int from public.feed_comments where id = '11200000-0000-4000-8000-000000000c72' $$,
  ARRAY[1], 'M1: the comment of the live post stays visible (positive control)');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004', '11200000-0000-4000-8000-000000000b12') $$,
  '42501', null, 'M1: a like on a post of a deleted community raises 42501');
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004', '11200000-0000-4000-8000-000000000c71', 'post') $$,
  '42501', null, 'M1: a like on the comment of a deleted community''s post raises 42501');
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004', '11200000-0000-4000-8000-000000000b01') $$,
  'M1: a like on a live post still succeeds');
reset role;
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000002', 'admin_tenant');
select is_empty(
  $$ select 1 from public.feed_comments where id = '11200000-0000-4000-8000-000000000c71' $$,
  'the admin lane: the comment of a deleted community''s post is invisible too');
reset role;

-- ── 6. the 403 trap ────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000004');
select ok('11200000-0000-4000-8000-0000000000c3'::uuid = any (app.community_locked_ids()),
  'C_gone2 is still in M1''s locked set through the archived product (the trap the definer fix covers)');
select is(app.feed_locked_post_community('11200000-0000-4000-8000-000000000b21'), null::uuid,
  'the OLDER post of deleted C_gone2 answers null (the bare 404), not C_gone2');
select is(app.feed_locked_post_community('11200000-0000-4000-8000-000000000b22'), null::uuid,
  'the NEWER post of deleted C_gone2 answers null');
select is(app.feed_locked_post_community('11200000-0000-4000-8000-000000000b11'), null::uuid,
  'the OLDER post of deleted C_gone (active product) answers null');
select is(app.feed_locked_post_community('11200000-0000-4000-8000-000000000b31'), '11200000-0000-4000-8000-0000000000c4'::uuid,
  'positive control: the hidden post of the LIVE locked C_locked still answers C_locked');
reset role;

-- ── 7. cross-tenant write ──────────────────────────────────────────────────────────────────────
select tests.as_tenant('11200000-0000-4000-8000-000000000011', '11200000-0000-4000-8000-000000000012', 'admin_tenant');
select results_eq(
  $$ with u as (update public.communities set deleted_at = null
                 where id = '11200000-0000-4000-8000-0000000000c2' returning 1)
     select count(*)::int from u $$,
  ARRAY[0], 'B''s lane updating A''s community deleted_at touches zero rows');
reset role;
select isnt(
  (select deleted_at from public.communities where id = '11200000-0000-4000-8000-0000000000c2'), null::timestamptz,
  'A''s community is still deleted after the attempt');

-- ── 9. nothing is erased (checked at the migration role, before recovery) ──────────────────────
select results_eq(
  $$ select (select count(*) from public.feed_posts where community_id in ('11200000-0000-4000-8000-0000000000c2', '11200000-0000-4000-8000-0000000000c3'))::int,
            (select count(*) from public.feed_comments where post_id in ('11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000b21'))::int,
            (select count(*) from public.feed_likes where post_id in ('11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000b21'))::int,
            (select like_count from public.feed_posts where id = '11200000-0000-4000-8000-000000000b11'),
            (select comment_count from public.feed_posts where id = '11200000-0000-4000-8000-000000000b11') $$,
  $$ select posts, comments, likes, like_count, comment_count from before_counts $$,
  'the posts, comments, likes and counters of the deleted communities are identical after the soft delete');

-- ── 8. recovery by clearing deleted_at ─────────────────────────────────────────────────────────
update public.communities set deleted_at = null where id = '11200000-0000-4000-8000-0000000000c2';
select tests.as_tenant('11200000-0000-4000-8000-000000000001', '11200000-0000-4000-8000-000000000005');
select results_eq(
  $$ select id::text from public.feed_posts where community_id = '11200000-0000-4000-8000-0000000000c2' order by id $$,
  ARRAY['11200000-0000-4000-8000-000000000b11', '11200000-0000-4000-8000-000000000b12'],
  'recovery: clearing deleted_at shows both posts of C_gone to M2 again');
select results_eq(
  $$ select count(*)::int from public.feed_comments where id = '11200000-0000-4000-8000-000000000c71' $$,
  ARRAY[1], 'recovery: the comment is visible again');
select is(array(select unnest(app.community_deleted_ids()) order by 1),
  array['11200000-0000-4000-8000-0000000000c3']::uuid[],
  'recovery: the set shrinks to the community still deleted');
reset role;

select * from finish();
rollback;
