begin;
-- 237-direct-conversations.sql — Phase 11 plan 03 (CHAT-06; D-719, D-720, D-721, D-482, D-483, D-800; T-11-01, T-11-02,
-- T-11-03, T-11-05, T-11-19), executed inside Postgres. The database half of a direct conversation.
--
-- 1. THE PATH (task 1, CHAT-06, D-720): two live members open ONE conversation through `app.direct_conversation_open`,
--    from either side, both enrolled, the pair stored in uuid order.
--
-- 2. UNIQUENESS (task 1, D-720, CHAT-07 encoding): the partial unique index, the two CHECKs, and the bare direct that
--    carries no pair (the fixtures of 152, 235 and 236) still accepted.
--
-- Fixture ids use the `1e370000-…` prefix (`tests.d37('a1')` spells one). Like its siblings, this file ROLLS BACK.
select plan(14);

create function tests.d37(p text) returns uuid language sql immutable as
  $$ select ('1e370000-0000-4000-8000-0000000000' || p)::uuid $$;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- Tenant A (`01`) and tenant B (`02`). a1 < a2 < a3 < a4 in uuid byte order. a1 and a2 also belong to tenant B.
select tests.tenant('pgtap-direct-a', 'Direto A', tests.d37('01'));
select tests.tenant('pgtap-direct-b', 'Direto B', tests.d37('02'));
select tests.auth_user('m1@direct-a.local', tests.d37('a1'));
select tests.auth_user('m2@direct-a.local', tests.d37('a2'));
select tests.auth_user('m3@direct-a.local', tests.d37('a3'));
select tests.auth_user('m4@direct-a.local', tests.d37('a4'));
select tests.auth_user('support@direct-a.local', tests.d37('a5'));
select tests.auth_user('admin@direct-a.local', tests.d37('a6'));
select tests.auth_user('m3@direct-b.local', tests.d37('b3'));
select tests.member(tests.d37('01'), tests.d37('a1'));
select tests.member(tests.d37('01'), tests.d37('a2'));
select tests.member(tests.d37('01'), tests.d37('a3'));
select tests.member(tests.d37('01'), tests.d37('a4'));
select tests.member(tests.d37('01'), tests.d37('a5'), 'support_tenant');
select tests.member(tests.d37('01'), tests.d37('a6'), 'admin_tenant');
select tests.member(tests.d37('02'), tests.d37('a1'));
select tests.member(tests.d37('02'), tests.d37('a2'));
select tests.member(tests.d37('02'), tests.d37('b3'));
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  (tests.d37('01'), 'social', true),
  (tests.d37('01'), 'chat', true),
  (tests.d37('02'), 'social', true),
  (tests.d37('02'), 'chat', true);

-- ── 1. the path ────────────────────────────────────────────────────────────────────────────────
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select created from app.direct_conversation_open(tests.d37('a2'))), true,
  'CHAT-06/D-720: the first call for a pair creates the conversation (created = true)');
reset role;
select results_eq(
  $$ select kind, direct_low_user_id::text, direct_high_user_id::text, created_by_user_id::text,
            last_seq::int, last_staff_seq::int, staff_last_read_seq::int, case_number is null, state is null
       from public.chat_conversations
      where tenant_id = tests.d37('01') and kind = 'direct' $$,
  $$ values ('direct'::text, tests.d37('a1')::text, tests.d37('a2')::text, tests.d37('a1')::text, 0, 0, 0, true, true) $$,
  'D-720: one direct row, the pair in uuid order, the first caller as creator, counters 0, no case columns (D-800)');

select tests.as_tenant(tests.d37('01'), tests.d37('a2'));
select is(
  (select created from app.direct_conversation_open(tests.d37('a1'))), false,
  'D-720: the other member opening the same pair creates nothing (created = false)');
select is(
  (select conversation_id::text from app.direct_conversation_open(tests.d37('a1'))),
  (select id::text from public.chat_conversations where tenant_id = tests.d37('01') and kind = 'direct'),
  'CHAT-07 encoding: the pair opened from the other side answers the SAME conversation id');
reset role;
select results_eq(
  $$ select user_id::text, role from public.chat_participants
      where tenant_id = tests.d37('01') order by user_id $$,
  $$ values (tests.d37('a1')::text, 'member'::text), (tests.d37('a2')::text, 'member'::text) $$,
  'D-720: both users are enrolled as participants with role member, nobody else');

select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select created from app.direct_conversation_open(tests.d37('a2'))), false,
  'D-720: the first caller asking again creates nothing');
reset role;
select is(
  (select count(*)::int from public.chat_conversations where tenant_id = tests.d37('01') and kind = 'direct'),
  1, 'D-720: still exactly one conversation for the pair after three calls from both sides');

-- ── 2. uniqueness ──────────────────────────────────────────────────────────────────────────────
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a2'), tests.d37('a1'), tests.d37('a2')) $$,
  '23505', 'duplicate key value violates unique constraint "chat_conversations_direct_pair_uq"',
  'D-720: a second row for the same pair is refused 23505 on chat_conversations_direct_pair_uq (owner, so no policy stands in the way)');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a3'), tests.d37('a4'), tests.d37('a3')) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_direct_pair_chk"',
  'CHAT-07 encoding: the pair stored with low above high is refused 23514 by chat_conversations_direct_pair_chk');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a3'), tests.d37('a3')) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_direct_pair_chk"',
  'D-720: only one of the two pair columns set is refused 23514');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_high_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a3'), tests.d37('a3')) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_direct_pair_chk"',
  'D-720: only the high pair column set is refused 23514');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id)
     values (tests.d37('01'), 'support', tests.d37('a3'), tests.d37('a3'), tests.d37('a4')) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_direct_pair_kind_chk"',
  'D-720: a support row carrying a pair is refused 23514 by chat_conversations_direct_pair_kind_chk');
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a3')) $$,
  'RESEARCH finding 5: a bare direct with both pair columns null is still accepted (the fixtures of 152, 235 and 236)');
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id)
     values (tests.d37('02'), 'direct', tests.d37('a1'), tests.d37('a1'), tests.d37('a2')) $$,
  'T-11-01: the SAME pair in tenant B is accepted beside tenant A (the index carries the tenant first)');

select * from finish();
rollback;
