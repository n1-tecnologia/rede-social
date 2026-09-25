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
        ('chat_messages'), ('notifications'),
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
        ('media_provider_events'),
        -- Phase 4 (04-01). `feed_posts` carries `tenant_id` and the standard isolation policy, so
        -- assertions 1-2 already cover it; it is listed here so a migration that silently stopped
        -- being applied cannot let those assertions pass vacuously. It is NOT exempted anywhere.
        ('feed_posts'),
        -- Phase 4 (04-03). `feed_comments` and `feed_likes` both carry `tenant_id` and the standard
        -- isolation policy, so assertions 1-2 already cover them; they are listed here for the same
        -- reason `feed_posts` is — a migration that silently stopped being applied must not let
        -- those assertions pass vacuously. NEITHER is exempted anywhere.
        ('feed_comments'), ('feed_likes'),
        -- Phase 4 (04-04). `feed_post_media` carries `tenant_id` and the standard isolation policy,
        -- so assertions 1-2 already cover it; it is listed here for the same reason its siblings
        -- are — a migration that silently stopped being applied must not let those assertions pass
        -- vacuously. It is NOT exempted anywhere.
        ('feed_post_media'),
        -- Phase 4 (04-05). `feed_link_previews` carries `tenant_id` and the standard isolation
        -- policy, so assertions 1-2 already cover it; it is listed here for the same reason its
        -- siblings are — a migration that silently stopped being applied must not let those
        -- assertions pass vacuously. It is NOT exempted anywhere, and its isolation matters more
        -- than most: the row records what one organisation chose to share (T-04-34).
        ('feed_link_previews'),
        -- Phase 5 (05-01). `communities` and `community_members` both carry `tenant_id` and the
        -- standard isolation policy, so assertions 1-2 already cover them; they are listed here for
        -- the same reason their Phase 4 siblings are — a migration that silently stopped being
        -- applied must not let those assertions pass vacuously. NEITHER is exempted anywhere, and
        -- `community_members` matters most of the two: it is born UNUSED in V1 (COMM-02 answers
        -- "every member sees every community" as a POLICY value, never as a join), and the only
        -- thing that makes V2-CONT-02 a policy change rather than a migration is that its policy
        -- already exists. This entry is what fails the build the day someone drops it as dead
        -- weight.
        ('communities'), ('community_members'),
        -- Phase 5 (05-05). `stories` carries `tenant_id` and the standard isolation policy, so
        -- assertions 1-2 already cover it; it is listed here for the same reason its siblings are.
        -- Its presence is also what makes `feed_comments_story_fk` / `feed_likes_story_fk`
        -- meaningful: those two constraints are HAND-WRITTEN SQL rather than drizzle references
        -- (a `module -> module` package edge is denied by `turbo boundaries`), so nothing in the TS
        -- schema would notice if this table stopped being created.
        ('stories'),
        -- Phase 05.2 (05.2-01). `story_highlights` and `story_highlight_items` both carry
        -- `tenant_id` and the standard isolation policy, so assertions 1-2 already cover them; they
        -- are listed here for the same reason their siblings are — a migration that silently stopped
        -- being applied must not let those assertions pass vacuously. NEITHER is exempted anywhere,
        -- and they matter more than most: a highlight item is the row that lets a story OUTLIVE its
        -- 24 h, so a leak would be permanent rather than a day long. `story_highlights`' community
        -- foreign key is hand-written SQL (MOD-02), so nothing in the TS schema would notice either.
        ('story_highlights'), ('story_highlight_items')
      ) as t(name)
     where to_regclass('public.' || t.name) is null
  $$,
  'every table Phases 1-05.2 declare exists in public'
);

select * from finish();
rollback;
