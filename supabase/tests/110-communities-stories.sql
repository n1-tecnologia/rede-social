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
-- 4. STORY-03 IS A READ PREDICATE, proved under a clock the test controls (05-05). `now()` inside a
--    transaction is the TRANSACTION timestamp, so publishing one story 25 hours ago and one an hour
--    ago is deterministic without sleeping and without a fake clock. Three separate assertions,
--    because they are three separate claims: the strip predicate returns only the active story; the
--    EXPIRED ROW IS STILL SELECTABLE BY ID (expiry is not a delete, not a blanking and not a status
--    transition); and the ordering comes back on `expires_at desc, id desc`.
--
-- 5. `stories_expiry_window_chk` REFUSES an inverted window, with its positive control in the same
--    block. It is the invariant the generated column could not be (`timestamptz + interval` is not
--    IMMUTABLE, so Postgres rejects the generation expression outright), so it is the only thing
--    standing between a hand-written row and a story that expired before it was published.
--
-- 6. The two Phase 4 slots are REAL foreign keys now (`feed_comments_story_fk`, `feed_likes_story_fk`),
--    declared as hand-written SQL in `*_stories.sql` because a drizzle `.references()` would need a
--    module -> module package dependency `turbo boundaries` denies. Asserted in both directions.
--
-- 7. The strip's keyset is an INDEX SCAN on `stories_tenant_expires_idx`, pinned BY NAME on its own
--    volume fixture — and the SAME index serves D-84's history with the range predicate dropped,
--    which is the whole reason the read orders by `expires_at` rather than by `published_at`.
--
-- 8. STORY-05 IS A FACT INSIDE POSTGRES, not an API convention (05-07). The roadmap states twice
--    that a story comment cannot be replied to or liked; this file is where that stops being prose.
--    Every refusal is asserted TWICE — once with the row naming its target HONESTLY (refused by the
--    null-guarded shape CHECK, 23514) and once with it LYING (refused by the composite foreign key,
--    23503) — because there is no legal triple that finds a story comment either way. Each negative
--    ships its POSITIVE CONTROL in the same block: a reply to a POST comment still succeeds, a like
--    on a POST comment still succeeds, and a like on the STORY itself still succeeds, so a
--    constraint that refused everything could not pass this file.
--
-- 9. THE PITFALL-1 PROBE. A CHECK that evaluates to NULL is SATISFIED, and Phase 4's second branch
--    evaluated to NULL when `parent_depth` was null — so a depth-1 comment with a parent id and a
--    NULL parent depth INSERTED, with the composite foreign key skipped entirely (MATCH SIMPLE).
--    The identical statement is asserted to be REFUSED here and in `090-feed.sql`, which is where
--    the Phase 4 acceptance checks live.
--
-- 10. `stories.comment_count` reconciles against the rows it summarises, across a MIXED
--    insert / soft-delete / restore / hard-delete sequence — the soft delete is an UPDATE, so a
--    counter that only followed inserts and deletes would sit wrong forever (Pitfall 5/10).
--
-- 11. D-83's forward-running list is served by `feed_comments_tenant_story_root_asc_idx`, pinned BY
--    NAME and with NO SORT NODE, on its own volume fixture. The no-sort half is the claim: an
--    `Index Scan` that feeds a `Sort` would mean the ascending order is being produced in memory,
--    which is exactly the Pitfall-8 regression reusing the DESC index would cause.
--
-- The EXPLAIN block builds and ANALYZEs its own 400-row fixture inside this file's transaction,
-- because with five rows the planner always chooses a sequential scan and the assertion would prove
-- nothing. Like its siblings, this file ROLLS BACK, so it re-runs identically against a seeded or an
-- empty database, twice in a row, in any order.
select plan(47);

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

-- ══ 19-28. STORIES (05-05) ═════════════════════════════════════════════════════════════════════
-- The fixture: one media asset this tenant owns, then two stories published under a clock this
-- transaction controls. `now()` is the transaction timestamp, so both rows are placed relative to
-- the SAME instant every assertion below reads — no sleep, no fake clock, no flake.
--
-- Note what is NOT here: no job, no sweeper, no status column and no `update` anywhere. A story
-- leaves the strip because the predicate stopped matching it, which is the entirety of STORY-03.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths)
values ('0f000000-0000-4000-8000-0000000000c1', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'image', 'story', 'ready', 'image/jpeg', 1024,
        '{640,1080}');

insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                            caption, published_at, expires_at)
values ('0f000000-0000-4000-8000-0000000000e1', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-0000000000c1', 'image',
        '', now() - interval '25 hours', now() - interval '1 hour'),
       ('0f000000-0000-4000-8000-0000000000a9', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-0000000000c1', 'video',
        'ao vivo', now() - interval '1 hour', now() + interval '23 hours');

-- 19. The strip predicate, verbatim from `listActiveStories` minus the readiness join, returns the
-- ACTIVE story and only it. The expired story is the negative half and the active one the positive
-- control, in one statement, so a globally broken fixture cannot make this pass vacuously.
select results_eq(
  $$ select s.id::text from public.stories s
      where s.tenant_id = '0f000000-0000-4000-8000-000000000001'
        and s.deleted_at is null
        and s.expires_at > now()
      order by s.expires_at desc, s.id desc $$,
  ARRAY['0f000000-0000-4000-8000-0000000000a9'],
  'STORY-03: the strip predicate returns only the story whose window is still open'
);

-- 20. …and the EXPIRED ROW IS STILL THERE. This is the assertion the requirement actually turns on:
-- expiry hid the story, it did not delete it, blank it or transition it. D-84's history and 05-08's
-- pins both read this row, and the likes and comments members left on it are untouched.
select isnt_empty(
  $$ select 1 from public.stories where id = '0f000000-0000-4000-8000-0000000000e1' $$,
  'STORY-03: the expired story is HIDDEN, never deleted — the row is retained'
);

-- 21. Nothing about the expired row was rewritten either: its caption, its window and its
-- `deleted_at` are exactly what was inserted. A "tidier" implementation that blanked the row on
-- expiry would pass 19 and 20 and fail here.
select results_eq(
  $$ select (caption = '' and deleted_at is null and expires_at < published_at + interval '25 hours')
       from public.stories where id = '0f000000-0000-4000-8000-0000000000e1' $$,
  ARRAY[true],
  'STORY-03: no column of the expired row was rewritten — expiry is a predicate, not a write'
);

-- 22-23. `stories_expiry_window_chk`: a window that ends before it begins is refused, and the same
-- insert with the window the right way round succeeds. The positive control is what proves the
-- refusal came from the CHECK and not from some unrelated failure of the fixture.
select throws_ok(
  $$ insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                                 published_at, expires_at)
     values ('0f000000-0000-4000-8000-0000000000e8', '0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-0000000000c1',
             'image', now(), now() - interval '1 hour') $$,
  '23514',
  null,
  'stories_expiry_window_chk refuses a story that expires before it was published'
);
select lives_ok(
  $$ insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                                 published_at, expires_at)
     values ('0f000000-0000-4000-8000-0000000000e9', '0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-0000000000c1',
             'image', now(), now() + interval '1 hour') $$,
  'positive control: the same insert with the window the right way round is accepted'
);

-- 24. The COLUMN DEFAULT is STORY_EXPIRY_HOURS, not something the caller chose. An insert that
-- names neither timestamp lands exactly 24 h apart — which is what makes "no client value can
-- lengthen a story" a property of the schema rather than of the service.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind)
values ('0f000000-0000-4000-8000-0000000000ea', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', '0f000000-0000-4000-8000-0000000000c1', 'image');
select results_eq(
  $$ select (expires_at - published_at) from public.stories
      where id = '0f000000-0000-4000-8000-0000000000ea' $$,
  ARRAY[interval '24 hours'],
  'the default window is exactly 24 h, derived from the same transaction timestamp'
);

-- 25-26. The two Phase 4 slots are REAL references now. A comment naming a story that does not
-- exist is a 23503, and the same comment naming a real story lives — the positive control is what
-- shows the constraint is the reason, and not `feed_comments_target_chk` firing first.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body)
     values ('0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-0000000000ff',
             '0f000000-0000-4000-8000-000000000002', 'orfa') $$,
  '23503',
  null,
  'feed_comments_story_fk: a comment cannot name a story that does not exist'
);
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, story_id)
     values ('0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-000000000002',
             '0f000000-0000-4000-8000-0000000000a9') $$,
  'positive control: feed_likes_story_fk accepts a like on a story that DOES exist'
);

-- ── 27-29. STORY-05: stories.like_count reconciles against the rows it summarises ─────────────
-- The like at 26 above is already in the table (and is the positive control the plan asks for),
-- so the counter is at 1 before this block runs. What follows is a MIXED sequence across TWO
-- members — like, like, unlike, repeat-like — because a counter that only ever counted up would
-- pass a test that only ever inserted.
--
-- `feed_likes_story_uq` is the idempotency arbiter, and 28 is what proves it: the repeat insert
-- adjusts NOTHING, because `on conflict do nothing` means the trigger never fires a second time.
-- That is the database half of "a repeat like is never a 409".
select tests.auth_user('comm2@c.local', '0f000000-0000-4000-8000-000000000003');
select tests.member('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000003');

insert into public.feed_likes (tenant_id, user_id, story_id)
values ('0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000003',
        '0f000000-0000-4000-8000-0000000000a9'),
       -- the EXPIRED story is liked too: expiry gates the STRIP, never the interaction (A-4)
       ('0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000003',
        '0f000000-0000-4000-8000-0000000000e1');

select results_eq(
  $$ select like_count from public.stories
      where id = '0f000000-0000-4000-8000-0000000000a9' $$,
  ARRAY[2],
  'STORY-05: two members liking one story leave like_count at 2 — the trigger is the only writer'
);

-- The repeat, by the member who already liked it: `feed_likes_story_uq` swallows it, so no trigger
-- fires and the count does not move. This is why the API never answers 409.
insert into public.feed_likes (tenant_id, user_id, story_id)
values ('0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000003',
        '0f000000-0000-4000-8000-0000000000a9')
on conflict (user_id, story_id) where story_id is not null do nothing;

delete from public.feed_likes
 where user_id = '0f000000-0000-4000-8000-000000000002'
   and story_id = '0f000000-0000-4000-8000-0000000000a9';

select results_eq(
  $$ select like_count from public.stories
      where id = '0f000000-0000-4000-8000-0000000000a9' $$,
  ARRAY[1],
  'a repeat like adjusts nothing and an unlike decrements once — no clamp, no double count'
);

-- The reconciliation itself, over EVERY story in the database rather than this file's fixture: the
-- seeded rows went through the same trigger, so a seed that wrote a counter by hand, a backfill
-- that missed a row or a branch that never fired all surface here (T-05-37). There is no
-- `greatest(0, …)` clamp in the function precisely so this can go red.
select is_empty(
  $$ select s.id::text, s.like_count, coalesce(l.n, 0) as rows
       from public.stories s
       left join (select story_id, count(*)::int as n
                    from public.feed_likes
                   where story_id is not null
                   group by story_id) l on l.story_id = s.id
      where s.like_count <> coalesce(l.n, 0) $$,
  'stories.like_count equals count(*) of that story''s like rows, for every story in the database'
);

-- ── 30-43. STORY-05: the refusals are the DATABASE's, and each carries its positive control ────
-- The fixture: a post of this file's own (so nothing earlier in the file can have removed it), one
-- ROOT comment on it, and one ROOT comment on the ACTIVE story. From here every assertion is about
-- which of the four constraints refused, and why.
insert into public.feed_posts (id, tenant_id, author_user_id, caption)
values ('0f000000-0000-4000-8000-0000000000bc', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-000000000002', 'alvo dos comentarios');

insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth,
                                  parent_id, parent_depth, parent_target_kind)
values ('0f000000-0000-4000-8000-0000000000c1', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-0000000000bc', '0f000000-0000-4000-8000-000000000002',
        'raiz de post', 0, null, null, null);

-- 30. The positive control the whole block rests on: a ROOT comment on a STORY is accepted, with
-- `target_kind` generated as 'story' and every parent column null. If this failed, every refusal
-- below would be passing for the wrong reason.
select lives_ok(
  $$ insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body, depth,
                                       parent_id, parent_depth, parent_target_kind)
     values ('0f000000-0000-4000-8000-0000000000c2', '0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-0000000000a9', '0f000000-0000-4000-8000-000000000002',
             'comentario de story', 0, null, null, null) $$,
  'STORY-05: a ROOT comment on a story is accepted — the flat conversation exists'
);

-- 31. Honest: the row says its parent is a story comment. The rewritten shape CHECK pins
-- `parent_target_kind = 'post'`, so the reply branch is FALSE and the row never reaches the index.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body, depth,
                                       parent_id, parent_depth, parent_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-0000000000a9',
             '0f000000-0000-4000-8000-000000000002', 'resposta honesta', 1,
             '0f000000-0000-4000-8000-0000000000c2', 0, 'story') $$,
  '23514',
  null,
  'STORY-05: a reply naming the story kind HONESTLY is refused by feed_comments_parent_shape_chk'
);

-- 32. Lying: the row claims its parent is a post comment, which satisfies the CHECK — and then the
-- composite foreign key looks for the triple `(c2, 0, 'post')`. c2's generated `target_kind` is
-- 'story', so no such triple exists. There is NO legal value that finds a story comment.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body, depth,
                                       parent_id, parent_depth, parent_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-0000000000a9',
             '0f000000-0000-4000-8000-000000000002', 'resposta mentirosa', 1,
             '0f000000-0000-4000-8000-0000000000c2', 0, 'post') $$,
  '23503',
  null,
  'STORY-05: a reply LYING about the parent kind is refused by the composite feed_comments_parent_fk'
);

-- 33. POSITIVE CONTROL, in the same block: the Phase 4 behaviour is untouched — a reply to a POST
-- comment still works. A constraint that refused every reply would pass 31 and 32 and fail here.
select lives_ok(
  $$ insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth,
                                       parent_id, parent_depth, parent_target_kind)
     values ('0f000000-0000-4000-8000-0000000000c3', '0f000000-0000-4000-8000-000000000001',
             '0f000000-0000-4000-8000-0000000000bc', '0f000000-0000-4000-8000-000000000002',
             'resposta legitima', 1, '0f000000-0000-4000-8000-0000000000c1', 0, 'post') $$,
  'positive control: a reply to a POST comment is still accepted after the rewrite'
);

-- 34. …and the Phase 4 RULE is untouched too: a reply to a REPLY is still refused, now by the
-- three-column key rather than the two-column one. The rewrite must not quietly widen the cap.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth,
                                       parent_id, parent_depth, parent_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-0000000000bc',
             '0f000000-0000-4000-8000-000000000002', 'resposta de resposta', 1,
             '0f000000-0000-4000-8000-0000000000c3', 0, 'post') $$,
  '23503',
  null,
  'FEED-05 survives the rewrite: a reply to a reply is still refused by feed_comments_parent_fk'
);

-- 35. A story comment claiming depth 1 with no parent at all: neither branch of the shape CHECK
-- matches, so the constraint is FALSE rather than NULL.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, story_id, author_user_id, body, depth,
                                       parent_id, parent_depth, parent_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-0000000000a9',
             '0f000000-0000-4000-8000-000000000002', 'orfa de nivel 1', 1, null, null, null) $$,
  '23514',
  null,
  'a depth-1 comment with NO parent is refused — the root branch requires depth 0'
);

-- 36. THE PITFALL-1 PROBE, verbatim: a parent id with a NULL parent depth. Before this migration
-- the second branch read `true AND NULL AND true` = NULL, a NULL CHECK is SATISFIED, and the
-- composite foreign key was skipped entirely because MATCH SIMPLE ignores a key with a null column
-- — so this row INSERTED, as a depth-1 reply whose parent was never checked to exist, to be in this
-- tenant, or to be a root. Every equality is now guarded by an explicit `is not null`.
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth,
                                       parent_id, parent_depth)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-0000000000bc',
             '0f000000-0000-4000-8000-000000000002', 'sonda pitfall 1', 1,
             '0f000000-0000-4000-8000-0000000000c1', null) $$,
  '23514',
  null,
  'PITFALL 1 CLOSED: a parent id with a NULL parent_depth no longer satisfies a NULL check'
);

-- 37. The like half, honest: the row says the comment it names is a story comment.
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
             '0f000000-0000-4000-8000-0000000000c2', 'story') $$,
  '23514',
  null,
  'STORY-05: a like naming the story kind HONESTLY is refused by feed_likes_comment_kind_chk'
);

-- 38. …and lying: the CHECK passes and `feed_likes_comment_fk` then looks for the pair
-- `(c2, 'post')`, which does not exist.
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
             '0f000000-0000-4000-8000-0000000000c2', 'post') $$,
  '23503',
  null,
  'STORY-05: a like LYING about the comment kind is refused by the composite feed_likes_comment_fk'
);

-- 39. PITFALL 2, which is the one that would actually have shipped: written the naive way, the
-- CHECK accepted a row with a comment id and a NULL discriminator, and MATCH SIMPLE then skipped
-- the foreign key entirely — so the story comment was liked. The guard is what refuses it.
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
             '0f000000-0000-4000-8000-0000000000c2') $$,
  '23514',
  null,
  'PITFALL 2 CLOSED: a NULL discriminator no longer disables feed_likes_comment_fk'
);

-- 40-41. The two POSITIVE CONTROLS for the like half, in the same block: a POST comment is still
-- likeable, and the STORY itself is still likeable (STORY-05's first half, 05-06).
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
             '0f000000-0000-4000-8000-0000000000c1', 'post') $$,
  'positive control: a like on a POST comment is still accepted after the rewrite'
);
select lives_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, story_id)
     values ('0f000000-0000-4000-8000-000000000001', '0f000000-0000-4000-8000-000000000002',
             '0f000000-0000-4000-8000-0000000000e1') $$,
  'positive control: a like on the STORY itself is still accepted (STORY-05 first half)'
);

-- ── 42-43. stories.comment_count across a MIXED sequence ───────────────────────────────────────
-- The soft delete is an UPDATE, not a DELETE (Pitfall 5/10), so the trigger branches on the
-- TRANSITION of `deleted_at`. A counter that only followed inserts and deletes would sit one too
-- high forever the first time a member removed a comment. One insert takes a9 to 2, the soft delete
-- back to 1, the restore back to 2, and the hard delete back to 1 — four transitions, one column.
insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body, depth,
                                  parent_id, parent_depth, parent_target_kind)
values ('0f000000-0000-4000-8000-0000000000c4', '0f000000-0000-4000-8000-000000000001',
        '0f000000-0000-4000-8000-0000000000a9', '0f000000-0000-4000-8000-000000000003',
        'segundo comentario', 0, null, null, null);
update public.feed_comments set deleted_at = now()
 where id = '0f000000-0000-4000-8000-0000000000c4';
update public.feed_comments set deleted_at = null
 where id = '0f000000-0000-4000-8000-0000000000c4';
delete from public.feed_comments where id = '0f000000-0000-4000-8000-0000000000c4';

select results_eq(
  $$ select comment_count from public.stories
      where id = '0f000000-0000-4000-8000-0000000000a9' $$,
  ARRAY[1],
  'stories.comment_count follows insert, SOFT delete, restore and hard delete — exactly once each'
);

-- The reconciliation itself, over EVERY story in the database rather than this file's fixture: the
-- seeded rows went through the same trigger, so a seed that wrote a counter by hand, a backfill
-- that missed a row or a branch that never fired all surface here (T-05-47). There is no
-- `greatest(0, …)` clamp in the function precisely so this can go red.
select is_empty(
  $$ select s.id::text, s.comment_count, coalesce(c.n, 0) as rows
       from public.stories s
       left join (select story_id, count(*)::int as n
                    from public.feed_comments
                   where story_id is not null and deleted_at is null
                   group by story_id) c on c.story_id = s.id
      where s.comment_count <> coalesce(c.n, 0) $$,
  'stories.comment_count equals count(*) of that story''s live comment rows, for every story'
);

-- ── 44-45. the strip keyset is an index scan on stories_tenant_expires_idx ─────────────────
-- 400 stories in THIS file's own tenant, then `analyze`: with five rows the planner always chooses
-- a sequential scan and the assertion below would prove nothing. The windows are spread so the
-- range predicate is selective, exactly as it is in production.
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind,
                            published_at, expires_at)
select ('0f00e0' || lpad(to_hex(g), 26, '0'))::uuid,
       '0f000000-0000-4000-8000-000000000001',
       '0f000000-0000-4000-8000-000000000002',
       '0f000000-0000-4000-8000-0000000000c1',
       'image',
       now() - (g || ' minutes')::interval,
       now() + interval '24 hours' - (g || ' minutes')::interval
  from generate_series(1, 400) g;

analyze public.stories;

create temporary table story_plans (name text primary key, plan text);

do $$
declare
  v_plan text;
begin
  execute
    'explain (format json) select s.id, s.expires_at from public.stories s
      where s.tenant_id = ''0f000000-0000-4000-8000-000000000001''
        and s.deleted_at is null and s.expires_at > now()
      order by s.expires_at desc, s.id desc limit 10' into v_plan;
  insert into story_plans values ('strip', v_plan);

  -- D-84's history: the IDENTICAL statement with the range predicate dropped. Capturing it here is
  -- what makes "one index serves both" falsifiable rather than a claim in a docblock.
  execute
    'explain (format json) select s.id, s.expires_at from public.stories s
      where s.tenant_id = ''0f000000-0000-4000-8000-000000000001''
        and s.deleted_at is null
      order by s.expires_at desc, s.id desc limit 10' into v_plan;
  insert into story_plans values ('history', v_plan);
end
$$;

select matches(
  (select plan from story_plans where name = 'strip'),
  'stories_tenant_expires_idx',
  'STORY-03: the strip ranges AND orders on expires_at, served by stories_tenant_expires_idx BY NAME'
);
-- The same index, the same direction, the range simply dropped — and still never a sequential scan.
-- Both halves in one assertion, because "one index serves both reads" is one claim.
select ok(
  (select plan from story_plans where name = 'history') like '%stories_tenant_expires_idx%'
  and (select plan from story_plans where name = 'history') not like '%Seq Scan on stories%'
  and (select plan from story_plans where name = 'strip') not like '%Seq Scan on stories%',
  'D-84: the admin history drops the range and rides the SAME index — neither plan is a Seq Scan'
);


-- ── 46-47. D-83's forward list is an index scan on feed_comments_tenant_story_root_asc_idx ─────
-- 400 root comments on ONE story, then `analyze`: with two rows the planner always chooses a
-- sequential scan and the assertion below would prove nothing. The windows are spread so the
-- ordering is what the index has to deliver rather than an accident of insertion order.
insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body, depth,
                                  parent_id, parent_depth, parent_target_kind, created_at)
select ('0f00c9' || lpad(to_hex(g), 26, '0'))::uuid,
       '0f000000-0000-4000-8000-000000000001',
       '0f000000-0000-4000-8000-0000000000a9',
       '0f000000-0000-4000-8000-000000000002',
       'volume story comment ' || g,
       0, null, null, null,
       now() - (g || ' minutes')::interval
  from generate_series(1, 400) g;

analyze public.feed_comments;

do $$
declare
  v_plan text;
begin
  execute
    'explain (format json) select c.id, c.created_at from public.feed_comments c
      where c.tenant_id = ''0f000000-0000-4000-8000-000000000001''
        and c.story_id = ''0f000000-0000-4000-8000-0000000000a9''
        and c.parent_id is null and c.deleted_at is null
      order by c.created_at asc, c.id asc limit 10' into v_plan;
  insert into story_plans values ('story_comments_asc', v_plan);
end
$$;

select matches(
  (select plan from story_plans where name = 'story_comments_asc'),
  'feed_comments_tenant_story_root_asc_idx',
  'D-83: the story comment list is served by feed_comments_tenant_story_root_asc_idx BY NAME'
);
-- The half that actually pins the DIRECTION. Naming the index alone would still pass on a plan that
-- scanned it and then SORTED — which is precisely what reusing the DESC index for an ascending
-- order produces, and what makes the existing cursor comparison unable to page it (Pitfall 8). No
-- Sort node and no sequential scan: the order comes off the index.
select ok(
  (select plan from story_plans where name = 'story_comments_asc') not like '%"Node Type": "Sort"%'
  and (select plan from story_plans where name = 'story_comments_asc') not like '%Seq Scan on feed_comments%',
  'D-83 / Pitfall 8: the ascending order comes OFF the index — no Sort node, never a Seq Scan'
);

select * from finish();
rollback;
