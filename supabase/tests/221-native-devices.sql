begin;
-- 221-native-devices.sql — NATIVE-08 / T-13-11 / T-13-12 / D-606, proved inside Postgres (13-06): the
-- `push_subscriptions` table holds a native device token (`kind` apns | fcm) beside a Web Push endpoint, and
-- three definers (`*_push_devices_functions.sql`) write and read it.
--
-- 0. The privilege facts: the three functions are `prosecdef` with `search_path=""`, NOT executable by
--    `anon`, executable by `authenticated` (the tenant lane the worker and the API run in), and
--    `_for_v2` by `service_role`; the shipped 4-argument writer and the old reader's return type are intact.
-- 1. `push_subscriptions_kind_chk` (and the platform and environment CHECKs) refuse the malformed shapes
--    (23514) and accept the three valid ones; the old insert shape still lands as a web row.
-- 2. `app.push_device_upsert`: saves for the caller, returns the row id, is idempotent (same id, version and
--    environment refreshed, nothing else reset), and refuses a bad kind, pairing, token length and
--    environment (22023) without echoing the token.
-- 3. The handoff inside one tenant (a second member saving a token takes it over) and the same token in
--    another tenant being a separate row that is never touched.
-- 4. Tenant and owner isolation: B reads and deletes none of A's rows, a teammate reads none of them, every
--    negative beside its positive control; a member-lane INSERT is still refused (no insert policy).
-- 5. Refusals (42501): no claim, a blocked member, a soft-deleted member, a user of another tenant under
--    A's claim, and `anon`.
-- 6. The readers: `app.push_subscriptions_for` returns WEB rows only (T-13-12, an old worker never sees a
--    native row with null keys); `_for_v2` returns both kinds with their native columns, live members only,
--    never another tenant's, and refuses a lane without a claim.
--
-- Fixture ids use the `22100000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
-- No token is ever put in an assertion description (a token is a delivery credential, T-13-11).
select plan(60);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-nd-a', 'Native A', '22100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-nd-b', 'Native B', '22100000-0000-4000-8000-000000000011');
-- A: a1, a2 live members; a3 blocked; a4 soft-deleted. B: b1.
select tests.auth_user('a1@nd-a.local', '22100000-0000-4000-8000-0000000000a1');
select tests.auth_user('a2@nd-a.local', '22100000-0000-4000-8000-0000000000a2');
select tests.auth_user('a3@nd-a.local', '22100000-0000-4000-8000-0000000000a3');
select tests.auth_user('a4@nd-a.local', '22100000-0000-4000-8000-0000000000a4');
select tests.auth_user('b1@nd-b.local', '22100000-0000-4000-8000-0000000000b1');
select tests.member('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1');
select tests.member('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a2');
select tests.member('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a3');
select tests.member('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a4');
select tests.member('22100000-0000-4000-8000-000000000011', '22100000-0000-4000-8000-0000000000b1');
update public.memberships set status = 'blocked', blocked_at = now()
 where user_id = '22100000-0000-4000-8000-0000000000a3';
update public.memberships set deleted_at = now()
 where user_id = '22100000-0000-4000-8000-0000000000a4';

-- ── 0. the privilege facts ────────────────────────────────────────────────────────────────────
select ok(
  (select count(*) = 3 and bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
    where oid in (to_regprocedure('app.push_device_upsert(text,text,text,text,text)'),
                  to_regprocedure('app.push_subscriptions_for_v2(uuid[])'),
                  to_regprocedure('app.push_subscriptions_for(uuid[])'))),
  'fact 0: the writer, the old reader and _for_v2 exist and are SECURITY DEFINER with search_path pinned to ""'
);
select ok(
  (select count(*) = 3 and not bool_or(has_function_privilege('anon', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.push_device_upsert(text,text,text,text,text)'),
                  to_regprocedure('app.push_subscriptions_for_v2(uuid[])'),
                  to_regprocedure('app.push_subscriptions_for(uuid[])'))),
  'fact 0: anon cannot execute any of the three (PUBLIC''s default EXECUTE is revoked)'
);
select ok(
  (select count(*) = 3 and bool_and(has_function_privilege('authenticated', oid, 'execute')) from pg_proc
    where oid in (to_regprocedure('app.push_device_upsert(text,text,text,text,text)'),
                  to_regprocedure('app.push_subscriptions_for_v2(uuid[])'),
                  to_regprocedure('app.push_subscriptions_for(uuid[])'))),
  'fact 0 positive control: authenticated (the member and worker lanes) can execute all three'
);
select ok(
  coalesce(has_function_privilege('service_role', to_regprocedure('app.push_subscriptions_for_v2(uuid[])'), 'execute'), false),
  'fact 0: service_role can execute _for_v2'
);
select ok(
  to_regprocedure('app.push_subscription_upsert(text,text,text,text)') is not null
  and pg_get_function_result(to_regprocedure('app.push_subscriptions_for(uuid[])'))
      = 'TABLE(id uuid, user_id uuid, role text, endpoint text, p256dh text, auth text)',
  'fact 0 (D-603): the shipped 4-argument writer stays and the old reader keeps its exact return type'
);

-- ── 1. the CHECKs ─────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, p256dh, auth)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-1', 'webpush', null, 'a') $$,
  '23514', null,
  'fact 1: a webpush row with a null p256dh is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, p256dh, auth)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-2', 'webpush', 'k', null) $$,
  '23514', null,
  'fact 1: a webpush row with a null auth is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, p256dh, auth, platform)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-3', 'webpush', 'k', 'a', 'ios') $$,
  '23514', null,
  'fact 1: a webpush row with a platform is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, p256dh, auth, platform)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-4', 'apns', 'k', 'a', 'ios') $$,
  '23514', null,
  'fact 1: a native row that carries keys is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-5', 'apns') $$,
  '23514', null,
  'fact 1: a native row without a platform is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-6', 'fcm', 'ios') $$,
  '23514', null,
  'fact 1: fcm with ios is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-7', 'apns', 'android') $$,
  '23514', null,
  'fact 1: apns with android is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-8', 'apns', 'windows') $$,
  '23514', null,
  'fact 1: a platform of windows is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform, app_environment)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-9', 'apns', 'ios', 'staging') $$,
  '23514', null,
  'fact 1: an app_environment of staging is refused (23514)'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-10', 'sms') $$,
  '23514', null,
  'fact 1: an unknown kind is refused (23514)'
);
select lives_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-ok-1', 'k', 'a') $$,
  'fact 1 positive control: the old insert shape still lands, as a webpush row'
);
select lives_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform, app_environment)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-ok-2', 'apns', 'ios', 'production') $$,
  'fact 1 positive control: a native apns row on ios lands'
);
select lives_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform)
     values ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'chk-ok-3', 'fcm', 'android') $$,
  'fact 1 positive control: a native fcm row on android lands'
);
select results_eq(
  $$ select kind from public.push_subscriptions where endpoint = 'chk-ok-1' $$,
  ARRAY['webpush'],
  'fact 1: the kind defaults to webpush (every shipped row satisfies the CHECK)'
);
delete from public.push_subscriptions where endpoint like 'chk-%';

-- ── 2. the native upsert ──────────────────────────────────────────────────────────────────────
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select app.push_device_upsert('apns', repeat('a1', 32), 'ios', 'production', '1.0.0') $$,
  'fact 2: a live member saves an apns token'
);
reset role;
select results_eq(
  $$ select user_id::text, kind, platform, app_environment, app_version, p256dh is null, auth is null
       from public.push_subscriptions
      where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32) $$,
  $$ values ('22100000-0000-4000-8000-0000000000a1', 'apns', 'ios', 'production', '1.0.0', true, true) $$,
  'fact 2: …and the row belongs to a1 with the native columns set and no keys'
);
-- A past success and a recorded failure, to prove the re-save keeps what it must; the id is kept aside.
update public.push_subscriptions
   set last_success_at = '2026-01-01T00:00:00Z', failure_count = 3
 where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32);
create temp table nd_first_id as
  select id from public.push_subscriptions
   where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32);
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select app.push_device_upsert('apns', repeat('a1', 32), 'ios', 'sandbox', '1.0.1') $$,
  'fact 2: saving the same token again lands (idempotent)'
);
reset role;
select results_eq(
  $$ select id from public.push_subscriptions
      where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32) $$,
  $$ select id from nd_first_id $$,
  'fact 2: …on the SAME row id'
);
select results_eq(
  $$ select count(*)::int, min(app_version), min(app_environment), min(failure_count), min(last_success_at)::text
       from public.push_subscriptions
      where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32) $$,
  $$ values (1, '1.0.1', 'sandbox', 0, '2026-01-01 00:00:00+00') $$,
  'fact 2: …one row, version and environment refreshed, the re-armed device''s failures cleared, last_success_at kept'
);
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select app.push_device_upsert('fcm', repeat('fcm_', 40), 'android', 'production', '2.3.4') $$,
  'fact 2: a live member saves an fcm token on android'
);
select throws_ok(
  $$ select app.push_device_upsert('webpush', repeat('c3', 32), 'ios', 'production', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: a kind other than apns or fcm is refused (22023) and the message does not echo the token'
);
select throws_ok(
  $$ select app.push_device_upsert('fcm', repeat('c3', 32), 'ios', 'production', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: fcm on ios is refused (22023)'
);
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('c3', 32), 'android', 'production', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: apns on android is refused (22023)'
);
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('c', 31), 'ios', 'production', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: a token of 31 characters is refused (22023)'
);
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('c', 4097), 'ios', 'production', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: a token of 4097 characters is refused (22023)'
);
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('c3', 32), 'ios', 'staging', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: an environment of staging is refused (22023)'
);
select throws_ok(
  $$ select app.push_device_upsert('apns', null, 'ios', 'production', '1.0.0') $$,
  '22023', 'push_device_upsert: invalid device',
  'fact 2: a null token is refused (22023)'
);
select lives_ok(
  $$ select app.push_device_upsert('apns', repeat('c3', 32), 'ios', 'production', null) $$,
  'fact 2 positive control: the same call with a valid environment and no app version lands'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.push_subscriptions
      where tenant_id = '22100000-0000-4000-8000-000000000001'
        and user_id = '22100000-0000-4000-8000-0000000000a1' $$,
  ARRAY[3],
  'fact 2: …and no refused call left a row behind (a1 holds exactly the three devices it saved)'
);
delete from public.push_subscriptions where endpoint = repeat('c3', 32);

-- ── 3. the handoff ────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$ select app.push_device_upsert('apns', repeat('a1', 32), 'ios', 'production', '1.0.2') $$,
  'fact 3: a2 saves the token a1 held'
);
reset role;
select results_eq(
  $$ select user_id::text from public.push_subscriptions
      where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32) $$,
  ARRAY['22100000-0000-4000-8000-0000000000a2'],
  'fact 3 (T-13-11): …a1''s row is gone and only a2 holds it (the device changed hands)'
);
select tests.as_tenant('22100000-0000-4000-8000-000000000011', '22100000-0000-4000-8000-0000000000b1');
select lives_ok(
  $$ select app.push_device_upsert('apns', repeat('a1', 32), 'ios', 'production', '1.0.0') $$,
  'fact 3: b1 saves the SAME token string in tenant B'
);
reset role;
select results_eq(
  $$ select tenant_id::text || ':' || user_id::text from public.push_subscriptions
      where endpoint = repeat('a1', 32) order by 1 $$,
  ARRAY['22100000-0000-4000-8000-000000000001:22100000-0000-4000-8000-0000000000a2',
        '22100000-0000-4000-8000-000000000011:22100000-0000-4000-8000-0000000000b1'],
  'fact 3 adjacency: the token in B is a separate row and A''s row is untouched (the handoff is tenant-scoped)'
);
select results_eq(
  $$ select app_version from public.push_subscriptions
      where tenant_id = '22100000-0000-4000-8000-000000000001' and endpoint = repeat('a1', 32) $$,
  ARRAY['1.0.2'],
  'fact 3 adjacency: …and B''s save did not rewrite A''s app version'
);

-- ── 4. isolation ──────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('22100000-0000-4000-8000-000000000011', '22100000-0000-4000-8000-0000000000b1');
select results_eq(
  $$ select count(*)::int from public.push_subscriptions where tenant_id = '22100000-0000-4000-8000-000000000001' $$,
  ARRAY[0],
  'fact 4 (T-13-11): B''s lane reads none of A''s rows'
);
select results_eq(
  $$ select count(*)::int from public.push_subscriptions $$,
  ARRAY[1],
  'fact 4 positive control: B''s member reads its own device'
);
select results_eq(
  $$ with d as (delete from public.push_subscriptions
                 where tenant_id = '22100000-0000-4000-8000-000000000001' returning 1)
     select count(*)::int from d $$,
  ARRAY[0],
  'fact 4 (T-13-11): B''s lane cannot delete A''s rows'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform)
     values ('22100000-0000-4000-8000-000000000011', '22100000-0000-4000-8000-0000000000b1', 'forged', 'fcm', 'android') $$,
  '42501', null,
  'fact 4: a member-lane INSERT of a native row is refused (no insert policy; writes go through the definer)'
);
reset role;
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select count(*)::int from public.push_subscriptions $$,
  ARRAY[1],
  'fact 4 positive control: a1 reads its own fcm device'
);
select results_eq(
  $$ select count(*)::int from public.push_subscriptions where user_id = '22100000-0000-4000-8000-0000000000a2' $$,
  ARRAY[0],
  'fact 4: …and a teammate''s native device is hidden from a1 (the owner-only select policy)'
);
select results_eq(
  $$ with d as (delete from public.push_subscriptions
                 where user_id = '22100000-0000-4000-8000-0000000000a2' returning 1)
     select count(*)::int from d $$,
  ARRAY[0],
  'fact 4: …and a1 cannot delete a2''s device'
);
reset role;
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select count(*)::int from public.push_subscriptions $$,
  ARRAY[1],
  'fact 4 positive control: a2 reads its own apns device'
);
reset role;

-- ── 5. refusals ───────────────────────────────────────────────────────────────────────────────
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('d4', 32), 'ios', 'production', '1.0.0') $$,
  '42501', null,
  'fact 5: without a claim the upsert is refused (42501)'
);
reset role;
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('d4', 32), 'ios', 'production', '1.0.0') $$,
  '42501', null,
  'fact 5 (SC 4): a blocked member cannot save a device (42501)'
);
reset role;
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a4');
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('d4', 32), 'ios', 'production', '1.0.0') $$,
  '42501', null,
  'fact 5: a soft-deleted member cannot save a device (42501)'
);
reset role;
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('d4', 32), 'ios', 'production', '1.0.0') $$,
  '42501', null,
  'fact 5 (T-13-11): a user of tenant B under tenant A''s claim has no membership and is refused (42501)'
);
reset role;
set local role anon;
select throws_ok(
  $$ select app.push_device_upsert('apns', repeat('d4', 32), 'ios', 'production', '1.0.0') $$,
  '42501', null,
  'fact 5: anon cannot call the writer at all (42501)'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.push_subscriptions where endpoint = repeat('d4', 32) $$,
  ARRAY[0],
  'fact 5: …and none of the refused calls left a row'
);

-- ── 6. the readers ────────────────────────────────────────────────────────────────────────────
-- Rows the definers would refuse to write, inserted as the migration role: a web device of a1, and the
-- native devices of the blocked a3 and the soft-deleted a4 (they predate the block in real life).
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth) values
  ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a1', 'https://push.fake.test/sub/w1', 'k', 'a');
insert into public.push_subscriptions (tenant_id, user_id, endpoint, kind, platform, app_environment, app_version) values
  ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a3', repeat('e5', 32), 'apns', 'ios', 'production', '1.0.0'),
  ('22100000-0000-4000-8000-000000000001', '22100000-0000-4000-8000-0000000000a4', repeat('e6', 32), 'fcm', 'android', 'production', '1.0.0');
-- The worker's lane: the zero user, support_tenant, A's claim (notificationsSystemCtx).
select tests.as_tenant('22100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select user_id::text || ':' || role || ':' || endpoint from app.push_subscriptions_for(array[
       '22100000-0000-4000-8000-0000000000a1', '22100000-0000-4000-8000-0000000000a2',
       '22100000-0000-4000-8000-0000000000a3', '22100000-0000-4000-8000-0000000000a4',
       '22100000-0000-4000-8000-0000000000b1']::uuid[]) order by 1 $$,
  ARRAY['22100000-0000-4000-8000-0000000000a1:member:https://push.fake.test/sub/w1'],
  'fact 6 (T-13-12): the OLD reader returns the web row only, though a1 and a2 also hold native devices'
);
select results_eq(
  $$ select user_id::text || ':' || kind || ':' || coalesce(platform, '-') || ':'
            || coalesce(app_environment, '-') || ':' || coalesce(app_version, '-') || ':' || role
       from app.push_subscriptions_for_v2(array[
       '22100000-0000-4000-8000-0000000000a1', '22100000-0000-4000-8000-0000000000a2',
       '22100000-0000-4000-8000-0000000000a3', '22100000-0000-4000-8000-0000000000a4',
       '22100000-0000-4000-8000-0000000000b1']::uuid[]) order by 1 $$,
  ARRAY['22100000-0000-4000-8000-0000000000a1:fcm:android:production:2.3.4:member',
        '22100000-0000-4000-8000-0000000000a1:webpush:-:-:-:member',
        '22100000-0000-4000-8000-0000000000a2:apns:ios:production:1.0.2:member'],
  'fact 6: _for_v2 returns both kinds with their native columns, live members of A only'
);
select results_eq(
  $$ select count(*)::int from app.push_subscriptions_for_v2(array['22100000-0000-4000-8000-0000000000a3',
       '22100000-0000-4000-8000-0000000000a4']::uuid[]) $$,
  ARRAY[0],
  'fact 6: …and never the blocked member''s or the soft-deleted member''s native device'
);
select results_eq(
  $$ select count(*)::int from app.push_subscriptions_for_v2(array['22100000-0000-4000-8000-0000000000a1']::uuid[])
      where p256dh is null and auth is null $$,
  ARRAY[1],
  'fact 6: …a native row comes back with null keys, the web row with its keys'
);
reset role;
select tests.as_tenant('22100000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select count(*)::int from app.push_subscriptions_for_v2(array['22100000-0000-4000-8000-0000000000a1',
       '22100000-0000-4000-8000-0000000000a2']::uuid[]) $$,
  ARRAY[0],
  'fact 6 (T-13-11): from B''s lane A''s users have no device in _for_v2'
);
select results_eq(
  $$ select count(*)::int from app.push_subscriptions_for_v2(array['22100000-0000-4000-8000-0000000000b1']::uuid[]) $$,
  ARRAY[1],
  'fact 6 positive control: B''s own member comes back from B''s lane'
);
reset role;
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select * from app.push_subscriptions_for_v2(array['22100000-0000-4000-8000-0000000000a1']::uuid[]) $$,
  '42501', null,
  'fact 6: without a claim _for_v2 is refused (42501)'
);
reset role;

select * from finish();
rollback;
