---
phase: "13"
slug: "app-nativo-ios-e-android-por-tenant-white-label"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-04"
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `13-RESEARCH.md` "Validation Architecture"; the per-task map is filled by the planner.

> Reconciled 2026-11-04 with `13-CONTEXT.md` D-616..D-619 (report and block slice, purchase switch off by default, shell-owned offline feed, GitHub macOS build). Per-task map filled by the planner on 2026-11-04 from the 32 plans; the success-criterion seed below gains row 9 (D-616) and the external-API matrix is `COVERAGE.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit, node; pure TypeScript modules of `apps/mobile`), Playwright 1.63.0 (web e2e, UA-spoofed contexts), pgTAP via `supabase test db`, API integration suite (`pnpm test:integration`) |
| **Config file** | per-package `vitest.config.ts` (Vitest 5 does not walk up): new `apps/mobile/vitest.config.ts` (bridge, host allow-list, id derivation, snapshot store, lock state machine, UA parse, payload mapping), `packages/modules/notifications`, `apps/api`, `apps/web`; `apps/web/playwright.config.ts`; pgTAP files in `supabase/tests/*.sql` (a single-file run needs `000-helpers.sql`) |
| **Quick run command** | `pnpm --filter @rede-social/mobile test` · `pnpm --filter @rede-social/module-notifications test` · `pnpm --filter @rede-social/web exec vitest run <file>` |
| **Full suite command** | `TURBO_CACHE=local:r pnpm turbo typecheck test --continue --concurrency=4` (no `turbo build`), then `pnpm db:reset && pnpm db:seed && pnpm supabase test db`, then `pnpm test:integration`; phase gate `pnpm verify` |
| **Estimated runtime** | to be measured in Wave 0 |

React Native screens stay thin and are not unit-tested under Vitest (no RN transform in this repo); their logic lives in pure modules. Native rendering is proven on devices.

---

## Sampling Rate

- **After every task commit:** the package's quick command plus `pnpm lint` (includes `scripts/check-ui-literals.sh`)
- **After every plan wave:** `pnpm turbo typecheck test`; for DB work `pnpm supabase test db` then `pnpm test:integration` (pgTAP before integration)
- **Before `/gsd-verify-work`:** `pnpm verify` green, then the manual-proofs document
- **Max feedback latency:** to be set when the quick commands are timed

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-T1 | 01 | 1 | NATIVE-34, UI-04 | T-13-01, T-13-02 | Register sketch 017 and write the review README with the 67 frame names and the questions for the design team | script | `R=.planning/sketches/017-phase-13-designed-screens/README.md; test -f "$R" && grep -q "^approved: false" "$...` | partly | ⬜ pending |
| 13-01-T2 | 01 | 1 | NATIVE-34, UI-04 | T-13-01, T-13-02 | Draw the native, notification, saved-feed, purchase-off and delete-account frames, 36 of the 67 | script | `S=.planning/sketches/017-phase-13-designed-screens/index.html; test -f "$S" && for f in splash-marca-escura...` | new | ⬜ pending |
| 13-01-T3 | 01 | 1 | NATIVE-34, UI-04 | T-13-01, T-13-02 | Append the platform App tab and the report and block frames, the remaining 31 of the 67 | script | `S=.planning/sketches/017-phase-13-designed-screens/index.html; for f in app-vazio app-em-preparacao app-pro...` | new | ⬜ pending |
| 13-01-T4 | 01 | 1 | NATIVE-34, UI-04 | T-13-01, T-13-02 | D-417 review of sketch 017 — Igor records the approval, the executor verifies and commits it (sketch gate) | human (human-action) | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md` | new | ⬜ pending |
| 13-02-T1 | 02 | 2 | NATIVE-01, NATIVE-03 | T-13-03, T-13-04, T-13-SC | [supply chain] Approve the Expo SDK 58 dependency set before the first install (T-13-SC) | human (human-verify) | `MISSING — Wave 0 gate: a human reply is the artifact; Task 2 starts by reading the recorded reply and stops...` | new | ⬜ pending |
| 13-02-T2 | 02 | 2 | NATIVE-01, NATIVE-03 | T-13-03, T-13-04, T-13-SC | [tracer] The workspace, the host classification and the marker, from the baked host to the WebView route | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/host-allowlist.test.ts tests/ua.test.ts && pnpm --f...` | partly | ⬜ pending |
| 13-02-T3 | 02 | 2 | NATIVE-01 | T-13-03, T-13-04, T-13-SC | [BLOCKING] The workspace passes the Expo checks and the repo gates without a `build` task | unit | `pnpm boundaries && pnpm boundaries:negative && TURBO_CACHE=local:r pnpm turbo typecheck test --filter=@rede...` | new | ⬜ pending |
| 13-03-T1 | 03 | 1 | NATIVE-02, NATIVE-32 | T-13-05, T-13-06 | [tracer] The subpath, the additive `app` block and bootstrap fields, and one id derivation, proven against old and new shapes | unit | `pnpm --filter @rede-social/contracts exec vitest run tests/native-additive.test.ts && pnpm --filter @rede-s...` | partly | ⬜ pending |
| 13-03-T2 | 03 | 1 | NATIVE-05 | T-13-05, T-13-06 | The bridge vocabulary, the snapshot, token shapes and the safe message parser | unit | `pnpm --filter @rede-social/contracts exec vitest run tests/native-bridge.test.ts && pnpm --filter @rede-soc...` | new | ⬜ pending |
| 13-03-T3 | 03 | 1 | NATIVE-02, NATIVE-32 | T-13-05, T-13-06 | The state functions, store-name cuts, build record, version rule and credential bodies | unit | `pnpm --filter @rede-social/contracts exec vitest run tests/native.test.ts && TURBO_CACHE=local:r pnpm turbo...` | new | ⬜ pending |
| 13-04-T1 | 04 | 3 | NATIVE-36, NATIVE-35 | T-13-07, T-13-08 | Record which store, Firebase and device prerequisites exist (research question 5) | human (human-action) | `test -f .planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-SPIKE-RESULTS.md && test "$(...` | new | ⬜ pending |
| 13-04-T2 | 04 | 3 | NATIVE-36, NATIVE-35 | T-13-07, T-13-08 | Write the spike protocol, the manual-proofs register and the device checklist | script | `R=.planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label; for n in 1 2 3 4 5 6 7 8 9; do grep ...` | new | ⬜ pending |
| 13-04-T3 | 04 | 3 | NATIVE-36, NATIVE-35 | T-13-07, T-13-08 | Run the nine spikes on real devices and a real domain and record the verdicts | human (human-verify) | `test "$(grep -E '^- S[1-9]: (pass\|fail\|changed\|blocked) - ' .planning/phases/13-app-nativo-ios-e-android-po...` | new | ⬜ pending |
| 13-05-T1 | 05 | 2 | NATIVE-24, NATIVE-26 | T-13-09, T-13-10 | [tracer] The two tables, their CHECKs and RLS, one generated migration, a row written by the platform lane and refused to the tenant lane | script | `pnpm db:generate:central 2>&1 \| grep -q "No schema changes" && pnpm db:central && TURBO_CACHE=local:r pnpm ...` | partly | ⬜ pending |
| 13-05-T2 | 05 | 2 | NATIVE-24, NATIVE-26, NATIVE-27 | T-13-09, T-13-10 | The hardening migration and the pgTAP proof of shape, CHECKs, exposure and cascade | pgTAP + integration | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/224-ce...` | partly | ⬜ pending |
| 13-05-T3 | 05 | 2 | NATIVE-24, NATIVE-26 | T-13-09, T-13-10 | [BLOCKING schema] The central set applies from scratch, drift is zero, the tenant set is untouched and the whole pgTAP suite is green | pgTAP + integration | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:generate:central 2>&1 \| grep -q "No schema c...` | new | ⬜ pending |
| 13-06-T1 | 06 | 2 | NATIVE-08 | T-13-11, T-13-12 | [tracer] The widened table and one generated migration, a native token saved and read back under RLS from two tenants | script | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r...` | exists | ⬜ pending |
| 13-06-T2 | 06 | 2 | NATIVE-08 | T-13-11, T-13-12 | The hand-written functions and the pgTAP proof of the CHECK, privileges, handoff and two-tenant isolation | pgTAP + integration | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/221-na...` | new | ⬜ pending |
| 13-06-T3 | 06 | 2 | NATIVE-08 | T-13-11, T-13-12 | [BLOCKING schema] The tenant set applies from scratch, drift is zero, the central set is untouched and the whole pgTAP suite is green | pgTAP + integration | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:generate:central 2>&1 \| grep -q "No schema c...` | new | ⬜ pending |
| 13-07-T1 | 07 | 3 | NATIVE-19, NATIVE-20 | T-13-13, T-13-14, T-13-15 | [tracer] The deletion columns, the request and the cancel by a fresh token, proven for one tenant and refused across tenants | script | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r...` | exists | ⬜ pending |
| 13-07-T2 | 07 | 3 | NATIVE-19, NATIVE-20, NATIVE-21 | T-13-13, T-13-14, T-13-15 | The due list, the in-place anonymisation, the privacy inventory and the pgTAP proof | pgTAP + integration | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/222-ac...` | new | ⬜ pending |
| 13-07-T3 | 07 | 3 | NATIVE-19, NATIVE-21 | T-13-13, T-13-14, T-13-15 | [BLOCKING schema] The tenant set applies from scratch, drift is zero, the central set is untouched and the whole pgTAP suite is green | pgTAP + integration | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:generate:central 2>&1 \| grep -q "No schema c...` | new | ⬜ pending |
| 13-08-T1 | 08 | 4 | NATIVE-31, NATIVE-33 | T-13-21, T-13-22, T-13-23 | [tracer] The two tables and one generated migration, a report and a block read back under RLS from two tenants | script | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:reset && pnpm db:seed && TURBO_CACHE=local:r...` | partly | ⬜ pending |
| 13-08-T2 | 08 | 4 | NATIVE-31, NATIVE-33 | T-13-21, T-13-22, T-13-23 | The anonymisation extension and the pgTAP proof of the CHECKs, policies, definers and two-tenant negatives | pgTAP + integration | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/223-re...` | new | ⬜ pending |
| 13-08-T3 | 08 | 4 | NATIVE-31, NATIVE-33 | T-13-21, T-13-22, T-13-23 | [BLOCKING schema] The tenant set applies from scratch, drift is zero, the central set is untouched and the whole pgTAP suite is green | pgTAP + integration | `pnpm db:generate 2>&1 \| grep -q "No schema changes" && pnpm db:generate:central 2>&1 \| grep -q "No schema c...` | new | ⬜ pending |
| 13-09-T1 | 09 | 3 | NATIVE-26 | T-13-16, T-13-17, T-13-18 | [tracer] Save one Apple push key write-only and read back only that it is held | integration | `pnpm --filter @rede-social/core exec vitest run tests/apps-credentials.test.ts && pnpm db:reset && pnpm db:...` | partly | ⬜ pending |
| 13-09-T2 | 09 | 3 | NATIVE-24, NATIVE-26 | T-13-16, T-13-17, T-13-18 | The remaining writes: ids, links, purchase switches, privacy URL and the manual checklist, with the derived state | integration | `pnpm --filter @rede-social/core exec vitest run tests/apps-tab.test.ts && pnpm db:reset && pnpm db:seed && ...` | partly | ⬜ pending |
| 13-09-T3 | 09 | 3 | NATIVE-26 | T-13-16, T-13-17, T-13-18 | [SECURITY GATE] No secret in any response, log or row, the boundaries hold, and the lane inventory is exact | pgTAP + integration | `pnpm boundaries && pnpm guard:lanes && TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core ...` | new | ⬜ pending |
| 13-10-T1 | 10 | 4 | NATIVE-24 | T-13-24, T-13-25 | [tracer] The fail-closed purchase answer from the stored switch to the bootstrap and the by-host block | integration | `pnpm --filter @rede-social/core exec vitest run tests/apps-read.test.ts && pnpm db:reset && pnpm db:seed &&...` | partly | ⬜ pending |
| 13-10-T2 | 10 | 4 | NATIVE-07, NATIVE-24 | T-13-24, T-13-25 | The unauthenticated minimum-version read and the edge proofs of the switch answer | integration | `pnpm --filter @rede-social/core exec vitest run tests/apps-read.test.ts && pnpm db:reset && pnpm db:seed &&...` | partly | ⬜ pending |
| 13-10-T3 | 10 | 4 | NATIVE-24, NATIVE-32 | T-13-24, T-13-25 | [GATE] The public contract stays additive, boundaries and lanes hold, and the API suite is green | static guard | `pnpm boundaries && pnpm guard:lanes && TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core ...` | new | ⬜ pending |
| 13-11-T1 | 11 | 3 | NATIVE-09 | T-13-19, T-13-20 | [tracer] Save and delete one native token through the existing route, isolated per tenant | integration | `pnpm db:reset && pnpm db:seed && pnpm --filter @rede-social/api exec vitest run tests/integration/push-devi...` | partly | ⬜ pending |
| 13-11-T2 | 11 | 3 | NATIVE-09 | T-13-19, T-13-20 | Prove the eight edges of the device body and the handoff under concurrency | integration | `pnpm --filter @rede-social/module-notifications exec vitest run tests/push-devices.test.ts && pnpm db:reset...` | new | ⬜ pending |
| 13-11-T3 | 11 | 3 | NATIVE-09 | T-13-19, T-13-20 | [GATE] Isolation inventory, module boundaries and the notifications suite stay green | static guard | `pnpm boundaries && pnpm guard:lanes && pnpm --filter @rede-social/module-notifications exec vitest run && p...` | exists | ⬜ pending |
| 13-12-T1 | 12 | 4 | NATIVE-10, NATIVE-13 | T-13-26, T-13-27, T-13-SC | [supply chain] Approve `google-auth-library` before it is installed (T-13-SC) | human (human-verify) | `MISSING — Wave 0 gate: a human reply is the artifact; Task 3 starts by reading the recorded reply and stops...` | exists | ⬜ pending |
| 13-12-T2 | 12 | 4 | NATIVE-10, NATIVE-13 | T-13-26, T-13-27, T-13-SC | [tracer] One fan-out sends to a web, an iOS and an Android subscription through `transportFor`, recorded by the fakes and reported | unit | `pnpm --filter @rede-social/module-notifications exec vitest run tests/native-send.test.ts && pnpm --filter ...` | partly | ⬜ pending |
| 13-12-T3 | 12 | 4 | NATIVE-10, NATIVE-13 | T-13-26, T-13-27, T-13-SC | The real APNs and FCM transports, tenant credentials, env, and the seven NATIVE-10 edges against local fake servers | unit | `pnpm --filter @rede-social/module-notifications exec vitest run tests/apns.test.ts tests/fcm.test.ts tests/...` | partly | ⬜ pending |
| 13-13-T1 | 13 | 5 | NATIVE-19, NATIVE-20 | T-13-29, T-13-30, T-13-31 | [tracer] Request deletion with a password, be deactivated at once, cancel by signing in again, see the notice once | pgTAP + integration | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/222-ac...` | partly | ⬜ pending |
| 13-13-T2 | 13 | 5 | NATIVE-21 | T-13-29, T-13-30, T-13-31 | The anonymisation job, the soft delete of the Auth account and the completion e-mail | pgTAP + integration | `pnpm --filter @rede-social/core exec vitest run tests/anonymise-job.test.ts && pnpm db:reset && pnpm db:see...` | partly | ⬜ pending |
| 13-13-T3 | 13 | 5 | NATIVE-19, NATIVE-20, NATIVE-21 | T-13-29, T-13-30, T-13-31 | [GATE] Inventories, rate limit and the whole deletion suite are green | static guard | `pnpm boundaries && pnpm guard:lanes && TURBO_CACHE=local:r pnpm turbo typecheck --filter=@rede-social/core ...` | new | ⬜ pending |
| 13-14-T1 | 14 | 6 | NATIVE-31 | T-13-32, T-13-33, T-13-34 | [tracer] A member reports a comment and the admin removes it through the existing paths, in one transaction | pgTAP + integration | `pnpm db:reset && pnpm db:seed && pnpm supabase test db supabase/tests/000-helpers.sql supabase/tests/223-re...` | partly | ⬜ pending |
| 13-14-T2 | 14 | 6 | NATIVE-33 | T-13-32, T-13-33, T-13-34 | Block and unblock, the blocked-author filter on the five read paths and the report and block riders | integration | `pnpm db:reset && pnpm db:seed && pnpm --filter @rede-social/api exec vitest run tests/integration/reports-b...` | partly | ⬜ pending |
| 13-14-T3 | 14 | 6 | NATIVE-31, NATIVE-33 | T-13-32, T-13-33, T-13-34 | [GATE] Edges, rate limits, isolation inventory, boundaries and the module suites are green | static guard | `pnpm boundaries && pnpm guard:lanes && pnpm --filter @rede-social/web exec vitest run lib/route-handlers.in...` | new | ⬜ pending |
| 13-15-T1 | 15 | 6 | NATIVE-14 | T-13-35, T-13-36 | [tracer] Prove the dot-folder route and serve both files for the primary host | unit | `pnpm --filter @rede-social/web exec vitest run lib/well-known.test.ts && TURBO_CACHE=local:r pnpm turbo typ...` | partly | ⬜ pending |
| 13-15-T2 | 15 | 6 | NATIVE-14 | T-13-35, T-13-36 | The Playwright request matrix: no redirect, unauthenticated, tenant-down, suspended, alias, partial data, platform host, browser unchanged | e2e | `pnpm db:reset && pnpm db:seed && pnpm --filter @rede-social/web exec playwright test e2e/well-known.spec.ts` | partly | ⬜ pending |
| 13-15-T3 | 15 | 6 | NATIVE-14, NATIVE-32 | T-13-35, T-13-36 | [GATE] The web build, lint and unit suites stay green with the new routes | unit | `pnpm lint && TURBO_CACHE=local:r pnpm turbo typecheck test --filter=@rede-social/web --concurrency=4 && pnp...` | new | ⬜ pending |
| 13-16-T1 | 16 | 4 | NATIVE-03 | T-13-37, T-13-38 | [tracer] The app user agent opens the member shell with no install gate, and a browser's output is byte-identical | unit | `pnpm --filter @rede-social/web exec vitest run lib/native-app.test.ts lib/install-gate.test.ts components/p...` | partly | ⬜ pending |
| 13-16-T2 | 16 | 4 | NATIVE-05, NATIVE-16 | T-13-37, T-13-38 | The bridge client, the platform header, native share and the logout signal | unit | `pnpm --filter @rede-social/web exec vitest run lib/native-app.test.ts lib/api.test.ts components/feed compo...` | partly | ⬜ pending |
| 13-16-T3 | 16 | 4 | NATIVE-03, NATIVE-04 | T-13-37, T-13-38 | [GATE] Playwright with the app user agent: no gate, the refusals unchanged, and a browser unchanged | e2e | `pnpm lint && TURBO_CACHE=local:r pnpm turbo typecheck test --filter=@rede-social/web --concurrency=4 && pnp...` | partly | ⬜ pending |
| 13-17-T1 | 17 | 7 | NATIVE-09, NATIVE-11 | T-13-39, T-13-40 | [tracer] Enable and disable native push from the page through the bridge and the BFF, on a fake shell | unit | `pnpm --filter @rede-social/web exec vitest run lib/push-native.test.ts app/api/push/subscriptions && TURBO_...` | partly | ⬜ pending |
| 13-17-T2 | 17 | 7 | NATIVE-11, NATIVE-17 | T-13-39, T-13-40 | [UI GATE] The explainer sheet, the notification row's app states and the "Bloqueio do app" row (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-17-T3 | 17 | 7 | NATIVE-13, NATIVE-11 | T-13-39, T-13-40 | The icon badge sender, the logout order and the gates | unit | `pnpm lint && TURBO_CACHE=local:r pnpm turbo typecheck test --filter=@rede-social/web --concurrency=4 && pnp...` | partly | ⬜ pending |
| 13-18-T1 | 18 | 8 | NATIVE-24 | T-13-41 | [tracer] The product page removes price, button and link for the app with the switch off, and a browser is byte-identical | e2e | `pnpm --filter @rede-social/web exec vitest run lib/purchase-visible.test.ts "app/(app)/loja" && TURBO_CACHE...` | partly | ⬜ pending |
| 13-18-T2 | 18 | 8 | NATIVE-24 | T-13-41 | [UI GATE] The padlock pill on the Loja card and the neutral note on the product page (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-18-T3 | 18 | 8 | NATIVE-24 | T-13-41 | [UI GATE] The locked community, course, live, lesson and post states, the module placeholders and the sign-up screens (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && TURBO_...` | exists | ⬜ pending |
| 13-19-T1 | 19 | 9 | NATIVE-22, NATIVE-20 | T-13-42, T-13-43 | [UI GATE, tracer] Request deletion, see the scheduled screen, sign in again and see the cancelled toast once (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-19-T2 | 19 | 9 | NATIVE-22 | T-13-42, T-13-43 | [UI GATE] The dialog and error states, the last-administrator notice and the public explanation page (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-19-T3 | 19 | 9 | NATIVE-22 | T-13-42, T-13-43 | [GATE] The settings page and the public routes stay unchanged for everyone else and the web suite is green (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && TURBO_...` | new | ⬜ pending |
| 13-20-T1 | 20 | 10 | NATIVE-31 | T-13-44, T-13-45 | [UI GATE, tracer] Report a comment from its menu and see it in the admin queue, resolved by "Ignorar" (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-20-T2 | 20 | 10 | NATIVE-33 | T-13-44, T-13-45 | [UI GATE] Block and unblock: the dialog, the settings row, the blocked list and the hidden content (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-20-T3 | 20 | 10 | NATIVE-31 | T-13-44, T-13-45 | [UI GATE] The complete admin queue: filters, the resolve sheet, removal and author block, all states (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && TURBO_...` | new | ⬜ pending |
| 13-21-T1 | 21 | 5 | NATIVE-25, NATIVE-26 | T-13-46, T-13-47 | [UI GATE, tracer] The App tab, one write-only credential row and its sheet, from the click to "Guardada" (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-21-T2 | 21 | 5 | NATIVE-25, NATIVE-26 | T-13-46, T-13-47 | [UI GATE] The other two credential rows, the identity card and the IDs sheet (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | new | ⬜ pending |
| 13-21-T3 | 21 | 5 | NATIVE-25 | T-13-46, T-13-47 | [GATE] The new tab does not disturb the platform panel and the web suite is green (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && TURBO_...` | new | ⬜ pending |
| 13-22-T1 | 22 | 6 | NATIVE-24 | T-13-57, T-13-58 | [UI GATE, tracer] The purchase card: off by default, a confirmation to turn on, and the effect on the by-host answer and the bootstrap (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | new | ⬜ pending |
| 13-22-T2 | 22 | 6 | NATIVE-29 | T-13-57, T-13-58 | [UI GATE] The listing card with the privacy URL and the reviewer account (sketch gate) | e2e | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | new | ⬜ pending |
| 13-22-T3 | 22 | 6 | NATIVE-25 | T-13-57, T-13-58 | [UI GATE] The checklist, the generate-the-app disclosure, 320px and the state walk (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && TURBO_...` | new | ⬜ pending |
| 13-23-T1 | 23 | 4 | NATIVE-05, NATIVE-16 | T-13-48, T-13-49 | [tracer] A `share` message from the page reaches the native share sheet only when it passes origin, schema, rate and host checks | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/bridge-router.test.ts tests/bridge-script.test.ts t...` | new | ⬜ pending |
| 13-23-T2 | 23 | 4 | NATIVE-01, NATIVE-23 | T-13-48, T-13-49 | External links, entry paths, back handling, process recovery, theme and settings | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/external-opener.test.ts tests/entry-path.test.ts te...` | new | ⬜ pending |
| 13-23-T3 | 23 | 4 | NATIVE-01, NATIVE-04, NATIVE-16, NATIVE-23 | T-13-48, T-13-49 | [GATE] The workspace passes its checks and the device rows for the shell are queued | unit | `TURBO_CACHE=local:r pnpm turbo typecheck test --filter=@rede-social/mobile --filter=@rede-social/contracts ...` | new | ⬜ pending |
| 13-24-T1 | 24 | 2 | NATIVE-02 | T-13-28 | [tracer] The tenant logo becomes the App Store and Google Play icons, measured by decoding | unit | `pnpm --filter @rede-social/core exec vitest run tests/app-assets.test.ts tests/icons.test.ts` | partly | ⬜ pending |
| 13-24-T2 | 24 | 2 | NATIVE-02, NATIVE-06 | T-13-28 | The splash, the name wrapping, the adaptive foreground and the notification silhouette | unit | `pnpm --filter @rede-social/core exec vitest run tests/app-assets.test.ts && TURBO_CACHE=local:r pnpm turbo ...` | new | ⬜ pending |
| 13-25-T1 | 25 | 6 | NATIVE-02, NATIVE-15, NATIVE-16 | T-13-61, T-13-62 | [tracer] A build record becomes a tenant Expo config, a branding record and a launch decision, all pure | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/tenant-config.test.ts tests/branding-record.test.ts...` | new | ⬜ pending |
| 13-25-T2 | 25 | 6 | NATIVE-06, NATIVE-07 | T-13-61, T-13-62 | [UI GATE] The load-failure screen, the update screen, the loading bar and the layout wiring (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | partly | ⬜ pending |
| 13-25-T3 | 25 | 6 | NATIVE-02, NATIVE-15, NATIVE-16 | T-13-61, T-13-62 | [GATE] The generated native projects carry the tenant's identity, links and permissions (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && TURBO_CACHE=local:r...` | new | ⬜ pending |
| 13-26-T1 | 26 | 7 | NATIVE-11, NATIVE-13 | T-13-63, T-13-64 | [tracer] `push.enable` becomes a prompt, a token and a `push.result` for the page | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/push-handlers.test.ts && pnpm --filter @rede-social...` | new | ⬜ pending |
| 13-26-T2 | 26 | 7 | NATIVE-12, NATIVE-15 | T-13-63, T-13-64 | Notification taps, universal links, the foreground rule and the layout wiring | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/push-response.test.ts tests/push-foreground.test.ts...` | new | ⬜ pending |
| 13-26-T3 | 26 | 7 | NATIVE-11, NATIVE-12, NATIVE-13, NATIVE-15 | T-13-63, T-13-64 | [GATE] The checks are green and the device proofs for push and links are queued (NATIVE-11, 12, 13, 15) | unit | `TURBO_CACHE=local:r pnpm turbo typecheck test --filter=@rede-social/mobile && pnpm lint && pnpm boundaries` | new | ⬜ pending |
| 13-27-T1 | 27 | 5 | NATIVE-17 | T-13-59, T-13-60 | [tracer] Turn the lock on with a verification, decide when it engages, answer the page | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/lock-state-machine.test.ts tests/lock-handlers.test...` | new | ⬜ pending |
| 13-27-T2 | 27 | 5 | NATIVE-17 | T-13-59, T-13-60 | [UI GATE] The lock screen, the privacy cover and the native module, wired into the app layout (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | new | ⬜ pending |
| 13-27-T3 | 27 | 5 | NATIVE-17 | T-13-59, T-13-60 | [GATE] The native module is picked up by the build and the checks are green (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && TURBO_CACHE=local:r...` | new | ⬜ pending |
| 13-28-T1 | 28 | 8 | NATIVE-18 | T-13-65, T-13-66 | [tracer] A loaded feed becomes a bounded snapshot, is stored atomically, and drives the offline decision | unit | `pnpm --filter @rede-social/mobile exec vitest run tests/snapshot-store.test.ts tests/snapshot-handlers.test...` | partly | ⬜ pending |
| 13-28-T2 | 28 | 8 | NATIVE-18 | T-13-65, T-13-66 | [UI GATE] The native saved feed list, its banner and toast, wired into the load flow (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && pnpm lint && pnpm -...` | new | ⬜ pending |
| 13-28-T3 | 28 | 8 | NATIVE-18 | T-13-65, T-13-66 | [GATE] Both workspaces are green and the offline device proofs are queued (sketch gate) | unit | `grep -q '^approved: true' .planning/sketches/017-phase-13-designed-screens/README.md && TURBO_CACHE=local:r...` | new | ⬜ pending |
| 13-29-T1 | 29 | 4 | NATIVE-02, NATIVE-28 | T-13-50, T-13-51, T-13-52 | [tracer] A dry run derives the build record, registers ids on fake stores and prints only non-secret outcomes | integration | `pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release/config.test.ts scripts/app-relea...` | partly | ⬜ pending |
| 13-29-T2 | 29 | 4 | NATIVE-27 | T-13-50, T-13-51, T-13-52 | Unseal safely and generate the signing material on first use, once | integration | `pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release/unseal.test.ts scripts/app-relea...` | new | ⬜ pending |
| 13-29-T3 | 29 | 4 | NATIVE-28 | T-13-50, T-13-51, T-13-52 | [GATE] Publish records the build, the full dry run is repeatable, and the repository gates are green | static guard | `pnpm lint && pnpm boundaries && pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release ...` | new | ⬜ pending |
| 13-30-T1 | 30 | 5 | NATIVE-28 | T-13-53, T-13-54, T-13-SC | [supply chain] Approve the fastlane gem version before it is locked (T-13-SC) | human (human-verify) | `MISSING — Wave 0 gate: a human reply is the artifact; Task 2 starts by reading the recorded reply and stops...` | new | ⬜ pending |
| 13-30-T2 | 30 | 5 | NATIVE-28 | T-13-53, T-13-54, T-13-SC | [tracer] The workflow, the Fastfile and the guard with a failing self-test for every rule | static guard | `bash scripts/check-workflows.sh && bash scripts/check-workflows.sh --self-test && bash scripts/check-releas...` | partly | ⬜ pending |
| 13-30-T3 | 30 | 5 | NATIVE-28 | T-13-53, T-13-54, T-13-SC | Document the runbook and ask for the cloud prerequisites (D-619) | human (human-action) | `grep -q "app-release" docs/DEPLOY.md && grep -q "APP_RELEASE_SA" docs/DEPLOY.md && grep -q "FCM_SERVICE_ACC...` | exists | ⬜ pending |
| 13-31-T1 | 31 | 5 | NATIVE-29 | T-13-55, T-13-56 | [tracer] Create the reviewer account with a sealed password, idempotently, and rotate it | integration | `pnpm --filter @rede-social/core exec vitest run tests/apps-reviewer.test.ts && pnpm db:reset && pnpm db:see...` | partly | ⬜ pending |
| 13-31-T2 | 31 | 5 | NATIVE-29 | T-13-55, T-13-56 | The listing text, the review notes, the questionnaire answers and the store-limit cuts | unit | `pnpm --filter @rede-social/core exec vitest run tests/apps-listing.test.ts && TURBO_CACHE=local:r pnpm turb...` | new | ⬜ pending |
| 13-31-T3 | 31 | 5 | NATIVE-29 | T-13-55, T-13-56 | Push the listing through the store clients, refuse early on missing pieces, and keep the gates green | static guard | `pnpm lint && pnpm exec vitest run --config scripts/vitest.config.ts scripts/app-release && pnpm boundaries ...` | new | ⬜ pending |
| 13-32-T1 | 32 | 11 | NATIVE-30 | T-13-67 | [one-way] Fix the pilot tenant and its permanent identifiers before the first real release | human (decision) | `MISSING — Wave 0 gate: the recorded decision is the artifact; Task 2 starts by reading it and stops if it i...` | new | ⬜ pending |
| 13-32-T2 | 32 | 11 | NATIVE-35 | T-13-67 | The phase gate, the verification map and the proof register are complete and honest | static guard | `pnpm lint && pnpm boundaries && pnpm guard:lanes && pnpm guard:workflows && grep -c "blocked\\|pass" .planni...` | partly | ⬜ pending |
| 13-32-T3 | 32 | 11 | NATIVE-30, NATIVE-35 | T-13-67 | Run the real releases, prove the app on devices and in the stores, and record the evidence | human (human-verify) | `test "$(grep -c '\| pass \|' .planning/phases/13-app-nativo-ios-e-android-por-tenant-white-label/13-MANUAL-PR...` | new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Success-criterion coverage seed (from the research):

| SC | Behavior | Test type | Human / device row |
|----|----------|-----------|--------------------|
| 1 | Only the tenant host loads in the view; `checkoutUrl`, `mailto:`, store links go external; refusals land on the web screens; foreign-tenant session is `TENANT_HOST_MISMATCH` | unit + e2e (UA-spoofed) + API integration | App fixed to host on a phone; recovery, invite, confirm e-mail flows |
| 2 | Browser output unchanged for every touched component; app UA hides install gate, hint and Web Push UI; bridge drops bad shape/origin/type | unit + Playwright (foreign UA and app UA) | Visual pass on a phone |
| 3 | Device register/delete, handoff between members, handoff across tenants impossible; APNs/FCM transport wire format, JWT claims, status mapping, retries | pgTAP + API integration (`PUSH_TRANSPORT=fake`) + unit against local fakes | Real delivery on iPhone and Android; tap opens the page; badge; logout stops pushes |
| 4 | AASA and assetlinks per host: 200, JSON, no redirect, unauthenticated, tenant-down, alias host, missing data is 404, browser unchanged | Playwright request tests on `*.localhost` + unit | Verification on a deployed domain; iOS install; `adb shell pm get-app-links`; mail links |
| 5 | Lock state machine, snapshot store, offline/online variants, share through the bridge | unit | Face ID/fingerprint/passcode, privacy cover, camera/library, offline screen, Mux, TUS, keyboard |
| 6 | Deletion: request, deactivation everywhere (live predicate), grace cancel by sign-in, job anonymises exactly the due rows, idempotent, last-admin refusal, two-tenant negative | pgTAP + API integration + Playwright | Same flow inside the app; completion e-mail |
| 7 | `purchaseVisible` false removes price/button/dialog/link; owned items unchanged; browser always true | unit + Playwright (app UA, switch off) | Link opens system browser; store review outcome |
| 8 | App tab sealed and write-only (reads never contain a secret field, validate-before-replace, no log), role gate; release script ids, `build.json`, dry-run, masking, cleanup | unit + API integration + Playwright + `platform:app-release --dry-run` | Real run to TestFlight and Play internal; pilot published; reviewer account works |
| 9 | Report a post or comment, block a member, admin list and the three resolutions, blocker's read filter on five paths, nobody told, two-tenant negatives (plans 08, 14, 20) | pgTAP + API integration + Playwright | Same flows inside the app; the report and block menus in the stores' review |

---

## Wave 0 Requirements

- [ ] `apps/mobile` workspace, `vitest.config.ts`, turbo `boundaries` tag (plan 02; no CI job is added, the shipped `static` job runs `turbo typecheck build test` and `boundaries`, and the workspace defines no `build` task); `expo-doctor` and the `expo prebuild --no-install` dry run run inside plans 02, 25, 26 and 27
- [ ] pgTAP, one file per concern, numbers confirmed free after 220: `221-native-devices.sql` (plan 06), `222-account-deletion.sql` (plan 07), `223-reports-blocks.sql` (plan 08), `224-central-tenant-apps.sql` (plan 05, with the platform table counts of `210-central-registry.sql` updated); `010-rls-coverage` and `040-schema-conventions` must pick the new tables up. **Every policy gets a cross-tenant negative test.**
- [ ] Fake APNs/FCM servers and the native fakes under `PUSH_TRANSPORT=fake` (plan 12); fake App Store Connect, Google Play and token servers for `--dry-run` (plan 29)
- [ ] Playwright specs and their `affected-map.json` entries, one editor per wave: `native-marker.spec.ts` (16), `platform-app.spec.ts` (21), `well-known.spec.ts` (15), `native-push.spec.ts` (17), `purchase-switch.spec.ts` (18), `delete-account.spec.ts` (19), `safety.spec.ts` (20)
- [ ] Browser-unchanged tests with goldens captured BEFORE each edit: InstallGate, InstallHint, logout form and share (16), push controls and the shell (17), Loja and locked states (18), settings page (19), Início and `(auth)` (28); report and block (20) change the browser on purpose (D-616)
- [ ] `docs/phase-13-device-checklist.md`, `13-MANUAL-PROOFS.md`, `13-SPIKE-RESULTS.md` (plan 04)
- [ ] Wave 0 spikes S1 to S9 (WebView behaviour, UA marker, Mux/TUS/camera, Realtime resume, share, fastlane signing, AASA on a real domain, Firebase config, privacy cover) recorded in `13-SPIKE-RESULTS.md` (plan 04); plans 15, 16, 23, 26, 27, 29 and 30 read them first

---

## Manual-Only Verifications

Phones cannot reach `*.localhost`, and the developer machine has no Xcode, JDK or Android SDK. Everything below needs a deployed host, a signed build, a real device or a store account, and is recorded with evidence (device model, OS, build number), never inferred from CI.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Apple CDN fetch of AASA, Android domain verification | NATIVE (links) | Needs a deployed custom domain | iOS install then tap an e-mail link; `adb shell pm get-app-links <id>` |
| APNs and FCM delivery, badge, tap-to-open, logout stops pushes | NATIVE (push) | Needs signed builds and real devices | Per `docs/phase-13-device-checklist.md` |
| Face ID / fingerprint lock, privacy cover in the app switcher, camera, library, keyboard | NATIVE (extras) | Native hardware | Per the device checklist |
| Offline screen and saved feed | NATIVE (offline) | Airplane mode on a device | Per the device checklist |
| Mux inline/fullscreen playback and TUS upload inside the WebView | NATIVE (parity) | WebView behaviour | Per the device checklist |
| TestFlight and Play internal upload, listing, reviewer account, App Review and Play review | NATIVE (release) | Store accounts | Per `13-MANUAL-PROOFS.md` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency measured and recorded
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
