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
-- 5. Courses (08.3-01, COURSE-13; extended by 08.5-01, COURSE-26, D-309): S's entitlement and
--    progress in A open and show nothing in B — through the lane and, since 08.5, through the member
--    definer functions too (`app.course_outline`, `app.course_lesson_access`,
--    `app.course_lesson_states`), which pin `app.tenant_id()` themselves. Since 08.6 (08.6-01,
--    COURSE-51): S's completion and live-reminder opt-in in A reach nothing in B — the member
--    projection (`app.course_member_lessons`) lists no A course, the streak
--    (`app.course_member_streak`) reads 0, and no `course_live_reminders` row shows.
--
-- Fixture ids use the `16000000-…` prefix and the tenants `pgtap-si-a`, `pgtap-si-b` and
-- `pgtap-si-c`, used by no other file. Like its siblings, this file ROLLS BACK, so an interrupted run
-- leaves no identity, membership or tenant behind (SC5 concurrency).
select plan(59);

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
-- Group 5 (08.3-01, COURSE-13): both modules ON in A and B; a product in each (the same name); a
-- published course in each, linked to its tenant's product, with one module and one NON-free lesson;
-- S holds A's product (a grant written as the service lane) and has a progress row on A's lesson.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('16000000-0000-4000-8000-000000000001', 'store', true),
  ('16000000-0000-4000-8000-000000000001', 'courses', true),
  ('16000000-0000-4000-8000-000000000011', 'store', true),
  ('16000000-0000-4000-8000-000000000011', 'courses', true);
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('16000000-0000-4000-8000-000000000e01', '16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a1', 'Curso x', 1990),
  ('16000000-0000-4000-8000-000000000e02', '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'Curso x', 1990);
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, status, published_at) values
  ('16000000-0000-4000-8000-000000000e11', '16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a1', 'x', 'x', 'published', now()),
  ('16000000-0000-4000-8000-000000000e12', '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'x', 'x', 'published', now());
insert into public.store_product_courses (tenant_id, product_id, course_id) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000e01', '16000000-0000-4000-8000-000000000e11'),
  ('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000e02', '16000000-0000-4000-8000-000000000e12');
insert into public.course_modules (id, tenant_id, course_id, title, position) values
  ('16000000-0000-4000-8000-000000000e21', '16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000e11', 'x', 1),
  ('16000000-0000-4000-8000-000000000e22', '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000e12', 'x', 1);
insert into public.course_lessons (id, tenant_id, course_id, module_id, title, position) values
  ('16000000-0000-4000-8000-000000000e31', '16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-000000000e11', '16000000-0000-4000-8000-000000000e21', 'x', 1),
  ('16000000-0000-4000-8000-000000000e32', '16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-000000000e12', '16000000-0000-4000-8000-000000000e22', 'x', 1);
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', '16000000-0000-4000-8000-000000000e31', 12);
select tests.as_service();
insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', '16000000-0000-4000-8000-000000000e01', 'grant', '16000000-0000-4000-8000-0000000000a1');
reset role;
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

-- ── 5. Courses (08.3-01, COURSE-13, D-309): an entitlement in A opens nothing in B ─────────────
-- S holds A's product, so A's course is open in S's A lane; B's course is linked to B's product,
-- which S does not hold. S is `admin_tenant` in B, so B's real lane never locks anything (staff by
-- claim); the member-shaped question "does S's A entitlement open B's course?" is asked through the
-- fail-closed null-role lane in B (T-08.3-04: a null claim takes the member branch).
select tests.as_tenant('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select is(app.course_locked_ids(), '{}'::uuid[],
  'fact 5 (A lane): S holds A''s product, so A''s course is open');
select results_eq(
  $$ select id::text from public.courses where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-000000000e11'],
  'fact 5 (A lane): S reads A''s course and never B''s');
select results_eq(
  $$ select id::text from public.course_lessons where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-000000000e31'],
  'fact 5 (A lane): S reads A''s lesson (open course) and never B''s');
select results_eq(
  $$ select lesson_id::text from public.course_lesson_progress $$,
  ARRAY['16000000-0000-4000-8000-000000000e31'],
  'fact 5 (A lane): S''s own progress row, on A''s lesson');
select is_empty(
  $$ select 1 from public.courses where id = '16000000-0000-4000-8000-000000000e12' $$,
  'fact 5 (A lane): B''s course is not found through S''s A lane');
reset role;
select tests.as_tenant('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'admin_tenant');
select is(app.course_locked_ids(), '{}'::uuid[],
  'fact 5 (B lane): S is admin_tenant in B, so the gate locks nothing for the staff claim');
select results_eq(
  $$ select id::text from public.courses where id::text like '16000000-%' $$,
  ARRAY['16000000-0000-4000-8000-000000000e12'],
  'fact 5 (B lane): S reads B''s course and never A''s');
select results_eq(
  $$ select count(*)::int from public.course_lesson_progress $$,
  ARRAY[0],
  'fact 5 (B lane): S''s A progress row is invisible in B, even to the admin claim');
select results_eq(
  $$ select count(*)::int from public.store_entitlements $$,
  ARRAY[0],
  'fact 5 (B lane): S''s A entitlement is invisible in B');
-- 08.5-01 (D-309, COURSE-26): the member definer functions pin the tenant too.
select is_empty(
  $$ select 1 from app.course_outline('16000000-0000-4000-8000-000000000e11') $$,
  'fact 5 (B lane, 08.5): the outline of A''s course answers zero rows in S''s B lane');
select is(app.course_lesson_access('16000000-0000-4000-8000-000000000e31'), 'missing',
  'fact 5 (B lane, 08.5): A''s lesson is missing in S''s B lane, though S holds A''s product');
select is(
  (select count(*)::int from app.course_lesson_states('16000000-0000-4000-8000-000000000e11')),
  0, 'fact 5 (B lane, 08.5): no lesson and no progress row of A through the evaluator in S''s B lane');
reset role;
select tests.as_tenant('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', null);
select is(app.course_locked_ids(), array['16000000-0000-4000-8000-000000000e12']::uuid[],
  'fact 5 (B, member branch): S''s entitlement in A opens nothing in B — B''s course is locked');
select is_empty(
  $$ select 1 from public.course_lessons where course_id = '16000000-0000-4000-8000-000000000e12' $$,
  'fact 5 (B, member branch): …and its non-free lesson is hidden by the restrictive gate');
reset role;
-- 08.6-01 (COURSE-51, D-309): S completes A's lesson today and opts into a live of A (written as
-- the migration role). The A lane is the positive control; the B lane must show none of it.
update public.course_lesson_progress set completed_at = now()
 where tenant_id = '16000000-0000-4000-8000-000000000001'
   and user_id = '16000000-0000-4000-8000-0000000000a0';
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url) values
  ('16000000-0000-4000-8000-000000000e41', '16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a1', 'x', now() + interval '1 day', 60, 'https://example.test/si');
insert into public.course_live_reminders (tenant_id, user_id, live_id) values
  ('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', '16000000-0000-4000-8000-000000000e41');
select tests.as_tenant('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select results_eq(
  $$ select distinct course_id::text from app.course_member_lessons() $$,
  ARRAY['16000000-0000-4000-8000-000000000e11'],
  'fact 5 (A lane, 08.6): the member projection lists A''s course');
select is(app.course_member_streak(), 1, 'fact 5 (A lane, 08.6): S''s completion today is a 1-day streak in A');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders $$,
  ARRAY[1], 'fact 5 (A lane, 08.6): S sees its own opt-in in A');
reset role;
select tests.as_tenant('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', null);
select is(
  (select count(*)::int from app.course_member_lessons() where course_id = '16000000-0000-4000-8000-000000000e11'),
  0, 'fact 5 (B, member branch, 08.6): the member projection lists no A course in S''s B lane');
select is(app.course_member_streak(), 0,
  'fact 5 (B, member branch, 08.6): S''s completion in A is no streak in B');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders $$,
  ARRAY[0], 'fact 5 (B, member branch, 08.6): S''s opt-in in A is invisible in B');
reset role;

select * from finish();
rollback;
