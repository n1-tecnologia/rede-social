# Deferred Items — Phase 08.6

## Deferred Items

- The 08.5 E05 long-text backstop on the member course page fails on mobile-chromium (found during 08.6-08)
  status: open
  **What:** `apps/web/e2e/courses-member.spec.ts:717` ("E05/long-text backstop: at 320px a 120-character title and a 160-character tagline…") throws `the element has no box` at `boxOf(hero)` (`member-course-hero`, line 730), after `title` and `tagline` already matched. It failed in the full three-suite run and again in both runs of `--repeat-each=2` on the `course page` group; the other 12 course-page cases pass.
  **Why out of scope:** 08.6-08 changes neither `/cursos/[courseId]` nor the `course page` describe or its `coursePageFixture`. The only shared component it touched, `MemberLessonThumb`, renders exactly as before when the new props are absent, and it is not part of the hero. A throwaway probe (a fresh published course on rede-demo at 320px, removed afterwards) measured the hero at 320 × 200 inside a normal layout chain. So the box is missing only with this case's fixture or timing. Candidates are the user's FRONT-AJUSTES course-header commits (`438bbb81`, `e860bc42`), which landed before this plan.
  **Next step:** open `test-results/…-the-header-title-truncates-mobile-chromium/trace.zip` (or rerun with `--trace on`), check whether the hero is detached by a re-render or hidden at that instant, then fix the test or the page in a `/gsd-debug` or quick task.

- The tenant-lane Marca "saved look" e2e fails: its fixture helper double-encodes the look (found during 08.6-13)
  status: open
  **What:** `apps/web/e2e/admin-branding.spec.ts:308` fails on both projects in the 08.6-13 full gate, and again when it runs alone. `setTenantLook` (`apps/web/e2e/branding-admin.ts`) writes `jsonb_set(..., '{look}', ${JSON.stringify(look)}::jsonb)` through postgres.js. The driver serializes the string as JSON, so `branding.look` is stored as a jsonb **string**. A standalone probe of the same pattern prints `jsonb_typeof = string`. `resolveBranding` (`packages/contracts/src/branding.ts:389`) then throws a ZodError ("look: expected object, received string") inside `resolveTenantHost`, `GET /v1/public/tenants/by-host` answers 500, and the Marca heading never renders.
  **Why out of scope:** the helper and the case come from the user's FRONT-AJUSTES work (`774e4770`, merged as `438bbb81` / `9706aa7f` into master during Phase 08.6). No 08.6 commit touches branding.
  **Next step:** pass the object, not its string (`${sql.json(look)}`, or `${look}::jsonb`), then rerun the spec. Do it in a quick task.

- The platform Marca app-icon editor's "unreachable logo" e2e step fails (found during 08.6-13)
  status: open
  **What:** `apps/web/e2e/platform-branding.spec.ts:235` (case 2) fails on both projects in the 08.6-13 full gate, and again when the whole file runs alone on desktop. With the branding bucket's `fetch` requests aborted, `AppIconEditor.tsx` never renders `[data-app-icon-logo-state="unreachable"]` within 30 s. Cases 3-5 of the serial describe then do not run.
  **Why out of scope:** `AppIconEditor.tsx` and this step come from the user's FRONT-AJUSTES work (`4d6a601d`, `6bc5b1ee`, merged mid-phase). No 08.6 commit touches them.
  **Next step:** check how the editor loads the current logo now (an `<img>` or another request type would bypass the spec's fetch-only abort), then fix the editor or the spec in a quick task or `/gsd-debug`.
