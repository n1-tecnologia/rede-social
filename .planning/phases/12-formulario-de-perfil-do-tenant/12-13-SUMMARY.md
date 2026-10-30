---
phase: 12-formulario-de-perfil-do-tenant
plan: 13
subsystem: web
tags: [profile-form, format-controls, phone-mask, pt-br-number, link-normalise, blur-validation, D-590, UI-D-584, UI-D-585, UI-D-586, T-12-31, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 03 the contract (parseAnswer: phone digits 10-11 with DDD 11-99 and a 9 after it, number, ISO date, e-mail, http/https link), plan 12 the member screen with the thirteen controls, toWire, issueFor, validateAll, errorSpec, limitHint and the profileForm.member catalog"
provides:
  - "phone.ts: phoneMask, parseBrazilianPhone (a country code 55 removed only when 12 or 13 digits remain), onlyDigits, caretAfterDigits"
  - "number.ts: parseNumberPtBr (comma decimal; thousands dots only when well formed; refused otherwise) and formatNumberPtBr"
  - "link.ts: normalizeLink (adds https:// to a bare address; leaves every scheme as typed so the contract refuses ftp:, javascript:, data:)"
  - "form-state: validateOnBlur, settleOnBlur, isFormatType; toWire uses the three helpers; limitHint also covers date; draftFromStored shows numbers with the pt-BR comma"
  - "fields.tsx: the five format controls share useFormatField (blur judged by parseAnswer, error cleared on the next edit, the save error wins); the phone control masks, handles paste and keeps the caret"
affects: [12-14, 12-17, 12-18, profile-form]

actuals:
  tokens: 14100
  tasks: 2
  commits: 2
plan_head_before: 8ecf1b5cc6d4f2fae2d32544044c3aed599e4f2e

tech-stack:
  added: []
  patterns:
    - "The client has one validator, the contract's parseAnswer; the helpers only move between what the member sees and the wire value and never judge"
    - "An input mask never drops what the member typed: a change that needs a twelfth digit is refused, not cut"
    - "A country code is removed only from a paste or a bulk insert into an empty field, never from digits typed one by one (DDD 55 exists)"
    - "Blur errors live in the field (useFormatField), not in the form's error map, so the save summary still appears only after a failed Salvar"

key-files:
  created:
    - apps/web/lib/profile-form/phone.ts
    - apps/web/lib/profile-form/phone.test.ts
    - apps/web/lib/profile-form/number.ts
    - apps/web/lib/profile-form/number.test.ts
    - apps/web/lib/profile-form/link.ts
    - apps/web/lib/profile-form/link.test.ts
    - apps/web/components/profile-form/format-fields.test.tsx
  modified:
    - apps/web/lib/profile-form/form-state.ts
    - apps/web/lib/profile-form/form-state.test.ts
    - apps/web/components/profile-form/fields.tsx
    - apps/web/components/profile-form/fields.test.tsx
    - apps/web/i18n/profile-form-messages.test.ts

key-decisions:
  - "Number rule (Claude's discretion, recorded): a comma is the decimal mark and then dots must be well-formed thousands groups; with no comma a dot is thousands only for a well-formed group whose first group does not start with 0 (1.234 is 1234, 12.345.678 is 12345678, 1.5 is 1.5, 1.23 is 1.23, 0.500 is 0.5); letters, exponents, spaces inside, a lone mark and a leading plus are refused"
  - "On blur a number is shown back as parsed (1.234,5 becomes 1234,5; 1.234 becomes 1234) so the member sees the value that will be stored; a text the rule refuses is left as typed and shown the error"
  - "A twelfth digit, typed or pasted, is refused instead of cut (the prohibition on a silently dropped digit); phoneMask itself still cuts at 11 as the pure function the plan describes"
  - "Blur validation never reports an empty field (a required blank is judged on Salvar), so tabbing past a field does not accuse it"
  - "toWire for a link normalises a bare address, so pressing Enter in the link field saves the same value that leaving it would have shown"
  - "The date question shows its limits as a helper in dd/MM/yyyy built from the ISO text (no Date object, no time zone), reusing the number helper lines"

patterns-established:
  - "useFormatField wraps a FieldProps into the props of a text line with the blur rules, so a sixth format type is one more control, not a new mechanism"

requirements-completed: [PFORM-14, PFORM-26]

coverage:
  - id: D1
    description: "A pasted +55 11 91234-5678, 5511912345678 or (11) 91234-5678 becomes the mask (11) 91234-5678 and the stored national number 11912345678; ten digits mask as (11) 1234-5678; a DDD 55 typed digit by digit is never taken for a country code; a twelfth digit is refused"
    requirement: "PFORM-14"
    verification:
      - kind: unit
        ref: "apps/web/lib/profile-form/phone.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/components/profile-form/format-fields.test.tsx#the phone control masks what the member types and stores the digits"
        status: pass
    human_judgment: false
  - id: D2
    description: "Blur validation of the five formats with the contract's parseAnswer: phone DDD 01 and 11 digits without the 9, e-mail, link schemes, number and date limits with their sentences; nothing while typing, nothing for an empty field, the error clears on edit, the save error wins"
    requirement: "PFORM-14"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/format-fields.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/form-state.test.ts#validateOnBlur: the contract judges a format control when the member leaves it (12-13)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The pt-BR number rule (the whole truth table, ambiguous input parsed by the rule or refused) and the link normaliser (https:// added, ftp:/javascript:/data: left for the contract to refuse)"
    requirement: "PFORM-26"
    verification:
      - kind: unit
        ref: "apps/web/lib/profile-form/number.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/link.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "For each format type the string the member sees converts to exactly the stored value shape and back; the keyboard attributes, 16px text and the 44px target of every format control are pinned"
    requirement: "PFORM-26"
    verification:
      - kind: unit
        ref: "apps/web/lib/profile-form/form-state.test.ts#the string the member sees converts to exactly the stored shape and back (PFORM-14, 26)"
        status: pass
      - kind: unit
        ref: "apps/web/components/profile-form/format-fields.test.tsx#every format control keeps its keyboard attributes, 16px text and a 44px target (UI-D-584)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The mask, the caret and the paste feel right on a real phone keyboard (iOS and Android autofill, the numeric keypad, the native date picker)"
    requirement: "PFORM-26"
    verification: []
    human_judgment: true
    rationale: "happy-dom proves the logic of the events; the keyboards, autofill and pickers of real devices are the manual rows of plan 18 (no device or Playwright run on this disk)"

duration: 22min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 13: The five format controls Summary

**The phone, number, date, e-mail and link controls of the member screen now speak Brazilian: a phone mask that survives pastes and a DDD 55, a pt-BR number rule that is parsed or refused and never guessed, a link that gains its `https://`, and blur validation that is the contract's own `parseAnswer`.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-10-30T01:38:00Z
- **Completed:** 2026-10-30T02:00:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Tracer (Task 1): a pasted `+55 11 91234-5678` becomes the mask `(11) 91234-5678`, the draft and the stored value `11912345678` and a green `parseAnswer`; the same for `5511912345678` and the masked form, and for ten digits as `(11) 1234-5678`.
- The phone control never drops a digit the member typed (a twelfth is refused), removes a country code only from a paste or a bulk insert into an empty field, replaces only the selected digits on a paste in the middle and keeps the caret beside the digit being edited.
- `parseNumberPtBr` and `formatNumberPtBr` carry the documented rule (a table of accepted decimal and thousands cases and 18 refused ones); on blur the number comes back in pt-BR form as it was parsed.
- `normalizeLink` adds `https://` (also for `localhost:3000/x` and `exemplo.com:8080`) and leaves `ftp:`, `javascript:`, `data:`, `mailto:` and `file:` untouched, so the contract refuses them.
- `validateOnBlur` and `settleOnBlur` in `form-state.ts` and the shared `useFormatField` give all five controls the same blur behaviour; date and number questions show their limits as a helper (`Entre 01/01/2026 e 31/12/2026.`).
- Round-trip tests per format type for PFORM-14 and PFORM-26.

## Task Commits

1. **Task 1: [tracer] a pasted phone becomes a mask, a stored national number and a valid answer** - `067b542b` (feat; it also carries the number and link helpers and the other four controls, because `form-state.ts` and `fields.tsx` hold them in one module each)
2. **Task 2: number, date, e-mail and link controls, tables and catalog pins** - `c4b98046` (test)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/lib/profile-form/phone.ts`, `number.ts`, `link.ts` - the three pure helpers
- `apps/web/lib/profile-form/form-state.ts` - `validateOnBlur`, `settleOnBlur`, `isFormatType`, helpers wired into `toWire`, date helper
- `apps/web/components/profile-form/fields.tsx` - `useFormatField`, the masked `PhoneField`, the refined number, date, e-mail and link controls
- Tests: `phone.test.ts`, `number.test.ts`, `link.test.ts`, `form-state.test.ts`, `format-fields.test.tsx` (new), `fields.test.tsx` (one row), `profile-form-messages.test.ts`

## Decisions Made

See `key-decisions`. In short: the number rule is written down once and refused when ambiguous; a number is shown back as parsed; a twelfth phone digit is refused, not cut; an empty field is never accused on blur; a link is normalised on save as well as on blur.

## Deviations from Plan

### Plan-sanctioned variations

- **No new catalog lines.** The plan lists catalog lines under `profileForm.member.formats.*`. Plan 12 already shipped every placeholder, helper and format error under `controls.*` and `errors.*`, verbatim from the UI-SPEC (and pinned by the catalog test), and `errorSpec`/`limitHint` read them. Adding a second copy under `formats.*` would duplicate strings, so none were added; the catalog test gained a check that the date helper lines render with `dd/MM/yyyy` values.
- **Blur state lives in the field, not in the form.** The plan says the controls are refined "without changing the form shell". `ProfileForm.tsx` and `QuestionField.tsx` are untouched: the blur error is local to `useFormatField`, so a blur error never opens the "Revise N campos" summary (that is for a failed Salvar) and the save/server error still wins.
- **Task 1's commit is wider than the tracer.** `form-state.ts` imports the number and link helpers and `fields.tsx` holds the five controls, so the first commit carries them; Task 2's commit is the tables and pins.
- `ids.describedBy` is extended locally with the error id when the blur error (not the save error) is showing.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A plan-12 pin expected the link control to have no `autocomplete`**
- **Found during:** Task 2 (`fields.test.tsx`)
- **Issue:** UI-D-584 (and this plan) say the link is `url`/`url`/`off`; the old row asserted `null`.
- **Fix:** the row now expects `off`; `toWire` for a link now normalises, so the generic "text types send the string" loop no longer lists `link` (a dedicated round-trip test covers it).
- **Files modified:** `apps/web/components/profile-form/fields.test.tsx`, `apps/web/lib/profile-form/form-state.test.ts`
- **Verification:** both files pass.
- **Committed in:** `067b542b`

---

**Total deviations:** 1 auto-fixed (1 blocking pin), 4 plan-sanctioned variations
**Impact on plan:** None on scope; no new token, type, catalog string or wire shape.

## Issues Encountered

- `fireEvent.change(input)` after assigning `input.value` directly does not reach React (its value tracker sees no change); the caret test sets the value through the native setter and dispatches an `input` event instead.

## Verification

- Sketch guard passes (`approved: true`).
- `vitest run lib/profile-form components/profile-form i18n/profile-form-messages.test.ts`: 8 files, 221 tests pass (`phone.test.ts` 25 cases, `number.test.ts` 45, `link.test.ts` 11, `format-fields.test.tsx` 35).
- `bash scripts/check-ui-literals.sh` clean; `biome check` clean on the touched folders; `tsc --noEmit` clean.
- Acceptance: `grep -c parseAnswer form-state.ts` is 3 (import, `issueFor`, `validateOnBlur`); every format control test asserts `inputMode`, `text-base`, `py-3` and `min-h-11`.
- Repo gate `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 41 of 41 tasks successful.
- Not run (disk, per instructions): Playwright and `next dev`; real keyboards, autofill and pickers are plan 18's manual rows. `apps/web/.next/cache` removed after the gate; free space 4.8 GB.

## Known Stubs

None.

## Threat Flags

None. T-12-31 is mitigated as planned: the helpers never repair a non-http scheme (`javascript:`, `ftp:`, `data:` stay as typed and `parseAnswer` refuses them), an ambiguous number is parsed by the documented rule or refused, a twelfth phone digit is refused instead of cut, and the contract's `parseAnswer` stays the only judge (the server re-validates every value in plan 06).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 17's builder preview mounts the same controls, so the masks and blur rules apply there as well.
- Plan 18's manual rows should include the phone mask with a paste and the iOS date picker on a real device.

## Self-Check: PASSED

- Created files exist; commits `067b542b` and `c4b98046` exist; no commit message carries a trailer or tool attribution; `.planning/sketches` untouched.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*
