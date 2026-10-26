-- community_soft_delete_gate (09.3-06, PEND-05; D-555, D-556, D-544 [informational]) — the two
-- SECURITY DEFINER functions the feed needs so that a SOFT-DELETED community's publications leave
-- Início, Reels and the post page. Hand-written (`--custom`) and EARLIER than the generated
-- `*_feed_posts_deleted_community_gate.sql`, because that file's CREATE POLICY resolves
-- `app.community_deleted_ids()` when it runs.
--
--   1. `app.community_deleted_ids() uuid[]`: the ids of this tenant's communities whose `deleted_at`
--      is set; '{}' when there are none or when the lane carries no tenant claim. It is a definer
--      because an invoker function reading `public.communities` from a `feed_posts` policy would
--      evaluate `communities_tenant_isolation` inside EVERY feed statement; the definer pins
--      `tenant_id = app.tenant_id()` itself, like every function of the community gate. It returns
--      ids only (no names, no counts) and is read once per statement, as an InitPlan, by the policy
--      (`coalesce((select app.community_deleted_ids()), '{}'::uuid[])`, RESEARCH Pitfall 1). It reads
--      one tenant's communities, never another's, and has no `limit`, so pgTAP 040's convention on
--      row-picking functions does not apply.
--
--   2. `app.feed_locked_post_community(p_post uuid) uuid`: the 08.2 body of
--      `*_feed_gate_lookups.sql`, `create or replace` with the SAME signature and attributes, plus
--      ONE predicate: the post's community must not be deleted. Why: `app.community_locked_ids()`
--      reads `store_product_communities` whatever the product's or the community's status is, so a
--      deleted community that stays linked only to an ARCHIVED product stays in a member's locked
--      set. Without the new `not exists`, the post page would answer `403 community_locked` (and a
--      buy section) for a community that no longer exists, instead of the bare 404.
--
-- Hardening (the T-06-29 posture): `search_path = ''`, fully qualified names; EXECUTE revoked from
-- PUBLIC and granted to `authenticated` only.
--
-- Expand-only (D-544 [informational]): one new function and one function replacement, no table, no
-- column, no row touched. Both reach every tenant project through the ledgered `migrateAll`. Nothing
-- is erased and nothing cascades (D-556): support recovers a community by clearing `deleted_at`.

create or replace function app.community_deleted_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.id), '{}'::uuid[])
    from public.communities c
   where c.tenant_id = app.tenant_id()
     and c.deleted_at is not null
$$;
--> statement-breakpoint
revoke all on function app.community_deleted_ids() from public;--> statement-breakpoint
grant execute on function app.community_deleted_ids() to authenticated;--> statement-breakpoint

create or replace function app.feed_locked_post_community(p_post uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.community_id
    from public.feed_posts p
   where p.id = p_post
     and p.tenant_id = app.tenant_id()
     and p.deleted_at is null
     and p.community_id is not null
     and p.community_id = any (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
     and p.id <> all (coalesce((select app.feed_sample_post_ids()), '{}'::uuid[]))
     and not exists (
           select 1
             from public.communities c
            where c.id = p.community_id
              and c.tenant_id = p.tenant_id
              and c.deleted_at is not null)
$$;
--> statement-breakpoint
revoke all on function app.feed_locked_post_community(uuid) from public;--> statement-breakpoint
grant execute on function app.feed_locked_post_community(uuid) to authenticated;
