begin;
-- 154-moderation-log.sql — MODER-03 / D-337 / T-08-02 / T-08-03, proved inside Postgres (08-01): the
-- kernel's moderation log is APPEND-ONLY in every lane, the owner's included.
--
-- 154, not 160: 08.1-07 already plans `160-shared-identity.sql`.
--
-- 0. Policy shape: exactly one `select` and one `insert` policy; zero update/delete/`for all`.
-- 1. Grants: update, delete and truncate are revoked from anon, authenticated, service_role and
--    api_user (`*_moderation_log_immutable.sql`); insert and select stay with the two lanes.
-- 2. The tenant lane (A's admin): an insert naming itself as the actor succeeds; naming another actor
--    or tenant B fails the insert policy (42501); update, delete and truncate are refused (42501); B's
--    rows are invisible and A's are visible (isolation is the policy, the permission is the API's).
-- 3. The admin lane (`service_role`, which bypasses RLS) and the table OWNER (`postgres`): update,
--    delete and truncate all raise 42501 — the row and statement triggers are the guard there.
-- 4. The CHECKs refuse a comment removal without a subject, a 501-character reason, a 281-character
--    excerpt and a role change without details (23514).
-- 5. Invariant (the 08-01 assumption-delta decision): every row's actor and target membership ids
--    belong to memberships of the row's own tenant.
--
-- Fixture ids use the `15400000-…` prefix, used by no other file. Like its siblings, this file ROLLS
-- BACK.
select plan(28);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ml-a', 'Moderacao A', '15400000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ml-b', 'Moderacao B', '15400000-0000-4000-8000-000000000011');
select tests.auth_user('a1@ml-a.local', '15400000-0000-4000-8000-0000000000a1');
select tests.auth_user('a2@ml-a.local', '15400000-0000-4000-8000-0000000000a2');
select tests.auth_user('b1@ml-b.local', '15400000-0000-4000-8000-0000000000b1');
select tests.auth_user('b2@ml-b.local', '15400000-0000-4000-8000-0000000000b2');
-- Fixed membership ids, so a lane can name them in a literal (a lane cannot read B's memberships).
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('15400000-0000-4000-8000-0000000001a1', '15400000-0000-4000-8000-000000000001',
   '15400000-0000-4000-8000-0000000000a1', 'admin_tenant', 'active'),
  ('15400000-0000-4000-8000-0000000001a2', '15400000-0000-4000-8000-000000000001',
   '15400000-0000-4000-8000-0000000000a2', 'member', 'active'),
  ('15400000-0000-4000-8000-0000000001b1', '15400000-0000-4000-8000-000000000011',
   '15400000-0000-4000-8000-0000000000b1', 'admin_tenant', 'active'),
  ('15400000-0000-4000-8000-0000000001b2', '15400000-0000-4000-8000-000000000011',
   '15400000-0000-4000-8000-0000000000b2', 'member', 'active');

-- One block row per tenant, written as the migration role (the admin-lane writer's shape). The
-- reasons are IDENTICAL on both sides (adjacency).
insert into public.moderation_log
  (id, tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id, reason)
values
  ('15400000-0000-4000-8000-0000000002a1', '15400000-0000-4000-8000-000000000001', 'member_blocked',
   '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1',
   '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2', 'motivo'),
  ('15400000-0000-4000-8000-0000000002b1', '15400000-0000-4000-8000-000000000011', 'member_blocked',
   '15400000-0000-4000-8000-0000000000b1', '15400000-0000-4000-8000-0000000001b1',
   '15400000-0000-4000-8000-0000000000b2', '15400000-0000-4000-8000-0000000001b2', 'motivo');

-- ── 0. policy shape ───────────────────────────────────────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from pg_policy
      where polrelid = 'public.moderation_log'::regclass and polcmd = 'r' $$,
  ARRAY[1],
  'fact 0: exactly one SELECT policy (moderation_log_tenant_select)'
);
select results_eq(
  $$ select count(*)::int from pg_policy
      where polrelid = 'public.moderation_log'::regclass and polcmd = 'a' $$,
  ARRAY[1],
  'fact 0: exactly one INSERT policy (moderation_log_tenant_insert)'
);
select results_eq(
  $$ select count(*)::int from pg_policy
      where polrelid = 'public.moderation_log'::regclass and polcmd in ('w', 'd', '*') $$,
  ARRAY[0],
  'fact 0: zero update / delete / for-all policies'
);

-- ── 1. grants ─────────────────────────────────────────────────────────────────────────────────
select ok(
  not (has_table_privilege('anon', 'public.moderation_log', 'UPDATE')
       or has_table_privilege('anon', 'public.moderation_log', 'DELETE')
       or has_table_privilege('anon', 'public.moderation_log', 'TRUNCATE')),
  'fact 1: anon holds no update, delete or truncate'
);
select ok(
  not (has_table_privilege('authenticated', 'public.moderation_log', 'UPDATE')
       or has_table_privilege('authenticated', 'public.moderation_log', 'DELETE')
       or has_table_privilege('authenticated', 'public.moderation_log', 'TRUNCATE')),
  'fact 1: authenticated (the tenant lane) holds no update, delete or truncate'
);
select ok(
  not (has_table_privilege('service_role', 'public.moderation_log', 'UPDATE')
       or has_table_privilege('service_role', 'public.moderation_log', 'DELETE')
       or has_table_privilege('service_role', 'public.moderation_log', 'TRUNCATE')),
  'fact 1: service_role (the admin lane) holds no update, delete or truncate'
);
select ok(
  not (has_table_privilege('api_user', 'public.moderation_log', 'UPDATE')
       or has_table_privilege('api_user', 'public.moderation_log', 'DELETE')
       or has_table_privilege('api_user', 'public.moderation_log', 'TRUNCATE')),
  'fact 1: api_user holds no update, delete or truncate'
);
select ok(
  has_table_privilege('authenticated', 'public.moderation_log', 'INSERT')
    and has_table_privilege('authenticated', 'public.moderation_log', 'SELECT'),
  'fact 1 positive control: the tenant lane may still insert and select'
);
select ok(
  has_table_privilege('service_role', 'public.moderation_log', 'INSERT')
    and has_table_privilege('service_role', 'public.moderation_log', 'SELECT'),
  'fact 1 positive control: the admin lane may still insert and select'
);

-- ── 2. the tenant lane (A's admin) ─────────────────────────────────────────────────────────────
select tests.as_tenant(
  '15400000-0000-4000-8000-000000000001', '15400000-0000-4000-8000-0000000000a1', 'admin_tenant'
);
select lives_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
        subject_type, subject_id, excerpt)
     values ('15400000-0000-4000-8000-000000000001', 'comment_removed',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1',
             '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2',
             'post_comment', '15400000-0000-4000-8000-0000000003a1', 'texto removido') $$,
  'fact 2: the lane appends a row that names ITSELF as the actor'
);
select throws_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id)
     values ('15400000-0000-4000-8000-000000000001', 'member_unblocked',
             '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1') $$,
  '42501',
  null,
  'fact 2: an insert naming ANOTHER actor fails the insert policy (T-08-03)'
);
select throws_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id)
     values ('15400000-0000-4000-8000-000000000011', 'member_unblocked',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001b1',
             '15400000-0000-4000-8000-0000000000b2', '15400000-0000-4000-8000-0000000001b2') $$,
  '42501',
  null,
  'fact 2: an insert into tenant B fails the insert policy'
);
select throws_ok(
  $$ update public.moderation_log set reason = 'reescrito'
      where id = '15400000-0000-4000-8000-0000000002a1' $$,
  '42501',
  null,
  'fact 2: the lane cannot UPDATE its own tenant''s row'
);
select throws_ok(
  $$ delete from public.moderation_log where id = '15400000-0000-4000-8000-0000000002a1' $$,
  '42501',
  null,
  'fact 2: the lane cannot DELETE its own tenant''s row'
);
select throws_ok(
  $$ truncate public.moderation_log $$,
  '42501',
  null,
  'fact 2: the lane cannot TRUNCATE the log'
);
select is_empty(
  $$ select id from public.moderation_log
      where tenant_id = '15400000-0000-4000-8000-000000000011' $$,
  'fact 2: B''s rows are invisible to A''s lane'
);
select results_eq(
  $$ select tenant_id::text from public.moderation_log where reason = 'motivo' $$,
  ARRAY['15400000-0000-4000-8000-000000000001'],
  'fact 2: adjacency — identical reasons on both sides, the lane returns only A''s row'
);
reset role;

-- ── 3. the admin lane and the owner ────────────────────────────────────────────────────────────
select tests.as_service();
select throws_ok(
  $$ update public.moderation_log set reason = 'reescrito'
      where id = '15400000-0000-4000-8000-0000000002a1' $$,
  '42501',
  null,
  'fact 3: service_role (bypasses RLS) cannot UPDATE'
);
select throws_ok(
  $$ delete from public.moderation_log where id = '15400000-0000-4000-8000-0000000002a1' $$,
  '42501',
  null,
  'fact 3: service_role cannot DELETE'
);
select throws_ok(
  $$ truncate public.moderation_log $$,
  '42501',
  null,
  'fact 3: service_role cannot TRUNCATE'
);
reset role;

select throws_ok(
  $$ update public.moderation_log set reason = 'reescrito'
      where id = '15400000-0000-4000-8000-0000000002a1' $$,
  '42501',
  'moderation_log is append-only',
  'fact 3: the table OWNER cannot UPDATE either (the row trigger)'
);
select throws_ok(
  $$ delete from public.moderation_log where id = '15400000-0000-4000-8000-0000000002a1' $$,
  '42501',
  'moderation_log is append-only',
  'fact 3: the table owner cannot DELETE (the row trigger)'
);
select throws_ok(
  $$ truncate public.moderation_log $$,
  '42501',
  'moderation_log is append-only',
  'fact 3: the table owner cannot TRUNCATE (the statement trigger)'
);

-- ── 4. the CHECKs ──────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id)
     values ('15400000-0000-4000-8000-000000000001', 'comment_removed',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1',
             '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2') $$,
  '23514',
  null,
  'fact 4: a comment removal without a subject is refused (moderation_log_subject_chk)'
);
select throws_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
        reason)
     values ('15400000-0000-4000-8000-000000000001', 'member_blocked',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1',
             '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2',
             repeat('m', 501)) $$,
  '23514',
  null,
  'fact 4: a 501-character reason is refused (moderation_log_reason_len_chk)'
);
select throws_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
        subject_type, subject_id, excerpt)
     values ('15400000-0000-4000-8000-000000000001', 'comment_removed',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1',
             '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2',
             'post_comment', '15400000-0000-4000-8000-0000000003a2', repeat('e', 281)) $$,
  '23514',
  null,
  'fact 4: a 281-character excerpt is refused (moderation_log_excerpt_len_chk)'
);
select throws_ok(
  $$ insert into public.moderation_log
       (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id)
     values ('15400000-0000-4000-8000-000000000001', 'role_changed',
             '15400000-0000-4000-8000-0000000000a1', '15400000-0000-4000-8000-0000000001a1',
             '15400000-0000-4000-8000-0000000000a2', '15400000-0000-4000-8000-0000000001a2') $$,
  '23514',
  null,
  'fact 4: a role change without details is refused (moderation_log_details_chk)'
);

-- ── 5. invariant: both parties are memberships of the row's own tenant ─────────────────────────
select is_empty(
  $$ select l.id
       from public.moderation_log l
       left join public.memberships a on a.id = l.actor_membership_id
       left join public.memberships t on t.id = l.target_membership_id
      where a.id is null or t.id is null
         or a.tenant_id <> l.tenant_id or t.tenant_id <> l.tenant_id
         or a.user_id <> l.actor_user_id or t.user_id <> l.target_user_id $$,
  'fact 5: every log row is anchored to two memberships of its own tenant, matching its user ids'
);

select * from finish();
rollback;
