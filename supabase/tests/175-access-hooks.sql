begin;
-- 175-access-hooks.sql — quick 261018-owq, retargeted by 09.1-03 (PAY-12, D-487, D-495; T-09.1-10,
-- T-09.1-11): the two Auth hook functions now read the per-tenant `public.access_grants`, and the one-off
-- migration of the retiring global `email_allowlist` into manual access rows. Proved against the
-- catalogue and by calling the functions directly:
--
-- a. `email_allowlist` exposure (kept: the table survives until a contract release): RLS on, NOT forced,
--    ZERO policies; anon and authenticated hold no privilege; service_role may select.
-- b. Both hook functions: SECURITY DEFINER with an empty search_path, EXECUTE for supabase_auth_admin ONLY
--    (anon, authenticated, service_role and the bare api_user may not), owned by the owner of the tables
--    they read, and no longer reading `email_allowlist`.
-- c. `memberships_user_idx` exists and the ungated-membership probe by `user_id` uses it.
-- d. The token hook's behaviour matrix (assumption A-P1 and the A-P26 consequence): a platform admin; an
--    ACTIVE access row (manual or gateway) in any tenant; a live staff membership; a live membership in a
--    tenant whose gate is OFF; else 403. A manual block, a gateway inactive row, a deleted membership and
--    a member of a gated tenant with no access are refused. Claims come back exactly as received, and
--    malformed input never raises (a raise would answer 500 on EVERY login).
-- e. The creation hook's matrix: only an ACTIVE access row passes; a pending `tenant_invites` row alone
--    does NOT (planning decision 2).
-- f. `public.migrate_email_allowlist_to_access_grants()`: liberado -> manual active and bloqueado ->
--    manual blocked in every tenant where the e-mail has a live membership, rows with no live membership
--    are counted as dropped, idempotent, owner-only.
--
-- pgTAP cannot `set role supabase_auth_admin` (postgres is refused), so the integration suite
-- access-hooks.test.ts proves the real GoTrue call path and compares the rejection envelope with the
-- `@rede-social/contracts` constant; the envelope literal is pinned here.
--
-- Fixture ids use the `17500000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(75);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- Tenants: GA gated (payments enabled, gate true), UG ungated (no payments row), UD payments row
-- DISABLED with gate true (reads as off).
select tests.tenant('pgtap-hk-ga', 'Hook GA', '17500000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-hk-ug', 'Hook UG', '17500000-0000-4000-8000-000000000002');
select tests.tenant('pgtap-hk-ud', 'Hook UD', '17500000-0000-4000-8000-000000000003');
insert into public.tenant_modules (tenant_id, module_key, enabled, settings) values
  ('17500000-0000-4000-8000-000000000001', 'payments', true, '{"gate": true}'),
  ('17500000-0000-4000-8000-000000000003', 'payments', false, '{"gate": true}');

-- Users. The platform admin has no membership and no access row.
select tests.auth_user('admin@hk.local', '17500000-0000-4000-8000-0000000000a1');
insert into public.platform_admins (user_id) values ('17500000-0000-4000-8000-0000000000a1');
select tests.auth_user('staff@hk.local', '17500000-0000-4000-8000-0000000000b1');
select tests.auth_user('support@hk.local', '17500000-0000-4000-8000-0000000000b2');
select tests.auth_user('gated@hk.local', '17500000-0000-4000-8000-0000000000b3');
select tests.auth_user('mixed@hk.local', '17500000-0000-4000-8000-0000000000b4');
select tests.auth_user('ungated@hk.local', '17500000-0000-4000-8000-0000000000b5');
select tests.auth_user('delstaff@hk.local', '17500000-0000-4000-8000-0000000000b6');
select tests.auth_user('delungated@hk.local', '17500000-0000-4000-8000-0000000000b7');
select tests.auth_user('disabled@hk.local', '17500000-0000-4000-8000-0000000000b8');
insert into public.memberships (tenant_id, user_id, role, status, deleted_at) values
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000b1', 'admin_tenant', 'active', null),
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000b2', 'support_tenant', 'active', null),
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000b3', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000b4', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000002', '17500000-0000-4000-8000-0000000000b4', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000002', '17500000-0000-4000-8000-0000000000b5', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000b6', 'admin_tenant', 'active', now()),
  ('17500000-0000-4000-8000-000000000002', '17500000-0000-4000-8000-0000000000b7', 'member', 'active', now()),
  ('17500000-0000-4000-8000-000000000003', '17500000-0000-4000-8000-0000000000b8', 'member', 'active', null);

-- Access rows, all in GA (the hooks ask "any tenant"). One e-mail per verdict.
insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values
  ('17500000-0000-4000-8000-000000000001', 'manual@hk.local', 'manual', 'active', null, null),
  ('17500000-0000-4000-8000-000000000001', 'gateway@hk.local', 'gateway', 'active', 'hookgw', 'hk-1'),
  ('17500000-0000-4000-8000-000000000001', 'blocked@hk.local', 'manual', 'blocked', null, null),
  ('17500000-0000-4000-8000-000000000001', 'inactive@hk.local', 'gateway', 'inactive', 'hookgw', 'hk-2');
-- A pending first-admin invite alone, in GA: not an access (planning decision 2).
insert into public.tenant_invites (tenant_id, email, role, status, created_by)
  values ('17500000-0000-4000-8000-000000000001', 'pending@hk.local', 'admin_tenant', 'pending',
          '17500000-0000-4000-8000-0000000000a1');

-- ── a. email_allowlist exposure (the table survives until a contract release) ──────────────────
select is(
  (select relrowsecurity from pg_class where oid = 'public.email_allowlist'::regclass),
  true, 'email_allowlist: RLS is on'
);
select is(
  (select relforcerowsecurity from pg_class where oid = 'public.email_allowlist'::regclass),
  false, 'email_allowlist: RLS is NOT forced'
);
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.email_allowlist'::regclass),
  0, 'email_allowlist: ZERO policies (adding one is always a bug)'
);
select ok(
  not (has_table_privilege('anon', 'public.email_allowlist', 'select')
    or has_table_privilege('anon', 'public.email_allowlist', 'insert')
    or has_table_privilege('anon', 'public.email_allowlist', 'update')
    or has_table_privilege('anon', 'public.email_allowlist', 'delete')),
  'email_allowlist: anon holds no privilege on the table'
);
select ok(
  not (has_table_privilege('authenticated', 'public.email_allowlist', 'select')
    or has_table_privilege('authenticated', 'public.email_allowlist', 'insert')
    or has_table_privilege('authenticated', 'public.email_allowlist', 'update')
    or has_table_privilege('authenticated', 'public.email_allowlist', 'delete')),
  'email_allowlist: authenticated holds no privilege on the table'
);
select ok(
  has_table_privilege('service_role', 'public.email_allowlist', 'select'),
  'email_allowlist: service_role may select'
);

-- ── b. the two hook functions ───────────────────────────────────────────────────────────────────
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
  (select relowner from pg_class where oid = 'public.access_grants'::regclass),
  'hook_custom_access_token_allowlist is owned by the owner of access_grants (the definer reads it without a policy)'
);
select is(
  (select proowner from pg_proc where oid = 'public.hook_custom_access_token_allowlist(jsonb)'::regprocedure),
  (select relowner from pg_class where oid = 'public.platform_admins'::regclass),
  'hook_custom_access_token_allowlist is owned by the owner of platform_admins'
);
select ok(
  (select prosrc !~* 'email_allowlist' from pg_proc where oid = 'public.hook_custom_access_token_allowlist(jsonb)'::regprocedure),
  'hook_custom_access_token_allowlist no longer reads the retiring email_allowlist table'
);
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
  (select relowner from pg_class where oid = 'public.access_grants'::regclass),
  'hook_before_user_created_allowlist is owned by the owner of access_grants (the definer reads it without a policy)'
);
select is(
  (select proowner from pg_proc where oid = 'public.hook_before_user_created_allowlist(jsonb)'::regprocedure),
  (select relowner from pg_class where oid = 'public.platform_admins'::regclass),
  'hook_before_user_created_allowlist is owned by the owner of platform_admins'
);
select ok(
  (select prosrc !~* 'email_allowlist' from pg_proc where oid = 'public.hook_before_user_created_allowlist(jsonb)'::regprocedure),
  'hook_before_user_created_allowlist no longer reads the retiring email_allowlist table'
);

-- ── c. memberships_user_idx ─────────────────────────────────────────────────────────────────────
select has_index('public', 'memberships', 'memberships_user_idx', 'user_id',
  'memberships_user_idx exists on (user_id)');
create function pg_temp.plan_text(p_sql text) returns text language plpgsql as $$
declare v_line text; v_out text := '';
begin
  for v_line in execute 'explain ' || p_sql loop v_out := v_out || v_line || E'\n'; end loop;
  return v_out;
end $$;
set local enable_seqscan = off;
select ok(
  pg_temp.plan_text($q$select 1 from public.memberships where user_id = '17500000-0000-4000-8000-0000000000b4' and deleted_at is null$q$)
    like '%memberships_user_idx%',
  'the ungated-membership probe by user_id plans on memberships_user_idx (index name, not timing)'
);
reset enable_seqscan;

-- ── d. the token hook, called directly ──────────────────────────────────────────────────────────
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000a1'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'nobody@hk.local', 'aud', 'authenticated', 'nested', jsonb_build_object('k', jsonb_build_array(1, 2))))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'nobody@hk.local', 'aud', 'authenticated', 'nested', jsonb_build_object('k', jsonb_build_array(1, 2)))),
  'token hook: a platform admin with no access row and no membership passes (claims unchanged)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'manual@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'manual@hk.local')),
  'token hook: an e-mail with an ACTIVE manual row passes, claims returned exactly as received'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'gateway@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'gateway@hk.local')),
  'token hook: an e-mail with an ACTIVE gateway row passes'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'blocked@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a manual block alone is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'inactive@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a gateway inactive row alone is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', 'absent@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: an e-mail with no row and no membership is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b1'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'staff@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'staff@hk.local')),
  'token hook: a live admin_tenant membership passes with no access row (staff are never stranded)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b2'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'support@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'support@hk.local')),
  'token hook: a live support_tenant membership passes with no access row'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b3'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'gated@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a member whose ONLY membership is in a gated tenant, with no access row, is refused (A-P26)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b4'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'mixed@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'mixed@hk.local')),
  'token hook: the same shape with a SECOND membership in an ungated tenant passes (A-P1)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b5'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'ungated@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'ungated@hk.local')),
  'token hook: a member of an UNGATED tenant with no access row passes (A-P1: enabling the hooks locks out nobody)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b8'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'disabled@hk.local'))),
  jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'disabled@hk.local')),
  'token hook: a member of a tenant whose payments module is DISABLED (gate true but off) passes'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b6'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'delstaff@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a soft-deleted staff membership does not pass'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', '17500000-0000-4000-8000-0000000000b7'::uuid, 'claims', jsonb_build_object('sub', 's', 'email', 'delungated@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a soft-deleted ungated membership does not pass'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(),
        'claims', jsonb_build_object('sub', 's', 'email', '  MaNuAl@HK.local ')))->'claims'->>'email',
  '  MaNuAl@HK.local ',
  'token hook: a padded, mixed-case claim matches the lower-case row (claims untouched)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's', 'email', ''))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: an empty e-mail claim for an unknown user is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', gen_random_uuid(), 'claims', jsonb_build_object('sub', 's'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a missing e-mail claim for an unknown user is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'manual@hk.local')))->'claims'->>'email',
  'manual@hk.local',
  'token hook: a missing user_id falls through to the e-mail check (active row passes, no exception)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('claims', jsonb_build_object('sub', 's', 'email', 'absent@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a missing user_id with no access is refused'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', 'not-a-uuid', 'claims', jsonb_build_object('sub', 's', 'email', 'manual@hk.local')))->'claims'->>'email',
  'manual@hk.local',
  'token hook: a malformed user_id does not raise (falls through to the e-mail check, active row passes)'
);
select is(
  public.hook_custom_access_token_allowlist(jsonb_build_object('user_id', 'not-a-uuid', 'claims', jsonb_build_object('sub', 's', 'email', 'absent@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: a malformed user_id with no access is refused with 403, not a 500'
);
select is(
  public.hook_custom_access_token_allowlist('{}'::jsonb),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: an empty event (no claims, no user_id) is refused, never raises'
);
select is(
  public.hook_custom_access_token_allowlist('{"user_id": null, "claims": null}'::jsonb),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'token hook: null claims and null user_id are refused, never raise'
);

-- ── e. the creation hook, called directly ───────────────────────────────────────────────────────
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'manual@hk.local'))),
  '{}'::jsonb, 'creation hook: an e-mail with an ACTIVE manual row returns {}'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'gateway@hk.local'))),
  '{}'::jsonb, 'creation hook: an e-mail with an ACTIVE gateway row returns {}'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'blocked@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a manual block alone is refused'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'inactive@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a gateway inactive row alone is refused'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'absent@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: an e-mail with no row is refused'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', 'pending@hk.local'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a pending tenant_invites row alone does NOT pass (planning decision 2)'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', ' ManuaL@HK.LOCAL '))),
  '{}'::jsonb, 'creation hook: mixed case and padding match the lower-case row'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('email', ''))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: an empty e-mail is refused'
);
select is(
  public.hook_before_user_created_allowlist(jsonb_build_object('user', jsonb_build_object('phone', '+5500000000000'))),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: a missing e-mail is refused'
);
select is(
  public.hook_before_user_created_allowlist('{}'::jsonb),
  '{"error":{"http_code":403,"message":"EMAIL_NOT_ALLOWED"}}'::jsonb, 'creation hook: an empty event is refused, never raises'
);

-- ── f. migrate_email_allowlist_to_access_grants() ───────────────────────────────────────────────
-- The function reads the WHOLE list, so the fixture starts from an empty one (this file rolls back).
delete from public.email_allowlist;
select tests.auth_user('Lib@Al.Local', '17500000-0000-4000-8000-0000000000c1');
select tests.auth_user('blk@al.local', '17500000-0000-4000-8000-0000000000c2');
select tests.auth_user('gone@al.local', '17500000-0000-4000-8000-0000000000c3');
insert into public.memberships (tenant_id, user_id, role, status, deleted_at) values
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000c1', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000002', '17500000-0000-4000-8000-0000000000c1', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000c2', 'member', 'active', null),
  ('17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-0000000000c3', 'member', 'active', now());
insert into public.email_allowlist (email, status, created_at, updated_at) values
  ('lib@al.local', 'liberado', '2026-01-02 03:04:05+00', '2026-02-03 04:05:06+00'),
  ('blk@al.local', 'bloqueado', now(), now()),
  ('nouser@al.local', 'liberado', now(), now()),
  ('gone@al.local', 'liberado', now(), now());
create temp table mig as select * from public.migrate_email_allowlist_to_access_grants();
select is((select inserted from mig), 3, 'migration: 3 manual rows inserted (2 for the liberado e-mail, 1 for the bloqueado one)');
select is((select dropped from mig), 2, 'migration: 2 list rows dropped (no matching user, only a soft-deleted membership)');
select is(
  (select array_agg(tenant_id order by tenant_id) from public.access_grants
    where email = 'lib@al.local' and source = 'manual' and status = 'active'),
  array['17500000-0000-4000-8000-000000000001', '17500000-0000-4000-8000-000000000002']::uuid[],
  'migration: a liberado e-mail (mixed-case user e-mail) becomes manual active in EVERY tenant where it has a live membership'
);
select is(
  (select created_at from public.access_grants
    where email = 'lib@al.local' and tenant_id = '17500000-0000-4000-8000-000000000001' and source = 'manual'),
  '2026-01-02 03:04:05+00'::timestamptz,
  'migration: the list row''s created_at is kept'
);
select is(
  (select array_agg(tenant_id) from public.access_grants
    where email = 'blk@al.local' and source = 'manual' and status = 'blocked'),
  array['17500000-0000-4000-8000-000000000001']::uuid[],
  'migration: a bloqueado e-mail becomes a manual BLOCKED row in its tenant'
);
select is(
  (select count(*)::int from public.access_grants where email = 'blk@al.local' and status = 'active'),
  0, 'migration: a bloqueado e-mail gets no release'
);
select is(
  (select count(*)::int from public.access_grants where email in ('nouser@al.local', 'gone@al.local')),
  0, 'migration: a row with no user, or only a soft-deleted membership, copies nothing'
);
select is((select inserted from public.migrate_email_allowlist_to_access_grants()), 0, 'migration: a second call inserts 0 (idempotent)');
select is((select dropped from public.migrate_email_allowlist_to_access_grants()), 2, 'migration: a second call still counts the 2 dropped rows');
select is((select count(*)::int from public.email_allowlist), 4, 'migration: email_allowlist is not altered or emptied');
select is(
  (select prosecdef from pg_proc where oid = 'public.migrate_email_allowlist_to_access_grants()'::regprocedure),
  false, 'migration function is SECURITY INVOKER'
);
select ok(not has_function_privilege('anon', 'public.migrate_email_allowlist_to_access_grants()', 'execute'),
  'migration function: anon may NOT execute');
select ok(not has_function_privilege('authenticated', 'public.migrate_email_allowlist_to_access_grants()', 'execute'),
  'migration function: authenticated may NOT execute');
select ok(not has_function_privilege('service_role', 'public.migrate_email_allowlist_to_access_grants()', 'execute'),
  'migration function: service_role may NOT execute');

select * from finish();
rollback;
