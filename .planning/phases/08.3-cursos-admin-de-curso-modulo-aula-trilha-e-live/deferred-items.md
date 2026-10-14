# Phase 08.3 deferred items

Accepted residuals for the member phase (RESEARCH § Security Domain, the plan 05 / plan 12 threat
registers) and out-of-scope discoveries logged by the plan executors (not caused by this phase's
changes). An entry stays open until it carries `status: resolved`.

## Deferred Items

- T-08.3-05 — `app.media_asset_hidden` has no lesson branch; a gated lesson's playback by a remembered asset id
  status: open
  **What:** `GET /v1/media/{assetId}/playback` asks `app.media_asset_hidden` before minting a
  credential (08.2-04), and that function knows feed posts only. A member who learns the asset id
  of a lesson video in a course a product locks could mint a playback token for it. **Why accepted
  in 08.3:** only an `admin_tenant` can mint lesson playback this phase — the course page and the
  lesson form sit behind `courses.manage`, no member route lists lessons or their asset ids, and the
  restrictive `course_lessons_course_gate` policy already hides the lesson ROWS from a locked
  member's lane (pgTAP 190 § 2). **For the member phase:** give `app.media_asset_hidden` a lesson
  branch (a `lesson` asset is hidden when its lesson's course is in `app.course_locked_ids()` and the
  lesson is not `is_free`), and extend `media-playback.test.ts` with the gated-lesson refusal.
  Threat register: RESEARCH T-08.3-05 (accept now / record for next phase); plan 12 T-08.3-05.

- T-08.3-08 — `GET /v1/media/{assetId}/original` is un-gated inside the tenant for a material known by id
  status: open
  **What:** the original-bytes route is a zero-read, tenant-prefixed capability that consults no gate
  (08.2 Assumption A6 / Open Question 2, kept on purpose). A member who learns a lesson material's
  asset id can fetch its bytes through it for the signed URL's hour. **Why accepted in 08.3:** no
  member route exposes a material id this phase (materials are listed only by the admin's lesson
  detail, behind `courses.manage`); the admin's own open goes through the ten-minute
  `signReadFor` URL of `GET …/materials/{materialId}/url` (plan 05, T-08.3-06). **For the member
  phase:** either extend `app.media_asset_hidden` to lesson materials and have `serveVariant` ask it
  for `file` kinds, or accept the residual for materials as 08.2 did for images and PDFs — decide
  before the first member read of a lesson's materials ships.
  Threat register: RESEARCH T-08.3-08 (accept, document for the member phase); plan 05 and plan 12
  T-08.3-08.

- Residual from 08.3-01 — a `course_lesson_progress` row stamped with tenant A may reference a lesson of tenant B through the plain FK
  status: open
  **What:** `course_lesson_progress.lesson_id` is a plain FK; referential-integrity checks bypass RLS,
  so an insert that names a foreign lesson is refused only by the tenant lane's `with check` on
  `tenant_id` / `user_id` (pgTAP 020 proves the cross-tenant insert is 42501), never by the FK
  itself. **Why accepted:** no route writes progress in 08.3; the member phase writes it only through
  the lane. A composite FK `(tenant_id, lesson_id) → course_lessons(tenant_id, id)` is the structural
  option if it ever matters (recorded in 08.3-01-SUMMARY § Next Phase Readiness).

- Residual from 08.3-05 — a lesson under a soft-deleted module stays reachable by id; a material whose asset was soft-deleted drops out of the list
  status: open
  **What:** `lockLesson` reads the lesson's OWN `deleted_at`, so a lesson under a removed module
  leaves every list but stays reachable by id (its video stays "in use" until detached by id); a
  material whose asset was soft-deleted drops out of the materials list and a re-sent identical set
  answers 404 until the id is dropped. **Why accepted:** both are admin-only paths with an admin-only
  recovery; the member phase decides what a removed replay or module reads as (08.3-05-SUMMARY,
  08.3-11-SUMMARY § Next Phase Readiness).

- Residual from 08.3-09 — the lesson form's submit does not wait for a video transfer still in flight
  status: open
  **What:** the kernel `VideoUploadField` exposes no upload state, so saving mid-transfer saves the
  lesson without the video and the asset lands as an orphan the 03-08 sweeper collects. **Fix shape:**
  an `onStateChange` on the field (a one-line kernel change outside plan 09's files) and a `busy`
  gate in `LessonForm` (08.3-09-SUMMARY § Next Phase Readiness).

- Out of scope (Phase 6) — `apps/web/app/(app)/eventos/meus/page.tsx:237` pairs `line-clamp-2` with `block`
  status: open
  **Found during:** 08.3-12 Task 1 (the E03 long-text backstop found the same pairing in
  `packages/modules/courses/ui/ListRow.tsx` and fixed it there, commit of Task 1).
  **What:** Tailwind v4 emits `.block { display: block }` AFTER `.line-clamp-2 { display: -webkit-box }`
  in the compiled CSS, so the display utility wins the cascade and the clamp never applies: a long
  event title on "Meus eventos" paints every line instead of two. Pre-existing (Phase 6, unchanged
  since before 08.3), not in any 08.3 path, so not fixed here. **Fix:** drop `block` from that `span`
  (the clamp's `-webkit-box` is block-level already); `events.spec.ts` has no long-title case to pin
  it.

- Pre-existing verify failure (quick 261012-s0v) — `signup.spec.ts` test 6 expects the generic-host signup link to come back to the generic host
  status: open
  **Found during:** 08.3-12 Task 3, the `pnpm verify` e2e stage (the only failing case: 979 passed,
  147 skipped, 2 failed — this one case on mobile-chromium and desktop-chromium).
  **Spec:** `apps/web/e2e/signup.spec.ts:324` "D-01/D-06/D-21 — generic and platform hosts › 6. generic
  host keeps /cadastro/{slug} and remembers the slug in a cookie".
  **Error:** `expect(mail.link?.startsWith(`${hosts.generic}/auth/confirm`)).toBe(true)` at line 345,
  received `false`; the mail's link is
  `http://rede-demo.localhost:3000/auth/confirm?next=/inicio&token_hash=…&type=signup`, not
  `http://localhost:3000/auth/confirm…`.
  **Reproduced on:** `507091beb3adb8b78e0e3f64d2a673bae03420fa` (the commit before 08.3-01), with a
  worktree-less checkout, `pnpm db:reset && pnpm db:seed` and
  `playwright test signup.spec.ts -g "6. generic host keeps"`. It failed the same way on both
  projects. The stack was then reset and seeded again on `master`.
  **Cause:** quick 261012-s0v (`5ea318a6`, before 08.3) re-homes a link that fell back to
  `site_url` onto the tenant's verified primary host. It updated the integration case for the
  hostless row 6a (`0b17aed5`) but not this e2e assertion. No 08.3 commit touches the auth hook,
  the mail templates or the sign-up path.
  **Fix shape:** decide which host a sign-up started on a generic host should link back to. If it
  is the tenant's primary host (s0v's behaviour), re-pin line 345 to the tenant's host and check
  that the cookie round trip after `signOut` still holds there. If it is the host the person used,
  narrow s0v's re-home to the real `site_url` fallback.

- Review WR-08 — the course page hard-codes `image.mux.com` thumbnails and mints a full playback credential per ready lesson on every render
  status: open
  **What:** `apps/web/app/(app)/cursos/[courseId]/page.tsx` builds the Mux thumbnail URL by hand,
  bypassing the `VideoProvider` seam (D-409), so every non-production environment
  (`VIDEO_PROVIDER=fake`) shows broken posters, and each page view calls
  `GET /v1/media/{id}/playback` once per ready lesson only to keep the thumbnail token.
  **Why deferred:** the fix needs a thumbnail builder or a thumbnail-only credential route on the
  provider layer, with contract and route changes; the code-review fixer skipped it as a planned
  task, not a review fix (08.3-REVIEW-FIX.md). **Fix shape:** `videoProvider.thumbnailUrl(...)` or a
  thumbnail-only route, with the glyph as the `fake` fallback.

- Review WR-09 — lesson materials share the tenant's 800 MiB byte ceiling with the feed
  status: open
  **What:** materials (up to 10 per lesson, 50 MiB each) count against `MEDIA_TENANT_BYTES_CEILING`
  together with every feed photo, cover, avatar and attachment; sixteen maximum-size materials
  exhaust it and every image or file upload in the tenant then answers `413 quota_exceeded`.
  **Why deferred:** the shared cap exists to stay under the Supabase Free plan's 1 GB total, so a
  separate materials budget is a plan decision for the product owner, not a code fix. **Options:** a
  separate `attachment` ceiling, or accept the shared cap and warn the admin in the materials list as
  usage nears it (08.3-REVIEW.md WR-09).
