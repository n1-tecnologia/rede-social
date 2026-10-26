-- story_highlight_title_limit (09.3-03, PEND-09, D-559, D-561)
-- A highlight name may now be up to 50 characters, up from 15: `story_highlights_title_chk` is
-- dropped and re-added with `between 1 and 50`; the trim rule (`title = btrim(title)`) is kept.
-- EXPAND-ONLY: the CHECK is re-added WIDER, so every existing row satisfies it and no row, column or
-- other table is touched. An old API on the new database keeps working (it still caps at 15 itself).
-- Lowering the cap again later would make saved names over it fail the CHECK and needs a data
-- decision first (D-559, costly, not one-way). The file reaches every tenant project through the
-- ledgered migrateAll, databases before API and worker (D-544).
ALTER TABLE "story_highlights" DROP CONSTRAINT "story_highlights_title_chk";--> statement-breakpoint
ALTER TABLE "story_highlights" ADD CONSTRAINT "story_highlights_title_chk" CHECK (char_length("story_highlights"."title") between 1 and 50 and "story_highlights"."title" = btrim("story_highlights"."title"));
