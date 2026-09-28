# API Coverage — Phase 1 external integrations

> Full coverage by default. Opt-outs are explicit, reasoned decisions. One table per external surface this phase integrates. Detector: `{"detected":true}` on the ROADMAP Phase 1 section (signal: "API integration tests"); confirmed by re-reading the scope — the phase integrates Supabase Auth/Postgres/CLI, Resend SMTP, Vercel, GCP (Cloud Run, Artifact Registry, Secret Manager, WIF) and GitHub (repo, Actions, Environments).

## Supabase Auth (GoTrue) — via `@supabase/ssr` (web server) and `@supabase/supabase-js` admin (API)

| capability | decision | reason |
|---|---|---|
| `auth.admin.createUser` (autoconfirm, user_metadata.name) | INTEGRATE | |
| `auth.admin.deleteUser` (sign-up compensation) | INTEGRATE | |
| `auth.admin.listUsers` (idempotent seed lookup) | INTEGRATE | |
| `signInWithPassword` | INTEGRATE | |
| `getClaims` (proxy.ts session refresh + JWKS verify) | INTEGRATE | |
| `getSession` (read access token only to forward as Bearer) | INTEGRATE | |
| `resetPasswordForEmail` | INTEGRATE | |
| `verifyOtp` (type=recovery, token_hash) | INTEGRATE | |
| `updateUser` (password) | INTEGRATE | |
| `signOut({ scope: 'local' })` | INTEGRATE | |
| `signOut({ scope: 'global' })` | OPT-OUT | "Sair de todos os aparelhos" deferred to Phase 8 (CONTEXT Deferred Ideas) |
| JWKS endpoint `/auth/v1/.well-known/jwks.json` (API verification with jose) | INTEGRATE | |
| Per-remote redirect allow-list (`additional_redirect_urls`), exact hosts per env | INTEGRATE | D-22 derives `redirect_to` from the request origin, so every served host is listed (D-24); staging never lists production hosts (Pitfall 8) |
| `redirect_to` from a fixed `SITE_URL` | OPT-OUT | replaced by origin-derived URLs (D-22); no `SITE_URL` variable exists in the web env |
| Wildcard tenant-domain entries in the production allow-list | OPT-OUT | customer domains are appended one by one when attached in Phase 2 (TENANT-07) |
| `signUp` (client-side self sign-up) | OPT-OUT | sign-up provisioning must go through the API admin lane so identity is bound to a tenant atomically (C1, Pattern 4) |
| E-mail confirmation flow (`type=signup` OTP) | OPT-OUT | autoconfirm on in the pilot (D-04); per-tenant toggle deferred |
| OAuth / magic link / phone / MFA / anonymous sign-in | OPT-OUT | not in V1 requirements (AUTH-01..06 are e-mail + password only) |
| Custom Access Token Hook | OPT-OUT | membership resolved per request from the DB (AUTH-06, SUMMARY resolved point) |
| Auth rate-limit configuration | OPT-OUT | Supabase defaults in the pilot; brute-force hardening deferred to Phase 8 |

## Supabase Postgres + CLI

| capability | decision | reason |
|---|---|---|
| Supavisor transaction pooler (6543) as the API lane | INTEGRATE | |
| Supavisor session pooler (5432) for the pg-boss worker and as fallback | INTEGRATE | |
| `supabase start` / `db reset` / `migration up` (local) | INTEGRATE | |
| `supabase db push --include-roles` (CI) | INTEGRATE | |
| `supabase test db` (pgTAP) | INTEGRATE | |
| `supabase config push` (auth settings, SMTP, templates, redirect URLs) | INTEGRATE | |
| `supabase gen signing-key` (ES256 local keys) | INTEGRATE | |
| `supabase projects create` / `link` / `orgs list` | INTEGRATE | |
| Supabase Storage (buckets, signed upload URLs) | OPT-OUT | scoped to Phase 3 (media broker) |
| Supabase Realtime Broadcast / `realtime.messages` policies | OPT-OUT | scoped to Phase 7; only chat/notification table stubs exist here |
| PostgREST Data API | OPT-OUT | the API is the only data client; `anon` grants revoked in the helpers migration |
| Edge Functions | OPT-OUT | not needed; business logic lives on Cloud Run |
| `drizzle-kit migrate` / `drizzle-kit push` as appliers | OPT-OUT | forbidden (two history tables); Supabase CLI is the only applier |

## Resend (SMTP relay for Supabase Auth e-mails)

| capability | decision | reason |
|---|---|---|
| Custom SMTP (`smtp.resend.com:465`, API key) on staging + production | INTEGRATE | |
| Domain creation + DNS verification (`POST /domains`, `GET /domains/:id/verify`) | INTEGRATE | |
| API key creation (`POST /api-keys`) | INTEGRATE | |
| Transactional e-mail API (`POST /emails`) from the API/worker | OPT-OUT | Phase 1 sends only Supabase Auth e-mails through SMTP; app-originated e-mail (notifications) is Phase 7 |
| Webhooks (delivery events) | OPT-OUT | not needed yet |

## Vercel

| capability | decision | reason |
|---|---|---|
| Git integration (Preview per PR, Production on `main`) | INTEGRATE | |
| Project settings: Root Directory `apps/web`, Ignored Build Step `turbo-ignore` | INTEGRATE | |
| Environment variables per environment (`vercel env add`) | INTEGRATE | |
| Remote cache (Turborepo) | INTEGRATE | |
| `vercel domains add` for the platform host + the two seed tenant hosts | INTEGRATE | D-21/D-24; requires DNS control (Open Question 5); three CNAMEs at the DNS checkpoint |
| `vercel domains inspect` (per-host configuration check after DNS) | INTEGRATE | 01-11 Task 3 verification |
| Vercel Domains REST API (add domain + verification polling) for customer domains | OPT-OUT | Phase 2 platform panel (TENANT-07); documented in `docs/DEPLOY.md` "Custom domains" by 01-11, not implemented |
| Preview branch domains (stable staging hostname) | OPT-OUT | D-11 has no long-lived staging branch; staging web = Preview URL (generic host, slug/cookie fallback per D-21) |
| Deployment protection bypass for Playwright | OPT-OUT | e2e runs against the local stack in CI in Phase 1; preview smoke is manual (VALIDATION manual-only row) |
| Vercel Blob/KV/Postgres, Edge Config, Cron | OPT-OUT | data lives in Supabase; jobs in pg-boss |

## Google Cloud (Cloud Run, Artifact Registry, Secret Manager, IAM/WIF)

| capability | decision | reason |
|---|---|---|
| Workload Identity Federation pool + provider for `n1-tecnologia/rede-social` | INTEGRATE | |
| Deploy service account + IAM bindings (Cloud Run Admin, SA User, AR Writer) | INTEGRATE | |
| Artifact Registry Docker repo `rede-social` (southamerica-east1) | INTEGRATE | |
| Cloud Run services api/worker x staging/prod (`deploy-cloudrun@v3`) | INTEGRATE | |
| Secret Manager secrets mounted as env (DB URL, Supabase URL + service key) | INTEGRATE | |
| Cloud Run min-instances / cpu-throttling flags | INTEGRATE | |
| Cloud SQL, Memorystore, Pub/Sub, Cloud Tasks | OPT-OUT | Supabase + pg-boss cover data and jobs in V1 |
| Cloud Run custom domain for the API | OPT-OUT | the web tier calls the `*.run.app` URL server-side; no public API hostname needed in the pilot |
| Cloud Logging sink / alerting | OPT-OUT | pino JSON is ingested automatically; alerting deferred to Phase 8 hardening |

## GitHub

| capability | decision | reason |
|---|---|---|
| Repository under `n1-tecnologia`, default branch `main`, branch protection | INTEGRATE | |
| Actions workflows (ci, deploy-api, seed-prod, keepalive-staging) | INTEGRATE | |
| Environments (`production` with one required reviewer) | INTEGRATE | conditional on the account plan (Open Question 1); `workflow_dispatch` fallback recorded in plan 01-10 |
| Repository/environment secrets and variables | INTEGRATE | |
| Dependabot / CodeQL | OPT-OUT | not required by PWA-04; revisit in Phase 8 hardening |
| Releases / tags | OPT-OUT | GSD creates tags on milestone completion; no release workflow needed |
