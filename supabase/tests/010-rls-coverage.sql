begin;
-- 010-rls-coverage.sql — T-08-01: the first tenant table that ships without RLS fails this file.
--
-- These are catalogue assertions, not data assertions: they hold for tables that do not exist yet,
-- which is the point — a table added in phase 4 is covered the day it is created.
select plan(4);

-- 1. Every tenant-owned table (anything carrying tenant_id) has row level security enabled.
select is_empty(
  $$
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
       and exists (
         select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id'
            and a.attnum > 0 and not a.attisdropped
       )
  $$,
  'TENANT-03: every public table with a tenant_id column has RLS enabled'
);

-- 2. …and at least one policy. RLS without a policy denies everything, which would be a silent
--    outage rather than a leak, so it is a separate assertion from 1.
--    The ONLY exception is the admin-lane-only list below: tables a tenant lane must never read
--    (`tenant_invites`, 02-03 / D-30 — same protection as `platform_admins`, which carries no
--    tenant_id and is therefore outside this assertion). 040 pins their policy count at ZERO, so a
--    table cannot hide here by accident: it is either isolated by a policy or pinned as invisible.
select is_empty(
  $$
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname not in ('tenant_invites')
       and exists (
         select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id'
            and a.attnum > 0 and not a.attisdropped
       )
       and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  $$,
  'TENANT-03: every public table with a tenant_id column has at least one policy (or is pinned admin-lane-only in 040)'
);

-- 3. Tables without tenant_id are covered too (users, platform_admins, tenants): `authenticated`
--    holds a schema-wide SELECT grant from 20260912031029, so RLS is the only thing standing
--    between a tenant lane and a global table.
select is_empty(
  $$
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
  $$,
  'no table in schema public is left without RLS, tenant_id column or not'
);

-- 4. The tables this phase actually shipped are all present — a guard against assertions 1-3
--    passing vacuously if a migration silently stopped being applied.
select is_empty(
  $$
    select t.name
      from (values
        ('tenants'), ('users'), ('memberships'), ('tenant_domains'), ('platform_admins'),
        ('tenant_modules'), ('consent_records'), ('chat_conversations'), ('chat_participants'),
        ('chat_messages'), ('notifications'), ('example_items'),
        -- Phase 2 (02-03)
        ('tenant_invites'),
        -- Phase 3 (03-01). `media_assets` needs NO entry in assertion 2's exemption list: it
        -- carries its own tenant select policy, so it is isolated rather than pinned invisible.
        ('media_assets'),
        -- Phase 3 (03-02). `member_profiles` needs no exemption either — it carries TWO policies
        -- (a tenant-wide select and a self-scoped update); 080 pins that count.
        ('member_profiles'),
        -- Phase 3 (03-06). `media_provider_events` carries NO tenant_id (a provider's event id is
        -- global; the tenant comes from the asset it names), so assertions 1-2 never reach it and
        -- it needs no exemption there. Assertion 3 covers its RLS, and 040 pins its policy count at
        -- ZERO — the `tenant_invites` / `platform_admins` posture.
        ('media_provider_events')
      ) as t(name)
     where to_regclass('public.' || t.name) is null
  $$,
  'every table Phases 1-3 declare exists in public'
);

select * from finish();
rollback;
