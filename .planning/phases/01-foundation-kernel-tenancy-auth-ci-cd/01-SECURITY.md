---
phase: 01
slug: foundation-kernel-tenancy-auth-ci-cd
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-09-14
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Source: the `<threat_model>` block of every plan (01-01..01-09; 66 rows, 64 unique ids), the `## Threat Flags` of seven SUMMARYs, the code review (01-REVIEW.md: 3 critical + 12 warnings, 12 fixed in a168f4c..182e9ed) and the gsd-security-auditor run of 2026-09-14 (State B, register authored at plan time, ASVS L1, block_on high). Every `mitigate` row was verified against the implementation with file:line evidence (see the auditor verdict summarised in the audit trail); `accept` rows are closed by their recorded rationale.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Internet → API (Cloud Run) | Untrusted `Authorization` header, request body and `x-tenant-host` reach Hono | JWT, sign-up PII, consent evidence |
| Browser → Next.js BFF (Vercel) | Untrusted host, cookies, form posts; proxy.ts classifies the host and refreshes the session | HttpOnly session cookies, tenant hint cookie |
| API → Postgres (pooler) | One `api_user` connection shared by all tenants; per-transaction LOCAL settings decide what RLS sees | All tenant rows |
| API → Supabase Auth admin | Service key in the API only (sign-up, seed) | Identities, passwords (hashed by GoTrue) |
| API → pg-boss schema | `set local role api_user` inside a tenant lane; `authenticated` revoked from `pgboss` | Job payloads (tenant-scoped) |
| GitHub Actions → GCP / Supabase / Vercel | WIF (no JSON keys), environment-scoped secrets, `production` environment gate | Deploy credentials, DB passwords |
| Developer machine → local stack | `.env.local`, `signing_keys.json` git-ignored; seed credentials are local-only throwaways | Local secrets |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Spoofing | `require-auth.ts` | critical | mitigate | `jose.jwtVerify` against the JWKS with `issuer` check (ES256 only, no HS256 secret in the API); 401 `INVALID_TOKEN` on any failure | closed |
| T-01-02 | Information disclosure | `tenant-tx.ts` / Supavisor | critical | mitigate | Claims via bound `set_config(..., true)` + `SET LOCAL ROLE`; both die with the transaction; `api_user` NOINHERIT so unscoped queries fail 42 | closed |
| T-01-03 | Elevation of privilege | `supabase-admin.ts`, `admin-tx.ts` | high | mitigate | Biome `noRestrictedImports` limits imports to `packages/core/server/{tenancy,platform}` and `scripts/`; service key only in API env | closed |
| T-01-04 | Elevation of privilege | blocked member with a valid token | high | mitigate | `membershipForUser` on every request, no cache; `status='blocked'` → 403 `MEMBERSHIP_BLOCKED` | closed |
| T-01-05 | Information disclosure | PostgREST with publishable key | medium | mitigate | RLS on every table + `revoke all … from anon` in the grants migration | closed |
| T-01-06 | Information disclosure | `signing_keys.json`, `.env.local` | high | mitigate | Git-ignored; `.env.example` holds names only; CI generates its own local keys | closed |
| T-01-07 | Tampering | migration ordering (policies referencing `app.tenant_id()`) | medium | mitigate | Generate helpers first; acceptance criterion checks filename order; `db reset` from clean proves it | closed |
| T-01-08 | Denial of service | `/v1/health` used by Cloud Run | low | accept | No DB access in health; rate limiting is Phase 8 | closed |
| T-01-09 | Spoofing | `x-tenant-host` header (client → BFF → API) | high | mitigate | The header never SELECTS a tenant: `ctx.tenantId` comes from the membership; the API re-resolves the host from `tenant_domains` and can only | closed |
| T-01-10 | Information disclosure | `GET /v1/public/tenants/by-host` (unauthenticated) | low | mitigate | Response limited to `slug` + `displayName` by `hostTenantSchema.strict()`; suspended tenants answer 404; 60 s negative cache + `no-store` (c | closed |
| T-01-SC | Tampering | npm installs (pnpm) | high | mitigate | Every package is pinned to an audited version (RESEARCH §Package Legitimacy Audit: all Approved, `msw` deferred); `pnpm install --frozen-loc | closed |
| T-02-01 | Information disclosure | session cookies | high | mitigate | `@supabase/ssr` writes `sb-*` as HttpOnly/Secure/SameSite=Lax; no token ever reaches client JS or localStorage; e2e asserts `httpOnly` | closed |
| T-02-02 | Spoofing | `proxy.ts` gating | high | mitigate | `getClaims()` (signature verified) decides access; `getSession()` is used only to forward the token to the API which re-verifies (RESEARCH a | closed |
| T-02-03 | Tampering | `tenant_slug` cookie | medium | mitigate | Display-only and set only on generic hosts; API never reads it; TENANT-01 adjacency test proves independence | closed |
| T-02-04 | Tampering | CSRF on server actions | medium | accept | Next.js Server Actions enforce same-origin (Origin/Host check) and cookies are SameSite=Lax; documented, no extra token in V1 | closed |
| T-02-05 | Information disclosure | login error message | low | mitigate | Single generic "Email ou senha incorretos." regardless of which field failed | closed |
| T-02-06 | Denial of service | login brute force | medium | accept | Supabase sign-in rate limit (30/5 min per IP) in the pilot; stronger limits deferred to Phase 8 per CONTEXT Deferred Ideas | closed |
| T-02-07 | Spoofing | `x-tenant-*` headers / host classification in `proxy.ts` | medium | mitigate | `proxy.ts` overwrites the four `x-tenant-*` request headers on every request (a client cannot claim `platform` or another tenant); the host  | closed |
| T-02-08 | Denial of service | by-host lookup on every request | low | mitigate | Generic fast path (localhost / `*.vercel.app` / platform host need no fetch); 300 s positive, 60 s negative, 10 s error cache per instance;  | closed |
| T-03-01 | Information disclosure | pooled connection state | critical | mitigate | Spike proves LOCAL scope under reuse; `guard-local-settings.sh` fails CI on any non-LOCAL switch; pgTAP `030-lanes.sql` (01-08) re-proves on | closed |
| T-03-02 | Elevation of privilege | `platform_admins` | high | mitigate | RLS enabled, no `authenticated` policy; readable only via `withAdminTx`; `requireSuperAdmin` (01-06) is the sole reader | closed |
| T-03-03 | Tampering | chat/notification stubs written before consumers exist | low | accept | Stubs have RLS + isolation policy; no routes exist; Phase 7 adds triggers and `realtime.messages` policies | closed |
| T-03-04 | Repudiation | spike result not recorded | low | mitigate | SUMMARY records local run output; 01-12 records the staging run before the prod gate | closed |
| T-04-01 | Information disclosure | duplicate e-mail response | medium | mitigate | 409 carries no `details`; generic D-04 copy; cross-tenant fact logged server-side only; test asserts the body never names a tenant | closed |
| T-04-02 | Repudiation | consent evidence | high | mitigate | `consent_records` append-only (select-only policy, admin-lane inserts), DB `now()` timestamp, `text_version` bound to versioned markdown wit | closed |
| T-04-03 | Tampering | `X-Client-IP` header | low | accept | Only the web server action sets it from Vercel's `x-real-ip`; a forged value degrades evidence quality, not authorization; documented | closed |
| T-04-04 | Elevation of privilege | admin lane in `signup.ts` | high | mitigate | Import allowed only under `packages/core/server/tenancy/**` (Biome pattern); role is always `member` (never taken from the request) | closed |
| T-04-05 | Denial of service | sign-up spam | medium | accept | Supabase sign-up rate limit (30/5 min/IP); further limits deferred to Phase 8 (CONTEXT Deferred Ideas) | open — below high threshold (non-blocking) |
| T-04-06 | Tampering | orphan identity after partial failure | medium | mitigate | Compensation `deleteUser` + 500; `NO_MEMBERSHIP` screen (01-05) as the safety net | closed |
| T-04-07 | Spoofing | slug aliasing (`Tria-Demo`) | low | mitigate | Strict lowercase regex; no normalisation; adjacency tests | closed |
| T-04-08 | Tampering | hidden `slug` field vs host on a tenant domain | low | mitigate | On tenant hosts the server action uses `hostTenant.slug` and ignores the form value; the proxy redirects `/cadastro/*` to `/cadastro`; e2e c | closed |
| T-05-01 | Tampering | `next` param on `/auth/confirm` | high | mitigate | Regex `^/(?!/)` guard; e2e asserts external and protocol-relative targets fall back | closed |
| T-05-02 | Information disclosure | account enumeration on `/esqueci-senha` | medium | mitigate | Single constant response (D-10); action has one redirect target; e2e compares known vs unknown e-mail | closed |
| T-05-03 | Elevation of privilege | blocked member keeps a valid token | high | mitigate | Per-request `membership_for_user`, no cache (file unchanged check); test proves 403 on the next request; web clears cookies via route handle | closed |
| T-05-04 | Spoofing | expired / forged / wrong-alg tokens | critical | mitigate | `jose.jwtVerify` with JWKS + issuer; tests (d)(e)(f) | closed |
| T-05-05 | Information disclosure | suspension screen | medium | mitigate | Only tenant display name; no reason, no actor, no timestamp (prohibition) | closed |
| T-05-06 | Denial of service | recovery e-mail flood | low | accept | Supabase e-mail rate limits (custom SMTP 30/h default, adjustable) in the pilot | closed |
| T-05-07 | Information disclosure | host-mismatch screen / 403 body | medium | mitigate | `TENANT_HOST_MISMATCH` carries no `details`; `/endereco-invalido` takes no query, cookie or header input; e2e asserts neither tenant name ap | closed |
| T-05-08 | Tampering | recovery `redirectTo` built from the request `host` | medium | mitigate | GoTrue validates `redirect_to` against the per-project allow-list (local `*.localhost`, production exact hosts — 01-01/01-11), and for an un | closed |
| T-06-01 | Elevation of privilege | `/v1/platform/*` | critical | mitigate | `requireSuperAdmin` verifies the JWT and reads `platform_admins` via admin lane per request; tenant admins get 403 (integration test) | closed |
| T-06-02 | Information disclosure | disabled module routes | medium | mitigate | 404 `MODULE_DISABLED` (existence not confirmed); adjacency tests cover missing vs disabled rows | closed |
| T-06-03 | Elevation of privilege | role checks | high | mitigate | `requireRole` after `requireModule`; role read from the membership row each request, never from the token | closed |
| T-06-04 | Tampering | flags cache cross-tenant bleed | high | mitigate | Cache keyed by tenant id; unit test proves isolation; only `tenant_modules` is cached | closed |
| T-06-05 | Repudiation | platform reads | low | mitigate | pino line `platform.tenants.list` with `userId` + `requestId` (full audit log is Phase 8) | closed |
| T-06-06 | Elevation of privilege | `example` enabled on a real tenant | medium | mitigate | `REAL_TENANT_DEFAULT_MODULES` excludes it (unit test); seed enables it only for `tria-demo` | closed |
| T-06-07 | Elevation of privilege | platform session used on a tenant domain / member session on the platform host | medium | mitigate | `requireSuperAdmin` + `requireAuth` answer 403 `TENANT_HOST_MISMATCH` on registered tenant hosts (test (8)); the platform-host web branch re | closed |
| T-07-01 | Elevation of privilege | `POST /v1/example/items` | high | mitigate | `requireRole('admin_tenant')`; `createdByUserId` from `ctx`, never from the body | closed |
| T-07-02 | Information disclosure | `GET /items/:id` across tenants | high | mitigate | Query inside `withTenantTx`; RLS hides foreign rows → 404 `NOT_FOUND` (test) | closed |
| T-07-03 | Tampering | job payload `tenantId` | medium | mitigate | Handler runs `withTenantTx` with the payload tenant; a mismatched item updates 0 rows (test); enqueue happens only inside the service transa | closed |
| T-07-04 | Denial of service | duplicate jobs / unbounded enqueue | low | mitigate | `singletonKey` = item id; `max: 2` worker pool; pg-boss archiving defaults | closed |
| T-07-05 | Elevation of privilege | pg-boss schema privileges | medium | mitigate | `api_user` gets DML on `pgboss` only via migration; `migrate: false` so runtime never needs DDL rights | closed |
| T-07-06 | Tampering | module importing kernel internals | medium | mitigate | `exports` map + Biome pattern + `turbo boundaries` in `<verify>` | closed |
| T-08-01 | Information disclosure | any tenant table without RLS/policy | critical | mitigate | `010-rls-coverage.sql` fails on the first unprotected table; re-run every CI | closed |
| T-08-02 | Information disclosure | cross-tenant read/write through the lane | critical | mitigate | `020` + `isolation.test.ts` with identical-looking data; `030` proves lane roles | closed |
| T-08-03 | Elevation of privilege | `api_user` privilege creep | high | mitigate | `030` asserts NOINHERIT, no bypassrls, cannot `set role postgres` | closed |
| T-08-04 | Tampering | schema drift between Drizzle and migrations | medium | mitigate | `db:generate` must be a no-op after clean apply (Task 3) | closed |
| T-08-05 | Tampering | module boundary erosion | medium | mitigate | Negative fixture keeps both lint layers honest (`boundaries:negative`) | closed |
| T-08-06 | Repudiation | suite skipped locally | low | mitigate | CI (01-09) runs the same order; VALIDATION.md sampling rule | closed |
| T-08-07 | Information disclosure | session of tenant A presented on tenant B's host | critical | mitigate | `isolation.test.ts` (f2)/(g2) assert 403 `TENANT_HOST_MISMATCH` with no B rows and no tenant names; `020` proves `tenant_domains` itself is  | closed |
| T-09-01 | Elevation of privilege | production deploy path | critical | mitigate | `environment: production` with one required reviewer (D-12; fallback `workflow_dispatch`); prod job only on `push` to `main`; never from a d | closed |
| T-09-02 | Information disclosure | secrets in logs / forks | high | mitigate | Environment-scoped secrets; `pull_request` (not `pull_request_target`) so fork PRs get no secrets; no secret echoed; `NEXT_PUBLIC_*` limited | closed |
| T-09-03 | Tampering | concurrent production migrations | high | mitigate | `concurrency` group without cancel-in-progress; migrations → API → worker order | closed |
| T-09-04 | Spoofing | long-lived cloud credentials | high | mitigate | WIF (`google-github-actions/auth@v3`), no JSON keys (C4) | closed |
| T-09-05 | Tampering | supply chain in the image | medium | mitigate | `--frozen-lockfile`, pinned base `node:24-slim`, pruned production deps, non-root user | closed |
| T-09-06 | Denial of service | staging paused (Free plan) | low | mitigate | keep-alive cron hitting `?deep=1` (A9); runbook "unpause" | closed |
| T-09-SC | Tampering | npm installs in CI | high | mitigate | `pnpm install --frozen-lockfile` only; no new packages in this plan | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Open, non-blocking

| Threat ID | Why still open | Resolution path |
|-----------|----------------|-----------------|
| T-04-05 (DoS, medium) | Plan rationale relied on GoTrue's sign-up limiter, but CR-02 disabled public GoTrue sign-up and `POST /v1/public/signup/{slug}` now creates identities through `admin.createUser`, which that limiter does not cover; no Hono/Cloud Armor limiter exists (01-REVIEW-FIX WR-05, "Needs decision"). Only the `signup.duplicate_email` attribution log line was added. | Decide in Phase 01.1 together with WR-04 (trusted IP source): per-IP/per-e-mail limiter in Hono or Cloud Armor, and/or a Turnstile token on the form. Pilot scale makes the exposure low until then. |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01-01 | T-01-08 | `GET /v1/health?deep=1` is unauthenticated and runs `select 1`; needed by the Free-plan keep-alive; negligible cost, no data. | Plan 01-01 / orchestrator | 2026-09-14 |
| AR-01-02 | T-02-04 | Server Actions CSRF relies on Next's Origin check + `SameSite=Lax` cookies; no extra token in V1. | Plan 01-02 | 2026-09-14 |
| AR-01-03 | T-02-06 | Login brute force limited by GoTrue `sign_in_sign_ups = 30`; hardening deferred to Phase 8. | Plan 01-02 | 2026-09-14 |
| AR-01-04 | T-03-03 | Chat/notification V2 stubs carry RLS + tenant policy but no routes; unused until Phase 7. | Plan 01-03 | 2026-09-14 |
| AR-01-05 | T-04-03 / WR-04 | `consent_records.ip` comes from `X-Client-IP` set by the BFF; the API is `--allow-unauthenticated`, so a direct caller can forge it. Evidence quality only, never authorization. Topology decision (Cloud Run `X-Forwarded-For` vs BFF shared secret) belongs to Phase 01.1. | Code review 01-REVIEW-FIX "Needs decision" | 2026-09-14 |
| AR-01-06 | T-05-06 | Recovery e-mail flood bounded by GoTrue `email_sent` rate limit and per-user `max_frequency`. | Plan 01-05 | 2026-09-14 |
| AR-01-07 | unregistered (low) | `GET /v1/openapi.json` is public in every environment; route surface only, no secrets. Restrict per environment in Phase 01.1. | 01-01 / 01-08 Threat Flags | 2026-09-14 |
| AR-01-08 | unregistered (medium) / WR-11 | The `staging` job triggers on `pull_request` and runs PR-controlled `supabase db push` + `pnpm db:seed` with staging secrets (collaborator-level trust on a private repo; fork PRs are excluded by T-09-02). No hosted environment exists yet. Phase 01.1 must add required reviewers on the `staging` environment or move staging deploys to `push`/`workflow_dispatch` before the first real PR. | Code review 01-REVIEW-FIX "Needs decision" | 2026-09-14 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-14 | 66 | 65 | 1 (non-blocking, medium) | gsd-security-auditor (ASVS L1, block_on high) after code review + fix (12/15 findings) |

Auditor caveat carried forward: the "one required reviewer" on the `production` environment (T-09-01) lives in GitHub Environment settings, not in the repo; confirm when the environment is created in Phase 01.1.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-14
