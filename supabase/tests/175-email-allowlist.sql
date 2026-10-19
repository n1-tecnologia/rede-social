begin;
-- 175-email-allowlist.sql — quick 261018-owq: the platform-global e-mail allowlist and the two Auth
-- hook functions that read it. Proved here, against the catalogue and by calling the functions:
--
-- a. Shape: columns, e-mail primary key, `liberado` default.
-- b. CHECKs: the e-mail is stored lowercase and trimmed, the status is `liberado | bloqueado`, the
--    e-mail is unique (SQLSTATE 23514 / 23505).
-- c. Exposure: RLS on, NOT forced, ZERO policies (only the definer functions and the admin lane read
--    it); anon and authenticated hold no privilege on the table; service_role may select.
-- d. Both functions: SECURITY DEFINER with an empty search_path, EXECUTE for supabase_auth_admin ONLY
--    (anon, authenticated, service_role and the bare api_user may not), owned by the table owner.
-- e. The token hook's behaviour matrix, called directly. pgTAP cannot `set role supabase_auth_admin`
--    (postgres is refused), so the integration suite email-allowlist.test.ts proves the real GoTrue
--    call path; the rejection envelope literal is pinned here and compared with the
--    `@rede-social/contracts` constant over there.
-- f. The creation hook's behaviour matrix.
--
-- Fixture ids use the `17500000-…` prefix, used by no other file. Like its siblings, this file ROLLS
-- BACK.
select plan(51);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.auth_user('admin@al.local', '17500000-0000-4000-8000-0000000000a1');
insert into public.platform_admins (user_id) values ('17500000-0000-4000-8000-0000000000a1');
insert into public.email_allowlist (email, status) values
  ('listed@al.local', 'liberado'),
  ('blocked@al.local', 'bloqueado');

-- ── a. shape ───────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'email_allowlist', 'email', 'email_allowlist.email exists');
select has_column('public', 'email_allowlist', 'status', 'email_allowlist.status exists');
select has_column('public', 'email_allowlist', 'created_at', 'email_allowlist.created_at exists');
select has_column('public', 'email_allowlist', 'updated_at', 'email_allowlist.updated_at exists');
select col_is_pk('public', 'email_allowlist', 'email', 'the e-mail is the primary key');
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'email_allowlist' and column_name = 'status'),
  '''liberado''::text',
  'status defaults to liberado'
);

-- ── b. CHECKs ──────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.email_allowlist (email) values ('Upper@X.local')$$,
  '23514', null, 'an upper-case e-mail is refused by the lowercase CHECK'
);
select throws_ok(
  $$insert into public.email_allowlist (email) values (' pad@x.local')$$,
  '23514', null, 'a space-padded e-mail is refused by the trim CHECK'
);
select throws_ok(
  $$insert into public.email_allowlist (email, status) values ('pend@x.local', 'pendente')$$,
  '23514', null, 'a status other than liberado | bloqueado is refused'
);
select throws_ok(
  $$insert into public.email_allowlist (email) values ('listed@al.local')$$,
  '23505', null, 'a duplicate e-mail is refused by the primary key'
);

-- ── c. exposure ────────────────────────────────────────────────────────────────────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.email_allowlist'::regclass),
  true, 'RLS is on'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.email_allowlist'::regclass),
  false, 'RLS is NOT forced: the definer owner always reads the table'
);
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.email_allowlist'::regclass),
  0, 'ZERO policies: no tenant lane can ever see a row (adding one is always a bug)'
);
select ok(
  not (has_table_privilege('anon', 'public.email_allowlist', 'select')
    or has_table_privilege('anon', 'public.email_allowlist', 'insert')
    or has_table_privilege('anon', 'public.email_allowlist', 'update')
    or has_table_privilege('anon', 'public.email_allowlist', 'delete')),
  'anon holds no privilege on the table'
);
select ok(
  not (has_table_privilege('authenticated', 'public.email_allowlist', 'select')
    or has_table_privilege('authenticated', 'public.email_allowlist', 'insert')
    or has_table_privilege('authenticated', 'public.email_allowlist', 'update')
    or has_table_privilege('authenticated', 'public.email_allowlist', 'delete')),
  'authenticated holds no privilege on the table'
);
select ok(
  has_table_privilege('service_role', 'public.email_allowlist', 'select'),
  'service_role (the admin lane, API pre-checks) may select'
);

-- ── d. hook_custom_access_token_allowlist ─────────────────────────────────────────────────────
select is(
  (select prosecdef from pg_proc where oid = 'public.hook_custom_access_token_allowlist(jsonb)'::regprocedure),
  true, 'hook_custom_access_token_allowlist is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.hook_custom_access_token_allowlist(jsonb)'::regprocedure),
  'hook_custom_access_token_allowlist pins search_path to empty'
);
select ok(not has_function_privilege('anon', 'public.hook_custom_access_token_allowlist(jsonb)', 'execute'),
  'hook_custom_access_token_allowlist: anon may NOT execute');
select ok(not has_function_privilege('authenticated', 'public.hook_custom_access_token_allowlist(jsonb)', 'execute'),
  'hook_custom_access_token_allowlist: authenticated may NOT execute');
select ok(not has_function_privilege('service_role', 'public.hook_custom_access_token_allowlist(jsonb)', 'execute'),
  'hook_custom_access_token_allowlist: service_role may NOT execute');
select ok(not has_function_privilege('api_user', 'public.hook_custom_access_token_allowlist(jsonb)', 'execute'),
  'hook_custom_access_token_allowlist: the bare api_user may NOT execute');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_custom_access_token_allowlist(jsonb)', 'execute'),
  'hook_custom_access_token_allowlist: supabase_auth_admin (GoTrue) may execute');
select is(
  (select proowner from pg_proc where oid = 'public.hook_custom_access_token_allowlist(jsonb)'::regprocedure),
  (select relowner from pg_class where oid = 'public.email_allowlist'::regclass),
  'hook_custom_access_token_allowlist is owned by the owner of email_allowlist (the definer reads it without a policy)'
);
select is(
  (select proowner from pg_proc where oid = 'public.hook_custom_access_token_allowlist(jsonb)'::regprocedure),
  (select relowner from pg_class where oid = 'public.platform_admins'::regclass),
  'hook_custom_access_token_allowlist is owned by the owner of platform_admins'
);

-- ── d. hook_before_user_created_allowlist ─────────────────────────────────────────────────────
select is(
  (select prosecdef from pg_proc where oid = 'public.hook_before_user_created_allowlist(jsonb)'::regprocedure),
  true, 'hook_before_user_created_allowlist is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc where oid = 'public.hook_before_user_created_allowlist(jsonb)'::regprocedure),
  'hook_before_user_created_allowlist pins search_path to empty'
);
select ok(not has_function_privilege('anon', 'public.hook_before_user_created_allowlist(jsonb)', 'execute'),
  'hook_before_user_created_allowlist: anon may NOT execute');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created_allowlist(jsonb)', 'execute'),
  'hook_before_user_created_allowlist: authenticated may NOT execute');
select ok(not has_function_privilege('service_role', 'public.hook_before_user_created_allowlist(jsonb)', 'execute'),
  'hook_before_user_created_allowlist: service_role may NOT execute');
select ok(not has_function_privilege('api_user', 'public.hook_before_user_created_allowlist(jsonb)', 'execute'),
  'hook_before_user_created_allowlist: the bare api_user may NOT execute');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created_allowlist(jsonb)', 'execute'),
  'hook_before_user_created_allowlist: supabase_auth_admin (GoTrue) may execute');
select is(
  (select proowner from pg_proc where oid = 'public.hook_before_user_created_allowlist(jsonb)'::regprocedure),
  (select relowner from pg_class where oid = 'public.email_allowlist'::regclass),
  'hook_before_user_created_allowlist is owned by the owner of email_allowlist (the definer reads it without a policy)'
);
select is(
  (select proowner from pg_proc where oid = 'public.hook_before_user_created_allowlist(jsonb)'::regprocedure),
  (select relowner from pg_class where oid = 'public.platform_admins'::regclass),
  'hook_before_user_created_allowlist is owned by the owner of platform_admins'
);

-- ── e. the token hook, called directly ─────────────────────────────────────────────────────────
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'listed@al.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'listed@al.local')),
  'token hook: a liberado e-mail returns exactly {claims: <input claims>}, unchanged'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'blocked@al.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a bloqueado e-mail is refused with 403 EMAIL_NOT_ALLOWED'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'absent@al.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: an absent e-mail is refused with 403 EMAIL_NOT_ALLOWED'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', ''))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: an empty e-mail claim is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a missing e-mail claim is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(),
        'claims', jsonb_build_object('sub', 's', 'email', '  LiStEd@AL.local ')))->'claims'->>'email',
  '  LiStEd@AL.local ',
  'token hook: a mixed-case, space-padded claim of a listed address passes (claims untouched)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000a1',
        'claims', jsonb_build_object('sub', 's')))->'claims'->>'sub',
  's',
  'token hook: a platform_admins user with no list row and no e-mail claim passes (super_admin exempt)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'listed@al.local')))->'claims'->>'email',
  'listed@al.local',
  'token hook: a missing user_id falls through to the e-mail check (listed passes, no exception)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'absent@al.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a missing user_id with an unlisted e-mail is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', 'not-a-uuid', 'claims', jsonb_build_object('sub', 's', 'email', 'listed@al.local')))->'claims'->>'email',
  'listed@al.local',
  'token hook: a malformed user_id does not raise (falls through to the e-mail check, listed passes)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', 'not-a-uuid', 'claims', jsonb_build_object('sub', 's', 'email', 'absent@al.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a malformed user_id with an unlisted e-mail is refused with 403, not a 500'
);

-- ── f. the creation hook, called directly ──────────────────────────────────────────────────────
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'listed@al.local'))),
  '{}'::jsonb, 'creation hook: a liberado e-mail returns {}'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'absent@al.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: an absent e-mail is refused with 403 EMAIL_NOT_ALLOWED'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'blocked@al.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a bloqueado e-mail is refused'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', ' absent@al.local '))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a padded but unlisted e-mail is refused'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', ' LISTED@al.LOCAL '))),
  '{}'::jsonb, 'creation hook: mixed case and padding of a listed address match'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('phone', '+5500000000000'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a missing e-mail is refused'
);

select * from finish();
rollback;
