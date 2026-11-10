begin;
-- 229-profile-form-professional-id.sql — quick 261110-ij7 (D-587, D-591): the 14th profile-form question type and the guard that locks its
-- mask, executed inside Postgres. Migrations under test: `*_profile_form_professional_id.sql` (the type CHECK widened to 14 names) and
-- `*_profile_form_professional_id_guard.sql` (the additive BEFORE UPDATE OF limits trigger raising PF005).
--
--  1. THE CHECK accepts a professional_id question carrying limits {"format":"cro"}, and still refuses an unknown type.
--  2. THE FORMAT LOCK: on an ANSWERED professional_id question an update of limits.format throws PF005 (changed, removed); the same
--     update passes on a never-answered question; an update that leaves the format as it is passes, and so does a title edit on the
--     answered question. A non-professional_id question is untouched by the trigger.
--  3. HARDENING: the guard function is a security definer with an empty search_path and is executable by neither anon nor authenticated.
--
-- Fixture ids use the `29000000-0000-4000-8000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(15);

select tests.tenant('pgtap-pid-a', 'Pid A', '29000000-0000-4000-8000-000000000001');
select tests.auth_user('admin@pid-a.local', '29000000-0000-4000-8000-0000000000a1');
select tests.auth_user('member@pid-a.local', '29000000-0000-4000-8000-0000000000a3');
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('29000000-0000-4000-8000-0000000001a1', '29000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-0000000000a1', 'admin_tenant', 'active'),
  ('29000000-0000-4000-8000-0000000001a3', '29000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-0000000000a3', 'member', 'active');

-- ── (1) the CHECK ──────────────────────────────────────────────────────────────────────────────
select lives_ok(
  $$ insert into public.profile_form_questions (id, tenant_id, type, title, limits, position, created_by_user_id)
     values ('29000000-0000-4000-8000-0000000002a1', '29000000-0000-4000-8000-000000000001', 'professional_id', 'Registro',
             '{"format":"cro"}'::jsonb, 1, '29000000-0000-4000-8000-0000000000a1') $$,
  'D-591: the type CHECK accepts professional_id with limits {"format":"cro"}');
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, type, title, position, created_by_user_id)
     values ('29000000-0000-4000-8000-000000000001', 'professional_ids', 'x', 9, '29000000-0000-4000-8000-0000000000a1') $$,
  '23514', null, 'D-591: a name that is not in the list of 14 is still refused');
select is(
  (select limits ->> 'format' from public.profile_form_questions where id = '29000000-0000-4000-8000-0000000002a1'),
  'cro', 'the format is stored in the existing limits jsonb (no new column)');

-- ── (2) the format lock ────────────────────────────────────────────────────────────────────────
-- 2a1 (above) is ANSWERED below; 2a2 is a never-answered professional_id; 2a3 is a short_text with answers (the trigger must ignore it).
insert into public.profile_form_questions (id, tenant_id, type, title, limits, position, created_by_user_id) values
  ('29000000-0000-4000-8000-0000000002a2', '29000000-0000-4000-8000-000000000001', 'professional_id', 'Livre', '{"format":"cro"}'::jsonb, 2, '29000000-0000-4000-8000-0000000000a1'),
  ('29000000-0000-4000-8000-0000000002a3', '29000000-0000-4000-8000-000000000001', 'short_text', 'Texto', '{}'::jsonb, 3, '29000000-0000-4000-8000-0000000000a1');
insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value) values
  ('29000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-0000000002a1', '29000000-0000-4000-8000-0000000001a3', '29000000-0000-4000-8000-0000000000a3', '"CRO-SP 123456"'::jsonb),
  ('29000000-0000-4000-8000-000000000001', '29000000-0000-4000-8000-0000000002a3', '29000000-0000-4000-8000-0000000001a3', '29000000-0000-4000-8000-0000000000a3', '"abc"'::jsonb);

select throws_ok(
  $$ update public.profile_form_questions set limits = '{"format":"cnpj"}'::jsonb where id = '29000000-0000-4000-8000-0000000002a1' $$,
  'PF005', null, 'D-587/PF005: the format of an answered professional_id question cannot change');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{}'::jsonb where id = '29000000-0000-4000-8000-0000000002a1' $$,
  'PF005', null, 'PF005: removing the format of an answered question is a change too');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{"format":"cnpj"}'::jsonb where id = '29000000-0000-4000-8000-0000000002a2' $$,
  'PF005: the same change passes on a never-answered question');
select is(
  (select limits ->> 'format' from public.profile_form_questions where id = '29000000-0000-4000-8000-0000000002a2'),
  'cnpj', 'the never-answered question now carries the new format');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{"format":"cro"}'::jsonb where id = '29000000-0000-4000-8000-0000000002a1' $$,
  'an update that leaves the format as it is passes on an answered question');
select lives_ok(
  $$ update public.profile_form_questions set title = 'Registro profissional' where id = '29000000-0000-4000-8000-0000000002a1' $$,
  'a title edit on the answered question passes');
select lives_ok(
  $$ update public.profile_form_questions set limits = '{"format":"crm"}'::jsonb where id = '29000000-0000-4000-8000-0000000002a3' $$,
  'the trigger leaves a question that is not a professional_id alone (the service refuses the format there, not the trigger)');
select is(
  (select limits ->> 'format' from public.profile_form_questions where id = '29000000-0000-4000-8000-0000000002a1'),
  'cro', 'the answered question still carries its original format after the refused writes');

-- ── (3) hardening ──────────────────────────────────────────────────────────────────────────────
select is(
  (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.profile_form_format_guard()'::regprocedure),
  true, 'the guard function is a security definer with an empty search_path');
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.profile_form_questions'::regclass and tgname = 'profile_form_questions_guard_format' and not tgisinternal),
  1, 'the format trigger exists once on profile_form_questions');
select is(
  (select tgname::text from pg_trigger
    where tgrelid = 'public.profile_form_questions'::regclass and tgname in ('profile_form_questions_guard', 'profile_form_questions_guard_format')
    order by tgname desc limit 1),
  'profile_form_questions_guard_format', 'the format trigger sorts after the main guard, so PF001 speaks first when both break');
select is(
  not (has_function_privilege('anon', 'app.profile_form_format_guard()', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_format_guard()', 'execute')),
  true, 'the guard function is executable by neither anon nor authenticated');

select * from finish();
rollback;
