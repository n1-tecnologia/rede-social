begin;
-- 220-profile-form.sql — Phase 12 (PFORM-01, 03, 05, 08, 09, 17, 18, 22, 25; D-585, D-587, D-588, D-589, D-591, D-593, D-594, D-596;
-- T-12-04, T-12-06, T-12-07, T-12-08, T-12-09): the profile form module, the two tables, the gate rule and the guard,
-- executed inside Postgres.
--
-- 1. THE MODULE KEY (plan 12-02, D-596). `tenant_modules_key_chk` is GENERATED from `TOGGLEABLE_MODULES` and the
--    migration `profile_form_module_key` widens it to end in 'profile_form': the key is accepted, an unknown
--    key is refused (23514), the definition lists the keys in the array's order with `payments` immediately
--    before `profile_form`, and nothing switched the key on (no enabled row, no backfill row).
-- 2. SHAPE and CHECKs (plan 12-04): the columns, the named constraints and indexes, the ordered type list of the CHECK
--    against the contract's list, every CHECK refused with 23514 and its boundary accepted.
-- 3. EXPOSURE: RLS on and not forced, the exact policy names, no privilege for `anon`.
-- 4. POLICIES x TWO TENANTS: admin, support, member and a lane without a real role, each reading and writing in its own
--    tenant and nothing in the other, every negative beside its positive control, every comparison a SET.
-- 6. THE GATE RULE: `app.profile_form_missing` for every state, its session variant and the `_gate` twins.
-- 7. THE GUARD TRIGGER: PF001 to PF005 on an answered question, the same edits allowed on a never-answered one.
-- 8. HARDENING: who may execute what, definer functions with an empty search_path, no TRUNCATE for the tenant lane.
-- 5. (last, because it deletes memberships and an identity) FOREIGN KEY and CASCADE: an answered question cannot be deleted (RESTRICT), an unanswered one can, an answer goes
--    with its membership and with its identity, the dismissal column, the widened moderation log CHECK.
--
-- Fixture ids use the `22000000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(205);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-pform-a', 'Pform A', '22000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-pform-b', 'Pform B', '22000000-0000-4000-8000-000000000002');
select tests.auth_user('admin@pform-a.local', '22000000-0000-4000-8000-0000000000a1');
select tests.auth_user('support@pform-a.local', '22000000-0000-4000-8000-0000000000a2');
select tests.auth_user('member1@pform-a.local', '22000000-0000-4000-8000-0000000000a3');
select tests.auth_user('member2@pform-a.local', '22000000-0000-4000-8000-0000000000a4');
select tests.auth_user('admin@pform-b.local', '22000000-0000-4000-8000-0000000000b1');
select tests.auth_user('member1@pform-b.local', '22000000-0000-4000-8000-0000000000b3');

insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('22000000-0000-4000-8000-0000000001a1', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a1', 'admin_tenant', 'active'),
  ('22000000-0000-4000-8000-0000000001a2', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a2', 'support_tenant', 'active'),
  ('22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a3', 'member', 'active'),
  ('22000000-0000-4000-8000-0000000001a4', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a4', 'member', 'active'),
  ('22000000-0000-4000-8000-0000000001b1', '22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000000b1', 'admin_tenant', 'active'),
  ('22000000-0000-4000-8000-0000000001b3', '22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000000b3', 'member', 'active');

-- Tenant A: 02a1 public 'Cidade', 02a2 private required 'Telefone', 02a3 ARCHIVED 'Antiga', 02a4 single choice 'Cor' with "Outro",
-- 02a5 and 02a6 never answered. Tenant B: 02b1 'Cidade' (the SAME title as A's), 02b2 never answered.
insert into public.profile_form_questions
  (id, tenant_id, type, title, required, show_on_profile, allow_other, options, position, archived_at, created_by_user_id) values
  ('22000000-0000-4000-8000-0000000002a1', '22000000-0000-4000-8000-000000000001', 'short_text', 'Cidade', false, true, false, '[]'::jsonb, 1, null, '22000000-0000-4000-8000-0000000000a1'),
  ('22000000-0000-4000-8000-0000000002a2', '22000000-0000-4000-8000-000000000001', 'phone', 'Telefone', true, false, false, '[]'::jsonb, 2, null, '22000000-0000-4000-8000-0000000000a1'),
  ('22000000-0000-4000-8000-0000000002a3', '22000000-0000-4000-8000-000000000001', 'short_text', 'Antiga', false, false, false, '[]'::jsonb, 3, now(), '22000000-0000-4000-8000-0000000000a1'),
  ('22000000-0000-4000-8000-0000000002a4', '22000000-0000-4000-8000-000000000001', 'single_choice', 'Cor', false, false, true,
     '[{"id":"22000000-0000-4000-8000-0000000004a1","label":"Azul"},{"id":"22000000-0000-4000-8000-0000000004a2","label":"Verde"}]'::jsonb, 4, null, '22000000-0000-4000-8000-0000000000a1'),
  ('22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-000000000001', 'long_text', 'Sobre voce', false, false, false, '[]'::jsonb, 5, null, '22000000-0000-4000-8000-0000000000a1'),
  ('22000000-0000-4000-8000-0000000002a6', '22000000-0000-4000-8000-000000000001', 'short_text', 'Rascunho', false, false, false, '[]'::jsonb, 6, null, '22000000-0000-4000-8000-0000000000a1'),
  ('22000000-0000-4000-8000-0000000002b1', '22000000-0000-4000-8000-000000000002', 'short_text', 'Cidade', false, false, false, '[]'::jsonb, 1, null, '22000000-0000-4000-8000-0000000000b1'),
  ('22000000-0000-4000-8000-0000000002b2', '22000000-0000-4000-8000-000000000002', 'short_text', 'Outra', false, false, false, '[]'::jsonb, 2, null, '22000000-0000-4000-8000-0000000000b1');

-- Answers: 03a1 member1 -> 02a1 (public), 03a2 member1 -> 02a2 (private), 03a3 member2 -> 02a2 (private),
-- 03a4 member2 -> 02a1 (public), 03a5 member1 -> 02a3 (archived), 03b1 memberB -> 02b1.
insert into public.profile_form_answers (id, tenant_id, question_id, membership_id, user_id, value) values
  ('22000000-0000-4000-8000-0000000003a1', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a1', '22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-0000000000a3', '"Recife"'::jsonb),
  ('22000000-0000-4000-8000-0000000003a2', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a2', '22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-0000000000a3', '"81999998888"'::jsonb),
  ('22000000-0000-4000-8000-0000000003a3', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a2', '22000000-0000-4000-8000-0000000001a4', '22000000-0000-4000-8000-0000000000a4', '"11999997777"'::jsonb),
  ('22000000-0000-4000-8000-0000000003a4', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a1', '22000000-0000-4000-8000-0000000001a4', '22000000-0000-4000-8000-0000000000a4', '"Olinda"'::jsonb),
  ('22000000-0000-4000-8000-0000000003a5', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a3', '22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-0000000000a3', '"antigo"'::jsonb),
  ('22000000-0000-4000-8000-0000000003b1', '22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000002b1', '22000000-0000-4000-8000-0000000001b3', '22000000-0000-4000-8000-0000000000b3', '"Salvador"'::jsonb);

-- ── (1) the module key ─────────────────────────────────────────────────────────────────────────
-- PFORM-01 empty: nothing in the migration or the seed switched the key on.
select is(
  (select count(*) from public.tenant_modules where module_key = 'profile_form' and enabled),
  0::bigint,
  'PFORM-01/D-596: no tenant has profile_form enabled before the test inserts one (off by default, no backfill)'
);

select lives_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('22000000-0000-4000-8000-000000000001', 'profile_form', false) $$,
  'PFORM-01: the widened tenant_modules_key_chk accepts the profile_form key'
);

select throws_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('22000000-0000-4000-8000-000000000001', 'nao_existe', false) $$,
  '23514',
  null,
  'PFORM-01: a key outside the vocabulary is still refused (23514)'
);

select is(
  (select enabled from public.tenant_modules
    where tenant_id = '22000000-0000-4000-8000-000000000001' and module_key = 'profile_form'),
  false,
  'PFORM-01: the row the test inserted reads as disabled, the same as a missing row'
);

-- PFORM-01 ordering: the CHECK lists the keys in the array's order, profile_form last, payments right before it.
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'tenant_modules_key_chk' and conrelid = 'public.tenant_modules'::regclass),
  'payments.{1,40}profile_form',
  'PFORM-01: payments sits immediately before profile_form in the CHECK definition'
);

select is(
  (select array_agg(k order by ord) from (
     select m[1] as k, ord
       from pg_constraint c,
            regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') with ordinality as t(m, ord)
      where c.conname = 'tenant_modules_key_chk' and c.conrelid = 'public.tenant_modules'::regclass
   ) q),
  array['feed','communities','stories','events','chat','notifications','reels','store','courses','social','payments','profile_form']::text[],
  'PFORM-01: the CHECK lists the twelve keys in TOGGLEABLE_MODULES order, profile_form last'
);

select is(
  (select count(*) from public.tenant_modules where module_key = 'profile_form' and enabled),
  0::bigint,
  'PFORM-01/T-12-04: still no enabled profile_form row after the control insert'
);

-- ── (2) shape and CHECKs ───────────────────────────────────────────────────────────────────────
select has_table('public', 'profile_form_questions', 'profile_form_questions exists');
select has_table('public', 'profile_form_answers', 'profile_form_answers exists');
select columns_are('public', 'profile_form_questions', array[
  'id', 'tenant_id', 'type', 'title', 'help_text', 'required', 'show_on_profile', 'allow_other', 'options', 'limits',
  'position', 'archived_at', 'listed_at', 'revision', 'created_by_user_id', 'created_at', 'updated_at',
  -- Phase 12.1 (plan 03): the step and the condition of a question
  'step_id', 'condition_question_id', 'condition_values'
], 'profile_form_questions has exactly the planned columns');
select columns_are('public', 'profile_form_answers', array[
  'id', 'tenant_id', 'question_id', 'membership_id', 'user_id', 'value', 'created_at', 'updated_at'
], 'profile_form_answers has exactly the planned columns (no flag, no counter, no per-answer type)');
select col_is_pk('public', 'profile_form_questions', 'id', 'profile_form_questions.id is the primary key');
select col_is_pk('public', 'profile_form_answers', 'id', 'profile_form_answers.id is the primary key');
select has_index('public', 'profile_form_questions', 'profile_form_questions_tenant_archived_position_idx', 'the list index exists (tenant first)');
select has_index('public', 'profile_form_questions', 'profile_form_questions_required_idx', 'the partial index of active required questions exists');
select has_index('public', 'profile_form_answers', 'profile_form_answers_member_question_uq', 'one answer per member and question (index)');
select has_index('public', 'profile_form_answers', 'profile_form_answers_tenant_question_idx', 'the (tenant, question) index exists');
select is(
  (select indpred is not null from pg_index where indexrelid = 'public.profile_form_questions_required_idx'::regclass),
  true, 'D-585: the required index is PARTIAL (required and not archived)');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profile_form_questions'::regclass
      and conname in ('profile_form_questions_type_chk', 'profile_form_questions_title_chk', 'profile_form_questions_help_chk',
                      'profile_form_questions_options_chk', 'profile_form_questions_other_chk', 'profile_form_questions_limits_chk',
                      'profile_form_questions_revision_chk', 'profile_form_questions_tenant_id_uq')),
  8, 'profile_form_questions carries its seven named CHECKs and its (tenant, id) unique');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profile_form_answers'::regclass and conname = 'profile_form_answers_value_chk'),
  1, 'profile_form_answers carries its value size CHECK');

-- PFORM-05 adjacency: the TypeScript list and the CHECK list are compared as ORDERED arrays (13 names, no tolerance).
select is(
  (select array_agg(k order by ord) from (
     select m[1] as k, ord
       from pg_constraint c,
            regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') with ordinality as t(m, ord)
      where c.conname = 'profile_form_questions_type_chk' and c.conrelid = 'public.profile_form_questions'::regclass
   ) q),
  array['short_text','long_text','dropdown','multiple_choice','single_choice','number','date','phone','email','link','yes_no','acceptance','rating']::text[],
  'PFORM-05/D-591: the type CHECK lists the thirteen PROFILE_FORM_TYPES in the contract''s order');
select is(
  (select array_length(array_agg(k), 1) from (
     select m[1] as k
       from pg_constraint c,
            regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as t(m)
      where c.conname = 'profile_form_questions_type_chk' and c.conrelid = 'public.profile_form_questions'::regclass
   ) q),
  13, 'PFORM-05: the type CHECK holds exactly thirteen names (a type in one list and not the other fails)');

-- CHECKs refuse (23514). The inserts run as the migration role, so only the CHECK can say no.
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'state_city', 'x', 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'PFORM-05: an unknown question type is refused');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', '', 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'an empty title is refused');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', repeat('t', 121), 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a 121-character title is refused');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-0000000002f1', '22000000-0000-4000-8000-000000000001', 'short_text', repeat('t', 120), 90, '22000000-0000-4000-8000-0000000000a1') $$,
  'a 120-character title is accepted (the boundary)');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, help_text, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'x', repeat('h', 301), 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a 301-character help text is refused');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, help_text, position, created_by_user_id)
     values ('22000000-0000-4000-8000-0000000002f2', '22000000-0000-4000-8000-000000000001', 'short_text', 'x', repeat('h', 300), 91, '22000000-0000-4000-8000-0000000000a1') $$,
  'a 300-character help text is accepted (the boundary)');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, options, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'dropdown', 'x',
             (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'label', 'o' || i)) from generate_series(1, 21) i), 9,
             '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'PFORM-05: 21 options are refused');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, options, position, created_by_user_id)
     values ('22000000-0000-4000-8000-0000000002f3', '22000000-0000-4000-8000-000000000001', 'dropdown', 'x',
             (select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'label', 'o' || i)) from generate_series(1, 20) i), 92,
             '22000000-0000-4000-8000-0000000000a1') $$,
  'PFORM-05: 20 options are accepted (the boundary)');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, options, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'single_choice', 'x', '[{"id":"a","label":"A"}]'::jsonb, 9,
             '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'PFORM-05 empty: a choice type with ONE option is refused');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'multiple_choice', 'x', 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'PFORM-05 empty: a choice type with NO options (the default []) is refused');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, options, position, created_by_user_id)
     values ('22000000-0000-4000-8000-0000000002f4', '22000000-0000-4000-8000-000000000001', 'single_choice', 'x',
             '[{"id":"a","label":"A"},{"id":"b","label":"B"}]'::jsonb, 93, '22000000-0000-4000-8000-0000000000a1') $$,
  'PFORM-05: a choice type with TWO options is accepted (the boundary)');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, options, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'x', '[{"id":"a","label":"A"},{"id":"b","label":"B"}]'::jsonb, 9,
             '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'PFORM-05: a non-choice type with a non-empty options array is refused');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, options, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'single_choice', 'x', '{"a":1}'::jsonb, 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'options that are not an array are refused');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, allow_other, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'x', true, 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'allow_other on a text type is refused (Outro exists only on the three choice types)');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, limits, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'number', 'x', '[1,2]'::jsonb, 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'limits that are not an object are refused');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, revision, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'x', 0, 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'a revision below 1 is refused');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001a3',
             '22000000-0000-4000-8000-0000000000a3', to_jsonb(repeat('v', 4100))) $$,
  '23514', null, 'D-591: an answer value over 4096 bytes is refused');
select lives_ok(
  $$ insert into public.profile_form_answers (id, tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-0000000003f1', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5',
             '22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-0000000000a3', to_jsonb(repeat('v', 1000))) $$,
  'an answer value of 1000 characters is accepted');
delete from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003f1';
delete from public.profile_form_questions where id in
  ('22000000-0000-4000-8000-0000000002f1', '22000000-0000-4000-8000-0000000002f2', '22000000-0000-4000-8000-0000000002f3', '22000000-0000-4000-8000-0000000002f4');

-- ── (3) exposure ───────────────────────────────────────────────────────────────────────────────
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.profile_form_questions'::regclass), true,
  'profile_form_questions: RLS on and NOT forced');
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.profile_form_answers'::regclass), true,
  'profile_form_answers: RLS on and NOT forced');
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.profile_form_questions'::regclass $$,
  $$ values ('profile_form_questions_select'), ('profile_form_questions_insert'), ('profile_form_questions_update'), ('profile_form_questions_delete') $$,
  'profile_form_questions has exactly its four named policies');
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.profile_form_answers'::regclass $$,
  $$ values ('profile_form_answers_self_select'), ('profile_form_answers_staff_select'), ('profile_form_answers_public_select'),
            ('profile_form_answers_self_insert'), ('profile_form_answers_self_update'), ('profile_form_answers_self_delete') $$,
  'D-593: profile_form_answers has exactly its six named policies (self, staff, public-flagged; NOT the tenant-wide profile select)');
select is(
  (select string_agg(polcmd::text, ',' order by polcmd::text) from pg_policy where polrelid = 'public.profile_form_answers'::regclass),
  'a,d,r,r,r,w', 'the answer policies are insert, delete, three selects and update: no FOR ALL policy');
select is(
  (select count(*)::int from pg_policy
    where polrelid in ('public.profile_form_questions'::regclass, 'public.profile_form_answers'::regclass)
      and polpermissive and polroles = array['authenticated'::regrole::oid]),
  10, 'all ten policies are permissive and granted to authenticated only');
select ok(
  not (has_table_privilege('anon', 'public.profile_form_questions', 'select') or has_table_privilege('anon', 'public.profile_form_questions', 'insert')
    or has_table_privilege('anon', 'public.profile_form_questions', 'update') or has_table_privilege('anon', 'public.profile_form_questions', 'delete')),
  'anon holds no privilege on profile_form_questions');
select ok(
  not (has_table_privilege('anon', 'public.profile_form_answers', 'select') or has_table_privilege('anon', 'public.profile_form_answers', 'insert')
    or has_table_privilege('anon', 'public.profile_form_answers', 'update') or has_table_privilege('anon', 'public.profile_form_answers', 'delete')),
  'anon holds no privilege on profile_form_answers');
select ok(
  has_table_privilege('authenticated', 'public.profile_form_answers', 'select') and has_table_privilege('authenticated', 'public.profile_form_answers', 'insert')
    and has_table_privilege('authenticated', 'public.profile_form_answers', 'update') and has_table_privilege('authenticated', 'public.profile_form_answers', 'delete'),
  'authenticated keeps select, insert, update and delete on the answers (the policies decide)');

-- ── (4) policies x two tenants ─────────────────────────────────────────────────────────────────
-- The admin of A: reads all of A's questions (archived included) and A's answers (staff), writes questions, never answers.
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a1', 'admin_tenant');
select set_eq(
  $$ select id::text from public.profile_form_questions $$,
  $$ values ('22000000-0000-4000-8000-0000000002a1'), ('22000000-0000-4000-8000-0000000002a2'), ('22000000-0000-4000-8000-0000000002a3'),
            ('22000000-0000-4000-8000-0000000002a4'), ('22000000-0000-4000-8000-0000000002a5'), ('22000000-0000-4000-8000-0000000002a6') $$,
  'PFORM-08: the admin of A reads exactly A''s six questions, the archived one included (as a SET)');
select is_empty(
  $$ select 1 from public.profile_form_questions where tenant_id = '22000000-0000-4000-8000-000000000002' $$,
  'PFORM-08: the admin of A reads ZERO of B''s questions');
select is((select count(*)::int from public.profile_form_questions where title = 'Cidade'), 1,
  'PFORM-08 adjacency: the title ''Cidade'' exists in both tenants but A reads exactly one');
select set_eq(
  $$ select id::text from public.profile_form_answers $$,
  $$ values ('22000000-0000-4000-8000-0000000003a1'), ('22000000-0000-4000-8000-0000000003a2'), ('22000000-0000-4000-8000-0000000003a3'),
            ('22000000-0000-4000-8000-0000000003a4'), ('22000000-0000-4000-8000-0000000003a5') $$,
  'D-593: the admin reads every answer of A, private and archived included, and none of B''s');
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-0000000002a7', '22000000-0000-4000-8000-000000000001', 'short_text', 'Nova', 7, '22000000-0000-4000-8000-0000000000a1') $$,
  'the admin of A inserts a question for A');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000002', 'short_text', 'Intruso', 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'PFORM-08: the admin of A cannot insert a question for B');
select results_eq(
  $$ with u as (update public.profile_form_questions set title = 'Hacked' where tenant_id = '22000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from u $$,
  array[0], 'the admin of A updates zero of B''s questions');
select results_eq(
  $$ with d as (delete from public.profile_form_questions where tenant_id = '22000000-0000-4000-8000-000000000002' returning 1) select count(*)::int from d $$,
  array[0], 'the admin of A deletes zero of B''s questions');
select throws_ok(
  $$ update public.profile_form_questions set tenant_id = '22000000-0000-4000-8000-000000000002' where id = '22000000-0000-4000-8000-0000000002a7' $$,
  '42501', null, 'the admin of A cannot hand its own question to B');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001a1',
             '22000000-0000-4000-8000-0000000000a1', '"x"'::jsonb) $$,
  '42501', null, 'D-584: staff never write answers (the admin insert is refused)');
select results_eq(
  $$ with d as (delete from public.profile_form_questions where id = '22000000-0000-4000-8000-0000000002a7' returning 1) select count(*)::int from d $$,
  array[1], 'the admin of A deletes its own never-answered question');
reset role;

select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a2', 'support_tenant');
select set_eq(
  $$ select id::text from public.profile_form_questions $$,
  $$ values ('22000000-0000-4000-8000-0000000002a1'), ('22000000-0000-4000-8000-0000000002a2'), ('22000000-0000-4000-8000-0000000002a3'),
            ('22000000-0000-4000-8000-0000000002a4'), ('22000000-0000-4000-8000-0000000002a5'), ('22000000-0000-4000-8000-0000000002a6') $$,
  'a support_tenant of A reads A''s six questions, the archived one included');
select set_eq(
  $$ select id::text from public.profile_form_answers $$,
  $$ values ('22000000-0000-4000-8000-0000000003a1'), ('22000000-0000-4000-8000-0000000003a2'), ('22000000-0000-4000-8000-0000000003a3'),
            ('22000000-0000-4000-8000-0000000003a4'), ('22000000-0000-4000-8000-0000000003a5') $$,
  'D-593: a support_tenant reads every answer of A and none of B''s');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'Suporte', 9, '22000000-0000-4000-8000-0000000000a2') $$,
  '42501', null, 'a support_tenant cannot insert a question');
select results_eq(
  $$ with u as (update public.profile_form_questions set title = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'a support_tenant updates zero questions');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001a2',
             '22000000-0000-4000-8000-0000000000a2', '"x"'::jsonb) $$,
  '42501', null, 'D-584: a support_tenant cannot write an answer');
reset role;

-- member1 of A (user a3): the active questions, her own answers and the public ones of the others; never a private one.
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a3', 'member');
select set_eq(
  $$ select id::text from public.profile_form_questions $$,
  $$ values ('22000000-0000-4000-8000-0000000002a1'), ('22000000-0000-4000-8000-0000000002a2'), ('22000000-0000-4000-8000-0000000002a4'),
            ('22000000-0000-4000-8000-0000000002a5'), ('22000000-0000-4000-8000-0000000002a6') $$,
  'a member of A reads A''s five ACTIVE questions');
select is_empty(
  $$ select 1 from public.profile_form_questions where id = '22000000-0000-4000-8000-0000000002a3' $$,
  'a member does not read the archived question');
select set_eq(
  $$ select id::text from public.profile_form_answers $$,
  $$ values ('22000000-0000-4000-8000-0000000003a1'), ('22000000-0000-4000-8000-0000000003a2'), ('22000000-0000-4000-8000-0000000003a5'),
            ('22000000-0000-4000-8000-0000000003a4') $$,
  'D-593: member1 reads her three own answers plus the PUBLIC-flagged answer of member2');
select is_empty(
  $$ select 1 from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003a3' $$,
  'D-593/T-12-06: member1 does NOT read member2''s private answer');
select is_empty(
  $$ select 1 from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003b1' $$,
  'T-12-06: member1 does NOT read tenant B''s answer');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'Membro', 9, '22000000-0000-4000-8000-0000000000a3') $$,
  '42501', null, 'a member cannot insert a question');
select results_eq(
  $$ with u as (update public.profile_form_questions set title = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'a member updates zero questions');
select results_eq(
  $$ with d as (delete from public.profile_form_questions returning 1) select count(*)::int from d $$,
  array[0], 'a member deletes zero questions');
select lives_ok(
  $$ insert into public.profile_form_answers (id, tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-0000000003a6', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a4',
             '22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-0000000000a3',
             '{"optionId":"22000000-0000-4000-8000-0000000004a1","otherText":null}'::jsonb) $$,
  'T-12-07: member1 answers a question of her own tenant for her own membership');
select results_eq(
  $$ select value->>'optionId' from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003a6' $$,
  array['22000000-0000-4000-8000-0000000004a1'], 'the positive control reads back the answer she just wrote');
select results_eq(
  $$ select value->>'optionId' from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003a6' $$,
  array['22000000-0000-4000-8000-0000000004a1'], 'PFORM-08 idempotency: reading it again returns the same row');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a4', '22000000-0000-4000-8000-0000000001a3',
             '22000000-0000-4000-8000-0000000000a3', '"duplicado"'::jsonb) $$,
  '23505', null, 'a second answer to the same question by the same membership is refused (unique)');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a6', '22000000-0000-4000-8000-0000000001a4',
             '22000000-0000-4000-8000-0000000000a3', '"x"'::jsonb) $$,
  '42501', null, 'T-12-07: an answer for ANOTHER member''s membership (her own user id) is refused by the policy');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a6', '22000000-0000-4000-8000-0000000001a4',
             '22000000-0000-4000-8000-0000000000a4', '"x"'::jsonb) $$,
  '42501', null, 'T-12-07: an answer in another member''s name (user id and membership) is refused');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002b2', '22000000-0000-4000-8000-0000000001a3',
             '22000000-0000-4000-8000-0000000000a3', '"x"'::jsonb) $$,
  '23503', null, 'PFORM-08 adjacency: an answer of A''s membership to B''s question is refused by the composite foreign key');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000002b2', '22000000-0000-4000-8000-0000000001a3',
             '22000000-0000-4000-8000-0000000000a3', '"x"'::jsonb) $$,
  '42501', null, 'an answer written into tenant B is refused by the policy');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001a3',
             '22000000-0000-4000-8000-0000000000a3', to_jsonb(repeat('v', 4100))) $$,
  '23514', null, 'the 4096-byte CHECK holds for a member write too');
select results_eq(
  $$ with u as (update public.profile_form_answers set value = '"Recife PE"'::jsonb where id = '22000000-0000-4000-8000-0000000003a1' returning 1) select count(*)::int from u $$,
  array[1], 'member1 updates her own answer');
select results_eq(
  $$ with u as (update public.profile_form_answers set value = '"Hacked"'::jsonb where id = '22000000-0000-4000-8000-0000000003a4' returning 1) select count(*)::int from u $$,
  array[0], 'member1 updates zero of member2''s answers, even the public one');
select results_eq(
  $$ with d as (delete from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003a3' returning 1) select count(*)::int from d $$,
  array[0], 'member1 deletes zero of member2''s answers');
select throws_ok(
  $$ update public.profile_form_answers set user_id = '22000000-0000-4000-8000-0000000000a4' where id = '22000000-0000-4000-8000-0000000003a1' $$,
  '42501', null, 'member1 cannot hand her answer to member2 (with check)');
select throws_ok(
  $$ update public.profile_form_answers set membership_id = '22000000-0000-4000-8000-0000000001a4' where id = '22000000-0000-4000-8000-0000000003a1' $$,
  '42501', null, 'member1 cannot move her answer onto member2''s membership (with check)');
select results_eq(
  $$ with d as (delete from public.profile_form_answers where id = '22000000-0000-4000-8000-0000000003a6' returning 1) select count(*)::int from d $$,
  array[1], 'member1 deletes her own answer');
reset role;

-- A public question that is ARCHIVED stops showing its answers to the others; the owner keeps reading hers.
update public.profile_form_questions set archived_at = now() where id = '22000000-0000-4000-8000-0000000002a1';
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a3', 'member');
select set_eq(
  $$ select id::text from public.profile_form_answers $$,
  $$ values ('22000000-0000-4000-8000-0000000003a1'), ('22000000-0000-4000-8000-0000000003a2'), ('22000000-0000-4000-8000-0000000003a5') $$,
  'D-593: once the public question is archived member2''s answer is hidden from member1 (her own stay)');
reset role;
update public.profile_form_questions set archived_at = null where id = '22000000-0000-4000-8000-0000000002a1';

-- member2 sees the mirror image: her two own answers plus member1's PUBLIC one, never member1's private phone.
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a4', 'member');
select set_eq(
  $$ select id::text from public.profile_form_answers $$,
  $$ values ('22000000-0000-4000-8000-0000000003a3'), ('22000000-0000-4000-8000-0000000003a4'), ('22000000-0000-4000-8000-0000000003a1') $$,
  'PFORM-08 ordering: member2 reads her two own answers and member1''s public one (as a SET)');
select is_empty(
  $$ select 1 from public.profile_form_answers where id in ('22000000-0000-4000-8000-0000000003a2', '22000000-0000-4000-8000-0000000003a5') $$,
  'member2 does not read member1''s private phone or her archived answer');
reset role;

-- Tenant B: its admin and its member see only B; the same attempts at A fail and the positive control passes.
select tests.as_tenant('22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000000b1', 'admin_tenant');
select set_eq(
  $$ select id::text from public.profile_form_questions $$,
  $$ values ('22000000-0000-4000-8000-0000000002b1'), ('22000000-0000-4000-8000-0000000002b2') $$,
  'PFORM-08: the admin of B reads exactly B''s two questions');
select is((select count(*)::int from public.profile_form_questions where title = 'Cidade'), 1,
  'PFORM-08 adjacency: B also reads exactly one ''Cidade'' (its own)');
select results_eq(
  $$ with u as (update public.profile_form_questions set title = 'Hacked' where tenant_id = '22000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  array[0], 'PFORM-08 idempotency: the admin of B updates zero of A''s questions');
select results_eq(
  $$ with u as (update public.profile_form_questions set title = 'Hacked' where tenant_id = '22000000-0000-4000-8000-000000000001' returning 1) select count(*)::int from u $$,
  array[0], 'PFORM-08 idempotency: the same attempt repeated returns the same refusal');
select set_eq(
  $$ select id::text from public.profile_form_answers $$,
  $$ values ('22000000-0000-4000-8000-0000000003b1') $$,
  'the admin of B reads exactly B''s one answer');
reset role;

select tests.as_tenant('22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000000b3', 'member');
select set_eq(
  $$ select id::text from public.profile_form_questions $$,
  $$ values ('22000000-0000-4000-8000-0000000002b1'), ('22000000-0000-4000-8000-0000000002b2') $$,
  'a member of B reads B''s two active questions and none of A''s');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001b3',
             '22000000-0000-4000-8000-0000000000b3', '"x"'::jsonb) $$,
  '23503', null, 'PFORM-08 adjacency: a member of B answering A''s question is refused by the composite foreign key');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001b3',
             '22000000-0000-4000-8000-0000000000b3', '"x"'::jsonb) $$,
  '42501', null, 'a member of B writing into tenant A is refused by the policy');
select lives_ok(
  $$ insert into public.profile_form_answers (id, tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-0000000003b2', '22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000002b2',
             '22000000-0000-4000-8000-0000000001b3', '22000000-0000-4000-8000-0000000000b3', '"x"'::jsonb) $$,
  'the positive control: a member of B answers B''s own question');
reset role;

-- PFORM-08 concurrency: two sessions of two tenants in ONE transaction, claims switched per statement, interleaved inserts.
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a3', 'member');
select lives_ok(
  $$ insert into public.profile_form_answers (id, tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-0000000003a7', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5',
             '22000000-0000-4000-8000-0000000001a3', '22000000-0000-4000-8000-0000000000a3', '"conta A"'::jsonb) $$,
  'concurrency: the member of A inserts after the member of B did');
select is((select count(*)::int from public.profile_form_answers where question_id = '22000000-0000-4000-8000-0000000002b2'), 0,
  'concurrency: after the interleaved inserts the member of A reads none of B''s rows');
select is((select count(*)::int from public.profile_form_answers where question_id = '22000000-0000-4000-8000-0000000002a5'), 1,
  'concurrency: and reads her own');
reset role;
select tests.as_tenant('22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-0000000000b3', 'member');
select is((select count(*)::int from public.profile_form_answers where question_id = '22000000-0000-4000-8000-0000000002a5'), 0,
  'concurrency: the member of B reads none of A''s rows');
select is((select count(*)::int from public.profile_form_answers where question_id = '22000000-0000-4000-8000-0000000002b2'), 1,
  'concurrency: and reads her own');
reset role;
delete from public.profile_form_answers where id in ('22000000-0000-4000-8000-0000000003a7', '22000000-0000-4000-8000-0000000003b2');

-- PFORM-08 empty: a null role, an unknown role and a lane without claims read and write nothing.
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a3', null);
select is_empty($$ select 1 from public.profile_form_questions $$, 'a lane with a NULL role claim reads no question (fails closed)');
select is_empty($$ select 1 from public.profile_form_answers $$, 'a lane with a NULL role claim reads no answer, not even her own');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001a3',
             '22000000-0000-4000-8000-0000000000a3', '"x"'::jsonb) $$,
  '42501', null, 'a lane with a NULL role claim writes no answer');
reset role;
select tests.as_tenant('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000a3', 'owner');
select is_empty($$ select 1 from public.profile_form_questions $$, 'a lane with an unknown role claim reads no question');
select is_empty($$ select 1 from public.profile_form_answers $$, 'a lane with an unknown role claim reads no answer');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from public.profile_form_questions $$, 'a lane with NO claims reads no question');
select is_empty($$ select 1 from public.profile_form_answers $$, 'a lane with NO claims reads no answer');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('22000000-0000-4000-8000-000000000001', 'short_text', 'Sem claims', 9, '22000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'a lane with NO claims writes no question');
reset role;

-- A tenant with no questions: its members read the empty set, not an error.
select tests.tenant('pgtap-pform-c', 'Pform C', '22000000-0000-4000-8000-000000000003');
select tests.auth_user('member1@pform-c.local', '22000000-0000-4000-8000-0000000000c3');
select tests.member('22000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-0000000000c3', 'member');
select tests.as_tenant('22000000-0000-4000-8000-000000000003', '22000000-0000-4000-8000-0000000000c3', 'member');
select is_empty($$ select 1 from public.profile_form_questions $$, 'PFORM-08 empty: a tenant with no questions reads zero question rows');
select is_empty($$ select 1 from public.profile_form_answers $$, 'PFORM-08 empty: and zero answer rows');
reset role;

-- ── (6) the gate rule ──────────────────────────────────────────────────────────────────────────
-- Tenant D has its own members so the counts below never touch the fixtures of sections 4 and 5.
select tests.tenant('pgtap-pform-d', 'Pform D', '22000000-0000-4000-8000-000000000004');
select tests.auth_user('admin@pform-d.local', '22000000-0000-4000-8000-0000000000d1');
select tests.auth_user('support@pform-d.local', '22000000-0000-4000-8000-0000000000d2');
select tests.auth_user('member1@pform-d.local', '22000000-0000-4000-8000-0000000000d3');
select tests.auth_user('member2@pform-d.local', '22000000-0000-4000-8000-0000000000d4');
select tests.auth_user('gone@pform-d.local', '22000000-0000-4000-8000-0000000000d5');
insert into public.memberships (id, tenant_id, user_id, role, status, deleted_at) values
  ('22000000-0000-4000-8000-0000000001d1', '22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d1', 'admin_tenant', 'active', null),
  ('22000000-0000-4000-8000-0000000001d2', '22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d2', 'support_tenant', 'active', null),
  ('22000000-0000-4000-8000-0000000001d3', '22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d3', 'member', 'active', null),
  ('22000000-0000-4000-8000-0000000001d4', '22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d4', 'member', 'active', null),
  ('22000000-0000-4000-8000-0000000001d5', '22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d5', 'member', 'active', now());
-- member1 of D is ALSO a member of A (the second tenant of the lookup that lists every membership).
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('22000000-0000-4000-8000-0000000001d6', '22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000000d3', 'member', 'active');

-- D1 required short text, D2 required single choice, D3 optional, D4 required but ARCHIVED.
insert into public.profile_form_questions (id, tenant_id, type, title, required, options, position, archived_at, created_by_user_id) values
  ('22000000-0000-4000-8000-0000000006d1', '22000000-0000-4000-8000-000000000004', 'short_text', 'Obrigatoria 1', true, '[]'::jsonb, 1, null, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000006d2', '22000000-0000-4000-8000-000000000004', 'single_choice', 'Obrigatoria 2', true,
     '[{"id":"x1","label":"Sim"},{"id":"x2","label":"Nao"}]'::jsonb, 2, null, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000006d3', '22000000-0000-4000-8000-000000000004', 'short_text', 'Opcional', false, '[]'::jsonb, 3, null, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000006d4', '22000000-0000-4000-8000-000000000004', 'short_text', 'Arquivada obrigatoria', true, '[]'::jsonb, 4, now(), '22000000-0000-4000-8000-0000000000d1');

-- PFORM-09 empty: no tenant_modules row at all.
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 0,
  'PFORM-09 empty: no tenant_modules row gives 0 even with two required questions open');
insert into public.tenant_modules (tenant_id, module_key, enabled) values ('22000000-0000-4000-8000-000000000004', 'profile_form', false);
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 0,
  'D-589: the module row present but disabled gives 0');
update public.tenant_modules set enabled = true where tenant_id = '22000000-0000-4000-8000-000000000004' and module_key = 'profile_form';
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 2,
  'PFORM-09 adjacency: module on, a member with nothing answered owes the two ACTIVE required questions (optional and archived not counted)');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d4'), 2,
  'the other member owes the same two (answers are per membership)');
insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value) values
  ('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000006d1', '22000000-0000-4000-8000-0000000001d3', '22000000-0000-4000-8000-0000000000d3', '"Ana"'::jsonb);
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 1,
  'PFORM-09 adjacency: one required question answered leaves 1 missing');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d4'), 2,
  'and the other member is still at 2');
insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value) values
  ('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000006d2', '22000000-0000-4000-8000-0000000001d3', '22000000-0000-4000-8000-0000000000d3', '{"optionId":"x1","otherText":null}'::jsonb);
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 0,
  'PFORM-09 adjacency: every required question answered gives 0');
-- No cache: a required question inserted a moment ago counts immediately.
insert into public.profile_form_questions (id, tenant_id, type, title, required, options, position, created_by_user_id) values
  ('22000000-0000-4000-8000-0000000006d5', '22000000-0000-4000-8000-000000000004', 'short_text', 'Nova obrigatoria', true, '[]'::jsonb, 5, '22000000-0000-4000-8000-0000000000d1');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 1,
  'PFORM-09: a required question inserted a moment ago counts at once (no cache, no stored flag)');
update public.profile_form_questions set required = false where id = '22000000-0000-4000-8000-0000000006d5';
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 0,
  'D-585: making it optional frees the member');
update public.profile_form_questions set required = true where id = '22000000-0000-4000-8000-0000000006d5';
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 1,
  'D-585: making it required again reopens the form for the member');
update public.profile_form_questions set archived_at = now() where id = '22000000-0000-4000-8000-0000000006d5';
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 0,
  'PFORM-09: archiving it frees the member (an archived required question is not counted)');
update public.profile_form_questions set archived_at = null where id = '22000000-0000-4000-8000-0000000006d5';
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 1,
  'D-585: reactivating it reopens the form');
-- PFORM-09 ordering: positions reversed, the count is the same.
update public.profile_form_questions set position = 100 - position where tenant_id = '22000000-0000-4000-8000-000000000004';
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d3'), 1,
  'PFORM-09 ordering: the count does not depend on question position');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d4'), 3,
  'PFORM-09 ordering: nor on creation order (the other member owes the three active required questions)');
-- PFORM-09 empty: staff, another tenant's membership, a soft-deleted membership.
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d1'), 0,
  'D-584: an admin_tenant is never held');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d2'), 0,
  'D-584: a support_tenant is never held');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d6'), 0,
  'PFORM-09 empty: a membership of ANOTHER tenant asked against this tenant gives 0');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d5'), 0,
  'PFORM-09 empty: a soft-deleted membership gives 0');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', gen_random_uuid()), 0,
  'PFORM-09 empty: an unknown membership gives 0');
update public.profile_form_questions set archived_at = now()
 where tenant_id = '22000000-0000-4000-8000-000000000004' and required and archived_at is null;
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d4'), 0,
  'PFORM-09 empty: with every required question archived nobody is held (D-589)');
update public.profile_form_questions set archived_at = null
 where id in ('22000000-0000-4000-8000-0000000006d1', '22000000-0000-4000-8000-0000000006d2', '22000000-0000-4000-8000-0000000006d5');
select is(app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d4'), 3,
  'D-585: reactivating them reopens the form for the member who had answered none');

-- The session variant: the membership comes from the claims, never from an argument (T-12-08).
select tests.as_tenant('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d4', 'member');
select is(app.profile_form_missing_self(), 3, 'T-12-08: a member session reads its OWN pending count through the no-argument variant');
reset role;
select tests.as_tenant('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d3', 'member');
select is(app.profile_form_missing_self(), 1, 'and member1 reads hers (a different number from the same function)');
reset role;
select tests.as_tenant('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d1', 'admin_tenant');
select is(app.profile_form_missing_self(), 0, 'an admin_tenant session reads 0');
reset role;
select tests.as_tenant('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000a3', 'member');
select is(app.profile_form_missing_self(), 0, 'a session of tenant D whose user has no membership there reads 0');
reset role;
select tests.as_tenant_without_claims();
select is(app.profile_form_missing_self(), 0, 'a lane with NO claims reads 0');
reset role;

-- The `_gate` twins return the seven columns of the `_gated` twins, row by row, plus the count.
select results_eq(
  $$ select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status, access_state
       from app.membership_in_tenant_gate('22000000-0000-4000-8000-0000000000d3', '22000000-0000-4000-8000-000000000004') $$,
  $$ select * from app.membership_in_tenant_gated('22000000-0000-4000-8000-0000000000d3', '22000000-0000-4000-8000-000000000004') $$,
  'PFORM-25: membership_in_tenant_gate returns the _gated columns row by row');
select is(
  (select profile_form_missing from app.membership_in_tenant_gate('22000000-0000-4000-8000-0000000000d3', '22000000-0000-4000-8000-000000000004')),
  1, 'D-581: and carries the pending count in the same statement');
select is(
  (select profile_form_missing from app.membership_in_tenant_gate('22000000-0000-4000-8000-0000000000d1', '22000000-0000-4000-8000-000000000004')),
  0, 'an admin_tenant row carries 0');
select is_empty(
  $$ select 1 from app.membership_in_tenant_gate('22000000-0000-4000-8000-0000000000d3', '22000000-0000-4000-8000-000000000002') $$,
  'a user with no membership in the asked tenant gets no row');
select results_eq(
  $$ select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status, access_state
       from app.memberships_of_user_gate('22000000-0000-4000-8000-0000000000d3') $$,
  $$ select * from app.memberships_of_user_gated('22000000-0000-4000-8000-0000000000d3') $$,
  'PFORM-25: memberships_of_user_gate returns the _gated columns row by row, in the same (slug) order');
select results_eq(
  $$ select tenant_slug, profile_form_missing from app.memberships_of_user_gate('22000000-0000-4000-8000-0000000000d3') $$,
  $$ values ('pgtap-pform-a'::text, 0), ('pgtap-pform-d'::text, 1) $$,
  'the list lookup carries each tenant''s own count: A has the module off (0), D has one question missing');
select is(
  pg_get_function_result('app.membership_in_tenant_gated(uuid,uuid)'::regprocedure) !~ 'profile_form_missing',
  true, 'PFORM-25: the old _gated function is untouched (its result still has no profile_form_missing)');

-- ── (7) the guard trigger ──────────────────────────────────────────────────────────────────────
-- 7a1 number, 7a2 date, 7a3 multiple choice with Outro, 7a4 single choice, 7a5 private text, 7a7 public text: all ANSWERED below.
-- 7b1 text, 7b2 multiple choice with Outro, 7b3 number: never answered, so the same edits must pass.
insert into public.profile_form_questions (id, tenant_id, type, title, show_on_profile, allow_other, options, limits, position, created_by_user_id) values
  ('22000000-0000-4000-8000-0000000007a1', '22000000-0000-4000-8000-000000000004', 'number', 'Numero', false, false, '[]'::jsonb, '{"min":1,"max":10}'::jsonb, 11, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007a2', '22000000-0000-4000-8000-000000000004', 'date', 'Data', false, false, '[]'::jsonb, '{"min":"2026-01-01","max":"2026-12-31"}'::jsonb, 12, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007a3', '22000000-0000-4000-8000-000000000004', 'multiple_choice', 'Varias', false, true,
     '[{"id":"o1","label":"Um"},{"id":"o2","label":"Dois"},{"id":"o3","label":"Tres"}]'::jsonb, '{}'::jsonb, 13, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007a4', '22000000-0000-4000-8000-000000000004', 'single_choice', 'Uma', false, false,
     '[{"id":"s1","label":"A"},{"id":"s2","label":"B"}]'::jsonb, '{}'::jsonb, 14, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007a5', '22000000-0000-4000-8000-000000000004', 'short_text', 'Privada', false, false, '[]'::jsonb, '{}'::jsonb, 15, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007a7', '22000000-0000-4000-8000-000000000004', 'short_text', 'Publica', true, false, '[]'::jsonb, '{}'::jsonb, 17, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007b1', '22000000-0000-4000-8000-000000000004', 'short_text', 'Livre', false, false, '[]'::jsonb, '{}'::jsonb, 21, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007b2', '22000000-0000-4000-8000-000000000004', 'multiple_choice', 'Livre escolha', false, true,
     '[{"id":"o1","label":"Um"},{"id":"o2","label":"Dois"},{"id":"o3","label":"Tres"}]'::jsonb, '{}'::jsonb, 22, '22000000-0000-4000-8000-0000000000d1'),
  ('22000000-0000-4000-8000-0000000007b3', '22000000-0000-4000-8000-000000000004', 'number', 'Livre numero', false, false, '[]'::jsonb, '{"min":1,"max":10}'::jsonb, 23, '22000000-0000-4000-8000-0000000000d1');
insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
select '22000000-0000-4000-8000-000000000004', q, '22000000-0000-4000-8000-0000000001d4', '22000000-0000-4000-8000-0000000000d4', v
  from (values
    ('22000000-0000-4000-8000-0000000007a1'::uuid, '5'::jsonb),
    ('22000000-0000-4000-8000-0000000007a2'::uuid, '"2026-06-01"'::jsonb),
    ('22000000-0000-4000-8000-0000000007a3'::uuid, '{"optionIds":["o1"],"otherText":"Meu"}'::jsonb),
    ('22000000-0000-4000-8000-0000000007a4'::uuid, '{"optionId":"s1","otherText":null}'::jsonb),
    ('22000000-0000-4000-8000-0000000007a5'::uuid, '"segredo"'::jsonb),
    ('22000000-0000-4000-8000-0000000007a7'::uuid, '"aberto"'::jsonb)
  ) as t(q, v);

select throws_ok(
  $$ update public.profile_form_questions set type = 'long_text' where id = '22000000-0000-4000-8000-0000000007a5' $$,
  'PF001', null, 'D-587/PF001: the type of an answered question cannot change');
select lives_ok(
  $$ update public.profile_form_questions set type = 'long_text' where id = '22000000-0000-4000-8000-0000000007b1' $$,
  'PF001: the same edit passes on a never-answered question');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o2","label":"Dois"},{"id":"o3","label":"Tres"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007a3' $$,
  'PF002', null, 'D-587/PF002: an option that has answers cannot be removed');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o1","label":"Primeiro"},{"id":"o2","label":"Dois"},{"id":"o3","label":"Tres"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007a3' $$,
  'PF002', null, 'D-587/PF002: an option that has answers cannot be relabelled');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"s2","label":"B"},{"id":"s3","label":"C"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007a4' $$,
  'PF002', null, 'PF002: the single-choice answer (optionId) locks its option too');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o2","label":"Dois"},{"id":"o3","label":"Tres"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007b2' $$,
  'PF002: the same removal passes on a never-answered question');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o1","label":"Um"},{"id":"o2","label":"Segundo"},{"id":"o3","label":"Tres"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007a3' $$,
  'D-587: relabelling an option that has NO answers passes on an answered question');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o1","label":"Um"},{"id":"o2","label":"Segundo"},{"id":"o3","label":"Tres"},{"id":"o4","label":"Quatro"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007a3' $$,
  'D-587: ADDING an option to an answered question passes');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"o1","label":"Um"},{"id":"o2","label":"Segundo"}]'::jsonb where id = '22000000-0000-4000-8000-0000000007a3' $$,
  'D-587: removing options that have no answers (o3, o4) passes on an answered question');
select throws_ok(
  $$ update public.profile_form_questions set allow_other = false where id = '22000000-0000-4000-8000-0000000007a3' $$,
  'PF003', null, 'D-587/PF003: Outro cannot be turned off while an Outro answer exists');
select lives_ok(
  $$ update public.profile_form_questions set allow_other = false where id = '22000000-0000-4000-8000-0000000007b2' $$,
  'PF003: the same edit passes on a never-answered question');
select throws_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = '22000000-0000-4000-8000-0000000007a5' $$,
  'PF004', null, 'D-587/PF004: a private answered question cannot become public (T-12-09, PU-1)');
select lives_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = '22000000-0000-4000-8000-0000000007b1' $$,
  'PF004: the same edit passes on a never-answered question');
select lives_ok(
  $$ update public.profile_form_questions set show_on_profile = false where id = '22000000-0000-4000-8000-0000000007a7' $$,
  'D-587: public to private is always allowed, answers or not (the ratchet turns one way)');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":2,"max":10}'::jsonb where id = '22000000-0000-4000-8000-0000000007a1' $$,
  'PF005', null, 'D-587/PF005: a number minimum that rises is refused');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":1,"max":9}'::jsonb where id = '22000000-0000-4000-8000-0000000007a1' $$,
  'PF005', null, 'PF005: a number maximum that falls is refused');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":"2026-02-01","max":"2026-12-31"}'::jsonb where id = '22000000-0000-4000-8000-0000000007a2' $$,
  'PF005', null, 'PF005: a date minimum that rises is refused');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":"2026-01-01","max":"2026-11-30"}'::jsonb where id = '22000000-0000-4000-8000-0000000007a2' $$,
  'PF005', null, 'PF005: a date maximum that falls is refused');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{"min":2,"max":9}'::jsonb where id = '22000000-0000-4000-8000-0000000007b3' $$,
  'PF005: the same narrowing passes on a never-answered question');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{"min":0,"max":20}'::jsonb where id = '22000000-0000-4000-8000-0000000007a1' $$,
  'D-587: WIDENING a number limit on an answered question passes');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":3}'::jsonb where id = '22000000-0000-4000-8000-0000000007a1' $$,
  'PF005', null, 'PF005: after widening to 0..20 a minimum of 3 is a narrowing again (the comparison is against the CURRENT limits)');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{}'::jsonb where id = '22000000-0000-4000-8000-0000000007a1' $$,
  'D-587: removing a number limit altogether (the widest) passes');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{"min":"2025-06-01"}'::jsonb where id = '22000000-0000-4000-8000-0000000007a2' $$,
  'D-587: widening a date limit (earlier minimum, no maximum) passes');
select lives_ok(
  $$ update public.profile_form_questions set title = 'Titulo novo', help_text = 'Ajuda', required = true, position = 99 where id = '22000000-0000-4000-8000-0000000007a5' $$,
  'D-587: title, help text, required and position stay free on an answered question');
select lives_ok(
  $$ update public.profile_form_questions set archived_at = now(), revision = revision + 1 where id = '22000000-0000-4000-8000-0000000007a5' $$,
  'D-587: archiving and the revision bump stay free on an answered question');

-- ── (8) hardening ──────────────────────────────────────────────────────────────────────────────
select ok(
  not (has_function_privilege('anon', 'app.profile_form_missing(uuid,uuid)', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_missing(uuid,uuid)', 'execute')),
  'T-12-08: anon and authenticated cannot execute the two-argument rule');
select ok(
  not (has_function_privilege('anon', 'app.membership_in_tenant_gate(uuid,uuid)', 'execute')
    or has_function_privilege('authenticated', 'app.membership_in_tenant_gate(uuid,uuid)', 'execute')
    or has_function_privilege('anon', 'app.memberships_of_user_gate(uuid)', 'execute')
    or has_function_privilege('authenticated', 'app.memberships_of_user_gate(uuid)', 'execute')),
  'anon and authenticated cannot execute the two _gate twins');
select ok(
  has_function_privilege('api_user', 'app.profile_form_missing(uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_missing(uuid,uuid)', 'execute')
    and has_function_privilege('api_user', 'app.membership_in_tenant_gate(uuid,uuid)', 'execute')
    and has_function_privilege('api_user', 'app.memberships_of_user_gate(uuid)', 'execute')
    and has_function_privilege('service_role', 'app.membership_in_tenant_gate(uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'app.memberships_of_user_gate(uuid)', 'execute'),
  'api_user and service_role can execute the rule and both twins');
select ok(
  has_function_privilege('authenticated', 'app.profile_form_missing_self()', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_missing_self()', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_missing_self()', 'execute')
    and not has_function_privilege('anon', 'app.profile_form_missing_self()', 'execute'),
  'authenticated can execute the no-argument _self variant; anon cannot');
select ok(
  not (has_function_privilege('anon', 'app.profile_form_question_guard()', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_question_guard()', 'execute')
    or has_function_privilege('api_user', 'app.profile_form_question_guard()', 'execute')
    or has_function_privilege('service_role', 'app.profile_form_question_guard()', 'execute')),
  'the guard function is granted to nobody');
select tests.as_tenant('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000000d3', 'member');
select throws_ok(
  $$ select app.profile_form_missing('22000000-0000-4000-8000-000000000004', '22000000-0000-4000-8000-0000000001d4') $$,
  '42501', null, 'T-12-08: a tenant session cannot probe another member''s pending count (42501)');
select throws_ok(
  $$ select * from app.membership_in_tenant_gate('22000000-0000-4000-8000-0000000000d4', '22000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'a tenant session cannot call the _gate lookup for another user (42501)');
select lives_ok($$ select app.profile_form_missing_self() $$, 'a tenant session can call the no-argument variant');
reset role;
select is(
  (select count(*)::int from pg_proc
    where oid in ('app.profile_form_missing(uuid,uuid)'::regprocedure, 'app.profile_form_missing_self()'::regprocedure,
                  'app.membership_in_tenant_gate(uuid,uuid)'::regprocedure, 'app.memberships_of_user_gate(uuid)'::regprocedure,
                  'app.profile_form_question_guard()'::regprocedure)
      and prosecdef and proconfig @> array['search_path=""']),
  5, 'all five functions are SECURITY DEFINER with an empty search_path (catalogue)');
select ok(
  not (has_table_privilege('authenticated', 'public.profile_form_questions', 'truncate')
    or has_table_privilege('authenticated', 'public.profile_form_answers', 'truncate')),
  'T-12-06: authenticated holds no TRUNCATE on either table (RLS does not see it)');
select trigger_is('public', 'profile_form_questions', 'profile_form_questions_guard', 'app', 'profile_form_question_guard',
  'D-587: the guard trigger is attached to profile_form_questions');
select is(
  (select tgtype & 2 = 2 and tgtype & 1 = 1 and tgtype & 16 = 16 from pg_trigger
    where tgname = 'profile_form_questions_guard' and tgrelid = 'public.profile_form_questions'::regclass),
  true, 'the guard is a BEFORE UPDATE ROW trigger');

-- ── (5) foreign key and cascade ────────────────────────────────────────────────────────────────
select is(
  (select confdeltype::text from pg_constraint where conname = 'profile_form_answers_question_fk'),
  'r', 'D-588: the composite question foreign key is ON DELETE RESTRICT');
select is(
  (select confdeltype::text from pg_constraint where conname = 'profile_form_answers_membership_id_memberships_id_fk'),
  'c', 'D-594: the membership foreign key of an answer is ON DELETE CASCADE');
select is(
  (select confdeltype::text from pg_constraint where conname = 'profile_form_answers_user_id_users_id_fk'),
  'c', 'D-594: the user foreign key of an answer is ON DELETE CASCADE');
select throws_ok(
  $$ delete from public.profile_form_questions where id = '22000000-0000-4000-8000-0000000002a1' $$,
  '23503', null, 'D-588: a question with answers cannot be deleted, not even by the owner of the table');
select lives_ok(
  $$ delete from public.profile_form_questions where id = '22000000-0000-4000-8000-0000000002a6' $$,
  'D-588: a never-answered question can be deleted');
select is(
  (select count(*)::int from public.profile_form_answers where question_id = '22000000-0000-4000-8000-0000000002a1'), 2,
  'the refused delete left the answers of the question where they were');

-- PFORM-22: deleting a membership removes its answers; deleting it twice leaves nothing and the second finds nothing.
select is((select count(*)::int from public.profile_form_answers where membership_id = '22000000-0000-4000-8000-0000000001a4'), 2,
  'before the delete member2 holds two answers');
delete from public.memberships where id = '22000000-0000-4000-8000-0000000001a4';
select is((select count(*)::int from public.profile_form_answers where membership_id = '22000000-0000-4000-8000-0000000001a4'), 0,
  'PFORM-22: deleting the membership removed its answers (cascade)');
select results_eq(
  $$ with d as (delete from public.memberships where id = '22000000-0000-4000-8000-0000000001a4' returning 1) select count(*)::int from d $$,
  array[0], 'PFORM-22 idempotency: the second delete of the same membership finds nothing');
select is((select count(*)::int from public.profile_form_answers where membership_id = '22000000-0000-4000-8000-0000000001a4'), 0,
  'PFORM-22 idempotency: and still no answers');
select throws_ok(
  $$ insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
     values ('22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-0000000002a5', '22000000-0000-4000-8000-0000000001a4',
             '22000000-0000-4000-8000-0000000000a4', '"x"'::jsonb) $$,
  '23503', null, 'PFORM-22 concurrency: an answer racing the delete fails the membership foreign key once it has landed');
select is_empty(
  $$ select 1 from public.profile_form_answers a where not exists (select 1 from public.memberships m where m.id = a.membership_id) $$,
  'PFORM-22: there is never an orphan answer row');
-- An identity deleted from auth removes its memberships and, through them, its answers.
select is((select count(*)::int from public.profile_form_answers where user_id = '22000000-0000-4000-8000-0000000000a3'), 3,
  'before the identity delete member1 holds three answers');
delete from auth.users where id = '22000000-0000-4000-8000-0000000000a3';
select is((select count(*)::int from public.profile_form_answers where user_id = '22000000-0000-4000-8000-0000000000a3'), 0,
  'D-594: deleting the identity removed its answers with no extra path');

-- The dismissal column (D-586) and the widened moderation log CHECK (D-595).
select has_column('public', 'member_profiles', 'profile_form_notice_dismissed_at', 'member_profiles gains the dismissal column');
select col_is_null('public', 'member_profiles', 'profile_form_notice_dismissed_at', 'the dismissal column is nullable');
select col_hasnt_default('public', 'member_profiles', 'profile_form_notice_dismissed_at', 'the dismissal column has no default');
select is(
  (select profile_form_notice_dismissed_at is null from public.member_profiles where membership_id = '22000000-0000-4000-8000-0000000001b3'),
  true, 'PFORM-25: a profile that existed before reads the dismissal as null (no backfill)');
select lives_ok(
  $$ insert into public.moderation_log (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id)
     values ('22000000-0000-4000-8000-000000000002', 'profile_form_exported', '22000000-0000-4000-8000-0000000000b1',
             '22000000-0000-4000-8000-0000000001b1', '22000000-0000-4000-8000-0000000000b1', '22000000-0000-4000-8000-0000000001b1') $$,
  'D-595: a moderation_log row with action profile_form_exported, actor and target the same membership, no subject, inserts');
select throws_ok(
  $$ insert into public.moderation_log (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id)
     values ('22000000-0000-4000-8000-000000000002', 'profile_form_deleted', '22000000-0000-4000-8000-0000000000b1',
             '22000000-0000-4000-8000-0000000001b1', '22000000-0000-4000-8000-0000000000b1', '22000000-0000-4000-8000-0000000001b1') $$,
  '23514', null, 'an action outside the widened vocabulary is still refused');

select * from finish();
rollback;
