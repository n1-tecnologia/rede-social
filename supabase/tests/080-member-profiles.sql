begin;
-- 080-member-profiles.sql — the DATABASE half of PROF-01/PROF-03 (plan 03-02).
--
-- Three separate claims, each of which the TypeScript side takes for granted:
--
--  (R-08, assertions 1-2) EVERY membership has EXACTLY ONE profile row, created EAGERLY. The API
--  treats a missing row as a broken invariant (`ApiError(500)`) rather than a 404, and 03-03's
--  directory reads `member_profiles` alone — no coalesce of the profile name with the identity's
--  name across two tables, which the trigram expression index could not cover. Assertion 1 is the state today;
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
--  (D-310/D-313, assertions 8-14, 08.1-04) A person in two communities has one profile PER
--  membership, and leaving one community never touches the identity or the other membership:
--  renaming one profile leaves the other alone, a soft delete changes no other row, a hard delete
--  removes exactly its own profile, and no foreign key or trigger runs from `memberships` towards
--  `users` or another membership.
--
-- Runs in one transaction that rolls back, so it re-runs identically in any order (TENANT-05).
select plan(14);

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

-- D-313: leaving one community never touches the identity or another membership
-- ── 8-14: one identity, two communities (fixture ids under the 0c130000 prefix) ─────────────────
-- A = 0c130000-…-001, B = 0c130000-…-002, the identity = 0c130000-…-003.
select tests.tenant('pgtap-d313-a', 'Comunidade A', '0c130000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-d313-b', 'Comunidade B', '0c130000-0000-4000-8000-000000000002');
select tests.auth_user('d313@c.local', '0c130000-0000-4000-8000-000000000003');
select tests.member('0c130000-0000-4000-8000-000000000001', '0c130000-0000-4000-8000-000000000003');
select tests.member('0c130000-0000-4000-8000-000000000002', '0c130000-0000-4000-8000-000000000003');
update public.member_profiles set display_name = 'Nome em A'
 where tenant_id = '0c130000-0000-4000-8000-000000000001'
   and user_id = '0c130000-0000-4000-8000-000000000003';
update public.member_profiles set display_name = 'Nome em B'
 where tenant_id = '0c130000-0000-4000-8000-000000000002'
   and user_id = '0c130000-0000-4000-8000-000000000003';

-- 8: a rename in A is a write to A's row only (D-310).
update public.member_profiles set display_name = 'Outro'
 where tenant_id = '0c130000-0000-4000-8000-000000000001'
   and user_id = '0c130000-0000-4000-8000-000000000003';
select results_eq(
  $$ select p.tenant_id::text, p.display_name
       from public.member_profiles p
      where p.user_id = '0c130000-0000-4000-8000-000000000003'
      order by p.tenant_id $$,
  $$ values ('0c130000-0000-4000-8000-000000000001', 'Outro'),
            ('0c130000-0000-4000-8000-000000000002', 'Nome em B') $$,
  'D-310: renaming the profile in A leaves the profile in B unchanged'
);

-- 9-10: soft-deleting A's membership changes no other row.
update public.memberships set deleted_at = now()
 where tenant_id = '0c130000-0000-4000-8000-000000000001'
   and user_id = '0c130000-0000-4000-8000-000000000003';
select results_eq(
  $$ select m.tenant_id::text, m.deleted_at is null, m.status, p.display_name
       from public.memberships m
       join public.member_profiles p on p.membership_id = m.id
      where m.user_id = '0c130000-0000-4000-8000-000000000003'
      order by m.tenant_id $$,
  $$ values ('0c130000-0000-4000-8000-000000000001', false, 'active', 'Outro'),
            ('0c130000-0000-4000-8000-000000000002', true, 'active', 'Nome em B') $$,
  'D-313: a soft delete marks only its own membership; the other membership and both profiles are unchanged'
);
select results_eq(
  $$ select (select count(*)::int from public.users
              where id = '0c130000-0000-4000-8000-000000000003'
                and email = 'd313@c.local' and name = 't'),
            (select count(*)::int from auth.users
              where id = '0c130000-0000-4000-8000-000000000003'
                and email = 'd313@c.local' and deleted_at is null) $$,
  $$ values (1, 1) $$,
  'D-313: a soft delete leaves the public.users and auth.users rows untouched'
);

-- 11-12: hard-deleting A's membership removes exactly its own profile.
delete from public.memberships
 where tenant_id = '0c130000-0000-4000-8000-000000000001'
   and user_id = '0c130000-0000-4000-8000-000000000003';
select results_eq(
  $$ select (select count(*)::int from public.member_profiles
              where user_id = '0c130000-0000-4000-8000-000000000003'
                and tenant_id = '0c130000-0000-4000-8000-000000000001'),
            (select count(*)::int from public.memberships
              where user_id = '0c130000-0000-4000-8000-000000000003') $$,
  $$ values (0, 1) $$,
  'D-313: a hard delete removes exactly its own profile, and only its own membership'
);
select results_eq(
  $$ select (select count(*)::int from public.memberships m
               join public.member_profiles p on p.membership_id = m.id
              where m.user_id = '0c130000-0000-4000-8000-000000000003'
                and m.tenant_id = '0c130000-0000-4000-8000-000000000002'
                and m.deleted_at is null and p.display_name = 'Nome em B'),
            (select count(*)::int from public.users
              where id = '0c130000-0000-4000-8000-000000000003' and email = 'd313@c.local'),
            (select count(*)::int from auth.users
              where id = '0c130000-0000-4000-8000-000000000003' and email = 'd313@c.local') $$,
  $$ values (1, 1, 1) $$,
  'D-313: after a hard delete, the other membership with its profile, public.users and auth.users all remain'
);

-- 13-14: the model, not just this run — nothing points from a membership back to the identity.
select is(
  (select count(*)::int from pg_constraint
    where contype = 'f'
      and conrelid = 'public.users'::regclass
      and confrelid = 'public.memberships'::regclass),
  0,
  'D-313: no foreign key from the identity (public.users) to a membership'
);
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.memberships'::regclass
      and not tgisinternal
      and (tgtype & (8 | 16)) <> 0),
  0,
  'D-313: no trigger runs on a membership update or delete (nothing cascades to users or another membership)'
);

select * from finish();
rollback;
