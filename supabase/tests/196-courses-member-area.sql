begin;
-- 196-courses-member-area.sql — the 08.6 member-area family executed inside Postgres (08.6-01,
-- COURSE-29, COURSE-37, COURSE-39, COURSE-51; D-437, D-440, D-441, D-443, D-444, D-446). A SIBLING
-- of 190-courses.sql and 195-courses-member.sql, which stay byte-identical.
--
-- 1. THE PROJECTION (`app.course_member_lessons()`, R-Pattern 1, T-08.6-01): for member M it lists
--    the live lessons of the PUBLISHED courses S and P only (never the draft D's), in course order,
--    with the evaluator's lock reason (P's paid lesson `purchase` for M, open for H who holds Q), the
--    ready video's seconds (null for a processing video and for no video), and the caller's OWN
--    completion and touch instants (N's rows never show in M's lane, M's never in N's). Its result
--    signature names no description, video asset id, material, thumbnail or external URL. A lane
--    with no tenant claim gets zero rows; a null and an unknown `tenant_role` claim on an admin USER
--    take the member branch (EP-71, fails closed); the admin claim reads no draft and nothing
--    locked; B's member lane lists no course of A and its own.
-- 2. THE STREAK (`app.course_member_streak()`, D-440, D-441, D-443, EP-31..33): M's completions,
--    written as the migration role at instants built from tenant A's local clock
--    (`America/Sao_Paulo`): today + yesterday + two days ago → 3; yesterday + two days ago → 2 (the
--    streak survives until the end of the next day); two + three days ago → 0; today + two days ago
--    → 1; local yesterday 23:30 + local today 00:30 → 2, two LOCAL dates where a UTC bucketing sees
--    one; three completions today → 1. The SAME UTC instants for B's member on tenant B
--    (`Asia/Tokyo`) are ONE Tokyo date → 1. The admin claim → 0 with a completion row of its own
--    (and 1 for the same user under a member claim: the guard is the claim, D-422); N's completion
--    never counts for M; a completion in a course that is now archived still counts (the history
--    is complete); no tenant claim → 0; the function takes no argument; two calls in one
--    transaction agree.
-- 3. THE REMINDER TABLE (`course_live_reminders`, D-444, D-446, PR-4, EP-37, T-08.6-02, T-08.6-12):
--    M inserts its own row for the open live V; a row naming N, a row for the locked live W (M holds
--    no Q) and a row under the admin claim raise 42501; H (holds Q) opts into W and support opts into
--    V; M's second insert of V raises 23505 on the primary key; N, support, the admin claim and B's
--    lane read none of M's rows (no staff branch); M reads its own; an update affects zero rows (no
--    update policy); M deletes its own row (one) and N's (zero).
-- 4. POSTURE (T-08.6-11): both functions are SECURITY DEFINER with an empty search_path, executable
--    by `authenticated` and not by `anon`; the table carries exactly its three policies and no update
--    policy.
--
-- Fixture ids use the `19600000-…` prefix and the tenants `pgtap-member-area-a` / `-b`, used by no
-- other file. Like its siblings, this file ROLLS BACK.
select plan(54);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-member-area-a', 'Área de Membros A', '19600000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-member-area-b', 'Área de Membros B', '19600000-0000-4000-8000-000000000011');
update public.tenants set timezone = 'America/Sao_Paulo' where id = '19600000-0000-4000-8000-000000000001';
update public.tenants set timezone = 'Asia/Tokyo' where id = '19600000-0000-4000-8000-000000000011';
select tests.auth_user('admin@member-area-a.local', '19600000-0000-4000-8000-000000000002');
select tests.auth_user('support@member-area-a.local', '19600000-0000-4000-8000-000000000003');
select tests.auth_user('m@member-area-a.local', '19600000-0000-4000-8000-000000000004');
select tests.auth_user('n@member-area-a.local', '19600000-0000-4000-8000-000000000005');
select tests.auth_user('h@member-area-a.local', '19600000-0000-4000-8000-000000000006');
select tests.auth_user('member@member-area-b.local', '19600000-0000-4000-8000-000000000012');
select tests.member('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select tests.member('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005');
select tests.member('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000006');
select tests.member('19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012');

insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('19600000-0000-4000-8000-000000000001', 'store', true),
  ('19600000-0000-4000-8000-000000000001', 'courses', true),
  ('19600000-0000-4000-8000-000000000011', 'courses', true);

-- Product Q of A: opens course P and live W.
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('19600000-0000-4000-8000-0000000000a1', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'Q', 1990);

-- Courses: S (published, no link), D (draft), P (published, Q), and one published course of B.
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, status, published_at) values
  ('19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'S', 'Ana', 'published', now()),
  ('19600000-0000-4000-8000-0000000000c2', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'D', 'Ana', 'draft', null),
  ('19600000-0000-4000-8000-0000000000c3', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'P', 'Ana', 'published', now()),
  ('19600000-0000-4000-8000-0000000000cb', '19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012', 'S', 'Ana', 'published', now());
insert into public.store_product_courses (tenant_id, product_id, course_id) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000a1', '19600000-0000-4000-8000-0000000000c3');

-- Modules: S has two (d1, d2); D, P and B's course one each.
insert into public.course_modules (id, tenant_id, course_id, title, position) values
  ('19600000-0000-4000-8000-0000000000d1', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c1', 'Módulo 1', 1),
  ('19600000-0000-4000-8000-0000000000d2', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c1', 'Módulo 2', 2),
  ('19600000-0000-4000-8000-0000000000d3', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c2', 'Módulo D', 1),
  ('19600000-0000-4000-8000-0000000000d4', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c3', 'Módulo P', 1),
  ('19600000-0000-4000-8000-0000000000db', '19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-0000000000cb', 'Módulo B', 1);

-- S's videos: 600 s and 300 s ready, and one still processing (its seconds are not counted).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, filename) values
  ('19600000-0000-4000-8000-000000000a01', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'video', 'lesson', 'ready', 'video/mp4', 10, 600, 's1.mp4'),
  ('19600000-0000-4000-8000-000000000a02', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'video', 'lesson', 'ready', 'video/mp4', 10, 300, 's2.mp4'),
  ('19600000-0000-4000-8000-000000000a03', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'video', 'lesson', 'processing', 'video/mp4', 10, 120, 's3.mp4');

-- Lessons: S1 (free, 600 s), S2 (300 s), S3 (processing), S4 (no video); D1; P1 (free), P2 (paid);
-- B1 and B2 in B.
insert into public.course_lessons (id, tenant_id, course_id, module_id, title, description, position, is_free, video_asset_id) values
  ('19600000-0000-4000-8000-0000000000f1', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000d1', 'S1', 'segredo', 1, true, '19600000-0000-4000-8000-000000000a01'),
  ('19600000-0000-4000-8000-0000000000f2', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000d1', 'S2', 'segredo', 2, false, '19600000-0000-4000-8000-000000000a02'),
  ('19600000-0000-4000-8000-0000000000f3', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000d2', 'S3', 'segredo', 1, false, '19600000-0000-4000-8000-000000000a03'),
  ('19600000-0000-4000-8000-0000000000f4', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000d2', 'S4', 'segredo', 2, false, null),
  ('19600000-0000-4000-8000-0000000000f5', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c2', '19600000-0000-4000-8000-0000000000d3', 'D1', '', 1, false, null),
  ('19600000-0000-4000-8000-0000000000f6', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c3', '19600000-0000-4000-8000-0000000000d4', 'P1', '', 1, true, null),
  ('19600000-0000-4000-8000-0000000000f7', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000c3', '19600000-0000-4000-8000-0000000000d4', 'P2', 'segredo', 2, false, null),
  ('19600000-0000-4000-8000-0000000000fb', '19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-0000000000cb', '19600000-0000-4000-8000-0000000000db', 'B1', '', 1, false, null),
  ('19600000-0000-4000-8000-0000000000fc', '19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-0000000000cb', '19600000-0000-4000-8000-0000000000db', 'B2', '', 2, false, null);

-- Lives of A: V (open, no product) and W (linked to Q), both scheduled.
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url) values
  ('19600000-0000-4000-8000-000000000b01', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'V', now() + interval '1 day', 60, 'https://example.test/v'),
  ('19600000-0000-4000-8000-000000000b02', '19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'W', now() + interval '2 days', 60, 'https://example.test/w');
insert into public.store_product_lives (tenant_id, product_id, live_id) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-0000000000a1', '19600000-0000-4000-8000-000000000b02');

-- H holds Q (written as the service lane).
select tests.as_service();
insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000006', '19600000-0000-4000-8000-0000000000a1', 'grant', '19600000-0000-4000-8000-000000000002');
reset role;

-- ── 1. the projection ──────────────────────────────────────────────────────────────────────────
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select results_eq(
  $$ select x.course_id::text, x.lesson_id::text from app.course_member_lessons() x order by x.course_id, x.course_seq $$,
  $$ values ('19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000f1'),
            ('19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000f2'),
            ('19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000f3'),
            ('19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000f4'),
            ('19600000-0000-4000-8000-0000000000c3', '19600000-0000-4000-8000-0000000000f6'),
            ('19600000-0000-4000-8000-0000000000c3', '19600000-0000-4000-8000-0000000000f7') $$,
  'M: the live lessons of the PUBLISHED courses S and P only, in course order — never the draft D''s (D-426)');
select results_eq(
  $$ select x.lesson_id::text, coalesce(x.lock_reason, '-') from app.course_member_lessons() x
      where x.course_id = '19600000-0000-4000-8000-0000000000c3' order by x.course_seq $$,
  $$ values ('19600000-0000-4000-8000-0000000000f6', '-'), ('19600000-0000-4000-8000-0000000000f7', 'purchase') $$,
  'M (no Q): P1 open (free), P2 purchase — the evaluator''s answer, unchanged');
select results_eq(
  $$ select x.lesson_id::text, coalesce(x.duration_seconds, -1) from app.course_member_lessons() x
      where x.course_id = '19600000-0000-4000-8000-0000000000c1' order by x.course_seq $$,
  $$ values ('19600000-0000-4000-8000-0000000000f1', 600), ('19600000-0000-4000-8000-0000000000f2', 300),
            ('19600000-0000-4000-8000-0000000000f3', -1), ('19600000-0000-4000-8000-0000000000f4', -1) $$,
  'duration_seconds is the READY video''s seconds; null for a processing video and for no video');
select results_eq(
  $$ select x.lesson_id::text, x.course_seq, x.module_seq, x.module_title from app.course_member_lessons() x
      where x.course_id = '19600000-0000-4000-8000-0000000000c1' order by x.course_seq $$,
  $$ values ('19600000-0000-4000-8000-0000000000f1', 1, 1, 'Módulo 1'), ('19600000-0000-4000-8000-0000000000f2', 2, 1, 'Módulo 1'),
            ('19600000-0000-4000-8000-0000000000f3', 3, 2, 'Módulo 2'), ('19600000-0000-4000-8000-0000000000f4', 4, 2, 'Módulo 2') $$,
  'course_seq, module_seq and the module title come with every row');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f1', now()),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005', '19600000-0000-4000-8000-0000000000f2', now());
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select results_eq(
  $$ select x.lesson_id::text from app.course_member_lessons() x
      where x.completed_at is not null or x.touched_at is not null order by x.lesson_id $$,
  ARRAY['19600000-0000-4000-8000-0000000000f1'],
  'M''s completed and touched instants appear only on M''s own row (N''s S2 never)');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005');
select results_eq(
  $$ select x.lesson_id::text from app.course_member_lessons() x
      where x.completed_at is not null or x.touched_at is not null order by x.lesson_id $$,
  ARRAY['19600000-0000-4000-8000-0000000000f2'],
  'N''s lane shows N''s own row only (M''s S1 never)');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000006');
select is(
  (select x.lock_reason from app.course_member_lessons() x where x.lesson_id = '19600000-0000-4000-8000-0000000000f7'),
  null, 'H (holds Q): P2 is open');
reset role;
select ok(
  pg_get_function_result('app.course_member_lessons()'::regprocedure) !~* '(description|video_asset_id|material|thumbnail|external_url)',
  'the projection''s result columns name no description, video asset id, material, thumbnail or external URL (titles only, D-423)');
select tests.as_tenant_without_claims();
select is((select count(*)::int from app.course_member_lessons()), 0,
  'EP-71: a lane with no tenant claim gets zero rows');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', null);
select is(
  (select x.lock_reason from app.course_member_lessons() x where x.lesson_id = '19600000-0000-4000-8000-0000000000f7'),
  'purchase', 'EP-71: a null tenant_role claim on an admin USER takes the member branch (P2 purchase)');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'owner');
select is(
  (select x.lock_reason from app.course_member_lessons() x where x.lesson_id = '19600000-0000-4000-8000-0000000000f7'),
  'purchase', 'EP-71: an unknown tenant_role claim takes the member branch (P2 purchase)');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'admin_tenant');
select is(
  (select count(*)::int from app.course_member_lessons() x where x.course_id = '19600000-0000-4000-8000-0000000000c2'),
  0, 'the admin claim reads no draft either (published only, every role)');
select is(
  (select x.lock_reason from app.course_member_lessons() x where x.lesson_id = '19600000-0000-4000-8000-0000000000f7'),
  null, 'the admin claim: nothing is locked (the evaluator''s staff branch)');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012');
select is(
  (select count(*)::int from app.course_member_lessons() x
    where x.course_id in ('19600000-0000-4000-8000-0000000000c1', '19600000-0000-4000-8000-0000000000c3')),
  0, 'T-08.6-01: B''s member lane lists no course of A');
select results_eq(
  $$ select distinct x.course_id::text from app.course_member_lessons() x $$,
  ARRAY['19600000-0000-4000-8000-0000000000cb'],
  'B''s member lane lists its own course');
reset role;

-- ── 2. the streak ──────────────────────────────────────────────────────────────────────────────
-- Instants are built from tenant A's local clock: `(local date - k + local time) at time zone tz`.
delete from public.course_lesson_progress where tenant_id = '19600000-0000-4000-8000-000000000001';
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f1',
   ((now() at time zone 'America/Sao_Paulo')::date + time '12:00') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f2',
   ((now() at time zone 'America/Sao_Paulo')::date - 1 + time '12:00') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f3',
   ((now() at time zone 'America/Sao_Paulo')::date - 2 + time '12:00') at time zone 'America/Sao_Paulo');
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 3, 'EP-31: today, yesterday and two days ago → 3');
reset role;
delete from public.course_lesson_progress
 where user_id = '19600000-0000-4000-8000-000000000004' and lesson_id = '19600000-0000-4000-8000-0000000000f1';
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 2,
  'D-441: yesterday and two days ago → 2 (the streak survives until the end of the next day)');
reset role;
delete from public.course_lesson_progress where user_id = '19600000-0000-4000-8000-000000000004';
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f1',
   ((now() at time zone 'America/Sao_Paulo')::date - 2 + time '12:00') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f2',
   ((now() at time zone 'America/Sao_Paulo')::date - 3 + time '12:00') at time zone 'America/Sao_Paulo');
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 0,
  'EP-31: two and three days ago → 0 (a full local day passed with no completion)');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f3',
   ((now() at time zone 'America/Sao_Paulo')::date + time '12:00') at time zone 'America/Sao_Paulo');
delete from public.course_lesson_progress
 where user_id = '19600000-0000-4000-8000-000000000004' and lesson_id = '19600000-0000-4000-8000-0000000000f2';
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 1, 'today and two days ago → 1 (the gap breaks the run)');
reset role;
delete from public.course_lesson_progress where user_id = '19600000-0000-4000-8000-000000000004';
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f1',
   ((now() at time zone 'America/Sao_Paulo')::date - 1 + time '23:30') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f2',
   ((now() at time zone 'America/Sao_Paulo')::date + time '00:30') at time zone 'America/Sao_Paulo');
select is(
  (select count(distinct (p.completed_at at time zone 'America/Sao_Paulo')::date)::int
     from public.course_lesson_progress p where p.user_id = '19600000-0000-4000-8000-000000000004'),
  2, 'EP-32: local yesterday 23:30 and local today 00:30 are two São Paulo dates');
select is(
  (select count(distinct (p.completed_at at time zone 'UTC')::date)::int
     from public.course_lesson_progress p where p.user_id = '19600000-0000-4000-8000-000000000004'),
  1, 'EP-32: …and ONE UTC date (02:30Z and 03:30Z), so a UTC bucketing would answer 1');
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 2,
  'EP-32 / Pitfall 8: the streak buckets by the tenant''s local date → 2');
reset role;
delete from public.course_lesson_progress where user_id = '19600000-0000-4000-8000-000000000004';
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f1',
   ((now() at time zone 'America/Sao_Paulo')::date + time '09:00') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f2',
   ((now() at time zone 'America/Sao_Paulo')::date + time '12:00') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f3',
   ((now() at time zone 'America/Sao_Paulo')::date + time '15:00') at time zone 'America/Sao_Paulo');
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 1, 'EP-33: three completions on one local date count one day');
reset role;
-- The SAME UTC instants as the EP-32 pair, for B's member on tenant B (Asia/Tokyo).
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012', '19600000-0000-4000-8000-0000000000fb',
   ((now() at time zone 'America/Sao_Paulo')::date - 1 + time '23:30') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012', '19600000-0000-4000-8000-0000000000fc',
   ((now() at time zone 'America/Sao_Paulo')::date + time '00:30') at time zone 'America/Sao_Paulo');
select is(
  (select count(distinct (p.completed_at at time zone 'Asia/Tokyo')::date)::int
     from public.course_lesson_progress p where p.user_id = '19600000-0000-4000-8000-000000000012'),
  1, 'EP-32: the same two UTC instants are ONE Tokyo date');
select tests.as_tenant('19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012');
select is(app.course_member_streak(), 1,
  'EP-32: B''s member, bucketed by B''s own timezone (Asia/Tokyo) → 1 where São Paulo answers 2');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', '19600000-0000-4000-8000-0000000000f1', now());
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.course_member_streak(), 0,
  'EP-31 / D-422: the admin_tenant claim answers 0 even with a completed row of its own');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'member');
select is(app.course_member_streak(), 1,
  'the control: the same user under a member claim counts that row (the guard is the claim)');
reset role;
delete from public.course_lesson_progress where user_id = '19600000-0000-4000-8000-000000000004';
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f1',
   ((now() at time zone 'America/Sao_Paulo')::date - 2 + time '12:00') at time zone 'America/Sao_Paulo'),
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005', '19600000-0000-4000-8000-0000000000f1', now());
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 0,
  'EP-31: M''s only completion is two local days old → 0, and N''s completion today never counts for M');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005');
select is(app.course_member_streak(), 1, 'the control: N''s own completion today is N''s 1-day streak');
reset role;
update public.courses set status = 'archived', archived_at = now() where id = '19600000-0000-4000-8000-0000000000c2';
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-0000000000f5', now());
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select is(app.course_member_streak(), 1,
  'D-440: a completion in a course that is now archived still counts (the history is complete)');
select is(app.course_member_streak(), (select app.course_member_streak()),
  'EP-33: two calls in one transaction answer the same value (one now())');
reset role;
select tests.as_tenant_without_claims();
select is(app.course_member_streak(), 0, 'EP-71: a lane with no tenant claim answers 0');
reset role;
select is(pg_get_function_arguments('app.course_member_streak()'::regprocedure), '',
  'EP-33 / T-08.6-05: the streak takes no argument (nothing from the client can reach it)');

-- ── 3. the reminder table ──────────────────────────────────────────────────────────────────────
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-000000000b01') $$,
  'D-444: M opts into the open live V (its own row)');
select throws_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005', '19600000-0000-4000-8000-000000000b01') $$,
  '42501', null, 'M cannot write a row naming N');
select throws_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-000000000b02') $$,
  '42501', null, 'D-446 / T-08.6-02: M (no Q) cannot opt into the locked live W');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000006');
select lives_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000006', '19600000-0000-4000-8000-000000000b02') $$,
  'H (holds Q) opts into W');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', '19600000-0000-4000-8000-000000000b01') $$,
  '42501', null, 'D-422 / T-08.6-02: the admin_tenant claim writes no opt-in, not even its own');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000003', 'support_tenant');
select lives_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000003', '19600000-0000-4000-8000-000000000b01') $$,
  'support_tenant opts into V like a member');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.course_live_reminders (tenant_id, user_id, live_id)
     values ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004', '19600000-0000-4000-8000-000000000b01') $$,
  '23505', null, 'EP-37: M''s second opt-in of V raises 23505 on the primary key');
reset role;
insert into public.course_live_reminders (tenant_id, user_id, live_id) values
  ('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005', '19600000-0000-4000-8000-000000000b01');
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders where user_id = '19600000-0000-4000-8000-000000000004' $$,
  ARRAY[0], 'PR-4: N reads none of M''s opt-ins');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders where user_id <> '19600000-0000-4000-8000-000000000003' $$,
  ARRAY[0], 'PR-4 / T-08.6-12: support reads no member''s opt-in (no staff branch)');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders $$,
  ARRAY[0], 'PR-4: the admin claim reads no opt-in either');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000011', '19600000-0000-4000-8000-000000000012');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders where tenant_id = '19600000-0000-4000-8000-000000000001' $$,
  ARRAY[0], 'B''s lane reads none of A''s opt-ins');
reset role;
select tests.as_tenant('19600000-0000-4000-8000-000000000001', '19600000-0000-4000-8000-000000000004');
select results_eq(
  $$ select live_id::text from public.course_live_reminders $$,
  ARRAY['19600000-0000-4000-8000-000000000b01'], 'M reads exactly its own opt-in');
select results_eq(
  $$ with u as (update public.course_live_reminders set created_at = now() returning 1) select count(*)::int from u $$,
  ARRAY[0], 'D-444: no update policy, so an update affects zero rows');
select results_eq(
  $$ with d as (delete from public.course_live_reminders
                 where user_id = '19600000-0000-4000-8000-000000000004'
                   and live_id = '19600000-0000-4000-8000-000000000b01' returning 1)
     select count(*)::int from d $$,
  ARRAY[1], 'M deletes its own opt-in (one row)');
select results_eq(
  $$ with d as (delete from public.course_live_reminders where user_id = '19600000-0000-4000-8000-000000000005' returning 1)
     select count(*)::int from d $$,
  ARRAY[0], 'M''s delete aimed at N''s opt-in touches nothing');
reset role;

-- ── 4. posture ─────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef and p.proname in ('course_member_lessons', 'course_member_streak')),
  2, 'both member-area functions are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and 'search_path=""' = any(p.proconfig)
      and p.proname in ('course_member_lessons', 'course_member_streak')),
  2, 'T-08.6-11: both member-area functions pin search_path to empty');
select ok(
  has_function_privilege('authenticated', 'app.course_member_lessons()', 'execute')
  and has_function_privilege('authenticated', 'app.course_member_streak()', 'execute'),
  'authenticated may execute both member-area functions');
select ok(
  not (has_function_privilege('anon', 'app.course_member_lessons()', 'execute')
       or has_function_privilege('anon', 'app.course_member_streak()', 'execute')),
  'anon may execute neither member-area function');
select results_eq(
  $$ select policyname::text collate "default" from pg_policies where schemaname = 'public' and tablename = 'course_live_reminders' order by 1 $$,
  ARRAY['course_live_reminders_delete_own', 'course_live_reminders_insert_own', 'course_live_reminders_select_own'],
  'course_live_reminders carries exactly its three own-row policies');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'course_live_reminders' and cmd = 'UPDATE'),
  0, 'course_live_reminders has no update policy');

select * from finish();
rollback;
