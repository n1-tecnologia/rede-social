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

> Per-phase validation contract for feedback sampling during execution. Seeded from `12-RESEARCH.md` "Validation Architecture"; task ids filled by the planner on 2026-10-29 (`12-<plan>-T<task>`, 18 plans, 11 waves).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit per package; API integration against the local stack), pgTAP via `supabase test db`, Playwright 1.63.0 (web e2e) |
| **Config file** | per-package `vitest.config.ts` (Vitest 5 does not walk up): `packages/contracts`, `packages/core/vitest.config.ts` (no DB), `packages/modules/profile-form/vitest.config.ts` (created by plan 02), `apps/api/vitest.config.ts` (integration needs the local stack, `fileParallelism: false`), `apps/web/vitest.config.ts`; `apps/web/playwright.config.ts`; pgTAP files in `supabase/tests/*.sql` (a single-file run needs `000-helpers.sql`) |
| **Quick run command** | `pnpm --filter @rede-social/contracts exec vitest run tests/<file>.test.ts` · `pnpm --filter @rede-social/core exec vitest run tests/<file>.test.ts` · `pnpm --filter @rede-social/api exec vitest run tests/unit/<file>.test.ts` · `pnpm --filter @rede-social/web exec vitest run <file>` · `pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/220-profile-form.sql` |
| **Full suite command** | `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` (NO `turbo build`), then `pnpm db:reset && pnpm db:seed && pnpm supabase test db`, then each new integration file with `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts`; phase gate adds `pnpm boundaries`, `pnpm boundaries:negative`, `pnpm guard:lanes`, `pnpm lint` (includes `scripts/check-ui-literals.sh`) |
| **Estimated runtime** | ~30 s per task (single file); several minutes for the pgTAP + integration wave gate |

Repo traps (see `12-RESEARCH.md` §Validation Architecture): pgTAP runs BEFORE the integration files (residue from integration trips pgTAP 154); `test:integration -- x` does not filter, use the per-file form; use `pnpm supabase`, not a global binary; Vitest never emits TAP, so a TDD red-evidence step needs a throwaway normalizer and never a fabricated count (no task of this phase is marked `tdd="true"`); `apps/api/tests/isolation-inventory.ts` must list every new route with a real `it(` title or its unit test stays red; the disk is tight (2.8 GiB free on 2026-10-29): no `turbo build`, no full Next build, clear `.turbo/cache` and `apps/web/.next/{dev,cache}` before gates, Playwright only in plan 18 under a free-space watchdog (more than 10 GiB free); `pnpm check:static-routes` needs a Next build, so it is run by Igor or CI, not here.

---

## Sampling Rate

- **After every task commit:** the single targeted Vitest file(s) (seconds); for SQL tasks the single pgTAP file; `TURBO_CACHE=local:r pnpm turbo typecheck --filter=<package>` for tasks that change a published contract or the `requireAuth` seam. Web tasks also run `grep -q '^approved: true' .planning/sketches/016-phase-12-designed-screens/README.md` and `bash scripts/check-ui-literals.sh`.
- **After every plan wave:** `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4`, then `pnpm supabase test db`, then the new integration files one by one.
- **Before `/gsd-verify-work`:** the phase gate above (plan 18 Task 3), the three Playwright specs, and the sketch gate `016` approved.
- **Max feedback latency:** 30 seconds for the per-task check.

---

## Per-Task Verification Map

Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Every `<automated>` command carries a `<fails_when>` in its plan. `PQ` = `pnpm --filter @rede-social/api exec vitest run`.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-02-T2 | 02 | 1 | PFORM-01 | T-12-03, T-12-04 | module key appended last, CHECK widened, off by default, no backfill, `manage` admin-only | unit + pgTAP | `PQ tests/unit/registry.test.ts tests/unit/mounts.test.ts`; `pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/220-profile-form.sql` | ❌ W0 (plan 02) | ⬜ pending |
| 12-08-T1, 12-11-T3 | 08, 11 | 6, 4 | PFORM-01 | T-12-19 | module off hides every route (404) and the platform row confirms before turning off | integration + web unit | `PQ tests/integration/profile-form-admin.test.ts`; `pnpm --filter @rede-social/web exec vitest run "app/(platform)/plataforma/tenants/[id]/modulos/page.test.tsx"` | ❌ W0 | ⬜ pending |
| 12-03-T2, 12-08-T1/T3 | 03, 08 | 1, 6 | PFORM-02 | T-12-19 | builder CRUD, order, limits; admin only | contracts + integration | `pnpm --filter @rede-social/contracts exec vitest run tests/profile-form.test.ts`; `PQ tests/integration/profile-form-admin.test.ts` | ❌ W0 | ⬜ pending |
| 12-04-T1, 12-09-T1/T2 | 04, 09 | 2, 7 | PFORM-03 | T-12-22 | archive keeps answers; no hard delete with answers (FK RESTRICT); reactivate at the end | pgTAP + integration | `pnpm supabase test db` (220); `PQ tests/integration/profile-form-lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| 12-03-T1 | 03 | 1 | PFORM-04 | T-12-05 | thirteen per-type validators built from the stored question | unit | `pnpm --filter @rede-social/contracts exec vitest run tests/profile-form.test.ts` | ❌ W0 | ⬜ pending |
| 12-03-T1, 12-04-T1 | 03, 04 | 1, 2 | PFORM-05 | — | type list in contracts equals the DB CHECK list (ordered) | unit + pgTAP | contracts test + pgTAP 220 | ❌ W0 | ⬜ pending |
| 12-03-T1/T2, 12-06-T2, 12-16-T2 | 03, 06, 16 | 1, 4, 9 | PFORM-06 | T-12-14 | options with stable ids, "Outro" per question, unknown option refused | unit + integration + web unit | contracts test; `PQ tests/integration/profile-form-member.test.ts`; web `"app/(app)/configuracoes/formulario-de-perfil"` | ❌ W0 | ⬜ pending |
| 12-06-T1/T2 | 06 | 4 | PFORM-07 | T-12-14 | save validates every answer, atomic, keyed errors, foreign question rejected | integration | `PQ tests/integration/profile-form-member.test.ts` | ❌ W0 | ⬜ pending |
| 12-04-T1, 12-06-T3, 12-07-T2, 12-08-T3, 12-09-T3, 12-10-T3 | 04, 06-10 | 2-8 | PFORM-08 | T-12-06, T-12-07, T-12-17 | two-tenant negatives on every policy and route; inventory complete | pgTAP + integration + unit | 220; `PQ tests/integration/isolation.test.ts -t "phase 12 sweep"`; `PQ tests/unit/isolation-inventory.test.ts` | partial | ⬜ pending |
| 12-04-T2, 12-05-T2, 12-06-T1 | 04, 05, 06 | 2, 3, 4 | PFORM-09 | — | completeness computed, never stored | pgTAP + integration | 220; `PQ tests/integration/profile-form-gate.test.ts` | ❌ W0 | ⬜ pending |
| 12-05-T1 | 05 | 3 | PFORM-10 | T-12-11, T-12-12, T-12-13 | gate rides the single membership lookup, new error code, exact allow-list | unit | `pnpm --filter @rede-social/core exec vitest run tests/require-auth-form.test.ts` | ❌ W0 | ⬜ pending |
| 12-05-T1/T2 | 05 | 3 | PFORM-11 | T-12-13 | staff/super_admin exempt, release on module off or archive, precedence over cut | unit + integration | core test above; `PQ tests/integration/profile-form-gate.test.ts` | ❌ W0 | ⬜ pending |
| 12-05-T2, 12-11-T1/T2, 12-18-T1 | 05, 11, 18 | 3, 4, 11 | PFORM-12 | T-12-28 | bootstrap block, redirect map, counters/LiveShell | web unit + e2e | `pnpm --filter @rede-social/web exec vitest run lib/bootstrap.test.ts components/shell/LiveShell.pending.test.ts app/api/me/counters/route.test.ts`; Playwright `profile-form-gate.spec.ts` | extend + ❌ spec | ⬜ pending |
| 12-06-T1, 12-12-T1, 12-18-T1 | 06, 12, 18 | 4, 5, 11 | PFORM-13 | — | new and old members take the same screen | integration + web unit + e2e | member integration; web `"app/(auth)/completar-perfil"`; Playwright gate spec | ❌ W0 | ⬜ pending |
| 12-06-T2, 12-12-T1/T2, 12-13-T1/T2, 12-18-T2 | 06, 12, 13, 18 | 4-6, 11 | PFORM-14 | T-12-30 | one scrollable screen; a 409 keeps typed answers; formats | integration + web unit + e2e | web `components/profile-form lib/profile-form`; Playwright member spec | ❌ W0 | ⬜ pending |
| 12-11-T1 | 11 | 4 | PFORM-15 | T-12-27 | `next` is a validated same-origin path | web unit | `pnpm --filter @rede-social/web exec vitest run lib/safe-next-path.test.ts lib/bootstrap.test.ts proxy.test.ts` | ❌ W0 | ⬜ pending |
| 12-06-T3, 12-14-T2 | 06, 14 | 4, 7 | PFORM-16 | — | optional question never gates; dismissal is server state | integration + web unit | member integration; web `components/profile-form/NewQuestionsNotice.test.tsx` | ❌ W0 | ⬜ pending |
| 12-04-T2, 12-08-T2, 12-09-T2, 12-16-T3 | 04, 08, 09, 16 | 2, 6, 7, 9 | PFORM-17 | T-12-09, T-12-20, T-12-36 | answered type/options/show-on-profile locked (service 409 + trigger); replace atomic | pgTAP + unit + integration + web unit | 220; `pnpm --filter @rede-social/core exec vitest run tests/profile-form-lock-rules.test.ts`; admin integration | ❌ W0 | ⬜ pending |
| 12-04-T1, 12-07-T1, 12-14-T3 | 04, 07, 14 | 2, 5, 7 | PFORM-18 | T-12-06, T-12-17, T-12-32 | private by default; public-flagged read; strict payload; one 404 | pgTAP + integration + web unit | 220; `PQ tests/integration/profile-form-answers.test.ts` | ❌ W0 | ⬜ pending |
| 12-07-T2, 12-14-T3 | 07, 14 | 5, 7 | PFORM-19 | T-12-18 | admin and support read a member's answers incl. archived | integration + web unit | answers integration; web `components/profile-form/AnswersBlocks.test.tsx` | ❌ W0 | ⬜ pending |
| 12-14-T1, 12-18-T2 | 14, 18 | 7, 11 | PFORM-20 | T-12-32 | "Minhas respostas" on the profile | web unit + e2e | web `components/profile-form/MyAnswersSection.test.tsx`; Playwright member spec | ❌ W0 | ⬜ pending |
| 12-10-T1/T2/T3, 12-17-T1 | 10, 17 | 8, 10 | PFORM-21 | T-12-24, T-12-25, T-12-26, T-12-37 | CSV neutralises `= + - @ tab CR LF`; log row written before the first byte; admin only | unit + integration + web unit | `pnpm --filter @rede-social/core exec vitest run tests/profile-form-csv.test.ts`; `PQ tests/integration/profile-form-export.test.ts` | ❌ W0 | ⬜ pending |
| 12-04-T1, 12-16-T1 | 04, 16 | 2, 9 | PFORM-22 | — | cascade with the membership; LGPD warning copy | pgTAP + web unit | 220; web `i18n/profile-form-messages.test.ts` | ❌ W0 | ⬜ pending |
| 12-09-T2, 12-15-T1/T3, 12-17-T2 | 09, 15, 17 | 7, 8, 10 | PFORM-23 | T-12-23, T-12-34 | admin sees aggregates and the impact of a change; impact failure blocks the write | integration + web unit | lifecycle integration; web `"app/(app)/configuracoes/formulario-de-perfil"` | ❌ W0 | ⬜ pending |
| 12-06-T3, 12-08-T2, 12-09-T3 | 06, 08, 09 | 4, 6, 7 | PFORM-24 | T-12-16, T-12-21 | concurrent admin edit vs member save, admin vs admin | integration (two connections) | `PQ tests/integration/profile-form-concurrency.test.ts` | ❌ W0 | ⬜ pending |
| 12-02-T2, 12-04-T3, 12-18-T3 | 02, 04, 18 | 1, 2, 11 | PFORM-25 | T-12-40 | migrations fan out, expand-only, no-op rerun, hold-out of a project behind the image | pgTAP + integration | `PQ tests/integration/migrate-all.test.ts`, `schema-gate.test.ts`, `two-database-routing.test.ts` | extend | ⬜ pending |
| 12-01-T1/T3, 12-11..18 | 01, 11-18 | 1, 4-11 | PFORM-26 | T-12-01, T-12-02 | pt-BR only, 44px targets, 320/390 widths, sketch gate approved before any web task; the one exemption is plan 10's two Moderação catalog lines and their icon and map entries (A-12-MOD, manual row M6) | web unit + Playwright + script | `bash scripts/check-ui-literals.sh`; specs; `grep -q '^approved: true' .planning/sketches/016-phase-12-designed-screens/README.md` | ❌ W0 | ⬜ pending |

*The PFORM-01..26 text is final in `REQUIREMENTS.md` (### Tenant profile form).*

---

## Wave 0 Requirements

Each Wave 0 item is created by the plan that owns it (no separate scaffolding plan):

- [ ] `packages/contracts/src/profile-form.ts` + `packages/contracts/tests/profile-form.test.ts` — validators, type list, limits, issue codes (plan 03; PFORM-04, 05, 06)
- [ ] `supabase/tests/220-profile-form.sql` — module key (plan 02), shape, CHECKs, FK RESTRICT, policies x two tenants, function, trigger, cascade, hardening (plan 04; PFORM-01, 03, 05, 08, 09, 17, 18, 22)
- [ ] `010-rls-coverage.sql` / `040` — catalogue-driven, expect no edit; verified by the whole-suite run in plan 04 Task 3
- [ ] `packages/core/tests/require-auth-form.test.ts`; fixtures in `membership-pick.test.ts` and `require-auth-cut.test.ts` (plan 05; PFORM-10, 11)
- [ ] `apps/api/tests/integration/profile-form-{gate,member,answers,admin,lifecycle,concurrency,export}.test.ts` + a `withProfileForm` helper in `setup.ts` (plans 05 to 10)
- [ ] New `phase 12 sweep` cases in `isolation.test.ts` and entries in `apps/api/tests/isolation-inventory.ts` for every new route (plans 06 to 10)
- [ ] `apps/api/tests/admin-lane-inventory/profile-form.ts` entry for the export site and the Biome allow-list line (plan 10)
- [ ] `apps/api/tests/unit/registry.test.ts` cases and `packages/modules/profile-form/README.md` with the fixed headings for `module-readmes.test.ts`; hard-coded module counts updated (plan 02)
- [ ] `apps/web/e2e/profile-form-{gate,member,admin}.spec.ts`, the `affected-map.json` entry and the `scripts/check-static-routes.sh` keys for `/(auth)/completar-perfil/page` and `/(app)/configuracoes/formulario-de-perfil/page` (plan 18)
- [ ] Sketch `016` (MANIFEST row `pending`; README whose `approved: true` is pasted by the user, never written by the executor) (plan 01)
- [ ] Framework install: none

---

## Manual-Only Verifications

Tracked in `12-MANUAL-PROOFS.md` (created by plan 18, rows M1..M7, all `pending`, only Igor writes `passed`).

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sketch gate `016` approval | PFORM-26 | design approval is the user's (D-417); the executor never writes `approved: true` | Igor opens the sketch screens and pastes the approval frontmatter |
| The form on a real phone (gate, completion, "Minhas respostas") | PFORM-12, 14, 20, 26 | phones cannot reach `*.localhost`; needs the homolog deploy | Igor walks the member path on a device after the homolog deploy; default is `blocked` until then (M1) |
| Per-tenant-database lane on a hosted project | PFORM-25 | hosted proofs are Igor's (09.2/09.4 pattern) | Igor runs the migrate job against one hosted tenant project and records the row (M2) |
| CSV opens cleanly in Excel / Google Sheets with accents | PFORM-21 | encoding/BOM/delimiter behaviour depends on the viewer (assumption A1) | open the exported file in both (M3) |
| A large export streams through Cloud Run | PFORM-21 | the 32 MiB body cap vs a streamed response is an assumption (A2) | export a tenant with thousands of members on the hosted API (M4) |
| Export row set (active and blocked members) | PFORM-21 | planner decision A-12-02 awaits Igor's confirmation | Igor confirms or asks for a filter (M5) |
| Moderação copy for the export row and chip | PFORM-21, PFORM-26 | planner assumption A-12-MOD (two catalog lines, not in the UI-SPEC; the one UI change exempted by name from the sketch gate in PFORM-26) | Igor reads the Moderação list after an export (M6) |
| Production release order | PFORM-25 | production deploys are Igor's | follow `docs/DEPLOY.md` "Phase 12 release" (M7) |

---

## COVERAGE (spec-less probe reconciliation, 2026-10-29)

The phase had no SPEC, so the edge probe ran on the 26 PFORM rows (`coverage12.json`, 96 applicable edges, all `unresolved`). Authored per `specless-probe-fallback.md` §C: 90 plain `must_haves.truths` strings (verification explicit), 2 structured `{ statement, verification: backstop }` items, and 4 `unclassified` rows kept as flagged assumptions. **96 probe items = 92 authored + 4 flagged.** A grouped truth names each edge's category so the count can be reconciled.

| Requirement | Probe categories | Owner plan | Authored as |
|-------------|------------------|------------|-------------|
| PFORM-01 | adjacency, empty, ordering | 02 | 3 explicit |
| PFORM-02 | empty, encoding, concurrency | 08 | 3 explicit |
| PFORM-03 | boundary, adjacency, empty, ordering, precision, idempotency, concurrency | 09 | 7 explicit |
| PFORM-04 | boundary, adjacency, empty, encoding, ordering, precision | 03 | 6 explicit |
| PFORM-05 | adjacency, empty, ordering | 04 | 3 explicit |
| PFORM-06 | empty, encoding | 03 | 2 explicit |
| PFORM-07 | adjacency, empty, ordering, idempotency, concurrency | 06 | 5 explicit |
| PFORM-08 | adjacency, empty, ordering, idempotency, concurrency | 04 | 5 explicit |
| PFORM-09 | adjacency, empty, ordering | 04 | 3 explicit |
| PFORM-10 | boundary, adjacency, empty, ordering, precision | 05 | 5 explicit |
| PFORM-11 | adjacency, empty, ordering, idempotency, concurrency | 05 | 5 explicit |
| PFORM-12 | unclassified | 05 / 11 | **flagged assumption** (API half plan 05, web half plan 11) |
| PFORM-13 | adjacency, empty, ordering | 12 | 3 explicit |
| PFORM-14 | adjacency, empty, ordering | 12 | 3 explicit |
| PFORM-15 | empty, encoding, idempotency, concurrency | 11 | 4 explicit |
| PFORM-16 | unclassified | 06 / 14 | **flagged assumption** (server half plan 06, notice plan 14) |
| PFORM-17 | boundary, adjacency, empty, encoding, ordering, precision, idempotency, concurrency | 08 | 8 explicit |
| PFORM-18 | unclassified | 04 / 07 | **flagged assumption** (policies plan 04, route plan 07) |
| PFORM-19 | adjacency, empty, ordering | 07 | 3 explicit |
| PFORM-20 | adjacency, empty, ordering, idempotency, concurrency | 14 | 4 explicit + 1 backstop (concurrency) |
| PFORM-21 | adjacency, empty, encoding, ordering | 10 | 4 explicit |
| PFORM-22 | idempotency, concurrency | 04 | 2 explicit |
| PFORM-23 | unclassified | 09 | **flagged assumption** (aggregate-only truth in plan 09; the failure-blocks-write half in plans 15, 16) |
| PFORM-24 | adjacency, empty, ordering, idempotency, concurrency | 09 | 5 explicit |
| PFORM-25 | adjacency, empty, ordering, idempotency, concurrency | 02 (adjacency), 04 (rest) | 4 explicit + 1 backstop (concurrency: an older API during the fan-out, confirmed only by the hosted rollout) |
| PFORM-26 | adjacency, empty, ordering | 01 | 3 explicit |

**Prohibitions (§B recall, authored descriptor-less in `must_haves.prohibitions`, flagged unverified):** plan 01 (two: the sketch gate and no new token), 02 (the key must not default on or backfill), 03 (the server must not trust a client-supplied question shape), 04 (no cross-member read of a private answer; no discarding or reinterpreting stored answers), 05 (the gate must not mutate state or revoke the session; must not trap the member), 06 (answers never in logs or URLs; no notification or push on form change, which is Deferred), 07 (no private answer, e-mail or staff marker in the public payload), 08 (no individual answer in builder responses; no content-based filtering of titles, D-594), 09 (no hard delete with answers; no code path that discards answers), 10 (export only by `admin_tenant`, always logged, never cacheable; the log stays append-only), 11 (no off-site redirect), 12 (no browser storage of answers; the screen must not trap the member), 13 (no silent reinterpretation by the phone/number parsers), 14 (no private answer or unsafe link rendered), 15 (no individual answers in the builder; no reopening write without an impact count), 16 (no purpose field or content blocking; no lock offered as free), 17 (the web tier never reads or persists the exported file), 18 (no deploy, push or hosted write; e2e touches only prefixed rows).

**Canon-referral breadcrumbs (not minted as prohibitions, ADR-550 D6):** open redirect, CSV formula injection, stored XSS, IDOR and cross-tenant access are canon security items — covered by threat models, tests and `/gsd-secure-phase`, not minted here; LGPD retention and consent are canon — covered by the cascade (D-594) and the builder warning, with `/gsd-secure-phase` as the owner of any further audit.

**UI Considerations lift (70 rows: 60 covered + 8 backstop + 2 dismissed):** E01 (summary card) plan 15 (3 covered; long-text dismissed in the UI-SPEC); E02 plan 15 (7 covered + 1 backstop); E03 plan 16 (4 + 1 backstop); E04 plan 16 (7 + 1 backstop); E05 plan 15 (8); E06 plan 17 (2 + 1 backstop); E07 plan 12 (6 + 1 backstop); E08 plan 14 (7 + 1 backstop); E09 plan 14 (7 + 1 backstop); E10 plan 14 (7 + 1 backstop); E11 plan 11 (2 covered; long-text dismissed). The eight structured backstop items are confirmed by the 320px and 390px checks of plan 18 Task 2, and abstain to `human_needed` if unconfirmed.

**Decisions D-580..D-596 → plans:** D-580: 06, 11, 12, 18; D-581: 05, 11, 18; D-582: 06, 08, 12, 18; D-583: 11, 12; D-584: 05, 12, 14; D-585: 04, 05, 06, 09, 16; D-586: 06, 14; D-587: 04, 08, 16; D-588: 04, 09, 15, 16; D-589: 02, 05, 09, 18; D-590: 03, 13, 16; D-591: 03, 04; D-592: 03, 16; D-593: 04, 07, 14, 16; D-594: 04, 08, 16; D-595: 10, 17; D-596: 02, 11, 15.

**Planner assumptions awaiting Igor:** (a) `next` travels in the `x-rede-path` header (plan 11); (b) A-12-02, the export row set is active and blocked members (plan 10, M5); (c) sketch gate 016 is a blocking human checkpoint (plan 01); (d) the `_gated` SQL pair is dropped by a later cleanup migration, not in this phase (plans 04 and 18); A-12-MOD, the two Moderação catalog lines for the export row (plan 10, M6; the one UI change exempted from the sketch gate by name in PFORM-26); the module key and error code names, confirmed once in plan 02 Task 1.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
