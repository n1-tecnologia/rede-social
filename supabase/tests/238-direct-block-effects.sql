begin;
-- 238-direct-block-effects.sql — Phase 11 plan 06 (CHAT-06, CHAT-07; D-719, D-721, D-722, D-728; T-11-01, T-11-02, T-11-03,
-- T-11-04, T-11-08), executed inside Postgres. The send path of a direct conversation in the database. Plan 07 appends the
-- effects of a block itself (sections 6 and up).
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
-- Fixture ids use the `1e380000-…` prefix (`tests.d38('a1')` spells one). Like its siblings, this file ROLLS BACK.
select plan(25);

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

select * from finish();
rollback;
