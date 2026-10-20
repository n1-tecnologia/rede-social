---
phase: 09-rede-social-follow-member-posts-and-explorar
plan: 09
subsystem: web
tags: [web, composer, member-variant, limits, moderator-removal, post-menu, D-472, D-473, D-474, D-475, UI-D-495, UI-D-497, UI-D-504]

requires:
  - phase: 09-06
    provides: "FEED_MEMBER_ISSUES in details.member, the member media policy at the broker, socialSettingsSchema and SOCIAL_SETTINGS_DEFAULTS"
  - phase: 09-07
    provides: "DELETE /v1/feed/posts/{id} with the moderator branch and the post's removal: 'moderation' statement"
  - phase: 09-08
    provides: "Explorar in the web, composerEntryFor, the composer FAB in Explorar, postAdminLabel"
  - phase: 09-12
    provides: "the platform panel that writes the tenant's member media limits; @rede-social/module-social already a dependency of apps/web"
provides:
  - "socialMediaLimits(bootstrap): the tolerant parse of bootstrap.modules['social'].settings (defaults on a malformed blob, never throws, no fetch)"
  - "ComposerForm memberLimits: the member variant of /criar and of the edit screen (no attachments section, no destination row, audience line, member placeholder, tenant photo and video limits)"
  - "isMemberComposer(permissions): the page/edit variant follows social.participate without content.publish, the same pair composerEntryFor reads"
  - "a member's create lands on /inicio?aba=explorar with 'Publicação criada.'; the administrator's landing is unchanged"
  - "useSignedUpload options maxBytes and tooLargeMessage: the pick-time cap (member variant only) and the same sentence for the broker's 413"
  - "asMemberIssue and the FeedMemberIssue members of PostWriteResult['code']: details.member read through the closed set"
  - "PostMenu moderator row 'Remover publicação' (from the API's removal), its own ConfirmDialog, the member wording of the author's delete, onDelete(postId, variant)"
  - "useDeletePost toasts 'Publicação removida.' for the removal variant; PostCardView carries audience and removal only when the API sent them"
  - "e2e/social.spec.ts walks for the publish tracer, the tenant limits, the video states, the stale-tab refusal, the moderator removal and the delete wording"
affects: [09-10, 09-11, 09-13]

actuals:
  tokens: 32620
  tasks: 3
  commits: 8
plan_head_before: f39afc9886c421a0847b9ad3985995066aac0aab

tech-stack:
  added: []
  patterns:
    - "One prop marks a form variant (memberLimits) and every difference is conditional on it, so the original variant is byte-identical and its tests stay as they were"
    - "A control the API forbids is absent from the DOM in the variant that may not use it, never disabled"
    - "Browser copy of server limits is parsed by the SAME tolerant schema the API uses, from data the page already holds"
    - "A menu decides its rows and wording from data stamped by the API (removal, audience), never from a role"
    - "One delete route, one action, one hook; the variant only picks the confirmation and the toast sentence"

key-files:
  created:
    - apps/web/lib/social-settings.ts
    - apps/web/lib/social-settings.test.ts
    - apps/web/lib/feed-write.test.ts
    - apps/web/components/media/useSignedUpload.test.tsx
    - apps/web/components/feed/useDeletePost.test.tsx
    - packages/modules/feed/tests/post-menu.test.tsx
  modified:
    - "apps/web/app/(app)/criar/ComposerForm.tsx"
    - "apps/web/app/(app)/criar/ComposerForm.test.tsx"
    - "apps/web/app/(app)/criar/page.tsx"
    - "apps/web/app/(app)/post/[postId]/editar/page.tsx"
    - "apps/web/app/(app)/post/[postId]/page.tsx"
    - "apps/web/app/(app)/comunidades/[communityId]/page.tsx"
    - apps/web/lib/feed-write.ts
    - apps/web/lib/feed-view.tsx
    - apps/web/lib/feed-view.test.ts
    - apps/web/lib/registry.tsx
    - apps/web/components/media/useSignedUpload.ts
    - apps/web/components/feed/useDeletePost.ts
    - apps/web/components/feed/FeedSurface.tsx
    - apps/web/components/feed/PostDetail.tsx
    - apps/web/components/feed/PostDetail.test.tsx
    - apps/web/messages/pt-BR/feed.json
    - apps/web/i18n/messages.test.ts
    - apps/web/e2e/social.spec.ts
    - apps/web/e2e/social-admin.ts
    - packages/modules/feed/ui/PostMenu.tsx
    - packages/modules/feed/ui/PostCard.tsx
    - packages/modules/feed/ui/FeedList.tsx
    - packages/modules/feed/ui/index.ts

key-decisions:
  - "Planning decision 1 (one form, one prop marks the variant): memberLimits is absent for the administrator and present for a member; every difference is conditional on it, and the existing administrator cases in ComposerForm.test.tsx pass unchanged"
  - "Planning decision 2 (limits come from the bootstrap): the page passes socialMediaLimits(bootstrap) parsed numbers; the form never reads a blob and nothing is fetched"
  - "Planning decision 3 (the pick-time cap is a hook option, not a fork): useSignedUpload gains maxBytes plus tooLargeMessage; unset it behaves exactly as before, and the API's 413 stays the authority"
  - "Planning decision 4 (the moderator row reuses the delete route): the web adds a dialog variant and a toast sentence; deletePostAction is untouched and onDelete carries a 'removal' variant"
  - "Planning decision 5 (redirect after publish): a member's create replaces the composer with /inicio?aba=explorar (D-472); the administrator's target stays the new post page"
  - "Planning decision 6 (sketch gate): sketch 012 is approved (provisionally, by the product owner, written by the orchestrator on Igor's instruction); the precondition passed"
  - "tooLargeMessage is a caller-supplied function rather than a catalog key: the hook reads the media namespace and the member sentence lives in feed.errors, so the caller (which owns that namespace) builds the sentence"
  - "In the member variant the line 'Você poderá publicar quando o vídeo terminar de processar.' replaces the administrator's wait line under the preview instead of adding a second one beside it; the Phase 3 processando card still draws"
  - "The author's member-post delete swaps only the body (feed.deleteMember.body); the title, confirm and cancel stay 04's feed.delete.* strings, so no dead feed.deleteMember.{title,confirm,cancel} keys were added"

requirements-completed: [SOCIAL-03, SOCIAL-05, SOCIAL-07, EXPL-03, EXPL-05]

coverage:
  - id: D1
    description: "Tracer: Helena opens the composer from the Explorar entry, sees the audience line and no PDF or community row, publishes and lands on /inicio?aba=explorar with her card on top and the 'Publicação criada.' toast; the stored post is visibility 'followers'; the lab administrator keeps the full composer and its landing"
    requirement: EXPL-05
    verification:
      - kind: unit
        ref: "apps/web/app/(app)/criar/ComposerForm.test.tsx#M1-M7 (variant rows, body shape, landing, empty Publicar)"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/social.spec.ts#09-09 the member composer: a member publishes from Explorar and lands on top of it (2 cases, mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The member composer shows the tenant's limits: photos helper 'Até 4 fotos de 1 MB cada.', a 2 MB photo refused at pick time with 'Cada foto pode ter até 1 MB.', the video row and helper only where video is on (absent from the DOM otherwise), the count cap at the tenant's allowance"
    requirement: SOCIAL-05
    verification:
      - kind: unit
        ref: "ComposerForm.test.tsx#L1-L5; useSignedUpload.test.tsx#H1-H6; social-settings.test.ts"
        status: pass
      - kind: e2e
        ref: "social.spec.ts#09-09 the member composer under the tenant limits (video off) (mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A member video waits for ready (processing card, its own line, Publicar off) then publishes into Explorar; a video refused for duration shows the failed card, the line in the tenant's seconds and one Remover vídeo; a stale tab offering a video the tenant switched off gets the catalog sentence, never a server string"
    requirement: SOCIAL-03
    verification:
      - kind: unit
        ref: "ComposerForm.test.tsx#L6-L10; feed-write.test.ts (member codes, unknown string is null)"
        status: pass
      - kind: e2e
        ref: "social.spec.ts#09-09 ... (video on): ready publish, duration refusal, stale-tab video off (mobile project; desktop skipped by design)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The moderator removes a member post from the card menu (Copiar link and the danger Remover row, no edit row), confirms in the documented dialog, the card leaves the list with 'Publicação removida.', the author is not notified; a failed removal keeps the card with the generic error toast; the author of a member post sees the member delete wording and an administrator post keeps 04's"
    requirement: SOCIAL-07
    verification:
      - kind: unit
        ref: "packages/modules/feed/tests/post-menu.test.tsx#P1-P6; useDeletePost.test.tsx#D1-D4; feed-view.test.ts (audience and removal carry)"
        status: pass
      - kind: e2e
        ref: "social.spec.ts#09-09 the moderator removal and the member wording of the author delete (3 cases, mobile and desktop)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The member variant and the moderator row read as the approved sketch 012 under any tenant brand at 320 and 390px (audience line beside the counter, spacing, danger row)"
    verification: []
    human_judgment: true
    rationale: "Visual fidelity to a provisionally approved sketch is a design judgment; the designer review is a follow-up (D-33). Not asserted by any test"

duration: 25 min
completed: 2026-10-20
status: complete
---

# Phase 09 Plan 09: The member composer and the moderator's removal Summary

**A member publishes from Explorar through a smaller composer bound by the tenant's own photo and video limits (no PDF, no community, controls absent from the DOM, not disabled) and lands on top of Explorar, and an administrator removes a member post from the card's "…" menu with a danger dialog and a "Publicação removida." toast, with no notice to the author.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-10-20T01:30:52Z
- **Completed:** 2026-10-20T01:56Z
- **Tasks:** 3 (one tracer, two auto), all TDD
- **Files:** 29 changed (6 created), 1965 insertions, 220 deletions

## Accomplishments

- **Tracer (EXPL-05, D-472, UI-D-495, UI-D-504).** `criar/page.tsx` and the edit page choose the member form from `isMemberComposer(permissions)` (`social.participate` without `content.publish`): no community fetch, `?comunidade=` ignored, `memberLimits={socialMediaLimits(bootstrap)}`. `ComposerForm` renders no attachments section and no destination row, the member placeholder, the audience line with the 14px `Users` glyph, and sends no `communityId` or attachment ids. The create replaces the composer with `/inicio?aba=explorar`. Verified end to end on both phone and desktop projects, including the stored `visibility = 'followers'`.
- **Limits and states (D-474, UI-D-504 d-h).** Photos helper and count cap from the tenant; the video row, helper, file input and desktop drop zone render only when the tenant allows video. `useSignedUpload` gained `maxBytes` and `tooLargeMessage`: an over-cap photo is refused at pick time (a phone photo is re-encoded first and judged after), the broker's `too_large` envelope maps to the same sentence. A processing member video shows its own wait line; a duration refusal shows the failed card, the line in the tenant's seconds and the single "Remover vídeo". `asMemberIssue` reads `details.member`; `member_video_off` maps to the catalog sentence and the other two codes to the generic publish error.
- **Moderator removal and delete wording (D-475, SOCIAL-07, UI-D-495, UI-D-497).** `PostMenu` draws "Remover publicação" (danger) from the API's `removal: 'moderation'` and only where the author's own controls are not, opens its own `ConfirmDialog`, and uses `deleteBodyMember` when the author deletes a member post. `onDelete(postId, 'removal')` reuses the existing route and action; `useDeletePost` picks the toast sentence by the variant. The card leaves the list only on success, the next card takes focus, a failure keeps the card with the generic error toast. The same menu serves `/post/[postId]` and the community page.

## Task Commits

1. **Task 1 (tracer)** - `ccac7b78` test (RED, helper stub), `16185a7f` feat (helper), `f17f9817` test (RED, variant), `999190b9` feat (page, form, landing, e2e)
2. **Task 2** - `8af744c5` test (RED), `fc1977cb` feat (limits, hook cap, refusal codes, e2e)
3. **Task 3** - `ba0ae30e` test (RED), `52e3dfe6` feat (menu, host wiring, e2e)

## TDD Gate Compliance

Plan type is `execute` with `tdd="true"` tasks, so each task has a `test(09-09)` commit before its `feat(09-09)` commit. The RED runs were real Vitest failures on the planned behavior:

- `socialMediaLimits` (inert stub, so the import resolved): 5 of 5 cases failed on assertions.
- Variant composer: M1, M4 and M7 failed on assertions; M2, M3, M5 and M6 passed already and are regression guards for the administrator's composer.
- Task 2: `feed-write` member codes (3 failed on assertions, and `asMemberIssue` did not exist so its case threw instead of asserting), upload hook (H1, H4, H5, H6 failed; H2, H3 passed as guards), composer limits (8 failed).
- Task 3: `post-menu` P1, P2, P4 failed; `feed-view` audience and removal carry (2) failed; `useDeletePost` D2 failed; the catalog keys case failed.

`gsd-tools check tdd-red-evidence` was not run: workflow `tdd_mode` is off and the plan is not `type: tdd`, and Vitest emits no TAP. No evidence record was fabricated and no counts are invented here.

## Verification

- `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 37 of 37 tasks successful (this includes the web build that typecheck depends on; `apps/web/.next` removed afterwards, disk back to 8.0 GB free).
- `pnpm --filter @rede-social/module-feed test`: 24 files, 313 tests. Web subsets for the plan (`lib/social-settings`, `criar/ComposerForm`, `lib/feed-write`, `components/media`, `components/feed`, `lib/feed-view`, `i18n`, `scripts/e2e-affected.test.ts`) green. `pnpm --filter @rede-social/web lint`, `module-feed lint` and `bash scripts/check-ui-literals.sh` clean (the one Biome info in `AlertsBell.test.tsx` is pre-existing).
- Playwright (local stack, `VIDEO_PROVIDER=fake`, two projects): `social.spec.ts` + `media-upload.spec.ts` 51 passed, 3 skipped (the three video-on cases are phone-only by design); `social.spec.ts` + `moderation.spec.ts` + `feed-composer.spec.ts` + `feed.spec.ts` 93 passed, 11 skipped (pre-existing skips plus the same three).
- **`pnpm db:reset && pnpm db:seed` was NOT run** in any e2e verify command (no consent to reset in this run); the specs ran on the existing local database, which carries earlier plans' residue. Logged as WINDOWS #115 `unrun-verify`.
- The stale-tab case waits 32 s on purpose: the API caches a tenant's module settings for 30 s per instance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Files outside the plan's `files_modified`**
- **Found during:** Task 3 and Task 1
- **Issue:** The `removedLabel` toast copy has to reach `PostDetail` and `FeedSurface` from their hosts, and two e2e fixtures were needed.
- **Fix:** Added `removedLabel: tf('toasts.removed')` to `app/(app)/post/[postId]/page.tsx` and `app/(app)/comunidades/[communityId]/page.tsx` (both build the same `menu` binding) and to `PostDetail.test.tsx`; added `visibilityOfPostWithCaption`, `setSocialSettings`, `markVideoTooLong`, `deleteMediaAssetsOfTenant` and `notificationCountFor` to `e2e/social-admin.ts`. New unit-test files: `lib/feed-write.test.ts`, `components/media/useSignedUpload.test.tsx`, `components/feed/useDeletePost.test.tsx`.
- **Commits:** `999190b9`, `fc1977cb`, `52e3dfe6`

**2. [Rule 1 - Plan inconsistency] The administrator's landing is the post, not Início**
- **Found during:** Task 1
- **Issue:** The tracer truth says the admin's flow "lands on Início as before", but the shipped composer (2026-10-09) replaces the form with `/post/{id}`. The plan also says the administrator's target stays unchanged.
- **Fix:** The administrator's landing was left exactly as shipped (`/post/{id}`) and the e2e asserts that. Only the member's target changed.

**3. [Rule 2 - Accessibility] The card takes script focus**
- **Found during:** Task 3
- **Issue:** "moves focus to the next card" needs a focusable element; `PostCard`'s `role="article"` surface was not.
- **Fix:** `tabIndex={-1}` and `focus:outline-none` on the card, and `FeedList.deletePost` focuses the next (else previous) card after a confirmed removal. This also applies to the author's own delete.
- **Commit:** `52e3dfe6`

**4. [Rule 1 - Type] `PostCardView.audience` is `'tenant' | 'followers'`**
- **Issue:** the plan implied `'followers'` only, but `FeedPost.audience` is typed with both, and tsc rejected the narrower view type.
- **Fix:** widened the view type; the on-the-wire value is still only `'followers'`.

### Judgment calls worth a reviewer's eye

- The member's processing line replaces the administrator's wait line instead of being added next to it (two near-identical lines under one preview read as a bug). Change in `ComposerForm.tsx` if the designer wants both.
- `feed.deleteMember` has only `body`; the plan's artifact list names `{title, body, confirm, cancel}` but its own Task 3 action says title, confirm and cancel are 04's strings, and UI-SPEC's "Excluir publicação" confirm would differ from 04's "Excluir". No dead keys added.
- The audience line sits directly under the Textarea (as the plan and UI-SPEC say); the sketch note proposes it beside the counter. The designer review (D-33) can decide.
- Photo overflow on a multi-pick keeps the first photos that fit and states the tenant limit after the picks settle (each completed upload clears the media error, so it is set last).

### Design gate note (for /gsd-verify-work)

Sketch `012-phase-09-designed-screens` was approved provisionally by Igor in chat on 2026-10-19 (commit `48c79511`). The orchestrator wrote the README approval keys and the MANIFEST row on Igor's explicit instruction ("pode alterar voce mesmo"); this executor did not write or stage anything under `.planning/sketches/`. Designer review remains a follow-up.

**Total deviations:** 4 auto-fixed (1 blocking, 1 plan inconsistency, 1 accessibility, 1 type). **Impact:** none on scope; all additive and inside the member/moderator paths.

## Issues Encountered

- A first run of the stale-tab case failed in `afterAll`: `media_assets.tenant_id` has no cascade, so the throwaway tenant could not be deleted while its refused and unattached videos existed. Fixed with `deleteMediaAssetsOfTenant` (posts first, assets, then the tenant). The tenant that run left behind (`social-comp-b-mobilechromium-mvg0mlul`, its memberships and its two auth users) was removed by hand with SQL on the local stack; no other leftover.
- The permission guard blocked reading `.env.local` for a scratch cleanup script; the cleanup was done in SQL without env access.

## Known Stubs

None. Every new string reaches a rendered path; no placeholder data flows to the UI.

## Threat Flags

None. No new endpoint, auth path or schema; the plan's mitigations T-09-20 (controls absent from the DOM in the member variant, plus the API's independent refusals), T-09-18 (caps are UX only, 413 maps to catalog copy), T-09-35 (closed `FEED_MEMBER_ISSUES` set, no server text) and T-09-43 (row drawn only from the API's `removal`) are implemented and covered.

## Next Phase Readiness

Ready for 09-10 (Seguir button, counts, person row) and the remaining web plans. Carry-overs: designer review of sketch 012 (D-33); a clean `pnpm db:reset && pnpm db:seed` run of `social.spec.ts`, `media-upload.spec.ts` and `moderation.spec.ts` when Igor consents (WINDOWS #115); a real phone check of the member composer waits for the deploy (real-device rows are blocked locally).

## Self-Check: PASSED

- Created files exist: `apps/web/lib/social-settings.ts`, `apps/web/lib/social-settings.test.ts`, `apps/web/lib/feed-write.test.ts`, `apps/web/components/media/useSignedUpload.test.tsx`, `apps/web/components/feed/useDeletePost.test.tsx`, `packages/modules/feed/tests/post-menu.test.tsx` (verified below).
- Task commits `ccac7b78`, `16185a7f`, `f17f9817`, `999190b9`, `8af744c5`, `fc1977cb`, `ba0ae30e`, `52e3dfe6` exist; measured `commits: 8` from the persisted ledger (`plan_head_before` above).
- Acceptance greps: `socialMediaLimits` in the helper and the page; `memberLimits`, `placeholderMember` and `aba=explorar` in the form and the catalog; `asMemberIssue`, `memberVideoOff`, `maxBytes`; `removeTitle` in `PostMenu.tsx` and `registry.tsx`, `deleteBodyMember`, `Publicação removida` in `feed.json`: all pass.
