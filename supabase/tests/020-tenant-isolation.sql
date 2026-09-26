begin;
-- 020-tenant-isolation.sql — T-08-02, the core value proved inside Postgres.
--
-- Two tenants are seeded with IDENTICAL-LOOKING content: the same item title ('x'), the same
-- notification kind, the same message body, the same `member@…` local part. A leak that matched on a
-- value instead of on tenant_id therefore cannot hide behind "the rows look different anyway" —
-- every assertion is about WHICH tenant's row came back, not about what it contained (TENANT-05
-- adjacency).
--
-- Ids are fixed literals on purpose: a temp table or temp view holding them would live in pg_temp,
-- which `authenticated` cannot read once the lane is open.
--
-- The whole file runs in one transaction that rolls back, so it re-runs identically against a seeded
-- or an empty database, twice in a row, in any order relative to its siblings (TENANT-05 ordering).
select plan(115);

-- ── fixtures (as the migration role, before any lane is opened) ─────────────────────────────────
select tests.tenant('pgtap-a', 'Comunidade A', '0a000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-b', 'Comunidade B', '0b000000-0000-4000-8000-000000000001');
select tests.auth_user('member@a.local', '0a000000-0000-4000-8000-000000000002');
select tests.auth_user('member@b.local', '0b000000-0000-4000-8000-000000000002');
-- An identity with NO membership anywhere: the lane's INSERT attempt below must fail on RLS (42501),
-- never on the one-tenant-per-user index, so the reason is unambiguous.
select tests.auth_user('orphan@a.local', '0a000000-0000-4000-8000-000000000009');
select tests.member('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000002');
select tests.member('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002');

-- One flag row per tenant (the two `tenant_modules` assertions below count on exactly one each).
-- 04-10 moved the key from the deleted reference module to `feed`: the retired key would now be
-- refused by `tenant_modules_key_chk`, which is the schema half of D-19's removal.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('0a000000-0000-4000-8000-000000000001', 'feed', true),
  ('0b000000-0000-4000-8000-000000000001', 'feed', true);

-- D-20: one primary, verified host each, registered on both sides so a host lookup through the lane
-- has something to (fail to) find.
insert into public.tenant_domains (tenant_id, host, is_primary, verified_at) values
  ('0a000000-0000-4000-8000-000000000001', 'a.test', true, now()),
  ('0b000000-0000-4000-8000-000000000001', 'b.test', true, now());

-- 04-01: the module's own table, with IDENTICAL captions on both sides (§(j) adjacency). The rows
-- are authored by each tenant's own member through the generic `author_user_id` column — there is no
-- admin-flavoured authorship column to seed, which is FEED-08 stated as data.
insert into public.feed_posts (id, tenant_id, caption, author_user_id) values
  ('0a000000-0000-4000-8000-0000000000f1', '0a000000-0000-4000-8000-000000000001', 'x',
   '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-0000000000f1', '0b000000-0000-4000-8000-000000000001', 'x',
   '0b000000-0000-4000-8000-000000000002');

-- 04-03: the interaction tables, again with IDENTICAL content on both sides. The comment body is
-- 'x' in both tenants and each member likes their own tenant's post, so every assertion below is
-- about WHICH tenant's row came back, never about what it contained.
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth) values
  ('0a000000-0000-4000-8000-0000000000f2', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-0000000000f1', '0a000000-0000-4000-8000-000000000002', 'x', 0, null, null),
  ('0b000000-0000-4000-8000-0000000000f2', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-0000000000f1', '0b000000-0000-4000-8000-000000000002', 'x', 0, null, null);

insert into public.feed_likes (id, tenant_id, user_id, post_id) values
  ('0a000000-0000-4000-8000-0000000000f3', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-0000000000f1'),
  ('0b000000-0000-4000-8000-0000000000f3', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-0000000000f1');

-- 04-04: an attachment on each tenant's post, with the SAME filename and the same `kind`/`position`
-- on both sides. `media_kind` stays 'none' on the parent posts above — a file row constrains the
-- discriminator not at all — so this fixture is also the "attachment with no media" shape.
insert into public.media_assets
  (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, filename) values
  ('0a000000-0000-4000-8000-0000000000f4', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 10, 'x.pdf'),
  ('0b000000-0000-4000-8000-0000000000f4', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 10, 'x.pdf');

insert into public.feed_post_media
  (id, tenant_id, post_id, post_media_kind, media_asset_id, kind, position) values
  ('0a000000-0000-4000-8000-0000000000f5', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-0000000000f1', 'none', '0a000000-0000-4000-8000-0000000000f4', 'file', 0),
  ('0b000000-0000-4000-8000-0000000000f5', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-0000000000f1', 'none', '0b000000-0000-4000-8000-0000000000f4', 'file', 0);

-- 04-05: an IDENTICAL link preview on each side — the same `url_hash`, the same title. The shared
-- hash is the point: it is legal across tenants (the cache is per tenant) and it makes the
-- adjacency case below unfakeable, because a query that filtered on the hash instead of on
-- `tenant_id` would match both rows.
insert into public.feed_link_previews (id, tenant_id, url_hash, url, status, title) values
  ('0a000000-0000-4000-8000-0000000000f6', '0a000000-0000-4000-8000-000000000001',
   'cccc3333', 'https://exemplo.invalid/c', 'resolved', 'Materia'),
  ('0b000000-0000-4000-8000-0000000000f6', '0b000000-0000-4000-8000-000000000001',
   'cccc3333', 'https://exemplo.invalid/c', 'resolved', 'Materia');

-- 05-01: the community container and its born-unused membership join, with IDENTICAL name, slug
-- and description on both sides. The shared SLUG is the point: `communities_tenant_slug_uq` is
-- per tenant, so the same segment is legal in both, and a query that filtered on the slug instead
-- of on `tenant_id` would match BOTH rows — which is exactly the leak the adjacency cases below
-- refuse to let through.
insert into public.communities
  (id, tenant_id, created_by_user_id, name, slug, description) values
  ('0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', 'Avisos', 'avisos', 'x'),
  ('0b000000-0000-4000-8000-0000000000c1', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', 'Avisos', 'avisos', 'x');

-- `community_members` carries NO row in V1's product surface (COMM-02 is a policy value: the list
-- never joins this table). It is seeded here anyway, because the point of the case below is that the
-- POLICY is already right on the day V2-CONT-02 starts writing rows — a table proved isolated only
-- once it is used is a table proved isolated too late.
insert into public.community_members (id, tenant_id, community_id, user_id, role) values
  ('0a000000-0000-4000-8000-0000000000c2', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-000000000002', 'member'),
  ('0b000000-0000-4000-8000-0000000000c2', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-0000000000c1', '0b000000-0000-4000-8000-000000000002', 'member');

insert into public.notifications (tenant_id, user_id, kind) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000002', 'k'),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002', 'k');

insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('0a000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', 'support',
   '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-000000000004', '0b000000-0000-4000-8000-000000000001', 'support',
   '0b000000-0000-4000-8000-000000000002');

insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('0a000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', 'member'),
  ('0b000000-0000-4000-8000-000000000004', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', 'member');

insert into public.chat_messages (tenant_id, conversation_id, seq, author_user_id, body) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000004', 1,
   '0a000000-0000-4000-8000-000000000002', 'oi'),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000004', 1,
   '0b000000-0000-4000-8000-000000000002', 'oi');

-- 03-01: one live asset each, plus a SOFT-DELETED one for A. Same mime and byte count on both
-- sides, so a leak cannot hide behind "the rows look different anyway" (TENANT-05 adjacency).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, deleted_at) values
  ('0a000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', 'image', 'avatar', 'ready', 'image/jpeg', 1024, null),
  ('0b000000-0000-4000-8000-000000000005', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', 'image', 'avatar', 'ready', 'image/jpeg', 1024, null),
  ('0a000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', 'image', 'avatar', 'deleted', 'image/jpeg', 1024, now());

-- 05-05: one ACTIVE story per tenant, with an IDENTICAL caption, media kind and window on both
-- sides. The shared caption is the point, exactly as the shared community slug is above: a read
-- that filtered on content instead of on `tenant_id` would match BOTH rows. Each story points at
-- its own tenant's asset, because `stories.media_asset_id` is a real reference and a cross-tenant
-- one could not be inserted here even deliberately.
insert into public.stories
  (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at) values
  ('0a000000-0000-4000-8000-0000000000d1', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000005', 'image',
   'ao vivo', now() - interval '1 hour', now() + interval '23 hours'),
  ('0b000000-0000-4000-8000-0000000000d1', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000005', 'image',
   'ao vivo', now() - interval '1 hour', now() + interval '23 hours');

-- 05.2-01: ONE named highlight and ONE item per tenant, structurally identical on both sides — the
-- adjacency Phase 5's community-pin rows had, carried to the rows that replaced them (05.2-11).
-- Each highlight sits on its own tenant's first community with the SAME title, and each item
-- points that highlight at its own tenant's story. A read that filtered on the title, the community slug or the item pair instead of
-- on `tenant_id` would match BOTH rows. The foreign keys make a cross-tenant item impossible to even
-- insert here, which is why the WITH CHECK cases below stamp a tenant rather than borrow an id.
insert into public.story_highlights
  (id, tenant_id, community_id, title, position, created_by_user_id) values
  ('0a000000-0000-4000-8000-0000000000e6', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-0000000000c1', 'Destaques', 0, '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-0000000000e6', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-0000000000c1', 'Destaques', 0, '0b000000-0000-4000-8000-000000000002');

insert into public.story_highlight_items
  (id, tenant_id, highlight_id, story_id, added_by_user_id) values
  ('0a000000-0000-4000-8000-0000000000e7', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-0000000000e6', '0a000000-0000-4000-8000-0000000000d1',
   '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-0000000000e7', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-0000000000e6', '0b000000-0000-4000-8000-0000000000d1',
   '0b000000-0000-4000-8000-000000000002');

-- 05.2-10: ONE seen row per tenant, structurally identical on both sides — each tenant's member has
-- seen their own tenant's first story. `story_views` is behavioural data about members; a lane that
-- could read another tenant's rows would tell one organisation what another's members watched.
insert into public.story_views (id, tenant_id, user_id, story_id) values
  ('0a000000-0000-4000-8000-0000000000e8', '0a000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-0000000000d1'),
  ('0b000000-0000-4000-8000-0000000000e8', '0b000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-0000000000d1');

-- 03-06/03-08: provider webhook traffic. The table carries NO tenant_id (a provider's event id is
-- global) and RLS with ZERO policies, like platform_admins and tenant_invites: one community's
-- transcode traffic is not another community's business, and with the schema-wide SELECT grant a
-- policy is the only thing that could ever expose it (T-03-45, SCHEMA-CONVENTIONS (i)).
insert into public.media_provider_events (id, provider, type) values
  ('evt-pgtap-a', 'fake', 'video.asset.ready'),
  ('evt-pgtap-b', 'fake', 'video.asset.ready');

insert into public.consent_records (tenant_id, user_id, kind, text_version) values
  ('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000002', 'tenant_rules', 1),
  ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002', 'tenant_rules', 1);

-- A platform admin really exists: the lane must still see nothing (RLS with ZERO policies, 01-03).
insert into public.platform_admins (user_id) values ('0a000000-0000-4000-8000-000000000002');

-- D-30: a pending first-admin invite exists on BOTH sides (same local part again). tenant_invites is
-- admin-lane only — RLS with ZERO policies, like platform_admins — so even A's own row must be
-- invisible to A's lane (T-02-08).
insert into public.tenant_invites (tenant_id, email, created_by) values
  ('0a000000-0000-4000-8000-000000000001', 'convidado@a.local', '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-000000000001', 'convidado@b.local', '0b000000-0000-4000-8000-000000000002');

-- ── tenant A's lane ─────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000002');

select is(current_user::text, 'authenticated', 'the lane runs as authenticated, never as the connection role');

-- ── feed_posts: the six worked isolation cases, on the table Phase 4 actually ships (04-01) ─────
-- 04-01 landed these BEFORE 04-10 dropped the reference module's table, precisely so the gate never
-- spent a commit without a worked case. 04-10 then removed the reference blocks, and the count below
-- fell by exactly the eight assertions those blocks held (81 -> 73) — no case was lost in the move.
select results_eq(
  $$ select count(*)::int from public.feed_posts
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own feed_posts row'
);
select results_eq(
  $$ select count(*)::int from public.feed_posts where caption = 'x' $$,
  ARRAY[1],
  'adjacency: both tenants have a post captioned x, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.feed_posts where caption = 'x' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the feed post it returns belongs to A'
);
select is_empty(
  $$ select id from public.feed_posts where id = '0b000000-0000-4000-8000-0000000000f1' $$,
  'detail by id: B''s post is not found through A''s lane (the bare 404 of FEED-07, one layer down)'
);
select throws_ok(
  $$ insert into public.feed_posts (tenant_id, caption, author_user_id)
     values ('0b000000-0000-4000-8000-000000000001', 'y',
             '0a000000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a post stamped with B''s tenant_id'
);
select results_eq(
  $$ with u as (
       update public.feed_posts set caption = 'y'
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'USING: an update aimed at B''s posts touches nothing'
);

-- ── feed_comments: the same five cases (04-03) ──────────────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from public.feed_comments
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own feed_comments row'
);
select results_eq(
  $$ select count(*)::int from public.feed_comments where body = 'x' $$,
  ARRAY[1],
  'adjacency: both tenants have a comment whose body is x, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.feed_comments where body = 'x' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the feed comment it returns belongs to A'
);
select is_empty(
  $$ select id from public.feed_comments where id = '0b000000-0000-4000-8000-0000000000f2' $$,
  'detail by id: B''s comment is not found through A''s lane'
);
select throws_ok(
  $$ insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
     values ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000f1',
             '0a000000-0000-4000-8000-000000000002', 'y') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a comment stamped with B''s tenant_id'
);
select results_eq(
  $$ with u as (
       update public.feed_comments set body = 'y'
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'USING: an update aimed at B''s comments touches nothing'
);

-- ── feed_likes: the same five cases (04-03) ─────────────────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from public.feed_likes
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own feed_likes row'
);
select results_eq(
  $$ select count(*)::int from public.feed_likes where kind = 'like' $$,
  ARRAY[1],
  'adjacency: both tenants have a like of kind "like", the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.feed_likes where kind = 'like' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the like it returns belongs to A'
);
select is_empty(
  $$ select id from public.feed_likes where id = '0b000000-0000-4000-8000-0000000000f3' $$,
  'detail by id: B''s like is not found through A''s lane'
);
select throws_ok(
  $$ insert into public.feed_likes (tenant_id, user_id, post_id)
     values ('0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000002',
             '0b000000-0000-4000-8000-0000000000f1') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a like stamped with B''s tenant_id'
);
select results_eq(
  $$ with d as (
       delete from public.feed_likes
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'USING: an unlike aimed at B''s rows touches nothing'
);

-- ── feed_post_media: the same five cases, plus its own positive control (04-04) ────────────────
select results_eq(
  $$ select count(*)::int from public.feed_post_media
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own feed_post_media row'
);
select results_eq(
  $$ select count(*)::int from public.feed_post_media where kind = 'file' and position = 0 $$,
  ARRAY[1],
  'adjacency: both tenants attached a file at position 0, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.feed_post_media where kind = 'file' and position = 0 $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the media row it returns belongs to A'
);
select is_empty(
  $$ select id from public.feed_post_media where id = '0b000000-0000-4000-8000-0000000000f5' $$,
  'detail by id: B''s media row is not found through A''s lane'
);
select throws_ok(
  $$ insert into public.feed_post_media
       (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
     values ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000f1',
             'none', '0b000000-0000-4000-8000-0000000000f4', 'file', 1) $$,
  '42501',
  null,
  'WITH CHECK: A cannot attach media stamped with B''s tenant_id'
);
select results_eq(
  $$ with d as (
       delete from public.feed_post_media
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'USING: a detach aimed at B''s media rows touches nothing'
);

-- ── feed_link_previews: the same five cases, plus its own positive control (04-05) ────────────
select results_eq(
  $$ select count(*)::int from public.feed_link_previews
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own feed_link_previews row'
);
select results_eq(
  $$ select count(*)::int from public.feed_link_previews where url_hash = 'cccc3333' $$,
  ARRAY[1],
  'adjacency: both tenants cached the SAME url_hash, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.feed_link_previews where url_hash = 'cccc3333' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the preview it returns belongs to A — one tenant cannot read another''s cache'
);
select is_empty(
  $$ select id from public.feed_link_previews
      where id = '0b000000-0000-4000-8000-0000000000f6' $$,
  'detail by id: B''s preview is not found through A''s lane'
);
select throws_ok(
  $$ insert into public.feed_link_previews (tenant_id, url_hash, url, status)
     values ('0b000000-0000-4000-8000-000000000001', 'dddd4444', 'https://exemplo.invalid/d', 'pending') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a preview stamped with B''s tenant_id'
);
select results_eq(
  $$ with u as (
       update public.feed_link_previews set status = 'failed'
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'USING: the unfurl job''s write aimed at B''s previews touches nothing — a forged job payload can name a tenant, never reach one'
);

-- ── communities: the same five cases, plus its own positive control (05-01) ───────────────────
select results_eq(
  $$ select count(*)::int from public.communities
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own communities row'
);
select results_eq(
  $$ select count(*)::int from public.communities where slug = 'avisos' and description = 'x' $$,
  ARRAY[1],
  'adjacency: both tenants named a community ''avisos'' with the same description, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.communities where slug = 'avisos' and description = 'x' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the community it returns belongs to A'
);
select is_empty(
  $$ select id from public.communities where id = '0b000000-0000-4000-8000-0000000000c1' $$,
  'detail by id: B''s community is not found through A''s lane — the read path''s bare 404 (D-23) has a policy under it'
);
select throws_ok(
  $$ insert into public.communities (tenant_id, created_by_user_id, name, slug)
     values ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002',
             'Avisos', 'avisos-2') $$,
  '42501',
  null,
  'WITH CHECK: A cannot create a community stamped with B''s tenant_id'
);
select results_eq(
  $$ with u as (
       update public.communities set status = 'archived'
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'USING: an archive aimed at B''s communities touches nothing'
);

-- ── stories: the same five cases, plus its own positive control (05-05) ───────────────────────
-- A story is the most member-visible thing this phase adds and the one with the shortest life, so
-- "zero leakage" has to hold for it on the same six axes as every other table — never on the
-- assumption that a 24 h window is its own protection.
select results_eq(
  $$ select count(*)::int from public.stories
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own stories row'
);
select results_eq(
  $$ select count(*)::int from public.stories where caption = 'ao vivo' $$,
  ARRAY[1],
  'adjacency: both tenants published a story captioned ''ao vivo'', the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.stories where caption = 'ao vivo' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the story it returns belongs to A'
);
select is_empty(
  $$ select id from public.stories where id = '0b000000-0000-4000-8000-0000000000d1' $$,
  'detail by id: B''s story is not found through A''s lane — the read path''s bare 404 (D-23) has a policy under it'
);
select throws_ok(
  $$ insert into public.stories (tenant_id, author_user_id, media_asset_id, media_kind)
     values ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002',
             '0a000000-0000-4000-8000-000000000005', 'image') $$,
  '42501',
  null,
  'WITH CHECK: A cannot publish a story stamped with B''s tenant_id'
);
select results_eq(
  $$ with u as (
       update public.stories set deleted_at = now()
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'USING: a delete aimed at B''s stories touches nothing'
);

-- ── story_highlights: the same five cases, plus its own positive control (05.2-01) ────────────
-- A highlight is where a story OUTLIVES its own expiry — on Início and on every community page —
-- so a leak here would put another organisation's broadcast in this one's permanent row. It is
-- proved on the same six axes as every other table, never on the assumption that its foreign
-- keys already constrain it (a foreign key runs as the table owner and bypasses RLS).
select results_eq(
  $$ select count(*)::int from public.story_highlights
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own story_highlights row'
);
select results_eq(
  $$ select count(*)::int from public.story_highlights where title = 'Destaques' $$,
  ARRAY[1],
  'adjacency: both tenants named their community highlight Destaques, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.story_highlights $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the highlight it returns belongs to A'
);
select is_empty(
  $$ select id from public.story_highlights
      where id = '0b000000-0000-4000-8000-0000000000e6' $$,
  'detail by id: B''s highlight is not found through A''s lane'
);
select throws_ok(
  $$ insert into public.story_highlights
       (tenant_id, community_id, title, position, created_by_user_id)
     values ('0b000000-0000-4000-8000-000000000001', null, 'Destaques', 1,
             '0b000000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a highlight stamped with B''s tenant_id'
);
select results_eq(
  $$ with d as (
       delete from public.story_highlights
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'USING: a delete aimed at B''s highlights removes nothing — a highlight delete is a HARD delete, so no soft-delete predicate hides the miss'
);

-- ── story_highlight_items: the same five cases, plus its own positive control (05.2-01) ───────
-- The item row IS the expiry override (docblock item 6), and the items read carries no expiry
-- predicate by design — so the only thing standing between A's lane and B's kept stories is the
-- tenant predicate this block proves. The READ is asserted as the join a highlight's viewer runs,
-- aimed at B's highlight id, not only as the bare table.
select results_eq(
  $$ select count(*)::int from public.story_highlight_items
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own story_highlight_items row'
);
select results_eq(
  $$ select count(*)::int from public.story_highlight_items $$,
  ARRAY[1],
  'adjacency: both tenants kept their first story in their Destaques, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.story_highlight_items $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the item it returns belongs to A'
);
select is_empty(
  $$ select s.id
       from public.story_highlight_items i
       join public.stories s on s.id = i.story_id and s.tenant_id = i.tenant_id
      where i.highlight_id = '0b000000-0000-4000-8000-0000000000e6'
        and s.deleted_at is null
     union all
     select id from public.story_highlight_items
      where id = '0b000000-0000-4000-8000-0000000000e7' $$,
  'detail by id: B''s item is not found by its id, nor by the items JOIN aimed at B''s highlight, through A''s lane'
);
select throws_ok(
  $$ insert into public.story_highlight_items
       (tenant_id, highlight_id, story_id, added_by_user_id)
     values ('0b000000-0000-4000-8000-000000000001',
             '0b000000-0000-4000-8000-0000000000e6',
             '0b000000-0000-4000-8000-0000000000d1',
             '0b000000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write an item stamped with B''s tenant_id'
);
select results_eq(
  $$ with d as (
       delete from public.story_highlight_items
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'USING: a removal aimed at B''s items removes nothing'
);

-- ── story_views: the same five cases, plus its own positive control (05.2-10) ─────────────────
-- The seen state (HIGHLIGHT-06) is the one table in 05.2 whose rows are ABOUT members rather than
-- by an admin: which story a person watched. The API only ever reads the caller's own rows, and
-- this block proves the tenant lane underneath that rule on the same six axes as every sibling.
select results_eq(
  $$ select count(*)::int from public.story_views
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own story_views row'
);
select results_eq(
  $$ select count(*)::int from public.story_views $$,
  ARRAY[1],
  'adjacency: both tenants'' members saw their own first story, the lane returns exactly one view'
);
select results_eq(
  $$ select tenant_id::text from public.story_views $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the view it returns belongs to A'
);
select is_empty(
  $$ select id from public.story_views
      where id = '0b000000-0000-4000-8000-0000000000e8'
     union all
     select v.id from public.story_views v
      where v.story_id = '0b000000-0000-4000-8000-0000000000d1' $$,
  'detail by id: B''s view is not found by its id, nor by the ring''s probe aimed at B''s story, through A''s lane'
);
select throws_ok(
  $$ insert into public.story_views (tenant_id, user_id, story_id)
     values ('0b000000-0000-4000-8000-000000000001',
             '0a000000-0000-4000-8000-000000000009',
             '0b000000-0000-4000-8000-0000000000d1') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a view stamped with B''s tenant_id'
);
select results_eq(
  $$ with d as (
       delete from public.story_views
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'USING: a delete aimed at B''s views removes nothing'
);

-- ── community_members: the same five cases (05-01). The table is UNUSED in V1 and still proved:
--    V2-CONT-02 is only a policy change if the policy is already correct today. ─────────────────
select results_eq(
  $$ select count(*)::int from public.community_members
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own community_members row'
);
select results_eq(
  $$ select count(*)::int from public.community_members where role = 'member' $$,
  ARRAY[1],
  'adjacency: both tenants hold an identical-looking membership row, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.community_members where role = 'member' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the membership row it returns belongs to A'
);
select is_empty(
  $$ select id from public.community_members where id = '0b000000-0000-4000-8000-0000000000c2' $$,
  'detail by id: B''s community membership is not found through A''s lane'
);
select throws_ok(
  $$ insert into public.community_members (tenant_id, community_id, user_id)
     values ('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000c1',
             '0b000000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'WITH CHECK: A cannot join B''s community with a row stamped with B''s tenant_id'
);
select results_eq(
  $$ with d as (
       delete from public.community_members
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'USING: a leave aimed at B''s membership rows touches nothing'
);

select is_empty(
  $$ select id from public.memberships
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'memberships: B''s rows are invisible'
);
select results_eq(
  $$ select count(*)::int from public.memberships $$,
  ARRAY[1],
  'memberships: exactly A''s own row is visible'
);
-- WR-07 (phase-1 review): memberships is SELECT-ONLY from the lane. `role` and `status` are the
-- authorization source of truth; they change only through the admin lane behind explicit guards.
select results_eq(
  $$ with u as (
       update public.memberships set role = 'admin_tenant'
        where tenant_id = '0a000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'memberships: the lane cannot promote itself — an UPDATE on its own tenant''s rows touches nothing'
);
select throws_ok(
  $$ insert into public.memberships (tenant_id, user_id, role, status)
     values ('0a000000-0000-4000-8000-000000000001',
             '0a000000-0000-4000-8000-000000000009', 'member', 'active') $$,
  '42501',
  null,
  'memberships: the lane cannot add a member — joining is an admin-lane operation'
);

select is_empty(
  $$ select module_key from public.tenant_modules
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'tenant_modules: B''s flags are invisible'
);
select results_eq(
  $$ select count(*)::int from public.tenant_modules $$,
  ARRAY[1],
  'tenant_modules: exactly A''s own flag row is visible'
);

select results_eq(
  $$ select host::text from public.tenant_domains $$,
  ARRAY['a.test'],
  'tenant_domains: only A''s host is listed'
);
select is_empty(
  $$ select host::text from public.tenant_domains where host = 'B.TEST' $$,
  'tenant_domains: the citext lookup of B''s host is still tenant-scoped (case-insensitive, not a bypass)'
);
select throws_ok(
  $$ insert into public.tenant_domains (tenant_id, host, is_primary)
     values ('0a000000-0000-4000-8000-000000000001', 'a2.test', false) $$,
  '42501',
  null,
  'tenant_domains is select-only in the lane: attaching a host is an admin-lane operation (D-20)'
);

select is_empty(
  $$ select id from public.consent_records
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'consent_records: B''s rows are invisible'
);
select results_eq(
  $$ select count(*)::int from public.consent_records $$,
  ARRAY[1],
  'consent_records: only the signed-in user''s own record is visible'
);

select is_empty(
  $$ select id from public.chat_messages
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'chat_messages: B''s messages are invisible'
);
select results_eq(
  $$ select count(*)::int from public.chat_messages where body = 'oi' $$,
  ARRAY[1],
  'adjacency: identical message bodies, one row'
);
select is_empty(
  $$ select id from public.chat_conversations
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'chat_conversations: B''s rows are invisible'
);
select is_empty(
  $$ select user_id from public.chat_participants
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'chat_participants: B''s rows are invisible'
);
select is_empty(
  $$ select id from public.notifications
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'notifications: B''s rows are invisible'
);

-- 03-01 (MEDIA-01/TENANT-04): the asset ROW is tenant-scoped like every other row. The OBJECT is
-- protected separately and structurally — the Storage key is built from the caller's own tenant id,
-- so the two halves of the isolation argument are independent (070-media-bucket.sql pins the other).
select is_empty(
  $$ select id from public.media_assets
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'media_assets: B''s assets are invisible'
);
-- Scoped to the AVATAR the assertion names (04-04): this file's fixture now also carries one
-- `attachment` asset per tenant for the `feed_post_media` block below, and an unqualified
-- `count(*)` would silently start measuring "how many fixtures does this file write" instead of
-- "how many of the OTHER tenant's rows leak", which is the only question here.
select results_eq(
  $$ select count(*)::int from public.media_assets where purpose = 'avatar' $$,
  ARRAY[1],
  'media_assets: adjacency — both tenants own an identical-looking avatar, the lane returns exactly A''s live one'
);
select is_empty(
  $$ select id from public.media_assets where id = '0a000000-0000-4000-8000-000000000006' $$,
  'media_assets: a SOFT-DELETED row is invisible to its OWN tenant''s lane (the policy carries deleted_at is null)'
);

select results_eq(
  $$ select count(*)::int from public.media_provider_events $$,
  ARRAY[0],
  'media_provider_events: provider traffic is invisible to a tenant lane (RLS, zero policies)'
);
select throws_ok(
  $$ insert into public.media_provider_events (id, provider, type)
     values ('evt-pgtap-forged', 'fake', 'video.asset.ready') $$,
  '42501',
  null,
  'media_provider_events: the lane cannot record an event — webhook ingest is an admin-lane operation'
);

select results_eq(
  $$ select count(*)::int from public.platform_admins $$,
  ARRAY[0],
  'platform_admins: a real row is invisible to a tenant lane (RLS, zero policies)'
);

select results_eq(
  $$ select count(*)::int from public.tenant_invites $$,
  ARRAY[0],
  'tenant_invites: A''s OWN pending invite is invisible to A''s lane (admin-lane only, zero policies)'
);
select throws_ok(
  $$ insert into public.tenant_invites (tenant_id, email, created_by)
     values ('0a000000-0000-4000-8000-000000000001', 'outro@a.local',
             '0a000000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'tenant_invites: the lane cannot create an invite — provisioning is a platform-lane operation (D-30)'
);

-- ── 03-02 (PROF-01/PROF-02/TENANT-04): member_profiles, the first TENANT-WIDE select policy ─────
-- A second member of A is created here, mid-file, on purpose: the self-scoped UPDATE policy needs a
-- NEIGHBOUR to be meaningful (a tenant with one member cannot distinguish "my row" from "a row of my
-- tenant"), and creating them here leaves every membership assertion above pinned exactly as it was.
-- Their profile row is created by the `member_profiles_from_membership` trigger, not by this file —
-- which is the R-08 guarantee being exercised rather than simulated.
reset role;
select tests.auth_user('vizinho@a.local', '0a000000-0000-4000-8000-00000000000a');
select tests.member('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a');
select tests.as_tenant('0a000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000002');

select is_empty(
  $$ select id from public.member_profiles
      where tenant_id = '0b000000-0000-4000-8000-000000000001' $$,
  'member_profiles: B''s profiles are invisible to A''s lane'
);
-- Unlike consent_records (self-only), this select policy is TENANT-WIDE by design: PROF-02 and
-- PROF-03 are a member reading OTHER members of their own community.
select results_eq(
  $$ select count(*)::int from public.member_profiles $$,
  ARRAY[2],
  'member_profiles: A''s lane sees BOTH of its members'' profiles — the select policy is tenant-wide'
);
select results_eq(
  $$ with u as (
       update public.member_profiles set bio = 'minha bio'
        where user_id = '0a000000-0000-4000-8000-000000000002' returning 1
     ) select count(*)::int from u $$,
  ARRAY[1],
  'member_profiles: a member CAN rewrite their own row (D-46: renaming is free and ungated)'
);
-- T-03-12: the row a PATCH may touch is decided by the policy, never by a body field. The statement
-- below names the neighbour explicitly and still changes nothing.
select results_eq(
  $$ with u as (
       update public.member_profiles set bio = 'invadida'
        where user_id = '0a000000-0000-4000-8000-00000000000a' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'member_profiles: an update aimed at a NEIGHBOUR''s row in the same tenant touches nothing'
);

-- ── tenant B's lane: the symmetric half, so nothing above is an artefact of who went first ──────
reset role;
select tests.as_tenant('0b000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002');

select results_eq(
  $$ select tenant_id::text from public.feed_posts where caption = 'x' $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s post for the same caption'
);
select is_empty(
  $$ select id from public.feed_posts where id = '0a000000-0000-4000-8000-0000000000f1' $$,
  'symmetry: A''s post is not found through B''s lane'
);
select results_eq(
  $$ select tenant_id::text from public.feed_comments where body = 'x' $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s comment for the same body'
);
select is_empty(
  $$ select id from public.feed_comments where id = '0a000000-0000-4000-8000-0000000000f2' $$,
  'symmetry: A''s comment is not found through B''s lane'
);
select results_eq(
  $$ select tenant_id::text from public.feed_likes where kind = 'like' $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s like for the same kind'
);
select is_empty(
  $$ select id from public.feed_likes where id = '0a000000-0000-4000-8000-0000000000f3' $$,
  'symmetry: A''s like is not found through B''s lane'
);
select results_eq(
  $$ select tenant_id::text from public.story_highlights where title = 'Destaques' $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s highlight for the same title'
);
select is_empty(
  $$ select id from public.story_highlights
      where id = '0a000000-0000-4000-8000-0000000000e6' $$,
  'symmetry: A''s highlight is not found through B''s lane'
);
select results_eq(
  $$ select tenant_id::text from public.story_highlight_items $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s item for the same structurally identical pair'
);
select is_empty(
  $$ select id from public.story_highlight_items
      where id = '0a000000-0000-4000-8000-0000000000e7' $$,
  'symmetry: A''s item is not found through B''s lane'
);
select results_eq(
  $$ select tenant_id::text from public.story_views $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s view for the same structurally identical pair'
);
select is_empty(
  $$ select id from public.story_views
      where id = '0a000000-0000-4000-8000-0000000000e8' $$,
  'symmetry: A''s view is not found through B''s lane'
);
select results_eq(
  $$ select host::text from public.tenant_domains $$,
  ARRAY['b.test'],
  'symmetry: only B''s host is listed'
);
select results_eq(
  $$ select count(*)::int from public.tenant_invites $$,
  ARRAY[0],
  'symmetry: B''s lane sees no invite either'
);
-- 03-01/03-08, the media half of the symmetry: the same adjacency assertion from B's side, plus the
-- soft-delete predicate — A's retired asset (the row the 03-08 sweeper collects by) is invisible to
-- B's lane for BOTH reasons at once, tenant scope and `deleted_at is null`.
select results_eq(
  $$ select count(*)::int from public.media_assets where purpose = 'avatar' $$,
  ARRAY[1],
  'symmetry: B''s lane returns exactly its own live media asset'
);
select is_empty(
  $$ select id from public.media_assets where id = '0a000000-0000-4000-8000-000000000006' $$,
  'symmetry: A''s soft-deleted asset is invisible through B''s lane too'
);
select is_empty(
  $$ select id from public.member_profiles
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  'symmetry: A''s member_profiles rows are invisible through B''s lane'
);
select results_eq(
  $$ select count(*)::int from public.media_provider_events $$,
  ARRAY[0],
  'symmetry: B''s lane sees no provider event either'
);

-- ── the admin lane (withAdminTx behind requireSuperAdmin) is the only reader of invites ─────────
reset role;
select tests.as_service();
select results_eq(
  $$ select tenant_id::text from public.tenant_invites where email = 'CONVIDADO@A.LOCAL' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'tenant_invites: the admin lane reads the row, and email is citext (case-insensitive lookup)'
);
select results_eq(
  $$ select count(*)::int from public.media_provider_events $$,
  ARRAY[2],
  'media_provider_events: the admin lane — the webhook''s own lane — reads every recorded event'
);

reset role;
select * from finish();
rollback;
