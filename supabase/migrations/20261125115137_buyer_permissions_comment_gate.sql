CREATE POLICY "feed_comments_community_insert_gate" ON "feed_comments" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (post_id is null or exists (
        select 1 from public.feed_posts p
         where p.id = feed_comments.post_id
           and (p.community_id is null or p.community_id <> all (coalesce((select app.community_action_denied_ids('comment')), '{}'::uuid[])))));