-- courses_functions (08.3-01, COURSE-08, D-404; MOD-02) — the courses module's hand-written SQL,
-- applied AFTER the generated `*_courses.sql` that created the tables it alters.
--
-- TWO groups of statements:
--
--   1. The foreign keys of the two product link tables to `store_products`.
--      `course_products.product_id` and `course_live_products.product_id` are bare uuids in
--      packages/modules/courses/db/schema.ts (no drizzle reference), so the courses package never
--      imports the store schema; the structural tie lives here, in SQL only — the
--      `store_product_communities_community_fk` precedent of `*_store_functions.sql`.
--      `on delete cascade`: a removed product drops its links (a course it alone opened becomes
--      open to every member, the store's own rule for communities; products are archived, never
--      removed, in the product itself). These two statements are what a store-less reuse of the
--      courses module drops: without `store_products` they cannot apply, and without them the link
--      tables are plain uuid columns that the kernel's gate stubs never read.
--
--   2. The progress ledger's table privileges (D-408, COURSE-09, P38; the `store_orders`
--      precedent): `delete` and `truncate` on `course_lesson_progress` are REVOKED from
--      `authenticated`. The table has no delete policy, so with RLS alone a member-lane delete would
--      silently touch zero rows and TRUNCATE is not seen by RLS at all; without the privilege every
--      tenant-lane delete raises 42501 — a member's record is never removed by any lane, the admin
--      claim included. Insert and update stay: the member lane writes its OWN rows through the
--      `*_own` policies. The admin lane (`service_role`) keeps its privileges.

alter table public.course_products
  add constraint course_products_product_fk
  foreign key (product_id) references public.store_products(id) on delete cascade;
--> statement-breakpoint

alter table public.course_live_products
  add constraint course_live_products_product_fk
  foreign key (product_id) references public.store_products(id) on delete cascade;
--> statement-breakpoint

revoke delete, truncate on public.course_lesson_progress from authenticated;
