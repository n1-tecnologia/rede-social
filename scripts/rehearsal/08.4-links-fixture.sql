-- 08.4-links-fixture.sql — the 08.3-era edge fixture `scripts/rehearse-course-links-migration.sh`
-- loads (08.4-02, COURSE-08, SC 4; D-418, D-405).
--
-- It runs on a database reset to `20261014144554_courses_live_gate` — the last 08.3 version — so
-- `public.course_products` / `public.course_live_products` still exist, the four gate bodies read
-- them, and nothing has been copied yet. `supabase/tests/000-helpers.sql` has NOT run on that
-- database, so the `tests.auth_user` / `tests.tenant` / `tests.member` inserts are inlined here in
-- the same shape. Every id is fixed (`84a…` tenant A, `84b…` tenant B, `84c…` tenant C, `84d…`
-- tenant D) so the assertions and the planted mismatch can name the rows; none collides with the
-- seed's families or pgTAP's fixtures.
--
-- The edges it covers, each one a way the carry-over or the gate swap could lose a link or flip an
-- answer:
--   * a course linked to TWO products (C1: P1 and P2)        → both links carried, open via either;
--   * a course whose ONLY product is archived (C2 → P3)      → still locked for every non-holder;
--   * an ARCHIVED course with a link (C3 → P1)               → the link survives (PR-2), still locked;
--   * a course linked to exactly ONE product (C4 → P2)       → the planted-mismatch target;
--   * a course with NO link (C5)                              → open to everyone, before and after;
--   * a SCHEDULED, a RECORDED and a CANCELLED live, each linked (L1 → P1, L2 → P2, L3 → P1);
--   * a member holding P1 (M1), a member holding nothing (M2), a member whose P2 is REVOKED (M3);
--   * staff by membership (S1 `admin_tenant`, S2 `support_tenant`) and staff by claim (every user is
--     also snapshotted under the `admin_tenant` and `support_tenant` claims), and a NULL claim;
--   * tenant B: a structurally identical course and live with its own product and the same titles;
--   * tenant C: `store` row DISABLED, tenant D: NO `courses` row — both with link rows present, so
--     every lane answers `'{}'` (D-405, P02) before and after.
--
-- Afterwards every link is snapshotted into `rehearsal.links_before` and every gate answer into
-- `rehearsal.gate_before`, the ground truth `08.4-links-assert.sql` checks once the 08.3 tables are
-- gone. `rehearsal.gate_rows()` is the ONE computation both files use, so before and after are
-- measured with the same instrument (plpgsql resolves the gate functions at call time, so after
-- `migration up` it reads the re-pointed bodies).

-- ── tenants ────────────────────────────────────────────────────────────────────────────────────
insert into public.tenants (id, slug, display_name, rules_text, rules_version) values
  ('84a00000-0000-4000-8000-000000000001', 'rehearsal-links-a', 'Ensaio A', 'Regras de teste.', 1),
  ('84b00000-0000-4000-8000-000000000001', 'rehearsal-links-b', 'Ensaio B', 'Regras de teste.', 1),
  ('84c00000-0000-4000-8000-000000000001', 'rehearsal-links-c', 'Ensaio C', 'Regras de teste.', 1),
  ('84d00000-0000-4000-8000-000000000001', 'rehearsal-links-d', 'Ensaio D', 'Regras de teste.', 1);

-- `store` and `courses` ON for A and B; C has `store` DISABLED; D has NO `courses` row.
insert into public.tenant_modules (tenant_id, module_key, enabled) values
  ('84a00000-0000-4000-8000-000000000001', 'store', true),
  ('84a00000-0000-4000-8000-000000000001', 'courses', true),
  ('84b00000-0000-4000-8000-000000000001', 'store', true),
  ('84b00000-0000-4000-8000-000000000001', 'courses', true),
  ('84c00000-0000-4000-8000-000000000001', 'store', false),
  ('84c00000-0000-4000-8000-000000000001', 'courses', true),
  ('84d00000-0000-4000-8000-000000000001', 'store', true);

-- ── users (the `auth.users` insert fires the mirror trigger that creates each `public.users` row)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '',
       now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"t"}'::jsonb, now(), now()
  from (values
    ('84a00000-0000-4000-8000-000000000002'::uuid, 'links-a-s1@rehearsal.local'),
    ('84a00000-0000-4000-8000-000000000003'::uuid, 'links-a-s2@rehearsal.local'),
    ('84a00000-0000-4000-8000-000000000004'::uuid, 'links-a-m1@rehearsal.local'),
    ('84a00000-0000-4000-8000-000000000005'::uuid, 'links-a-m2@rehearsal.local'),
    ('84a00000-0000-4000-8000-000000000006'::uuid, 'links-a-m3@rehearsal.local'),
    ('84b00000-0000-4000-8000-000000000002'::uuid, 'links-b-s1@rehearsal.local'),
    ('84b00000-0000-4000-8000-000000000004'::uuid, 'links-b-m1@rehearsal.local'),
    ('84c00000-0000-4000-8000-000000000002'::uuid, 'links-c-s1@rehearsal.local'),
    ('84c00000-0000-4000-8000-000000000004'::uuid, 'links-c-m1@rehearsal.local'),
    ('84d00000-0000-4000-8000-000000000002'::uuid, 'links-d-s1@rehearsal.local'),
    ('84d00000-0000-4000-8000-000000000004'::uuid, 'links-d-m1@rehearsal.local')
  ) as u(id, email);

-- A: S1 admin_tenant, S2 support_tenant, M1..M3 members; B, C, D: one admin, one member each.
insert into public.memberships (tenant_id, user_id, role, status) values
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000003', 'support_tenant', 'active'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000004', 'member', 'active'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000005', 'member', 'active'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000006', 'member', 'active'),
  ('84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000004', 'member', 'active'),
  ('84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-000000000004', 'member', 'active'),
  ('84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000002', 'admin_tenant', 'active'),
  ('84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000004', 'member', 'active');

-- ── products: A has P1, P2 active and P3 ARCHIVED; B, C, D one active product each ──────────────
insert into public.store_products (id, tenant_id, created_by_user_id, name, price_cents, status) values
  ('84a00000-0000-4000-8000-0000000000a1', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Produto 1', 1990, 'active'),
  ('84a00000-0000-4000-8000-0000000000a2', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Produto 2', 2990, 'active'),
  ('84a00000-0000-4000-8000-0000000000a3', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Produto 3', 990, 'archived'),
  ('84b00000-0000-4000-8000-0000000000a1', '84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000002', 'Produto 1', 1990, 'active'),
  ('84c00000-0000-4000-8000-0000000000a1', '84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-000000000002', 'Produto 1', 1990, 'active'),
  ('84d00000-0000-4000-8000-0000000000a1', '84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000002', 'Produto 1', 1990, 'active');

-- ── courses: A's five edges; B, C, D one published course each with A's C1 title ──────────────
insert into public.courses (id, tenant_id, created_by_user_id, title, instructor_name, status, published_at, archived_at) values
  ('84a00000-0000-4000-8000-0000000000c1', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Curso dois produtos', 'Ana', 'published', now() - interval '20 days', null),
  ('84a00000-0000-4000-8000-0000000000c2', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Curso produto arquivado', 'Ana', 'draft', null, null),
  ('84a00000-0000-4000-8000-0000000000c3', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Curso arquivado', 'Ana', 'archived', now() - interval '40 days', now() - interval '5 days'),
  ('84a00000-0000-4000-8000-0000000000c4', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Curso um produto', 'Ana', 'published', now() - interval '10 days', null),
  ('84a00000-0000-4000-8000-0000000000c5', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Curso aberto', 'Ana', 'published', now() - interval '10 days', null),
  ('84b00000-0000-4000-8000-0000000000c1', '84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000002', 'Curso dois produtos', 'Ana', 'published', now() - interval '20 days', null),
  ('84c00000-0000-4000-8000-0000000000c1', '84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-000000000002', 'Curso dois produtos', 'Ana', 'published', now() - interval '20 days', null),
  ('84d00000-0000-4000-8000-0000000000c1', '84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000002', 'Curso dois produtos', 'Ana', 'published', now() - interval '20 days', null);

-- ── lives: A's SCHEDULED (L1), RECORDED (L2, ended three days ago) and CANCELLED (L3); one each
--    for B, C, D with A's L1 title ──────────────────────────────────────────────────────────────
insert into public.course_lives (id, tenant_id, created_by_user_id, title, starts_at, duration_min, external_url, cancelled_at) values
  ('84a00000-0000-4000-8000-000000000b01', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Live agendada', now() + interval '2 days', 60, 'https://example.test/l1', null),
  ('84a00000-0000-4000-8000-000000000b02', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Live gravada', now() - interval '3 days', 60, 'https://example.test/l2', null),
  ('84a00000-0000-4000-8000-000000000b03', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000002', 'Live cancelada', now() + interval '4 days', 60, 'https://example.test/l3', now() - interval '1 day'),
  ('84b00000-0000-4000-8000-000000000b01', '84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000002', 'Live agendada', now() + interval '2 days', 60, 'https://example.test/b1', null),
  ('84c00000-0000-4000-8000-000000000b01', '84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-000000000002', 'Live agendada', now() + interval '2 days', 60, 'https://example.test/c1', null),
  ('84d00000-0000-4000-8000-000000000b01', '84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000002', 'Live agendada', now() + interval '2 days', 60, 'https://example.test/d1', null);

-- ── the 08.3 links, each with its own created_at so the carry-over's date preservation is visible
insert into public.course_products (tenant_id, course_id, product_id, created_at) values
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-0000000000c1', '84a00000-0000-4000-8000-0000000000a1', now() - interval '19 days'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-0000000000c1', '84a00000-0000-4000-8000-0000000000a2', now() - interval '18 days'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-0000000000c2', '84a00000-0000-4000-8000-0000000000a3', now() - interval '17 days'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-0000000000c3', '84a00000-0000-4000-8000-0000000000a1', now() - interval '39 days'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-0000000000c4', '84a00000-0000-4000-8000-0000000000a2', now() - interval '9 days'),
  ('84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-0000000000c1', '84b00000-0000-4000-8000-0000000000a1', now() - interval '19 days'),
  ('84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-0000000000c1', '84c00000-0000-4000-8000-0000000000a1', now() - interval '19 days'),
  ('84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-0000000000c1', '84d00000-0000-4000-8000-0000000000a1', now() - interval '19 days');

insert into public.course_live_products (tenant_id, live_id, product_id, created_at) values
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000b01', '84a00000-0000-4000-8000-0000000000a1', now() - interval '8 days'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000b02', '84a00000-0000-4000-8000-0000000000a2', now() - interval '7 days'),
  ('84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000b03', '84a00000-0000-4000-8000-0000000000a1', now() - interval '6 days'),
  ('84b00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000b01', '84b00000-0000-4000-8000-0000000000a1', now() - interval '8 days'),
  ('84c00000-0000-4000-8000-000000000001', '84c00000-0000-4000-8000-000000000b01', '84c00000-0000-4000-8000-0000000000a1', now() - interval '8 days'),
  ('84d00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000b01', '84d00000-0000-4000-8000-0000000000a1', now() - interval '8 days');

-- ── entitlements: M1 holds P1 (active); M3's P2 is REVOKED; M2 and every other member hold none
insert into public.store_entitlements (id, tenant_id, user_id, product_id, source, granted_by_user_id, status, revoked_at) values
  ('84a00000-0000-4000-8000-0000000000e1', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000004',
   '84a00000-0000-4000-8000-0000000000a1', 'grant', '84a00000-0000-4000-8000-000000000002', 'active', null),
  ('84a00000-0000-4000-8000-0000000000e2', '84a00000-0000-4000-8000-000000000001', '84a00000-0000-4000-8000-000000000006',
   '84a00000-0000-4000-8000-0000000000a2', 'grant', '84a00000-0000-4000-8000-000000000002', 'revoked', now() - interval '1 day');

-- ── the snapshot ───────────────────────────────────────────────────────────────────────────────
create schema rehearsal;

-- Every 08.3 link that exists, the ground truth for the carry-over.
create table rehearsal.links_before as
  select 'course'::text as kind, tenant_id, product_id, course_id as target_id, created_at
    from public.course_products
  union all
  select 'live'::text, tenant_id, product_id, live_id, created_at
    from public.course_live_products;

-- The ONE gate computation, used before (here) and after (the assert file). For every (tenant,
-- user) membership of the fixture and every claim role in {member, admin_tenant, support_tenant,
-- the user's own role, NULL}, set the claims `tests.as_tenant` sets (`sub`, `role`, `tenant_id`,
-- `tenant_role`) and store the four gate answers as SORTED arrays (the answer is a set).
create function rehearsal.gate_rows()
returns table (tenant_id uuid, user_id uuid, claim_role text,
               course_ids uuid[], live_ids uuid[], course_ids_for uuid[], live_ids_for uuid[])
language plpgsql as $$
#variable_conflict use_column
declare
  v record;
begin
  for v in
    select distinct m.tenant_id as t, m.user_id as u, c.r
      from public.memberships m
      cross join lateral unnest(array['member', 'admin_tenant', 'support_tenant', m.role::text, null]) as c(r)
     where m.tenant_id in ('84a00000-0000-4000-8000-000000000001', '84b00000-0000-4000-8000-000000000001',
                           '84c00000-0000-4000-8000-000000000001', '84d00000-0000-4000-8000-000000000001')
     order by 1, 2, 3
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v.u::text, 'role', 'authenticated', 'tenant_id', v.t::text,
                        'tenant_role', v.r)::text,
      true);
    tenant_id := v.t;
    user_id := v.u;
    claim_role := v.r;
    course_ids := array(select unnest(app.course_locked_ids()) order by 1);
    live_ids := array(select unnest(app.live_locked_ids()) order by 1);
    course_ids_for := array(select unnest(app.course_locked_ids_for(v.u)) order by 1);
    live_ids_for := array(select unnest(app.live_locked_ids_for(v.u)) order by 1);
    return next;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end
$$;

create table rehearsal.gate_before as select * from rehearsal.gate_rows();

do $$
declare
  r record;
begin
  raise notice 'rehearsal: links BEFORE (08.3 tables), per (kind, tenant):';
  for r in select kind, tenant_id, count(*) as n from rehearsal.links_before group by 1, 2 order by 1, 2 loop
    raise notice '  %  %  %', r.kind, r.tenant_id, r.n;
  end loop;
  raise notice 'rehearsal: gate answers BEFORE: % rows over % (tenant, user) pairs; % rows lock at least one course or live',
    (select count(*) from rehearsal.gate_before),
    (select count(distinct (tenant_id, user_id)) from rehearsal.gate_before),
    (select count(*) from rehearsal.gate_before
      where cardinality(course_ids) + cardinality(live_ids) + cardinality(course_ids_for) + cardinality(live_ids_for) > 0);
end $$;
