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

