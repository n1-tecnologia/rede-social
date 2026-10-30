---
phase: 12-formulario-de-perfil-do-tenant
plan: 14
subsystem: web
tags: [profile-form, profile-surfaces, my-answers, public-answers, staff-answers, answer-mapper, notice, D-584, D-586, D-593, UI-D-589, UI-D-590, UI-D-591, UI-D-592, UI-D-593, T-12-32, tracer]

requires:
  - phase: 12-formulario-de-perfil-do-tenant
    provides: "plan 03 the contract (memberFormSchema, publicAnswersSchema, staffAnswersSchema, dismissNoticeResultSchema), plan 06 GET /v1/me/profile-form and POST /v1/me/profile-form/dismiss-notice, plan 07 GET /v1/members/{id}/profile-answers (member or staff payload, one bare 404 for every miss), plan 12 the member screen and getMemberForm, plan 13 phoneMask and the pt-BR number helpers"
provides:
  - "answerView: the one pure mapper from a question and a stored value to a view (text, link, rating) for all thirteen types; a link only for http(s); a date by string splitting; a pt-BR number and phone mask"
  - "AnswerValue: renders that view as React text (the anchor with the exact attributes, five aria-hidden stars, line breaks kept, long words wrapped)"
  - "loadMyAnswers and loadMemberAnswers: readers that never throw (ok / empty / error and ok / absent / error)"
  - "MyAnswersSection on /perfil (module on, member role): rows, the public caption, details above four rows, the shipped empty and error cards, its own Suspense skeleton"
  - "NewQuestionsNotice and dismissNoticeAction: the dismissible notice, dismissed on the server, optimistic with a restore and toast on failure"
  - "PublicAnswersBlock, StaffAnswersBlock and MemberAnswersBlock on /membros/[membershipId], each read in its own Suspense after the base profile"
  - "profileForm.profile catalog branch (answers, values, newQuestions, public, staff)"
affects: [12-15, 12-16, 12-17, 12-18, profile-form]

actuals:
  tokens: 27000
  tasks: 3
  commits: 3
plan_head_before: a3fc594c85014f5e6e8ef5b995e2a3301d98045d

tech-stack:
  added: []
  patterns:
    - "One mapper decides how a stored answer reads; the catalog words (Sim, Não, Aceito, rating, Outro) come in as a small AnswerWords object, so the mapper holds no copy and every surface shares one reviewed rule"
    - "A profile loader that runs inside a Suspense never throws and never redirects: it returns a status and the block turns a failure into a small card with a retry"
    - "A block that picks by the viewer's role calls its sibling async components as functions (await Block(props)) so the tree it returns has nothing left to resolve, which makes it testable without a server runtime"
    - "A page with streamed blocks is tested through react-dom/server.browser renderToReadableStream and allReady, so each Suspense really resolves against the real catalog"

key-files:
  created:
    - apps/web/lib/profile-form/answer-view.ts
    - apps/web/lib/profile-form/answer-view.test.ts
    - apps/web/lib/profile-form/profile-reads.ts
    - apps/web/lib/profile-form/profile-reads.test.ts
    - apps/web/lib/profile-form/profile-surfaces.ts
    - apps/web/lib/profile-form/profile-surfaces.test.ts
    - apps/web/components/profile-form/AnswerValue.tsx
    - apps/web/components/profile-form/AnswerValue.test.tsx
    - apps/web/components/profile-form/MyAnswersSection.tsx
    - apps/web/components/profile-form/MyAnswersSection.test.tsx
    - apps/web/components/profile-form/NewQuestionsNotice.tsx
    - apps/web/components/profile-form/NewQuestionsNotice.test.tsx
    - apps/web/components/profile-form/PublicAnswersBlock.tsx
    - apps/web/components/profile-form/StaffAnswersBlock.tsx
    - apps/web/components/profile-form/MemberAnswersBlock.tsx
    - apps/web/components/profile-form/AnswersBlocks.test.tsx
    - apps/web/app/(app)/perfil/profile-form-actions.ts
    - apps/web/app/(app)/perfil/profile-form-actions.test.ts
    - apps/web/app/(app)/membros/[membershipId]/page.test.tsx
    - apps/web/messages/pt-BR/profileForm.profile.json
  modified:
    - apps/web/app/(app)/perfil/page.tsx
    - apps/web/app/(app)/membros/[membershipId]/page.tsx
    - apps/web/i18n/profile-form-messages.test.ts

key-decisions:
  - "answerView takes the catalog words as a third argument (AnswerWords: yes, no, accepted, other, rating) instead of the plan's two-argument signature, so the pure mapper holds no pt-BR copy and the date/number/link rules stay testable without a catalog"
  - "loadMyAnswers takes the same words; its rows carry the resolved view, so MyAnswersSection never touches a raw stored value"
  - "A null view is 'Sem resposta' for the member and the staff, and a skipped row for another member (a stored shape that does not fit its type is never guessed at)"
  - "Staff 'answered nothing' is decided by whether any row has a view, so one sentence replaces the list even when active questions exist (the sketch's staff-sem-respostas frame)"
  - "MemberAnswersBlock renders by the viewer's role AND the payload kind: a member never renders a staff payload and staff never render a member one, whatever the API sent"
  - "The skeleton of Minhas respostas has no title, so a member of a tenant with the module on and no question does not see a heading flash and vanish; the section brings its title with its content"
  - "The completeness card and the notice share one px-4 flex-col gap-3 container, so the notice sits directly under the card (or alone in its place) instead of a 32px gap away"
  - "Loaders log the error class name only, never a message, because a message could echo a stored value (T-12-30)"

patterns-established:
  - "profileFormSurfaces(role, bootstrap.profileForm) is the one gate for the two /perfil surfaces: member role and the bootstrap block present; the notice needs newOptional above zero"
  - "A client notice calls a server action, hides itself first and restores itself on a false or thrown result"

requirements-completed: [PFORM-16, PFORM-18, PFORM-19]

coverage:
  - id: D1
    description: "One mapper renders all thirteen types as React text: text with line breaks, choice labels in the admin's order with 'Outro: texto', a pt-BR number, a date dd/MM/yyyy with no time-zone shift (same text under four zones), a masked phone, an e-mail as text, a link only for http(s) with every other scheme as text, Sim/Não, Aceito, '{n} de 5' with five aria-hidden stars"
    requirement: "PFORM-20"
    verification:
      - kind: unit
        ref: "apps/web/lib/profile-form/answer-view.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/components/profile-form/AnswerValue.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "A member reads her own answers on /perfil in the admin's order with the public caption only on public rows, 'Sem resposta' for an unanswered one, a native details above four rows ('Ver todas (6)' / 'Mostrar menos'), the shipped empty card with 'Responder', the error card with a retry, the 'Editar' link to /completar-perfil?next=%2Fperfil, and nothing when no question is active"
    requirement: "PFORM-20"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/MyAnswersSection.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/profile-reads.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The notice shows only to a member with the module on and news (singular and plural copy, exact 'Responder' target, neutral disc); 'Agora não' hides it at once, calls the server action once, and restores it with the toast when the write fails or throws; the action posts to dismiss-notice and follows the shipped navigation for a refused session"
    requirement: "PFORM-16"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/NewQuestionsNotice.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/perfil/profile-form-actions.test.ts"
        status: pass
      - kind: unit
        ref: "apps/web/lib/profile-form/profile-surfaces.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Another member's page shows 'Sobre {name}' with the public answered rows only (absent with none), staff see 'Respostas do formulário' with active rows, 'Sem resposta', the pills, the 'Perguntas arquivadas' sub-heading only when one exists, or the one sentence; a failed read is only a small error row and the base profile still renders; the API's bare 404 is no block; own membership still redirects and a miss is still the one notFound"
    requirement: "PFORM-18"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/AnswersBlocks.test.tsx"
        status: pass
      - kind: unit
        ref: "apps/web/app/(app)/membros/[membershipId]/page.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "The staff view of every answer with the privacy markers"
    requirement: "PFORM-19"
    verification:
      - kind: unit
        ref: "apps/web/components/profile-form/AnswersBlocks.test.tsx#StaffAnswersBlock (UI-D-593)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The catalog branch profileForm.profile is pinned verbatim to the approved Copywriting Contract (25 plain strings, interpolations, the notice plural)"
    requirement: "PFORM-26"
    verification:
      - kind: unit
        ref: "apps/web/i18n/profile-form-messages.test.ts#profileForm.profile.json (12-14)"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh"
        status: pass
    human_judgment: false
  - id: D7
    description: "The surfaces read right at 320px and 390px under a tenant brand (a 1000-character long-text answer wrapping with its line breaks, a long Link address, the notice beside the completeness card, the details collapse) and match sketch 016"
    requirement: "PFORM-20"
    verification: []
    human_judgment: true
    rationale: "Layout, wrapping and brand fidelity are the 320px Playwright run and the manual rows of plan 18; no screenshot was taken here (no dev server and no Playwright on this disk). The wrap classes (break-words, wrap-anywhere, whitespace-pre-line, min-w-0) are asserted, not rendered."

duration: 13min
completed: 2026-10-30
status: complete
---

# Phase 12 Plan 14: The profile's side of the form Summary

**A member reads and edits her answers from "Minhas respostas", waves the "Há perguntas novas" notice away on the server, and sees only what the admin made public on other members' pages, while staff see every answer with the privacy markers, all through one answer mapper that turns nothing a member typed into markup.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-30T02:00:30Z
- **Completed:** 2026-10-30T02:13:30Z
- **Tasks:** 3 (1 tracer, 2 auto)
- **Files modified:** 23 (20 created, 3 modified)

## Accomplishments

- Tracer (Task 1): `answerView` maps all thirteen types, `loadMyAnswers` reads the member form without ever throwing, and `MyAnswersSection` renders "Minhas respostas" on `/perfil` from the loader to the rendered, collapsible, empty and error-handled section, with the "Editar" link back to `/completar-perfil?next=%2Fperfil`.
- Task 2: `dismissNoticeAction` (server-side "Agora não") and `NewQuestionsNotice` in the completeness card's mould with a neutral disc; it hides at once and restores itself with the toast on failure. The page puts it directly under the completeness card, or alone in its place.
- Task 3: `PublicAnswersBlock` ("Sobre {name}", absent when empty), `StaffAnswersBlock` (active rows, "Sem resposta", "Público no perfil", the "Perguntas arquivadas" sub-heading only when needed, the one-sentence empty) and `MemberAnswersBlock`, each in its own `Suspense` after the base profile; a failed read is a small row with a retry and the base profile still renders (proved through the streaming renderer).
- T-12-32: a link anchor exists only for a validated http(s) address with `rel="noopener noreferrer nofollow ugc"`; `javascript:`, `data:`, `ftp:`, `mailto:`, `file:` and relative addresses are text; an e-mail is text; markup-looking text stays text; `dangerouslySetInnerHTML` appears nowhere.

## Task Commits

1. **Task 1: [tracer] Minhas respostas on /perfil through the one answer mapper** - `b5263393` (feat)
2. **Task 2: the Há perguntas novas notice and its server-side dismissal** - `0b8c29fd` (feat)
3. **Task 3: the public and staff answers blocks on another member's page** - `4791f2f9` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `apps/web/lib/profile-form/answer-view.ts` - the one mapper, `answerWordsFrom`, `isoDayToBr`
- `apps/web/lib/profile-form/profile-reads.ts` - `loadMyAnswers`, `loadMemberAnswers` (ok / empty / absent / error)
- `apps/web/lib/profile-form/profile-surfaces.ts` - the member-role-with-module gate for the two `/perfil` surfaces
- `apps/web/components/profile-form/AnswerValue.tsx`, `MyAnswersSection.tsx`, `NewQuestionsNotice.tsx` - the renderer, the section and the notice
- `apps/web/components/profile-form/PublicAnswersBlock.tsx`, `StaffAnswersBlock.tsx`, `MemberAnswersBlock.tsx` - the two blocks, the role picker with the skeleton and the error row
- `apps/web/app/(app)/perfil/profile-form-actions.ts` - `dismissNoticeAction`
- `apps/web/app/(app)/perfil/page.tsx`, `apps/web/app/(app)/membros/[membershipId]/page.tsx` - the new slots
- `apps/web/messages/pt-BR/profileForm.profile.json` - every word of these surfaces
- Tests: one beside each module, `AnswersBlocks.test.tsx`, the membros `page.test.tsx`, and the catalog test gained a `profileForm.profile` block

## Decisions Made

See `key-decisions`. In short: the mapper takes the catalog words as an argument, a null view means "Sem resposta" or a skipped row by surface, the role and the payload kind must agree before a block renders, the skeleton carries no title, and the loaders log an error class only.

## Deviations from Plan

### Plan-sanctioned variations

- **`answerView(question, value, words)` has a third argument.** The plan names a two-argument mapper; the pt-BR words (Sim, Não, Aceito, "{n} de 5", "Outro: {text}") must come from the catalog and the mapper returns them already resolved, so the words are passed in. `loadMyAnswers(words)` takes them for the same reason.
- **Three files the plan does not list:** `lib/profile-form/profile-surfaces.ts` (+ test), so the "member role with the module on, notice only above zero" rule is one tested function instead of a page condition; `components/profile-form/MemberAnswersBlock.tsx`, the role picker, skeleton and error row the two blocks share; `app/(app)/perfil/profile-form-actions.test.ts`, the action's test.
- **The membros page had no existing test**, so `page.test.tsx` is new. It renders the whole page through `renderToReadableStream` with the real blocks and catalog and only the API boundary stubbed.
- **The notice and the completeness card share one container** (`flex flex-col gap-3 px-4`) so the notice sits directly under the card as the sketch shows; the card's markup is unchanged.
- **Minhas respostas' skeleton has no section title** (the fallback is the three rows) so a tenant with the module on and no question never sees a heading appear and vanish.

### Auto-fixed Issues

**1. [Rule 1 - Bug] Async child components do not resolve under a client render**
- **Found during:** Task 3 (`AnswersBlocks.test.tsx`, three failures)
- **Issue:** `MemberAnswersData` returned `<PublicAnswersBlock/>`, `<StaffAnswersBlock/>` and `<AnswersErrorRow/>` elements; those are async components, which a client render (and the unit test) leaves empty.
- **Fix:** it now calls them as functions (`return PublicAnswersBlock({...})`), so one `await` yields a tree with nothing left to resolve; a Server Component renders it the same way.
- **Files modified:** `apps/web/components/profile-form/MemberAnswersBlock.tsx`
- **Verification:** `AnswersBlocks.test.tsx` 18 passed; the page test through the streaming renderer passes.
- **Committed in:** `4791f2f9`

---

**Total deviations:** 1 auto-fixed (1 bug), 5 plan-sanctioned variations
**Impact on plan:** None on scope; no new token, type, route or wire shape.

## Issues Encountered

- `tsc` flagged a typed-translator overload when the mapper's words were built from the typed `getTranslations` result; the translator is cast to the small `WordsTranslator` shape at the three call sites.

## Verification

- Sketch guard passes (`approved: true`).
- `vitest run lib/profile-form components/profile-form "app/(app)/membros" "app/(app)/perfil" i18n/profile-form-messages.test.ts`: 366 passed.
- `bash scripts/check-ui-literals.sh` clean; `biome check` clean on every touched folder; `tsc --noEmit` clean.
- Acceptance: `dangerouslySetInnerHTML` count is 0 in every profile-form `.tsx`; `dismiss-notice` appears 2 times in `profile-form-actions.ts`; `profile-answers` appears 2 times in `profile-reads.ts`; the mapper test asserts the same date text under four time zones; the notice test asserts the optimistic hide and the restore on failure; the staff test asserts the order active, sub-heading, archived with the pill; the page test asserts a failing answers read keeps the base profile.
- Repo gate `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`: 41 of 41 tasks successful. `apps/web/.next/cache` removed after the gate.
- Not run (disk, per instructions): Playwright, `next dev`, `turbo build`. The 320px wrapping of a 1000-character answer and of a long Link address (E08, E09, E10 long-text backstops), the details collapse and the notice beside the completeness card are plan 18's visual and manual rows.
- Free space on `/System/Volumes/Data` at the end: 4.7 GB.

## Known Stubs

None.

## Threat Flags

None. T-12-32 is mitigated as planned: the single mapper renders React text only; a link becomes an anchor only for `http:`/`https:` with `rel="noopener noreferrer nofollow ugc"`; no raw-HTML path exists (acceptance grep); an e-mail answer is text; unit cases cover a `javascript:` link (also mixed case), `data:`, `ftp:`, `mailto:`, `file:`, a relative path and markup-looking text. The public block renders only the API's strict payload (an extra key such as an e-mail makes the read an error, covered), a role/payload mismatch renders nothing, and no loader logs more than a status or an error class name.

## User Setup Required

None - no external service configuration required. Nothing was pushed and no hosted project was touched.

## Next Phase Readiness

- Plans 15 and 16 (admin) can reuse `AnswerValue` and `answerView` for any place that shows a stored answer.
- Plan 18 should add the 320px rows: a 1000-character long-text answer in "Minhas respostas", on another member's page and in the staff block; a very long Link answer; the notice with and without the completeness card; and a Playwright check that a slow answers read never delays the base profile.
- PFORM-20 and PFORM-26 stay open: other plans of the phase still declare them.

## Self-Check: PASSED

- Created files exist (20 files listed above); commits `b5263393`, `0b8c29fd` and `4791f2f9` exist; `git rev-list --count a3fc594c..HEAD` is 3 before this commit; no commit message carries a trailer or tool attribution; `.planning/sketches` untouched; no file was deleted.

---
*Phase: 12-formulario-de-perfil-do-tenant*
*Completed: 2026-10-30*
