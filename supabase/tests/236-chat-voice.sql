begin;
-- 236-chat-voice.sql — Phase 12.5 plan 04 (VOICE-01..06, VOICE-34; D-846, D-847, D-859, D-861, D-865;
-- T-12.5-10..14), executed inside Postgres. Later plans of the phase append numbered sections in ONE continuous
-- sequence (plans 07 and 08 start at section 7).
--
-- 1. THE PATH (plan 04 task 2, VOICE-01, VOICE-03, VOICE-05; D-846, D-861): a member's voice message is stored as the
--    member lane, with its gapless seq; it reopens a resolved case, a staff voice message takes an unowned open case,
--    and any voice message on a closed case is refused with SQLSTATE CS004.
--
-- Fixture ids use the `1e360000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(9);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-voice-a', 'Voz A', '1e360000-0000-4000-8000-000000000001');
select tests.auth_user('m1@voice-a.local', '1e360000-0000-4000-8000-0000000000a1');
select tests.auth_user('m2@voice-a.local', '1e360000-0000-4000-8000-0000000000a2');
select tests.auth_user('support@voice-a.local', '1e360000-0000-4000-8000-0000000000a3');
select tests.auth_user('m3@voice-a.local', '1e360000-0000-4000-8000-0000000000a4');
select tests.auth_user('m4@voice-a.local', '1e360000-0000-4000-8000-0000000000a5');
select tests.member('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select tests.member('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2');
select tests.member('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant');
select tests.member('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4');
select tests.member('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a5');

-- Four support conversations, each born open by the insert; the participants are the members.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  ('1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-000000000001', 'support', '1e360000-0000-4000-8000-0000000000a1'),
  ('1e360000-0000-4000-8000-0000000000c2', '1e360000-0000-4000-8000-000000000001', 'support', '1e360000-0000-4000-8000-0000000000a2'),
  ('1e360000-0000-4000-8000-0000000000c3', '1e360000-0000-4000-8000-000000000001', 'support', '1e360000-0000-4000-8000-0000000000a5'),
  ('1e360000-0000-4000-8000-0000000000c4', '1e360000-0000-4000-8000-000000000001', 'support', '1e360000-0000-4000-8000-0000000000a4');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member'),
  ('1e360000-0000-4000-8000-0000000000c2', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member'),
  ('1e360000-0000-4000-8000-0000000000c3', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a5', 'member'),
  ('1e360000-0000-4000-8000-0000000000c4', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4', 'member');
-- starting states (every column of the coherence CHECK set together)
update public.chat_conversations set state = 'resolved', resolved_at = now(), owner_user_id = '1e360000-0000-4000-8000-0000000000a3'
 where id = '1e360000-0000-4000-8000-0000000000c2';
update public.chat_conversations set state = 'closed', closed_at = now()
 where id = '1e360000-0000-4000-8000-0000000000c4';

-- Ready voice assets, written as the table owner (the upload pipeline is plans 02 and 05): kind audio, purpose voice,
-- ready, 7 seconds. e1 and e2 belong to member 1, e4 to member 2, e5 and e6 to the staff user and e7 to member 3.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds) values
  ('1e360000-0000-4000-8000-0000000000e1', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  ('1e360000-0000-4000-8000-0000000000e2', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  ('1e360000-0000-4000-8000-0000000000e4', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  ('1e360000-0000-4000-8000-0000000000e5', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  ('1e360000-0000-4000-8000-0000000000e6', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  ('1e360000-0000-4000-8000-0000000000e7', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7);

-- ── 1. the path ────────────────────────────────────────────────────────────────────────────────
-- A member sends one recording on a fresh case: no body, the asset and its seconds.
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member',
        null, '1e360000-0000-4000-8000-0000000000e1', 7);
reset role;
select results_eq(
  $$ select body, media_asset_id::text, voice_seconds::int, seq, author_side
       from public.chat_messages where conversation_id = '1e360000-0000-4000-8000-0000000000c1' $$,
  $$ values (null::text, '1e360000-0000-4000-8000-0000000000e1'::text, 7, 1::bigint, 'member'::text) $$,
  'VOICE-01/VOICE-03: the member lane stores a recording with no text, its asset, its seconds and seq 1 (first message of the case)');
select is(
  (select last_seq from public.chat_conversations where id = '1e360000-0000-4000-8000-0000000000c1'),
  1::bigint, 'D-861: the conversation counter moved with the voice message');

-- A second recording on the same case is numbered 2: the sequence stays gapless.
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member',
        null, '1e360000-0000-4000-8000-0000000000e2', 7);
reset role;
select is(
  (select max(seq) from public.chat_messages where conversation_id = '1e360000-0000-4000-8000-0000000000c1'),
  2::bigint, 'D-861: a second voice message is numbered 2, gapless');

-- VOICE-05: a member voice message on a resolved case reopens it, with one reopened event.
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c2', '1e360000-0000-4000-8000-0000000000a2', 'member',
        null, '1e360000-0000-4000-8000-0000000000e4', 7);
reset role;
select results_eq(
  $$ select state, owner_user_id is null, resolved_at is null
       from public.chat_conversations where id = '1e360000-0000-4000-8000-0000000000c2' $$,
  $$ values ('open'::text, true, true) $$,
  'VOICE-05/D-861: a member voice message on a resolved case moves it to open, ownerless, resolved_at cleared');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e360000-0000-4000-8000-0000000000c2' and kind = 'reopened'),
  1, 'VOICE-05: ... with exactly one reopened event');

-- VOICE-05: a staff voice message on an open unowned case takes it.
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant');
insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c3', '1e360000-0000-4000-8000-0000000000a3', 'staff',
        null, '1e360000-0000-4000-8000-0000000000e5', 7);
reset role;
select results_eq(
  $$ select state, owner_user_id::text from public.chat_conversations where id = '1e360000-0000-4000-8000-0000000000c3' $$,
  $$ values ('in_progress'::text, '1e360000-0000-4000-8000-0000000000a3'::text) $$,
  'VOICE-05/D-861: a staff voice message on an open unowned case moves it to in_progress, owned by the author');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id = '1e360000-0000-4000-8000-0000000000c3' and kind = 'taken'),
  1, 'VOICE-05: ... with exactly one taken event');

-- VOICE-05: a voice message on a closed case is refused with CS004, for either side.
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c4', '1e360000-0000-4000-8000-0000000000a4', 'member',
             null, '1e360000-0000-4000-8000-0000000000e7', 7) $$,
  'CS004', 'case_closed', 'VOICE-05/D-861: a member voice message on a closed case is refused with SQLSTATE CS004');
reset role;
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c4', '1e360000-0000-4000-8000-0000000000a3', 'staff',
             null, '1e360000-0000-4000-8000-0000000000e6', 7) $$,
  'CS004', 'case_closed', 'VOICE-05/D-861: a staff voice message on a closed case is refused with SQLSTATE CS004');
reset role;

select * from finish();
rollback;
