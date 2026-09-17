# Deploy contract

Everything the pipeline reads, by name, per environment. Plans 01-10 (GitHub + Vercel) and 01-11
(Supabase + GCP) create exactly what is listed here — nothing more, nothing less. If a name is not in
this file, no workflow reads it.

Pipeline files: `.github/workflows/ci.yml`, `deploy-api.yml`, `seed-prod.yml`,
`keepalive-staging.yml`, `apps/web/vercel.json`, `apps/api/Dockerfile`.

## Environments (D-11, D-15)

| | Local | PR / staging | Production |
|---|---|---|---|
| Trigger | `supabase start` + `pnpm dev` | any pull request | push to `main` (after approval) |
| Web | `localhost:3000` | Vercel **Preview** (per-PR URL) | Vercel **Production** (`app.seusistema.com`) |
| API | `localhost:8787` | Cloud Run `api-staging` | Cloud Run `api` |
| Worker | same process (`ROLE=worker`) | Cloud Run `worker-staging` | Cloud Run `worker` |
| Database | Supabase CLI stack | Supabase `rede-social-staging` | Supabase `rede-social-prod` |
| Seed | `pnpm db:seed` | automatic (staging job) | manual `seed-prod.yml` only (D-14) |
| GCP region | — | `southamerica-east1` | `southamerica-east1` |
| Supabase region | — | `sa-east-1` | `sa-east-1` |

One Artifact Registry repository, `rede-social`, in `southamerica-east1`; the image is
`southamerica-east1-docker.pkg.dev/<GCP_PROJECT_ID>/rede-social/api:<sha>` and serves both Cloud Run
services of both environments (`ROLE=api` / `ROLE=worker`, D-18).

## GitHub repository variables (not secret)

| Name | Example | Read by |
|---|---|---|
| `WIF_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/github/providers/repo` | `deploy-api.yml` (`google-github-actions/auth@v3`) |
| `DEPLOY_SA` | `rede-social-deploy@<project>.iam.gserviceaccount.com` | `deploy-api.yml` (the identity Actions impersonates) |
| `RUNTIME_SA` | `rede-social-runtime@<project>.iam.gserviceaccount.com` | `deploy-api.yml` — passed as `--service-account=` on **every** `deploy-cloudrun@v3` step. This is the account Cloud Run *runs as*; it holds `roles/secretmanager.secretAccessor`, so without it the mounted Secret Manager values are unreadable and the service crashes on boot. Created in 01-11. |
| `GCP_PROJECT_ID` | `rede-social-471200` | `deploy-api.yml` (image reference) |
| `API_STAGING_URL` | `https://api-staging-xxxx.southamerica-east1.run.app` | `keepalive-staging.yml` |

## GitHub environment variables (not secret) — `staging` and `production`

Consumed by the seed steps so the seeded tenants register their real hostnames in `tenant_domains`
instead of the `*.localhost` defaults (D-24). Values are set in 01-11.

| Name | staging | production |
|---|---|---|
| `PLATFORM_HOST` | staging platform host | `app.seusistema.com` |
| `TENANT_DEMO_HOST` | `demo-staging.seusistema.com` | `demo.seusistema.com` |
| `TENANT_LAB_HOST` | `lab-staging.seusistema.com` | `lab.seusistema.com` |

## GitHub environment secrets — `staging` and `production`

Same names in both environments, different values. Environment-scoped so a job that does not declare
`environment:` cannot read them, and fork pull requests get none (the workflows use `pull_request`,
never `pull_request_target`).

| Name | Used for |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | `supabase link` / `db push` / `config push` |
| `SUPABASE_PROJECT_ID` | project ref of `rede-social-staging` / `rede-social-prod` |
| `SUPABASE_DB_PASSWORD` | `supabase db push` (the project's `postgres` password) |
| `SUPABASE_SESSION_POOLER_URL` | `psql` URL (session pooler, port 5432) for the `alter role` step |
| `API_DB_PASSWORD` | password set on `api_user` after `db push --include-roles`; the same value is inside the `api-database-url-*` Secret Manager secrets |
| `SUPABASE_URL` | seed step (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | seed step (service role key — never reaches the browser) |
| `DATABASE_URL` | seed step (`api_user` through the pooler) |
| `RESEND_API_KEY` | `supabase config push` (Custom SMTP, D-13) |
| `SEED_PASSWORD` | initial password of the seeded tenant users |
| `SUPER_ADMIN_EMAIL` | `ferramentas@triacompany.com.br` |
| `SUPER_ADMIN_PASSWORD` | initial `super_admin` password |

## GCP Secret Manager secrets (mounted into Cloud Run)

Readable by `RUNTIME_SA` only. Names are referenced literally in `deploy-api.yml`.

| Secret | Mounted as | Service |
|---|---|---|
| `api-database-url-staging` | `DATABASE_URL` | `api-staging`, `worker-staging` |
| `worker-database-url-staging` | `BOSS_DATABASE_URL` | `worker-staging` (session pooler, port 5432) |
| `supabase-service-key-staging` | `SUPABASE_SERVICE_KEY` | both staging services |
| `supabase-url-staging` | `SUPABASE_URL` | both staging services |
| `api-database-url-prod` | `DATABASE_URL` | `api`, `worker` |
| `worker-database-url-prod` | `BOSS_DATABASE_URL` | `worker` |
| `supabase-service-key-prod` | `SUPABASE_SERVICE_KEY` | both production services |
| `supabase-url-prod` | `SUPABASE_URL` | both production services |
| `vercel-token-prod` | `VERCEL_TOKEN` | `api`, `worker` (custom domains, D-34 — see below) |
| `supabase-pat-prod` | `SUPABASE_PAT` | `api`, `worker` (auth allow-list, D-34 — see below) |

`DATABASE_URL` is always the **`api_user`** connection through the Supavisor **transaction** pooler
(port 6543); `BOSS_DATABASE_URL` is the same role through the **session** pooler (port 5432) because
pg-boss holds long-lived listeners. Never the `postgres` role, never the service-role key, for tenant
traffic. See `packages/core/db/README.md` for the URL shapes and the session-mode fallback.

## Vercel environment variables (web)

Root Directory `apps/web`; Build Command `turbo build`; Ignored Build Step
`npx turbo-ignore --fallback=HEAD^1` (committed as `apps/web/vercel.json`).

| Variable | Preview | Production |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | staging project URL | production project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | staging publishable key | production publishable key |
| `API_URL` | `api-staging` Cloud Run URL | `api` Cloud Run URL |
| `PLATFORM_HOST` | *(unset — every Preview host is a generic host, D-21)* | `app.seusistema.com` |

No `SITE_URL` anywhere: every absolute URL, including the password-recovery `redirect_to`, is derived
from the request origin (D-22). Only publishable keys ever reach Vercel — the service key lives in
Secret Manager and GitHub environment secrets.

**Password-recovery origin (WR-09).** `apps/web/app/(auth)/esqueci-senha/actions.ts` builds the
`redirect_to` from `X-Forwarded-Host`/`Host`, but honours it only when `proxy.ts` classified the host
as a registered tenant domain or as `PLATFORM_HOST` (plus `localhost`/`*.localhost` outside
production). Any other host — a `*.vercel.app` preview alias included — sends no e-mail (the browser
still gets the constant answer). The hosted project's `[auth] additional_redirect_urls` is the second,
independent guard and must therefore be an **explicit per-domain list**
(`https://comunidade.cliente.com.br/auth/confirm**`, `https://app.seusistema.com/auth/confirm**`, …),
never a wildcard host such as `https://**`. Since 02-09 (D-34) the per-domain
`https://<host>/auth/confirm**` entries are **added by the API when a custom domain verifies and
removed when it is detached** (`AUTH_ALLOW_LIST=supabase`, Management API `PATCH …/config/auth`
`uri_allow_list`, one entry per host, never a wildcard); the platform host entry stays in
`config.toml`. The list must still be **reviewed after every `supabase config push`**: a push
re-applies `[auth] additional_redirect_urls` from `config.toml` and can drop the runtime entries.
After each push open every verified domain in the platform panel and press "Verificar agora" — it
re-adds the entry idempotently (Phase 8 adds a reconcile command that does this for every host).

## Custom domains (TENANT-07, D-34)

A tenant's host is attached from the platform panel; the API registers it with the hosting
provider through an env-selected adapter, stores it **unverified** with the DNS records the customer
must create, and the `kernel.domain-verify` pg-boss job (in the **worker** service) re-checks it
every ~10 minutes for up to 7 days. Only a verified host resolves (D-36); the verified transition
adds the host to the Supabase Auth redirect allow-list and sends the pending first-admin invite.
Locally and in CI both adapters are the fail-safe **local** implementations (`fake` / `local`,
the kernel env defaults) — nothing here is needed to develop or test.

Variables read by the **`api` and `worker`** Cloud Run services (both run the same image; the
worker runs the poller, the API answers "Verificar agora"):

| Variable | staging | production | Source |
|---|---|---|---|
| `DOMAIN_PROVIDER` | `fake` (Preview deployments carry no customer domains) | `vercel` | plain env |
| `VERCEL_TOKEN` | — | Secret Manager `vercel-token-prod` | Vercel → Team Settings → Tokens (team-scoped token) |
| `VERCEL_PROJECT_ID` | — | project id of `apps/web` | Vercel → Project → Settings → General; plain env |
| `VERCEL_TEAM_ID` | — | team id | Vercel → Team Settings → General; plain env |
| `AUTH_ALLOW_LIST` | `local` | `supabase` | plain env |
| `SUPABASE_PAT` | — | Secret Manager `supabase-pat-prod` | Supabase → Account → Access Tokens: a **dedicated** token with `auth:write` — not the CI `SUPABASE_ACCESS_TOKEN` |
| `SUPABASE_PROJECT_REF` | — | `rede-social-prod` reference id | same value as the GitHub secret `SUPABASE_PROJECT_ID`; plain env |
| `PLATFORM_HOST` | staging platform host | `app.seusistema.com` | now also read by the API so an attach of the platform host is refused (`400 { host: "platform_host" }`) |

`assertProductionEnv()` (kernel `env.ts`) refuses `DOMAIN_PROVIDER=vercel` / `AUTH_ALLOW_LIST=supabase`
without their credentials at boot, so a half-configured revision fails its startup probe instead of
failing the first attach. The adapters call only the documented project-level endpoints (add / status
/ config / verify / detach) — the platform never writes the customer's DNS, buys a domain or deletes
one at the Vercel account level (`.planning/phases/02-…/COVERAGE.md`).

## Production gate (D-12)

Three conditions must hold **on the same `main` SHA** before a single production migration runs:

1. `checks` — `deploy-api.yml` calls `./.github/workflows/ci.yml` as a job (`workflow_call`), so the
   lint/typecheck/build/unit, boundary, lane-guard, pgTAP, integration, spike and e2e steps all pass
   for that exact commit, not for an earlier one.
2. `build` — the image for that SHA is in Artifact Registry.
3. `production` — one required reviewer approves the GitHub Environment (configured in 01-10).

`migrate-and-deploy-prod` declares `needs: [checks, build]`, so a **direct push to `main` by an
admin goes through the same `checks` job**; branch protection is a convenience, not the gate. Inside
the job the order is fixed: migrations → API → worker. `concurrency: deploy-<ref>` with
`cancel-in-progress: false` means two pushes queue instead of migrating in parallel.

If the GitHub plan blocks protected environments on a private repository (RESEARCH §Pitfall 5), use
the commented `workflow_dispatch` fallback in `deploy-api.yml`: the manual dispatch *is* the
approval, `needs: [checks, build]` stays.

**Production is never a promoted preview.** `NEXT_PUBLIC_*` values are inlined at build time, so a
Preview build carries staging Supabase URLs and keys forever; promoting it would point production
users at the staging database. Production is always a fresh build of `main`.

## Runbook

**Staging is paused (Supabase Free plan).** Free projects pause after a week of inactivity. Unpause
in the Supabase dashboard (`rede-social-staging` → Restore), then re-run `keepalive-staging.yml`
manually. The cron (`0 9 * * 1,4`) hits `/v1/health?deep=1`, which runs `select 1` through `api_user`,
so normal weeks never reach the timer.

**Rotate the `api_user` password.** Change `API_DB_PASSWORD` in the environment secrets, update the
matching `api-database-url-*` / `worker-database-url-*` Secret Manager versions, then re-run the
deploy workflow: the `alter role api_user with login password` step and the new secret version land
together. Never edit the role by hand in the dashboard without updating the secrets.

**Seed production.** Actions → *Seed production* → *Run workflow*. It is idempotent, so a second run
is safe. It is the only path that writes seed data to production (D-14).

**Roll back an API release.** `gcloud run services update-traffic api --to-revisions=<previous>=100
--region=southamerica-east1`. Migrations are not rolled back — write forward-compatible migrations.

**Migrations never run from a developer machine.** `supabase db push` against a remote project is a
workflow step only; locally use `pnpm db:reset`.

**Attach a real customer domain end-to-end (hosted proof, deferred from Phase 2 to the Phase 01.1
runbook).** The Vercel and Supabase Management adapters ship unit-tested against the documented
bodies (02-09) but have not run against the real APIs (RESEARCH Open Question 1 / A1 / A2). Once the
production project exists: (1) create the team-scoped Vercel token and the dedicated Supabase PAT,
store them as `vercel-token-prod` / `supabase-pat-prod`, set `DOMAIN_PROVIDER=vercel`,
`AUTH_ALLOW_LIST=supabase`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `SUPABASE_PROJECT_REF` on `api`
and `worker` and redeploy; (2) in the platform panel attach `comunidade.<cliente>` to a test tenant;
(3) create the CNAME (or A for an apex) and, if shown, the `_vercel.<apex>` TXT record at the
customer's DNS; (4) wait for the poller (~10 min) or press "Verificar agora"; (5) confirm
`GET /v1/public/tenants/by-host?host=comunidade.<cliente>` answers 200, the first-admin invite mail
arrives, the project's auth `uri_allow_list` contains `https://comunidade.<cliente>/auth/confirm**`,
and `https://comunidade.<cliente>/entrar` renders the tenant brand; (6) record the outcome here:
token scope needed, whether Cloud Run egress needed anything, and whether a fresh domain showed a
TXT step (A2). Detach the test host afterwards (panel → Remover) and confirm the allow-list entry
is gone.
