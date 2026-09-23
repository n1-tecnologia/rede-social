---
phase: 04-feed
plan: 09
subsystem: ui
tags: [feed, composer, edit, soft-delete, rbac, uploads, next-app-router, hono, zod, playwright]

requires:
  - phase: 03-media
    provides: the signed-upload hook, the drop zone, the provider-owned video branch and the media catalog copy the composer assembles without writing a byte of upload code
  - phase: 04-feed
    provides: 04-04's gallery-XOR-video constraint and in-transaction asset validation, 04-05's unfurl-inside-the-write-transaction, 04-06's action row and createHref seam, 04-08's share handler and one-fetch-implementation split
provides:
  - "`PATCH` / `DELETE /v1/feed/posts/{postId}` behind `feed.post.manage`, with the author and live-row predicates in the statement"
  - "`updatePost` / `softDeletePost`, and the `post.edited` / `post.deleted` domain events"
  - "`ComposerForm` — one form component serving `/criar` and `/post/[postId]/editar`"
  - "`PostMenu` (author/admin and member variants) and `ComposeFab`, both in `@tria/module-feed/ui`"
  - "`lib/feed-write.ts` — the post-write result vocabulary and refusal mapping shared by both action files"
affects: [05-communities, 06-events, 08-moderation]

actuals:
  tokens: 44885
  tasks: 3
  commits: 3
  plan_head_before: 865b2f3bae1b911c85b3a8597d7f72fe62d07ef5

tech-stack:
  added: []
  patterns:
    - "Permission on the route, authorship in the statement: `requirePermission` says the role may manage posts, `author_user_id = ctx.userId` says this one is yours. V1 needs both."
    - "A second overlay hosted like the comment sheet: ONE `PostMenu` per column, opened by id, never one per card."
    - "Shared non-action helpers for server actions live in a plain module (`lib/feed-write.ts`) because a `'use server'` file may export only async functions."

key-files:
  created:
    - "apps/web/app/(app)/criar/ComposerForm.tsx"
    - "apps/web/app/(app)/criar/page.tsx"
    - "apps/web/app/(app)/criar/actions.ts"
    - "apps/web/app/(app)/post/[postId]/editar/page.tsx"
    - "apps/web/lib/feed-write.ts"
    - "apps/web/components/feed/useDeletePost.ts"
    - "packages/modules/feed/ui/PostMenu.tsx"
    - "packages/modules/feed/ui/ComposeFab.tsx"
    - "apps/api/tests/integration/feed-edit-delete.test.ts"
    - "apps/web/e2e/feed-composer.spec.ts"
  modified:
    - "packages/modules/feed/contracts/index.ts"
    - "packages/modules/feed/server/service.ts"
    - "packages/modules/feed/server/routes.ts"
    - "packages/modules/feed/ui/FeedList.tsx"
    - "packages/modules/feed/ui/PostCard.tsx"
    - "apps/web/lib/feed.ts"
    - "apps/web/lib/feed-view.tsx"
    - "apps/web/lib/registry.tsx"
    - "apps/web/app/(app)/inicio/feed-actions.ts"
    - "apps/web/messages/pt-BR/feed.json"
    - "packages/ui/src/primitives/PageHeader.tsx"
    - "apps/web/components/media/useSignedUpload.ts"
    - "scripts/check-static-routes.sh"

key-decisions:
  - "The media triple on `PATCH` is a REPLACEMENT, not a merge: present any of `imageAssetIds`/`videoAssetId`/`attachmentAssetIds` and the post's whole media set becomes what the three describe. A per-key merge would need a second vocabulary for 'remove this one', and the composer already holds the complete post on screen."
  - "The publishable rule is judged against the RESULTING row in the service, not only against the body: an edit that clears the caption is refused exactly when the post keeps no media."
  - "`linkUrl: ''` is the create path's 'no preview, thank you' — `new URL('')` throws inside the SSRF guard, so removing the prévia needs no second field; the edit path uses `linkPreviewId: null`."
  - "`edited_at` advances on a re-save of byte-identical content. 'Edited' means 'the author saved this again', not 'the bytes differ'; a diff gate would need a canonical comparison of caption, media order and preview and would lie after a reorder-and-back."
  - "Image reorder ships as two 44×44 move controls per tile rather than the mockup's drag grip: a pointer-only drag is unreachable by keyboard and unassertable in a spec, and the effect on the asset-id array is identical."
  - "`/criar` refuses a caller without `feed.post.create` with a redirect to `/inicio`; `/post/[id]/editar` refuses a non-author with `notFound()`, collapsing into the same one screen every other miss uses (UI-D-16)."

patterns-established:
  - "Post-write refusal mapping (`postWriteIssue`, `asMediaIssue`, `attemptPostWrite`) lives in `apps/web/lib/feed-write.ts`; both action files import it, neither re-implements it."
  - "A module overlay takes its data from the card view (`canManage`, `editHref`, `shareUrl`) and its outcome handler from the host, so the module decides no route, no copy and no authorisation."
  - "e2e specs read their expected strings from `apps/web/messages/pt-BR/feed.json` rather than inlining pt-BR."

requirements-completed: [FEED-01, FEED-03, UI-02]

coverage:
  - id: D1
    description: "An admin edits their own post; `edited_at` is set on any persisted change, media-only edits and byte-identical re-saves included (UI-D-15)."
    requirement: FEED-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-edit-delete.test.ts#UI-D-15 — the edit marker follows ANY persisted change"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#edits an own post and the card gains the edited marker"
        status: pass
    human_judgment: false
  - id: D2
    description: "A second `admin_tenant` holding `feed.post.manage` cannot edit or delete a colleague's post; a member gets 403 and a foreign-tenant admin gets 404."
    requirement: FEED-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-edit-delete.test.ts#T-04-54 — holding the permission is not owning the post"
        status: pass
    human_judgment: false
  - id: D3
    description: "A soft delete removes the post from every read and deletes nothing: the row keeps its stamp, its media rows, its comments and its assets."
    requirement: FEED-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-edit-delete.test.ts#FEED-03 — the soft delete removes the post and deletes nothing"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#deletes an own post behind the confirmation and the card leaves the feed"
        status: pass
    human_judgment: false
  - id: D4
    description: "A delete wins a concurrent edit, and a repeat delete is a no-op that moves no stamp and emits no second event."
    requirement: FEED-03
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-edit-delete.test.ts#T-04-57 — delete wins a concurrent edit"
        status: pass
      - kind: integration
        ref: "apps/api/tests/integration/feed-edit-delete.test.ts#answers the same bare 404 on a REPEAT delete, and the stamp does not move"
        status: pass
    human_judgment: false
  - id: D5
    description: "An admin publishes a two-image post from a phone through the full-screen composer, with the video picker disabled and the D-53 helper line on screen."
    requirement: FEED-01
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#two images through the real file chooser, then the card on the home route"
        status: pass
    human_judgment: false
  - id: D6
    description: "A post with neither caption nor media cannot be created or saved: the submit is disabled and the API refuses the body with `empty_post`, both reading `createPostSchema`."
    requirement: FEED-01
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/feed-edit-delete.test.ts#FEED-01 / empty — a post with neither caption nor media"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#two images through the real file chooser (the disabled-submit assertion)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The create affordance is gated on the composed `feed.post.create` permission: the FAB on a phone for an admin, nothing for a member, and the header-row button on desktop (UI-D-17)."
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#UI-D-17 / E15 — the create control is a permission, not a role"
        status: pass
    human_judgment: false
  - id: D8
    description: "The overflow menu opens the shared bottom sheet with the author/admin variant (edit, copy link, destructive delete) or the member variant (copy link alone), and its confirmation quotes no member content."
    requirement: UI-02
    verification:
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#edits an own post and the card gains the edited marker (menu row assertions)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/feed-composer.spec.ts#deletes an own post behind the confirmation (the dialog quotes nothing)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The composer, the edit screen, the FAB and the overflow menu look like the approved prototype language in light and dark under an arbitrary tenant brand (UI-02, D-33)."
    requirement: UI-02
    verification: []
    human_judgment: true
    rationale: "Sketch 002 is still `status: pending` / `approved: false`. The screens were coded against the drawing on the orchestrator's explicit instruction, with the D-33 approval carried to phase UAT. Visual fidelity across themes and brands is a judgment no assertion in this plan makes."
  - id: D10
    description: "The Phase 3 upload machine behaves inside the composer for the paths the local stack cannot exercise: a real phone photo (HEIC), a >6 MiB TUS transfer, and a real vendor-hosted video upload."
    verification: []
    human_judgment: true
    rationale: "The composer writes no upload code and reuses `useSignedUpload` unchanged, but the HEIC decode branch depends on the device's own decoder and the video path runs against `VIDEO_PROVIDER=fake` locally (WINDOWS #12). Real-device confirmation is a UAT item, as it was in Phase 3."

duration: 46 min
completed: 2026-09-23
status: complete
---

# Phase 04 Plan 09: The Admin's Half — Composer, Edit and Soft Delete Summary

**The prototype-less half of the feed: one `ComposerForm` serving `/criar` and `/post/[id]/editar` on top of Phase 3's upload machine with zero new upload code, plus `PATCH`/`DELETE` on a post whose authorisation is a permission on the route AND an author predicate in the statement.**

## Performance

- **Duration:** 46 min
- **Started:** 2026-09-23T02:58:00Z
- **Completed:** 2026-09-23T03:44:00Z
- **Tasks:** 3 of 3
- **Files modified:** 34 (28 source/test, 6 planning)

## Accomplishments

- **The two write routes exist and are guarded twice.** `PATCH`/`DELETE /v1/feed/posts/{postId}` carry `requirePermission('feed.post.manage')`, and `updatePost`/`softDeletePost` additionally carry `author_user_id = ctx.userId` **and** `deleted_at is null` inside their own `where` clause. The first stops a member; the second stops a *second admin of the same tenant*; the third makes a delete deterministically win a concurrent edit. All three are integration-pinned, with the author's own success as the positive control in the same test.
- **A soft delete deletes nothing.** The row keeps its `deleted_at` stamp and its `feed_post_media` rows, its comments and its `media_assets` all survive — asserted by counting them after the delete — so Phase 8's moderation and the Phase 3 sweeper both still have something to see.
- **One form, two routes.** `ComposerForm` renders `/criar` and, pre-filled, `/post/[postId]/editar`; both build as `ƒ` and are now pinned in `scripts/check-static-routes.sh`. Its entire byte path is `useSignedUpload` + `FileDropZone` — the file contains no upload URL, no TUS session and no Storage request, only asset ids.
- **WINDOWS #18 is closed.** `lib/registry.tsx` now passes `createHref="/criar"`, so the admin empty-state CTA renders its button instead of its copy alone; `feed.spec.ts`'s UI-D-20 case was inverted from "the CTA is absent until `/criar` exists" to asserting it is present and points at the composer.
- **The inert `onMore` seam is closed.** `PostMenu` opens the shipped `BottomSheet` with the author/admin variant (edit, copy link, destructive delete) or the member variant (copy link alone), driven by the API's own `canManage`. "Copiar link" calls the SAME `useSharePost` handler the action row's `Send` glyph does, on the same `post.shareUrl` — the two entry points cannot resolve to different links.

## Task Commits

1. **Task 1: PATCH and DELETE on a post — the edit marker, the predicates, the menu** — `c61cd34` (feat)
2. **Task 2: The composer — one form, two routes, the Phase 3 upload layer** — `2879412` (feat)
3. **Task 3: Prove the admin paths — integration matrix and the mobile composer e2e** — `42bbd58` (test)

## Files Created/Modified

- `packages/modules/feed/contracts/index.ts` — `updatePostSchema` (media triple as a replacement, `videoAssetId` nullable, at-least-one-key rule), `PostEdited`/`PostDeleted` on the event map
- `packages/modules/feed/server/service.ts` — `updatePost`, `softDeletePost`, and five helpers (`assertMediaShape`, `wantedMediaFor`, `validateAssets`, `insertPostMedia`, `resolveLinkCandidate`/`upsertLinkPreview`) extracted from `createPost` so the edit path validates assets and unfurls through the SAME code
- `packages/modules/feed/server/routes.ts` — the two routes, their OpenAPI refusal documentation, and `postIdParam` hoisted so all post-scoped routes share it
- `packages/modules/feed/ui/PostMenu.tsx` — the overflow menu, presentational, no language, no route table
- `packages/modules/feed/ui/ComposeFab.tsx` — the mobile floating control: a LINK (the composer is a route), `md:hidden`, visibility from a boolean prop
- `packages/modules/feed/ui/FeedList.tsx` — hosts ONE menu for the column (the `CommentSheet` pattern) and the FAB, suppressed while the empty-state CTA is on screen
- `packages/modules/feed/ui/PostCard.tsx` — `PostCardView` gains `canManage` and `editHref`
- `apps/web/app/(app)/criar/ComposerForm.tsx` — the form: sticky header with the `X`, auto-focused caption with its counter, two mutually exclusive pickers (tap rows on mobile, drop zones on desktop), the wrapping thumbnail grid with remove + reorder, the inert link row, attachment rows, the discard confirmation
- `apps/web/app/(app)/criar/{page,actions}.tsx|ts` and `apps/web/app/(app)/post/[postId]/editar/page.tsx` — the two routes
- `apps/web/lib/feed-write.ts` — the shared result vocabulary and refusal mapping
- `apps/web/components/feed/useDeletePost.ts` — the delete's toast branch table; rejects on refusal so the card never leaves the column on a failure
- `apps/web/messages/pt-BR/feed.json` — every composer, menu, confirmation and toast string from the Copywriting Contract; the Phase 3 upload copy is NOT duplicated
- `packages/ui/src/primitives/PageHeader.tsx` — optional `backIcon` (default unchanged)
- `apps/web/components/media/useSignedUpload.ts` — `formatMediaLimit` exported; `successKey: null` suppresses the per-file toast
- `apps/api/tests/integration/feed-edit-delete.test.ts`, `apps/web/e2e/feed-composer.spec.ts`, `apps/web/e2e/fixtures/post-{a,b}.jpg`

## Decisions Made

See `key-decisions` in the frontmatter. The two worth reading in full:

- **The media triple is a replacement.** `updatePostSchema` treats the three media keys as "the post's whole media set becomes this"; omit all three and the media is untouched. The composer always holds the complete post on screen, so it sends what the post should BE — which is also what makes `media_kind` recomputable from the body alone. The rows are deleted BEFORE the parent's `media_kind` moves, because `feed_post_media_kind_fk` points at `(id, media_kind)` and would refuse the update while a row still named the old pair.
- **`edited_at` advances on an identical re-save.** A diff gate would need a canonical comparison of caption, media order and preview, and would tell the reader nothing happened when the author reordered two photos back and forth.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] A `'use server'` module cannot re-export another one**

- **Found during:** Task 2
- **Issue:** The plan asked `criar/actions.ts` to re-export `updatePostAction`/`deletePostAction`. Turbopack replaces a `'use server'` module's export list with the action registry it builds and drops `export { x } from '…'` on the way; `pnpm --filter @tria/web build` failed with `The export updatePostAction was not found in module … The module has no exports at all`.
- **Fix:** `ComposerForm` imports `updatePostAction` directly from `inicio/feed-actions.ts` — the SAME function the card's overflow menu calls, which is the property the re-export was there to protect. The reason is written into `criar/actions.ts` so nobody re-adds the line.
- **Files modified:** `apps/web/app/(app)/criar/actions.ts`, `apps/web/app/(app)/criar/ComposerForm.tsx`
- **Verification:** `pnpm --filter @tria/web build` exits 0
- **Committed in:** `2879412`

**2. [Rule 3 - Blocker] `PageHeader` could only draw a back chevron**

- **Found during:** Task 2
- **Issue:** UI-SPEC §Composer contract specifies a leading 44×44 `X` "Fechar"; the shipped primitive hard-coded `ChevronLeft`.
- **Fix:** Additive optional `backIcon` prop, defaulting to `ChevronLeft` — every existing caller is byte-identical.
- **Files modified:** `packages/ui/src/primitives/PageHeader.tsx`
- **Verification:** `pnpm --filter @tria/ui typecheck lint`, and every route using `PageHeader` still builds
- **Committed in:** `2879412`

**3. [Rule 2 - Missing critical] A toast per picked photo**

- **Found during:** Task 2
- **Issue:** `useSignedUpload` always raised the Phase 3 success toast; the composer picks several photos in one chooser answer, which would stack three notifications over a form still being filled in — and none of the `media.toasts.*` keys says the right thing for a composer.
- **Fix:** `successKey` widened to `string | null`; `null` suppresses the toast. The thumbnail appearing in the grid is the confirmation. Every single-upload screen is unchanged.
- **Files modified:** `apps/web/components/media/useSignedUpload.ts`
- **Verification:** `media-upload.spec.ts` and `media-video.spec.ts` still assert their toasts
- **Committed in:** `2879412`

**4. [Rule 2 - Missing critical] A crafted `linkPreviewId` from another tenant**

- **Found during:** Task 1
- **Issue:** `updatePost` accepts a `linkPreviewId`. Postgres runs referential-integrity checks as the referenced table's owner, bypassing RLS — so the foreign key alone would NOT have stopped a caller stamping another tenant's preview row onto their own post.
- **Fix:** a uuid `linkPreviewId` is re-read in the TENANT LANE before it is stamped; invisible means `400 VALIDATION_FAILED`. (The composer only ever sends `null`, so the branch exists for a crafted caller.)
- **Files modified:** `packages/modules/feed/server/service.ts`
- **Verification:** covered by the tenant-lane posture the rest of the suite asserts; the branch is documented at the call site
- **Committed in:** `c61cd34`

**5. [Rule 3 - Blocker] `feed.spec.ts` pinned the ABSENCE of the empty-state CTA**

- **Found during:** Task 3
- **Issue:** 04-08 wrote `await expect(region.getByRole('link', { name: F.empty.cta })).toHaveCount(0)` with the comment "deliberately absent until `/criar` exists (04-09)". Supplying `createHref` made that assertion fail by design.
- **Fix:** inverted — the CTA must now be visible and carry `href="/criar"`, with `.first()` because at the desktop breakpoint the same label also sits in the widget's header row.
- **Files modified:** `apps/web/e2e/feed.spec.ts`
- **Verification:** `playwright test feed.spec.ts --grep "UI-D-20"` passes on both projects
- **Committed in:** `42bbd58`

### Deliberate departures from the plan's letter

**6. Reorder is two move controls, not a drag grip.** The mockup draws a drag handle on each thumbnail. Shipped instead: 44×44 `ChevronLeft`/`ChevronRight` controls, hidden at the ends. A pointer-only drag is unreachable by keyboard and unassertable in a spec; the plan's own wording is "a reorder affordance whose only effect is to reorder the asset-id array the API receives", which this satisfies exactly. Recorded as WINDOWS #29.

**7. `revalidatePath` lives in the actions, not in `attemptPostWrite`.** Which paths a write invalidates is a decision belonging to the action that owns the request — `deletePostAction` already made it inline — so burying it in the shared helper would have hidden it from the two call sites a reviewer reads.

---

**Total deviations:** 5 auto-fixed (3 × Rule 3 blockers, 2 × Rule 2 missing-critical) + 2 documented departures.
**Impact on plan:** No scope creep. Three of the five were forced by the toolchain or by an assertion a prior plan deliberately left for this one; the two Rule 2 fixes close a cross-tenant write path and a UX defect the plan's own truths imply.

## Known Stubs

None introduced. Two pre-existing limitations touched by this plan are recorded in `.planning/WINDOWS.md`:

| # | Where | What |
|---|-------|------|
| 27 | `apps/web/app/(app)/criar/ComposerForm.tsx` | Publishing within ~2 s of the last photo upload can answer `asset_not_usable`: variant derivation runs in the WORKER and `createPost` requires an image to be `ready` (04-04's rule — a video may publish mid-transcode, an image may not). The composer surfaces the refusal with its own copy; it does not wait for readiness. Closing it means either polling readiness in the composer or relaxing the image status rule, which is a 04-04 contract change and therefore a decision, not a fix. |
| 28 | `.planning/sketches/002-phase-04-designed-screens/README.md` | The D-33 gate for these exact screens is still `status: pending` / `approved: false`. Coded against the drawing on the orchestrator's explicit instruction, approval carried to phase UAT. |
| 29 | `apps/web/app/(app)/criar/ComposerForm.tsx` | The reorder affordance departs from the mockup's drag grip (see departure 6). |

WINDOWS **#18** (the `createHref` empty-state CTA stub) is now **fixed**.

## Issues Encountered

- **The `feed-composer` e2e first failed waiting for image readiness.** The two uploaded photos sat at `processing` for longer than 30 s — not because the worker was broken, but because pg-boss is FIFO with a ~2 s poll and a backlog of ~20 undrained `kernel.media-derive-variants` jobs left behind by earlier media specs stood in front of them. The fixture's wait now reports the observed statuses in its failure message and is bounded at 120 s; with a drained queue the whole spec runs in ~18 s, well inside the T2 ceiling. The stale backlog itself is a pre-existing artefact of every media spec stopping its worker at teardown.
- **The delete confirmation's locator matched two dialogs.** The `BottomSheet` behind the `ConfirmDialog` is also `role="dialog"`, so a text filter resolved both. Located by accessible NAME instead.
- **`feed.spec.ts` remains intermittently flaky** — a different test fails on each full-file run (the like toggle one run, the empty-state card another) and every one of them passes in isolation. This is the pre-existing flake already logged in `.planning/phases/04-feed/deferred-items.md` ("server-action round trips against the local `next dev`"); the failing cases include ones this plan never touched, and the two cases it does touch pass in isolation on both projects.

## Threat Flags

None. Every surface this plan adds is inside the phase's existing threat register: T-04-54/55 (the permission + author predicate), T-04-56 (the shared asset validation), T-04-57 (the live-row predicate), T-04-58 (the non-interpolating confirmation), T-04-59 (no file byte through the API). The one surface the register did not name — a crafted `linkPreviewId` surviving RLS through a referential check — is closed in `updatePost` and written up as deviation 4.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The feed's requirement set is complete apart from 04-10's cleanup (deleting `@tria/module-example` and its table, D-19).
- Phase 8's moderation extends exactly what is here: `softDeletePost` keeps the row and every child row, `canManage` already rides the wire, and widening moderation means granting a permission and relaxing one predicate deliberately — not discovering the route was already open.
- Phase 7 has two new events to build notification rows from (`post.edited`, `post.deleted`), both over-carrying `authorUserId` alongside `actorUserId` so a moderator delete needs no payload change.
- **Carried to phase UAT:** the D-33 approval of sketch 002, the real-device upload paths (HEIC, TUS, a real vendor video), and the image-readiness window in WINDOWS #27.

## Self-Check: PASSED

- All ten `key-files.created` paths exist on disk.
- `git log --oneline --all --grep="04-09"` returns the three task commits (`c61cd34`, `2879412`, `42bbd58`).
- Re-ran every task's `<acceptance_criteria>`: all pass. One is a false positive as written — `grep -rcE "fetch\(.*storage|createSignedUploadUrl|tus" ComposerForm.tsx` prints 5 because `tus` is a substring of `status`/`MediaStatus`; the word-boundary form `grep -cE "createSignedUploadUrl|tus-js-client|\btus\b|uploadBytes|fetch\("` prints **0**, which is the criterion's actual intent (no upload code written here).
- Re-ran the plan-level `<verification>`: `turbo typecheck lint` (17/17), `turbo test` (7/7), `check-ui-literals`, `check-static-routes`, `boundaries`, `pnpm --filter @tria/web build`, the integration file (11 passed) and the Playwright spec (5 passed, 0 skipped).

---
*Phase: 04-feed*
*Completed: 2026-09-23*
