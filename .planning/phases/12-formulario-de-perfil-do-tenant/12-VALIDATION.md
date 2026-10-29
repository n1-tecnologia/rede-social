---
phase: "12"
slug: "formulario-de-perfil-do-tenant"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-29"
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `12-RESEARCH.md` "Validation Architecture"; the planner replaces the `TBD` task ids with `12-<plan>-T<task>` once the plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit per package; API integration against the local stack), pgTAP via `supabase test db`, Playwright 1.63.0 (web e2e) |
| **Config file** | per-package `vitest.config.ts` (Vitest 5 does not walk up): `packages/contracts`, `packages/core/vitest.config.ts` (no DB), `apps/api/vitest.config.ts` (integration needs the local stack, `fileParallelism: false`), `apps/web/vitest.config.ts`; `apps/web/playwright.config.ts`; pgTAP files in `supabase/tests/*.sql` (a single-file run needs `000-helpers.sql`) |
| **Quick run command** | `pnpm --filter @rede-social/contracts test` · `pnpm --filter @rede-social/core exec vitest run tests/<file>.test.ts` · `pnpm --filter @rede-social/api exec vitest run tests/unit/<file>.test.ts` · `pnpm --filter @rede-social/web exec vitest run <file>` |
| **Full suite command** | `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`, then `pnpm supabase test db`, then each new integration file with `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`; phase gate adds `pnpm db:reset && pnpm db:seed && pnpm test:integration`, `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes` |
| **Estimated runtime** | ~30 s per task (single file); several minutes for the pgTAP + integration wave gate |

Repo traps (see `12-RESEARCH.md` §Validation Architecture): pgTAP runs BEFORE the integration files (residue from integration trips pgTAP 154); `test:integration -- x` does not filter, use the per-file form; use `pnpm supabase`, not a global binary; Vitest never emits TAP, so a TDD red-evidence step needs a throwaway normalizer and never a fabricated count; `apps/api/tests/isolation-inventory.ts` must list every new route with a real `it(` title or its unit test stays red; the disk is tight (2.8 GiB free on 2026-10-29), so clear `.turbo/cache` and `apps/web/.next` caches before gates and run Playwright under a free-space watchdog.

---

## Sampling Rate

- **After every task commit:** the single targeted Vitest file(s) (seconds); for SQL tasks the single pgTAP file; `pnpm turbo typecheck` for tasks that change a published contract or the `requireAuth` seam.
- **After every plan wave:** `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`, then `pnpm supabase test db`, then the new integration files one by one; `pnpm lint` (includes `scripts/check-ui-literals.sh`) and `pnpm check:static-routes` when web routes change.
- **Before `/gsd-verify-work`:** phase gate above, the new Playwright specs under a disk watchdog, and the sketch gate `016` approved.
- **Max feedback latency:** 30 seconds for the per-task check.

---

## Per-Task Verification Map

Task id = `12-<plan>-T<task>`, filled by the planner. Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Web tasks also run `bash scripts/check-ui-literals.sh` and `grep -q '^approved: true' .planning/sketches/016-phase-12-designed-screens/README.md`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | PFORM-01 | — | module key appended last, CHECK widened, off by default, no backfill | unit + pgTAP + integration | `pnpm --filter @rede-social/contracts test`; `pnpm --filter @rede-social/api exec vitest run tests/unit/registry.test.ts`; pgTAP 220 | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-02 | — | builder CRUD, order, limits; admin only | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/profile-form-admin.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-03 | — | archive/reactivate, no hard delete with answers (FK RESTRICT) | pgTAP + integration | `pnpm supabase test db` (220) + admin integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-04 | — | thirteen per-type validators | unit | `pnpm --filter @rede-social/contracts test` (profile-form.test.ts) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-05 | — | type list in contracts equals the DB CHECK list | unit + pgTAP | contracts test + 220 | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-06 | — | options with stable ids, "Outro" per question | unit + integration | contracts + member integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-07 | T-12 tampering | save validates every answer, atomic, keyed errors, foreign question rejected | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/profile-form-member.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-08 | T-12 isolation | two-tenant negatives on every policy and route; inventory complete | pgTAP + integration + unit | 220; `tests/integration/isolation.test.ts`; `tests/unit/isolation-inventory.test.ts` | partial | ⬜ pending |
| TBD | TBD | TBD | PFORM-09 | — | completeness computed, never stored | pgTAP + integration | 220 + member integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-10 | T-12 availability | gate rides the single membership lookup, new error code | unit + integration | `pnpm --filter @rede-social/core exec vitest run tests/require-auth-form.test.ts`; `tests/integration/profile-form-gate.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-11 | — | staff/super_admin exempt, release on module off, precedence over cut, allow-list | unit + integration | same two files | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-12 | — | bootstrap block, redirect map, counters/LiveShell | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/bootstrap.test.ts components/shell/LiveShell.pending.test.ts app/api/me/counters/route.test.ts`; Playwright `profile-form-gate.spec.ts` | extend + ❌ spec | ⬜ pending |
| TBD | TBD | TBD | PFORM-13 | — | new and old members take the same screen | e2e + integration | Playwright `profile-form-member.spec.ts`; member integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-14 | — | one scrollable screen; a 409 keeps typed answers | web unit + e2e | component test + spec | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-15 | T-12 open redirect | `next` is a validated same-origin path | web unit | `pnpm --filter @rede-social/web exec vitest run lib/safe-next-path.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-16 | — | optional question never gates; dismissal is server state | integration + web unit | member integration + component test | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-17 | T-12 tampering | answered type/options/show-on-profile locked (service 409 + trigger) | pgTAP + integration | 220 + admin integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-18 | T-12 disclosure | private by default; public-flagged read; strict payload | pgTAP + integration | 220 + `tests/integration/profile-form-answers.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-19 | — | admin and support read a member's answers | integration + web unit | same | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-20 | — | "Minhas respostas" on the profile | web unit + e2e | component test + spec | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-21 | T-12 injection | CSV neutralises `= + - @ tab`; log row written before the first byte | unit + integration | `pnpm --filter @rede-social/core exec vitest run tests/profile-form-csv.test.ts`; admin integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-22 | — | cascade with the membership; LGPD warning copy | pgTAP + web unit | 220 + catalog test | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-23 | — | admin sees aggregates and the impact of a change | integration | admin integration | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-24 | T-12 integrity | concurrent admin edit vs member save | integration (two connections) | `tests/integration/profile-form-concurrency.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PFORM-25 | — | migration fans out to every project, expand-only, hold-out of a project behind the image | integration | `tests/integration/migrate-all.test.ts`, `schema-gate.test.ts`, `two-database-routing.test.ts` (extend) | extend | ⬜ pending |
| TBD | TBD | TBD | PFORM-26 | — | pt-BR only, 44px targets, 320/390 widths, sketch gate approved | web unit + Playwright + script | `bash scripts/check-ui-literals.sh`; `pnpm check:static-routes`; specs; `grep -q '^approved: true' .planning/sketches/016-phase-12-designed-screens/README.md` | ❌ W0 | ⬜ pending |

*The PFORM-01..26 text is the researcher's draft (`12-RESEARCH.md` §Phase Requirements); the planner finalises the wording in REQUIREMENTS.md and keeps these ids.*

---

## Wave 0 Requirements

- [ ] `packages/contracts/src/profile-form.ts` + `packages/contracts/tests/profile-form.test.ts` — validators, type list, limits, issue codes (PFORM-04, 05, 06)
- [ ] `supabase/tests/220-profile-form.sql` — shape, CHECKs, FK RESTRICT, policies x two tenants, function, trigger, cascade, hardening (`revoke ... from public`, grants) (PFORM-01, 03, 05, 08, 09, 17, 18, 22)
- [ ] `010-rls-coverage.sql` / `040` — catalogue-driven, expect no edit; verify
- [ ] `packages/core/tests/require-auth-form.test.ts`; extend `membership-pick.test.ts` fixtures (PFORM-10, 11)
- [ ] `apps/api/tests/integration/profile-form-{admin,member,gate,answers,concurrency}.test.ts` + a `withProfileForm` helper in `setup.ts`
- [ ] New cases in `isolation.test.ts` and entries in `apps/api/tests/isolation-inventory.ts` for every new route (the unit test fails until each has a real `it(` title)
- [ ] `apps/api/tests/admin-lane-inventory/profile-form.ts` entry for the export site
- [ ] `apps/api/tests/unit/registry.test.ts` cases and `packages/modules/profile-form/README.md` with the fixed headings for `module-readmes.test.ts`; update hard-coded module counts
- [ ] `apps/web/e2e/profile-form-{gate,member,admin}.spec.ts`, `affected-map.json` rows and `scripts/check-static-routes.sh` entries for `/(auth)/completar-perfil/page` and `/(app)/configuracoes/formulario-de-perfil/page`
- [ ] Sketch `016` (MANIFEST row `pending`; README whose `approved: true` frontmatter is pasted by the user, never written by the executor)
- [ ] Framework install: none

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sketch gate `016` approval | PFORM-26 | design approval is the user's (D-417); the executor never writes `approved: true` | Igor opens the sketch screens and pastes the approval frontmatter |
| The form on a real phone (gate, completion, "Minhas respostas") | PFORM-12, 14, 20, 26 | phones cannot reach `*.localhost`; needs the homolog deploy | Igor walks the member path on a device after the homolog deploy; default is `blocked` until then |
| Per-tenant-database lane on a hosted project | PFORM-25 | hosted proofs are Igor's (09.2/09.4 pattern) | Igor runs the migrate job against one hosted tenant project and records the row |
| CSV opens cleanly in Excel / Google Sheets with accents | PFORM-21 | encoding/BOM behaviour depends on the viewer | open the exported file in both |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
