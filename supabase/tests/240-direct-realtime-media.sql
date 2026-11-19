begin;
-- 240-direct-realtime-media.sql — Phase 11 plan 09 task 3 (MODER-05, CHAT-06; D-731, D-482, D-483; T-11-09, T-11-10, T-11-01),
-- executed inside Postgres. Two seams of the paired direct conversation that are not the table's own policies.
--
-- 1. THE REALTIME TOPIC (RESEARCH Open Question 4): `app.realtime_topic_allowed` for the `conv:` topic of a PAIRED direct is true
--    for its two participants and false for a third member, `admin_tenant`, `support_tenant` and a user of another tenant. The
--    function is NOT changed by this plan: with `social` off a participant's topic is still allowed, an ACCEPTED RESIDUAL (a
--    signal carries ids only and the API refuses everything while `social` is off, D-483).
--
-- 2. THE RECORDING GATE WITH THE REPORT CLAUSE (D-731, T-11-10): `app.chat_asset_hidden` of a recording sent in a paired direct is
--    not hidden for the sender and the recipient; hidden for a third member, the support staff and `admin_tenant` BEFORE any
--    report; NOT hidden for `admin_tenant` and the reporter AFTER a report row of the tenant holds its `media_asset_id`; still
--    hidden for the third member and the support staff; unchanged for another tenant's user (the gate adds nothing, the asset
--    and the report are invisible to that user); the clause matches ONE asset only; a report of ANOTHER tenant that carries the
--    id unhides nothing; and once the asset is retired every caller is hidden again, the administrator included.
--
-- 3. THE SHAPE (D-858): the gate stays SECURITY INVOKER with an empty search_path and its grants, so `content_reports_select` (the
--    reporter's own rows and `admin_tenant` for the tenant) is the single answer to "can this caller read a report of it".
--
-- Fixture ids use the `1e400000-…` prefix (`tests.d40('a1')` spells one). Like its siblings, this file ROLLS BACK.
select plan(49);

create function tests.d40(p text) returns uuid language sql immutable as
  $$ select ('1e400000-0000-4000-8000-0000000000' || p)::uuid $$;
-- The gate as a lane built exactly as `withTenantTx` builds it, answered and dropped.
create function tests.gate40(p_tenant uuid, p_user uuid, p_role text, p_asset uuid) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform tests.as_tenant(p_tenant, p_user, p_role);
  v := app.chat_asset_hidden(p_asset);
  reset role;
  return v;
end
$$;
-- The realtime topic check as a lane.
create function tests.topic40(p_tenant uuid, p_user uuid, p_role text, p_topic text) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform tests.as_tenant(p_tenant, p_user, p_role);
  v := app.realtime_topic_allowed(p_topic);
  reset role;
  return v;
end
$$;
-- Files one report as a lane and answers 'ok' or the SQLSTATE.
create function tests.rep40(p_tenant uuid, p_user uuid, p_subject uuid) returns text language plpgsql as $$
declare v_res text;
begin
  perform tests.as_tenant(p_tenant, p_user, 'member');
  begin
    perform app.content_report_create('direct_message', p_subject, 'harassment', null);
    v_res := 'ok';
  exception when others then
    v_res := sqlstate;
  end;
  reset role;
  return v_res;
end
$$;
-- How many rows of one table a lane can read: 'reports' or 'assets' (filtered to one asset id).
create function tests.visible40(p_tenant uuid, p_user uuid, p_role text, p_what text, p_asset uuid) returns int language plpgsql as $$
declare v int;
begin
  perform tests.as_tenant(p_tenant, p_user, p_role);
  if p_what = 'reports' then
    select count(*) into v from public.content_reports where media_asset_id = p_asset;
  else
    select count(*) into v from public.media_assets where id = p_asset;
  end if;
  reset role;
  return v;
end
$$;

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
-- A (`01`): a1 admin, a2 support, a3 recipient and reporter, a4 sender, a5 third member. B (`02`): b1 admin and b2 member.
-- C (`03`, `social` off): c1 and c2, one pair, for the accepted residual.
select tests.tenant('pgtap-dr-a', 'Direto A', tests.d40('01'));
select tests.tenant('pgtap-dr-b', 'Direto B', tests.d40('02'));
select tests.tenant('pgtap-dr-c', 'Direto C', tests.d40('03'));
select tests.auth_user('a1@dr-a.local', tests.d40('a1'));
select tests.auth_user('a2@dr-a.local', tests.d40('a2'));
select tests.auth_user('a3@dr-a.local', tests.d40('a3'));
select tests.auth_user('a4@dr-a.local', tests.d40('a4'));
select tests.auth_user('a5@dr-a.local', tests.d40('a5'));
select tests.auth_user('b1@dr-b.local', tests.d40('b1'));
select tests.auth_user('b2@dr-b.local', tests.d40('b2'));
select tests.auth_user('c1@dr-c.local', tests.d40('c1'));
select tests.auth_user('c2@dr-c.local', tests.d40('c2'));
select tests.member(tests.d40('01'), tests.d40('a1'), 'admin_tenant');
select tests.member(tests.d40('01'), tests.d40('a2'), 'support_tenant');
select tests.member(tests.d40('01'), tests.d40('a3'));
select tests.member(tests.d40('01'), tests.d40('a4'));
select tests.member(tests.d40('01'), tests.d40('a5'));
select tests.member(tests.d40('02'), tests.d40('b1'), 'admin_tenant');
select tests.member(tests.d40('02'), tests.d40('b2'));
select tests.member(tests.d40('03'), tests.d40('c1'));
select tests.member(tests.d40('03'), tests.d40('c2'));
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  (tests.d40('01'), 'social', true), (tests.d40('01'), 'chat', true),
  (tests.d40('02'), 'social', true), (tests.d40('02'), 'chat', true),
  (tests.d40('03'), 'social', true), (tests.d40('03'), 'chat', true);
-- the pair a3 + a4 (d1) and the pair c1 + c2 (d3)
insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id, direct_low_user_id, direct_high_user_id) values
  (tests.d40('d1'), tests.d40('01'), 'direct', tests.d40('a3'), tests.d40('a3'), tests.d40('a4')),
  (tests.d40('d3'), tests.d40('03'), 'direct', tests.d40('c1'), tests.d40('c1'), tests.d40('c2'));
insert into public.chat_participants (conversation_id, tenant_id, user_id, role) values
  (tests.d40('d1'), tests.d40('01'), tests.d40('a3'), 'member'), (tests.d40('d1'), tests.d40('01'), tests.d40('a4'), 'member'),
  (tests.d40('d3'), tests.d40('03'), tests.d40('c1'), 'member'), (tests.d40('d3'), tests.d40('03'), tests.d40('c2'), 'member');
-- Recordings of a4 (e1 the reported one, e2 never reported, e3 only "reported" by ANOTHER tenant's forged row, e4 retired after
-- its report) and an image (f1). Sent in d1 as a4's voice messages (the table owner writes them).
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, duration_seconds) values
  (tests.d40('e1'), tests.d40('01'), tests.d40('a4'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  (tests.d40('e2'), tests.d40('01'), tests.d40('a4'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  (tests.d40('e3'), tests.d40('01'), tests.d40('a4'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7),
  (tests.d40('e4'), tests.d40('01'), tests.d40('a4'), 'audio', 'voice', 'ready', 'audio/mp4', 8000, 7);
insert into public.media_assets (id, tenant_id, owner_user_id, kind, purpose, status, mime, bytes, variant_widths) values
  (tests.d40('f1'), tests.d40('01'), tests.d40('a4'), 'image', 'story', 'ready', 'image/jpeg', 1024, '{640,1080}');
insert into public.chat_messages (id, tenant_id, conversation_id, author_user_id, author_side, body, media_asset_id, voice_seconds) values
  (tests.d40('81'), tests.d40('01'), tests.d40('d1'), tests.d40('a4'), 'member', null, tests.d40('e1'), 7),
  (tests.d40('82'), tests.d40('01'), tests.d40('d1'), tests.d40('a4'), 'member', null, tests.d40('e2'), 7),
  (tests.d40('83'), tests.d40('01'), tests.d40('d1'), tests.d40('a4'), 'member', null, tests.d40('e3'), 7),
  (tests.d40('84'), tests.d40('01'), tests.d40('d1'), tests.d40('a4'), 'member', null, tests.d40('e4'), 7);

-- ── 1. the realtime topic ──────────────────────────────────────────────────────────────────────
select ok(tests.topic40(tests.d40('01'), tests.d40('a3'), 'member', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')),
  'CHAT-06: the first participant is allowed the conv topic of the paired direct');
select ok(tests.topic40(tests.d40('01'), tests.d40('a4'), 'member', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')),
  'CHAT-06: the second participant is allowed too');
select is(tests.topic40(tests.d40('01'), tests.d40('a5'), 'member', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')), false,
  'D-482: a third member is refused the topic');
select is(tests.topic40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')), false,
  'D-482: admin_tenant is refused the topic of a direct (the staff term is the support kind only)');
select is(tests.topic40(tests.d40('01'), tests.d40('a2'), 'support_tenant', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')), false,
  'D-482: support_tenant is refused it too');
select is(tests.topic40(tests.d40('02'), tests.d40('b2'), 'member', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')), false,
  'T-11-01: a user of another tenant is refused (no live membership in the topic''s tenant)');
select is(tests.topic40(tests.d40('02'), tests.d40('b1'), 'admin_tenant', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d1')), false,
  'T-11-01: another tenant''s administrator is refused too');
select is(tests.topic40(tests.d40('01'), tests.d40('a3'), 'member', 'tenant:' || tests.d40('01') || ':conv:' || tests.d40('d3')), false,
  'T-11-01 positive control beside the previous: a participant is refused the topic of ANOTHER tenant''s conversation');
select ok(tests.topic40(tests.d40('03'), tests.d40('c1'), 'member', 'tenant:' || tests.d40('03') || ':conv:' || tests.d40('d3')),
  'D-483 (accepted residual): with `social` ON the participant of the pair in tenant C reads its topic');
update public.tenant_modules set enabled = false where tenant_id = tests.d40('03') and module_key = 'social';
select ok(tests.topic40(tests.d40('03'), tests.d40('c1'), 'member', 'tenant:' || tests.d40('03') || ':conv:' || tests.d40('d3')),
  'D-483 (accepted residual, plan 09 does NOT change the function): with `social` OFF the participant is still allowed the topic; a signal carries ids only and the API refuses everything while `social` is off');
update public.tenant_modules set enabled = false where tenant_id = tests.d40('03') and module_key = 'chat';
select is(tests.topic40(tests.d40('03'), tests.d40('c1'), 'member', 'tenant:' || tests.d40('03') || ':conv:' || tests.d40('d3')), false,
  'positive control: with `chat` OFF the same topic is refused (the module gate is the one the function does apply)');

-- ── 2. the recording gate with the report clause ───────────────────────────────────────────────
-- BEFORE any report.
select is(tests.gate40(tests.d40('01'), tests.d40('a4'), 'member', tests.d40('e1')), false, 'VOICE-24: the sender is not hidden from its recording');
select is(tests.gate40(tests.d40('01'), tests.d40('a3'), 'member', tests.d40('e1')), false, 'VOICE-24: the recipient is not hidden (she can read the message)');
select is(tests.gate40(tests.d40('01'), tests.d40('a5'), 'member', tests.d40('e1')), true, 'T-11-10: a third member is hidden');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e1')), true, 'T-11-10: admin_tenant is hidden BEFORE any report');
select is(tests.gate40(tests.d40('01'), tests.d40('a2'), 'support_tenant', tests.d40('e1')), true, 'T-11-10: the support staff is hidden');
select is(tests.gate40(tests.d40('02'), tests.d40('b2'), 'member', tests.d40('e1')), false,
  'T-12.5-25: another tenant''s user is unchanged by the gate (it adds nothing; the route 404s from the missing row)');
select is(tests.visible40(tests.d40('02'), tests.d40('b1'), 'admin_tenant', 'assets', tests.d40('e1')), 0,
  'T-11-01: ... because another tenant''s administrator cannot read the asset row at all');
select is(tests.visible40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', 'reports', tests.d40('e1')), 0,
  'T-11-10: no report row carries the asset yet');

-- the report (a3 reports a4's recording) through the definer, as the lane
select is(tests.rep40(tests.d40('01'), tests.d40('a3'), tests.d40('81')), 'ok', 'D-731: the recipient reports the recording');
select is(tests.visible40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', 'reports', tests.d40('e1')), 1,
  'D-731: the administrator reads the report row that carries the asset (content_reports_select)');

-- AFTER the report.
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e1')), false,
  'T-11-10: admin_tenant is NOT hidden once a report of the tenant carries the asset (the administrator hears it through the report)');
select is(tests.gate40(tests.d40('01'), tests.d40('a3'), 'member', tests.d40('e1')), false, 'T-11-10: the reporter is still not hidden');
select is(tests.gate40(tests.d40('01'), tests.d40('a4'), 'member', tests.d40('e1')), false, 'T-11-10: the sender is still not hidden');
select is(tests.gate40(tests.d40('01'), tests.d40('a5'), 'member', tests.d40('e1')), true,
  'T-11-10: a third member is STILL hidden after the report (content_reports_select shows her no row)');
select is(tests.gate40(tests.d40('01'), tests.d40('a2'), 'support_tenant', tests.d40('e1')), true,
  'T-11-10: the support staff is STILL hidden (a staff member who is not admin_tenant reads no report)');
select is(tests.gate40(tests.d40('02'), tests.d40('b2'), 'member', tests.d40('e1')), false,
  'T-11-01: another tenant''s user is still unchanged: no report row of tenant A is visible to it');
select is(tests.visible40(tests.d40('02'), tests.d40('b1'), 'admin_tenant', 'reports', tests.d40('e1')), 0,
  'T-11-01: another tenant''s administrator reads none of tenant A''s report rows');
select is(tests.visible40(tests.d40('01'), tests.d40('a5'), 'member', 'reports', tests.d40('e1')), 0, 'T-13-21: the third member reads no report row');
select is(tests.visible40(tests.d40('01'), tests.d40('a2'), 'support_tenant', 'reports', tests.d40('e1')), 0, 'T-13-21: the support staff reads no report row');
-- the clause is about ONE asset: e2 (same pair, never reported) stays hidden from the administrator
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e2')), true,
  'T-11-10: another recording of the same pair, never reported, stays hidden from the administrator');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('f1')), false,
  'D-858 control: an image asset is never hidden by this gate');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('c1')), false,
  'D-858 control: an unknown id is not hidden by this gate (the route answers its own 404)');

-- a report of ANOTHER tenant that carries the id of tenant A's recording unhides nothing for tenant A (forged, written as the owner)
insert into public.content_reports (tenant_id, reporter_user_id, subject_type, subject_id, author_user_id, reason, media_asset_id, voice_seconds)
values (tests.d40('02'), tests.d40('b2'), 'direct_message', tests.d40('83'), tests.d40('b2'), 'spam', tests.d40('e3'), 7);
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e3')), true,
  'T-11-01: a report row of another tenant that names the asset does not unhide it for tenant A''s administrator');
select is(tests.gate40(tests.d40('01'), tests.d40('a5'), 'member', tests.d40('e3')), true,
  'T-11-01: ... nor for a third member of tenant A');
-- a RESOLVED report keeps the recording readable for the administrator (the evidence stays while the report exists)
select is(tests.rep40(tests.d40('01'), tests.d40('a3'), tests.d40('84')), 'ok', 'D-731: a second recording (e4) is reported');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e4')), false, 'T-11-10: the administrator hears e4 through its report');
update public.content_reports set status = 'dismissed', resolved_at = now(), resolved_by_user_id = tests.d40('a1')
 where subject_id = tests.d40('84');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e4')), false,
  'D-731: a resolved report still carries the asset, so the evidence of a decision stays playable while the row exists');

-- RETIRED: once the asset is soft-deleted every caller is hidden, the administrator and the reporter included (D-868)
update public.media_assets set status = 'deleted', deleted_at = now() where id in (tests.d40('e1'), tests.d40('e4'));
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e1')), true, 'D-731: a retired recording is hidden from the administrator even with its report');
select is(tests.gate40(tests.d40('01'), tests.d40('a3'), 'member', tests.d40('e1')), true, 'D-731: ... from the reporter');
select is(tests.gate40(tests.d40('01'), tests.d40('a4'), 'member', tests.d40('e1')), true, 'D-731: ... from the sender');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e4')), true, 'D-731: ... and a resolved report''s retired recording too');
select is(tests.rep40(tests.d40('01'), tests.d40('a3'), tests.d40('82')), 'ok', 'positive control: the not-retired recording (e2) is still reportable');
select is(tests.gate40(tests.d40('01'), tests.d40('a1'), 'admin_tenant', tests.d40('e2')), false, 'positive control: ... and then heard by the administrator');

-- ── 3. the shape ───────────────────────────────────────────────────────────────────────────────
select is((select prosecdef from pg_proc where oid = 'app.chat_asset_hidden(uuid)'::regprocedure), false,
  'D-858: the gate is still SECURITY INVOKER (content_reports_select is the single answer)');
select ok((select array_to_string(proconfig, ',') like '%search_path=""%' from pg_proc where oid = 'app.chat_asset_hidden(uuid)'::regprocedure),
  'D-867: ... with an empty search_path');
select ok(has_function_privilege('authenticated', 'app.chat_asset_hidden(uuid)', 'execute')
      and not has_function_privilege('anon', 'app.chat_asset_hidden(uuid)', 'execute'),
  'D-867: ... and the grants survive the replacement (authenticated yes, anon no)');
select is((select provolatile::text from pg_proc where oid = 'app.chat_asset_hidden(uuid)'::regprocedure), 's',
  'D-867: ... STABLE');
select ok((select prosrc ~ 'content_reports' from pg_proc where oid = 'app.chat_asset_hidden(uuid)'::regprocedure),
  'D-731: the body reads content_reports');

select * from finish();
rollback;
