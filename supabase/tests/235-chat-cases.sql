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
-- 6. LEGACY BACKFILL AND THE SWAP (plan 02, CASE-03, CASE-04, CASE-21, D-802, D-814, D-838): `app.chat_cases_backfill`
--    on legacy-shaped rows, then the support-state constraint added NOT VALID and validated, then the active-case
--    index that replaces the one-per-member one.
--
-- 7. MESSAGE-DRIVEN MOVES (plan 02, CASE-05, CASE-06, CASE-07, D-805, D-806, D-845, T-12.4-06, T-12.4-07, EP-021..EP-023):
--    the transition matrix of the message trigger, one assertion per row, as the real lane.
--
-- 8. CHECK COHERENCE (plan 02, CASE-04, EP-016): every illegal combination refused 23514 with the coherence constraint
--    name, and every CHECK of the table VALID.
--
-- 9. TAKE, END TO END (plan 03, CASE-05, CASE-18, CASE-23; D-806, D-810, D-845): the first staff definer, its taken event,
--    the three ids-only chat.case signals, the member lane and foreign-tenant refusals.
--
-- 10. THE ACTION MATRIX (plan 03, CASE-05, CASE-08, CASE-09, CASE-12; D-805, D-806, D-842): every legal pair and every
--    adjacent illegal pair of app.chat_case_act, stale and serial actions, assignee validity, the assign role guard.
--
-- 11. EDIT AND HISTORY (plan 03, CASE-10, CASE-12; D-810, D-811, D-812, D-845; EP-034..EP-036): app.chat_case_edit, one
--    edited row per changed field, no-op edits, the closed refusal, the value bounds, the lanes and the signals.
--
-- 12. THE SWEEP, END TO END (plan 04, CASE-13, CASE-12, CASE-18, CASE-23; D-807, D-844, D-810; T-12.4-17..20): the hourly
--    sweeper's `app.chat_cases_auto_close` closes a case resolved 7 days ago, silently, with a history row that has no actor.
--
-- 13. THE SWEEP AT ITS EDGES (plan 04, EP-039..EP-042): the exact boundary, the batch clamps, the oldest-first order with the id
--    tiebreak, two tenants in one call, the states it never touches, the lanes and the 5000 ceiling.
--
-- Fixture ids use the `1e350000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(398);

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


-- Plan 02: the activation migration added `chat_conversations_support_state_chk` (a support row has a state). Sections 1
-- to 5 are plan 01's proofs, written for a world where a legacy support row (every case column null) is storable, so the
-- constraint is dropped for them (DDL is transactional and this file rolls back); section 6 re-adds it, NOT VALID then
-- validated, exactly as the activation file does, and proves it.
alter table public.chat_conversations drop constraint if exists chat_conversations_support_state_chk;

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

-- EP-008: the same insert twice with `on conflict do nothing` (the shape of the API since plan 02: the arbiter repeats the
-- active-case index predicate) moves the counter ONCE.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c4', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e1')
on conflict (tenant_id, created_by_user_id) where kind = 'support' and state in ('open','in_progress','resolved') do nothing;
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000000c5', '1e350000-0000-4000-8000-000000000003', 'support', '1e350000-0000-4000-8000-0000000000e1')
on conflict (tenant_id, created_by_user_id) where kind = 'support' and state in ('open','in_progress','resolved') do nothing;
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

-- ── 6. legacy backfill and the swap ────────────────────────────────────────────────────────────
-- Plan 02 (CASE-03, CASE-04, CASE-21; D-802, D-814, D-838; EP-010, EP-012, EP-013, EP-066..EP-071; T-12.4-09,
-- T-12.4-10). Legacy-shaped rows are built INSIDE this rolled-back transaction, in this order: the support-state
-- constraint is dropped (the activation migration already added it, and DDL is transactional), the support
-- conversations are inserted as the table owner (the defaults and numbering triggers fire), every case column is nulled
-- FIRST, the events those inserts wrote are deleted (so the backfill is the only writer of events below), and only THEN
-- the messages go in (a legacy row has a null state, so the message trigger takes the counters-only branch).
alter table public.chat_conversations drop constraint if exists chat_conversations_support_state_chk;
select tests.tenant('pgtap-case-d', 'Chamado D', '1e350000-0000-4000-8000-000000000004');
select tests.tenant('pgtap-case-e', 'Chamado E', '1e350000-0000-4000-8000-000000000005');
select tests.auth_user('f3@case-d.local', '1e350000-0000-4000-8000-0000000000f3');
select tests.auth_user('f4@case-d.local', '1e350000-0000-4000-8000-0000000000f4');
select tests.auth_user('f5@case-d.local', '1e350000-0000-4000-8000-0000000000f5');
select tests.auth_user('f6@case-d.local', '1e350000-0000-4000-8000-0000000000f6');
select tests.auth_user('f7@case-d.local', '1e350000-0000-4000-8000-0000000000f7');
select tests.auth_user('f8@case-d.local', '1e350000-0000-4000-8000-0000000000f8');
select tests.auth_user('f9@case-d.local', '1e350000-0000-4000-8000-0000000000f9');
select tests.auth_user('fa@case-e.local', '1e350000-0000-4000-8000-0000000000fa');

-- Inserted in REVERSE order so insertion order is not the answer. L3 has no message at all (EP-066).
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id, created_at) values
  ('1e350000-0000-4000-8000-000000000106', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f8', '2025-12-31 09:00+00'),
  ('1e350000-0000-4000-8000-000000000105', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f7', '2025-12-31 09:00+00'),
  ('1e350000-0000-4000-8000-000000000104', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f6', '2025-12-31 09:00+00'),
  ('1e350000-0000-4000-8000-000000000103', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f5', '2026-01-02 12:00+00'),
  ('1e350000-0000-4000-8000-000000000102', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f4', '2025-12-31 09:00+00'),
  ('1e350000-0000-4000-8000-000000000101', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f3', '2025-12-31 09:00+00');
update public.chat_conversations
   set state = null, case_number = null, priority = null, category = null
 where tenant_id = '1e350000-0000-4000-8000-000000000004';
delete from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000004';
-- L2 closed (member, staff), L5 closed (member, staff), L6 closed (member last but read), L1 open (member, staff, member),
-- L4 open (member only). L5 and L6 share ONE first-message instant (EP-067); the lower id must come first.
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, created_at) values
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000102', '1e350000-0000-4000-8000-0000000000f4', 'member', 'L2 a', '2026-01-01 10:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000102', '1e350000-0000-4000-8000-0000000000f9', 'staff',  'L2 b', '2026-01-01 11:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000105', '1e350000-0000-4000-8000-0000000000f7', 'member', 'L5 a', '2026-01-02 10:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000105', '1e350000-0000-4000-8000-0000000000f9', 'staff',  'L5 b', '2026-01-02 11:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000106', '1e350000-0000-4000-8000-0000000000f8', 'member', 'L6 a', '2026-01-02 10:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000101', '1e350000-0000-4000-8000-0000000000f3', 'member', 'L1 a', '2026-01-03 10:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000101', '1e350000-0000-4000-8000-0000000000f9', 'staff',  'L1 b', '2026-01-03 11:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000101', '1e350000-0000-4000-8000-0000000000f3', 'member', 'L1 c', '2026-01-03 12:00+00'),
  ('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-000000000104', '1e350000-0000-4000-8000-0000000000f6', 'member', 'L4 a', '2026-01-04 10:00+00');
-- The team read L6 (member last, but read): a sequence comparison, never an instant (EP-071).
update public.chat_conversations set staff_last_read_seq = last_seq where id = '1e350000-0000-4000-8000-000000000106';

select is(
  (select count(*)::int from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000004' and state is null and case_number is null),
  6, 'D-814 setup: six legacy-shaped support conversations (every case column null)');
select is(
  (select count(*)::int from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000004'),
  0, 'D-814 setup: no event exists before the backfill, so the backfill is the only writer below');
select set_config('tests.d_base', (select last_number::text from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000004'), true);

select is(app.chat_cases_backfill('1e350000-0000-4000-8000-000000000004'), 6, 'D-814: the backfill numbers the six legacy conversations of the tenant');

select results_eq(
  $$ select id::text, case_number - current_setting('tests.d_base')::int from public.chat_conversations
      where tenant_id = '1e350000-0000-4000-8000-000000000004' order by case_number $$,
  $$ values ('1e350000-0000-4000-8000-000000000102'::text, 1), ('1e350000-0000-4000-8000-000000000105', 2), ('1e350000-0000-4000-8000-000000000106', 3), ('1e350000-0000-4000-8000-000000000103', 4), ('1e350000-0000-4000-8000-000000000101', 5), ('1e350000-0000-4000-8000-000000000104', 6) $$,
  'D-814/EP-067/EP-070: numbers follow (first message instant, id) and continue after the counter; the tie of L5 and L6 goes to the lower id, a conversation without a message is numbered by its creation');
select results_eq(
  $$ select id::text, state from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000004' order by id $$,
  $$ values ('1e350000-0000-4000-8000-000000000101'::text, 'open'::text), ('1e350000-0000-4000-8000-000000000102', 'closed'), ('1e350000-0000-4000-8000-000000000103', 'closed'), ('1e350000-0000-4000-8000-000000000104', 'open'), ('1e350000-0000-4000-8000-000000000105', 'closed'), ('1e350000-0000-4000-8000-000000000106', 'closed') $$,
  'D-814/EP-071: open when the last message is the member''s and unread by the team, closed otherwise (a zero-message conversation is closed)');
select results_eq(
  $$ select id::text, closed_at = coalesce(last_message_at, created_at) from public.chat_conversations
      where tenant_id = '1e350000-0000-4000-8000-000000000004' and state = 'closed' order by id $$,
  $$ values ('1e350000-0000-4000-8000-000000000102'::text, true), ('1e350000-0000-4000-8000-000000000103', true), ('1e350000-0000-4000-8000-000000000105', true), ('1e350000-0000-4000-8000-000000000106', true) $$,
  'D-814/EP-066: closed_at is the last message instant, or the creation instant when there is no message');
select is(
  (select count(*)::int from public.chat_conversations
    where tenant_id = '1e350000-0000-4000-8000-000000000004' and category = 'other' and priority = 'normal' and subject is null
      and owner_user_id is null and resolved_at is null and (state = 'closed') = (closed_at is not null)),
  6, 'D-814: category other, priority normal, no stored subject, no owner, no resolved_at, closed_at only on closed cases');
select results_eq(
  $$ select conversation_id::text, actor_user_id::text, created_at from public.chat_case_events
      where tenant_id = '1e350000-0000-4000-8000-000000000004' and kind = 'opened' order by conversation_id $$,
  $$ values ('1e350000-0000-4000-8000-000000000101'::text, '1e350000-0000-4000-8000-0000000000f3'::text, '2026-01-03 10:00+00'::timestamptz),
            ('1e350000-0000-4000-8000-000000000102', '1e350000-0000-4000-8000-0000000000f4', '2026-01-01 10:00+00'),
            ('1e350000-0000-4000-8000-000000000103', '1e350000-0000-4000-8000-0000000000f5', '2026-01-02 12:00+00'),
            ('1e350000-0000-4000-8000-000000000104', '1e350000-0000-4000-8000-0000000000f6', '2026-01-04 10:00+00'),
            ('1e350000-0000-4000-8000-000000000105', '1e350000-0000-4000-8000-0000000000f7', '2026-01-02 10:00+00'),
            ('1e350000-0000-4000-8000-000000000106', '1e350000-0000-4000-8000-0000000000f8', '2026-01-02 10:00+00') $$,
  'D-814: one opened event per case, the member as actor, at the first message instant (the creation instant without a message)');
select results_eq(
  $$ select conversation_id::text, actor_user_id is null, from_state, to_state from public.chat_case_events
      where tenant_id = '1e350000-0000-4000-8000-000000000004' and kind = 'closed' order by conversation_id $$,
  $$ values ('1e350000-0000-4000-8000-000000000102'::text, true, 'open'::text, 'closed'::text), ('1e350000-0000-4000-8000-000000000103', true, 'open', 'closed'),
            ('1e350000-0000-4000-8000-000000000105', true, 'open', 'closed'), ('1e350000-0000-4000-8000-000000000106', true, 'open', 'closed') $$,
  'D-814: a closed event with no actor for each closed case, none for the open ones');
select is(
  (select count(*)::int from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000004'), 10,
  'D-814: the backfill wrote six opened and four closed events and nothing else');
select is(
  (select last_number - current_setting('tests.d_base')::int from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000004'),
  6, 'D-814: the tenant counter is left at the highest number');
select is(
  (select count(*)::int from public.chat_messages where tenant_id = '1e350000-0000-4000-8000-000000000004'), 9,
  'D-814: no message was added or removed');
select results_eq(
  $$ select id::text, last_seq::int from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000004' order by id $$,
  $$ values ('1e350000-0000-4000-8000-000000000101'::text, 3), ('1e350000-0000-4000-8000-000000000102', 2), ('1e350000-0000-4000-8000-000000000103', 0), ('1e350000-0000-4000-8000-000000000104', 1), ('1e350000-0000-4000-8000-000000000105', 2), ('1e350000-0000-4000-8000-000000000106', 1) $$,
  'D-814: the ids and the message counters are untouched');

-- idempotent (EP-070, T-12.4-09)
select set_config('tests.d_snap',
  (select string_agg(id::text || '|' || state || '|' || case_number || '|' || coalesce(closed_at::text, ''), ',' order by id)
     from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000004'), true);
select is(app.chat_cases_backfill('1e350000-0000-4000-8000-000000000004'), 0, 'EP-070/T-12.4-09: a second run assigns nothing');
select is(
  (select string_agg(id::text || '|' || state || '|' || case_number || '|' || coalesce(closed_at::text, ''), ',' order by id)
     from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000004'),
  current_setting('tests.d_snap'), 'EP-070/T-12.4-09: a second run moves no number, state or instant');
select is(
  (select count(*)::int from public.chat_case_events where tenant_id = '1e350000-0000-4000-8000-000000000004'), 10,
  'EP-070/T-12.4-09: a second run writes no event');
select is(
  (select last_number - current_setting('tests.d_base')::int from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000004'),
  6, 'EP-070: a second run leaves the counter where it was');

-- EP-068: only direct or group rows (or nothing at all) means nothing to do
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('1e350000-0000-4000-8000-000000000111', '1e350000-0000-4000-8000-000000000005', 'direct', '1e350000-0000-4000-8000-0000000000fa'),
  ('1e350000-0000-4000-8000-000000000112', '1e350000-0000-4000-8000-000000000005', 'group', '1e350000-0000-4000-8000-0000000000fa');
select is(app.chat_cases_backfill('1e350000-0000-4000-8000-000000000005'), 0, 'EP-068: a tenant with only direct or group rows is not backfilled');
select is(
  (select count(*)::int from public.chat_case_counters where tenant_id = '1e350000-0000-4000-8000-000000000005'), 0,
  'EP-068: ... and gets no counter row');
select is(app.chat_cases_backfill('1e350000-0000-4000-8000-0000000000ff'), 0,
  'EP-068: a tenant that has no support conversation (or does not exist) gets nothing');
select is(
  (select count(*)::int from public.chat_conversations where tenant_id = '1e350000-0000-4000-8000-000000000005' and state is null and case_number is null),
  2, 'EP-068: the direct and group rows keep every case column null');

-- T-12.4-10: callable by the service role only; EP-069: the ordering note is on the function
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
    where p.oid = 'app.chat_cases_backfill(uuid)'::regprocedure),
  'T-12.4-10: the backfill is a security definer with search_path pinned to ""');
select ok(
  has_function_privilege('service_role', 'app.chat_cases_backfill(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.chat_cases_backfill(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.chat_cases_backfill(uuid)', 'execute'),
  'T-12.4-10: only service_role may execute the backfill');
select tests.as_tenant('1e350000-0000-4000-8000-000000000004', '1e350000-0000-4000-8000-0000000000f3');
select throws_ok(
  $$ select app.chat_cases_backfill() $$, '42501', 'permission denied for function chat_cases_backfill',
  'T-12.4-10: a member lane cannot run the backfill');
reset role;
select ok(
  (select obj_description('app.chat_cases_backfill(uuid)'::regprocedure, 'pg_proc') like '%timestamptz%uuid%'),
  'EP-069: the function comment says the ordering uses the timestamptz value and the uuid byte order, never text');

-- Sections 2 and 5 left two legacy-shaped rows in tenant A (a null state); the backfill must number it BEFORE the constraint can
-- be validated, which is exactly the order of the activation file (the global call there reaches every tenant).
select is(app.chat_cases_backfill('1e350000-0000-4000-8000-000000000001'), 2,
  'D-838: the two legacy-shaped rows left in tenant A by sections 2 and 5 are numbered before the constraint is validated');
-- CASE-04: the second half of the shape rule, added after the backfill (D-836, D-838)
select lives_ok(
  $$ alter table public.chat_conversations add constraint chat_conversations_support_state_chk
       check (kind <> 'support' or state is not null) not valid $$,
  'D-838: the support-state constraint is added NOT VALID once every legacy row is numbered');
select lives_ok(
  $$ alter table public.chat_conversations validate constraint chat_conversations_support_state_chk $$,
  'D-838: ... and validates against every row of the table');
select ok(
  (select convalidated from pg_constraint
    where conrelid = 'public.chat_conversations'::regclass and conname = 'chat_conversations_support_state_chk'),
  'EP-016: chat_conversations_support_state_chk is VALID');
select throws_ok(
  $$ update public.chat_conversations
        set state = null, case_number = null, priority = null, category = null
      where id = '1e350000-0000-4000-8000-000000000102' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_support_state_chk"',
  'D-838: a support row with a null state is now refused');

-- the swap (D-802)
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'chat_conversations_one_support_per_member'),
  0, 'D-802: the one-conversation-per-member index no longer exists');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'chat_conversations_one_active_case_per_member'),
  1, 'D-802: the one-active-case-per-member index exists');
select ok(
  (select indexdef like 'CREATE UNIQUE INDEX%(tenant_id, created_by_user_id)%'
      and indexdef like '%''open''%''in_progress''%''resolved''%' and indexdef not like '%closed%'
     from pg_indexes where schemaname = 'public' and indexname = 'chat_conversations_one_active_case_per_member'),
  'EP-012/EP-013: the index is unique on (tenant_id, created_by_user_id) and its predicate lists exactly open, in_progress and resolved as lowercase literals');
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f3') $$,
  '23505', 'duplicate key value violates unique constraint "chat_conversations_one_active_case_per_member"',
  'D-802: a second ACTIVE case for a member is refused (L1 is open)');
update public.chat_conversations set state = 'closed', closed_at = now() where id = '1e350000-0000-4000-8000-000000000101';
select lives_ok(
  $$ insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000121', '1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f3') $$,
  'D-802/EP-010: a new case is accepted once the previous one is closed');
select is(
  (select case_number - current_setting('tests.d_base')::int from public.chat_conversations
    where id = '1e350000-0000-4000-8000-000000000121'),
  7, 'D-814: a case born after the activation continues from the backfilled counter');
update public.chat_conversations set state = 'resolved', resolved_at = now() where id = '1e350000-0000-4000-8000-000000000104';
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f6') $$,
  '23505', 'duplicate key value violates unique constraint "chat_conversations_one_active_case_per_member"',
  'EP-010: a resolved case still counts as active at the index predicate');
update public.chat_conversations set state = 'closed', resolved_at = null, closed_at = now() where id = '1e350000-0000-4000-8000-000000000104';
select lives_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f6') $$,
  'EP-010: a closed case does not count as active (one step either side of the boundary)');
-- D-800: the previous API revision's insert text no longer matches any index
select throws_ok(
  $$ insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
     values ('1e350000-0000-4000-8000-000000000004', 'support', '1e350000-0000-4000-8000-0000000000f3')
     on conflict (tenant_id, created_by_user_id) where kind = 'support' do nothing $$,
  '42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
  'D-800: the previous member send (the old on conflict text) answers 42P10 after the swap, the release window of plan 18');

-- ── 7. message-driven moves ────────────────────────────────────────────────────────────────────
-- Plan 02 (CASE-05, CASE-06, CASE-07; D-805, D-806, D-845; EP-021..EP-023; T-12.4-06, T-12.4-07). Every row of the
-- transition table that a MESSAGE drives, written as the real lane (the member lane as a participant, the staff lane as
-- support_tenant), so the policies and the trigger are exercised together. Cases are born open by the insert and moved to
-- the starting state by the table owner, setting every column the coherence CHECK reads.

alter table public.chat_conversations drop constraint if exists chat_conversations_support_state_chk;
select tests.tenant('pgtap-case-g', 'Chamado G', '1e350000-0000-4000-8000-000000000006');
select tests.auth_user('s1@case-g.local', '1e350000-0000-4000-8000-000000000201');
select tests.auth_user('s2@case-g.local', '1e350000-0000-4000-8000-000000000202');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000201', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000202', 'support_tenant');
select tests.auth_user('m1@case-g.local', '1e350000-0000-4000-8000-000000000211');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000211');
select tests.auth_user('m2@case-g.local', '1e350000-0000-4000-8000-000000000212');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000212');
select tests.auth_user('m3@case-g.local', '1e350000-0000-4000-8000-000000000213');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000213');
select tests.auth_user('m4@case-g.local', '1e350000-0000-4000-8000-000000000214');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000214');
select tests.auth_user('m5@case-g.local', '1e350000-0000-4000-8000-000000000215');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000215');
select tests.auth_user('m6@case-g.local', '1e350000-0000-4000-8000-000000000216');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000216');
select tests.auth_user('m7@case-g.local', '1e350000-0000-4000-8000-000000000217');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000217');
select tests.auth_user('m8@case-g.local', '1e350000-0000-4000-8000-000000000218');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000218');
select tests.auth_user('m9@case-g.local', '1e350000-0000-4000-8000-000000000219');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000219');
select tests.auth_user('m10@case-g.local', '1e350000-0000-4000-8000-00000000021a');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000021a');
select tests.auth_user('m11@case-g.local', '1e350000-0000-4000-8000-00000000021b');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000021b');
select tests.auth_user('m12@case-g.local', '1e350000-0000-4000-8000-00000000021c');
select tests.member('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000021c');

insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('1e350000-0000-4000-8000-000000000301', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000211'),
  ('1e350000-0000-4000-8000-000000000302', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000212'),
  ('1e350000-0000-4000-8000-000000000303', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000213'),
  ('1e350000-0000-4000-8000-000000000304', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000214'),
  ('1e350000-0000-4000-8000-000000000305', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000215'),
  ('1e350000-0000-4000-8000-000000000306', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000216'),
  ('1e350000-0000-4000-8000-000000000307', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000217'),
  ('1e350000-0000-4000-8000-000000000308', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000218'),
  ('1e350000-0000-4000-8000-000000000309', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-000000000219'),
  ('1e350000-0000-4000-8000-00000000030a', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-00000000021a'),
  ('1e350000-0000-4000-8000-00000000030b', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-00000000021b'),
  ('1e350000-0000-4000-8000-00000000030c', '1e350000-0000-4000-8000-000000000006', 'support', '1e350000-0000-4000-8000-00000000021c');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('1e350000-0000-4000-8000-000000000301', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000211', 'member'),
  ('1e350000-0000-4000-8000-000000000302', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000212', 'member'),
  ('1e350000-0000-4000-8000-000000000303', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000213', 'member'),
  ('1e350000-0000-4000-8000-000000000304', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000214', 'member'),
  ('1e350000-0000-4000-8000-000000000305', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000215', 'member'),
  ('1e350000-0000-4000-8000-000000000306', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000216', 'member'),
  ('1e350000-0000-4000-8000-000000000307', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000217', 'member'),
  ('1e350000-0000-4000-8000-000000000308', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000218', 'member'),
  ('1e350000-0000-4000-8000-000000000309', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000219', 'member'),
  ('1e350000-0000-4000-8000-00000000030a', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000021a', 'member'),
  ('1e350000-0000-4000-8000-00000000030b', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000021b', 'member'),
  ('1e350000-0000-4000-8000-00000000030c', '1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000021c', 'member');
-- starting states (every column of the coherence CHECK set together)
update public.chat_conversations set state = 'resolved', resolved_at = now(), owner_user_id = '1e350000-0000-4000-8000-000000000201' where id in ('1e350000-0000-4000-8000-000000000301', '1e350000-0000-4000-8000-000000000305', '1e350000-0000-4000-8000-000000000309');
update public.chat_conversations set state = 'in_progress', owner_user_id = '1e350000-0000-4000-8000-000000000202' where id in ('1e350000-0000-4000-8000-000000000303', '1e350000-0000-4000-8000-000000000307');
update public.chat_conversations set state = 'in_progress', owner_user_id = '1e350000-0000-4000-8000-000000000201' where id = '1e350000-0000-4000-8000-000000000304';
update public.chat_conversations set state = 'closed', closed_at = now() where id = '1e350000-0000-4000-8000-000000000308';

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000211');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000301', '1e350000-0000-4000-8000-000000000211', 'member', chr(128512));
reset role;
select results_eq(
  $$ select state, owner_user_id is null, resolved_at is null, closed_at is null from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000301' $$,
  $$ values ('open'::text, true, true, true) $$,
  'D-805/D-845: a member message on a resolved case moves it to open, with no owner and resolved_at cleared (a body of one emoji is enough, EP-022)');
select results_eq(
  $$ select e.kind, e.actor_user_id::text, e.from_state, e.to_state, e.message_id = m.id
       from public.chat_case_events e join public.chat_messages m on m.conversation_id = e.conversation_id
      where e.conversation_id = '1e350000-0000-4000-8000-000000000301' and e.kind = 'reopened' $$,
  $$ values ('reopened'::text, '1e350000-0000-4000-8000-000000000211'::text, 'resolved'::text, 'open'::text, true) $$,
  'D-810/D-845: exactly one reopened event, the member as actor, carrying the id of the message that reopened it');

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000201', 'support_tenant');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000302', '1e350000-0000-4000-8000-000000000201', 'staff', 'Estou vendo isso agora');
reset role;
select results_eq(
  $$ select state, owner_user_id::text, resolved_at is null from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000302' $$,
  $$ values ('in_progress'::text, '1e350000-0000-4000-8000-000000000201'::text, true) $$,
  'D-806/D-845: a staff reply on an open unowned case moves it to in_progress, owned by the author');
select results_eq(
  $$ select e.kind, e.actor_user_id::text, e.from_state, e.to_state, e.message_id = m.id
       from public.chat_case_events e join public.chat_messages m on m.conversation_id = e.conversation_id
      where e.conversation_id = '1e350000-0000-4000-8000-000000000302' and e.kind = 'taken' $$,
  $$ values ('taken'::text, '1e350000-0000-4000-8000-000000000201'::text, 'open'::text, 'in_progress'::text, true) $$,
  'D-810/D-845: exactly one taken event, the author as actor, carrying the message id');

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000201', 'support_tenant');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000303', '1e350000-0000-4000-8000-000000000201', 'staff', 'Resposta de outra pessoa');
reset role;
select results_eq(
  $$ select state, owner_user_id::text from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000303' $$,
  $$ values ('in_progress'::text, '1e350000-0000-4000-8000-000000000202'::text) $$,
  'T-12.4-07/D-806: a staff reply on a case owned by ANOTHER person changes neither state nor owner');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000303' and kind <> 'opened'), 0,
  'T-12.4-07: ... and writes no event');

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000201', 'support_tenant');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000304', '1e350000-0000-4000-8000-000000000201', 'staff', 'Segue a resposta');
reset role;
select results_eq(
  $$ select state, owner_user_id::text from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000304' $$,
  $$ values ('in_progress'::text, '1e350000-0000-4000-8000-000000000201'::text) $$,
  'D-806: a staff reply on a case the author already owns changes nothing');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000304' and kind <> 'opened'), 0,
  'D-806: ... and writes no event');

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000202', 'support_tenant');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000305', '1e350000-0000-4000-8000-000000000202', 'staff', 'Mais um detalhe');
reset role;
select results_eq(
  $$ select state, owner_user_id::text, resolved_at is not null from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000305' $$,
  $$ values ('resolved'::text, '1e350000-0000-4000-8000-000000000201'::text, true) $$,
  'D-805: a staff reply on a resolved case does not reopen it and does not change its owner');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000305' and kind <> 'opened'), 0,
  'D-805: ... and writes no event');

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000216');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000306', '1e350000-0000-4000-8000-000000000216', 'member', 'Ainda aguardo');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000217');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000307', '1e350000-0000-4000-8000-000000000217', 'member', 'Alguma novidade?');
reset role;
select results_eq(
  $$ select id::text, state, owner_user_id::text from public.chat_conversations where id in ('1e350000-0000-4000-8000-000000000306', '1e350000-0000-4000-8000-000000000307') order by id $$,
  $$ values ('1e350000-0000-4000-8000-000000000306'::text, 'open'::text, null::text), ('1e350000-0000-4000-8000-000000000307', 'in_progress', '1e350000-0000-4000-8000-000000000202'::text) $$,
  'D-805: a member message on an open or an in_progress case changes neither state nor owner');
select is((select count(*)::int from public.chat_case_events where conversation_id in ('1e350000-0000-4000-8000-000000000306', '1e350000-0000-4000-8000-000000000307') and kind <> 'opened'), 0,
  'D-805: ... and writes no event');

select set_config('tests.g_seq8', (select last_seq::text from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000308'), true);
select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000218');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000308', '1e350000-0000-4000-8000-000000000218', 'member', 'Posso falar de novo?') $$,
  'CS004', 'case_closed', 'T-12.4-06/D-845: a MEMBER message on a closed case is refused with SQLSTATE CS004');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000201', 'support_tenant');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000308', '1e350000-0000-4000-8000-000000000201', 'staff', 'Resposta tardia') $$,
  'CS004', 'case_closed', 'T-12.4-06/D-845: a STAFF reply on a closed case is refused with SQLSTATE CS004');
reset role;
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000308', '1e350000-0000-4000-8000-000000000201', 'staff', 'Uma sessao do banco tambem nao escreve') $$,
  'CS004', 'case_closed', 'T-12.4-06: the refusal holds for the table owner too (a psql session, the seed, the worker)');
select is((select last_seq::text from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000308'), current_setting('tests.g_seq8'),
  'T-12.4-06: the refused messages consumed no sequence number');
select is((select count(*)::int from public.chat_messages where conversation_id = '1e350000-0000-4000-8000-000000000308'), 0,
  'T-12.4-06: ... and no message row was written');
select is((select state from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000308'), 'closed',
  'D-801: a closed case stays closed');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000308' and kind <> 'opened'), 0,
  'D-801: ... and its history gained nothing');

select tests.as_tenant('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000219');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000309', '1e350000-0000-4000-8000-000000000219', 'member', E'  \n\t  ') $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_body_chk"',
  'EP-021: an all-whitespace member body on a resolved case is refused by the body CHECK');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000309', '1e350000-0000-4000-8000-000000000219', 'member', repeat('a', 2001)) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_body_chk"',
  'EP-022: 2001 code points are refused by the body CHECK');
reset role;
select results_eq(
  $$ select state, resolved_at is not null, last_seq::int from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000309' $$,
  $$ values ('resolved'::text, true, 0) $$,
  'EP-021/EP-022: a refused body moves nothing, the trigger transition and the counters roll back with the statement');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000309' and kind <> 'opened'), 0,
  'EP-021: ... and no event row is written');

insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values ('1e350000-0000-4000-8000-000000000320', '1e350000-0000-4000-8000-000000000006', 'direct', '1e350000-0000-4000-8000-00000000021a');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-000000000320', '1e350000-0000-4000-8000-00000000021a', 'member', 'Conversa direta');
select results_eq(
  $$ select last_seq::int, state, case_number from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000320' $$,
  $$ values (1, null::text, null::int) $$,
  'CASE-25: a message on a direct conversation moves the counters only');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000320'), 0,
  'CASE-25: ... and writes no event');

update public.chat_conversations set state = null, case_number = null, priority = null, category = null where id = '1e350000-0000-4000-8000-00000000030b';
delete from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-00000000030b';
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000030b', '1e350000-0000-4000-8000-000000000201', 'staff', 'Resposta em uma conversa antiga');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
values ('1e350000-0000-4000-8000-000000000006', '1e350000-0000-4000-8000-00000000030b', '1e350000-0000-4000-8000-00000000021b', 'member', 'Mensagem em uma conversa antiga');
select results_eq(
  $$ select last_seq::int, state, owner_user_id is null from public.chat_conversations where id = '1e350000-0000-4000-8000-00000000030b' $$,
  $$ values (2, null::text, true) $$,
  'D-845: a null state (a legacy row between the functions file and the activation file) is counters only, even for a staff reply');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-00000000030b'), 0,
  'D-845: ... and writes no event');


-- ── 8. CHECK coherence ─────────────────────────────────────────────────────────────────────────
-- Plan 02 (CASE-04, EP-016). Every illegal combination of state, owner and instants is refused 23514 with the coherence
-- constraint name, row by row, on a case born open. The CHECKs are VALID.

select throws_ok(
  $$ update public.chat_conversations set owner_user_id = '1e350000-0000-4000-8000-000000000201' where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: an open case with an owner is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'in_progress' where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: an in_progress case without an owner is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'resolved' where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: a resolved case without resolved_at is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'closed' where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: a closed case without closed_at is refused');
select throws_ok(
  $$ update public.chat_conversations set resolved_at = now() where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: an open case with resolved_at is refused');
select throws_ok(
  $$ update public.chat_conversations set state = 'closed', closed_at = now(), resolved_at = now() where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: a closed case that still carries resolved_at is refused (closing clears it)');
select throws_ok(
  $$ update public.chat_conversations set state = 'resolved', resolved_at = now(), closed_at = now() where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: a resolved case with closed_at is refused');
select throws_ok(
  $$ update public.chat_conversations set closed_at = now() where id = '1e350000-0000-4000-8000-00000000030c' $$,
  '23514', 'new row for relation "chat_conversations" violates check constraint "chat_conversations_case_coherence_chk"',
  'CASE-04: an open case with closed_at is refused');
select results_eq(
  $$ select state, owner_user_id is null, resolved_at is null, closed_at is null from public.chat_conversations where id = '1e350000-0000-4000-8000-00000000030c' $$,
  $$ values ('open'::text, true, true, true) $$,
  'CASE-04: after the refusals the case is exactly as it was born');
select ok(
  (select bool_and(convalidated) from pg_constraint where conrelid = 'public.chat_conversations'::regclass and contype = 'c'),
  'EP-016: every CHECK of chat_conversations is VALID, chat_conversations_support_state_chk included');


-- ── 9. take, end to end ────────────────────────────────────────────────────────────────────────
-- Plan 03 (CASE-05, CASE-08, CASE-18, CASE-23; D-806, D-810, D-845; T-12.4-11, T-12.4-12, T-12.4-15). The tracer: a staff
-- lane takes an open case through `app.chat_case_act`; every refusal is read by SQLSTATE, never by message.
-- Tenant H: staff s1, s2 (support_tenant), admin ad, members m1..; the foreign staff is tenant B's `...00b3`.
-- Realtime evidence is read at now(): it passes only when a partition covers it, and FAILS with a named reason otherwise.
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
select tests.tenant('pgtap-case-h', 'Chamado H', '1e350000-0000-4000-8000-000000000007');
select tests.auth_user('s1@case-h.local', '1e350000-0000-4000-8000-000000000401');
select tests.auth_user('s2@case-h.local', '1e350000-0000-4000-8000-000000000402');
select tests.auth_user('ad@case-h.local', '1e350000-0000-4000-8000-000000000403');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000401', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000402', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000403', 'admin_tenant');
select tests.auth_user('m1@case-h.local', '1e350000-0000-4000-8000-000000000411');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000411');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-000000000501', '1e350000-0000-4000-8000-000000000007', 'support', '1e350000-0000-4000-8000-000000000411');

select tests.as_tenant('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000401', 'support_tenant');
select results_eq(
  $$ select r->>'id', (r->>'number')::int, r->>'from_state', r->>'state', r->>'owner_user_id'
       from (select app.chat_case_act('1e350000-0000-4000-8000-000000000501', 'take', 'open', null, null) as r) x $$,
  $$ values ('1e350000-0000-4000-8000-000000000501'::text, 1, 'open'::text, 'in_progress'::text, '1e350000-0000-4000-8000-000000000401'::text) $$,
  'D-806/D-845: a support staff lane takes an open case, the definer answers its id, number, from-state, state and owner');
reset role;

select results_eq(
  $$ select state, owner_user_id::text, resolved_at is null, closed_at is null
       from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000501' $$,
  $$ values ('in_progress'::text, '1e350000-0000-4000-8000-000000000401'::text, true, true) $$,
  'D-806: the row is in_progress and owned by the caller');
select results_eq(
  $$ select kind, actor_user_id::text, from_state, to_state, target_user_id is null, message_id is null
       from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000501' and kind = 'taken' $$,
  $$ values ('taken'::text, '1e350000-0000-4000-8000-000000000401'::text, 'open'::text, 'in_progress'::text, true, true) $$,
  'D-810: exactly one taken event, the caller as actor, from open to in_progress');

select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select topic from realtime.messages
      where event = 'chat.case' and payload->>'conversationId' = '1e350000-0000-4000-8000-000000000501'
      order by topic collate "C" $$,
  $$ values ('tenant:1e350000-0000-4000-8000-000000000007:conv:1e350000-0000-4000-8000-000000000501'::text),
            ('tenant:1e350000-0000-4000-8000-000000000007:support-inbox'),
            ('tenant:1e350000-0000-4000-8000-000000000007:user:1e350000-0000-4000-8000-000000000411') $$,
  'CASE-18: one chat.case signal on the conversation topic, one on the support inbox and one on the member''s own topic'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select distinct array(select jsonb_object_keys(payload) order by 1)
       from realtime.messages
      where event = 'chat.case' and payload->>'conversationId' = '1e350000-0000-4000-8000-000000000501' $$,
  $$ values (array['conversationId', 'id']) $$,
  'T-12.4-15: the chat.case payload carries exactly conversationId and the injected id'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;

-- the member lane and the foreign tenant's staff, on the same open case, with nothing moving
select tests.auth_user('m2@case-h.local', '1e350000-0000-4000-8000-000000000412');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000412');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-000000000502', '1e350000-0000-4000-8000-000000000007', 'support', '1e350000-0000-4000-8000-000000000412');

select tests.as_tenant('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000412');
select throws_ok(
  $$ select app.chat_case_act('1e350000-0000-4000-8000-000000000502', 'take', 'open', null, null) $$,
  '42501', null, 'CASE-23: a member lane calling the definer is refused 42501');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b3', 'support_tenant');
select throws_ok(
  $$ select app.chat_case_act('1e350000-0000-4000-8000-000000000502', 'take', 'open', null, null) $$,
  'CS001', null, 'CASE-23/T-12.4-12: tenant B''s staff on tenant A''s case is CS001');
reset role;
select results_eq(
  $$ select state, owner_user_id is null from public.chat_conversations where id = '1e350000-0000-4000-8000-000000000502' $$,
  $$ values ('open'::text, true) $$,
  'CASE-23: ... and the case did not move');
select is((select count(*)::int from public.chat_case_events where conversation_id = '1e350000-0000-4000-8000-000000000502' and kind <> 'opened'), 0,
  'CASE-23: ... and its history gained nothing');

select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
     from pg_proc p where p.oid = 'app.chat_case_act(uuid,text,text,uuid,uuid)'::regprocedure),
  'D-845: app.chat_case_act is a security definer with search_path pinned to ""');
select ok(has_function_privilege('authenticated', 'app.chat_case_act(uuid,text,text,uuid,uuid)', 'execute'),
  'D-845: authenticated can execute app.chat_case_act');
select ok(not has_function_privilege('anon', 'app.chat_case_act(uuid,text,text,uuid,uuid)', 'execute'),
  'D-845: anon cannot execute app.chat_case_act');
select ok(not has_function_privilege('public', 'app.chat_case_act(uuid,text,text,uuid,uuid)', 'execute'),
  'D-845: public cannot execute app.chat_case_act');


-- ── 10. the action matrix ──────────────────────────────────────────────────────────────────────
-- Plan 03 (CASE-05, CASE-08, CASE-09, CASE-12; D-805, D-806, D-842, D-845; EP-017..EP-020, EP-024..EP-027, EP-037, EP-038;
-- T-12.4-11, T-12.4-13, T-12.4-14, T-12.4-16). Every legal pair and every adjacent illegal pair of `app.chat_case_act`,
-- asserted by the final row, the history and the SQLSTATE (never a message). Cases are numbered 1..N by the helper
-- `tests.mkcase`: its own member, born open, then moved to the starting state with every column the coherence CHECK reads.
-- A helper reads the history compactly: `kind:from>to` joined by commas, oldest first by (created_at, id), `opened` left out.
create or replace function tests.cid(p_n integer) returns uuid language sql immutable strict as $$
  select ('1e350000-0000-4000-8000-00000000' || lpad(to_hex(1536 + p_n), 4, '0'))::uuid
$$;
create or replace function tests.uid(p_n integer) returns uuid language sql immutable strict as $$
  select ('1e350000-0000-4000-8000-00000000' || lpad(to_hex(1792 + p_n), 4, '0'))::uuid
$$;
create or replace function tests.mkcase(p_n integer, p_state text, p_owner uuid default null, p_last_seq integer default 0)
returns void language plpgsql as $$
begin
  perform tests.auth_user('cm' || p_n || '@case-h.local', tests.uid(p_n));
  perform tests.member('1e350000-0000-4000-8000-000000000007', tests.uid(p_n));
  insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
  values (tests.cid(p_n), '1e350000-0000-4000-8000-000000000007', 'support', tests.uid(p_n));
  update public.chat_conversations
     set state = p_state,
         owner_user_id = p_owner,
         resolved_at = case when p_state = 'resolved' then now() end,
         closed_at = case when p_state = 'closed' then now() end,
         last_seq = p_last_seq
   where id = tests.cid(p_n);
end
$$;
create or replace function tests.evs(p_n integer) returns text language sql stable as $$
  select coalesce(string_agg(e.kind || ':' || coalesce(e.from_state, '-') || '>' || coalesce(e.to_state, '-'), ',' order by e.created_at, e.id), '')
    from public.chat_case_events e
   where e.conversation_id = tests.cid(p_n) and e.kind <> 'opened'
$$;
create or replace function tests.act(p_staff uuid, p_role text, p_n integer, p_action text, p_expected text,
                                     p_exp_owner uuid default null, p_target uuid default null)
returns jsonb language plpgsql as $$
declare
  v_id uuid := tests.cid(p_n);
  v jsonb;
begin
  perform tests.as_tenant('1e350000-0000-4000-8000-000000000007', p_staff, p_role);
  begin
    v := app.chat_case_act(v_id, p_action, p_expected, p_exp_owner, p_target);
  exception when others then
    reset role;
    raise;
  end;
  reset role;
  return v;
end
$$;
create or replace function tests.row(p_n integer) returns text language sql stable as $$
  select c.state || '|' || coalesce(c.owner_user_id::text, '-') || '|' || (c.resolved_at is not null)::text
         || '|' || (c.closed_at is not null)::text || '|' || c.staff_last_read_seq::text
    from public.chat_conversations c where c.id = tests.cid(p_n)
$$;

-- extra staff: a blocked one and a removed one, both still carrying a support_tenant claim in a stale token
select tests.auth_user('s3@case-h.local', '1e350000-0000-4000-8000-000000000404');
select tests.auth_user('s4@case-h.local', '1e350000-0000-4000-8000-000000000405');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000404', 'support_tenant');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000405', 'support_tenant');
update public.memberships set blocked_at = now() where tenant_id = '1e350000-0000-4000-8000-000000000007' and user_id = '1e350000-0000-4000-8000-000000000404';
update public.memberships set deleted_at = now() where tenant_id = '1e350000-0000-4000-8000-000000000007' and user_id = '1e350000-0000-4000-8000-000000000405';

-- fixtures (case number: starting state, owner)
select tests.mkcase(1, 'open', null, 0);
select tests.mkcase(2, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(3, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(4, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(5, 'open', null, 0);
select tests.mkcase(6, 'resolved', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(7, 'closed', null, 0);
select tests.mkcase(8, 'open', null, 0);
select tests.mkcase(9, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(10, 'open', null, 0);
select tests.mkcase(11, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(12, 'resolved', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(13, 'closed', null, 0);
select tests.mkcase(14, 'open', null, 0);
select tests.mkcase(15, 'open', null, 0);
select tests.mkcase(16, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(17, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(18, 'open', null, 5);
select tests.mkcase(19, 'in_progress', '1e350000-0000-4000-8000-000000000401', 7);
select tests.mkcase(20, 'resolved', '1e350000-0000-4000-8000-000000000401', 9);
select tests.mkcase(21, 'open', null, 0);
select tests.mkcase(22, 'in_progress', '1e350000-0000-4000-8000-000000000402', 0);
select tests.mkcase(23, 'resolved', null, 0);
select tests.mkcase(24, 'closed', null, 0);
select tests.mkcase(25, 'open', null, 0);
select tests.mkcase(26, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(27, 'open', null, 0);
select tests.mkcase(28, 'open', null, 0);
select tests.mkcase(29, 'open', null, 0);
select tests.mkcase(30, 'open', null, 0);
select tests.mkcase(31, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(32, 'open', null, 0);
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e350000-0000-4000-8000-0000000006ff', '1e350000-0000-4000-8000-000000000007', 'direct', '1e350000-0000-4000-8000-000000000411');

select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 1, 'take', 'open', null, null) $$, 'D-806: take from open');
select is(tests.row(1), 'in_progress|1e350000-0000-4000-8000-000000000402|false|false|0', 'D-806: take from open makes the actor the owner');
select is(tests.evs(1), 'taken:open>in_progress', 'D-810: ... with one taken event');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 2, 'take', 'in_progress', '1e350000-0000-4000-8000-000000000401', null) $$, 'D-842: take-over with the expected owner');
select is(tests.row(2), 'in_progress|1e350000-0000-4000-8000-000000000402|false|false|0', 'D-842: a take-over moves the owner to the actor and keeps the state');
select is(tests.evs(2), 'taken:in_progress>in_progress', 'D-842: ... and writes one taken event');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 3, 'take', 'in_progress', null, null) $$, 'CS002', null, 'D-842: a take-over without the expected owner is CS002');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 3, 'take', 'in_progress', '1e350000-0000-4000-8000-000000000402', null) $$, 'CS002', null, 'D-842: a take-over with the WRONG expected owner is CS002');
select is(tests.row(3), 'in_progress|1e350000-0000-4000-8000-000000000401|false|false|0', 'D-842: ... and the owner did not move');
select is(tests.evs(3), '', 'D-842: ... and the history gained nothing');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 4, 'take', 'in_progress', '1e350000-0000-4000-8000-000000000401', null) $$, 'CS003', null, 'EP-037: taking a case the actor already owns is CS003');
select is(tests.evs(4), '', 'EP-037: ... with no event');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 5, 'take', 'open', null, null) $$, 'EP-037: the first take works');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 5, 'take', 'in_progress', '1e350000-0000-4000-8000-000000000401', null) $$, 'CS003', null, 'EP-037: the same take twice is CS003');
select is(tests.evs(5), 'taken:open>in_progress', 'EP-037: ... and there is one taken event');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 6, 'take', 'resolved', null, null) $$, 'CS003', null, 'EP-025: take from resolved is CS003');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 7, 'take', 'closed', null, null) $$, 'CS003', null, 'EP-025: take from closed is CS003');
select is(tests.row(6), 'resolved|1e350000-0000-4000-8000-000000000401|true|false|0', 'EP-025: ... the resolved case did not move');
select is(tests.row(7), 'closed|-|false|true|0', 'EP-025: ... the closed case did not move');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 8, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000402') $$, 'D-806: an admin assigns an open case to a live staff member');
select is(tests.row(8), 'in_progress|1e350000-0000-4000-8000-000000000402|false|false|0', 'D-806: assign from open makes the target the owner');
select results_eq($$ select kind, actor_user_id::text, target_user_id::text, from_state, to_state from public.chat_case_events where conversation_id = tests.cid(8) and kind = 'assigned' $$, $$ values ('assigned'::text, '1e350000-0000-4000-8000-000000000403'::text, '1e350000-0000-4000-8000-000000000402'::text, 'open'::text, 'in_progress'::text) $$, 'D-810: the assigned event carries the actor, the target and both states');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 9, 'assign', 'in_progress', null, '1e350000-0000-4000-8000-000000000402') $$, 'D-806: assign from in_progress moves the owner');
select is(tests.row(9), 'in_progress|1e350000-0000-4000-8000-000000000402|false|false|0', 'D-806: ... to the target');
select is(tests.evs(9), 'assigned:in_progress>in_progress', 'D-810: ... with one assigned event');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 10, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000402') $$, '42501', null, 'T-12.4-11: support_tenant assigning is refused 42501');
select is(tests.row(10), 'open|-|false|false|0', 'T-12.4-11: ... and nothing moved');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 10, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000402') $$, 'T-12.4-11: positive control, admin_tenant assigns the same case');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 14, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000404') $$, 'CS005', null, 'T-12.4-14: a blocked staff member is not a valid assignee');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 14, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000405') $$, 'CS005', null, 'T-12.4-14: a removed staff member is not a valid assignee');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 14, 'assign', 'open', null, '1e350000-0000-4000-8000-0000000000b3') $$, 'CS005', null, 'T-12.4-14: another tenants staff is not a valid assignee');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 14, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000411') $$, 'CS005', null, 'T-12.4-14: a member is not a valid assignee');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 14, 'assign', 'open', null, null) $$, 'CS005', null, 'T-12.4-14: a null assignee is CS005');
select is(tests.row(14), 'open|-|false|false|0', 'T-12.4-14: ... and the case did not move after five refusals');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 11, 'assign', 'in_progress', null, '1e350000-0000-4000-8000-000000000401') $$, 'CS005', null, 'D-806: assigning to the current owner is CS005');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 15, 'assign', 'open', null, '1e350000-0000-4000-8000-000000000403') $$, 'D-806: an admin may assign a case to themself');
select is(tests.row(15), 'in_progress|1e350000-0000-4000-8000-000000000403|false|false|0', 'D-806: ... and becomes its owner');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 12, 'assign', 'resolved', null, '1e350000-0000-4000-8000-000000000402') $$, 'CS003', null, 'EP-025: assign from resolved is CS003');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 13, 'assign', 'closed', null, '1e350000-0000-4000-8000-000000000402') $$, 'CS003', null, 'EP-025: assign from closed is CS003');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 16, 'resolve', 'in_progress', null, null) $$, 'D-842: any staff member resolves a case owned by another');
select is(tests.row(16), 'resolved|1e350000-0000-4000-8000-000000000401|true|false|0', 'D-805: resolve sets resolved_at and keeps the owner');
select is(tests.evs(16), 'resolved:in_progress>resolved', 'D-810: ... with one resolved event');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 21, 'resolve', 'open', null, null) $$, 'D-805: resolve from open');
select is(tests.row(21), 'resolved|-|true|false|0', 'D-805/EP-026: resolve of an open case with zero messages leaves staff_last_read_seq at 0');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 18, 'resolve', 'open', null, null) $$, 'D-805: resolve a case that has messages');
select is(tests.row(18), 'resolved|-|true|false|5', 'D-805: resolve sets staff_last_read_seq to last_seq');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 20, 'resolve', 'resolved', null, null) $$, 'CS003', null, 'EP-025: resolve from resolved is CS003');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 7, 'resolve', 'closed', null, null) $$, 'CS003', null, 'EP-025: resolve from closed is CS003');
select is(tests.row(20), 'resolved|1e350000-0000-4000-8000-000000000401|true|false|0', 'EP-025: ... the resolved case did not move');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 17, 'close', 'in_progress', null, null) $$, 'D-842: any staff member closes a case owned by another');
select is(tests.row(17), 'closed|1e350000-0000-4000-8000-000000000401|false|true|0', 'D-805: close sets closed_at and keeps the owner');
select is(tests.evs(17), 'closed:in_progress>closed', 'D-810: ... with one closed event');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 19, 'close', 'in_progress', null, null) $$, 'D-805: close a case that has messages');
select is(tests.row(19), 'closed|1e350000-0000-4000-8000-000000000401|false|true|7', 'D-805: close sets staff_last_read_seq to last_seq');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 22, 'close', 'in_progress', null, null) $$, 'D-805: close from in_progress');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 23, 'close', 'resolved', null, null) $$, 'D-805: close from resolved');
select is(tests.row(23), 'closed|-|false|true|0', 'D-805: closing a resolved case clears resolved_at');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 25, 'close', 'open', null, null) $$, 'D-805: close from open');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 24, 'close', 'closed', null, null) $$, 'CS003', null, 'EP-025: close from closed is CS003');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 20, 'reopen', 'resolved', null, null) $$, 'D-805: reopen from resolved');
select is(tests.row(20), 'open|-|false|false|0', 'D-805: reopen clears the owner and resolved_at');
select is(tests.evs(20), 'reopened:resolved>open', 'D-810: ... with one reopened event');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 8, 'reopen', 'in_progress', null, null) $$, 'CS003', null, 'EP-025: reopen from in_progress is CS003');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 26, 'reopen', 'in_progress', null, null) $$, 'CS003', null, 'EP-025: reopen from in_progress is CS003 (a second case)');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 27, 'reopen', 'open', null, null) $$, 'CS003', null, 'EP-025: reopen from open is CS003');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 24, 'reopen', 'closed', null, null) $$, 'CS003', null, 'EP-025: reopen from closed is CS003');
select is(tests.row(24), 'closed|-|false|true|0', 'EP-025: ... the closed case stays closed');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 28, 'resolve', 'open', null, null) $$, 'EP-027: resolve ...');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 28, 'close', 'resolved', null, null) $$, 'EP-027: ... then close');
select is(tests.evs(28), 'resolved:open>resolved,closed:resolved>closed', 'EP-027: the events read resolved then closed, oldest first by (created_at, id)');
select is(tests.row(28), 'closed|-|false|true|0', 'EP-027: the close cleared resolved_at, so the coherence CHECK held at each step');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 29, 'take', 'in_progress', null, null) $$, 'CS002', null, 'EP-017: an action one state off is CS002');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 29, 'resolve', 'closed', null, null) $$, 'CS002', null, 'EP-017: ... in either direction');
select is(tests.row(29), 'open|-|false|false|0', 'EP-017: ... and the row did not move');
select is(tests.evs(29), '', 'EP-017: ... and the history gained nothing');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 30, 'take', 'open', null, null) $$, 'EP-038: the first of two takers wins');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 30, 'take', 'open', null, null) $$, 'CS002', null, 'EP-038: the second taker sees the first ones state and gets CS002');
select is(tests.evs(30), 'taken:open>in_progress', 'EP-038: exactly one taken event');
select is(tests.row(30), 'in_progress|1e350000-0000-4000-8000-000000000401|false|false|0', 'EP-038: ... and the winner owns the case');
select lives_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 31, 'resolve', 'in_progress', null, null) $$, 'EP-020: the first of two actions applies');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 31, 'close', 'in_progress', null, null) $$, 'CS002', null, 'EP-020: the loser, expecting the old state, answers CS002');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000402', 'support_tenant', 31, 'resolve', 'resolved', null, null) $$, 'CS003', null, 'EP-020: a loser that re-read the state answers CS003, never both apply');
select is(tests.evs(31), 'resolved:in_progress>resolved', 'EP-020: one history row');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'Take', 'open', null, null) $$, '22023', null, 'EP-019: a capitalised action is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, ' take', 'open', null, null) $$, '22023', null, 'EP-019: a padded action is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'take ', 'open', null, null) $$, '22023', null, 'EP-019: a trailing-space action is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'ｔａｋｅ', 'open', null, null) $$, '22023', null, 'EP-019: a full-width spelling is 22023 (no normalisation)');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, '', 'open', null, null) $$, '22023', null, 'EP-018: an empty action is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, null, 'open', null, null) $$, '22023', null, 'EP-018: a null action is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'cancel', 'open', null, null) $$, '22023', null, 'D-845: an unknown action is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'take', null, null, null) $$, '22023', null, 'EP-018: a null expected state is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'take', '', null, null) $$, '22023', null, 'EP-018: an empty expected state is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'take', 'Open', null, null) $$, '22023', null, 'EP-019: a capitalised expected state is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 32, 'take', 'archived', null, null) $$, '22023', null, 'EP-019: an unknown expected state is 22023');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', null, 'take', 'open') $$, '22023', null, 'EP-018: a null conversation id is 22023');
select is(tests.row(32), 'open|-|false|false|0', 'EP-018/EP-019: ... and the eleven refusals moved nothing');
select is(tests.evs(32), '', 'EP-018/EP-019: ... and wrote no event');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 99, 'take', 'open', null, null) $$, 'CS001', null, 'D-845: a conversation that does not exist is CS001');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'support_tenant', 255, 'take', 'open') $$, 'CS001', null, 'D-845: a DIRECT conversation is CS001 (not a support case)');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000404', 'support_tenant', 32, 'take', 'open', null, null) $$, '42501', null, 'T-12.4-11: a blocked staff member with a stale claim is refused 42501');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000405', 'support_tenant', 32, 'take', 'open', null, null) $$, '42501', null, 'T-12.4-11: a removed staff member with a stale claim is refused 42501');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000411', 'member', 32, 'take', 'open', null, null) $$, '42501', null, 'CASE-23: a member lane is refused 42501');
select throws_ok($$ select tests.act('1e350000-0000-4000-8000-000000000401', 'admin_tenant', 32, 'take', 'open', null, null) $$, '42501', null, 'T-12.4-11: a claim no live membership backs (support member claiming admin) is 42501');
select throws_ok($$ select tests.as_tenant_without_claims(); select app.chat_case_act(tests.cid(32), 'take', 'open', null, null) $$, '42501', null, 'D-845: a lane with no claims is refused 42501');
reset role;
select is(tests.row(32), 'open|-|false|false|0', 'T-12.4-11: ... and the case is still as born');

-- the signals of an action (CASE-18): three per applied action, none for a refused one
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages where event = 'chat.case' and payload->>'conversationId' = tests.cid(28)::text $$,
  ARRAY[6], 'CASE-18: two applied actions (resolve, close) on one case published six chat.case signals, three each'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages where event = 'chat.case' and payload->>'conversationId' = tests.cid(29)::text $$,
  ARRAY[0], 'EP-017: a stale or refused action published nothing'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select is((select count(*)::int from public.chat_messages where conversation_id = tests.cid(28)), 0,
  'T-12.4-16: an action wrote no message');

select ok(
  pg_get_functiondef('app.chat_case_act(uuid,text,text,uuid,uuid)'::regprocedure) like '%tenant_role() = ''admin_tenant''%'
  and pg_get_functiondef('app.chat_case_act(uuid,text,text,uuid,uuid)'::regprocedure) like '%case_assignee_invalid%',
  'T-12.4-11: the FINAL definition of app.chat_case_act carries the admin_tenant assign guard and the assignee refusal');
select ok(has_function_privilege('authenticated', 'app.chat_case_act(uuid,text,text,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'app.chat_case_act(uuid,text,text,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'app.chat_case_signal(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.chat_case_signal(uuid,uuid,uuid)', 'execute'),
  'D-845/CASE-18: the grants survived the redefinition; the signal helper has no lane grant at all');


-- ── 11. edit and history ───────────────────────────────────────────────────────────────────────
-- Plan 03 (CASE-10, CASE-12; D-810, D-811, D-812, D-845; EP-034..EP-036; T-12.4-12, T-12.4-16). `app.chat_case_edit` moves
-- category, subject and priority of a case that is not closed, writes ONE `edited` row per CHANGED field with its own from
-- and to values (the rows of one call share one instant), and publishes nothing when nothing changed. A null argument leaves
-- the field alone; `p_blank_subject` is the explicit way to clear the subject.
create or replace function tests.edit(p_staff uuid, p_role text, p_n integer, p_expected text, p_category text default null,
                                      p_subject text default null, p_blank boolean default false, p_priority text default null)
returns jsonb language plpgsql as $$
declare
  v_id uuid := tests.cid(p_n);
  v jsonb;
begin
  perform tests.as_tenant('1e350000-0000-4000-8000-000000000007', p_staff, p_role);
  begin
    v := app.chat_case_edit(v_id, p_expected, p_category, p_subject, p_blank, p_priority);
  exception when others then
    reset role;
    raise;
  end;
  reset role;
  return v;
end
$$;
create or replace function tests.facts(p_n integer) returns text language sql stable as $$
  select coalesce(c.category, '-') || '|' || coalesce(c.priority, '-') || '|' || coalesce(c.subject, '-') || '|' || c.state
    from public.chat_conversations c where c.id = tests.cid(p_n)
$$;

select tests.mkcase(41, 'open', null, 0);
select tests.mkcase(42, 'open', null, 0);
select tests.mkcase(43, 'open', null, 0);
select tests.mkcase(44, 'closed', null, 0);
select tests.mkcase(45, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(46, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(47, 'resolved', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(48, 'open', null, 0);
select tests.mkcase(49, 'open', null, 0);
select tests.mkcase(50, 'open', null, 0);
select results_eq($$ select r->>'id', r->>'state', r->>'from_state' from (select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 41, 'open', 'payment', null, false, 'high') as r) x $$, $$ values (tests.cid(41)::text, 'open'::text, 'open'::text) $$, 'D-811: the edit answers the case id and its state');
select is(tests.facts(41), 'payment|high|-|open', 'D-811: category and priority changed in one call');
select results_eq($$ select kind, field, from_value, to_value, actor_user_id::text, from_state, to_state from public.chat_case_events where conversation_id = tests.cid(41) and kind = 'edited' order by field $$, $$ values ('edited'::text, 'category'::text, 'other'::text, 'payment'::text, '1e350000-0000-4000-8000-000000000401'::text, null::text, null::text), ('edited', 'priority', 'normal', 'high', '1e350000-0000-4000-8000-000000000401', null, null) $$, 'EP-034/D-810: two edited rows, one per field, each with its own from and to value and the actor');
select is((select count(distinct created_at)::int from public.chat_case_events where conversation_id = tests.cid(41) and kind = 'edited'), 1, 'EP-034: the two rows of one call share one instant');
select is((select string_agg(kind, ',' order by created_at, id) from public.chat_case_events where conversation_id = tests.cid(41)), 'opened,edited,edited', 'EP-036: the history reads oldest first by (created_at, id), the opened row before the edits');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 42, 'open', null, 'Dúvida sobre o ingresso', false, null) $$, 'D-811: an admin sets a subject');
select results_eq($$ select field, from_value, to_value from public.chat_case_events where conversation_id = tests.cid(42) and kind = 'edited' $$, $$ values ('subject'::text, null::text, 'Dúvida sobre o ingresso'::text) $$, 'D-810: the subject change is one row, from null to the typed text');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 42, 'open', null, null, true, null) $$, 'D-812: the explicit blank clears the subject');
select is(tests.facts(42), 'other|normal|-|open', 'D-812: ... and the row has no subject');
select results_eq($$ select field, from_value, to_value from public.chat_case_events where conversation_id = tests.cid(42) and kind = 'edited' order by created_at, id $$, $$ values ('subject'::text, null::text, 'Dúvida sobre o ingresso'::text), ('subject', 'Dúvida sobre o ingresso', null) $$, 'D-810: ... as a second row from the text to null');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 42, 'open', null, null, true, null) $$, 'EP-035: blanking an already empty subject changes nothing');
select is((select count(*)::int from public.chat_case_events where conversation_id = tests.cid(42) and kind = 'edited'), 2, 'EP-035: ... and writes no third row');
select results_eq($$ select r->>'state', r->>'from_state' from (select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 43, 'open', 'other', null, false, 'normal') as r) x $$, $$ values ('open'::text, 'open'::text) $$, 'EP-035: an edit whose values equal the current ones answers the case unchanged');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 43, 'open', null, null, false, null) $$, 'EP-035: an edit with every field null is also accepted and changes nothing');
select is((select count(*)::int from public.chat_case_events where conversation_id = tests.cid(43) and kind = 'edited'), 0, 'EP-035: ... no event is written');
select is(tests.facts(43), 'other|normal|-|open', 'EP-035: ... and the row is as born');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 44, 'closed', 'payment', null, false, null) $$, 'CS003', null, 'EP-035/D-811: an edit refused on a closed case is CS003');
select is(tests.facts(44), 'other|normal|-|closed', 'D-811: ... and nothing changed');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 45, 'open', 'payment', null, false, null) $$, 'CS002', null, 'D-845: an edit that expects another state is CS002');
select is(tests.facts(45), 'other|normal|-|in_progress', 'D-845: ... and nothing changed');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 45, 'Open', 'payment', null, false, null) $$, '22023', null, 'EP-019: a capitalised expected state is 22023');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 45, null, 'payment', null, false, null) $$, '22023', null, 'EP-018: a null expected state is 22023');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', null, 'open', 'payment') $$, '22023', null, 'EP-018: a null conversation id is 22023');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 46, 'in_progress', 'events', null, false, null) $$, 'D-811: an in_progress case may be edited');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 47, 'resolved', null, null, false, 'low') $$, 'D-811: a resolved case may be edited');
select is(tests.facts(47), 'other|low|-|resolved', 'D-811: ... and stays resolved');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 48, 'open', null, repeat('a', 81), false, null) $$, '23514', null, 'D-812: an 81-code-point subject is refused by the table CHECK');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 48, 'open', null, '', false, null) $$, '23514', null, 'D-812: an empty typed subject is refused by the table CHECK');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 48, 'open', null, repeat(chr(128512), 80), false, null) $$, 'D-812: an 80-code-point emoji subject is accepted (the bound counts code points, not bytes)');
select is((select char_length(subject) from public.chat_conversations where id = tests.cid(48)), 80, 'D-812: ... and stored whole');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 49, 'open', 'billing', null, false, null) $$, '23514', null, 'D-811: a category outside the list is refused by the table CHECK');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 49, 'open', null, null, false, 'urgent') $$, '23514', null, 'D-811: a priority outside the list is refused by the table CHECK');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 49, 'open', null, 'x', true, null) $$, '22023', null, 'D-812: a typed subject together with the blank flag is 22023');
select is(tests.facts(49), 'other|normal|-|open', 'D-811: ... and the refusals moved nothing');
select is((select count(*)::int from public.chat_case_events where conversation_id = tests.cid(49) and kind = 'edited'), 0, 'T-12.4-16: ... and wrote no event');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000411', 'member', 50, 'open', 'payment', null, false, null) $$, '42501', null, 'CASE-23: a member lane calling the edit definer is refused 42501');
select tests.as_tenant('1e350000-0000-4000-8000-000000000002', '1e350000-0000-4000-8000-0000000000b3', 'support_tenant');
select throws_ok($$ select app.chat_case_edit(tests.cid(50), 'open', 'payment', null, false, null) $$, 'CS001', null, 'T-12.4-12: tenant B staff editing tenant A case is CS001');
reset role;
select is(tests.facts(50), 'other|normal|-|open', 'CASE-23: ... and the case did not move');
select lives_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000403', 'admin_tenant', 50, 'open', 'account', null, false, null) $$, 'T-12.4-12: positive control, tenant As admin edits the same case');
select throws_ok($$ select tests.edit('1e350000-0000-4000-8000-000000000401', 'support_tenant', 255, 'open', 'payment') $$, 'CS001', null, 'D-845: a DIRECT conversation is CS001');

select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select topic from realtime.messages
      where event = 'chat.case' and payload->>'conversationId' = tests.cid(41)::text
      order by topic collate "C" $$,
  $$ values ('tenant:1e350000-0000-4000-8000-000000000007:conv:' || tests.cid(41)::text),
            ('tenant:1e350000-0000-4000-8000-000000000007:support-inbox'),
            ('tenant:1e350000-0000-4000-8000-000000000007:user:' || tests.uid(41)::text) $$,
  'CASE-18: one edit of two fields published ONE signal per topic, not one per field'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages where event = 'chat.case' and payload->>'conversationId' = tests.cid(43)::text $$,
  ARRAY[0], 'EP-035: a no-op edit published nothing'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select distinct array(select jsonb_object_keys(payload) order by 1)
       from realtime.messages
      where event = 'chat.case' and payload->>'conversationId' = tests.cid(41)::text $$,
  $$ values (array['conversationId', 'id']) $$,
  'T-12.4-15: the edit signal carries exactly conversationId and the injected id, never a subject'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;

select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'app.chat_case_edit(uuid,text,text,text,boolean,text)'::regprocedure),
  'D-845: app.chat_case_edit is a security definer with search_path pinned to ""');
select ok(has_function_privilege('authenticated', 'app.chat_case_edit(uuid,text,text,text,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'app.chat_case_edit(uuid,text,text,text,boolean,text)', 'execute')
  and not has_function_privilege('public', 'app.chat_case_edit(uuid,text,text,text,boolean,text)', 'execute'),
  'D-845: authenticated can execute the edit definer; anon and public cannot');

-- ── 12. the sweep, end to end ─────────────────────────────────────────────────────────────────
-- Plan 04 (CASE-13, CASE-12, CASE-18, CASE-23; D-807, D-844, D-810; T-12.4-17..20). `app.chat_cases_auto_close` is the
-- function the kernel's hourly sweeper runs: a support case left `resolved` for 7 days is closed, silently, with a history
-- row that has no actor. The function is cross-tenant by design, so residue the local database already holds (a resolved
-- case of an earlier integration run, older than 7 days) is moved to now() first; this file rolls back.
update public.chat_conversations
   set resolved_at = now()
 where state = 'resolved' and resolved_at <= now() - interval '6 days';

select tests.mkcase(61, 'resolved', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(62, 'resolved', '1e350000-0000-4000-8000-000000000401', 0);
update public.chat_conversations set resolved_at = now() - interval '7 days' - interval '1 minute' where id = tests.cid(61);
update public.chat_conversations set resolved_at = now() - interval '6 days 23 hours' where id = tests.cid(62);

select is(app.chat_cases_auto_close(500), 1, 'D-807: one sweep closes the one case resolved 7 days and a minute ago and returns 1');
select is(tests.row(61), 'closed|1e350000-0000-4000-8000-000000000401|false|true|0',
  'D-807: the case is closed, closed_at set, resolved_at cleared, the owner kept');
select is(tests.evs(61), 'closed:resolved>closed', 'D-810: exactly one closed event, from resolved to closed');
select results_eq(
  $$ select actor_user_id is null, target_user_id is null, message_id is null, tenant_id::text
       from public.chat_case_events where conversation_id = tests.cid(61) and kind = 'closed' $$,
  $$ values (true, true, true, '1e350000-0000-4000-8000-000000000007'::text) $$,
  'D-807: the closed event has no actor, no target and no message, and sits in the case''s own tenant');
select is(tests.row(62), 'resolved|1e350000-0000-4000-8000-000000000401|true|false|0',
  'EP-039: a case resolved 6 days 23 hours ago is left alone');
select is(tests.evs(62), '', 'EP-039: ... and gets no event');

select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select topic from realtime.messages
      where event = 'chat.case' and payload->>'conversationId' = tests.cid(61)::text
      order by topic collate "C" $$,
  $$ values ('tenant:1e350000-0000-4000-8000-000000000007:conv:' || tests.cid(61)::text),
            ('tenant:1e350000-0000-4000-8000-000000000007:support-inbox'),
            ('tenant:1e350000-0000-4000-8000-000000000007:user:' || tests.uid(61)::text) $$,
  'CASE-18: the close published one chat.case signal on the conversation, one on the support inbox and one on the member''s own topic'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select distinct array(select jsonb_object_keys(payload) order by 1)
       from realtime.messages
      where event = 'chat.case' and payload->>'conversationId' = tests.cid(61)::text $$,
  $$ values (array['conversationId', 'id']) $$,
  'T-12.4-20: the close signal carries exactly conversationId and the injected id'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;
select case when current_setting('tests.now_partition') <> '' then results_eq(
  $$ select count(*)::int from realtime.messages where event = 'chat.case' and payload->>'conversationId' = tests.cid(62)::text $$,
  ARRAY[0], 'D-807: the case left alone published nothing'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;

select ok(not has_function_privilege('authenticated', 'app.chat_cases_auto_close(int)', 'execute')
  and not has_function_privilege('anon', 'app.chat_cases_auto_close(int)', 'execute')
  and not has_function_privilege('public', 'app.chat_cases_auto_close(int)', 'execute'),
  'T-12.4-18: no tenant lane, anon or public can execute the sweep');
select ok(has_function_privilege('service_role', 'app.chat_cases_auto_close(int)', 'execute'),
  'D-844: the admin lane (service_role) can execute the sweep');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
             from pg_proc p where p.oid = 'app.chat_cases_auto_close(int)'::regprocedure),
  'D-844: the sweep is a security definer with search_path pinned to ""');

-- ── 13. the sweep at its edges ────────────────────────────────────────────────────────────────
-- Plan 04 (CASE-13, CASE-12, CASE-23; D-807, D-844; EP-039..EP-042; T-12.4-17..20). Sequence, because every call of the
-- sweep acts on EVERY old resolved case of the database: idempotency and silence, the exact 7-day boundary, the batch
-- clamps, the oldest-first order with the id tiebreak, two tenants in one call, the states the sweep must never touch, the
-- lanes, and last the 5000 ceiling (the unique active-case index is dropped for it; this file rolls back).
select set_config('tests.n_events0', (select count(*)::text from public.chat_case_events), true);
select set_config('tests.n_notif0', (select count(*)::text from public.notifications where tenant_id in ('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000008')), true);
select set_config('tests.n_signals0', (select count(*)::text from realtime.messages where event = 'chat.case'), true);

-- idempotent: the case of section 12 is closed, so a second run finds nothing and writes nothing
select is(app.chat_cases_auto_close(500), 0, 'EP-040/D-807: with no resolved case old enough the sweep returns 0');
select is((select count(*)::text from public.chat_case_events), current_setting('tests.n_events0'),
  'D-807: ... and writes no event');
select is(tests.evs(61), 'closed:resolved>closed', 'D-807: the case closed by the first run has still exactly one closed event');
select case when current_setting('tests.now_partition') <> '' then is(
  (select count(*)::text from realtime.messages where event = 'chat.case'), current_setting('tests.n_signals0'),
  'EP-040: ... and publishes nothing'
) else fail('no realtime.messages partition covers now(): start the Realtime service first (it creates them); Realtime evidence never passes vacuously') end;

-- EP-039: the exact boundary, on the transaction clock (the comparison is less-than-or-equal)
select tests.mkcase(71, 'resolved', null, 0);
select tests.mkcase(72, 'resolved', null, 0);
update public.chat_conversations set resolved_at = now() - interval '7 days' where id = tests.cid(71);
update public.chat_conversations set resolved_at = now() - interval '7 days' + interval '1 minute' where id = tests.cid(72);
select is(app.chat_cases_auto_close(500), 1, 'EP-039: a case resolved exactly 7 days ago is closed, one resolved 7 days minus a minute ago is not: the call returns 1');
select is(tests.row(71), 'closed|-|false|true|0', 'EP-039: resolved exactly 7 days ago: closed');
select is(tests.row(72), 'resolved|-|true|false|0', 'EP-039: resolved 7 days minus 1 minute ago: left');
select is(tests.evs(71), 'closed:resolved>closed', 'EP-039: the boundary case has its closed event');
select is(tests.evs(72), '', 'EP-039: the case left has none');

-- EP-040: the batch clamps. A null, zero and negative batch each clamp to 1 and take the OLDEST case
select tests.mkcase(73, 'resolved', null, 0);
select tests.mkcase(74, 'resolved', null, 0);
select tests.mkcase(75, 'resolved', null, 0);
update public.chat_conversations set resolved_at = now() - interval '10 days' where id = tests.cid(73);
update public.chat_conversations set resolved_at = now() - interval '9 days' where id = tests.cid(74);
update public.chat_conversations set resolved_at = now() - interval '8 days' where id = tests.cid(75);
select is(app.chat_cases_auto_close(null), 1, 'EP-040: a null batch clamps to 1');
select is(tests.row(73) || '/' || tests.row(74) || '/' || tests.row(75), 'closed|-|false|true|0/resolved|-|true|false|0/resolved|-|true|false|0',
  'EP-040: ... and took the oldest of the three');
select is(app.chat_cases_auto_close(0), 1, 'EP-040: a zero batch clamps to 1');
select is(tests.row(74), 'closed|-|false|true|0', 'EP-040: ... and took the next oldest');
select is(app.chat_cases_auto_close(-5), 1, 'EP-040: a negative batch clamps to 1');
select is(tests.row(75), 'closed|-|false|true|0', 'EP-040: ... and took the last');
select is(tests.evs(73) || '/' || tests.evs(74) || '/' || tests.evs(75), 'closed:resolved>closed/closed:resolved>closed/closed:resolved>closed',
  'EP-040: each clamped call wrote exactly one closed event for the one case it took');

-- EP-042 (and EP-041): a batch of 1 over a backlog takes the oldest resolved_at first, the id breaking a tie
select tests.mkcase(76, 'resolved', null, 0);
select tests.mkcase(77, 'resolved', null, 0);
select tests.mkcase(78, 'resolved', null, 0);
update public.chat_conversations set resolved_at = now() - interval '12 days' where id = tests.cid(76);
update public.chat_conversations set resolved_at = now() - interval '11 days' where id in (tests.cid(77), tests.cid(78));
select is(app.chat_cases_auto_close(1), 1, 'EP-042: a batch of 1 closes one case');
select is(tests.row(76) || '/' || tests.row(77) || '/' || tests.row(78), 'closed|-|false|true|0/resolved|-|true|false|0/resolved|-|true|false|0',
  'EP-042: ... the one resolved longest ago');
select is(app.chat_cases_auto_close(1), 1, 'EP-042: the next call takes the rest, one at a time');
select is(tests.row(77) || '/' || tests.row(78), 'closed|-|false|true|0/resolved|-|true|false|0',
  'EP-042: two cases with the same resolved_at: the smaller conversation id first');
select is(app.chat_cases_auto_close(1), 1, 'EP-042: the third call closes the last');
select is(tests.row(78), 'closed|-|false|true|0', 'EP-042: ... the larger id');
select is(pg_typeof(app.chat_cases_auto_close(1))::text, 'integer', 'EP-041: the result is an integer');
select ok(pg_get_functiondef('app.chat_cases_auto_close(int)'::regprocedure) !~* '(collate|lower\(|upper\(|normalize|ilike|unaccent)',
  'EP-041: nothing in the function compares text under a collation or normalisation rule');
select ok(pg_get_functiondef('app.chat_cases_auto_close(int)'::regprocedure) like '%c.state = ''resolved''%'
  and pg_get_functiondef('app.chat_cases_auto_close(int)'::regprocedure) like '%kind = ''support''%',
  'EP-041: the state and the kind are exact lowercase literals');
select ok(pg_get_functiondef('app.chat_cases_auto_close(int)'::regprocedure) like '%least(coalesce(p_batch, 1), 5000)%',
  'EP-040: the ceiling of 5000 is in the source');

-- two tenants in one call, each closed under its own tenant id (positive control) and nothing crosses (negative)
select tests.tenant('pgtap-case-i', 'Chamado I', '1e350000-0000-4000-8000-000000000008');
select tests.auth_user('x1@case-i.local', '1e350000-0000-4000-8000-0000000000b9');
select tests.auth_user('s1@case-i.local', '1e350000-0000-4000-8000-0000000007c1');
select tests.member('1e350000-0000-4000-8000-000000000008', '1e350000-0000-4000-8000-0000000000b9');
select tests.member('1e350000-0000-4000-8000-000000000008', '1e350000-0000-4000-8000-0000000007c1', 'support_tenant');
select tests.mkcase(79, 'resolved', null, 0);
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values (tests.cid(80), '1e350000-0000-4000-8000-000000000008', 'support', '1e350000-0000-4000-8000-0000000000b9');
update public.chat_conversations set state = 'resolved', resolved_at = now() - interval '9 days' where id = tests.cid(80);
update public.chat_conversations set resolved_at = now() - interval '9 days' where id = tests.cid(79);
select is(app.chat_cases_auto_close(500), 2, 'CASE-23: one call closes a case of tenant H and a case of tenant I');
select results_eq(
  $$ select e.tenant_id::text, c.tenant_id::text, e.actor_user_id is null
       from public.chat_case_events e join public.chat_conversations c on c.id = e.conversation_id
      where e.conversation_id in (tests.cid(79), tests.cid(80)) and e.kind = 'closed'
      order by e.tenant_id::text $$,
  $$ values ('1e350000-0000-4000-8000-000000000007'::text, '1e350000-0000-4000-8000-000000000007'::text, true), ('1e350000-0000-4000-8000-000000000008'::text, '1e350000-0000-4000-8000-000000000008'::text, true) $$,
  'T-12.4-17: each closed event sits in the tenant of its own case (positive control)');
select tests.as_tenant('1e350000-0000-4000-8000-000000000008', '1e350000-0000-4000-8000-0000000007c1', 'support_tenant');
select is((select count(*)::int from public.chat_case_events where kind = 'closed' and tenant_id = '1e350000-0000-4000-8000-000000000007'::uuid), 0,
  'T-12.4-17: tenant I staff reads none of tenant H''s close events (negative control)');
select is((select count(*)::int from public.chat_case_events where kind = 'closed' and conversation_id = tests.cid(80)), 1,
  'T-12.4-17: ... and reads its own');
reset role;

-- the states and kinds the sweep must never touch, each with an old timestamp
select tests.mkcase(81, 'open', null, 0);
select tests.mkcase(82, 'in_progress', '1e350000-0000-4000-8000-000000000401', 0);
select tests.mkcase(83, 'closed', null, 0);
update public.chat_conversations set created_at = now() - interval '40 days' where id in (tests.cid(81), tests.cid(82), tests.cid(83));
update public.chat_conversations set closed_at = now() - interval '30 days' where id = tests.cid(83);
select tests.auth_user('dm@case-h.local', '1e350000-0000-4000-8000-0000000007a1');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-0000000007a1');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id, created_at)
values (tests.cid(90), '1e350000-0000-4000-8000-000000000007', 'direct', '1e350000-0000-4000-8000-0000000007a1', now() - interval '40 days');
select is(app.chat_cases_auto_close(500), 0, 'D-807: an open, an in_progress and a closed case and a direct conversation, all old, are never closed');
select is(tests.row(81) || '/' || tests.row(82) || '/' || tests.row(83),
  'open|-|false|false|0/in_progress|1e350000-0000-4000-8000-000000000401|false|false|0/closed|-|false|true|0',
  'D-807: ... and their rows are as they were');
select is((select count(*)::int from public.chat_case_events where conversation_id in (tests.cid(81), tests.cid(82), tests.cid(83), tests.cid(90)) and kind = 'closed'), 0,
  'D-807: ... with no closed event');
select is((select state from public.chat_conversations where id = tests.cid(90)), null,
  'CASE-25: the direct conversation has no state and the sweep left it so');

-- silent: no notification row, no push job, no notification code in the function
select is((select count(*)::text from public.notifications where tenant_id in ('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000008')), current_setting('tests.n_notif0'),
  'D-808/T-12.4-20: the sweeps of this file wrote no notification row');
select ok(pg_get_functiondef('app.chat_cases_auto_close(int)'::regprocedure) !~* '(notification|pgboss|push)',
  'D-808/T-12.4-20: nothing in the function can notify, queue a job or send a push');
select is((select count(*)::int from public.chat_case_events where kind = 'closed' and actor_user_id is not null
                and conversation_id in (select tests.cid(n) from generate_series(61, 80) n)), 0,
  'D-810: no closed event the sweep wrote carries an actor');

-- the lanes: execution refused for every tenant lane, allowed for the admin lane
select tests.as_tenant('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000403', 'admin_tenant');
select throws_ok($$ select app.chat_cases_auto_close(500) $$, '42501', null, 'T-12.4-18: a tenant admin lane cannot execute the sweep');
reset role;
select tests.as_tenant('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-000000000411', 'member');
select throws_ok($$ select app.chat_cases_auto_close(500) $$, '42501', null, 'T-12.4-18: a member lane cannot execute the sweep');
reset role;
set local role anon;
select throws_ok($$ select app.chat_cases_auto_close(500) $$, '42501', null, 'T-12.4-18: anon cannot execute the sweep');
reset role;
select tests.as_service();
select lives_ok($$ select app.chat_cases_auto_close(500) $$, 'D-844: the admin lane (service_role) executes it');
reset role;

-- the 5000 ceiling, functionally: 5002 resolved cases of one member (the unique active-case index dropped, rolled back
-- with the file), a batch of 6000 closes 5000 and the next call the other 2
select tests.auth_user('bulk@case-h.local', '1e350000-0000-4000-8000-0000000007b1');
select tests.member('1e350000-0000-4000-8000-000000000007', '1e350000-0000-4000-8000-0000000007b1');
drop index public.chat_conversations_one_active_case_per_member;
insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
select '1e350000-0000-4000-8000-000000000007', 'support', '1e350000-0000-4000-8000-0000000007b1' from generate_series(1, 5002);
update public.chat_conversations set state = 'resolved', resolved_at = now() - interval '20 days'
 where created_by_user_id = '1e350000-0000-4000-8000-0000000007b1';
select is(app.chat_cases_auto_close(6000), 5000, 'EP-040: a batch of 6000 clamps to 5000');
select is((select count(*)::int from public.chat_conversations where created_by_user_id = '1e350000-0000-4000-8000-0000000007b1' and state = 'resolved'), 2,
  'EP-040: ... and 2 cases are left for the next call');
select is(app.chat_cases_auto_close(6000), 2, 'EP-042: the next call takes the remaining 2');

select * from finish();
rollback;
