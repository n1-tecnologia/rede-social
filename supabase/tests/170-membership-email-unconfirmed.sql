begin;
-- 170-membership-email-unconfirmed.sql — quick 261007-gzu: the Membros admin list marks a member whose
-- e-mail is still unconfirmed. `auth.users` is unreadable by `api_user` and by the admin lane
-- (`service_role`), so the single reader is `app.membership_email_unconfirmed(tenant, membership)`:
-- SECURITY DEFINER, empty search_path, a boolean only, executable by `service_role` ONLY. Proved here:
--
-- 1. Shape and privileges: the function exists with (uuid, uuid), returns boolean, is SECURITY DEFINER
--    with an empty search_path; service_role may execute it; authenticated, anon and the bare
--    api_user (NOINHERIT: it owns nothing until it opens a lane) may not.
-- 2. Behaviour: an unconfirmed identity reads true under its own tenant (also through the admin
--    lane), a confirmed one false, and the same fact asked under ANOTHER tenant is false in both
--    directions (no cross-tenant oracle). A soft-deleted membership, an unknown id and null arguments
--    answer false (never null, never an error). Once the identity is confirmed the answer flips.
-- 3. The tenant lane is refused outright (SQLSTATE 42501).
--
-- Fixture ids use the `17000000-…` prefix and the tenants `pgtap-ue-a` and `pgtap-ue-b`, used by no
-- other file. Like its siblings, this file ROLLS BACK.
select plan(19);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ue-a', 'Unconfirmed A', '17000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ue-b', 'Unconfirmed B', '17000000-0000-4000-8000-000000000011');
select tests.auth_user('a-unconfirmed@ue.local', '17000000-0000-4000-8000-0000000000a1');
select tests.auth_user('a-confirmed@ue.local', '17000000-0000-4000-8000-0000000000a2');
select tests.auth_user('a-removed@ue.local', '17000000-0000-4000-8000-0000000000a3');
select tests.auth_user('b-unconfirmed@ue.local', '17000000-0000-4000-8000-0000000000b1');
select tests.member('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-0000000000a1');
select tests.member('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-0000000000a2');
select tests.member('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-0000000000a3');
select tests.member('17000000-0000-4000-8000-000000000011', '17000000-0000-4000-8000-0000000000b1');
update auth.users set email_confirmed_at = null
 where id in ('17000000-0000-4000-8000-0000000000a1',
              '17000000-0000-4000-8000-0000000000a3',
              '17000000-0000-4000-8000-0000000000b1');
update public.memberships set deleted_at = now()
 where tenant_id = '17000000-0000-4000-8000-000000000001'
   and user_id = '17000000-0000-4000-8000-0000000000a3';
create temp table ue_ids as
select m.user_id, m.id as membership_id, m.tenant_id
  from public.memberships m
 where m.user_id::text like '17000000-%';
grant select on ue_ids to public;

-- ── shape and privileges ────────────────────────────────────────────────────────────────────────
select has_function('app', 'membership_email_unconfirmed', ARRAY['uuid', 'uuid'],
  'app.membership_email_unconfirmed(uuid, uuid) exists');
select function_returns('app', 'membership_email_unconfirmed', ARRAY['uuid', 'uuid'], 'boolean',
  'it returns a boolean (never the timestamp, the e-mail or an auth column)');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'membership_email_unconfirmed'),
  true,
  'it is SECURITY DEFINER: auth.users is not readable by the API roles'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'membership_email_unconfirmed'),
  'it pins search_path to empty'
);
select ok(
  has_function_privilege('service_role', 'app.membership_email_unconfirmed(uuid, uuid)', 'execute'),
  'service_role (the admin lane) may execute it'
);
select ok(
  not has_function_privilege('authenticated', 'app.membership_email_unconfirmed(uuid, uuid)', 'execute'),
  'the tenant lane (authenticated) may NOT execute it'
);
select ok(
  not has_function_privilege('anon', 'app.membership_email_unconfirmed(uuid, uuid)', 'execute'),
  'anon may NOT execute it'
);
select ok(
  not has_function_privilege('api_user', 'app.membership_email_unconfirmed(uuid, uuid)', 'execute'),
  'the bare api_user (NOINHERIT) may NOT execute it: only an opened admin lane can'
);

-- ── behaviour ───────────────────────────────────────────────────────────────────────────────────
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a1')),
  true,
  'an unconfirmed member reads true under its own tenant'
);
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a2')),
  false,
  'a confirmed member reads false'
);
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000011',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a1')),
  false,
  'tenant A''s unconfirmed membership asked under tenant B is false (no cross-tenant oracle)'
);
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000b1')),
  false,
  'tenant B''s unconfirmed membership asked under tenant A is false (reverse negative)'
);
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a3')),
  false,
  'the soft-deleted membership of an unconfirmed identity is false'
);
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-0000000000ff'),
  false,
  'an unknown membership id is false (not null, not an error)'
);
select is(
  app.membership_email_unconfirmed(
    null, (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a1')),
  false,
  'a null tenant is false'
);
select is(
  app.membership_email_unconfirmed('17000000-0000-4000-8000-000000000001', null),
  false,
  'a null membership is false'
);

-- ── through the admin lane (the only real caller) ───────────────────────────────────────────────
select tests.as_service();
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a1')),
  true,
  'the same unconfirmed membership called through the admin lane (service_role) is true'
);
reset role;

-- ── the answer follows the identity ─────────────────────────────────────────────────────────────
update auth.users set email_confirmed_at = now() where id = '17000000-0000-4000-8000-0000000000a1';
select is(
  app.membership_email_unconfirmed(
    '17000000-0000-4000-8000-000000000001',
    (select membership_id from ue_ids where user_id = '17000000-0000-4000-8000-0000000000a1')),
  false,
  'once the identity is confirmed the same call is false'
);

-- ── the tenant lane is refused ──────────────────────────────────────────────────────────────────
select tests.as_tenant('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-0000000000a2');
select throws_ok(
  $$select app.membership_email_unconfirmed('17000000-0000-4000-8000-000000000001', '17000000-0000-4000-8000-0000000000ff')$$,
  '42501',
  null,
  'a call from the tenant lane is refused with SQLSTATE 42501'
);
reset role;

select * from finish();
rollback;
