ALTER POLICY "stories_audience_gate" ON "stories" TO authenticated USING (visibility = 'tenant'
        or ((select app.social_enabled()) and ((select (app.tenant_role() = 'admin_tenant' or app.user_id() = '00000000-0000-0000-0000-000000000000'::uuid)) or author_user_id = any (coalesce((select app.social_visible_author_ids()), '{}'::uuid[]))))
        or exists (
          select 1
            from public.story_highlight_items i
            join public.story_highlights h on h.id = i.highlight_id and h.tenant_id = i.tenant_id
           where i.story_id = stories.id
             and h.community_id is not null
             and exists (
               select 1 from public.communities c
                where c.id = h.community_id
                  and c.tenant_id = app.tenant_id()
                  and c.deleted_at is null
                  and c.id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[])))));