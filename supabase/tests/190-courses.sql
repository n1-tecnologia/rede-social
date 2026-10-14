begin;
-- 190-courses.sql — the courses tables, the course and live gate seam, the restrictive lesson policy
-- and the progress ledger, executed inside Postgres (08.3-01, COURSE-08, COURSE-09, COURSE-13; D-403,
-- D-404, D-405, D-407, D-408, D-413). Numbered 190 after 180 (08.2).
--
-- Sets are compared SORTED (`array(select unnest(…) order by 1)`): the answer is a set and no
-- caller relies on its order.
--
-- 1. THE GATE TRUTH TABLE (P32, T-08.3-04; rows of `app.course_locked_ids()` / `app.live_locked_ids()`
--    in a lane, the 180 rows one for one): a course with no link is open to a member; a linked
--    course is locked for a member who holds no active entitlement to ANY of its products; holding
--    one of its products opens it, and revoking one of two held products keeps it open;
--    `admin_tenant` and `support_tenant` always get the empty set (by claim in the lane form, by
--    membership in the `_for` form); a null or unknown `tenant_role` claim takes the MEMBER branch
--    even for an admin user (fails closed); a course whose only product is archived stays locked for
--    non-holders and opens for a holder; the live pair follows the same rule. Since 08.4 (D-418)
--    the link fixtures live in the store-owned `store_product_courses` / `store_product_lives`.
--    With the tenant's `store` row disabled, then deleted, and with its `courses` row disabled,
--    then deleted, every lane gets the empty set while link rows exist (P02).
--
-- 2. THE RESTRICTIVE LESSON POLICY AND THE DRAFT RULE (D-407, D-413, T-08.3-03): a member locked
--    out of a course reads exactly its `is_free` lessons and their materials; holding a product opens
--    the rest; a member reads no `draft` course, none of its modules and none of its lessons;
--    `admin_tenant` reads everything, `support_tenant` every lesson but no draft. The RESTRICTIVE
--    live policy (WR-01 of the 08.3 review) mirrors it: a member locked out of a live reads no row of
--    it (its `external_url` is the paid room link), holding the product opens it, staff read all.
--
-- 3. WRITES ARE THE ADMIN CLAIM'S (D-403, T-08.3-01, T-08.4-03): on each of the eight course
--    catalogue tables and on the store's two link tables `store_product_courses` /
--    `store_product_lives` (08.4, D-418: the links ARE the gate) the member lane's insert raises
--    42501 and its update and delete touch nothing; on the two link tables the member and
--    `support_tenant` lanes are refused insert (42501), touch 0 rows on update and delete, and
--    `truncate` raises 42501 (the privilege is revoked: TRUNCATE is not subject to RLS); the
--    `admin_tenant` lane writes (it inserts then deletes one link of each kind, leaving the fixture
--    as it was), and still cannot stamp another tenant's id.
--
-- 4. THE PROGRESS LEDGER (D-408, COURSE-09, P37, P38): a member selects only its own rows, inserts
--    only for itself (another member's user id is 42501), updates its own, and cannot delete (42501,
--    the privilege is revoked); the admin lane reads the tenant's rows and cannot delete either; a
--    second insert of the same key is 23505 (the PK is the arbiter); a row stamped with another
--    tenant's id is 42501.
--
-- 5. CHECKS AND UNIQUES: every CHECK of the nine course tables rejects a violating row written as the
--    service lane; a category name is unique per tenant ignoring case; one video asset per LIVE
--    lesson, freed by a soft delete.
--
-- 6. POSTURE: the four gate functions are SECURITY DEFINER with an empty search_path, executable by
--    `authenticated` and not by `anon`; every one of the nine course tables has RLS; the lesson gate
--    and the live gate are RESTRICTIVE; the progress ledger has no delete policy and `authenticated`
--    holds no delete privilege on it; neither 08.3 link table exists any more (08.4-02 dropped
--    `course_products` and `course_live_products`; the store tables are the only links).
--
-- Fixture ids use the `19000000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(137);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-courses-a', 'Escola A', '19000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-courses-b', 'Escola B', '19000000-0000-4000-8000-000000000011');
select tests.auth_user('admin@courses-a.local', '19000000-0000-4000-8000-000000000002');
select tests.auth_user('support@courses-a.local', '19000000-0000-4000-8000-000000000003');
select tests.auth_user('m1@courses-a.local', '19000000-0000-4000-8000-000000000004');
select tests.auth_user('m2@courses-a.local', '19000000-0000-4000-8000-000000000005');
select tests.auth_user('member@courses-b.local', '19000000-0000-4000-8000-000000000012');
select tests.member('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'admin_tenant');
select tests.member('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'support_tenant');
select tests.member('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select tests.member('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005');
select tests.member('19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000012');

-- Both modules ON for both tenants (the gate reads both flags).
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('19000000-0000-4000-8000-000000000001', 'store', true),
  ('19000000-0000-4000-8000-000000000001', 'courses', true),
  ('19000000-0000-4000-8000-000000000011', 'store', true),
  ('19000000-0000-4000-8000-000000000011', 'courses', true);

-- Products of A: P1, P2 (active), P3 (archived); one of B with the same name.
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'x', 1990, 'active'),
  ('19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'P2', 500, 'active'),
  ('19000000-0000-4000-8000-0000000000a3', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'P3', 100, 'archived'),
  ('19000000-0000-4000-8000-0000000000b1', '19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000012', 'x', 1990, 'active');

-- Categories of A: K1 (one course), K2 (none).
insert into public.course_categories (id, tenant_id, name) values
  ('19000000-0000-4000-8000-0000000000e1', '19000000-0000-4000-8000-000000000001', 'Lábios'),
  ('19000000-0000-4000-8000-0000000000e2', '19000000-0000-4000-8000-000000000001', 'Pele');

-- Courses of A: C_open (published, no link), C_one (P1), C_two (P1 and P2), C_arch (only the archived
-- P3), C_draft (draft, no link). One published course of B with the same title.
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, category_id, status, published_at) values
  ('19000000-0000-4000-8000-0000000000c0', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Aberto', 'Ana', null, 'published', now()),
  ('19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'x', 'Ana', '19000000-0000-4000-8000-0000000000e1', 'published', now()),
  ('19000000-0000-4000-8000-0000000000c2', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Dois', 'Ana', null, 'published', now()),
  ('19000000-0000-4000-8000-0000000000c3', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Arquivo', 'Ana', null, 'published', now()),
  ('19000000-0000-4000-8000-0000000000c4', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Rascunho', 'Ana', null, 'draft', null),
  ('19000000-0000-4000-8000-0000000000cb', '19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000012', 'x', 'Ana', null, 'published', now());

insert into public.store_product_courses (tenant_id, product_id, course_id) values
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-0000000000c1'),
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-0000000000c2'),
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-0000000000c2'),
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a3', '19000000-0000-4000-8000-0000000000c3');

-- Modules: one in C_open (…d0), one in C_one (…d1), one in C_draft (…d4), one in B's course (…db).
insert into public.course_modules (id, tenant_id, course_id, title, position) values
  ('19000000-0000-4000-8000-0000000000d0', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0', 'M', 1),
  ('19000000-0000-4000-8000-0000000000d1', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c1', 'M', 1),
  ('19000000-0000-4000-8000-0000000000d4', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c4', 'M', 1),
  ('19000000-0000-4000-8000-0000000000db', '19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-0000000000cb', 'M', 1);

-- Assets of A: two ready attachments (materials) and two pending lesson videos.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, filename) values
  ('19000000-0000-4000-8000-0000000000a7', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 10, 'a.pdf'),
  ('19000000-0000-4000-8000-0000000000a8', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'file', 'attachment', 'ready', 'application/pdf', 10, 'b.pdf'),
  ('19000000-0000-4000-8000-0000000000a9', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'video', 'lesson', 'pending', 'video/mp4', 10, 'aula.mp4'),
  ('19000000-0000-4000-8000-0000000000aa', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'video', 'lesson', 'pending', 'video/mp4', 10, 'aula2.mp4');

-- Lessons: L_open in C_open (…f0), L_free and L_paid in C_one (…f1, …f2), one in C_draft (…f4), one in
-- B's course (…fb).
insert into public.course_lessons (id, tenant_id, course_id, module_id, title, is_free, position) values
  ('19000000-0000-4000-8000-0000000000f0', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0', '19000000-0000-4000-8000-0000000000d0', 'Aberta', false, 1),
  ('19000000-0000-4000-8000-0000000000f1', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000d1', 'Amostra', true, 1),
  ('19000000-0000-4000-8000-0000000000f2', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000d1', 'Paga', false, 2),
  ('19000000-0000-4000-8000-0000000000f4', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c4', '19000000-0000-4000-8000-0000000000d4', 'Rascunho', false, 1),
  ('19000000-0000-4000-8000-0000000000fb', '19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-0000000000cb', '19000000-0000-4000-8000-0000000000db', 'B', false, 1);

insert into public.course_lesson_materials (id, tenant_id, lesson_id, asset_id, position) values
  ('19000000-0000-4000-8000-0000000000b7', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000f1', '19000000-0000-4000-8000-0000000000a7', 1),
  ('19000000-0000-4000-8000-0000000000b8', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000f2', '19000000-0000-4000-8000-0000000000a8', 1);

-- A track over C_open; lives V_open (no product) and V_one (P1).
insert into public.course_tracks (id, tenant_id, title) values
  ('19000000-0000-4000-8000-0000000000d9', '19000000-0000-4000-8000-000000000001', 'Trilha');
insert into public.course_track_courses (tenant_id, track_id, course_id, position) values
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000d9', '19000000-0000-4000-8000-0000000000c0', 1);
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url) values
  ('19000000-0000-4000-8000-000000000a50', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Aberta', now() + interval '1 day', 60, 'https://example.test/open'),
  ('19000000-0000-4000-8000-000000000a51', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Paga', now() + interval '1 day', 60, 'https://example.test/paid');
insert into public.store_product_lives (tenant_id, product_id, live_id) values
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-000000000a51');

-- Progress: M1 and M2 each on L_free.
insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds) values
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', '19000000-0000-4000-8000-0000000000f1', 30),
  ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005', '19000000-0000-4000-8000-0000000000f1', 45);

-- ── 1. the truth table, before anyone holds anything ───────────────────────────────────────────
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c2', '19000000-0000-4000-8000-0000000000c3']::uuid[],
  'member M1 with nothing: every linked course is locked, the unlinked C_open and the draft are not');
select is(array(select unnest(app.course_locked_ids_for('19000000-0000-4000-8000-000000000004')) order by 1),
  array(select unnest(app.course_locked_ids()) order by 1),
  'the explicit form agrees with the lane form for the same member');
select is(app.course_locked_ids_for('19000000-0000-4000-8000-000000000002'), '{}'::uuid[],
  'the explicit form: an admin_tenant by MEMBERSHIP gets the empty set');
select is(app.course_locked_ids_for('19000000-0000-4000-8000-000000000003'), '{}'::uuid[],
  'the explicit form: a support_tenant by MEMBERSHIP gets the empty set');
select is(app.live_locked_ids(), array['19000000-0000-4000-8000-000000000a51']::uuid[],
  'lives: M1 is locked out of V_one (P1) and not of V_open (no link)');
select is(app.live_locked_ids_for('19000000-0000-4000-8000-000000000004'), array['19000000-0000-4000-8000-000000000a51']::uuid[],
  'lives: the explicit form agrees');
select is(app.live_locked_ids_for('19000000-0000-4000-8000-000000000002'), '{}'::uuid[],
  'lives: an admin_tenant by MEMBERSHIP gets the empty set');

-- Null and unknown role claims fail CLOSED (T-08.3-04): even an admin USER takes the member branch.
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', null);
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c2', '19000000-0000-4000-8000-0000000000c3']::uuid[],
  'a null tenant_role claim is treated as member');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', null);
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c2', '19000000-0000-4000-8000-0000000000c3']::uuid[],
  'a null tenant_role claim for an admin USER still takes the member branch (the claim decides)');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'owner');
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c2', '19000000-0000-4000-8000-0000000000c3']::uuid[],
  'an unknown tenant_role claim is treated as member');

-- Staff lanes: the empty set.
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.course_locked_ids(), '{}'::uuid[], 'admin_tenant lane: no course locked');
select is(app.live_locked_ids(), '{}'::uuid[], 'admin_tenant lane: no live locked');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.course_locked_ids(), '{}'::uuid[], 'support_tenant lane: no course locked');
select is(app.live_locked_ids(), '{}'::uuid[], 'support_tenant lane: no live locked');

-- ── 1. holding products (entitlements written as the service lane) ─────────────────────────────
reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19000000-0000-4000-8000-0000000000e9', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004',
   '19000000-0000-4000-8000-0000000000a1', 'grant', '19000000-0000-4000-8000-000000000002');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.course_locked_ids()) order by 1), array['19000000-0000-4000-8000-0000000000c3']::uuid[],
  'M1 holding P1: C_one and C_two open (P1 opens both), C_arch stays locked');
select is(app.live_locked_ids(), '{}'::uuid[], 'M1 holding P1: V_one opens too');

reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19000000-0000-4000-8000-0000000000ea', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004',
   '19000000-0000-4000-8000-0000000000a2', 'grant', '19000000-0000-4000-8000-000000000002');
update public.store_entitlements set status = 'revoked', revoked_at = now()
 where id = '19000000-0000-4000-8000-0000000000e9';
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c3']::uuid[],
  'M1 held P1 and P2, P1 revoked: C_two stays open through P2 (P32), C_one locks again');
select is(app.live_locked_ids(), array['19000000-0000-4000-8000-000000000a51']::uuid[],
  'P1 revoked: V_one locks again');

-- An archived product still locks its course for non-holders and opens it for a holder (A4).
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005');
select ok('19000000-0000-4000-8000-0000000000c3'::uuid = any (app.course_locked_ids()),
  'C_arch (only an archived product) is locked for the non-holder M2');
reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19000000-0000-4000-8000-0000000000eb', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005',
   '19000000-0000-4000-8000-0000000000a3', 'grant', '19000000-0000-4000-8000-000000000002');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005');
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c2']::uuid[],
  'M2 holding the archived P3: C_arch opens for the holder (A4)');

-- ── 1. store off: disabled, then no row at all (links stay dormant, D-405) ─────────────────────
reset role;
update public.tenant_modules set enabled = false
 where tenant_id = '19000000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005');
select is(app.course_locked_ids(), '{}'::uuid[], 'store disabled: M2 gets the empty set');
select is(app.live_locked_ids(), '{}'::uuid[], 'store disabled: no live locked either');
reset role;
delete from public.tenant_modules
 where tenant_id = '19000000-0000-4000-8000-000000000001' and module_key = 'store';
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(app.course_locked_ids(), '{}'::uuid[], 'no store row at all: the empty set');
select is(app.course_locked_ids_for('19000000-0000-4000-8000-000000000004'), '{}'::uuid[],
  'no store row at all: the explicit form agrees');
reset role;
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('19000000-0000-4000-8000-000000000001', 'store', true);

-- ── 1. courses off: disabled, then no row at all (P02: the gate is inert with the module off) ───
update public.tenant_modules set enabled = false
 where tenant_id = '19000000-0000-4000-8000-000000000001' and module_key = 'courses';
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(app.course_locked_ids(), '{}'::uuid[], 'courses disabled: the empty set while link rows exist');
reset role;
delete from public.tenant_modules
 where tenant_id = '19000000-0000-4000-8000-000000000001' and module_key = 'courses';
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(app.course_locked_ids(), '{}'::uuid[], 'no courses row at all (P02): the empty set');
select is(app.live_locked_ids_for('19000000-0000-4000-8000-000000000004'), '{}'::uuid[],
  'no courses row at all (P02): the live explicit form agrees');
reset role;
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('19000000-0000-4000-8000-000000000001', 'courses', true);
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select is(array(select unnest(app.course_locked_ids()) order by 1),
  array['19000000-0000-4000-8000-0000000000c1', '19000000-0000-4000-8000-0000000000c3']::uuid[],
  'both flags back on: M1 (holding P2 only) is locked out of C_one and C_arch again');

-- ── 2. the restrictive lesson policy and the draft rule, in M1''s lane (C_one locked) ───────────
select results_eq(
  $$ select id::text from public.course_lessons where course_id = '19000000-0000-4000-8000-0000000000c1' order by position $$,
  ARRAY['19000000-0000-4000-8000-0000000000f1'],
  'locked C_one: M1 reads exactly its is_free lesson (D-407)');
select results_eq(
  $$ select lesson_id::text from public.course_lesson_materials
      where lesson_id in ('19000000-0000-4000-8000-0000000000f1', '19000000-0000-4000-8000-0000000000f2') $$,
  ARRAY['19000000-0000-4000-8000-0000000000f1'],
  'locked C_one: the materials follow the lesson — only the free lesson''s material is visible');
select is_empty(
  $$ select 1 from public.courses where id = '19000000-0000-4000-8000-0000000000c4' $$,
  'a member reads no draft course (D-413)');
select results_eq(
  $$ select count(*)::int from public.courses where tenant_id = '19000000-0000-4000-8000-000000000001' $$,
  ARRAY[4], 'a member reads the four published courses of its tenant (locked ones included: the catalogue shows them)');
select results_eq(
  $$ select count(*)::int from public.course_modules where course_id = '19000000-0000-4000-8000-0000000000c4' $$,
  ARRAY[0], 'a member reads no module of a draft course (the course subquery hides it)');
select results_eq(
  $$ select count(*)::int from public.course_lessons where course_id = '19000000-0000-4000-8000-0000000000c4' $$,
  ARRAY[0], 'a member reads no lesson of a draft course');
select results_eq(
  $$ select count(*)::int from public.course_lessons where course_id = '19000000-0000-4000-8000-0000000000c2' $$,
  ARRAY[0], 'the open C_two has no lesson yet: an empty list, not an error (P50)');
select results_eq(
  $$ select id::text from public.course_lives where tenant_id = '19000000-0000-4000-8000-000000000001' order by id $$,
  ARRAY['19000000-0000-4000-8000-000000000a50'],
  'locked V_one: M1 reads only the unlinked V_open — the paid live''s row (and its external_url) stays hidden');
reset role;
select tests.as_service();
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id) values
  ('19000000-0000-4000-8000-0000000000ec', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004',
   '19000000-0000-4000-8000-0000000000a1', 'grant', '19000000-0000-4000-8000-000000000002');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select id::text from public.course_lessons where course_id = '19000000-0000-4000-8000-0000000000c1' order by position $$,
  ARRAY['19000000-0000-4000-8000-0000000000f1', '19000000-0000-4000-8000-0000000000f2'],
  'M1 holding P1 again: both lessons of C_one');
select results_eq(
  $$ select count(*)::int from public.course_lesson_materials
      where lesson_id in ('19000000-0000-4000-8000-0000000000f1', '19000000-0000-4000-8000-0000000000f2') $$,
  ARRAY[2], '…and both materials');
select results_eq(
  $$ select count(*)::int from public.course_lives where tenant_id = '19000000-0000-4000-8000-000000000001' $$,
  ARRAY[2], 'M1 holding P1 again: both lives, V_one included');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.course_lessons where course_id = '19000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[2], 'admin_tenant lane: every lesson of C_one');
select results_eq(
  $$ select count(*)::int from public.courses where tenant_id = '19000000-0000-4000-8000-000000000001' $$,
  ARRAY[5], 'admin_tenant lane: every course, the draft included');
select results_eq(
  $$ select count(*)::int from public.course_modules where course_id = '19000000-0000-4000-8000-0000000000c4' $$,
  ARRAY[1], 'admin_tenant lane: the draft''s module');
select results_eq(
  $$ select count(*)::int from public.course_lives where tenant_id = '19000000-0000-4000-8000-000000000001' $$,
  ARRAY[2], 'admin_tenant lane: every live');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.course_lessons where course_id = '19000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[2], 'support_tenant lane: every lesson of C_one (staff are never locked out)');
select is_empty(
  $$ select 1 from public.courses where id = '19000000-0000-4000-8000-0000000000c4' $$,
  'support_tenant lane: no draft (the draft branch is the admin_tenant claim''s alone)');
select results_eq(
  $$ select count(*)::int from public.course_lives where tenant_id = '19000000-0000-4000-8000-000000000001' $$,
  ARRAY[2], 'support_tenant lane: every live (staff are never locked out)');

-- ── 3. writes are the admin claim''s (D-403): the member lane on the eight catalogue tables and the
--    store's two link tables (08.4) ────────────────────────────────────────────────────────────────
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select throws_ok(
  $$ insert into public.course_categories (tenant_id, name) values ('19000000-0000-4000-8000-000000000001', 'pirata') $$,
  '42501', null, 'member lane: insert into course_categories is refused');
select results_eq(
  $$ with u as (update public.course_categories set name = 'z' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_categories touches nothing');
select results_eq(
  $$ with d as (delete from public.course_categories where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_categories touches nothing');
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', 'pirata', 'eu') $$,
  '42501', null, 'member lane: insert into courses is refused');
select results_eq(
  $$ with u as (update public.courses set status = 'draft' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of courses (unpublishing) touches nothing');
select results_eq(
  $$ with d as (delete from public.courses where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from courses touches nothing');
select throws_ok(
  $$ insert into public.course_modules (tenant_id, course_id, title)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0', 'pirata') $$,
  '42501', null, 'member lane: insert into course_modules is refused');
select results_eq(
  $$ with u as (update public.course_modules set requires_previous = true where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_modules touches nothing');
select results_eq(
  $$ with d as (delete from public.course_modules where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_modules touches nothing');
select throws_ok(
  $$ insert into public.course_lessons (tenant_id, course_id, module_id, title)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0', '19000000-0000-4000-8000-0000000000d0', 'pirata') $$,
  '42501', null, 'member lane: insert into course_lessons is refused');
select results_eq(
  $$ with u as (update public.course_lessons set is_free = true where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_lessons (freeing a paid lesson) touches nothing');
select results_eq(
  $$ with d as (delete from public.course_lessons where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_lessons touches nothing');
select throws_ok(
  $$ insert into public.course_lesson_materials (tenant_id, lesson_id, asset_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000f1', '19000000-0000-4000-8000-0000000000a8') $$,
  '42501', null, 'member lane: insert into course_lesson_materials is refused');
select results_eq(
  $$ with u as (update public.course_lesson_materials set position = 9 where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_lesson_materials touches nothing');
select results_eq(
  $$ with d as (delete from public.course_lesson_materials where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_lesson_materials touches nothing');
select throws_ok(
  $$ insert into public.store_product_courses (tenant_id, product_id, course_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-0000000000c0') $$,
  '42501', null, 'member lane: insert into store_product_courses (locking an open course) is refused');
select results_eq(
  $$ with u as (update public.store_product_courses set product_id = '19000000-0000-4000-8000-0000000000a2' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of store_product_courses touches nothing');
select results_eq(
  $$ with d as (delete from public.store_product_courses where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from store_product_courses (unlocking everything) touches nothing');
select throws_ok(
  $$ truncate public.store_product_courses $$,
  '42501', null, 'member lane: truncate public.store_product_courses (unlocking every course) is refused');
select throws_ok(
  $$ insert into public.course_tracks (tenant_id, title) values ('19000000-0000-4000-8000-000000000001', 'pirata') $$,
  '42501', null, 'member lane: insert into course_tracks is refused');
select results_eq(
  $$ with u as (update public.course_tracks set title = 'z' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_tracks touches nothing');
select results_eq(
  $$ with d as (delete from public.course_tracks where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_tracks touches nothing');
select throws_ok(
  $$ insert into public.course_track_courses (tenant_id, track_id, course_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000d9', '19000000-0000-4000-8000-0000000000c1') $$,
  '42501', null, 'member lane: insert into course_track_courses is refused');
select results_eq(
  $$ with u as (update public.course_track_courses set position = 9 where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_track_courses touches nothing');
select results_eq(
  $$ with d as (delete from public.course_track_courses where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_track_courses touches nothing');
select throws_ok(
  $$ insert into public.course_lives (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', 'pirata', now(), 60, 'https://example.test/x') $$,
  '42501', null, 'member lane: insert into course_lives is refused');
select results_eq(
  $$ with u as (update public.course_lives set cancelled_at = now() where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of course_lives (cancelling) touches nothing');
select results_eq(
  $$ with d as (delete from public.course_lives where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from course_lives touches nothing');
select throws_ok(
  $$ insert into public.store_product_lives (tenant_id, product_id, live_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-000000000a50') $$,
  '42501', null, 'member lane: insert into store_product_lives is refused');
select results_eq(
  $$ with u as (update public.store_product_lives set product_id = '19000000-0000-4000-8000-0000000000a2' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'member lane: an update of store_product_lives touches nothing');
select results_eq(
  $$ with d as (delete from public.store_product_lives where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'member lane: a delete from store_product_lives touches nothing');
select throws_ok(
  $$ truncate public.store_product_lives $$,
  '42501', null, 'member lane: truncate public.store_product_lives (unlocking every live) is refused');
select is(array(select unnest(app.course_locked_ids()) order by 1), array['19000000-0000-4000-8000-0000000000c3']::uuid[],
  '…and after every attempt M1 (holding P1 and P2) still reads the gate as it was: only C_arch locked');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'support_tenant');
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000003', 'suporte', 'eu') $$,
  '42501', null, 'support_tenant lane: insert into courses is refused (D-403: admin only)');
select results_eq(
  $$ with u as (update public.course_lessons set is_free = true where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'support_tenant lane: an update of course_lessons touches nothing');
-- 08.4 (T-08.4-03): the support lane cannot touch the store's course and live links either.
select throws_ok(
  $$ insert into public.store_product_courses (tenant_id, product_id, course_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a1', '19000000-0000-4000-8000-0000000000c0') $$,
  '42501', null, 'support_tenant lane: insert into store_product_courses is refused');
select results_eq(
  $$ with u as (update public.store_product_courses set product_id = '19000000-0000-4000-8000-0000000000a2' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'support_tenant lane: an update of store_product_courses touches nothing');
select results_eq(
  $$ with d as (delete from public.store_product_courses where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'support_tenant lane: a delete from store_product_courses touches nothing');
select throws_ok(
  $$ truncate public.store_product_courses $$,
  '42501', null, 'support_tenant lane: truncate public.store_product_courses is refused');
select throws_ok(
  $$ insert into public.store_product_lives (tenant_id, product_id, live_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-000000000a50') $$,
  '42501', null, 'support_tenant lane: insert into store_product_lives is refused');
select results_eq(
  $$ with u as (update public.store_product_lives set product_id = '19000000-0000-4000-8000-0000000000a2' where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  ARRAY[0], 'support_tenant lane: an update of store_product_lives touches nothing');
select results_eq(
  $$ with d as (delete from public.store_product_lives where tenant_id = '19000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from d $$,
  ARRAY[0], 'support_tenant lane: a delete from store_product_lives touches nothing');
select throws_ok(
  $$ truncate public.store_product_lives $$,
  '42501', null, 'support_tenant lane: truncate public.store_product_lives is refused');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'admin_tenant');
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name)
     values ('19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000002', 'invasor', 'eu') $$,
  '42501', null, 'admin_tenant lane: a course stamped with B''s tenant_id is refused');
select lives_ok(
  $$ insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name)
     values ('19000000-0000-4000-8000-0000000000c9', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'Novo', 'Ana') $$,
  'admin_tenant lane: inserts a course of its own tenant');
select results_eq(
  $$ with u as (update public.courses set status = 'archived', archived_at = now() where id = '19000000-0000-4000-8000-0000000000c9' returning 1) select count(*)::int from u $$,
  ARRAY[1], 'admin_tenant lane: updates it');
-- 08.4 (D-418): the admin lane writes the store's links; each is removed again, so the fixture the
-- later sections read is unchanged.
select lives_ok(
  $$ insert into public.store_product_courses (tenant_id, product_id, course_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-0000000000c0') $$,
  'admin_tenant lane: inserts a store_product_courses link of its own tenant');
select results_eq(
  $$ with d as (delete from public.store_product_courses
                 where product_id = '19000000-0000-4000-8000-0000000000a2' and course_id = '19000000-0000-4000-8000-0000000000c0' returning 1)
     select count(*)::int from d $$,
  ARRAY[1], 'admin_tenant lane: deletes that course link again');
select lives_ok(
  $$ insert into public.store_product_lives (tenant_id, product_id, live_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000a2', '19000000-0000-4000-8000-000000000a50') $$,
  'admin_tenant lane: inserts a store_product_lives link of its own tenant');
select results_eq(
  $$ with d as (delete from public.store_product_lives
                 where product_id = '19000000-0000-4000-8000-0000000000a2' and live_id = '19000000-0000-4000-8000-000000000a50' returning 1)
     select count(*)::int from d $$,
  ARRAY[1], 'admin_tenant lane: deletes that live link again');

-- ── 4. the progress ledger (D-408) ─────────────────────────────────────────────────────────────
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004');
select results_eq(
  $$ select user_id::text from public.course_lesson_progress $$,
  ARRAY['19000000-0000-4000-8000-000000000004'],
  'M1 selects its own progress row and not M2''s');
select lives_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', '19000000-0000-4000-8000-0000000000f0', 5) $$,
  'M1 inserts a progress row for itself');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005', '19000000-0000-4000-8000-0000000000f0') $$,
  '42501', null, 'M1 cannot insert a progress row for M2 (T-08.3-09)');
select results_eq(
  $$ with u as (update public.course_lesson_progress set last_position_seconds = 60, updated_at = now()
                 where user_id = '19000000-0000-4000-8000-000000000004' and lesson_id = '19000000-0000-4000-8000-0000000000f1' returning 1)
     select count(*)::int from u $$,
  ARRAY[1], 'M1 updates its own last_position_seconds');
select results_eq(
  $$ with u as (update public.course_lesson_progress set last_position_seconds = 0 where user_id = '19000000-0000-4000-8000-000000000005' returning 1)
     select count(*)::int from u $$,
  ARRAY[0], 'M1 cannot touch M2''s row');
select throws_ok(
  $$ delete from public.course_lesson_progress where user_id = '19000000-0000-4000-8000-000000000004' $$,
  '42501', null, 'M1 cannot delete its own record (no delete policy, no privilege; P38)');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000004', '19000000-0000-4000-8000-0000000000f0') $$,
  '23505', null, 'a second insert of the same (tenant, user, lesson) is 23505: the PK is the arbiter (P37)');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id)
     values ('19000000-0000-4000-8000-000000000011', '19000000-0000-4000-8000-000000000004', '19000000-0000-4000-8000-0000000000fb') $$,
  '42501', null, 'a progress row stamped with B''s tenant_id (B''s lesson) is refused from A''s lane');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'admin_tenant');
select results_eq(
  $$ select count(*)::int, bool_and(tenant_id = '19000000-0000-4000-8000-000000000001') from public.course_lesson_progress $$,
  $$ values (3, true) $$, 'the admin_tenant lane reads every progress row of its tenant (M1 x2, M2 x1), none of B''s');
select throws_ok(
  $$ delete from public.course_lesson_progress where tenant_id = '19000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the admin_tenant lane cannot delete a member''s record either (D-408)');
reset role;
select tests.as_tenant('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005');
select results_eq(
  $$ select count(*)::int from public.course_lesson_progress $$,
  ARRAY[1], 'M2 selects only its own row');

-- ── 5. CHECKs and uniques, written as the service lane ──────────────────────────────────────────
reset role;
select tests.as_service();
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name, status)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'c', 'i', 'live') $$,
  '23514', null, 'courses_status_chk: draft, published or archived');
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name, level)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'c', 'i', 'expert') $$,
  '23514', null, 'courses_level_chk: iniciante, intermediario, avancado or null');
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name, outcomes)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'c', 'i',
             array['1','2','3','4','5','6','7','8','9','10','11']) $$,
  '23514', null, 'courses_outcomes_chk: at most 10 outcomes');
select throws_ok(
  $$ insert into public.courses (tenant_id, created_by_user_id, title, instructor_name, certificate_hours)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'c', 'i', 1000) $$,
  '23514', null, 'courses_hours_chk: 0..999 or null');
select throws_ok(
  $$ insert into public.course_tracks (tenant_id, title, status) values ('19000000-0000-4000-8000-000000000001', 't', 'draft') $$,
  '23514', null, 'course_tracks_status_chk: active or archived');
select throws_ok(
  $$ insert into public.course_lives (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'l', now(), 4, 'https://example.test/l') $$,
  '23514', null, 'course_lives_duration_chk: at least 5 minutes');
select throws_ok(
  $$ insert into public.course_lives (tenant_id, created_by_user_id, title, starts_at, duration_min, external_url)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000002', 'l', now(), 601, 'https://example.test/l') $$,
  '23514', null, 'course_lives_duration_chk: at most 600 minutes');
select throws_ok(
  $$ insert into public.course_lesson_progress (tenant_id, user_id, lesson_id, last_position_seconds)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-000000000005', '19000000-0000-4000-8000-0000000000f0', -1) $$,
  '23514', null, 'course_lesson_progress_position_chk: never negative');
select throws_ok(
  $$ insert into public.course_categories (tenant_id, name) values ('19000000-0000-4000-8000-000000000001', 'lábios') $$,
  '23505', null, 'course_categories_tenant_name_uq: Lábios and lábios are one name (P13)');
select lives_ok(
  $$ insert into public.course_categories (tenant_id, name) values ('19000000-0000-4000-8000-000000000011', 'Lábios') $$,
  '…but another tenant may use the same name');
select lives_ok(
  $$ insert into public.course_lessons (id, tenant_id, course_id, module_id, title, video_asset_id, position)
     values ('19000000-0000-4000-8000-0000000000f5', '19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0',
             '19000000-0000-4000-8000-0000000000d0', 'Vídeo', '19000000-0000-4000-8000-0000000000a9', 2) $$,
  'a lesson takes a video asset');
select throws_ok(
  $$ insert into public.course_lessons (tenant_id, course_id, module_id, title, video_asset_id, position)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0',
             '19000000-0000-4000-8000-0000000000d0', 'Vídeo 2', '19000000-0000-4000-8000-0000000000a9', 3) $$,
  '23505', null, 'course_lessons_tenant_video_uq: the same asset on two live lessons is refused (P22)');
update public.course_lessons set deleted_at = now() where id = '19000000-0000-4000-8000-0000000000f5';
select lives_ok(
  $$ insert into public.course_lessons (tenant_id, course_id, module_id, title, video_asset_id, position)
     values ('19000000-0000-4000-8000-000000000001', '19000000-0000-4000-8000-0000000000c0',
             '19000000-0000-4000-8000-0000000000d0', 'Vídeo 3', '19000000-0000-4000-8000-0000000000a9', 3) $$,
  '…and a soft-deleted lesson frees its asset');
reset role;

-- ── 6. posture ─────────────────────────────────────────────────────────────────────────────────
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p
    where p.oid in ('app.course_locked_ids()'::regprocedure,
                    'app.course_locked_ids_for(uuid)'::regprocedure,
                    'app.live_locked_ids()'::regprocedure,
                    'app.live_locked_ids_for(uuid)'::regprocedure)),
  'the four gate functions are SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.course_locked_ids()', 'execute'),
  'app.course_locked_ids is executable by authenticated');
select ok(has_function_privilege('authenticated', 'app.course_locked_ids_for(uuid)', 'execute'),
  'app.course_locked_ids_for is executable by authenticated');
select ok(has_function_privilege('authenticated', 'app.live_locked_ids()', 'execute'),
  'app.live_locked_ids is executable by authenticated');
select ok(has_function_privilege('authenticated', 'app.live_locked_ids_for(uuid)', 'execute'),
  'app.live_locked_ids_for is executable by authenticated');
select ok(not has_function_privilege('anon', 'app.course_locked_ids()', 'execute'),
  '…and not by anon (EXECUTE revoked from PUBLIC)');
select results_eq(
  $$ select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity
        and c.relname in ('course_categories', 'courses', 'course_modules', 'course_lessons', 'course_lesson_materials',
                          'course_lesson_progress', 'course_tracks', 'course_track_courses', 'course_lives') $$,
  ARRAY[9], 'every one of the nine course tables has RLS enabled');
select ok(to_regclass('public.course_products') is null,
  'the 08.3 course link table is gone (08.4-02 drop; store_product_courses holds the links)');
select ok(to_regclass('public.course_live_products') is null,
  'the 08.3 live link table is gone (08.4-02 drop; store_product_lives holds the links)');
select is(
  (select polpermissive from pg_policy where polname = 'course_lessons_course_gate'),
  false, 'course_lessons_course_gate is RESTRICTIVE (it ANDs with the tenant select)');
select is(
  (select polpermissive from pg_policy where polname = 'course_lives_live_gate'),
  false, 'course_lives_live_gate is RESTRICTIVE (it ANDs with the tenant select)');
select results_eq(
  $$ select count(*)::int from pg_policy where polrelid = 'public.course_lesson_progress'::regclass and polcmd in ('d', '*') $$,
  ARRAY[0], 'course_lesson_progress has no delete policy (D-408)');
select ok(not has_table_privilege('authenticated', 'public.course_lesson_progress', 'delete'),
  'authenticated holds no delete privilege on course_lesson_progress');

-- 7. THE 08.4 BODY PIN (D-418, RESEARCH Pitfall 2): the four gate bodies read the store-owned link
--    tables and neither 08.3 link table, so dropping the 08.3 tables cannot break the gate.
select ok(
  pg_get_functiondef('app.course_locked_ids_for(uuid)'::regprocedure) like '%store_product_courses%'
  and pg_get_functiondef('app.course_locked_ids_for(uuid)'::regprocedure) not like '%course_products%',
  'app.course_locked_ids_for reads store_product_courses and not the 08.3 course link table');
select ok(
  pg_get_functiondef('app.course_locked_ids()'::regprocedure) like '%store_product_courses%'
  and pg_get_functiondef('app.course_locked_ids()'::regprocedure) not like '%course_products%',
  'app.course_locked_ids reads store_product_courses and not the 08.3 course link table');
select ok(
  pg_get_functiondef('app.live_locked_ids_for(uuid)'::regprocedure) like '%store_product_lives%'
  and pg_get_functiondef('app.live_locked_ids_for(uuid)'::regprocedure) not like '%course_live_products%',
  'app.live_locked_ids_for reads store_product_lives and not the 08.3 live link table');
select ok(
  pg_get_functiondef('app.live_locked_ids()'::regprocedure) like '%store_product_lives%'
  and pg_get_functiondef('app.live_locked_ids()'::regprocedure) not like '%course_live_products%',
  'app.live_locked_ids reads store_product_lives and not the 08.3 live link table');

select * from finish();
rollback;
