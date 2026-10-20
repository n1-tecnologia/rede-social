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
--    09.1-02 adds `access_grants` to the list (D-487): the readers are SECURITY DEFINER functions and the
--    admin lane, and 204 pins its policy count at ZERO and the revoke from anon and authenticated.
select is_empty(
  $$
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname not in ('tenant_invites', 'access_grants')
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
        ('story_highlights'), ('story_highlight_items'),
        -- Phase 05.2 (05.2-10). `story_views` is BEHAVIOURAL data about members — who saw which
        -- story — carrying `tenant_id` and the standard isolation policy. Listed for the same reason
        -- as its siblings, and it matters for a second one: in 05.2 the API reads only the caller's
        -- own rows, and the policy is what keeps every other path (a worker, a psql session, V2's
        -- "quem viu") inside one tenant.
        ('story_views'),
        -- Phase 7 (07-06). `push_subscriptions` carries `tenant_id` and OWNER-only select/delete
        -- policies ANDed with the tenant claim, so assertions 1-2 already cover it; it is listed for
        -- the same reason as its siblings, and its rows are the most sensitive in the notifications
        -- module: the endpoint and keys of a member's device. NOT exempted anywhere.
        ('push_subscriptions'),
        -- Phase 08.2 (08.2-01). The store's four tables all carry `tenant_id`, so assertions 1-2
        -- already cover them; they are listed for the same reason as their siblings. Two of them
        -- matter more than most: `store_orders` and `store_entitlements` carry a SELECT policy ONLY
        -- (own rows, or every tenant row for `admin_tenant`) and no write policy, because an
        -- entitlement is what opens a locked community (STORE-20) and a lane that could write one
        -- could grant itself access. `store_product_communities`' community foreign key is
        -- hand-written SQL (MOD-02), so nothing in the TS schema would notice it disappear either.
        ('store_products'), ('store_product_communities'), ('store_orders'), ('store_entitlements'),
        -- Phase 08.4 (08.4-01, D-418). The course and live gate: the store owns the links that lock a
        -- course or a live, and their foreign keys to `courses` / `course_lives` are hand-written
        -- SQL (MOD-02), so nothing in the TS schema would notice them disappear either.
        ('store_product_courses'), ('store_product_lives'),
        -- Phase 08.3 (08.3-01). The courses module's nine tables all carry `tenant_id`, so
        -- assertions 1-2 already cover them; they are listed for the same reason as their siblings.
        -- Three of them matter more than most: `course_lessons` carries the RESTRICTIVE
        -- `course_lessons_course_gate` (a member of a locked course reads only its free lessons),
        -- `courses` hides drafts from every claim but `admin_tenant`, and `course_lesson_progress` is
        -- a member's own record with no delete policy (D-408).
        ('course_categories'),
        ('courses'),
        ('course_modules'),
        ('course_lessons'),
        ('course_lesson_materials'),
        ('course_lesson_progress'),
        ('course_tracks'),
        ('course_track_courses'),
        ('course_lives'),
        -- Phase 08.6 (08.6-01, D-444, COURSE-39). `course_live_reminders` carries `tenant_id`, so
        -- assertions 1-2 already cover it; it is listed for the same reason as its siblings, and its
        -- rows are private (PR-4): every policy is own-row with no staff branch, so a member's
        -- opt-ins to paid lives are never a list another member or a support agent can read.
        ('course_live_reminders'),
        -- Phase 08.7 (08.7-01, D-462, D-464). The two dashboard snapshot tables carry `tenant_id`, so
        -- assertions 1-2 already cover them; they are listed for the same reason as their siblings.
        -- Both carry a SELECT policy ONLY (the tenant row admin-only, the member row own-or-admin)
        -- and no write grant for the lane: only the builder definer writes them.
        ('dashboard_snapshots'),
        ('dashboard_member_snapshots'),
        -- Quick 261018-owq: `email_allowlist` is a global table (no tenant_id, zero policies by
        -- design); assertion 3 covers its RLS and 175 pins the zero-policy posture and the grants.
        ('email_allowlist'),
        -- Phase 09 (09-02, D-467, D-468). `social_follows` carries `tenant_id`, so assertions 1-2
        -- already cover it; it is listed for the same reason as its siblings. It matters more than
        -- most: it has NO tenant-wide select policy (a follow is readable by its two parties only,
        -- counts for others come from `app.social_counts`), so a migration that silently stopped
        -- being applied must not let those assertions pass vacuously. 200 pins its three policies.
        ('social_follows'),
        -- Phase 09.1 (09.1-02, D-485, D-487). `access_grants` carries `tenant_id`, so assertions 1-2
        -- already cover it; it is listed for the same reason as its siblings. It matters more than most:
        -- RLS on and ZERO policies (the readers are definer functions and the admin lane), so a migration
        -- that silently stopped being applied must not let those assertions pass vacuously. 204 pins the
        -- shape, the zero-policy posture and the grants.
        ('access_grants')
      ) as t(name)
     where to_regclass('public.' || t.name) is null
  $$,
  'every table Phases 1-09.1 declare exists in public'
);

select * from finish();
rollback;
