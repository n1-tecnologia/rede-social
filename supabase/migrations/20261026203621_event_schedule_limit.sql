-- event_schedule_limit (09.3-01, PEND-08, D-558; T-09.3-01, T-09.3-02, T-09.3-04)
-- Raises the event programme ("Cronograma") from 30 to 200 moments: `events_schedule_chk` is dropped and
-- re-added with `jsonb_array_length(schedule) <= 200`. The item rules (day 1..31, `HH:MM`, a non-blank
-- title of 1..80 characters) are byte-identical to `20261007194945_event_schedule.sql`, which is never edited.
-- EXPAND-ONLY: the CHECK is re-added WIDER, so every existing row satisfies it; no column, table, trigger
-- or policy is touched and no stored schedule is rewritten, truncated or backfilled. An old API on the new
-- database keeps working (D-561). The DROP and the ADD live in this one file, so the runner's single
-- transaction never exposes `events` without the constraint.
-- COSTLY TO UNDO (D-558): lowering the limit again would make any saved schedule over the new cap fail the
-- CHECK, so it needs a data decision first (what happens to the moments past the cap), never a plain re-add.
-- It reaches every tenant project through the ledgered `migrateAll`, databases before API and worker (D-544).
ALTER TABLE "events" DROP CONSTRAINT "events_schedule_chk";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_schedule_chk" CHECK (jsonb_typeof("events"."schedule") = 'array' and jsonb_array_length("events"."schedule") <= 200 and not jsonb_path_exists("events"."schedule", '$[*] ? (!(@.type() == "object" && @.day.type() == "number" && @.day.floor() == @.day && @.day >= 1 && @.day <= 31 && @.time.type() == "string" && @.time like_regex "^([01][0-9]|2[0-3]):[0-5][0-9]$" && @.title.type() == "string" && @.title like_regex "^.{1,80}$" && @.title like_regex "[^[:space:]]"))'));