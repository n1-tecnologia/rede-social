# Phase 12.3 deferred items

Out-of-scope discoveries, logged and not fixed (executor scope boundary).

## From plan 12.3-07 (found 2026-11-09)

- `apps/web/app/(app)/cursos/[courseId]/CurriculumEditor.test.tsx`, case 7 ("creating a module through the sheet appends its card ..."), fails: the module sheet now posts `coverAssetId: null, topCoverAssetId: null` (added by plan 12.3-05 so `ModuleSheet.tsx` type-checks against the defaulted `ModuleInput`), and the case still expects the body without those two keys. Not caused by plan 07 (the sheet and the test are untouched here). Fix: add the two null keys to the expected body, or fold it into plan 12.3-08, which rewrites the module form.
- `pnpm exec biome check --write "app/(app)/cursos"` (whole directory) reformats three files outside any plan (`MemberCoursesGrid.tsx`, `[courseId]/ModuleSheet.tsx`, `lib/registry.tsx`, one line each). Run biome on named files only.
