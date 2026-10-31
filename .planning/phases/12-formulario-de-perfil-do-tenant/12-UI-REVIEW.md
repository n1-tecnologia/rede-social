# Phase 12 - UI Review

**Audited:** 2026-10-31
**Baseline:** 12-UI-SPEC.md (approved) and provisional sketch 016
**Screenshots:** not captured (code-only audit, no servers allowed)
**Auditor:** gsd-ui-auditor

Scope read: `apps/web/app/(app)/configuracoes/formulario-de-perfil/*` (builder, sheet, dialogs, archived list), `apps/web/components/profile-form/*`, `apps/web/app/(auth)/completar-perfil/*`. Not read line by line: the /perfil and /membros/{id} wiring, and the i18n catalog text, which was sampled only through greps.

Rendered fidelity against sketch 016, brand-colour rendering, and real-device behaviour cannot be shown by code reading. They are marked `needs_human_review: true` below and are not scored as passing. Scores are for what the code proves.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | All strings go through next-intl and no hardcoded JSX text was found. The planner-written copy (UAT row 9) and the unanswered sketch questions (a)-(f) are unratified. |
| 2. Visuals | 3/4 | Accessibility structure is strong. Fidelity to the sketch is unverified (UAT 10 blocked, 11 pending). |
| 3. Color | 3/4 | No hardcoded hex or rgb and no new tokens. Brand budget per screen is not provable from code alone. |
| 4. Typography | 3/4 | Sizes xs, sm, base, 2xl and weights 400 and 700 only. One stray `text-base` on a non-input span. |
| 5. Spacing | 3/4 | Only the scale classes are used. A few arbitrary values sit outside the declared scale. |
| 6. Experience Design | 3/4 | Loading, error, empty, offline, locked, reorder and impact-confirm states are all present. Real-device behaviour is unproved. |

**Overall: 18/24**

No pillar scores 4. Fidelity to the approved design is unproven (the design gate is only provisional, and the sketch comparison, colours and copy tone were never checked by any test), so a 4 cannot be supported. No pillar scores 1 or 2 and no BLOCKER was found.

---

## Top 3 Priority Fixes

1. **Sketch 016 has never been compared with the build and is not approved by the owner** (WARNING) - UAT 10 is blocked and UAT 11 is pending. The 20 Playwright tests prove only overflow and tap targets. Users could meet a screen that differs from the approved design. Fix: Igor confirms sketch 016 and answers design questions (a)-(f). Then someone walks the 9 surfaces at 320 and 390 px with a tenant brand colour and compares them to the sketch (`needs_human_review: true`).
2. **Unratified pt-BR copy** (WARNING) - UAT row 9 (editor notes for short and long text, "Informe um número.", archive and delete failure toasts, "Fechar") and row 6 (Moderação export wording) are planner-written copy outside the approved design. Fix: Igor keeps or rewrites each item. This is flagged for the owner, not rewritten here.
3. **Brand budget and type-scale drift are unenforced** (WARNING) - The contract says one brand fill per screen and four sizes. The code shows `text-brand` and `border-brand` on the type-tile selected state and on the TypePicker link at `TypePicker.tsx:76,117,120`, which the contract allows only as selected marks. `text-base` is used on a static option label at `OptionsEditor.tsx:115`, which is not an input. Fix: change that span to `text-sm`. Check the TypePicker link at line 76 against the brand-reserved list, and add a render check that counts brand fills per screen.

Minor: arbitrary values `max-w-[680px]`, `h-[104px]` and `h-[88px]` (the last two in loading.tsx skeletons) sit outside the declared scale. Take them from the shipped admin-page convention or record them as exceptions in the contract.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
- No hardcoded user-visible JSX strings were found by grep in the builder, the member form or the completion page. All text goes through `useTranslations`. This is a strength.
- No generic labels were found in the greps (profile-form-messages.test.ts also guards the catalog).
- The labels "Falta responder", "Obrigatória/Opcional", "Limpar resposta", "Agora não" and "Responder" appear as contract keys in the code. Whether the tone matches the sketch is `needs_human_review: true`.
- WARNING: UAT row 9 and row 6 copy is not ratified by the owner (see fix 2). I did not judge or rewrite it.
- WARNING: the read-failure paths in `ArchivedList.tsx:135` ("previewFailed") and `QuestionEditorSheet.tsx:229` ("saveFailed") are generic by nature. They name the failure but give no next step in code-visible form. Check the rendered text.

### Pillar 2: Visuals (3/4)
- Strength: fields use `fieldset` + `legend` for groups, `htmlFor` for single controls, `aria-required`, `aria-invalid` and `aria-describedby` (`fields.tsx:44-195`). Icon-only controls carry `aria-label` (`QuestionList.tsx:102`, `OptionsEditor.tsx:125`, `ArchivedList.tsx:199`). Decorative icons are `aria-hidden`.
- Strength: reorder offers explicit up and down buttons with a spoken result (`QuestionList.tsx:143-249`), not drag only.
- Gap: the h1 on the completion screen is `text-2xl font-bold tracking-[-0.02em]` (`ProfileForm.tsx:238`), matching the contract's Title role. Hierarchy elsewhere is bold 14 px labels over 12 px captions, so the focal point is clear in code.
- Gap: the "Falta responder" block uses a danger tint plus an icon plus text, so it does not rely on colour alone (`QuestionField.tsx:112`). Good.
- needs_human_review: true - match to sketch 016, the focal point on a rendered screen, the glyph choices of the 13 type tiles, and the empty-state look.

### Pillar 3: Color (3/4)
- No hardcoded hex or rgb in any audited file. Colours are tokens only: `text-danger`, `bg-danger/5`, `bg-warning/10`, `bg-bg-tertiary`, `border-brand`, `text-brand`. No new token was added, as the contract requires.
- Danger use matches the contract: error text, the alert class (`ProfileForm.tsx:61`) and the "Falta responder" flag.
- Not provable by code: whether each screen ends with one brand fill (the "Responder" outline button on the notice is outline in code), and contrast on a custom tenant brand colour (`needs_human_review: true`).

### Pillar 4: Typography (3/4)
- Class distribution across the builder, member components and completion page: `text-xs` x42 combined, `text-sm` x28, `text-base` x2, `text-2xl` x1; weights `font-bold` and `font-normal` only. No medium or semibold. This matches the contract's two weights.
- `text-base` (16 px) at `fields.tsx:81` is the declared input exemption. `text-base` at `OptionsEditor.tsx:115` is a non-input span and falls outside the declared sizes (WARNING, minor).
- The contract lists 12/14/16/24 px. The 16 px heading role is not seen as `text-base` in the audited files, so sheet titles likely come from shared primitives. That was not verified.

### Pillar 5: Spacing (3/4)
- Scale classes are consistent with the contract: `gap-2`, `gap-3`, `p-4`, `px-3 py-3` notice rows, `min-h-11` for tap targets. This is the same 12 px exception documented in the spec.
- Arbitrary values: `max-w-[680px]` (`page.tsx:107`, `loading.tsx:21`), `h-[104px]`, `h-[88px]` (skeletons), `max-[359px]:grid-cols-1` (`LimitsFields.tsx:58`). Skeleton heights are a layout-shift guess against the real card height, which was not measured.
- 44 px tap targets are enforced in code (`min-h-11`) and in the Playwright specs at 320 and 390 px (E02-E10). The Button hit area fix is in `buttonClasses.ts`. I did not re-run the specs.
- needs_human_review: true - actual rhythm against the sketch and the wrap behaviour of the OptionsEditor action row at 320 px.

### Pillar 6: Experience Design (3/4)
- States covered: pending and `aria-busy` on submit (`ProfileForm.tsx:230`), loading skeletons for the builder and the completion page (`loading.tsx`), `role="alert"` and `role="status"` regions for errors, the offline notice (`WifiOff`), the empty state and "module off" surface, archived list with reactivate, impact preview before a required question is archived, and a guarded limit (active limit toast).
- Failure handling: transport failures toast and keep the draft (`QuestionEditorSheet.tsx:97`). Archive and reactivate do nothing if the impact read fails (`ArchivedList.tsx:57`).
- Open caveats from UAT 8: (1) the server change of quick 261030-g1y is not proved in a browser; (2) an open app whose member taps a link at the moment the gate flips lands on /inicio, not on the post. Both are acknowledged and left to the owner.
- Gap: the real-device behaviour of date pickers, masks, autofill and iOS keyboards (`inputMode`, `autoComplete="tel-national"` and others are set correctly in code) is unproved (UAT 1, 10 blocked: physical device).
- Gap: CSV opening in a pt-BR spreadsheet and the large-export path are unproved (UAT 3, 4).
- No registry audit was needed: `shadcn_initialized: false` in the UI-SPEC.

---

## Items marked needs_human_review: true
1. Visual fidelity of all 9 surfaces to sketch 016 at 320 and 390 px with a tenant brand colour.
2. Sketch design questions (a)-(f) and the approval of the sketch by the owner (UAT 11).
3. Copy tone and the unratified strings (UAT 6, 9).
4. Brand-fill count per screen and contrast on a custom brand colour.
5. Native pickers, keyboards and autofill on a real phone (UAT 1, 10).

## Files Audited
- `apps/web/app/(app)/configuracoes/formulario-de-perfil/` (ArchiveDialog, ArchivedList, ExportDialog, FormSummaryCard, ImpactDialog, LimitsFields, OptionsEditor, PreviewSheet, ProfileFormTabs, QuestionBuilder, QuestionEditorSheet, QuestionList, TypePicker, VisibilitySwitches, loading, page)
- `apps/web/components/profile-form/` (ProfileForm, QuestionField, fields, NewQuestionsNotice, MyAnswersSection, AnswerValue, PublicAnswersBlock, MemberAnswersBlock, StaffAnswersBlock)
- `apps/web/app/(auth)/completar-perfil/` (page, loading)
- `.planning/phases/12-formulario-de-perfil-do-tenant/12-UI-SPEC.md`, `12-UAT.md`
