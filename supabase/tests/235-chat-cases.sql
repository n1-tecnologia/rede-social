begin;
-- 235-chat-cases.sql — Phase 12.4 plan 01 (CASE-01, CASE-02, CASE-12, CASE-23, CASE-25; D-836, D-837, D-804, D-810;
-- T-12.4-01..05, T-12.4-85), executed inside Postgres. Later plans of the phase append numbered sections.
--
-- 1. THE PATH (plan 01, D-836, D-837, D-810, CASE-01, CASE-02): a support conversation inserted the way the SHIPPED
--    API inserts it (`tenant_id`, `kind`, `created_by_user_id` only, as the member lane) is stored born open with
--    priority normal, category other, case number 1 in a fresh tenant and ONE `opened` event whose actor is the member;
--    the event table's foreign keys cascade with the conversation and set null on the two users; the two trigger
--    functions are definers with an empty search_path that no lane can execute.
--
-- 2. CONSTRAINTS AND POLICIES (plan 01, D-836, D-810, CASE-23, T-12.4-01, T-12.4-03): the allowed values of state,
--    category and priority, the number floor and uniqueness, the support subject bound, the shape and coherence
--    CHECKs (both of which a legacy row with a null state satisfies), the born-open insert policy and the
--    staff-only events policy.
--
-- 3. NUMBERING (plan 01, D-837, D-804, CASE-02, EP-001, EP-003..EP-006, EP-008, T-12.4-04): a skipped
--    `on conflict do nothing` burns nothing, a rolled-back insert leaves no gap, two members of one tenant number
--    consecutively, a third tenant starts again at 1, no counter row exists before the first case, the events index
--    and the integer types.
--
-- 4. DIRECTS, ISOLATION AND THE SHAPE (plan 01, CASE-25, CASE-23, EP-002, EP-082, EP-083, EP-085, EP-086, T-12.4-02,
--    T-12.4-03): direct and group conversations are never numbered, never counted and never given an event; another
--    tenant reads nothing; no lane writes the history; no lane may update a case column.
--
-- 5. LEGACY ROWS (plan 01, B1, T-12.4-85): a support conversation whose case columns are all null still takes a member
--    message and a staff reply, moves its counters as before and writes no event.
--
-- Fixture ids use the `1e350000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(11);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-case-a', 'Chamado A', '1e350000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-case-b', 'Chamado B', '1e350000-0000-4000-8000-000000000002');
select tests.auth_user('m1@case-a.local', '1e350000-0000-4000-8000-0000000000a1');
select tests.auth_user('m2@case-a.local', '1e350000-0000-4000-8000-0000000000a2');
select tests.auth_user('support@case-a.local', '1e350000-0000-4000-8000-0000000000a3');
select tests.auth_user('admin@case-a.local', '1e350000-0000-4000-8000-0000000000a4');
select tests.auth_user('m1@case-b.local', '1e350000-0000-4000-8000-0000000000b1');
select tests.auth_user('support@case-b.local', '1e350000-0000-4000-8000-0000000000b3');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a1');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a2');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a4', 'admin_tenant');
select tests.member('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b1');
select tests.member('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b3', 'support_tenant');

-- ── 1. the path ────────────────────────────────────────────────────────────────────────────────
-- A fresh tenant has no counter row and no event (EP-001, EP-003): the counter appears at the first case.
select is(
  (select count(*)::int from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000001'),
  0, 'EP-001: a tenant with no case has no counter row');

-- The shipped API writes exactly these three columns, as the member lane.
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a1');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c1', '1e350000-0000-4000-8000-000000000001', 'support',
        '1e350000-0000-4000-8000-0000000000a1');
reset role;

select results_eq(
  $$ select state, priority, category, case_number, owner_user_id is null, resolved_at is null, closed_at is null
       from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c1' $$,
  $$ values ('open'::text, 'normal'::text, 'other'::text, 1, true, true, true) $$,
  'D-836/D-837: the shipped insert shape is stored born open, normal, other and numbered 1');

select results_eq(
  $$ select kind, actor_user_id, to_state, from_state
       from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c1' $$,
  $$ values ('opened'::text, '1e350000-0000-4000-8000-0000000000a1'::uuid, 'open'::text, null::text) $$,
  'D-810: exactly one opened event, whose actor is the member and whose to-state is open');

select is(
  (select last_number from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000001'),
  1, 'D-837: the tenant counter row appeared at the first case and holds 1');

-- Checker R-W2: the cascade and the two set-nulls are pinned by catalogue.
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.chat_case_events'::regclass and contype = 'f'
      and confrelid = 'public.chat_conversations'::regclass),
  'c', 'D-836: chat_case_events.conversation_id cascades with the conversation');
select is(
  (select string_agg(confdeltype::text, ',' order by a.attname)
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.chat_case_events'::regclass and c.contype = 'f'
      and c.confrelid = 'public.users'::regclass),
  'n,n', 'D-836: the actor and the target foreign keys to users are ON DELETE SET NULL');

-- T-12.4-05: both trigger functions are definers with an empty search_path that no lane may execute.
select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
     from pg_proc p where p.oid in ('app.chat_conversations_before_insert()'::regprocedure,
                                    'app.chat_conversations_after_insert()'::regprocedure)),
  'T-12.4-05: the defaults and numbering functions are security definers with search_path pinned to ""');
select ok(
  not has_function_privilege('authenticated', 'app.chat_conversations_before_insert()', 'execute')
  and not has_function_privilege('authenticated', 'app.chat_conversations_after_insert()', 'execute')
  and not has_function_privilege('anon', 'app.chat_conversations_after_insert()', 'execute'),
  'T-12.4-05: no lane can execute the trigger functions');
select has_trigger('public', 'chat_conversations', 'chat_conversations_defaults_trg',
  'D-836: chat_conversations carries the BEFORE INSERT defaults trigger');
select has_trigger('public', 'chat_conversations', 'chat_conversations_number_trg',
  'D-837: chat_conversations carries the AFTER INSERT numbering trigger');

-- Deleting the conversation removes its history (the shipped suites delete conversations directly).
delete from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c1';
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c1'),
  0, 'D-836: deleting the conversation cascades to its events');

select * from finish();
rollback;
