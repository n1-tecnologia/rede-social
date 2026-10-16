# Deferred Items — Phase 08.6

## Deferred Items

- The 08.5 E05 long-text backstop on the member course page fails on mobile-chromium (found during 08.6-08)
  status: open
  **What:** `apps/web/e2e/courses-member.spec.ts:717` ("E05/long-text backstop: at 320px a 120-character title and a 160-character tagline…") throws `the element has no box` at `boxOf(hero)` (`member-course-hero`, line 730), after `title` and `tagline` already matched. It failed in the full three-suite run and again in both runs of `--repeat-each=2` on the `course page` group; the other 12 course-page cases pass.
  **Why out of scope:** 08.6-08 changes neither `/cursos/[courseId]` nor the `course page` describe or its `coursePageFixture`. The only shared component it touched, `MemberLessonThumb`, renders exactly as before when the new props are absent, and it is not part of the hero. A throwaway probe (a fresh published course on rede-demo at 320px, removed afterwards) measured the hero at 320 × 200 inside a normal layout chain. So the box is missing only with this case's fixture or timing. Candidates are the user's FRONT-AJUSTES course-header commits (`438bbb81`, `e860bc42`), which landed before this plan.
  **Next step:** open `test-results/…-the-header-title-truncates-mobile-chromium/trace.zip` (or rerun with `--trace on`), check whether the hero is detached by a re-render or hidden at that instant, then fix the test or the page in a `/gsd-debug` or quick task.
