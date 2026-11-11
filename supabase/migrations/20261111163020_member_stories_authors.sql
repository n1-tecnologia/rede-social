-- member_stories_authors (10-08, MSTORY-03, MPUB-07; A10, T-10-32) — the index of the Explorar authors read.
--
-- ONE index, chosen by measurement before it was final: `.planning/phases/10-rede-social-member-stories-and-communities/
-- 10-08-SPIKE.md` (`CHOSEN_FORM: LATERAL`). The authors read takes the live MEMBER stories of one author at a time
-- (a LATERAL over the followed set for a member, over the live members for the moderator), so it needs the author as
-- the second key and the window range on `expires_at` after it. The partial predicate is the literals the statement
-- names (`visibility = 'followers'`, `deleted_at is null`): organization stories and removed ones are not in it.
-- Measured on 8000 live member stories: the member reads 1.2 to 4.9 ms, the moderator's pages 12 ms, no sequential scan.
--
-- EXPAND-ONLY (MPUB-07): an index and nothing else; no table, column, constraint, policy or row is touched, so the
-- previous release keeps working against it and the migration can be applied ahead of the code. It sorts AFTER
-- `*_moderation_member_content.sql`. The Inicio strip (`visibility = 'tenant'`) never uses it; its plan is unchanged.

CREATE INDEX "stories_tenant_author_expires_idx" ON "stories" USING btree ("tenant_id","author_user_id","expires_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE deleted_at is null and visibility = 'followers';
