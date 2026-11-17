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
select plan(98);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-case-a', 'Chamado A', '1e350000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-case-b', 'Chamado B', '1e350000-0000-4000-8000-000000000002');
select tests.auth_user('m1@case-a.local', '1e350000-0000-4000-8000-0000000000a1');
select tests.auth_user('m2@case-a.local', '1e350000-0000-4000-8000-0000000000a2');
select tests.auth_user('support@case-a.local', '1e350000-0000-4000-8000-0000000000a3');
select tests.auth_user('admin@case-a.local', '1e350000-0000-4000-8000-0000000000a4');
select tests.auth_user('m1@case-b.local', '1e350000-0000-4000-8000-0000000000b1');
select tests.auth_user('support@case-b.local', '1e350000-0000-4000-8000-0000000000b3');
select tests.auth_user('u1@case-a.local', '1e350000-0000-4000-8000-0000000000d1');
select tests.auth_user('u2@case-a.local', '1e350000-0000-4000-8000-0000000000d2');
select tests.auth_user('u3@case-a.local', '1e350000-0000-4000-8000-0000000000d3');
select tests.auth_user('u4@case-a.local', '1e350000-0000-4000-8000-0000000000d4');
select tests.auth_user('u5@case-a.local', '1e350000-0000-4000-8000-0000000000d5');
select tests.auth_user('u6@case-a.local', '1e350000-0000-4000-8000-0000000000d6');
select tests.auth_user('u7@case-a.local', '1e350000-0000-4000-8000-0000000000d7');
select tests.auth_user('u8@case-a.local', '1e350000-0000-4000-8000-0000000000d8');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a1');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a2');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a4', 'admin_tenant');
select tests.member('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b1');
select tests.member('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b3', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d1');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d2');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d3');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d4');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d5');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d6');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d7');
select tests.member('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d8');


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

-- ── 2. constraints and policies ────────────────────────────────────────────────────────────────
-- R1 is the working case of this section (as the shipped insert writes it), R2 becomes the legacy-shaped row and RB1
-- is tenant B's first case. Rows are written as the table owner unless a lane is named.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('1e350000-0000-4000-8000-0000000000c2', '1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d1'),
  ('1e350000-0000-4000-8000-0000000000c3', '1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d2'),
  ('1e350000-0000-4000-8000-0000000000cb', '1e350000-0000-4000-8000-000000000002', 'support', '1e350000-0000-4000-8000-0000000000b1');

-- the allowed values (each refusal names its constraint)
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, state)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'bogus') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'D-836: a state outside open, in_progress, resolved, closed is refused (Postgres evaluates CHECKs by name, so the coherence CHECK reports first)');
select ok(
  (select pg_get_constraintdef(oid) like '%open%in_progress%resolved%closed%' and convalidated
     from pg_constraint where conrelid = 'public.chat_conversations'::regclass and conname = 'chat_conversations_state_chk'),
  'D-836: chat_conversations_state_chk exists, is VALID and lists the four states');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, category)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'bogus') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_category_chk"',
  'D-811: a category outside the five keys is refused (chat_conversations_category_chk)');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, priority)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'urgent') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_priority_chk"',
  'D-811: a priority outside low, normal, high is refused (chat_conversations_priority_chk)');
select throws_ok(
  $$ update public.chat_conversations set case_number = 0 where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_number_chk"',
  'EP-001: a case number of 0 is refused (the first number is 1)');
select throws_ok(
  $$ update public.chat_conversations set case_number = -1 where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_number_chk"',
  'EP-001: a negative case number is refused');
select throws_ok(
  $$ update public.chat_conversations
        set case_number = (select case_number from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c2')
      where id = '1e350000-0000-4000-8000-0000000000c3' $$,
  '23505', 'duplicate key value violates unique constraint "chat_conversations_case_number_uniq"',
  'D-804: two cases of one tenant cannot share a number (chat_conversations_case_number_uniq)');
select lives_ok(
  $$ update public.chat_conversations
        set case_number = (select case_number from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c2')
      where id = '1e350000-0000-4000-8000-0000000000cb' $$,
  'D-804: the same number in two tenants is accepted (the number is per tenant)');

-- the support subject bound counts code points and is scoped to support rows
select throws_ok(
  $$ update public.chat_conversations set subject = '' where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_subject_chk"',
  'D-839: an empty support subject is refused (chat_conversations_subject_chk)');
select throws_ok(
  $$ update public.chat_conversations set subject = repeat('a', 81) where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_subject_chk"',
  'D-839: an 81-character support subject is refused');
select throws_ok(
  $$ update public.chat_conversations set subject = repeat(chr(128512), 81) where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_subject_chk"',
  'D-839: 81 emoji (81 code points) are refused');
select lives_ok(
  $$ update public.chat_conversations set subject = repeat(chr(128512), 80) where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  'D-839: 80 emoji (80 code points, 320 bytes) are accepted: the bound counts code points');
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, subject)
     values ('1e350000-0000-4000-8000-000000000001', 'group', '1e350000-0000-4000-8000-0000000000d3', repeat('g', 200)) $$,
  'D-839: a group conversation keeps accepting a 200-character subject (the bound is scoped to support rows)');

-- a row that is not support carries no case column (the shape CHECK, one probe per column)
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, state)
     values ('1e350000-0000-4000-8000-000000000001', 'direct', '1e350000-0000-4000-8000-0000000000d3', 'open') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a direct row carrying a state is refused by the shape CHECK');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, owner_user_id)
     values ('1e350000-0000-4000-8000-000000000001', 'direct', '1e350000-0000-4000-8000-0000000000d3', '1e350000-0000-4000-8000-0000000000a3') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a direct row carrying an owner is refused by the shape CHECK');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, category)
     values ('1e350000-0000-4000-8000-000000000001', 'group', '1e350000-0000-4000-8000-0000000000d3', 'other') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a group row carrying a category is refused by the shape CHECK');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, priority)
     values ('1e350000-0000-4000-8000-000000000001', 'group', '1e350000-0000-4000-8000-0000000000d3', 'normal') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a group row carrying a priority is refused by the shape CHECK');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, resolved_at)
     values ('1e350000-0000-4000-8000-000000000001', 'direct', '1e350000-0000-4000-8000-0000000000d3', now()) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a direct row carrying resolved_at is refused by the shape CHECK');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, closed_at)
     values ('1e350000-0000-4000-8000-000000000001', 'direct', '1e350000-0000-4000-8000-0000000000d3', now()) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a direct row carrying closed_at is refused by the shape CHECK');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, case_number)
     values ('1e350000-0000-4000-8000-000000000001', 'direct', '1e350000-0000-4000-8000-0000000000d3', 7) $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_shape_chk"',
  'CASE-25: a direct row carrying a case number is refused by the shape CHECK');

-- the coherence of a NON-null state (R1 is open with no owner and no instants)
select throws_ok(
  $$ update public.chat_conversations set owner_user_id = '1e350000-0000-4000-8000-0000000000a3' where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'D-806: an open case with an owner is refused (coherence CHECK)');
select throws_ok(
  $$ update public.chat_conversations set resolved_at = now() where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'D-805: an open case with resolved_at is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'in_progress' where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'D-806: an in_progress case with no owner is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'resolved' where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'D-805: a resolved case with no resolved_at is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'closed' where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'D-805: a closed case with no closed_at is refused');
select lives_ok(
  $$ update public.chat_conversations set state = 'in_progress', owner_user_id = '1e350000-0000-4000-8000-0000000000a3' where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  'D-806: taking a case (in_progress with an owner) is accepted');
select lives_ok(
  $$ update public.chat_conversations set state = 'resolved', resolved_at = now() where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  'D-805: resolving it (resolved_at set, owner kept) is accepted');
select lives_ok(
  $$ update public.chat_conversations set state = 'closed', closed_at = now(), resolved_at = null where id = '1e350000-0000-4000-8000-0000000000c2' $$,
  'D-805: closing it (closed_at set, resolved_at cleared) is accepted');

-- checker B1: a LEGACY support row (every case column null) satisfies both legacy-safe CHECKs, and both are VALID
select lives_ok(
  $$ update public.chat_conversations
        set state = null, case_number = null, priority = null, category = null
      where id = '1e350000-0000-4000-8000-0000000000c3' $$,
  'B1: a support row with a null state and null case columns is accepted by chat_conversations_case_shape_chk and chat_conversations_case_coherence_chk');
select ok(
  (select convalidated from pg_constraint
    where conrelid = 'public.chat_conversations'::regclass and conname = 'chat_conversations_case_shape_chk'),
  'B1: chat_conversations_case_shape_chk was added VALID');
select ok(
  (select convalidated from pg_constraint
    where conrelid = 'public.chat_conversations'::regclass and conname = 'chat_conversations_case_coherence_chk'),
  'B1: chat_conversations_case_coherence_chk was added VALID');

-- the history's own kind list
select throws_ok(
  $$ insert into public.chat_case_events (tenant_id, conversation_id, kind)
     values ('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000c2', 'bogus') $$,
  '23514', 'new row for relation "chat_case_events" violates check constraint "chat_case_events_kind_chk"',
  'D-810: an event kind outside the seven is refused (chat_case_events_kind_chk)');

-- T-12.4-01: the insert policy lets a lane create ONLY a born-open case of its own
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d3');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, case_number)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 9) $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-12.4-01: a member cannot start a case that already carries a number');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, state, owner_user_id)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'in_progress', '1e350000-0000-4000-8000-0000000000a3') $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-12.4-01: a member cannot start a case that is already owned');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, state, resolved_at)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'resolved', now()) $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-12.4-01: a member cannot start a case that is already resolved');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, state, closed_at)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'closed', now()) $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-12.4-01: a member cannot start a case that is already closed');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, priority)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3', 'high') $$,
  '42501', 'new row violates row-level security policy for table "chat_conversations"',
  'T-12.4-01: a member cannot choose a priority other than normal');
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d3') $$,
  'T-12.4-01 positive control: the plain shipped insert shape is accepted');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d4');
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id, category)
     values ('1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d4', 'payment') $$,
  'D-812 positive control: a member may pick the category of the case they open');
reset role;
select is(
  (select category from public.chat_conversations
    where tenant_id = '1e350000-0000-4000-8000-000000000001' and created_by_user_id = '1e350000-0000-4000-8000-0000000000d4'),
  'payment', 'D-812: the picked category is stored (the defaults trigger never overrides a value the writer set)');

-- the events policy: staff of the tenant read the history, nobody else does
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c2'),
  1, 'D-810 positive control: tenant A''s staff reads the opened event of its own case');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d1');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c2'),
  0, 'T-12.4-02: a member, even the owner of the case, reads no event');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b3', 'support_tenant');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c2'),
  0, 'T-12.4-02: tenant B''s staff reads no event of tenant A');
reset role;

-- T-12.4-03: nothing a lane holds rewrites the history
select ok(
  not has_table_privilege('authenticated', 'public.chat_case_events', 'update')
  and not has_table_privilege('authenticated', 'public.chat_case_events', 'delete')
  and not has_table_privilege('authenticated', 'public.chat_case_events', 'truncate'),
  'T-12.4-03: authenticated holds no UPDATE, DELETE or TRUNCATE privilege on chat_case_events');

-- ── 3. numbering ───────────────────────────────────────────────────────────────────────────────
-- A third, fresh tenant, so the numbers below are exact: it has no counter row and no event yet.
select tests.tenant('pgtap-case-c', 'Chamado C', '1e350000-0000-4000-8000-000000000003');
select tests.auth_user('e1@case-c.local', '1e350000-0000-4000-8000-0000000000e1');
select tests.member('1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000e1');
select tests.auth_user('e2@case-c.local', '1e350000-0000-4000-8000-0000000000e2');
select tests.member('1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000e2');
select tests.auth_user('e3@case-c.local', '1e350000-0000-4000-8000-0000000000e3');
select tests.member('1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000e3');
select tests.auth_user('e4@case-c.local', '1e350000-0000-4000-8000-0000000000e4');
select tests.member('1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000e4');
select tests.auth_user('e5@case-c.local', '1e350000-0000-4000-8000-0000000000e5');
select tests.member('1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000e5');
select tests.auth_user('e6@case-c.local', '1e350000-0000-4000-8000-0000000000e6');
select tests.member('1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000e6');

select is(
  (select count(*)::int from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000003')
  + (select count(*)::int from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000003'),
  0, 'EP-001/EP-003: a tenant with no support conversation has no counter row and no event row');
select set_config('tests.a_counter', (select last_number::text from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000001'), true);

-- EP-008: the same insert twice with `on conflict do nothing` (the shape of the shipped API) moves the counter ONCE.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c4', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e1')
on conflict (tenant_id, created_by_user_id) where kind = 'support' do nothing;
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c5', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e1')
on conflict (tenant_id, created_by_user_id) where kind = 'support' do nothing;
select is(
  (select last_number from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000003'),
  1, 'EP-008: a retried insert that conflicts burns no number (the counter moved once, by equality)');
select is(
  (select count(*)::int from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000003' and kind = 'opened'),
  1, 'EP-008: the skipped insert wrote no event either (one opened event)');
select is(
  (select case_number from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c4'),
  1, 'EP-001: the first number a tenant ever receives is exactly 1');

-- EP-006: the second member of the tenant is 2; another tenant's counter did not move (the counter is per tenant).
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c6', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e2');
select is(
  (select case_number from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c6'),
  2, 'EP-006: the next member of the tenant takes the next consecutive number');
select is(
  (select last_number from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000001')::text,
  current_setting('tests.a_counter'),
  'EP-006: the counter is per tenant: tenant A did not move while tenant C was numbered');

-- T-12.4-04: a rolled-back insert leaves no gap and the next insert takes the same number.
savepoint nogap;
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c7', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e3');
select is(
  (select last_number from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000003'),
  3, 'T-12.4-04: inside the savepoint the third case took 3');
rollback to savepoint nogap;
select is(
  (select last_number from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000003'),
  2, 'T-12.4-04: the rolled-back insert gave its number back (no gap)');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c8', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e3');
select is(
  (select case_number from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c8'),
  3, 'T-12.4-04: the next committed insert takes the very number the rolled-back one had');

-- EP-004: the history of one case reads in (created_at, id) order; two events of one instant keep the id order.
insert into public.chat_case_events (id, tenant_id, conversation_id, kind, created_at) values
  ('1e350000-0000-4000-8000-0000000000f2', '1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000c4', 'edited', now() + interval '1 day'),
  ('1e350000-0000-4000-8000-0000000000f1', '1e350000-0000-4000-8000-000000000003', '1e350000-0000-4000-8000-0000000000c4', 'taken',  now() + interval '1 day');
select is(
  (select array_agg(id::text order by created_at, id) from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c4' and kind <> 'opened'),
  array['1e350000-0000-4000-8000-0000000000f1', '1e350000-0000-4000-8000-0000000000f2'],
  'EP-004: two events of one instant read in the stable id order');
select ok(
  (select pg_get_indexdef(i.indexrelid) like '%(tenant_id, conversation_id, created_at, id)%'
     from pg_index i where i.indexrelid = 'public.chat_case_events_conv_idx'::regclass),
  'EP-004: chat_case_events_conv_idx is on (tenant_id, conversation_id, created_at, id)');

-- EP-005: 32-bit integers, no prefix or separator in the database.
select col_type_is('public', 'chat_conversations', 'case_number', 'integer', 'EP-005: chat_conversations.case_number is a 32-bit integer');
select col_type_is('public', 'chat_case_counters', 'last_number', 'integer', 'EP-005: chat_case_counters.last_number is a 32-bit integer');

-- ── 4. directs, isolation and the shape ────────────────────────────────────────────────────────
-- EP-084 (read before tenant C is given directs): tenant B holds no direct row, so its history is support-only.
select is(
  (select count(*)::int from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000002' and kind <> 'support')
  + (select count(*)::int from public.chat_case_events e join public.chat_conversations c on c.id = e.conversation_id
      where e.tenant_id = '1e350000-0000-4000-8000-000000000002' and c.kind <> 'support'),
  0, 'EP-084: in a tenant with no direct row the counter and event tables hold support rows only');

-- EP-085, EP-083, EP-002: direct, support, direct, support in one transaction; only the supports are numbered.
select set_config('tests.c_counter', (select last_number::text from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000003'), true);
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values ('1e350000-0000-4000-8000-0000000000d1', '1e350000-0000-4000-8000-000000000003', 'direct', '1e350000-0000-4000-8000-0000000000e4');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values ('1e350000-0000-4000-8000-0000000000d2', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e4');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values ('1e350000-0000-4000-8000-0000000000d3', '1e350000-0000-4000-8000-000000000003', 'direct', '1e350000-0000-4000-8000-0000000000e5');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values ('1e350000-0000-4000-8000-0000000000d4', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e5');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values ('1e350000-0000-4000-8000-0000000000d5', '1e350000-0000-4000-8000-000000000003', 'group', '1e350000-0000-4000-8000-0000000000e6');
select results_eq(
  $$ select c.id::text, c.state, c.case_number, c.priority, c.category from public.chat_conversations c
      where c.id in ('1e350000-0000-4000-8000-0000000000d1', '1e350000-0000-4000-8000-0000000000d3', '1e350000-0000-4000-8000-0000000000d5') order by c.id $$,
  $$ values ('1e350000-0000-4000-8000-0000000000d1'::text, null::text, null::int, null::text, null::text),
            ('1e350000-0000-4000-8000-0000000000d3', null, null, null, null),
            ('1e350000-0000-4000-8000-0000000000d5', null, null, null, null) $$,
  'CASE-25/EP-002: a direct and a group row beside the support rows keep every case column null');
select results_eq(
  $$ select c.id::text, c.case_number - current_setting('tests.c_counter')::int from public.chat_conversations c
      where c.id in ('1e350000-0000-4000-8000-0000000000d2', '1e350000-0000-4000-8000-0000000000d4') order by c.id $$,
  $$ values ('1e350000-0000-4000-8000-0000000000d2'::text, 1), ('1e350000-0000-4000-8000-0000000000d4', 2) $$,
  'EP-085: with the insert order direct, support, direct, support the supports are numbered consecutively in that order');
select is(
  (select last_number - current_setting('tests.c_counter')::int from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000003'),
  2, 'EP-083: only the two support rows moved the counter (a direct by the same user as a support moved nothing)');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id in ('1e350000-0000-4000-8000-0000000000d1', '1e350000-0000-4000-8000-0000000000d3', '1e350000-0000-4000-8000-0000000000d5')),
  0, 'CASE-25: a direct or group conversation gets no event');

-- EP-082: a direct row with every case column null is accepted at the maximum values of its other columns.
select lives_ok(
  $$ insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id, subject, last_seq, last_staff_seq, staff_last_read_seq, last_message_side, last_message_at)
     values ('1e350000-0000-4000-8000-0000000000d6', '1e350000-0000-4000-8000-000000000003', 'direct', '1e350000-0000-4000-8000-0000000000e6', repeat('x', 1000), 9223372036854775807, 9223372036854775807, 9223372036854775807, 'member', now()) $$,
  'EP-082: a direct row with null case columns and maximal other columns is accepted');

-- EP-086: the comparisons are exact lowercase literals; a kind of "Support" never reaches the shape rules.
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000003', 'Support', '1e350000-0000-4000-8000-0000000000e6') $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_kind_chk"',
  'EP-086: a conversation of kind Support is refused by the shipped kind CHECK, no case folding');

-- CASE-23: another tenant reads nothing (positive control first).
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select is(
  (select count(*)::int from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c2' and case_number is not null and state is not null),
  1, 'CASE-23 positive control: tenant A''s staff reads the case columns of its own case');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b3', 'support_tenant');
select is(
  (select count(*)::int from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c2')
  + (select count(*)::int from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000001'),
  0, 'CASE-23: tenant B''s staff reads no case column and no event of tenant A');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b1');
select is(
  (select count(*)::int from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c2'),
  0, 'CASE-23: tenant B''s member reads no case column of tenant A');
reset role;

-- The counters are reachable by no lane at all: RLS on, ZERO policies, and no table privilege.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.chat_case_counters'::regclass)
  and (select count(*) from pg_policy where polrelid = 'public.chat_case_counters'::regclass) = 0,
  'D-837: chat_case_counters has RLS on and ZERO policies');
select ok(
  not has_table_privilege('authenticated', 'public.chat_case_counters', 'select')
  and not has_table_privilege('authenticated', 'public.chat_case_counters', 'insert')
  and not has_table_privilege('authenticated', 'public.chat_case_counters', 'update')
  and not has_table_privilege('authenticated', 'public.chat_case_counters', 'delete')
  and not has_table_privilege('anon', 'public.chat_case_counters', 'select'),
  'T-12.4-02: no lane holds any privilege on chat_case_counters');
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select throws_ok(
  $$ select last_number from public.chat_case_counters $$,
  '42501', 'permission denied for table chat_case_counters',
  'T-12.4-02: tenant A''s own staff lane cannot read the counter');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d1');
select throws_ok(
  $$ update public.chat_case_counters set last_number = 0 $$,
  '42501', 'permission denied for table chat_case_counters',
  'T-12.4-04: a member lane cannot rewind the counter');
reset role;

-- T-12.4-03: a direct DML on the history from the staff lane changes nothing.
select set_config('tests.events_before', (select count(*)::text from public.chat_case_events), true);
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select throws_ok(
  $$ insert into public.chat_case_events (tenant_id, conversation_id, kind) values ('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000c2', 'taken') $$,
  '42501', 'new row violates row-level security policy for table "chat_case_events"',
  'T-12.4-03: a staff lane cannot insert an event');
select throws_ok(
  $$ update public.chat_case_events set kind = 'closed' where conversation_id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '42501', 'permission denied for table chat_case_events',
  'T-12.4-03: a staff lane cannot update an event');
select throws_ok(
  $$ delete from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c2' $$,
  '42501', 'permission denied for table chat_case_events',
  'T-12.4-03: a staff lane cannot delete an event');
reset role;
select is(
  (select count(*)::text from public.chat_case_events), current_setting('tests.events_before'),
  'T-12.4-03: the history holds exactly the rows it held before the attempts');

-- No lane may update any of the seven case columns (the grant file is untouched by this plan).
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'case_number', 'update'), 'D-836: authenticated cannot update case_number');
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'state', 'update'), 'D-836: authenticated cannot update state');
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'owner_user_id', 'update'), 'D-836: authenticated cannot update owner_user_id');
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'category', 'update'), 'D-836: authenticated cannot update category');
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'priority', 'update'), 'D-836: authenticated cannot update priority');
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'resolved_at', 'update'), 'D-836: authenticated cannot update resolved_at');
select ok(not has_column_privilege('authenticated', 'public.chat_conversations', 'closed_at', 'update'), 'D-836: authenticated cannot update closed_at');

-- ── 5. legacy rows ─────────────────────────────────────────────────────────────────────────────
-- Plan 02 adds `chat_conversations_support_state_chk` (a support row has a state) after its backfill; this line keeps
-- the section green after it (a no-op in this plan, rolled back with the file).
alter table public.chat_conversations drop constraint if exists chat_conversations_support_state_chk;
-- A legacy-shaped support conversation: inserted, then every case column nulled as the table owner (allowed by the
-- legacy-safe CHECKs), THEN the messages go in, so the message trigger meets a legacy row.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c9', '1e350000-0000-4000-8000-000000000001', 'support', '1e350000-0000-4000-8000-0000000000d5');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
values ('1e350000-0000-4000-8000-0000000000c9', '1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d5', 'member');
update public.chat_conversations
   set state = null, case_number = null, priority = null, category = null
 where id = '1e350000-0000-4000-8000-0000000000c9';
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c9'),
  1, 'B1: the legacy-shaped conversation holds the one opened event its insert wrote');
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000d5');
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000c9', '1e350000-0000-4000-8000-0000000000d5', 'member', 'Mensagem de uma conversa antiga') $$,
  'B1: a member message on a legacy conversation (null state) is accepted');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000a3', 'support_tenant');
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000001', '1e350000-0000-4000-8000-0000000000c9', '1e350000-0000-4000-8000-0000000000a3', 'staff', 'Resposta da equipe') $$,
  'B1: a staff reply on a legacy conversation is accepted');
reset role;
select results_eq(
  $$ select last_seq::int, last_staff_seq::int, staff_last_read_seq::int, last_message_side, state, case_number
       from public.chat_conversations where id = '1e350000-0000-4000-8000-0000000000c9' $$,
  $$ values (2, 2, 2, 'staff'::text, null::text, null::int) $$,
  'B1: the counters move as before, the state stays null and the case number stays null');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-0000000000c9'),
  1, 'B1: no new event row was written by the legacy messages');

select * from finish();
rollback;
