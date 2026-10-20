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
