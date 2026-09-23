begin;
-- 100-module-example-removal.sql — the standing regression guard for D-19 / MOD-03 (plan 04-10).
--
-- 04-10 deleted the throwaway reference module `@tria/module-example`. The source tree no longer
-- mentions it, but the SOURCE TREE is not where a resurrection would hurt: the damage would be a
-- future migration re-creating `example_items` or re-widening `tenant_modules_key_chk`, and until
-- this file existed the whole pgTAP suite would have stayed green through it. The removal was only
-- ever confirmed by an ad-hoc probe during verification, which leaves nothing behind.
--
-- Three things are asserted, and the third exists so the first two cannot pass vacuously:
--   * the module's table is GONE from `public` — and no `example%` relation took its place;
--   * the narrowed key vocabulary REFUSES the retired key (23514 on `tenant_modules_key_chk`,
--     which 04-10 rewrote down to the six surviving modules);
--   * a surviving key ('feed') is still accepted on the same table in the same transaction — so a
--     globally broken insert, a dropped constraint or a missing fixture cannot make the negative
--     look like a pass.
--
-- Like its siblings this file runs in one transaction that rolls back, so it re-runs identically
-- against a seeded or an empty database, twice in a row, in any order (TENANT-05 ordering).
select plan(4);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-modrm', 'Comunidade Remoção', '0e000000-0000-4000-8000-000000000001');

-- ── (1) the module's table is gone ─────────────────────────────────────────────────────────────
select hasnt_table(
  'public', 'example_items',
  'D-19/04-10: public.example_items no longer exists'
);

-- ── (2) and nothing example-shaped replaced it ─────────────────────────────────────────────────
select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and c.relname like 'example%' $$,
  'D-19/04-10: no example% relation survives in public'
);

-- ── (3) the retired key is refused by the narrowed CHECK ───────────────────────────────────────
select throws_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('0e000000-0000-4000-8000-000000000001', 'example', true) $$,
  '23514',
  null,
  'D-19/04-10: tenant_modules_key_chk refuses the retired example module key'
);

-- ── (4) positive control: a surviving key is still accepted ────────────────────────────────────
select lives_ok(
  $$ insert into public.tenant_modules (tenant_id, module_key, enabled)
     values ('0e000000-0000-4000-8000-000000000001', 'feed', true) $$,
  'control: a surviving module key is still accepted, so (3) is not passing vacuously'
);

select * from finish();
rollback;
