-- courses_material_soft_delete (quick 261016-aqc, 08.5 code review WR-01): nullable `course_lesson_materials.deleted_at`,
-- expand-only. A detach stamps it instead of removing the row, so app.course_asset_hidden keeps governing the asset for good.
ALTER TABLE "course_lesson_materials" ADD COLUMN "deleted_at" timestamp with time zone;