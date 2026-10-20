begin;
-- 204-access-gate.sql — Phase 09.1-02 (PAY-05, PAY-06, PAY-08, PAY-11, PAY-13, PAY-14; D-485, D-487, D-489,
-- D-491, D-492, D-494, D-496, D-497; T-09.1-03 .. T-09.1-08): `public.access_grants` and the seven SQL
-- functions that decide what an e-mail may do in a tenant, executed inside Postgres.
--
-- 1. SHAPE: the columns, the primary key, the five named indexes, and that NO function of this plan reads
--    the retiring global allowlist table (assumption-delta invariant: a gated tenant must never be bypassed
--    by the old list).
-- 2. CHECKs (23514) and uniqueness (23505): the e-mail is stored lower-case and trimmed, a manual row is
--    active|blocked, a gateway row is active|inactive and carries provider + external_ref, a manual row
--    carries neither, the provider is a lower snake FORMAT; one manual release and one manual block may
--    coexist for one e-mail (planning decision 2), two of the same kind may not.
-- 3. EXPOSURE: RLS on, NOT forced, ZERO policies, no privilege for anon or authenticated.
-- 4. `app.access_gate_on`: only the jsonb boolean true under settings.gate of an ENABLED payments row opens
--    the gate; no row, a disabled module, empty settings, false, the string "true" and the number 1 are off.
-- 5. `app.access_effective`: D-489 literally (block, any active gateway row, all-inactive gateway, manual
--    release, none) for seven e-mails, plus tenant pinning and e-mail normalisation.
-- 6. `app.access_state`: gate off -> open; live staff -> open (a DELETED staff membership is not exempt);
--    granted / blocked / cut for members; a missing user row fails closed; `membership_access_cut` and
--    `access_cut_user_ids` agree.
-- 7. The `_gated` lookups: the six original columns plus access_state, the same rows as the old functions,
--    the old functions byte for byte unchanged (expand-only).
-- 8. HARDENING by catalogue: SECURITY DEFINER, empty search_path, EXECUTE for api_user / service_role only.
--
-- Fixture ids use the `20400000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(86);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-ag-a', 'Gate A', '20400000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-ag-b', 'Gate B', '20400000-0000-4000-8000-000000000002');
-- Seven tenants for the gate truth table (section 4); the tenant named by each suffix:
--   g1 no payments row, g2 disabled + gate true, g3 empty settings, g4 gate false, g5 gate "true" (string),
--   g6 gate 1 (number), g7 gate true.
select tests.tenant('pgtap-ag-g1', 'Gate G1', '20400000-0000-4000-8000-0000000000e1');
select tests.tenant('pgtap-ag-g2', 'Gate G2', '20400000-0000-4000-8000-0000000000e2');
select tests.tenant('pgtap-ag-g3', 'Gate G3', '20400000-0000-4000-8000-0000000000e3');
select tests.tenant('pgtap-ag-g4', 'Gate G4', '20400000-0000-4000-8000-0000000000e4');
select tests.tenant('pgtap-ag-g5', 'Gate G5', '20400000-0000-4000-8000-0000000000e5');
select tests.tenant('pgtap-ag-g6', 'Gate G6', '20400000-0000-4000-8000-0000000000e6');
select tests.tenant('pgtap-ag-g7', 'Gate G7', '20400000-0000-4000-8000-0000000000e7');
insert into public.tenant_modules (tenant_id, module_key, enabled, settings) values
  ('20400000-0000-4000-8000-000000000001', 'payments', true, '{"gate": true}'),
  ('20400000-0000-4000-8000-000000000002', 'payments', true, '{"gate": true}'),
  ('20400000-0000-4000-8000-0000000000e2', 'payments', false, '{"gate": true}'),
  ('20400000-0000-4000-8000-0000000000e3', 'payments', true, '{}'),
  ('20400000-0000-4000-8000-0000000000e4', 'payments', true, '{"gate": false}'),
  ('20400000-0000-4000-8000-0000000000e5', 'payments', true, '{"gate": "true"}'),
  ('20400000-0000-4000-8000-0000000000e6', 'payments', true, '{"gate": 1}'),
  ('20400000-0000-4000-8000-0000000000e7', 'payments', true, '{"gate": true}');

-- Users. M1 has a MIXED-CASE e-mail; the access rows carry the lower-case form.
select tests.auth_user('admin@ag-a.local', '20400000-0000-4000-8000-0000000000a1');
select tests.auth_user('support@ag-a.local', '20400000-0000-4000-8000-0000000000a2');
select tests.auth_user('deladmin@ag-a.local', '20400000-0000-4000-8000-0000000000a3');
select tests.auth_user('M1@Ag-A.Local', '20400000-0000-4000-8000-0000000000b1');
select tests.auth_user('m2@ag-a.local', '20400000-0000-4000-8000-0000000000b2');
select tests.auth_user('m3@ag-a.local', '20400000-0000-4000-8000-0000000000b3');
select tests.auth_user('m4@ag-a.local', '20400000-0000-4000-8000-0000000000b4');
select tests.auth_user('m5@ag-a.local', '20400000-0000-4000-8000-0000000000b5');
select tests.auth_user('m6@ag-a.local', '20400000-0000-4000-8000-0000000000b6');
select tests.auth_user('m7@ag-a.local', '20400000-0000-4000-8000-0000000000b7');
select tests.auth_user('m8@ag-a.local', '20400000-0000-4000-8000-0000000000b8');
select tests.auth_user('m9@ag-a.local', '20400000-0000-4000-8000-0000000000b9');

-- Memberships in A: staff, M1..M9. M8 is blocked_at (reports `blocked`), M9 and the second admin are deleted.
-- M1 also belongs to B (its own state there is separate), M6 too.
insert into public.memberships (id, tenant_id, user_id, role, status, blocked_at, deleted_at) values
  ('20400000-0000-4000-8000-00000000f0a1', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a1', 'admin_tenant', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0a2', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a2', 'support_tenant', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0a3', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a3', 'admin_tenant', 'active', null, now()),
  ('20400000-0000-4000-8000-00000000f0b1', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b1', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b2', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b2', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b3', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b3', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b4', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b4', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b5', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b5', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b6', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b6', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b7', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b7', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f0b8', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b8', 'member', 'blocked', now(), null),
  ('20400000-0000-4000-8000-00000000f0b9', '20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b9', 'member', 'active', null, now()),
  ('20400000-0000-4000-8000-00000000f1b1', '20400000-0000-4000-8000-000000000002', '20400000-0000-4000-8000-0000000000b1', 'member', 'active', null, null),
  ('20400000-0000-4000-8000-00000000f1b6', '20400000-0000-4000-8000-000000000002', '20400000-0000-4000-8000-0000000000b6', 'member', 'active', null, null);

-- Access rows in A (e-mails lower-case, as the CHECK demands):
--   M1 manual active                     -> active
--   M2 gateway active                    -> active
--   M3 gateway inactive                  -> inactive
--   M4 gateway inactive + manual active  -> inactive (A-P9: the gateway outranks the release)
--   M5 manual blocked + gateway active   -> blocked
--   M6 nothing in A (but a release in B) -> none
--   M7 gateway inactive + gateway active -> active (D-494: any active row)
--   M8 manual active (so it is not cut)
insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values
  ('20400000-0000-4000-8000-000000000001', 'm1@ag-a.local', 'manual', 'active', null, null),
  ('20400000-0000-4000-8000-000000000001', 'm2@ag-a.local', 'gateway', 'active', 'fake_gw', 'r2'),
  ('20400000-0000-4000-8000-000000000001', 'm3@ag-a.local', 'gateway', 'inactive', 'fake_gw', 'r3'),
  ('20400000-0000-4000-8000-000000000001', 'm4@ag-a.local', 'gateway', 'inactive', 'fake_gw', 'r4'),
  ('20400000-0000-4000-8000-000000000001', 'm4@ag-a.local', 'manual', 'active', null, null),
  ('20400000-0000-4000-8000-000000000001', 'm5@ag-a.local', 'manual', 'blocked', null, null),
  ('20400000-0000-4000-8000-000000000001', 'm5@ag-a.local', 'gateway', 'active', 'fake_gw', 'r5'),
  ('20400000-0000-4000-8000-000000000001', 'm7@ag-a.local', 'gateway', 'inactive', 'fake_gw', 'r7a'),
  ('20400000-0000-4000-8000-000000000001', 'm7@ag-a.local', 'gateway', 'active', 'fake_gw', 'r7b'),
  ('20400000-0000-4000-8000-000000000001', 'm8@ag-a.local', 'manual', 'active', null, null),
  ('20400000-0000-4000-8000-000000000002', 'm6@ag-a.local', 'manual', 'active', null, null);

-- ── 1. shape ───────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'access_grants', 'access_grants exists');
select columns_are('public', 'access_grants', array[
  'id', 'tenant_id', 'email', 'source', 'status', 'provider', 'external_ref', 'mapping_id',
  'valid_until', 'last_event_at', 'terminal', 'created_by_user_id', 'created_at', 'updated_at'
], 'access_grants has exactly the planned columns');
select col_is_pk('public', 'access_grants', 'id', 'id is the primary key');
select has_index('public', 'access_grants', 'access_grants_manual_uq', 'manual uniqueness index exists');
select has_index('public', 'access_grants', 'access_grants_gateway_uq', 'gateway uniqueness index exists');
select has_index('public', 'access_grants', 'access_grants_tenant_email_idx', 'tenant-first e-mail index exists');
select has_index('public', 'access_grants', 'access_grants_email_active_idx', 'active e-mail index (hooks) exists');
select has_index('public', 'access_grants', 'access_grants_tenant_updated_idx', 'Acessos list index exists');
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('access_gate_on', 'access_effective', 'access_state', 'membership_access_cut',
                          'access_cut_user_ids', 'membership_in_tenant_gated', 'memberships_of_user_gated')
        and p.prosrc like '%email_allowlist%' $$,
  'no function of this plan reads the retiring email_allowlist table'
);

-- ── 2. CHECKs and uniqueness ───────────────────────────────────────────────────────────────────
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status) values ('20400000-0000-4000-8000-000000000001', 'Upper@X.local', 'manual', 'active')$$,
  '23514', null, 'an upper-case e-mail is refused by the lowercase CHECK'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status) values ('20400000-0000-4000-8000-000000000001', ' pad@x.local', 'manual', 'active')$$,
  '23514', null, 'a space-padded e-mail is refused by the trim CHECK'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status) values ('20400000-0000-4000-8000-000000000001', 'x1@x.local', 'manual', 'inactive')$$,
  '23514', null, 'a manual row cannot be inactive'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values ('20400000-0000-4000-8000-000000000001', 'x2@x.local', 'gateway', 'blocked', 'fake_gw', 'z1')$$,
  '23514', null, 'a gateway row cannot be blocked'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status) values ('20400000-0000-4000-8000-000000000001', 'x3@x.local', 'gateway', 'active')$$,
  '23514', null, 'a gateway row without provider and external_ref is refused'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values ('20400000-0000-4000-8000-000000000001', 'x4@x.local', 'manual', 'active', 'fake_gw', 'z2')$$,
  '23514', null, 'a manual row carrying a provider is refused'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values ('20400000-0000-4000-8000-000000000001', 'x5@x.local', 'gateway', 'active', 'Fake_GW', 'z3')$$,
  '23514', null, 'a provider with a capital letter is refused by the format CHECK'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status) values ('20400000-0000-4000-8000-000000000001', 'm1@ag-a.local', 'manual', 'active')$$,
  '23505', null, 'a second manual active row for the same tenant and e-mail is refused'
);
select throws_ok(
  $$insert into public.access_grants (tenant_id, email, source, status, provider, external_ref) values ('20400000-0000-4000-8000-000000000001', 'other@x.local', 'gateway', 'active', 'fake_gw', 'r2')$$,
  '23505', null, 'a second gateway row for the same (tenant, provider, ref) is refused'
);
insert into public.access_grants (tenant_id, email, source, status)
  values ('20400000-0000-4000-8000-000000000001', 'pair@ag-a.local', 'manual', 'active');
select lives_ok(
  $$insert into public.access_grants (tenant_id, email, source, status) values ('20400000-0000-4000-8000-000000000001', 'pair@ag-a.local', 'manual', 'blocked')$$,
  'one e-mail may hold a manual release AND a manual block at once (planning decision 2)'
);

-- ── 3. exposure ────────────────────────────────────────────────────────────────────────────────
select is((select relrowsecurity from pg_class where oid = 'public.access_grants'::regclass), true, 'RLS is on');
select is((select relforcerowsecurity from pg_class where oid = 'public.access_grants'::regclass), false,
  'RLS is NOT forced: the definer owner always reads the table');
select is((select count(*)::int from pg_policy where polrelid = 'public.access_grants'::regclass), 0,
  'ZERO policies: no tenant lane can ever see a row (adding one is always a bug)');
select ok(
  not (has_table_privilege('anon', 'public.access_grants', 'select')
    or has_table_privilege('anon', 'public.access_grants', 'insert')
    or has_table_privilege('anon', 'public.access_grants', 'update')
    or has_table_privilege('anon', 'public.access_grants', 'delete')),
  'anon holds no privilege on the table'
);
select ok(
  not (has_table_privilege('authenticated', 'public.access_grants', 'select')
    or has_table_privilege('authenticated', 'public.access_grants', 'insert')
    or has_table_privilege('authenticated', 'public.access_grants', 'update')
    or has_table_privilege('authenticated', 'public.access_grants', 'delete')),
  'authenticated holds no privilege on the table'
);

-- ── 4. app.access_gate_on ──────────────────────────────────────────────────────────────────────
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e1'), false, 'gate: no payments row is off');
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e2'), false, 'gate: a disabled module with gate true is off (P16)');
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e3'), false, 'gate: empty settings is off (P15)');
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e4'), false, 'gate: false is off');
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e5'), false, 'gate: the string "true" is off (P14)');
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e6'), false, 'gate: the number 1 is off (P14)');
select is(app.access_gate_on('20400000-0000-4000-8000-0000000000e7'), true, 'gate: only the jsonb boolean true is on');

-- ── 5. app.access_effective ────────────────────────────────────────────────────────────────────
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm1@ag-a.local'), 'active', 'M1 manual release is active');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm2@ag-a.local'), 'active', 'M2 gateway active is active');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm3@ag-a.local'), 'inactive', 'M3 gateway inactive is inactive');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm4@ag-a.local'), 'inactive',
  'M4 gateway inactive OUTRANKS a manual release (D-489 literal, A-P9)');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm5@ag-a.local'), 'blocked',
  'M5 a manual block outranks an active gateway row');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm6@ag-a.local'), 'none', 'M6 with no row in A is none');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm7@ag-a.local'), 'active',
  'M7 one active gateway row among several opens the door (D-494)');
select is(app.access_effective('20400000-0000-4000-8000-000000000002', 'm6@ag-a.local'), 'active',
  'tenant pinning: M6 has a release in B');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', 'm6@ag-a.local'), 'none',
  'tenant pinning: B''s release never opens A');
select is(app.access_effective('20400000-0000-4000-8000-000000000002', 'm1@ag-a.local'), 'none',
  'tenant pinning: A''s release for M1 never opens B');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', '  M1@AG-A.LOCAL '), 'active',
  'a padded, upper-case argument finds the lower-case row');
select is(app.access_effective('20400000-0000-4000-8000-000000000001', null), 'none', 'a null e-mail is none, never null');

-- ── 6. app.access_state and its siblings ───────────────────────────────────────────────────────
select is(app.access_state('20400000-0000-4000-8000-0000000000e1', '20400000-0000-4000-8000-0000000000b6'), 'open',
  'gate off (no row): open for everyone');
select is(app.access_state('20400000-0000-4000-8000-0000000000e2', '20400000-0000-4000-8000-0000000000b6'), 'open',
  'gate off (module disabled with gate true): open for everyone');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a1'), 'open',
  'admin_tenant is open with no access row (D-492)');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a2'), 'open',
  'support_tenant is open with no access row (D-492)');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a3'), 'cut',
  'a DELETED staff membership is not exempt');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b1'), 'granted', 'M1 granted (mixed-case user e-mail, lower-case row)');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b2'), 'granted', 'M2 granted');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b3'), 'cut', 'M3 cut');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b4'), 'cut', 'M4 cut (A-P9)');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b5'), 'blocked', 'M5 blocked');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b6'), 'cut', 'M6 cut (A-P24: none is cut when the gate is on)');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b7'), 'granted', 'M7 granted');
select is(app.access_state('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000ff'), 'cut',
  'a user with no public.users row fails closed to cut');
select is(app.access_state('20400000-0000-4000-8000-000000000002', '20400000-0000-4000-8000-0000000000b1'), 'cut',
  'M1 in B (gate on, no row in B) is cut while granted in A');
select is(app.access_state('20400000-0000-4000-8000-000000000002', '20400000-0000-4000-8000-0000000000b6'), 'granted',
  'M6 in B (release in B) is granted');
select is(app.membership_access_cut('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b3'), true, 'membership_access_cut: M3 is cut');
select is(app.membership_access_cut('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b1'), false, 'membership_access_cut: M1 is not');
select is(app.membership_access_cut('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000a1'), false, 'membership_access_cut: the admin is not');
select is(app.membership_access_cut('20400000-0000-4000-8000-000000000001', '20400000-0000-4000-8000-0000000000b5'), false,
  'membership_access_cut: a manual block is blocked, not cut');
select is(
  app.access_cut_user_ids('20400000-0000-4000-8000-000000000001'),
  array['20400000-0000-4000-8000-0000000000b3', '20400000-0000-4000-8000-0000000000b4',
        '20400000-0000-4000-8000-0000000000b6']::uuid[],
  'access_cut_user_ids: exactly the live member-role users whose state is cut (M3, M4, M6)'
);
select is(app.access_cut_user_ids('20400000-0000-4000-8000-0000000000e1'), '{}'::uuid[], 'access_cut_user_ids: gate off is empty');
select is(app.access_cut_user_ids('20400000-0000-4000-8000-0000000000e5'), '{}'::uuid[], 'access_cut_user_ids: a lookalike gate is empty');

-- ── 7. the _gated lookups ──────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000b1', '20400000-0000-4000-8000-000000000001')),
  1, 'membership_in_tenant_gated returns the one row'
);
select is_empty(
  $$ (select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.membership_in_tenant('20400000-0000-4000-8000-0000000000b8', '20400000-0000-4000-8000-000000000001')
      except
      select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000b8', '20400000-0000-4000-8000-000000000001'))
     union all
     (select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000b8', '20400000-0000-4000-8000-000000000001')
      except
      select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.membership_in_tenant('20400000-0000-4000-8000-0000000000b8', '20400000-0000-4000-8000-000000000001')) $$,
  'membership_in_tenant_gated returns the same six columns as the 08.1 function'
);
select is(
  (select access_state from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000b3', '20400000-0000-4000-8000-000000000001')),
  'cut', 'membership_in_tenant_gated: M3 carries access_state cut'
);
select is(
  (select access_state from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000a1', '20400000-0000-4000-8000-000000000001')),
  'open', 'membership_in_tenant_gated: the admin carries access_state open'
);
select results_eq(
  $$ select tenant_slug, access_state from app.memberships_of_user_gated('20400000-0000-4000-8000-0000000000b1') $$,
  $$ values ('pgtap-ag-a'::text, 'granted'::text), ('pgtap-ag-b'::text, 'cut'::text) $$,
  'memberships_of_user_gated: every non-deleted membership, ordered by slug, each with its own state'
);
select is_empty(
  $$ (select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.memberships_of_user('20400000-0000-4000-8000-0000000000b1')
      except
      select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.memberships_of_user_gated('20400000-0000-4000-8000-0000000000b1'))
     union all
     (select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.memberships_of_user_gated('20400000-0000-4000-8000-0000000000b1')
      except
      select tenant_id, tenant_slug, tenant_display_name, role, status, tenant_status
        from app.memberships_of_user('20400000-0000-4000-8000-0000000000b1')) $$,
  'memberships_of_user_gated returns the same six columns as the 08.1 function'
);
select is(
  (select status from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000b8', '20400000-0000-4000-8000-000000000001')),
  'blocked', 'a blocked_at membership reports blocked'
);
select is(
  (select count(*)::int from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000b9', '20400000-0000-4000-8000-000000000001')),
  0, 'a deleted member is absent'
);
select is(
  (select count(*)::int from app.membership_in_tenant_gated('20400000-0000-4000-8000-0000000000a3', '20400000-0000-4000-8000-000000000001')),
  0, 'a deleted staff membership is absent'
);
select is(
  (select md5(prosrc) from pg_proc where oid = 'app.membership_in_tenant(uuid, uuid)'::regprocedure),
  '64b01cb5aca8edca9fa280e6ba909a39', 'app.membership_in_tenant is byte for byte the 08.1 body (expand-only)'
);
select is(
  (select md5(prosrc) from pg_proc where oid = 'app.memberships_of_user(uuid)'::regprocedure),
  'e9f2d839abc0c245d6b809b6e9366032', 'app.memberships_of_user is byte for byte the 08.1 body (expand-only)'
);

-- ── 8. hardening by catalogue ──────────────────────────────────────────────────────────────────
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('access_gate_on', 'access_effective', 'access_state', 'membership_access_cut',
                          'access_cut_user_ids', 'membership_in_tenant_gated', 'memberships_of_user_gated')
        and not p.prosecdef $$,
  'all seven functions are SECURITY DEFINER'
);
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app'
        and p.proname in ('access_gate_on', 'access_effective', 'access_state', 'membership_access_cut',
                          'access_cut_user_ids', 'membership_in_tenant_gated', 'memberships_of_user_gated')
        and not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))) $$,
  'all seven functions pin search_path to the empty string'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('access_gate_on', 'access_effective', 'access_state', 'membership_access_cut',
                        'access_cut_user_ids', 'membership_in_tenant_gated', 'memberships_of_user_gated')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  0, 'authenticated can execute none of the seven (T-09.1-05)'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('access_gate_on', 'access_effective', 'access_state', 'membership_access_cut',
                        'access_cut_user_ids', 'membership_in_tenant_gated', 'memberships_of_user_gated')
      and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon can execute none of the seven'
);
select ok(has_function_privilege('api_user', 'app.membership_in_tenant_gated(uuid, uuid)', 'execute'), 'api_user may execute membership_in_tenant_gated');
select ok(has_function_privilege('api_user', 'app.memberships_of_user_gated(uuid)', 'execute'), 'api_user may execute memberships_of_user_gated');
select ok(has_function_privilege('api_user', 'app.access_state(uuid, uuid)', 'execute'), 'api_user may execute access_state');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('access_gate_on', 'access_effective', 'membership_access_cut', 'access_cut_user_ids')
      and has_function_privilege('api_user', p.oid, 'execute')),
  0, 'api_user cannot execute the four admin-lane functions'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('access_gate_on', 'access_effective', 'access_state', 'membership_access_cut',
                        'access_cut_user_ids')
      and has_function_privilege('service_role', p.oid, 'execute')),
  5, 'service_role (the admin lane) can execute the five decision functions'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('membership_in_tenant_gated', 'memberships_of_user_gated')
      and has_function_privilege('service_role', p.oid, 'execute')),
  0, 'service_role cannot execute the two request-path lookups'
);

select * from finish();
rollback;
