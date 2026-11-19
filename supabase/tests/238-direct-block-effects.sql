begin;
-- 238-direct-block-effects.sql — Phase 11 plans 06 and 07 (CHAT-06, CHAT-07; D-719, D-721, D-722, D-728; T-11-01, T-11-02, T-11-03,
-- T-11-04, T-11-08), executed inside Postgres. The send path of a direct conversation in the database (plan 06, sections 1 to 5)
-- and the effects of a member block (plan 07, sections 6 to 9).
--
-- 1. THE PATH (task 1, CHAT-06, D-728): two members open ONE conversation through `app.direct_conversation_open`; the first
--    message gets seq 1 and advances the AUTHOR's `last_read_seq` to 1 (the empty edge: the first message of a fresh
--    direct), the recipient stays at 0; the reply gets seq 2 and moves only the replier; the unread flag of a participant
--    is exactly `last_seq > last_read_seq`.
--
-- 2. THE GUARD (task 1, D-721, D-722; T-11-03): a block either way, `social` off for the row's tenant, an administrator-
--    blocked member, a removed member and an anonymised member each refuse a send with the ONE SQLSTATE `DM001` and the ONE
--    message `direct_closed`, burning no seq; a `staff` side insert into a paired row is refused the same way.
--
-- 3. UNPAIRED UNTOUCHED (task 1): a bare direct (both pair columns null) in a tenant WITHOUT `social` still accepts and
--    numbers a message, and the shipped path does not touch its participant rows.
--
-- 4. THE SIGNALS (task 2, D-719, D-728; T-07-53): the recipient's user topic gets one `chat.unread` carrying only ids.
--
-- 5. THE NOTICE DEFINER (task 3, D-728, D-731; T-11-01, T-11-02, T-11-08): `app.direct_message_notice` answers only the
--    notifications worker (the zero system user).
--
-- 6. THE BLOCK'S EFFECT ON FOLLOWS (plan 07 task 1, CHAT-07; D-722, D-723, D-724; T-11-01, T-11-21): `app.member_block_create`
--    deletes the two follow rows between the pair in the claim's tenant, keeps the conversation, its messages and its
--    participants, and leaves every other follow (a third member's, the same two users' in another tenant) alone.
--
-- 7. EMPTY, IDEMPOTENCY, UNBLOCK (plan 07 task 1): a block with no follow and no conversation answers true and deletes
--    nothing; a second call answers false and still clears a follow that reappeared; unblocking restores nothing.
--
-- 8. THE FOLLOW INSERT POLICY (plan 07 task 2, D-724): a follow across a block is refused from BOTH sides, with a
--    positive control beside each negative, in another tenant, and after the block is lifted.
--
-- 9. PRESERVED PHASE 13 BEHAVIOURS (plan 07 task 3): BL001 and 42501 refusals, the definer hardening, the grants,
--    idempotency and the blocker-only read of `member_blocks`.
--
-- Fixture ids use the `1e380000-…` prefix (`tests.d38('a1')` spells one). Like its siblings, this file ROLLS BACK.
select plan(109);

create function tests.d38(p text) returns uuid language sql immutable as
  $$ select ('1e380000-0000-4000-8000-0000000000' || p)::uuid $$;
-- Inserts ONE message as the CURRENT role and answers 'ok' or '<sqlstate>:<message>' so one assertion can compare the
-- refusal of every cause with the same literal (T-11-03). An exception block is a subtransaction: a refusal burns nothing.
create function tests.send38(p_tenant uuid, p_conv uuid, p_user uuid, p_side text default 'member', p_body text default 'oi')
returns text language plpgsql as $$
begin
  insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
  values (p_tenant, p_conv, p_user, p_side, p_body);
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end
$$;
-- The id of a paired direct, read as the table owner.
create function tests.pair38(p_tenant uuid, p_low uuid, p_high uuid) returns uuid language sql security definer as
  $$ select id from public.chat_conversations
      where tenant_id = p_tenant and direct_low_user_id = p_low and direct_high_user_id = p_high $$;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- Tenant A (`01`, social and chat on) and tenant B (`02`, chat on, social OFF). a1 < a2 < ... in uuid byte order.
select tests.tenant('pgtap-block-a', 'Bloqueio A', tests.d38('01'));
select tests.tenant('pgtap-block-b', 'Bloqueio B', tests.d38('02'));
select tests.auth_user('m1@block-a.local', tests.d38('a1'));
select tests.auth_user('m2@block-a.local', tests.d38('a2'));
select tests.auth_user('m3@block-a.local', tests.d38('a3'));
select tests.auth_user('m4@block-a.local', tests.d38('a4'));
select tests.auth_user('support@block-a.local', tests.d38('a5'));
select tests.auth_user('admin@block-a.local', tests.d38('a6'));
select tests.auth_user('m7@block-a.local', tests.d38('a7'));
select tests.auth_user('m8@block-a.local', tests.d38('a8'));
select tests.auth_user('m9@block-a.local', tests.d38('a9'));
select tests.auth_user('m1@block-b.local', tests.d38('b1'));
select tests.auth_user('m2@block-b.local', tests.d38('b2'));
select tests.auth_user('m3@block-b.local', tests.d38('b3'));
select tests.member(tests.d38('01'), tests.d38('a1'));
select tests.member(tests.d38('01'), tests.d38('a2'));
select tests.member(tests.d38('01'), tests.d38('a3'));
select tests.member(tests.d38('01'), tests.d38('a4'));
select tests.member(tests.d38('01'), tests.d38('a5'), 'support_tenant');
select tests.member(tests.d38('01'), tests.d38('a6'), 'admin_tenant');
select tests.member(tests.d38('01'), tests.d38('a7'));
select tests.member(tests.d38('01'), tests.d38('a8'));
select tests.member(tests.d38('01'), tests.d38('a9'));
select tests.member(tests.d38('02'), tests.d38('b1'));
select tests.member(tests.d38('02'), tests.d38('b2'));
select tests.member(tests.d38('02'), tests.d38('b3'));
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  (tests.d38('01'), 'social', true),
  (tests.d38('01'), 'chat', true),
  (tests.d38('02'), 'social', false),
  (tests.d38('02'), 'chat', true);

-- ── 1. the path ────────────────────────────────────────────────────────────────────────────────
select tests.as_tenant(tests.d38('01'), tests.d38('a1'));
select is(
  (select created from app.direct_conversation_open(tests.d38('a2'))), true,
  'CHAT-06: the two members open one conversation');
select is(
  tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), tests.d38('a1')),
  'ok', 'CHAT-06: the first author sends into the open pair');
reset role;
select results_eq(
  $$ select seq::int from public.chat_messages where conversation_id = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')) $$,
  $$ values (1) $$,
  'CHAT-06 (empty edge): the first message of a fresh direct takes seq 1');
select results_eq(
  $$ select user_id::text, last_read_seq::int, last_read_at is not null
       from public.chat_participants
      where conversation_id = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')) order by user_id $$,
  $$ values (tests.d38('a1')::text, 1, true), (tests.d38('a2')::text, 0, false) $$,
  'D-728: the author read position moves to seq 1 (and its instant is stamped), the recipient stays at 0');
select tests.as_tenant(tests.d38('01'), tests.d38('a2'));
select is(
  tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), tests.d38('a2')),
  'ok', 'CHAT-06: the other participant replies');
reset role;
select results_eq(
  $$ select user_id::text, last_read_seq::int
       from public.chat_participants
      where conversation_id = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')) order by user_id $$,
  $$ values (tests.d38('a1')::text, 1), (tests.d38('a2')::text, 2) $$,
  'D-728: the reply moves only the replier to seq 2; the first author stays at 1 (someone else''s send never moves a position)');
select results_eq(
  $$ select p.user_id::text, c.last_seq > p.last_read_seq
       from public.chat_conversations c
       join public.chat_participants p on p.conversation_id = c.id
      where c.id = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')) order by p.user_id $$,
  $$ values (tests.d38('a1')::text, true), (tests.d38('a2')::text, false) $$,
  'D-728: the unread flag of a participant is exactly last_seq > last_read_seq');

-- ── 2. the guard ───────────────────────────────────────────────────────────────────────────────
-- Five closed pairs (owner-built, the pair in uuid order), one cause each. a1 is the sender everywhere else.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id) values
  (tests.d38('d3'), tests.d38('01'), 'direct', tests.d38('a1'), tests.d38('a1'), tests.d38('a3')),
  (tests.d38('d4'), tests.d38('01'), 'direct', tests.d38('a2'), tests.d38('a2'), tests.d38('a4')),
  (tests.d38('d7'), tests.d38('01'), 'direct', tests.d38('a1'), tests.d38('a1'), tests.d38('a7')),
  (tests.d38('d8'), tests.d38('01'), 'direct', tests.d38('a1'), tests.d38('a1'), tests.d38('a8')),
  (tests.d38('d9'), tests.d38('01'), 'direct', tests.d38('a1'), tests.d38('a1'), tests.d38('a9')),
  (tests.d38('e1'), tests.d38('02'), 'direct', tests.d38('b1'), tests.d38('b1'), tests.d38('b2'));
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  (tests.d38('d3'), tests.d38('01'), tests.d38('a1'), 'member'), (tests.d38('d3'), tests.d38('01'), tests.d38('a3'), 'member'),
  (tests.d38('d4'), tests.d38('01'), tests.d38('a2'), 'member'), (tests.d38('d4'), tests.d38('01'), tests.d38('a4'), 'member'),
  (tests.d38('d7'), tests.d38('01'), tests.d38('a1'), 'member'), (tests.d38('d7'), tests.d38('01'), tests.d38('a7'), 'member'),
  (tests.d38('d8'), tests.d38('01'), tests.d38('a1'), 'member'), (tests.d38('d8'), tests.d38('01'), tests.d38('a8'), 'member'),
  (tests.d38('d9'), tests.d38('01'), tests.d38('a1'), 'member'), (tests.d38('d9'), tests.d38('01'), tests.d38('a9'), 'member'),
  (tests.d38('e1'), tests.d38('02'), tests.d38('b1'), 'member'), (tests.d38('e1'), tests.d38('02'), tests.d38('b2'), 'member');
-- the causes: a member block a1 -> a3 (the blocker side is the low one), a member block a4 -> a2 (the blocker side is the
-- high one), an administrator block of a7, a removed a8, an anonymised a9; tenant B has social off.
insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id) values
  (tests.d38('01'), tests.d38('a1'), tests.d38('a3')),
  (tests.d38('01'), tests.d38('a4'), tests.d38('a2'));
update public.memberships set blocked_at = now() where tenant_id = tests.d38('01') and user_id = tests.d38('a7');
update public.memberships set deleted_at = now() where tenant_id = tests.d38('01') and user_id = tests.d38('a8');
-- an anonymised account (the deletion flow soft-deletes the membership first: `deleted_at` stays set, D-610)
update public.memberships
   set deleted_at = now() - interval '2 days',
       deletion_requested_at = now() - interval '2 days', deletion_due_at = now() - interval '1 day', anonymised_at = now()
 where tenant_id = tests.d38('01') and user_id = tests.d38('a9');

select tests.as_tenant(tests.d38('01'), tests.d38('a1'));
select is(tests.send38(tests.d38('01'), tests.d38('d3'), tests.d38('a1')), 'DM001:direct_closed',
  'D-722: the BLOCKER sending into a blocked pair is refused DM001 direct_closed');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a3'));
select is(tests.send38(tests.d38('01'), tests.d38('d3'), tests.d38('a3')), 'DM001:direct_closed',
  'D-722: the BLOCKED member sending is refused with the SAME code and message (nobody is told)');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a2'));
select is(tests.send38(tests.d38('01'), tests.d38('d4'), tests.d38('a2')), 'DM001:direct_closed',
  'D-722: a block in the other direction (blocker is the high id) refuses the same way');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a1'));
select is(tests.send38(tests.d38('01'), tests.d38('d7'), tests.d38('a1')), 'DM001:direct_closed',
  'D-721/D-722: an administrator-blocked other member closes the pair: the SAME refusal');
select is(tests.send38(tests.d38('01'), tests.d38('d8'), tests.d38('a1')), 'DM001:direct_closed',
  'D-721/D-722: a removed other member closes the pair: the SAME refusal');
select is(tests.send38(tests.d38('01'), tests.d38('d9'), tests.d38('a1')), 'DM001:direct_closed',
  'D-721/D-722: an anonymised other member makes the conversation read-only: the SAME refusal');
reset role;
select tests.as_tenant(tests.d38('02'), tests.d38('b1'));
select is(tests.send38(tests.d38('02'), tests.d38('e1'), tests.d38('b1')), 'DM001:direct_closed',
  'D-722: social off for the ROW''s tenant refuses with the SAME refusal');
reset role;
select is(tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), tests.d38('a6'), 'staff'),
  'DM001:direct_closed', 'D-482: a staff side insert into a paired row is refused DM001 even with the pair open (owner, so no policy stands in the way)');
select results_eq(
  $$ select id::text, last_seq::int from public.chat_conversations
      where id in (tests.d38('d3'), tests.d38('d4'), tests.d38('d7'), tests.d38('d8'), tests.d38('d9'), tests.d38('e1')) order by id $$,
  $$ values (tests.d38('d3')::text, 0), (tests.d38('d4')::text, 0), (tests.d38('d7')::text, 0), (tests.d38('d8')::text, 0),
            (tests.d38('d9')::text, 0), (tests.d38('e1')::text, 0) $$,
  'D-722: no refused send consumed a seq (last_seq of every closed pair is 0)');
select is(
  (select last_seq::int from public.chat_conversations where id = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2'))), 2,
  'D-722: the refused staff insert did not consume a seq on the open pair either (still 2)');
select is(
  (select count(*)::int from public.chat_messages where conversation_id in
     (tests.d38('d3'), tests.d38('d4'), tests.d38('d7'), tests.d38('d8'), tests.d38('d9'), tests.d38('e1'))), 0,
  'D-722: no refused send left a message row');
-- the positive control that the refusals are about the pair and not the lane: lifting every cause reopens each pair.
delete from public.member_blocks where tenant_id = tests.d38('01');
update public.memberships set blocked_at = null where tenant_id = tests.d38('01') and user_id = tests.d38('a7');
update public.memberships set deleted_at = null where tenant_id = tests.d38('01') and user_id = tests.d38('a8');
select tests.as_tenant(tests.d38('01'), tests.d38('a1'));
select is(tests.send38(tests.d38('01'), tests.d38('d3'), tests.d38('a1')), 'ok',
  'D-721: once the member block is lifted the same pair accepts the send again (seq 1)');
select is(tests.send38(tests.d38('01'), tests.d38('d7'), tests.d38('a1')), 'ok',
  'D-721: once the administrator unblocks, the conversation returns to sending');
select is(tests.send38(tests.d38('01'), tests.d38('d8'), tests.d38('a1')), 'ok',
  'D-721: …and so does a restored removed member');
reset role;
select results_eq(
  $$ select id::text, last_seq::int from public.chat_conversations
      where id in (tests.d38('d3'), tests.d38('d7'), tests.d38('d8')) order by id $$,
  $$ values (tests.d38('d3')::text, 1), (tests.d38('d7')::text, 1), (tests.d38('d8')::text, 1) $$,
  'D-722: the first accepted send after the refusals takes seq 1 (the refusals burned none)');

-- ── 3. unpaired untouched ──────────────────────────────────────────────────────────────────────
-- A bare direct (both pair columns null) in tenant B, where `social` is OFF, still accepts and numbers a message.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values (tests.d38('e3'), tests.d38('02'), 'direct', tests.d38('b1'));
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  (tests.d38('e3'), tests.d38('02'), tests.d38('b1'), 'member'),
  (tests.d38('e3'), tests.d38('02'), tests.d38('b3'), 'member');
select tests.as_tenant(tests.d38('02'), tests.d38('b1'));
select is(tests.send38(tests.d38('02'), tests.d38('e3'), tests.d38('b1')), 'ok',
  'RESEARCH finding 5: a bare direct in a tenant WITHOUT social still accepts a message');
reset role;
select results_eq(
  $$ select m.seq::int, c.last_seq::int from public.chat_messages m
       join public.chat_conversations c on c.id = m.conversation_id
      where m.conversation_id = tests.d38('e3') $$,
  $$ values (1, 1) $$,
  'RESEARCH finding 5: …and numbers it (seq 1)');
select results_eq(
  $$ select user_id::text, last_read_seq::int from public.chat_participants
      where conversation_id = tests.d38('e3') order by user_id $$,
  $$ values (tests.d38('b1')::text, 0), (tests.d38('b3')::text, 0) $$,
  'D-728: an unpaired row does not touch participant rows (the shipped path)');

-- ── 4. the signals ─────────────────────────────────────────────────────────────────────────────
-- Everything above inserted at now(), so each topic's rows are read as the migration role. 'on' only when a Realtime
-- partition covers now() (152's rule: Realtime evidence never passes vacuously).
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
-- A support case of a4 and one staff reply (the shipped support branch), written as the table owner.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values (tests.d38('f1'), tests.d38('01'), 'support', tests.d38('a4'));
insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
values (tests.d38('f1'), tests.d38('01'), tests.d38('a4'), 'member');
select is(tests.send38(tests.d38('01'), tests.d38('f1'), tests.d38('a5'), 'staff', 'resposta'), 'ok',
  'the shipped support path: a staff reply to a support case is still accepted');
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$select (payload->>'seq')::int
       from realtime.messages
      where topic = 'tenant:' || tests.d38('01')::text || ':user:' || tests.d38('a2')::text
        and event = 'chat.unread'
        and payload->>'conversationId' = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2'))::text
      order by 1$$,
  ARRAY[1],
  'D-719/D-728: the recipient of the first message gets exactly one chat.unread (seq 1) on its own user topic'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$select (payload->>'seq')::int
       from realtime.messages
      where topic = 'tenant:' || tests.d38('01')::text || ':user:' || tests.d38('a1')::text
        and event = 'chat.unread'
        and payload->>'conversationId' = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2'))::text
      order by 1$$,
  ARRAY[2],
  'D-719/D-728: the author never signals itself: a1''s user topic holds only the reply''s chat.unread (seq 2)'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$select (payload->>'seq')::int
       from realtime.messages
      where topic = 'tenant:' || tests.d38('01')::text || ':conv:' || tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2'))::text
        and event = 'chat.message'
      order by 1$$,
  ARRAY[1, 2],
  'D-719: the chat.message signal on the conv: topic is unchanged (one per insert, in seq order)'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$select distinct array(select jsonb_object_keys(payload) order by 1)
       from realtime.messages
      where payload->>'conversationId' = tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2'))::text$$,
  $$ values (array['conversationId', 'id', 'seq']) $$,
  'T-07-53: every signal of the pair carries exactly conversationId, id, seq (no body, no name, no pair)'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$select distinct topic
       from realtime.messages
      where event = 'chat.unread'
        and payload->>'conversationId' = tests.d38('f1')::text$$,
  ARRAY['tenant:' || tests.d38('01')::text || ':user:' || tests.d38('a4')::text],
  'D-237 kept: a support staff reply still signals only the member''s user topic'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$select count(*)::int
       from realtime.messages
      where event = 'chat.unread'
        and payload->>'conversationId' = tests.d38('e3')::text$$,
  ARRAY[0],
  'RESEARCH finding 5: a bare unpaired direct signals nothing to any user topic'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;

-- ── 5. the notice definer ──────────────────────────────────────────────────────────────────────
-- The facts a direct push needs, readable by the notifications worker (the zero system user) and nobody else.
create function tests.msg38(p_conv uuid, p_seq int) returns uuid language sql security definer as
  $$ select id from public.chat_messages where conversation_id = p_conv and seq = p_seq $$;
-- the membership trigger already created each profile row: name the two writers.
update public.member_profiles
   set display_name = case user_id when tests.d38('a1') then 'Ana Um' else 'Bia Dois' end
 where tenant_id = tests.d38('01') and user_id in (tests.d38('a1'), tests.d38('a2'));
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds)
values ('1e380000-0000-4000-8000-000000000f01', tests.d38('01'), tests.d38('a1'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7);
-- a voice message of a1 into the (open) pair, written as the table owner: it takes seq 3.
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
values (tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), tests.d38('a1'), 'member', null,
        '1e380000-0000-4000-8000-000000000f01', 7);

select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select results_eq(
  $$ select recipient_user_id::text, writer_user_id::text, writer_name, body, voice_seconds, voice_gone, deliverable
       from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1)) $$,
  $$ values (tests.d38('a2')::text, tests.d38('a1')::text, 'Ana Um'::text, 'oi'::text, null::int, false, true) $$,
  'D-728: the worker reads a text message: the recipient is the OTHER participant, the writer, its profile name, the body');
select results_eq(
  $$ select recipient_user_id::text, writer_user_id::text, writer_name
       from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 2)) $$,
  $$ values (tests.d38('a1')::text, tests.d38('a2')::text, 'Bia Dois'::text) $$,
  'D-728: the reply flips recipient and writer');
select results_eq(
  $$ select body, voice_seconds, voice_gone, deliverable
       from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 3)) $$,
  $$ values (null::text, 7, false, true) $$,
  'D-728: a voice message answers no body, the stored length and voice_gone false');
reset role;
update public.media_assets set deleted_at = now() where id = '1e380000-0000-4000-8000-000000000f01';
select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select voice_gone from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 3))),
  true, 'D-868: once the recording''s asset is soft-deleted, voice_gone is true');
reset role;

-- T-11-08: `deliverable` is recomputed from the live pair every time it is asked.
insert into public.member_blocks (tenant_id, blocker_user_id, blocked_user_id) values (tests.d38('01'), tests.d38('a2'), tests.d38('a1'));
select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select deliverable from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1))),
  false, 'T-11-08: a block either way makes the message undeliverable (the row is still answered)');
reset role;
delete from public.member_blocks where tenant_id = tests.d38('01');
update public.memberships set blocked_at = now() where tenant_id = tests.d38('01') and user_id = tests.d38('a2');
select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select deliverable from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1))),
  false, 'T-11-08: an administrator-blocked participant makes it undeliverable');
reset role;
update public.memberships set blocked_at = null where tenant_id = tests.d38('01') and user_id = tests.d38('a2');
update public.tenant_modules set enabled = false where tenant_id = tests.d38('01') and module_key = 'social';
select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select deliverable from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1))),
  false, 'T-11-08: social off makes it undeliverable');
reset role;
update public.tenant_modules set enabled = true where tenant_id = tests.d38('01') and module_key = 'social';
select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select deliverable from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1))),
  true, 'positive control: with every cause lifted the same message is deliverable again');

-- zero rows: not a paired direct, not this tenant, not a message, a deleted message.
select is(
  (select count(*)::int from app.direct_message_notice(tests.msg38(tests.d38('f1'), 1))), 0,
  'D-728: a message of a support case answers zero rows');
select is(
  (select count(*)::int from app.direct_message_notice(tests.msg38(tests.d38('e3'), 1))), 0,
  'T-11-01: another tenant''s message (a bare direct of tenant B) answers zero rows under a tenant A claim');
select is(
  (select count(*)::int from app.direct_message_notice('1e380000-0000-4000-8000-000000000999')), 0,
  'D-728: an unknown id answers zero rows');
reset role;
select tests.as_tenant(tests.d38('02'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select count(*)::int from app.direct_message_notice(tests.msg38(tests.d38('e3'), 1))), 0,
  'D-728: a bare direct of the claim''s own tenant answers zero rows (only a PAIRED direct is answered)');
reset role;
update public.chat_messages set deleted_at = now() where id = tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1);
select tests.as_tenant(tests.d38('01'), '00000000-0000-0000-0000-000000000000'::uuid, 'support_tenant');
select is(
  (select count(*)::int from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 1))), 0,
  'D-728: a deleted message answers zero rows');
reset role;

-- T-11-02: every caller that is not the zero system user is refused 42501, whatever its role.
select tests.as_tenant(tests.d38('01'), tests.d38('a1'));
select throws_ok(
  $$ select * from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 2)) $$,
  '42501', null, 'T-11-02: a member lane is refused 42501');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a6'), 'admin_tenant');
select throws_ok(
  $$ select * from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 2)) $$,
  '42501', null, 'T-11-02: an administrator is refused 42501');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a5'), 'support_tenant');
select throws_ok(
  $$ select * from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 2)) $$,
  '42501', null, 'T-11-02: a support member is refused 42501');
reset role;
select tests.as_tenant_without_claims();
select throws_ok(
  $$ select * from app.direct_message_notice(tests.msg38(tests.pair38(tests.d38('01'), tests.d38('a1'), tests.d38('a2')), 2)) $$,
  '42501', null, 'T-11-02: a lane with no claims is refused 42501');
reset role;
select ok(
  not has_function_privilege('anon', 'app.direct_message_notice(uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.direct_message_notice(uuid)', 'execute'),
  'T-11-02: anon cannot execute the notice; the worker''s authenticated lane can (the zero-user guard is the gate)');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'app.direct_message_notice(uuid)'::regprocedure),
  'the notice is a security definer that pins search_path');

-- Plan 07 fixture: eight more members of tenant A (`c1`..`c8`), a third tenant (`03`, social on) where `c1`, `c2`, `c4` and
-- `c5` also hold a membership, so the same two users exist in two tenants with `social` on.
select tests.tenant('pgtap-block-c', 'Bloqueio C', tests.d38('03'));
select tests.auth_user('c1@block-a.local', tests.d38('c1'));
select tests.auth_user('c2@block-a.local', tests.d38('c2'));
select tests.auth_user('c3@block-a.local', tests.d38('c3'));
select tests.auth_user('c4@block-a.local', tests.d38('c4'));
select tests.auth_user('c5@block-a.local', tests.d38('c5'));
select tests.auth_user('c6@block-a.local', tests.d38('c6'));
select tests.auth_user('c7@block-a.local', tests.d38('c7'));
select tests.auth_user('c8@block-a.local', tests.d38('c8'));
select tests.member(tests.d38('01'), tests.d38('c1'));
select tests.member(tests.d38('01'), tests.d38('c2'));
select tests.member(tests.d38('01'), tests.d38('c3'));
select tests.member(tests.d38('01'), tests.d38('c4'));
select tests.member(tests.d38('01'), tests.d38('c5'));
select tests.member(tests.d38('01'), tests.d38('c6'));
select tests.member(tests.d38('01'), tests.d38('c7'));
select tests.member(tests.d38('01'), tests.d38('c8'));
select tests.member(tests.d38('03'), tests.d38('c1'));
select tests.member(tests.d38('03'), tests.d38('c2'));
select tests.member(tests.d38('03'), tests.d38('c4'));
select tests.member(tests.d38('03'), tests.d38('c5'));
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  (tests.d38('03'), 'social', true),
  (tests.d38('03'), 'chat', true);
-- Follow rows seeded as the table owner (the policy is exercised in section 8): c1 and c2 follow each other in tenants
-- A and C, c1 follows c3 and c3 follows c2 in tenant A (the survivors).
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  (tests.d38('01'), tests.d38('c1'), tests.d38('c2')),
  (tests.d38('01'), tests.d38('c2'), tests.d38('c1')),
  (tests.d38('01'), tests.d38('c1'), tests.d38('c3')),
  (tests.d38('01'), tests.d38('c3'), tests.d38('c2')),
  (tests.d38('03'), tests.d38('c1'), tests.d38('c2')),
  (tests.d38('03'), tests.d38('c2'), tests.d38('c1'));
create function tests.follows38(p_tenant uuid, p_a uuid, p_b uuid) returns int language sql security definer as
  $$ select count(*)::int from public.social_follows
      where tenant_id = p_tenant
        and ((follower_user_id = p_a and followee_user_id = p_b) or (follower_user_id = p_b and followee_user_id = p_a)) $$;

-- ── 6. the block clears the follows both ways and keeps the conversation ─────────────────────────
select tests.as_tenant(tests.d38('01'), tests.d38('c1'));
select is(
  (select created from app.direct_conversation_open(tests.d38('c2'))), true,
  'CHAT-07: the pair c1/c2 opens its direct before the block');
select is(tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), tests.d38('c1')), 'ok',
  'CHAT-07: c1 sends the first message');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c2'));
select is(tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), tests.d38('c2')), 'ok',
  'CHAT-07: c2 replies');
reset role;
select is(tests.follows38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), 2,
  'D-724 (before): c1 and c2 follow each other in tenant A');
select tests.as_tenant(tests.d38('01'), tests.d38('c1'));
select is(app.member_block_create(tests.d38('c2')), true, 'D-724: c1 blocks c2 and the call answers true (this call made the block)');
reset role;
select is(tests.follows38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), 0,
  'D-724: the block deleted BOTH follow rows between c1 and c2 (the caller''s and the blocked member''s)');
select results_eq(
  $$ select follower_user_id::text, followee_user_id::text from public.social_follows
      where tenant_id = tests.d38('01') order by follower_user_id $$,
  $$ values (tests.d38('c1')::text, tests.d38('c3')::text), (tests.d38('c3')::text, tests.d38('c2')::text) $$,
  'T-11-21: only the two rows between the pair went; c1 -> c3 and c3 -> c2 survive');
select is(tests.follows38(tests.d38('03'), tests.d38('c1'), tests.d38('c2')), 2,
  'T-11-01: the same two users keep both follow rows in tenant C');
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2'))), 1,
  'D-723: the conversation is not deleted');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2'))), 2,
  'D-723: both messages are intact');
select is(
  (select count(*)::int from public.chat_participants where conversation_id = tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2'))), 2,
  'D-723: both participant rows are intact');
select tests.as_tenant(tests.d38('01'), tests.d38('c1'));
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2'))), 2,
  'D-723: the blocker still reads the whole history');
select is(tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), tests.d38('c1')), 'DM001:direct_closed',
  'D-722: the composer closes for the blocker (the send guard)');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c2'));
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2'))), 2,
  'D-723: the blocked member still reads the whole history');
select is(tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), tests.d38('c2')), 'DM001:direct_closed',
  'D-722: the composer closes for the blocked member with the SAME refusal');
reset role;
select ok(
  (select position('for update' in lower(prosrc)) > 0
      and position('for update' in lower(prosrc)) < position('insert into public.member_blocks' in lower(prosrc))
      and position('insert into public.member_blocks' in lower(prosrc)) < position('delete from public.social_follows' in lower(prosrc))
    from pg_proc where oid = 'app.member_block_create(uuid)'::regprocedure),
  'T-11-04: the body takes the pair''s conversation lock (for update) BEFORE it writes the block, and deletes the follows after');

-- ── 7. empty, idempotency, unblock ─────────────────────────────────────────────────────────────
select tests.as_tenant(tests.d38('01'), tests.d38('c6'));
select is(app.member_block_create(tests.d38('c7')), true,
  'CHAT-07 (empty): blocking a member with no follow and no conversation answers true, no error');
reset role;
select is(
  (select count(*)::int from public.chat_conversations
    where tenant_id = tests.d38('01') and direct_low_user_id = tests.d38('c6') and direct_high_user_id = tests.d38('c7')), 0,
  'CHAT-07 (empty): no conversation was created by the block');
select is((select count(*)::int from public.social_follows where tenant_id = tests.d38('01')), 2,
  'CHAT-07 (empty): the block deleted zero follow rows (the two survivors of section 6 are all that is left)');
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
  values (tests.d38('01'), tests.d38('c7'), tests.d38('c6'));
select tests.as_tenant(tests.d38('01'), tests.d38('c6'));
select is(app.member_block_create(tests.d38('c7')), false,
  'CHAT-07 (idempotency): the second call answers false (the row existed)');
reset role;
select is(tests.follows38(tests.d38('01'), tests.d38('c6'), tests.d38('c7')), 0,
  'CHAT-07 (idempotency): the second call still clears a follow row that reappeared out of band');
select is((select count(*)::int from public.member_blocks where tenant_id = tests.d38('01') and blocker_user_id = tests.d38('c6')), 1,
  'CHAT-07 (idempotency): one block row after two calls');
select tests.as_tenant(tests.d38('01'), tests.d38('c1'));
select is(app.member_block_delete(tests.d38('c2')), true, 'D-724: c1 lifts the block');
reset role;
select is(tests.follows38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), 0,
  'D-724: unblocking restores nothing, the two follow rows stay deleted');
select tests.as_tenant(tests.d38('01'), tests.d38('c1'));
select is(tests.send38(tests.d38('01'), tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2')), tests.d38('c1'), 'member', 'volta'), 'ok',
  'D-722: unblocking reopens the pair (the composer-facing facts reopen)');
reset role;
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair38(tests.d38('01'), tests.d38('c1'), tests.d38('c2'))), 3,
  'D-723: the history held two messages through the block and now three');

-- ── 8. the follow insert policy across a block (plan 07 task 2) ─────────────────────────────────
-- Inserts ONE follow as the CURRENT lane and answers 'ok' or '<sqlstate>:<message>', so the refusal across a block can be
-- compared with the refusal of an unknown target (T-11-03: the blocked side learns nothing from the failure).
create function tests.fol38(p_tenant uuid, p_follower uuid, p_followee uuid) returns text language plpgsql as $$
begin
  insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values (p_tenant, p_follower, p_followee);
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end
$$;
select tests.as_tenant(tests.d38('01'), tests.d38('c4'));
select is(app.member_block_create(tests.d38('c5')), true, 'D-724 (setup): c4 blocks c5');
select is(left(tests.fol38(tests.d38('01'), tests.d38('c4'), tests.d38('c5')), 6), '42501:',
  'D-724: the BLOCKER following the blocked member is refused 42501');
select is(tests.fol38(tests.d38('01'), tests.d38('c4'), tests.d38('c5')), tests.fol38(tests.d38('01'), tests.d38('c4'), tests.d38('ff')),
  'T-11-03: the refusal across a block is the SAME failure as a follow toward an unknown target');
select is(tests.fol38(tests.d38('01'), tests.d38('c4'), tests.d38('c3')), 'ok',
  'D-724 (control): the blocker follows a third member while the block stands');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c5'));
select is(left(tests.fol38(tests.d38('01'), tests.d38('c5'), tests.d38('c4')), 6), '42501:',
  'D-724: the BLOCKED member following the blocker is refused 42501 from the other side');
select is(tests.fol38(tests.d38('01'), tests.d38('c5'), tests.d38('c3')), 'ok',
  'D-724 (control): the blocked member follows a third member');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c3'));
select is(tests.fol38(tests.d38('01'), tests.d38('c3'), tests.d38('c4')), 'ok',
  'D-724 (control): a third member follows the blocker, the block touches only the pair');
reset role;
select tests.as_tenant(tests.d38('03'), tests.d38('c4'));
select is(tests.fol38(tests.d38('03'), tests.d38('c4'), tests.d38('c5')), 'ok',
  'T-11-01: the same two users follow in tenant C, a block in tenant A refuses nothing there');
reset role;
select tests.as_tenant(tests.d38('03'), tests.d38('c5'));
select is(tests.fol38(tests.d38('03'), tests.d38('c5'), tests.d38('c4')), 'ok',
  'T-11-01: …and the other direction in tenant C');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c4'));
select is(app.member_block_delete(tests.d38('c5')), true, 'D-724: c4 lifts the block');
select is(tests.fol38(tests.d38('01'), tests.d38('c4'), tests.d38('c5')), 'ok',
  'D-724: once the block is lifted the follow is accepted again');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c5'));
select is(tests.fol38(tests.d38('01'), tests.d38('c5'), tests.d38('c4')), 'ok',
  'D-724: …and from the other side');
reset role;

-- ── 9. the preserved Phase 13 behaviours of the replaced definer (plan 07 task 3) ───────────────
-- Calls the definer as the CURRENT lane and answers 'true' / 'false' or the SQLSTATE, so one assertion pins each refusal.
create function tests.blk38(p_target uuid) returns text language plpgsql as $$
begin
  return app.member_block_create(p_target)::text;
exception when others then
  return sqlstate;
end
$$;
-- an administrator-blocked target (a7) and a removed target (a8); a8 also serves as a removed CALLER below.
update public.memberships set blocked_at = now() where tenant_id = tests.d38('01') and user_id = tests.d38('a7');
update public.memberships set deleted_at = now() where tenant_id = tests.d38('01') and user_id = tests.d38('a8');
select tests.as_tenant(tests.d38('01'), tests.d38('c3'));
select is(tests.blk38(null), 'BL001', 'preserved: a null target is BL001');
select is(tests.blk38(tests.d38('c3')), 'BL001', 'preserved: the caller as target is BL001');
select is(tests.blk38(tests.d38('a6')), 'BL001', 'preserved (AD-1): an administrator target is BL001');
select is(tests.blk38(tests.d38('a5')), 'BL001', 'preserved (AD-1): a support target is BL001');
select is(tests.blk38(tests.d38('a8')), 'BL001', 'preserved: a removed target is BL001');
select is(tests.blk38(tests.d38('a7')), 'BL001', 'preserved: an administrator-blocked target is BL001');
select is(tests.blk38(tests.d38('b1')), 'BL001', 'preserved (T-11-01): another tenant''s member is BL001');
select is(tests.blk38(tests.d38('ff')), 'BL001', 'preserved: an unknown target is BL001, the same code as every other cause');
reset role;
select tests.as_tenant_without_claims();
select is(tests.blk38(tests.d38('c8')), '42501', 'preserved: a lane with no claims is refused 42501');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a8'));
select is(tests.blk38(tests.d38('c8')), '42501', 'preserved: a removed caller is refused 42501');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a7'));
select is(tests.blk38(tests.d38('c8')), '42501', 'preserved: an administrator-blocked caller is refused 42501');
reset role;
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] and prorettype = 'boolean'::regtype
     from pg_proc where oid = 'app.member_block_create(uuid)'::regprocedure),
  'preserved: the block definer is a security definer, pins an empty search_path and still returns boolean');
select ok(not has_function_privilege('anon', 'app.member_block_create(uuid)', 'execute'),
  'preserved: anon cannot execute the block definer');
select ok(has_function_privilege('authenticated', 'app.member_block_create(uuid)', 'execute'),
  'preserved: authenticated can execute the block definer');
select tests.as_tenant(tests.d38('01'), tests.d38('c3'));
select is(tests.blk38(tests.d38('c8')), 'true', 'preserved: the first block answers true');
select is(tests.blk38(tests.d38('c8')), 'false', 'preserved: the second block answers false (idempotent)');
select is((select count(*)::int from public.member_blocks where blocker_user_id = tests.d38('c3') and blocked_user_id = tests.d38('c8')), 1,
  'preserved (T-11-03, positive control): the blocker reads their one block row');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c8'));
select is((select count(*)::int from public.member_blocks), 0,
  'T-11-03: the blocked member reads no member_blocks row at all');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('c1'));
select is((select count(*)::int from public.member_blocks), 0, 'T-11-03: a third member reads no member_blocks row');
reset role;
select tests.as_tenant(tests.d38('01'), tests.d38('a6'), 'admin_tenant');
select is((select count(*)::int from public.member_blocks), 0, 'T-11-03: the administrator reads no member_blocks row');
reset role;

select * from finish();
rollback;
