begin;
-- 040-schema-conventions.sql — ROLE-01, ROLE-02, D-20 and the V2-safe identity model, asserted
-- against the catalogue rather than against prose in packages/core/docs/SCHEMA-CONVENTIONS.md.
--
-- These are the rules that are cheap to honour today and expensive to retrofit: identity is global
-- (`users` carries no tenant and no role), authority is the membership, `super_admin` is NOT a
-- membership role, and every tenant table is indexed tenant-first.
select plan(38);

-- ── ROLE-01 / ROLE-02: identity is global, authority is the membership ──────────────────────────
select hasnt_column('public', 'users', 'tenant_id',
  'ROLE-01: users carries no tenant_id — identity is global, V2 multi-tenant membership needs no rewrite');
select hasnt_column('public', 'users', 'role',
  'ROLE-01: users carries no role — authority lives on the membership, not on the identity');

select tests.tenant('pgtap-conv-a', 'Convencoes A', '0d000000-0000-4000-8000-000000000001');
select tests.tenant('pgtap-conv-b', 'Convencoes B', '0d000000-0000-4000-8000-000000000011');
select tests.auth_user('member@conv.local', '0d000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ insert into public.memberships (tenant_id, user_id, role, status)
     values ('0d000000-0000-4000-8000-000000000001',
             '0d000000-0000-4000-8000-000000000002', 'super_admin', 'active') $$,
  '23514',
  null,
  'ROLE-02: memberships.role rejects super_admin — the platform role is never a tenant membership'
);

select tests.member('0d000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002');
select has_index('public', 'memberships', 'memberships_one_tenant_per_user_v1',
  'V1 invariant: one membership per user, enforced by a named index that V2 drops deliberately');
select throws_ok(
  $$ insert into public.memberships (tenant_id, user_id, role, status)
     values ('0d000000-0000-4000-8000-000000000011',
             '0d000000-0000-4000-8000-000000000002', 'member', 'active') $$,
  '23505',
  null,
  'a second membership for the same user is refused in V1 (memberships_one_tenant_per_user_v1)'
);

-- ── platform_admins: RLS with ZERO policies is the whole protection ──────────────────────────────
-- `authenticated` holds a schema-wide SELECT grant (20260912031029 `alter default privileges`), so a
-- policy added here by mistake would expose the platform roster to every tenant lane at once. The
-- assertion is the count, not "RLS is on".
select results_eq(
  $$ select count(*)::int from pg_policy where polrelid = 'public.platform_admins'::regclass $$,
  ARRAY[0],
  'platform_admins has ZERO policies: no tenant lane can ever read it (01-03)'
);
select results_eq(
  $$ select relrowsecurity from pg_class where oid = 'public.platform_admins'::regclass $$,
  ARRAY[true],
  'platform_admins still has RLS enabled — without it the schema-wide SELECT grant would apply'
);

-- ── tenant_invites: the same zero-policy protection, on a tenant-owned table (02-03, D-30) ──────
-- 010 exempts exactly this table from "at least one policy"; this pair is what keeps the exemption
-- honest — the count is pinned at zero and RLS must stay on, or the schema-wide SELECT grant applies.
select results_eq(
  $$ select count(*)::int from pg_policy where polrelid = 'public.tenant_invites'::regclass $$,
  ARRAY[0],
  'tenant_invites has ZERO policies: invites are admin-lane only, no tenant lane can read them (D-30)'
);
select results_eq(
  $$ select relrowsecurity from pg_class where oid = 'public.tenant_invites'::regclass $$,
  ARRAY[true],
  'tenant_invites still has RLS enabled — without it the schema-wide SELECT grant would apply'
);
select is(
  (select t.typname::text from pg_attribute a
     join pg_type t on t.oid = a.atttypid
    where a.attrelid = 'public.tenant_invites'::regclass and a.attname = 'email'),
  'citext',
  'tenant_invites.email is citext: a re-invite that differs only in case is the same invite'
);
select has_index('public', 'tenant_invites', 'tenant_invites_tenant_email_key',
  'one invite per (tenant_id, email) — tenant-first, like every other tenant index');

-- ── media_provider_events: the same zero-policy protection, on the webhook inbox (03-06, MEDIA-03) ─
-- The table records every delivery a video provider ever made, keyed by the PROVIDER's own event id
-- (that primary key IS the replay defence). It carries no tenant_id — a provider event id is global
-- and the tenant is resolved from the asset it names — so 010's tenant-table assertions do not
-- reach it and THIS pair is the whole protection: RLS on, zero policies, exactly like
-- `platform_admins` and `tenant_invites`. A tenant lane has no business reading another community's
-- transcode traffic, and with the schema-wide SELECT grant a policy is the only thing that could
-- expose it (T-03-45).
select results_eq(
  $$ select count(*)::int from pg_policy where polrelid = 'public.media_provider_events'::regclass $$,
  ARRAY[0],
  'media_provider_events has ZERO policies: webhook traffic is admin-lane only, no tenant lane can read it'
);
select results_eq(
  $$ select relrowsecurity from pg_class where oid = 'public.media_provider_events'::regclass $$,
  ARRAY[true],
  'media_provider_events still has RLS enabled — without it the schema-wide SELECT grant would apply'
);

-- ── consent_records is append-only evidence: the lane may read, never rewrite ───────────────────
select results_eq(
  $$ select count(*)::int from pg_policy
      where polrelid = 'public.consent_records'::regclass and polcmd in ('w', 'd', '*') $$,
  ARRAY[0],
  'consent_records has no update/delete policy: a consent record cannot be altered from a tenant lane'
);

-- ── memberships is the authorization source of truth: the lane may read, never write ───────────
select results_eq(
  $$ select count(*)::int from pg_policy
      where polrelid = 'public.memberships'::regclass and polcmd in ('a', 'w', 'd', '*') $$,
  ARRAY[0],
  'memberships has no insert/update/delete policy: role and status change only in the admin lane (WR-07)'
);

-- ── every tenant table is indexed tenant-first ───────────────────────────────────────────────────
select is_empty(
  $$
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and exists (
         select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id'
            and a.attnum > 0 and not a.attisdropped
       )
       and not exists (
         select 1
           from pg_index i
           join pg_attribute a
             on a.attrelid = c.oid and a.attnum = i.indkey[0]
          where i.indrelid = c.oid and a.attname = 'tenant_id'
       )
  $$,
  'every public table with tenant_id has an index whose FIRST key column is tenant_id'
);

-- ── per-table shape ─────────────────────────────────────────────────────────────────────────────
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.tenant_modules'::regclass and contype = 'p'),
  'PRIMARY KEY (tenant_id, module_key)',
  'tenant_modules is keyed by (tenant_id, module_key): one flag row per tenant per module'
);
select has_index('public', 'chat_messages', 'chat_messages_conversation_seq_uq',
  'chat_messages has a unique index on (conversation_id, seq) — the V2 ordering contract');
select is(
  (select array_to_string(array_agg(a.attname order by k.ord), ',')
     from pg_index i
     cross join lateral unnest(i.indkey) with ordinality as k(att, ord)
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.att
    where i.indexrelid = 'public.chat_messages_conversation_seq_uq'::regclass),
  'conversation_id,seq',
  '…and its columns are exactly (conversation_id, seq)'
);

-- ── D-20: tenant_domains ────────────────────────────────────────────────────────────────────────
select has_column('public', 'tenant_domains', 'tenant_id',
  'D-20: a host belongs to a tenant, so tenant_domains carries tenant_id like any other tenant table');
select is(
  (select t.typname::text from pg_attribute a
     join pg_type t on t.oid = a.atttypid
    where a.attrelid = 'public.tenant_domains'::regclass and a.attname = 'host'),
  'citext',
  'tenant_domains.host is citext: Host headers are case-insensitive, so uniqueness must be too'
);
select has_index('public', 'tenant_domains', 'tenant_domains_host_key',
  'a host is globally unique — it can only ever point at one tenant');
select has_index('public', 'tenant_domains', 'tenant_domains_one_primary_per_tenant',
  'at most one primary host per tenant');
-- D-34: the verification lifecycle is a status column with a CHECK (SCHEMA-CONVENTIONS (d).1), and
-- verified_at stays the resolution predicate the host resolver reads (D-36).
select col_default_is('public', 'tenant_domains', 'verification_status', 'pending',
  'a freshly attached host starts as pending');
select throws_ok(
  $$ insert into public.tenant_domains (tenant_id, host, verification_status)
     values ('0d000000-0000-4000-8000-000000000001', 'conv-bad.test', 'done') $$,
  '23514',
  null,
  'tenant_domains_verification_status_chk: only pending | verified | expired | failed are storable'
);

insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
values ('0d000000-0000-4000-8000-000000000001', 'conv-a.test', true, now());

select throws_ok(
  $$ insert into public.tenant_domains (tenant_id, host, is_primary)
     values ('0d000000-0000-4000-8000-000000000001', 'conv-a2.test', true) $$,
  '23505',
  null,
  'a second primary host for the same tenant is refused (tenant_domains_one_primary_per_tenant)'
);
select throws_ok(
  $$ insert into public.tenant_domains (tenant_id, host, is_primary)
     values ('0d000000-0000-4000-8000-000000000011', 'conv-a.test', false) $$,
  '23505',
  null,
  'a host already attached to one tenant cannot be attached to another (tenant_domains_host_key)'
);
-- Two independent guards make the host case-proof, and they fail differently on purpose:
-- tenant_domains_host_chk refuses to STORE anything but lowercase, and citext makes the LOOKUP
-- case-insensitive. Proving only one of them would leave `Host: CONV-A.TEST` unaccounted for.
select throws_ok(
  $$ insert into public.tenant_domains (tenant_id, host, is_primary)
     values ('0d000000-0000-4000-8000-000000000011', 'CONV-A.TEST', false) $$,
  '23514',
  null,
  'tenant_domains_host_chk: a host is stored lowercase or not at all'
);
select results_eq(
  $$ select count(*)::int from public.tenant_domains where host = 'CONV-A.TEST' $$,
  ARRAY[1],
  'citext: the stored lowercase host still matches an upper-case Host header verbatim'
);

select results_eq(
  $$ select relrowsecurity from pg_class where oid = 'public.tenant_domains'::regclass $$,
  ARRAY[true],
  'tenant_domains has RLS enabled'
);
select cmp_ok(
  (select count(*)::int from pg_policy where polrelid = 'public.tenant_domains'::regclass),
  '>=', 1,
  'tenant_domains has at least one policy'
);
select results_eq(
  $$ select count(*)::int from pg_policy
      where polrelid = 'public.tenant_domains'::regclass and polcmd in ('a', 'w', 'd', '*') $$,
  ARRAY[0],
  'tenant_domains is read-only from a tenant lane: attaching a host is an admin-lane operation'
);

-- ── ROLE-02: the membership lookup is deterministic, and it is the only one ─────────────────────
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'membership_for_user') like '%order by m.joined_at%',
  'app.membership_for_user orders by joined_at: the V1 single membership is picked deterministically'
);
select is(
  (select string_agg(p.proname::text, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prosrc ilike '%limit 1%'),
  'membership_for_user',
  'app.membership_for_user is the ONLY function in schema app that silently picks one row'
);
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'membership_for_user'),
  true,
  'app.membership_for_user is SECURITY DEFINER: requireAuth resolves a membership before a lane exists'
);

-- ── WR-08: the lookup honours the lifecycle columns, so requireAuth cannot forget them ──────────
-- The membership created above (tenant 0d…01, user 0d…02) is active with neither column set.
select results_eq(
  $$ select status from app.membership_for_user('0d000000-0000-4000-8000-000000000002') $$,
  ARRAY['active'],
  'membership_for_user: an untouched active membership reports status active'
);
update public.memberships set blocked_at = now()
 where user_id = '0d000000-0000-4000-8000-000000000002';
select results_eq(
  $$ select status from app.membership_for_user('0d000000-0000-4000-8000-000000000002') $$,
  ARRAY['blocked'],
  'membership_for_user: blocked_at set (status column untouched) is reported as blocked'
);
update public.memberships set blocked_at = null, deleted_at = now()
 where user_id = '0d000000-0000-4000-8000-000000000002';
select is_empty(
  $$ select * from app.membership_for_user('0d000000-0000-4000-8000-000000000002') $$,
  'membership_for_user: a soft-deleted membership returns no row (requireAuth -> NO_MEMBERSHIP)'
);

select * from finish();
rollback;
