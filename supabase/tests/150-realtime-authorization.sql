begin;
-- 150-realtime-authorization.sql — SC 4 / T-07-01 / T-07-02, proved inside Postgres (07-01): who may
-- JOIN which Realtime topic, and who may PUBLISH. Numbered 150 because 140..142 are Phase 6's events.
--
-- HOW REALTIME ASKS. On a private channel join, Realtime sets `realtime.topic` to the channel's topic
-- and runs a SELECT on `realtime.messages` as `authenticated` with the user's OWN Supabase JWT in
-- `request.jwt.claims`: `sub` and `role`, and NO `tenant_id` (no custom access token hook exists).
-- `tests.as_realtime_user` reproduces exactly that lane, and each "join" below is that SELECT
-- against a PROBE row of the same topic: a probe the caller can read is a join the policy admits.
--
-- PITFALL 3: `realtime.messages` is `PARTITION BY RANGE (inserted_at)` with daily partitions the
-- Realtime service creates. Every probe is inserted (as the migration role) with an `inserted_at`
-- inside an EXISTING partition, found through `pg_inherits`. On a stack with no partition the probe
-- facts are SKIPPED with a named reason, never passed; facts 10 and 11 insert at `now()` and skip
-- when no partition covers it.
--
-- 0. The privilege facts. Both definers are `prosecdef`, pin `search_path=""`, are NOT executable by
--    `anon` and ARE executable by `authenticated`. `realtime.messages` carries exactly ONE policy,
--    `realtime_tenant_topics_select`, for SELECT: no write policy exists.
-- 1. A's member reads its own `user:` probe (the positive control of the file).
-- 2. …and reads 0 on the second member's `user:` topic.
-- 3. …and reads 0 on B's member topic and on B's `all`, while B's member reads its own.
-- 4. The member reads 0 on `support-inbox`, while `support_tenant` and `admin_tenant` read 1.
-- 5. The conversation's participant reads its `conv:` probe, both staff roles read it (a support
--    conversation), and the second member reads 0.
-- 6. With `blocked_at` set on the member, every topic reads 0; the second member still reads its own.
-- 7. A malformed topic (not a uuid, an extra segment, upper-case hex, 36 hyphens) reads 0 and never
--    raises; the well-formed `all` reads 1.
-- 8. With `notifications` disabled for A, `all` reads 0 while `user:` still reads 1; with `chat`
--    disabled, `support-inbox` and `conv:` read 0.
-- 9. A suspended tenant reads 0 everywhere; B's member, same block, still reads its own.
-- 10. An `authenticated` INSERT into `realtime.messages` is refused (42501): a browser can never
--     publish (T-07-02).
-- 11. `app.realtime_signal` under a lane with no tenant claim raises 42501, and with a bad suffix
--     raises 42501; under A's tenant lane with a good suffix it inserts ONE row on `tenant:<A>:all`,
--     which A's member can then read.
--
-- Fixture ids use the `15000000-…` prefix, used by no other file. Like its siblings, this file ROLLS
-- BACK.
select plan(44);

-- ── the Realtime lane ──────────────────────────────────────────────────────────────────────────
-- The real Realtime claim shape: `sub` + `role`, NO `tenant_id`. All three settings are LOCAL.
create or replace function tests.as_realtime_user(p_user uuid, p_topic text)
returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('realtime.topic', p_topic, true);
  perform set_config('role', 'authenticated', true);
end
$$;
grant execute on function tests.as_realtime_user(uuid, text) to public;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-rt-a', 'Realtime A', '15000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-rt-b', 'Realtime B', '15000000-0000-4000-8000-000000000011');
select tests.auth_user('member@rt-a.local', '15000000-0000-4000-8000-0000000000a1');
select tests.auth_user('second@rt-a.local', '15000000-0000-4000-8000-0000000000a2');
select tests.auth_user('admin@rt-a.local', '15000000-0000-4000-8000-0000000000a3');
select tests.auth_user('support@rt-a.local', '15000000-0000-4000-8000-0000000000a4');
select tests.auth_user('member@rt-b.local', '15000000-0000-4000-8000-0000000000b1');
select tests.member('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000a1');
select tests.member('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000a2');
select tests.member('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000a3', 'admin_tenant');
select tests.member('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000a4', 'support_tenant');
select tests.member('15000000-0000-4000-8000-000000000011', '15000000-0000-4000-8000-0000000000b1');

insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('15000000-0000-4000-8000-000000000001', 'notifications', true),
  ('15000000-0000-4000-8000-000000000001', 'chat', true),
  ('15000000-0000-4000-8000-000000000011', 'notifications', true);

-- A support conversation in A, created by the first member, who is its participant.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('15000000-0000-4000-8000-0000000000c1', '15000000-0000-4000-8000-000000000001', 'support',
   '15000000-0000-4000-8000-0000000000a1');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('15000000-0000-4000-8000-0000000000c1', '15000000-0000-4000-8000-000000000001',
   '15000000-0000-4000-8000-0000000000a1', 'member');

-- PITFALL 3: an `inserted_at` inside an existing partition (the one covering now() when there is
-- one, else the newest), kept in a LOCAL setting any role can read. Empty = no partition at all.
select set_config(
  'tests.probe_at',
  coalesce((
    select (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'FROM \(''([^'']+)''\)'))[1]
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'realtime.messages'::regclass
     order by (pg_get_expr(c.relpartbound, c.oid) like
               '%FROM (''' || to_char(date_trunc('day', now() at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS') || ''')%') desc,
              c.relname desc
     limit 1
  ), ''),
  true
);
-- Facts 10 and 11 write at now(): 'on' only when a partition covers it.
select set_config(
  'tests.now_partition',
  case when exists (
    select 1
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'realtime.messages'::regclass
       and pg_get_expr(c.relpartbound, c.oid) like
           '%FROM (''' || to_char(date_trunc('day', now() at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS') || ''')%'
  ) then 'on' else '' end,
  true
);

-- One probe per topic, as the migration role.
insert into realtime.messages (id, topic, extension, private, event, payload, inserted_at)
select gen_random_uuid(), t.topic, 'broadcast', true, 'probe', '{}'::jsonb,
       current_setting('tests.probe_at')::timestamp
  from (values
    ('tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1'),
    ('tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a2'),
    ('tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1'),
    ('tenant:15000000-0000-4000-8000-000000000011:all'),
    ('tenant:15000000-0000-4000-8000-000000000001:all'),
    ('tenant:15000000-0000-4000-8000-000000000001:support-inbox'),
    ('tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1'),
    ('tenant:not-a-uuid:all'),
    ('tenant:15000000-0000-4000-8000-000000000001:all:extra'),
    ('tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000A1'),
    ('tenant:------------------------------------:all')
  ) as t(topic)
 where current_setting('tests.probe_at') <> '';

-- ── 0. the privilege facts ────────────────────────────────────────────────────────────────────
select ok(
  (select prosecdef from pg_proc where oid = 'app.realtime_topic_allowed(text)'::regprocedure),
  'app.realtime_topic_allowed is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.realtime_topic_allowed(text)'::regprocedure),
  '…and pins search_path to the empty string'
);
select ok(
  not has_function_privilege('anon', 'app.realtime_topic_allowed(text)', 'execute'),
  '…anon cannot execute it (PUBLIC''s default EXECUTE is revoked)'
);
select ok(
  has_function_privilege('authenticated', 'app.realtime_topic_allowed(text)', 'execute'),
  'positive control: authenticated (the Realtime join role) can'
);
select ok(
  (select prosecdef from pg_proc where oid = 'app.realtime_signal(text,text,jsonb)'::regprocedure),
  'app.realtime_signal is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.realtime_signal(text,text,jsonb)'::regprocedure),
  '…and pins search_path to the empty string'
);
select ok(
  not has_function_privilege('anon', 'app.realtime_signal(text,text,jsonb)', 'execute'),
  '…anon cannot execute it'
);
select ok(
  has_function_privilege('authenticated', 'app.realtime_signal(text,text,jsonb)', 'execute'),
  'positive control: authenticated (the tenant lane''s role) can'
);
select is(
  (select string_agg(polname::text || ':' || polcmd::text, ',' order by polname)
     from pg_policy where polrelid = 'realtime.messages'::regclass),
  'realtime_tenant_topics_select:r',
  'T-07-02: realtime.messages carries exactly ONE policy, for SELECT: no write policy exists'
);

-- ── 1. the member's own user topic ────────────────────────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  'fact 1: A''s member joins its OWN user topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;

-- ── 2. another member's user topic ────────────────────────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a2');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a2' $$,
  ARRAY[0],
  'fact 2: …and never the second member''s user topic, in the SAME tenant'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;

-- ── 3. another tenant's topics ────────────────────────────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1' $$,
  ARRAY[0],
  'fact 3: A''s member cannot join B''s member topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000011:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000011:all' $$,
  ARRAY[0],
  'fact 3: …nor B''s all topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000b1',
  'tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1' $$,
  ARRAY[1],
  'fact 3 positive control: B''s member joins its own topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;

-- ── 4. the support inbox is staff-only ────────────────────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:support-inbox');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:support-inbox' $$,
  ARRAY[0],
  'fact 4: a member cannot join support-inbox'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a4',
  'tenant:15000000-0000-4000-8000-000000000001:support-inbox');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:support-inbox' $$,
  ARRAY[1],
  'fact 4 positive control: support_tenant joins support-inbox'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a3',
  'tenant:15000000-0000-4000-8000-000000000001:support-inbox');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:support-inbox' $$,
  ARRAY[1],
  'fact 4 positive control: admin_tenant joins support-inbox'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;

-- ── 5. a conversation topic ───────────────────────────────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1],
  'fact 5: the participant joins its conversation topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a3',
  'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1],
  'fact 5: admin_tenant joins a SUPPORT conversation it does not participate in'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a4',
  'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1],
  'fact 5: support_tenant joins it too'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a2',
  'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5: a member who is not a participant cannot'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;

-- ── 6. a blocked member joins nothing ─────────────────────────────────────────────────────────
update public.memberships set status = 'blocked', blocked_at = now()
 where tenant_id = '15000000-0000-4000-8000-000000000001'
   and user_id = '15000000-0000-4000-8000-0000000000a1';
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[0],
  'fact 6: blocked, the member cannot join even its own user topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all' $$,
  ARRAY[0],
  'fact 6: …nor the tenant''s all topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 6: …nor its own conversation'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a2',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a2');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a2' $$,
  ARRAY[1],
  'fact 6 positive control: the second member, not blocked, still joins its own topic'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
update public.memberships set status = 'active', blocked_at = null
 where tenant_id = '15000000-0000-4000-8000-000000000001'
   and user_id = '15000000-0000-4000-8000-0000000000a1';

-- ── 7. malformed topics read nothing and never raise ──────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1', 'tenant:not-a-uuid:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages where topic = 'tenant:not-a-uuid:all' $$,
  ARRAY[0],
  'fact 7: a tenant segment that is not a uuid is refused, never cast'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:all:extra');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all:extra' $$,
  ARRAY[0],
  'fact 7: an extra segment is refused'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000A1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000A1' $$,
  ARRAY[0],
  'fact 7: upper-case hex is refused, not normalised (it would be the member''s own topic)'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:------------------------------------:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:------------------------------------:all' $$,
  ARRAY[0],
  'fact 7: 36 hyphens pass the shape regex but are refused before the cast (never a raise)'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all' $$,
  ARRAY[1],
  'fact 7 positive control: the well-formed all topic of the member''s tenant is joined'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;

-- ── 8. the module flags gate their topics ─────────────────────────────────────────────────────
update public.tenant_modules set enabled = false
 where tenant_id = '15000000-0000-4000-8000-000000000001' and module_key = 'notifications';
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all' $$,
  ARRAY[0],
  'fact 8: notifications disabled, the all topic is closed'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[1],
  'fact 8 positive control: the member''s own user topic stays open (chat signals ride it too)'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '15000000-0000-4000-8000-000000000001' and module_key = 'notifications';
update public.tenant_modules set enabled = false
 where tenant_id = '15000000-0000-4000-8000-000000000001' and module_key = 'chat';
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a4',
  'tenant:15000000-0000-4000-8000-000000000001:support-inbox');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:support-inbox' $$,
  ARRAY[0],
  'fact 8: chat disabled, support-inbox is closed even to staff'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:conv:15000000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 8: …and so is the participant''s conversation'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
update public.tenant_modules set enabled = true
 where tenant_id = '15000000-0000-4000-8000-000000000001' and module_key = 'chat';

-- ── 9. a suspended tenant ─────────────────────────────────────────────────────────────────────
update public.tenants set status = 'suspended' where id = '15000000-0000-4000-8000-000000000001';
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1' $$,
  ARRAY[0],
  'fact 9: suspended, the member''s own user topic is closed'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:all');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all' $$,
  ARRAY[0],
  'fact 9: …and so is all'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a4',
  'tenant:15000000-0000-4000-8000-000000000001:support-inbox');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:support-inbox' $$,
  ARRAY[0],
  'fact 9: …and support-inbox, for staff too'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000b1',
  'tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1');
select case when current_setting('tests.probe_at') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000011:user:15000000-0000-4000-8000-0000000000b1' $$,
  ARRAY[1],
  'fact 9 positive control: B, active, still joins'
) else skip('no realtime.messages partition exists (the Realtime service creates them)') end;
reset role;
update public.tenants set status = 'active' where id = '15000000-0000-4000-8000-000000000001';

-- ── 10. a browser can never publish ───────────────────────────────────────────────────────────
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1');
select case when current_setting('tests.now_partition') <> '' then throws_ok(
  $$ insert into realtime.messages (topic, extension, private, event, payload)
     values ('tenant:15000000-0000-4000-8000-000000000001:user:15000000-0000-4000-8000-0000000000a1',
             'broadcast', true, 'forged', '{}') $$,
  '42501',
  null,
  'fact 10: an authenticated INSERT into realtime.messages is refused (no insert policy)'
) else skip('no realtime.messages partition covers now()') end;
reset role;

-- ── 11. app.realtime_signal publishes only inside the caller's tenant ─────────────────────────
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.realtime_signal('all', 'notifications.changed', '{"kind":"probe"}') $$,
  '42501',
  null,
  'fact 11: a lane with no tenant claim is refused (42501)'
);
reset role;
select tests.as_tenant('15000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ select app.realtime_signal('user:NOT-A-UUID', 'notifications.changed', '{"kind":"probe"}') $$,
  '42501',
  null,
  'fact 11: a suffix outside the four shapes is refused (42501)'
);
select lives_ok(
  $$ select app.realtime_signal('all', 'notifications.changed', '{"kind":"probe"}') $$,
  'fact 11: a good suffix under A''s tenant lane publishes'
);
reset role;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all'
        and event = 'notifications.changed' $$,
  ARRAY[1],
  'fact 11: …exactly ONE row, on tenant:<A>:all (the tenant half is the caller''s claim)'
) else skip('no realtime.messages partition covers now()') end;
select tests.as_realtime_user('15000000-0000-4000-8000-0000000000a1',
  'tenant:15000000-0000-4000-8000-000000000001:all');
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages
      where topic = 'tenant:15000000-0000-4000-8000-000000000001:all'
        and event = 'notifications.changed' $$,
  ARRAY[1],
  'fact 11: …which A''s member, joined to all, receives'
) else skip('no realtime.messages partition covers now()') end;
reset role;

select * from finish();
rollback;
