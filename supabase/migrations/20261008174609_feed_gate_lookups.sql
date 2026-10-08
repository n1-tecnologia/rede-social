-- feed_gate_lookups (08.2-03, STORE-13, STORE-15, STORE-17; D-354, D-356; RESEARCH Patterns 6 and 7)
-- — the feed's two definer lookups over content the caller's lane CANNOT see.
--
-- Both read rows that RLS hides from the caller on purpose (a post of a community locked for them),
-- so both are SECURITY DEFINER: they run as their owner, which bypasses RLS, and therefore EVERY
-- statement pins `tenant_id = app.tenant_id()` itself (T-08.2-22). A lane with no tenant claim gets
-- null / false, and an id of another tenant matches no row. Each answers ONE fact, never content.
--
--   1. `app.feed_locked_post_community(p_post) uuid` (STORE-17, Pattern 6): the community id of the
--      post when it is live (`deleted_at is null`), in the caller's tenant, in a community locked for
--      the caller (`app.community_locked_ids()`, the kernel seam) and NOT that community's sample
--      (`app.feed_sample_post_ids()`); otherwise null. `getPost` calls it ONLY on an RLS miss: a
--      non-null answer becomes 403 `FORBIDDEN { access: 'community_locked', communityId }` (the shared
--      link routes the member to the buy section), null stays the bare 404 (D-23). Accepted
--      disclosure: "this unguessable uuid is a post of community X", same tenant only (T-08.2-09).
--
--   2. `app.media_asset_hidden(p_asset) boolean` (Pattern 7): the FEED body of the kernel stub
--      declared by `*_community_gate_seam.sql` (`create or replace`, same signature, same OID). True
--      only when a `feed_post_media` row of this tenant attaches the asset to a live post hidden from
--      the caller (its community is locked for the lane and it is not the sample) AND no
--      `feed_post_media` row attaches it to a live post the caller can see (no community, an open
--      community, or a sample). So a sample's media answer false, and an asset shared by a hidden and
--      a visible post answers false. While the store is off, or for staff, the lane's locked set is
--      '{}' and every asset answers false. Served by `feed_post_media_tenant_asset_idx` (plan 03's
--      generated `*_feed_community_gate_policies.sql`); plan 04 calls it from `playbackTokens`.
--
-- Both read the gate as `coalesce((select app.f()), '{}'::uuid[])` (RESEARCH Pitfall 1: the bare
-- `<> all ((select f()))` is the subquery form of ALL and does not parse as an array comparison).
--
-- Hardening (the T-06-29 posture): `search_path = ''`, fully qualified names; EXECUTE revoked from
-- PUBLIC and granted to `authenticated` only.

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
$$;
--> statement-breakpoint
revoke all on function app.feed_locked_post_community(uuid) from public;--> statement-breakpoint
grant execute on function app.feed_locked_post_community(uuid) to authenticated;--> statement-breakpoint

create or replace function app.media_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1
             from public.feed_post_media m
             join public.feed_posts p on p.id = m.post_id and p.tenant_id = m.tenant_id
            where m.tenant_id = app.tenant_id()
              and m.media_asset_id = p_asset
              and p.deleted_at is null
              and p.community_id is not null
              and p.community_id = any (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
              and p.id <> all (coalesce((select app.feed_sample_post_ids()), '{}'::uuid[])))
     and not exists (
           select 1
             from public.feed_post_media m
             join public.feed_posts p on p.id = m.post_id and p.tenant_id = m.tenant_id
            where m.tenant_id = app.tenant_id()
              and m.media_asset_id = p_asset
              and p.deleted_at is null
              and (p.community_id is null
                   or p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
                   or p.id = any (coalesce((select app.feed_sample_post_ids()), '{}'::uuid[]))))
$$;
--> statement-breakpoint
revoke all on function app.media_asset_hidden(uuid) from public;--> statement-breakpoint
grant execute on function app.media_asset_hidden(uuid) to authenticated;
