-- feed_comments_orphan_replies (08-01, D-334, RESEARCH Runtime State / Open Question 2) — a ONE-OFF
-- DATA repair, not a schema change.
--
-- Before Phase 8, deleting a ROOT comment soft-deleted the root alone (`where id = X`): its replies
-- stayed live, kept counting in `feed_posts.comment_count` and stayed readable through
-- `/comments/{id}/replies`, under a thread nobody could see (RESEARCH Pitfall 1). 08-01's delete
-- cascades from now on (`id = X or parent_id = X`); this statement brings the rows written under the
-- old rule into line.
--
--  - IDEMPOTENT: it touches only live replies of an already-deleted root (`r.deleted_at is null`), so a
--    second run finds nothing and changes nothing.
--  - IDENTIFIABLE: `deleted_at` is copied from the root and `deleted_by_user_id` stays NULL on purpose.
--    Every delete written by the 08-01 code stamps the actor, so `deleted_by_user_id is null and
--    deleted_at = root.deleted_at` names exactly the rows this repair touched — which is what keeps it
--    reversible (reversibility rated costly: it changes live production rows).
--  - COUNTS SELF-CORRECT: `app.feed_comment_count()` fires on the `deleted_at` transition and
--    decrements each post's `comment_count` once per repaired reply. No counter is written here.
--  - ACCEPTED LEFTOVER: the "X respondeu" notifications of those replies are NOT retracted (no event
--    runs in a migration). They open the shipped removed-thread state, which is what a member would
--    see anyway.
--  - Only POST comments can be replies (`feed_comments_parent_shape_chk`), so story comments are never
--    touched. Expand-safe: it can run on production before the Phase 8 API deploys.

update public.feed_comments r
   set deleted_at = p.deleted_at
  from public.feed_comments p
 where r.parent_id = p.id
   and p.deleted_at is not null
   and r.deleted_at is null;
