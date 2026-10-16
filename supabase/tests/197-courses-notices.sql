begin;
-- 197-courses-notices.sql — the 08.6 course-notice family executed inside Postgres (08.6-05,
-- COURSE-41, COURSE-48, COURSE-51; D-444, D-446, R-Pitfall 2). A SIBLING of 190, 195 and 196, which
-- stay byte-identical. Plans 06 and 07 append their audience definers here.
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
-- 2. POSTURE (T-08.6-11): SECURITY DEFINER, empty search_path, `TABLE(user_id uuid)`, executable by
--    `authenticated` and not by `anon`.
--
-- Fixture ids use the `19700000-…` prefix and the tenants `pgtap-notices-a` / `-b`, used by no other
-- file. Like its siblings, this file ROLLS BACK.
select plan(15);

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

-- ── 2. posture ─────────────────────────────────────────────────────────────────────────────────
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

select * from finish();
rollback;
