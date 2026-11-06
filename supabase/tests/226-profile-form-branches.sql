begin;
-- 226-profile-form-branches.sql — Phase 12.2 (PFORM-45, 46, 47, 48, 53, 55; D-640, D-644, D-645, D-646; T-12.2-01, T-12.2-02,
-- T-12.2-06, T-12.2-07, T-12.2-10, T-12.2-12): the branches table, its policies, the chain gate, the chain purge, the guards,
-- the conversion and the lock functions, executed inside Postgres.
--
--  1. SHAPE and EXPOSURE of `profile_form_branches` and of `branch_id`, the CHECK boundaries and the composite keys
--     (a cross-tenant negative beside every positive control).
--  2. THE FOUR POLICIES x two tenants x the three real roles.
--  3. THE GATE `app.profile_form_missing` over a chain of up to three branches, replayed from PROFILE_FORM_CHAIN_CASES
--     (packages/contracts/src/profile-form-branches.ts): rows 1..9 on the clinic fixture of tenant A, row 10 (any-of) on
--     tenant H. Row 11 (a fourth level) can never be STORED, so its SQL form is the PF008 refusal of section 5. Also the
--     module-off tenant, staff, a tenant with no question, two insert orders, and a question archived with its branch.
--  4. THE PURGE `app.profile_form_purge_closed`: the same rows, two branches of one opener, an empty member, ordering,
--     idempotence, the archived-branch case (T-12.2-06) and the claims scoping (T-12.2-12).
--  5. THE GUARDS PF006..PF010 (Task 3 of plan 12.2-07).
--  6. THE CONVERSION replayed on 12.1-shaped rows.
--  7. THE LOCK FUNCTIONS and the grants.
--  8. THE COST of a 30-question depth-3 form.
--
-- The chain rows are COPIED from PROFILE_FORM_CHAIN_FIXTURE and PROFILE_FORM_CHAIN_CASES: the same ids (`24000000-0000-4000-8000-…`)
-- for the questions Q1..Q7 (`…000000000001..7`), the branches B1..B4 (`…0000000000b1..b4`) and the options (`…0000000000e1..e3`).
-- Rule: a new chain row adds a row in the contracts constant AND a line here, in the same change.
-- Fixture ids use the `24000000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(236);

-- ── fixture helpers (rolled back with the file) ─────────────────────────────────────────────────
-- One question row (always inside a step; a NULL branch is an unconditional question).
create function tests.pf_q(
  p_id uuid, p_tenant uuid, p_step uuid, p_type text, p_title text, p_pos int,
  p_required boolean default false, p_options jsonb default '[]'::jsonb, p_allow_other boolean default false,
  p_branch uuid default null, p_archived boolean default false, p_limits jsonb default '{}'::jsonb,
  p_show boolean default false
) returns void language sql as $$
  insert into public.profile_form_questions
    (id, tenant_id, step_id, type, title, required, allow_other, options, limits, position, archived_at,
     branch_id, show_on_profile, created_by_user_id)
  values (p_id, p_tenant, p_step, p_type, p_title, p_required, p_allow_other, p_options, p_limits, p_pos,
          case when p_archived then now() end, p_branch, p_show, '24000000-0000-4000-8000-020000000001');
$$;
-- One branch row.
create function tests.pf_b(
  p_id uuid, p_tenant uuid, p_opener uuid, p_vals text[], p_name text default null, p_archived boolean default false
) returns void language sql as $$
  insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values, name, archived_at)
  values (p_id, p_tenant, p_opener, p_vals, p_name, case when p_archived then now() end);
$$;
-- One answer, upserted (the unique index is (tenant, membership, question)).
create function tests.pf_a(p_tenant uuid, p_q uuid, p_membership uuid, p_user uuid, p_value jsonb)
returns void language sql as $$
  insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
  values (p_tenant, p_q, p_membership, p_user, p_value)
  on conflict (tenant_id, membership_id, question_id) do update set value = excluded.value;
$$;
-- The clinic question ids by KEY ('Q2' -> …000000000002), as the contracts constant names them.
create function tests.pf_keys(variadic p_keys text[] default array[]::text[]) returns text[] language sql immutable as $$
  select coalesce(array_agg('24000000-0000-4000-8000-' || lpad(substr(k, 2), 12, '0') order by k), array[]::text[])
  from unnest(p_keys) as k;
$$;
-- The gate for member m1 of tenant A (the one the chain rows are replayed for).
create function tests.pf_gate_a() returns integer language sql as $$
  select app.profile_form_missing('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-030000000003');
$$;
-- Load the STORED answers of one chain row for m1 (all of m1's answers are replaced). The shapes are the stored shapes of
-- the `stored` field of PROFILE_FORM_CHAIN_CASES; `E1 = …e1` (tem), `E2 = …e2` (trabalha), `E3 = …e3` (aprende).
create function tests.pf_load(p_row int) returns void language sql as $$
  delete from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003';
  insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
  select '24000000-0000-4000-8000-010000000001',
         ('24000000-0000-4000-8000-' || lpad(substr(r.k, 2), 12, '0'))::uuid,
         '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', r.v
  from (values
    (2, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'::jsonb),
    (3, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'),
    (3, 'Q2', 'true'),
    (4, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'),
    (4, 'Q2', 'true'),
    (4, 'Q5', 'true'),
    (5, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e2","otherText":null}'),
    (5, 'Q2', 'true'),
    (5, 'Q5', 'true'),
    (6, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'),
    (6, 'Q2', 'false'),
    (6, 'Q5', 'true'),
    (7, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e3","otherText":null}'),
    (8, 'Q1', '{"optionId":null,"otherText":"x"}'),
    (9, 'Q1', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'),
    (9, 'Q2', '"true"')
  ) as r(n, k, v)
  where r.n = p_row;
$$;
-- Two small twin trees, for the insert-order case. Question n of prefix `pp` is `24000000-0000-4000-8000-<pp><10 digits n>`,
-- branches are n = 11 and 12. Q0 required unconditional; Q1 single choice (k1, k2); B1 opens on Q1 = k1 and holds Q2 (yes/no)
-- and Q3 (required); B2 opens on Q2 = true and holds Q4 (required). `p_reverse` inserts the leaves first with the keys deferred.
create function tests.pf_twin(p_tenant uuid, p_step uuid, p_pp text, p_reverse boolean) returns void language plpgsql as $$
declare
  id0 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000000')::uuid;
  id1 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000001')::uuid;
  id2 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000002')::uuid;
  id3 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000003')::uuid;
  id4 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000004')::uuid;
  b1 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000011')::uuid;
  b2 uuid := ('24000000-0000-4000-8000-' || p_pp || '0000000012')::uuid;
begin
  if p_reverse then
    set constraints all deferred;
    perform tests.pf_q(id4, p_tenant, p_step, 'short_text', 'Q4', 5, true, p_branch => b2);
    perform tests.pf_b(b2, p_tenant, id2, array['true']);
    perform tests.pf_q(id3, p_tenant, p_step, 'short_text', 'Q3', 4, true, p_branch => b1);
    perform tests.pf_q(id2, p_tenant, p_step, 'yes_no', 'Q2', 3, false, p_branch => b1);
    perform tests.pf_b(b1, p_tenant, id1, array['k1']);
    perform tests.pf_q(id1, p_tenant, p_step, 'single_choice', 'Q1', 2, false, '[{"id":"k1","label":"Um"},{"id":"k2","label":"Dois"}]'::jsonb);
    perform tests.pf_q(id0, p_tenant, p_step, 'short_text', 'Q0', 1, true);
    set constraints all immediate;
  else
    perform tests.pf_q(id0, p_tenant, p_step, 'short_text', 'Q0', 1, true);
    perform tests.pf_q(id1, p_tenant, p_step, 'single_choice', 'Q1', 2, false, '[{"id":"k1","label":"Um"},{"id":"k2","label":"Dois"}]'::jsonb);
    perform tests.pf_b(b1, p_tenant, id1, array['k1']);
    perform tests.pf_q(id2, p_tenant, p_step, 'yes_no', 'Q2', 3, false, p_branch => b1);
    perform tests.pf_q(id3, p_tenant, p_step, 'short_text', 'Q3', 4, true, p_branch => b1);
    perform tests.pf_b(b2, p_tenant, id2, array['true']);
    perform tests.pf_q(id4, p_tenant, p_step, 'short_text', 'Q4', 5, true, p_branch => b2);
  end if;
end
$$;

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
-- A the clinic (gate and purge), B the other tenant, C the module-off lab, D no question, H the any-of tree,
-- K and L the twin trees inserted in two orders, G the guard lab, R the conversion lab, J the 30-question form.
select tests.tenant('pgtap-pf3-a', 'Pf3 A', '24000000-0000-4000-8000-010000000001');
select tests.tenant('pgtap-pf3-b', 'Pf3 B', '24000000-0000-4000-8000-010000000002');
select tests.tenant('pgtap-pf3-c', 'Pf3 C', '24000000-0000-4000-8000-010000000003');
select tests.tenant('pgtap-pf3-d', 'Pf3 D', '24000000-0000-4000-8000-010000000004');
select tests.tenant('pgtap-pf3-h', 'Pf3 H', '24000000-0000-4000-8000-010000000005');
select tests.tenant('pgtap-pf3-k', 'Pf3 K', '24000000-0000-4000-8000-010000000006');
select tests.tenant('pgtap-pf3-l', 'Pf3 L', '24000000-0000-4000-8000-010000000007');
select tests.auth_user('admin@pf3-a.local', '24000000-0000-4000-8000-020000000001');
select tests.auth_user('support@pf3-a.local', '24000000-0000-4000-8000-020000000002');
select tests.auth_user('member1@pf3-a.local', '24000000-0000-4000-8000-020000000003');
select tests.auth_user('member2@pf3-a.local', '24000000-0000-4000-8000-020000000004');
select tests.auth_user('admin@pf3-b.local', '24000000-0000-4000-8000-020000000005');
select tests.auth_user('member1@pf3-b.local', '24000000-0000-4000-8000-020000000006');
select tests.auth_user('member1@pf3-c.local', '24000000-0000-4000-8000-020000000007');
select tests.auth_user('member1@pf3-d.local', '24000000-0000-4000-8000-020000000008');
select tests.auth_user('member1@pf3-h.local', '24000000-0000-4000-8000-020000000009');
select tests.auth_user('member1@pf3-k.local', '24000000-0000-4000-8000-02000000000a');
select tests.auth_user('member1@pf3-l.local', '24000000-0000-4000-8000-02000000000b');
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('24000000-0000-4000-8000-030000000001', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000001', 'admin_tenant', 'active'),
  ('24000000-0000-4000-8000-030000000002', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000002', 'support_tenant', 'active'),
  ('24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member', 'active'),
  ('24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000004', 'member', 'active'),
  ('24000000-0000-4000-8000-030000000005', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-020000000005', 'admin_tenant', 'active'),
  ('24000000-0000-4000-8000-030000000006', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-020000000006', 'member', 'active'),
  ('24000000-0000-4000-8000-030000000007', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-020000000007', 'member', 'active'),
  ('24000000-0000-4000-8000-030000000008', '24000000-0000-4000-8000-010000000004', '24000000-0000-4000-8000-020000000008', 'member', 'active'),
  ('24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-020000000009', 'member', 'active'),
  ('24000000-0000-4000-8000-03000000000a', '24000000-0000-4000-8000-010000000006', '24000000-0000-4000-8000-02000000000a', 'member', 'active'),
  ('24000000-0000-4000-8000-03000000000b', '24000000-0000-4000-8000-010000000007', '24000000-0000-4000-8000-02000000000b', 'member', 'active');
-- The module is on for A, B, D, H, K and L (the gate), OFF for C.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('24000000-0000-4000-8000-010000000001', 'profile_form', true), ('24000000-0000-4000-8000-010000000002', 'profile_form', true),
  ('24000000-0000-4000-8000-010000000003', 'profile_form', false), ('24000000-0000-4000-8000-010000000004', 'profile_form', true),
  ('24000000-0000-4000-8000-010000000005', 'profile_form', true), ('24000000-0000-4000-8000-010000000006', 'profile_form', true),
  ('24000000-0000-4000-8000-010000000007', 'profile_form', true);
insert into public.profile_form_steps (id, tenant_id, title, position, created_at) values
  ('24000000-0000-4000-8000-050000000001', '24000000-0000-4000-8000-010000000001', 'Passo A', 1, '2026-01-01'),
  ('24000000-0000-4000-8000-050000000002', '24000000-0000-4000-8000-010000000002', 'Passo B', 1, '2026-01-01'),
  ('24000000-0000-4000-8000-050000000003', '24000000-0000-4000-8000-010000000003', 'Passo C', 1, '2026-01-01'),
  ('24000000-0000-4000-8000-050000000004', '24000000-0000-4000-8000-010000000004', 'Passo D', 1, '2026-01-01'),
  ('24000000-0000-4000-8000-050000000005', '24000000-0000-4000-8000-010000000005', 'Passo H', 1, '2026-01-01'),
  ('24000000-0000-4000-8000-050000000006', '24000000-0000-4000-8000-010000000006', 'Passo K', 1, '2026-01-01'),
  ('24000000-0000-4000-8000-050000000007', '24000000-0000-4000-8000-010000000007', 'Passo L', 1, '2026-01-01');

-- Tenant A: the clinic fixture of PROFILE_FORM_CHAIN_FIXTURE, same ids. Inserted opener first, branch second, members last.
select tests.pf_q('24000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'single_choice', 'Voce tem clinica, trabalha em clinica ou esta aprendendo?', 1, false,
  '[{"id":"24000000-0000-4000-8000-0000000000e1","label":"Tenho"},{"id":"24000000-0000-4000-8000-0000000000e2","label":"Trabalho"},{"id":"24000000-0000-4000-8000-0000000000e3","label":"Aprendo"}]'::jsonb);
select tests.pf_b('24000000-0000-4000-8000-0000000000b1', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', array['24000000-0000-4000-8000-0000000000e1']);
select tests.pf_q('24000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'yes_no', 'A clinica tem equipe?', 2, false, p_branch => '24000000-0000-4000-8000-0000000000b1');
select tests.pf_q('24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'short_text', 'Nome da clinica', 3, true, p_branch => '24000000-0000-4000-8000-0000000000b1');
select tests.pf_b('24000000-0000-4000-8000-0000000000b2', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000002', array['true']);
select tests.pf_q('24000000-0000-4000-8000-000000000004', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'number', 'Quantos profissionais?', 4, true, p_branch => '24000000-0000-4000-8000-0000000000b2');
select tests.pf_q('24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'yes_no', 'Tem socio?', 5, false, p_branch => '24000000-0000-4000-8000-0000000000b2');
select tests.pf_b('24000000-0000-4000-8000-0000000000b3', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000005', array['true']);
select tests.pf_q('24000000-0000-4000-8000-000000000006', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'short_text', 'Nome do socio', 6, true, p_branch => '24000000-0000-4000-8000-0000000000b3');
select tests.pf_b('24000000-0000-4000-8000-0000000000b4', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', array['24000000-0000-4000-8000-0000000000e3']);
select tests.pf_q('24000000-0000-4000-8000-000000000007', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-050000000001', 'short_text', 'Onde estuda?', 7, true, p_branch => '24000000-0000-4000-8000-0000000000b4');

-- Tenant B: an opener, a branch, a required question inside it and a required unconditional one.
select tests.pf_q('24000000-0000-4000-8000-060000000001', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-050000000002', 'single_choice', 'Abridor B', 1, false,
  '[{"id":"x1","label":"X um"},{"id":"x2","label":"X dois"}]'::jsonb);
select tests.pf_b('24000000-0000-4000-8000-0b0000000001', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-060000000001', array['x1']);
select tests.pf_q('24000000-0000-4000-8000-060000000002', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-050000000002', 'short_text', 'Se B um', 2, true, p_branch => '24000000-0000-4000-8000-0b0000000001');
select tests.pf_q('24000000-0000-4000-8000-060000000003', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-050000000002', 'short_text', 'Obrigatoria B', 3, true);

-- Tenant C (module OFF): an opener and a required unconditional question. It is also the lab of the boundaries and keys.
select tests.pf_q('24000000-0000-4000-8000-070000000001', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-050000000003', 'single_choice', 'Abridor C', 1, false,
  '[{"id":"c1","label":"C um"},{"id":"c2","label":"C dois"}]'::jsonb);
select tests.pf_q('24000000-0000-4000-8000-070000000002', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-050000000003', 'short_text', 'Obrigatoria C', 2, true);

-- Tenant H: PROFILE_FORM_CHAIN_FIXTURE_ANY_OF (row 10) plus a yes/no opener whose branch opens on 'True' (a wrong case).
select tests.pf_q('24000000-0000-4000-8000-0000000000a1', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-050000000005', 'single_choice', 'H Q1', 1, false,
  '[{"id":"24000000-0000-4000-8000-0000000000e1","label":"Tenho"},{"id":"24000000-0000-4000-8000-0000000000e2","label":"Trabalho"}]'::jsonb);
select tests.pf_b('24000000-0000-4000-8000-0000000000a5', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a1', array['24000000-0000-4000-8000-0000000000e1']);
select tests.pf_q('24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-050000000005', 'multiple_choice', 'H Q2', 2, false,
  '[{"id":"24000000-0000-4000-8000-0000000000f1","label":"F um"},{"id":"24000000-0000-4000-8000-0000000000f2","label":"F dois"},{"id":"24000000-0000-4000-8000-0000000000f3","label":"F tres"}]'::jsonb, false, '24000000-0000-4000-8000-0000000000a5');
select tests.pf_b('24000000-0000-4000-8000-0000000000a6', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2',
  array['24000000-0000-4000-8000-0000000000f2', '24000000-0000-4000-8000-0000000000f3']);
select tests.pf_q('24000000-0000-4000-8000-0000000000a3', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-050000000005', 'short_text', 'H Q3', 3, true, p_branch => '24000000-0000-4000-8000-0000000000a6');
select tests.pf_q('24000000-0000-4000-8000-0000000000a7', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-050000000005', 'yes_no', 'H Q4', 4);
select tests.pf_b('24000000-0000-4000-8000-0000000000a8', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a7', array['True']);
select tests.pf_q('24000000-0000-4000-8000-0000000000a9', '24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-050000000005', 'short_text', 'H Q5', 5, true, p_branch => '24000000-0000-4000-8000-0000000000a8');

-- Tenants K and L: the same small tree inserted in two orders (K reversed, with the keys deferred).
select tests.pf_twin('24000000-0000-4000-8000-010000000006', '24000000-0000-4000-8000-050000000006', 'c1', true);
select tests.pf_twin('24000000-0000-4000-8000-010000000007', '24000000-0000-4000-8000-050000000007', 'c2', false);

-- ── (1) shape and exposure ─────────────────────────────────────────────────────────────────────
select has_table('public', 'profile_form_branches', 'PFORM-45: profile_form_branches exists');
select columns_are('public', 'profile_form_branches',
  array['id', 'tenant_id', 'opener_question_id', 'open_values', 'name', 'revision', 'archived_at', 'created_at', 'updated_at'],
  'PFORM-45: profile_form_branches has exactly the planned columns');
select col_is_pk('public', 'profile_form_branches', 'id', 'profile_form_branches.id is the primary key');
select col_not_null('public', 'profile_form_branches', 'opener_question_id', 'the opener of a branch is NOT NULL');
select col_not_null('public', 'profile_form_branches', 'open_values', 'the opening values of a branch are NOT NULL');
select col_is_null('public', 'profile_form_branches', 'name', 'the name of a branch is optional');
select has_column('public', 'profile_form_questions', 'branch_id', 'PFORM-45: profile_form_questions.branch_id exists');
select col_is_null('public', 'profile_form_questions', 'branch_id', 'branch_id is nullable (an unconditional question has no branch)');
select is(
  (select count(*)::int from pg_index i
     join pg_attribute a on a.attrelid = i.indexrelid and a.attnum = 1
    where i.indrelid = 'public.profile_form_branches'::regclass and not i.indisprimary and a.attname <> 'tenant_id'),
  0, 'T-12.2-01: every index of profile_form_branches other than the primary key is tenant-first');
select is(
  (select count(*)::int from pg_index i join pg_attribute a on a.attrelid = i.indexrelid and a.attnum = 1
    where i.indexrelid = 'public.profile_form_questions_branch_idx'::regclass and a.attname = 'tenant_id' and i.indpred is not null),
  1, 'the (tenant, branch) index of the questions is tenant-first and PARTIAL');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profile_form_branches'::regclass
      and conname in ('profile_form_branches_tenant_id_uq', 'profile_form_branches_values_chk', 'profile_form_branches_name_chk',
                      'profile_form_branches_revision_chk', 'profile_form_branches_opener_fk')),
  5, 'profile_form_branches carries its (tenant, id) unique, its three named CHECKs and the opener key');
select is(
  (select string_agg(conname || ':' || condeferrable::text || ':' || condeferred::text || ':' || confdeltype::text, ',' order by conname)
     from pg_constraint where conname in ('profile_form_branches_opener_fk', 'profile_form_questions_branch_fk')),
  'profile_form_branches_opener_fk:true:false:a,profile_form_questions_branch_fk:true:false:a',
  'D-640: both composite keys are NO ACTION and DEFERRABLE INITIALLY IMMEDIATE (the move engine plans the pair as one group)');
select is((select relrowsecurity and not relforcerowsecurity from pg_class where oid = 'public.profile_form_branches'::regclass), true,
  'profile_form_branches: RLS on and NOT forced');
select set_eq(
  $$ select polname::text from pg_policy where polrelid = 'public.profile_form_branches'::regclass $$,
  $$ values ('profile_form_branches_select'), ('profile_form_branches_insert'), ('profile_form_branches_update'), ('profile_form_branches_delete') $$,
  'profile_form_branches has exactly its four named policies');
select is(
  (select count(*)::int from pg_policy
    where polrelid = 'public.profile_form_branches'::regclass and polpermissive and polroles = array['authenticated'::regrole::oid]),
  4, 'all four branch policies are permissive and granted to authenticated only');
select ok(
  not (has_table_privilege('anon', 'public.profile_form_branches', 'select') or has_table_privilege('anon', 'public.profile_form_branches', 'insert')
    or has_table_privilege('anon', 'public.profile_form_branches', 'update') or has_table_privilege('anon', 'public.profile_form_branches', 'delete')),
  'anon holds no privilege on profile_form_branches');
select ok(not has_table_privilege('authenticated', 'public.profile_form_branches', 'truncate'),
  'T-12.2-01: authenticated holds no TRUNCATE on profile_form_branches (RLS does not see it)');

-- CHECK boundaries (tenant C, as the migration role; every accepted row is deleted again).
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array[]::text[]) $$,
  '23514', null, 'PFORM-45 boundary: a branch with 0 opening values is refused');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-0b00000000c1', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c1']) $$,
  'PFORM-45 boundary: a branch with exactly 1 opening value is accepted');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-0b00000000c2', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array(select 'v' || i from generate_series(1, 20) i)) $$,
  'PFORM-45 boundary: a branch with exactly 20 opening values is accepted');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array(select 'v' || i from generate_series(1, 21) i)) $$,
  '23514', null, 'PFORM-45 boundary: a branch with 21 opening values is refused');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values, name) values ('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c2'], '') $$,
  '23514', null, 'PFORM-45 boundary: an empty branch name is refused (null is the no-name)');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values, name) values ('24000000-0000-4000-8000-0b00000000c3', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c2'], 'n') $$,
  'PFORM-45 boundary: a 1-character branch name is accepted');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values, name) values ('24000000-0000-4000-8000-0b00000000c4', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c2'], repeat('é', 60)) $$,
  'PFORM-45 boundary: a 60 code point branch name is accepted (accents count as one)');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values, name) values ('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c2'], repeat('é', 61)) $$,
  '23514', null, 'PFORM-45 boundary: a 61 code point branch name is refused');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values, revision) values ('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c2'], 0) $$,
  '23514', null, 'PFORM-45 boundary: a revision of 0 is refused');
delete from public.profile_form_branches where id in ('24000000-0000-4000-8000-0b00000000c1', '24000000-0000-4000-8000-0b00000000c2', '24000000-0000-4000-8000-0b00000000c3', '24000000-0000-4000-8000-0b00000000c4');

-- The composite keys: a negative beside every positive control.
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-060000000001', array['x1']) $$,
  '23503', null, 'T-12.2-01 cross-tenant: a branch of C naming B''s question as its opener is refused by the composite key');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-0b00000000c5', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-070000000001', array['c1']) $$,
  'T-12.2-01: the positive control, the same branch naming C''s own opener');
select throws_ok(
  $$ select tests.pf_q('24000000-0000-4000-8000-070000000003', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-050000000003', 'short_text', 'Ramo alheio', 3, false, p_branch => '24000000-0000-4000-8000-0b0000000001') $$,
  '23503', null, 'T-12.2-01 cross-tenant: a question of C whose branch_id names B''s branch is refused by the composite key');
select lives_ok(
  $$ select tests.pf_q('24000000-0000-4000-8000-070000000003', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-050000000003', 'short_text', 'Ramo proprio', 3, false, p_branch => '24000000-0000-4000-8000-0b00000000c5') $$,
  'T-12.2-01: the positive control, the same question naming C''s own branch');
select throws_ok(
  $$ select tests.pf_q('24000000-0000-4000-8000-070000000004', '24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-050000000003', 'short_text', 'Ramo fantasma', 4, false, p_branch => '24000000-0000-4000-8000-0b00000000ff') $$,
  '23503', null, 'chain row 11 (SQL form): a question naming a branch that does not exist is refused, so a dangling id cannot be stored');
select throws_ok(
  $$ delete from public.profile_form_branches where id = '24000000-0000-4000-8000-0b00000000c5' $$,
  '23503', null, 'D-640: a branch that holds a question cannot be deleted (NO ACTION)');
select throws_ok(
  $$ delete from public.profile_form_questions where id = '24000000-0000-4000-8000-070000000001' $$,
  '23503', null, 'D-640: an opener with a branch cannot be deleted (NO ACTION)');
select lives_ok(
  $$ delete from public.profile_form_questions where id = '24000000-0000-4000-8000-070000000003' $$,
  'T-12.2-01: the positive control, with the question gone the branch can follow');
delete from public.profile_form_branches where id = '24000000-0000-4000-8000-0b00000000c5';

-- ── (2) the four policies x two tenants x the three real roles ─────────────────────────────────
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000001', 'admin_tenant');
select set_eq(
  $$ select id::text from public.profile_form_branches $$,
  $$ values ('24000000-0000-4000-8000-0000000000b1'), ('24000000-0000-4000-8000-0000000000b2'), ('24000000-0000-4000-8000-0000000000b3'), ('24000000-0000-4000-8000-0000000000b4') $$,
  'T-12.2-01: the admin of A reads exactly A''s four branches (as a SET)');
select is_empty(
  $$ select 1 from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000002' $$,
  'T-12.2-01 cross-tenant: the admin of A reads ZERO of B''s branches');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-0b00000000e1', '24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', array['zz']) $$,
  'T-12.2-01: the admin of A inserts a branch for A (positive control)');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-060000000001', array['x2']) $$,
  '42501', null, 'T-12.2-01 cross-tenant: the admin of A cannot insert a branch for B');
select results_eq(
  $$ with u as (update public.profile_form_branches set name = 'Hacked' where tenant_id = '24000000-0000-4000-8000-010000000002' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.2-01 cross-tenant: the admin of A updates zero of B''s branches');
select results_eq(
  $$ with d as (delete from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000002' returning 1) select count(*)::int from d $$,
  array[0], 'T-12.2-01 cross-tenant: the admin of A deletes zero of B''s branches');
select results_eq(
  $$ with u as (update public.profile_form_branches set name = 'Renomeado' where id = '24000000-0000-4000-8000-0b00000000e1' returning 1) select count(*)::int from u $$,
  array[1], 'T-12.2-01: the admin of A renames its own branch (positive control)');
select throws_ok(
  $$ update public.profile_form_branches set tenant_id = '24000000-0000-4000-8000-010000000002' where id = '24000000-0000-4000-8000-0b00000000e1' $$,
  '42501', null, 'T-12.2-01 cross-tenant: the admin of A cannot hand its own branch to B');
select results_eq(
  $$ with d as (delete from public.profile_form_branches where id = '24000000-0000-4000-8000-0b00000000e1' returning 1) select count(*)::int from d $$,
  array[1], 'T-12.2-01: the admin of A deletes its own empty branch (positive control)');
reset role;

select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000002', 'support_tenant');
select set_eq(
  $$ select id::text from public.profile_form_branches $$,
  $$ values ('24000000-0000-4000-8000-0000000000b1'), ('24000000-0000-4000-8000-0000000000b2'), ('24000000-0000-4000-8000-0000000000b3'), ('24000000-0000-4000-8000-0000000000b4') $$,
  'T-12.2-01: a support_tenant of A reads A''s four branches');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', array['zz']) $$,
  '42501', null, 'T-12.2-01: a support_tenant cannot insert a branch');
select results_eq(
  $$ with u as (update public.profile_form_branches set name = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.2-01: a support_tenant updates zero branches');
select results_eq(
  $$ with d as (delete from public.profile_form_branches returning 1) select count(*)::int from d $$,
  array[0], 'T-12.2-01: a support_tenant deletes zero branches');
reset role;

select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq(
  $$ select id::text from public.profile_form_branches $$,
  $$ values ('24000000-0000-4000-8000-0000000000b1'), ('24000000-0000-4000-8000-0000000000b2'), ('24000000-0000-4000-8000-0000000000b3'), ('24000000-0000-4000-8000-0000000000b4') $$,
  'T-12.2-01: a member of A reads A''s four branches (the member form needs them)');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', array['zz']) $$,
  '42501', null, 'T-12.2-01: a member cannot insert a branch');
select results_eq(
  $$ with u as (update public.profile_form_branches set name = 'Hacked' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.2-01: a member updates zero branches');
select results_eq(
  $$ with d as (delete from public.profile_form_branches returning 1) select count(*)::int from d $$,
  array[0], 'T-12.2-01: a member deletes zero branches');
reset role;

select tests.as_tenant('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-020000000005', 'admin_tenant');
select set_eq(
  $$ select id::text from public.profile_form_branches $$,
  $$ values ('24000000-0000-4000-8000-0b0000000001') $$,
  'T-12.2-01 cross-tenant: the admin of B reads exactly B''s one branch');
select results_eq(
  $$ with u as (update public.profile_form_branches set name = 'Hacked' where tenant_id = '24000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from u $$,
  array[0], 'T-12.2-01 cross-tenant: the admin of B updates zero of A''s branches');
select results_eq(
  $$ with d as (delete from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000001' returning 1) select count(*)::int from d $$,
  array[0], 'T-12.2-01 cross-tenant: the admin of B deletes zero of A''s branches');
select throws_ok(
  $$ insert into public.profile_form_branches (tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', array['zz']) $$,
  '42501', null, 'T-12.2-01 cross-tenant: the admin of B cannot insert a branch for A');
select lives_ok(
  $$ insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values) values ('24000000-0000-4000-8000-0b00000000e2', '24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-060000000001', array['x2']) $$,
  'T-12.2-01: the admin of B inserts a branch for B (positive control)');
select results_eq(
  $$ with d as (delete from public.profile_form_branches where id = '24000000-0000-4000-8000-0b00000000e2' returning 1) select count(*)::int from d $$,
  array[1], 'T-12.2-01: and deletes it again');
reset role;

select tests.as_tenant('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-020000000006', 'member');
select set_eq(
  $$ select id::text from public.profile_form_branches $$,
  $$ values ('24000000-0000-4000-8000-0b0000000001') $$,
  'T-12.2-01 cross-tenant: a member of B reads B''s one branch and none of A''s');
reset role;
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', null);
select is_empty($$ select 1 from public.profile_form_branches $$, 'T-12.2-01: a lane with a NULL role claim reads no branch (fails closed)');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from public.profile_form_branches $$, 'T-12.2-01: a lane with NO claims reads no branch');
reset role;

-- ── (3) the gate over a chain: the rows of PROFILE_FORM_CHAIN_CASES (tenant A, member m1) ──────
-- Rows 1..9 on the clinic fixture. The gate returns an integer (PFORM-46 precision: no float, no cast involved).
select is(pg_typeof(tests.pf_gate_a())::text, 'integer', 'PFORM-46 precision: the gate returns an integer');
select tests.pf_load(1);
select is(tests.pf_gate_a(), 0, 'chain row 1 gate: no answers, only the top question is visible and it is optional (owed: none)');
select tests.pf_load(2);
select is(tests.pf_gate_a(), 1, 'chain row 2 gate: depth 1, Q1=tem opens B1 (owed: Q3)');
select tests.pf_load(3);
select is(tests.pf_gate_a(), 2, 'chain row 3 gate: depth 2, Q2=true opens B2 (owed: Q3, Q4)');
select tests.pf_load(4);
select is(tests.pf_gate_a(), 3, 'chain row 4 gate: depth 3 is visible and owed, Q5=true opens B3 (owed: Q3, Q4, Q6)');
select tests.pf_load(5);
select is(tests.pf_gate_a(), 0, 'chain row 5 gate: stale deeper answers, Q1 changed to trabalha closes the whole chain (owed: none)');
select tests.pf_load(6);
select is(tests.pf_gate_a(), 1, 'chain row 6 gate: stale middle answer, Q2=false closes B2 and B3 while B1 stays open (owed: Q3)');
select tests.pf_load(7);
select is(tests.pf_gate_a(), 1, 'chain row 7 gate: the other branch of the same opener, Q1=aprende opens B4 (owed: Q7)');
select tests.pf_load(8);
select is(tests.pf_gate_a(), 0, 'chain row 8 gate: Outro on the opener (no option id) opens nothing (owed: none)');
select tests.pf_load(9);
select is(tests.pf_gate_a(), 1, 'chain row 9 gate: a yes/no answer stored as the string ''true'' is no token, B2 stays closed (owed: Q3)');

-- Row 10: the any-of tree of tenant H. Q1=tem opens B1, Q2 has the second OR the third option, B2 opens on either.
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a1', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionIds":["24000000-0000-4000-8000-0000000000f1","24000000-0000-4000-8000-0000000000f3"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 1,
  'chain row 10 gate: any-of multiple-choice opener at depth 2, one overlapping option (f3 of f1, f3) opens B2 (owed: Q3)');
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionIds":["24000000-0000-4000-8000-0000000000f2"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 1,
  'PFORM-46 adjacency: the OTHER opening value alone (f2) also opens B2 (either of two is enough)');
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionIds":["24000000-0000-4000-8000-0000000000f1"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 0,
  'PFORM-46 adjacency: a ticked option that is in NO opening value (f1 alone) leaves B2 closed');
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionIds":["24000000-0000-4000-8000-0000000000F3"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 0,
  'PFORM-46 adjacency: a value one character off (F3 for f3) does not open: tokens compare exactly');
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a1', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionId":"24000000-0000-4000-8000-0000000000E1","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionIds":["24000000-0000-4000-8000-0000000000f3"],"otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 0,
  'PFORM-46 adjacency: with the TOP opener one character off (E1 for e1) the whole chain is closed even though f3 is ticked');
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a1', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionId":"24000000-0000-4000-8000-0000000000e1","otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 1,
  'PFORM-46 adjacency: and with the exact option id back the chain opens again (the positive control of the two zeros above)');
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a7', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', 'true'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-030000000009'), 1,
  'PFORM-46 adjacency: a yes/no answered true does not open a branch whose value is ''True'' (Q5 stays hidden; owed stays Q3)');

-- The other edges of the gate.
select tests.pf_load(2);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-030000000001'), 0, 'PFORM-46 empty: an admin_tenant is never held, branches or not');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-030000000002'), 0, 'PFORM-46 empty: a support_tenant is never held, branches or not');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000004', '24000000-0000-4000-8000-030000000008'), 0, 'PFORM-46 empty: a tenant with no question owes nothing');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-030000000007'), 0, 'PFORM-46 empty: a tenant with the module OFF owes nothing even with a required question');
update public.tenant_modules set enabled = true where tenant_id = '24000000-0000-4000-8000-010000000003' and module_key = 'profile_form';
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000003', '24000000-0000-4000-8000-030000000007'), 1, 'PFORM-46 empty: the positive control, module on gives the one required question');
update public.tenant_modules set enabled = false where tenant_id = '24000000-0000-4000-8000-010000000003' and module_key = 'profile_form';
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-030000000006'), 1,
  'PFORM-46 empty: a member with no answers owes only the unconditional required question of the tenant');
select tests.pf_a('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-060000000001', '24000000-0000-4000-8000-030000000006', '24000000-0000-4000-8000-020000000006', '{"optionId":"x1","otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-030000000006'), 2,
  'T-12.2-01 cross-tenant: with B''s opener matching B owes exactly its own two (A''s questions never count for B)');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-030000000006'), 0, 'T-12.2-01 cross-tenant: B''s member evaluated against A''s tenant id gives 0');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-030000000003'), 0, 'T-12.2-01 cross-tenant: A''s member evaluated against B''s tenant id gives 0');
select is(tests.pf_gate_a(), 1, 'T-12.2-01 cross-tenant: and A''s member against A still gives 1 (the positive control for both zeros)');

-- PFORM-46 ordering: the same tree inserted in two orders returns the same count.
select tests.pf_a('24000000-0000-4000-8000-010000000006', '24000000-0000-4000-8000-c10000000001', '24000000-0000-4000-8000-03000000000a', '24000000-0000-4000-8000-02000000000a', '{"optionId":"k1","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000007', '24000000-0000-4000-8000-c20000000001', '24000000-0000-4000-8000-03000000000b', '24000000-0000-4000-8000-02000000000b', '{"optionId":"k1","otherText":null}'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000006', '24000000-0000-4000-8000-03000000000a'), 2,
  'PFORM-46 ordering: the tree inserted LEAVES FIRST (K) owes Q0 and Q3 when only the opener is answered');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000007', '24000000-0000-4000-8000-03000000000b'), 2,
  'PFORM-46 ordering: the same tree inserted in order (L) owes the same two');
select tests.pf_a('24000000-0000-4000-8000-010000000006', '24000000-0000-4000-8000-c10000000002', '24000000-0000-4000-8000-03000000000a', '24000000-0000-4000-8000-02000000000a', 'true'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000007', '24000000-0000-4000-8000-c20000000002', '24000000-0000-4000-8000-03000000000b', '24000000-0000-4000-8000-02000000000b', 'true'::jsonb);
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000006', '24000000-0000-4000-8000-03000000000a'), 3,
  'PFORM-46 ordering: leaves first (K), depth 2 open, owes Q0, Q3 and Q4');
select is(app.profile_form_missing('24000000-0000-4000-8000-010000000007', '24000000-0000-4000-8000-03000000000b'), 3,
  'PFORM-46 ordering: in order (L), the same three');

-- ── (4) the purge: the rows of PROFILE_FORM_CHAIN_CASES (tenant A, member m1) ──────────────────
-- Each row loads the stored answers, runs the purge AS the member (the real claims-scoped call) and compares the returned
-- ids with the `purged` keys of the table; the rows that purge nothing must also leave the stored answers alone.
create function tests.pf_count_a() returns integer language sql as $$
  select count(*)::int from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003';
$$;
select tests.pf_load(1);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 1 purge: no answers, nothing purged');
reset role;
select tests.pf_load(2);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 2 purge: depth 1 open, nothing purged');
reset role;
select tests.pf_load(3);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 3 purge: depth 2 open, nothing purged');
reset role;
select tests.pf_load(4);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 4 purge: depth 3 open, nothing purged');
reset role;
select is(tests.pf_count_a(), 3, 'chain row 4 purge: and all three stored answers are still there');
select tests.pf_load(5);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q2', 'Q5')) $$,
  'chain row 5 purge: stale deeper answers, Q1 changed to trabalha deletes Q2 and Q5 down the whole chain in one call');
reset role;
select set_eq($$ select question_id::text from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003' $$, $$ select unnest(tests.pf_keys('Q1')) $$,
  'chain row 5 purge: only the opener answer is left');
select tests.pf_load(6);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q5')) $$,
  'chain row 6 purge: stale middle answer, Q2=false deletes Q5 while Q2 itself stays (B1 is open)');
reset role;
select set_eq($$ select question_id::text from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003' $$, $$ select unnest(tests.pf_keys('Q1', 'Q2')) $$,
  'chain row 6 purge: Q1 and Q2 are left');
select tests.pf_load(7);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 7 purge: the other branch of the same opener is open, nothing purged');
reset role;
select tests.pf_load(8);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 8 purge: an Outro opener answer has no dependents to purge');
reset role;
select tests.pf_load(9);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys()) $$,
  'chain row 9 purge: the string ''true'' for Q2 deletes nothing (Q2 itself sits in the open B1, B2 holds no answer)');
reset role;

-- Row 10 on tenant H: the any-of chain, purged as H's member.
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a3', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '"resposta"'::jsonb);
select tests.as_tenant('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-020000000009', 'member');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$,
  'chain row 10 purge: the any-of chain is open (Q2 holds f3), Q3''s answer stays');
reset role;
select tests.pf_a('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-0000000000a2', '24000000-0000-4000-8000-030000000009', '24000000-0000-4000-8000-020000000009', '{"optionIds":["24000000-0000-4000-8000-0000000000f1"],"otherText":null}'::jsonb);
select tests.as_tenant('24000000-0000-4000-8000-010000000005', '24000000-0000-4000-8000-020000000009', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ values ('24000000-0000-4000-8000-0000000000a3') $$,
  'chain row 10 purge: with only f1 ticked B2 is closed and Q3''s answer is deleted (the negative beside the positive above)');
reset role;

-- PFORM-47 adjacency: two branches of ONE opener, one open (B1) and one closed (B4): the closed branch's answers go.
select tests.pf_load(2);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '"clinica"'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000007', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '"escola"'::jsonb);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q7')) $$,
  'PFORM-47 adjacency: Q1=tem opens B1 and closes B4, so the answer of B4''s Q7 is deleted');
reset role;
select set_eq($$ select question_id::text from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003' $$, $$ select unnest(tests.pf_keys('Q1', 'Q3')) $$,
  'PFORM-47 adjacency: and the open branch''s Q3 answer is kept next to the opener');

-- PFORM-47 empty: a member with no answers gets no row back and nothing changes.
select tests.pf_load(1);
select is(tests.pf_count_a(), 0, 'PFORM-47 empty: m1 holds no answer before the purge');
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$, 'PFORM-47 empty: a member with no answers gets no row back');
reset role;
select is(tests.pf_count_a(), 0, 'PFORM-47 empty: and still holds none afterwards');

-- PFORM-47 idempotency and T-12.2-12: the purge is scoped to the caller's own answers.
-- m2 of A holds the same stale chain as row 5; B's member holds a stale answer too.
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-020000000004', '{"optionId":"24000000-0000-4000-8000-0000000000e2","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-020000000004', 'true'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-020000000004', 'true'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-060000000001', '24000000-0000-4000-8000-030000000006', '24000000-0000-4000-8000-020000000006', '{"optionId":"x2","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-060000000002', '24000000-0000-4000-8000-030000000006', '24000000-0000-4000-8000-020000000006', '"velha de B"'::jsonb);
select tests.pf_load(5);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q2', 'Q5')) $$,
  'T-12.2-12: m1''s own call deletes m1''s own Q2 and Q5');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$, 'PFORM-47 idempotency: a second call deletes nothing');
reset role;
select is((select count(*)::int from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000004'), 3,
  'T-12.2-12 cross-member: m2''s three stale answers survived m1''s purge');
select is((select count(*)::int from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000006'), 2,
  'T-12.2-12 cross-tenant: and so did the two answers of B''s member');
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000004', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q2', 'Q5')) $$,
  'T-12.2-12 cross-member: the positive control, m2''s own call deletes m2''s own stale answers');
reset role;
select is((select count(*)::int from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000006'), 2,
  'T-12.2-12 cross-tenant: B''s answers still survive both calls of A');
select tests.as_tenant('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-020000000006', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ values ('24000000-0000-4000-8000-060000000002') $$,
  'T-12.2-12 cross-tenant: the positive control, B''s member purges B''s own stale answer');
reset role;
select set_eq($$ select question_id::text from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000004' $$, $$ select unnest(tests.pf_keys('Q1')) $$,
  'T-12.2-12: and B''s call left m2''s answers exactly as the purge of m2 left them');
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000001', 'admin_tenant');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$, 'T-12.2-12: a staff session purges nothing (no answers of its own)');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from app.profile_form_purge_closed() $$, 'T-12.2-12: a session with no claims purges nothing');
reset role;
select is((select pronargs::int from pg_proc where oid = 'app.profile_form_purge_closed()'::regprocedure), 0,
  'T-12.2-12: the purge accepts no argument, so it cannot name another member or tenant');
select is(
  (select count(*)::int from pg_proc
    where oid in ('app.profile_form_purge_closed()'::regprocedure, 'app.profile_form_lock_active_v3()'::regprocedure,
                  'app.profile_form_lock_branches()'::regprocedure)
      and prosecdef and proconfig @> array['search_path=""']),
  3, 'T-12.2-12: the purge and the two lock functions are SECURITY DEFINER with an empty search_path');

-- PFORM-47 ordering: the whole chain is judged against ONE snapshot, so the order the answers were stored in does not matter.
delete from public.profile_form_answers where membership_id in ('24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-030000000004');
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', 'true'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', 'true'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '{"optionId":"24000000-0000-4000-8000-0000000000e2","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-020000000004', '{"optionId":"24000000-0000-4000-8000-0000000000e2","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-020000000004', 'true'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-030000000004', '24000000-0000-4000-8000-020000000004', 'true'::jsonb);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q2', 'Q5')) $$,
  'PFORM-47 ordering: answers stored bottom first (Q5, Q2, Q1) purge the top and the bottom of the chain in one statement');
reset role;
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000004', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q2', 'Q5')) $$,
  'PFORM-47 ordering: answers stored top first (Q1, Q2, Q5) give the same purged set');
reset role;
select is(
  (select string_agg(question_id::text, ',' order by question_id) from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003'),
  (select string_agg(question_id::text, ',' order by question_id) from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000004'),
  'PFORM-47 ordering: and the remaining sets of the two members are identical');

-- T-12.2-06: the purge keeps the answers of an ARCHIVED block and still erases a really closed chain.
-- B1, B2, B3 and Q2..Q6 are archived with ONE timestamp; m1 answers every question of the block.
select tests.pf_load(4);
select is(tests.pf_gate_a(), 3, 'T-12.2-06: before archiving, m1 (Q1, Q2, Q5 answered) owes Q3, Q4 and Q6');
update public.profile_form_branches set archived_at = '2026-02-02 10:00:00+00'
 where id in ('24000000-0000-4000-8000-0000000000b3', '24000000-0000-4000-8000-0000000000b2', '24000000-0000-4000-8000-0000000000b1');
update public.profile_form_questions set archived_at = '2026-02-02 10:00:00+00'
 where id in ('24000000-0000-4000-8000-000000000006', '24000000-0000-4000-8000-000000000005', '24000000-0000-4000-8000-000000000004', '24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000002');
select is(tests.pf_gate_a(), 0, 'PFORM-46 precision: a question archived with its branch never counts (the three owed questions are archived)');
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '"clinica"'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000004', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '5'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000006', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '"socio"'::jsonb);
select is(tests.pf_count_a(), 6, 'T-12.2-06: m1 holds six answers, five of them to ARCHIVED questions of archived branches');
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select is_empty($$ select 1 from app.profile_form_purge_closed() $$,
  'T-12.2-06: the chain is open, so the purge deletes nothing although the whole block is archived');
reset role;
select is(tests.pf_count_a(), 6, 'T-12.2-06: and every archived answer survives');
select tests.pf_a('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-030000000003', '24000000-0000-4000-8000-020000000003', '{"optionId":"24000000-0000-4000-8000-0000000000e2","otherText":null}'::jsonb);
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select set_eq($$ select question_id::text from app.profile_form_purge_closed() $$, $$ select unnest(tests.pf_keys('Q2', 'Q3', 'Q4', 'Q5', 'Q6')) $$,
  'T-12.2-06: the positive control, once Q1 really closes the chain the answers of the archived questions are deleted too');
reset role;
select set_eq($$ select question_id::text from public.profile_form_answers where membership_id = '24000000-0000-4000-8000-030000000003' $$, $$ select unnest(tests.pf_keys('Q1')) $$,
  'T-12.2-06: only the opener answer is left');

-- ── (5) the guards: PF006, PF007, PF008, PF009, PF010 and PF001..PF005 still firing (tenant G) ─
-- Short id helpers for the guard lab: question n of G is `…0e00000000<nn>`, branch n is `…0d00000000<nn>`.
create function tests.gq(n int) returns uuid language sql immutable as $$ select ('24000000-0000-4000-8000-0e00000000' || lpad(n::text, 2, '0'))::uuid $$;
create function tests.gb(n int) returns uuid language sql immutable as $$ select ('24000000-0000-4000-8000-0d00000000' || lpad(n::text, 2, '0'))::uuid $$;
select tests.tenant('pgtap-pf3-g', 'Pf3 G', '24000000-0000-4000-8000-010000000008');
select tests.auth_user('member1@pf3-g.local', '24000000-0000-4000-8000-02000000000c');
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-02000000000c', 'member', 'active');
insert into public.tenant_modules (tenant_id, module_key, enabled) values ('24000000-0000-4000-8000-010000000008', 'profile_form', true);
insert into public.profile_form_steps (id, tenant_id, title, position) values
  ('24000000-0000-4000-8000-050000000008', '24000000-0000-4000-8000-010000000008', 'Passo G', 1);
-- G1 opener (g1, g2, g3); G6 a second opener; branches 1 (g1), 2 (g2, g3), 3 (g1), 4 (g3), all on G1.
select tests.pf_q(tests.gq(1), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'single_choice', 'G abridor', 1, false,
  '[{"id":"g1","label":"G um"},{"id":"g2","label":"G dois"},{"id":"g3","label":"G tres"}]'::jsonb);
select tests.pf_q(tests.gq(6), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'single_choice', 'G outro abridor', 6, false,
  '[{"id":"z1","label":"Z um"},{"id":"z2","label":"Z dois"}]'::jsonb);
select tests.pf_b(tests.gb(1), '24000000-0000-4000-8000-010000000008', tests.gq(1), array['g1']);
select tests.pf_b(tests.gb(2), '24000000-0000-4000-8000-010000000008', tests.gq(1), array['g2', 'g3']);
select tests.pf_b(tests.gb(3), '24000000-0000-4000-8000-010000000008', tests.gq(1), array['g1']);
select tests.pf_b(tests.gb(4), '24000000-0000-4000-8000-010000000008', tests.gq(1), array['g3']);
-- G2 answered, no branch; G3 answered in branch 1; G4 unanswered, no branch; G5 answered in branch 2; G7 unanswered in branch 3;
-- G8 multiple choice with Outro answered; G9 number answered; G10 plain and unanswered (the passing control of PF001..PF005).
select tests.pf_q(tests.gq(2), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'G dois', 2);
select tests.pf_q(tests.gq(3), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'G tres', 3, p_branch => tests.gb(1));
select tests.pf_q(tests.gq(4), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'G quatro', 4);
select tests.pf_q(tests.gq(5), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'G cinco', 5, p_branch => tests.gb(2));
select tests.pf_q(tests.gq(7), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'G sete', 7, p_branch => tests.gb(3));
select tests.pf_q(tests.gq(8), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'multiple_choice', 'G varias', 8, false,
  '[{"id":"m1","label":"Um"},{"id":"m2","label":"Dois"},{"id":"m3","label":"Tres"}]'::jsonb, true);
select tests.pf_q(tests.gq(9), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'number', 'G numero', 9, p_limits => '{"min":1,"max":10}'::jsonb);
select tests.pf_q(tests.gq(10), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'G livre', 10);
select tests.pf_a('24000000-0000-4000-8000-010000000008', tests.gq(1), '24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-02000000000c', '{"optionId":"g1","otherText":null}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000008', tests.gq(2), '24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-02000000000c', '"x"'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000008', tests.gq(3), '24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-02000000000c', '"y"'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000008', tests.gq(5), '24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-02000000000c', '"z"'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000008', tests.gq(8), '24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-02000000000c', '{"optionIds":["m1"],"otherText":"Meu"}'::jsonb);
select tests.pf_a('24000000-0000-4000-8000-010000000008', tests.gq(9), '24000000-0000-4000-8000-03000000000c', '24000000-0000-4000-8000-02000000000c', '5'::jsonb);

-- PF006 on a QUESTION (D-646): an answered question may not enter or change branch; leaving passes.
select throws_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(1) where id = tests.gq(2) $$,
  'PF006', null, 'D-646/PF006: an answered question cannot ENTER a branch from none');
select lives_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(1) where id = tests.gq(4) $$,
  'D-646/PF006: the same edit passes on a question nobody answered (positive control)');
select throws_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(2) where id = tests.gq(3) $$,
  'PF006', null, 'PFORM-48 adjacency: an answered question cannot move from one branch to ANOTHER');
select lives_ok(
  $$ update public.profile_form_questions set title = 'G tres editada' where id = tests.gq(3) $$,
  'D-646/PF006: an edit that leaves the branch alone passes on an answered question');
select lives_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(1) where id = tests.gq(3) $$,
  'D-646/PF006: setting the branch to the SAME branch passes (no change)');
select lives_ok(
  $$ update public.profile_form_questions set branch_id = null where id = tests.gq(3) $$,
  'PFORM-48 adjacency: setting the branch of an answered question to null passes ("Desfazer ramo" needs it)');
select throws_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(1) where id = tests.gq(3) $$,
  'PF006', null, 'D-646/PF006: and entering it again afterwards is refused again (it is an entry, the question still has answers)');

-- PF006 on a BRANCH: the opener and the SET of opening values freeze once a question of the branch has an answer.
select throws_ok(
  $$ update public.profile_form_branches set opener_question_id = tests.gq(6) where id = tests.gb(2) $$,
  'PF006', null, 'D-646/PF006: a branch with an answered question cannot change opener');
select throws_ok(
  $$ update public.profile_form_branches set open_values = array['g2'] where id = tests.gb(2) $$,
  'PF006', null, 'D-646/PF006: a branch with an answered question cannot REMOVE an opening value');
select throws_ok(
  $$ update public.profile_form_branches set open_values = array['g2', 'g3', 'g1'] where id = tests.gb(2) $$,
  'PF006', null, 'D-646/PF006: and cannot ADD one either');
select lives_ok(
  $$ update public.profile_form_branches set open_values = array['g3', 'g2'] where id = tests.gb(2) $$,
  'D-646/PF006: the same set in ANOTHER ORDER passes');
select lives_ok(
  $$ update public.profile_form_branches set open_values = array['g3', 'g2', 'g3'] where id = tests.gb(2) $$,
  'D-646/PF006: the same set with a repeated value passes');
select lives_ok(
  $$ update public.profile_form_branches set name = 'Renomeado', revision = revision + 1 where id = tests.gb(2) $$,
  'D-646/PF006: a NAME change (and a revision bump) passes on a branch with answers');
select lives_ok(
  $$ update public.profile_form_branches set archived_at = now() where id = tests.gb(2) $$,
  'D-646/PF006: an ARCHIVE passes on a branch with answers');
select lives_ok(
  $$ update public.profile_form_branches set opener_question_id = tests.gq(6), open_values = array['z1'] where id = tests.gb(3) $$,
  'PFORM-48 empty: a branch none of whose questions has an answer can change opener and values');
select lives_ok(
  $$ update public.profile_form_branches set opener_question_id = tests.gq(6), open_values = array['z2'] where id = tests.gb(4) $$,
  'PFORM-48 empty: and so can a branch with no question at all');
select is(
  (select (tgtype & 3) || ':' || (tgtype & 16) from pg_trigger where tgname = 'profile_form_branches_guard' and tgrelid = 'public.profile_form_branches'::regclass),
  '3:16', 'PFORM-48 ordering: the branch guard is a BEFORE UPDATE FOR EACH ROW trigger, so it runs after the row lock of the update');

-- PF007: an opener with an ACTIVE branch (D-646). Independent of answers, so it fires BEFORE the early return.
select tests.pf_q(tests.gq(11), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'single_choice', 'H abridor', 11, false,
  '[{"id":"h1","label":"H um"},{"id":"h2","label":"H dois"},{"id":"h3","label":"H tres"}]'::jsonb);
select tests.pf_b(tests.gb(11), '24000000-0000-4000-8000-010000000008', tests.gq(11), array['h1']);
select throws_ok(
  $$ update public.profile_form_questions set archived_at = now() where id = tests.gq(11) $$,
  'PF007', null, 'PFORM-48 ordering/PF007: an UNANSWERED opener with an active branch cannot be archived (raised before the early return)');
select throws_ok(
  $$ update public.profile_form_questions set type = 'dropdown' where id = tests.gq(11) $$,
  'PF007', null, 'D-646/PF007: an opener with an active branch cannot be retyped, even with no answer');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"h2","label":"H dois"},{"id":"h3","label":"H tres"}]'::jsonb where id = tests.gq(11) $$,
  'PF007', null, 'D-646/PF007: an opener cannot lose an option id that an active branch references');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"h1","label":"H um"},{"id":"h2","label":"H dois"}]'::jsonb where id = tests.gq(11) $$,
  'D-646/PF007: removing an option NO active branch references passes (positive control)');
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"h1","label":"H primeiro"},{"id":"h2","label":"H dois"}]'::jsonb where id = tests.gq(11) $$,
  'D-646/PF007: relabelling the referenced option keeps its id and passes');
select throws_ok(
  $$ update public.profile_form_questions set type = 'dropdown' where id = tests.gq(1) $$,
  'PF007', null, 'D-646/PF007 ordering: an ANSWERED opener with an active branch gets PF007, not PF001 (PF007 is tested first)');
update public.profile_form_branches set archived_at = now() where id = tests.gb(11);
select lives_ok(
  $$ update public.profile_form_questions set options = '[{"id":"h2","label":"H dois"},{"id":"h4","label":"H quatro"}]'::jsonb where id = tests.gq(11) $$,
  'D-646/PF007 archived: once the branch is archived the opener can lose the option it referenced');
select lives_ok(
  $$ update public.profile_form_questions set type = 'dropdown' where id = tests.gq(11) $$,
  'D-646/PF007 archived: and can be retyped');
select lives_ok(
  $$ update public.profile_form_questions set archived_at = now() where id = tests.gq(11) $$,
  'D-646/PF007 archived: and can be archived');

-- PF008: a fourth level, a move that deepens, a cycle (T-12.2-07). Chain: F1 > B21 > F2 > B22 > F3 > B23 > F4.
select tests.pf_q(tests.gq(21), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'F1', 21);
select tests.pf_b(tests.gb(21), '24000000-0000-4000-8000-010000000008', tests.gq(21), array['true']);
select tests.pf_q(tests.gq(22), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'F2', 22, p_branch => tests.gb(21));
select tests.pf_b(tests.gb(22), '24000000-0000-4000-8000-010000000008', tests.gq(22), array['true']);
select tests.pf_q(tests.gq(23), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'F3', 23, p_branch => tests.gb(22));
select lives_ok(
  $$ select tests.pf_b(tests.gb(23), '24000000-0000-4000-8000-010000000008', tests.gq(23), array['true']) $$,
  'PFORM-46 boundary: a THIRD level (a branch opened by a question that sits in a second-level branch) is accepted');
select tests.pf_q(tests.gq(24), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'F4', 24, p_branch => tests.gb(23));
select throws_ok(
  $$ select tests.pf_b(tests.gb(24), '24000000-0000-4000-8000-010000000008', tests.gq(24), array['true']) $$,
  'PF008', null, 'chain row 11 (SQL form): a branch that would make a FOURTH level is refused by PF008 at insert (one step past the limit)');
select tests.pf_b(tests.gb(26), '24000000-0000-4000-8000-010000000008', tests.gq(21), array['true']);
select tests.pf_q(tests.gq(27), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'F7', 27, p_branch => tests.gb(26));
select tests.pf_b(tests.gb(27), '24000000-0000-4000-8000-010000000008', tests.gq(27), array['true']);
select tests.pf_q(tests.gq(28), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'F8', 28, p_branch => tests.gb(27));
select throws_ok(
  $$ update public.profile_form_branches set opener_question_id = tests.gq(24) where id = tests.gb(26) $$,
  'PF008', null, 'T-12.2-07: moving a two-level subtree under a third-level question (fifth level) is refused');
select throws_ok(
  $$ update public.profile_form_branches set opener_question_id = tests.gq(23) where id = tests.gb(26) $$,
  'PF008', null, 'T-12.2-07: moving it under a second-level question (a fourth level for its child) is refused');
select lives_ok(
  $$ update public.profile_form_branches set opener_question_id = tests.gq(22) where id = tests.gb(26) $$,
  'T-12.2-07: the positive control, moving it under a question of a first-level branch keeps three levels and passes');
select throws_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(23) where id = tests.gq(27) $$,
  'PF008', null, 'T-12.2-07: moving a question that opens a branch into a third-level branch makes a fourth level and is refused');
select tests.pf_q(tests.gq(31), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'C1', 31);
select tests.pf_q(tests.gq(32), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'C2', 32);
select tests.pf_b(tests.gb(31), '24000000-0000-4000-8000-010000000008', tests.gq(31), array['v']);
select tests.pf_b(tests.gb(32), '24000000-0000-4000-8000-010000000008', tests.gq(32), array['v']);
select lives_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(32) where id = tests.gq(31) $$,
  'T-12.2-07: the first half of a would-be cycle (C1 inside the branch C2 opens) is a legal chain and passes');
select throws_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(31) where id = tests.gq(32) $$,
  'PF008', null, 'T-12.2-07: closing the loop (C2 inside the branch C1 opens) is a cycle and is refused by PF008');

-- PF009 (T-12.2-02, WR-06): a question shown on the profile under an opener that is not shown, at depths 1, 2 and 3.
select tests.pf_q(tests.gq(41), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'P1 privada', 41);
select tests.pf_b(tests.gb(41), '24000000-0000-4000-8000-010000000008', tests.gq(41), array['true']);
select throws_ok(
  $$ select tests.pf_q(tests.gq(42), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P2 publica', 42, p_branch => tests.gb(41), p_show => true) $$,
  'PF009', null, 'T-12.2-02 depth 1: a PUBLIC question inserted under a PRIVATE opener is refused');
select lives_ok(
  $$ select tests.pf_q(tests.gq(42), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P2 privada', 42, p_branch => tests.gb(41)) $$,
  'T-12.2-02 depth 1: the passing counterpart, the same question private');
select throws_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = tests.gq(42) $$,
  'PF009', null, 'T-12.2-02 depth 1: making it public while the opener is private is refused');
select lives_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = tests.gq(41) $$,
  'T-12.2-02: making the OPENER public first passes');
select lives_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = tests.gq(42) $$,
  'T-12.2-02: and now the dependent can be public');
select throws_ok(
  $$ update public.profile_form_questions set show_on_profile = false where id = tests.gq(41) $$,
  'PF009', null, 'T-12.2-02: turning the OPENER private while a public question hangs on it is refused');
select lives_ok(
  $$ update public.profile_form_questions set show_on_profile = false where id in (tests.gq(41), tests.gq(42)) $$,
  'T-12.2-02: turning both private in one statement passes (the check sees the end of the statement)');
-- A moved question: P3 is public under the public opener P4; moving it into the private P1 chain is refused.
select tests.pf_q(tests.gq(44), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'P4 publica', 44, p_show => true);
select tests.pf_b(tests.gb(42), '24000000-0000-4000-8000-010000000008', tests.gq(44), array['true']);
select tests.pf_q(tests.gq(43), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P3 publica', 43, p_branch => tests.gb(42), p_show => true);
select throws_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(41) where id = tests.gq(43) $$,
  'PF009', null, 'T-12.2-02: moving a PUBLIC question into a chain whose opener is private is refused');
select tests.pf_b(tests.gb(43), '24000000-0000-4000-8000-010000000008', tests.gq(44), array['false']);
select lives_ok(
  $$ update public.profile_form_questions set branch_id = tests.gb(43) where id = tests.gq(43) $$,
  'T-12.2-02: the passing counterpart, moving it to another branch of a PUBLIC opener');
-- Depth 2: an ARCHIVED public question P5 sits under the private P1 (archived rows are not judged themselves), P6 hangs on P5.
select tests.pf_q(tests.gq(45), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'P5 arquivada publica', 45, p_branch => tests.gb(41), p_archived => true, p_show => true);
select tests.pf_b(tests.gb(45), '24000000-0000-4000-8000-010000000008', tests.gq(45), array['true']);
select throws_ok(
  $$ select tests.pf_q(tests.gq(46), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P6 publica', 46, p_branch => tests.gb(45), p_show => true) $$,
  'PF009', null, 'T-12.2-02 depth 2: a public question whose SECOND opener up the chain is private is refused');
select lives_ok(
  $$ select tests.pf_q(tests.gq(46), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P6 privada', 46, p_branch => tests.gb(45)) $$,
  'T-12.2-02 depth 2: the passing counterpart, the same question private');
-- Depth 3: P7 archived public under P5 (itself archived public under the private P1), P8 hangs on P7.
select tests.pf_q(tests.gq(47), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'yes_no', 'P7 arquivada publica', 47, p_branch => tests.gb(45), p_archived => true, p_show => true);
select tests.pf_b(tests.gb(47), '24000000-0000-4000-8000-010000000008', tests.gq(47), array['true']);
select throws_ok(
  $$ select tests.pf_q(tests.gq(48), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P8 publica', 48, p_branch => tests.gb(47), p_show => true) $$,
  'PF009', null, 'T-12.2-02 depth 3: a public question whose THIRD opener up the chain is private is refused');
select lives_ok(
  $$ select tests.pf_q(tests.gq(48), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'P8 privada', 48, p_branch => tests.gb(47)) $$,
  'T-12.2-02 depth 3: the passing counterpart, the same question private');

-- PF010: the retired condition pair can no longer be written.
select throws_ok(
  $$ insert into public.profile_form_questions (tenant_id, step_id, type, title, position, created_by_user_id, condition_question_id, condition_values)
     values ('24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'Legado', 60, '24000000-0000-4000-8000-020000000001', tests.gq(6), array['z1']) $$,
  'PF010', null, 'T-12.2-08/PF010: inserting a question that carries the legacy condition pair is refused');
select lives_ok(
  $$ select tests.pf_q(tests.gq(60), '24000000-0000-4000-8000-010000000008', '24000000-0000-4000-8000-050000000008', 'short_text', 'Sem legado', 60) $$,
  'T-12.2-08/PF010: the positive control, the same insert without the pair');
select throws_ok(
  $$ update public.profile_form_questions set condition_question_id = tests.gq(6), condition_values = array['z1'] where id = tests.gq(60) $$,
  'PF010', null, 'T-12.2-08/PF010: updating a question to GAIN the legacy pair is refused');
select lives_ok(
  $$ update public.profile_form_questions set condition_question_id = null, condition_values = null, title = 'Sem legado 2' where id = tests.gq(60) $$,
  'T-12.2-08/PF010: an update that leaves the pair null passes');

-- PF001..PF005 still fire (the answered G2, G8, G9) and pass on the unanswered G10.
select throws_ok(
  $$ update public.profile_form_questions set type = 'long_text' where id = tests.gq(2) $$,
  'PF001', null, 'PF001 still fires: the type of an answered question cannot change');
select throws_ok(
  $$ update public.profile_form_questions set options = '[{"id":"m2","label":"Dois"},{"id":"m3","label":"Tres"}]'::jsonb where id = tests.gq(8) $$,
  'PF002', null, 'PF002 still fires: an answered option cannot be removed');
select throws_ok(
  $$ update public.profile_form_questions set allow_other = false where id = tests.gq(8) $$,
  'PF003', null, 'PF003 still fires: Outro cannot be turned off while an Outro answer exists');
select throws_ok(
  $$ update public.profile_form_questions set show_on_profile = true where id = tests.gq(2) $$,
  'PF004', null, 'PF004 still fires: a private answered question cannot become public');
select throws_ok(
  $$ update public.profile_form_questions set limits = '{"min":2,"max":10}'::jsonb where id = tests.gq(9) $$,
  'PF005', null, 'PF005 still fires: a number minimum that rises is refused');
select lives_ok(
  $$ update public.profile_form_questions set type = 'long_text', show_on_profile = true where id = tests.gq(10) $$,
  'PF001/PF004: the same edits pass on a question nobody answered (positive control)');

-- ── (6) the conversion replayed on 12.1-shaped rows (tenant R) ─────────────────────────────────
-- The statements of the `do` block of 20261106180523_profile_form_branches_functions.sql, copied into a function so they can
-- run twice. The 12.1 rows are written with the user triggers OFF (the new guards did not exist when they were written, and
-- the migration converts before it installs the question guard) and the conversion runs in the same state.
create function tests.pf_convert() returns void language plpgsql as $$
declare
  t uuid;
begin
  for t in
    select distinct q.tenant_id
      from public.profile_form_questions q
     where q.condition_question_id is not null
       and q.branch_id is null
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('profile_form:' || t::text, 0));

    update public.profile_form_questions d
       set show_on_profile = false
      from public.profile_form_questions o
     where d.tenant_id = t
       and d.archived_at is null
       and d.show_on_profile
       and d.branch_id is null
       and d.condition_question_id is not null
       and o.tenant_id = d.tenant_id
       and o.id = d.condition_question_id
       and not o.show_on_profile;

    insert into public.profile_form_branches (tenant_id, opener_question_id, open_values)
    select distinct q.tenant_id,
           q.condition_question_id,
           array(select v from unnest(q.condition_values) v order by v)
      from public.profile_form_questions q
     where q.tenant_id = t
       and q.condition_question_id is not null
       and q.branch_id is null;

    update public.profile_form_questions q
       set branch_id = b.id
      from public.profile_form_branches b
     where q.tenant_id = t
       and q.branch_id is null
       and q.condition_question_id is not null
       and b.tenant_id = q.tenant_id
       and b.opener_question_id = q.condition_question_id
       and b.open_values = array(select v from unnest(q.condition_values) v order by v);
  end loop;
end
$$;
select tests.tenant('pgtap-pf3-r', 'Pf3 R', '24000000-0000-4000-8000-010000000009');
select tests.auth_user('member1@pf3-r.local', '24000000-0000-4000-8000-02000000000d');
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('24000000-0000-4000-8000-03000000000d', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-02000000000d', 'member', 'active');
insert into public.profile_form_steps (id, tenant_id, title, position) values
  ('24000000-0000-4000-8000-050000000009', '24000000-0000-4000-8000-010000000009', 'Passo R', 1);
alter table public.profile_form_questions disable trigger user;
-- Ro1 single choice (public), Ro2 yes/no PRIVATE, Ru1 plain. Rd1 conditional + ANSWERED, Rd2 the same pair ARCHIVED,
-- Rd3 (r2, r1) a different set, Rd4 a PUBLIC dependent of the PRIVATE Ro2.
insert into public.profile_form_questions (id, tenant_id, step_id, type, title, required, options, position, show_on_profile, archived_at, created_by_user_id, condition_question_id, condition_values) values
  ('24000000-0000-4000-8000-0f0000000001', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'single_choice', 'R abridor um', false, '[{"id":"r1","label":"R um"},{"id":"r2","label":"R dois"}]', 1, true, null, '24000000-0000-4000-8000-020000000001', null, null),
  ('24000000-0000-4000-8000-0f0000000002', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'yes_no', 'R abridor dois', false, '[]', 2, false, null, '24000000-0000-4000-8000-020000000001', null, null),
  ('24000000-0000-4000-8000-0f0000000003', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'short_text', 'R plana', false, '[]', 3, false, null, '24000000-0000-4000-8000-020000000001', null, null),
  ('24000000-0000-4000-8000-0f0000000011', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'short_text', 'R dependente respondida', true, '[]', 4, false, null, '24000000-0000-4000-8000-020000000001', '24000000-0000-4000-8000-0f0000000001', array['r1']),
  ('24000000-0000-4000-8000-0f0000000012', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'short_text', 'R dependente arquivada', true, '[]', 5, false, now(), '24000000-0000-4000-8000-020000000001', '24000000-0000-4000-8000-0f0000000001', array['r1']),
  ('24000000-0000-4000-8000-0f0000000013', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'short_text', 'R dependente de dois', false, '[]', 6, false, null, '24000000-0000-4000-8000-020000000001', '24000000-0000-4000-8000-0f0000000001', array['r2', 'r1']),
  ('24000000-0000-4000-8000-0f0000000014', '24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-050000000009', 'short_text', 'R dependente publica de privada', false, '[]', 7, true, null, '24000000-0000-4000-8000-020000000001', '24000000-0000-4000-8000-0f0000000002', array['true']);
select tests.pf_a('24000000-0000-4000-8000-010000000009', '24000000-0000-4000-8000-0f0000000011', '24000000-0000-4000-8000-03000000000d', '24000000-0000-4000-8000-02000000000d', '"respondida"'::jsonb);
select is((select count(*)::int from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009'), 0,
  'T-12.2-18: tenant R holds 12.1-shaped rows and no branch before the conversion');
create temp table pf_before_a as
  select (select string_agg(ctid::text, ',' order by id) from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000001') as qs,
         (select string_agg(ctid::text, ',' order by id) from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000001') as bs;
select tests.pf_convert();
alter table public.profile_form_questions enable trigger user;
select is((select count(*)::int from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009'), 3,
  'T-12.2-18: three distinct (opener, sorted values) pairs give exactly three branches');
select set_eq(
  $$ select opener_question_id::text || '|' || array_to_string(open_values, ',') from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009' $$,
  $$ values ('24000000-0000-4000-8000-0f0000000001|r1'), ('24000000-0000-4000-8000-0f0000000001|r1,r2'), ('24000000-0000-4000-8000-0f0000000002|true') $$,
  'T-12.2-18: the branches are (Ro1, r1), (Ro1, r1 r2 SORTED) and (Ro2, true)');
select is((select count(*)::int from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009' and name is null and revision = 1 and archived_at is null), 3,
  'T-12.2-18: every converted branch is nameless, revision 1 and active');
select is((select count(distinct branch_id)::int from public.profile_form_questions where id in ('24000000-0000-4000-8000-0f0000000011', '24000000-0000-4000-8000-0f0000000012')), 1,
  'T-12.2-18: the answered dependent and the ARCHIVED one with the same pair point at the SAME branch');
select is((select count(*)::int from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000009' and condition_question_id is not null and branch_id is not null), 4,
  'T-12.2-18: every legacy dependent (archived included) points at a branch');
select is((select branch_id::text from public.profile_form_questions where id = '24000000-0000-4000-8000-0f0000000013'),
  (select id::text from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009' and open_values = array['r1', 'r2']),
  'T-12.2-18: the dependent with (r2, r1) points at the branch with the SORTED set');
select is((select count(*)::int from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000009' and branch_id is null and condition_question_id is null), 3,
  'T-12.2-18: the openers and the plain question are untouched (no branch)');
select is((select string_agg(condition_question_id::text || ':' || array_to_string(condition_values, ','), ';' order by id) from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000009' and condition_question_id is not null),
  '24000000-0000-4000-8000-0f0000000001:r1;24000000-0000-4000-8000-0f0000000001:r1;24000000-0000-4000-8000-0f0000000001:r2,r1;24000000-0000-4000-8000-0f0000000002:true',
  'T-12.2-18: the legacy columns are untouched (the values keep their original order)');
select is((select count(*)::int from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000009' and revision = 1), 7,
  'T-12.2-18: no revision was bumped');
select is((select show_on_profile::text from public.profile_form_questions where id = '24000000-0000-4000-8000-0f0000000014'), 'false',
  'T-12.2-02/T-12.2-18: the public dependent of a PRIVATE opener became private (so PF009 never meets a legacy row)');
select is((select show_on_profile::text from public.profile_form_questions where id = '24000000-0000-4000-8000-0f0000000001'), 'true',
  'T-12.2-18: and a public opener stays public');
select is((select count(*)::int from public.profile_form_answers where tenant_id = '24000000-0000-4000-8000-010000000009'), 1,
  'T-12.2-18: the answer to the answered dependent is untouched');
create temp table pf_after_one as
  select (select string_agg(ctid::text, ',' order by id) from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000009') as qs,
         (select string_agg(ctid::text, ',' order by id) from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009') as bs;
alter table public.profile_form_questions disable trigger user;
select tests.pf_convert();
alter table public.profile_form_questions enable trigger user;
select is((select count(*)::int from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009'), 3,
  'T-12.2-18 idempotency: a second replay adds no branch');
select is(
  (select qs || '|' || bs from pf_after_one),
  (select (select string_agg(ctid::text, ',' order by id) from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000009') || '|'
       || (select string_agg(ctid::text, ',' order by id) from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000009')),
  'T-12.2-18 idempotency: a second replay rewrites no row (every row keeps its physical tuple)');
select is(
  (select qs || '|' || bs from pf_before_a),
  (select (select string_agg(ctid::text, ',' order by id) from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000001') || '|'
       || (select string_agg(ctid::text, ',' order by id) from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-010000000001')),
  'T-12.2-18 empty: a tenant with no legacy condition (A) is untouched by both replays');
-- With the guards back on: a row that already carries the pair passes an edit that leaves it alone, and clearing it passes.
select lives_ok(
  $$ update public.profile_form_questions set title = 'R dependente respondida editada' where id = '24000000-0000-4000-8000-0f0000000011' $$,
  'T-12.2-08/PF010: a converted row that still carries the pair passes an edit that does not touch it (and PF006 sees no branch change)');
select lives_ok(
  $$ update public.profile_form_questions set condition_question_id = null, condition_values = null where id = '24000000-0000-4000-8000-0f0000000011' $$,
  'T-12.2-08/PF010: and clearing the pair passes');
select throws_ok(
  $$ update public.profile_form_questions set condition_question_id = '24000000-0000-4000-8000-0f0000000001', condition_values = array['r2'] where id = '24000000-0000-4000-8000-0f0000000011' $$,
  'PF010', null, 'T-12.2-08/PF010: and writing a pair back afterwards is refused');

-- ── (7) the lock functions and the grants ──────────────────────────────────────────────────────
select ok(pg_get_function_result('app.profile_form_lock_active_v3()'::regprocedure) like '%branch_id uuid%'
      and pg_get_function_result('app.profile_form_lock_active_v3()'::regprocedure) not like '%condition_question_id%'
      and pg_get_function_result('app.profile_form_lock_active_v3()'::regprocedure) not like '%condition_values%',
  'D-596 lock v3: returns branch_id and NOT the two condition columns');
select ok(pg_get_function_result('app.profile_form_lock_branches()'::regprocedure) not like '%name%'
      and pg_get_function_result('app.profile_form_lock_branches()'::regprocedure) like '%opener_question_id uuid%'
      and pg_get_function_result('app.profile_form_lock_branches()'::regprocedure) like '%open_values text[]%',
  'D-596 lock branches: returns the opener, the opening values, the revision and the archive stamp, and NO name column');
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select results_eq(
  $$ select id::text from app.profile_form_lock_active_v3() $$,
  $$ select id::text from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-010000000001' and archived_at is null order by position, created_at, id $$,
  'D-596 lock v3: a member session reads A''s ACTIVE questions in position, created_at, id order');
select results_eq(
  $$ select branch_id::text from app.profile_form_lock_active_v3() where id = '24000000-0000-4000-8000-000000000007' $$,
  array['24000000-0000-4000-8000-0000000000b4'], 'D-596 lock v3: the row carries branch_id');
select is_empty(
  $$ select 1 from app.profile_form_lock_active_v3() where id in ('24000000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000006') $$,
  'D-596 lock v3: ARCHIVED questions are not returned');
select set_eq(
  $$ select id::text from app.profile_form_lock_branches() $$,
  $$ values ('24000000-0000-4000-8000-0000000000b1'), ('24000000-0000-4000-8000-0000000000b2'), ('24000000-0000-4000-8000-0000000000b3'), ('24000000-0000-4000-8000-0000000000b4') $$,
  'D-596 lock branches: a member of A reads exactly A''s four branches, archived ones included');
select is((select count(*)::int from app.profile_form_lock_branches() where archived_at is not null), 3,
  'D-596 lock branches: the archive stamp is returned (B1, B2, B3 were archived in section 4)');
select is_empty(
  $$ select 1 from app.profile_form_lock_branches() where id = '24000000-0000-4000-8000-0b0000000001' $$,
  'T-12.2-01 cross-tenant: and none of B''s');
reset role;
select tests.as_tenant('24000000-0000-4000-8000-010000000002', '24000000-0000-4000-8000-020000000006', 'member');
select set_eq(
  $$ select id::text from app.profile_form_lock_branches() $$,
  $$ values ('24000000-0000-4000-8000-0b0000000001') $$,
  'T-12.2-01 cross-tenant: a member of B gets exactly B''s one branch and none of A''s (the positive control for the zero above)');
select set_eq(
  $$ select id::text from app.profile_form_lock_active_v3() $$,
  $$ values ('24000000-0000-4000-8000-060000000001'), ('24000000-0000-4000-8000-060000000002'), ('24000000-0000-4000-8000-060000000003') $$,
  'T-12.2-01 cross-tenant: a member of B reads exactly B''s three active questions from the v3 lock');
reset role;
select tests.as_tenant('24000000-0000-4000-8000-010000000004', '24000000-0000-4000-8000-020000000008', 'member');
select is_empty($$ select 1 from app.profile_form_lock_branches() $$, 'T-12.2-01: a member of a tenant with no branch gets none');
reset role;
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000001', 'admin_tenant');
select lives_ok($$ select * from app.profile_form_lock_branches() $$, 'D-596 lock branches: an admin_tenant session can call it');
reset role;
select tests.as_tenant_without_claims();
select is_empty($$ select 1 from app.profile_form_lock_branches() $$, 'T-12.2-01: a session with no claims reads nothing from the branch lock');
select is_empty($$ select 1 from app.profile_form_lock_active_v3() $$, 'T-12.2-01: nor from the v3 lock');
reset role;
select ok(
  has_function_privilege('authenticated', 'app.profile_form_lock_active_v3()', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_lock_active_v3()', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_lock_active_v3()', 'execute')
    and not has_function_privilege('anon', 'app.profile_form_lock_active_v3()', 'execute'),
  'D-596: the v3 lock is executable by authenticated, api_user and service_role, never by anon');
select ok(
  has_function_privilege('authenticated', 'app.profile_form_lock_branches()', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_lock_branches()', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_lock_branches()', 'execute')
    and not has_function_privilege('anon', 'app.profile_form_lock_branches()', 'execute'),
  'D-596: the branch lock is executable by authenticated, api_user and service_role, never by anon');
select ok(
  has_function_privilege('authenticated', 'app.profile_form_purge_closed()', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_purge_closed()', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_purge_closed()', 'execute')
    and not has_function_privilege('anon', 'app.profile_form_purge_closed()', 'execute'),
  'D-596: the purge is executable by authenticated, api_user and service_role, never by anon');
select ok(
  not has_function_privilege('authenticated', 'app.profile_form_missing(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'app.profile_form_missing(uuid,uuid)', 'execute')
    and has_function_privilege('api_user', 'app.profile_form_missing(uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'app.profile_form_missing(uuid,uuid)', 'execute'),
  'D-596: the gate stays callable by api_user and service_role only, never by a session');
select tests.as_tenant('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-020000000003', 'member');
select throws_ok(
  $$ select app.profile_form_missing('24000000-0000-4000-8000-010000000001', '24000000-0000-4000-8000-030000000003') $$,
  '42501', null, 'D-596: a member session cannot probe the two-argument gate (42501)');
reset role;
select ok(
  not (has_function_privilege('authenticated', 'app.profile_form_question_guard()', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_branch_guard()', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_tree_guard()', 'execute')
    or has_function_privilege('authenticated', 'app.profile_form_legacy_condition_guard()', 'execute')
    or has_function_privilege('anon', 'app.profile_form_tree_guard()', 'execute')),
  'D-596: the four guard functions are revoked from public (no session can call them)');
select is(
  (select count(*)::int from pg_proc
    where oid in ('app.profile_form_lock_active_v3()'::regprocedure, 'app.profile_form_lock_branches()'::regprocedure,
                  'app.profile_form_purge_closed()'::regprocedure, 'app.profile_form_missing(uuid,uuid)'::regprocedure,
                  'app.profile_form_question_guard()'::regprocedure, 'app.profile_form_branch_guard()'::regprocedure,
                  'app.profile_form_tree_guard()'::regprocedure, 'app.profile_form_legacy_condition_guard()'::regprocedure)
      and proconfig @> array['search_path=""']),
  8, 'D-596: all eight functions of the branches migration set an empty search_path');

-- ── (8) the cost: a 30-question form with a depth-3 tree and 15 branches (tenant J) ────────────
-- Five chains: top yes/no > L1 branch > yes/no > L2 branch > yes/no > L3 branch > required text. 5 + 5 + 5 + 5 = 20 questions,
-- 15 branches, plus 10 unconditional required questions = 30 questions. Question ids `…0a<lvl><9 digits>`, branches `…0b<lvl>…`.
select tests.tenant('pgtap-pf3-j', 'Pf3 J', '24000000-0000-4000-8000-01000000000a');
select tests.auth_user('member1@pf3-j.local', '24000000-0000-4000-8000-02000000000e');
insert into public.memberships (id, tenant_id, user_id, role, status) values
  ('24000000-0000-4000-8000-03000000000e', '24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-02000000000e', 'member', 'active');
insert into public.tenant_modules (tenant_id, module_key, enabled) values ('24000000-0000-4000-8000-01000000000a', 'profile_form', true);
insert into public.profile_form_steps (id, tenant_id, title, position) values
  ('24000000-0000-4000-8000-050000000010', '24000000-0000-4000-8000-01000000000a', 'Passo J', 1);
insert into public.profile_form_questions (id, tenant_id, step_id, type, title, required, position, created_by_user_id)
select ('24000000-0000-4000-8000-0a0' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-050000000010',
       'yes_no', 'J topo ' || i, false, i, '24000000-0000-4000-8000-020000000001'
  from generate_series(1, 5) i;
insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values)
select ('24000000-0000-4000-8000-0b1' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a',
       ('24000000-0000-4000-8000-0a0' || lpad(i::text, 9, '0'))::uuid, array['true']
  from generate_series(1, 5) i;
insert into public.profile_form_questions (id, tenant_id, step_id, type, title, required, position, branch_id, created_by_user_id)
select ('24000000-0000-4000-8000-0a1' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-050000000010',
       'yes_no', 'J nivel um ' || i, false, 10 + i, ('24000000-0000-4000-8000-0b1' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-020000000001'
  from generate_series(1, 5) i;
insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values)
select ('24000000-0000-4000-8000-0b2' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a',
       ('24000000-0000-4000-8000-0a1' || lpad(i::text, 9, '0'))::uuid, array['true']
  from generate_series(1, 5) i;
insert into public.profile_form_questions (id, tenant_id, step_id, type, title, required, position, branch_id, created_by_user_id)
select ('24000000-0000-4000-8000-0a2' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-050000000010',
       'yes_no', 'J nivel dois ' || i, false, 20 + i, ('24000000-0000-4000-8000-0b2' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-020000000001'
  from generate_series(1, 5) i;
insert into public.profile_form_branches (id, tenant_id, opener_question_id, open_values)
select ('24000000-0000-4000-8000-0b3' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a',
       ('24000000-0000-4000-8000-0a2' || lpad(i::text, 9, '0'))::uuid, array['true']
  from generate_series(1, 5) i;
insert into public.profile_form_questions (id, tenant_id, step_id, type, title, required, position, branch_id, created_by_user_id)
select ('24000000-0000-4000-8000-0a3' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-050000000010',
       'short_text', 'J nivel tres ' || i, true, 30 + i, ('24000000-0000-4000-8000-0b3' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-020000000001'
  from generate_series(1, 5) i;
insert into public.profile_form_questions (id, tenant_id, step_id, type, title, required, position, created_by_user_id)
select ('24000000-0000-4000-8000-0a4' || lpad(i::text, 9, '0'))::uuid, '24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-050000000010',
       'short_text', 'J obrigatoria ' || i, true, 40 + i, '24000000-0000-4000-8000-020000000001'
  from generate_series(1, 10) i;
select is((select count(*)::int from public.profile_form_questions where tenant_id = '24000000-0000-4000-8000-01000000000a'), 30, 'T-12.2-10: the cost form holds 30 questions');
select is((select count(*)::int from public.profile_form_branches where tenant_id = '24000000-0000-4000-8000-01000000000a'), 15, 'T-12.2-10: and 15 branches');
select is(app.profile_form_missing('24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-03000000000e'), 10,
  'T-12.2-10: nothing answered, the 30-question form owes only its ten unconditional required questions');
insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
select '24000000-0000-4000-8000-01000000000a', ('24000000-0000-4000-8000-0a' || lvl || lpad(i::text, 9, '0'))::uuid,
       '24000000-0000-4000-8000-03000000000e', '24000000-0000-4000-8000-02000000000e', 'true'::jsonb
  from generate_series(0, 2) lvl, generate_series(1, 5) i;
select is(app.profile_form_missing('24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-03000000000e'), 15,
  'PFORM-46 boundary: with all fifteen openers answered true the depth-3 form owes 5 level-3 questions and the 10 plain ones, in ONE call');
select is(
  (select array_length(string_to_array(regexp_replace(prosrc, '--[^\n]*', '', 'g'), ';'), 1)
     from pg_proc where oid = 'app.profile_form_missing(uuid,uuid)'::regprocedure),
  1, 'T-12.2-10: the gate is ONE statement (no semicolon in the body once comments are stripped)');
select ok(
  (select prolang = (select oid from pg_language where lanname = 'sql') and prosrc !~* '\m(loop|perform|execute|recursive)\M'
     from pg_proc where oid = 'app.profile_form_missing(uuid,uuid)'::regprocedure),
  'T-12.2-10: a plain SQL function: no loop, no perform, no execute, no recursion');
update public.profile_form_answers set value = 'false'::jsonb
 where membership_id = '24000000-0000-4000-8000-03000000000e' and question_id = '24000000-0000-4000-8000-0a2000000001';
select is(app.profile_form_missing('24000000-0000-4000-8000-01000000000a', '24000000-0000-4000-8000-03000000000e'), 14,
  'PFORM-46 boundary: closing one level-2 opener hides exactly its level-3 question (one step either side of 15)');

select * from finish();
rollback;
