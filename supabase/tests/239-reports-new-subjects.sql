begin;
-- 239-reports-new-subjects.sql — Phase 11 plan 09 (MODER-05, MODER-04; D-730, D-731, D-732; T-11-01, T-11-09, T-11-10,
-- T-11-23, T-11-24), executed inside Postgres. The database half of reporting FOUR more subjects: a story, a story comment,
-- a community and one direct message (text or recording).
--
-- 0. SHAPE (task 2): the two new nullable columns, no column that can hold a conversation id, no foreign key to the media
--    table (the report outlives the asset), the two new CHECKs and the widened subject CHECK, the unique arbiter.
--
-- 1. THE PATH (task 2, MODER-05; D-730, D-731): a member reports a story, a story comment, a community, a text message and
--    a voice message, and the row snapshots exactly that one item (author, excerpt, the voice columns, status `open`).
--
-- 2. THE REFUSALS (task 2, T-11-01, T-11-23; D-731): one's own item is RP001 for all four subjects; a missing, deleted,
--    another tenant's, unreadable, non-participant, support-conversation or retired-recording subject is RP002; an unknown
--    type is 22023; a repeat is 23505; a non-live or claim-less caller is 42501; the CHECKs refuse a forged type and a forged
--    voice column even to the table owner (T-11-24).
--
-- 3. COPY ONLY (task 2, D-731, T-11-09): no column of the table can hold the conversation or the counterpart, and the
--    administrator, the support staff and a third member read NO chat row of the reported direct, beside the positive
--    control that the participants still do.
--
-- 4. IDEMPOTENCY (task 3, MODER-05): the same reporter and item twice is 23505 for each of the four subjects and leaves one row.
--
-- 5. STAFF CONTENT (task 3, AD-1): an organization story and an organization community can be reported.
--
-- 6. ENCODING AND EMPTY (task 3, MODER-05): the excerpt is cut at 280 CODE POINTS (emoji, combining marks), the table refuses
--    281, a story with no caption and a community with no description snapshot an empty excerpt or the name alone, a
--    report with no note stores null and a 501-character note is refused.
--
-- 7. CROSS-TENANT (task 3, T-11-01): each of the four branches pins the tenant of the claim, with a positive control beside it.
--
-- 8. THE RECORDING GATE'S PREMISES (task 3, D-731): a report of a voice message stores the asset id and the seconds the gate
--    reads; the gate itself is proved in 240.
--
-- Fixture ids use the `1e390000-…` prefix (`tests.d39('a1')` spells one). Like its siblings, this file ROLLS BACK.
select plan(107);

create function tests.d39(p text) returns uuid language sql immutable as
  $$ select ('1e390000-0000-4000-8000-0000000000' || p)::uuid $$;
-- Files one report as `p_user` of `p_tenant` and answers 'ok' or the SQLSTATE, so one assertion can compare every refusal.
-- The lane is set OUTSIDE the exception block and dropped after it; a refusal is a subtransaction and writes nothing.
create function tests.rep39(p_tenant uuid, p_user uuid, p_type text, p_subject uuid,
                            p_reason text default 'spam', p_note text default null, p_role text default 'member')
returns text language plpgsql as $$
declare v_res text;
begin
  perform tests.as_tenant(p_tenant, p_user, p_role);
  begin
    perform app.content_report_create(p_type, p_subject, p_reason, p_note);
    v_res := 'ok';
  exception when others then
    v_res := sqlstate;
  end;
  reset role;
  return v_res;
end
$$;
-- The name of the constraint a statement violates, as the table owner ('ok' when none, '<sqlstate>' when it is not a constraint).
create function tests.cname39(p_sql text) returns text language plpgsql as $$
declare v_name text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_name = constraint_name;
  return coalesce(v_name, sqlstate);
end
$$;
-- How many chat rows a lane can read (messages, conversations, participants) of ONE conversation.
create function tests.chatrows39(p_tenant uuid, p_user uuid, p_role text, p_conv uuid) returns text language plpgsql as $$
declare v_m int; v_c int; v_p int;
begin
  perform tests.as_tenant(p_tenant, p_user, p_role);
  select count(*) into v_m from public.chat_messages where conversation_id = p_conv;
  select count(*) into v_c from public.chat_conversations where id = p_conv;
  select count(*) into v_p from public.chat_participants where conversation_id = p_conv;
  reset role;
  return v_m || '/' || v_c || '/' || v_p;
end
$$;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- Tenant A (`01`, social and chat on), tenant B (`02`, social and chat on), tenant C (`03`, chat on, social turned OFF later).
select tests.tenant('pgtap-rn-a', 'Denuncias A', tests.d39('01'));
select tests.tenant('pgtap-rn-b', 'Denuncias B', tests.d39('02'));
select tests.tenant('pgtap-rn-c', 'Denuncias C', tests.d39('03'));
-- A: a1 admin, a2 support, a3 the main reporter, a4 the author, a5 a third member (also the reporter of the second pair),
-- a6 and a8 more reporters, a7 the counterpart who is blocked later, a9 a blocked member.
-- B: b1 reporter, b2 author. C: c1 reporter, c2 author.
select tests.auth_user('a1@rn-a.local', tests.d39('a1'));
select tests.auth_user('a2@rn-a.local', tests.d39('a2'));
select tests.auth_user('a3@rn-a.local', tests.d39('a3'));
select tests.auth_user('a4@rn-a.local', tests.d39('a4'));
select tests.auth_user('a5@rn-a.local', tests.d39('a5'));
select tests.auth_user('a6@rn-a.local', tests.d39('a6'));
select tests.auth_user('a7@rn-a.local', tests.d39('a7'));
select tests.auth_user('a8@rn-a.local', tests.d39('a8'));
select tests.auth_user('a9@rn-a.local', tests.d39('a9'));
select tests.auth_user('b1@rn-b.local', tests.d39('b1'));
select tests.auth_user('b2@rn-b.local', tests.d39('b2'));
select tests.auth_user('c1@rn-c.local', tests.d39('c1'));
select tests.auth_user('c2@rn-c.local', tests.d39('c2'));
select tests.member(tests.d39('01'), tests.d39('a1'), 'admin_tenant');
select tests.member(tests.d39('01'), tests.d39('a2'), 'support_tenant');
select tests.member(tests.d39('01'), tests.d39('a3'));
select tests.member(tests.d39('01'), tests.d39('a4'));
select tests.member(tests.d39('01'), tests.d39('a5'));
select tests.member(tests.d39('01'), tests.d39('a6'));
select tests.member(tests.d39('01'), tests.d39('a7'));
select tests.member(tests.d39('01'), tests.d39('a8'));
select tests.member(tests.d39('01'), tests.d39('a9'));
select tests.member(tests.d39('02'), tests.d39('b1'));
select tests.member(tests.d39('02'), tests.d39('b2'));
select tests.member(tests.d39('03'), tests.d39('c1'));
select tests.member(tests.d39('03'), tests.d39('c2'));
update public.memberships set status = 'blocked', blocked_at = now() where tenant_id = tests.d39('01') and user_id = tests.d39('a9');
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  (tests.d39('01'), 'social', true), (tests.d39('01'), 'chat', true),
  (tests.d39('02'), 'social', true), (tests.d39('02'), 'chat', true),
  (tests.d39('03'), 'social', true), (tests.d39('03'), 'chat', true);

-- Assets: story images (f1..f9, fa..fb), two voice recordings of a4 (e1 live, e2 retired later) and one of b2 (e3).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  (tests.d39('f1'), tests.d39('01'), tests.d39('a4'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  (tests.d39('f2'), tests.d39('01'), tests.d39('a3'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  (tests.d39('f3'), tests.d39('01'), tests.d39('a4'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  (tests.d39('f4'), tests.d39('01'), tests.d39('a4'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  (tests.d39('f5'), tests.d39('01'), tests.d39('a1'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  (tests.d39('f6'), tests.d39('01'), tests.d39('a4'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}'),
  (tests.d39('fb'), tests.d39('02'), tests.d39('b2'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds) values
  (tests.d39('e1'), tests.d39('01'), tests.d39('a4'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  (tests.d39('e2'), tests.d39('01'), tests.d39('a4'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 9),
  (tests.d39('e3'), tests.d39('02'), tests.d39('b2'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 5);

-- Stories (51 a4's, 52 a3's own, 53 a4's deleted, 54 a4's with no caption, 55 the ORGANIZATION's by a1, 56 a4's with 281 emoji,
-- 5b tenant B's by b2).
insert into public.stories (id, tenant_id, author_user_id, media_asset_id, media_kind, caption, deleted_at) values
  (tests.d39('51'), tests.d39('01'), tests.d39('a4'), tests.d39('f1'), 'image', 'legenda do story', null),
  (tests.d39('52'), tests.d39('01'), tests.d39('a3'), tests.d39('f2'), 'image', 'story proprio de a3', null),
  (tests.d39('53'), tests.d39('01'), tests.d39('a4'), tests.d39('f3'), 'image', 'story apagado', now()),
  (tests.d39('54'), tests.d39('01'), tests.d39('a4'), tests.d39('f4'), 'image', '', null),
  (tests.d39('55'), tests.d39('01'), tests.d39('a1'), tests.d39('f5'), 'image', 'story da organizacao', null),
  (tests.d39('56'), tests.d39('01'), tests.d39('a4'), tests.d39('f6'), 'image', repeat('😀', 281), null),
  (tests.d39('5b'), tests.d39('02'), tests.d39('b2'), tests.d39('fb'), 'image', 'story de B', null);
-- Story comments (61 a4's on story 51, 62 a3's own, 63 a4's deleted, 65 a4's with 281 emoji, 6b tenant B's) and one POST comment
-- (66, a4's: a post_comment must never be taken for a story comment).
insert into public.feed_posts (id, tenant_id, author_user_id, caption, visibility, media_kind) values
  (tests.d39('41'), tests.d39('01'), tests.d39('a4'), 'post do a4', 'tenant', 'none');
insert into public.feed_comments (id, tenant_id, story_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind, deleted_at) values
  (tests.d39('61'), tests.d39('01'), tests.d39('51'), tests.d39('a4'), 'comentario no story', 0, null, null, null, null),
  (tests.d39('62'), tests.d39('01'), tests.d39('51'), tests.d39('a3'), 'comentario proprio de a3', 0, null, null, null, null),
  (tests.d39('63'), tests.d39('01'), tests.d39('51'), tests.d39('a4'), 'comentario apagado', 0, null, null, null, now()),
  (tests.d39('65'), tests.d39('01'), tests.d39('51'), tests.d39('a4'), repeat('😀', 281), 0, null, null, null, null),
  (tests.d39('6b'), tests.d39('02'), tests.d39('5b'), tests.d39('b2'), 'comentario de B', 0, null, null, null, null);
insert into public.feed_comments (id, tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind) values
  (tests.d39('66'), tests.d39('01'), tests.d39('41'), tests.d39('a4'), 'comentario de post', 0, null, null, null);
-- Communities (71 a4's with a description, 72 a3's own, 73 a4's deleted, 74 the ORGANIZATION's with NO description, 75 a4's with a
-- 300-character description, 7b tenant B's).
insert into public.communities (id, tenant_id, created_by_user_id, name, slug, description, kind, position, deleted_at) values
  (tests.d39('71'), tests.d39('01'), tests.d39('a4'), 'Comunidade do A4', 'do-a4', 'Sobre ela', 'member', 1000000, null),
  (tests.d39('72'), tests.d39('01'), tests.d39('a3'), 'Comunidade de A3', 'de-a3', 'minha', 'member', 1000000, null),
  (tests.d39('73'), tests.d39('01'), tests.d39('a4'), 'Apagada', 'apagada', 'x', 'member', 1000000, now()),
  (tests.d39('74'), tests.d39('01'), tests.d39('a1'), 'Oficial', 'oficial', '', 'organization', 0, null),
  (tests.d39('75'), tests.d39('01'), tests.d39('a4'), 'Longa', 'longa', repeat('d', 300), 'member', 1000000, null),
  (tests.d39('7b'), tests.d39('02'), tests.d39('b2'), 'Comunidade de B', 'de-b', 'da B', 'member', 1000000, null);

-- Direct conversations (the pair in uuid order): d1 = a3 + a4, d2 = a5 + a7, d4 = b1 + b2, d5 = c1 + c2; d3 is a SUPPORT conversation of a3.
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id) values
  (tests.d39('d1'), tests.d39('01'), 'direct', tests.d39('a3'), tests.d39('a3'), tests.d39('a4')),
  (tests.d39('d2'), tests.d39('01'), 'direct', tests.d39('a5'), tests.d39('a5'), tests.d39('a7')),
  (tests.d39('d4'), tests.d39('02'), 'direct', tests.d39('b1'), tests.d39('b1'), tests.d39('b2')),
  (tests.d39('d5'), tests.d39('03'), 'direct', tests.d39('c1'), tests.d39('c1'), tests.d39('c2'));
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id) values
  (tests.d39('d3'), tests.d39('01'), 'support', tests.d39('a3'));
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  (tests.d39('d1'), tests.d39('01'), tests.d39('a3'), 'member'), (tests.d39('d1'), tests.d39('01'), tests.d39('a4'), 'member'),
  (tests.d39('d2'), tests.d39('01'), tests.d39('a5'), 'member'), (tests.d39('d2'), tests.d39('01'), tests.d39('a7'), 'member'),
  (tests.d39('d3'), tests.d39('01'), tests.d39('a3'), 'member'),
  (tests.d39('d4'), tests.d39('02'), tests.d39('b1'), 'member'), (tests.d39('d4'), tests.d39('02'), tests.d39('b2'), 'member'),
  (tests.d39('d5'), tests.d39('03'), tests.d39('c1'), 'member'), (tests.d39('d5'), tests.d39('03'), tests.d39('c2'), 'member');
-- Messages (the table owner writes them; the lane policies are proved elsewhere). 81 a4's text, 82 a3's own, 84 a4's DELETED,
-- 85 a4's 281 emoji, 87 a4's combining marks, 83 and 86 a4's recordings (86's asset is retired below), 88 and 89 a7's texts in d2,
-- 8a the support case's staff message, 8b tenant B's, 8c tenant C's.
insert into public.chat_messages (id, tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds, deleted_at) values
  (tests.d39('81'), tests.d39('01'), tests.d39('d1'), tests.d39('a4'), 'member', 'ola, tudo bem?', null, null, null),
  (tests.d39('82'), tests.d39('01'), tests.d39('d1'), tests.d39('a3'), 'member', 'mensagem de a3', null, null, null),
  (tests.d39('83'), tests.d39('01'), tests.d39('d1'), tests.d39('a4'), 'member', null, tests.d39('e1'), 7, null),
  (tests.d39('84'), tests.d39('01'), tests.d39('d1'), tests.d39('a4'), 'member', 'mensagem apagada', null, null, now()),
  (tests.d39('85'), tests.d39('01'), tests.d39('d1'), tests.d39('a4'), 'member', repeat('😀', 281), null, null, null),
  (tests.d39('86'), tests.d39('01'), tests.d39('d1'), tests.d39('a4'), 'member', null, tests.d39('e2'), 9, null),
  (tests.d39('87'), tests.d39('01'), tests.d39('d1'), tests.d39('a4'), 'member', repeat('e' || chr(769), 281), null, null, null),
  (tests.d39('88'), tests.d39('01'), tests.d39('d2'), tests.d39('a7'), 'member', 'a7 escreve', null, null, null),
  (tests.d39('89'), tests.d39('01'), tests.d39('d2'), tests.d39('a7'), 'member', 'a7 escreve de novo', null, null, null),
  (tests.d39('8b'), tests.d39('02'), tests.d39('d4'), tests.d39('b2'), 'member', 'mensagem de B', null, null, null),
  (tests.d39('8c'), tests.d39('03'), tests.d39('d5'), tests.d39('c2'), 'member', 'mensagem de C', null, null, null);
insert into public.chat_messages (id, tenant_id, conversation_id, author_user_id, author_side, body) values
  (tests.d39('8a'), tests.d39('01'), tests.d39('d3'), tests.d39('a2'), 'staff', 'resposta do suporte'),
  (tests.d39('8d'), tests.d39('01'), tests.d39('d3'), tests.d39('a3'), 'member', 'pergunta ao suporte');
-- the retired recording (a4's e2) and the closed cause of the second pair and the third tenant, set AFTER the messages exist.
update public.media_assets set status = 'deleted', deleted_at = now() where id = tests.d39('e2');
update public.tenant_modules set enabled = false where tenant_id = tests.d39('03') and module_key = 'social';

-- ── 0. shape ───────────────────────────────────────────────────────────────────────────────────
select is(
  (select string_agg(attname::text, ',' order by attnum) collate "default" from pg_attribute
    where attrelid = 'public.content_reports'::regclass and attnum > 0 and not attisdropped),
  'id,tenant_id,reporter_user_id,subject_type,subject_id,author_user_id,reason,note,excerpt,status,resolved_by_user_id,resolved_at,created_at,media_asset_id,voice_seconds',
  'D-731: the table holds the two new columns and NO column that can hold a conversation id, a counterpart or another message');
select results_eq(
  $$ select attname::text collate "default", format_type(atttypid, atttypmod) collate "default", not attnotnull from pg_attribute
      where attrelid = 'public.content_reports'::regclass and attname in ('media_asset_id', 'voice_seconds') order by attname $$,
  $$ values ('media_asset_id'::text, 'uuid'::text, true), ('voice_seconds'::text, 'smallint'::text, true) $$,
  'D-731: media_asset_id is a nullable uuid and voice_seconds a nullable smallint');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.content_reports'::regclass and confrelid = 'public.media_assets'::regclass),
  0, 'D-731: no foreign key to the media table, so the report outlives the asset');
select ok(
  (select count(*) = 3 from pg_constraint
    where conrelid = 'public.content_reports'::regclass
      and conname in ('content_reports_voice_pair_chk', 'content_reports_voice_subject_chk', 'content_reports_subject_type_chk')),
  'D-730/D-731: the widened subject CHECK and the two voice CHECKs exist');
select ok(
  (select bool_and(pg_get_constraintdef(oid) ~ 'feed_post.*post_comment.*story.*story_comment.*community.*direct_message')
     from pg_constraint where conrelid = 'public.content_reports'::regclass and conname = 'content_reports_subject_type_chk'),
  'D-730: the subject CHECK lists the six values, the new four appended after the shipped two');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'content_reports_reporter_subject_uq'),
  'UNIQUE (tenant_id, reporter_user_id, subject_type, subject_id)',
  'AD-6: one report per reporter and item is a table key, the arbiter of every duplicate and of two concurrent filings');
select ok(
  (select prosecdef and 'search_path=""' = any(proconfig) from pg_proc where oid = to_regprocedure('app.content_report_create(text,uuid,text,text)')),
  'MODER-05: the replaced definer is still SECURITY DEFINER with an empty search_path');
select ok(
  has_function_privilege('authenticated', 'app.content_report_create(text,uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'app.content_report_create(text,uuid,text,text)', 'execute'),
  'MODER-05: the grants survive the replacement (authenticated yes, anon no)');

-- ── 1. the path ────────────────────────────────────────────────────────────────────────────────
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('51'), 'harassment', 'nota do story'), 'ok',
  'MODER-05: a member reports another member''s story');
select results_eq(
  $$ select subject_type, author_user_id::text, reason, note, excerpt, status, media_asset_id::text, voice_seconds::int
       from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('51') $$,
  $$ values ('story'::text, tests.d39('a4')::text, 'harassment'::text, 'nota do story'::text, 'legenda do story'::text, 'open'::text, null::text, null::int) $$,
  'MODER-05: the story report snapshots the author, the caption as the excerpt and `open`, with no voice columns');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('61'), 'offensive'), 'ok',
  'MODER-05: a member reports a comment on a story');
select results_eq(
  $$ select subject_type, author_user_id::text, note, excerpt, status, media_asset_id::text, voice_seconds::int
       from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('61') $$,
  $$ values ('story_comment'::text, tests.d39('a4')::text, null::text, 'comentario no story'::text, 'open'::text, null::text, null::int) $$,
  'MODER-05: the story comment report snapshots the author and the body, a report with no note stores null');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('71'), 'spam'), 'ok',
  'MODER-05: a member reports a member''s community');
select results_eq(
  $$ select subject_type, author_user_id::text, excerpt, status
       from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('71') $$,
  $$ values ('community'::text, tests.d39('a4')::text, E'Comunidade do A4\nSobre ela'::text, 'open'::text) $$,
  'MODER-05: the community report snapshots the creator and the name, a line break and the description');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('81'), 'harassment', 'me ofendeu'), 'ok',
  'MODER-05: a participant reports the other side''s text message');
select results_eq(
  $$ select subject_type, author_user_id::text, note, excerpt, status, media_asset_id::text, voice_seconds::int
       from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('81') $$,
  $$ values ('direct_message'::text, tests.d39('a4')::text, 'me ofendeu'::text, 'ola, tudo bem?'::text, 'open'::text, null::text, null::int) $$,
  'D-731: the text message report stores the author and the body, with no asset columns');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('83'), 'sexual_violent'), 'ok',
  'D-731: a participant reports the other side''s voice message');
select results_eq(
  $$ select subject_type, author_user_id::text, excerpt, media_asset_id::text, voice_seconds::int
       from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('83') $$,
  $$ values ('direct_message'::text, tests.d39('a4')::text, ''::text, tests.d39('e1')::text, 7) $$,
  'D-731: a voice message report stores excerpt = empty, the asset id and the stored length (a reference, not a second file)');
select is(
  (select count(*)::int from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id in
    (tests.d39('51'), tests.d39('61'), tests.d39('71'), tests.d39('81'), tests.d39('83'))),
  5, 'MODER-05: five reports, one row for each subject');
select results_eq(
  $$ select count(*)::int, count(distinct subject_id)::int from public.content_reports where reporter_user_id = tests.d39('a3') $$,
  $$ values (5, 5) $$,
  'D-731: nothing else was stored by the five filings (no row for the conversation, the counterpart or another message)');

-- ── 2. the refusals ────────────────────────────────────────────────────────────────────────────
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('52')), 'RP001', 'D-731: one''s own story is RP001');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('62')), 'RP001', 'D-731: one''s own story comment is RP001');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('72')), 'RP001', 'D-731: one''s own community is RP001');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('82')), 'RP001', 'D-731: one''s own message is RP001');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', gen_random_uuid()), 'RP002', 'D-731: a missing story is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('53')), 'RP002', 'D-731: a deleted story is RP002 (the same code, no existence oracle)');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', gen_random_uuid()), 'RP002', 'D-731: a missing story comment is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('63')), 'RP002', 'D-731: a deleted story comment is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('66')), 'RP002',
  'D-731: a comment on a POST is not a story comment (RP002), though its author is someone else');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', gen_random_uuid()), 'RP002', 'D-731: a missing community is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('73')), 'RP002', 'D-731: a deleted community is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', gen_random_uuid()), 'RP002', 'D-731: a missing message is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('84')), 'RP002', 'D-731: a deleted message is RP002');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('86')), 'RP002',
  'D-731: a recording that is already retired is RP002 (there is nothing to judge)');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('8a')), 'RP002',
  'D-731: a message of a SUPPORT conversation (staff''s, in the reporter''s own case) is RP002: only paired directs are reported here');
select is(tests.rep39(tests.d39('01'), tests.d39('a5'), 'direct_message', tests.d39('81')), 'RP002',
  'T-11-23: a member who is not a participant of the pair cannot report its message (RP002, the same answer as a miss)');
select is(tests.rep39(tests.d39('01'), tests.d39('a2'), 'direct_message', tests.d39('81'), 'spam', null, 'support_tenant'), 'RP002',
  'T-11-23: a support staff member cannot report a direct message either');
select is(tests.rep39(tests.d39('01'), tests.d39('a1'), 'direct_message', tests.d39('81'), 'spam', null, 'admin_tenant'), 'RP002',
  'T-11-23: nor can the administrator, who is no participant');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'reel', tests.d39('51')), '22023', 'MODER-05: an unknown type is still 22023');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('51')), '23505', 'AD-6: a repeat of the same story is 23505');
select is(tests.rep39(tests.d39('01'), tests.d39('a9'), 'story', tests.d39('51')), '42501', 'MODER-05: a blocked member is refused 42501');
select is(tests.rep39(tests.d39('01'), tests.d39('b1'), 'story', tests.d39('51')), '42501',
  'MODER-05: a user with no membership in the tenant is refused 42501');
select tests.as_tenant_without_claims();
select throws_ok($$ select app.content_report_create('story', '1e390000-0000-4000-8000-000000000051', 'spam', null) $$, '42501', null,
  'MODER-05: a lane with no claims is refused 42501');
reset role;
-- the second pair after the administrator blocks a7: the earlier message is reported (positive control), the later one is refused
select is(tests.rep39(tests.d39('01'), tests.d39('a5'), 'direct_message', tests.d39('88')), 'ok',
  'D-721 positive control: a5 reports a7''s message while the pair is readable');
update public.memberships set blocked_at = now(), status = 'blocked' where tenant_id = tests.d39('01') and user_id = tests.d39('a7');
select is(tests.rep39(tests.d39('01'), tests.d39('a5'), 'direct_message', tests.d39('89')), 'RP002',
  'D-721: once the administrator blocked the counterpart the pair is unreadable and the message is RP002 (no oracle)');
update public.memberships set blocked_at = null, status = 'active' where tenant_id = tests.d39('01') and user_id = tests.d39('a7');
select is(tests.rep39(tests.d39('01'), tests.d39('a5'), 'direct_message', tests.d39('89')), 'ok',
  'D-721 positive control: the same message is reportable again once the block is lifted');
select is(tests.rep39(tests.d39('03'), tests.d39('c1'), 'direct_message', tests.d39('8c')), 'RP002',
  'D-483: with `social` off for the tenant a message cannot be reported (RP002)');
update public.tenant_modules set enabled = true where tenant_id = tests.d39('03') and module_key = 'social';
select is(tests.rep39(tests.d39('03'), tests.d39('c1'), 'direct_message', tests.d39('8c')), 'ok',
  'D-483 positive control: the same message is reportable with `social` on');
-- the table refuses a forged type and a forged voice column even to the owner (T-11-24)
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'reel', gen_random_uuid(), gen_random_uuid(), 'spam') $$),
  'content_reports_subject_type_chk', 'T-11-24: an unknown subject type is refused by the subject CHECK');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, media_asset_id)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'direct_message', gen_random_uuid(), gen_random_uuid(), 'spam', gen_random_uuid()) $$),
  'content_reports_voice_pair_chk', 'T-11-24: an asset id without the seconds is refused by the pair CHECK');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, voice_seconds)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'direct_message', gen_random_uuid(), gen_random_uuid(), 'spam', 7) $$),
  'content_reports_voice_pair_chk', 'T-11-24: seconds without an asset id are refused by the pair CHECK');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, media_asset_id, voice_seconds)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'direct_message', gen_random_uuid(), gen_random_uuid(), 'spam', gen_random_uuid(), 0) $$),
  'content_reports_voice_pair_chk', 'T-11-24: 0 seconds are refused');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, media_asset_id, voice_seconds)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'direct_message', gen_random_uuid(), gen_random_uuid(), 'spam', gen_random_uuid(), 301) $$),
  'content_reports_voice_pair_chk', 'T-11-24: 301 seconds are refused');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, media_asset_id, voice_seconds)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'feed_post', gen_random_uuid(), gen_random_uuid(), 'spam', gen_random_uuid(), 7) $$),
  'content_reports_voice_subject_chk', 'T-11-24: an asset on any subject but a direct message is refused by the subject CHECK');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, media_asset_id, voice_seconds)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'direct_message', gen_random_uuid(), gen_random_uuid(), 'spam', gen_random_uuid(), 300) $$),
  'ok', 'T-11-24 positive control: an asset and 300 seconds on a direct message are accepted');

-- ── 3. copy only ───────────────────────────────────────────────────────────────────────────────
-- Reports of the d1 messages exist (81 and 83). The administrator, the support staff and a third member read NO row of the conversation.
select is(tests.chatrows39(tests.d39('01'), tests.d39('a1'), 'admin_tenant', tests.d39('d1')), '0/0/0',
  'D-731/D-482: admin_tenant reads no message, conversation or participant of the reported direct');
select is(tests.chatrows39(tests.d39('01'), tests.d39('a2'), 'support_tenant', tests.d39('d1')), '0/0/0',
  'D-731/D-482: support_tenant reads none of them either');
select is(tests.chatrows39(tests.d39('01'), tests.d39('a5'), 'member', tests.d39('d1')), '0/0/0',
  'D-731: a third member reads none of them');
select is(tests.chatrows39(tests.d39('01'), tests.d39('a3'), 'member', tests.d39('d1')), '7/1/1',
  'positive control: the reporter, a participant, still reads the messages (seven, the deleted one included), the conversation and her participant row');
select is(tests.chatrows39(tests.d39('01'), tests.d39('a4'), 'member', tests.d39('d1')), '7/1/1',
  'positive control: the reported author, the other participant, reads the same');
select tests.as_tenant(tests.d39('01'), tests.d39('a1'), 'admin_tenant');
select is((select count(*)::int from public.content_reports where subject_id in (tests.d39('81'), tests.d39('83'))), 2,
  'D-731: the administrator reads the two REPORT rows of the tenant (the excerpt and the asset reference) and nothing of the conversation');
reset role;
select tests.as_tenant(tests.d39('01'), tests.d39('a4'), 'member');
select is((select count(*)::int from public.content_reports), 0, 'T-13-21: the reported author reads no report at all');
reset role;
select tests.as_tenant(tests.d39('01'), tests.d39('a2'), 'support_tenant');
select is((select count(*)::int from public.content_reports), 0, 'T-13-21: the support staff reads no report at all');
reset role;

-- ── 4. idempotency (one row for each subject, the unique key is the arbiter) ───────────────────
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('61')), '23505', 'AD-6: a repeat of the story comment is 23505');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('71')), '23505', 'AD-6: a repeat of the community is 23505');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('81')), '23505', 'AD-6: a repeat of the message is 23505');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('83')), '23505', 'AD-6: a repeat of the voice message is 23505');
select is(
  (select count(*)::int from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id in
    (tests.d39('51'), tests.d39('61'), tests.d39('71'), tests.d39('81'), tests.d39('83'))),
  5, 'AD-6: still exactly one row for each of the five items after the repeats');
select is(tests.rep39(tests.d39('01'), tests.d39('a6'), 'story', tests.d39('51')), 'ok',
  'AD-6 adjacency: ANOTHER reporter of the same story files its own row (the key includes the reporter)');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('55')), 'ok',
  'AD-6 adjacency: the same reporter files a DIFFERENT story');

-- ── 5. staff content is reportable (AD-1) ──────────────────────────────────────────────────────
select results_eq(
  $$ select subject_type, author_user_id::text, excerpt from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('55') $$,
  $$ values ('story'::text, tests.d39('a1')::text, 'story da organizacao'::text) $$,
  'AD-1: an organization story (the administrator''s) is reported with the administrator as the author');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('74')), 'ok',
  'AD-1: an organization community is reportable');
select results_eq(
  $$ select subject_type, author_user_id::text, excerpt from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('74') $$,
  $$ values ('community'::text, tests.d39('a1')::text, 'Oficial'::text) $$,
  'MODER-05 (empty): a community with no description snapshots the name ALONE (no trailing line break)');

-- ── 6. encoding and empty ──────────────────────────────────────────────────────────────────────
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('54')), 'ok', 'MODER-05 (empty): a story with no caption is reported');
select results_eq(
  $$ select excerpt, note from public.content_reports where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('54') $$,
  $$ values (''::text, null::text) $$,
  'MODER-05 (empty): the excerpt of a story with no caption is empty and the missing note is null');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('56')), 'ok', 'MODER-05 (encoding): a story with 281 emoji is reported');
select results_eq(
  $$ select char_length(excerpt), excerpt = repeat('😀', 280) from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('56') $$,
  $$ values (280, true) $$,
  'MODER-05 (encoding): the caption is cut at 280 CODE POINTS, no surrogate pair is split');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('65')), 'ok', 'MODER-05 (encoding): a story comment of 281 emoji is reported');
select results_eq(
  $$ select char_length(excerpt), excerpt = repeat('😀', 280) from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('65') $$,
  $$ values (280, true) $$,
  'MODER-05 (encoding): the comment body is cut at 280 code points');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('85')), 'ok', 'MODER-05 (encoding): a message of 281 emoji is reported');
select results_eq(
  $$ select char_length(excerpt), excerpt = repeat('😀', 280) from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('85') $$,
  $$ values (280, true) $$,
  'MODER-05 (encoding): the message body is cut at 280 code points');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('87')), 'ok', 'MODER-05 (encoding): a message of combining marks is reported');
select results_eq(
  $$ select char_length(excerpt), excerpt = repeat('e' || chr(769), 140) from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('87') $$,
  $$ values (280, true) $$,
  'MODER-05 (encoding): combining marks are cut at 280 code points (140 letter-and-accent pairs here, none split)');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('75')), 'ok', 'MODER-05 (encoding): a community with a long description is reported');
select results_eq(
  $$ select char_length(excerpt), excerpt = left('Longa' || E'\n' || repeat('d', 300), 280) from public.content_reports
      where reporter_user_id = tests.d39('a3') and subject_id = tests.d39('75') $$,
  $$ values (280, true) $$,
  'MODER-05: the community excerpt is the name, a line break and the description, cut at 280');
select is(tests.cname39($$ insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, excerpt)
    values ('1e390000-0000-4000-8000-000000000003', '1e390000-0000-4000-8000-0000000000c1', 'story', gen_random_uuid(), gen_random_uuid(), 'spam', repeat('😀', 281)) $$),
  'content_reports_excerpt_len_chk', 'MODER-05 (encoding): the table refuses an excerpt of 281 code points');
select is(tests.rep39(tests.d39('01'), tests.d39('a6'), 'story_comment', tests.d39('61'), 'other', repeat('n', 501)), '23514',
  'MODER-05: a note of 501 characters is refused (23514), as in Phase 13');
select is(tests.rep39(tests.d39('01'), tests.d39('a6'), 'story_comment', tests.d39('61'), 'other', ''), 'ok', 'MODER-05: an empty note is accepted');
select is((select note from public.content_reports where reporter_user_id = tests.d39('a6') and subject_id = tests.d39('61')), null,
  'MODER-05 (empty): an empty note is stored as null');
select is(tests.rep39(tests.d39('01'), tests.d39('a8'), 'story_comment', tests.d39('61'), 'other', repeat('é', 500)), 'ok',
  'MODER-05: a note of 500 two-byte characters is accepted (the cap counts characters)');

-- ── 7. cross-tenant: each branch pins the tenant of the claim, with a positive control ─────────
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story', tests.d39('5b')), 'RP002', 'T-11-01: tenant A cannot report tenant B''s story');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'story_comment', tests.d39('6b')), 'RP002', 'T-11-01: ... nor its story comment');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'community', tests.d39('7b')), 'RP002', 'T-11-01: ... nor its community');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('8b')), 'RP002', 'T-11-01: ... nor its message');
select is(tests.rep39(tests.d39('02'), tests.d39('b1'), 'story', tests.d39('5b')), 'ok', 'T-11-01 positive control: tenant B''s member reports its story');
select is(tests.rep39(tests.d39('02'), tests.d39('b1'), 'story_comment', tests.d39('6b')), 'ok', 'T-11-01 positive control: ... its story comment');
select is(tests.rep39(tests.d39('02'), tests.d39('b1'), 'community', tests.d39('7b')), 'ok', 'T-11-01 positive control: ... its community');
select is(tests.rep39(tests.d39('02'), tests.d39('b1'), 'direct_message', tests.d39('8b')), 'ok', 'T-11-01 positive control: ... its message');
select is(tests.rep39(tests.d39('02'), tests.d39('b1'), 'story', tests.d39('51')), 'RP002', 'T-11-01: tenant B cannot report tenant A''s story');
select is(tests.rep39(tests.d39('02'), tests.d39('b1'), 'direct_message', tests.d39('81')), 'RP002', 'T-11-01: ... nor its message');
select is(
  (select count(*)::int from public.content_reports where tenant_id = tests.d39('01') and reporter_user_id = tests.d39('b1')), 0,
  'T-11-01: no row was written in tenant A for tenant B''s reporter');

-- ── 8. the premises of the recording gate ──────────────────────────────────────────────────────
select results_eq(
  $$ select count(*)::int from public.content_reports where reporter_user_id = tests.d39('a3') and subject_type = 'direct_message' and media_asset_id is not null and voice_seconds is not null $$,
  $$ values (1) $$,
  'D-731: exactly the voice report carries the asset reference the gate reads (the text reports carry none)');
select is(tests.rep39(tests.d39('01'), tests.d39('a3'), 'direct_message', tests.d39('86')), 'RP002',
  'D-731: the retired recording is still unreportable (the asset is gone, the report would have nothing to play)');
select results_eq(
  $$ select count(*)::int from public.content_reports where tenant_id = tests.d39('01') and subject_type in ('story', 'story_comment', 'community', 'direct_message') and status <> 'open' $$,
  $$ values (0) $$,
  'MODER-04: no filing resolves, removes or blocks anything by itself (every new row is `open`)');
select is(
  (select count(*)::int from public.stories where id in (tests.d39('51'), tests.d39('55'), tests.d39('56')) and deleted_at is null), 3,
  'MODER-04: the reported stories are all still live (a report removes nothing)');
select is(
  (select count(*)::int from public.chat_messages where conversation_id = tests.d39('d1') and deleted_at is null), 6,
  'MODER-04: the reported messages are all still live (the one deleted row is the fixture''s own)');
select is(
  (select count(*)::int from public.member_blocks where tenant_id = tests.d39('01')), 0,
  'MODER-04: no filing blocked anybody');

select * from finish();
rollback;
