---
phase: 12-formulario-de-perfil-do-tenant
plan: 12
subsystem: web
tags: [profile-form, completion-screen, member-form, server-action, open-redirect, a11y, D-580, D-582, D-583, D-584, UI-D-581, UI-D-582, UI-D-583, UI-D-584, UI-D-586, UI-D-587, UI-D-588, UI-D-596, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 03 the contract (parseAnswer, missingIssue, member and answer schemas), plan 06 GET /v1/me/profile-form and PUT /v1/me/profile-form/answers (409 form_changed carries the fresh form, 400 answers_invalid is keyed by question id), plan 11 safeNextPath, PROFILE_FORM_PATH and the redirect to /completar-perfil"
provides:
  - "/completar-perfil: one scrollable card in the (auth) group for the first answer, the return after a form change and later edits; the mode comes from the API read, never from the URL"
  - "saveProfileFormAction: typed results (ok with the validated destination, invalid keyed errors, changed with the fresh form, failed); the destination has one source, safeNextPath"
  - "ProfileForm (client, with a preview mode that sends nothing), QuestionField with the exhaustive FIELD_BY_TYPE registry, and the thirteen controls"
  - "form-state: drafts, wire values, validateAll with the contract's parseAnswer, flags, the 409 merge and the message mapping, all pure"
  - "getMemberForm loader and the profileForm.member catalog (every word of the screen)"
affects: [12-13, 12-14, 12-17, 12-18, profile-form]

actuals:
  tokens: 38200
  tasks: 3
  commits: 4
plan_head_before: 080be4f90734e6c6599603f0da9d48eb5dda5aaa

tech-stack:
  added: []
  patterns:
    - "A server action returns a typed result and the validated destination; the client navigates only to what the action returned and never reads the raw next"
    - "Answers are held as drafts in component state and converted to the wire value by one pure function; the contract's parseAnswer is the single validator on the client and the server"
    - "A registry typed Record<ProfileFormType, FieldComponent> makes a new question type a compile error until it has a control"
    - "A 409 refresh merges by question id: surviving drafts are kept, removed ones dropped, newly required blank ones flagged, the fresh order wins"

key-files:
  created:
    - apps/web/app/(auth)/completar-perfil/page.tsx
    - apps/web/app/(auth)/completar-perfil/page.test.tsx
    - apps/web/app/(auth)/completar-perfil/loading.tsx
    - apps/web/app/(auth)/completar-perfil/actions.ts
    - apps/web/app/(auth)/completar-perfil/actions.test.ts
    - apps/web/components/profile-form/ProfileForm.tsx
    - apps/web/components/profile-form/ProfileForm.test.tsx
    - apps/web/components/profile-form/QuestionField.tsx
    - apps/web/components/profile-form/fields.tsx
    - apps/web/components/profile-form/fields.test.tsx
    - apps/web/lib/profile-form/form-state.ts
    - apps/web/lib/profile-form/form-state.test.ts
    - apps/web/lib/profile-form/member-form.ts
    - apps/web/lib/profile-form/test-fixtures.ts
    - apps/web/messages/pt-BR/profileForm.member.json
    - apps/web/i18n/profile-form-messages.test.ts
  modified:
    - apps/web/lib/safe-next-path.test.ts

key-decisions:
  - "The page heading and intro are rendered by ProfileForm (title and intro props from the page) so the h1 can take focus on mount; the page still decides the text by mode and owns Sair or Cancelar"
  - "On a failed Salvar the error summary (role alert, tabIndex -1) takes focus so the screen reader hears the count first, and its link 'Ir para o primeiro' moves focus to the first invalid control; one element cannot hold both foci"
  - "A required question shows the danger block only while it is still blank: answering it removes the flag at once"
  - "A failed read always shows Sair (the mode is unknown when the read fails), so a failing read never traps an edit-mode member either"
  - "A chosen 'Outro' with no text is the client-only issue other_required (the contract models Outro as an absent otherText and cannot produce it)"

patterns-established:
  - "The page of a route a gated member must reach reads getBootstrap through loadOrRedirect(getBootstrap, bootstrapRedirectPath) and a test pins that the module source never names the redirecting guard"
  - "Component tests mock the save action at its module path and the router, and drive the whole form through the real catalog"

requirements-completed: [PFORM-13, PFORM-14, PFORM-26]

coverage:
  - id: D1
    description: "The route reads the form, renders it pre-filled in the admin's order, and a staff role is sent to /inicio with no read of the form; the heading follows the API mode; the read failure and nothing-to-answer states keep a way out"
    requirement: "PFORM-13"
    verification:
      - kind: unit
        ref: "apps/web/app/(auth)/completar-perfil/page.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "The save action maps 400, 409 and other answers to typed results and takes the destination only from safeNextPath (//evil.com, encoded, scheme, over-length and the form itself fall back to /inicio, /perfil in edit mode); no answer reaches a log"
    requirement: "PFORM-13"
    verification:
      - kind: unit
        ref: "apps/web/app/(auth)/completar-perfil/actions.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The thirteen controls: name and role, 44px floor, required caption plus aria-required on every kind, Outro reveal and its required rule, Limpar resposta only on answered optional single answers, rating names and fill, pressed yes/no"
    requirement: "PFORM-14"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/fields.test.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every state of the screen: returning notice and flags only on the missing required ones, first mode flags nothing until Salvar fails, error summary with plural count and focus, keyed server errors, Salvando with every control locked, offline, save failure keeping answers, 409 keeping typed values and order, one and thirty questions, the empty state, answers never in storage or URL"
    requirement: "PFORM-14"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/ProfileForm.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/form-state.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "The catalog is pinned verbatim to the approved copy (42 strings, plurals, interpolations); the preview mode sends nothing; the accessibility floor and React-text-only rendering are tests"
    requirement: "PFORM-26"
    verification:
      - kind: unit
        ref: "apps/web/i18n/profile-form-messages.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/components/profile-form/ProfileForm.test.tsx#the preview sends nothing"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false
  - id: D6
    description: "The screen reads right at 320px and 390px under a tenant brand and the long-title wrap holds inside the 288px card (visual fidelity to sketch 016 and the UI-SPEC)"
    requirement: "PFORM-26"
    verification: []
    human_judgment: true
    rationale: "Layout, wrapping and brand fidelity are the 320px and 390px Playwright runs and the manual rows of plan 18; no screenshot was taken here (no dev server, no Playwright on this disk)"

duration: 16min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 12: The member completion screen Summary

**`/completar-perfil` is one scrollable card for the first answer, the return after a form change and later edits: thirteen real controls, every state of the UI-SPEC, a save action that decides the destination with `safeNextPath`, and answers that never leave component state.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-10-30T01:35:00Z
- **Completed:** 2026-10-30T01:51:00Z
- **Tasks:** 3
- **Files modified:** 17

## Accomplishments

- Tracer (Task 1): the route reads `getBootstrap` through `loadOrRedirect`, sends any staff role to `/inicio` with no read of the form, reads `GET /v1/me/profile-form`, renders the heading by the API mode and saves through `saveProfileFormAction`, which returns the validated destination; the client flashes "Respostas salvas." and navigates only there.
- Task 2: the choice, rating, yes/no and acceptance controls, the returning notice, the danger-tinted "Falta responder" blocks (words and a shape), the error summary with focus, the offline notice, the save-failure alert, the 409 merge that keeps typed answers and order, and `loading.tsx` (no spinner).
- Task 3: the catalog test (42 strings, plurals, interpolations), the preview mode (every control live, action never called, "Fechar", no heading, nothing pre-filled or flagged) and the accessibility tests (names, `aria-invalid` and `aria-describedby`, heading focus, hostile text stays text).
- The module never names the redirecting `(app)` guard; a test reads the source and pins it, so the page cannot redirect to itself.

## Task Commits

1. **Task 1: [tracer] the route, the action and the form** - `9dad6f58` (feat)
2. **Task 2: every state and the remaining controls, tested** - `d8e2b4bb` (feat)
3. **Task 3: the catalog test, preview and accessibility tests** - `fa98425b` (test)
4. **Pin fix for the new (auth) folder** - `acff33a8` (fix)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/app/(auth)/completar-perfil/page.tsx`, `loading.tsx`, `actions.ts` - the route, its skeleton and the save action
- `apps/web/components/profile-form/ProfileForm.tsx`, `QuestionField.tsx`, `fields.tsx` - the form, the `FIELD_BY_TYPE` registry and the thirteen controls
- `apps/web/lib/profile-form/form-state.ts`, `member-form.ts`, `test-fixtures.ts` - pure state, the loader and test builders
- `apps/web/messages/pt-BR/profileForm.member.json` - every word of the member form
- Tests: `page.test.tsx`, `actions.test.ts`, `ProfileForm.test.tsx`, `fields.test.tsx`, `form-state.test.ts`, `profile-form-messages.test.ts`; `lib/safe-next-path.test.ts` (one pin)

## Decisions Made

See `key-decisions`. In short: the heading lives in `ProfileForm` so it can take focus; the summary gets focus and its link moves focus to the first bad control; a flag disappears as soon as the question is answered; a failed read always offers "Sair".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] "Limpar resposta" read a catalog key that does not exist**
- **Found during:** Task 2 (the field tests logged `MISSING_MESSAGE profileForm.member.clear`)
- **Issue:** `ClearButton` called `t('clear')`; the catalog declares `controls.clear`.
- **Fix:** `t('controls.clear')`.
- **Files modified:** `apps/web/components/profile-form/fields.tsx`
- **Verification:** `fields.test.tsx` and the catalog test pin the string.
- **Committed in:** `d8e2b4bb`

**2. [Rule 3 - Blocking] The (auth)-folder pin of plan 11 failed on the new folder**
- **Found during:** the repo gate after Task 3 (`lib/safe-next-path.test.ts`)
- **Issue:** the test derives the list of `app/(auth)` folders and expects each in `AUTH_PATH_PREFIXES`; `completar-perfil` is excluded through `PROFILE_FORM_PATH` (with sub-paths and queries), not that list.
- **Fix:** the pin skips the form's own folder; the form path stays asserted by the existing `PROFILE_FORM_PATH` cases.
- **Files modified:** `apps/web/lib/safe-next-path.test.ts`
- **Verification:** the file and the whole web suite (272 files, 6030 tests) pass.
- **Committed in:** `acff33a8`

### Plan-sanctioned variations

- The Task 1 commit already carries all thirteen controls and the full state machine (the plan asks Task 1 for `short_text` plus real placeholders for the rest and Task 2 for the rest). They were written once, in one module each; Task 2 added the tests, `loading.tsx` and the key fix, Task 3 the catalog and preview/a11y tests. The whole catalog also landed in Task 1.
- Extra file `lib/profile-form/test-fixtures.ts` (shared builders for the four test files).
- Two catalog strings that the UI-SPEC does not list: `errors.generic` (a fallback for refusals with no member-facing sentence, such as `unknown_question`) and `tenantFallback` ("Sua comunidade", used only when both the bootstrap name and `?t=` are empty).
- The five format types (number, date, phone, e-mail, link) are the plain text controls with the right `type` and `inputMode`, as asked; `toWire` already strips a phone to digits, accepts the pt-BR comma for numbers and `parseAnswer` decides validity. Masks, blur validation and link normalisation are plan 13.

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** None on scope; both fixes were needed for the screen and the suite to be correct.

## Issues Encountered

- `tsc --noEmit` passed before the catalog test existed, then `next build` (pulled in by `turbo typecheck`) typed `createTranslator` keys as `never` in that test; the translator is now cast to a plain `(key, values) => string` there.
- The first run of the repo gate left `apps/web/.next` 130 MB larger; `.next/cache` was removed afterwards. Free space stayed at 4.5 GB throughout.

## Verification

- Sketch guard passes (`approved: true`).
- Task verifies green: page, action and form-state tests (47); the whole profile-form folder (components, lib, route: 100); catalog test plus components (68); `bash scripts/check-ui-literals.sh` clean; `TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/web` green.
- Acceptance greps: `requireBootstrap` in `page.tsx` 0; `localStorage|sessionStorage` in `ProfileForm.tsx` and `form-state.ts` 0 each; `FIELD_BY_TYPE` in `QuestionField.tsx` 2 (typed `Record<ProfileFormType, FieldComponent>`); "Falta responder" in the catalog 1; `dangerouslySetInnerHTML` 0 in every profile-form `.tsx`; the action test asserts `//evil.com` gives `/inicio`; the 409 test asserts the typed value and the order; the preview test asserts the save mock called 0 times.
- Repo gate `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: every package green except one pin in `lib/safe-next-path.test.ts` (fixed in `acff33a8`); the whole web suite was then rerun: 272 files, 6030 tests passed.
- Not run (disk, per instructions): Playwright, `next dev`; the 320px/390px visual check is plan 18's.

## Known Stubs

None. (`short_text` has no stub; the five format types are real, basic text controls that plan 13 refines.)

## Threat Flags

None. T-12-29 (open redirect) and T-12-30 (answers in storage, a URL, a log or a toast) are mitigated as planned: the action is the only source of the destination and tests cover `//evil.com`, encoded, scheme, over-length and the form itself; storage, URL, log and flash-toast contents are asserted free of a typed secret; `dangerouslySetInnerHTML` and the storage names are absent from the form sources by a test and a grep.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 13 can replace the five format controls in `fields.tsx` (`NumberField`, `DateField`, `PhoneField`, `EmailField`, `LinkField`) and add blur validation through `issueFor`; `toWire` and `errorSpec` already cover their wire values and sentences.
- Plan 17 can mount `<ProfileForm preview form={...} onClose={...} />` in the builder sheet; the preview needs a `MemberForm`-shaped object (mode ignored, answers ignored).
- Plan 14 and 18 rely on the `?next=` shapes and the `Cancelar` link already wired here; visual fidelity at 320 and 390px is for plan 18.

## Self-Check: PASSED

- Created files exist; commits `9dad6f58`, `d8e2b4bb`, `fa98425b`, `acff33a8` exist; no commit message carries a trailer or tool attribution; `.planning/sketches` untouched by this plan (only a pre-existing untracked `.DS_Store` appears there).

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*
