begin;
-- 160-shared-identity.sql — ROADMAP 08.1 SC 5 / V2-PLAT-07 / T-08.1-37, proved inside Postgres (08.1-07):
-- ONE identity S that belongs to two tenants, `member` of A ('S em A') and `admin_tenant` of B
-- ('S em B'). Every lane below is `tests.as_tenant(<tenant>, S)`: the claims the API builds for the
-- host-selected membership (D-307). The question is the one 020 asks with two people, asked of the
-- hardest case — one person in both: does A's lane of S ever show a row of B?
--
-- 1. Rows and names. In S's A lane `memberships` shows only S's A membership, `member_profiles` only
--    'S em A', and the feed author join (the RLS-scoped join of `packages/modules/feed/server/
--    service.ts`, RESEARCH inventory row 24) renders 'S em A' for the post S wrote in A and never
--    S's B post; the reverse in S's B lane.
-- 2. S's own rows. Its notifications, its chat conversations and messages (a member's thread in A;
--    the staff view of B's support threads in B), its push subscriptions (the SAME endpoint saved in
--    both tenants: unique per `(tenant_id, endpoint)`), what `app.push_subscriptions_for` hands the
--    worker, and its consent records: each lane shows only its own tenant's rows.
-- 3. Realtime host binding (decided: NOT bound to the host). `app.realtime_topic_allowed` authorises
--    by an active membership in the TOPIC's tenant: S may join A's and B's `user:` topics and never
--    C's, where it has no membership; blocked in A, A's topic closes while B's stays open (D-304);
--    an `invited` and then a soft-deleted membership in C keep C closed.
-- 4. The tables and functions added after research (08.1-RECONCILE "For 08.1-07"): events (with the
--    category capacity guard), event photos, communities (position), the moderation log, feed
--    comments (orphan replies) and `app.notifications_withdrawn` (notifications_push_withdrawn) —
--    each lane of S reads its own tenant only.
--
-- Fixture ids use the `16000000-…` prefix and the tenants `pgtap-si-a`, `pgtap-si-b` and
-- `pgtap-si-c`, used by no other file. Like its siblings, this file ROLLS BACK, so an interrupted run
-- leaves no identity, membership or tenant behind (SC5 concurrency).
select plan(39);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-si-a', 'Shared A', '16000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-si-b', 'Shared B', '16000000-0000-4000-8000-000000000011');
select tests.tenant('pgtap-si-c', 'Shared C', '16000000-0000-4000-8000-000000000021');
-- S, the shared identity; a1, a second member of A; b1, a second member of B.
select tests.auth_user('s@si.local', '16000000-0000-4000-8000-0000000000a0');
select tests.auth_user('a1@si-a.local', '16000000-0000-4000-8000-0000000000a1');
select tests.auth_user('b1@si-b.local', '16000000-0000-4000-8000-0000000000b1');
select tests.member('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select tests.member('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'admin_tenant');
select tests.member('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a1');
select tests.member('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000b1');
-- One name per membership (D-310): the trigger created both profile rows; each is renamed here.
update public.member_profiles set display_name = 'S em A'
 where tenant_id = '16000000-0000-4000-8000-000000000001'
   and user_id = '16000000-0000-4000-8000-0000000000a0';
update public.member_profiles set display_name = 'S em B'
 where tenant_id = '16000000-0000-4000-8000-000000000011'
   and user_id = '16000000-0000-4000-8000-0000000000a0';
-- One post by S in each tenant (the 090 fixture shape, written as the migration role).
insert into public.feed_posts (id, tenant_id, caption, author_user_id) values
  ('16000000-0000-4000-8000-0000000000d1', '16000000-0000-4000-8000-000000000001', 'Aviso.',
   '16000000-0000-4000-8000-0000000000a0'),
  ('16000000-0000-4000-8000-0000000000d2', '16000000-0000-4000-8000-000000000011', 'Aviso.',
   '16000000-0000-4000-8000-0000000000a0');
-- Group 2: S's notifications (the SAME dedupe key on both sides; B's is retracted, for fact 4),
-- chats, devices (the SAME endpoint in both tenants) and consents.
insert into public.notifications (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, payload) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'feed.post',
   'feed.post:16000000-0000-4000-8000-0000000000d9', 'post', '16000000-0000-4000-8000-0000000000d9', '{}'),
  ('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'feed.post',
   'feed.post:16000000-0000-4000-8000-0000000000d9', 'post', '16000000-0000-4000-8000-0000000000d9',
   '{"removed": true}');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('16000000-0000-4000-8000-0000000000c1', '16000000-0000-4000-8000-000000000001', 'support',
   '16000000-0000-4000-8000-0000000000a0'),
  ('16000000-0000-4000-8000-0000000000c2', '16000000-0000-4000-8000-000000000011', 'support',
   '16000000-0000-4000-8000-0000000000b1');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('16000000-0000-4000-8000-0000000000c1', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-0000000000a0', 'member'),
  ('16000000-0000-4000-8000-0000000000c2', '16000000-0000-4000-8000-000000000011',
   '16000000-0000-4000-8000-0000000000b1', 'member');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000c1',
   '16000000-0000-4000-8000-0000000000a0', 'member', 'Oi, preciso de ajuda.'),
  ('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000c2',
   '16000000-0000-4000-8000-0000000000b1', 'member', 'Oi, preciso de ajuda.');
insert into public.push_subscriptions (id, tenant_id, user_id, endpoint, p256dh, auth) values
  ('16000000-0000-4000-8000-0000000000e1', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-0000000000a0', 'https://push.fake.test/sub/si', 'k', 'a'),
  ('16000000-0000-4000-8000-0000000000e2', '16000000-0000-4000-8000-000000000011',
   '16000000-0000-4000-8000-0000000000a0', 'https://push.fake.test/sub/si', 'k', 'a');
insert into public.consent_records (tenant_id, user_id, kind, text_version) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'tenant_rules', 1),
  ('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'tenant_rules', 1);
-- Group 4: one event (both halves in ONE statement), one photo, one community, one moderation-log
-- row and one comment by S per tenant, identical-looking on both sides but for the ids.
create function pg_temp.ev(p_id uuid, p_tenant uuid, p_author uuid) returns void
language sql as $$
  with e as (
    insert into public.events (id, tenant_id, created_by_user_id, title, format, venue_name,
                               address, starts_at, ends_at, category, capacity)
    values (p_id, p_tenant, p_author, 'Encontro', 'in_person', 'Sede', 'Rua A, 1',
            now() + interval '1 day', now() + interval '1 day 2 hours', null, 10)
    returning id, tenant_id, format
  )
  insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code)
  select id, tenant_id, format, 'K7QM' from e
$$;
select pg_temp.ev('16000000-0000-4000-8000-0000000000f1', '16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a1');
select pg_temp.ev('16000000-0000-4000-8000-0000000000f2', '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0');
insert into public.media_assets
  (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, width, height,
   variant_widths, filename, ready_at)
values
  ('16000000-0000-4000-8000-0000000000b8', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-0000000000a1', 'image', 'post', 'ready', 'image/webp', 1024, 1600, 1200,
   '{320,640,1080,1600}'::int[], 'x.webp', now()),
  ('16000000-0000-4000-8000-0000000000b9', '16000000-0000-4000-8000-000000000011',
   '16000000-0000-4000-8000-0000000000a0', 'image', 'post', 'ready', 'image/webp', 1024, 1600, 1200,
   '{320,640,1080,1600}'::int[], 'x.webp', now());
insert into public.event_photos (id, tenant_id, event_id, media_asset_id, created_by_user_id) values
  ('16000000-0000-4000-8000-0000000000f8', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-0000000000f1', '16000000-0000-4000-8000-0000000000b8',
   '16000000-0000-4000-8000-0000000000a1'),
  ('16000000-0000-4000-8000-0000000000f9', '16000000-0000-4000-8000-000000000011',
   '16000000-0000-4000-8000-0000000000f2', '16000000-0000-4000-8000-0000000000b9',
   '16000000-0000-4000-8000-0000000000a0');
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, position) values
  ('16000000-0000-4000-8000-0000000000aa', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-0000000000a1', 'Grupo', 'grupo', 1),
  ('16000000-0000-4000-8000-0000000000ab', '16000000-0000-4000-8000-000000000011',
   '16000000-0000-4000-8000-0000000000a0', 'Grupo', 'grupo', 1);
insert into public.moderation_log
  (id, tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id, reason)
select '16000000-0000-4000-8000-0000000000ac'::uuid, a.tenant_id, 'member_blocked', a.user_id, a.id,
       t.user_id, t.id, 'motivo'
  from public.memberships a, public.memberships t
 where a.tenant_id = '16000000-0000-4000-8000-000000000001'
   and a.user_id = '16000000-0000-4000-8000-0000000000a1'
   and t.tenant_id = a.tenant_id and t.user_id = '16000000-0000-4000-8000-0000000000a0';
insert into public.moderation_log
  (id, tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id, reason)
select '16000000-0000-4000-8000-0000000000ad'::uuid, a.tenant_id, 'member_blocked', a.user_id, a.id,
       t.user_id, t.id, 'motivo'
  from public.memberships a, public.memberships t
 where a.tenant_id = '16000000-0000-4000-8000-000000000011'
   and a.user_id = '16000000-0000-4000-8000-0000000000a0'
   and t.tenant_id = a.tenant_id and t.user_id = '16000000-0000-4000-8000-0000000000b1';
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body) values
  ('16000000-0000-4000-8000-0000000000ca', '16000000-0000-4000-8000-000000000001',
   '16000000-0000-4000-8000-0000000000d1', '16000000-0000-4000-8000-0000000000a0', 'Comentário.'),
  ('16000000-0000-4000-8000-0000000000cb', '16000000-0000-4000-8000-000000000011',
   '16000000-0000-4000-8000-0000000000d2', '16000000-0000-4000-8000-0000000000a0', 'Comentário.');

-- ── 1. rows and names, in S's A lane ───────────────────────────────────────────────────────────
select tests.as_tenant('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select results_eq(
  $$ select tenant_id::text from public.memberships
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000001'],
  'fact 1: in S''s A lane, S has exactly ONE visible membership, the A one'
);
select is(
  (select count(*)::int from public.memberships
    where tenant_id <> '16000000-0000-4000-8000-000000000001'),
  0,
  'fact 1: …and not one membership row of another tenant is visible (B''s second member included)'
);
select results_eq(
  $$ select display_name from public.member_profiles
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['S em A'],
  'fact 1: in S''s A lane, S''s profile is ''S em A'' only, never ''S em B'''
);
select results_eq(
  $$ select p.id::text || ':' || mp.display_name
       from public.feed_posts p
       join public.memberships ms on ms.user_id = p.author_user_id
       join public.member_profiles mp on mp.membership_id = ms.id
      where p.author_user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-0000000000d1:S em A'],
  'fact 1 (inventory row 24): the feed author join renders S''s A post as ''S em A'', and S''s B post never appears'
);
reset role;

-- ── 1. the reverse, in S's B lane ──────────────────────────────────────────────────────────────
select tests.as_tenant('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'admin_tenant');
select results_eq(
  $$ select tenant_id::text from public.memberships
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000011'],
  'fact 1 reverse: in S''s B lane, S has exactly ONE visible membership, the B one'
);
select is(
  (select count(*)::int from public.memberships
    where tenant_id <> '16000000-0000-4000-8000-000000000011'),
  0,
  'fact 1 reverse: …and not one membership row of another tenant is visible (A''s second member included)'
);
select results_eq(
  $$ select display_name from public.member_profiles
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['S em B'],
  'fact 1 reverse: in S''s B lane, S''s profile is ''S em B'' only, never ''S em A'''
);
select results_eq(
  $$ select p.id::text || ':' || mp.display_name
       from public.feed_posts p
       join public.memberships ms on ms.user_id = p.author_user_id
       join public.member_profiles mp on mp.membership_id = ms.id
      where p.author_user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-0000000000d2:S em B'],
  'fact 1 reverse: the feed author join renders S''s B post as ''S em B'', and S''s A post never appears'
);
reset role;

-- ── 2 and 4. S's own rows and the post-research tables, in S's A lane (member) ──────────────────
select tests.as_tenant('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select results_eq(
  $$ select tenant_id::text from public.notifications where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000001'],
  'fact 2 (A lane): S''s notifications are A''s only'
);
select results_eq(
  $$ select id::text from public.chat_conversations $$,
  ARRAY['16000000-0000-4000-8000-0000000000c1'],
  'fact 2 (A lane, member): the visible chat conversations are A''s only'
);
select results_eq(
  $$ select tenant_id::text from public.chat_messages $$,
  ARRAY['16000000-0000-4000-8000-000000000001'],
  'fact 2 (A lane): the visible chat messages are A''s only'
);
select results_eq(
  $$ select id::text from public.push_subscriptions $$,
  ARRAY['16000000-0000-4000-8000-0000000000e1'],
  'fact 2 (A lane): of the SAME endpoint saved in both tenants, only A''s row is visible'
);
select results_eq(
  $$ select id::text from app.push_subscriptions_for(ARRAY['16000000-0000-4000-8000-0000000000a0']::uuid[]) $$,
  ARRAY['16000000-0000-4000-8000-0000000000e1'],
  'fact 2 (A lane): the worker''s reader hands A''s push only A''s device of S'
);
select results_eq(
  $$ select tenant_id::text from public.consent_records where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000001'],
  'fact 2 (A lane): S''s consent records are A''s only'
);
select results_eq(
  $$ select id::text from public.events where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000f1'],
  'fact 4 (A lane): events (category capacity included) are A''s only'
);
select results_eq(
  $$ select id::text from public.event_photos where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000f8'],
  'fact 4 (A lane): event photos are A''s only'
);
select results_eq(
  $$ select id::text || ':' || position::text from public.communities where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000aa:1'],
  'fact 4 (A lane): communities (and their position) are A''s only'
);
select results_eq(
  $$ select id::text from public.moderation_log where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000ac'],
  'fact 4 (A lane): the moderation log is A''s only'
);
select results_eq(
  $$ select id::text from public.feed_comments where author_user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-0000000000ca'],
  'fact 4 (A lane): S''s comments are A''s only'
);
select is(
  app.notifications_withdrawn('feed.post:16000000-0000-4000-8000-0000000000d9', ARRAY['16000000-0000-4000-8000-0000000000a0']::uuid[]),
  false,
  'fact 4 (A lane): notifications_withdrawn answers about A''s row only (B''s is retracted, A''s is not)'
);
reset role;

-- ── 2 and 4. S's own rows and the post-research tables, in S's B lane (admin_tenant) ──────────────────
select tests.as_tenant('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'admin_tenant');
select results_eq(
  $$ select tenant_id::text from public.notifications where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000011'],
  'fact 2 (B lane): S''s notifications are B''s only'
);
select results_eq(
  $$ select id::text from public.chat_conversations $$,
  ARRAY['16000000-0000-4000-8000-0000000000c2'],
  'fact 2 (B lane, admin_tenant): the visible chat conversations are B''s only'
);
select results_eq(
  $$ select tenant_id::text from public.chat_messages $$,
  ARRAY['16000000-0000-4000-8000-000000000011'],
  'fact 2 (B lane): the visible chat messages are B''s only'
);
select results_eq(
  $$ select id::text from public.push_subscriptions $$,
  ARRAY['16000000-0000-4000-8000-0000000000e2'],
  'fact 2 (B lane): of the SAME endpoint saved in both tenants, only B''s row is visible'
);
select results_eq(
  $$ select id::text from app.push_subscriptions_for(ARRAY['16000000-0000-4000-8000-0000000000a0']::uuid[]) $$,
  ARRAY['16000000-0000-4000-8000-0000000000e2'],
  'fact 2 (B lane): the worker''s reader hands B''s push only B''s device of S'
);
select results_eq(
  $$ select tenant_id::text from public.consent_records where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000011'],
  'fact 2 (B lane): S''s consent records are B''s only'
);
select results_eq(
  $$ select id::text from public.events where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000f2'],
  'fact 4 (B lane): events (category capacity included) are B''s only'
);
select results_eq(
  $$ select id::text from public.event_photos where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000f9'],
  'fact 4 (B lane): event photos are B''s only'
);
select results_eq(
  $$ select id::text || ':' || position::text from public.communities where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000ab:1'],
  'fact 4 (B lane): communities (and their position) are B''s only'
);
select results_eq(
  $$ select id::text from public.moderation_log where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-0000000000ad'],
  'fact 4 (B lane): the moderation log is B''s only'
);
select results_eq(
  $$ select id::text from public.feed_comments where author_user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-0000000000cb'],
  'fact 4 (B lane): S''s comments are B''s only'
);
select is(
  app.notifications_withdrawn('feed.post:16000000-0000-4000-8000-0000000000d9', ARRAY['16000000-0000-4000-8000-0000000000a0']::uuid[]),
  true,
  'fact 4 (B lane): notifications_withdrawn answers about B''s row only (B''s is retracted, A''s is not)'
);
reset role;

-- ── 3. Realtime: topics authorised by the TOPIC's tenant membership, never by a host ───────────
-- The lane Realtime builds on a join: S's own JWT, `sub` and `role` only, no tenant claim.
select set_config('request.jwt.claims',
                  json_build_object('sub', '16000000-0000-4000-8000-0000000000a0', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000001:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3: S may join its user: topic in A (a live membership there)'
);
select ok(
  app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000011:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3: …and in B, from the same JWT: topics are not bound to a host'
);
select ok(
  not app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000021:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3: …and never in C, where S has no membership'
);
reset role;
update public.memberships set status = 'blocked', blocked_at = now()
 where tenant_id = '16000000-0000-4000-8000-000000000001' and user_id = '16000000-0000-4000-8000-0000000000a0';
set local role authenticated;
select ok(
  not app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000001:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3 (D-304): blocked in A, S''s A topic closes'
);
select ok(
  app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000011:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3 (D-304): …while its B topic stays open (a block is per membership)'
);
reset role;
update public.memberships set status = 'active', blocked_at = null
 where tenant_id = '16000000-0000-4000-8000-000000000001' and user_id = '16000000-0000-4000-8000-0000000000a0';
insert into public.memberships (tenant_id, user_id, role, status)
values ('16000000-0000-4000-8000-000000000021', '16000000-0000-4000-8000-0000000000a0', 'member', 'invited');
set local role authenticated;
select ok(
  not app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000021:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3: an invited membership in C keeps C closed'
);
reset role;
update public.memberships set status = 'active', deleted_at = now()
 where tenant_id = '16000000-0000-4000-8000-000000000021' and user_id = '16000000-0000-4000-8000-0000000000a0';
set local role authenticated;
select ok(
  not app.realtime_topic_allowed('tenant:16000000-0000-4000-8000-000000000021:user:16000000-0000-4000-8000-0000000000a0'),
  'fact 3: a soft-deleted membership in C keeps C closed'
);
reset role;

select * from finish();
rollback;
