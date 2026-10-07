-- event_schedule (quick 261007-n1g) — the event's programme ("Cronograma") gets its own column.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
-- Until now the web stored the schedule as text inside the event description (the "Programação" lines
-- of the "Informações úteis" block), spending the 4000-character description limit on up to 30 moments
-- and printing them raw in the .ics file and the Google Calendar link. This adds `events.schedule`, a
-- jsonb array of `{ day, time, title }`, validated at the API and, independently, by the CHECK below.
--
-- ── WHY A COLUMN AND NOT A TABLE ────────────────────────────────────────────────────────────────────
-- The schedule is written as a WHOLE with the event (the PUT is a whole-event replacement) and read
-- WITH it, never queried per item; a table would add statements to the one-statement projection and a
-- second tenant-first index, and the column rides the existing `events_tenant_isolation` policy (no
-- new surface to leak across tenants). It can be split into a table later by an expand migration.
--
-- ── RELEASE ORDER ───────────────────────────────────────────────────────────────────────────────────
-- Expand-only: a new column with a default and a new CHECK on rows that all satisfy it (every row takes
-- `[]`), so the API revision still serving during `supabase db push` ignores it. Release order:
-- migrations, then web, then API (docs/DEPLOY.md, "Event schedule").

ALTER TABLE "events" ADD COLUMN "schedule" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_schedule_chk" CHECK (jsonb_typeof("events"."schedule") = 'array' and jsonb_array_length("events"."schedule") <= 30 and not jsonb_path_exists("events"."schedule", '$[*] ? (!(@.type() == "object" && @.day.type() == "number" && @.day.floor() == @.day && @.day >= 1 && @.day <= 31 && @.time.type() == "string" && @.time like_regex "^([01][0-9]|2[0-3]):[0-5][0-9]$" && @.title.type() == "string" && @.title like_regex "^.{1,80}$" && @.title like_regex "[^[:space:]]"))'));
