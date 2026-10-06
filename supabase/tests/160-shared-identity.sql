begin;
-- 160-shared-identity.sql — ROADMAP 08.1 SC 5 / V2-PLAT-07 / T-08.1-37, proved inside Postgres (08.1-07):
-- ONE identity S that belongs to two tenants, `member` of A ('S em A') and `admin_tenant` of B
-- ('S em B'). Every lane below is `tests.as_tenant(<tenant>, S)`: the claims the API builds for the
-- host-selected membership (D-307). The question is the one 020 asks with two people, asked of the
-- hardest case — one person in both: does A's lane of S ever show a row of B?
--
-- 1. Rows and names. In S's A lane `memberships` shows only S's A membership, `member_profiles` only
--    'S em A', and the feed author join (the RLS-scoped join of `packages/modules/feed/server/
--    service.ts`, RESEARCH inventory row 24) renders 'S em A' for the post S wrote in A and never
--    S's B post; the reverse in S's B lane.
--
-- Fixture ids use the `16000000-…` prefix and the tenants `pgtap-si-a`, `pgtap-si-b` and
-- `pgtap-si-c`, used by no other file. Like its siblings, this file ROLLS BACK, so an interrupted run
-- leaves no identity, membership or tenant behind (SC5 concurrency).
select plan(8);

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
select tests.tenant('pgtap-si-a', 'Shared A', '16000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-si-b', 'Shared B', '16000000-0000-4000-8000-000000000011');
select tests.tenant('pgtap-si-c', 'Shared C', '16000000-0000-4000-8000-000000000021');
-- S, the shared identity; a1, a second member of A; b1, a second member of B.
select tests.auth_user('s@si.local', '16000000-0000-4000-8000-0000000000a0');
select tests.auth_user('a1@si-a.local', '16000000-0000-4000-8000-0000000000a1');
select tests.auth_user('b1@si-b.local', '16000000-0000-4000-8000-0000000000b1');
select tests.member('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select tests.member('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'admin_tenant');
select tests.member('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a1');
select tests.member('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000b1');
-- One name per membership (D-310): the trigger created both profile rows; each is renamed here.
update public.member_profiles set display_name = 'S em A'
 where tenant_id = '16000000-0000-4000-8000-000000000001'
   and user_id = '16000000-0000-4000-8000-0000000000a0';
update public.member_profiles set display_name = 'S em B'
 where tenant_id = '16000000-0000-4000-8000-000000000011'
   and user_id = '16000000-0000-4000-8000-0000000000a0';
-- One post by S in each tenant (the 090 fixture shape, written as the migration role).
insert into public.feed_posts (id, tenant_id, caption, author_user_id) values
  ('16000000-0000-4000-8000-0000000000d1', '16000000-0000-4000-8000-000000000001', 'Aviso.',
   '16000000-0000-4000-8000-0000000000a0'),
  ('16000000-0000-4000-8000-0000000000d2', '16000000-0000-4000-8000-000000000011', 'Aviso.',
   '16000000-0000-4000-8000-0000000000a0');

-- ── 1. rows and names, in S's A lane ───────────────────────────────────────────────────────────
select tests.as_tenant('16000000-0000-4000-8000-000000000001', '16000000-0000-4000-8000-0000000000a0', 'member');
select results_eq(
  $$ select tenant_id::text from public.memberships
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000001'],
  'fact 1: in S''s A lane, S has exactly ONE visible membership, the A one'
);
select is(
  (select count(*)::int from public.memberships
    where tenant_id <> '16000000-0000-4000-8000-000000000001'),
  0,
  'fact 1: …and not one membership row of another tenant is visible (B''s second member included)'
);
select results_eq(
  $$ select display_name from public.member_profiles
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['S em A'],
  'fact 1: in S''s A lane, S''s profile is ''S em A'' only, never ''S em B'''
);
select results_eq(
  $$ select p.id::text || ':' || mp.display_name
       from public.feed_posts p
       join public.memberships ms on ms.user_id = p.author_user_id
       join public.member_profiles mp on mp.membership_id = ms.id
      where p.author_user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-0000000000d1:S em A'],
  'fact 1 (inventory row 24): the feed author join renders S''s A post as ''S em A'', and S''s B post never appears'
);
reset role;

-- ── 1. the reverse, in S's B lane ──────────────────────────────────────────────────────────────
select tests.as_tenant('16000000-0000-4000-8000-000000000011', '16000000-0000-4000-8000-0000000000a0', 'admin_tenant');
select results_eq(
  $$ select tenant_id::text from public.memberships
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-000000000011'],
  'fact 1 reverse: in S''s B lane, S has exactly ONE visible membership, the B one'
);
select is(
  (select count(*)::int from public.memberships
    where tenant_id <> '16000000-0000-4000-8000-000000000011'),
  0,
  'fact 1 reverse: …and not one membership row of another tenant is visible (A''s second member included)'
);
select results_eq(
  $$ select display_name from public.member_profiles
      where user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['S em B'],
  'fact 1 reverse: in S''s B lane, S''s profile is ''S em B'' only, never ''S em A'''
);
select results_eq(
  $$ select p.id::text || ':' || mp.display_name
       from public.feed_posts p
       join public.memberships ms on ms.user_id = p.author_user_id
       join public.member_profiles mp on mp.membership_id = ms.id
      where p.author_user_id = '16000000-0000-4000-8000-0000000000a0' $$,
  ARRAY['16000000-0000-4000-8000-0000000000d2:S em B'],
  'fact 1 reverse: the feed author join renders S''s B post as ''S em B'', and S''s A post never appears'
);
reset role;

select * from finish();
rollback;
