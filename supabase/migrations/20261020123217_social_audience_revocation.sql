-- social_audience_revocation (09-14, gap G2 of 09-VERIFICATION = WR-01; SOCIAL-06, SOCIAL-07, EXPL-06;
-- D-475, D-483, D-484; T-09-48) — re-creates `app.media_asset_hidden(p_asset) boolean` so that the video
-- of a followers-only post STAYS closed once the post is soft-deleted.
--
-- WHY. 09-05 made the function hide an asset carried only by LIVE posts the caller is shut out of. Its
-- two `exists` blocks both say `p.deleted_at is null`, so the moment the only carrying post was
-- soft-deleted (the moderator's takedown of D-475 or the author's own delete) no live post carried the
-- asset, nothing was hidden, and the video became playable by anyone who knew its id, including the
-- strangers the post had always excluded. A takedown that reopens the video to the world is the opposite
-- of what a takedown is for. The unfollow case on a LIVE post was already right; this closes the deleted
-- post case.
--
-- THE RULE (A or B) and not C, where:
--   A = a LIVE post carrying the asset that the caller is shut out of by the store gate or the social
--       gate (the 09-05 branch, verbatim);
--   B = a SOFT-DELETED post of audience `followers` carries the asset AND the caller is not inside the
--       staff exemption (`admin_tenant`, or the zero user the system lanes run under). The exemption
--       holds only while `social` is enabled, exactly as in the live-post branch (D-483: off hides
--       everything, the admin included), so an admin never reaches a member video through a deleted
--       post that a live post would have refused;
--   C = a LIVE post carrying the asset that the caller can see (the 09-05 `not exists`, verbatim).
-- So a video also carried by a live organization post, or by a live followers post of someone the caller
-- follows, is not hidden (the live visible carrier wins). The branch is limited to `visibility =
-- 'followers'`: a soft-deleted ORGANIZATION post (`tenant`) never hid anything and still does not, and an
-- asset on no post at all (the composer's own preview) still answers false.
--
-- The audience revocation HIDES, it never deletes: no media row, Storage object or provider asset is
-- touched, so a restore of the post, or the admin's moderation view, still has the video (D-475, D-483).
--
-- Hardening (the T-06-29 posture, unchanged): SECURITY DEFINER, `search_path = ''`, fully qualified
-- names, every statement pinned to `app.tenant_id()`, null-safe on a lane with no claim; EXECUTE revoked
-- from PUBLIC and granted to `authenticated` only. The seam reads are scalar subqueries (InitPlans)
-- wrapped in coalesce, never the bare subquery form of ANY/ALL (RESEARCH Pitfall 1). Same signature and
-- OID as the 09-05 body (`create or replace`), so `playbackTokens` keeps working; the applied 09-05
-- migration is not edited. Expand-only: no table, column, constraint or index changes.

create or replace function app.media_asset_hidden(p_asset uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (
           exists (
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
           or
           exists (
             select 1
               from public.feed_post_media m
               join public.feed_posts p on p.id = m.post_id and p.tenant_id = m.tenant_id
              where m.tenant_id = app.tenant_id()
                and m.media_asset_id = p_asset
                and p.deleted_at is not null
                and p.visibility = 'followers'
                and not (
                  coalesce((select app.social_enabled()), false)
                  and (coalesce(app.tenant_role(), '') = 'admin_tenant'
                       or coalesce(app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid, false))))
         )
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
