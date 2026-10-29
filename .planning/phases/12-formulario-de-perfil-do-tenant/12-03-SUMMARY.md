---
phase: 12-formulario-de-perfil-do-tenant
plan: 03
subsystem: contracts
tags: [profile-form, contracts, zod, answer-validators, D-590, D-591, D-592, T-12-05, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 02 confirmed names: module profile_form, gate code PROFILE_FORM_PENDING, permissions profile_form.manage / profile_form.read, mount path /v1/profile_form"
provides:
  - "subpath @rede-social/contracts/profile-form (packages/contracts/src/profile-form.ts)"
  - "PROFILE_FORM_TYPES (13, append-last order), PROFILE_FORM_CHOICE_TYPES, PROFILE_FORM_MODES, PROFILE_FORM_LIMITS (one constant per limit), PROFILE_FORM_ISSUES (21 closed codes) and PROFILE_FORM_ISSUE_SET"
  - "parseAnswer(question, raw), missingIssue(question), normalizeOptionLabel(label), codePoints(text), answerEtag(questions)"
  - "answerValueSchema, a z.discriminatedUnion with exactly one variant per type, same order as PROFILE_FORM_TYPES"
  - "18 wire schemas: create, update, reorder and replace bodies; member question and form; save body and result; dismiss result; bootstrap block; admin, archived, summary, impact query and result; strict public and staff answer reads"
affects: [12-04, 12-05, 12-06, 12-07, 12-08, 12-09, 12-10, 12-11, profile-form]

actuals:
  tokens: 16956
  tasks: 2
  commits: 2
plan_head_before: e5a1465ad9f05071c0a3aa3fde950f31a95ab21f

tech-stack:
  added: []
  patterns:
    - "A module contract file exports constants, a closed *_ISSUES list with a lookup set, pure validators and strict response schemas, exactly like payments.ts"
    - "Zod refinements carry the closed issue code as their message (and a path), so a route defaultHook can lift them with PROFILE_FORM_ISSUE_SET"
    - "Base object shape shared by create and replace, with the cross-field superRefine attached after .extend (Zod 4 refuses .extend on a refined object)"

key-files:
  created:
    - packages/contracts/src/profile-form.ts
    - packages/contracts/tests/profile-form.test.ts
  modified:
    - packages/contracts/package.json

key-decisions:
  - "The validator is a pure function of the STORED question: type, options, limits and allowOther come from the row, so a client-claimed type or limit is never read (T-12-05)"
  - "Stored value shapes are exactly the PFORM-04 table; a multiple_choice value is re-ordered to the question's option order and de-duplicated; -0 is stored as 0"
  - "other_required is in the closed list but parseAnswer never emits it: the raw value cannot say 'Outro was chosen' without text, so the web raises it while the box is ticked and empty (UI-D-585); the server sees an empty text as no answer"
  - "Body-schema refusals use only codes of the closed list: a missing title or blank label is required, an overlong one too_long, wrong option count or a duplicate label invalid, more than 20 options limit_reached, min above max out_of_range, allowOther on a non-choice type other_not_allowed"

patterns-established:
  - "Raw choice inputs accepted by parseAnswer: a bare id string, an id array (multiple only), or { optionId | optionIds, otherText }; the stored result is always the object form"

requirements-completed: [PFORM-02, PFORM-04, PFORM-05, PFORM-06]

coverage:
  - id: D1
    description: "parseAnswer validates all thirteen types against the stored question (type, options, limits, allowOther) and returns the documented stored shape or exactly one closed issue code"
    requirement: PFORM-04
    verification:
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts#12-03 - one valid answer per type (PFORM-04)"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts#12-03 - the server never trusts a claimed type (T-12-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The six PFORM-04 edge categories: boundary, adjacency, empty, encoding, ordering and precision are pinned by named tests"
    requirement: PFORM-04
    verification:
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts (describes boundary, adjacency, empty, encoding, ordering, precision)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Choice questions: 2 to 20 options with unique normalised labels, unknown_option, other_not_allowed, and 'Outro' text stored with the answer"
    requirement: PFORM-06
    verification:
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts#12-03 - choices: options and Outro (PFORM-06, D-592)"
        status: pass
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts#12-03 - createQuestionBodySchema (PFORM-02, PFORM-06)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The TypeScript list is the single source for the type CHECK: answerValueSchema has one variant per PROFILE_FORM_TYPES element, in order (the SQL half is plan 04)"
    requirement: PFORM-05
    verification:
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts#PFORM-05 (TypeScript half): the answer schema has exactly one variant per type, in order"
        status: pass
    human_judgment: false
  - id: D5
    description: "Builder bodies enforce title 1 to 120, help text at most 300 and carry the 30-active-question constant; every route has one request or response schema, and the public answers read is strict"
    requirement: PFORM-02
    verification:
      - kind: unit
        ref: "packages/contracts/tests/profile-form.test.ts#12-03 - createQuestionBodySchema, updateQuestionBodySchema, reorder and replace, member shapes, admin and read shapes"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-29
status: complete
---

# Phase 12 Plan 03: Profile form answer contract Summary

**One import now defines a valid profile-form answer for the API, the kernel and the web: thirteen type validators (`parseAnswer`) built from the stored question alone, one constant per limit, a closed list of 21 refusal codes, and 18 request/response schemas with strict answer reads.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-29T23:16:01Z
- **Completed:** 2026-10-29T23:21:49Z
- **Tasks:** 2 (1 tracer, 1 auto)
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Tracer through the whole contract: a question definition plus a raw value goes into `parseAnswer` and comes out as the typed stored value or exactly one issue code, for all thirteen types (59 tests at the tracer commit).
- The six PFORM-04 edge categories (boundary, adjacency, empty, encoding, ordering, precision) and the PFORM-06 empty and encoding items are pinned by named tests, including 120 emoji accepted and 121 refused, phone 10/11 digits with DDD 11-99 and the 9 rule, `2026-02-30` refused, 2**60 refused, min equal to max.
- Every body schema refuses with a code from `PROFILE_FORM_ISSUES` (a test walks malformed bodies and checks each message is in the lookup set).
- `publicAnswersSchema` and `staffAnswersSchema` are `.strict()` at both levels; tests feed them an extra key and a forbidden `showOnProfile`/`email` key and expect failure.

## Task Commits

1. **Task 1: [tracer] Types, limits, issue codes and parseAnswer for all thirteen types** - `33e75291` (feat)
2. **Task 2: The wire schemas of every route** - `47a5d4d7` (feat)

**Plan metadata:** committed after this file (docs: complete plan).

## Files Created/Modified

- `packages/contracts/src/profile-form.ts` - constants, issue list, `parseAnswer` and helpers, `answerValueSchema`, all body and response schemas, `answerEtag`
- `packages/contracts/tests/profile-form.test.ts` - 83 tests across the validators, the edge categories and the wire schemas
- `packages/contracts/package.json` - `./profile-form` subpath export

## Decisions Made

See `key-decisions` above. In short: the validator reads only the stored question; `other_required` is a web-raised code; body refusals reuse the closed list, mapping to field-level codes (`required`, `too_long`, `invalid`, `limit_reached`, `out_of_range`, `other_not_allowed`).

## Deviations from Plan

None - plan executed exactly as written. Two small choices inside the plan's latitude, recorded for the later plans:

- `PROFILE_FORM_IMPACT_CHANGES`, `codePoints`, `ParseAnswerResult` and the inferred `*Body`/`*Result` types are additional exports; no export the plan lists is missing (18 `export const ...Schema`, plan asked for at least 17).
- `memberQuestionSchema.answer` is typed as the loose stored union (string, number, boolean, the two choice objects) or `null`, rather than `unknown`, so the web gets a real type for the answer.

**Total deviations:** 0 auto-fixed.

## Issues Encountered

- Biome flagged a local helper named `valueOf` (shadows a global) and a `1e400` literal in the test file; renamed to `parsedValue` and `Number.POSITIVE_INFINITY`. No behavior change.
- Gate: `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` ran 41 tasks, all successful; the contracts package alone is 15 files, 342 tests green.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or file access added; T-12-05 (a validator accepting what the stored type forbids) is mitigated and tested: `javascript:`/`data:`/`ftp:` links, DDD 01 phones, out-of-range and non-finite numbers, and option ids of another question are all refused.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 04 builds the `type` CHECK from `PROFILE_FORM_TYPES` and the length CHECKs from `PROFILE_FORM_LIMITS` (title 120, help 300, options 20, value 4096 bytes); the TypeScript half of PFORM-05 is pinned here.
- Plans 05 to 11 import everything from `@rede-social/contracts/profile-form`. The route hook can lift Zod messages with `PROFILE_FORM_ISSUE_SET`, as the payments module does with `PAYMENTS_ISSUE_SET`.
- The service enforces the 30-active-question limit (`limit_reached`), `type_locked`, `option_locked`, `stale_revision`, `form_changed`, and emits `unknown_question` and `other_required`-free field errors keyed by question id; those are not decided by the contract.
- Plan 12-01 (sketch 016, Igor's design-gate review) still has no SUMMARY and was not touched.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-29*

## Self-Check: PASSED

- Created files exist: `packages/contracts/src/profile-form.ts`, `packages/contracts/tests/profile-form.test.ts`.
- Commits `33e75291` and `47a5d4d7` exist; `git rev-list --count e5a1465a..HEAD` is 2 before this commit.
- Acceptance criteria re-run: `grep -c "profile-form" packages/contracts/package.json` prints 1; the test file has the boundary, adjacency, empty, encoding, ordering and precision titles; `PROFILE_FORM_TYPES` has 13 entries and `activeQuestions` is 30 (asserted); `grep -c "export const .*Schema"` prints 18; the strictness case for `publicAnswersSchema` is present.
- Plan verification: `vitest run tests/profile-form.test.ts` 83/83 and `turbo typecheck --filter=@rede-social/contracts` green.
