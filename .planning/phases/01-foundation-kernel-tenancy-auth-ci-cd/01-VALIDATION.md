---
phase: 1
slug: foundation-kernel-tenancy-auth-ci-cd
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-11
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `01-RESEARCH.md` §Validation Architecture; the Per-Task Verification Map is filled by the planner / `/gsd-validate-phase`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (unit + API integration), pgTAP via `supabase test db` (Supabase CLI 2.117.0), Playwright 1.63.0 (auth smoke on a mobile viewport), `turbo boundaries` + Biome 2.5.13 (MOD-02 boundary lint) |
| **Config file** | none yet — Wave 0 creates `packages/config/vitest.base.ts`, per-package `vitest.config.ts` (Vitest 5 does not walk up directories), `apps/web/playwright.config.ts`, `supabase/tests/` |
| **Quick run command** | `pnpm turbo lint typecheck test --filter=...[HEAD^1]` (per package: `pnpm vitest run`) |
| **Full suite command** | `pnpm turbo lint typecheck boundaries test && supabase test db && pnpm --filter @tria/api test:integration && pnpm --filter @tria/web e2e` |
| **Estimated runtime** | ~30 s quick · ~5 min full (requires `supabase start`) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm turbo lint typecheck test --filter=...[HEAD^1]`
- **After every plan wave:** Run the full suite command above (requires `supabase start`)
- **Before `/gsd-verify-work`:** Full suite must be green + staging Supavisor spike green + one manual PR → preview → merge → approval → prod run observed
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/config/vitest.base.ts` + per-package `vitest.config.ts` — framework install `pnpm add -Dw vitest@5.0.0 @vitest/coverage-v8@5.0.0`
- [ ] `apps/api/tests/integration/{setup.ts,bootstrap,isolation,modules,signup,auth-middleware}.test.ts` — stubs for TENANT-01, TENANT-05, ROLE-06, AUTH-01/04, AUTH-06 (needs local stack + seed)
- [ ] `supabase/tests/{000-helpers,010-rls-coverage,020-tenant-isolation,030-lanes,040-schema-conventions}.sql` — pgTAP stubs for TENANT-03, TENANT-05, ROLE-01/02
- [ ] `scripts/spike-supavisor.test.ts` — Supavisor `set_config` + `SET LOCAL ROLE` spike (before schema freeze)
- [ ] `apps/web/playwright.config.ts` with `devices['iPhone 14']` project; `e2e/{auth,session,recovery,logout}.spec.ts` — AUTH-01..05
- [ ] `packages/boundary-fixture` — negative package for the MOD-02 CI check (`! turbo boundaries --filter=@tria/boundary-fixture`)
- [ ] `docker info` green; `supabase start` once to pull images

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PR opens Vercel Preview + Cloud Run `api-staging`/`worker-staging`; merge to `main` deploys prod after one approval in the `production` environment | PWA-04 | Requires live GitHub/Vercel/GCP accounts; CI observes itself | Open a PR, confirm preview URL + staging revision; merge, approve the `migrate-and-deploy-prod` job, `curl` prod `/v1/health` |
| Recovery e-mail delivered to a real inbox through Resend custom SMTP on staging | AUTH-03 | Local stack uses Mailpit/Inbucket; real delivery needs the verified sending domain | Trigger `/esqueci-senha` on staging, open the link from the real inbox, set a new password |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
