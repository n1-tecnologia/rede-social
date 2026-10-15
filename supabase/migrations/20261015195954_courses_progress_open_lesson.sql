-- courses_progress_open_lesson (08.5-01, COURSE-21, D-422, D-429; closes T-08.3-09 in the database): both own-row
-- progress write checks also require a lesson the caller may OPEN (app.course_lesson_access(lesson_id) is null) and refuse the
-- admin_tenant claim. Sorted after *_courses_member_functions.sql, which creates the function the policies call.
ALTER POLICY "course_lesson_progress_insert_own" ON "course_lesson_progress" TO authenticated WITH CHECK (tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() is distinct from 'admin_tenant' and app.course_lesson_access(lesson_id) is null);--> statement-breakpoint
ALTER POLICY "course_lesson_progress_update_own" ON "course_lesson_progress" TO authenticated USING (tenant_id = app.tenant_id() and user_id = app.user_id()) WITH CHECK (tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() is distinct from 'admin_tenant' and app.course_lesson_access(lesson_id) is null);
