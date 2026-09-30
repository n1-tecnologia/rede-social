begin;
-- 151-notifications.sql — NOTIF-01 / NOTIF-02 / T-07-03, proved inside Postgres (07-01): the reshaped
-- `notifications` table, its owner-only policies and the SECURITY DEFINER `app.notifications_fanout`,
-- its only writer.
--
-- 0. The privilege facts: `app.notifications_fanout` is `prosecdef`, pins `search_path=""`, is NOT
--    executable by `anon` and IS executable by `authenticated`.
-- 1. `notifications_tenant_user_dedupe_uq` refuses a duplicate `(tenant, user, dedupe_key)` (23505).
-- 2. `members` audience: one row per LIVE `member` of A (D-229), and none for `admin_tenant`,
--    `support_tenant`, a blocked member, a soft-deleted membership, an invited membership or the
--    excluded author. Every row of the fan-out shares ONE `created_at` (NOTIF-01 ordering).
-- 3. Idempotency: a second identical call returns 0 rows and writes nothing.
-- 4. `users` audience: only LIVE listed users, of ANY role, and never a user of B listed by id.
-- 5. Without a tenant claim the function raises 42501.
-- 6. Owner-only reads (T-07-03): a member lane counts exactly its own rows and none of a colleague's
--    in the same tenant; the second member sees only its own; B's lane sees none of A's rows and its
--    own one.
-- 7. Owner-only writes: a member-lane UPDATE of a colleague's row touches 0 rows (its own touches 1),
--    an INSERT is refused (42501, no insert policy), and a DELETE touches 0 rows (no delete policy)
--    and the colleague's row is intact.
-- 8. `notifications_unread_list_idx` and `notifications_read_list_idx` serve the two list statements
--    BY NAME, on a 4,000-row ANALYZEd fixture, with predicates and order copied VERBATIM from
--    `listNotifications` (`packages/modules/notifications/server/service.ts`): edit both together.
-- 9. `notifications_unseen_idx` serves the bell's count (`countUnseen`).
-- 10. (07-04) `app.notifications_retract` is a hardened definer; on the OBJECT it blanks only the rows
--     about that comment; on the SUBJECT it blanks every remaining row about the post; the payload
--     becomes EXACTLY `{"removed": true}`; the same subject id in B is untouched (adjacency, T-07-21);
--     a row about another target is untouched; a second call changes nothing (idempotent); a lane
--     without a tenant claim, or an unknown `p_on`, is refused (42501).
--
-- Fixture ids use the `15100000-…` prefix, used by no other file. Like its siblings, this file ROLLS
-- BACK.
select plan(38);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-nt-a', 'Notificacoes A', '15100000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-nt-b', 'Notificacoes B', '15100000-0000-4000-8000-000000000011');
-- A: m1 (the author), m2, m3 live members; admin, support; blocked, soft-deleted, invited members.
select tests.auth_user('m1@nt-a.local', '15100000-0000-4000-8000-0000000000a1');
select tests.auth_user('m2@nt-a.local', '15100000-0000-4000-8000-0000000000a2');
select tests.auth_user('m3@nt-a.local', '15100000-0000-4000-8000-0000000000a3');
select tests.auth_user('admin@nt-a.local', '15100000-0000-4000-8000-0000000000a4');
select tests.auth_user('support@nt-a.local', '15100000-0000-4000-8000-0000000000a5');
select tests.auth_user('blocked@nt-a.local', '15100000-0000-4000-8000-0000000000a6');
select tests.auth_user('gone@nt-a.local', '15100000-0000-4000-8000-0000000000a7');
select tests.auth_user('invited@nt-a.local', '15100000-0000-4000-8000-0000000000a8');
select tests.auth_user('member@nt-b.local', '15100000-0000-4000-8000-0000000000b1');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a1');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a2');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a3');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a4', 'admin_tenant');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a5', 'support_tenant');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a6');
select tests.member('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a7');
select tests.member('15100000-0000-4000-8000-000000000011', '15100000-0000-4000-8000-0000000000b1');
update public.memberships set status = 'blocked', blocked_at = now()
 where user_id = '15100000-0000-4000-8000-0000000000a6';
update public.memberships set deleted_at = now()
 where user_id = '15100000-0000-4000-8000-0000000000a7';
insert into public.memberships (tenant_id, user_id, role, status)
values ('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a8', 'member', 'invited');

-- ── 0. the privilege facts ────────────────────────────────────────────────────────────────────
select ok(
  (select prosecdef from pg_proc
    where oid = 'app.notifications_fanout(text,uuid[],uuid[],text,text,text,uuid,text,uuid,uuid,jsonb)'::regprocedure),
  'app.notifications_fanout is SECURITY DEFINER'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.notifications_fanout(text,uuid[],uuid[],text,text,text,uuid,text,uuid,uuid,jsonb)'::regprocedure),
  '…and pins search_path to the empty string'
);
select ok(
  not has_function_privilege('anon',
    'app.notifications_fanout(text,uuid[],uuid[],text,text,text,uuid,text,uuid,uuid,jsonb)', 'execute'),
  '…anon cannot execute it (PUBLIC''s default EXECUTE is revoked)'
);
select ok(
  has_function_privilege('authenticated',
    'app.notifications_fanout(text,uuid[],uuid[],text,text,text,uuid,text,uuid,uuid,jsonb)', 'execute'),
  'positive control: authenticated (the worker''s tenant lane) can'
);

-- ── 1. the dedupe key is unique per recipient ─────────────────────────────────────────────────
insert into public.notifications (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id)
values ('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a3', 'k',
        'k:15100000-0000-4000-8000-0000000000d1', 'post', '15100000-0000-4000-8000-0000000000d1');
select throws_ok(
  $$ insert into public.notifications (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id)
     values ('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a3', 'k',
             'k:15100000-0000-4000-8000-0000000000d1', 'post', '15100000-0000-4000-8000-0000000000d1') $$,
  '23505',
  null,
  'fact 1: notifications_tenant_user_dedupe_uq refuses a duplicate (tenant, user, dedupe_key)'
);

-- ── 2. members audience ───────────────────────────────────────────────────────────────────────
-- The worker's lane: the zero user, support_tenant, A's claim (notificationsSystemCtx).
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select user_id::text from app.notifications_fanout(
       'members', null, array['15100000-0000-4000-8000-0000000000a1']::uuid[], 'feed.post',
       'feed.post:15100000-0000-4000-8000-0000000000f1', 'post', '15100000-0000-4000-8000-0000000000f1',
       null, null, '15100000-0000-4000-8000-0000000000a1', '{"excerpt":"x"}'::jsonb)
      order by 1 $$,
  ARRAY['15100000-0000-4000-8000-0000000000a2', '15100000-0000-4000-8000-0000000000a3'],
  'fact 2: one row per LIVE member, never staff, blocked, removed, invited or the excluded author'
);
reset role;
select results_eq(
  $$ select count(*)::int, count(distinct created_at)::int from public.notifications
      where dedupe_key = 'feed.post:15100000-0000-4000-8000-0000000000f1' $$,
  $$ values (2, 1) $$,
  'fact 2: …two rows written, sharing ONE created_at (NOTIF-01 ordering: ties break on id)'
);

-- ── 3. idempotency ────────────────────────────────────────────────────────────────────────────
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select count(*)::int from app.notifications_fanout(
       'members', null, array['15100000-0000-4000-8000-0000000000a1']::uuid[], 'feed.post',
       'feed.post:15100000-0000-4000-8000-0000000000f1', 'post', '15100000-0000-4000-8000-0000000000f1',
       null, null, '15100000-0000-4000-8000-0000000000a1', '{"excerpt":"x"}'::jsonb) $$,
  ARRAY[0],
  'fact 3: the same call again returns NO recipient (nothing is signalled twice)'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.notifications
      where dedupe_key = 'feed.post:15100000-0000-4000-8000-0000000000f1' $$,
  ARRAY[2],
  'fact 3: …and the table still holds two rows'
);

-- ── 4. users audience ─────────────────────────────────────────────────────────────────────────
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select user_id::text from app.notifications_fanout(
       'users',
       array['15100000-0000-4000-8000-0000000000a2', '15100000-0000-4000-8000-0000000000a4',
             '15100000-0000-4000-8000-0000000000a6', '15100000-0000-4000-8000-0000000000b1']::uuid[],
       null, 'feed.comment_replied', 'feed.comment_replied:15100000-0000-4000-8000-0000000000f2',
       'post', '15100000-0000-4000-8000-0000000000f1', 'comment', '15100000-0000-4000-8000-0000000000f2',
       '15100000-0000-4000-8000-0000000000a3', '{}'::jsonb)
      order by 1 $$,
  ARRAY['15100000-0000-4000-8000-0000000000a2', '15100000-0000-4000-8000-0000000000a4'],
  'fact 4: users audience — live listed users of any role (the admin too), never the blocked one or B''s user'
);
reset role;

-- ── 5. no tenant claim, no write ──────────────────────────────────────────────────────────────
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select * from app.notifications_fanout('members', null, null, 'feed.post', 'feed.post:x',
       'post', '15100000-0000-4000-8000-0000000000f9', null, null, null, '{}'::jsonb) $$,
  '42501',
  null,
  'fact 5: a lane without a tenant claim is refused (42501)'
);
reset role;

-- B's own row, written through B's lane, so fact 6 has a positive control on the other side.
select tests.as_tenant('15100000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select count(*) from app.notifications_fanout(
  'members', null, null, 'feed.post', 'feed.post:15100000-0000-4000-8000-0000000000f1', 'post',
  '15100000-0000-4000-8000-0000000000f1', null, null, null, '{}'::jsonb);
reset role;

-- ── 6. owner-only reads ───────────────────────────────────────────────────────────────────────
-- m2 owns: the members row (fact 2) and the users row (fact 4). m3 owns: the fact-1 row and the
-- members row.
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select count(*)::int from public.notifications $$,
  ARRAY[2],
  'fact 6: a member lane counts exactly its OWN rows'
);
select is_empty(
  $$ select id from public.notifications where user_id <> '15100000-0000-4000-8000-0000000000a2' $$,
  'fact 6: …and none of a colleague''s rows in the same tenant'
);
reset role;
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a3');
select results_eq(
  $$ select user_id::text from public.notifications group by 1 $$,
  ARRAY['15100000-0000-4000-8000-0000000000a3'],
  'fact 6: the second member sees only its own rows'
);
reset role;
select tests.as_tenant('15100000-0000-4000-8000-000000000011', '15100000-0000-4000-8000-0000000000b1');
select is_empty(
  $$ select id from public.notifications where tenant_id = '15100000-0000-4000-8000-000000000001' $$,
  'fact 6: B''s lane sees none of A''s rows'
);
select results_eq(
  $$ select count(*)::int from public.notifications $$,
  ARRAY[1],
  'fact 6 positive control: B''s member reads its own row'
);
reset role;

-- ── 7. owner-only writes ──────────────────────────────────────────────────────────────────────
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ with u as (
       update public.notifications set read_at = now()
        where user_id = '15100000-0000-4000-8000-0000000000a3' returning 1
     ) select count(*)::int from u $$,
  ARRAY[0],
  'fact 7: an UPDATE aimed at a colleague''s rows touches nothing'
);
select results_eq(
  $$ with u as (
       update public.notifications set read_at = now()
        where user_id = '15100000-0000-4000-8000-0000000000a2'
          and dedupe_key = 'feed.post:15100000-0000-4000-8000-0000000000f1' returning 1
     ) select count(*)::int from u $$,
  ARRAY[1],
  'fact 7 positive control: the member marks its OWN row'
);
select throws_ok(
  $$ insert into public.notifications (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id)
     values ('15100000-0000-4000-8000-000000000001', '15100000-0000-4000-8000-0000000000a2', 'k',
             'k:forged', 'post', '15100000-0000-4000-8000-0000000000f1') $$,
  '42501',
  null,
  'fact 7: a member-lane INSERT is refused, even of its own row (no insert policy)'
);
select results_eq(
  $$ with d as (
       delete from public.notifications
        where user_id = '15100000-0000-4000-8000-0000000000a3' returning 1
     ) select count(*)::int from d $$,
  ARRAY[0],
  'fact 7: a member-lane DELETE touches nothing (no delete policy)'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.notifications
      where user_id = '15100000-0000-4000-8000-0000000000a3' and read_at is null $$,
  ARRAY[2],
  'fact 7: …and the colleague''s rows are intact and still unread'
);

-- ── 10. retraction (07-04, keep-and-mark) ─────────────────────────────────────────────────────
select ok(
  (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'app.notifications_retract(text,text,uuid)'::regprocedure),
  'fact 10: app.notifications_retract is SECURITY DEFINER with search_path pinned to ""'
);
select ok(
  not has_function_privilege('anon', 'app.notifications_retract(text,text,uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.notifications_retract(text,text,uuid)', 'execute'),
  'fact 10: anon cannot execute it; authenticated (the worker''s tenant lane) can'
);
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select app.notifications_retract('object', 'comment', '15100000-0000-4000-8000-0000000000f2') $$,
  ARRAY[2],
  'fact 10: on the OBJECT, only the two rows about that comment (m2, the admin) are marked'
);
reset role;
select results_eq(
  $$ select count(*)::int from public.notifications
      where tenant_id = '15100000-0000-4000-8000-000000000001'
        and subject_id = '15100000-0000-4000-8000-0000000000f1'
        and payload = '{"removed": true}'::jsonb $$,
  ARRAY[2],
  'fact 10: …the post rows about the same subject are not yet marked (object, not subject)'
);
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select results_eq(
  $$ select app.notifications_retract('subject', 'post', '15100000-0000-4000-8000-0000000000f1') $$,
  ARRAY[2],
  'fact 10: on the SUBJECT, the two remaining rows about the post are marked (already-marked rows skipped)'
);
select results_eq(
  $$ select app.notifications_retract('subject', 'post', '15100000-0000-4000-8000-0000000000f1') $$,
  ARRAY[0],
  'fact 10: a second call marks nothing (idempotent)'
);
reset role;
select results_eq(
  $$ select count(*)::int,
            count(*) filter (where payload = '{"removed": true}'::jsonb)::int
       from public.notifications
      where tenant_id = '15100000-0000-4000-8000-000000000001'
        and subject_id = '15100000-0000-4000-8000-0000000000f1' $$,
  $$ values (4, 4) $$,
  'fact 10: every A row about the post now holds EXACTLY {"removed": true} (no excerpt survives)'
);
select results_eq(
  $$ select payload from public.notifications
      where tenant_id = '15100000-0000-4000-8000-000000000011'
        and subject_id = '15100000-0000-4000-8000-0000000000f1' $$,
  $$ values ('{}'::jsonb) $$,
  'fact 10 adjacency: B''s row about the SAME subject id is untouched (T-07-21)'
);
select results_eq(
  $$ select count(*)::int from public.notifications
      where dedupe_key = 'k:15100000-0000-4000-8000-0000000000d1'
        and coalesce(payload->>'removed', '') <> 'true' $$,
  ARRAY[1],
  'fact 10 positive control: a row about ANOTHER post is untouched'
);
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select app.notifications_retract('subject', 'post', '15100000-0000-4000-8000-0000000000f1') $$,
  '42501',
  null,
  'fact 10: a lane without a tenant claim is refused (42501)'
);
reset role;
select tests.as_tenant('15100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select throws_ok(
  $$ select app.notifications_retract('everything', 'post', '15100000-0000-4000-8000-0000000000f1') $$,
  '42501',
  null,
  'fact 10: an unknown p_on is refused (42501)'
);
reset role;

-- ── 8 / 9. the list statements and the count ride their indexes, by name ──────────────────────
-- 20 recipients x 200 rows = 4,000 rows, half read, half seen, then `analyze`. The plan asked for
-- 400; at 10 unread rows per recipient the planner rightly prefers a bitmap scan plus a sort, so the
-- fixture uses the 141 volume, where an ordered index scan is the cheaper plan for a 21-row page.
do $$
begin
  for u in 1..20 loop
    perform tests.auth_user('vol' || u || '@nt-a.local', ('151000b0-0000-4000-8000-' || lpad(u::text, 12, '0'))::uuid);
  end loop;
end
$$;
insert into public.notifications
  (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, created_at, seen_at, read_at)
select '15100000-0000-4000-8000-000000000001',
       ('151000b0-0000-4000-8000-' || lpad(u::text, 12, '0'))::uuid,
       'feed.post', 'vol:' || g, 'post', gen_random_uuid(),
       now() - make_interval(mins => g),
       case when g % 2 = 0 then now() end,
       case when g % 2 = 0 then now() end
  from generate_series(1, 20) u, generate_series(1, 200) g;
analyze public.notifications;

create temporary table notification_plans (name text primary key, plan text);
do $$
declare
  v_plan text;
begin
  execute $q$
    explain (format json)
    select n.id,
           n.kind,
           n.subject_type,
           n.subject_id,
           n.object_type,
           n.object_id,
           n.payload,
           to_char(n.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
           to_char(n.seen_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as seen_at,
           to_char(n.read_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as read_at,
           n.actor_user_id
      from public.notifications n
     where n.tenant_id = '15100000-0000-4000-8000-000000000001'::uuid
       and n.user_id = '151000b0-0000-4000-8000-000000000007'::uuid
       and n.read_at is null
       and (
         null::timestamptz is null
         or (n.created_at, n.id) < (null::timestamptz, null::uuid)
       )
     order by n.created_at desc, n.id desc
     limit 21 $q$ into v_plan;
  insert into notification_plans values ('unread', v_plan);

  execute $q$
    explain (format json)
    select n.id,
           n.kind,
           n.subject_type,
           n.subject_id,
           n.object_type,
           n.object_id,
           n.payload,
           to_char(n.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
           to_char(n.seen_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as seen_at,
           to_char(n.read_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as read_at,
           n.actor_user_id
      from public.notifications n
     where n.tenant_id = '15100000-0000-4000-8000-000000000001'::uuid
       and n.user_id = '151000b0-0000-4000-8000-000000000007'::uuid
       and n.read_at is not null
       and (
         null::timestamptz is null
         or (n.created_at, n.id) < (null::timestamptz, null::uuid)
       )
     order by n.created_at desc, n.id desc
     limit 21 $q$ into v_plan;
  insert into notification_plans values ('read', v_plan);

  execute $q$
    explain (format json)
    select count(*)::int as unseen
      from public.notifications n
     where n.tenant_id = '15100000-0000-4000-8000-000000000001'::uuid
       and n.user_id = '151000b0-0000-4000-8000-000000000007'::uuid
       and n.seen_at is null $q$ into v_plan;
  insert into notification_plans values ('unseen', v_plan);
end
$$;
select matches(
  (select plan from notification_plans where name = 'unread'),
  'notifications_unread_list_idx',
  'fact 8: Novas (read_at is null) is served by notifications_unread_list_idx, BY NAME'
);
select ok(
  (select plan from notification_plans where name = 'unread') not like '%Seq Scan%',
  '…and it is not a sequential scan'
);
select matches(
  (select plan from notification_plans where name = 'read'),
  'notifications_read_list_idx',
  'fact 8: Anteriores (read_at is not null) is served by notifications_read_list_idx, BY NAME'
);
select ok(
  (select plan from notification_plans where name = 'read') not like '%Seq Scan%',
  '…and it is not a sequential scan'
);
select matches(
  (select plan from notification_plans where name = 'unseen'),
  'notifications_unseen_idx',
  'fact 9: the bell''s count is served by notifications_unseen_idx, BY NAME'
);
select ok(
  (select plan from notification_plans where name = 'unseen') not like '%Seq Scan%',
  '…and it is not a sequential scan'
);

select * from finish();
rollback;
