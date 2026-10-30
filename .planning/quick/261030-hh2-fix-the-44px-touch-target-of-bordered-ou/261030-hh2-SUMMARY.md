---
phase: quick-261030-hh2
plan: 01
subsystem: ui
tags: [ui, button, touch-target, hit-area, e2e, quick]
requirements: [UI-D-443]
status: complete
commits: 1
plan_head_before: 88e8d3aed8b80d0288420131eee72d647bdb3a5a
key-files:
  modified:
    - packages/ui/src/primitives/buttonClasses.ts
    - packages/ui/tests/button.test.tsx
    - apps/web/app/(app)/configuracoes/formulario-de-perfil/dialogs.test.tsx
actuals:
  tasks: 2
  commits: 1
---

# Quick 261030-hh2: centred 44px hit area for bordered sm buttons

`HIT_AREA` in the Button primitive is now a 44px `::after` box centred on the control
(`relative after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2`) instead of
an inset from the padding box, so a 1px border no longer shaves the tap target to 42px. One string,
one primitive, no call site touched.

## Commit

- `18d9f0f8` fix(quick-261030-hh2): centre the 44px hit area of sm buttons so a border no longer shaves it to 42px
  (3 files, author igor.vboas, no trailer; `git log -1 --format=%B | grep -i claude|anthropic|co-authored` printed nothing).

## Task 1: unit tests, red then green

RED (real output, before editing `buttonClasses.ts`):

- `packages/ui/tests/button.test.tsx`: 3 failed | 40 passed (43). Failing: "hitArea keeps the 36px sm look ...",
  "hitArea is a centred 44px box that does not depend on the border (UI-D-443)" (new), "Button hitArea renders the
  hit-area classes and never reaches the DOM". Failure lines: `expected [ Array(25) ] to include 'after:top-1/2'`,
  `expected [ 'after:-inset-y-1', ...(2) ] to deeply equal [ 'after:-translate-y-1/2', ...(4) ]`.
- `dialogs.test.tsx`: 1 failed | 58 passed (59). Failing: "the export button keeps the transparent 44px hit area of the
  small button", `expected [ Array(26) ] to include 'after:top-1/2'`.
- Nothing else failed. (Vitest output was not reformatted into TAP; no counts invented.)

GREEN (after the change):

- `packages/ui/tests/button.test.tsx`: 43 passed (43).
- `dialogs.test.tsx` + `pagamentos/EventsList.test.tsx`: 2 files, 84 passed (84).
- `tsc --noEmit --incremental false` clean in `packages/ui` and `apps/web`.
- `biome check` clean on the three touched files (biome format wrapped the `HIT_AREA` literal onto its own line after
  `const HIT_AREA =`; the tokens are still whole literals, so Tailwind's `@source` scan sees them).
- The old inset-y class string is absent from every `.ts`/`.tsx` under packages and apps.

## hitArea inventory (classification from the plan, geometry not re-measured except where stated)

- Bordered, variant outline (1px border), hit area grows 42 -> 44: ExportDialog 'Exportar respostas (CSV)', ArchivedList
  'Reativar pergunta', AccessList 'Liberar e-mail', AccessProductsCard, EventsList 'Liberar manualmente', MemberHomeTab /
  MemberProgressTab / MemberTracksTab RETRY_LINK, CourseActionZone OUTLINE_SM_LINK, InicioTabs FIND_BUTTON_LINK,
  ReplaceCredentialsSheet, ReplaceTokenSheet, SocialLimitsSheet, VerifyDatabaseButton, NewQuestionsNotice (outline),
  SocialProfileBlock, FollowButton (following state).
- Borderless, geometry unchanged (centred 44px on a 36px control equals the old 4px inset): ghost call sites
  (NewQuestionsNotice, PreviewBanner, ReadMoreText, CourseActionZone, MemberLessonPage) and FollowButton's brand state.
- Not the primitive, untouched: ReelCaption (own hand-written hit area), TenantTable (stretched link).
- Only the Export button was measured in a real browser (below); the rest rely on identical geometry.

## Task 2: Playwright, profile-form-admin.spec.ts on mobile-chromium

Precondition: 16 GiB free (`df`), `supabase_db_rede-social` up, both `.env.local` present, ports 3000 and 8787 free, so the
run started its own servers on the Task 1 code. Watchdog (abort under 3 GiB) ran; free space stayed at about 16 GiB
throughout; after the run `apps/web/.next/dev` is 794 MB, no next process alive, free space 16 GiB, so nothing was removed.

Full run (once): 5 passed, 1 failed, 1 did not run.

| Test | Result |
|------|--------|
| 1 row opens the builder, add question | passed |
| 2 reorder | passed |
| 3 answered question locked, replace/archive/impact | passed |
| 4 export downloads BOM CSV, preview saves nothing | passed |
| 5 support user does not see the row | passed |
| 6 at 320px | FAILED at spec line 456 (not a touch target) |
| 6 at 390px | skipped by the serial file after the 320px failure |

Follow-up run (the one allowed, `--grep "at 390px"`): test 6 at 390px FAILED at the same line 456 with the same assertion.

Failure (a FINDING, not fixed, at both widths):

```
profile-form-admin.spec.ts:456  await expect(discard).toBeVisible();
Locator: getByRole('dialog', { name: 'Descartar as alterações?' })  Expected: visible  Error: element(s) not found (10000ms)
```

The step before it fills the 'Pergunta' textbox of the editor sheet and presses Escape; the page snapshot afterwards shows
the builder list with the sheet gone and no discard dialog, i.e. Escape closed the dirty sheet without the discard prompt
(or the fill did not register as dirty). Nothing in it is about hit areas.

What the run proves about the fix: in test 6 the step `E02 {width}px list` runs `expectScreenFits` (which calls
`expectTouchTarget`/`expectTapTarget`, passing at a run of 43px or more) on 'Exportar respostas (CSV)' before the failing
line, and it passed at both 320px and 390px (the failing run before the fix measured 42 at 320px). The printed
`{visible, run, first, last}` values are not in the log because the probe only prints on failure. The 'Reativar pergunta'
control (ArchivedList) is checked later in test 6, after the failing line, so it was NOT reached at either width and is not
proven in a browser; it shares the Export button's geometry. The two requested end-to-end passes of test 6 (320px and
390px) are therefore NOT achieved, because of the discard-dialog finding.

## Deviations from Plan

**1. [Orchestrator override] `apps/web/e2e/payments-admin.spec.ts` not edited.** The plan's extra tidy of E07 was removed
from Task 1 by the orchestrator (an unverified change outside the one-spec Playwright budget). The spec still pins the old
workaround at about lines 456-458: a comment saying the shipped `hitArea` of an outline `sm` button reaches 42px
(`deferred-items.md, 09.1-19`) and `await expectTapTarget(grant, 42);`. That assertion still passes at 44px; a later task
should revert it to `expectTapTarget(grant)`, delete the comment and run that spec. Its grep gate was dropped from the
verify; the other gates ran green.

**2. [Formatting]** biome wrapped `HIT_AREA` over two lines, so the plan's single-line grep for the three tokens on one
non-comment line does not match; the tokens are all present as one literal.

## Notes

- The Phase 09.1 deferred-items entry 09.1-19 (outline hitArea reaches 42px) is now resolved by this fix; the document was
  not edited.
- Nothing else was touched: no member or gate spec, no Phase 12 document, no call site, IN-01..IN-04 untouched.
- `apps/web/test-results/` holds git-ignored failure output of the follow-up run.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- `18d9f0f8` exists; the three files exist; the plan's old class string is absent from the code.
