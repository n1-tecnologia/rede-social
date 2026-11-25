ALTER POLICY "feed_likes_community_gate" ON "feed_likes" TO authenticated WITH CHECK ((post_id is null or exists (
          select 1 from public.feed_posts p
           where p.id = feed_likes.post_id
             and (p.community_id is null
                  or (p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
                      and p.community_id <> all (coalesce((select app.community_action_denied_ids('like')), '{}'::uuid[]))))))
        and (comment_id is null or exists (
          select 1 from public.feed_comments c
            left join public.feed_posts p on p.id = c.post_id
           where c.id = feed_likes.comment_id
             and (p.community_id is null
                  or (p.community_id <> all (coalesce((select app.community_locked_ids()), '{}'::uuid[]))
                      and p.community_id <> all (coalesce((select app.community_action_denied_ids('like')), '{}'::uuid[])))))));