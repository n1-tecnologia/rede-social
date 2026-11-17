-- media_audio_kind (12.5-01, D-864, VOICE-13): widen the two CHECKs of `media_assets` so a chat voice
-- message can exist as a row — kind `audio` and purpose `voice`, appended after every value the
-- constraints accepted before. Generated from the contract lists in `@rede-social/contracts/media`
-- and then reshaped by hand for a safe swap.
--
-- Expand-only: nothing is removed, so every existing row already satisfies the wider lists and the
-- previous API keeps working while this ships first (docs/DEPLOY.md: migrations before the API).
--
-- Each swap is ONE `alter table` statement that drops the old constraint and adds the new one
-- NOT VALID in the same breath, so there is never a moment without a constraint (the local CLI does
-- not wrap a file in a transaction, and a gap between a drop and an add would let a bad row in).
-- The `validate constraint` statements that follow take only a SHARE UPDATE EXCLUSIVE lock, so they
-- do not block writers while the existing rows are re-checked.
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_kind_chk", ADD CONSTRAINT "media_assets_kind_chk" CHECK ("media_assets"."kind" in ('image','video','file','audio')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_purpose_chk", ADD CONSTRAINT "media_assets_purpose_chk" CHECK ("media_assets"."purpose" in ('avatar','post','cover','story','attachment','lesson','voice')) NOT VALID;--> statement-breakpoint
ALTER TABLE "media_assets" VALIDATE CONSTRAINT "media_assets_kind_chk";--> statement-breakpoint
ALTER TABLE "media_assets" VALIDATE CONSTRAINT "media_assets_purpose_chk";
