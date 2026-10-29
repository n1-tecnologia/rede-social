begin;
-- 220-profile-form.sql — Phase 12 (PFORM-01, PFORM-25; D-589, D-596; T-12-04): the profile form module,
-- executed inside Postgres. Plan 12-04 extends this file with the tables, the gate and the answers.
--
-- 1. THE MODULE KEY (plan 12-02, D-596). `tenant_modules_key_chk` is GENERATED from `TOGGLEABLE_MODULES` and the
--    migration `profile_form_module_key` widens it to end in 'profile_form': the key is accepted, an unknown
--    key is refused (23514), the definition lists the keys in the array's order with `payments` immediately
--    before `profile_form`, and nothing switched the key on (no enabled row, no backfill row).
-- 2. (plan 12-04) the tables, the CHECKs and the exposure.
-- 3. (plan 12-04) the gate fact and the cross-tenant negatives.
-- 4. (plan 12-04) the answers, the export and the expand-only proof.
--
-- Fixture ids use the `22000000-…` prefix, used by no other file. Like its siblings, this file ROLLS BACK.
select plan(7);

-- ── fixture (as the migration role) ────────────────────────────────────────────────────────────
select tests.tenant('pgtap-pform-a', 'Pform A', '22000000-0000-4000-8000-000000000001');

-- ── (1) the module key ─────────────────────────────────────────────────────────────────────────
-- PFORM-01 empty: nothing in the migration or the seed switched the key on.
select is(
  (select count(*) from public.tenant_modules where module_key = 'profile_form' and enabled),
  0::bigint,
  'PFORM-01/D-596: no tenant has profile_form enabled before the test inserts one (off by default, no backfill)'
);

select lives_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('22000000-0000-4000-8000-000000000001', 'profile_form', false) $$,
  'PFORM-01: the widened tenant_modules_key_chk accepts the profile_form key'
);

select throws_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('22000000-0000-4000-8000-000000000001', 'nao_existe', false) $$,
  '23514',
  null,
  'PFORM-01: a key outside the vocabulary is still refused (23514)'
);

select is(
  (select enabled from public.tenant_modules
    where tenant_id = '22000000-0000-4000-8000-000000000001' and module_key = 'profile_form'),
  false,
  'PFORM-01: the row the test inserted reads as disabled, the same as a missing row'
);

-- PFORM-01 ordering: the CHECK lists the keys in the array's order, profile_form last, payments right before it.
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'tenant_modules_key_chk' and conrelid = 'public.tenant_modules'::regclass),
  'payments.{1,40}profile_form',
  'PFORM-01: payments sits immediately before profile_form in the CHECK definition'
);

select is(
  (select array_agg(k order by ord) from (
     select m[1] as k, ord
       from pg_constraint c,
            regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') with ordinality as t(m, ord)
      where c.conname = 'tenant_modules_key_chk' and c.conrelid = 'public.tenant_modules'::regclass
   ) q),
  array['feed','communities','stories','events','chat','notifications','reels','store','courses','social','payments','profile_form']::text[],
  'PFORM-01: the CHECK lists the twelve keys in TOGGLEABLE_MODULES order, profile_form last'
);

select is(
  (select count(*) from public.tenant_modules where module_key = 'profile_form' and enabled),
  0::bigint,
  'PFORM-01/T-12-04: still no enabled profile_form row after the control insert'
);

select * from finish();
rollback;
