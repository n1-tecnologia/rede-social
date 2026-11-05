begin;
-- 225-profile-form-steps-conditions.sql — Phase 12.1 (PFORM-27, 30, 31, 33; D-624, D-625, D-627, D-631, D-632, D-636;
-- T-12.1-01, T-12.1-03, T-12.1-04, T-12.1-05, T-12.1-15): the steps table, the conditional gate, the token helper, the purge,
-- the guard (PF006, PF007) and the default-step trigger, executed inside Postgres.
--
--  1. SHAPE and EXPOSURE of `profile_form_steps` and of the three new question columns.
--  2. CHECK boundaries, adjacency (same title and position) and the canonical order (tenant C).
--  3. COMPOSITE FOREIGN KEYS and the condition CHECK (cross-tenant negatives beside positive controls).
--  4. STEPS POLICIES x two tenants x the three real roles.
--  5. THE TOKEN HELPER against the rows of PROFILE_FORM_VISIBILITY_CASES (packages/contracts/src/profile-form.ts).
--  6. THE GATE `app.profile_form_missing`: only visible required questions are owed (D-631), boundary and precision (PFORM-30).
--  7. THE DEFAULT-STEP TRIGGER (a legacy-shaped insert, as Phase 12 and the previous API revision write it).
--  8. THE BACKFILL replayed on legacy-shaped rows, then SET NOT NULL (column temporarily nullable, trigger disabled, all rolled back).
--  9. A5: the set-based layout UPDATE. FINDING: the form written in RESEARCH Pattern 1 and in plan 09 (`from jsonb_to_recordset(...)
--     with ordinality as o(id uuid, step_id uuid, ord int)`) is REJECTED by Postgres; the two working forms are proved below.
-- 10. THE GUARD: PF006, PF007 and PF001..PF005 still firing.
-- 11. THE PURGE (own answers only, active and archived) and its cross-member and cross-tenant negatives.
-- 12. `app.profile_form_lock_active_v2` and the grants of the new functions.
--
-- The token helper rows are COPIED from PROFILE_FORM_VISIBILITY_CASES. Rule: a new stored-answer shape adds a row in the
-- contracts constant AND a line in section 5, in the same change.
-- Fixture ids use the `23000000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(218);

-- ── fixture helpers (rolled back with the file) ─────────────────────────────────────────────────
-- One question row. A NULL step is the LEGACY shape (Phase 12 / the previous API revision): the trigger fills it.
create function tests.pf_q(
  p_id uuid, p_tenant uuid, p_step uuid, p_type text, p_title text, p_pos int,
  p_required boolean default false, p_options jsonb default '[]'::jsonb, p_allow_other boolean default false,
  p_cond uuid default null, p_vals text[] default null, p_archived boolean default false,
  p_limits jsonb default '{}'::jsonb
) returns void language sql as $$
  insert into public.profile_form_questions
    (id, tenant_id, step_id, type, title, required, allow_other, options, limits, position, archived_at,
     condition_question_id, condition_values, created_by_user_id)
  values (p_id, p_tenant, p_step, p_type, p_title, p_required, p_allow_other, p_options, p_limits, p_pos,
          case when p_archived then now() end, p_cond, p_vals, '23000000-0000-4000-8000-020000000001');
$$;
-- One answer, upserted (the unique index is (tenant, membership, question)).
create function tests.pf_a(p_tenant uuid, p_q uuid, p_membership uuid, p_user uuid, p_value jsonb)
returns void language sql as $$
  insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
  values (p_tenant, p_q, p_membership, p_user, p_value)
  on conflict (tenant_id, membership_id, question_id) do update set value = excluded.value;
$$;
create function tests.pf_unanswer(p_membership uuid, p_q uuid)
returns void language sql as $$
  delete from public.profile_form_answers where membership_id = p_membership and question_id = p_q;
$$;

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
-- A gate and purge, B the other tenant, C steps lab, D default-step trigger, E guard, F one-step form, R1..R3 backfill.
select tests.tenant('pgtap-pf2-a', 'Pf2 A', '23000000-0000-4000-8000-010000000001');
select tests.tenant('pgtap-pf2-b', 'Pf2 B', '23000000-0000-4000-8000-010000000002');
select tests.tenant('pgtap-pf2-c', 'Pf2 C', '23000000-0000-4000-8000-010000000003');
select tests.tenant('pgtap-pf2-d', 'Pf2 D', '23000000-0000-4000-8000-010000000004');
select tests.tenant('pgtap-pf2-e', 'Pf2 E', '23000000-0000-4000-8000-010000000005');
select tests.tenant('pgtap-pf2-f', 'Pf2 F', '23000000-0000-4000-8000-010000000006');
select tests.tenant('pgtap-pf2-r1', 'Pf2 R1', '23000000-0000-4000-8000-010000000007');
select tests.tenant('pgtap-pf2-r2', 'Pf2 R2', '23000000-0000-4000-8000-010000000008');
select tests.tenant('pgtap-pf2-r3', 'Pf2 R3', '23000000-0000-4000-8000-010000000009');
select tests.auth_user('admin@pf2-a.local', '23000000-0000-4000-8000-020000000001');
select tests.auth_user('support@pf2-a.local', '23000000-0000-4000-8000-020000000002');
select tests.auth_user('member1@pf2-a.local', '23000000-0000-4000-8000-020000000003');
select tests.auth_user('member2@pf2-a.local', '23000000-0000-4000-8000-020000000004');
select tests.auth_user('admin@pf2-b.local', '23000000-0000-4000-8000-020000000005');
select tests.auth_user('member1@pf2-b.local', '23000000-0000-4000-8000-020000000006');
select tests.auth_user('member1@pf2-c.local', '23000000-0000-4000-8000-020000000007');
select tests.auth_user('admin@pf2-d.local', '23000000-0000-4000-8000-020000000008');
select tests.auth_user('member1@pf2-e.local', '23000000-0000-4000-8000-020000000009');
select tests.auth_user('member1@pf2-f.local', '23000000-0000-4000-8000-02000000000a');
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('23000000-0000-4000-8000-030000000001', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000001', 'admin_tenant', 'active'),
  ('23000000-0000-4000-8000-030000000002', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000002', 'support_tenant', 'active'),
  ('23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000003', 'member', 'active'),
  ('23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000004', 'member', 'active'),
  ('23000000-0000-4000-8000-030000000005', '23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-020000000005', 'admin_tenant', 'active'),
  ('23000000-0000-4000-8000-030000000006', '23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-020000000006', 'member', 'active'),
  ('23000000-0000-4000-8000-030000000007', '23000000-0000-4000-8000-010000000003', '23000000-0000-4000-8000-020000000007', 'member', 'active'),
  ('23000000-0000-4000-8000-030000000008', '23000000-0000-4000-8000-010000000004', '23000000-0000-4000-8000-020000000008', 'admin_tenant', 'active'),
  ('23000000-0000-4000-8000-030000000009', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-020000000009', 'member', 'active'),
  ('23000000-0000-4000-8000-03000000000a', '23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-02000000000a', 'member', 'active');
-- The module is on for A, B, C and F (the gate), off for the rest.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('23000000-0000-4000-8000-010000000001', 'profile_form', true), ('23000000-0000-4000-8000-010000000002', 'profile_form', true), ('23000000-0000-4000-8000-010000000003', 'profile_form', true), ('23000000-0000-4000-8000-010000000006', 'profile_form', true);

-- Steps. A: two steps; B, E, F: one; C: one EMPTY step (no question), the rest of C's steps are made in section 2.
insert into public.profile_form_steps (id, tenant_id, title, position, created_at) values
  ('23000000-0000-4000-8000-050000000001', '23000000-0000-4000-8000-010000000001', 'Passo 1', 1, '2026-01-01'),
  ('23000000-0000-4000-8000-050000000002', '23000000-0000-4000-8000-010000000001', 'Passo 2', 2, '2026-01-01'),
  ('23000000-0000-4000-8000-050000000003', '23000000-0000-4000-8000-010000000002', 'Passo B', 1, '2026-01-01'),
  ('23000000-0000-4000-8000-050000000004', '23000000-0000-4000-8000-010000000005', 'Passo E', 1, '2026-01-01'),
  ('23000000-0000-4000-8000-050000000005', '23000000-0000-4000-8000-010000000006', 'Passo F', 1, '2026-01-01'),
  ('23000000-0000-4000-8000-050000000006', '23000000-0000-4000-8000-010000000003', 'Vazio', 5, '2026-02-01');

-- Tenant A: openers a1 (single choice with Outro), a2 (yes/no), a3 (multiple choice with Outro); a4 required unconditional;
-- a5 optional; a6 required but ARCHIVED; dependents b1..b7 (all required): b1 a1=sa1, b2 a2=true, b3 a2=false,
-- b4 a3 in (m1,m2), b5 a2='True' (wrong case), b6 a1='SA1' (wrong case), b7 ARCHIVED a2=true.
select tests.pf_q('23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'single_choice', 'Abridor um', 1, false,
  '[{"id":"sa1","label":"Sim A"},{"id":"sa2","label":"Nao A"}]'::jsonb, true);
select tests.pf_q('23000000-0000-4000-8000-040000000002', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'yes_no', 'Abridor sim ou nao', 2);
select tests.pf_q('23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'multiple_choice', 'Abridor varias', 3, false,
  '[{"id":"m1","label":"Um"},{"id":"m2","label":"Dois"},{"id":"m3","label":"Tres"}]'::jsonb, true);
select tests.pf_q('23000000-0000-4000-8000-040000000004', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Obrigatoria sempre', 4, true);
select tests.pf_q('23000000-0000-4000-8000-040000000005', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Opcional', 5);
select tests.pf_q('23000000-0000-4000-8000-040000000006', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Obrigatoria arquivada', 6, true, p_archived => true);
select tests.pf_q('23000000-0000-4000-8000-040000000007', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Se um A', 7, true, p_cond => '23000000-0000-4000-8000-040000000001', p_vals => array['sa1']);
select tests.pf_q('23000000-0000-4000-8000-040000000008', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Se sim', 8, true, p_cond => '23000000-0000-4000-8000-040000000002', p_vals => array['true']);
select tests.pf_q('23000000-0000-4000-8000-040000000009', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Se nao', 9, true, p_cond => '23000000-0000-4000-8000-040000000002', p_vals => array['false']);
select tests.pf_q('23000000-0000-4000-8000-04000000000a', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Se m1 ou m2', 10, true, p_cond => '23000000-0000-4000-8000-040000000003', p_vals => array['m1','m2']);
select tests.pf_q('23000000-0000-4000-8000-04000000000b', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Se True', 11, true, p_cond => '23000000-0000-4000-8000-040000000002', p_vals => array['True']);
select tests.pf_q('23000000-0000-4000-8000-04000000000c', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Se SA1', 12, true, p_cond => '23000000-0000-4000-8000-040000000001', p_vals => array['SA1']);
select tests.pf_q('23000000-0000-4000-8000-04000000000d', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000002', 'short_text', 'Arquivada se sim', 13, true, p_cond => '23000000-0000-4000-8000-040000000002', p_vals => array['true'], p_archived => true);

-- Tenant B: opener d1, dependent d2 (required, d1=sb1), d3 required unconditional.
select tests.pf_q('23000000-0000-4000-8000-04000000000e', '23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-050000000003', 'single_choice', 'Abridor B', 1, false,
  '[{"id":"sb1","label":"Sim B"},{"id":"sb2","label":"Nao B"}]'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-04000000000f', '23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-050000000003', 'short_text', 'Se B um', 2, true, p_cond => '23000000-0000-4000-8000-04000000000e', p_vals => array['sb1']);
select tests.pf_q('23000000-0000-4000-8000-040000000010', '23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-050000000003', 'short_text', 'Obrigatoria B', 3, true);

-- Tenant F: a one-step form, two required unconditional questions (Phase 12 behaviour).
select tests.pf_q('23000000-0000-4000-8000-040000000011', '23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-050000000005', 'short_text', 'F um', 1, true);
select tests.pf_q('23000000-0000-4000-8000-040000000012', '23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-050000000005', 'short_text', 'F dois', 2, true);

-- ── (1) shape and exposure ─────────────────────────────────────────────────────────────────────
select has_table('public', 'profile_form_steps', 'PFORM-27: profile_form_steps exists');
select columns_are('public', 'profile_form_steps',
  array['id', 'tenant_id', 'title', 'position', 'revision', 'created_at', 'updated_at'],
  'PFORM-27: profile_form_steps has exactly the planned columns');
select col_is_pk('public', 'profile_form_steps', 'id', 'profile_form_steps.id is the primary key');
select col_not_null('public', 'profile_form_questions', 'step_id', 'D-627: step_id is NOT NULL (the backfill ran before SET NOT NULL)');
select has_index('public', 'profile_form_steps', 'profile_form_steps_tenant_position_idx', 'the (tenant, position) index of the steps exists');
select has_index('public', 'profile_form_questions', 'profile_form_questions_step_idx', 'the (tenant, step) index of the questions exists');
select is(
  (select indpred is not null from pg_index where indexrelid = 'public.profile_form_questions_condition_idx'::regclass),
  true, 'the condition index is PARTIAL (only conditional questions)');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profile_form_steps'::regclass
      and conname in ('profile_form_steps_tenant_id_uq', 'profile_form_steps_title_chk', 'profile_form_steps_position_chk', 'profile_form_steps_revision_chk')),
  4, 'profile_form_steps carries its (tenant, id) unique and its three named CHECKs');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profile_form_questions'::regclass
      and conname in ('profile_form_questions_step_fk', 'profile_form_questions_condition_fk', 'profile_form_questions_condition_chk')),
  3, 'the questions carry the two composite foreign keys and the condition CHECK');
select is(
  (select string_agg(confdeltype::text, ',' order by conname) from pg_constraint
    where conname in ('profile_form_questions_step_fk', 'profile_form_questions_condition_fk')),
  'a,a', 'both composite foreign keys are NO ACTION (a step with questions and an opener with dependents cannot vanish)');
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.profile_form_steps'::regclass), true,
  'profile_form_steps: RLS on and NOT forced');
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.profile_form_steps'::regclass $$,
  $$ values ('profile_form_steps_select'), ('profile_form_steps_insert'), ('profile_form_steps_update'), ('profile_form_steps_delete') $$,
  'profile_form_steps has exactly its four named policies');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.profile_form_steps'::regclass and polpermissive and polroles = array['authenticated'::regrole::oid]),
  4, 'all four step policies are permissive and granted to authenticated only');
select ok(
  not (has_table_privilege('anon', 'public.profile_form_steps', 'select') or has_table_privilege('anon', 'public.profile_form_steps', 'insert')
    or has_table_privilege('anon', 'public.profile_form_steps', 'update') or has_table_privilege('anon', 'public.profile_form_steps', 'delete')),
  'anon holds no privilege on profile_form_steps');
select ok(not has_table_privilege('authenticated', 'public.profile_form_steps', 'truncate'),
  'T-12.1-01: authenticated holds no TRUNCATE on profile_form_steps (RLS does not see it)');

-- ── (2) CHECK boundaries, adjacency, canonical order (tenant C, as the migration role) ─────────
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000003', repeat('t', 61), 2) $$,
  '23514', null, 'PFORM-27 boundary: a 61-character step title is refused');
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position) values ('23000000-0000-4000-8000-050000000007', '23000000-0000-4000-8000-010000000003', repeat('t', 60), 2) $$,
  'PFORM-27 boundary: a 60-character step title is accepted');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000003', '', 2) $$,
  '23514', null, 'PFORM-27 boundary: an empty step title is refused');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000003', 'Onze', 11) $$,
  '23514', null, 'PFORM-27 boundary: a step position of 11 is refused');
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position) values ('23000000-0000-4000-8000-050000000008', '23000000-0000-4000-8000-010000000003', 'Dez', 10) $$,
  'PFORM-27 boundary: a step position of 10 is accepted');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000003', 'Zero', 0) $$,
  '23514', null, 'PFORM-27 boundary: a step position of 0 is refused');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position, revision) values ('23000000-0000-4000-8000-010000000003', 'Rev', 2, 0) $$,
  '23514', null, 'PFORM-27 boundary: a step revision of 0 is refused');
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position, revision) values ('23000000-0000-4000-8000-050000000009', '23000000-0000-4000-8000-010000000003', 'Rev', 2, 1) $$,
  'PFORM-27 boundary: a step revision of 1 is accepted');
delete from public.profile_form_steps where id in ('23000000-0000-4000-8000-050000000007', '23000000-0000-4000-8000-050000000008', '23000000-0000-4000-8000-050000000009');

-- Adjacency: two steps with the SAME title and the SAME position are both accepted (no unique on either).
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position, created_at) values ('23000000-0000-4000-8000-05000000000a', '23000000-0000-4000-8000-010000000003', 'Igual', 1, '2026-01-01') $$,
  'PFORM-27 adjacency: the first step titled Igual at position 1 is accepted');
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position, created_at) values ('23000000-0000-4000-8000-05000000000b', '23000000-0000-4000-8000-010000000003', 'Igual', 1, '2026-01-01') $$,
  'PFORM-27 adjacency: a second step with the same title and position is accepted too (no unique, a swap never violates)');
select is(
  (select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000003' and title = 'Igual' and position = 1), 2,
  'PFORM-27 adjacency: both exist and are told apart only by id');
insert into public.profile_form_steps (id, tenant_id, title, position, created_at) values
  ('23000000-0000-4000-8000-05000000000c', '23000000-0000-4000-8000-010000000003', 'Segundo', 2, '2026-01-01'),
  ('23000000-0000-4000-8000-05000000000d', '23000000-0000-4000-8000-010000000003', 'Primeiro tardio', 1, '2026-01-02');
-- Ordering: position, then created_at, then id (the order of the services and of the member form).
select results_eq(
  $$ select id::text from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000003' order by position, created_at, id $$,
  array['23000000-0000-4000-8000-05000000000a', '23000000-0000-4000-8000-05000000000b', '23000000-0000-4000-8000-05000000000d', '23000000-0000-4000-8000-05000000000c', '23000000-0000-4000-8000-050000000006'],
  'PFORM-27 ordering: equal positions read earlier created_at first, then the smaller id; position 2 and 5 follow');
select lives_ok(
  $$ update public.profile_form_steps set position = case id when '23000000-0000-4000-8000-05000000000a' then 2 when '23000000-0000-4000-8000-05000000000c' then 1 end
      where id in ('23000000-0000-4000-8000-05000000000a', '23000000-0000-4000-8000-05000000000c') $$,
  'PFORM-27 adjacency: swapping two positions in one statement never violates a constraint');
-- Empty: a tenant whose only steps hold no question is allowed; the gate ignores them (section 6).
select is((select count(*)::int from public.profile_form_questions where tenant_id = '23000000-0000-4000-8000-010000000003'), 0,
  'PFORM-27 empty: tenant C has steps and no question at all (an empty step is allowed)');

-- ── (3) composite foreign keys and the condition CHECK ─────────────────────────────────────────
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000013', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000003', 'short_text', 'Passo alheio', 50) $$,
  '23503', null, 'T-12.1-01 cross-tenant: a question of A pointing at B''s step is refused by the composite foreign key');
select lives_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000013', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Passo proprio', 50) $$,
  'T-12.1-01: the positive control, the same question pointing at A''s own step');
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000014', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Abridor alheio', 51, p_cond => '23000000-0000-4000-8000-04000000000e', p_vals => array['sb1']) $$,
  '23503', null, 'T-12.1-01 cross-tenant: a condition naming B''s question as its opener is refused');
select lives_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000014', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Abridor proprio', 51, p_cond => '23000000-0000-4000-8000-040000000001', p_vals => array['sa1']) $$,
  'T-12.1-01: the positive control, a condition naming A''s own opener');
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000015', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Propria abridora', 52, p_cond => '23000000-0000-4000-8000-040000000015', p_vals => array['v']) $$,
  '23514', null, 'D-621: a question cannot be its own opener (the CHECK)');
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000015', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Sem valores', 52, p_cond => '23000000-0000-4000-8000-040000000001', p_vals => array[]::text[]) $$,
  '23514', null, 'D-621: an opener with an EMPTY values array is refused');
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000015', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Valores nulos', 52, p_cond => '23000000-0000-4000-8000-040000000001', p_vals => null) $$,
  '23514', null, 'D-621: an opener with NULL values is refused');
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000015', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Valores sem abridor', 52, p_vals => array['sa1']) $$,
  '23514', null, 'D-621: values without an opener are refused');
select throws_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000015', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Vinte e um', 52, p_cond => '23000000-0000-4000-8000-040000000001',
       p_vals => array(select 'v' || i from generate_series(1, 21) i)) $$,
  '23514', null, 'D-621 boundary: 21 condition values are refused');
select lives_ok(
  $$ select tests.pf_q('23000000-0000-4000-8000-040000000015', '23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-050000000001', 'short_text', 'Vinte', 52, p_cond => '23000000-0000-4000-8000-040000000001',
       p_vals => array(select 'v' || i from generate_series(1, 20) i)) $$,
  'D-621 boundary: 20 condition values are accepted');
select throws_ok(
  $$ delete from public.profile_form_steps where id = '23000000-0000-4000-8000-050000000001' $$,
  '23503', null, 'D-627: a step that holds questions cannot be deleted (NO ACTION)');
select throws_ok(
  $$ delete from public.profile_form_questions where id = '23000000-0000-4000-8000-040000000001' $$,
  '23503', null, 'D-621: an opener with dependents cannot be deleted (NO ACTION, and answers RESTRICT)');
delete from public.profile_form_questions where id in ('23000000-0000-4000-8000-040000000013', '23000000-0000-4000-8000-040000000014', '23000000-0000-4000-8000-040000000015');

-- ── (4) steps policies x two tenants x the three roles ─────────────────────────────────────────
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000001', 'admin_tenant');
select set_eq(
  $$ select id::text from public.profile_form_steps $$,
  $$ values ('23000000-0000-4000-8000-050000000001'), ('23000000-0000-4000-8000-050000000002') $$,
  'D-627: the admin of A reads exactly A''s two steps (as a SET)');
select is_empty(
  $$ select 1 from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000002' $$,
  'D-627 cross-tenant: the admin of A reads ZERO of B''s steps');
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position) values ('23000000-0000-4000-8000-05000000000e', '23000000-0000-4000-8000-010000000001', 'Passo 3', 3) $$,
  'D-627: the admin of A inserts a step for A (positive control)');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000002', 'Intruso', 5) $$,
  '42501', null, 'D-627 cross-tenant: the admin of A cannot insert a step for B');
select results_eq(
  $$ with u as (update public.profile_form_steps set title = 'Hacked' where tenant_id = '23000000-0000-4000-8000-010000000002' returning 1) select count(*)::int from u $$,
  array[0], 'D-627 cross-tenant: the admin of A updates zero of B''s steps');
select results_eq(
  $$ with d as (delete from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000002' returning 1) select count(*)::int from d $$,
  array[0], 'D-627 cross-tenant: the admin of A deletes zero of B''s steps');
select results_eq(
  $$ with u as (update public.profile_form_steps set title = 'Renomeado' where id = '23000000-0000-4000-8000-05000000000e' returning 1) select count(*)::int from u $$,
  array[1], 'D-627: the admin of A renames its own step (positive control)');
select throws_ok(
  $$ update public.profile_form_steps set tenant_id = '23000000-0000-4000-8000-010000000002' where id = '23000000-0000-4000-8000-05000000000e' $$,
  '42501', null, 'D-627 cross-tenant: the admin of A cannot hand its own step to B');
select results_eq(
  $$ with d as (delete from public.profile_form_steps where id = '23000000-0000-4000-8000-05000000000e' returning 1) select count(*)::int from d $$,
  array[1], 'D-627: the admin of A deletes its own empty step (positive control)');
reset role;

select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000002', 'support_tenant');
select set_eq(
  $$ select id::text from public.profile_form_steps $$,
  $$ values ('23000000-0000-4000-8000-050000000001'), ('23000000-0000-4000-8000-050000000002') $$,
  'D-627: a support_tenant of A reads A''s two steps');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000001', 'Suporte', 4) $$,
  '42501', null, 'D-627: a support_tenant cannot insert a step');
select results_eq(
  $$ with u as (update public.profile_form_steps set title = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'D-627: a support_tenant updates zero steps');
select results_eq(
  $$ with d as (delete from public.profile_form_steps returning 1) select count(*)::int from d $$,
  array[0], 'D-627: a support_tenant deletes zero steps');
reset role;

select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000003', 'member');
select set_eq(
  $$ select id::text from public.profile_form_steps $$,
  $$ values ('23000000-0000-4000-8000-050000000001'), ('23000000-0000-4000-8000-050000000002') $$,
  'D-627: a member of A reads A''s two steps (the member form needs them)');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000001', 'Membro', 4) $$,
  '42501', null, 'D-627: a member cannot insert a step');
select results_eq(
  $$ with u as (update public.profile_form_steps set title = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'D-627: a member updates zero steps');
select results_eq(
  $$ with d as (delete from public.profile_form_steps returning 1) select count(*)::int from d $$,
  array[0], 'D-627: a member deletes zero steps');
reset role;

select tests.as_tenant('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-020000000005', 'admin_tenant');
select set_eq(
  $$ select id::text from public.profile_form_steps $$,
  $$ values ('23000000-0000-4000-8000-050000000003') $$,
  'D-627 cross-tenant: the admin of B reads exactly B''s one step');
select results_eq(
  $$ with u as (update public.profile_form_steps set title = 'Hacked' where tenant_id = '23000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'D-627 cross-tenant: the admin of B updates zero of A''s steps');
select throws_ok(
  $$ insert into public.profile_form_steps (tenant_id, title, position) values ('23000000-0000-4000-8000-010000000001', 'Intruso', 5) $$,
  '42501', null, 'D-627 cross-tenant: the admin of B cannot insert a step for A');
select lives_ok(
  $$ insert into public.profile_form_steps (id, tenant_id, title, position) values ('23000000-0000-4000-8000-05000000000f', '23000000-0000-4000-8000-010000000002', 'Passo B2', 2) $$,
  'D-627: the admin of B inserts a step for B (positive control)');
select results_eq(
  $$ with d as (delete from public.profile_form_steps where id = '23000000-0000-4000-8000-05000000000f' returning 1) select count(*)::int from d $$,
  array[1], 'D-627: and deletes it again');
reset role;

select tests.as_tenant('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-020000000006', 'member');
select set_eq(
  $$ select id::text from public.profile_form_steps $$,
  $$ values ('23000000-0000-4000-8000-050000000003') $$,
  'D-627 cross-tenant: a member of B reads B''s one step and none of A''s');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000003', null);
select is_empty($$ select 1 from public.profile_form_steps $$, 'D-627: a lane with a NULL role claim reads no step (fails closed)');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from public.profile_form_steps $$, 'D-627: a lane with NO claims reads no step');
reset role;

-- ── (5) the token helper against PROFILE_FORM_VISIBILITY_CASES (copied, in order) ──────────────
select is(array['true']::text[] && app.profile_form_answer_tokens('true'::jsonb), true,
  'PFORM-41 parity 01: yes_no true opens a true condition');
select is(array['false']::text[] && app.profile_form_answer_tokens('false'::jsonb), true,
  'PFORM-41 parity 02: yes_no false opens a false condition');
select is(array['false']::text[] && app.profile_form_answer_tokens('true'::jsonb), false,
  'PFORM-41 parity 03: yes_no true does not open a false condition');
select is(array['true']::text[] && app.profile_form_answer_tokens('false'::jsonb), false,
  'PFORM-41 parity 04: yes_no false does not open a true condition');
select is(array['true','false']::text[] && app.profile_form_answer_tokens('true'::jsonb), true,
  'PFORM-41 parity 05: yes_no true opens a both-values condition');
select is(array['true']::text[] && app.profile_form_answer_tokens('"true"'::jsonb), false,
  'PFORM-41 parity 06: yes_no as a string is not a boolean answer');
select is(array['11111111-1111-4111-8111-111111111111']::text[] && app.profile_form_answer_tokens('{"optionId":"11111111-1111-4111-8111-111111111111","otherText":null}'::jsonb), true,
  'PFORM-41 parity 07: single choice, the chosen option opens');
select is(array['22222222-2222-4222-8222-222222222222']::text[] && app.profile_form_answer_tokens('{"optionId":"11111111-1111-4111-8111-111111111111","otherText":null}'::jsonb), false,
  'PFORM-41 parity 08: single choice, another option does not open');
select is(array['22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333']::text[]
    && app.profile_form_answer_tokens('{"optionId":"11111111-1111-4111-8111-111111111111","otherText":null}'::jsonb), true,
  'PFORM-41 parity 09: single choice, mixed list with the chosen option among them');
select is(array['22222222-2222-4222-8222-222222222222']::text[]
    && app.profile_form_answer_tokens('{"optionIds":["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"],"otherText":null}'::jsonb), true,
  'PFORM-41 parity 10: multiple choice any-of, one of two chosen options is enough');
select is(array['33333333-3333-4333-8333-333333333333']::text[]
    && app.profile_form_answer_tokens('{"optionIds":["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"],"otherText":null}'::jsonb), false,
  'PFORM-41 parity 11: multiple choice, none of the chosen options is in the condition');
select is(array['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333']::text[]
    && app.profile_form_answer_tokens('{"optionIds":["11111111-1111-4111-8111-111111111111"],"otherText":null}'::jsonb), false,
  'PFORM-41 parity 12: multiple choice, one chosen option against a list that omits it');
select is(array['11111111-1111-4111-8111-111111111111']::text[]
    && app.profile_form_answer_tokens('{"optionIds":["11111111-1111-4111-8111-111111111111"],"otherText":"texto"}'::jsonb), true,
  'PFORM-41 parity 13: multiple choice with Outro text still opens by its option ids');
select is(array['11111111-1111-4111-8111-111111111111']::text[]
    && app.profile_form_answer_tokens('{"optionId":null,"otherText":"texto"}'::jsonb), false,
  'PFORM-41 parity 14: Outro on a single choice (optionId null) opens nothing');
select is(array['11111111-1111-4111-8111-111111111111']::text[]
    && app.profile_form_answer_tokens('{"optionIds":[],"otherText":"texto"}'::jsonb), false,
  'PFORM-41 parity 15: Outro only on a multiple choice opens nothing');
select is(array['11111111-1111-4111-8111-111111111111']::text[]
    && app.profile_form_answer_tokens('{"optionIds":[],"otherText":null}'::jsonb), false,
  'PFORM-41 parity 16: a multiple choice with an empty set opens nothing');
select is(array['11111111-1111-4111-8111-111111111111']::text[] && app.profile_form_answer_tokens('null'::jsonb), false,
  'PFORM-41 parity 17: an unanswered opener (stored null) is hidden');
select is(array['11111111-1111-4111-8111-111111111111']::text[]
    && app.profile_form_answer_tokens('{"optionId":"99999999-9999-4999-8999-999999999999","otherText":null}'::jsonb), false,
  'PFORM-41 parity 18: an unknown option id stored for the opener opens nothing');
-- PFORM-30 precision: exact text, no case folding, no trimming, no numeric coercion.
select is(array['True']::text[] && app.profile_form_answer_tokens('true'::jsonb), false,
  'PFORM-30 precision: the condition value True does not match a stored boolean true (no case folding)');
select is(array['SA1']::text[] && app.profile_form_answer_tokens('{"optionId":"sa1","otherText":null}'::jsonb), false,
  'PFORM-30 precision: an option id differing only by letter case does not match');
select is(array[' sa1']::text[] && app.profile_form_answer_tokens('{"optionId":"sa1","otherText":null}'::jsonb), false,
  'PFORM-30 precision: an option id with a leading space does not match (no trimming)');
select is(app.profile_form_answer_tokens('1'::jsonb), '{}'::text[],
  'PFORM-30 precision: a stored number gives no token (no numeric coercion)');
select is(array['1']::text[] && app.profile_form_answer_tokens('1'::jsonb), false,
  'PFORM-30 precision: and so the text 1 does not match the number 1');
select is(app.profile_form_answer_tokens('{"optionIds":["a",1,null,{"x":1},"b"],"otherText":null}'::jsonb), array['a','b']::text[],
  'PFORM-30 precision: only the string elements of optionIds are tokens, like the TypeScript filter');

-- ── (6) the gate: only visible required questions are owed (A, member m1) ──────────────────────
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631: with nothing answered only the unconditional required question is owed (six conditional ones hidden, the archived one never counted)');
update public.profile_form_questions set archived_at = null where id = '23000000-0000-4000-8000-040000000006';
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 2,
  'D-631: the positive control, un-archiving the required a6 makes it owed (so archived is what kept it out)');
update public.profile_form_questions set archived_at = now() where id = '23000000-0000-4000-8000-040000000006';
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000004', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '"respondida"'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: the unconditional question answered gives 0 (it was the one counted, exactly as in Phase 12)');
-- single choice
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionId":"sa2","otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: an opener answered with a NON-matching option hides the dependent');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionId":"sa1","otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631: a MATCHING single choice shows the dependent');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionId":null,"otherText":"Meu texto"}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: an Outro answer (optionId null) hides the dependent');
-- the boundary sequence, one step either side of zero
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionId":"sa1","otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'PFORM-30 boundary: opener answered, the revealed required question unanswered holds the member at exactly 1');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000007', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '"resposta"'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'PFORM-30 boundary: answering the revealed question releases the gate at exactly 0');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionId":"sa2","otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'PFORM-30 boundary: changing the opener to a non-matching option gives 0 again (the dependent is hidden)');
select tests.pf_unanswer('23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-040000000007');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'PFORM-30 boundary: and with the hidden answer purged the gate is still 0 (stored equals visible)');
-- precision: wrong-case condition values never open
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionId":"sa1","otherText":null}'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000002', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', 'true'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 2,
  'PFORM-30 precision: exactly b1 and b2 are owed; b5 (condition True) and b6 (condition SA1) never match');
-- the session variant agrees with the explicit form
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000003', 'member');
select is(app.profile_form_missing_self(), 2,
  'T-12-08: the no-argument variant reads the same count from the member session claims');
reset role;
-- yes/no
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000007', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '"resposta"'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631: yes_no true shows the true dependent only (b2)');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000002', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', 'false'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631: yes_no false shows the false dependent only (b3) and closes b2');
select tests.pf_unanswer('23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-040000000002');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: an unanswered yes/no hides both dependents');
-- multiple choice
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionIds":["m1"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631: a multiple choice with one ticked matching option shows the dependent');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionIds":["m3"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: a multiple choice with only non-matching options hides it');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionIds":["m3","m2"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631: ANY one ticked option that matches is enough (m2 among m3, m2)');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionIds":[],"otherText":"texto"}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: an empty set with an Outro text hides it');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionIds":[],"otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631: an empty multiple-choice set hides it');
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '{"optionIds":["m1"],"otherText":null}'::jsonb);
-- module off, staff
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-589: the state before the module is switched off (1 owed)');
update public.tenant_modules set enabled = false where tenant_id = '23000000-0000-4000-8000-010000000001' and module_key = 'profile_form';
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 0, 'D-589: module off gives 0 for the same member');
update public.tenant_modules set enabled = true where tenant_id = '23000000-0000-4000-8000-010000000001' and module_key = 'profile_form';
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1, 'D-589: and back on gives 1 again');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000001'), 0, 'D-584: an admin_tenant is never held, conditions or not');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000002'), 0, 'D-584: a support_tenant is never held, conditions or not');
-- cross-tenant
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-030000000006'), 1,
  'D-631 cross-tenant: B''s member with nothing answered owes only B''s own unconditional question');
select tests.pf_a('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-04000000000e', '23000000-0000-4000-8000-030000000006', '23000000-0000-4000-8000-020000000006', '{"optionId":"sb1","otherText":null}'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-030000000006'), 2,
  'D-631 cross-tenant: with B''s opener matching B owes exactly its own two (A''s questions never count for B)');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000006'), 0,
  'D-631 cross-tenant: B''s member evaluated against A''s tenant id gives 0');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-030000000003'), 0,
  'D-631 cross-tenant: A''s member evaluated against B''s tenant id gives 0');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000003'), 1,
  'D-631 cross-tenant: and A''s member against A still gives 1 (the positive control for both zeros)');
-- a one-step form behaves as Phase 12; an empty step is ignored
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-03000000000a'), 2,
  'PFORM-27 empty: a form with exactly one step owes its two required questions as in Phase 12');
select tests.pf_a('23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-040000000011', '23000000-0000-4000-8000-03000000000a', '23000000-0000-4000-8000-02000000000a', '"um"'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-03000000000a'), 1, 'PFORM-27 empty: one answered leaves 1 in the one-step form');
select tests.pf_a('23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-040000000012', '23000000-0000-4000-8000-03000000000a', '23000000-0000-4000-8000-02000000000a', '"dois"'::jsonb);
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000006', '23000000-0000-4000-8000-03000000000a'), 0, 'PFORM-27 empty: both answered gives 0 in the one-step form');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000003', '23000000-0000-4000-8000-030000000007'), 0,
  'PFORM-27 empty: a tenant whose steps hold no question owes nothing (the gate ignores empty steps)');

-- ── (7) the default-step trigger (tenant D has no step; tenant A has two) ──────────────────────
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000004'), 0,
  'D-627 default step: tenant D starts with no step at all');
select tests.as_tenant('23000000-0000-4000-8000-010000000004', '23000000-0000-4000-8000-020000000008', 'admin_tenant');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, position, created_by_user_id)
     values ('23000000-0000-4000-8000-040000000016', '23000000-0000-4000-8000-010000000004', 'short_text', 'Legada um', 1, '23000000-0000-4000-8000-020000000008') $$,
  'D-627 default step: a legacy-shaped insert (no step_id) by the admin of D succeeds');
reset role;
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000004'), 1,
  'D-627 default step: the trigger created exactly one step for the tenant that had none');
select is((select title from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000004'), 'Informações gerais',
  'D-627 default step: its title is the confirmed literal Informações gerais');
select is((select "position" from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000004'), 1,
  'D-627 default step: at position 1');
select is((select q.step_id = s.id from public.profile_form_questions q, public.profile_form_steps s
            where q.id = '23000000-0000-4000-8000-040000000016' and s.tenant_id = '23000000-0000-4000-8000-010000000004'), true,
  'D-627 default step: and the legacy question lives in it');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, position, created_by_user_id)
     values ('23000000-0000-4000-8000-040000000017', '23000000-0000-4000-8000-010000000004', 'short_text', 'Legada dois', 2, '23000000-0000-4000-8000-020000000008') $$,
  'D-627 default step: a second legacy-shaped insert succeeds');
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000004'), 1,
  'D-627 default step: the second insert reuses the default step (still exactly one)');
select is((select count(distinct step_id)::int from public.profile_form_questions where tenant_id = '23000000-0000-4000-8000-010000000004'), 1,
  'D-627 default step: both legacy questions share it');
insert into public.profile_form_steps (id, tenant_id, title, position) values ('23000000-0000-4000-8000-050000000010', '23000000-0000-4000-8000-010000000004', 'Outro passo', 2);
select tests.pf_q('23000000-0000-4000-8000-040000000018', '23000000-0000-4000-8000-010000000004', '23000000-0000-4000-8000-050000000010', 'short_text', 'Explicita', 3);
select is((select step_id from public.profile_form_questions where id = '23000000-0000-4000-8000-040000000018'), '23000000-0000-4000-8000-050000000010'::uuid,
  'D-627 default step: an explicit step_id is never overridden by the trigger');
select tests.pf_q('23000000-0000-4000-8000-040000000019', '23000000-0000-4000-8000-010000000004', null, 'short_text', 'Legada tres', 4);
select is((select s.position from public.profile_form_questions q join public.profile_form_steps s on s.id = q.step_id where q.id = '23000000-0000-4000-8000-040000000019'), 1,
  'D-627 default step: with two steps a legacy insert lands in the FIRST one by position');
select tests.pf_q('23000000-0000-4000-8000-04000000001a', '23000000-0000-4000-8000-010000000001', null, 'short_text', 'Legada em A', 60);
select is((select step_id from public.profile_form_questions where id = '23000000-0000-4000-8000-04000000001a'), '23000000-0000-4000-8000-050000000001'::uuid,
  'D-627 default step: in tenant A a legacy insert lands in A''s first step, not the second');
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000002'), 1,
  'D-627 default step cross-tenant: nothing the trigger did created or touched a step of B');
select is(
  (select tgtype & 31 = 7 from pg_trigger where tgname = 'profile_form_questions_default_step' and tgrelid = 'public.profile_form_questions'::regclass),
  true, 'D-627 default step: the trigger is a BEFORE INSERT ROW trigger');
select trigger_is('public', 'profile_form_questions', 'profile_form_questions_default_step', 'app', 'profile_form_default_step',
  'D-627 default step: the trigger runs app.profile_form_default_step');
select ok(
  not (has_function_privilege('anon', 'app.profile_form_default_step()', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_default_step()', 'execute')),
  'T-12.1-05: the default-step function is granted to no session role');

-- ── (8) the backfill replayed on legacy-shaped rows, then SET NOT NULL ─────────────────────────
alter table public.profile_form_questions alter column step_id drop not null;
alter table public.profile_form_questions disable trigger profile_form_questions_default_step;
select tests.pf_q('23000000-0000-4000-8000-04000000001b', '23000000-0000-4000-8000-010000000007', null, 'short_text', 'Legada R1 um', 1);
select tests.pf_q('23000000-0000-4000-8000-04000000001c', '23000000-0000-4000-8000-010000000007', null, 'short_text', 'Legada R1 dois', 2, true);
select tests.pf_q('23000000-0000-4000-8000-04000000001d', '23000000-0000-4000-8000-010000000007', null, 'short_text', 'Legada R1 arquivada', 3, p_archived => true);
select tests.pf_q('23000000-0000-4000-8000-04000000001e', '23000000-0000-4000-8000-010000000008', null, 'short_text', 'Legada R2 um', 1);
select is((select count(*)::int from public.profile_form_questions where step_id is null), 4,
  'backfill: four legacy-shaped rows with no step (three in R1, one in R2) and none elsewhere');
select is((select count(*)::int from public.profile_form_steps where tenant_id in ('23000000-0000-4000-8000-010000000007', '23000000-0000-4000-8000-010000000008', '23000000-0000-4000-8000-010000000009')), 0,
  'backfill: and none of R1, R2, R3 has a step yet');
select lives_ok($$
  insert into public.profile_form_steps (tenant_id, title, "position")
  select distinct q.tenant_id, 'Informações gerais', 1
    from public.profile_form_questions q
   where not exists (
           select 1
             from public.profile_form_steps s
            where s.tenant_id = q.tenant_id
         )
$$, 'backfill: the plan 06 step insert runs on the legacy-shaped rows');
select lives_ok($$
  update public.profile_form_questions q
     set step_id = (
           select s.id
             from public.profile_form_steps s
            where s.tenant_id = q.tenant_id
            order by s."position", s.created_at, s.id
            limit 1
         )
   where q.step_id is null
$$, 'backfill: the plan 06 question update runs on the legacy-shaped rows');
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000007'), 1,
  'backfill: R1, which has questions, got exactly one default step');
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000008'), 1,
  'backfill: R2, which has a question, got exactly one default step');
select is((select count(*)::int from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000009'), 0,
  'PFORM-27 empty: R3, which has no question, still has no step after the backfill');
select is((select count(*)::int from public.profile_form_questions where step_id is null), 0,
  'backfill: no question is left without a step, archived ones included');
select is(
  (select count(*)::int from public.profile_form_questions q join public.profile_form_steps s on s.id = q.step_id and s.tenant_id = q.tenant_id
    where q.tenant_id in ('23000000-0000-4000-8000-010000000007', '23000000-0000-4000-8000-010000000008') and s.title = 'Informações gerais'),
  4, 'backfill: every legacy question points at its OWN tenant''s default step with the confirmed title');
create temp table pf225_snapshot on commit drop as
  select (select md5(string_agg(s.id::text || s.tenant_id::text || s.title || s.position::text, ',' order by s.id)) from public.profile_form_steps s) as steps_hash,
         (select md5(string_agg(q.id::text || q.step_id::text, ',' order by q.id)) from public.profile_form_questions q) as questions_hash;
select lives_ok($$
  insert into public.profile_form_steps (tenant_id, title, "position")
  select distinct q.tenant_id, 'Informações gerais', 1
    from public.profile_form_questions q
   where not exists (
           select 1
             from public.profile_form_steps s
            where s.tenant_id = q.tenant_id
         )
$$, 'backfill: the step insert replayed a second time');
select lives_ok($$
  update public.profile_form_questions q
     set step_id = (
           select s.id
             from public.profile_form_steps s
            where s.tenant_id = q.tenant_id
            order by s."position", s.created_at, s.id
            limit 1
         )
   where q.step_id is null
$$, 'backfill: the question update replayed a second time');
select is(
  (select md5(string_agg(s.id::text || s.tenant_id::text || s.title || s.position::text, ',' order by s.id)) from public.profile_form_steps s),
  (select steps_hash from pf225_snapshot), 'backfill idempotency: a second replay changed no step');
select is(
  (select md5(string_agg(q.id::text || q.step_id::text, ',' order by q.id)) from public.profile_form_questions q),
  (select questions_hash from pf225_snapshot), 'backfill idempotency: and no question moved');
select lives_ok($$ alter table public.profile_form_questions alter column step_id set not null $$,
  'backfill: SET NOT NULL succeeds once the backfill has run');
alter table public.profile_form_questions enable trigger profile_form_questions_default_step;
select is((select tgenabled::text from pg_trigger where tgname = 'profile_form_questions_default_step' and tgrelid = 'public.profile_form_questions'::regclass), 'O',
  'backfill: the default-step trigger is enabled again');
select col_not_null('public', 'profile_form_questions', 'step_id', 'backfill: step_id is NOT NULL again');

-- ── (9) A5: the set-based layout UPDATE (tenant D) ─────────────────────────────────────────────
create temp table pf225_ids on commit drop as
  select id as def from public.profile_form_steps where tenant_id = '23000000-0000-4000-8000-010000000004' order by position, created_at, id limit 1;
select throws_ok($$
  select * from jsonb_to_recordset('[{"id":"11111111-1111-4111-8111-111111111111","step_id":"22222222-2222-4222-8222-222222222222"}]'::jsonb)
    with ordinality as o(id uuid, step_id uuid, ord int)
$$, '42601', null,
  'A5 jsonb_to_recordset: the form written in RESEARCH Pattern 1 and plan 09 (with ordinality AND a column definition list) is rejected by Postgres');
select lives_ok($$
  update public.profile_form_questions q
     set position = o.ord::int, step_id = o.step_id, updated_at = now()
    from rows from (
           jsonb_to_recordset(jsonb_build_array(
             jsonb_build_object('id', '23000000-0000-4000-8000-040000000018', 'step_id', (select def from pf225_ids)),
             jsonb_build_object('id', '23000000-0000-4000-8000-040000000016', 'step_id', '23000000-0000-4000-8000-050000000010'),
             jsonb_build_object('id', '23000000-0000-4000-8000-040000000019', 'step_id', '23000000-0000-4000-8000-050000000010'),
             jsonb_build_object('id', '23000000-0000-4000-8000-040000000017', 'step_id', (select def from pf225_ids))
           )) as (id uuid, step_id uuid)
         ) with ordinality as o(id, step_id, ord)
   where q.id = o.id and q.tenant_id = '23000000-0000-4000-8000-010000000004'
$$, 'A5 jsonb_to_recordset: the ROWS FROM (...) WITH ORDINALITY form renumbers positions and steps together in one statement');
select results_eq(
  $$ select id::text from public.profile_form_questions where tenant_id = '23000000-0000-4000-8000-010000000004' order by position, created_at, id $$,
  array['23000000-0000-4000-8000-040000000018', '23000000-0000-4000-8000-040000000016', '23000000-0000-4000-8000-040000000019', '23000000-0000-4000-8000-040000000017'],
  'A5 jsonb_to_recordset: the positions follow the order of the JSON array (ordinality)');
select results_eq(
  $$ select (step_id = '23000000-0000-4000-8000-050000000010')::text from public.profile_form_questions where tenant_id = '23000000-0000-4000-8000-010000000004' order by position, created_at, id $$,
  array['false', 'true', 'true', 'false'],
  'A5 jsonb_to_recordset: and q1 and q4 moved to the second step in the same statement');
select lives_ok($$
  update public.profile_form_questions q
     set position = o.ord, step_id = o.step_id
    from jsonb_to_recordset(jsonb_build_array(
           jsonb_build_object('id', '23000000-0000-4000-8000-040000000016', 'step_id', (select def from pf225_ids), 'ord', 1),
           jsonb_build_object('id', '23000000-0000-4000-8000-040000000017', 'step_id', (select def from pf225_ids), 'ord', 2),
           jsonb_build_object('id', '23000000-0000-4000-8000-040000000018', 'step_id', '23000000-0000-4000-8000-050000000010', 'ord', 3),
           jsonb_build_object('id', '23000000-0000-4000-8000-040000000019', 'step_id', '23000000-0000-4000-8000-050000000010', 'ord', 4)
         )) as o(id uuid, step_id uuid, ord int)
   where q.id = o.id and q.tenant_id = '23000000-0000-4000-8000-010000000004'
$$, 'A5 jsonb_to_recordset: the second working form (the ordinal carried inside the JSON, no WITH ORDINALITY) also runs');
select results_eq(
  $$ select position::text || (step_id = '23000000-0000-4000-8000-050000000010')::text from public.profile_form_questions where tenant_id = '23000000-0000-4000-8000-010000000004' order by id $$,
  array['1false', '2false', '3true', '4true'],
  'A5 jsonb_to_recordset: and it moved every question back, positions 1..4');

-- ── (10) the guard: PF006, PF007, and PF001..PF005 still fire (tenant E) ──────────────────────
select tests.pf_q('23000000-0000-4000-8000-04000000001f', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'single_choice', 'Abridor X', 1, false,
  '[{"id":"x1","label":"X um"},{"id":"x2","label":"X dois"}]'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-040000000020', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'single_choice', 'Abridor X2', 2, false,
  '[{"id":"y1","label":"Y um"},{"id":"y2","label":"Y dois"}]'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-040000000021', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Respondida livre', 3);
select tests.pf_q('23000000-0000-4000-8000-040000000022', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Nao respondida', 4);
select tests.pf_q('23000000-0000-4000-8000-040000000023', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Respondida condicional', 5, false, p_cond => '23000000-0000-4000-8000-04000000001f', p_vals => array['x1']);
select tests.pf_q('23000000-0000-4000-8000-040000000024', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'single_choice', 'Abridor O1', 6, false,
  '[{"id":"p1","label":"P um"},{"id":"p2","label":"P dois"},{"id":"p3","label":"P tres"}]'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-040000000025', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Dependente ativa', 7, false, p_cond => '23000000-0000-4000-8000-040000000024', p_vals => array['p1']);
select tests.pf_q('23000000-0000-4000-8000-040000000026', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'single_choice', 'Abridor O2', 8, false,
  '[{"id":"p1","label":"P um"},{"id":"p2","label":"P dois"},{"id":"p3","label":"P tres"}]'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-040000000027', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Dependente arquivada', 9, false, p_cond => '23000000-0000-4000-8000-040000000026', p_vals => array['p1'], p_archived => true);
select tests.pf_q('23000000-0000-4000-8000-040000000028', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'single_choice', 'Abridor O3 sem dependentes', 10, false,
  '[{"id":"p1","label":"P um"},{"id":"p2","label":"P dois"},{"id":"p3","label":"P tres"}]'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-040000000029', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Privada respondida', 11);
select tests.pf_q('23000000-0000-4000-8000-04000000002a', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'multiple_choice', 'Varias respondida', 12, false,
  '[{"id":"o1","label":"Um"},{"id":"o2","label":"Dois"}]'::jsonb, true);
select tests.pf_q('23000000-0000-4000-8000-04000000002b', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'number', 'Numero respondido', 13, false, '[]'::jsonb, false, p_limits => '{"min":1,"max":10}'::jsonb);
select tests.pf_q('23000000-0000-4000-8000-04000000002c', '23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-050000000004', 'short_text', 'Livre', 14);
select tests.pf_a('23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-040000000021', '23000000-0000-4000-8000-030000000009', '23000000-0000-4000-8000-020000000009', '"x"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-040000000023', '23000000-0000-4000-8000-030000000009', '23000000-0000-4000-8000-020000000009', '"y"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-040000000029', '23000000-0000-4000-8000-030000000009', '23000000-0000-4000-8000-020000000009', '"z"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-04000000002a', '23000000-0000-4000-8000-030000000009', '23000000-0000-4000-8000-020000000009', '{"optionIds":["o1"],"otherText":"Meu"}'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000005', '23000000-0000-4000-8000-04000000002b', '23000000-0000-4000-8000-030000000009', '23000000-0000-4000-8000-020000000009', '5'::jsonb);

select throws_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-04000000001f', condition_values = array['x1'] where id = '23000000-0000-4000-8000-040000000021' $$,
  'PF006', null, 'D-625/PF006: gaining a condition on a question that has answers is refused');
select lives_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-04000000001f', condition_values = array['x1'] where id = '23000000-0000-4000-8000-040000000022' $$,
  'D-625/PF006: the same edit passes on a question nobody answered');
select throws_ok(
  $$ update public.profile_form_questions set condition_values = array['x2'] where id = '23000000-0000-4000-8000-040000000023' $$,
  'PF006', null, 'D-625/PF006: changing the values of the condition of an answered question is refused');
select throws_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-040000000020', condition_values = array['y1'] where id = '23000000-0000-4000-8000-040000000023' $$,
  'PF006', null, 'D-625/PF006: changing the opener of the condition of an answered question is refused');
select lives_ok(
  $$ update public.profile_form_questions set title = 'Respondida condicional editada' where id = '23000000-0000-4000-8000-040000000023' $$,
  'D-625/PF006: an edit that leaves the condition alone passes on an answered conditional question');
select lives_ok(
  $$ update public.profile_form_questions set condition_question_id = null, condition_values = null where id = '23000000-0000-4000-8000-040000000023' $$,
  'D-625/PF006: REMOVING the condition of an answered question passes');
select throws_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-04000000001f', condition_values = array['x1'] where id = '23000000-0000-4000-8000-040000000023' $$,
  'PF006', null, 'D-625/PF006: and gaining it back afterwards is refused again (it is a gain, the question still has answers)');

select throws_ok(
  $$ update public.profile_form_questions set archived_at = now() where id = '23000000-0000-4000-8000-040000000024' $$,
  'PF007', null, 'D-632/PF007: an opener with an ACTIVE dependent cannot be archived');
select throws_ok(
  $$ update public.profile_form_questions set type = 'dropdown' where id = '23000000-0000-4000-8000-040000000024' $$,
  'PF007', null, 'D-632/PF007: an opener with an active dependent cannot be retyped');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"p2","label":"P dois"},{"id":"p3","label":"P tres"}]'::jsonb where id = '23000000-0000-4000-8000-040000000024' $$,
  'PF007', null, 'D-632/PF007: an opener cannot lose an option id that an active dependent references');
select throws_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-04000000001f', condition_values = array['x1'] where id = '23000000-0000-4000-8000-040000000024' $$,
  'PF007', null, 'D-622/PF007: an opener with an active dependent cannot gain a condition itself');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"p1","label":"P um"},{"id":"p2","label":"P dois"}]'::jsonb where id = '23000000-0000-4000-8000-040000000024' $$,
  'D-632/PF007: removing an option NO dependent references passes (positive control)');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"p1","label":"P primeiro"},{"id":"p2","label":"P dois"}]'::jsonb where id = '23000000-0000-4000-8000-040000000024' $$,
  'D-632/PF007: relabelling the referenced option keeps its id and passes');
select lives_ok(
  $$ update public.profile_form_questions set type = 'dropdown' where id = '23000000-0000-4000-8000-040000000026' $$,
  'D-632/PF007 archived: an opener whose only dependent is ARCHIVED can be retyped');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"p2","label":"P dois"},{"id":"p3","label":"P tres"}]'::jsonb where id = '23000000-0000-4000-8000-040000000026' $$,
  'D-632/PF007 archived: and can lose the option the archived dependent references');
select lives_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-04000000001f', condition_values = array['x1'] where id = '23000000-0000-4000-8000-040000000026' $$,
  'D-632/PF007 archived: and can gain a condition');
select lives_ok(
  $$ update public.profile_form_questions set archived_at = now() where id = '23000000-0000-4000-8000-040000000026' $$,
  'D-632/PF007 archived: and can be archived');
select lives_ok(
  $$ update public.profile_form_questions set type = 'dropdown' where id = '23000000-0000-4000-8000-040000000028' $$,
  'D-632/PF007 no dependents: an opener with no dependent can be retyped');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"p2","label":"P dois"},{"id":"p3","label":"P tres"}]'::jsonb where id = '23000000-0000-4000-8000-040000000028' $$,
  'D-632/PF007 no dependents: and can lose any option');
select lives_ok(
  $$ update public.profile_form_questions set condition_question_id = '23000000-0000-4000-8000-04000000001f', condition_values = array['x1'] where id = '23000000-0000-4000-8000-040000000028' $$,
  'D-632/PF007 no dependents: and can gain a condition');
select lives_ok(
  $$ update public.profile_form_questions set archived_at = now() where id = '23000000-0000-4000-8000-040000000028' $$,
  'D-632/PF007 no dependents: and can be archived');

select throws_ok(
  $$ update public.profile_form_questions set type = 'long_text' where id = '23000000-0000-4000-8000-040000000029' $$,
  'PF001', null, 'PF001 still fires: the type of an answered question cannot change');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o2","label":"Dois"},{"id":"o3","label":"Tres"}]'::jsonb where id = '23000000-0000-4000-8000-04000000002a' $$,
  'PF002', null, 'PF002 still fires: an answered option cannot be removed');
select throws_ok(
  $$ update public.profile_form_questions set allow_other = false where id = '23000000-0000-4000-8000-04000000002a' $$,
  'PF003', null, 'PF003 still fires: Outro cannot be turned off while an Outro answer exists');
select throws_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = '23000000-0000-4000-8000-040000000029' $$,
  'PF004', null, 'PF004 still fires: a private answered question cannot become public');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":2,"max":10}'::jsonb where id = '23000000-0000-4000-8000-04000000002b' $$,
  'PF005', null, 'PF005 still fires: a number minimum that rises is refused');
select lives_ok(
  $$ update public.profile_form_questions set type = 'long_text', show_on_profile = true where id = '23000000-0000-4000-8000-04000000002c' $$,
  'PF001/PF004: the same edits pass on a question nobody answered (positive control)');

-- ── (11) the purge: own answers only, active and archived (T-12.1-03, T-12.1-05, T-12.1-15) ────
-- m2 of A: opener a1 = sa2 (closes b1 and b6), a2 unanswered (closes b2 and the ARCHIVED b7), a3 = m1 (keeps b4 open).
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000001', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '{"optionId":"sa2","otherText":null}'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000003', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '{"optionIds":["m1"],"otherText":null}'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000004', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '"sempre"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000007', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '"fechada um"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-04000000000c', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '"fechada seis"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000008', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '"fechada dois"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-04000000000d', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '"fechada arquivada"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-04000000000a', '23000000-0000-4000-8000-030000000004', '23000000-0000-4000-8000-020000000004', '"aberta"'::jsonb);
-- A stale answer of another member (m1: b2 while a2 is unanswered) and of another tenant (B: d2 while d1 = sb2).
select tests.pf_a('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-040000000008', '23000000-0000-4000-8000-030000000003', '23000000-0000-4000-8000-020000000003', '"velha de m1"'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-04000000000e', '23000000-0000-4000-8000-030000000006', '23000000-0000-4000-8000-020000000006', '{"optionId":"sb2","otherText":null}'::jsonb);
select tests.pf_a('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-04000000000f', '23000000-0000-4000-8000-030000000006', '23000000-0000-4000-8000-020000000006', '"velha de B"'::jsonb);
select is((select count(*)::int from public.profile_form_answers where membership_id = '23000000-0000-4000-8000-030000000004'), 8,
  'purge: before the call m2 holds eight answers (three openers or plain, four closed dependents, one open dependent)');
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000004', 'member');
select set_eq(
  $$ select question_id::text from app.profile_form_purge_closed() $$,
  $$ values ('23000000-0000-4000-8000-040000000007'), ('23000000-0000-4000-8000-04000000000c'), ('23000000-0000-4000-8000-040000000008'), ('23000000-0000-4000-8000-04000000000d') $$,
  'D-624/D-636 purge: it deletes m2''s answers to the closed ACTIVE dependents and to the closed ARCHIVED one');
reset role;
select set_eq(
  $$ select question_id::text from public.profile_form_answers where membership_id = '23000000-0000-4000-8000-030000000004' $$,
  $$ values ('23000000-0000-4000-8000-040000000001'), ('23000000-0000-4000-8000-040000000003'), ('23000000-0000-4000-8000-040000000004'), ('23000000-0000-4000-8000-04000000000a') $$,
  'D-624 purge: the openers, the unconditional answer and the MATCHING dependent''s answer stay');
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000004', 'member');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$,
  'D-624 purge idempotency: a second call deletes nothing');
reset role;
select is((select count(*)::int from public.profile_form_answers where membership_id = '23000000-0000-4000-8000-030000000003' and question_id = '23000000-0000-4000-8000-040000000008'), 1,
  'T-12.1-15 cross-member: m2''s purge left m1''s own stale answer untouched');
select is((select count(*)::int from public.profile_form_answers where membership_id = '23000000-0000-4000-8000-030000000006' and question_id = '23000000-0000-4000-8000-04000000000f'), 1,
  'T-12.1-15 cross-tenant: and left tenant B''s stale answer untouched');
select is(app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000004'), 0,
  'D-624 purge: after the purge m2 owes nothing and what is stored is what is visible');
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000003', 'member');
select set_eq(
  $$ select question_id::text from app.profile_form_purge_closed() $$,
  $$ values ('23000000-0000-4000-8000-040000000008') $$,
  'T-12.1-15 cross-member: the positive control, m1''s own call deletes m1''s own stale answer');
reset role;
select is((select count(*)::int from public.profile_form_answers where membership_id = '23000000-0000-4000-8000-030000000006' and question_id = '23000000-0000-4000-8000-04000000000f'), 1,
  'T-12.1-15 cross-tenant: tenant B''s stale answer still survives both A calls');
select tests.as_tenant('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-020000000006', 'member');
select set_eq(
  $$ select question_id::text from app.profile_form_purge_closed() $$,
  $$ values ('23000000-0000-4000-8000-04000000000f') $$,
  'T-12.1-15 cross-tenant: the positive control, B''s member purges B''s own stale answer');
reset role;
select set_eq(
  $$ select question_id::text from public.profile_form_answers where membership_id = '23000000-0000-4000-8000-030000000004' $$,
  $$ values ('23000000-0000-4000-8000-040000000001'), ('23000000-0000-4000-8000-040000000003'), ('23000000-0000-4000-8000-040000000004'), ('23000000-0000-4000-8000-04000000000a') $$,
  'T-12.1-15: and B''s call left m2''s answers exactly as they were');
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000001', 'admin_tenant');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$,
  'T-12.1-05: a staff session purges nothing (no answers of its own)');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from app.profile_form_purge_closed() $$,
  'T-12.1-05: a session with no claims purges nothing');
reset role;
select is((select pronargs::int from pg_proc where oid = 'app.profile_form_purge_closed()'::regprocedure), 0,
  'T-12.1-05: the purge accepts no argument, so it cannot name another member or tenant');
select is(
  (select count(*)::int from pg_proc
    where oid in ('app.profile_form_purge_closed()'::regprocedure, 'app.profile_form_lock_active_v2()'::regprocedure,
                  'app.profile_form_default_step()'::regprocedure)
      and prosecdef and proconfig @> array['search_path=""']),
  3, 'T-12.1-05: the purge, the v2 lock and the default-step function are SECURITY DEFINER with an empty search_path');
select ok(
  has_function_privilege('authenticated', 'app.profile_form_purge_closed()', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_purge_closed()', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_purge_closed()', 'execute')
    and not has_function_privilege('anon', 'app.profile_form_purge_closed()', 'execute'),
  'T-12.1-05: the purge is executable by authenticated, api_user and service_role, never by anon');

-- ── (12) the v2 lock and the helper grants ─────────────────────────────────────────────────────
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000003', 'member');
select results_eq(
  $$ select id::text from app.profile_form_lock_active_v2() $$,
  $$ select id::text from public.profile_form_questions where tenant_id = '23000000-0000-4000-8000-010000000001' and archived_at is null order by position, created_at, id $$,
  'D-627 lock v2: a member session reads A''s active questions in position, created_at, id order');
select results_eq(
  $$ select step_id::text || '|' || condition_question_id::text || '|' || array_to_string(condition_values, ',')
       from app.profile_form_lock_active_v2() where id = '23000000-0000-4000-8000-040000000007' $$,
  array['23000000-0000-4000-8000-050000000002|23000000-0000-4000-8000-040000000001|sa1'],
  'D-627 lock v2: the row carries step_id, condition_question_id and condition_values');
select is_empty(
  $$ select 1 from app.profile_form_lock_active_v2() where id in ('23000000-0000-4000-8000-040000000006', '23000000-0000-4000-8000-04000000000d') $$,
  'D-627 lock v2: ARCHIVED questions are not returned');
select is_empty(
  $$ select 1 from app.profile_form_lock_active_v2() where id in ('23000000-0000-4000-8000-04000000000e', '23000000-0000-4000-8000-04000000000f', '23000000-0000-4000-8000-040000000010') $$,
  'T-12.1-05 cross-tenant: and none of B''s questions');
select lives_ok($$ select app.profile_form_answer_tokens('true'::jsonb) $$,
  'T-12.1-05: a member session can call the token helper');
select throws_ok(
  $$ select app.profile_form_missing('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-030000000004') $$,
  '42501', null, 'T-12.1-05: a member session still cannot probe the two-argument gate (42501)');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-010000000001', '23000000-0000-4000-8000-020000000001', 'admin_tenant');
select lives_ok($$ select app.profile_form_answer_tokens('{"optionId":"sa1"}'::jsonb) $$,
  'T-12.1-05: an admin_tenant session can call the token helper (the services call it directly)');
select lives_ok($$ select * from app.profile_form_lock_active_v2() $$,
  'D-627 lock v2: an admin_tenant session can call the v2 lock');
reset role;
select tests.as_tenant('23000000-0000-4000-8000-010000000002', '23000000-0000-4000-8000-020000000006', 'member');
select set_eq(
  $$ select id::text from app.profile_form_lock_active_v2() $$,
  $$ values ('23000000-0000-4000-8000-04000000000e'), ('23000000-0000-4000-8000-04000000000f'), ('23000000-0000-4000-8000-040000000010') $$,
  'T-12.1-05 cross-tenant: a member of B reads exactly B''s three active questions from the v2 lock');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from app.profile_form_lock_active_v2() $$,
  'T-12.1-05: a session with no claims reads nothing from the v2 lock');
reset role;
select ok(
  not (has_function_privilege('anon', 'app.profile_form_lock_active_v2()', 'execute')
    or has_function_privilege('anon', 'app.profile_form_answer_tokens(jsonb)', 'execute')),
  'T-12.1-05: anon can execute neither the v2 lock nor the token helper');
select ok(
  has_function_privilege('authenticated', 'app.profile_form_lock_active_v2()', 'execute')
    and has_function_privilege('authenticated', 'app.profile_form_answer_tokens(jsonb)', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_lock_active_v2()', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_answer_tokens(jsonb)', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_lock_active_v2()', 'execute'),
  'the v2 lock and the helper are executable by authenticated, api_user and service_role');
select ok(
  not has_function_privilege('authenticated', 'app.profile_form_missing(uuid,uuid)', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_missing(uuid,uuid)', 'execute'),
  'T-12.1-05: the replaced gate keeps its grant (api_user and service_role only, never a session)');

select * from finish();
rollback;
