begin;
-- 197-courses-notices.sql — the 08.6 course-notice family executed inside Postgres (08.6-05,
-- COURSE-41, COURSE-48, COURSE-51; D-444, D-446, R-Pitfall 2; 08.6-06, COURSE-46, COURSE-47; D-433,
-- D-449, D-453). A SIBLING of 190, 195 and 196, which stay byte-identical. Plan 07 appends its
-- audience definer here.
--
-- 1. THE LIVE REMINDER RECIPIENTS (`app.course_live_reminder_user_ids(uuid, boolean)`, T-08.6-04):
--    tenant A (store and courses on) holds lives V (open) and W (sold by product Q, which only H
--    holds) and opt-in rows on BOTH for M (member, no Q), H (member, holds Q), S (support), K
--    (member, `blocked_at` set), X (member, membership soft-deleted) and the admin (a row written by
--    the migration role past the insert policy). Asserted in the worker's zero-user
--    `support_tenant` lane: V with the access check → M, H, S (never K, X or the admin); W with the
--    check → H and S only (M lacks Q; S is staff, never locked); W without the check → M, H, S; a
--    null flag checks (fails closed); the lane reads 0 rows of `public.course_live_reminders` itself
--    (own-row policies, R-Pitfall 2) and 3 ids from the definer; H's entitlement revoked → W with the
--    check answers S only (a revoked buyer receives nothing, D-446); A's `store` row disabled → W
--    with the check answers M, H, S again (no product gates anything while the store is off); B's
--    lane answers 0 rows for A's live; a lane with no tenant claim answers 0 rows.
-- 2. THE NOTICE AUDIENCE (`app.course_notice_user_ids()`, 08.6-06, D-449, D-453): in the zero-user
--    lane of A → S, M, H and the two new members L and C (every live `member` and
--    `support_tenant` membership, with or without access); never the admin, the blocked K or the
--    removed X; B's lane answers B's own member only; a claim-less lane answers 0 rows.
-- 3. THE REPLAY AUDIENCE (`app.live_replay_audience_user_ids(uuid)`, 08.6-06, D-433, D-449, R-A7):
--    published course P (sold by product QC, which only C holds) with lessons P1 (paid), P2 (free)
--    and Pd (soft-deleted); draft course D (also sold by QC) with the free lesson D1; recorded lives
--    sold by product QL (which only L holds): R1 replays P1, R2 replays P2, R3 replays D1, R4 replays
--    the removed Pd, R5 (cancelled) replays P2. R1 → S, L (live door), C (course door), never M or H
--    (neither door); R2 → everyone (a free lesson of a published course opens the course door); R3 →
--    S and L only (a draft course closes the course door, even for a free lesson); R4 → nobody (a
--    removed replay lesson); R5 → nobody (a cancelled live); store off → R1 answers every live
--    membership; B's lane answers 0 rows for R1.
-- 4. POSTURE (T-08.6-11): SECURITY DEFINER, empty search_path, `TABLE(user_id uuid)`, executable by
--    `authenticated` and not by `anon`, for the three definers.
--
-- Fixture ids use the `19700000-…` prefix and the tenants `pgtap-notices-a` / `-b`, used by no other
-- file. Like its siblings, this file ROLLS BACK.
select plan(34);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-notices-a', 'Avisos A', '19700000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-notices-b', 'Avisos B', '19700000-0000-4000-8000-000000000011');
select tests.auth_user('admin@notices-a.local', '19700000-0000-4000-8000-000000000002');
select tests.auth_user('s@notices-a.local', '19700000-0000-4000-8000-000000000003');
select tests.auth_user('m@notices-a.local', '19700000-0000-4000-8000-000000000004');
select tests.auth_user('h@notices-a.local', '19700000-0000-4000-8000-000000000005');
select tests.auth_user('k@notices-a.local', '19700000-0000-4000-8000-000000000006');
select tests.auth_user('x@notices-a.local', '19700000-0000-4000-8000-000000000007');
select tests.auth_user('member@notices-b.local', '19700000-0000-4000-8000-000000000012');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000004');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000005');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000006');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000007');
select tests.member('19700000-0000-4000-8000-000000000011', '19700000-0000-4000-8000-000000000012');
-- K is blocked (the column the live predicate reads), X's membership is soft-deleted.
update public.memberships set blocked_at = now()
 where tenant_id = '19700000-0000-4000-8000-000000000001' and user_id = '19700000-0000-4000-8000-000000000006';
update public.memberships set deleted_at = now()
 where tenant_id = '19700000-0000-4000-8000-000000000001' and user_id = '19700000-0000-4000-8000-000000000007';

insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('19700000-0000-4000-8000-000000000001', 'store', true),
  ('19700000-0000-4000-8000-000000000001', 'courses', true),
  ('19700000-0000-4000-8000-000000000011', 'courses', true);

-- Product Q of A sells live W.
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('19700000-0000-4000-8000-0000000000a1', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'Q', 1990);

-- Lives of A: V (open, no product) and W (linked to Q), both scheduled.
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url) values
  ('19700000-0000-4000-8000-000000000b01', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'V', now() + interval '1 day', 60, 'https://example.test/v'),
  ('19700000-0000-4000-8000-000000000b02', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'W', now() + interval '2 days', 60, 'https://example.test/w');
insert into public.store_product_lives (tenant_id, product_id, live_id) values
  ('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000a1', '19700000-0000-4000-8000-000000000b02');

-- Opt-ins on V and W for M, H, S, K, X and the admin, written past the insert policy.
insert into public.course_live_reminders (tenant_id, user_id, live_id)
select '19700000-0000-4000-8000-000000000001', u.id, l.id
  from (values ('19700000-0000-4000-8000-000000000002'::uuid), ('19700000-0000-4000-8000-000000000003'::uuid),
               ('19700000-0000-4000-8000-000000000004'::uuid), ('19700000-0000-4000-8000-000000000005'::uuid),
               ('19700000-0000-4000-8000-000000000006'::uuid), ('19700000-0000-4000-8000-000000000007'::uuid)) u(id)
 cross join (values ('19700000-0000-4000-8000-000000000b01'::uuid), ('19700000-0000-4000-8000-000000000b02'::uuid)) l(id);

-- H holds Q (written as the service lane).
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19700000-0000-4000-8000-0000000000e1', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000005', '19700000-0000-4000-8000-0000000000a1', 'grant', '19700000-0000-4000-8000-000000000002');
reset role;

-- ── 1. the live reminder recipients ────────────────────────────────────────────────────────────
-- The worker's lane: the zero user under the support_tenant claim (notifications system context).
select tests.as_tenant('19700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select x.user_id::text from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b01', true) x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000004'), ('19700000-0000-4000-8000-000000000005') $$,
  'D-444: V with the access check → S, M, H (ordered by user id); never the blocked K, the removed X or the admin');
select results_eq(
  $$ select x.user_id::text from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b02', true) x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000005') $$,
  'D-446 / T-08.6-04: W with the access check → S (staff, never locked) and H (holds Q) only; M lacks Q');
select results_eq(
  $$ select x.user_id::text from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b02', false) x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000004'), ('19700000-0000-4000-8000-000000000005') $$,
  'W without the access check → S, M, H (the cancel notice''s audience, plan 06)');
select results_eq(
  $$ select x.user_id::text from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b02', null) x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000005') $$,
  'a null access flag checks access (fails closed)');
select results_eq(
  $$ select count(*)::int from public.course_live_reminders $$,
  ARRAY[0], 'R-Pitfall 2: the zero-user lane reads NO row of the own-row table itself');
select results_eq(
  $$ select count(*)::int from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b01', true) $$,
  ARRAY[3], 'R-Pitfall 2: the same lane reads the 3 recipients of V through the definer');
reset role;

-- H's entitlement revoked: a revoked buyer receives nothing (D-446).
select tests.as_service();
update public.store_entitlements set status = 'revoked' where id = '19700000-0000-4000-8000-0000000000e1';
reset role;
select tests.as_tenant('19700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select x.user_id::text from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b02', true) x $$,
  $$ values ('19700000-0000-4000-8000-000000000003') $$,
  'D-446 / T-08.6-04: H''s Q revoked → W with the check answers S only (access is checked again at fire time)');
reset role;

-- A's store turned off: no product gates anything, every opted-in live membership is kept.
update public.tenant_modules set enabled = false
 where tenant_id = '19700000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('19700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select x.user_id::text from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b02', true) x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000004'), ('19700000-0000-4000-8000-000000000005') $$,
  'store off: W with the check answers S, M, H (the lock seam answers nothing while the store is off)');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '19700000-0000-4000-8000-000000000001' and module_key = 'store';

-- Tenant pin.
select tests.as_tenant('19700000-0000-4000-8000-000000000011', '19700000-0000-4000-8000-000000000012');
select results_eq(
  $$ select (select count(*) from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b01', true))::int
          + (select count(*) from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b01', false))::int $$,
  ARRAY[0], 'COURSE-51: B''s lane answers 0 rows for A''s live, with or without the check');
reset role;
select tests.as_tenant_without_claims();
select results_eq(
  $$ select count(*)::int from app.course_live_reminder_user_ids('19700000-0000-4000-8000-000000000b01', false) $$,
  ARRAY[0], 'a lane with no tenant claim answers 0 rows');
reset role;

-- ── 2. the notice audience (08.6-06) ───────────────────────────────────────────────────────────
-- Two more live members of A: L (will hold the live product QL) and C (will hold the course product QC).
select tests.auth_user('l@notices-a.local', '19700000-0000-4000-8000-000000000008');
select tests.auth_user('c@notices-a.local', '19700000-0000-4000-8000-000000000009');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000008');
select tests.member('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000009');

select tests.as_tenant('19700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select x.user_id::text from app.course_notice_user_ids() x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000004'),
            ('19700000-0000-4000-8000-000000000005'), ('19700000-0000-4000-8000-000000000008'),
            ('19700000-0000-4000-8000-000000000009') $$,
  'D-449 / D-453: every live member and support membership of A (S, M, H, L, C), with or without access; never the admin, the blocked K or the removed X');
reset role;
select tests.as_tenant('19700000-0000-4000-8000-000000000011', '19700000-0000-4000-8000-000000000012');
select results_eq(
  $$ select x.user_id::text from app.course_notice_user_ids() x $$,
  $$ values ('19700000-0000-4000-8000-000000000012') $$,
  'COURSE-51: B''s lane answers B''s own member only, never a user of A');
reset role;
select tests.as_tenant_without_claims();
select results_eq(
  $$ select count(*)::int from app.course_notice_user_ids() $$,
  ARRAY[0], 'a lane with no tenant claim answers 0 notice recipients');
reset role;

-- ── 3. the replay audience (08.6-06) ───────────────────────────────────────────────────────────
-- Products of A: QL sells the recorded lives, QC sells the courses P and D.
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents) values
  ('19700000-0000-4000-8000-0000000000a2', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'QL', 990),
  ('19700000-0000-4000-8000-0000000000a3', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'QC', 4990);
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, status, published_at) values
  ('19700000-0000-4000-8000-0000000000c1', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'P', 'Ana', 'published', now()),
  ('19700000-0000-4000-8000-0000000000c2', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'D', 'Ana', 'draft', null);
insert into public.store_product_courses (tenant_id, product_id, course_id) values
  ('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000a3', '19700000-0000-4000-8000-0000000000c1'),
  ('19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000a3', '19700000-0000-4000-8000-0000000000c2');
insert into public.course_modules (id, tenant_id, course_id, title, position) values
  ('19700000-0000-4000-8000-0000000000d1', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000c1', 'Módulo P', 1),
  ('19700000-0000-4000-8000-0000000000d2', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000c2', 'Módulo D', 1);
insert into public.course_lessons (id, tenant_id, course_id, module_id, title, description, position, is_free) values
  ('19700000-0000-4000-8000-0000000000f1', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000c1', '19700000-0000-4000-8000-0000000000d1', 'P1', '', 1, false),
  ('19700000-0000-4000-8000-0000000000f2', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000c1', '19700000-0000-4000-8000-0000000000d1', 'P2', '', 2, true),
  ('19700000-0000-4000-8000-0000000000f3', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000c1', '19700000-0000-4000-8000-0000000000d1', 'Pd', '', 3, false),
  ('19700000-0000-4000-8000-0000000000f4', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000c2', '19700000-0000-4000-8000-0000000000d2', 'D1', '', 1, true);
-- Recorded lives (ended yesterday), each replaying one lesson; R5 is cancelled.
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url, replay_lesson_id, cancelled_at) values
  ('19700000-0000-4000-8000-000000000c01', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'R1', now() - interval '1 day', 60, 'https://example.test/r1', '19700000-0000-4000-8000-0000000000f1', null),
  ('19700000-0000-4000-8000-000000000c02', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'R2', now() - interval '1 day', 60, 'https://example.test/r2', '19700000-0000-4000-8000-0000000000f2', null),
  ('19700000-0000-4000-8000-000000000c03', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'R3', now() - interval '1 day', 60, 'https://example.test/r3', '19700000-0000-4000-8000-0000000000f4', null),
  ('19700000-0000-4000-8000-000000000c04', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'R4', now() - interval '1 day', 60, 'https://example.test/r4', '19700000-0000-4000-8000-0000000000f3', null),
  ('19700000-0000-4000-8000-000000000c05', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000002', 'R5', now() - interval '1 day', 60, 'https://example.test/r5', '19700000-0000-4000-8000-0000000000f2', now() - interval '2 days');
insert into public.store_product_lives (tenant_id, product_id, live_id)
select '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-0000000000a2', v.id
  from (values ('19700000-0000-4000-8000-000000000c01'::uuid), ('19700000-0000-4000-8000-000000000c02'::uuid),
               ('19700000-0000-4000-8000-000000000c03'::uuid), ('19700000-0000-4000-8000-000000000c04'::uuid),
               ('19700000-0000-4000-8000-000000000c05'::uuid)) v(id);
-- Pd is removed after R4 points at it.
update public.course_lessons set deleted_at = now() where id = '19700000-0000-4000-8000-0000000000f3';

-- L holds QL (the live door), C holds QC (the course door).
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19700000-0000-4000-8000-0000000000e2', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000008', '19700000-0000-4000-8000-0000000000a2', 'grant', '19700000-0000-4000-8000-000000000002'),
  ('19700000-0000-4000-8000-0000000000e3', '19700000-0000-4000-8000-000000000001', '19700000-0000-4000-8000-000000000009', '19700000-0000-4000-8000-0000000000a3', 'grant', '19700000-0000-4000-8000-000000000002');
reset role;

select tests.as_tenant('19700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select x.user_id::text from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c01') x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000008'),
            ('19700000-0000-4000-8000-000000000009') $$,
  'D-433 / T-08.6-03: R1 (paid P1) → S (staff), L (the live door) and C (the course door); never M or H (neither door)');
select results_eq(
  $$ select x.user_id::text from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c02') x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000004'),
            ('19700000-0000-4000-8000-000000000005'), ('19700000-0000-4000-8000-000000000008'),
            ('19700000-0000-4000-8000-000000000009') $$,
  'R2 (free P2 of the published P) → every live membership: a free lesson opens the course door');
select results_eq(
  $$ select x.user_id::text from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c03') x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000008') $$,
  'EP-61: R3 (free D1 of the DRAFT D) → S and L only: a draft course closes the course door, even for C');
select results_eq(
  $$ select count(*)::int from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c04') $$,
  ARRAY[0], 'EP-61: R4 (its replay lesson removed) → nobody');
select results_eq(
  $$ select count(*)::int from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c05') $$,
  ARRAY[0], 'R5 (cancelled) → nobody, even with a free replay lesson');
select results_eq(
  $$ select count(*)::int from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000b01') $$,
  ARRAY[0], 'a live with no replay lesson (V) → nobody');
reset role;

-- A's store turned off: no product gates anything, every live membership watches R1.
update public.tenant_modules set enabled = false
 where tenant_id = '19700000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('19700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select x.user_id::text from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c01') x $$,
  $$ values ('19700000-0000-4000-8000-000000000003'), ('19700000-0000-4000-8000-000000000004'),
            ('19700000-0000-4000-8000-000000000005'), ('19700000-0000-4000-8000-000000000008'),
            ('19700000-0000-4000-8000-000000000009') $$,
  'store off: R1 answers every live member and support membership');
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '19700000-0000-4000-8000-000000000001' and module_key = 'store';

select tests.as_tenant('19700000-0000-4000-8000-000000000011', '19700000-0000-4000-8000-000000000012');
select results_eq(
  $$ select count(*)::int from app.live_replay_audience_user_ids('19700000-0000-4000-8000-000000000c01') $$,
  ARRAY[0], 'COURSE-51: B''s lane answers 0 rows for A''s live R1');
reset role;

-- ── 4. posture ─────────────────────────────────────────────────────────────────────────────────
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'course_live_reminder_user_ids'),
  true, 'course_live_reminder_user_ids is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any(p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'course_live_reminder_user_ids'),
  'T-08.6-11: course_live_reminder_user_ids pins search_path to empty');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'course_live_reminder_user_ids'),
  'TABLE(user_id uuid)', 'the definer answers user ids only');
select ok(
  has_function_privilege('authenticated', 'app.course_live_reminder_user_ids(uuid, boolean)', 'execute'),
  'authenticated may execute course_live_reminder_user_ids');
select ok(
  not has_function_privilege('anon', 'app.course_live_reminder_user_ids(uuid, boolean)', 'execute'),
  'anon may not execute course_live_reminder_user_ids');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'course_notice_user_ids'),
  true, 'course_notice_user_ids is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any(p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'course_notice_user_ids'),
  'T-08.6-11: course_notice_user_ids pins search_path to empty');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'course_notice_user_ids'),
  'TABLE(user_id uuid)', 'course_notice_user_ids answers user ids only');
select ok(
  has_function_privilege('authenticated', 'app.course_notice_user_ids()', 'execute')
  and not has_function_privilege('anon', 'app.course_notice_user_ids()', 'execute'),
  'T-08.6-08: authenticated may execute course_notice_user_ids, anon may not');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'live_replay_audience_user_ids'),
  true, 'live_replay_audience_user_ids is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any(p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'live_replay_audience_user_ids'),
  'T-08.6-11: live_replay_audience_user_ids pins search_path to empty');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'live_replay_audience_user_ids'),
  'TABLE(user_id uuid)', 'live_replay_audience_user_ids answers user ids only');
select ok(
  has_function_privilege('authenticated', 'app.live_replay_audience_user_ids(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.live_replay_audience_user_ids(uuid)', 'execute'),
  'T-08.6-08: authenticated may execute live_replay_audience_user_ids, anon may not');

select * from finish();
rollback;
