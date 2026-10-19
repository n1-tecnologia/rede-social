-- moderation_post_removed (09-07, SOCIAL-07, D-475; T-09-22, T-09-23)
-- Widens the two vocabularies of `moderation_log` by one value each: the action `post_removed` and the
-- subject type `feed_post`, so a holder of `moderation.manage` can remove a MEMBER's post with the log
-- row committed in the same transaction (the comment-removal shape). The subject CHECK now requires a
-- subject for BOTH removal actions and binds `feed_post` to `post_removed`, with every comparison
-- guarded so a NULL can never satisfy it.
-- EXPAND-ONLY: two constraints are dropped and re-added WIDER; every existing row (comment_removed with
-- a comment subject, the three non-subject actions) satisfies the new text, and no column, table or
-- trigger is touched. The immutability triggers fire on row update/delete and truncate, never on DDL,
-- so the append-only lock (`*_moderation_log_immutable.sql`) is untouched.
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_action_chk";--> statement-breakpoint
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_subject_chk";--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_action_chk" CHECK ("moderation_log"."action" in ('comment_removed','member_blocked','member_unblocked','role_changed','post_removed'));--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_subject_chk" CHECK ((("moderation_log"."action" in ('comment_removed','post_removed')) = ("moderation_log"."subject_type" is not null and "moderation_log"."subject_id" is not null))
        and ("moderation_log"."subject_type" is null or "moderation_log"."subject_type" in ('post_comment','story_comment','feed_post'))
        and (coalesce("moderation_log"."subject_type" = 'feed_post', false) = ("moderation_log"."action" = 'post_removed')));