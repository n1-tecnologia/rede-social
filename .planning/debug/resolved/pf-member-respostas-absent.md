---
status: resolved
trigger: "Phase 12 Playwright: profile-form-member.spec.ts:331 test 4 ('Minhas respostas' on /perfil) — GET /perfil answers 200 with no redirect, but locator('#respostas') never appears in 10 s (expected text 'Analista')."
created: 2026-10-30T15:00:00Z
updated: 2026-10-30T15:45:00Z
---

## Current Focus

hypothesis: CONFIRMED (spec defect). The spec locator `#respostas` addresses a DOM id the product never renders. `ProfileSection` (apps/web/components/profile/ProfileSection.tsx:50) turns its `id` prop into `data-profile-section="respostas"` and the heading id `profile-respostas-title`, never `id="respostas"`. The section IS on the page (Playwright error-context snapshot shows region "Minhas respostas" with Analista, "Visível no seu perfil", Recife).
test: replace the five `#respostas` locators in profile-form-member.spec.ts with `[data-profile-section="respostas"]` (the convention profile.spec.ts already uses for the other /perfil sections), re-run test 4 alone
expecting: test 4 passes (or fails further down on a different assertion, which is then a new finding)
next_action: edit apps/web/e2e/profile-form-member.spec.ts lines 361, 378, 395, 550, 553 and re-run `-g "Minhas respostas"`
reasoning_checkpoint:
  hypothesis: "test 4 fails because `page.locator('#respostas')` matches no element: ProfileSection never emits an id attribute equal to its `id` prop, only data-profile-section"
  confirming_evidence:
    - "error-context.md page snapshot taken at the failure shows the region 'Minhas respostas' rendered with the three expected texts, so the section exists and loadMyAnswers returned ok"
    - "ProfileSection.tsx line 50 is `<section aria-labelledby={titleId} data-profile-section={id}>`; the h2 gets id `profile-respostas-title`; no element gets id `respostas`"
    - "e2e/profile.spec.ts addresses every other /perfil section as `[data-profile-section=\"events\"]` etc.; ProfileSection's doc comment says the fixed key exists 'so a spec can address it'"
  falsification_test: "with the locator changed to [data-profile-section=\"respostas\"] test 4 still reports the section not found (then the section is only in a not-yet-resolved Suspense or absent)"
  fix_rationale: "UI-D-590 asks for `ProfileSection id=\"respostas\"` (the prop), which the product honours; the only wrong party is the spec's CSS id selector. Adding a DOM id to ProfileSection would change four sections' markup for a test convenience"
  blind_spots: "assertions after line 362 (marker count, Editar flow, notice) never ran; they may expose further defects"
  candidate_causes:
    - "code (spec): wrong selector for a data-attribute keyed section"
    - "code (product): ProfileSection missing a DOM id the UI-SPEC wanted as anchor target (the error card links /perfil#respostas)"
    - "environment/data: module flag or stale bootstrap hiding the section (eliminated: section is on the page)"
  and_gate: "no - one condition (the selector) fully explains the failure; the snapshot shows every product-side precondition satisfied"

## Symptoms

expected: after a member answered a required public short_text question ('Analista'), a private one ('Recife') and an archived one, /perfil shows a '#respostas' section ('Minhas respostas') containing 'Analista' and the private answer, one 'Visível no seu perfil' marker (the archived question is not listed).
actual: /perfil answers 200, no redirect, but locator('#respostas') is not found within 10 s.
errors: Playwright `expect(locator('#respostas')).toContainText('Analista')` -> element(s) not found (spec line 362). No API error in the trace (only /perfil 200 and three /v1/media 302s).
reproduction: `pnpm --filter @rede-social/web exec playwright test profile-form-member.spec.ts --project=mobile-chromium -g "Minhas respostas"` against the local stack (Supabase up; Playwright starts the API and the web dev server). The first full run was on the tree BEFORE quick 261030-g1y; tests 1-3 of the same file passed, tests 5-7 did not run (serial group).
started: first browser run of the Phase 12 specs, 2026-10-30. Never ran before.

## Eliminated

- hypothesis: (1) bootstrap.profileForm undefined / stale, so showAnswers is false
  evidence: the page snapshot at failure time contains the "Minhas respostas" region, which renders only when formSurfaces.showAnswers is true
  timestamp: 2026-10-30
- hypothesis: (2) loadMyAnswers returned 'empty', so MyAnswersSection returned null
  evidence: the region shows the three rows (Cargo no perfil/Analista/Visível no seu perfil, Cidade reservada/Recife), so status was 'ok' with answered rows
  timestamp: 2026-10-30
- hypothesis: (3) the section is stuck in a Suspense that never resolves
  evidence: the snapshot shows the resolved content, not MyAnswersSkeleton
  timestamp: 2026-10-30

## Evidence

- timestamp: 2026-10-30T15:20:00Z
  checked: re-ran test 4 alone on the current tree (after quick 261030-g1y), `-g "Minhas respostas"`, mobile-chromium; read test-results/.../error-context.md
  found: fails again, deterministically, at spec line 362 with "element(s) not found" for locator('#respostas'); the page snapshot at that instant contains `region "Minhas respostas"` with heading, the "Editar minhas respostas" link and the text "e2epf-... 40 Cargo no perfil Analista Visível no seu perfil e2epf-... 41 Cidade reservada Recife". The archived question is absent. No redirect, member sees /perfil.
  implication: the product renders the section correctly; none of the three candidates holds. ProfileSection emits data-profile-section="respostas" and heading id profile-respostas-title but no id="respostas", so the CSS id selector can never match. Spec defect (UI-D-590 says `ProfileSection id="respostas"`, the prop).
- timestamp: 2026-10-30T15:00:00Z
  note: apps/web/app/(app)/perfil/page.tsx renders MyAnswersSection only when formSurfaces.showAnswers; apps/web/lib/profile-form/profile-surfaces.ts returns showAnswers = (role === 'member' && profileForm !== undefined). MyAnswersSection (apps/web/components/profile-form/MyAnswersSection.tsx) returns null when loadMyAnswers returns status 'empty'; the three branches that render it all carry id="respostas". The local DB after the run holds no profile_form rows (the spec sweeps its own), so the state at failure time cannot be read back; re-run and inspect while it fails.

## Resolution

root_cause: SPEC defect. profile-form-member.spec.ts addressed "Minhas respostas" with the CSS id selector `#respostas`, but ProfileSection renders `<section data-profile-section="respostas" aria-labelledby="profile-respostas-title">`: the `id` prop never becomes a DOM id. The product (UI-D-590 asks for `ProfileSection id="respostas"`, the prop) is correct and the section was on the page when the test failed.
fix: apps/web/e2e/profile-form-member.spec.ts — one constant `MY_ANSWERS = '[data-profile-section="respostas"]'` (the convention profile.spec.ts already uses) replaces the five `#respostas` locators (test 4 x3, test 6 x2).
verification: |
  Revert proof: the first run (same tree, selector `#respostas`) failed deterministically at spec line 362; the same test with the constant passes.
  Test 4 alone (-g "Minhas respostas", mobile-chromium): 1 passed (4.6 s) — every assertion after line 362 ran for the first time and holds (marker count 1, archived answer absent, no notice, Editar -> /completar-perfil?next=%2Fperfil with Cancelar, save back to /perfil showing Diretora, new-questions notice, "Agora não" stored and kept after reload).
  Whole profile-form-member.spec.ts on mobile-chromium (one run): 7 passed in 27 s (tests 1, 2, 3, 4, 5, 6 at 320px, 6 at 390px); afterAll's snapshot equality held, so the module row and the e2epf- rows were restored. The ECONNRESET "aborted" lines in the web-server log are the navigations that gotoWhileRedirected tolerates.
  biome check clean, `tsc --noEmit --incremental false` in apps/web clean.
  Guardrail: spec-only change, no product code touched; a product mutation signal does not apply.
files_changed:
  - apps/web/e2e/profile-form-member.spec.ts
commit: c1f1780f (path-scoped, no trailer)

## Constraints (from the orchestrator)

- Investigate root cause first. Fix only a PRODUCT defect; report a SPEC defect separately and propose the spec change (apply it only if it is a plain test-harness fix inside apps/web/e2e/).
- Disk about 15 GiB free: single Playwright specs, targeted vitest, `tsc --noEmit --incremental false`, biome only. NEVER supabase db reset, pnpm db:reset, db:seed, next build, pnpm verify, integration suite or pgTAP. Do not read .env.local files (a hook blocks it).
- Commits: path-scoped (git add <paths>; git commit -- <paths>), author igor.vboas, NO Co-Authored-By trailer, no mention of Claude or Anthropic; never stage untracked .claude/, .planning/ or stray root files with code commits.
- Do not edit 12-VERIFICATION.md or 12-UAT.md. Do not touch IN-01..IN-04 of the Phase 12 review. Do not diagnose profile-form-admin.spec.ts test 5 here (separate session `pf-admin-support-404-status`), and do not run it concurrently: both use ports 3000/8787.
