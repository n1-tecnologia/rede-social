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
-- 3. THE LANE CANNOT CREATE (task 2, CHAT-06, D-720; T-11-05): a tenant lane inserting a `direct` row is refused 42501,
--    a `support` insert beside it is still accepted (the positive control), and no lane enrols a participant into a direct.
--
-- 4. THE READABLE POLICY (task 2, D-721, D-482, D-483, D-800; T-11-01, T-11-02): the two participants read the row and its
--    messages; a third member, `support_tenant`, `admin_tenant` and tenant B do not; `social` off hides it and turning it
--    on returns it unchanged; an administrator-blocked, removed or still-pending-deletion other member hides it from the
--    OTHER participant and lifting the block returns it; an anonymised other member keeps it readable; the 12.4 case
--    triggers leave it alone.
--
-- Fixture ids use the `1e370000-…` prefix (`tests.d37('a1')` spells one). Like its siblings, this file ROLLS BACK.
select plan(52);

create function tests.d37(p text) returns uuid language sql immutable as
  $$ select ('1e370000-0000-4000-8000-0000000000' || p)::uuid $$;
-- The id of a paired direct, read as the table owner (RLS never hides it from this helper).
create function tests.pair37(p_tenant uuid, p_low uuid, p_high uuid) returns uuid language sql security definer as
  $$ select id from public.chat_conversations
      where tenant_id = p_tenant and direct_low_user_id = p_low and direct_high_user_id = p_high $$;

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

-- ── 3. the lane cannot create ──────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from public.chat_case_counters where tenant_id = tests.d37('01')), 0,
  'D-800: before any support case exists the tenant has no case counter row (the direct created nothing)');
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a1'), tests.d37('a1'), tests.d37('a3')) $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-11-05: a member lane inserting a paired direct row is refused 42501');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values (tests.d37('01'), 'direct', tests.d37('a1')) $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-11-05: a member lane inserting a bare direct row is refused 42501 too');
select throws_ok(
  $$ insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
     values (tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2')), tests.d37('01'), tests.d37('a3'), 'member') $$,
  '42501', 'new row violates row-level security policy for table "chat_participants"',
  'T-11-05: the creator enrolling ANOTHER member into the direct is refused 42501');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a4'));
select throws_ok(
  $$ insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
     values (tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2')), tests.d37('01'), tests.d37('a4'), 'member') $$,
  '42501', 'new row violates row-level security policy for table "chat_participants"',
  'T-11-05: a third member enrolling ITSELF into a direct it did not create is refused 42501');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a3'));
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values (tests.d37('01'), 'support', tests.d37('a3')) $$,
  'positive control: the same lane still creates its own support conversation');
reset role;

-- ── 4. the readable policy ─────────────────────────────────────────────────────────────────────
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: the first participant reads the paired direct');
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values (tests.d37('01'), tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2')), tests.d37('a1'), 'member', 'oi') $$,
  'the first participant writes a message in the direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: the first participant reads the message');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a2'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: the other participant reads the paired direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: the other participant reads the message');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a4'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'T-11-02: a third member of the tenant does not read the paired direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'T-11-02: a third member does not read its messages');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a5'), 'support_tenant');
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-482/T-11-02: support_tenant does not read a paired direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-482/T-11-02: support_tenant does not read its messages');
select is(
  (select count(*)::int from public.chat_conversations where kind = 'support'), 1,
  'positive control: support_tenant still reads the support conversation of the tenant');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a6'), 'admin_tenant');
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-482/T-11-02: admin_tenant does not read a paired direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-482/T-11-02: admin_tenant does not read its messages');
reset role;
-- tenant B: the same two user ids reach nothing of tenant A, and open a pair of their own beside it.
select tests.as_tenant(tests.d37('02'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'T-11-01: the same user id with a tenant B claim does not read tenant A''s direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'T-11-01: …nor its messages');
select is(
  (select conversation_id from app.direct_conversation_open(tests.d37('a2'))),
  tests.pair37(tests.d37('02'), tests.d37('a1'), tests.d37('a2')),
  'T-11-01: the same two users reach tenant B''s OWN conversation (the one section 2 stored), one per tenant');
select is(
  (select count(*)::int from public.chat_conversations where kind = 'direct'), 1,
  'positive control: in tenant B the user reads exactly its own tenant B direct');
reset role;
select isnt(
  tests.pair37(tests.d37('02'), tests.d37('a1'), tests.d37('a2')), tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2')),
  'T-11-01: the two tenants hold two different conversations for the same two users');

-- D-483: social off hides the pair, nothing is deleted, and turning it back on returns it unchanged.
update public.tenant_modules set enabled = false where tenant_id = tests.d37('01') and module_key = 'social';
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-483: with social off the first participant no longer reads the direct');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-483: …nor its messages');
reset role;
select tests.as_tenant(tests.d37('01'), tests.d37('a2'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-483: with social off the other participant no longer reads it either');
reset role;
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-483: nothing was deleted: the message is still in the table');
update public.tenant_modules set enabled = true where tenant_id = tests.d37('01') and module_key = 'social';
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select results_eq(
  $$ select c.last_seq::int, (select count(*)::int from public.chat_messages m where m.conversation_id = c.id)
       from public.chat_conversations c where c.id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2')) $$,
  $$ values (1, 1) $$,
  'D-483: turning social back on returns the direct and its message unchanged');
reset role;

-- D-721: an administrator block hides the pair from the OTHER participant and lifting it returns the pair whole.
update public.memberships set blocked_at = now() where tenant_id = tests.d37('01') and user_id = tests.d37('a2');
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-721: a member the administrator blocked (blocked_at) hides the direct from the other participant');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-721: …and its messages');
reset role;
update public.memberships set blocked_at = null where tenant_id = tests.d37('01') and user_id = tests.d37('a2');
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: clearing the block returns the direct to the other participant');
reset role;
update public.memberships set status = 'blocked' where tenant_id = tests.d37('01') and user_id = tests.d37('a2');
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-721: status blocked hides the direct from the other participant');
reset role;
update public.memberships set status = 'active' where tenant_id = tests.d37('01') and user_id = tests.d37('a2');
update public.memberships set deleted_at = now() where tenant_id = tests.d37('01') and user_id = tests.d37('a2');
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-721: a removed member (deleted_at set, not anonymised) hides the direct from the other participant');
reset role;
-- an anonymised account stays readable: the same row once the deletion request has run its course.
update public.memberships
   set deletion_requested_at = now() - interval '2 days', deletion_due_at = now() - interval '1 day', anonymised_at = now()
 where tenant_id = tests.d37('01') and user_id = tests.d37('a2');
select tests.as_tenant(tests.d37('01'), tests.d37('a1'));
select is(
  (select count(*)::int from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: an anonymised other member keeps the direct readable (read-only history)');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 1,
  'D-721: …and its messages');
reset role;

-- D-800: the two 12.4 triggers (defaults and number) left the paired direct alone.
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2'))), 0,
  'D-800: a paired direct has no case event');
select results_eq(
  $$ select case_number is null, state is null, owner_user_id is null, category is null, priority is null
       from public.chat_conversations where id = tests.pair37(tests.d37('01'), tests.d37('a1'), tests.d37('a2')) $$,
  $$ values (true, true, true, true, true) $$,
  'D-800: a paired direct has no number, state, owner, category or priority');
select is(
  (select last_number from public.chat_case_counters where tenant_id = tests.d37('01')), 1,
  'D-800: the tenant counter moved only for the one support case, never for the direct');

select * from finish();
rollback;
