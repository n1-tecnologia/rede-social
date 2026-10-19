-- media_duration_cap (09-06, SOCIAL-05, D-474; T-09-18)
-- Adds `media_assets.duration_cap_seconds`, the effective duration cap SNAPSHOTTED at `start` for a
-- MEMBER's `post` video. The ready job judges the provider's measured duration against
-- `coalesce(duration_cap_seconds, <static cap>)`, so lowering a tenant's limit after an upload began
-- does not change the verdict on that upload (limits apply to new uploads only).
-- EXPAND-ONLY: one nullable column (NULL = the static cap applies, i.e. every existing row and every
-- admin upload) and one CHECK that holds for every existing row (NULL passes). Nothing is removed,
-- or altered, so a deploy-window API that does not know the column keeps working.
ALTER TABLE "media_assets" ADD COLUMN "duration_cap_seconds" integer;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_duration_cap_chk" CHECK ("media_assets"."duration_cap_seconds" is null or "media_assets"."duration_cap_seconds" > 0);
