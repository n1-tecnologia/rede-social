---
phase: 2
slug: tenant-shell-branding-platform-panel
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `02-RESEARCH.md` §Validation Architecture; the per-task map is filled by the planner (Dimension 8) and validated by `/gsd-validate-phase 2`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit: `packages/*`, `apps/api/tests/unit`; integration: `apps/api/tests/integration` against the local stack), Playwright 1.63.0 (`apps/web/e2e`, projects `mobile-chromium` + `desktop-chromium`), pgTAP via `supabase test db` (`supabase/tests/*.sql`) |
| **Config file** | `packages/config/vitest.base.ts` merged per package; `apps/web/playwright.config.ts`; no Vitest in `apps/web` / `packages/ui` yet — Wave 0 installs `apps/web/vitest.config.ts` + `packages/ui/vitest.config.ts` (`happy-dom`, Testing Library) |
| **Quick run command** | `pnpm --filter <pkg> test` for the owning package (`@rede-social/core`, `@rede-social/contracts`, `@rede-social/api`, `@rede-social/ui`, `@rede-social/web`) + `pnpm lint` |
| **Full suite command** | `pnpm turbo lint typecheck test && pnpm test:integration && pnpm supabase test db && pnpm e2e` |
| **Estimated runtime** | ~60 s (quick, per package) · ~10–15 min (full, incl. local stack integration + both Playwright projects) |

---

## Sampling Rate

- **After every task commit:** Run the owning package's `pnpm --filter <pkg> test` + `pnpm lint`
- **After every plan wave:** Run `pnpm turbo lint typecheck test && pnpm test:integration && pnpm supabase test db`
- **Before `/gsd-verify-work`:** Full suite must be green, including `pnpm e2e` on both Playwright projects, the build-output check (`scripts/check-no-static-routes.mjs`) and the manual iOS/Android standalone check
- **Max feedback latency:** 120 seconds (quick command)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | REQ-{XX} | T-2-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |
| 02-17-01 | 17 | 8 | TENANT-07 (CR-01; D-34) | T-02-140 / T-02-141 / T-02-142 | Provider error re-arms exactly one `created` verify job and honours the deadline; `last_error` stores only `kind[:status]` (never the provider body); the branch never writes `verified_at` and never touches a row a concurrent winner verified (`isNull(verifiedAt)` guard) | unit + integration | `pnpm --filter @rede-social/core test -- domains-fake && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && pnpm test:integration -- platform-domains` (platform-domains cases 17-20) | ✅ (new cases in existing files) | ⬜ pending |
| 02-17-02 | 17 | 8 | TENANT-07 (WR-01) | T-02-143 | `last_error` is cleared only after `ensureVerifiedSideEffects` reports success on a verified host; a failed side effect keeps its cause visible | unit + integration | `pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/core test && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && pnpm --filter @rede-social/api test && pnpm test:integration -- platform-domains jobs worker` | ✅ | ⬜ pending |
| 02-18-01 | 18 | 8 | MOD-04, TENANT-02 (WR-05) | T-02-145 | Bootstrap membership select is scoped by `tenant_id` AND `user_id` through `membershipOfRecord(ctx)` (PgDialect SQL asserted), so the V1 one-tenant-per-user index can be relaxed without a cross-tenant row leaking | unit + integration | `pnpm --filter @rede-social/core test -- membership-scope && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && pnpm --filter @rede-social/api test && pnpm test:integration -- bootstrap invites` | ❌ created by the task (`packages/core/tests/membership-scope.test.ts`, RED first) | ⬜ pending |
| 02-18-02 | 18 | 8 | TENANT-02 (WR-06; D-20, D-36) | T-02-146 / T-02-147 | `by-host` lookup aborts after 2 s (`AbortSignal.timeout`); timeout/error fails open to the GENERIC shell cached for the error TTL — never to another tenant's brand | unit | `pnpm --filter @rede-social/web test -- tenant-host proxy && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh` | ❌ created by the task (`apps/web/lib/tenant-host.test.ts`) | ⬜ pending |
| 02-18-03 | 18 | 8 | ROLE-03 (WR-07; UI-SPEC E14 error) | T-02-147 / T-02-148 | Every `useSignedUpload.onFile` failure path (rejected action or thrown transfer) resets `busy`/`state`/`progress` and renders the generic pt-BR message; `String(error)` goes to the console only | component (happy-dom) | `pnpm --filter @rede-social/web test && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh && node -e "…happy-dom 20.14.5 + @testing-library/react 16.3.3 pinned in apps/web devDependencies…"` | ❌ created by the task (`apps/web/components/platform/LogoUpload.test.ts`; installs happy-dom + Testing Library) | ⬜ pending |
| 02-19-01 | 19 | 9 | ROLE-03 (WR-02, WR-03; D-29, D-30) | T-02-151 / T-02-152 / T-02-153 / T-02-154 | `identityConflict` pre-check runs BEFORE any GoTrue call in both send paths; refusal answers 409 `INVITE_STATE_INVALID` with a reason code only (`email_in_use` / `user_in_other_tenant`, no tenant named); membership upsert conflicts only on the same tenant+user; 23505 on the one-tenant-per-user index maps to the refusal; each refusal is logged | contract + integration | `pnpm --filter @rede-social/contracts typecheck && pnpm --filter @rede-social/contracts test && pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && pnpm test:integration -- invites` (R1, R2, R3 + tuple case updated) | ✅ (new cases in existing files) | ⬜ pending |
| 02-19-02 | 19 | 9 | ROLE-03 (WR-04; D-29) | T-02-150 | Recovery-link fallback is minted ONLY when `tenant_invites.user_id` is set and THIS tenant's membership for that user is `invited`; an `active` membership answers `already_accepted` with no mail | integration | `pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && pnpm test:integration -- invites` (R4, R5) | ✅ | ⬜ pending |
| 02-19-03 | 19 | 9 | ROLE-03, TENANT-07 (WR-03 create-time; D-31, D-30) | T-02-152 / T-02-154 / T-02-155 | `POST /v1/platform/tenants` with an in-use `adminEmail` answers 400 `VALIDATION_FAILED { adminEmail: 'in_use' }` (case-insensitive) with zero partial rows; domain verify records `last_error 'invite:email_in_use'` and the refused invite stays terminal (no re-mail on re-check); set-primary survives a refused invite inside it | unit + integration | `pnpm --filter @rede-social/core typecheck && pnpm --filter @rede-social/core lint && pnpm --filter @rede-social/core test && pnpm --filter @rede-social/api typecheck && pnpm --filter @rede-social/api lint && pnpm --filter @rede-social/api test && pnpm test:integration -- platform-tenants platform-domains invites` (platform-tenants case 21, platform-domains case 21) | ✅ | ⬜ pending |
| 02-20-01 | 20 | 10 | ROLE-03, PWA-03 (WR-02/WR-03 panel; D-30, D-31; UI-SPEC E11/E17 error) | T-02-160 / T-02-161 | Every refusal copy comes from the catalog by key (the reason map knows only the two documented reasons + generic fallback, names no tenant, renders nothing from the API body raw); the `refused` state is view-only, derived from `status === 'expired' && sentAt === null`, never in contracts/API | unit + typecheck + lint + catalog check | `pnpm --filter @rede-social/web test && pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && bash scripts/check-ui-literals.sh && node -e "…platform.new.errors.emailInUse, platform.admins.inviteRefused, platform.admins.resendEmailInUse, platform.admins.resendUserInOtherTenant present…"` | ✅ | ⬜ pending |
| 02-20-02 | 20 | 10 | ROLE-03 (WR-02/WR-03 e2e) | T-02-162 | e2e cleanup removes every throwaway identity and tenant (`created.emails` / `created.slugs` pushed before any create call; `deleteUserByEmail` cascades the rede-lab membership); the foreign membership stays `{ role: 'member', status: 'active' }` | e2e (desktop-chromium, local stack) | `pnpm --filter @rede-social/web typecheck && pnpm --filter @rede-social/web lint && pnpm --filter @rede-social/web exec playwright test platform-tenants.spec.ts invite.spec.ts --project=desktop-chromium` (platform-tenants case 8, invite case 4) | ✅ (new cases in existing specs) | ⬜ pending |
| 02-20-03 | 20 | 10 | ROLE-03, TENANT-07, TENANT-02, MOD-04, PWA-03 (phase exit gate, 02-16 contract) | T-02-163 | Gate runs against fresh servers and a fresh `apps/api/dist` (no false green/red); exact commands, exit codes, counts and durations recorded in 02-20-SUMMARY.md `## Exit gate`; expected counts: unit >= 278 + new files, integration >= 176 + 11 (187), five-spec desktop e2e green, `pnpm verify` one shot | full suite (unit + pgTAP + integration + e2e) | `pnpm lint && pnpm turbo typecheck test && rm -rf apps/api/dist && pnpm boundaries && pnpm boundaries:negative && pnpm test:integration && pnpm --filter @rede-social/web exec playwright test invite.spec.ts platform-tenants.spec.ts platform-domains.spec.ts platform-branding.spec.ts phase2-smoke.spec.ts --project=desktop-chromium && pnpm verify` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Gap-closure rows 02-17-01 … 02-20-03 added at plan revision (checker iteration 2). Rows for the executed plans 02-01..02-16 remain to be back-filled by `/gsd-validate-phase 2`; `nyquist_compliant` stays `false` until every row is filled.*

*Filled by the planner from `02-RESEARCH.md` §"Phase Requirements → Test Map" once PLAN.md task IDs exist.*

---

## Wave 0 Requirements

- [ ] `apps/web/vitest.config.ts` + `packages/ui/vitest.config.ts` (`happy-dom`, Testing Library) — framework install: `pnpm --filter @rede-social/web add -D vitest@5.0.0 happy-dom @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 @vitejs/plugin-react@6.1.1`
- [ ] `apps/web/scripts/check-no-static-routes.mjs` wired into `build` (reads `.next/prerender-manifest.json`)
- [ ] `apps/web/e2e/branding.spec.ts`, `domains.spec.ts`, `invite.spec.ts`, `pwa.spec.ts`, `suspended.spec.ts`; fixtures: seed tenants with distinct brands + logos (`scripts/seed.ts`), `e2e/mail.ts` generalised to any `/auth/confirm` link
- [ ] `apps/api/tests/integration/{send-email-hook,domains,domain-verify-job,platform-tenants,suspended}.test.ts`
- [ ] `packages/contracts/tests/branding.test.ts`, `packages/core/tests/{domain-provider,mail-templates,nav,icons}.test.ts` (PNG/SVG fixtures under `packages/core/tests/fixtures/`)
- [ ] Local stack config: `[auth.hook.send_email]`, `[storage.buckets.branding]`, `otp_expiry = 86400`, `SEND_EMAIL_HOOK_SECRETS` in `scripts/local-env.sh`
- [ ] Spike: `@serwist/turbopack` build under TypeScript 7.0.2 (RESEARCH Pitfall 4)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Design-team approval of the UI-SPEC / static mockup for the prototype-less screens (tenant list, new tenant, tenant tabs, domain attach, accept-invite, settings, desktop rail) | UI-04 | Human design review (D-33) | `checkpoint:human-verify` before panel/shell screens are coded; record approval date in the plan |
| App installs and runs in standalone mode on a real iOS Safari and Android Chrome device | PWA-01 | Installability cannot be asserted by Playwright | Open the tenant host on the device → "Adicionar à Tela de Início" → launch → no browser chrome, tenant icon/name shown |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
