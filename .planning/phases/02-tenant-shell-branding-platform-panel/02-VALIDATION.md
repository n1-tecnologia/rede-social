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
| **Quick run command** | `pnpm --filter <pkg> test` for the owning package (`@tria/core`, `@tria/contracts`, `@tria/api`, `@tria/ui`, `@tria/web`) + `pnpm lint` |
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

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Filled by the planner from `02-RESEARCH.md` §"Phase Requirements → Test Map" once PLAN.md task IDs exist.*

---

## Wave 0 Requirements

- [ ] `apps/web/vitest.config.ts` + `packages/ui/vitest.config.ts` (`happy-dom`, Testing Library) — framework install: `pnpm --filter @tria/web add -D vitest@5.0.0 happy-dom @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 @vitejs/plugin-react@6.1.1`
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
