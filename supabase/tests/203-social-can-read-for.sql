begin;
-- 203-social-can-read-for.sql — `app.social_can_read_for(p_user, p_author)`, the explicit-user form of the
-- social read gate, executed inside Postgres (09-14, gap G1 of 09-VERIFICATION = WR-02; SOCIAL-06; D-468,
-- D-483, D-484; T-09-51, T-09-52). Numbered 203 after 202. It is used by the notifications worker (plan 09-15)
-- to ask "may THIS recipient still read THIS author's followers posts"; the claims-based
-- `app.social_visible_author_ids()` answers the empty array in the worker lane (role `support_tenant`), so it
-- cannot serve, and the feed module may not read the social table (MOD-02).
--
-- 1. THE TRUTH TABLE, asked from the SYSTEM lane (the zero user, `support_tenant` claim), the only lane that
--    may ask about anyone: TRUE for a live follower of a live member author, the author, and a live
--    `admin_tenant`; FALSE for a stranger, an EX-follower (the edge was removed), a blocked recipient and a
--    removed recipient (the edge is still present), a blocked author and a removed author, a real
--    `support_tenant`, a blocked admin, `social` off (and TRUE again once re-enabled: nothing was deleted),
--    another tenant's lane and another tenant's ids (the tenant pin), and for a null, unknown or mismatched
--    input, a lane with no claims. It never answers null (`is(…, false)` does not pass a null).
-- 2. NO FOLLOW-GRAPH ORACLE (D-468: counts public, lists private). Any other lane gets an answer only about
--    ITSELF: a member asking whether a THIRD member follows the author gets false although the edge exists,
--    asking about itself gets the real answer, and an admin or a support lane asking about someone else gets
--    false while the system lane gets true for the same pair.
-- 3. THE POSTURE: SECURITY DEFINER, `search_path` the empty string, executable by `authenticated` and not by
--    `anon`.
--
-- Fixture ids use the `20300000-…` prefix and the tenants `pgtap-scrf-a` / `pgtap-scrf-b`. Like its siblings,
-- this file ROLLS BACK.
select plan(38);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-scrf-a', 'Can read for A', '20300000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-scrf-b', 'Can read for B', '20300000-0000-4000-8000-000000000011');
select tests.auth_user('admin@scrf-a.local', '20300000-0000-4000-8000-000000000002');
select tests.auth_user('support@scrf-a.local', '20300000-0000-4000-8000-000000000003');
select tests.auth_user('m1@scrf-a.local', '20300000-0000-4000-8000-000000000004');
select tests.auth_user('m2@scrf-a.local', '20300000-0000-4000-8000-000000000005');
select tests.auth_user('m3@scrf-a.local', '20300000-0000-4000-8000-000000000006');
select tests.auth_user('m4@scrf-a.local', '20300000-0000-4000-8000-000000000007');
select tests.auth_user('m5@scrf-a.local', '20300000-0000-4000-8000-000000000008');
select tests.auth_user('m6@scrf-a.local', '20300000-0000-4000-8000-000000000009');
select tests.auth_user('m7@scrf-a.local', '20300000-0000-4000-8000-00000000000a');
select tests.auth_user('m8@scrf-a.local', '20300000-0000-4000-8000-00000000000b');
select tests.auth_user('k@scrf-b.local', '20300000-0000-4000-8000-000000000012');
-- M1 author. M2 follower. M3 stranger. M4 ex-follower. M5 blocked follower. M6 removed follower. M7 blocked
-- author (followed by M2). M8 removed author (followed by M2).
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at) values
  ('20300000-0000-4000-8000-00000000f002', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000002', 'admin_tenant', 'active', null, null),
  ('20300000-0000-4000-8000-00000000f003', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000003', 'support_tenant', 'active', null, null),
  ('20300000-0000-4000-8000-00000000f004', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000004', 'member', 'active', null, null),
  ('20300000-0000-4000-8000-00000000f005', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000005', 'member', 'active', null, null),
  ('20300000-0000-4000-8000-00000000f006', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000006', 'member', 'active', null, null),
  ('20300000-0000-4000-8000-00000000f007', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000007', 'member', 'active', null, null),
  ('20300000-0000-4000-8000-00000000f008', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000008', 'member', 'blocked', now(), null),
  ('20300000-0000-4000-8000-00000000f009', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000009', 'member', 'active', null, now()),
  ('20300000-0000-4000-8000-00000000f00a', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-00000000000a', 'member', 'blocked', now(), null),
  ('20300000-0000-4000-8000-00000000f00b', '20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-00000000000b', 'member', 'active', null, now()),
  ('20300000-0000-4000-8000-00000000f012', '20300000-0000-4000-8000-000000000011', '20300000-0000-4000-8000-000000000012', 'member', 'active', null, null);
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('20300000-0000-4000-8000-000000000001', 'social', true),
  ('20300000-0000-4000-8000-000000000011', 'social', true);
insert into public.social_follows (tenant_id, follower_user_id, followee_user_id) values
  ('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'),
  ('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000007', '20300000-0000-4000-8000-000000000004'),
  ('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000008', '20300000-0000-4000-8000-000000000004'),
  ('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000009', '20300000-0000-4000-8000-000000000004'),
  ('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-00000000000a'),
  ('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-00000000000b');
-- M4 unfollows: the edge is removed, so M4 is an EX-follower.
delete from public.social_follows where follower_user_id = '20300000-0000-4000-8000-000000000007' and followee_user_id = '20300000-0000-4000-8000-000000000004';

-- ── 1. the truth table, from the system lane ───────────────────────────────────────────────────
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), true,
  '1: a live follower of a live member author may read (system lane)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000004', '20300000-0000-4000-8000-000000000004'), true,
  '1: the author may read their own posts');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000002', '20300000-0000-4000-8000-000000000004'), true,
  '1: a live admin_tenant may read');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000006', '20300000-0000-4000-8000-000000000004'), false,
  '1: a stranger may not read');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000007', '20300000-0000-4000-8000-000000000004'), false,
  '1: an EX-follower (the edge was removed) may not read');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000008', '20300000-0000-4000-8000-000000000004'), false,
  '1: a BLOCKED recipient may not read although the edge is present (D-484)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000009', '20300000-0000-4000-8000-000000000004'), false,
  '1: a REMOVED recipient may not read although the edge is present (D-484)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-00000000000a'), false,
  '1: nobody may read a BLOCKED author''s posts (D-484)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-00000000000b'), false,
  '1: nobody may read a REMOVED author''s posts (D-484)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000003', '20300000-0000-4000-8000-000000000004'), false,
  '1: a REAL support_tenant recipient may not read (only admin_tenant is staff-exempt)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000012'), false,
  '1: an author of another tenant is a mismatched input: false');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000012', '20300000-0000-4000-8000-000000000004'), false,
  '1: a recipient of another tenant is a mismatched input: false');
select is(app.social_can_read_for(null, '20300000-0000-4000-8000-000000000004'), false,
  '1: EP-57: a null recipient answers false, never null');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', null), false,
  '1: EP-57: a null author answers false, never null');
select is(app.social_can_read_for(null, null), false,
  '1: EP-57: two nulls answer false, never null');
select is(app.social_can_read_for('20300000-0000-4000-8000-0000000000ff', '20300000-0000-4000-8000-000000000004'), false,
  '1: EP-57: an unknown recipient answers false');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-0000000000ff'), false,
  '1: EP-57: an unknown author answers false');
reset role;
update public.memberships set status = 'blocked', blocked_at = now() where id = '20300000-0000-4000-8000-00000000f002';
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000002', '20300000-0000-4000-8000-000000000004'), false,
  '1: a BLOCKED admin_tenant may not read');
reset role;
update public.memberships set status = 'active', blocked_at = null where id = '20300000-0000-4000-8000-00000000f002';
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000002', '20300000-0000-4000-8000-000000000004'), true,
  '1: …and the admin reads again once unblocked (positive control)');
reset role;
update public.tenant_modules set enabled = false where tenant_id = '20300000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '1: social OFF: the follower may not read (D-483)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000002', '20300000-0000-4000-8000-000000000004'), false,
  '1: social OFF: even the admin may not read (D-483)');
reset role;
update public.tenant_modules set enabled = true where tenant_id = '20300000-0000-4000-8000-000000000001' and module_key = 'social';
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), true,
  '1: …and the follower reads again when social is re-enabled (nothing was deleted)');
reset role;
select tests.as_tenant('20300000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '1: another tenant''s system lane asking about tenant A''s pair: false (tenant pin, T-09-52)');
reset role;
select tests.as_tenant_without_claims();
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '1: a lane with no tenant claim: false, never null, never an error');
reset role;

-- ── 2. no follow-graph oracle (T-09-51) ────────────────────────────────────────────────────────
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000006');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '2: a stranger asking whether M2 follows M1 gets false although the edge exists');
reset role;
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000005');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), true,
  '2: M2 asking about ITSELF gets the real answer (positive control)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000004', '20300000-0000-4000-8000-000000000004'), false,
  '2: M2 asking about the author M1 reading M1 gets false (someone else)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000002', '20300000-0000-4000-8000-000000000004'), false,
  '2: M2 asking about the admin gets false (someone else)');
reset role;
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000004');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000004', '20300000-0000-4000-8000-000000000004'), true,
  '2: the author asking about themself gets true (positive control)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '2: the author cannot ask whether their follower M2 may read: false (lists are private)');
reset role;
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000002', 'admin_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '2: an admin_tenant lane asking about M2 gets false (the system lane alone may ask)');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000002', '20300000-0000-4000-8000-000000000004'), true,
  '2: …and about itself gets true (positive control)');
reset role;
select tests.as_tenant('20300000-0000-4000-8000-000000000001', '20300000-0000-4000-8000-000000000003', 'support_tenant');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000005', '20300000-0000-4000-8000-000000000004'), false,
  '2: a REAL support_tenant lane asking about M2 gets false');
select is(app.social_can_read_for('20300000-0000-4000-8000-000000000003', '20300000-0000-4000-8000-000000000004'), false,
  '2: …and about itself gets false (support is not a reader of member posts)');
reset role;

-- ── 3. the posture ─────────────────────────────────────────────────────────────────────────────
select is((select prosecdef from pg_proc where oid = to_regprocedure('app.social_can_read_for(uuid, uuid)')), true,
  '3: app.social_can_read_for is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = to_regprocedure('app.social_can_read_for(uuid, uuid)')),
  '3: app.social_can_read_for pins search_path to the empty string');
select ok(coalesce(has_function_privilege('authenticated', to_regprocedure('app.social_can_read_for(uuid, uuid)'), 'execute'), false),
  '3: authenticated may execute app.social_can_read_for');
select ok(not coalesce(has_function_privilege('anon', to_regprocedure('app.social_can_read_for(uuid, uuid)'), 'execute'), false)
          and to_regprocedure('app.social_can_read_for(uuid, uuid)') is not null,
  '3: anon may not execute app.social_can_read_for');

select * from finish();
rollback;
