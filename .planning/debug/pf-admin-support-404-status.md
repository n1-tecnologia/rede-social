---
status: awaiting_human_verify
trigger: "Phase 12 Playwright: profile-form-admin.spec.ts:363 test 5 ('a support user does not see the row, and a typed URL meets the not-found page') — expect(response?.status()).toBe(404) received 200 when a support_tenant opens /configuracoes/formulario-de-perfil."
created: 2026-10-30T15:50:00Z
updated: 2026-10-30T16:45:00Z
---

## Current Focus

hypothesis: CONFIRMED candidate 1 (status-only; spec assertion defect). The page renders the not-found screen for the support user; Next streams loading.tsx first (200) and notFound() thrown by ProfileFormPage afterwards cannot change the status. No admin data reaches the support user.
test: done (throwaway probe, deleted; then the whole profile-form-admin.spec.ts on mobile-chromium)
expecting: n/a
next_action: orchestrator decides on the separate test-6 finding (outline hitArea measures 42px, not 44px, see Evidence); nothing else to do for this session
reasoning_checkpoint:
  hypothesis: "A support_tenant gets HTTP 200 on /configuracoes/formulario-de-perfil because the route's loading.tsx commits the shell before ProfileFormPage reaches notFound(), while the rendered screen is the app's 404 and no admin data is served."
  confirming_evidence:
    - "raw HTML for the support user: 200, loading skeleton present, <template data-dgst=NEXT_HTTP_ERROR_FALLBACK;404 ... stack ProfileFormPage>, meta robots noindex + next-error not-found"
    - "browser DOM for the support user: headings ['404','This page could not be found.'], 0 builder buttons, 0 marker text"
    - "a seeded question title is absent from the support HTML and RSC payload and present in both for the admin control (the detection works)"
    - "/configuracoes/rota-inexistente-xyz (no loading.tsx) answers a real 404; pagamentos/midia/moderacao (loading.tsx) answer 200 to the same user; media-video.spec.ts:76-91 documents the same effect"
  falsification_test: "the support DOM showing the builder, or the marker title in the HTML/RSC payload, would have meant candidate 2 (it did not)"
  fix_rationale: "assert what the user sees and that no admin data is sent, matching the repo precedent, instead of a status Next cannot give a streamed route"
  blind_spots: "production build (next start) was not run (disk); the streaming behaviour is the same mechanism but only dev was observed"
  candidate_causes:
    - "code: loading.tsx streaming commits 200 before notFound() (confirmed)"
    - "code/data: page gate or API permission missing so support is served the builder (refuted: marker absent, gate at page.tsx:42 and requirePermission on every profile_form route, composed for admin_tenant only)"
  and_gate: "no: one condition (streamed shell) fully explains the 200; the security candidate was refuted independently"

## Symptoms

expected: a support_tenant (staff, but not admin_tenant) never sees the 'Formulário de perfil' row on /configuracoes, and a typed URL /configuracoes/formulario-de-perfil meets the not-found page: HTTP 404 and no level-1 heading 'Formulário de perfil'.
actual: the first assertions pass (the row is absent from /configuracoes); `page.goto('/configuracoes/formulario-de-perfil')` answers HTTP 200 and the spec stops at `expect(response?.status()).toBe(404)` (spec line 363). What the page body shows was not captured in the first run.
errors: `expect(received).toBe(expected)` Expected 404, Received 200 (profile-form-admin.spec.ts:363). The same run also re-ran after quick 261030-g1y with the same result (reported by the executor, trace at apps/web/test-results/profile-form-admin-5-a-sup-b7bfa-RL-meets-the-not-found-page-mobile-chromium/trace.zip, may have been overwritten by later runs).
reproduction: `pnpm --filter @rede-social/web exec playwright test profile-form-admin.spec.ts --project=mobile-chromium -g "a support user"` against the local stack (Supabase up; Playwright starts the API and the web dev server). The spec is a serial group: tests 1-4 must run before it in a full file run, but test 5 only needs the support user it creates itself; check its own beforeAll/setup before running it alone.
started: first browser run of the Phase 12 specs, 2026-10-30. Never ran before. Test 6 (320px and 390px backstops of the list, sheet, dialogs, archived list) did not run because the serial group stopped at test 5; run it after the fix.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-10-30T15:50:00Z
  note: the page is apps/web/app/(app)/configuracoes/formulario-de-perfil/page.tsx (admin lane). Other admin-only pages in the repo return not-found for the wrong role; look at how they do it (notFound() vs redirect) and at not-found.tsx under (app). Next 16 streaming: a not-found thrown inside a Suspense boundary or after `loading.tsx` has flushed keeps status 200; a notFound() thrown before any flush returns 404. `loading.tsx` exists in this route folder, which makes the streamed-200 candidate plausible. SECURITY ANGLE: whichever candidate holds, confirm that no admin_tenant data (questions, counts, member emails, answers) is in the HTML or RSC payload served to the support user.

- timestamp: 2026-10-30T16:20:00Z
  checked: throwaway probe apps/web/e2e/zz-probe-pf404.spec.ts (2 runs, mobile-chromium, lab host). A support_tenant (created by createAccount) opens the page; a marker question titled `<prefix> MARKERQUESTION` was seeded in the lab form; an admin control opens the same URL.
  found: |
    SUPPORT, raw HTML (context.request.get, no JS): HTTP 200, 290 607 bytes; `data-profile-form-loading` present (the role-neutral loading.tsx shell flushed first); a `<template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404" ... stack: ProfileFormPage>` (the server render threw notFound() AFTER the shell was flushed); `<meta name="robots" content="noindex">` and `<meta name="next-error" content="not-found">`. MARKER question title: ABSENT from the HTML and from the RSC payload (RSC request: also 200, contains the 404 digest, no marker). The strings "Adicionar pergunta"/"Formulário de perfil" appear only inside the escaped next-intl messages JSON (the static pt-BR catalog every page ships; context shown by the probe: `actions.add = "Adicionar pergunta"`), never as an element.
    SUPPORT, browser: goto status 200; final DOM headings ["404", "This page could not be found."]; 0 "Adicionar pergunta" buttons; 0 marker text; 0 loading skeleton left.
    ADMIN control, same URL: HTTP 200, marker present in the HTML and in the RSC payload, no 404 digest -> the marker detection works, so its absence for support is real.
    CONTROLS: /configuracoes/rota-inexistente-xyz -> 404 (no loading.tsx on it). /configuracoes/pagamentos, /midia, /moderacao (admin-only pages that also have loading.tsx) ALSO answer 200 to the support user with the aria-busy skeleton in the HTML; /marca and /regras (no loading skeleton) answer 200 too in this probe (not examined further).
  implication: |
    STATEMENT BEFORE ANY EDIT — CANDIDATE 1 HOLDS (status-only, spec assertion defect). The page renders the app's not-found screen for the support user; the 200 is Next streaming (loading.tsx commits the shell, then notFound() throws inside ProfileFormPage, which can no longer change the status). SECURITY ANSWER: NO, the support user receives NO admin data: not in the HTML, not in the RSC payload (the seeded question title is absent for support and present for admin). Two gates are in the way: the page gate (`bootstrap.permissions.includes('profile_form.manage')`, composed for admin_tenant only; page.tsx:42 runs before any admin read) and the API's requirePermission('profile_form.manage') + requireModule on every profile_form route. Same cause and same precedent as apps/web/e2e/media-video.spec.ts:76-91 (assert the rendered screen, not response.status()).
  fix plan: replace the status assertion in profile-form-admin.spec.ts test 5 by the rendered-screen assertion (heading "404" visible, no level-1 "Formulário de perfil", no "Adicionar pergunta" button) plus a data check on the raw response (a seeded question title never reaches the support user).

- timestamp: 2026-10-30T16:40:00Z
  checked: whole apps/web/e2e/profile-form-admin.spec.ts on mobile-chromium after the fix (single run)
  found: 5 passed (tests 1-5, test 5 in 1.3s), test 6 at 320px FAILED, test 6 at 390px did not run (serial group). Failure: `the control answers a tap over only 42px, not 44px: {"visible":36,"run":42,"first":299,"last":340,"mid":320}` from expectScreenFits at profile-form-admin.spec.ts:431 (list at 320px). By elimination the control is "Exportar respostas (CSV)" (ExportDialog.tsx:94-102: Button variant="outline" size="sm" hitArea; Reordenar/Adicionar are size md = 44px).
  implication: |
    NEW FINDING, UNRELATED TO THE 404 STATUS (a product touch-target defect, not caused by this fix). A follow-up probe (throwaway, deleted) walked elementFromPoint down the button's centre at 320, 390 and 430px: the button box is 302..338 (36px), its transparent ::after answers a tap over 299..340 (42px) at every width; the card above/below (overflow-hidden, p-4) answers outside that. Cause: the shared HIT_AREA in packages/ui/src/primitives/buttonClasses.ts is `after:absolute after:inset-x-0 after:-inset-y-1`; an absolutely positioned pseudo-element is offset from the PADDING box, and the `outline` variant has `border` (1px), so the extension is 4px from the padding edge = 3px beyond the visible edge, 36 + 3 + 3 = 42. Variants without a border (brand, secondary, ghost, danger) reach exactly 44. The doc comment of HIT_AREA promises 44px.
    Not fixed here (shared UI primitive used app-wide, outside this session's scope; the orchestrator asked to report). Suggested fix: make the pseudo-element a centred 44px box that ignores the border, e.g. `after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2`, plus a unit assertion on the class string if one exists. Test 6 stops at its first failure, so other hitArea outline buttons later in the test (ArchivedList.tsx:197, and the dialogs) may fail the same way once this one is fixed; tests 6@390px was never reached.

## Resolution

root_cause: "Next 16 streams the route: apps/web/app/(app)/configuracoes/formulario-de-perfil/loading.tsx commits the shell with HTTP 200, and ProfileFormPage then throws notFound() (page.tsx:42) after the flush, which cannot change the status. The user sees the app's not-found screen; the spec asserted a status that a streamed route cannot have. NOT a product defect: the support user receives no admin data (page gate on profile_form.manage, composed for admin_tenant only; API requirePermission + requireModule on every profile_form route)."
fix: "apps/web/e2e/profile-form-admin.spec.ts test 5: replaced expect(response.status()).toBe(404) with the rendered-screen assertions of the media-video.spec.ts precedent (heading 404 visible, no level-1 'Formulário de perfil', no 'Adicionar pergunta' button, no 403/Forbidden/Acesso negado text) and a data check: a seeded admin question title must not appear in the support user's HTML or RSC payload."
verification:
  target_test: { result: pass, note: "test 5 passes in the whole-file run (1.3s); before, the original assertion failed with 200 in the executor's two runs and in my probe (GOTO status 200)" }
  mutation_check: { result: skipped, reason_if_skipped: "no Stryker for Playwright specs", mutant_killed: n/a }
  no_op_deletion: { result: flagged, deletion_justified_by_rca: true, note: "one assertion (status 404) removed; it asserted an impossible value for a streamed route; replaced by stricter checks (rendered 404, no builder, no seeded title in HTML/RSC). Detection proven live: the same title IS present in the admin's HTML and RSC payload in the probe." }
  adjacent_tests: { result: pass, note: "biome check and tsc --noEmit --incremental false clean; tests 1-4 of the same file pass; test 6 fails for an unrelated reason (see Evidence, hitArea outline 42px)" }
  revert_reconfirm: { result: pass, note: "the original assertion is the revert: 200 != 404 reproduced three times (two executor runs, one probe)" }
  guardrail_verdict: accepted
files_changed: [apps/web/e2e/profile-form-admin.spec.ts]
commit: 131ff69c

## Constraints (from the orchestrator)

- Say which candidate holds BEFORE changing anything. Investigate root cause first.
- If it is only the HTTP status of a correctly rendered not-found screen (candidate 1, with no admin data leaked), the assertion should check what the user sees (the not-found screen and no level-1 'Formulário de perfil' heading) instead of the status; look at how other specs in apps/web/e2e assert not-found pages and match that. Apply that spec change.
- If the support user is actually served the page or any admin data (candidate 2), that is a PRODUCT SECURITY defect: fix it in the product with a test (the tenant-isolation and role gates are the core value of this project), and tell the orchestrator clearly.
- Disk about 15 GiB free: single Playwright specs, targeted vitest, `tsc --noEmit --incremental false`, biome only. NEVER supabase db reset, pnpm db:reset, db:seed, next build, pnpm verify, integration suite or pgTAP. Do not read .env.local files (a hook blocks it).
- Commits: path-scoped (git add <paths>; git commit -- <paths>), author igor.vboas, NO Co-Authored-By trailer, no mention of Claude or Anthropic; never stage untracked .claude/, .planning/ or stray root files with code commits.
- Do not edit 12-VERIFICATION.md or 12-UAT.md. Do not touch IN-01..IN-04 of the Phase 12 review.
- After the fix, run the WHOLE profile-form-admin.spec.ts once on mobile-chromium (also proves test 6, the 320px and 390px backstops, which never ran). Report any new failure as a finding; do not paper over it. Ports 3000/8787 are free right now.
