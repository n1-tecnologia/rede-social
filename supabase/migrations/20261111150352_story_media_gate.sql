-- story_media_gate (10-04, assumption A5, MSTORY-04, MSTORY-09, MPUB-07; D-705, D-708, D-716; T-10-11) —
-- re-creates `app.media_asset_hidden(p_asset) boolean` so that the VIDEO of a followers-only MEMBER story is not
-- playable by a caller outside the story's audience.
--
-- WHY. Before this migration the function knew only the asset carried by a feed post (09-05, 09-14). A member
-- story (`stories.visibility = 'followers'`, `*_member_stories.sql`) carries its asset on `stories.media_asset_id`,
-- so a tenant member who held the asset id of someone else's followers-only story could mint a playback token for
-- its video. The id only reaches readers of the story (the same exposure class as member photos, which stay the
-- accepted id-capability residual of Phase 9, Igor 2026-10-20), but the video route is the one path where the
-- database can close it with no new endpoint.
--
-- THE RULE. Every existing block is copied VERBATIM from `20261020123217_social_audience_revocation.sql` (the
-- 09-14 body: A, B and the trailing `not exists` C, see its header). ONE block is OR-ed into the hiding group:
--   S = a LIVE story of audience `followers` carries the asset AND the caller is outside the story gate: not
--       (`social` enabled AND (the moderator `admin_tenant`, or the zero user the system lanes run under, or the
--       story's author is in `app.social_visible_author_ids()`: the caller plus the LIVE followees, so a blocked
--       or removed author drops out, D-708)) AND no HIGHLIGHT OF A COMMUNITY THE CALLER CAN READ holds the story
--       (branch 3 of `stories_audience_gate`, D-716: whoever reads the community reads the story, with `social`
--       on or off, so its video is playable too). The branch is written inline in the per-row `exists` form the
--       A10 spike chose (`10-04-SPIKE.md`, `CHOSEN_FORM: EXISTS_JOIN`). This function is a SECURITY DEFINER and
--       runs without the caller's RLS, so the community half of branch 3 cannot lean on
--       `communities_member_hidden_gate`: it pins the tenant, `c.deleted_at is null` and
--       `c.id <> all (app.member_community_hidden_ids())` explicitly, which is the same answer.
--   S' = (beyond the plan's literal text, the 09-14 lesson applied to stories) a SOFT-DELETED followers story
--       carries the asset AND the caller is not inside the staff exemption (`admin_tenant` or the zero user, only
--       while `social` is on). Without it, a moderator's takedown (`story_removed`, plan 07) or an author's own
--       delete would reopen the video to every tenant member who knows the id: the takedown the rule exists for.
--       Same shape and same reason as block B above for posts; an ORGANIZATION story (`'tenant'`) never hid
--       anything and still does not.
-- As before, a video also carried by a live post the caller can see (C) is not hidden, and an asset on no story and
-- no post still answers false. The function HIDES, it never deletes: no media row, Storage object or provider
-- asset is touched.
--
-- Hardening (the T-06-29 posture, unchanged): SECURITY DEFINER, `search_path = ''`, fully qualified names, every
-- statement pinned to `app.tenant_id()`, null-safe on a lane with no claim; EXECUTE revoked from PUBLIC and
-- granted to `authenticated` only. Same signature and OID as the 09-14 body (`create or replace`), so
-- `playbackTokens` keeps working; no applied migration is edited.
--
-- ONE-TASK REVERT (assumption A5 for Igor to confirm): re-apply the body of
-- `20261020123217_social_audience_revocation.sql` with `create or replace`; nothing else depends on the new blocks.
-- Expand-only: a function body, no table, column, constraint, index or row changes. It sorts AFTER
-- `*_member_stories.sql`, whose `visibility` column the `language sql` body is bound to at creation.

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
           or
           exists (
             select 1
               from public.stories s
              where s.tenant_id = app.tenant_id()
                and s.media_asset_id = p_asset
                and s.deleted_at is null
                and s.visibility = 'followers'
                and not (
                  coalesce((select app.social_enabled()), false)
                  and (coalesce(app.tenant_role(), '') = 'admin_tenant'
                       or coalesce(app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid, false)
                       or s.author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))))
                and not exists (
                  select 1
                    from public.story_highlight_items i
                    join public.story_highlights h on h.id = i.highlight_id and h.tenant_id = i.tenant_id
                    join public.communities c on c.id = h.community_id and c.tenant_id = h.tenant_id
                   where i.tenant_id = app.tenant_id()
                     and i.story_id = s.id
                     and h.community_id is not null
                     and c.deleted_at is null
                     and c.id <> all (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[]))))
           or
           exists (
             select 1
               from public.stories s
              where s.tenant_id = app.tenant_id()
                and s.media_asset_id = p_asset
                and s.deleted_at is not null
                and s.visibility = 'followers'
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
