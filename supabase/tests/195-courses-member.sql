begin;
-- 195-courses-member.sql — the 08.5 member function family executed inside Postgres (08.5-01,
-- COURSE-18..22, COURSE-26; D-423, D-426, D-428, D-429, D-433). A SIBLING of 190-courses.sql, which
-- stays byte-identical (its 137 assertions are the "every 08.3 assertion green" proof).
--
-- 1. THE EVALUATOR (`app.course_lesson_states`, D-428, D-429, EP-25, EP-26, EP-38): course S has
--    module A (stale module rule) with A1 (stale lesson rule), A2 (rule), A3 (free, rule); module B
--    (no rule) with B1 (rule); module C whose only lesson is removed; module D (rule) with D1;
--    module E removed with E1. For member M with no progress: A1 open, A2 `lesson`, A3 open (free),
--    B1 `lesson` (its previous is A3, across the module boundary), D1 `module` (the previous
--    NON-EMPTY module is B: C is skipped), E1 absent; completing A1, A3, B1 opens A2, B1, D1 in turn.
--    Course P (linked to product Q): P1 free, P2 rule. For M (no Q) P2 is `purchase` (purchase
--    before sequence); for H (holds Q) `lesson` until P1 is complete, then open. Staff: nothing
--    locked. A null and an unknown claim on an admin user: the member answers. Store row off: P2 for
--    M falls to `lesson` (the gate answers '{}').
-- 2. THE ACCESS ANSWER (`app.course_lesson_access`, D-426, D-433): a lesson under a removed module, a
--    removed lesson, B's lesson and the draft course's lesson are `missing` for every role; P2 opens
--    for M through the LIVE door V (M holds V's product R); a member holding neither Q nor R gets
--    `purchase` — the cancelled live W, linked to nothing, opens nothing, and opens once un-cancelled;
--    B1 before A3 is `sequence`; a null or unknown claim gets `purchase`.
-- 3. THE PROJECTIONS (D-423, D-431, EP-15): the outline's result columns name no description, video
--    asset id, material or thumbnail; the outline lists P2 by title with `purchase`, numbers modules
--    and lessons by live rank, and answers zero rows for a draft course (admin included) and for B's
--    course; content and materials answer zero rows for a non-buyer and one row each for H; the live
--    cards never name the room link or the replay lesson, and `locked` follows R; the catalogue
--    stats count S's five live lessons and the caller's completions.
-- 4. THE ASSET GATE (`app.course_asset_hidden`, COURSE-20, EP-45): P2's video and material are hidden
--    from a non-buyer and served to H, to M (live door), to admin and support; P1's video is served;
--    an orphan lesson video and E1's video are hidden; a cover image is ungoverned; the body that
--    replaced the kernel stub names `course_lesson_access`; a null or unknown claim is hidden.
--    WR-01 (quick 261016-aqc): P2's material stays hidden from members (and served to admin) once P2
--    is removed, once module P is removed, and once its material row is detached (soft-deleted); a
--    detached material leaves H's material list.
-- 5. THE PROGRESS WITH CHECK (COURSE-21, D-422, D-429, T-08.3-09): own insert and the
--    `on conflict … do update` on an open lesson live; a purchase-locked or sequence-locked lesson,
--    the admin claim's own row and B's lesson from A's lane raise 42501; a free lesson writes for a
--    non-buyer; support writes its own row.
-- 6. POSTURE: the eight functions are SECURITY DEFINER with an empty search_path, executable by
--    `authenticated` and not by `anon`.
-- 7. TENANT PIN (T-08.5-04): from B's member lane, S's outline and A1's content are empty, A1 is
--    `missing`, and P2's video row is not readable.
-- 8. WR-03 DRIFT (quick 261016-aqc): with the evaluator replaced by one that returns no row, the
--    access answer is `missing` (never NULL) for a member and admin, and P1's video is hidden.
--
-- Fixture ids use the `19500000-…` prefix and the tenants `pgtap-courses-member-a` / `-b`, used by
-- no other file. Like its siblings, this file ROLLS BACK.
select plan(86);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-courses-member-a', 'Escola Membro A', '19500000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-courses-member-b', 'Escola Membro B', '19500000-0000-4000-8000-000000000011');
select tests.auth_user('admin@courses-member-a.local', '19500000-0000-4000-8000-000000000002');
select tests.auth_user('support@courses-member-a.local', '19500000-0000-4000-8000-000000000003');
select tests.auth_user('m@courses-member-a.local', '19500000-0000-4000-8000-000000000004');
select tests.auth_user('h@courses-member-a.local', '19500000-0000-4000-8000-000000000005');
select tests.auth_user('n@courses-member-a.local', '19500000-0000-4000-8000-000000000006');
select tests.auth_user('member@courses-member-b.local', '19500000-0000-4000-8000-000000000012');
select tests.member('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select tests.member('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select tests.member('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select tests.member('19500000-0000-4000-8000-000000000011', '19500000-0000-4000-8000-000000000012');

insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('19500000-0000-4000-8000-000000000001', 'store', true),
  ('19500000-0000-4000-8000-000000000001', 'courses', true),
  ('19500000-0000-4000-8000-000000000011', 'store', true),
  ('19500000-0000-4000-8000-000000000011', 'courses', true);

-- Products of A: Q (opens course P), R (opens live V).
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('19500000-0000-4000-8000-0000000000a1', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'Q', 1990),
  ('19500000-0000-4000-8000-0000000000a2', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'R', 990);

-- Courses: S (published, no link), P (published, Q), a draft, and one published course of B.
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, status, published_at) values
  ('19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'S', 'Ana', 'published', now()),
  ('19500000-0000-4000-8000-0000000000c2', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'P', 'Ana', 'published', now()),
  ('19500000-0000-4000-8000-0000000000c3', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'Rascunho', 'Ana', 'draft', null),
  ('19500000-0000-4000-8000-0000000000cb', '19500000-0000-4000-8000-000000000011', '19500000-0000-4000-8000-000000000012', 'S', 'Ana', 'published', now());
insert into public.store_product_courses (tenant_id, product_id, course_id) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000a1', '19500000-0000-4000-8000-0000000000c2');

-- Modules of S: A (1, stale rule), B (2), C (3, only a removed lesson), D (4, rule), E (5, removed).
-- P's module, the draft's module and B's module.
insert into public.course_modules (id, tenant_id, course_id, title, position, requires_previous, deleted_at) values
  ('19500000-0000-4000-8000-0000000000d1', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', 'Módulo A', 1, true, null),
  ('19500000-0000-4000-8000-0000000000d2', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', 'Módulo B', 2, false, null),
  ('19500000-0000-4000-8000-0000000000d3', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', 'Módulo C', 3, false, null),
  ('19500000-0000-4000-8000-0000000000d4', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', 'Módulo D', 4, true, null),
  ('19500000-0000-4000-8000-0000000000d5', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', 'Módulo E', 5, false, now()),
  ('19500000-0000-4000-8000-0000000000d6', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c2', 'Módulo P', 1, false, null),
  ('19500000-0000-4000-8000-0000000000d7', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c3', 'Módulo X', 1, false, null),
  ('19500000-0000-4000-8000-0000000000db', '19500000-0000-4000-8000-000000000011', '19500000-0000-4000-8000-0000000000cb', 'Módulo B', 1, false, null);

-- Assets of A: P1's video and material, P2's video and material, an orphan lesson video, a cover
-- image and E1's video; all ready.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, filename) values
  ('19500000-0000-4000-8000-000000000a01', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'video', 'lesson', 'ready', 'video/mp4', 10, 600, 'p1.mp4'),
  ('19500000-0000-4000-8000-000000000a02', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 10, null, 'p1.pdf'),
  ('19500000-0000-4000-8000-000000000a03', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'video', 'lesson', 'ready', 'video/mp4', 10, 600, 'p2.mp4'),
  ('19500000-0000-4000-8000-000000000a04', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 10, null, 'p2.pdf'),
  ('19500000-0000-4000-8000-000000000a05', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'video', 'lesson', 'ready', 'video/mp4', 10, 60, 'orfao.mp4'),
  ('19500000-0000-4000-8000-000000000a06', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'image', 'cover', 'ready', 'image/webp', 10, null, 'capa.webp'),
  ('19500000-0000-4000-8000-000000000a07', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'video', 'lesson', 'ready', 'video/mp4', 10, 60, 'e1.mp4');

insert into public.course_lessons (id, tenant_id, course_id, module_id, title, description, position, is_free, requires_previous, video_asset_id, deleted_at) values
  ('19500000-0000-4000-8000-0000000000f1', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d1', 'A1', '', 1, false, true, null, null),
  ('19500000-0000-4000-8000-0000000000f2', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d1', 'A2', '', 2, false, true, null, null),
  ('19500000-0000-4000-8000-0000000000f3', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d1', 'A3', '', 3, true, true, null, null),
  ('19500000-0000-4000-8000-0000000000f4', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d2', 'B1', '', 1, false, true, null, null),
  ('19500000-0000-4000-8000-0000000000f5', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d3', 'C1', '', 1, false, false, null, now()),
  ('19500000-0000-4000-8000-0000000000f6', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d4', 'D1', '', 1, false, false, null, null),
  ('19500000-0000-4000-8000-0000000000f7', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c1', '19500000-0000-4000-8000-0000000000d5', 'E1', '', 1, false, false, '19500000-0000-4000-8000-000000000a07', null),
  ('19500000-0000-4000-8000-0000000000f8', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c2', '19500000-0000-4000-8000-0000000000d6', 'Livre', 'aberta', 1, true, false, '19500000-0000-4000-8000-000000000a01', null),
  ('19500000-0000-4000-8000-0000000000f9', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c2', '19500000-0000-4000-8000-0000000000d6', 'Paga', 'segredo', 2, false, true, '19500000-0000-4000-8000-000000000a03', null),
  ('19500000-0000-4000-8000-0000000000fa', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000c3', '19500000-0000-4000-8000-0000000000d7', 'X', '', 1, false, false, null, null),
  ('19500000-0000-4000-8000-0000000000fb', '19500000-0000-4000-8000-000000000011', '19500000-0000-4000-8000-0000000000cb', '19500000-0000-4000-8000-0000000000db', 'A1', '', 1, false, false, null, null);

insert into public.course_lesson_materials (tenant_id, lesson_id, asset_id, position) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000f8', '19500000-0000-4000-8000-000000000a02', 1),
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000f9', '19500000-0000-4000-8000-000000000a04', 1);

-- Lives: V (not cancelled, product R, replays P2) and W (cancelled, no link, replays P2).
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url, replay_lesson_id, cancelled_at) values
  ('19500000-0000-4000-8000-000000000b01', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'V', now() - interval '2 days', 60, 'https://example.test/v', '19500000-0000-4000-8000-0000000000f9', null),
  ('19500000-0000-4000-8000-000000000b02', '19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'W', now() - interval '3 days', 60, 'https://example.test/w', '19500000-0000-4000-8000-0000000000f9', now() - interval '4 days');
insert into public.store_product_lives (tenant_id, product_id, live_id) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-0000000000a2', '19500000-0000-4000-8000-000000000b01');

-- Entitlements: H holds Q, M holds R (written as the service lane).
select tests.as_service();
insert into public.store_entitlements (tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005', '19500000-0000-4000-8000-0000000000a1', 'grant', '19500000-0000-4000-8000-000000000002'),
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000a2', 'grant', '19500000-0000-4000-8000-000000000002');
reset role;

-- ── 1. the evaluator ───────────────────────────────────────────────────────────────────────────
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select results_eq(
  $$ select s.lesson_id::text, coalesce(s.lock_reason, '-')
       from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s order by s.course_seq $$,
  $$ values ('19500000-0000-4000-8000-0000000000f1', '-'), ('19500000-0000-4000-8000-0000000000f2', 'lesson'),
            ('19500000-0000-4000-8000-0000000000f3', '-'), ('19500000-0000-4000-8000-0000000000f4', 'lesson'),
            ('19500000-0000-4000-8000-0000000000f6', 'module') $$,
  'M, no progress: A1 open (stale rule), A2 lesson, A3 open (free), B1 lesson (previous A3, EP-25), D1 module (previous non-empty module B, EP-26)');
select is(
  (select count(*)::int from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s
    where s.lesson_id in ('19500000-0000-4000-8000-0000000000f5', '19500000-0000-4000-8000-0000000000f7')),
  0, 'a removed lesson and a lesson under a removed module are not live: no row');
select results_eq(
  $$ select s.lesson_id::text, s.course_seq, s.module_seq
       from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s order by s.course_seq $$,
  $$ values ('19500000-0000-4000-8000-0000000000f1', 1, 1), ('19500000-0000-4000-8000-0000000000f2', 2, 1),
            ('19500000-0000-4000-8000-0000000000f3', 3, 1), ('19500000-0000-4000-8000-0000000000f4', 4, 2),
            ('19500000-0000-4000-8000-0000000000f6', 5, 3) $$,
  'course order is total and module_seq ranks NON-EMPTY live modules (C is skipped)');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f1', now());
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f2'),
  null, 'A1 complete: A2 opens');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f3', now());
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f4'),
  null, 'A3 complete: B1 opens (its previous live lesson sits in the previous module)');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f4', now());
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f6'),
  null, 'B1 complete: every live lesson of module B is done, so D1 opens');
select results_eq(
  $$ select s.lesson_id::text, coalesce(s.lock_reason, '-')
       from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2') s order by s.course_seq $$,
  $$ values ('19500000-0000-4000-8000-0000000000f8', '-'), ('19500000-0000-4000-8000-0000000000f9', 'purchase') $$,
  'course P for M (no Q): P1 open (free), P2 purchase — purchase is decided before sequence');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f9'),
  'lesson', 'course P for H (holds Q): P2 waits for P1');
reset role;
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at) values
  ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005', '19500000-0000-4000-8000-0000000000f8', now());
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f9'),
  null, 'course P for H: P1 complete, P2 opens');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(
  (select count(*)::int from (
     select lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1')
     union all
     select lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2')) x
    where x.lock_reason is not null),
  0, 'admin_tenant: no lesson of S or P is locked');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000003', 'support_tenant');
select is(
  (select count(*)::int from (
     select lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1')
     union all
     select lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2')) x
    where x.lock_reason is not null),
  0, 'support_tenant: no lesson of S or P is locked');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', null);
select results_eq(
  $$ select coalesce(s.lock_reason, '-')
       from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s order by s.course_seq $$,
  $$ values ('-'), ('lesson'), ('-'), ('lesson'), ('module') $$,
  'EP-38: a null tenant_role claim on an admin USER gets the member answers on S');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f9'),
  'purchase', 'EP-38: a null tenant_role claim on an admin USER is purchase-locked out of P2');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'owner');
select results_eq(
  $$ select coalesce(s.lock_reason, '-')
       from app.course_lesson_states('19500000-0000-4000-8000-0000000000c1') s order by s.course_seq $$,
  $$ values ('-'), ('lesson'), ('-'), ('lesson'), ('module') $$,
  'EP-38: an unknown tenant_role claim gets the member answers (fails closed, T-08.3-04)');
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '19500000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select is(
  (select s.lock_reason from app.course_lesson_states('19500000-0000-4000-8000-0000000000c2') s
    where s.lesson_id = '19500000-0000-4000-8000-0000000000f9'),
  'lesson', 'store row off: the gate answers {} and P2 for M falls to its sequence rule');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '19500000-0000-4000-8000-000000000001' and module_key = 'store';

-- ── 2. the access answer ───────────────────────────────────────────────────────────────────────
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select is(
  array[app.course_lesson_access('19500000-0000-4000-8000-0000000000f7'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000f5'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000fb'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000fa')],
  array['missing', 'missing', 'missing', 'missing'],
  'member: under a removed module, removed, B''s and the draft''s lesson are all missing');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f9'), null,
  'D-433: M holds V''s product R, so P2 opens through the LIVE door despite the course lock');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000003', 'support_tenant');
select is(
  array[app.course_lesson_access('19500000-0000-4000-8000-0000000000f7'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000f5'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000fb'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000fa')],
  array['missing', 'missing', 'missing', 'missing'],
  'support_tenant: the same four are missing (D-426)');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f9'), null,
  'support_tenant: P2 open (staff bypass the purchase and sequence locks)');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(
  array[app.course_lesson_access('19500000-0000-4000-8000-0000000000f7'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000f5'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000fb'),
        app.course_lesson_access('19500000-0000-4000-8000-0000000000fa')],
  array['missing', 'missing', 'missing', 'missing'],
  'admin_tenant: the same four are missing — published-only for every role (D-426)');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f9'), 'purchase',
  'N holds neither Q nor R: P2 is purchase — the cancelled live W (linked to nothing) opens nothing');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f4'), 'sequence',
  'N, no progress: B1 before A3 is sequence (the evaluator''s lesson collapses to sequence)');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f8'), null,
  'N: the free P1 is open (D-429)');
reset role;
update public.course_lives set cancelled_at = null where id = '19500000-0000-4000-8000-000000000b02';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f9'), null,
  'the control: W un-cancelled (linked to nothing, so open to N) opens P2 through the live door');
reset role;
update public.course_lives set cancelled_at = now() - interval '4 days' where id = '19500000-0000-4000-8000-000000000b02';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', null);
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f9'), 'purchase',
  'EP-38: a null claim on an admin USER gets purchase for P2');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'owner');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f9'), 'purchase',
  'EP-38: an unknown claim on an admin USER gets purchase for P2');
reset role;

-- ── 3. the projections ─────────────────────────────────────────────────────────────────────────
select ok(
  pg_get_function_result('app.course_outline(uuid)'::regprocedure) !~* '(description|video_asset_id|material|thumbnail)',
  'D-423: the outline''s result columns name no description, video asset id, material or thumbnail');
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select results_eq(
  $$ select o.lesson_title, coalesce(o.lock_reason, '-')
       from app.course_outline('19500000-0000-4000-8000-0000000000c2') o order by o.course_seq $$,
  $$ values ('Livre', '-'), ('Paga', 'purchase') $$,
  'the outline of P for M lists P2 by title with its purchase lock');
select results_eq(
  $$ select o.lesson_title, o.module_number, o.lesson_number
       from app.course_outline('19500000-0000-4000-8000-0000000000c1') o order by o.course_seq $$,
  $$ values ('A1', 1, 1), ('A2', 1, 2), ('A3', 1, 3), ('B1', 2, 1), ('D1', 3, 1) $$,
  'EP-15: modules and lessons are numbered by live rank, so no removed or empty module leaves a gap');
select is_empty(
  $$ select 1 from app.course_outline('19500000-0000-4000-8000-0000000000c3') $$,
  'the outline of a draft course is empty for a member');
select is_empty(
  $$ select 1 from app.course_outline('19500000-0000-4000-8000-0000000000cb') $$,
  'the outline of B''s course is empty from A''s lane');
select results_eq(
  $$ select s.course_id::text, s.lesson_count, s.duration_seconds, s.completed_count
       from app.course_catalogue_stats() s order by s.course_id $$,
  $$ values ('19500000-0000-4000-8000-0000000000c1', 5, 0, 3), ('19500000-0000-4000-8000-0000000000c2', 2, 1200, 0) $$,
  'catalogue stats: S counts its five live lessons (A1, A2, A3, B1, D1) and M''s three completions; P its two and 1200 ready seconds; no draft, no B');
select is(
  (select o.locked from app.course_live_cards('19500000-0000-4000-8000-000000000b01') o),
  false, 'the live card of V is not locked for M (holds R)');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is_empty(
  $$ select 1 from app.course_outline('19500000-0000-4000-8000-0000000000c3') $$,
  'D-426: the outline of a draft course is empty for the admin too');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is_empty(
  $$ select 1 from app.course_lesson_content('19500000-0000-4000-8000-0000000000f9') $$,
  'PR-1: P2''s content answers zero rows for a member holding neither product');
select is_empty(
  $$ select 1 from app.course_lesson_material_list('19500000-0000-4000-8000-0000000000f9') $$,
  'PR-1: P2''s materials answer zero rows for a member holding neither product');
select is(
  (select o.locked from app.course_live_cards('19500000-0000-4000-8000-000000000b01') o),
  true, 'the live card of V is locked for N (no R)');
select is(
  (select count(*)::int from app.course_live_cards() o
    where o.live_id in ('19500000-0000-4000-8000-000000000b01', '19500000-0000-4000-8000-000000000b02') and o.has_replay),
  2, 'the live cards list both lives, locked or cancelled, and both have a live replay lesson');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select results_eq(
  $$ select c.title, c.description, c.video_asset_id::text, c.video_status, c.duration_seconds
       from app.course_lesson_content('19500000-0000-4000-8000-0000000000f9') c $$,
  $$ values ('Paga', 'segredo', '19500000-0000-4000-8000-000000000a03', 'ready', 600) $$,
  'H (holds Q, P1 done) reads P2''s content: one row');
select results_eq(
  $$ select m.asset_id::text, m.filename, m.position
       from app.course_lesson_material_list('19500000-0000-4000-8000-0000000000f9') m $$,
  $$ values ('19500000-0000-4000-8000-000000000a04', 'p2.pdf', 1) $$,
  'H reads P2''s one material');
reset role;
select ok(
  pg_get_function_result('app.course_live_cards(uuid)'::regprocedure) !~* '(external_url|replay_lesson)',
  'D-431: the live cards never name the room link or the replay lesson');

-- ── 4. the asset gate ──────────────────────────────────────────────────────────────────────────
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), true,
  'T-08.3-05: P2''s video is hidden from a member holding neither product');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), true,
  'T-08.3-08: P2''s material is hidden from a member holding neither product');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a01'), false,
  'P1''s video (free lesson) is served to every member');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a02'), false,
  'P1''s material (free lesson) is served to every member');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a05'), true,
  'an orphan lesson video (held by no lesson) is hidden from a member');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a07'), true,
  'E1''s video (a lesson under a removed module) is hidden from a member');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a06'), false,
  'a cover image is not governed by the course gate');
select is(app.course_asset_hidden(gen_random_uuid()), false,
  'an unknown asset is not governed (the media lane''s own 404 handles it)');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select is(
  array[app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), app.course_asset_hidden('19500000-0000-4000-8000-000000000a04')],
  array[false, false], 'H (holds Q, P1 done): P2''s video and material are served');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select is(
  array[app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), app.course_asset_hidden('19500000-0000-4000-8000-000000000a04')],
  array[false, false], 'M (holds R): P2''s video and material are served through the live door (D-433)');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(
  array[app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'),
        app.course_asset_hidden('19500000-0000-4000-8000-000000000a05')],
  array[false, false, false], 'admin_tenant: P2''s video and material and the orphan video are served');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000003', 'support_tenant');
select is(
  array[app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), app.course_asset_hidden('19500000-0000-4000-8000-000000000a04')],
  array[false, false], 'support_tenant: P2''s video and material are served');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', null);
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), true,
  'EP-38: a null claim on an admin USER is refused P2''s video');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'owner');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a03'), true,
  'EP-38: an unknown claim on an admin USER is refused P2''s video');
reset role;
select ok(
  pg_get_functiondef('app.course_asset_hidden(uuid)'::regprocedure) like '%course_lesson_access%'
  and pg_get_functiondef('app.course_asset_hidden(uuid)'::regprocedure) not like '%select false $$%',
  'EP-45: the courses body replaced the kernel stub in place (same signature)');

-- WR-01 (quick 261016-aqc): a material stays governed after its lesson or module is removed and
-- after it is detached (its row soft-deleted). Each mutation runs as the migration role and is
-- undone before the next scenario, so § 5 onwards sees the original fixture.
update public.course_lessons set deleted_at = now() where id = '19500000-0000-4000-8000-0000000000f9';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), true,
  'WR-01: P2''s material stays hidden from N once P2 is removed');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), true,
  'WR-01: P2''s material is hidden from H (a former buyer) once P2 is removed: no live lesson holds it');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), false,
  'WR-01: admin_tenant is still served P2''s material once P2 is removed');
reset role;
update public.course_lessons set deleted_at = null where id = '19500000-0000-4000-8000-0000000000f9';

update public.course_modules set deleted_at = now() where id = '19500000-0000-4000-8000-0000000000d6';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), true,
  'WR-01: P2''s material stays hidden from N once module P is removed');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), false,
  'WR-01: admin_tenant is still served P2''s material once module P is removed');
reset role;
update public.course_modules set deleted_at = null where id = '19500000-0000-4000-8000-0000000000d6';

update public.course_lesson_materials set deleted_at = now()
 where lesson_id = '19500000-0000-4000-8000-0000000000f9' and asset_id = '19500000-0000-4000-8000-000000000a04';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), true,
  'WR-01: a detached material stays hidden from N');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), true,
  'WR-01: a detached material is hidden from H although P2 is live and open to H');
select is_empty(
  $$ select 1 from app.course_lesson_material_list('19500000-0000-4000-8000-0000000000f9') $$,
  'WR-01: H''s material list of P2 no longer names the detached material');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a04'), false,
  'WR-01: admin_tenant is still served a detached material');
reset role;
update public.course_lesson_materials set deleted_at = null
 where lesson_id = '19500000-0000-4000-8000-0000000000f9' and asset_id = '19500000-0000-4000-8000-000000000a04';

-- ── 5. the progress with check ─────────────────────────────────────────────────────────────────
delete from public.course_lesson_progress where user_id = '19500000-0000-4000-8000-000000000004';
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004');
select lives_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f1', 5) $$,
  'M inserts its own row on the open A1');
select lives_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f1', 9)
     on conflict (tenant_id, user_id, lesson_id) do update
       set last_position_seconds = excluded.last_position_seconds, updated_at = now() $$,
  'M''s insert … on conflict do update on A1 lives (both checks pass)');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f4') $$,
  '42501', null, 'M cannot write B1 while A3 is incomplete (sequence, T-08.3-09)');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000fb') $$,
  '42501', null, 'B''s lesson from A''s lane is refused (it answers missing: the 08.3-01 FK residual is closed)');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000004', '19500000-0000-4000-8000-0000000000f7') $$,
  '42501', null, 'a lesson under a removed module is refused');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006', '19500000-0000-4000-8000-0000000000f9') $$,
  '42501', null, 'N (neither product) cannot write the purchase-locked P2');
select lives_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006', '19500000-0000-4000-8000-0000000000f8', now()) $$,
  'D-429: N writes the free P1 even without buying');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005');
select lives_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, completed_at)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000005', '19500000-0000-4000-8000-0000000000f9', now())
     on conflict (tenant_id, user_id, lesson_id) do update set completed_at = excluded.completed_at $$,
  'H (holds Q, P1 done) writes P2');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', '19500000-0000-4000-8000-0000000000f1') $$,
  '42501', null, 'D-422: the admin_tenant lane writes no progress, not even its own on an open lesson');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000003', 'support_tenant');
select lives_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000003', '19500000-0000-4000-8000-0000000000f1') $$,
  'support_tenant writes its own row like a member');
reset role;

-- ── 6. posture ─────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosecdef
      and p.proname in ('course_lesson_states', 'course_lesson_access', 'course_outline', 'course_lesson_content',
                        'course_lesson_material_list', 'course_live_cards', 'course_catalogue_stats', 'course_asset_hidden')),
  8, 'the eight member functions are SECURITY DEFINER');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and 'search_path=""' = any(p.proconfig)
      and p.proname in ('course_lesson_states', 'course_lesson_access', 'course_outline', 'course_lesson_content',
                        'course_lesson_material_list', 'course_live_cards', 'course_catalogue_stats', 'course_asset_hidden')),
  8, 'the eight member functions pin search_path to empty (T-08.5-05)');
select ok(
  has_function_privilege('authenticated', 'app.course_lesson_states(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.course_lesson_access(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.course_outline(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.course_lesson_content(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.course_lesson_material_list(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.course_live_cards(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.course_catalogue_stats()', 'execute')
  and has_function_privilege('authenticated', 'app.course_asset_hidden(uuid)', 'execute'),
  'authenticated may execute the eight member functions');
select ok(
  not (has_function_privilege('anon', 'app.course_lesson_states(uuid)', 'execute')
       or has_function_privilege('anon', 'app.course_lesson_access(uuid)', 'execute')
       or has_function_privilege('anon', 'app.course_outline(uuid)', 'execute')
       or has_function_privilege('anon', 'app.course_lesson_content(uuid)', 'execute')
       or has_function_privilege('anon', 'app.course_lesson_material_list(uuid)', 'execute')
       or has_function_privilege('anon', 'app.course_live_cards(uuid)', 'execute')
       or has_function_privilege('anon', 'app.course_catalogue_stats()', 'execute')
       or has_function_privilege('anon', 'app.course_asset_hidden(uuid)', 'execute')),
  'anon may execute none of the eight member functions');

-- ── 7. tenant pin ──────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('19500000-0000-4000-8000-000000000011', '19500000-0000-4000-8000-000000000012');
select is_empty(
  $$ select 1 from app.course_outline('19500000-0000-4000-8000-0000000000c1') $$,
  'B''s member lane: the outline of A''s course S is empty');
select is_empty(
  $$ select 1 from app.course_lesson_content('19500000-0000-4000-8000-0000000000f1') $$,
  'B''s member lane: A1''s content is empty');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f1'), 'missing',
  'B''s member lane: A1 is missing');
select is_empty(
  $$ select 1 from public.media_assets where id = '19500000-0000-4000-8000-000000000a03' $$,
  'B''s member lane reads no row of P2''s video (the playback 404 stays structural)');
reset role;

-- ── 8. WR-03 drift simulation ──────────────────────────────────────────────────────────────────
-- The evaluator is replaced (same signature) by a body that returns no row; the file rolls back, so
-- the real evaluator returns at `rollback`.
create or replace function app.course_lesson_states(p_course uuid)
returns table (
  lesson_id uuid,
  module_id uuid,
  course_seq int,
  module_seq int,
  lock_reason text,
  completed_at timestamptz,
  last_position_seconds int
)
language sql stable security definer set search_path = '' as $$
  select null::uuid, null::uuid, null::int, null::int, null::text, null::timestamptz, null::int
   where false
$$;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000006');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f8'), 'missing',
  'WR-03: with no evaluator row the free P1 answers missing to N (fails closed, never NULL)');
select is(app.course_asset_hidden('19500000-0000-4000-8000-000000000a01'), true,
  'WR-03: with no evaluator row P1''s video is hidden from N');
reset role;
select tests.as_tenant('19500000-0000-4000-8000-000000000001', '19500000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.course_lesson_access('19500000-0000-4000-8000-0000000000f8'), 'missing',
  'WR-03: with no evaluator row P1 answers missing to admin_tenant');
reset role;

select * from finish();
rollback;
