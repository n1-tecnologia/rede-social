begin;
-- 080-member-profiles.sql — the DATABASE half of PROF-01/PROF-03 (plan 03-02).
--
-- Three separate claims, each of which the TypeScript side takes for granted:
--
--  (R-08, assertions 1-2) EVERY membership has EXACTLY ONE profile row, created EAGERLY. The API
--  treats a missing row as a broken invariant (`ApiError(500)`) rather than a 404, and 03-03's
--  directory reads `member_profiles` alone — no `coalesce(mp.display_name, u.name)` across two
--  tables, which the trigram expression index could not cover. Assertion 1 is the state today;
--  assertion 2 proves the MECHANISM by inserting a brand-new membership inside this transaction,
--  which is what makes the guarantee survive a future call site nobody has written yet.
--
--  (assertion 3) The policy count is pinned at TWO. `member_profiles` is the first tenant table
--  whose select policy is deliberately TENANT-WIDE rather than self-scoped (PROF-02/PROF-03 read
--  other members), so the count is what keeps a well-meant third policy — an insert or a delete —
--  from quietly appearing and letting a session forge or erase a profile.
--
--  (R-10, assertions 4-6) `app.imm_unaccent` folds accents AND is marked IMMUTABLE. An accidental
--  STABLE would not merely be slower: the expression indexes could not exist at all, and search
--  would silently degrade to a sequential scan. Assertion 7 pins both indexes by name.
--
-- Runs in one transaction that rolls back, so it re-runs identically in any order (TENANT-05).
select plan(7);

-- ── 1-2: one row per membership, guaranteed by the trigger, not by a call site ──────────────────
select is(
  (select count(*)::int from public.memberships m
     left join public.member_profiles p on p.membership_id = m.id
    where p.id is null),
  0,
  'R-08: every membership has a member_profiles row (the migration backfilled the pre-existing ones)'
);

select tests.tenant('pgtap-profiles', 'Comunidade Perfis', '0c000000-0000-4000-8000-000000000001');
select tests.auth_user('perfil@c.local', '0c000000-0000-4000-8000-000000000002');
select tests.member('0c000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-000000000002');

select results_eq(
  $$ select count(*)::int, max(p.display_name)
       from public.member_profiles p
       join public.memberships m on m.id = p.membership_id
      where m.tenant_id = '0c000000-0000-4000-8000-000000000001' $$,
  $$ values (1, 't') $$,
  'R-08: a BRAND-NEW membership gets exactly one profile row, display_name seeded from users.name'
);

-- ── 3: exactly two policies, and no more ────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.member_profiles'::regclass),
  2,
  'member_profiles carries EXACTLY two policies: a tenant-wide select and a self-scoped update'
);

-- ── 4-6: app.imm_unaccent folds accents and is honestly IMMUTABLE ───────────────────────────────
select is(
  app.imm_unaccent(lower('João Gonçalves')),
  'joao goncalves',
  'R-10: accent folding — 03-03 finds João Gonçalves from the query `goncal`'
);

select is(
  app.imm_unaccent(lower('Íris Muñoz')),
  'iris munoz',
  'R-10: case AND accent folding — 03-03 finds Íris Muñoz from the query `MUNOZ`'
);

select matches(
  pg_get_functiondef('app.imm_unaccent(text)'::regprocedure),
  'IMMUTABLE',
  'app.imm_unaccent is IMMUTABLE — a STABLE marking would make the expression indexes impossible'
);

-- ── 7: both search indexes exist by name ────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'member_profiles'
      and indexname in ('member_profiles_name_trgm_idx', 'member_profiles_tenant_name_idx')),
  2,
  'R-10: the GIN trigram index and the keyset order index both exist (03-03 pages on the second)'
);

select * from finish();
rollback;
