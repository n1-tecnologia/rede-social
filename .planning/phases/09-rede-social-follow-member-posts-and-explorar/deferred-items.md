# Phase 09 deferred items

Out-of-scope discoveries logged by executors. Not fixed by the plan that found them.

## Found by 09-10 (2026-10-20)

- **`apps/web/e2e/admin-members.spec.ts` "role tracer" fails on both projects, before and independent of any 09-10 file.**
  The case opens `/configuracoes` as a plain rede-demo member and asserts `getByRole('link', { name: 'Membros' })` has count 0
  (`appMessages.app.settings.rows.members`). A link whose accessible name CONTAINS "Membros" is present (the locator is a substring
  match, so the member-area entry added by quick 261019-k7x, "Área de membros", is the likely match). 09-10 touches neither
  `/configuracoes` nor that catalog. The failure surfaced because `playwright test members.spec.ts` is a substring pattern that also
  selects `admin-members.spec.ts`. Fix belongs to a quick task: make the locator `exact: true` or scope it to the Administração group.

- **`apps/web/e2e/profile.spec.ts`: 5 cases x 2 projects fail on the local database (not reset since earlier plans).**
  "08.7: Sua atividade on the member's own numbers", "a community without Comunidades", and the three "Perfil - o painel do dono"
  "on real data" cases (Membros, Conteudo, Financeiro) read the nightly dashboard snapshot that the spec's `beforeAll` builds through
  `app.dashboard_build_snapshot`. On this database the member-activity blocks never render (`[data-activity-block]` count 0).
  Proven independent of 09-10: the same "Sua atividade" case was re-run with `/perfil/page.tsx` restored to its pre-plan content
  (HEAD) and failed the same way; rede-demo has `social` off, so none of the new social code is on that path. The other 119 cases of
  `social.spec.ts` + `profile.spec.ts` passed (3 skipped). The plan's verify command runs `pnpm db:reset && pnpm db:seed` first; that
  prefix was not run (no consent to reset), logged in WINDOWS.md as `unrun-verify`. Re-run on a freshly seeded database before
  treating these as real.

## Found by 09-11 (2026-10-20)

- **The four comment-id routes of the API still let an admin holding a blocked author's comment id read replies** (the 09-05 residual,
  `likeComment`, `unlikeComment`, `listReplies`, `getCommentThread`; fix = pass `canModerate` into them and add the author-liveness test
  to their post join, the way the post-id routes already do). It is API code in `packages/modules/feed/server/service.ts`, outside 09-11's
  `files_modified`, so it was not touched here. No member can reach it and nothing crosses a tenant. Left for the verifier / a quick task.
- **A member whose `member_profiles.display_name` is blank renders "Siga  para ver" and an avatar link with an empty name.** Real members
  have a name (the profile nudge), but the schema allows an empty string and the API returns it as is. The plan carries no fallback copy
  (the UI-SPEC catalog has one heading string), so the screen was left as specified. A fixture member made by the e2e `createMember` has
  exactly this state, which is how it was found; the e2e now names the throwaway author first.
- **No `apps/web/lib/feed.test.ts` existed** (the plan said "extend"); it was created, and covers only `loadPost`.


## Found by 09-13 (2026-10-20), the exit gate

The gate ran `TURBO_CACHE=local:r VIDEO_PROVIDER=fake pnpm verify`. Every stage through `db:reset` and `db:seed` passed (lint, typecheck,
build, unit, static routes, boundaries and the negative check, lanes, pgTAP 38 files / 2057 tests, integration 76 files / 1538 tests, the
spike). The web dev server then ran out of disk (ENOSPC) at e2e test 244 (mobile project), so the e2e stage was re-run by project in
chunks of about seven spec files, with `.next/dev`, `.next/cache` and `test-results` removed between chunks, on the same database. The
only e2e failures left are below, and none is a Phase 09 defect.

- **`apps/web/e2e/platform-domains.spec.ts` case 6 ("nine switches") was a Phase 09 regression and is fixed in 09-13.** It expected two
  "Desativado" switches (store, courses) and, after turning Feed off, three. Rede social ships OFF (09-01), so a new tenant has three off
  switches (four with Feed off). The count of ten switches was already updated by 09-01; these two counts were not. Fixed in
  `platform-domains.spec.ts`; passes on both projects (platform-domains + platform-wizard 18 passed).
- **`apps/web/e2e/admin-branding.spec.ts:303` (both projects)**: `setTenantLook` stores `branding.look` as a jsonb string. Already
  recorded in `08.6-area-de-membros/deferred-items.md` and WINDOWS 88.
- **`apps/web/e2e/platform-branding.spec.ts:223` (case 2, both projects; the three cases after it in the serial describe then do not run)**:
  the app-icon editor's "unreachable logo" step. Already recorded in `08.6-area-de-membros/deferred-items.md`. The other cases of the file pass
  with `--grep-invert "logo upload"` (6 passed, 2 skipped).
- **`apps/web/e2e/signup.spec.ts:331` (both projects)**: the generic-host signup link is re-homed by quick 261012-s0v. Already recorded in
  `08.3-cursos-.../deferred-items.md` and WINDOWS 84.
- **`apps/web/e2e/admin-members.spec.ts` "role tracer" (both projects)**: the substring locator `getByRole('link', { name: 'Membros' })`
  matches the "Área de membros" entry added by quick 261019-k7x. Recorded above (09-10); fix is `exact: true` in a quick task.
- **`apps/web/e2e/profile.spec.ts`: 5 cases x 2 projects fail on a database reset and seeded the SAME calendar day** (the 09-10 note said
  "re-evaluate after a fresh reset": this is the evaluation). Root cause: the seeded memberships and posts are created "now", and the
  nightly builder (`app.dashboard_build_snapshot`) counts members who joined and activity up to the end of the tenant-local yesterday, so
  on the day of the seed `dashboard_member_snapshots` holds 0 rows and the member-activity blocks never render. Proof: with `joined_at`
  moved back two days (local database, restored afterwards) four of the five cases pass on both projects (50 passed); the fifth ("Conteúdo
  on real data") also needs posts and likes older than today, and changing them was not allowed, so that one is the same cause by
  reading, not by run. Re-run on a seed older than a day. No Phase 09 file is on that path (the lab/demo posts it reads are organization posts).
- **`apps/web/e2e/courses-member.spec.ts:759` failed once in the first, interrupted pass and passed alone and in the chunked pass (both
  projects).** Treated as a flake under load; nothing to fix.
- **Carried, unchanged**: the four comment-id routes of the API still let an admin holding a blocked author's comment id read replies (09-05
  residual; WINDOWS 120), and a blank `display_name` renders "Siga  para ver" (WINDOWS 121). Both are in the sections above and stay for
  the verifier or a quick task.
