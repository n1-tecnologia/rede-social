begin;
-- 090-feed.sql — the ROADMAP's named Phase 4 acceptance checks, executed inside Postgres (04-03).
--
-- Four things live here that no application test can prove:
--   * the one-level reply cap is refused BY THE DATABASE on all three illegal shapes — a reply to a
--     reply (23503 on the composite self-FK), a row lying about `parent_depth`, and a row claiming
--     `depth = 2` (23514 on the shape check). The positive case (root + one reply) is asserted in
--     the SAME file, so a globally broken insert cannot make the negatives pass vacuously;
--   * "exactly one target" on both tables;
--   * the counters RECONCILE against the rows they summarise, asserted AFTER a soft delete so the
--     `deleted_at` branch of the trigger is exercised rather than assumed (Pitfall 5);
--   * the three keyset queries are INDEX SCANS against a realistically-sized fixture.
--
-- The EXPLAIN block needs `pnpm db:seed` to have run: it measures the 200-row volume fixture the
-- seed writes, because with three rows the planner always chooses a sequential scan and the
-- assertion would prove nothing. Everything else in this file builds its own fixture and, like its
-- siblings, the whole file rolls back.
select plan(20);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-feed', 'Comunidade Feed', '0c000000-0000-4000-8000-000000000001');
select tests.auth_user('feed@c.local', '0c000000-0000-4000-8000-000000000002');
select tests.auth_user('feed2@c.local', '0c000000-0000-4000-8000-000000000003');
select tests.member('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002');
select tests.member('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000003');

insert into public.feed_posts (id, tenant_id, caption, author_user_id) values
  ('0c000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-000000000001', 'p',
   '0c000000-0000-4000-8000-000000000002');

-- ── 1-5. the one reply level, enforced declaratively (FEED-05) ─────────────────────────────────
select lives_ok(
  $$ insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
     values ('0c000000-0000-4000-8000-0000000000b1', '0c000000-0000-4000-8000-000000000001',
             '0c000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-000000000002',
             'root', 0, null, null) $$,
  'positive control: a ROOT comment (depth 0, no parent) is accepted'
);
select lives_ok(
  $$ insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
     values ('0c000000-0000-4000-8000-0000000000b2', '0c000000-0000-4000-8000-000000000001',
             '0c000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-000000000003',
             'reply', 1, '0c000000-0000-4000-8000-0000000000b1', 0) $$,
  'positive control: ONE reply level (depth 1, parent_depth 0) is accepted'
);
-- The cap itself: the only (id, depth) pair a reply may name has depth 0, and a reply has depth 1.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000a1',
             '0c000000-0000-4000-8000-000000000002', 'reply to a reply', 1,
             '0c000000-0000-4000-8000-0000000000b2', 0) $$,
  '23503',
  null,
  'FEED-05: a reply to a reply is refused by feed_comments_parent_fk (23503)'
);
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000a1',
             '0c000000-0000-4000-8000-000000000002', 'lying about parent_depth', 1,
             '0c000000-0000-4000-8000-0000000000b2', 1) $$,
  '23514',
  null,
  'FEED-05: claiming parent_depth = 1 is refused by feed_comments_parent_shape_chk (23514)'
);
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000a1',
             '0c000000-0000-4000-8000-000000000002', 'depth two', 2,
             '0c000000-0000-4000-8000-0000000000b1', 0) $$,
  '23514',
  null,
  'FEED-05: depth = 2 is refused by feed_comments_parent_shape_chk (23514)'
);

-- ── 6-8. exactly one target, on both tables ────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id, comment_id)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002',
             '0c000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-0000000000b1') $$,
  '23514',
  null,
  'a like naming BOTH a post and a comment is refused (feed_likes_target_chk)'
);
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002') $$,
  '23514',
  null,
  'a like naming NO target is refused (feed_likes_target_chk)'
);
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, story_id, author_user_id, body)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000a1',
             '0c000000-0000-4000-8000-0000000000a1', '0c000000-0000-4000-8000-000000000002', 'x') $$,
  '23514',
  null,
  'a comment naming BOTH a post and a story is refused (feed_comments_target_chk) — the Phase 5 slot is exclusive'
);

-- ── 9-10. idempotency AT THE INDEX (FEED-04) ───────────────────────────────────────────────────
-- Two identical statements, exactly as the service issues them. The second inserts zero rows, fires
-- no trigger and changes no counter — which is why the API can answer 200 rather than 409.
insert into public.feed_likes (tenant_id, user_id, post_id)
values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002',
        '0c000000-0000-4000-8000-0000000000a1')
on conflict (user_id, post_id) where post_id is not null do nothing;

insert into public.feed_likes (tenant_id, user_id, post_id)
values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002',
        '0c000000-0000-4000-8000-0000000000a1')
on conflict (user_id, post_id) where post_id is not null do nothing;

select results_eq(
  $$ select count(*)::int from public.feed_likes
      where post_id = '0c000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  'FEED-04: two identical likes leave exactly ONE row — the partial unique index is the arbiter'
);
select results_eq(
  $$ select like_count from public.feed_posts where id = '0c000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  'FEED-04: …and the trigger fired exactly once, so like_count is 1 and not 2'
);

-- ── 11-14. the counters reconcile, ACROSS a soft delete (Pitfall 5) ────────────────────────────
-- The reply is removed the way D-61 removes one: an UPDATE of `deleted_at`, never a DELETE. A
-- trigger that only watched insert/delete would leave comment_count stuck at 2 here.
select results_eq(
  $$ select comment_count from public.feed_posts where id = '0c000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[2],
  'the root and its reply BOTH count toward the post''s comment_count'
);

update public.feed_comments set deleted_at = now()
 where id = '0c000000-0000-4000-8000-0000000000b2';

select results_eq(
  $$ select comment_count from public.feed_posts where id = '0c000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  'Pitfall 5: soft-deleting a comment DECREMENTS comment_count — no phantom comment'
);

-- Every post in the database, not only this file's fixture: the seeded rows went through the same
-- triggers, so a seed that wrote a counter by hand (or a trigger that did not fire) shows up here.
select is_empty(
  $$ select p.id from public.feed_posts p
      where p.comment_count <> (
              select count(*) from public.feed_comments c
               where c.post_id = p.id and c.deleted_at is null)
         or p.like_count <> (
              select count(*) from public.feed_likes l where l.post_id = p.id) $$,
  'reconciliation: every post''s like_count and comment_count equal the live rows they summarise'
);
select is_empty(
  $$ select c.id from public.feed_comments c
      where c.like_count <> (
              select count(*) from public.feed_likes l where l.comment_id = c.id) $$,
  'reconciliation: every comment''s like_count equals the live like rows it summarises'
);

-- ── 15-20. the three keyset queries are index scans ────────────────────────────────────────────
-- Captured into a temp table with `execute … into`, because EXPLAIN cannot be a subquery. The
-- predicates mirror what RLS injects (`tenant_id = app.tenant_id()`), since pg_prove connects as
-- the table owner and therefore does not have the policy applied for it.
create temporary table feed_plans (name text primary key, plan text);

do $$
declare
  v_tenant uuid;
  v_post   uuid;
  v_root   uuid;
  v_plan   text;
begin
  select id into v_tenant from public.tenants where slug = 'tria-demo';
  select c.post_id, c.parent_id into v_post, v_root
    from public.feed_comments c
   where c.tenant_id = v_tenant and c.parent_id is not null
   limit 1;
  if v_post is null then
    select id into v_post from public.feed_posts where tenant_id = v_tenant order by created_at limit 1;
  end if;

  execute format(
    'explain (format json) select p.id, p.created_at from public.feed_posts p
      where p.tenant_id = %L and p.community_id is null and p.deleted_at is null
      order by p.created_at desc, p.id desc limit 10', v_tenant) into v_plan;
  insert into feed_plans values ('feed', v_plan);

  execute format(
    'explain (format json) select c.id, c.created_at from public.feed_comments c
      where c.tenant_id = %L and c.post_id = %L and c.parent_id is null and c.deleted_at is null
      order by c.created_at desc, c.id desc limit 20', v_tenant, v_post) into v_plan;
  insert into feed_plans values ('roots', v_plan);

  execute format(
    'explain (format json) select c.id, c.created_at from public.feed_comments c
      where c.tenant_id = %L and c.parent_id = %L and c.deleted_at is null
      order by c.created_at asc, c.id asc limit 10', v_tenant, coalesce(v_root, v_post)) into v_plan;
  insert into feed_plans values ('replies', v_plan);
end
$$;

select matches(
  (select plan from feed_plans where name = 'feed'),
  'Index Scan|Index Only Scan',
  'the feed keyset page is an index scan on feed_posts'
);
select doesnt_match(
  (select plan from feed_plans where name = 'feed'),
  'Seq Scan on feed_posts',
  '…and never a sequential scan of feed_posts'
);
select matches(
  (select plan from feed_plans where name = 'roots'),
  'Index Scan|Index Only Scan',
  'the root-comment keyset page is an index scan on feed_comments'
);
select doesnt_match(
  (select plan from feed_plans where name = 'roots'),
  'Seq Scan on feed_comments',
  '…and never a sequential scan of feed_comments'
);
select matches(
  (select plan from feed_plans where name = 'replies'),
  'Index Scan|Index Only Scan',
  'the reply keyset page is an index scan on feed_comments'
);
select doesnt_match(
  (select plan from feed_plans where name = 'replies'),
  'Seq Scan on feed_comments',
  '…and never a sequential scan of feed_comments'
);

select * from finish();
rollback;
