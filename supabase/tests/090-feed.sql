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
--   * the three keyset queries are INDEX SCANS against a realistically-sized fixture;
--   * the link-preview cache's PER-TENANT boundary is a fact of the index: the same url_hash
--     collides inside one tenant (23505) and inserts freely across two, with the positive control
--     in the same block — so a global cache could not be introduced without turning this red;
--   * D-53's gallery-XOR-video rule is refused BY THE DATABASE on all four illegal shapes — an
--     image row on a video post and a video row on a gallery post (23503 on the composite
--     `feed_post_media_kind_fk`), a row lying about its own `kind`/`post_media_kind` pair (23514),
--     and a second video on one post (23505 on the partial unique). The three POSITIVE controls
--     ship in the same block — a `kind = 'file'` row is accepted on a 'none', a 'gallery' AND a
--     'video' post — so a globally broken insert cannot make the negatives pass vacuously.
--
-- The EXPLAIN block builds and ANALYZEs its own 250-row fixture inside this file's transaction,
-- because with three rows the planner always chooses a sequential scan and the assertion would
-- prove nothing. It deliberately does NOT lean on `pnpm db:seed`: a volume fixture in a seeded
-- tenant would push the demo posts off the first feed page and quietly break `feed.test.ts`'s
-- cursor walk and `feed.spec.ts`'s ordering assertions. Like its siblings, this file rolls back, so
-- it re-runs identically against a seeded or an empty database, twice in a row, in any order.
select plan(35);

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

-- ── 15-24. D-53: gallery XOR video, enforced by the database (04-04) ──────────────────────────
-- Three posts, one per `media_kind`, plus one real asset of each kind. The assets are written with
-- the migration role (this file never opens a lane), so `media_assets`' select policy is irrelevant
-- here — what is under test is the composite foreign key, the check and the partial unique.
insert into public.media_assets
  (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, width, height, filename)
values
  ('0c000000-0000-4000-8000-0000000000d1', '0c000000-0000-4000-8000-000000000001',
   '0c000000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/webp', 1000, 800, 600, 'f.webp'),
  ('0c000000-0000-4000-8000-0000000000d2', '0c000000-0000-4000-8000-000000000001',
   '0c000000-0000-4000-8000-000000000002', 'image', 'post', 'ready', 'image/webp', 1000, 800, 600, 'g.webp'),
  ('0c000000-0000-4000-8000-0000000000d3', '0c000000-0000-4000-8000-000000000001',
   '0c000000-0000-4000-8000-000000000002', 'video', 'post', 'ready', 'video/mp4', 2000, null, null, 'v.mp4'),
  ('0c000000-0000-4000-8000-0000000000d4', '0c000000-0000-4000-8000-000000000001',
   '0c000000-0000-4000-8000-000000000002', 'video', 'post', 'ready', 'video/mp4', 2000, null, null, 'w.mp4'),
  ('0c000000-0000-4000-8000-0000000000d5', '0c000000-0000-4000-8000-000000000001',
   '0c000000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 3000, null, null, 'a.pdf');

insert into public.feed_posts (id, tenant_id, caption, author_user_id, media_kind) values
  ('0c000000-0000-4000-8000-0000000000e1', '0c000000-0000-4000-8000-000000000001', 'g',
   '0c000000-0000-4000-8000-000000000002', 'gallery'),
  ('0c000000-0000-4000-8000-0000000000e2', '0c000000-0000-4000-8000-000000000001', 'v',
   '0c000000-0000-4000-8000-000000000002', 'video'),
  ('0c000000-0000-4000-8000-0000000000e3', '0c000000-0000-4000-8000-000000000001', 't',
   '0c000000-0000-4000-8000-000000000002', 'none');

-- 15-16. the two positive controls for the media half: an image on a gallery post, a video on a
-- video post. Without these the four negatives below could all be passing for the wrong reason.
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e1',
             'gallery', '0c000000-0000-4000-8000-0000000000d1', 'image', 0) $$,
  'positive control: an image row on a gallery post is accepted'
);
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e2',
             'video', '0c000000-0000-4000-8000-0000000000d3', 'video', 0) $$,
  'positive control: THE video row on a video post is accepted'
);

-- 17-20. the four illegal shapes. A post has exactly ONE media_kind, so naming the other one is a
-- pair that does not exist in feed_posts(id, media_kind) — which is why D-53 is a referential fact
-- and not a composer convention.
select throws_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e2',
             'gallery', '0c000000-0000-4000-8000-0000000000d2', 'image', 0) $$,
  '23503',
  null,
  'D-53: an IMAGE row on a video post is refused by feed_post_media_kind_fk (23503)'
);
select throws_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e1',
             'video', '0c000000-0000-4000-8000-0000000000d3', 'video', 0) $$,
  '23503',
  null,
  'D-53: a VIDEO row on a gallery post is refused by feed_post_media_kind_fk (23503)'
);
select throws_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e2',
             'video', '0c000000-0000-4000-8000-0000000000d2', 'image', 1) $$,
  '23514',
  null,
  'D-53: an image row CLAIMING post_media_kind = video is refused by feed_post_media_kind_chk (23514)'
);
select throws_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e2',
             'video', '0c000000-0000-4000-8000-0000000000d4', 'video', 1) $$,
  '23505',
  null,
  'D-53: a SECOND video on one post is refused by feed_post_media_video_uq (23505)'
);

-- 21-23. an attachment coexists with EVERY media kind — the three positive controls that make the
-- four negatives above mean "gallery XOR video" rather than "media rows are hard to insert".
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e3',
             'none', '0c000000-0000-4000-8000-0000000000d5', 'file', 0) $$,
  'FEED-01: a file row is accepted on a post with NO media'
);
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e1',
             'gallery', '0c000000-0000-4000-8000-0000000000d5', 'file', 0) $$,
  'FEED-01: a file row is accepted on a GALLERY post — photos plus a PDF'
);
select lives_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e2',
             'video', '0c000000-0000-4000-8000-0000000000d5', 'file', 0) $$,
  'FEED-01: a file row is accepted on a VIDEO post — a video plus a PDF'
);

-- 24. ordering is a fact of the data: two rows cannot claim the same slide.
select throws_ok(
  $$ insert into public.feed_post_media (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000e1',
             'gallery', '0c000000-0000-4000-8000-0000000000d2', 'image', 0) $$,
  '23505',
  null,
  'two media rows with the same (post_id, kind, position) are refused by feed_post_media_position_uq (23505)'
);

-- ── 25-29. the link-preview cache and its per-tenant boundary (04-05, MEDIA-04) ───────────────
-- A SECOND tenant is created here on purpose: the whole point of `unique (tenant_id, url_hash)` is
-- that it is per tenant, and that is unprovable with one tenant in the fixture. The positive
-- control ships in the same block, so a globally broken insert cannot make the collision pass.
select tests.tenant('pgtap-feed-2', 'Comunidade Feed 2', '0c000000-0000-4000-8000-000000000004');

select lives_ok(
  $$ insert into public.feed_link_previews (id, tenant_id, url_hash, url, status)
     values ('0c000000-0000-4000-8000-0000000000f1', '0c000000-0000-4000-8000-000000000001',
             'aaaa1111', 'https://exemplo.invalid/a', 'resolved') $$,
  'positive control: a link preview row is accepted'
);

-- 26. the same URL twice IN ONE TENANT is one cache row — which is what makes a second post of the
-- same link cost no second outbound fetch (the service relies on this via `on conflict do nothing`).
select throws_ok(
  $$ insert into public.feed_link_previews (tenant_id, url_hash, url, status)
     values ('0c000000-0000-4000-8000-000000000001', 'aaaa1111', 'https://exemplo.invalid/a', 'pending') $$,
  '23505',
  null,
  'the same url_hash twice in ONE tenant collides on feed_link_previews_tenant_url_uq (23505)'
);

-- 27. THE PRIVACY BOUNDARY. The same hash in ANOTHER tenant is a separate row: one tenant can never
-- reuse — and therefore never learn about — what another organisation already resolved (T-04-34).
select lives_ok(
  $$ insert into public.feed_link_previews (tenant_id, url_hash, url, status)
     values ('0c000000-0000-4000-8000-000000000004', 'aaaa1111', 'https://exemplo.invalid/a', 'resolved') $$,
  'the same url_hash in a DIFFERENT tenant inserts: the cache is per tenant, not global'
);

-- 28. the status vocabulary is closed, so a typo cannot create a fourth rendering state the card
-- has no branch for.
select throws_ok(
  $$ insert into public.feed_link_previews (tenant_id, url_hash, url, status)
     values ('0c000000-0000-4000-8000-000000000001', 'bbbb2222', 'https://exemplo.invalid/b', 'partial') $$,
  '23514',
  null,
  'an out-of-vocabulary preview status is refused by feed_link_previews_status_chk (23514)'
);

-- 29. `on delete set null`: dropping a preview (a cache purge, a re-unfurl) must never take the post
-- with it — the post survives and falls back to the bare auto-linked URL in its caption (UI-D-11).
insert into public.feed_posts (id, tenant_id, caption, author_user_id, link_preview_id) values
  ('0c000000-0000-4000-8000-0000000000f2', '0c000000-0000-4000-8000-000000000001', 'l',
   '0c000000-0000-4000-8000-000000000002', '0c000000-0000-4000-8000-0000000000f1');
delete from public.feed_link_previews where id = '0c000000-0000-4000-8000-0000000000f1';
select is(
  (select count(*) filter (where link_preview_id is null)::int
     from public.feed_posts where id = '0c000000-0000-4000-8000-0000000000f2'),
  1,
  'deleting a preview leaves its post alive with link_preview_id null (on delete set null)'
);

-- ── 30-35. the three keyset queries are index scans ────────────────────────────────────────────
-- Captured into a temp table with `execute … into`, because EXPLAIN cannot be a subquery. The
-- predicates mirror what RLS injects (`tenant_id = app.tenant_id()`), since pg_prove connects as
-- the table owner and therefore does not have the policy applied for it.
-- The volume fixture: 250 posts, 250 root comments on one post and 250 replies under one root, in
-- THIS file's own tenant. `analyze` is what makes the planner act on any of it — without it every
-- estimate is the zero-row default and the plans below prove nothing.
insert into public.feed_posts (id, tenant_id, author_user_id, caption, created_at)
select ('0c00f1' || lpad(to_hex(g), 26, '0'))::uuid,
       '0c000000-0000-4000-8000-000000000001',
       '0c000000-0000-4000-8000-000000000002',
       'volume ' || g,
       now() - (g || ' minutes')::interval
  from generate_series(1, 250) g;

insert into public.feed_comments
  (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, created_at)
select ('0c00f2' || lpad(to_hex(g), 26, '0'))::uuid,
       '0c000000-0000-4000-8000-000000000001',
       '0c000000-0000-4000-8000-0000000000a1',
       '0c000000-0000-4000-8000-000000000002',
       'volume root ' || g,
       0, null, null,
       now() - (g || ' minutes')::interval
  from generate_series(1, 250) g;

insert into public.feed_comments
  (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, created_at)
select ('0c00f3' || lpad(to_hex(g), 26, '0'))::uuid,
       '0c000000-0000-4000-8000-000000000001',
       '0c000000-0000-4000-8000-0000000000a1',
       '0c000000-0000-4000-8000-000000000002',
       'volume reply ' || g,
       1, '0c000000-0000-4000-8000-0000000000b1', 0,
       now() - (g || ' seconds')::interval
  from generate_series(1, 250) g;

analyze public.feed_posts;
analyze public.feed_comments;

-- Captured into a temp table with `execute … into`, because EXPLAIN cannot be a subquery. The
-- predicates mirror what RLS injects (`tenant_id = app.tenant_id()`), since pg_prove connects as
-- the table owner and therefore does not have the policy applied for it.
create temporary table feed_plans (name text primary key, plan text);

do $$
declare
  v_plan text;
begin
  execute
    'explain (format json) select p.id, p.created_at from public.feed_posts p
      where p.tenant_id = ''0c000000-0000-4000-8000-000000000001''
        and p.community_id is null and p.deleted_at is null
      order by p.created_at desc, p.id desc limit 10' into v_plan;
  insert into feed_plans values ('feed', v_plan);

  execute
    'explain (format json) select c.id, c.created_at from public.feed_comments c
      where c.tenant_id = ''0c000000-0000-4000-8000-000000000001''
        and c.post_id = ''0c000000-0000-4000-8000-0000000000a1''
        and c.parent_id is null and c.deleted_at is null
      order by c.created_at desc, c.id desc limit 20' into v_plan;
  insert into feed_plans values ('roots', v_plan);

  execute
    'explain (format json) select c.id, c.created_at from public.feed_comments c
      where c.tenant_id = ''0c000000-0000-4000-8000-000000000001''
        and c.parent_id = ''0c000000-0000-4000-8000-0000000000b1''
        and c.deleted_at is null
      order by c.created_at asc, c.id asc limit 10' into v_plan;
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
