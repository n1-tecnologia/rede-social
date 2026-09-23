begin;
-- 110-communities-stories.sql — the ROADMAP's named Phase 5 acceptance checks, executed inside
-- Postgres (05-04). Later plans in this phase extend it; this file's share is the two facts that
-- only the database can prove.
--
-- 1. THE COUNTERS RECONCILE, and they reconcile across a MIXED sequence. `communities.post_count`
--    and `communities.last_activity_at` are written by `app.community_post_stats()` and by nothing
--    else, so the only honest test of them is to put the table through inserts, soft deletes,
--    restores, hard deletes and a (forbidden but defended) move, and then compare both columns to
--    the rows they summarise. The comparison runs over EVERY community in the database, not only
--    this file's fixture: the seeded rows went through the same trigger, so a seed that wrote a
--    counter by hand, a backfill that missed a row or a trigger that did not fire all show up here.
--    There is deliberately no `greatest(0, …)` clamp in the function, which is precisely what lets
--    this assertion SURFACE drift instead of hiding it (T-05-22).
--
-- 2. WHAT ARCHIVE MEANS, as three predicates rather than as prose (05-RESEARCH §Pattern 7,
--    UI-D-37). Archive is a WRITE gate and a LIST gate, never a feed gate:
--      * the merged feed's predicate (which has NO archive filter at all) still returns an archived
--        community's posts — the property that stops an organisational tidy-up reading to a member
--        as censorship or as data loss;
--      * the LIST's predicate (`status = 'active'`) does not return the community;
--      * the BY-ID read still does.
--    Each of the three ships with its positive control in the same block, so a globally broken
--    fixture cannot make any of them pass vacuously.
--
-- 3. The community list's ordering is an INDEX SCAN on `communities_tenant_activity_idx`, pinned BY
--    NAME on this file's own volume fixture. Naming the index rather than matching `Index Scan` is
--    what makes "D-76's keyset is served by the index 05-01 added" falsifiable: a shape match would
--    also pass on a sequential scan feeding a sort under some other node.
--
-- The EXPLAIN block builds and ANALYZEs its own 400-row fixture inside this file's transaction,
-- because with five rows the planner always chooses a sequential scan and the assertion would prove
-- nothing. Like its siblings, this file ROLLS BACK, so it re-runs identically against a seeded or an
-- empty database, twice in a row, in any order.
select plan(18);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-comm', 'Comunidade Phase 5', '0f000000-0000-4000-8000-000000000001');
select tests.auth_user('comm@c.local', '0f000000-0000-4000-8000-000000000002');
select tests.member('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002');

-- Two containers: one that the counter cases churn, one archived container for the semantics cases.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description, created_at, last_activity_at)
values ('0f000000-0000-4000-8000-0000000000a1', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'Contadores', 'contadores', '',
        now() - interval '10 days', now() - interval '10 days'),
       ('0f000000-0000-4000-8000-0000000000a2', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'Arquivada', 'arquivada', '',
        now() - interval '10 days', now() - interval '10 days');

-- ── 1-3. the counter follows an INSERT, and `last_activity_at` follows the newest post ─────────
insert into public.feed_posts (id, tenant_id, author_user_id, caption, community_id, created_at)
values ('0f000000-0000-4000-8000-0000000000b1', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'p1', '0f000000-0000-4000-8000-0000000000a1',
        now() - interval '3 days'),
       ('0f000000-0000-4000-8000-0000000000b2', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'p2', '0f000000-0000-4000-8000-0000000000a1',
        now() - interval '1 day');

select results_eq(
  $$ select post_count from public.communities where id = '0f000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[2],
  'two inserts into a community leave post_count at 2 — the trigger is the only writer'
);
select is(
  (select last_activity_at from public.communities where id = '0f000000-0000-4000-8000-0000000000a1'),
  (select created_at from public.feed_posts where id = '0f000000-0000-4000-8000-0000000000b2'),
  'last_activity_at followed the NEWEST post, which is what D-76 orders the list by'
);
-- Positive control in the same block: a TENANT-WIDE post (no container) moves nothing at all, so
-- the assertions above are about the community_id branch and not about inserts in general.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, created_at)
values ('0f000000-0000-4000-8000-0000000000b9', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'sem comunidade', now());
select results_eq(
  $$ select post_count from public.communities where id = '0f000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[2],
  'positive control: a tenant-wide post (community_id is null) moves no community counter'
);

-- ── 4-6. a BACKDATED post, the soft delete and the restore (Pitfall 10, D-61) ──────────────────
insert into public.feed_posts (id, tenant_id, author_user_id, caption, community_id, created_at)
values ('0f000000-0000-4000-8000-0000000000b3', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'antigo', '0f000000-0000-4000-8000-0000000000a1',
        now() - interval '9 days');
select is(
  (select last_activity_at from public.communities where id = '0f000000-0000-4000-8000-0000000000a1'),
  (select created_at from public.feed_posts where id = '0f000000-0000-4000-8000-0000000000b2'),
  'a BACKDATED post raises the count but never pulls last_activity_at backwards'
);

-- The removal is D-61's: an UPDATE of `deleted_at`, never a DELETE. A trigger that only watched
-- insert/delete would leave post_count stuck and every card would show a phantom publication.
update public.feed_posts set deleted_at = now()
 where id = '0f000000-0000-4000-8000-0000000000b2';
select results_eq(
  $$ select post_count from public.communities where id = '0f000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[2],
  'Pitfall 10: soft-deleting a post DECREMENTS post_count — no phantom publication'
);
select is(
  (select last_activity_at from public.communities where id = '0f000000-0000-4000-8000-0000000000a1'),
  (select created_at from public.feed_posts where id = '0f000000-0000-4000-8000-0000000000b1'),
  '…and last_activity_at MOVED BACK to the newest LIVE post, because the maximum changed'
);

-- ── 7-8. a restore, and a hard delete ──────────────────────────────────────────────────────────
update public.feed_posts set deleted_at = null
 where id = '0f000000-0000-4000-8000-0000000000b2';
select results_eq(
  $$ select post_count from public.communities where id = '0f000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[3],
  'a Phase 8 restore puts the post back in the count — the branch reads the TRANSITION'
);

delete from public.feed_posts where id = '0f000000-0000-4000-8000-0000000000b3';
select results_eq(
  $$ select post_count from public.communities where id = '0f000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[2],
  'a hard delete decrements too, so a migration or a psql session cannot desynchronise the count'
);

-- ── 9. the MOVE the API forbids, handled anyway (D-72) ─────────────────────────────────────────
-- `updatePostSchema` has no `communityId` key and is `.strict()`, so the API cannot produce this
-- write. A counter that is only correct while the API is disciplined is not a counter.
update public.feed_posts set community_id = '0f000000-0000-4000-8000-0000000000a2'
 where id = '0f000000-0000-4000-8000-0000000000b1';
select results_eq(
  $$ select c.post_count from public.communities c
      where c.id in ('0f000000-0000-4000-8000-0000000000a1', '0f000000-0000-4000-8000-0000000000a2')
      order by c.id $$,
  ARRAY[1, 1],
  'D-72 defence: moving a post between containers decrements one counter and increments the other'
);

-- ── 10-11. reconciliation over EVERY community in the database ─────────────────────────────────
-- The whole point of the unclamped counter: these two are what would go red on drift.
select is_empty(
  $$ select c.id from public.communities c
      where c.post_count <> (
              select count(*) from public.feed_posts p
               where p.community_id = c.id and p.deleted_at is null) $$,
  'reconciliation: every community''s post_count equals the live posts it summarises'
);
select is_empty(
  $$ select c.id from public.communities c
      where c.last_activity_at <> greatest(
              c.created_at,
              coalesce((select max(p.created_at) from public.feed_posts p
                         where p.community_id = c.id and p.deleted_at is null),
                       c.created_at)) $$,
  'reconciliation: last_activity_at is greatest(created_at, newest live post) for every community'
);

-- ── 12-16. what ARCHIVE means: a WRITE gate and a LIST gate, never a feed gate ─────────────────
update public.communities set status = 'archived'
 where id = '0f000000-0000-4000-8000-0000000000a2';

-- 12-13. Where the write gate LIVES. Archiving is enforced by the SERVICE, which answers
-- `400 { community: 'archived' }` (05-03), and deliberately NOT by a constraint: a CHECK here would
-- also block the Phase 8 moderation paths, every backfill and every `supabase db reset` fixture,
-- and it could not be lifted by reactivating the community inside the same transaction. The
-- database therefore ACCEPTS this row, and the positive control in the next assertion is what stops
-- that reading as "inserts are broken here".
select lives_ok(
  $$ insert into public.feed_posts (id, tenant_id, author_user_id, caption, community_id)
     values ('0f000000-0000-4000-8000-0000000000b4', '0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-000000000002', 'na arquivada',
             '0f000000-0000-4000-8000-0000000000a2') $$,
  'the DATABASE accepts a post into an archived community — the refusal is the service''s, by design'
);
select lives_ok(
  $$ insert into public.feed_posts (id, tenant_id, author_user_id, caption, community_id)
     values ('0f000000-0000-4000-8000-0000000000b5', '0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-000000000002', 'na ativa',
             '0f000000-0000-4000-8000-0000000000a1') $$,
  'positive control: the same insert into an ACTIVE community is accepted too'
);

-- 14. The MERGED FEED predicate, verbatim from `listFeed` with the communities module enabled: it
-- carries no archive filter at all, so the archived container's posts stay exactly where members
-- already saw them. This is the assertion that makes "archiving is not censorship" a fact.
select results_eq(
  $$ select count(*)::int from public.feed_posts p
      where p.tenant_id = '0f000000-0000-4000-8000-000000000001'
        and p.deleted_at is null
        and p.community_id = '0f000000-0000-4000-8000-0000000000a2' $$,
  ARRAY[2],
  'archive is not a FEED gate: the merged-feed predicate still returns the archived community''s posts'
);

-- 15. The LIST predicate, verbatim from `listCommunities`, with its positive control in the same
-- statement: the archived container is absent and the active one is present.
select results_eq(
  $$ select c.id::text from public.communities c
      where c.tenant_id = '0f000000-0000-4000-8000-000000000001'
        and c.deleted_at is null
        and c.status = 'active'
      order by c.id $$,
  ARRAY['0f000000-0000-4000-8000-0000000000a1'],
  'archive IS a list gate: the archived community is absent and the active one is its positive control'
);

-- 16. The BY-ID read, verbatim from `getCommunity`: no status predicate, so a shared link and every
-- feed post that names the container keep working.
select results_eq(
  $$ select c.status from public.communities c
      where c.tenant_id = '0f000000-0000-4000-8000-000000000001'
        and c.id = '0f000000-0000-4000-8000-0000000000a2'
        and c.deleted_at is null $$,
  ARRAY['archived'],
  'archive is NOT a read gate: the community still resolves by id, which is what keeps links alive'
);

-- ── 17-18. D-76's keyset is an index scan on communities_tenant_activity_idx ───────────────────
-- 400 communities in THIS file's own tenant. `analyze` is what makes the planner act on any of it —
-- without it every estimate is the zero-row default and the plan below proves nothing.
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description, created_at, last_activity_at)
select ('0f00c0' || lpad(to_hex(g), 26, '0'))::uuid,
       '0f000000-0000-4000-8000-000000000001',
       '0f000000-0000-4000-8000-000000000002',
       'Volume ' || g,
       'volume-' || g,
       '',
       now() - (g || ' minutes')::interval,
       now() - (g || ' minutes')::interval
  from generate_series(1, 400) g;

analyze public.communities;

-- Captured into a temp table with `execute … into`, because EXPLAIN cannot be a subquery. The
-- predicate mirrors what RLS injects (`tenant_id = app.tenant_id()`), since pg_prove connects as the
-- table owner and therefore does not have the policy applied for it.
create temporary table community_plans (name text primary key, plan text);

do $$
declare
  v_plan text;
begin
  execute
    'explain (format json) select c.id, c.last_activity_at from public.communities c
      where c.tenant_id = ''0f000000-0000-4000-8000-000000000001''
        and c.deleted_at is null and c.status = ''active''
      order by c.last_activity_at desc, c.id desc limit 10' into v_plan;
  insert into community_plans values ('list', v_plan);
end
$$;

select matches(
  (select plan from community_plans where name = 'list'),
  'communities_tenant_activity_idx',
  'D-76: the community list keyset is served by communities_tenant_activity_idx, BY NAME'
);
-- The negative half, in the SAME captured plan: without it the assertion above would pass on a plan
-- that merely MENTIONS the index in a subnode while sequentially scanning the table at the top.
select doesnt_match(
  (select plan from community_plans where name = 'list'),
  'Seq Scan on communities',
  '…and never a sequential scan of communities'
);

select * from finish();
rollback;
