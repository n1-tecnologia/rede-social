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
| 01-01-01 | 01 | 1 | MOD-01 | T-01-06 / T-01-SC | Local keys + env files git-ignored; pinned audited packages only | build + unit | `docker info >/dev/null && pnpm turbo typecheck lint build && pnpm --filter @tria/api exec vitest run tests/unit/health.test.ts && curl -fsS http://127.0.0.1:54321/auth/v1/.well-known/jwks.json \| grep -q '"kty"'` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | TENANT-01, TENANT-03, ROLE-01, ROLE-02, AUTH-06 (D-20, D-23, D-24) | T-01-01 / T-01-02 / T-01-04 / T-01-09 / T-01-10 | Forged/missing token → 401; lane runs as `authenticated` via `api_user` (NOINHERIT → 42501 outside a lane); membership read per request; `x-tenant-host` re-resolved from `tenant_domains` and can only deny (403 `TENANT_HOST_MISMATCH`, no tenant named); `by-host` returns slug + displayName only; seed hosts idempotent | integration | `pnpm db:reset && SEED_PASSWORD=Segredo123 pnpm db:seed && SEED_PASSWORD=Segredo123 pnpm --filter @tria/api exec vitest run tests/integration/bootstrap.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | AUTH-02, TENANT-01 (D-20, D-21) | T-02-01 / T-02-02 / T-02-07 / T-02-08 | `@tria/web` scaffold builds (moved from 01-01); HttpOnly `sb-*` cookies; `getClaims()` gates routes; `proxy.ts` classifies the host (tenant / platform / generic) via the cached `by-host` lookup and overwrites every `x-tenant-*` request header; `tenant_slug` cookie only on generic hosts; `x-tenant-host` forwarded to the API | build + typecheck + lint + catalog check | `pnpm --filter @tria/web typecheck && pnpm --filter @tria/web lint && node -e "…required pt-BR keys incl. hostMismatch.body, platform.title…" && pnpm turbo build --filter=@tria/web` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | AUTH-02, AUTH-05, TENANT-01 (D-21, D-22) | T-02-05 | Generic login error; logout `scope: 'local'`; on the tenant host `/entrar` shows the tenant name from the HOST (no cookie) and links `/cadastro`; generic host has no hint; platform host renders the placeholder | e2e (mobile, baseURL = `tria-demo.localhost`) | `SEED_PASSWORD=Segredo123 pnpm --filter @tria/web exec playwright test e2e/login.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 2 | AUTH-02, AUTH-05, TENANT-01 (D-21, D-23) | T-02-03 | Session survives restart; logout is device-local; API ignores `tenant_slug` cookie + Host; an unregistered `x-tenant-host` is a generic host (membership wins) | e2e + integration | `SEED_PASSWORD=Segredo123 pnpm --filter @tria/web exec playwright test e2e/session.spec.ts e2e/logout.spec.ts --project=mobile-chromium && SEED_PASSWORD=Segredo123 pnpm --filter @tria/api exec vitest run tests/integration/bootstrap.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | TENANT-03 | T-03-01 | No claim/role leaks across pooled transactions (local target 54329; recorded 54322 contingency only when the local pooler refuses `api_user` under both username forms — 01-12 staging run is then the pooler proof); guard rejects non-LOCAL settings | spike + script | `SEED_PASSWORD=Segredo123 pnpm db:seed && pnpm spike:supavisor && pnpm guard:lanes` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | ROLE-01 | T-03-02 | `platform_admins` has RLS and zero policies; stubs carry isolation policies | migration + psql | `pnpm supabase migration up && psql … relrowsecurity count = 5 && policy count on platform_admins = 0 && pnpm --filter @tria/core typecheck` | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 3 | AUTH-01, AUTH-04, ROLE-02 | T-04-01 / T-04-02 / T-04-04 / T-04-06 | 409 without tenant disclosure; append-only consents; admin lane only in tenancy; compensation on failure; `by-host` stays registered before `/tenants/{slug}` | unit + integration | `pnpm supabase migration up && pnpm --filter @tria/contracts exec vitest run && SEED_PASSWORD=Segredo123 pnpm --filter @tria/api exec vitest run tests/integration/signup.test.ts` | ❌ W0 | ⬜ pending |
| 01-04-02 | 04 | 3 | AUTH-01, AUTH-04 (D-22) | T-04-07 / T-04-08 | Unchecked separate consents; strict slug; password never in URL/log; on tenant hosts the host slug wins over the hidden form slug | typecheck + lint | `pnpm --filter @tria/web typecheck && pnpm --filter @tria/web lint` | ❌ W0 | ⬜ pending |
| 01-04-03 | 04 | 3 | AUTH-01 (D-21, D-22) | T-04-01 / T-04-08 | Duplicate copy generic; round trip keeps the tenant via the host (`/cadastro` on the tenant domain) and via the cookie (`/cadastro/{slug}` on generic hosts); platform host redirects sign-up to `/entrar` | e2e (mobile) | `SEED_PASSWORD=Segredo123 pnpm --filter @tria/web exec playwright test e2e/signup.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-05-01 | 05 | 3 | AUTH-03 (D-22) | T-05-01 / T-05-02 / T-05-08 | Constant recovery response; `next` open-redirect guard; recovery link origin = the request host (asserted on `tria-demo.localhost`) | e2e (Mailpit) | `SEED_PASSWORD=Segredo123 pnpm --filter @tria/web exec playwright test e2e/recovery.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-05-02 | 05 | 3 | AUTH-06, TENANT-01 (D-23) | T-05-03 / T-05-04 / T-05-05 / T-05-07 | 403 on the very next request; expired/forged/HS256 → 401; suspension screen shows no reason; wrong-host session → signed out + `/endereco-invalido` naming no tenant; blocked checked before host | integration + e2e | `SEED_PASSWORD=Segredo123 pnpm --filter @tria/api exec vitest run tests/integration/auth-middleware.test.ts && SEED_PASSWORD=Segredo123 pnpm --filter @tria/web exec playwright test e2e/blocked.spec.ts e2e/host-mismatch.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-06-01 | 06 | 4 | ROLE-06, ROLE-01, TENANT-01 (D-23) | T-06-02 / T-06-03 / T-06-04 / T-06-07 | Missing/disabled row → 404; role 403; tenant-keyed flags cache; membership never cached; `requireSuperAdmin` rejects tenant hosts; platform admin on a tenant host → `TENANT_HOST_MISMATCH` | unit + integration | `pnpm supabase migration up && pnpm --filter @tria/core test && SEED_PASSWORD=Segredo123 pnpm --filter @tria/api exec vitest run tests/integration/auth-middleware.test.ts` | ❌ W0 | ⬜ pending |
| 01-06-02 | 06 | 4 | ROLE-06, MOD-02 (D-24) | T-06-01 / T-06-06 | Platform route behind `requireSuperAdmin` only; `example` never in real-tenant defaults; seed keeps the two `tenant_domains` rows | unit + seed + psql | `pnpm --filter @tria/api exec vitest run tests/unit/registry.test.ts && SEED_PASSWORD=Segredo123 SUPER_ADMIN_PASSWORD=SuperSegredo123 pnpm db:seed && psql … "select count(*) from public.tenant_domains" \| grep -qx 2 && pnpm --filter @tria/api typecheck` | ❌ W0 | ⬜ pending |
| 01-06-03 | 06 | 4 | ROLE-06, ROLE-01, TENANT-01 (D-21, D-23) | T-06-01 / T-06-02 / T-06-07 | 404 on tria-lab disabled module; 401 before 404; super_admin vs admin_tenant on platform; platform lane host rule; platform host serves the super_admin and signs out members | integration + typecheck + lint + e2e | `SEED_PASSWORD=Segredo123 SUPER_ADMIN_PASSWORD=SuperSegredo123 pnpm --filter @tria/api exec vitest run tests/integration/modules.test.ts && pnpm --filter @tria/web typecheck && pnpm --filter @tria/web lint && SEED_PASSWORD=Segredo123 SUPER_ADMIN_PASSWORD=SuperSegredo123 pnpm --filter @tria/web exec playwright test e2e/platform.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-07-01 | 07 | 5 | MOD-01 | T-07-05 | pg-boss schema via migration; `api_user` DML only; `migrate: false`; API boots DB-free (pg-boss lazy, worker owns createQueue) | unit + psql + boot smoke | `pnpm supabase migration up && pnpm --filter @tria/core test && pnpm --filter @tria/api typecheck && psql … has_schema_privilege('api_user','pgboss','USAGE') = t && pnpm --filter @tria/api build && (closed-port DATABASE_URL ROLE=api node apps/api/dist/main.js & … curl :18787/v1/health \| grep -q '"ok":true')` | ❌ W0 | ⬜ pending |
| 01-07-02 | 07 | 5 | MOD-01, MOD-02, ROLE-06 | T-07-01 / T-07-02 / T-07-03 / T-07-06 | Admin-only POST; RLS hides foreign items (404); job under tenant lane; boundaries + lane guard green | unit + integration + lint | `pnpm supabase migration up && pnpm turbo typecheck lint --filter=@tria/module-example --filter=@tria/api && pnpm --filter @tria/api exec vitest run tests/unit/mounts.test.ts && SEED_PASSWORD=Segredo123 pnpm --filter @tria/api exec vitest run tests/integration/example.test.ts && pnpm boundaries && pnpm guard:lanes` | ❌ W0 | ⬜ pending |
| 01-07-03 | 07 | 5 | MOD-01, ROLE-06 | T-07-01 | Form only for `example.create`; other tenant sees nothing | e2e (mobile) | `pnpm --filter @tria/web typecheck && pnpm --filter @tria/web lint && SEED_PASSWORD=Segredo123 pnpm --filter @tria/web exec playwright test e2e/example.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-08-01 | 08 | 6 | TENANT-03, TENANT-05, ROLE-01, ROLE-02 (D-20) | T-08-01 / T-08-02 / T-08-03 / T-08-07 | RLS on every table incl. `tenant_domains`; cross-tenant read/write blocked in-DB (tenant_domains read-only for the lane); lane roles; no bypassrls; citext unique host + one primary per tenant | pgTAP | `pnpm supabase test db && pnpm supabase test db` | ❌ W0 | ⬜ pending |
| 01-08-02 | 08 | 6 | TENANT-05, MOD-02 (D-23) | T-08-02 / T-08-05 / T-08-07 | API never returns another tenant's rows; session of tenant A on tenant B's host → 403 `TENANT_HOST_MISMATCH` (no B rows, no names); cookie/Host saying B with membership A → A's data; boundary fixture rejected by both lint layers | integration + lint | `SEED_PASSWORD=Segredo123 SUPER_ADMIN_PASSWORD=SuperSegredo123 pnpm --filter @tria/api exec vitest run tests/integration/isolation.test.ts && pnpm boundaries && pnpm boundaries:negative` | ❌ W0 | ⬜ pending |
| 01-08-03 | 08 | 6 | TENANT-03, TENANT-05 | T-08-04 | [BLOCKING] Supabase CLI is the only applier; `db:generate` is a no-op after clean apply; Docker image still boots DB-free after 01-07 | full suite + docker smoke | `pnpm db:reset && pnpm supabase test db && … pnpm turbo lint typecheck build test && pnpm boundaries && pnpm boundaries:negative && pnpm guard:lanes && … pnpm test:integration && … pnpm spike:supavisor && … pnpm e2e && pnpm db:generate && test -z "$(git status --porcelain supabase/migrations)" && docker build -f apps/api/Dockerfile -t tria-api:local . && docker run … -e DATABASE_URL=postgres://x:y@127.0.0.1:1/x -e ROLE=api … && curl -fsS http://127.0.0.1:18080/v1/health \| grep -q '"ok":true'` | ❌ W0 | ⬜ pending |
| 01-09-01 | 09 | 2 | PWA-04 | T-09-05 | Non-root image; health needs no DB credentials | docker smoke | `docker build -f apps/api/Dockerfile -t tria-api:local . && docker run … -e DATABASE_URL=postgres://x:y@127.0.0.1:1/x … && curl -fsS http://127.0.0.1:18080/v1/health \| grep -q '"ok":true'` | ❌ W0 | ⬜ pending |
| 01-09-02 | 09 | 2 | PWA-04 (D-24) | T-09-01 / T-09-02 / T-09-03 / T-09-04 | Prod job `needs: [checks, build]` with `checks` = reusable `ci.yml` (`workflow_call`) for the same SHA (D-12); gated prod job; env-scoped secrets; no cancel-in-progress on deploys; WIF only; runtime SA (`vars.RUNTIME_SA`) on every deploy step; seed steps receive `vars.PLATFORM_HOST` / `vars.TENANT_DEMO_HOST` / `vars.TENANT_LAB_HOST` | YAML parse + grep | `for f in .github/workflows/*.yml; do ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$f"; done && grep -q "cancel-in-progress: false" .github/workflows/deploy-api.yml && grep -q "name: production" … && grep -q "workflow_dispatch" .github/workflows/seed-prod.yml && grep -q "turbo-ignore" apps/web/vercel.json && grep -q -- '--service-account=${{ vars.RUNTIME_SA }}' .github/workflows/deploy-api.yml && awk '/deploy-cloudrun@v3/{u++} /vars\.RUNTIME_SA/{s++} END{exit !(u==4 && s==u)}' .github/workflows/deploy-api.yml && grep -q "workflow_call" .github/workflows/ci.yml && grep -q "uses: ./.github/workflows/ci.yml" .github/workflows/deploy-api.yml && ruby -ryaml -e '…jobs["migrate-and-deploy-prod"]["needs"] includes checks and build; jobs["checks"]["uses"] == ./.github/workflows/ci.yml…'` | ❌ W0 | ⬜ pending |
| 01-10-01 | 10 | 7 | PWA-04 | T-10-03 | Decision on the D-12 gate mode recorded | checkpoint:decision | — (human decision; recorded in docs/DEPLOY.md) | n/a | ⬜ pending |
| 01-10-02 | 10 | 7 | PWA-04 (D-21, D-24) | T-10-04 | Account ownership confirmed; CLIs authenticated; real platform domain + seed tenant hostnames confirmed | checkpoint:human-action | `vercel teams ls && gcloud config get-value project && supabase orgs list` | n/a | ⬜ pending |
| 01-10-03 | 10 | 7 | PWA-04 (D-24) | T-10-01 / T-10-02 | No secret values in git; prod secrets env-scoped; `main` protected; DEPLOY.md Hosts table (`PLATFORM_HOST`, `TENANT_DEMO_HOST`, `TENANT_LAB_HOST`) | CLI assertions | `test "$(git rev-parse --abbrev-ref HEAD)" = main && gh api repos/{owner}/{repo}/environments … \| grep -q production && supabase projects list \| grep -q rede-social-prod && gh secret list --env production \| grep -q SUPABASE_PROJECT_ID` | n/a | ⬜ pending |
| 01-11-01 | 11 | 8 | PWA-04 | T-11-01 / T-11-02 | WIF pinned to the repo; runtime SA reads secrets only and is published as `RUNTIME_SA` for the deploy steps; no JSON keys | CLI assertions | `gcloud artifacts repositories describe rede-social … && gcloud iam workload-identity-pools providers describe github-actions … && gcloud secrets list … \| grep -c … \| grep -qx 8 && gh variable list \| grep -q WIF_PROVIDER && gh variable list \| grep -q RUNTIME_SA` | n/a | ⬜ pending |
| 01-11-02 | 11 | 8 | PWA-04 (D-21, D-22, D-24) | T-11-03 / T-11-04 / T-11-07 | Sending-only Resend key; wildcard redirects staging-only, production allow-list = exactly the platform host + two seed tenant hosts; three Vercel domains attached; `PLATFORM_HOST` on Vercel production only; host variables in both GitHub environments; Phase 2 custom-domain flow documented, not built; local SMTP untouched | CLI + grep | `vercel project ls … \| grep -q rede-social && grep -q 'smtp.resend.com' supabase/config.toml && grep -q 'env(RESEND_API_KEY)' supabase/config.toml && grep -q 'Custom domains' docs/DEPLOY.md && gh secret list --env production \| grep -q RESEND_API_KEY && gh variable list --env production \| grep -q TENANT_DEMO_HOST && gh variable list --env staging \| grep -q PLATFORM_HOST` | n/a | ⬜ pending |
| 01-11-03 | 11 | 8 | PWA-04, AUTH-06 (D-24) | T-11-05 | ES256 JWKS on both hosted projects; DNS verified for the three Vercel hosts + Resend | checkpoint:human-action | `curl … resend domains/<id> → verified; dig +short CNAME "$PLATFORM_HOST" / "$TENANT_DEMO_HOST" / "$TENANT_LAB_HOST"; vercel domains inspect each; both JWKS contain "alg":"ES256"` | n/a | ⬜ pending |
| 01-12-01 | 12 | 9 | PWA-04, TENANT-03 (D-21, D-24) | T-12-02 / T-12-03 | Staging spike passes in the recorded pooler mode; sign-up smoke on Preview only (generic host, slug/cookie fallback); staging `by-host` resolves `TENANT_DEMO_HOST`; verify refuses empty/local `SPIKE_DATABASE_URL` or non-vercel.app `PREVIEW_URL` (no vacuous pass) | remote spike + e2e | `case "$SPIKE_DATABASE_URL" in *.pooler.supabase.com:*) ;; *) exit 1;; esac && case "$PREVIEW_URL" in https://*.vercel.app*) ;; *) exit 1;; esac && test -n "$TENANT_A" && test -n "$TENANT_B" && curl -fsS "$API/v1/health?deep=1" \| grep -q '"db":true' && SPIKE_DATABASE_URL="$SPIKE_DATABASE_URL" … pnpm spike:supavisor && PLAYWRIGHT_BASE_URL="$PREVIEW_URL" pnpm --filter @tria/web exec playwright test e2e/smoke-remote.spec.ts --project=mobile-chromium` | ❌ W0 | ⬜ pending |
| 01-12-02 | 12 | 9 | PWA-04 | T-12-01 | One human approval before production migrations | checkpoint:human-action | `gh run view <run-id> --json jobs … migrate-and-deploy-prod = success && curl … /v1/health?deep=1` | n/a | ⬜ pending |
| 01-12-03 | 12 | 9 | PWA-04, AUTH-03 (D-20, D-21, D-22, D-23, D-24) | T-12-04 / T-12-05 / T-12-06 | Vercel Production `API_URL` = Cloud Run `api` URL + fresh build of `main` before the smoke; prod seeded once via dispatch (incl. `tenant_domains`); login-only smokes on production — member on `https://$TENANT_DEMO_HOST`, super_admin on `https://$PLATFORM_HOST` (member rejected there); `by-host` resolves the demo host; real recovery e-mail (human-check) | env check + workflow + e2e + human-check | `test -n "$PLATFORM_HOST" && test -n "$TENANT_DEMO_HOST" && (cd apps/web && vercel env ls production \| grep -q API_URL) && curl -fsS "$API/v1/health?deep=1" \| grep -q '"db":true' && curl -fsS "$API/v1/public/tenants/by-host?host=$TENANT_DEMO_HOST" \| grep -q '"slug":"tria-demo"' && gh run list --workflow=seed-prod.yml --limit 1 … success && PLAYWRIGHT_BASE_URL="https://$TENANT_DEMO_HOST" … playwright test e2e/login.spec.ts --project=mobile-chromium && PLAYWRIGHT_BASE_URL="https://$PLATFORM_HOST" PLAYWRIGHT_PLATFORM_URL=… PLAYWRIGHT_DEMO_URL=… SUPER_ADMIN_… playwright test e2e/platform.spec.ts --project=mobile-chromium` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/config/vitest.base.ts` + per-package `vitest.config.ts` — framework install `pnpm add -Dw vitest@5.0.0 @vitest/coverage-v8@5.0.0`
- [ ] `apps/api/tests/integration/{setup.ts,bootstrap,isolation,modules,signup,auth-middleware}.test.ts` — stubs for TENANT-01, TENANT-05, ROLE-06, AUTH-01/04, AUTH-06 (needs local stack + seed)
- [ ] `supabase/tests/{000-helpers,010-rls-coverage,020-tenant-isolation,030-lanes,040-schema-conventions}.sql` — pgTAP stubs for TENANT-03, TENANT-05, ROLE-01/02
- [ ] `scripts/spike-supavisor.test.ts` — Supavisor `set_config` + `SET LOCAL ROLE` spike (before schema freeze)
- [ ] `apps/web/playwright.config.ts` with `devices['iPhone 14']` project and `baseURL` = `http://tria-demo.localhost:3000` (01-02; Chromium resolves `*.localhost` to loopback, `e2e/fixtures.ts` exposes `hosts.{demo,lab,platform,generic}` + `isRemote`); `e2e/{login,session,logout}.spec.ts` (01-02), `signup.spec.ts` (01-04), `recovery.spec.ts` + `blocked.spec.ts` + `host-mismatch.spec.ts` (01-05), `platform.spec.ts` (01-06), `example.spec.ts` (01-07), `smoke-remote.spec.ts` (01-12) — AUTH-01..06, TENANT-01 (D-20..D-24)
- [ ] `scripts/guard-local-settings.sh` (01-03) and `scripts/check-boundaries.sh` (01-08) — CI guards for TENANT-03 / MOD-02
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
