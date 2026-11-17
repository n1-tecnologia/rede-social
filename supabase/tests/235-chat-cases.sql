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
select plan(55);

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

select * from finish();
rollback;
