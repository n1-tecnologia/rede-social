begin;
-- 152-chat.sql — the chat schema's facts, proved inside Postgres (07-08, CHAT-01..04, T-07-50/51/53/
-- 54/58). Numbered 152 after 150 (Realtime authorisation) and 151 (notifications).
--
-- 0. Both chat trigger functions are `prosecdef` and pin `search_path=""`; both triggers exist.
-- 1. `chat_conversations_one_support_per_member` refuses a second support conversation for M1, while
--    M2's first one is accepted (positive control).
-- 2. `chat_messages_body_chk` refuses '', ' ', two newlines and 2,001 characters; 'a', 2,000
--    characters and 2,000 emoji (code points, not bytes) are accepted.
-- 3. The seq trigger assigns 1, 2, 3 whatever `seq` the writer supplied, and maintains `last_seq`,
--    `last_message_side`, `last_staff_seq` and `staff_last_read_seq` (a staff insert sets both to its
--    own seq; a member insert touches neither).
-- 4. A failing insert (inside the savepoint `throws_*` opens) leaves `last_seq` unchanged, and the next
--    insert takes the very next seq: no gap.
-- 5. The policies (T-07-50/51/54): M1's lane reads the conversation, its participant row and its
--    messages; M2's lane reads 0 of all three; the support and admin lanes read them; B's member lane
--    reads 0; M2 cannot insert into M1's conversation (42501); a lane cannot insert a message whose
--    author is not itself (42501); M1 and S can each insert as themselves (positive controls).
-- 6. Each insert commits `realtime.messages` rows (read as the migration role): `chat.message` on the
--    `conv:` and `support-inbox` topics, plus `chat.unread` on `user:<M1>` for a staff message, with
--    payload keys exactly `conversationId`, `id`, `seq` (T-07-53: the body never travels; the `id` is
--    the one `realtime.send` injects). Skipped with a named reason when no partition covers now().
-- 7. `chat_conversations_inbox_idx` serves the inbox statement BY NAME on an ANALYZEd 400-row fixture.
--
-- Fixture ids use the `15200000-…` prefix, used by no other file. Like its siblings, this file ROLLS
-- BACK.
select plan(52);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-chat-a', 'Chat A', '15200000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-chat-b', 'Chat B', '15200000-0000-4000-8000-000000000011');
select tests.auth_user('m1@chat-a.local', '15200000-0000-4000-8000-0000000000a1');
select tests.auth_user('m2@chat-a.local', '15200000-0000-4000-8000-0000000000a2');
select tests.auth_user('support@chat-a.local', '15200000-0000-4000-8000-0000000000a3');
select tests.auth_user('admin@chat-a.local', '15200000-0000-4000-8000-0000000000a4');
select tests.auth_user('member@chat-b.local', '15200000-0000-4000-8000-0000000000b1');
select tests.member('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a1');
select tests.member('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a2');
select tests.member('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a3', 'support_tenant');
select tests.member('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a4', 'admin_tenant');
select tests.member('15200000-0000-4000-8000-000000000011', '15200000-0000-4000-8000-0000000000b1');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('15200000-0000-4000-8000-000000000001', 'chat', true),
  ('15200000-0000-4000-8000-000000000011', 'chat', true);

-- M1's support conversation, and M1 as its participant.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-000000000001', 'support',
   '15200000-0000-4000-8000-0000000000a1');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-000000000001',
   '15200000-0000-4000-8000-0000000000a1', 'member');
-- B's member's conversation, for the cross-tenant reads.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('15200000-0000-4000-8000-0000000000c9', '15200000-0000-4000-8000-000000000011', 'support',
   '15200000-0000-4000-8000-0000000000b1');

-- Facts 6 read rows written at now(): 'on' only when a Realtime partition covers it (Pitfall 3).
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

-- ── 0. the definers and their triggers ─────────────────────────────────────────────────────────
select ok(
  (select prosecdef from pg_proc where oid = 'app.chat_messages_before_insert()'::regprocedure),
  'fact 0: app.chat_messages_before_insert is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid = 'app.chat_messages_after_insert()'::regprocedure),
  'fact 0: app.chat_messages_after_insert is SECURITY DEFINER'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
    where oid = 'app.chat_messages_before_insert()'::regprocedure)
  and (select proconfig @> array['search_path=""'] from pg_proc
    where oid = 'app.chat_messages_after_insert()'::regprocedure),
  'fact 0: both pin search_path to the empty string'
);
select has_trigger('public', 'chat_messages', 'chat_messages_seq_trg',
  'fact 0: chat_messages carries the BEFORE INSERT seq trigger');
select has_trigger('public', 'chat_messages', 'chat_messages_signal_trg',
  'fact 0: chat_messages carries the AFTER INSERT signal trigger');

-- ── 1. one support conversation per member ─────────────────────────────────────────────────────
select throws_like(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('15200000-0000-4000-8000-000000000001', 'support', '15200000-0000-4000-8000-0000000000a1') $$,
  '%chat_conversations_one_support_per_member%',
  'fact 1: a second support conversation for M1 is refused by chat_conversations_one_support_per_member'
);
select lives_ok(
  $$ insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
     values ('15200000-0000-4000-8000-0000000000c2', '15200000-0000-4000-8000-000000000001', 'support',
             '15200000-0000-4000-8000-0000000000a2') $$,
  'fact 1 positive control: M2''s first support conversation is accepted'
);

-- ── 2. the body CHECK (as the migration role, so only the CHECK can refuse) ──────────────────────
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', '') $$,
  '%chat_messages_body_chk%',
  'fact 2: an empty body is refused'
);
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', ' ') $$,
  '%chat_messages_body_chk%',
  'fact 2: a single space is refused'
);
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', E'\n\n') $$,
  '%chat_messages_body_chk%',
  'fact 2: a body of two newlines is refused'
);
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', repeat('a', 2001)) $$,
  '%chat_messages_body_chk%',
  'fact 2: 2,001 characters are refused'
);
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', 'a') $$,
  'fact 2 positive control: one character is accepted'
);
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', repeat('a', 2000)) $$,
  'fact 2 boundary: exactly 2,000 characters are accepted'
);
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', repeat(U&'\+01F600', 2000)) $$,
  'fact 2 encoding: 2,000 emoji (8,000 bytes) are accepted: the CHECK counts code points'
);
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'member', repeat(U&'\+01F600', 2001)) $$,
  '%chat_messages_body_chk%',
  'fact 2 encoding: …and 2,001 emoji are refused'
);
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c2',
             '15200000-0000-4000-8000-0000000000a2', 'bot', 'oi') $$,
  '23514',
  null,
  'fact 2: an author side other than member/staff is refused (the seq trigger copies it onto the conversation first, so chat_conversations_last_side_chk fires before chat_messages_author_side_chk; either is a 23514)'
);

-- ── 3. the seq trigger and the counters ────────────────────────────────────────────────────────
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, seq)
values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
        '15200000-0000-4000-8000-0000000000a1', 'member', 'primeira', 99);
select results_eq(
  $$ select c.last_seq::int, c.last_message_side, c.last_staff_seq::int, c.staff_last_read_seq::int
       from public.chat_conversations c where c.id = '15200000-0000-4000-8000-0000000000c1' $$,
  $$ values (1, 'member', 0, 0) $$,
  'fact 3: a member message moves last_seq to 1 and the side to member, and touches no staff counter'
);
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, seq)
values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
        '15200000-0000-4000-8000-0000000000a3', 'staff', 'resposta', 99);
select results_eq(
  $$ select c.last_seq::int, c.last_message_side, c.last_staff_seq::int, c.staff_last_read_seq::int
       from public.chat_conversations c where c.id = '15200000-0000-4000-8000-0000000000c1' $$,
  $$ values (2, 'staff', 2, 2) $$,
  'fact 3: a staff message sets last_staff_seq AND the team''s staff_last_read_seq to its own seq'
);
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, seq)
values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
        '15200000-0000-4000-8000-0000000000a1', 'member', 'terceira', 99);
select results_eq(
  $$ select seq::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' order by seq $$,
  ARRAY[1, 2, 3],
  'fact 3: three inserts supplying seq 99 got 1, 2, 3'
);
select results_eq(
  $$ select c.last_seq::int, c.last_message_side, c.last_staff_seq::int, c.staff_last_read_seq::int
       from public.chat_conversations c where c.id = '15200000-0000-4000-8000-0000000000c1' $$,
  $$ values (3, 'member', 2, 2) $$,
  'fact 3: after member, staff, member the thread awaits staff (last_seq 3 > staff_last_read_seq 2)'
);
select ok(
  (select last_message_at is not null from public.chat_conversations
    where id = '15200000-0000-4000-8000-0000000000c1'),
  'fact 3: last_message_at is maintained'
);

-- ── 4. a failed insert leaves no gap ───────────────────────────────────────────────────────────
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
             '15200000-0000-4000-8000-0000000000a1', 'member', '   ') $$,
  '%chat_messages_body_chk%',
  'fact 4: a refused insert (inside a savepoint)…'
);
select results_eq(
  $$ select last_seq::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[3],
  'fact 4: …leaves last_seq unchanged'
);
select throws_like(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000ff',
             '15200000-0000-4000-8000-0000000000a1', 'member', 'oi') $$,
  '%conversation_not_found%',
  'fact 4: an insert into an unknown conversation is refused by the trigger (no counter to move)'
);
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
        '15200000-0000-4000-8000-0000000000a1', 'member', 'quarta');
select results_eq(
  $$ select seq::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' order by seq $$,
  ARRAY[1, 2, 3, 4],
  'fact 4: the next insert takes seq 4: contiguous, no gap'
);

-- ── 5. participant/staff-aware policies ────────────────────────────────────────────────────────
-- M1, the thread's member.
select tests.as_tenant('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a1');
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1],
  'fact 5: M1 reads its own conversation (positive control)'
);
select results_eq(
  $$ select count(*)::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[4],
  'fact 5: …and its four messages'
);
select results_eq(
  $$ select count(*)::int from public.chat_participants
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1],
  'fact 5: …and its participant row'
);
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
             '15200000-0000-4000-8000-0000000000a1', 'member', 'pelo meu lane') $$,
  'fact 5 positive control: M1''s lane inserts a message as itself'
);
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
             '15200000-0000-4000-8000-0000000000a2', 'member', 'fingindo ser M2') $$,
  '42501',
  null,
  'fact 5 (T-07-54): a lane cannot insert a message whose author is not itself'
);
reset role;

-- M2, a second member of the SAME tenant.
select tests.as_tenant('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a2');
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5 (T-07-50): M2 reads 0 of M1''s conversation'
);
select results_eq(
  $$ select count(*)::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5 (T-07-50): …0 of its messages'
);
select results_eq(
  $$ select count(*)::int from public.chat_participants
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5 (T-07-50): …and 0 of its participant rows'
);
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c2' $$,
  ARRAY[1],
  'fact 5 positive control: M2 reads its OWN conversation'
);
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
             '15200000-0000-4000-8000-0000000000a2', 'member', 'intrusa') $$,
  '42501',
  null,
  'fact 5 (T-07-50): M2 cannot insert a message into M1''s conversation'
);
reset role;

-- S (support_tenant) and AD (admin_tenant): staff reach every support thread by ROLE.
select tests.as_tenant('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a3', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[5],
  'fact 5: the support lane reads M1''s five messages'
);
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where tenant_id = '15200000-0000-4000-8000-000000000001' $$,
  ARRAY[2],
  'fact 5: …and both support conversations of its tenant, without a participant row'
);
select results_eq(
  $$ select count(*)::int from public.chat_participants
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[1],
  'fact 5: …and the member''s participant row'
);
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000c1',
             '15200000-0000-4000-8000-0000000000a3', 'staff', 'da equipe') $$,
  'fact 5 positive control: the support lane replies as itself'
);
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c9' $$,
  ARRAY[0],
  'fact 5 (T-07-51): the support lane reads 0 of tenant B''s conversation'
);
reset role;
select tests.as_tenant('15200000-0000-4000-8000-000000000001', '15200000-0000-4000-8000-0000000000a4', 'admin_tenant');
select results_eq(
  $$ select count(*)::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[6],
  'fact 5: the admin lane reads M1''s messages too (D-223)'
);
reset role;

-- B's member.
select tests.as_tenant('15200000-0000-4000-8000-000000000011', '15200000-0000-4000-8000-0000000000b1');
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5 (T-07-51): B''s member reads 0 of A''s conversation'
);
select results_eq(
  $$ select count(*)::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5 (T-07-51): …and 0 of its messages'
);
select results_eq(
  $$ select count(*)::int from public.chat_conversations
      where id = '15200000-0000-4000-8000-0000000000c9' $$,
  ARRAY[1],
  'fact 5 positive control: B''s member reads its own conversation'
);
reset role;

-- A staff lane of the WRONG tenant claim (B) sees nothing of A even as support_tenant.
select tests.as_tenant('15200000-0000-4000-8000-000000000011', '15200000-0000-4000-8000-0000000000a3', 'support_tenant');
select results_eq(
  $$ select count(*)::int from public.chat_messages
      where conversation_id = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[0],
  'fact 5 (T-07-51): a staff role claim never crosses the tenant claim'
);
reset role;

-- ── 6. the ids-only signals ────────────────────────────────────────────────────────────────────
-- Everything above inserted at now(), so each topic's rows are read as the migration role.
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select event, (payload->>'seq')::int
       from realtime.messages
      where topic = 'tenant:15200000-0000-4000-8000-000000000001:conv:15200000-0000-4000-8000-0000000000c1'
      order by (payload->>'seq')::int $$,
  $$ values ('chat.message', 1), ('chat.message', 2), ('chat.message', 3), ('chat.message', 4),
            ('chat.message', 5), ('chat.message', 6) $$,
  'fact 6: one chat.message per committed insert on the conv: topic, in seq order'
) else skip('no realtime.messages partition covers now() (the Realtime service creates them)') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int
       from realtime.messages
      where topic = 'tenant:15200000-0000-4000-8000-000000000001:support-inbox'
        and event = 'chat.message'
        and payload->>'conversationId' = '15200000-0000-4000-8000-0000000000c1' $$,
  ARRAY[6],
  'fact 6: …and one per insert on the support inbox (a support conversation)'
) else skip('no realtime.messages partition covers now() (the Realtime service creates them)') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select (payload->>'seq')::int
       from realtime.messages
      where topic = 'tenant:15200000-0000-4000-8000-000000000001:user:15200000-0000-4000-8000-0000000000a1'
        and event = 'chat.unread'
      order by 1 $$,
  ARRAY[2, 6],
  'fact 6: chat.unread rings the member''s own topic for the two STAFF messages only'
) else skip('no realtime.messages partition covers now() (the Realtime service creates them)') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select distinct array(select jsonb_object_keys(payload) order by 1)
       from realtime.messages
      where topic like 'tenant:15200000-0000-4000-8000-000000000001:%' $$,
  $$ values (array['conversationId', 'id', 'seq']) $$,
  'fact 6 (T-07-53): every chat signal carries exactly conversationId, id, seq (never the body)'
) else skip('no realtime.messages partition covers now() (the Realtime service creates them)') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int
       from realtime.messages
      where topic like 'tenant:15200000-0000-4000-8000-000000000001:%'
        and payload->>'id' is distinct from id::text $$,
  ARRAY[0],
  'fact 6: the injected id is each signal''s own realtime.messages row id'
) else skip('no realtime.messages partition covers now() (the Realtime service creates them)') end;

-- ── 7. the inbox statement rides chat_conversations_inbox_idx, by name ─────────────────────────
-- 400 support conversations in A (created_by null, so the one-per-member index does not bind them)
-- and 400 in B, their `last_message_at` spread over 400 minutes, then `analyze`.
insert into public.chat_conversations (tenant_id, kind, last_message_at, last_seq, last_message_side)
select t.id, 'support', now() - make_interval(mins => g), 1, 'member'
  from (values ('15200000-0000-4000-8000-000000000001'::uuid),
               ('15200000-0000-4000-8000-000000000011'::uuid)) as t(id),
       generate_series(1, 400) g;
analyze public.chat_conversations;

create temporary table chat_plans (name text primary key, plan text);
do $$
declare
  v_plan text;
begin
  execute $q$
    explain (format json)
    select c.id,
           c.created_by_user_id,
           c.last_seq,
           c.staff_last_read_seq,
           c.last_message_side,
           to_char(c.last_message_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_message_at
      from public.chat_conversations c
     where c.tenant_id = '15200000-0000-4000-8000-000000000001'::uuid
       and c.kind = 'support'
       and (
         null::timestamptz is null
         or (c.last_message_at, c.id) < (null::timestamptz, null::uuid)
       )
     order by c.last_message_at desc, c.id desc
     limit 21 $q$ into v_plan;
  insert into chat_plans values ('inbox', v_plan);
end
$$;
select matches(
  (select plan from chat_plans where name = 'inbox'),
  'chat_conversations_inbox_idx',
  'fact 7: the inbox page is served by chat_conversations_inbox_idx, BY NAME'
);
select ok(
  (select plan from chat_plans where name = 'inbox') not like '%Seq Scan%',
  'fact 7: …and it is not a sequential scan'
);

select * from finish();
rollback;
