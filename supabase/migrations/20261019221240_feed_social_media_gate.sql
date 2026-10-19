-- feed_social_media_gate (09-05, SOCIAL-06, D-469, D-483, D-484; RESEARCH Pattern 7; T-09-16)
-- — re-creates the FEED body of the kernel function `app.media_asset_hidden(p_asset) boolean` so that a
-- video carried only by posts the caller cannot see mints no playback token.
--
-- WHY. 08.2 gave the function its first feed body (`*_feed_gate_lookups.sql`): an asset is hidden when
-- a live post carrying it sits in a community locked for the caller and no live post carrying it is
-- visible. Since 09-03 a SECOND reason hides a post: a member's followers-only post (`visibility =
-- 'followers'`) is readable only by its author, the author's live followers, the tenant admin and the
-- system lanes, and only while `social` is on. A video id is a capability (`playbackTokens` asks this
-- function before it signs anything), so the function has to know that rule too, or a stranger who
-- learned the asset id of a follower-only reel could still play it. Same signature, same OID
-- (`create or replace`), so `playbackTokens` and the policies that depend on it keep working.
--
-- THE RULE. TRUE when at least one live post of this tenant carrying the asset is hidden from the
-- caller by EITHER gate AND no live post carrying it is visible to the caller:
--   * hidden by the STORE gate: its community is locked for the caller and it is not that community's
--     sample (unchanged from 08.2);
--   * hidden by the SOCIAL gate: `visibility = 'followers'` and NOT (`app.social_enabled()` AND (the
--     caller is the tenant admin, or the zero user the system lanes run under, or the post's author is
--     in `app.social_visible_author_ids()` - the caller themself and their live followees)).
-- An asset attached to no post yet (the composer's own preview) answers false, as does an asset also
-- carried by one post the caller can see (an organization post, their own, a followee's, a moderator's
-- view). The definer bypasses RLS, so it states the three social conditions itself, mirroring the
-- restrictive policy `feed_posts_social_gate` and the service fragment `memberPostVisible`.
--
-- Hardening (the T-06-29 posture): SECURITY DEFINER, `search_path = ''`, fully qualified names, every
-- statement pinned to `app.tenant_id()`, null-safe on a lane with no claim; EXECUTE revoked from PUBLIC
-- and granted to `authenticated` only. The seam reads are scalar subqueries (InitPlans) wrapped in
-- coalesce, never the bare subquery form of ANY/ALL (RESEARCH Pitfall 1).

create or replace function app.media_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1
             from public.feed_post_media m
             join public.feed_posts p on p.id = m.post_id and p.tenant_id = m.tenant_id
            where m.tenant_id = app.tenant_id()
              and m.media_asset_id = p_asset
              and p.deleted_at is null
              and (
                (p.community_id is not null
                 and p.community_id = any (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
                 and p.id <> all (coalesce((select app.feed_sample_post_ids()), '{}'::uuid[])))
                or
                (p.visibility = 'followers'
                 and not (
                   coalesce((select app.social_enabled()), false)
                   and (coalesce(app.tenant_role(), '') = 'admin_tenant'
                        or coalesce(app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid, false)
                        or p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])))))))
     and not exists (
           select 1
             from public.feed_post_media m
             join public.feed_posts p on p.id = m.post_id and p.tenant_id = m.tenant_id
            where m.tenant_id = app.tenant_id()
              and m.media_asset_id = p_asset
              and p.deleted_at is null
              and not (
                (p.community_id is not null
                 and p.community_id = any (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
                 and p.id <> all (coalesce((select app.feed_sample_post_ids()), '{}'::uuid[])))
                or
                (p.visibility = 'followers'
                 and not (
                   coalesce((select app.social_enabled()), false)
                   and (coalesce(app.tenant_role(), '') = 'admin_tenant'
                        or coalesce(app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid, false)
                        or p.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[])))))))
$$;
--> statement-breakpoint
revoke all on function app.media_asset_hidden(uuid) from public;--> statement-breakpoint
grant execute on function app.media_asset_hidden(uuid) to authenticated;
