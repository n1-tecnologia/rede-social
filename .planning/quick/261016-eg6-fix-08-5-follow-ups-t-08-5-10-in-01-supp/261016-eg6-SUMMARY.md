---
phase: quick-261016-eg6
plan: 01
subsystem: courses (asset gate), @rede-social/ui (Button), web member courses (UI + i18n)
status: complete
tags: [courses, asset-gate, pgtap, security, ui, a11y, i18n, review-fix, 08.5]
requires:
  - 20261016110251_courses_asset_gate_fail_closed.sql (quick 261016-aqc)
provides:
  - app.course_asset_hidden with an admin_tenant-only staff bypass
  - buttonClasses() in @rede-social/ui with an opt-in 44px hit area
  - whole-sentence ICU select messages for card.aria, lives.aria, lesson.free
affects:
  - GET /v1/media/{assetId}/playback and /original for support_tenant
  - 08.5 member course surfaces (tap targets, button look, accessible names)
tech-stack:
  added: []
  patterns:
    - directive-less class-builder module re-exported from the ui index (chipBase precedent)
    - ICU select arguments passed as 'true' / 'false' strings (next-intl value type)
key-files:
  created:
    - supabase/migrations/20261016133848_courses_asset_gate_admin_only.sql
    - supabase/migrations/meta/20261016133848_snapshot.json
    - packages/ui/src/primitives/buttonClasses.ts
  modified:
    - supabase/migrations/meta/_journal.json
    - supabase/tests/195-courses-member.sql
    - apps/api/tests/integration/media-playback.test.ts
    - docs/DEPLOY.md
    - packages/modules/courses/README.md
    - packages/ui/src/primitives/Button.tsx
    - packages/ui/src/index.ts
    - packages/ui/tests/button.test.tsx
    - apps/web/app/(app)/cursos/[courseId]/CourseActionZone.tsx
    - apps/web/app/(app)/cursos/lives/[liveId]/LiveStateZone.tsx
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/LessonNav.tsx
    - apps/web/app/(app)/cursos/PreviewBanner.tsx
    - apps/web/app/(app)/cursos/MemberCoursesGrid.tsx
    - apps/web/app/(app)/cursos/[courseId]/aulas/[lessonId]/MemberLessonPage.tsx
    - apps/web/app/(app)/cursos/ReadMoreText.tsx
    - apps/web/messages/pt-BR/courses.member.json
    - apps/web/lib/courses-member-view.ts
    - apps/web/lib/courses-member-view.test.ts
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/courses-member.spec.ts
decisions:
  - "T-08.5-10 / IN-01: only the admin_tenant claim bypasses app.course_asset_hidden; support_tenant takes app.course_lesson_access (served on published courses, refused a draft's lesson assets)"
  - "buttonClasses() lives in a directive-less module so Server Components can style links with it; Button renders exactly buttonClasses(...)"
  - "ICU select arguments are passed as 'true' / 'false' strings, because next-intl types a value as string | number | Date"
metrics:
  duration: ~12 min
  completed: 2026-10-16
plan_head_before: e1b216cb73556bc85730ec383d19eafa71c29f34
actuals:
  tokens: 13600   # chars/4 over the diff, excluding the generated 9k-line drizzle snapshot (~80k with it)
  tasks: 3
  commits: 3
---

# Quick 261016-eg6: 08.5 follow-ups (T-08.5-10 / IN-01 and UI-REVIEW fixes 1-3) Summary

This task closes three 08.5 follow-ups:
- **Asset gate:** the course asset gate now bypasses only the `admin_tenant` claim, so support can no longer mint playback or sign `/original` for a draft course's lesson assets.
- **Button look:** one `buttonClasses()` helper now builds every button-styled link on the member side, and adds an opt-in 44px tap target.
- **Accessible names:** the course card name, the live card name and the free-lesson meta are each one ICU `select` sentence in the catalog.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 5db5c9e5 | fix(08.5): IN-01 course asset gate bypasses admin_tenant only, support_tenant takes the access answer (T-08.5-10) |
| 2 | bed02012 | fix(08.5): UI-D-443 44px tap targets and one shared buttonClasses() for button-styled links (UI-REVIEW fixes 1-2) |
| 3 | ead2b409 | fix(08.5): whole-sentence ICU messages for the course and live card names and the free-lesson meta (UI-REVIEW fix 3) |

None of the three commits has a Co-Authored-By trailer (`git log --format=%B e1b216cb..HEAD | grep -ci co-authored-by` prints 0).

## Task 1: the asset gate (T-08.5-10 / IN-01)

- **RED:** `bash scripts/supabase.sh test db supabase/tests/000-helpers.sql supabase/tests/195-courses-member.sql` ran against the old body. It reported exactly ONE failure out of 89 (`Failed test 66: "IN-01 / T-08.5-10: support_tenant is refused a draft course's lesson video and material (D-426)"`, have `{f,f}`, want `{t,t}`). The other two new cases already passed under the old body.
- **Migration:** `20261016133848_courses_asset_gate_admin_only.sql` comes from `pnpm db:generate --custom`.
  - It holds one `create or replace function app.course_asset_hidden(uuid)` plus the revoke/grant pair.
  - A `diff` against 110251 lines 100-138 shows one changed line: `when app.tenant_role() = 'admin_tenant' then false`.
  - The expand-only grep finds nothing.
  - I applied it with `bash scripts/supabase.sh migration up` without piping it, so the apply could not be silently skipped. The DB function body was then confirmed to contain `= 'admin_tenant' then false`, with `search_path=""`.
- **GREEN:** pgTAP 195 passes `plan(89)`. The targeted 000/010/020/030/040/190/195 run passed: 7 files, 569 tests.
- **HTTP:** a new `it` sits right before WR-01 in `media-playback.test.ts`, so WR-01 still runs last:
  - Before the change: support gets 200 on playback and 302 on `/original`.
  - With the course set to draft: support gets the bare 404 on both, and the admin still gets 200 and 302.
  - The course is republished in `finally`.
- **Unchanged files:** 20261016110251 and 20261015194825 are byte-identical to `e1b216cb`, and `pnpm db:generate` reports "No schema changes".
- **Docs:** DEPLOY.md now says "Seven migrations", has a new bullet for this migration, and says "these seven files". The courses README asset-seam paragraph now names the admin-only bypass.

## Task 2: buttonClasses() and 44px tap targets (UI-REVIEW fixes 1-2)

- **RED:** `pnpm --filter @rede-social/ui exec vitest run button` gave 5 failed and 32 passed. Four failures were `TypeError: buttonClasses is not a function`; the fifth was `Button hitArea` missing `relative`.
- **GREEN:**
  - `packages/ui/src/primitives/buttonClasses.ts` has no directive. It holds the moved `variantStyles` and `sizeStyles`, the `HIT_AREA` constant (`relative after:absolute after:inset-x-0 after:-inset-y-1`), `ButtonClassesOptions` and `buttonClasses()`.
  - `Button` renders exactly `buttonClasses(...)` and destructures `hitArea`, so it never reaches the DOM. It re-exports the two types.
  - The index exports each type once.
  - The ui package passes: 11 files, 183 tests, client-boundary included.
- **Call sites:**
  - CourseActionZone: brand, brand plus `mt-3`, outline full width, outline sm with hit area, ghost sm with hit area.
  - LiveStateZone: brand.
  - LessonNav: outline and brand, with `min-w-0 gap-1.5 px-3`. `STATIC` is kept for the spans.
  - PreviewBanner: ghost sm with hit area.
  - MemberCoursesGrid: outline md. This brings back the outline active state.
  - MemberLessonPage: ghost sm with hit area.
  - ReadMoreText: `<Button hitArea>`.
  - MemberLessonPage and ReadMoreText were found by grepping the code; the review did not list them.
- **Left as is:** the `rounded-[14px]` over-media pill in MemberCoursesGrid stays on purpose. It is documented: it wraps onto two lines at 320px, where `rounded-full` would turn it into a capsule, and no token gives both a one-line pill and a soft two-line rectangle.

## Task 3: whole-sentence ICU messages (UI-REVIEW fix 3)

- **RED:** `pnpm --filter @rede-social/web exec vitest run i18n/messages lib/courses-member-view` gave 4 failed and 1257 passed:
  - the placeholder rows for card.aria, lives.aria and lesson.free;
  - the formatted card.aria with exclusive.

  The new 'Aula aberta' view pin (free lesson with no duration) already passed; it guards the refactor.
- **GREEN:**
  - In the catalog, `card.aria`, `lives.aria` and `lesson.free` are now ICU `select` sentences, and the three fragment keys are gone.
  - In the view, each name is built by one `t()` call. `trimLead` is still used for the lock line.
  - The e2e spec takes its three expectations from the catalog through `createTranslator`. The live suffix is computed as the difference between the exclusive and non-exclusive sentences, regex-escaped and anchored with `$`.
  - Result: 1261 of 1261 tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Boolean ICU select arguments failed the web typecheck**
- **Found during:** Task 3, caught by the monorepo gate after the Task 3 commit.
- **Issue:** at runtime, intl-messageformat selects `true` correctly, so the Vitest suites passed. But next-intl types an argument as `string | number | Date`, and `tsc` raised 16 TS2322/TS2345 errors in `courses-member-view.ts`, `messages.test.ts` and `courses-member.spec.ts`. My Task 3 verify run missed this because it piped `pnpm typecheck` through `tail`, which hid the exit code.
- **Fix:** I applied the plan's own fallback. The view passes `String(flag)`, and the tests and e2e pass `'true'` / `'false'`. A comment in the view explains why. Then I checked again: web typecheck exited 0 when run on its own, and 1261 of 1261 tests passed.
- **Commit:** folded into the Task 3 commit with `--amend`. The commit was local and never pushed, so the plan still has three commits. 70499781 became ead2b409.

**2. [Process] Task 2 typecheck was also checked through a tail pipe**
- The final monorepo gate (`@rede-social/web#typecheck` and `#build`, both green) confirms the Task 2 call sites typecheck. Only Task 3 lines were in the failing run.

## Verification (after all three commits)

1. **Full pgTAP** (`pnpm supabase test db`): 31 files, 1434 tests, Result: PASS. Test 154 did not trip, so no `db:reset` / `db:seed` was needed.
2. **Integration** (`pnpm --filter @rede-social/api exec vitest run tests/integration/media-playback.test.ts tests/integration/courses-learn.test.ts`): 2 files, 66 of 66 tests passed. This was run once after Task 1 and again after the full pgTAP run.
3. **Schema drift** (`pnpm db:generate`): "No schema changes, nothing to migrate".
4. **Literals** (`bash scripts/check-ui-literals.sh`): exit 0.
5. **Monorepo gate** (`TURBO_CACHE=local:r pnpm turbo lint typecheck test --continue --concurrency=4`): exit 0, 49 of 49 tasks. The first run failed on web typecheck and build, which was deviation 1 above, and passed after the fix.

   | Package | Tests passed |
   |---|---|
   | web | 3080 (126 files) |
   | ui | 183 |
   | core | 433 |
   | api (unit) | 62 |
   | module-feed | 247 |
   | contracts | 179 |
   | module-stories | 162 |
   | module-events | 160 |
   | module-courses | 129 |
   | module-notifications | 127 |
   | module-reels | 126 |
   | module-store | 66 |
   | module-communities | 52 |
   | module-chat | 44 |
   | reuse-fixture | 3 |

   No pre-existing failures were seen.
6. **Trailers:** 0 Co-Authored-By lines across `e1b216cb..HEAD`.

## Hand-on notes (deliberately untouched)

- `08.5-SECURITY.md` still lists T-08.5-10 as open until `/gsd-secure-phase 08.5` re-audits it.
- The `08.5-UI-REVIEW.md` scores are historical.
- Review IN-02 (the `course_lesson_states` grant) stays deferred.
- The 36px sm controls on the 08.3 admin surfaces are outside this phase's review.
- The new migration still has to reach production through `supabase db push` in the 08.5 release (DEPLOY.md now lists it).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261016133848_courses_asset_gate_admin_only.sql
- FOUND: packages/ui/src/primitives/buttonClasses.ts
- FOUND: commits 5db5c9e5, bed02012, ead2b409 (`git rev-list --count e1b216cb..HEAD` = 3)
