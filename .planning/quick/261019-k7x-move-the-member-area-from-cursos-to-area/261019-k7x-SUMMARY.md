---
phase: quick-261019-k7x
plan: 01
subsystem: courses-member-area
tags: [courses, member-area, routing, nav, redirect, e2e, quick]
status: complete
requirements: [COURSE-16, COURSE-28]
commits: 3
plan_head_before: 05735d7b25a69e36b6f727317ea3434b47869b07
actuals:
  tokens: 90000
  tasks: 3
  commits: 3
key-files:
  created:
    - apps/web/lib/member-area.ts
    - apps/web/lib/member-area.test.ts
    - apps/web/app/(app)/area-membros/layout.tsx
    - apps/web/app/(app)/area-membros/page.tsx
    - apps/web/app/(app)/area-membros/loading.tsx
  modified:
    - apps/web/app/(app)/cursos/page.tsx
    - apps/web/app/(app)/cursos/tabs.ts
    - apps/web/lib/courses-member-view.ts
    - apps/web/app/(app)/layout.tsx
    - packages/core/ui/nav.ts
    - apps/web/messages/pt-BR/courses.json
    - apps/web/e2e/affected-map.json
decisions:
  - "QD-01 role-aware tab = host-side withTabOverrides after buildNav (kernel: NavItem.matches + withTabOverrides, names no module)"
  - "QD-02 /cursos split = server-side redirect() in the page, never next.config/proxy"
  - "QD-03 /area-membros/page.tsx imports the shipped member components from cursos/, no file moves"
  - "QD-04 admin preview lands on /area-membros?ver=aluno; PreviewBanner back link stays the hub /cursos"
  - "QD-05 role-neutral surfaces (courses not-found card, lesson not-found) keep bare /cursos and ride the redirect"
  - "QD-06 server-built push/bell urls untouched; only the web bell renderer's degrade-to-list fallback moved"
---

# Quick 261019-k7x: the member area moves from /cursos to /area-membros

The member side of the school area (Inicio, Cursos, Trilhas, Lives, Progresso) is now served at `/area-membros`. `/cursos` stays the admin authoring hub and redirects every non-manager to the new route. The bottom bar shows **Membros** (graduation-cap) to members and support_tenant, and keeps **Cursos** for admin_tenant.

Only the route prefix of 08.6 D-435 / D-400 changed. The five chips, the content and the locked-stays-visible rule (08.5 D-419..D-424) are untouched: no grid, shelf, lock or empty-school logic was edited. No file under `apps/api`, `supabase/` or `packages/core/db` was touched (checked with `git show --stat` over the three commits).

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | 2b611182 | feat(quick-261019-k7x): the member area lives at /area-membros |
| 2 | d2108359 | feat(quick-261019-k7x): role-aware Membros tab |
| 3 | 7c3140e5 | test(quick-261019-k7x): e2e for the /area-membros move (not executed) |

No co-author trailer on any of them. Every commit was path-scoped (`git add <exact paths>` then `git commit -- <same paths>`), with `git diff --cached --name-only` checked first.

## What changed

- **Task 1.** `apps/web/lib/member-area.ts` (zero-dependency leaf, `MEMBER_AREA_PATH`). New route `app/(app)/area-membros/{layout,page,loading}.tsx`: the layout does the module gate, the page repeats it, then splits by the composed `courses.manage` permission. A manager without `ver=aluno` is redirected to the hub tab named by `?aba=`. Everyone else gets `MemberCatalogue` (`preview={manage}`). `cursos/page.tsx` keeps the hub branch byte-for-byte and redirects the non-hub branch via the new `memberAreaRedirectHref` (only single non-empty `aba`/`categoria`/`trilha`, always URLSearchParams-encoded, path is the constant, `ver=aluno` appended last in preview). Rebased to `MEMBER_AREA_PATH`: `catalogueCategoryHref`, `MEMBER_LIVES_HREF`, `MEMBER_CATALOGUE_HREF`, `memberTracksHref`, the track href, the progress empty CTA, `memberTabHref`, ReminderToggle's lives fallback, the member course page back link, the member error card back link, and the bell renderer's degrade-to-list fallbacks. `/cursos/{id}`, `/cursos/{id}/aulas/{lessonId}` and `/cursos/lives/{id}` hrefs and `packages/modules/courses/server/notifications.ts` are untouched. `scripts/check-static-routes.sh` got the `/(app)/area-membros/page` key.
- **Task 2.** Kernel `packages/core/ui/nav.ts`: `NavItem.matches`, `TabOverride`, `withTabOverrides`, and `activeTabKey` now tests each tab's `href` plus its `matches` (longest path wins, first tab on a tie). Exported from `ui/index.ts`; the kernel names no module or route (`grep -c area-membros packages/core/ui/nav.ts` = 0). `memberAreaTabOverrides` in the web leaf (empty for a manager). `courses.memberNav = "Membros"` in the catalog (`nav` unchanged). `app/(app)/layout.tsx` wraps `buildNav(...)` with `withTabOverrides`. `packages/modules/courses/module.ts`: comment only, the `nav` object is byte-identical.
- **Task 3.** `courses-member-area.spec.ts` and `courses-member.spec.ts` moved to the area URLs; a new redirect-contract test (auto-retrying URL assertions only); school-off now also asserts `/area-membros` is the kernel not-found for the lab member and admin; phase4/5/6 smokes, shell.spec and reels.spec expect **Membros** for the demo member; the shell 08.5-11 tab test now checks the tab goes to `/area-membros`, is current there and on `/cursos/<unknown uuid>`, and Inicio is not current. `affected-map.json`: `apps/web/app/(app)/area-membros/**` and `apps/web/lib/member-area*` added to `courses-web`, and `reels.spec.ts` plus the three phase smokes added to that group's specs (they read the tab label). `packages/core/**` and `apps/web/app/(app)/layout.tsx` were already in `shared`, so no kernel glob was needed.

## Gates run

| Gate | Command | Result |
|------|---------|--------|
| Task 1 unit | `pnpm --filter @rede-social/web exec vitest run lib/member-area.test.ts lib/courses-member-view.test.ts lib/notifications-view.test.ts "app/(app)/cursos/tabs.test.ts" "app/(app)/cursos/ReminderToggle.test.tsx"` | 5 files, 185 tests passed |
| Web typecheck (after Task 1, 2 and 3) | `pnpm --filter @rede-social/web typecheck` | clean |
| Task 2 core unit | `pnpm --filter @rede-social/core exec vitest run tests/nav.test.ts tests/app-shell.test.tsx tests/bottom-nav-collapse.test.tsx tests/tab-reselect.test.tsx` | 4 files, 63 tests passed |
| Task 2 web unit | `pnpm --filter @rede-social/web exec vitest run lib/member-area.test.ts lib/preview-modules.test.ts` | 2 files, 12 tests passed |
| Core typecheck | `pnpm --filter @rede-social/core typecheck` | clean |
| Full web unit suite | `pnpm --filter @rede-social/web exec vitest run` | 171 files, 3839 tests passed |
| Full core unit suite | `pnpm --filter @rede-social/core exec vitest run` | 41 files, 447 tests passed |
| Courses module unit suite | `pnpm --filter @rede-social/module-courses exec vitest run` | 330 tests passed |
| Affected-map guard | `pnpm --filter @rede-social/web exec vitest run scripts/e2e-affected.test.ts` | 44 tests passed |
| Playwright collection only | `pnpm --filter @rede-social/web exec playwright test --list <the 7 specs>` | 210 tests in 7 files collected, nothing run |
| UI-literal guard | `bash scripts/check-ui-literals.sh apps packages` | OK |
| Biome | `biome check` over the 32 `.ts/.tsx/.json` files changed or added since `05735d7b` in apps, packages, scripts | clean, no fixes needed |
| Build | `pnpm --filter @rede-social/web build` (not turbo; 7 GB free before) | OK, `/area-membros` listed as dynamic (ƒ) |
| Static routes | `pnpm check:static-routes` | `check-static-routes: OK`, 86 guarded routes, 0 offenders |

After the build I removed `apps/web/.next/cache` (no `next dev` was running). The rest of `apps/web/.next` is the user's existing build output (it held a 12:51 build and a `dev/` directory before I started) and was overwritten by my build, not deleted. Disk is now about 5 GB free (98 percent).

## Gates NOT run

- **Playwright execution (all e2e specs): NOT RUN.** The local stack (web, API, Supabase) is down and was not started; no `pnpm db:reset`. The edited specs are statically checked (typecheck, `playwright test --list`, affected-map guard) and have never been executed against this change. Treat the redirect contract, the Membros tab and the school-off assertions as unproven until they run.
- **Integration suites and pgTAP: NOT RUN** (they need the stack; nothing in this change touches the API or the database).
- `courses-admin.spec.ts` was reviewed and left unchanged: it only drives the admin side, plus a member `goto /cursos` after the school is re-enabled, which still ends on the catalogue through the redirect (its `toBeVisible` retries).

### Commands for the user (after `pnpm supabase start`, `pnpm db:reset`, `pnpm db:seed`)

```
pnpm --filter @rede-social/web exec playwright test courses-member.spec.ts courses-member-area.spec.ts courses-admin.spec.ts shell.spec.ts reels.spec.ts phase4-smoke.spec.ts phase5-smoke.spec.ts phase6-smoke.spec.ts
```

## Remaining `/cursos` hits in the two member specs (all intended)

- `courses-member-area.spec.ts:312` admin `goto /cursos` followed by the `courses-hub` testid (hub navigation).
- `courses-member-area.spec.ts:1377` the PreviewBanner back link, still the hub `/cursos`.
- `courses-member.spec.ts:323` admin hub navigation.
- `courses-member.spec.ts:364-390` the new redirect test (member and admin redirect edges, plus the area-to-hub edge).
- `courses-member.spec.ts:445-455` the school-off case: `/cursos` for the lab member and admin, still the kernel not-found (the `/area-membros` lines were added next to them).
- All `/cursos/{id}`, `/cursos/{id}/aulas/{lessonId}`, `/cursos/lives/{id}` and `/cursos/novo` references.

## Deviations from Plan

None - the plan was executed as written. Notes, not deviations:

- The `@/lib/member-area` import in `tabs.ts` sorts after the module imports (Biome reordered some import lines on `--write`; no behavior change).
- `memberAreaRedirectHref` takes a small exported `MemberAreaRedirectQuery` interface (aba, categoria, trilha) instead of an inline type.
- `affected-map.json`: besides the two requested globs, `reels.spec.ts` and the phase 4/5/6 smokes were added to the `courses-web` specs, because the tab label they assert now comes from the courses-web files.

## Open points carried from the plan (not done on purpose)

1. The area h1 and subtitle still read "Cursos" / "Cursos e lives de {tenant}." (copy change not requested; one catalog line each if wanted).
2. No TopBar suffix "· Membros" and no area menu (`NavArea`) were added for the member area (the ask was the bottom-bar tab only; it would change the TopBar's right side for members).
3. REQUIREMENTS.md COURSE-16 / COURSE-28 and the 08.6 D-435 / D-400 text still say `/cursos`. They were not edited: the verification digest covers REQUIREMENTS and ROADMAP, so amend them in a separate commit.
4. The member course page back link still says "Voltar para Cursos" (the target moved to `/area-membros`, the label did not).
5. The empty-school logic (Inicio says "Nenhum curso por aqui ainda" for a published course with zero lessons) is untouched.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the new route reads the same bootstrap and the API still authorises every read. Threat register T-k7x-01..04 mitigations are in place (permission-only role split, constant redirect path with encoded query values and unit tests for URL-shaped values, module gate before any redirect, mutually exclusive predicates); their e2e coverage is written but not yet executed.

## Self-Check: PASSED

- Created files exist: member-area.ts, member-area.test.ts, area-membros/layout.tsx, page.tsx, loading.tsx.
- Commits 2b611182, d2108359, 7c3140e5 are on master (`git rev-list --count 05735d7b..HEAD` = 3).
- No Co-Authored-By trailer and no api/supabase/db path in any of the three commits.
