-- courses_member_columns (08.5-01, D-428, COURSE-22): `course_lessons.requires_previous` ("Exige concluir a
-- aula anterior", evaluated by app.course_lesson_states) and the materials-by-asset index the COURSE-20 asset gate reads.
ALTER TABLE "course_lessons" ADD COLUMN "requires_previous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "course_lesson_materials_tenant_asset_idx" ON "course_lesson_materials" USING btree ("tenant_id","asset_id");
