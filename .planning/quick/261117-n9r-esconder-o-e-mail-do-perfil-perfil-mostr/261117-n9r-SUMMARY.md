---
phase: quick-261117-n9r
plan: 01
subsystem: web-profile
tags: [fix, privacy, profile, perfil, quick]
status: complete
requirements: []
key-files:
  modified:
    - apps/web/app/(app)/perfil/page.tsx
    - apps/web/components/profile/ProfileHero.tsx
    - apps/web/components/profile/ProfileHero.test.tsx
    - apps/web/components/platform/preview/TenantAppPreview.tsx
    - apps/web/e2e/profile.spec.ts
    - apps/web/e2e/login.spec.ts
    - apps/web/e2e/shell.spec.ts
  created:
    - apps/web/app/(app)/perfil/page.test.tsx
commits: 3
plan_head_before: 75cd5a5f
actuals:
  tasks: 3
  commits: 3
---

# Quick 261117-n9r: the account e-mail on /perfil is the administrator's alone

On `/perfil` the account e-mail under the name is now handed to `ProfileHero` only when the viewer's role is `admin_tenant`; `member` and `support_tenant` get HTML that does not contain the string (decided on the server, not hidden by CSS).

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | a6d35fd0 | fix(web): /perfil shows the account e-mail only to the tenant administrator |
| 2 | 01880938 | fix(web): platform preview shows the sample e-mail in the administrator view only |
| 3 | ceade1c7 | test(web): e2e expect no e-mail on a member's /perfil and add the administrator case |

The measured count from the ledger base `75cd5a5f` also includes two unrelated docs commits made by another process during this run (`d265001c` 12.5 research, `0cb83020` 12.5 validation strategy); they are not part of this task. No commit carries a co-author trailer.

## What changed

- `page.tsx`: `showEmail = role === 'admin_tenant'`; `email={showEmail ? profile.email : undefined}`; docblock states the rule, why it lives on the page (the viewer's own role is already here, D-47; a server decision keeps the string out of the HTML), and that `support_tenant` is held back by the lowest-risk reading. `GET /v1/me/profile`, `ownProfileSchema` and `loadOwnProfile` are untouched (nothing changed under `packages/contracts`, `apps/api` or `apps/web/lib`).
- New `perfil/page.test.tsx`: real page, real `ProfileHero`, real catalog, real streaming renderer; bootstrap, own profile and the sections under the hero are stubbed. Reads the whole HTML: member and support_tenant never contain the e-mail, admin_tenant contains it exactly once after the name.
- `ProfileHero.tsx`: docblock and prop-doc only (no behavior change); skeleton docblock no longer calls the second bar "the e-mail", geometry unchanged. `ProfileHero.test.tsx`: claim 4 updated, new case 9 (no `email` prop or an empty one: no e-mail paragraph, hero paragraphs are just the bio, or none). Cases 1 to 8 untouched.
- `TenantAppPreview.tsx` (`PreviewProfile`): the sample e-mail shows in the administrator view only (`member ? undefined : ...`); docblock sentence added; the catalog key `sample.memberEmail` kept.
- e2e rewritten (not run): `profile.spec.ts` first PROF-01 test asserts the member's e-mail absent from `main`; E1/E2 empty hero paragraph count 1 -> 0 with its comment fixed; new test "the e-mail under the name is the administrator alone (2026-11-17)" (admin sees it once inside the hero, then a cleared session as the member sees none). `login.spec.ts` and `shell.spec.ts` now prove the identity by `main [data-profile-name]` ("Membro Rede Demo") and pin the member's e-mail absent from `main`; the shell test title now starts "/perfil: name, no e-mail, no role pill, ...".

## Red then green (page test)

Written before the gate and run against the unchanged page: the member and support_tenant cases FAILED (the hero's e-mail paragraph was in the HTML), the admin_tenant case passed. After the gate was added all three pass. No counts are claimed beyond that: the file ran with the 3 cases of the new file plus the two other test files vitest's filter matched, and all passed.

An early first run failed for a harness reason, not a behavior reason (the real `@/lib/api` pulls the env validation), fixed by stubbing `@/lib/api` the way the membros page test does. Case 9 of `ProfileHero.test.tsx` was first written with an at-sign check that tripped on the Instagram label (`@ana.souza`); it now asserts the paragraphs and the absence of the e-mail domain instead.

## Verification run

- `pnpm exec vitest run "perfil/page.test.tsx"` (apps/web): green after the gate. `vitest run components/profile/ProfileHero.test.tsx components/platform/preview`: 16 passed.
- `pnpm biome check` over the three e2e specs, the page and its test, `ProfileHero` and its test, `TenantAppPreview`: clean.
- `pnpm --filter @rede-social/web typecheck`: clean.
- The plan's grep gate (`getByText(users.demoMember)).toBeVisible` in the three specs): no match. `email={profile.email}` no longer appears in the page.

## NOT run

- The rewritten e2e cases (profile, login, shell specs) were written, type-checked and Biome-checked but NOT run. No Playwright, no local Supabase stack, no `db:reset`, no `next build`/dev, no push, no deploy. (`next typegen` ran as part of the `typecheck` script; `apps/web/.next` already existed and is gitignored.)

## Recorded, left as is

- **Dead `ProfileHeader` email prop:** `ProfileHeader.tsx` still has an optional `email` prop that no caller passes (`/membros/[membershipId]` passes none); its own test exercises it. Left in place (T-n9r-03, accepted).
- **Profile-form e-mail question type:** a profile-form question of type e-mail ("Minhas respostas", the answers blocks on `/membros/[id]`) is the member's own ANSWER with the admin-controlled `showOnProfile` privacy, not the account e-mail. Unchanged.
- **`/inicio` platform-host e-mail:** `app/(app)/inicio/page.tsx` shows the session's e-mail only in the `mode === 'platform'` branch (the super_admin on the platform shell). Unchanged.
- Administration screens that show e-mail (MemberAdminSheet, AdminMemberRow, event participants sheet, store buyers sheet, platform AdminsCard/wizard) are permission-gated and untouched.
- No payload of another member carries an e-mail (`memberProfileSchema` is `.strict()`), so the stop-and-record clause did not trigger.

## Deviations from Plan

None - plan executed as written (the two harness fixes above were inside the new tests).

## Ship note

Nothing pushed or deployed. The change ships with the next deploy together with Phase 12.5 and 261117-mvo (Mux Player bar).

## Known Stubs

None.

## Self-Check: PASSED

Files exist (page.test.tsx created, seven files modified) and commits a6d35fd0, 01880938, ceade1c7 are in `git log`.
