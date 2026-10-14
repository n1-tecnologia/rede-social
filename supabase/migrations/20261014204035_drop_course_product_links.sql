-- drop_course_product_links — MIGRATION FILE 3 of the 08.4 link move: the ONE-WAY step (08.4-02,
-- COURSE-08, COURSE-11, STORE-22; D-418, SC 4).
--
-- WHAT IT DOES: drops 08.3's course-owned link tables `course_products` and `course_live_products`
-- with their policies; the CASCADE also takes their two hand foreign keys to `store_products` from
-- `*_courses_functions.sql`. After it runs, a course or live link has ONE representation — a row of
-- the store-owned `store_product_courses` / `store_product_lives` — and the store computes the gate
-- from them. Undo before a deploy is a reverted commit plus `db:reset`; after a deploy, one migration
-- recreating the two tables and copying the rows back.
--
-- WHY IT CANNOT LOSE A LINK: migration file 2 (`*_store_course_links_functions.sql`) already copied
-- every 08.3 link row into the store tables preserving `created_at` (`on conflict … do nothing`) and
-- ends its carry-over with a guard that raises, aborting that file, on any set difference in either
-- direction; only then did it re-point the four gate bodies at the store tables.
-- `scripts/rehearse-course-links-migration.sh` replays files 1 → 2 → 3 from the 08.3 era on an edge
-- fixture and asserts every link and every gate answer survives. No deployed database has these
-- tables: 08.3 never shipped, and 08.3 and 08.4 migrations are pushed together, migrations first.
--
-- WHY IT IS A SEPARATE, LATER FILE from the custom one: a `language sql` function body is not a
-- tracked dependency, so `drop table` would succeed while a gate body still named the table and the
-- gate would fail at its next call (RESEARCH probe). Kept apart, file 1 is create-only and this file
-- is drop-only, so drizzle-kit never asks whether a new table replaces an old one.
--
-- ORDER: every environment must apply `*_store_course_links_functions.sql` BEFORE this file. The
-- timestamped filenames guarantee it — the Supabase CLI applies migrations in version order — and
-- the rehearsal applies them in exactly that order from the 08.3 era.
--
-- The statements below are `pnpm db:generate`'s own output, unedited; the generated snapshot
-- (`meta/20261014204035_snapshot.json`) matches them, so `pnpm db:generate` stays a no-op.

DROP POLICY "course_live_products_select_tenant" ON "course_live_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_live_products_insert_admin" ON "course_live_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_live_products_update_admin" ON "course_live_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_live_products_delete_admin" ON "course_live_products" CASCADE;--> statement-breakpoint
DROP TABLE "course_live_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_products_select_tenant" ON "course_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_products_insert_admin" ON "course_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_products_update_admin" ON "course_products" CASCADE;--> statement-breakpoint
DROP POLICY "course_products_delete_admin" ON "course_products" CASCADE;--> statement-breakpoint
DROP TABLE "course_products" CASCADE;