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
select plan(69);

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

insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('0a000000-0000-4000-8000-000000000001', 'example', true),
  ('0b000000-0000-4000-8000-000000000001', 'example', true);

-- D-20: one primary, verified host each, registered on both sides so a host lookup through the lane
-- has something to (fail to) find.
insert into public.tenant_domains (tenant_id, host, is_primary, verified_at) values
  ('0a000000-0000-4000-8000-000000000001', 'a.test', true, now()),
  ('0b000000-0000-4000-8000-000000000001', 'b.test', true, now());

insert into public.example_items (id, tenant_id, title, created_by_user_id) values
  ('0a000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', 'x',
   '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000001', 'x',
   '0b000000-0000-4000-8000-000000000002');

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

select results_eq(
  $$ select count(*)::int from public.example_items
      where tenant_id = '0a000000-0000-4000-8000-000000000001' $$,
  ARRAY[1],
  'A sees its own example_items row'
);
select results_eq(
  $$ select count(*)::int from public.example_items where title = 'x' $$,
  ARRAY[1],
  'adjacency: both tenants have an item titled x, the lane returns exactly one'
);
select results_eq(
  $$ select tenant_id::text from public.example_items where title = 'x' $$,
  ARRAY['0a000000-0000-4000-8000-000000000001'],
  'and the one it returns belongs to A'
);
select is_empty(
  $$ select id from public.example_items where id = '0b000000-0000-4000-8000-000000000003' $$,
  'detail by id: B''s item is not found through A''s lane'
);

select throws_ok(
  $$ insert into public.example_items (tenant_id, title, created_by_user_id)
     values ('0b000000-0000-4000-8000-000000000001', 'y',
             '0a000000-0000-4000-8000-000000000002') $$,
  '42501',
  null,
  'WITH CHECK: A cannot write a row stamped with B''s tenant_id'
);
select results_eq(
  $$ with u as (
       update public.example_items set title = 'y'
        where tenant_id = '0b000000-0000-4000-8000-000000000001' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'USING: an update aimed at B''s rows touches nothing'
);

-- ── feed_posts: the same five cases, on the table Phase 4 actually ships (04-01) ────────────────
-- These land BEFORE 04-10 removes the example module, so the exit gate can never be weakened by that
-- removal: it is already proving itself against a feed table when `example_items` disappears.
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
select results_eq(
  $$ select count(*)::int from public.media_assets $$,
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
  $$ select tenant_id::text from public.example_items where title = 'x' $$,
  ARRAY['0b000000-0000-4000-8000-000000000001'],
  'symmetry: B''s lane returns B''s item for the same title'
);
select is_empty(
  $$ select id from public.example_items where id = '0a000000-0000-4000-8000-000000000003' $$,
  'symmetry: A''s item is not found through B''s lane'
);
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
  $$ select count(*)::int from public.media_assets $$,
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
