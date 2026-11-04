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
| *(filled by the planner: `13-<plan>-T<task>`)* | | | | | | | | | ⬜ pending |

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

---

## Wave 0 Requirements

- [ ] `apps/mobile` workspace, `vitest.config.ts`, turbo `boundaries` tag, CI job `mobile` (typecheck, test, `expo-doctor`, `expo prebuild --no-install` dry run)
- [ ] pgTAP: native-devices file and account-deletion file (tenant set); a central-set file for `platform.tenant_apps` / `tenant_app_credentials` (RLS on, zero policies; `010-rls-coverage` and `040-schema-conventions` must pick the new tables up). **Every policy gets a cross-tenant negative test.**
- [ ] Fake APNs/FCM servers and `PUSH_TRANSPORT` variants for CI
- [ ] Playwright specs: `native-marker.spec.ts` (UA contexts), `well-known.spec.ts`, `delete-account.spec.ts`, `purchase-switch.spec.ts`; `affected-map.json` entries
- [ ] Browser-unchanged tests for each touched web component (InstallGate, InstallHint, PushSettingRow, soft ask, Loja cards, product page, locked states)
- [ ] `docs/phase-13-device-checklist.md` and `13-MANUAL-PROOFS.md`
- [ ] Wave 0 spikes (WebView behaviour, fastlane signing, AASA on a real domain) producing `13-SPIKE-RESULTS.md`

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
