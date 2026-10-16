-- courses_notice_columns (08.6-07, D-448, D-450, COURSE-44, COURSE-45, COURSE-52): `courses.published_notified_at` (the
-- 24-hour course-published notice stamp, D-448 dedupe) and `course_lessons.announced_at` (the lesson announcement
-- watermark, D-450, R-Pitfall 6). Generated, expand-only; the backfill lives in `*_courses_course_notice_functions.sql`.
ALTER TABLE "course_lessons" ADD COLUMN "announced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "published_notified_at" timestamp with time zone;
