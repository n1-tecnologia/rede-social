ALTER POLICY "story_highlight_items_member_insert_gate" ON "story_highlight_items" TO authenticated WITH CHECK (app.tenant_role() <> 'member' or (app.tenant_role() = 'member' and (select app.social_enabled()) and (exists (
  select 1 from public.story_highlights h
    join public.communities c on c.id = h.community_id and c.tenant_id = h.tenant_id
   where h.id = story_highlight_items.highlight_id
     and h.tenant_id = app.tenant_id()
     and c.kind = 'member'
     and c.created_by_user_id = app.user_id()) or exists (
  select 1 from public.story_highlights h
    join public.communities c on c.id = h.community_id and c.tenant_id = h.tenant_id
   where h.id = story_highlight_items.highlight_id
     and h.tenant_id = app.tenant_id()
     and h.open_to_buyers
     and c.kind = 'organization'
     and c.status = 'active'
     and c.deleted_at is null
     and app.community_action_allowed(c.id, 'story'))) and exists (
  select 1 from public.stories s
   where s.id = story_highlight_items.story_id
     and s.tenant_id = app.tenant_id()
     and s.author_user_id = app.user_id())));