begin;
-- 236-chat-voice.sql — Phase 12.5 plan 04 (VOICE-01..06, VOICE-34; D-846, D-847, D-859, D-861, D-865;
-- T-12.5-10..14), executed inside Postgres. Later plans of the phase append numbered sections in ONE continuous
-- sequence (plan 07 appends sections 7 and 8, plan 08 starts at section 9).
--
-- 1. THE PATH (plan 04 task 2, VOICE-01, VOICE-03, VOICE-05; D-846, D-861): a member's voice message is stored as the
--    member lane, with its gapless seq; it reopens a resolved case, a staff voice message takes an unowned open case,
--    and any voice message on a closed case is refused with SQLSTATE CS004.
--
-- 2. CONTENT CHECKS (plan 04 task 3, VOICE-01; D-846, T-12.5-11): text, recording, both, neither, whitespace, 2000 and
--    2001 characters, 0/1/300/301 seconds, a recording with no asset and a text row with seconds, each refused 23514
--    with the right constraint name, for the table owner (so no policy stands in the way).
--
-- 3. THE POLICY MATRIX (VOICE-03; D-858, T-12.5-10): the own ready asset with an equal duration is accepted; another
--    member's, a pending, a processing, a failed, a soft-deleted, a video, a wrong-purpose, a wrong-duration, an unset-
--    duration and another tenant's asset are each refused 42501; the staff lane accepts a staff-owned asset and refuses
--    a member-owned one.
--
-- 4. SINGLE USE (VOICE-02; D-865): the same take sent twice is refused 23505 on `chat_messages_tenant_media_asset_uq`,
--    across two conversations too; the foreign key refuses an unknown asset id 23503.
--
-- 5. UNCHANGED, DIRECT AND GROUP (VOICE-04, VOICE-06; D-847, D-859): the previous text insert shape still works, no
--    lane updates or deletes a voice row, a direct and a group conversation take a recording and number it without a
--    case, and the two chat triggers read no body.
--
-- 6. CROSS-TENANT (VOICE-34; T-12.5-10): tenant B cannot back a message with tenant A's asset nor read A's voice rows,
--    and the same shape from tenant A is accepted beside it (the positive control).
--
-- 7. THE READ GATE (plan 07 task 1, VOICE-24, VOICE-25; D-858, D-867, D-868; T-12.5-24..27): `app.chat_asset_hidden` is
--    a SECURITY INVOKER function, so the chat policies decide: the sender, the case's staff and the participants of a
--    direct or group conversation are not hidden, anyone else of the tenant is; a retired recording is hidden from every
--    caller; other kinds are ignored; tenant B sees nothing of tenant A and the answer is the same for an unknown id.
--
-- 8. THE STUB (plan 07 task 1, D-867): the migration order is checked, then the kernel stub answers false.
--
-- 9. THE ORPHAN SWEEP (plan 08 task 1, VOICE-27, VOICE-34; D-844, D-856, D-869; T-12.5-31..33): `app.chat_voice_orphans_sweep`
--    soft-deletes every `ready` or `failed` voice asset older than 24 hours that no message references, in each row's own
--    tenant, oldest first, at most a clamped batch per call, and is executable by `service_role` only.
--
-- 10. THE REMOVAL PREMISES (plan 08 task 3, VOICE-37; D-868, T-12.5-34, T-12.5-36): a soft-deleted recording is `retired` for the
--    read gate at once, and a recording a message references cannot be hard-deleted (the foreign key the purge's tombstone
--    branch answers).
--
-- Fixture ids use the `1e360000-…` prefix. Like its siblings, this file ROLLS BACK.
select plan(114);

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

-- ── sections 2 to 6: the shared fixture ────────────────────────────────────────────────────────
-- A helper that inserts ONE recording message as the CURRENT role (so the policy decides), and a second tenant.
create function tests.vmsg(p_tenant uuid, p_conv uuid, p_user uuid, p_side text, p_asset uuid, p_secs int)
returns void language sql as $$
  insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
  values (p_tenant, p_conv, p_user, p_side, null, p_asset, p_secs)
$$;

select tests.tenant('pgtap-voice-b', 'Voz B', '1e360000-0000-4000-8000-000000000002');
select tests.auth_user('m1@voice-b.local', '1e360000-0000-4000-8000-0000000000b1');
select tests.member('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1');
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e360000-0000-4000-8000-0000000000c9', '1e360000-0000-4000-8000-000000000002', 'support', '1e360000-0000-4000-8000-0000000000b1');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
values ('1e360000-0000-4000-8000-0000000000c9', '1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1', 'member');

-- Assets, written as the table owner. f01..f03 and the g/h/i/j ranges are described where they are used.
-- f01 (never consumed) is the asset of every refused shape in section 2; f02 and f03 are consumed by the two accepted ones.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds) values
  ('1e360000-0000-4000-8000-000000000f01', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  ('1e360000-0000-4000-8000-000000000f02', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 1),
  ('1e360000-0000-4000-8000-000000000f03', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 300);

-- ── 2. content CHECKs (VOICE-01, T-12.5-11) ────────────────────────────────────────────────────
-- As the table owner, on c1 (open), the author being member 1. The body CHECK is named for the text cases and the
-- content CHECK for the shape cases; WITH CHECK (RLS) runs first for a lane, so a lane would hide which CHECK refused.
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', 'oi') $$,
  'VOICE-01: a text row (a body, no asset, no seconds) is accepted');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000f02', 1) $$,
  'VOICE-01: a recording of 1 second is accepted');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000f03', 300) $$,
  'VOICE-01: a recording of 300 seconds is accepted');
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', repeat('x', 2000)) $$,
  'VOICE-01: a body of 2000 characters is accepted');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', 'oi', '1e360000-0000-4000-8000-000000000f01', 7) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_content_chk"',
  'VOICE-01: a text AND a recording (no caption) is refused 23514 by chat_messages_content_chk');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member') $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_content_chk"',
  'VOICE-01: neither text nor recording is refused 23514 by chat_messages_content_chk');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', E' \t\n\r ') $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_body_chk"',
  'VOICE-01: a body of only whitespace is refused 23514 by chat_messages_body_chk');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', repeat('x', 2001)) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_body_chk"',
  'VOICE-01: a body of 2001 characters is refused 23514 by chat_messages_body_chk');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000f01', 0) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_content_chk"',
  'VOICE-01: a recording of 0 seconds is refused 23514 by chat_messages_content_chk');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000f01', 301) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_content_chk"',
  'VOICE-01: a recording of 301 seconds is refused 23514 by chat_messages_content_chk');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', null, 7) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_content_chk"',
  'VOICE-01: seconds without an asset is refused 23514 by chat_messages_content_chk');
select throws_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body, voice_seconds)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', 'oi', 7) $$,
  '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_content_chk"',
  'VOICE-01: a text row carrying seconds is refused 23514 by chat_messages_content_chk');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and conname in ('chat_messages_body_chk', 'chat_messages_content_chk') and convalidated),
  2, 'T-12.5-11: both CHECKs are validated (the body CHECK keeps its shipped name)');

-- ── 3. the policy matrix (VOICE-03, T-12.5-10) ─────────────────────────────────────────────────
-- Assets: g01 is member 1's own ready 7 s recording (accepted); the rest are refused for one reason each.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, deleted_at) values
  ('1e360000-0000-4000-8000-000000000a01', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a02', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a03', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'pending', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a04', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'processing', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a05', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'failed', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a06', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now()),
  ('1e360000-0000-4000-8000-000000000a07', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'video', 'voice', 'ready', 'video/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a08', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'attachment', 'ready', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a09', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'image', 'avatar', 'ready', 'image/png', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a0a', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a0b', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, null, null),
  ('1e360000-0000-4000-8000-000000000a0c', '1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a0d', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, null),
  ('1e360000-0000-4000-8000-000000000a0e', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, null);

select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a01', 7) $$,
  'VOICE-03: the own, ready, audio/voice asset of an equal duration is accepted (positive control)');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a02', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: another member''s ready asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a03', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: a pending asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a04', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: a processing asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a05', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: a failed asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a06', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: a soft-deleted asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a07', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: a video asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a08', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: an audio asset of another purpose is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a09', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: an image/avatar asset is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a0a', 8) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: a duration that differs by one second is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a0b', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: an asset with no stored duration is refused 42501');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a0c', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: an asset of another tenant (owned by the same user) is refused 42501');
reset role;

select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c3', '1e360000-0000-4000-8000-0000000000a3', 'staff', '1e360000-0000-4000-8000-000000000a0d', 7) $$,
  'VOICE-03: the staff lane accepts a staff-owned ready asset on a support conversation');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c3', '1e360000-0000-4000-8000-0000000000a3', 'staff', '1e360000-0000-4000-8000-000000000a0e', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: the staff lane refuses an asset a MEMBER owns');
reset role;

-- ── 4. single use (VOICE-02, D-865) ────────────────────────────────────────────────────────────
-- a01 was sent above on c1. Sending it again on c1 or on another conversation of the tenant collides on the index.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-000000000001', 'direct', '1e360000-0000-4000-8000-0000000000a1');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member'),
  ('1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member');
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a01', 7) $$,
  '23505', 'duplicate key value violates unique constraint "chat_messages_tenant_media_asset_uq"',
  'VOICE-02: the same take sent again in the same conversation is refused 23505 on chat_messages_tenant_media_asset_uq');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a01', 7) $$,
  '23505', 'duplicate key value violates unique constraint "chat_messages_tenant_media_asset_uq"',
  'VOICE-02: ... and in another conversation of the tenant');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000bad', 7) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'T-12.5-10: an unknown asset id is refused by the policy for a lane');
reset role;
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000bad', 7) $$,
  '23503', 'insert or update on table "chat_messages" violates foreign key constraint "chat_messages_media_asset_id_media_assets_id_fk"',
  'VOICE-02: the foreign key refuses an unknown asset id 23503 (the table owner, no policy)');
select is(
  (select confdeltype::text from pg_constraint where conname = 'chat_messages_media_asset_id_media_assets_id_fk'),
  'a', 'D-846: the foreign key to media_assets is NO ACTION');

-- ── 5. unchanged, direct and group (VOICE-04, VOICE-06, D-847, D-859) ──────────────────────────
-- The previous text insert shape, as the member lane and as the staff lane.
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', 'texto como antes') $$,
  'VOICE-04: the previous text insert shape is still accepted for the member lane');
reset role;
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant');
select lives_ok(
  $$ insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
     values ('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c3', '1e360000-0000-4000-8000-0000000000a3', 'staff', 'resposta como antes') $$,
  'VOICE-04: ... and for the staff lane');
reset role;

-- D-859: no lane edits or deletes a voice row. The lane has no UPDATE or DELETE privilege at all.
select ok(
  not has_table_privilege('authenticated', 'public.chat_messages', 'update')
  and not has_table_privilege('authenticated', 'public.chat_messages', 'delete'),
  'D-859: the authenticated role holds no UPDATE or DELETE on chat_messages (so no lane can edit or delete a recording)');
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select throws_ok(
  $$ update public.chat_messages set deleted_at = now() where media_asset_id = '1e360000-0000-4000-8000-000000000a01' $$,
  '42501', 'permission denied for table chat_messages', 'D-859: the member lane cannot update a voice row');
select throws_ok(
  $$ delete from public.chat_messages where media_asset_id = '1e360000-0000-4000-8000-000000000a01' $$,
  '42501', 'permission denied for table chat_messages', 'D-859: the member lane cannot delete a voice row');
reset role;
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant');
select throws_ok(
  $$ update public.chat_messages set deleted_at = now() where media_asset_id = '1e360000-0000-4000-8000-000000000a01' $$,
  '42501', 'permission denied for table chat_messages', 'D-859: the staff lane cannot update a voice row');
select throws_ok(
  $$ delete from public.chat_messages where media_asset_id = '1e360000-0000-4000-8000-000000000a01' $$,
  '42501', 'permission denied for table chat_messages', 'D-859: the staff lane cannot delete a voice row');
reset role;
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.chat_messages'::regclass and polcmd in ('w', 'd')),
  0, 'D-859: chat_messages has no UPDATE and no DELETE policy');

-- D-847, VOICE-06: a direct and a group conversation take a recording. They are never numbered and have no case.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
values ('1e360000-0000-4000-8000-0000000000d2', '1e360000-0000-4000-8000-000000000001', 'group', '1e360000-0000-4000-8000-0000000000a2');
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  ('1e360000-0000-4000-8000-0000000000d2', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member'),
  ('1e360000-0000-4000-8000-0000000000d2', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member'),
  ('1e360000-0000-4000-8000-0000000000d2', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4', 'member');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds) values
  ('1e360000-0000-4000-8000-000000000b01', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 12),
  ('1e360000-0000-4000-8000-000000000b02', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 30);
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000b01', 12) $$,
  'VOICE-06: a participant sends a recording into a direct conversation');
reset role;
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000d2', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000b02', 30) $$,
  'VOICE-06: a participant sends a recording into a group conversation');
reset role;
select results_eq(
  $$ select c.kind, m.seq, m.voice_seconds::int from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
      where m.conversation_id in ('1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-0000000000d2') order by c.kind $$,
  $$ values ('direct'::text, 1::bigint, 12), ('group'::text, 1::bigint, 30) $$,
  'VOICE-06: both are numbered by the same seq trigger, from 1');
select results_eq(
  $$ select case_number, state, owner_user_id::text from public.chat_conversations
      where id in ('1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-0000000000d2') $$,
  $$ values (null::int, null::text, null::text), (null::int, null::text, null::text) $$,
  'D-847/VOICE-06: a recording gives a direct or a group conversation no case number, state or owner');
select is(
  (select count(*)::int from public.chat_case_events where conversation_id in ('1e360000-0000-4000-8000-0000000000d1', '1e360000-0000-4000-8000-0000000000d2')),
  0, 'VOICE-06: ... and writes no case event');

-- D-861: neither chat trigger function reads a message body.
select is(
  (select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.chat_messages'::regclass and not t.tgisinternal and p.prosrc ~* 'body'),
  0, 'D-861: no trigger function of chat_messages mentions body');
select is(
  (select count(*)::int from pg_trigger t where t.tgrelid = 'public.chat_messages'::regclass and not t.tgisinternal),
  2, 'D-861: chat_messages carries exactly the two chat triggers (seq and signal)');

-- ── 6. cross-tenant (VOICE-34, T-12.5-10) ──────────────────────────────────────────────────────
-- Tenant A's member 1 owns a ready asset (x01) not yet sent; tenant B has its own member and asset (x02).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds) values
  ('1e360000-0000-4000-8000-000000000c01', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 9),
  ('1e360000-0000-4000-8000-000000000c02', '1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 9);
select tests.as_tenant('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1');
select throws_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000c9', '1e360000-0000-4000-8000-0000000000b1', 'member', '1e360000-0000-4000-8000-000000000c01', 9) $$,
  '42501', 'new row violates row-level security policy for table "chat_messages"',
  'VOICE-34: tenant B cannot back a message with tenant A''s asset');
select is(
  (select count(*)::int from public.chat_messages where media_asset_id is not null),
  0, 'VOICE-34: tenant B reads none of tenant A''s voice rows');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000c9', '1e360000-0000-4000-8000-0000000000b1', 'member', '1e360000-0000-4000-8000-000000000c02', 9) $$,
  'VOICE-34: tenant B''s own insert of the same shape with its own asset is accepted (positive control)');
reset role;
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select lives_ok(
  $$ select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000c01', 9) $$,
  'VOICE-34: tenant A''s own insert of the same shape is accepted (positive control)');
select is(
  (select count(*)::int from public.chat_messages where media_asset_id = '1e360000-0000-4000-8000-000000000c02'),
  0, 'VOICE-34: tenant A reads none of tenant B''s voice rows');
reset role;


-- ── 7. the read gate (VOICE-24, VOICE-25; D-858, D-867, D-868; T-12.5-24..27) ─────────────────
-- `app.chat_asset_hidden` is the kernel's SECOND asset seam (the 08.5 shape): a stub that answers false in the kernel
-- migration, given its body by the chat module as a SECURITY INVOKER function, so the chat tables' own policies decide.
-- `app.voice_asset_retired` is the small definer that sees a soft-deleted recording the tenant select policy hides.
-- Both helpers run the gate in a lane exactly as `withTenantTx` builds it and return to the owner afterwards.
create function tests.gate_as(p_tenant uuid, p_user uuid, p_role text, p_asset uuid) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform tests.as_tenant(p_tenant, p_user, p_role);
  v := app.chat_asset_hidden(p_asset);
  reset role;
  return v;
end
$$;
create function tests.retired_as(p_tenant uuid, p_user uuid, p_asset uuid) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform tests.as_tenant(p_tenant, p_user, 'member');
  v := app.voice_asset_retired(p_asset);
  reset role;
  return v;
end
$$;

-- Function properties.
select is((select prosecdef from pg_proc where oid = 'app.chat_asset_hidden(uuid)'::regprocedure), false,
  'D-858: app.chat_asset_hidden is SECURITY INVOKER, so the chat policies decide');
select is((select prosecdef from pg_proc where oid = 'app.voice_asset_retired(uuid)'::regprocedure), true,
  'D-868: app.voice_asset_retired is SECURITY DEFINER (it reads a row the tenant select policy hides)');
select ok((select array_to_string(proconfig, ',') like '%search_path=""%' from pg_proc where oid = 'app.chat_asset_hidden(uuid)'::regprocedure),
  'D-867: app.chat_asset_hidden has an empty search_path');
select ok((select array_to_string(proconfig, ',') like '%search_path=""%' from pg_proc where oid = 'app.voice_asset_retired(uuid)'::regprocedure),
  'D-867: app.voice_asset_retired has an empty search_path');
select ok(has_function_privilege('authenticated', 'app.chat_asset_hidden(uuid)', 'execute')
      and has_function_privilege('authenticated', 'app.voice_asset_retired(uuid)', 'execute'),
  'D-867: EXECUTE is granted to authenticated on both functions');
select ok(not has_function_privilege('anon', 'app.chat_asset_hidden(uuid)', 'execute')
      and not has_function_privilege('anon', 'app.voice_asset_retired(uuid)', 'execute'),
  'D-867: anon holds EXECUTE on neither function');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) x
            where p.oid in ('app.chat_asset_hidden(uuid)'::regprocedure, 'app.voice_asset_retired(uuid)'::regprocedure) and x.grantee = 0),
  0, 'D-867: EXECUTE is not held by PUBLIC on either function');

-- Fixtures (owner). The unsent takes (f01 of member 1), tenant B's recording (c02) and the sent ones (e1 in a support
-- case, b01 in the direct conversation, b02 in the group one) come from the sections above. 071 is a recording of
-- member 1 that WAS sent in case 1 and then retired (soft-deleted), as the account-deletion step and the orphan sweep
-- of plan 08 will do.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, deleted_at) values
  ('1e360000-0000-4000-8000-000000000071', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'deleted', 'audio/mp4', 8000, 7, now());
select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000071', 7);

-- A recording sent in a SUPPORT case (e1, member 1, case 1): its sender and the tenant's staff open it, another member does not.
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-0000000000e1'), false, 'VOICE-24: the member who sent the recording is not hidden from it (302 beside the 404s)');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant', '1e360000-0000-4000-8000-0000000000e1'), false, 'VOICE-24: the support staff of the tenant read the support case, so the recording is not hidden');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'admin_tenant', '1e360000-0000-4000-8000-0000000000e1'), false, 'VOICE-24: the admin_tenant is not hidden from a support recording either');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-0000000000e1'), true, 'T-12.5-24: a same-tenant member who is not in the case is hidden from the recording (the bare 404)');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1', 'member', '1e360000-0000-4000-8000-0000000000e1'), false, 'T-12.5-25: tenant Bs user sees nothing of tenant As recording, so the gate adds nothing (the route 404s from the missing object)');
-- Tenant B's own recording (c02, sent in B's case) beside the negative: its sender is not hidden, tenant A's member sees nothing of it.
select is(tests.gate_as('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1', 'member', '1e360000-0000-4000-8000-000000000c02'), false, 'VOICE-34: tenant Bs sender opens tenant Bs own recording (positive control)');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000c02'), false, 'VOICE-34: tenant As member sees nothing of tenant Bs recording, so the gate adds nothing (404 from the key)');
-- An UNSENT take (f01, member 1): the uploader opens it (to play it back before sending), nobody else.
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000f01'), false, 'D-858: the uploader of an unsent take is not hidden from it (the preview before sending)');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000f01'), true, 'D-858: another member is hidden from an unsent take');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant', '1e360000-0000-4000-8000-000000000f01'), true, 'D-858: staff are hidden from a members unsent take');
-- A DIRECT conversation (d1: members 1 and 2) and a GROUP one (d2: members 1, 2 and 3): only participants.
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000b01'), false, 'VOICE-24: a participant of the direct conversation is not hidden from a recording sent in it');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000b01'), false, 'VOICE-24: the other participant of the direct conversation is not hidden either');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant', '1e360000-0000-4000-8000-000000000b01'), true, 'T-12.5-27: staff who are not participants of a direct conversation are hidden from its recording');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'admin_tenant', '1e360000-0000-4000-8000-000000000b01'), true, 'T-12.5-27: the admin_tenant who is not a participant of a direct conversation is hidden too');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4', 'member', '1e360000-0000-4000-8000-000000000b01'), true, 'T-12.5-24: a member outside the direct conversation is hidden from its recording');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000b02'), false, 'VOICE-24: a participant of the group conversation is not hidden from its recording');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a4', 'member', '1e360000-0000-4000-8000-000000000b02'), false, 'VOICE-24: another participant of the group conversation is not hidden either');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a5', 'member', '1e360000-0000-4000-8000-000000000b02'), true, 'T-12.5-24: a member outside the group conversation is hidden from its recording');
-- A RETIRED recording (071, soft-deleted after it was sent): every caller is hidden at once (D-868), before the hourly purge.
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000071'), true, 'T-12.5-26: a retired recording is hidden from the member who sent it');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant', '1e360000-0000-4000-8000-000000000071'), true, 'T-12.5-26: ... from the support staff');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000071'), true, 'T-12.5-26: ... and from every other member');
select is(tests.retired_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', '1e360000-0000-4000-8000-000000000071'), true, 'D-868: app.voice_asset_retired is true for a soft-deleted voice asset of the callers tenant');
select is(tests.retired_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', '1e360000-0000-4000-8000-0000000000e1'), false, 'D-868: ... and false for a live one');
select is(tests.retired_as('1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1', '1e360000-0000-4000-8000-000000000071'), false, 'D-868: ... and false for another tenants caller (the tenant predicate)');
-- Other kinds and unknown ids: the gate ignores them (an avatar image of member 1, and an id that does not exist).
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000000a09'), false, 'D-858: an image asset is never hidden by this gate (its owner)');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000a09'), false, 'D-858: ... and not for another member either');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a3', 'support_tenant', '1e360000-0000-4000-8000-000000000a09'), false, 'D-858: ... nor for staff');
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-000000000bad'), false, 'D-858: an unknown id is not hidden by this gate (the route answers the 404 from the missing object)');

-- ── 8. the stub (VOICE-25; D-867) ──────────────────────────────────────────────────────────────
-- The kernel stub answers false and reads no table, so a project that has the media kernel and no chat module hides
-- nothing. Put the stub body back (owner, inside this rolled-back transaction) and ask the gate that hid e1 above.
-- Keep this the last GATE section: the stub stays in place until the rollback (sections 9 and 10 read no gate).
select is((select count(*)::int from supabase_migrations.schema_migrations
            where name = 'chat_asset_gate_seam'
              and version < (select version from supabase_migrations.schema_migrations where name = 'chat_voice_gate')
              and version > (select version from supabase_migrations.schema_migrations where name = 'chat_voice_messages')),
  1, 'D-867: the kernel seam migration sorts after the message table and BEFORE the chat gate body');
create or replace function app.chat_asset_hidden(p_asset uuid) returns boolean
language sql stable security invoker set search_path = '' as $$ select false $$;
select is(tests.gate_as('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a2', 'member', '1e360000-0000-4000-8000-0000000000e1'), false,
  'D-867: the neutral stub answers false for the caller the chat body hid (no chat module, nothing hidden)');

-- ── 9. the orphan sweep (VOICE-27, VOICE-34; D-844, D-856, D-869; T-12.5-31..33) ────────────────
-- Anything already eligible in this database is drained first (inside this rolled-back transaction), so the counts below
-- are about THIS file's fixtures only.
select lives_ok($$ select app.chat_voice_orphans_sweep(5000) $$, 'D-869: the sweep runs for the table owner (drains whatever the local database already holds)');
-- (a) ready 25 h unsent, (b) ready 23 h, (c) ready 25 h SENT, (d) failed 25 h, (e) an image 25 h, (f) tenant B's unsent 25 h,
-- (g) processing 25 h, (h) already deleted 25 h ago, (i) ready 24 h minus a minute.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, created_at, deleted_at) values
  ('1e360000-0000-4000-8000-000000009a01', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '25 hours', null),
  ('1e360000-0000-4000-8000-000000009a02', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '23 hours', null),
  ('1e360000-0000-4000-8000-000000009a03', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '25 hours', null),
  ('1e360000-0000-4000-8000-000000009a04', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'failed', 'audio/mp4', 8000, 7, now() - interval '25 hours', null),
  ('1e360000-0000-4000-8000-000000009a05', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'image', 'avatar', 'ready', 'image/png', 8000, null, now() - interval '25 hours', null),
  ('1e360000-0000-4000-8000-000000009a06', '1e360000-0000-4000-8000-000000000002', '1e360000-0000-4000-8000-0000000000b1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '25 hours', null),
  ('1e360000-0000-4000-8000-000000009a07', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'processing', 'audio/mp4', 8000, 7, now() - interval '25 hours', null),
  ('1e360000-0000-4000-8000-000000009a08', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'deleted', 'audio/mp4', 8000, 7, now() - interval '30 hours', now() - interval '25 hours'),
  ('1e360000-0000-4000-8000-000000009a09', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '24 hours' + interval '1 minute', null);
-- (c) is referenced by a SENT message (the table owner writes it; the lane policies are proved above).
select tests.vmsg('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000c1', '1e360000-0000-4000-8000-0000000000a1', 'member', '1e360000-0000-4000-8000-000000009a03', 7);

select is(app.chat_voice_orphans_sweep(500), 3,
  'VOICE-27/D-869: one sweep soft-deletes the three eligible unsent takes (ready a, failed d, tenant B f) and returns 3');
select results_eq(
  $$ select id::text, status, deleted_at is not null, tenant_id::text from public.media_assets
      where id in ('1e360000-0000-4000-8000-000000009a01', '1e360000-0000-4000-8000-000000009a04', '1e360000-0000-4000-8000-000000009a06') order by id $$,
  $$ values ('1e360000-0000-4000-8000-000000009a01'::text, 'deleted'::text, true, '1e360000-0000-4000-8000-000000000001'::text),
            ('1e360000-0000-4000-8000-000000009a04'::text, 'deleted'::text, true, '1e360000-0000-4000-8000-000000000001'::text),
            ('1e360000-0000-4000-8000-000000009a06'::text, 'deleted'::text, true, '1e360000-0000-4000-8000-000000000002'::text) $$,
  'T-12.5-33: the three are deleted with deleted_at set and each keeps its OWN tenant (tenant B is swept in tenant B)');
select results_eq(
  $$ select id::text, status, deleted_at is null from public.media_assets
      where id in ('1e360000-0000-4000-8000-000000009a02', '1e360000-0000-4000-8000-000000009a03', '1e360000-0000-4000-8000-000000009a05',
                   '1e360000-0000-4000-8000-000000009a07', '1e360000-0000-4000-8000-000000009a09') order by id $$,
  $$ values ('1e360000-0000-4000-8000-000000009a02'::text, 'ready'::text, true),
            ('1e360000-0000-4000-8000-000000009a03'::text, 'ready'::text, true),
            ('1e360000-0000-4000-8000-000000009a05'::text, 'ready'::text, true),
            ('1e360000-0000-4000-8000-000000009a07'::text, 'processing'::text, true),
            ('1e360000-0000-4000-8000-000000009a09'::text, 'ready'::text, true) $$,
  'D-856/T-12.5-32: the 23-hour take, the SENT 25-hour recording, the image, the processing take and the 24-hour-minus-a-minute take are untouched');
select is(
  (select deleted_at from public.media_assets where id = '1e360000-0000-4000-8000-000000009a08'), now() - interval '25 hours',
  'D-869: an asset already deleted keeps its own deleted_at (the sweep never rewrites a retired row)');
select is(app.chat_voice_orphans_sweep(500), 0, 'D-869: a second call finds nothing (idempotent: the predicate is the state)');

-- The batch: three more orphans, oldest 28 hours; a batch of 1 takes the OLDEST, 0 and null clamp to 1.
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds, created_at) values
  ('1e360000-0000-4000-8000-000000009a11', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '26 hours'),
  ('1e360000-0000-4000-8000-000000009a12', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '27 hours'),
  ('1e360000-0000-4000-8000-000000009a13', '1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1', 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7, now() - interval '28 hours');
select is(app.chat_voice_orphans_sweep(1), 1, 'EP-042: a batch of 1 soft-deletes exactly one take');
select results_eq(
  $$ select id::text, status from public.media_assets
      where id in ('1e360000-0000-4000-8000-000000009a11', '1e360000-0000-4000-8000-000000009a12', '1e360000-0000-4000-8000-000000009a13') order by id $$,
  $$ values ('1e360000-0000-4000-8000-000000009a11'::text, 'ready'::text),
            ('1e360000-0000-4000-8000-000000009a12'::text, 'ready'::text),
            ('1e360000-0000-4000-8000-000000009a13'::text, 'deleted'::text) $$,
  'D-869: ... and it is the OLDEST one (oldest first)');
select tests.as_service();
select is(app.chat_voice_orphans_sweep(0), 1, 'D-869: a batch of 0 clamps to 1, called as service_role');
reset role;
select is(app.chat_voice_orphans_sweep(null), 1, 'D-869: a null batch clamps to 1');
select is(app.chat_voice_orphans_sweep(500), 0, 'D-869: and the next call finds nothing left');

-- Privileges and shape (T-12.5-31): service_role only, a definer with an empty search_path, one 24-hour literal.
select ok(not has_function_privilege('authenticated', 'app.chat_voice_orphans_sweep(int)', 'execute')
      and not has_function_privilege('anon', 'app.chat_voice_orphans_sweep(int)', 'execute')
      and not has_function_privilege('public', 'app.chat_voice_orphans_sweep(int)', 'execute'),
  'T-12.5-31: authenticated, anon and PUBLIC cannot execute the sweep function');
select ok(has_function_privilege('service_role', 'app.chat_voice_orphans_sweep(int)', 'execute'),
  'T-12.5-31 positive control: service_role can execute it');
select tests.as_tenant('1e360000-0000-4000-8000-000000000001', '1e360000-0000-4000-8000-0000000000a1');
select throws_ok($$ select app.chat_voice_orphans_sweep(500) $$, '42501', null,
  'T-12.5-31: a tenant lane (the member role) is refused 42501');
reset role;
select ok((select prosecdef and array_to_string(proconfig, ',') like '%search_path=""%'
             from pg_proc where oid = 'app.chat_voice_orphans_sweep(int)'::regprocedure),
  'T-12.5-33: the sweep is a security definer with an empty search_path');
select is(
  (select count(*)::int from regexp_matches(pg_get_functiondef('app.chat_voice_orphans_sweep(int)'::regprocedure), 'interval ''24 hours''', 'g')),
  1, 'D-869: the 24 hours are ONE literal in the function definition');

select * from finish();
rollback;
