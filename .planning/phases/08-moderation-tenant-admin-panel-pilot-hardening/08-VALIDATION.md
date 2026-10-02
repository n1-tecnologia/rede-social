---
phase: "08"
slug: "moderation-tenant-admin-panel-pilot-hardening"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-01"
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Infrastructure, sampling and Wave 0 blocks are transcribed from `08-RESEARCH.md` §Validation Architecture; threat references come from its §Security Domain.
> The Per-Task Verification Map lists requirement rows only; task IDs are bound when the plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.0 (per package; `apps/api` has `tests/unit` + `tests/integration`) · pgTAP via `pnpm supabase test db` · Playwright 1.63.0 (`apps/web/playwright.config.ts`, `apps/web/playwright.pwa.config.ts`) |
| **Config file** | per-package `vitest.config.ts` (a new one for `packages/reuse-fixture`, since Vitest 5 does not walk up for config), `apps/api/vitest.config.ts`, `apps/web/playwright.config.ts`, `apps/web/playwright.pwa.config.ts`, `supabase/tests/*.sql` |
| **Quick run command** | `pnpm --filter @rede-social/api exec vitest run tests/unit` · `pnpm --filter @rede-social/core test` |
| **API integration command** | `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>.test.ts` (`pnpm test:integration -- <name>` does NOT filter) |
| **DB command** | `pnpm supabase test db` |
| **Migration hygiene command** | `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)"` |
| **Full suite command** | `TURBO_CACHE=local:r pnpm verify` |
| **Estimated runtime** | quick ~3–5 s per package; one integration file ~5–15 s after reset+seed; whole integration folder ~50 s+; full suite dominated by e2e (49.8 min single-worker in the 07-15 gate) |

**Plan-file rule:** `<automated>` commands inside PLAN.md XML-escape `&&` as `&amp;&amp;`.

**Video-provider rule:** Playwright runs are prefixed `VIDEO_PROVIDER=fake`; no command depends on real Mux, a tunnel or the hosted projects.

**Disk rule:** builds run with `TURBO_CACHE=local:r`; `rm -rf .turbo/cache` when free space runs low (94% used at research time).

**Production rule:** every migration must be safe to apply before the new API deploys (expand, then contract). Production pushes go through `supabase db push`.

---

## Sampling Rate

- **After every task commit:** the task's own vitest file plus `pnpm lint`
- **After every migration task:** `pnpm db:generate && test -z "$(git status --porcelain -- supabase/migrations)" && pnpm db:reset && pnpm db:seed && pnpm supabase test db`
- **After every plan wave:** `pnpm supabase test db && pnpm --filter @rede-social/api exec vitest run tests/integration` (after a re-seed if needed) and the plan's Playwright spec
- **Before `/gsd-verify-work`:** one green `TURBO_CACHE=local:r pnpm verify` plus one CI run that finishes (D-348), then the D-345 real-device checklist recorded honestly (rows not run stay `blocked`)
- **Max feedback latency:** ~60 seconds per task

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | MODER-01 | tenant isolation | Moderator removes any comment; replies cascade; counts drop; log row in the same tx; a member gets a bare 404 on others' comments | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/moderation-comments.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | MODER-01 | — | Story comment admin removal + `story.comment_deleted` retraction | integration | same file, `-t "story"` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | MODER-02 | admin lockout / tenant isolation | Block → next request 403 `MEMBERSHIP_BLOCKED`; sign-up with the same e-mail 409; push subs deleted; self and last-admin guards; concurrent demotions | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/member-admin.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | MODER-03 | audit tampering / forged log entry | Log append-only: UPDATE/DELETE/TRUNCATE refused in every lane; insert policy pins `tenant_id` and actor to claims; grants revoked; raising trigger | pgTAP | `pnpm supabase test db` (new `160-moderation-log.sql`, extend `020`, `040`) | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | MODER-03 | — | Log list keyset + action filter; admin only; support 403 | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/moderation-log.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-01 | tenant isolation | Tenant-lane branding routes use `ctx.tenantId` only; contrast gate; display name | integration + e2e | `pnpm --filter @rede-social/api exec vitest run tests/integration/admin-branding.test.ts` ; `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test admin-branding.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-02 | membership probe | Admin list shows all statuses, search, status filter; role change effective on the next request; one bare 404 body for unknown/other-tenant/removed | integration + e2e | `pnpm --filter @rede-social/api exec vitest run tests/integration/member-admin.test.ts` ; `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test admin-members.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-03 | stored XSS | Rules save bumps the version only on change; `/cadastro` shows the new text; old consents untouched | integration + e2e | `pnpm --filter @rede-social/api exec vitest run tests/integration/admin-rules.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ADMIN-04 | — | Creation flows at iPhone/Pixel viewports | e2e + manual real device | existing specs on `mobile-chromium` + D-345 checklist | ✅ (specs) / manual | ⬜ pending |
| TBD | TBD | TBD | MOD-05 | — | READMEs match manifests; the reuse fixture builds, mounts and serves one module with only kernel contracts | unit + integration | `pnpm --filter @rede-social/reuse-fixture test` ; `tsx scripts/check-module-readmes.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Gate (TENANT-05) | tenant isolation | Every API route classified in the isolation inventory (case or explicit exemption) | unit | `pnpm --filter @rede-social/api exec vitest run tests/unit/isolation-inventory.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Gate (TENANT-05) | realtime authz | Cross-tenant Realtime topic joins refused (4 kinds) | integration | `pnpm --filter @rede-social/api exec vitest run tests/integration/realtime.test.ts -t "cross-tenant"` | ❌ W0 (new case) | ⬜ pending |
| TBD | TBD | TBD | Gate (PWA-03) | — | Zero UI literals | lint | `pnpm lint` | partial (script exists; rule new) | ⬜ pending |
| TBD | TBD | TBD | Gate (D-346) | stored XSS / clickjacking / third-party frames | CSP header present on every HTML response incl. a refreshed session; zero violations in the smoke | e2e | `VIDEO_PROVIDER=fake pnpm --filter @rede-social/web exec playwright test csp.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | Gate (D-346) | — | API emits no CORS headers | unit | `pnpm --filter @rede-social/api exec vitest run tests/unit/cors.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/160-moderation-log.sql`, plus additions to `020-tenant-isolation.sql` and `040-schema-conventions.sql` (policy shape, grants, trigger)
- [ ] `apps/api/tests/integration/{moderation-comments,member-admin,moderation-log,admin-branding,admin-rules}.test.ts`
- [ ] `apps/api/tests/unit/{isolation-inventory,cors}.test.ts` + `apps/api/tests/isolation-inventory.ts`
- [ ] `packages/reuse-fixture/` with its own `vitest.config.ts`
- [ ] `scripts/check-module-readmes.ts` wired into `pnpm lint`
- [ ] `apps/web/e2e/{csp,admin-branding,admin-members,moderation}.spec.ts` + a shared `securitypolicyviolation` collector fixture
- [ ] CI: split `checks` into jobs (static + unit; pgTAP + integration; e2e sharded with `--shard=i/n`, each with its own `supabase start` + seed; `e2e:pwa`), because e2e alone took 49.8 min single-worker in the 07-15 gate and cannot fit the 60-minute timeout

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin creation flows, branding, members, moderation and rules usable on a phone | ADMIN-04 (SC 3) | Needs a real iPhone and Android phone against production | D-345 consolidated checklist on the production `qa` tenant |
| PWA install + push smoke | Gate (SC 4) | Real-device OS behaviour (iOS Home Screen, Android install, push delivery) | D-345 checklist, including Phase 2, 4, 05.2, 05.3 (WINDOWS #48–#51, REELS-06) and Phase 7 UAT rows 1–17 + the blocked-member-with-an-open-socket check |
| LGPD legal review | Gate (D-349) | Legal sign-off, not code | Gate report row marked done or accepted as a risk, with a date |

Rows that cannot be run stay `blocked`, never recorded as passed.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
