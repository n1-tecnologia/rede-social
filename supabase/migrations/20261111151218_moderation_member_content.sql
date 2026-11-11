-- moderation_member_content (10-04, MCOMM-10, MSTORY-09, MPUB-07; D-711; T-10-12) — widens the two vocabularies
-- of `moderation_log` by three actions and two subject types, so a holder of `moderation.manage` can remove a
-- MEMBER's story and archive or remove a MEMBER's community with the log row committed in the same transaction
-- (the 09-07 `post_removed` shape).
--
--   actions       + 'story_removed', 'community_archived', 'community_removed'
--   subject types + 'story', 'community'
--
-- THE CURRENT LISTS, not the 09-07 file's: the action list starts from the one in
-- `20261029232606_profile_form_tables.sql` (the Phase 12 `profile_form_exported` is KEPT), and the subject list
-- from `20261019225153_moderation_post_removed.sql`, the last migration that touched it. Nothing existing is
-- narrowed.
--
-- THE BINDING. The five removal-class actions (`comment_removed`, `post_removed`, `story_removed`,
-- `community_archived`, `community_removed`) are exactly the actions whose `subject_type` AND `subject_id` are both
-- present, and no other action names a subject. Each new subject type is bound to its actions with a NULL-guarded
-- equality: `story` iff `story_removed`; `community` iff `community_archived` or `community_removed` (beside the
-- existing `feed_post` iff `post_removed`), so a story subject on a post removal, a feed_post subject on a story
-- removal and a community subject on a block are all refused (23514), and a NULL can never satisfy a branch.
--
-- REPORTS. `content_reports.subject_type` is its own CHECK list (`feed_post`, `post_comment`) and the resolve path
-- (`packages/core/server/safety/reports.ts`, `app.content_report_resolve`) removes only those two kinds through
-- `post_removed` / `comment_removed`: no report can be resolved into a `story_removed`, `community_archived` or
-- `community_removed` row. Phase 11 owns new report subjects.
--
-- EXPAND-ONLY, NO ROW TOUCHED: two constraints are dropped and re-added WIDER; every existing row (a comment
-- removal with a comment subject, a post removal with a post, the four non-subject actions) satisfies the new
-- text. No column, table or trigger changes. The immutability triggers fire on row update/delete and truncate,
-- never on DDL, so the append-only lock (`*_moderation_log_immutable.sql`) is untouched.
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_action_chk";--> statement-breakpoint
ALTER TABLE "moderation_log" DROP CONSTRAINT "moderation_log_subject_chk";--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_action_chk" CHECK ("moderation_log"."action" in ('comment_removed','member_blocked','member_unblocked','role_changed','post_removed','profile_form_exported','story_removed','community_archived','community_removed'));--> statement-breakpoint
ALTER TABLE "moderation_log" ADD CONSTRAINT "moderation_log_subject_chk" CHECK ((("moderation_log"."action" in ('comment_removed','post_removed','story_removed','community_archived','community_removed')) = ("moderation_log"."subject_type" is not null and "moderation_log"."subject_id" is not null))
        and ("moderation_log"."subject_type" is null or "moderation_log"."subject_type" in ('post_comment','story_comment','feed_post','story','community'))
        and (coalesce("moderation_log"."subject_type" = 'feed_post', false) = ("moderation_log"."action" = 'post_removed'))
        and (coalesce("moderation_log"."subject_type" = 'story', false) = ("moderation_log"."action" = 'story_removed'))
        and (coalesce("moderation_log"."subject_type" = 'community', false) = ("moderation_log"."action" in ('community_archived','community_removed'))));
