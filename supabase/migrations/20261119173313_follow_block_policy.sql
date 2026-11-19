ALTER POLICY "social_follows_insert_member" ON "social_follows" TO authenticated WITH CHECK (tenant_id = app.tenant_id()
        and follower_user_id = app.user_id()
        and app.tenant_role() = 'member'
        and (select app.social_enabled())
        and exists (
          select 1 from public.memberships m
           where m.tenant_id = social_follows.tenant_id
             and m.user_id = social_follows.followee_user_id
             and m.role = 'member' and m.status = 'active'
             and m.blocked_at is null and m.deleted_at is null)
        and not (select app.members_blocked_between(social_follows.followee_user_id)));