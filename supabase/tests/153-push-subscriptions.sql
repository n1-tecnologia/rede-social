begin;
-- 153-push-subscriptions.sql — NOTIF-03 / T-07-34 / T-07-35 / T-07-36, proved inside Postgres (07-06):
-- the `push_subscriptions` table, its owner-only select/delete policies and its four SECURITY DEFINER
-- functions (`*_push_subscriptions_functions.sql`), the only writers and the worker's only reader.
--
-- 0. The privilege facts: all four functions are `prosecdef` with `search_path=""`, NOT executable by
--    `anon`, executable by `authenticated`.
-- 1. `push_subscriptions_tenant_endpoint_uq` refuses a duplicate `(tenant, endpoint)` (23505), while
--    the SAME endpoint in another tenant is a separate row (adjacency).
-- 2. `app.push_subscription_upsert`: under A's member lane it inserts for THAT member and returns the
--    id; the same endpoint saved by A's second member REPLACES the row (device handoff, T-07-34); the
--    owner saving it again refreshes its keys in place; the same endpoint saved in B leaves A's row
--    alone; it raises without a claim (42501), for a blocked member (42501) and for a non-https
--    endpoint (22023).
-- 3. Owner-only access (T-07-36): the owner lane sees exactly its rows; A's second member sees none of
--    the first's; B sees none of A's; a member-lane INSERT is refused (42501, no insert policy); an
--    UPDATE touches 0 rows (no update policy); a DELETE of another member's row touches 0, of its own 1.
-- 4. `app.push_subscriptions_for` returns only LIVE members' rows of A with their role, never a listed
--    B user or a blocked one; from B's lane A's users return nothing; without a claim it raises.
-- 5. `app.push_subscriptions_delete_dead` removes rows of a blocked or soft-deleted member and keeps
--    live ones; `null` sweeps the whole tenant and never another tenant; without a claim it raises.
-- 6. `app.push_subscription_report` increments (`failed`), stamps and resets (`sent`), deletes
--    (`gone`), refuses an unknown outcome (22023), and from B's lane touches none of A's rows.
--
-- Fixture ids use the `15300000-…` prefix, used by no other file. Like its siblings, this file ROLLS
-- BACK.
select plan(35);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ps-a', 'Push A', '15300000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ps-b', 'Push B', '15300000-0000-4000-8000-000000000011');
-- A: a1, a2 live members; a3 blocked; a4 soft-deleted; a5 the admin. B: b1.
select tests.auth_user('a1@ps-a.local', '15300000-0000-4000-8000-0000000000a1');
select tests.auth_user('a2@ps-a.local', '15300000-0000-4000-8000-0000000000a2');
select tests.auth_user('a3@ps-a.local', '15300000-0000-4000-8000-0000000000a3');
select tests.auth_user('a4@ps-a.local', '15300000-0000-4000-8000-0000000000a4');
select tests.auth_user('a5@ps-a.local', '15300000-0000-4000-8000-0000000000a5');
select tests.auth_user('b1@ps-b.local', '15300000-0000-4000-8000-0000000000b1');
select tests.member('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a1');
select tests.member('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a2');
select tests.member('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a3');
select tests.member('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a4');
select tests.member('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a5', 'admin_tenant');
select tests.member('15300000-0000-4000-8000-000000000011', '15300000-0000-4000-8000-0000000000b1');
update public.memberships set status = 'blocked', blocked_at = now()
 where user_id = '15300000-0000-4000-8000-0000000000a3';
update public.memberships set deleted_at = now()
 where user_id = '15300000-0000-4000-8000-0000000000a4';

-- ── 0. the privilege facts ────────────────────────────────────────────────────────────────────
select ok(
  (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from pg_proc
    where oid in ('app.push_subscription_upsert(text,text,text,text)'::regprocedure,
                  'app.push_subscriptions_for(uuid[])'::regprocedure,
                  'app.push_subscriptions_delete_dead(uuid[])'::regprocedure,
                  'app.push_subscription_report(uuid,text)'::regprocedure)),
  'fact 0: all four push functions are SECURITY DEFINER with search_path pinned to ""'
);
select ok(
  not (select bool_or(has_function_privilege('anon', oid, 'execute')) from pg_proc
        where oid in ('app.push_subscription_upsert(text,text,text,text)'::regprocedure,
                      'app.push_subscriptions_for(uuid[])'::regprocedure,
                      'app.push_subscriptions_delete_dead(uuid[])'::regprocedure,
                      'app.push_subscription_report(uuid,text)'::regprocedure)),
  'fact 0: anon cannot execute any of them (PUBLIC''s default EXECUTE is revoked)'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', oid, 'execute')) from pg_proc
    where oid in ('app.push_subscription_upsert(text,text,text,text)'::regprocedure,
                  'app.push_subscriptions_for(uuid[])'::regprocedure,
                  'app.push_subscriptions_delete_dead(uuid[])'::regprocedure,
                  'app.push_subscription_report(uuid,text)'::regprocedure)),
  'fact 0 positive control: authenticated (the member and worker lanes) can execute all four'
);

-- ── 1. endpoint uniqueness is per tenant ──────────────────────────────────────────────────────
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
values ('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a1',
        'https://push.fake.test/sub/e0', 'k', 'a');
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values ('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a2',
             'https://push.fake.test/sub/e0', 'k', 'a') $$,
  '23505',
  null,
  'fact 1: push_subscriptions_tenant_endpoint_uq refuses a duplicate (tenant, endpoint)'
);
select lives_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values ('15300000-0000-4000-8000-000000000011', '15300000-0000-4000-8000-0000000000b1',
             'https://push.fake.test/sub/e0', 'k', 'a') $$,
  'fact 1 adjacency: the SAME endpoint in another tenant is a separate row'
);
delete from public.push_subscriptions where endpoint = 'https://push.fake.test/sub/e0';

-- ── 2. the upsert ─────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a1');
select isnt(
  app.push_subscription_upsert('https://push.fake.test/sub/e1', 'k1', 'a1', 'ua'),
  null::uuid,
  'fact 2: the upsert under a1''s lane returns the new row id'
);
reset role;
select results_eq(
  $$ select user_id::text from public.push_subscriptions where endpoint = 'https://push.fake.test/sub/e1' $$,
  ARRAY['15300000-0000-4000-8000-0000000000a1'],
  'fact 2: …and the row belongs to a1, in A'
);
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a2');
select app.push_subscription_upsert('https://push.fake.test/sub/e1', 'k2', 'a2', null);
reset role;
select results_eq(
  $$ select user_id::text from public.push_subscriptions where endpoint = 'https://push.fake.test/sub/e1' $$,
  ARRAY['15300000-0000-4000-8000-0000000000a2'],
  'fact 2 (T-07-34): the same endpoint saved by a2 REPLACES the row: only a2''s exists'
);
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a2');
select app.push_subscription_upsert('https://push.fake.test/sub/e1', 'k3', 'a3', null);
reset role;
select results_eq(
  $$ select count(*)::int, min(p256dh) from public.push_subscriptions
      where endpoint = 'https://push.fake.test/sub/e1' $$,
  $$ values (1, 'k3') $$,
  'fact 2: the owner saving it again refreshes the keys in place (still one row)'
);
-- The same endpoint in B, by B's member, leaves A's row where it was.
select tests.as_tenant('15300000-0000-4000-8000-000000000011', '15300000-0000-4000-8000-0000000000b1');
select app.push_subscription_upsert('https://push.fake.test/sub/e1', 'kb', 'ab', null);
reset role;
select results_eq(
  $$ select tenant_id::text || ':' || user_id::text from public.push_subscriptions
      where endpoint = 'https://push.fake.test/sub/e1' order by 1 $$,
  ARRAY['15300000-0000-4000-8000-000000000001:15300000-0000-4000-8000-0000000000a2',
        '15300000-0000-4000-8000-000000000011:15300000-0000-4000-8000-0000000000b1'],
  'fact 2 adjacency: B saving the same endpoint never touches A''s row (the handoff is tenant-scoped)'
);
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.push_subscription_upsert('https://push.fake.test/sub/e9', 'k', 'a', null) $$,
  '42501',
  null,
  'fact 2: without a claim the upsert is refused (42501)'
);
reset role;
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a3');
select throws_ok(
  $$ select app.push_subscription_upsert('https://push.fake.test/sub/e9', 'k', 'a', null) $$,
  '42501',
  null,
  'fact 2 (SC 4): a blocked member cannot save a device (42501)'
);
reset role;
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ select app.push_subscription_upsert('http://push.fake.test/sub/e9', 'k', 'a', null) $$,
  '22023',
  null,
  'fact 2: a non-https endpoint is refused (22023, defence in depth behind the API rule)'
);
-- a1's two own devices, for fact 3.
select app.push_subscription_upsert('https://push.fake.test/sub/e2', 'k', 'a', null);
select app.push_subscription_upsert('https://push.fake.test/sub/e3', 'k', 'a', null);
reset role;

-- ── 3. owner-only access ──────────────────────────────────────────────────────────────────────
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select endpoint from public.push_subscriptions order by 1 $$,
  ARRAY['https://push.fake.test/sub/e2', 'https://push.fake.test/sub/e3'],
  'fact 3: the owner lane sees exactly its own rows'
);
select throws_ok(
  $$ insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
     values ('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a1',
             'https://push.fake.test/sub/forged', 'k', 'a') $$,
  '42501',
  null,
  'fact 3: a member-lane INSERT is refused (no insert policy; writes go through the definer)'
);
select results_eq(
  $$ with u as (
       update public.push_subscriptions set endpoint = 'https://push.fake.test/sub/moved'
        where endpoint = 'https://push.fake.test/sub/e2' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'fact 3: a member-lane UPDATE, even of its own row, touches nothing (no update policy)'
);
select results_eq(
  $$ with d as (
       delete from public.push_subscriptions
        where user_id = '15300000-0000-4000-8000-0000000000a2' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'fact 3: a DELETE aimed at a colleague''s device touches nothing'
);
select results_eq(
  $$ with d as (
       delete from public.push_subscriptions
        where endpoint = 'https://push.fake.test/sub/e3' returning 1
     ) select count(*)::int from d $$,
  ARRAY[1],
  'fact 3 positive control: the owner deletes its OWN device'
);
reset role;
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a2');
select is_empty(
  $$ select id from public.push_subscriptions where user_id = '15300000-0000-4000-8000-0000000000a1' $$,
  'fact 3: a2 sees none of a1''s devices'
);
select results_eq(
  $$ select count(*)::int from public.push_subscriptions $$,
  ARRAY[1],
  'fact 3 positive control: a2 sees its own one'
);
reset role;
select tests.as_tenant('15300000-0000-4000-8000-000000000011', '15300000-0000-4000-8000-0000000000b1');
select is_empty(
  $$ select id from public.push_subscriptions where tenant_id = '15300000-0000-4000-8000-000000000001' $$,
  'fact 3: B''s lane sees none of A''s rows'
);
select results_eq(
  $$ select count(*)::int from public.push_subscriptions $$,
  ARRAY[1],
  'fact 3 positive control: B''s member reads its own row'
);
reset role;

-- ── 4. the worker's read ──────────────────────────────────────────────────────────────────────
-- Rows the definers would refuse to write: a blocked member's and a soft-deleted member's devices,
-- inserted as the migration role (they predate the block in real life).
insert into public.push_subscriptions (id, tenant_id, user_id, endpoint, p256dh, auth) values
  ('15300000-0000-4000-8000-0000000000c3', '15300000-0000-4000-8000-000000000001',
   '15300000-0000-4000-8000-0000000000a3', 'https://push.fake.test/sub/e4', 'k', 'a'),
  ('15300000-0000-4000-8000-0000000000c4', '15300000-0000-4000-8000-000000000001',
   '15300000-0000-4000-8000-0000000000a4', 'https://push.fake.test/sub/e5', 'k', 'a'),
  ('15300000-0000-4000-8000-0000000000c7', '15300000-0000-4000-8000-000000000001',
   '15300000-0000-4000-8000-0000000000a5', 'https://push.fake.test/sub/e7', 'k', 'a');
-- The worker's lane: the zero user, support_tenant, A's claim (notificationsSystemCtx).
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select user_id::text || ':' || role || ':' || endpoint from app.push_subscriptions_for(array[
       '15300000-0000-4000-8000-0000000000a1', '15300000-0000-4000-8000-0000000000a2',
       '15300000-0000-4000-8000-0000000000a3', '15300000-0000-4000-8000-0000000000a4',
       '15300000-0000-4000-8000-0000000000a5', '15300000-0000-4000-8000-0000000000b1']::uuid[])
      order by 1 $$,
  ARRAY['15300000-0000-4000-8000-0000000000a1:member:https://push.fake.test/sub/e2',
        '15300000-0000-4000-8000-0000000000a2:member:https://push.fake.test/sub/e1',
        '15300000-0000-4000-8000-0000000000a5:admin_tenant:https://push.fake.test/sub/e7'],
  'fact 4: only LIVE listed members of A, with their role; never the blocked, the removed or B''s user'
);
reset role;
select tests.as_tenant('15300000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is_empty(
  $$ select id from app.push_subscriptions_for(array['15300000-0000-4000-8000-0000000000a1',
       '15300000-0000-4000-8000-0000000000a2']::uuid[]) $$,
  'fact 4: from B''s lane, A''s users have no device (T-07-41)'
);
reset role;
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select * from app.push_subscriptions_for(array['15300000-0000-4000-8000-0000000000a1']::uuid[]) $$,
  '42501',
  null,
  'fact 4: without a claim the read is refused (42501)'
);
reset role;

-- ── 5. the dead-member cleanup ────────────────────────────────────────────────────────────────
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select app.push_subscriptions_delete_dead(array[
       '15300000-0000-4000-8000-0000000000a1', '15300000-0000-4000-8000-0000000000a2',
       '15300000-0000-4000-8000-0000000000a3', '15300000-0000-4000-8000-0000000000a4']::uuid[]) $$,
  ARRAY[2],
  'fact 5 (SC 4): the blocked and the soft-deleted members'' devices are deleted (2 rows)'
);
reset role;
select results_eq(
  $$ select user_id::text from public.push_subscriptions
      where tenant_id = '15300000-0000-4000-8000-000000000001' order by 1 $$,
  ARRAY['15300000-0000-4000-8000-0000000000a1', '15300000-0000-4000-8000-0000000000a2',
        '15300000-0000-4000-8000-0000000000a5'],
  'fact 5: …and every live member''s device stays'
);
-- A new stale row, and one in B whose owner is blocked there: `null` sweeps A only.
insert into public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth) values
  ('15300000-0000-4000-8000-000000000001', '15300000-0000-4000-8000-0000000000a3',
   'https://push.fake.test/sub/e6', 'k', 'a');
update public.memberships set blocked_at = now()
 where user_id = '15300000-0000-4000-8000-0000000000b1';
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select app.push_subscriptions_delete_dead(null) $$,
  ARRAY[1],
  'fact 5: null sweeps every stale device of the TENANT (the broadcast path)'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.push_subscriptions
      where tenant_id = '15300000-0000-4000-8000-000000000011' $$,
  ARRAY[1],
  'fact 5 adjacency: …and never another tenant''s row, even a stale one'
);
update public.memberships set blocked_at = null
 where user_id = '15300000-0000-4000-8000-0000000000b1';
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.push_subscriptions_delete_dead(null) $$,
  '42501',
  null,
  'fact 5: without a claim the cleanup is refused (42501)'
);
reset role;

-- ── 6. the outcome report ─────────────────────────────────────────────────────────────────────
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select app.push_subscription_report('15300000-0000-4000-8000-0000000000c7', 'failed');
select app.push_subscription_report('15300000-0000-4000-8000-0000000000c7', 'failed');
reset role;
select results_eq(
  $$ select failure_count from public.push_subscriptions where id = '15300000-0000-4000-8000-0000000000c7' $$,
  ARRAY[2],
  'fact 6: failed increments failure_count'
);
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select app.push_subscription_report('15300000-0000-4000-8000-0000000000c7', 'sent');
reset role;
select results_eq(
  $$ select failure_count, last_success_at is not null from public.push_subscriptions
      where id = '15300000-0000-4000-8000-0000000000c7' $$,
  $$ values (0, true) $$,
  'fact 6: sent stamps last_success_at and resets failure_count'
);
select tests.as_tenant('15300000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select app.push_subscription_report('15300000-0000-4000-8000-0000000000c7', 'gone');
reset role;
select results_eq(
  $$ select count(*)::int from public.push_subscriptions where id = '15300000-0000-4000-8000-0000000000c7' $$,
  ARRAY[1],
  'fact 6 (T-07-41): a report from B''s lane touches none of A''s rows'
);
select tests.as_tenant('15300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select app.push_subscription_report('15300000-0000-4000-8000-0000000000c7', 'gone');
select throws_ok(
  $$ select app.push_subscription_report('15300000-0000-4000-8000-0000000000c7', 'bogus') $$,
  '22023',
  null,
  'fact 6: an unknown outcome is refused (22023)'
);
reset role;
select is_empty(
  $$ select id from public.push_subscriptions where id = '15300000-0000-4000-8000-0000000000c7' $$,
  'fact 6: gone deletes the row (404/410: the endpoint expired)'
);

reset role;
select * from finish();
rollback;
