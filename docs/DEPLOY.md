# Deploy contract

Everything the pipeline reads, by name, per environment. Plans 01-10 (GitHub + Vercel) and 01-11
(Supabase + GCP) create exactly what is listed here — nothing more, nothing less. If a name is not in
this file, no workflow reads it.

Pipeline files: `.github/workflows/ci.yml`, `deploy-api.yml` (production), `deploy-hml.yml`
(homolog), `e2e-full.yml` (manual full e2e), `.github/actions/*` (the shared composite steps),
`apps/web/vercel.json`, `scripts/vercel-ignore.sh` (the Vercel Ignored Build Step, tested
by `scripts/vercel-ignore.test.sh`), `apps/api/Dockerfile`, `scripts/check-static-routes.sh`
(build-output gate, Phase 2). Which workflow runs when, and how the e2e is selected:
`docs/deploy/ci.md`.

## Decisions (2026-10-02)

An isolated homolog (hml) environment now sits next to production (quick 261002-f4y). These
decisions supersede the 2026-09-28 bullet "Production only, no staging"; the rest of
Decisions (2026-09-28) stands.

- **Full isolation per vendor.** Nothing is shared with production:
  - GCP: a separate project `rede-social-hml` (tentative id), region `southamerica-east1`, its own
    Artifact Registry repository `rede-social`, its own service accounts `rede-social-deploy`
    (Actions) and `rede-social-runtime` (Cloud Run), and its own Workload Identity pool `github`
    with provider `repo`, restricted to `refs/heads/homolog`.
  - Vercel: a separate project `rede-social-hml` (team `n1-tecnologia`, Root Directory `apps/web`,
    functions region `gru1`, Production Branch `homolog`) with `DEPLOY_ENV=homolog` on every
    environment. `scripts/vercel-ignore.sh` makes each Vercel project build only its own branch.
  - Supabase: a separate project, ref `<hml-supabase-ref>` (not known yet).
- **Branch flow.** A push to `homolog` deploys hml automatically through `deploy-hml.yml`, with NO
  reviewer (GitHub environment `homolog`). `master` stays production, unchanged, behind the
  `production` environment's required reviewer.
- **CI gates hml like production.** `deploy-hml.yml` calls the same `ci.yml` as `checks`, and its
  deploy job needs it, exactly as `deploy-api.yml` does (quick 261007-kbq). This supersedes the earlier
  "No CI gate on hml" statement: the e2e inside `checks` now runs only the specs a change can affect,
  so it finishes in time (`docs/deploy/ci.md`).
- **Vendors.** Mux: a separate environment "HML". VAPID: a new key pair, never production's.
  Resend: its own API key on the same verified domain, `n1marketingdigital.com.br`.
- **Secret names.** Secret Manager names in the hml GCP project end in `-hml` and mirror the
  production list exactly (see "GCP Secret Manager secrets — `homolog`").
- **Cost.** hml `api` runs `--min-instances=0` (a cold start is acceptable; the deep health check
  retries); `worker` keeps `--min-instances=1 --no-cpu-throttling` because pg-boss needs it warm.
- **`[remotes.homolog]` in `supabase/config.toml`** lands once the hml ref is known. Until then the
  `deploy-hml.yml` preflight refuses every run: without that block `supabase config push` would push
  the LOCAL `[auth]` values (localhost `site_url`, local hook URI) to the hml project.
- **Seed.** A demo seed on hml is allowed, but only by hand (see "hml provisioning runbook"), never
  from a workflow. Production's never-seed rule is unchanged.

### Temporary: hml shares production's Supabase, Mux and Resend (2026-10-02)

Until Igor provisions them, hml runs with `HML_SUPABASE=shared-with-production` (GitHub environment
variable on `homolog`): the hml `api` reads and writes the **production database** — anything
created on `rede-social-hml.vercel.app` is real production data. `deploy-hml.yml` then skips
migrations, the `api_user` password and `config push` (only `deploy-api.yml`, behind the reviewer,
changes production) and does **not** deploy the hml `worker` (production's worker alone consumes the
single pg-boss queue; jobs the hml `api` enqueues run there). The `-hml` secrets hold copies of the
`-prod` values, VAPID included (push subscriptions live in the shared database); the hml VAPID pair
generated on 2026-10-02 is kept as version 1 of `vapid-*-hml` for the switch. Mux webhooks keep
pointing at the production `api`, which updates the shared rows. Production's Supabase Auth
`site_url`/redirects stay production's, so e-mail confirmation/recovery links open production.
Code on `homolog` must not need a migration production has not applied yet.

**Switch to isolated:** create the hml Supabase project, add `[remotes.homolog]`, set the
`homolog` GitHub secrets, add new versions of every `-hml` secret (disable the copied VAPID version
to fall back to version 1), the hml Mux environment/webhook, then set `HML_SUPABASE=isolated`.

## Decisions (2026-09-28)

These deviate from the Phase 01.1 roadmap text (two Supabase projects, staging on every pull
request, the old `main` default branch) and supersede the staging parts of D-11/D-15; the roadmap
itself is not edited here.

- *Superseded by Decisions (2026-10-02): homolog (hml) is an isolated environment.*
  **Production only, no staging.** No staging Supabase project, no `api-staging`/`worker-staging`
  Cloud Run services, no `staging` GitHub environment. Pull requests run `ci.yml` only (its own
  throwaway local Supabase stack) and get a Vercel Preview from the Git integration;
  `deploy-api.yml` has no pull_request trigger and no staging job; `keepalive-staging.yml` was
  removed.
- **Production branch is `master`** (the Vercel Git integration tracks it); `ci.yml` no longer
  triggers on pushes (`deploy-api.yml` runs it as `checks`) and the production job checks
  `refs/heads/master`.
- **`PLATFORM_HOST` = `rede-social-woad.vercel.app`** (no custom domain yet). The hosted auth
  `site_url` and the single explicit redirect entry
  `https://rede-social-woad.vercel.app/auth/confirm**` live in `supabase/config.toml`
  `[remotes.production.auth]` (WR-09), and `otp_expiry = 86400` in
  `[remotes.production.auth.email]`.
- **E-mail via Resend (2026-09-29).** Sender domain `n1marketingdigital.com.br` is verified in
  Resend (São Paulo region), so `MAIL_DOMAIN=n1marketingdigital.com.br` and mail leaves as
  `"{tenant}" <no-reply@n1marketingdigital.com.br>`. `api` and `worker` run `MAIL_TRANSPORT=resend`
  with `RESEND_API_KEY` (Secret Manager `resend-api-key-prod`) and `SEND_EMAIL_HOOK_SECRETS`
  (`send-email-hook-secrets-prod`, same value as the GitHub environment secret). The hosted Send
  Email Hook (`[remotes.production.auth.hook.send_email]`) calls
  `https://api-253040968821.southamerica-east1.run.app/v1/hooks/auth/send-email`. Every Supabase CLI
  step in `deploy-api.yml` exports `SEND_EMAIL_HOOK_SECRETS`, because the CLI validates the hook
  block on every command. `docs/deploy/auth-mail.md` applies to production only.
- **Video via Mux (2026-09-29).** `VIDEO_PROVIDER=mux` on `api` and `worker`, using the Mux
  environment `N1-TECH` (the same one the local stack uses); its webhook now points at
  `https://api-253040968821.southamerica-east1.run.app/v1/webhooks/mux`, so local real-video testing
  no longer receives webhooks. The five `mux-*-prod` secrets were copied from the local values.
- **Production gate.** One required reviewer on the GitHub environment `production`. The
  repository is public (owner `n1-tecnologia`), so protected environments are available and the
  `workflow_dispatch` fallback is not needed.
- **Identifiers** (not secrets):
  - Supabase: project `rede-social`, ref `qjjhtduxquvlfppybpqq`, region `sa-east-1`, pooler
    `aws-0-sa-east-1`.
  - GCP: project `api-dere-social` (number `253040968821`), region `southamerica-east1`; service
    accounts `rede-social-deploy` (Actions) / `rede-social-runtime` (Cloud Run); Workload Identity
    pool `github` with provider `repo`.
  - Vercel: project `prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa` (team `n1-tecnologia`, Root Directory
    `apps/web`, functions region `gru1`).
- **One-time bootstrap from the developer machine (2026-09-28).** The first
  `supabase db push --include-roles`, the `api_user` login password, and the super_admin created
  directly (Auth user + `platform_admins` row, no tenants). This is the single recorded exception to
  "Migrations never run from a developer machine"; every later migration goes through
  `deploy-api.yml`. `seed-prod.yml` was removed for the same reason: `pnpm db:seed` creates the demo
  tenants, and production must only ever hold the super_admin.
- **First Cloud Run deploy (2026-09-28).** Billing account `cobrancas-tech` is linked. `api` serves
  at `https://api-253040968821.southamerica-east1.run.app` (the Vercel `API_URL`), `worker` is
  private. The first image was built with Cloud Build from a `git archive` of HEAD (tracked files
  only) on the default machine — `E2_HIGHCPU_8` has no quota in `southamerica-east1` on a new
  project — and deployed with `gcloud run deploy`; later images come from `deploy-api.yml`.
- **`api` is public through `--no-invoker-iam-check`, not `--allow-unauthenticated`.** The
  `n1marketingdigital.com.br` organization enforces `iam.allowedPolicyMemberDomains` (Domain
  restricted sharing), which refuses an `allUsers` invoker binding.
- **`PLATFORM_HOST` is also set on `api` and `worker`** (`env_vars` in `deploy-api.yml`) so a tenant
  attach of the platform host is refused (D-34).
- **The worker's `worker-database-url-prod` ends in `?sslmode=require&uselibpqcompat=true`.**
  node-postgres (pg-boss) treats a bare `sslmode=require` as `verify-full` and fails on Supabase's
  chain with `SELF_SIGNED_CERT_IN_CHAIN`; `uselibpqcompat=true` restores libpq semantics (encrypted,
  no CA check). `api-database-url-prod` (postgres.js) keeps `?sslmode=require`.

## Documents

- `docs/deploy/auth-mail.md` — branded auth e-mails: Send Email Hook secrets, Resend, rotation,
  failure modes (02-06).
- `## Custom domains (TENANT-07, D-34)` (this file) — provider / allow-list variables and the
  deferred hosted proof (02-09).
- `## Phase 2 verification` (this file) — the local exit gate `pnpm verify`, the smoke, the manual
  checks and the hosted proofs deferred to the Phase 01.1 runbook (02-16).
- `packages/core/db/README.md` — connection URL shapes (pooler ports, `api_user`, session-mode
  fallback).

## Environments (D-11, D-15)

| | Local | Homolog | Production |
|---|---|---|---|
| Trigger | `supabase start` + `pnpm dev` | push to `homolog`, automatic, no reviewer (`deploy-hml.yml`) | push to `master` (after the `production` approval) |
| Web | `localhost:3000` | Vercel `rede-social-hml` **Production** (`rede-social-hml.vercel.app`) | Vercel **Production** (`rede-social-woad.vercel.app`) |
| API | `localhost:8787` | Cloud Run `api` in `rede-social-hml` (`https://api-221367067304.southamerica-east1.run.app`) | Cloud Run `api` |
| Worker | same process (`ROLE=worker`) | Cloud Run `worker` in `rede-social-hml` | Cloud Run `worker` |
| Database | Supabase CLI stack | Supabase `<hml-supabase-ref>` | Supabase `rede-social` (`qjjhtduxquvlfppybpqq`) |
| Seed | `pnpm db:seed` | demo seed allowed, by hand only ("hml provisioning runbook"), never in a workflow | none: super_admin only, created once by hand (Decisions 2026-09-28), never `pnpm db:seed` |
| GCP region | — | `southamerica-east1` | `southamerica-east1` |
| Supabase region | — | `<hml-supabase-region>` | `sa-east-1` |

Pull requests run `ci.yml` only and get a Vercel Preview from the PRODUCTION Vercel project; the hml
Vercel project skips every ref except `homolog` (`scripts/vercel-ignore.sh`). A change reaches hml by
being pushed or merged into `homolog`, and production by being merged into `master`
(Decisions 2026-10-02).

One Artifact Registry repository `rede-social` per GCP project (`api-dere-social` and
`rede-social-hml`), both in `southamerica-east1`; the image is
`southamerica-east1-docker.pkg.dev/<GCP_PROJECT_ID>/rede-social/api:<sha>` and serves both Cloud Run
services (`ROLE=api` / `ROLE=worker`, D-18).

## GitHub repository variables (not secret)

| Name | Example | Read by |
|---|---|---|
| `WIF_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/github/providers/repo` | `deploy-api.yml` (`google-github-actions/auth@v3`) |
| `DEPLOY_SA` | `rede-social-deploy@<project>.iam.gserviceaccount.com` | `deploy-api.yml` (the identity Actions impersonates) |
| `RUNTIME_SA` | `rede-social-runtime@<project>.iam.gserviceaccount.com` | `deploy-api.yml` — passed as `--service-account=` on **every** `deploy-cloudrun@v3` step. This is the account Cloud Run *runs as*; it holds `roles/secretmanager.secretAccessor`, so without it the mounted Secret Manager values are unreadable and the service crashes on boot. Created in 01-11. |
| `GCP_PROJECT_ID` | `rede-social-471200` | `deploy-api.yml` (image reference) |

These repository-level values are production's. The GitHub environment `homolog` defines the same
four names (see "GitHub environment variables (not secret) — `homolog`"), and an environment-level
value wins for every job that declares `environment: homolog` — both `deploy-hml.yml` jobs. If one is
missing on `homolog`, GitHub silently falls back to the production value: the `deploy-hml.yml`
preflight refuses that run, and the Workload Identity condition refuses production credentials to
the `homolog` ref regardless (see "Workload Identity branch restriction (isolation guard)").

## GitHub environment variables (not secret) — `production`

No workflow reads any since 2026-09-28: the seed steps that read `PLATFORM_HOST`,
`TENANT_DEMO_HOST` and `TENANT_LAB_HOST` were removed with the staging job and the production seed
workflow. The web app and the API read `PLATFORM_HOST` from their own runtime env (the Vercel and
Cloud Run tables below).

## GitHub environment secrets — `production`

Environment-scoped to `production`, so a job that does not declare `environment: production` cannot
read them, and fork pull requests get none (`ci.yml` uses `pull_request`, never
`pull_request_target`).

| Name | Used for |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | `supabase link` / `db push` / `config push` |
| `SUPABASE_PROJECT_ID` | project ref of `rede-social` (`qjjhtduxquvlfppybpqq`) |
| `SUPABASE_DB_PASSWORD` | `supabase db push` (the project's `postgres` password) |
| `SUPABASE_SESSION_POOLER_URL` | `psql` URL (session pooler, port 5432) for the `alter role` step |
| `API_DB_PASSWORD` | password set on `api_user` after `db push --include-roles`; the same value is inside the `api-database-url-prod` Secret Manager secret |
| `RESEND_API_KEY` | `supabase config push` (Custom SMTP, D-13) — not needed while e-mail is deferred |
| `SEND_EMAIL_HOOK_SECRETS` | every Supabase CLI step (the CLI validates `[auth.hook.send_email]` on every command); same value as the Secret Manager secret `send-email-hook-secrets-prod` |

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `SEED_PASSWORD`, `SUPER_ADMIN_EMAIL` and
`SUPER_ADMIN_PASSWORD` were read only by the removed seed steps; the super_admin was created by hand
(Decisions 2026-09-28).

## GitHub environment variables (not secret) — `homolog`

Defined on the GitHub environment `homolog`; they override the repository-level (production)
variables of the same names for both `deploy-hml.yml` jobs. The preflight refuses an empty value and
any value that resolves to production.

| Name | Value | Read by |
|---|---|---|
| `WIF_PROVIDER` | `projects/221367067304/locations/global/workloadIdentityPools/github/providers/repo` | `deploy-hml.yml` (`google-github-actions/auth@v3`, both jobs) |
| `DEPLOY_SA` | `rede-social-deploy@rede-social-hml.iam.gserviceaccount.com` | `deploy-hml.yml` (the identity Actions impersonates) |
| `RUNTIME_SA` | `rede-social-runtime@rede-social-hml.iam.gserviceaccount.com` | `deploy-hml.yml` — `--service-account=` on both `deploy-cloudrun@v3` steps (reads the `-hml` Secret Manager secrets) |
| `GCP_PROJECT_ID` | `rede-social-hml` | `deploy-hml.yml` (image reference) |
| `PLATFORM_HOST` | `rede-social-hml.vercel.app` — the same value as the hml Vercel `PLATFORM_HOST` | `deploy-hml.yml` — `env_vars` on `api` and `worker`, so a tenant attach of the platform host is refused (D-34) |
| `VERCEL_PROJECT_ID` | `prj_Z7qixvkp31z7r0j329MGMQTY5gev` (Vercel project `rede-social-hml`) | `deploy-hml.yml` — `env_vars` on `api` and `worker` with `DOMAIN_PROVIDER=vercel`: a tenant domain added on the hml panel is attached to the hml Vercel project. The preflight refuses production's project id |
| `VERCEL_TEAM_ID` | `team_Nf4Qex49TkN0pmqTt4iuKNGU` (team `n1-tecnologia`) | `deploy-hml.yml` — `env_vars` on `api` and `worker` |
| `SUPABASE_PROJECT_REF` | the Supabase project hml logs in against: `qjjhtduxquvlfppybpqq` while `HML_SUPABASE=shared-with-production`, the hml ref once isolated (the preflight enforces it) | `deploy-hml.yml` — `env_vars` on `api` and `worker` with `AUTH_ALLOW_LIST=supabase`: verifying a domain on the hml panel adds `https://<host>/auth/confirm**` to that project's redirect allow-list, so the first admin's invite link is not refused (`redirect_host_not_tenant`) |
| `WEB_URL` | `https://rede-social-hml.vercel.app` | `deploy-hml.yml` — the `homolog` environment URL, and a preflight check |

Environment settings: **no required reviewer** (Decisions 2026-10-02), and **Deployment branches and
tags** limited to the `homolog` branch — a third guard, so no other ref can run a job on this
environment or read its secrets.

## GitHub environment secrets — `homolog`

The same names `deploy-hml.yml` reads, environment-scoped to `homolog`. Never reuse a production
value for any of them.

| Name | Used for |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | `supabase link` / `db push` / `config push` on the hml project. Use a dedicated token, revocable without touching production |
| `SUPABASE_PROJECT_ID` | the hml ref `<hml-supabase-ref>`; must equal `[remotes.homolog].project_id` in `supabase/config.toml` (the preflight checks it, without printing it) |
| `SUPABASE_DB_PASSWORD` | `supabase db push` (the hml project's `postgres` password) |
| `SUPABASE_SESSION_POOLER_URL` | `psql` URL (hml session pooler, port 5432) for the `alter role` step |
| `API_DB_PASSWORD` | password set on the hml `api_user`; the same value is inside `api-database-url-hml` and `worker-database-url-hml` |
| `SEND_EMAIL_HOOK_SECRETS` | every Supabase CLI step; same value as the Secret Manager secret `send-email-hook-secrets-hml` |

## GCP Secret Manager secrets (mounted into Cloud Run)

Readable by `RUNTIME_SA` only. Names are referenced literally in `deploy-api.yml`.

| Secret | Mounted as | Service |
|---|---|---|
| `api-database-url-prod` | `DATABASE_URL` | `api`, `worker` |
| `worker-database-url-prod` | `BOSS_DATABASE_URL` | `worker` |
| `supabase-service-key-prod` | `SUPABASE_SERVICE_KEY` | both production services |
| `supabase-url-prod` | `SUPABASE_URL` | both production services |
| `vercel-token-prod` | `VERCEL_TOKEN` | `api`, `worker` (custom domains, D-34 — see below) |
| `supabase-pat-prod` | `SUPABASE_PAT` | `api`, `worker` (auth allow-list, D-34 — see below) |
| `mux-token-id-prod` | `MUX_TOKEN_ID` | `api`, `worker` (video, D-43 — see below) |
| `mux-token-secret-prod` | `MUX_TOKEN_SECRET` | `api`, `worker` |
| `mux-signing-key-id-prod` | `MUX_SIGNING_KEY_ID` | `api`, `worker` (signed playback, D-44) |
| `mux-signing-key-private-prod` | `MUX_SIGNING_KEY_PRIVATE` | `api`, `worker` (base64 PEM) |
| `mux-webhook-secret-prod` | `MUX_WEBHOOK_SECRET` | `api` (the webhook's only authentication) |
| `vapid-public-key-prod` | `VAPID_PUBLIC_KEY` | `api`, `worker` (Web Push, NOTIF-03 — see "Phase 7 release"; the same value is Vercel's `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) |
| `vapid-private-key-prod` | `VAPID_PRIVATE_KEY` | `api`, `worker` (signs every push; never leaves Secret Manager) |
| `vapid-subject-prod` | `VAPID_SUBJECT` | `api`, `worker` (a `mailto:` contact, never `localhost`) |

`DATABASE_URL` is always the **`api_user`** connection through the Supavisor **transaction** pooler
(port 6543); `BOSS_DATABASE_URL` is the same role through the **session** pooler (port 5432) because
pg-boss holds long-lived listeners. Never the `postgres` role, never the service-role key, for tenant
traffic. See `packages/core/db/README.md` for the URL shapes and the session-mode fallback.

## GCP Secret Manager secrets — `homolog`

In the hml GCP project (rede-social-hml), readable by the hml `RUNTIME_SA` only. Create every one of
them before the first push to `homolog`: a missing secret fails the deploy. The names are exactly the
ones `deploy-hml.yml` mounts — the production list with `-prod` replaced by `-hml`.

| Secret | Mounted as | Service | Source |
|---|---|---|---|
| `api-database-url-hml` | `DATABASE_URL` | `api`, `worker` | hml Supabase, `api_user` through the transaction pooler (port 6543), `?sslmode=require` |
| `worker-database-url-hml` | `BOSS_DATABASE_URL` | `worker` | hml Supabase, `api_user` through the session pooler (port 5432), ending in `?sslmode=require&uselibpqcompat=true` like production |
| `supabase-service-key-hml` | `SUPABASE_SERVICE_KEY` | `api`, `worker` | hml Supabase project |
| `supabase-url-hml` | `SUPABASE_URL` | `api`, `worker` | hml Supabase project |
| `mux-token-id-hml` | `MUX_TOKEN_ID` | `api`, `worker` | Mux environment HML |
| `mux-token-secret-hml` | `MUX_TOKEN_SECRET` | `api`, `worker` | Mux environment HML |
| `mux-signing-key-id-hml` | `MUX_SIGNING_KEY_ID` | `api`, `worker` | Mux environment HML |
| `mux-signing-key-private-hml` | `MUX_SIGNING_KEY_PRIVATE` | `api`, `worker` | Mux environment HML (base64 PEM) |
| `mux-webhook-secret-hml` | `MUX_WEBHOOK_SECRET` | `api`, `worker` | Mux environment HML, the webhook endpoint's signing secret |
| `vapid-public-key-hml` | `VAPID_PUBLIC_KEY` | `api`, `worker` | the new hml VAPID pair; its public half is also the hml Vercel `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| `vapid-private-key-hml` | `VAPID_PRIVATE_KEY` | `api`, `worker` | the new hml VAPID pair (never production's) |
| `vapid-subject-hml` | `VAPID_SUBJECT` | `api`, `worker` | a `mailto:` contact |
| `resend-api-key-hml` | `RESEND_API_KEY` | `api`, `worker` | the Resend hml API key (domain `n1marketingdigital.com.br`) |
| `send-email-hook-secrets-hml` | `SEND_EMAIL_HOOK_SECRETS` | `api`, `worker` | a new hook secret; the same value as the `homolog` GitHub environment secret |
| `vercel-token-hml` | `VERCEL_TOKEN` | `api`, `worker` | a Vercel token scoped to team `n1-tecnologia` (the domain adapter's `POST/GET/DELETE /v*/projects/{VERCEL_PROJECT_ID}/domains` calls) |
| `supabase-pat-hml` | `SUPABASE_PAT` | `api`, `worker` | a Supabase personal access token with access to the project in `SUPABASE_PROJECT_REF` (only `GET`/`PATCH /v1/projects/{ref}/config/auth`, `uri_allow_list` only) |

## Vercel environment variables (web)

Root Directory `apps/web`; Build Command `turbo build`; Ignored Build Step
`bash ../../scripts/vercel-ignore.sh` (committed as `apps/web/vercel.json`): on this production
project it skips ref `homolog` and otherwise runs `npx turbo-ignore` (no `--fallback` since 2026-10-02) as
before. `DEPLOY_ENV` stays unset on the production project.

| Variable | Preview | Production |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | not provisioned (no staging project) | production project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | not provisioned (no staging project) | production publishable key |
| `API_URL` | not provisioned (no staging project) | `api` Cloud Run URL |
| `PLATFORM_HOST` | *(unset — every Preview host is a generic host, D-21)* | `rede-social-woad.vercel.app` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | *(unset — every push surface reads "unsupported")* | the PUBLIC half of the production VAPID pair, the same value as `vapid-public-key-prod` (Phase 7 release, step 3). Inlined at build time, so set it BEFORE the push that ships Phase 7 |
| `CSP_MODE` | *(unset — the default `report-only`)* | `report-only` when Phase 8 ships; `enforce` only after the 08-12 real-device pass shows zero violations (see the CSP section below). Server-only and read per request, so a change needs a redeploy but no rebuild of anything else |

No `SITE_URL` anywhere: every absolute URL, including the password-recovery `redirect_to`, is derived
from the request origin (D-22). Only publishable keys ever reach Vercel — the service key lives in
Secret Manager only.

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
`uri_allow_list`, one entry per host, never a wildcard); the platform host entry
(`https://rede-social-woad.vercel.app/auth/confirm**`) lives in `config.toml` under
`[remotes.production.auth]`. The list must still be **reviewed after every `supabase config push`**:
a push re-applies `[auth] additional_redirect_urls` from `config.toml` and can drop the runtime
entries.
The worker reconciles every verified host's entry at boot (`reconcileAuthAllowList`, quick
261012-s0v), so a deploy (config push → new worker revision) self-heals the list; `"Verificar agora"`
remains the manual path for a single host, and a push that is NOT followed by a worker deploy still
needs it (or a worker restart).

**Sign-up confirmation link (quick 261012-s0v).** The Send Email Hook re-homes a `site_url`-fallback
`signup` link (a hostless `redirect_to` for an identity with exactly one membership) onto that
tenant's VERIFIED primary host as `/auth/confirm?next=/inicio`, and `apps/web/proxy.ts` forwards a
stray `/?token_hash=…&type=…` link to `/auth/confirm`, so a missing allow-list entry no longer strands
a new member — it only costs the branded-host guarantee until the entry is back.

## Vercel project — `homolog`

Project `rede-social-hml`, team `n1-tecnologia`, the same Git repository, Root Directory `apps/web`,
Build Command `turbo build`, functions region `gru1`, **Production Branch `homolog`**. It uses the same
committed `apps/web/vercel.json`, so the Ignored Build Step is `bash ../../scripts/vercel-ignore.sh`.

| Variable | Environments | Value |
|---|---|---|
| `DEPLOY_ENV` | Production **and** Preview **and** Development | `homolog`. Preview matters: every other branch arrives on this project as a Preview, and this is how the script skips it |
| `NEXT_PUBLIC_SUPABASE_URL` | Production | the hml Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production | the hml project's publishable key |
| `API_URL` | Production | `https://api-221367067304.southamerica-east1.run.app` (the hml `api` Cloud Run URL) |
| `PLATFORM_HOST` | Production | `rede-social-hml.vercel.app` (same value as the `homolog` GitHub variable) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Production | the PUBLIC half of the hml VAPID pair (same value as `vapid-public-key-hml`), set before the first build |

`scripts/vercel-ignore.sh` (exit 0 = skip, "build check" = run `npx turbo-ignore`, which compares against the last deployment and builds when there is none
and pass its exit code through):

| `DEPLOY_ENV` | ref `homolog` | any other ref (or none) |
|---|---|---|
| `homolog` | build check | skip |
| `production` | skip | build check |
| unset or empty | skip — except with `VERCEL_ENV=production`: a warning, then build check (the belt: only the project whose Production Branch is `homolog` can produce that combination) | build check (production previews and CLI deploys as before) |
| anything else | skip, with an error naming the value (fails closed) | skip, with an error naming the value |

**Preview guard (2026-10-06):** before any "build check" of a Preview (`VERCEL_ENV=preview`), the
script also requires the variables `apps/web/lib/env.ts` validates at build time (`API_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). A Preview missing any of them
could only fail that validation, so it is skipped and the log names the missing variables (never a
value). This is what a feature branch meets on the hml project while `DEPLOY_ENV` is missing from its
Preview environment: a **Canceled** preview instead of a failed one. Production builds never go
through the guard. Setting `DEPLOY_ENV=homolog` on Preview, as the table above asks, still makes the
hml project skip every other branch before the guard is reached.

Every run prints one `vercel-ignore: DEPLOY_ENV=… ref=… VERCEL_ENV=… -> build check|skip` line in
the build log; check it on the first deploy. Skipped builds show as **Canceled** in the dashboard and
still count toward the deployment quota.

## Workload Identity branch restriction (isolation guard)

The real isolation guard is each Workload Identity provider's attribute condition, not the YAML:

- production: project `api-dere-social`, pool `github`, provider `repo`, condition
  `assertion.repository == 'n1-tecnologia/rede-social' && assertion.ref == 'refs/heads/master'`;
- hml: project `rede-social-hml`, pool `github`, provider `repo`, condition
  `assertion.repository == 'n1-tecnologia/rede-social' && assertion.ref == 'refs/heads/homolog'`.

Why it holds: a run on `homolog` that falls back to the production variables still presents
`ref=refs/heads/homolog` in its OIDC token, so the production provider refuses it whatever the
workflow says. The `deploy-hml.yml` preflight and the `homolog` environment's branch policy are
earlier, softer guards.

Read a condition with
`gcloud iam workload-identity-pools providers describe repo --workload-identity-pool=github --location=global --project=<project> --format='value(attributeCondition)'`
and set it with
`gcloud iam workload-identity-pools providers update-oidc repo --workload-identity-pool=github --location=global --project=<project> --attribute-condition="<condition>"`.

Recorded 2026-10-02: the production provider was created (2026-09-28) with only
`assertion.repository=='n1-tecnologia/rede-social'` — no branch restriction. The hml provider was
created with the `refs/heads/homolog` condition on 2026-10-02, and production was tightened to
`refs/heads/master` the same day (applied by hand; auto mode refuses production IaC changes).

## hml provisioning runbook

Run in order; every `<hml-...>` value is unknown until its step. No step here is automated.

- [x] **GCP project.** Create `rede-social-hml` (done 2026-10-02, number `221367067304`), link the billing account
  `cobrancas-tech`, and record its project number as `221367067304`.
- [x] **APIs.** Enable Cloud Run, Artifact Registry, Secret Manager, IAM Service Account Credentials
  and Security Token Service (STS) on `rede-social-hml`.
- [x] **Artifact Registry.** Create the Docker repository `rede-social` in `southamerica-east1`.
- [x] **Service accounts.** `rede-social-deploy` with `roles/run.admin`,
  `roles/artifactregistry.writer`, and `roles/iam.serviceAccountUser` on the runtime SA;
  `rede-social-runtime` with `roles/secretmanager.secretAccessor`.
- [x] **Workload Identity.** Pool `github`, OIDC provider `repo` (issuer
  `https://token.actions.githubusercontent.com`) with the `refs/heads/homolog` condition from
  "Workload Identity branch restriction (isolation guard)", and a `roles/iam.workloadIdentityUser`
  binding for the repository principal on `rede-social-deploy`. Then read the production provider's
  condition, record it in that section, and make sure it is restricted to `refs/heads/master`.
- [ ] **Supabase project.** Create the hml project; record its ref (`<hml-supabase-ref>`), region
  (`<hml-supabase-region>`) and pooler host. Check the organisation's Free-plan allowance of active
  projects first. Use the same auth signing-key setup as production (asymmetric ES256 keys).
- [ ] **Realtime.** Turn public access off on the hml project (`private_only`), as in
  "Phase 7 release", step 4.
- [ ] **Data API.** After the first isolated deploy-hml.yml run (migrations, then config push), check that Exposed schemas on the hml project lists only data_api_closed and Extra search path only extensions, then run the curl proof of "Data API exposure (quick 261009-8fz)" against the hml URL. The [remotes.homolog] table must not carry an api table that lists public.
- [ ] **`[remotes.homolog]` in `supabase/config.toml`**, in its own commit once the ref is known:
  `project_id = "<hml-supabase-ref>"`; `[remotes.homolog.auth]` with
  `site_url = "https://rede-social-hml.vercel.app"` and one explicit
  `additional_redirect_urls = ["https://rede-social-hml.vercel.app/auth/confirm**"]` entry;
  `[remotes.homolog.auth.email]` `otp_expiry = 86400`; `[remotes.homolog.auth.hook.send_email]`
  `enabled = true`,
  `uri = "https://api-221367067304.southamerica-east1.run.app/v1/hooks/auth/send-email"`
  (the Cloud Run URL is derivable from the project number) and
  `secrets = "env(SEND_EMAIL_HOOK_SECRETS)"`; and, if hml stays on the Free plan, the same
  `[remotes.homolog.auth.email.template.recovery]` pin production uses. The `deploy-hml.yml` preflight
  blocks every deploy until this block exists with the hml ref.
- [ ] **Mux.** Environment "HML": an access token pair, a signing key (store the private key
  base64-encoded), a webhook to `https://api-221367067304.southamerica-east1.run.app/v1/webhooks/mux` subscribed to `video.asset.ready`,
  `video.asset.errored` and `video.upload.errored`, and the default playback policy `signed`.
- [ ] **VAPID.** Generate a new pair with `npx web-push generate-vapid-keys`; never reuse
  production's.
- [ ] **Resend.** Create an hml API key on the verified domain `n1marketingdigital.com.br`.
- [x] **Secret Manager.** (created empty 2026-10-02; values still to add) Create the 14 secrets of "GCP Secret Manager secrets — `homolog`" in
  `rede-social-hml`.
- [x] **GitHub environment `homolog`.** (2026-10-02: variables + branch policy; secrets pending) Its variables and secrets (the two `homolog` sections above),
  Deployment branches limited to `homolog`, no required reviewer.
- [ ] **Branch.** Create `homolog` from `master` and push it.
- [ ] **Vercel project.** Create `rede-social-hml` with the settings and variables of
  "Vercel project — `homolog`", including `DEPLOY_ENV=homolog` on all three environments.
- [ ] **First deploy checks.** `deploy-hml.yml` is green, deep health check included; the hml Vercel
  build log shows `vercel-ignore: DEPLOY_ENV=homolog ref=homolog`; the production Vercel project's
  deployment for the same push shows `skip`. If the hml log shows `DEPLOY_ENV=unset`, the belt still
  builds `homolog`, but fix the variable's environments.
- [ ] **Optional demo seed / super_admin (by hand).** From a clean checkout, export only hml values:
  `DATABASE_URL` (the `api-database-url-hml` value), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `SEED_PASSWORD`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, `PLATFORM_HOST=rede-social-hml.vercel.app`,
  `TENANT_DEMO_HOST` / `TENANT_LAB_HOST` (distinct from `PLATFORM_HOST`); then run `pnpm db:seed`.
  Variables in the environment win over `apps/api/.env.local`. Check the target ref first, and
  never run it with a production value.
- [ ] **Placeholders.** Replace every `<hml-...>` placeholder in this file with the real value, and
  date the change.

## Custom domains (TENANT-07, D-34)

A tenant's host is attached from the platform panel; the API registers it with the hosting
provider through an env-selected adapter, stores it **unverified** with the DNS records the customer
must create, and the `kernel.domain-verify` pg-boss job (in the **worker** service) re-checks it
every ~10 minutes for up to 7 days. Only a verified host resolves (D-36); the verified transition
adds the host to the Supabase Auth redirect allow-list and sends the pending first-admin invite.
Locally and in CI both adapters are the fail-safe **local** implementations (`fake` / `local`,
the kernel env defaults) — nothing here is needed to develop or test. Locally and in CI the flow
runs against `DOMAIN_PROVIDER=fake` (`apps/web/e2e/phase2-smoke.spec.ts`,
`platform-domains.spec.ts`); aliases 308 to the primary (D-35) and only verified hosts resolve
(D-36). The real-provider proof is the runbook item "Attach a real customer domain end-to-end"
below (Phase 01.1).

Variables read by the **`api` and `worker`** Cloud Run services (both run the same image; the
worker runs the poller, the API answers "Verificar agora"):

| Variable | staging (not provisioned) | production | Source |
|---|---|---|---|
| `DOMAIN_PROVIDER` | `fake` (Preview deployments carry no customer domains) | `vercel` | plain env |
| `VERCEL_TOKEN` | — | Secret Manager `vercel-token-prod` | Vercel → Team Settings → Tokens (team-scoped token) |
| `VERCEL_PROJECT_ID` | — | project id of `apps/web` | Vercel → Project → Settings → General; plain env |
| `VERCEL_TEAM_ID` | — | team id | Vercel → Team Settings → General; plain env |
| `AUTH_ALLOW_LIST` | `local` | `supabase` | plain env |
| `SUPABASE_PAT` | — | Secret Manager `supabase-pat-prod` | Supabase → Account → Access Tokens: a **dedicated** token with `auth:write` — not the CI `SUPABASE_ACCESS_TOKEN` |
| `SUPABASE_PROJECT_REF` | — | `qjjhtduxquvlfppybpqq` (project `rede-social`) | same value as the GitHub secret `SUPABASE_PROJECT_ID`; plain env |
| `PLATFORM_HOST` | staging platform host | `rede-social-woad.vercel.app` | now also read by the API so an attach of the platform host is refused (`400 { host: "platform_host" }`) |

`assertProductionEnv()` (kernel `env.ts`) refuses `DOMAIN_PROVIDER=vercel` / `AUTH_ALLOW_LIST=supabase`
without their credentials at boot, so a half-configured revision fails its startup probe instead of
failing the first attach. The adapters call only the documented project-level endpoints (add / status
/ config / verify / detach) — the platform never writes the customer's DNS, buys a domain or deletes
one at the Vercel account level (`.planning/phases/02-…/COVERAGE.md`).

## Video (MEDIA-03, D-43/D-44)

Video is reached through the `VideoProvider` seam (`packages/core/server/media/video/`), which has
two implementations selected by `VIDEO_PROVIDER`. **`fake` is the default everywhere and the only
thing that has ever run**: it mints its direct-upload target in the private `media` bucket and
simulates transcoding with a deferred `kernel.media-provider-event` job, so no automated run — local,
CI or a Preview deployment — can ingest into a real Mux account and accumulate stored minutes. The
documented cheaper alternative (Cloudflare Stream) would be a new file next to `mux.ts`, not a
rewrite.

Variables read by the **`api` and `worker`** Cloud Run services (both run the same image; the API
answers the webhook and mints upload targets, the worker applies the events):

| Variable | staging (not provisioned) | production | Source |
|---|---|---|---|
| `VIDEO_PROVIDER` | `fake` | `mux` (only after the runbook item below) | plain env |
| `MUX_TOKEN_ID` | — | Secret Manager `mux-token-id-prod` | Mux → Settings → Access Tokens (Video read+write) |
| `MUX_TOKEN_SECRET` | — | Secret Manager `mux-token-secret-prod` | shown ONCE at token creation |
| `MUX_SIGNING_KEY_ID` | — | Secret Manager `mux-signing-key-id-prod` | Mux → Settings → Signing Keys |
| `MUX_SIGNING_KEY_PRIVATE` | — | Secret Manager `mux-signing-key-private-prod` | the signing key's private key, **base64-encoded** |
| `MUX_WEBHOOK_SECRET` | — | Secret Manager `mux-webhook-secret-prod` | Mux → Settings → Webhooks → the endpoint's signing secret |

`assertProductionEnv()` (kernel `env.ts`) refuses `VIDEO_PROVIDER=mux` without **all five** at boot,
so a half-configured revision fails its startup probe instead of handing out upload URLs it can
never confirm. `FAKE_VIDEO_WEBHOOK_SECRET` is a local-stack-only override for the fake's own HMAC and
belongs in no hosted environment. Only publishable keys ever reach Vercel — nothing about Mux does.

`POST /v1/webhooks/mux` is **unauthenticated by design**: the provider's HMAC signature over the raw
body is its authentication (5-minute tolerance, timing-safe compare). Do not put an IAM or IAP guard
in front of it; do rotate `MUX_WEBHOOK_SECRET` together with the endpoint in the Mux dashboard.

**Phase 01.1 runbook — provision Mux (NOT DONE; no Mux account exists yet).** Until every step below
has run, `VIDEO_PROVIDER` stays `fake`, every automated proof runs against the fake, and **the real
transcode and the real-device HLS playback are known-blocked UAT lines** — the honest analogue of
Phase 2's four blocked items. Steps:

1. Create the Mux account and confirm the published pay-as-you-go rates still match the Phase 3
   cost model (`video_quality: 'basic'` ⇒ free encoding; the first 100,000 delivery minutes per
   month free; storage ≈ USD 0.0028/min/month at 1080p). Assumption A6 — a Brazilian account with no
   negotiated contract — is verified HERE, at account creation.
2. Settings → Access Tokens → create an **API access token pair** with Mux Video read+write. Store
   the id and the secret as `mux-token-id-prod` / `mux-token-secret-prod`.
3. Settings → Signing Keys → create a **signing key**. Store the key id as
   `mux-signing-key-id-prod` and the private key **base64-encoded** as
   `mux-signing-key-private-prod` (`base64 -i private.pem`).
4. Settings → Webhooks → create an endpoint pointing at `https://<api host>/v1/webhooks/mux`,
   subscribed to `video.asset.ready`, `video.asset.errored` and `video.upload.errored`. Copy its
   signing secret into `mux-webhook-secret-prod`.
5. Confirm the environment's **default playback policy is `signed`** (D-44). Every asset is created
   with `playback_policies: ['signed']` regardless, but a public default is a trap for anything
   created outside this codebase.
6. Set `VIDEO_PROVIDER=mux` on `api` and `worker` and redeploy. A missing secret fails the startup
   probe rather than the first upload.
7. Close the two blocked UAT lines: (a) an `admin_tenant` uploads a real phone-recorded video and it
   reaches `ready` with a playback id; (b) it plays on a real iOS Safari and a real Android Chrome.
   Record the outcome here, including whether Mux's `test: true` assets (which this codebase sets
   outside production) behaved as documented — watermarked, 10 seconds, deleted after 24 h.

## Phase 3 runtime state (media & member profiles, 03-01 … 03-08)

Phase 3 creates state **outside git**. Everything below is applied by `supabase db push`, so a
hosted deploy must **run `supabase db push` BEFORE the `api`/`worker` revision is rolled out** — the
bucket row, the two extensions and the profile backfill all come from migrations, and an API that
boots first answers `POST /v1/media/uploads` with a 500 against a bucket that does not exist yet.

**1. Stored data (new tables).**

| Table | Migration | Notes |
|---|---|---|
| `media_assets` | `20260921182418_media_assets.sql` | every upload of every kind; one tenant-wide `select` policy carrying `deleted_at is null`, every write through the admin lane |
| `member_profiles` | `20260921190226_member_profiles.sql` | one row per membership; created going forward by the `member_profiles_from_membership` trigger and **backfilled for existing memberships by `20260921190227_member_profiles_search.sql`**. The backfill is `on conflict (membership_id) do nothing`, so re-applying it is harmless |
| `media_provider_events` | `20260922020438_media_provider_events.sql` | the webhook replay defence, keyed by the PROVIDER's event id. No `tenant_id`, RLS with **zero policies** — admin lane only |

**2. Live service configuration (not in the database schema).**

- **The private `media` Storage bucket.** Local comes from `[storage.buckets.media]` in
  `supabase/config.toml`; hosted comes from `supabase/migrations/20260921182426_media_bucket.sql`
  (widened for the fake provider's two video mimes by `20260922020621_media_bucket_video.sql`).
  **The two must agree**: the API's 413 threshold and its accepted mime list are pinned to the
  bucket's own `file_size_limit` (50 MiB) and `allowed_mime_types` (exactly the `MEDIA_LIMITS` union
  in `@rede-social/contracts/media`), and `supabase/tests/070-media-bucket.sql` pins that set so neither a
  widening nor a narrowing passes silently. `supabase config push` does **not** create buckets.
- **The `unaccent` and `pg_trgm` extensions**, created into schema `extensions` by
  `20260921190227_member_profiles_search.sql` together with the `app.imm_unaccent(text)` IMMUTABLE
  wrapper and the GIN trigram index behind the directory's accent-insensitive search. Without them
  `GET /v1/members?q=…` cannot be planned at all.

**3. Secrets.** The five Mux entries plus the `VIDEO_PROVIDER` selector — see
[Video (MEDIA-03)](#video-media-03-d-43d-44) above. `VIDEO_PROVIDER` defaults to `fake` and
`assertProductionEnv()` refuses a `mux` selection missing any of the five at boot, so a
half-configured revision fails its startup probe instead of handing out upload URLs it cannot
confirm.

**4. OS-registered state: none.** Phase 3 introduces **no scheduler, no cron and no new service**.
Its three background jobs — `kernel.media-derive-variants` (03-01),
`kernel.media-provider-event` (03-06) and `kernel.media-sweep-orphans` (03-08) — all run in the
existing `ROLE=worker` Cloud Run service. The sweeper paces itself with a deferred `startAfter`
re-arm under a constant `singletonKey`, the `kernel.domain-verify` pattern; `boss.schedule()` stays
unused. The worker arms it once at start, and every run queues the next one an hour later, so
restarting the worker is the only operational action it ever needs.

### Phase 3's known-blocked verifications (Phase 01.1)

Two checks could not be closed in Phase 3 and are recorded as **blocked, not passed** — the honest
analogue of Phase 2's four blocked items ("UAT partial — 9/13 passed, 4 blocked on Phase 01.1").
`apps/web/e2e/phase3-smoke.spec.ts` annotates both in its own run output as well.

| # | Blocked verification | Why it cannot be closed here | How to close it |
|---|---|---|---|
| 1 | **Real-device HLS playback** | Playwright bundles Chromium, which cannot stand in for iOS Safari's HLS stack — the same class of finding as 02-11's standalone-install check. The local fake also mints non-JWT thumbnail tokens, so `@mux/mux-player` never derives a poster and only the no-poster branch is ever exercised (broken-windows 14). | After step 6 of the Mux runbook: as `admin_tenant`, upload a phone-recorded HEVC video, confirm the "Processando" placeholder, then confirm playback **with a thumbnail** on a real iPhone (Safari) and a real Android device (Chrome). |
| 2 | **A real Mux transcode** | No Mux account and no GCP Secret Manager exist yet (Phase 01.1 is deferred to the end of the milestone), so every automated proof in Phase 3 runs against `VIDEO_PROVIDER=fake`. The Mux adapter is written and typed but has never run against a real account (broken-windows 12). | Run the seven-step Mux runbook above, set `VIDEO_PROVIDER=mux`, and upload one real video end to end: `video.asset.ready` must land on `POST /v1/webhooks/mux` and flip the row to `ready` with a `playback_id`. |

**Video vendor pricing — the STATE blocker "[Phase 3]: Video vendor pricing is LOW confidence" is
CLOSED by published figures** (RESEARCH R-01): Mux encoding is free at `video_quality: 'basic'`, the
first **100,000** delivery minutes per month are free, and storage is about USD **0.0028**/min/month
at 1080p — so a 300-minute pilot library costs roughly **USD 1/month**, against **Cloudflare
Stream's USD 5/month floor** (USD 5 per 1,000 minutes stored). Mux is therefore the pilot choice and
Cloudflare Stream stays the documented alternative behind the same seam. Assumption **A6** flags
these as *published* rates for a Brazilian account with no negotiated contract: **re-verify them in
the dashboard at account creation** (step 1 of the runbook).

## Supabase hosted auth settings (Phase 2)

**Email OTP Expiration = 86400** (24 h) on the hosted project — Dashboard → Authentication →
Emails, or `[remotes.production.auth.email] otp_expiry = 86400`, committed in `supabase/config.toml`
on 2026-09-28 and applied by the next `supabase config push` — so a first `admin_tenant` can open
the invite link within a day of the domain verifying (02-10). The local stack keeps `otp_expiry = 3600` (`[auth.email]`), which the
e2e suite never approaches. The Send Email Hook values (secret, transport, rotation) live in
`docs/deploy/auth-mail.md`.

## Data API exposure (quick 261009-8fz)

**Why.** The API is the only data client. The browser talks to Supabase only for Auth (through the
Next.js BFF) and for read-only Realtime Broadcast, and neither uses the Data API (PostgREST
`/rest/v1` and the `/graphql/v1` route). Yet a member holds both halves of a Data API call:
`GET /api/realtime/token` gives page JavaScript the raw access token, and the publishable key ships
in the bundle. `authenticated` keeps its DML grants on `public`, because the API runs its queries as
that role, so an exposed `public` lets a member's own token reach every RLS policy without the
API's rules (CR-01 of the 08.2 review). Locally the exposure was latent: the member token carries no
top-level `tenant_id`, so only the member's own `users` row was readable. Production's claims were
not observed. A future claim hook would turn it into a write path, which is why the surface is
closed rather than patched table by table.

**What changed in the repo.** The migration `20261009111139_data_api_closed_schema.sql` creates
`data_api_closed` with no objects and no grants (no USAGE grant was needed: PostgREST boots and
refuses cleanly without one). The `[api]` block of `supabase/config.toml` now reads
`schemas = ["data_api_closed"]` and `extra_search_path = ["extensions"]`. The regression test
`apps/api/tests/integration/data-api-not-exposed.test.ts` runs in `pnpm test:integration`, and
therefore in CI; it pins the `[api]` block, the absence of `public` in any `[remotes.*.api]` table,
the empty grant-less schema, and a refusal for every method, profile, RPC and GraphQL call. Two
config-only variants were rejected after probing:

- `schemas = []`: PostgREST treats an empty list as unset and falls back to serving `public`.
- `enabled = false`: Kong keeps its `/rest/v1` and `/graphql/v1` routes and proxies them to a
  missing upstream; on networks with a wildcard DNS search domain the request leaves the machine
  and hangs.

**How the deploy carries it, and the order.** In `deploy-api.yml`, the step "Migrations (roles
included)" (`supabase db push --include-roles`) runs before "Push auth configuration"
(`supabase config push`), in the same job; a failed migration stops the job before config push.
config push also applies the `[api]` block, because there is no `[remotes.production.api]`
override, so the next production deploy creates the schema first and then sets Exposed schemas to
`data_api_closed` and the extra search path to `extensions`. The migration must be applied before
the config push, the normal migration-then-API order. Measured locally with the schema missing,
PostgREST fails closed: every `/rest/v1` call (default profile or `Accept-Profile: public`) answers
503 `PGRST002` "Could not query the database for the schema cache. Retrying." in about 10 ms, and
nothing in `public` is served. Once the schema exists it recovers on its own at the next retry (the
retry backoff reached 32 s locally), with no restart. Never add a `[remotes.<env>.api]` table that
lists `public`; the regression test fails on it. That config push applies `[api]` on this plan
cannot be observed without a hosted call, which is why step 2 below checks the dashboard after the
deploy. `deploy-hml.yml` skips both steps while `HML_SUPABASE=shared-with-production`; in isolated
mode it runs them in the same order.

**Steps for the developer, by hand.** No workflow and no agent performs them.

1. **Before the next production deploy**, run the curl proof (step 3) against production and record
   the answers here. They are expected to show `public` still exposed: 401 with code `42501`, or 200
   with an empty array.
2. **After the next `deploy-api.yml` run succeeds**, open the dashboard for project `rede-social`
   (ref `qjjhtduxquvlfppybpqq`) → Project Settings → Data API (or Integrations → Data API →
   Settings). Check that Exposed schemas lists only `data_api_closed` and Extra search path lists
   only `extensions`. If `public` or `graphql_public` is still listed, config push did not carry
   `[api]`: set the same values by hand (the schema exists after the migration step) and record
   here that config push did not apply them.
3. **Curl proof with the publishable key only.** It is the value the browser already has; use no
   service key and no member token, and `limit=0` reads no data. Export `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` with the target project's values in your shell (never pasted inline),
   then run:

   ```bash
   curl -sS -i "$SUPABASE_URL/rest/v1/communities?select=id&limit=0" \
     -H "apikey: $SUPABASE_PUBLISHABLE_KEY"
   curl -sS -i "$SUPABASE_URL/rest/v1/communities?select=id&limit=0" \
     -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H "Accept-Profile: public"
   curl -sS -i -X POST "$SUPABASE_URL/graphql/v1" \
     -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H 'content-type: application/json' \
     -d '{"query":"{ __typename }"}'
   ```

   Expected after the change (the shapes pinned locally): the first answers 404 `PGRST205`
   "Could not find the table 'data_api_closed.communities' in the schema cache"; the second and the
   third answer 406 `PGRST106` ("Invalid schema: public" / "Invalid schema: graphql_public") with
   the hint "Only the following schemas are exposed: data_api_closed". A 503 `PGRST002` means the
   schema is missing (the migration did not run). Record the observed hosted status and body here,
   with the date.
4. **Smoke on a tenant host:** log in and see the bell or the support chat update live. Realtime and
   Auth do not use the Data API.
5. **hml.** While `HML_SUPABASE=shared-with-production`, steps 1-4 already cover hml (same
   project). When hml becomes isolated, follow the "Data API" item of the hml provisioning runbook.

**Rollback.** Restore the previous `[api]` values in `supabase/config.toml`
(`schemas = ["public", "graphql_public"]`, `extra_search_path = ["public", "extensions"]`) and
deploy; config push re-applies them. Changing only the dashboard is undone by the next deploy. The
empty schema can stay, since it is harmless; migrations are forward-only, so never edit the applied
one. Nothing in the app depends on the Data API.

## Storage buckets

The private `media` bucket (03-01) accepts `image/jpeg`, `image/png`, `image/webp`,
`application/pdf`, `video/mp4` and `video/quicktime` — exactly the union of `MEDIA_LIMITS` in
`@rede-social/contracts/media`, pinned as a set by `supabase/tests/070-media-bucket.sql`. The two video
entries exist for `VIDEO_PROVIDER=fake`, which stores its bytes there; with `VIDEO_PROVIDER=mux` the
vendor owns the object and nothing mints a Storage URL for a video at all. The bucket stays PRIVATE,
caps files at 50 MiB and carries zero `storage.objects` policies.

**08.3 release (D-410, COURSE-07).** The hosted `media` bucket's allow-list is widened by
`supabase/migrations/20261013214735_media_bucket_office.sql` to the four office document mimes of
`ATTACHMENT_MIMES` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`,
`application/vnd.ms-powerpoint`) so lesson materials — and, with them, the feed's attachments — may
be spreadsheets and slide decks as well as PDFs and images. The migration ships with the 08.3
release, is expand-only (an `update storage.buckets set allowed_mime_types`, nothing removed) and a
no-op for every existing object; the local list in `supabase/config.toml` matches it value for value
and `070-media-bucket.sql` pins the eleven-value set. The 50 MiB per-file cap is unchanged — it is
now also `MEDIA_LIMITS.file.attachment.maxBytes` (was 25 MiB for PDFs). As for every 08.2/08.3
migration, apply it before the API that accepts the new mimes.

`[storage.buckets.branding]` in `supabase/config.toml` applies to the **local stack only**
(`supabase start`). Hosted projects get the public `branding` bucket (2 MiB cap, image MIME
allow-list) from `supabase/migrations/20260917021738_branding_bucket.sql`, applied by
`supabase db push` like every other migration — there is no dashboard step, and `supabase config
push` does **not** create buckets (02-13). Object keys are `<tenant_id>/branding/…`; the derived
icon set lives under `<tenant_id>/branding/icons/<iconVersion>/`.

## Phase 2 verification

**Local exit gate — `pnpm verify` (~15–20 min, one shot).** Runs, in this order, exactly what CI
runs (`.github/workflows/ci.yml`, called as `checks` by `deploy-api.yml` and `deploy-hml.yml`, D-12;
see `docs/deploy/ci.md`). `pnpm verify` runs the whole e2e locally; CI runs only the affected specs:

1. `pnpm lint` — Biome on every package + `scripts/check-ui-literals.sh` (no hex literal, legacy
   brand class or pt-BR literal in TSX; catalog files valid — UI-03, PWA-03);
2. `pnpm turbo typecheck build test` — TypeScript, `next build`, unit suites;
3. `pnpm check:static-routes` — the build-output gate (below);
4. `pnpm boundaries` / `pnpm boundaries:negative` / `pnpm guard:lanes`;
5. `pnpm supabase test db` — pgTAP (RLS, tenant isolation);
6. `pnpm test:integration` — the API integration suite (needs the running API on :8787 or starts
   its own listener);
7. `pnpm spike:supavisor`;
8. `pnpm e2e` — Playwright against the dev servers on `mobile-chromium` (iPhone 14),
   `pixel-chromium` (Pixel 7; only `branding.spec.ts` and `phase2-smoke.spec.ts`) and
   `desktop-chromium`;
9. `pnpm --filter @rede-social/web e2e:pwa` — 02-11's suite against a **production build** on :3100
   (manifest per tenant, service worker, offline fallback, `display-mode` mirror).

**Smoke only — `pnpm verify:smoke` (~10 min).** `branding.spec.ts` (criterion 1 on the seed
tenants), `phase2-smoke.spec.ts` (criteria 2 and 4 on a panel-provisioned throwaway tenant:
create → attach + verify → invite mail → served brand → Marca rebrand through the worker → member
shell → alias 308 → suspend/reactivate → module toggle → branded recovery mail), `invite.spec.ts`,
`recovery.spec.ts`, then the `@tracer` half of the PWA suite. Use it after a change that touches
branding, the panel, the proxy or the mail path; `pnpm verify` before a phase seals or a PR opens.
Never filter Playwright through `pnpm e2e -- <spec>` — pnpm forwards the `--` and Playwright then
runs the whole suite; the scripts call `pnpm --filter @rede-social/web exec playwright test <spec>`.

**Prerequisites.** `pnpm supabase start` (pinned CLI, Docker), `pnpm db:reset`,
`bash scripts/local-env.sh --write` (writes `apps/api/.env.local` and `apps/web/.env.local` with
`MAIL_TRANSPORT=local`, `DOMAIN_PROVIDER=fake`, `AUTH_ALLOW_LIST=local`), `pnpm db:seed` (also
derives the seed tenants' icon sets), Chromium via
`pnpm --filter @rede-social/web exec playwright install chromium`. The smoke spawns its own
`ROLE=worker` on :8790 for icon derivation and stops it afterwards; a running one is reused. Mail
is read from Mailpit (`http://127.0.0.1:54324`). Expect ~60 s waits inside the smoke: the web
host cache (`apps/web/lib/tenant-host.ts`, 60 s TTL) is what a brand or status change has to
outlive before the served HTML follows; the spec polls and annotates the observed delay.

**Build-output gate — `scripts/check-static-routes.sh`** (`pnpm check:static-routes`, after
`pnpm --filter @rede-social/web build`). Reads `apps/web/.next/prerender-manifest.json` and
`app-path-routes-manifest.json`: every authenticated or host-branded route (`(app)/`, `(auth)/`,
`(platform)/`, `/m/[slug]/manifest.webmanifest`, `/~offline`) must be dynamic; the only static
output allowed is Next's `/_*` internals and `/serwist/*` (02-11 prerenders the service-worker
script). Exit 2 = no build output (never a pass by absence); exit 1 = offenders printed. A failure
means a layout or page stopped reading a request-time API (`cookies()` / `headers()`) or gained a
static export — restore the per-request read; never add the path to the allow-list. A required key
that disappears (`route moved or renamed — update REQUIRED_KEYS`) is also a failure.

**Manual checks (not automatable).**

| Check | Requirement | Why manual | Steps |
|---|---|---|---|
| App installs and runs in standalone mode on a real iOS Safari and a real Android Chrome device | PWA-01 | Playwright cannot install a PWA and the bundled Chromium ignores `display-mode` emulation (`pwa.spec.ts` skips that half with an annotation); installability needs an HTTPS origin, i.e. the hosted environment from Phase 01.1 | Open the tenant host on the device over HTTPS → "Adicionar à Tela de Início" (iOS: Compartilhar → Adicionar à Tela de Início; Android Chrome: install prompt) → launch → no browser chrome, the tenant's icon and name; `document.documentElement.dataset.displayMode === 'standalone'` |
| Design approval of the prototype-less screens | UI-04 (D-33) | Human design review | Recorded in `.planning/sketches/001-phase-02-designed-screens/README.md` (`approved: true`, provisional, 2026-09-16); the designer's follow-up review stays open |

**Hosted proofs deferred to the Phase 01.1 runbook.**

- Custom domain end-to-end with `DOMAIN_PROVIDER=vercel` + `AUTH_ALLOW_LIST=supabase` — the
  runbook item "Attach a real customer domain end-to-end" under `## Runbook`.
- Send Email Hook against Resend with `MAIL_TRANSPORT=resend` — `docs/deploy/auth-mail.md`
  ("Hosted values — Phase 01.1 runbook items").
- `scripts/check-static-routes.sh` against a Vercel build (`vercel build` locally, then
  `NEXT_DIR=apps/web/.next bash scripts/check-static-routes.sh`, or the deployment's `.next`) —
  CI proves the identical `next build` on the runner; the Vercel parity run is the hosted step.
- *Not runnable as written while production-only (no staging, no seed tenants in production —
  Decisions 2026-09-28).* Staging smoke on the platform-owned seed hosts (D-24: `TENANT_DEMO_HOST` / `TENANT_LAB_HOST`) with
  `PLAYWRIGHT_BASE_URL=https://<TENANT_DEMO_HOST>` (+ `PLAYWRIGHT_API_URL` for the by-host reads):
  `branding.spec.ts`'s remote-capable tests are the ones without `isRemote` skips.
- `otp_expiry = 86400` on the hosted project — now committed as `[remotes.production.auth.email]`
  in `supabase/config.toml`; it lands with the next `supabase config push` (section above).

## Phase 7 release (notifications, Web Push, chat)

**Every step below is run by the developer, in this order, by hand.** Nothing in the repository
runs them, and no plan has run them: production is live, so the secrets, the Realtime toggle, the
push, the reminder backfill and the device run are user actions (plan 07-11). The commands never
print a secret; do not paste a key into a terminal that records history, a chat or an issue.

What ships: 11 migrations (`20260930123126_notifications.sql` … `20260930190229_chat_functions.sql`,
applied by `supabase db push` in `deploy-api.yml`), the `notifications` and `chat` modules, the
`notifications.fanout` / `notifications.push-send` / `events.reminder` / `notifications.prune`
worker jobs, and the web's bell, Notificações, Configurações push row, soft-ask card and Suporte
screens. Both modules are per-tenant flags: a tenant sees nothing until the platform panel turns
`notifications` / `chat` on for it.

1. **Generate the production VAPID pair, once, on your own machine.**
   `npx web-push generate-vapid-keys` prints a public and a private key (base64url). The private key
   goes ONLY into Secret Manager (step 2); it is never committed, never put on Vercel and never
   shared. Keep the pair: **rotating it invalidates every stored subscription** (a one-way door).
   After a rotation, a device whose permission is still granted re-subscribes on its next open
   (07-07's key-mismatch resync); every other device has to be turned on again by its member.
2. **Create the three secrets in Secret Manager BEFORE pushing** (project `api-dere-social`). A
   secret that `deploy-api.yml` references but that does not exist fails the deploy loudly, which is
   why this comes first.

   | Secret | Value |
   |---|---|
   | `vapid-public-key-prod` | the public key from step 1 |
   | `vapid-private-key-prod` | the private key from step 1 |
   | `vapid-subject-prod` | a `mailto:` contact (for example `mailto:suporte@n1marketingdigital.com.br`). Never `localhost`: Apple rejects it (`BadJwtToken`), and `assertProductionEnv()` refuses to boot with one |

   Create each with `printf '%s' '<value>' | gcloud secrets create <name> --data-file=- --project=api-dere-social`
   (or Security → Secret Manager → Create secret in the console, which keeps the value out of the
   shell history). Then confirm `RUNTIME_SA` (`rede-social-runtime@…`) can read them: it holds
   `roles/secretmanager.secretAccessor`; if that grant is per secret rather than project-wide, add it
   to each of the three with
   `gcloud secrets add-iam-policy-binding <name> --member=serviceAccount:<RUNTIME_SA> --role=roles/secretmanager.secretAccessor --project=api-dere-social`.
   `deploy-api.yml` mounts them as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` on
   **both** `api` and `worker`, with `PUSH_TRANSPORT=webpush` on both (the worker sends; the API only
   enqueues, but its subscription-endpoint rule refuses the local fake push host only under
   `webpush`, and it boots the same `assertProductionEnv()`).
3. **Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on Vercel, Production only**, to the same value as
   `vapid-public-key-prod` (Project → Settings → Environment Variables). It is inlined at build time,
   so it must exist before the build that ships Phase 7. Leave Preview unset (every push surface then
   reads "unsupported"). The private key never reaches Vercel.
4. **Turn Realtime public access off** (`private_only`). Dashboard → project `rede-social` →
   Realtime → Settings → disable "Allow public access"; or, with your own Supabase access token in
   the environment (never pasted inline),
   `curl -X PATCH "https://api.supabase.com/v1/projects/qjjhtduxquvlfppybpqq/config/realtime" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d '{"private_only": true}'`.
   Every channel the app joins and every signal the database publishes is already private (07-01,
   07-03); this closes the door on a public join of the same topic (T-07-73). There is no
   `config.toml` key for it, so it is a dashboard/Management API setting that `supabase config push`
   does not touch.
5. **Confirm the hosted access-token expiry is at most 3600 s** (Dashboard → Authentication →
   Sessions / JWT settings: "Access token expiry"). `supabase config push` in the deploy re-applies
   `[auth] jwt_expiry = 3600` from `config.toml`, so re-check it after step 7. It bounds how long a
   member blocked in the database keeps an already-open Realtime socket (signals are ids only and
   every read goes through the API, which refuses a blocked member at once; T-07-74, accepted).
6. **Check that the reshaped tables are empty in production** (read-only, Dashboard → SQL editor):
   `select (select count(*) from public.notifications) as notifications, (select count(*) from public.chat_messages) as chat_messages;`
   Both must be `0`. `20260930123126_notifications.sql` adds `dedupe_key`, `subject_type` and
   `subject_id` as `NOT NULL`, and `20260930190151_chat.sql` adds `chat_messages.author_side
   NOT NULL`, all without a default: they apply cleanly only to the empty tables no earlier release
   ever wrote. A non-zero count means stop and ask before pushing.
7. **Push `master` and deploy the API and worker BEFORE the web serves the new build.** The bootstrap
   contract gained `counters.conversationsBadge` (07-08). Since the 07 code review (A-WR-07) the web
   reads it with a default (`count`), so a web build that goes live before the API revision no
   longer breaks the signed-in pages the way the 06-01 precedent did (`deferred-items.md`); until the
   API catches up, a member's chat slot shows a count instead of the dot, and the new `/suporte` and
   `/notificacoes` routes answer their error states. A push to `master` starts BOTH pipelines at
   once, and the API one waits for `checks` (~20 min) and the `production` approval, so the Vercel
   build normally finishes first. Holding the web back is still the clean order:
   1. before pushing, in Vercel → Project → Settings → Environments → Production, turn off the
      automatic assignment of the production domains to new production deployments (Vercel's
      staged production deployments), so the push builds the web but `rede-social-woad.vercel.app`
      keeps serving the current deployment;
   2. push `master`; approve the `production` environment in GitHub Actions once `checks` and
      `build` are green; `deploy-api.yml` runs `supabase db push` (the 11 migrations), deploys
      `api`, then `worker`, then its deep health check;
   3. when the workflow is green, promote that SHA's production deployment in Vercel (Deployments →
      the deployment → Promote), then turn the automatic domain assignment back on.

   This promotes a **production** build of the same `master` SHA, built with the Production
   variables, not a Preview (see "Production is never a promoted preview" under the Production
   gate). If the web did go live first, roll it back (Vercel → Instant Rollback to the previous
   production deployment) until the API revision is serving, then promote the new one.
8. **Optional: arm the reminders of events created before this release** (07-05). Events created or
   edited after the deploy arm their own 24 h and 1 h `events.reminder` jobs; older upcoming events
   have none until this runs. From a clean checkout, with ONLY the production `DATABASE_URL` (the
   `api-database-url-prod` value: the `api_user` connection through the transaction pooler)
   exported in the shell for the duration of the command, and never printed:
   ```bash
   DATABASE_URL="$(gcloud secrets versions access latest --secret=api-database-url-prod --project=api-dere-social)" \
     pnpm exec tsx scripts/arm-event-reminders.ts --dry-run   # plans only: { events, armed, skipped }
   DATABASE_URL="$(gcloud secrets versions access latest --secret=api-database-url-prod --project=api-dere-social)" \
     pnpm exec tsx scripts/arm-event-reminders.ts             # arms; re-running arms nothing new
   ```
   The script loads `apps/api/.env.local` for the other kernel variables, but a variable already in
   the environment wins, so the production `DATABASE_URL` above is the one it uses. Run it only after
   the worker from step 7 is live (it creates the `events.reminder` queue itself if the worker has
   not yet). A window already in the past is skipped, never sent late.
9. **Staff for support.** Production has no `support_tenant` user: a tenant's `admin_tenant` holds
   `chat.support` and answers from the same Suporte slot (D-223) until Phase 8's role management can
   create a `support_tenant` membership.
10. **Run the real-device test plan**, [`docs/phase-07-device-test-plan.md`](phase-07-device-test-plan.md),
    against production (a real iPhone on iOS 16.4+, a real iPad and a real Android phone), and
    record every row in the Phase 7 UAT. Until a row has run on a device it stays
    `blocked — not run`; no automated run counts for it.

### Realtime quota (Free plan)

Supabase **Free** allows **200 concurrent Realtime connections**, **100 messages/s** and **2 M
messages/month** (each broadcast counts one message sent plus one per receiving client), with no
overage billing. Sizing for a 300-member pilot with about 40 app windows open at the peak (07-RESEARCH
Pattern 4): one tenant-wide signal per publication (never one per member), personal signals for
personal notifications, and conversation + support-inbox + user signals per chat message come to
**about 600 messages a day** (about 18 k a month), **under 1 % of the quota**, with connections
around 40 of 200.

The connection hygiene is already built (07-03): **one Realtime client per window** (every channel is
multiplexed on it), **disconnected after 60 s hidden** and reconnected on refocus, with the counters
and the open thread refetched through the API on every re-join (D-240), so a dropped signal is never
a wrong number.

**Upgrade trigger:** more than about **150 simultaneous foreground windows**, or any observed
`too_many_connections` / `tenant_events` error in the Realtime logs (Dashboard → Logs → Realtime),
means moving the project to **Pro** (V2-PLAT-06: 500 connections, 500 messages/s).

## Connection budget (Pro)

Quick task 261006-fs9, for the ~10,000-user launch (3 tenants). Cloud Run multiplies every pooled
client by the instance count, and Supavisor refuses clients past its per-compute limit, so the
`--max-instances` flags in `deploy-api.yml` / `deploy-hml.yml` and the `DATABASE_POOL_MAX` env var
are sized together from this section.

**Assumption:** Supabase **Pro on SMALL compute**: **400 Supavisor (pooler) clients** and **90
Postgres connections**. Micro (Pro's default compute) is 200 / 60; Medium is 600 / 120. Source:
<https://supabase.com/docs/guides/platform/compute-and-disk>, read 2026-10-06. Re-check the figures
whenever the compute changes.

### Per-process pooler clients

| Process | App pool (`DATABASE_POOL_MAX`, transaction pooler 6543) | API-side pg-boss (`getBoss`, lazy, transaction pooler) | Worker pg-boss (`BOSS_DATABASE_URL`, session pooler 5432) | Total pooler clients |
|---------|------|------|------|------|
| `api` instance | 5 (the default) | 1 | — | **6** |
| `worker` instance | 10 (`DATABASE_POOL_MAX=10`, worker only) | 1 (fan-out and push retry enqueues) | 2 (`createBoss({ max: 2 })`) | **13** |

The worker's 2 session-mode clients also each hold a real Postgres backend for their lifetime.

### Worker pool fit (re-checked 2026-10-06)

The worker runs `notifications.push-send` with pg-boss `localConcurrency: 4`
(`PUSH_SEND_JOB_CONCURRENCY`, declared on the job definition) and every other queue at 1; each push
job sends 16 subscriptions at a time (`PUSH_SEND_PARALLELISM`), so at most 64 outbound HTTPS requests
per worker.

- A push-send job holds **at most one app-pool connection at any moment**: its read lane, then per
  distinct recipient a flags-cache-miss lane (only on a miss; the per-tenant 30 s cache has no
  in-flight de-duplication, so 4 concurrent jobs of one tenant may each miss once) released before
  that recipient's counters lane opens, then its report lane. The single-job case in
  `packages/modules/notifications/tests/push-send-job.test.ts` asserts max open lanes = 1. So 4
  concurrent push jobs hold at most 4 connections.
- **No other handler holds an app-pool connection while acquiring a second one:** the fan-out and the
  event sink read the flags before their lane; `enqueueInTx` inside a lane writes through that lane's
  own connection (it only starts the separate API-side pg-boss pool, max 1); the media, domain,
  branding and invite jobs run their `withAdminTx` calls one after another.
- Worst case at once: 4 (push) + 13 (one per other queue) = **17 holders against a pool of 10**
  (re-counted 2026-10-19 for Phase 08.7: 08.6 added `courses.live_reminder` and
  `courses.lessons_batch`, 08.7 `kernel.daily-tenant-dispatch` and `dashboard.snapshot-build`). The
  pool covers every push job plus the fan-out with 5 to spare; in the theoretical instant where every
  queue is in a database phase, up to 7 handlers wait briefly inside postgres.js for a free
  connection. That is a short wait, never starvation or deadlock, because nothing holds-and-waits.
- The pg-boss pool stays **max 2**: pg-boss never holds a connection across a handler, LISTEN/NOTIFY
  is off, and the 14 queues' 17 pollers (every 2 s) and their completes are single short queries.

### Formula

```
2 × (A × 6 + W × 13) + H × 6 + R ≤ L
```

- `A` = api `--max-instances`, `W` = worker `--max-instances`.
- `H` = hml api `--max-instances` while `HML_SUPABASE=shared-with-production` (the hml api then
  points at the production database, see "Temporary: hml shares production's Supabase" above; the
  hml worker is not deployed in that mode). `H = 0` once hml is isolated.
- `R` = reserve for CI migrations (`supabase db push`), Studio / the SQL editor, `psql`, and the
  `spike:supavisor` run.
- `L` = the compute's pooler-client limit.
- The factor 2 covers a rollout where the old and the new revision are both alive (postgres.js keeps
  idle connections until the instance stops).

| | A | W | H | R | L | Rollout peak | Steady state |
|---|---|---|---|---|---|---|---|
| **Current (Small)** | 20 | 1 | 2 | 40 | 400 | 2 × (120 + 13) + 12 + 40 = **318 ≤ 400** | 120 + 13 + 12 = **145** |
| Fallback (Micro) | 10 | 1 | 2 | 20 | 200 | 2 × (60 + 13) + 12 + 20 = **178 ≤ 200** | 60 + 13 + 12 = 85 |

On Micro, `A` must drop to 10 in `deploy-api.yml` before the deploy.

**Throughput:** 20 api instances × Cloud Run's default concurrency 80 = 1,600 concurrent requests (20 is the regional CPU quota cap, 2026-10-07).
The real database ceiling is the pooler's server-side **Pool Size** (Dashboard → Database → Settings →
Connection pooling), which this budget does not change; check that the Pool Size plus the worker's
session clients plus Supabase's own services stay under the 90 Postgres connections.

**Push fan-out:** a tenant-wide push to 10,000 subscribers is about 100 `notifications.push-send`
jobs (100 users each). Per job, about 1 s of sequential badge counts plus about 1 s of sends at 16 in
flight; with 4 jobs per worker at once (pg-boss polls every 2 s per worker) a tenant-wide push takes
roughly **one to two minutes**, versus tens of minutes serially before.

**Recompute** whenever `DATABASE_POOL_MAX`, a job's `concurrency`, the compute size, the number of
services on the database, or hml's Supabase mode changes; edit both workflows and this section
together.

## Phase 8 release (moderation, tenant admin panel, CSP)

> Phase 08.1's release 1 ships in the same push as this release; read "Phase 08.1 release
> (multi-tenant identity)" below before step 1.

**Every step below is run by the developer, in this order, by hand** (plan 08-12, D-345). No plan
has run any of them: production is live, auto mode blocks Claude from applying production
migrations, and the devices and accounts are the developer's. No command here prints a secret; do
not paste a key or token into a terminal that records history, a chat or an issue.

What ships:
- 3 migrations: `20261002121805_moderation_log.sql` (the `moderation_log` table, its two policies,
  and the nullable `feed_comments.deleted_by_user_id`), `20261002123245_moderation_log_immutable.sql`
  (revokes update, delete and truncate; the immutability triggers) and
  `20261002123247_feed_comments_orphan_replies.sql` (a one-off, idempotent soft delete of the
  replies left under roots that were deleted the pre-Phase-8 way). Any earlier migration production
  has not applied yet goes with them; step 1 lists them.
- The `/v1/admin` routes (Moderação, Membros, Marca, Regras), the moderator removal on feed and story
  comments, the block that reaches an open app, the click-to-play YouTube and Vimeo players, and the
  nonce CSP with its `CSP_MODE` switch.
- No new API or worker environment variable or secret. The web gains `CSP_MODE` (server-only).

**Why this order inverts Phase 7's API-first rule.** The web parses every API answer with STRICT
response schemas, which refuse unknown keys. The Phase 8 API adds `removal` to every comment and
`embedUrl` to link previews. An OLD web would therefore refuse a NEW API's comment and feed answers.
The NEW web declares both fields `.optional()`, so it reads the OLD API's answers unchanged. The new
admin rows also hide without the new permissions, which only the new API grants. Phase 7 was the
opposite case (an added bootstrap field the old web lacked). So, for Phase 8: migrations first, then
the web, then the API and worker. Every migration is expand-only, so the running API ignores them.

**hml shares this database** ("Temporary: hml shares production's Supabase, Mux and Resend"). Phase 8
must not reach the `homolog` branch before step 1 has run, and pushing it there at all is the
developer's call.

1. **Push `master`, then apply the migrations with the brew Supabase CLI.**
   - Before pushing, confirm no commit carries a Claude trailer:
     `git log origin/master..HEAD --format=%B | grep -i anthropic` must print nothing.
   - Push `master`. This starts two things at once:
     - the Vercel production build of the web (step 2: set `CSP_MODE` BEFORE this push);
     - `Deploy API`, whose `checks` job is `ci.yml` (step 7; the push starts no separate `CI` run).
       Let its `build` job finish, because it pushes
       `southamerica-east1-docker.pkg.dev/api-dere-social/rede-social/api:<sha>` for step 3. Do not
       approve the `production` environment while its `checks` job has not finished green; cancel
       the run once the image exists if you deploy by hand (step 3).
   - Pre-push check that the pending migrations are expand-only. With the global (brew) CLI linked
     to `qjjhtduxquvlfppybpqq`, `supabase migration list --linked` lists the migrations production
     lacks. Each pending file must hold no `drop table`, `drop column`, `rename`, `set not null` or
     column type change:
     `grep -inE 'drop (table|column)|rename|set not null|alter column .* type' supabase/migrations/<pending>.sql`
     must print nothing for each pending file. The three Phase 8 files pass this check.
   - Apply them as in Phase 7, with the brew CLI (the repo-pinned binary hangs on the macOS keychain
     prompt). Export `SUPABASE_ACCESS_TOKEN` (from `supabase-pat-prod`) and a `SEND_EMAIL_HOOK_SECRETS`
     value (the CLI validates the hook block on every command) in the shell only, then run
     `supabase db push --linked --include-roles`. This is the same exception to "Migrations never
     run from a developer machine" that Phase 7 used, because `deploy-api.yml`'s `checks` have never
     finished inside their limit. If a `Deploy API` run ever passes `checks`, its production job does
     the same push instead.
   - Afterwards, `supabase migration list --linked` shows the three Phase 8 migrations applied.
2. **The web on Vercel, FIRST, with `CSP_MODE=report-only`.** Before the push in step 1, run
   `vercel env add CSP_MODE production` with the value `report-only` (unset means the same). The
   push then builds and serves the new web. If the Ignored Build Step cancels the build, force it
   from a scratch directory linked to the project after `vercel switch n1-tecnologia`:
   `vercel api -X POST /v13/deployments --input <json with gitSource ref master>` (the Phase 7
   path). Check `https://rede-social-woad.vercel.app/entrar`: the response carries
   `Content-Security-Policy-Report-Only`, and an existing tenant's feed and comments still render
   against the OLD API.
3. **The API and the worker on Cloud Run**, with the image from step 1's `build` job:
   ```bash
   export CLOUDSDK_ACTIVE_CONFIG_NAME=rede-social
   IMAGE=southamerica-east1-docker.pkg.dev/api-dere-social/rede-social/api:<sha>
   gcloud run deploy api    --image "$IMAGE" --region=southamerica-east1 --project=api-dere-social \
     --max-instances=20
   gcloud run deploy worker --image "$IMAGE" --region=southamerica-east1 --project=api-dere-social \
     --max-instances=1 --update-env-vars=DATABASE_POOL_MAX=10
   curl -fsS https://api-253040968821.southamerica-east1.run.app/v1/health?deep=1
   ```
   `gcloud run deploy` keeps each service's current env vars, secrets and flags, except what the
   command names. Phase 8 adds none. Quick 261006-fs9 adds the `--max-instances` caps and the
   worker's `DATABASE_POOL_MAX=10`, sized for the Supabase Pro **Small** compute (see "Connection
   budget (Pro)"): switch the project to Pro + Small BEFORE this step, or on Micro use
   `--max-instances=10` for `api`. `--update-env-vars` merges and never drops the existing vars
   (never `--set-env-vars` here). With these the commands match `deploy-api.yml`'s production job. A
   deploy closes Mux's
   pooled webhook connections, and Mux retries 10-15 min later (Phase 7 note). Then, on an existing
   tenant, an admin's Configurações shows the Administração group with Marca, Membros, Regras da
   comunidade and Moderação.
4. **The `qa` tenant** (D-345), from the platform panel as the super_admin:
   - `/plataforma/novo`: slug `qa`, a display name such as "QA Rede Social", the brand colours and a
     logo. Modules on: `feed`, `communities`, `stories`, `events`, `notifications`, `chat` (and
     `reels` for the Reels rows). It is a tenant of its own, separate from socializando,
     igor-alves-teste and reine, and never holds real members' data.
   - Accounts: the first admin through the panel's invite (a mailbox you control). Then a member
     (sign up on the qa host, or invite). Then a second member promoted to "Suporte" from Membros
     (checklist row A9).
   - Domain: a verified custom domain needs a DNS name from you (RESEARCH A8). Attach it from
     Domínios as in "Attach a real customer domain end-to-end" under Runbook. Without one, the
     checklist marks the host-dependent rows blocked with that reason.
   - Lifecycle: it stays active until the 08.1 exit gate's real-device smoke closes the MVP. Then
     suspend it with the platform panel's status toggle (reversible). Never hard-delete it.
   - **Post-release smoke on qa** (minutes, before the full checklist): as the qa admin, remove one
     member comment (it appears in Moderação) and block then unblock the second member (the member's
     open app lands on "Acesso suspenso").
5. **Run [`docs/phase-08-device-checklist.md`](phase-08-device-checklist.md)** on a real iPhone and
   a real Android phone against production on the `qa` tenant. Record every row you run in that file
   and in the Phase 8 UAT (`/gsd-verify-work 8`). A row you did not run on a real device stays
   `blocked — not run`.
6. **The flip to `CSP_MODE=enforce`**, only when the checklist's section D read shows **zero**
   `csp.violation` lines from the app in the Vercel logs (filter below in "Content Security Policy
   (Phase 8)", step 2). Then set it (`vercel env rm CSP_MODE production`, then
   `vercel env add CSP_MODE production` with value `enforce`) and redeploy the web. Repeat the
   smallest smoke on one phone (checklist D3). **Rollback:** set `CSP_MODE=report-only` again and
   redeploy. No code, no migration.
7. **One CI run that finishes.** The `checks` of the `Deploy API` run that the step 1 push started on
   `master` (jobs `static`, `db`, `plan`, `e2e` (the affected specs, or four shards when the change is
   shared or unmapped), `e2e-pwa`) must reach a conclusion inside its limits. Record its URL, its conclusion and each job's duration in `08-GATE.md`. If it does not
   finish, the gate row stays open with what timed out (D-348).

**Rollback.** The API first, then the web, because an old web cannot read the new API (see above):
`gcloud run services update-traffic api --to-revisions=<previous>=100 --region=southamerica-east1`
(and the same for `worker`), then Vercel → Instant Rollback to the previous production deployment.
The migrations stay: they are expand-only, and the old code ignores the new table and column. The
orphan-reply repair is a one-way soft delete by design; the rows stay in the table.

## Phase 08.1 release (multi-tenant identity)

**Every step below is run by the developer, by hand.** No plan has run any of them: production is
live, auto mode blocks Claude from touching production, and the checks need the developer's
dashboard and accounts. No command here prints a secret.

08.1 ships in **two releases, in two separate pushes** (D-318, expand then contract), because
`deploy-api.yml` (and the by-hand path below) applies migrations BEFORE the new Cloud Run revision
serves (RESEARCH Pitfall 1). Dropping something the running API still reads in the same push breaks
every request until the new revision is up.

**How it combines with Phase 8.** Phase 8 has not been released yet (08-12 is paused at its go-live
checkpoint), and the developer chose to ship 08.1 first, so **release 1 goes out together with
Phase 8's code**, in ONE push of `master`, following the "Phase 8 release" steps and their order
(migrations, then the web with `CSP_MODE=report-only`, then the API and the worker). The additions
for 08.1 are marked in the steps below. Release 2 is a later push of its own.

### Release 1 (expand) = the commits of 08.1-01 through 08.1-07

What `supabase db push` applies, all expand-only:
- `20261006195908_multi_tenant_identity.sql`: `DROP INDEX memberships_one_tenant_per_user_v1` (an
  identity may now hold one membership per tenant, V2-PLAT-07). It is an index, not a column: the
  "Phase 8 release" step 1 grep (`drop (table|column)|rename|set not null|alter column .* type`)
  prints nothing for it.
- `20261006195913_multi_tenant_identity_lookups.sql`: `app.membership_in_tenant(uuid, uuid)` and
  `app.memberships_of_user(uuid)`, SECURITY DEFINER, executable by `api_user` only.
- `20261006215630_identity_has_password.sql`: `app.identity_has_password(uuid)`, executable by
  `api_user` and `service_role` only.

**Why the API revision still serving during the push keeps working.** Nothing it reads changes:
`app.membership_for_user`, `public.users.name` and both profile triggers are untouched by release 1.
The index only backed the old code's race guard; in the few minutes before the new API serves, an
old-API sign-up race could at worst create a second membership, which the new API reads correctly.

1. **Migrations, with Phase 8's.** Production lacks Phase 8's three migrations
   (`20261002121805_moderation_log`, `20261002123245_moderation_log_immutable`,
   `20261002123247_feed_comments_orphan_replies`), and they are OLDER than migrations production has
   already applied, so a plain `supabase db push` refuses them. Run the "Phase 8 release" step 1
   checks, then add `--include-all` to its push:
   `supabase db push --linked --include-roles --include-all`. Before pushing,
   `supabase migration list --linked` must list exactly the 3 Phase 8 files and the 3 files above as
   pending; anything else means stop and ask. Afterwards it shows all six applied. (`deploy-api.yml`
   runs `supabase db push --include-roles` without `--include-all`, so the workflow would refuse
   these files too; the by-hand push is the path for this release.)
2. **The web.** Vercel builds it from the same push, and it may go live before the API approval
   (Phase 8 wants it first anyway): it tolerates the old API. `/participar` maps the old API's 404 on
   `GET /v1/join/state` to today's host-mismatch screen, and the community picker
   (`/escolher-comunidade`) exists only on generic hosts (localhost, Vercel Preview), never on a
   tenant or the platform host.
3. **The API, then the worker**, exactly as "Phase 8 release" step 3. No new environment variable
   or secret in 08.1.
4. **Check release 1 is serving:**
   `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/join/state`
   prints `401` (the route exists and asks for a Bearer). `404` means the release-1 revision is not
   serving: stop, release 2 must not be pushed.
5. **hml shares this database** (`HML_SUPABASE=shared-with-production`, so `deploy-hml.yml` skips
   migrations). Push release 1 to `homolog` only after step 1 has run, and never push release 2
   there before production has it.

**Release-1 gate (local).** `pnpm verify` (with `TURBO_CACHE=local:r VIDEO_PROVIDER=fake`) is green
on the release-1 code, including the shared-identity suite of 08.1-07 (pgTAP
`160-shared-identity.sql`, the `shared identity (08.1)` cases in `isolation.test.ts`, `realtime
shared identity (08.1)` and push case 10). The suite runs again in 08.1-08 on the final schema.

### Before release 2 (read-only production checks)

Run both, and record the results in the 08.1-08 SUMMARY:
1. `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/join/state`
   prints `401`. `404` means production does not run release 1: stop.
2. In the Supabase SQL editor of project `rede-social` (read-only):
   ```sql
   select count(*) from public.member_profiles mp
     join public.users u on u.id = mp.user_id
    where mp.display_name = '' and u.name <> '';
   ```
   Record the number. The contract migration fills exactly these names from `users.name` before
   it drops the column (RESEARCH A5), so after release 2 the same query cannot run (the column is
   gone) and `select count(*) from public.member_profiles where display_name = ''` shows how many
   stayed empty because `users.name` was empty too.

### Release 2 (contract) = the commits of 08.1-08 only, in their own push

After both checks above passed, push the 08.1-08 commits and nothing else. They apply the fill of
empty profile names, the re-pointed profile triggers, `drop function app.membership_for_user` and
`alter table users drop column name`, then deploy the API and the worker that no longer read either.
**Never push release 1 and release 2 together** (RESEARCH Pitfall 1: the migrations run before the
API, so the old revision would lose `users.name` and `app.membership_for_user` mid-request). If
08.1-08 is already committed locally when release 1 ships, push release 1 by SHA
(`git push origin <last 08.1-07 commit>:master`), never the whole branch.

### Rollback limit

- **Release 1:** the "Phase 8 release" rollback applies (API first, then the web). The expand
  migrations stay; an older API revision ignores the new functions. An identity that already holds
  two memberships is resolved by the old `app.membership_for_user` (oldest membership), so on its
  second tenant's host it gets the old host-mismatch answer until the API rolls forward again.
- **Release 2:** `gcloud run services update-traffic api --to-revisions=<revision>=100 …` (and the
  same for `worker`) may only target a release-1 revision or a later one. A pre-08.1 revision reads
  `users.name` and calls `app.membership_for_user`, both gone, and would fail every request. The
  contract migrations are never rolled back.

### Manual UAT (hosted)

Run against production on a tenant host after release 1 (the `qa` tenant of "Phase 8 release" step 4
works), and record each line in the 08.1 UAT (`/gsd-verify-work 08.1`); a line not run stays
`blocked — not run`:
- A password recovery started on a tenant host arrives in THAT tenant's brand through Resend, even
  for someone who is not a member there yet, and the link opens that host (D-315, D-317).
- An existing-identity invite (a person who already belongs to another community, invited as a new
  community's first admin) arrives tokenless, in the new community's brand, pointing at its
  `/entrar` (D-314).
- A password reset on one community signs the person out of the other communities' origins at their
  next token refresh (within the access-token TTL, at most 1 h). Expected: the password is shared
  (RESEARCH Pitfall 4, D-312).

## Phase 08.2 release (Loja and paid access to communities)

**Every step below is run by the developer, by hand, in this order.** No plan has run any of them:
production is live, and auto mode blocks Claude from touching it. No command here prints a secret.

### What ships

- **Seven migrations, all expand-only:**
  - `20261008171502_community_gate_seam.sql`: the kernel's community gate,
    `app.community_locked_ids()` and its siblings, created as stubs that return the empty set.
  - `20261008171520_feed_community_sample.sql`: `app.feed_sample_post_ids`, the newest post of each
    locked community (the sample a non-holder sees).
  - `20261008171623_store.sql`: the four store tables (`store_products`,
    `store_product_communities`, `store_orders`, `store_entitlements`) with RLS, the RESTRICTIVE
    `feed_posts_community_gate` policy, and `tenant_modules_key_chk` widened to accept `store`. The
    CHECK is dropped and re-added with one more allowed value, so no existing row can fail it. No
    `tenant_modules` row is inserted.
  - `20261008171645_store_functions.sql`: the store bodies of the gate functions, the SECURITY
    DEFINER purchase, and the member-lane write privileges revoked on both ledgers.
  - `20261008174609_feed_gate_lookups.sql`: the feed's two definer lookups over rows the caller's
    lane cannot see (is this post locked, is this media asset hidden). Each answers one fact, never
    content.
  - `20261008175334_feed_community_gate_policies.sql`: the RESTRICTIVE policies on `feed_comments`
    and `feed_likes` (story comments untouched) and one index on `feed_post_media`.
  - `20261008190514_store_grants.sql`: the SECURITY DEFINER grant and revoke, the admin's two
    writes on the entitlement ledger.

  None holds a `drop table`, `drop column`, `rename`, `set not null` or column type change, so the
  "Phase 8 release" step 1 grep prints nothing for any of them.
- **The API:** the twelve `/v1/store` routes (products list, detail and lock preview; create, edit
  and archive; purchase; community access for the list and the page; buyers, grant and revoke), the
  feed and stories reads behind the gate, and the notification fan-out that skips non-holders.
- **The web:** the Loja screens (`/loja`, the product page and its purchase pop-up, the product
  form, Compradores), the "Exclusiva" tags and the locked community page. No new environment
  variable or secret on Vercel, Cloud Run or GitHub.

### Order: migrations, then the API, then the web

1. **Migrations first** (RESEARCH Pitfall 11). The new API calls functions only these migrations
   create, so an API that goes live before them answers 500 on every feed read. The command is
   `supabase db push --linked --include-roles --include-all`. `--include-all` is needed while
   production still lacks Phase 8's three migrations, which are older than files it has already
   applied. Before pushing, `supabase migration list --linked` must list as pending only the seven
   files above, plus any earlier release's files that have not shipped yet. Anything else means stop
   and ask. The push belongs to `deploy-api.yml`. That workflow runs `supabase db push
   --include-roles` without `--include-all`, and its `checks` job has never finished inside its time
   limit. Until both are fixed, use the by-hand exception of "Phase 8 release" step 1, with the brew
   CLI and the token exported in the shell only. Never use any other developer-machine push.
   **Why the running API keeps working.** Every gate function returns the empty set for a tenant
   whose `store` row is missing or off, and production has no `store` row anywhere. So the restrictive
   feed policies restrict nothing, and the revision still serving reads exactly what it read before.
2. **The API, then the worker**, as in "Phase 8 release" step 3. The new revision emits two new
   optional contract keys, `access` on a post and `lockedCount` on a community feed page, and only
   for a locked community. With `store` off nothing is locked, so the web still serving keeps
   parsing every answer (RESEARCH Pitfall 10).
3. **The web last.** Vercel builds it from the same push. Without `store` in the bootstrap's
   modules, the Loja slot, the settings row and every store read stay absent.
4. **Check the API is serving:**
   `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/store/products`
   prints `401` (the route exists and asks for a Bearer). `404` means the 08.2 revision is not
   serving.

### Turning it on

`store` ships **OFF for every tenant**: no migration and no seed of production writes a row. A
`super_admin` turns it on per tenant from Plataforma → the tenant → Módulos. The flag cache gives
each API instance up to 30 s to see the change (RESEARCH Pitfall 8). The SQL gate reads
`tenant_modules` live, so content follows the switch at once while the Loja routes may answer a
few more seconds the old way. Turning it off again hides the Loja and unlocks every community. The
products, orders and entitlements stay and come back if the module is turned on again.

### 08.1-08 and this release

08.2 reads neither object that 08.1-08 drops: `app.membership_for_user` and `public.users.name`.
It uses `memberships`, `member_profiles.display_name`, `app.user_id()` and `app.tenant_id()`. The
two releases touch disjoint objects, so they ship in either order. Each still follows its own steps.

### No payment step

There is no payment gateway in this release. A purchase writes a `paid` order with provider `none`
and the product row's amount, and the entitlement at once. Nothing is charged. Until the gateway
phase, a tenant that turns `store` on is selling at no cost, which suits free products and access an
admin grants by hand.

### Rollback limit

Roll back the API first, then the web, as in "Phase 8 release". The migrations stay. An older API
revision never calls the store functions, and an older web never sees the optional keys. If a
tenant already had `store` on, turn it off before rolling the API back: the old revision has no
Loja routes, and the restrictive policies would keep locking communities that its screens cannot
explain.

### Manual UAT (hosted)

Run on a tenant host after the release, with `store` turned on for a test tenant only. Record each
line in the 08.2 UAT (`/gsd-verify-work 08.2`); a line that is not run stays `blocked — not run`:
- On a real phone, the locked community page and the purchase pop-up (VALIDATION "Manual-Only").
- A member buys a product and the community opens. The admin revokes the purchase and it locks
  again on the member's next request.

## Phase 08.3 release (Cursos)

**Every step below is run by the developer, by hand, in this order.** No plan has run any of them:
production is live, and auto mode blocks Claude from touching it. No command here prints a secret.
The school is admin-first: this release ships the tenant admin's catalogue (courses, modules,
lessons, materials, categories, tracks, lives) and the whole data model; no member sees any of it
until the member phase, and no tenant has it until a `super_admin` turns `courses` on.

### What ships

- **Six migrations, all expand-only, all no-ops while `courses` is off** (COURSE-15, P62):
  - `20261013205445_course_gate_seam.sql`: the kernel's course and live gate —
    `app.course_locked_ids()`, `app.course_locked_ids_for(uuid)`, `app.live_locked_ids()` and
    `app.live_locked_ids_for(uuid)` — created as SECURITY DEFINER stubs that return the empty set
    (the `community_gate_seam` shape of 08.2).
  - `20261013205511_courses.sql` (generated): the eleven tables (`courses`, `course_categories`,
    `course_modules`, `course_lessons`, `course_lesson_materials`, `course_products`,
    `course_lesson_progress`, `course_tracks`, `course_track_courses`, `course_lives`,
    `course_live_products`) with their RLS — tenant-read / admin-write, `courses` published-or-admin,
    the RESTRICTIVE `course_lessons_course_gate`, the own-or-admin progress ledger — and the two
    widened CHECKs: `tenant_modules_key_chk` accepts `courses`, `media_assets_purpose_chk` accepts
    `lesson`. Each CHECK is dropped and re-added with one more allowed value, so no existing row can
    fail it. No `tenant_modules` row is inserted.
  - `20261013205559_courses_functions.sql`: the two hand-written foreign keys of the product link
    tables to `store_products` (the courses package never imports the store's schema), and `delete`
    / `truncate` on `course_lesson_progress` revoked from `authenticated` (the ledger cannot be
    emptied from any tenant lane).
  - `20261013205601_store_course_gate.sql`: the store's bodies of the four gate functions
    (`create or replace`, same signatures). A body answers the empty set unless the tenant has BOTH
    `store` and `courses` enabled, so link rows stay inert with either module off.
  - `20261013214735_media_bucket_office.sql`: the private `media` bucket's allow-list widened to
    the eleven-value contract union (the four office document mimes join the images, the PDF and the
    two video mimes). Documented under "Storage buckets" above (plan 03's note); nothing is removed
    and no existing object is touched.
  - `20261014144554_courses_live_gate.sql` (08.3 code review WR-01): one RESTRICTIVE select
    policy, `course_lives_live_gate`, on `course_lives`. It mirrors `course_lessons_course_gate`: the
    `admin_tenant` claim reads every live, and a lane that `app.live_locked_ids()` locks out reads no
    row of that live, so a locked live's `external_url` (the paid room link) no longer reaches a
    member lane. It only adds a policy; with `store` or `courses` off the gate function answers the
    empty set, so it is a no-op there.

  The "Phase 8 release" step 1 grep (`drop (table|column)|rename|set not null|alter column .* type`)
  prints no STATEMENT for any of the six; its one hit is the comment line in `*_courses.sql` that
  states the file is expand-only. The two `DROP CONSTRAINT` statements are the CHECK re-additions
  described above, not column or table drops.
- **The API and the worker:** the thirty-two `/v1/courses` routes (categories, catalogue, course
  create / edit / status, modules and lessons with their whole-order reorders, materials as one set
  and the ten-minute signed open, tracks, lives, the lessons picker), every one behind
  `requireModule('courses')` and `courses.manage` (an `admin_tenant`-only permission by
  construction); the `lesson` media purpose on `POST /v1/media/uploads` (4 GiB / 4 h, its own 200 h
  tenant ceiling beside the feed's 3 h one, charged in minutes); the duration-sized playback
  credential (`max(2 h, duration + 30 min)`, capped at 12 h) on `GET /v1/media/{id}/playback`;
  `inspectFile` at `complete` (PDF, ZIP and OLE signatures, the sharp decode for image attachments);
  the attachment limit widened to 50 MiB and the eight `ATTACHMENT_MIMES`; and the ready-event job's
  per-purpose duration cap (a lesson over four hours is `rejected` and its provider asset deleted).
  The worker image is the same build as the API (`ROLE=worker`), so it ships in the same step.
- **The web:** the `/cursos` segment (the hub with its Cursos | Trilhas | Lives tabs, the course,
  module, lesson, track and live forms, the course page with the curriculum editor, the category
  manager) and the "Cursos" row in Configurações → Administração, both gated on the module AND
  `courses.manage`. No new environment variable or secret on Vercel, Cloud Run or GitHub.

### Order: migrations, then the API and the worker, then the web

1. **Migrations first.** The new API calls functions and tables only these migrations create: a new
   API live before them would answer 500 — but only on the `/v1/courses` routes, which no member
   reaches and no admin reaches while `courses` is off for every tenant (every route is
   `requireModule`'d, 404 `MODULE_DISABLED`). Every other route of the new API reads what it read
   before. The command is `supabase db push --linked --include-roles --include-all`. Before pushing,
   `supabase migration list --linked` must list as pending only the six files above, plus any
   earlier release's files that have not shipped yet (08.2's seven, the quick tasks' two, if they are
   still pending). Anything else means stop and ask. The push belongs to `deploy-api.yml`. That
   workflow runs `supabase db push --include-roles` without `--include-all`, and its `checks` job has
   never finished inside its time limit ("Phase 8 release", "Phase 08.2 release"). Until both are
   fixed, use the by-hand exception of "Phase 8 release" step 1, with the brew CLI and the token
   exported in the shell only. Never use any other developer-machine push.
   **Why the running API keeps working.** The old revision never calls the four new functions and
   never reads the eleven tables; the two widened CHECKs only accept more; the gate bodies return
   the empty set for every tenant, because production has no `courses` row anywhere. So the
   restrictive lesson policy restricts nothing anyone can read, and the revision still serving
   answers exactly what it answered before.
2. **The API, then the worker**, as in "Phase 8 release" step 3. One contract note (RESEARCH
   Pitfall 12): the strict `mediaAssetSchema.purpose` enum gains `lesson`, so an OLD web would refuse
   a `lesson` asset in a media answer — but only an admin of a tenant with `courses` on can create
   one, and only through the NEW web's lesson form, which ships in step 3. Until then no `lesson`
   asset exists, and the old web keeps parsing every answer it receives. The media library screen
   lists videos of every purpose; it reads them through the new web once step 3 is live.
3. **The web last.** Vercel builds it from the same push. Without `courses` in the bootstrap's
   modules, the Configurações row, the `/cursos` segment and every courses read stay absent (the
   layout and the page both answer the kernel not-found).
4. **Check the API is serving:**
   `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/courses`
   prints `401` (the route exists and asks for a Bearer before the module check). `404` means the
   08.3 revision is not serving.

### Turning it on

`courses` ships **OFF for every tenant**: no migration and no seed of production writes a row
(`REAL_TENANT_DEFAULT_MODULES` is unchanged; a NEW tenant gets its `courses` row off like `store`).
A `super_admin` turns it on per tenant from Plataforma → the tenant → Módulos. The flag cache gives
each API instance up to 30 s to see the change (RESEARCH Pitfall 8); the SQL gate reads
`tenant_modules` live. With the module on, the tenant's `admin_tenant` sees the "Cursos" row in
Configurações and the `/cursos` hub; members see nothing new in this release (the member school is
the next phase). A course linked to store products locks only while the tenant ALSO has `store` on
(D-405): with the store off every course is open to every member of the member phase. Turning
`courses` off again hides the hub and the row; the catalogue stays and comes back with the switch.

### Rollback limit

Roll back the API first, then the web, as in "Phase 8 release". The migrations stay. An older API
revision never calls the course functions or reads the eleven tables, and an older web never sees a
`/cursos` route. If a tenant already had `courses` on, turn it off before rolling the API back: the
old revision has no `/v1/courses` routes, so the new web's hub would answer the error card on every
read, and the old web (once rolled back too) would refuse a `lesson` asset in a media answer.

### Manual UAT (hosted)

Run on a tenant host after the release, with `courses` turned on for a test tenant only. Record each
line in the 08.3 UAT (`/gsd-verify-work 08.3`); a line that is not run stays `blocked — not run`.
Local runs use `VIDEO_PROVIDER=fake`, so these are the real-provider and real-device checks the
VALIDATION marks "Manual-Only":
- On a real phone, a lesson video longer than five minutes uploaded through the lesson form reaches
  `ready` on Mux; the form shows the asset's duration, the curriculum row shows the Mux poster, and
  the course page's publish zone enables once it is ready; the player plays the signed HLS stream.
- On a real phone, a material (a PDF and a spreadsheet) uploaded to a lesson opens through the
  ten-minute signed URL in the phone's own viewer.
- The admin surfaces (`/cursos` hub, the course form, the curriculum editor, the lesson form, the
  track and live forms) on a 320 px and a 390 px phone, in light and dark, under the tenant's brand.

## Phase 08.4 release (course and live links in the product form)

**Every step below is run by the developer, by hand, in this order.** No plan has run any of them:
production is live, and auto mode blocks Claude from touching it. No command here prints a secret.
This release moves the course and live links from the course and live forms to the product form
(D-418): the store owns them, as it owns the community links, and the course and live forms show
them read-only ("Liberado pelos produtos: X, Y" / "Liberada pelos produtos: X, Y"). It ships
together with the Phase 08.3 release above, which has never reached production either.

### What ships

- **Three migrations, applied in timestamp order, the last one a DROP:**
  - `20261014201933_store_course_links.sql` (generated, create-only): the store tables
    `store_product_courses` and `store_product_lives`, with RLS (tenant read, `admin_tenant` write,
    the `store_product_communities` policies) and their indexes.
  - `20261014201954_store_course_links_functions.sql` (hand-written): the hand foreign keys to
    `courses(id)` and `course_lives(id)`, `truncate` revoked from `authenticated`, the copy of every
    08.3 link row (`course_products`, `course_live_products`) into the store tables with its
    `created_at`, a guard that raises (and aborts the file) on any difference between the two link
    sets, and only then the four gate bodies (`app.course_locked_ids*`, `app.live_locked_ids*`)
    re-pointed at the store tables with the same signatures and the same rule.
  - `20261014204035_drop_course_product_links.sql` (generated, drop-only): drops `course_products`
    and `course_live_products` with their policies and their two foreign keys to `store_products`.
    After it, the 08.3 section's "eleven tables" are nine; the links live only in the store.
- **The API:** `courseIds` / `liveIds` on `POST` / `PATCH /v1/store/products` (the product's set is
  replaced as `communityIds` is; a link to an archived course or a cancelled live is kept), the
  manager-only `courses` / `lives` in the product detail, and the course and live routes refusing
  any product key (strict `400`). Their `products` (and the lessons' `hasProducts`) now read the
  store tables.
- **The web:** the product form's "Cursos liberados" and "Lives liberadas" blocks (only while
  `courses` is on and the viewer holds `courses.manage`), and the read-only line on the course and
  live edit forms (only while `store` is on). No member surface changes: a member's product page
  never names a linked course or live. No new environment variable or secret.

### Order: migrations, then the API, then the web

1. **Run the rehearsal locally first:** `bash scripts/rehearse-course-links-migration.sh` must print
   `rehearsal: PASS`. It resets the local stack to the last 08.3 migration, loads an edge fixture
   (four tenants, archived and cancelled targets, `store` off in one tenant and `courses` off in
   another), applies the three files above in order and asserts that every link survives with its
   `created_at` and that every gate answer, per tenant, user and claim, is unchanged. It restores the
   seeded local database when it ends. Do not push if it fails.
2. **Migrations first, 08.3's and 08.4's together.** `supabase migration list --linked` must list as
   pending exactly the 08.3 release's six files and these three, plus any earlier release's files
   that have not shipped yet (production is known to lag: "Phase 8 release", "Phase 08.2 release").
   Anything else means stop and ask. Then `supabase db push --linked --include-roles --include-all`,
   by hand, with the brew CLI and the token exported in the shell only (the exception of "Phase 8
   release" step 1; `deploy-api.yml` pushes without `--include-all` and its `checks` job has never
   finished inside its time limit). Never use any other developer-machine push.
   **Why the running API keeps working.** The revision serving during the push is older than 08.3:
   it never reads a course table or calls a gate function, so neither the copy nor the drop touches
   anything it reads.
3. **The API**, as in "Phase 8 release" step 3; the worker is the same image and ships with it.
4. **The web last.** Vercel builds it from the same push. The new blocks and lines appear only for a
   tenant whose `courses` (and, for the read-only line, `store`) module is on.

### The two DROP TABLE lines

The "Phase 8 release" step 1 grep (`drop (table|column)|rename|set not null|alter column .* type`)
finds exactly two statements in this release, both in `*_drop_course_product_links.sql`:
`DROP TABLE "course_live_products" CASCADE;` and `DROP TABLE "course_products" CASCADE;`. Its other
hits are comment lines (one in that file and one in `*_store_course_links_functions.sql`) explaining
why the drop is a separate, later file. The two drops are safe:

- **No deployed database ever had those tables.** They were created by the 08.3 migrations, which
  ship in this same push; 08.3 never reached production, so no production row exists in them.
- **The copy is guarded anyway.** `*_store_course_links_functions.sql` copies every row first and
  raises on any difference before it re-points the gate bodies, and the drop runs only after that
  file succeeded (timestamp order). A failed guard aborts the push before anything is dropped.
- **The rehearsal proves the chain** (step 1 above, run locally before the push): every link and
  every gate answer survives files 1 to 3.

### Rollback limit

Roll back the web and the API only to an 08.4 revision, or to one older than 08.3. **Never to an 08.3
revision:** after the drop, an 08.3 API would read and write `course_products` /
`course_live_products`, which no longer exist, so every course and live route that touches a link
would fail. If an 08.4 revision misbehaves, roll forward with a fix instead. A revision older than
08.3 never reads a course table (as in the 08.3 section's rollback note: turn `courses` off for any
tenant that has it on before rolling that far back). The migrations stay; undoing the drop would be a
new migration that recreates the two tables and copies the rows back.

### Manual UAT (hosted)

Run on a tenant host after the release, on a test tenant with `courses` and `store` turned on. Record
each line in the 08.4 UAT (`/gsd-verify-work 08.4`); a line that is not run stays `blocked — not
run`.
- As the tenant admin, link a course and a live to a product from the product form ("Escolher
  cursos", "Escolher lives", save), on a phone and on a desktop; reopening the form lists both.
- The course edit form and the live form show "Liberado pelos produtos: {product}" / "Liberada pelos
  produtos: {product}" read-only, the product name linking to its page in the Loja; neither form
  offers a product picker.
- A member who does not hold the product is locked out of the course's non-free lessons and does not
  see the live's link; after a grant or a purchase they get both. There is no member course screen
  yet (the member school is the next phase), so until it ships this line stays `blocked — not run`;
  the gate itself is proven locally by pgTAP `190-courses.sql` and the rehearsal.
- With `courses` turned off for the tenant, the two blocks disappear from the product form (allow
  30 s for the flag cache) and a product save leaves the links in place.

## Phase 08.5 release (member side of the school)

**Every step below is run by the developer, by hand, in this order.** No plan has run any of them:
production is live, and auto mode blocks Claude from touching it. No command here prints a secret.
This release opens the school to members: the Cursos tab, the member catalogue, the course page, the
lesson player with its progress, the lock pages, the lives agenda and the live page, the admin's
"Ver como aluno" and the per-lesson sequence switch, and the store's side (what a product unlocks,
"Compra concluída" for courses and lives, the return to a locked course or live). It ships together
with the Phase 08.3 and Phase 08.4 releases above, which have never reached production either.

### What ships

- **Seven migrations, all expand-only, applied in timestamp order** (COURSE-27):
  - `20261015194744_course_asset_gate_seam.sql` (hand-written, kernel): the second kernel asset seam,
    `app.course_asset_hidden(uuid)`, created as a SECURITY DEFINER stub that answers `false` (no
    asset hidden), EXECUTE to `authenticated` only. It sits beside the feed's
    `app.media_asset_hidden` and never re-creates it.
  - `20261015194814_courses_member_columns.sql` (generated): `course_lessons.requires_previous
    boolean default false not null` ("Exige concluir a aula anterior", D-428) and the index
    `course_lesson_materials_tenant_asset_idx` the asset gate reads. Every existing lesson takes the
    default, so no lesson becomes sequence-locked by the migration.
  - `20261015194825_courses_member_functions.sql` (hand-written): the eight member functions, all
    `language sql stable security definer set search_path = ''`, pinned to `app.tenant_id()`, EXECUTE
    to `authenticated` only: the one lock evaluator `app.course_lesson_states`, the one access answer
    `app.course_lesson_access` (course door and live door), the titles-only `app.course_outline`,
    `app.course_lesson_content`, `app.course_lesson_material_list`, `app.course_live_cards` (never the
    room link or the replay id), `app.course_catalogue_stats` and, last, the courses body of
    `app.course_asset_hidden` (`create or replace`, same signature).
  - `20261015195954_courses_progress_open_lesson.sql` (generated): `ALTER POLICY` on
    `course_lesson_progress_insert_own` and `_update_own`. Their `with check` now also requires a
    lesson the caller may open (`app.course_lesson_access(lesson_id) is null`) and refuses the
    `admin_tenant` claim. It sorts after the functions file, which creates the function it calls.
  - `20261016110155_courses_material_soft_delete.sql` (generated, quick 261016-aqc, 08.5 review
    WR-01): the nullable `course_lesson_materials.deleted_at`. Detaching a material now stamps it
    instead of removing the row, so the asset stays governed by the course asset gate; a re-attach
    revives the same row. No existing row changes.
  - `20261016110251_courses_asset_gate_fail_closed.sql` (hand-written, quick 261016-aqc, 08.5 review
    WR-01 and WR-03): `create or replace`, same signatures and hardening, of
    `app.course_lesson_access` (a lesson the evaluator does not return answers `missing`, never
    open), `app.course_lesson_material_list` (live material rows only) and `app.course_asset_hidden`
    (any material row of the tenant, under any lesson, live or detached, keeps its asset governed).
    It sorts after the column file, whose column its bodies read.
  - `20261016133848_courses_asset_gate_admin_only.sql` (hand-written, quick 261016-eg6, 08.5 review
    IN-01 / T-08.5-10): `create or replace` of `app.course_asset_hidden`, same signature and
    hardening. Only the `admin_tenant` claim bypasses it now; `support_tenant` takes the access
    answer, so support is served every lesson asset of a published course and refused a draft
    course's lesson video and materials (D-426).

  The "Phase 8 release" step 1 grep (`drop (table|column)|rename|set not null|alter column .* type`)
  prints nothing for these seven files. The restrictive `course_lessons_course_gate` and
  `course_lives_live_gate` policies are not touched.
- **The API and the worker** (same image, `ROLE=worker`):
  - the seven member routes under `/v1/courses/learn/*`, behind `requireAuth` and
    `requireModule('courses')` only (no permission; the database decides): the catalogue
    `GET /learn/courses`, the course page `GET /learn/courses/{courseId}`, the lesson
    `GET /learn/lessons/{lessonId}`, the progress write `PUT /learn/lessons/{lessonId}/progress`
    (`admin_tenant` answers 204 and writes nothing), the member material URL
    `GET /learn/lessons/{lessonId}/materials/{materialId}/url`, the agenda `GET /learn/lives` and the
    live page `GET /learn/lives/{liveId}` (the room link only inside `[start − 15 min, end)` on the
    server clock). Every answer is `Cache-Control: no-store`.
  - the four store access reads `GET /v1/store/course-access`, `GET /v1/store/live-access`,
    `GET /v1/store/courses/{courseId}/access` and `GET /v1/store/lives/{liveId}/access` (STORE-23).
  - the product detail's `unlockedCourses` / `unlockedLives` for every caller and the purchase
    answer's `courses` / `lives` (D-425, STORE-06 / STORE-07 amended), `[]` while `courses` is off.
  - `requiresPrevious` on the lesson create, edit and views, with the first lesson of a course and a
    free lesson never storing it.
  - the media gate: `playbackTokens` asks `media_asset_hidden OR course_asset_hidden`, and
    `serveVariant('original')` asks `course_asset_hidden`, so a lesson video or material is the bare
    404 by remembered id for a member who cannot open a lesson holding it (closes T-08.3-05 and
    T-08.3-08).
  - the bootstrap's nav entry for `courses` (the Cursos tab) and Reels' `yieldsTabTo: ['courses']`.
- **The web:** the Cursos tab in the BottomNav with Reels moved to the leftmost TopBar slot, only on
  tenants with `courses` on; `/cursos` split by role (the hub for `courses.manage`, the member
  catalogue with its Cursos | Lives tabs for everyone else); the course page with its curriculum and
  buy section; the lesson player (resume, 15-second progress writes, the page-hide beacon through the
  new same-origin `POST /api/courses/progress`, "Marcar como concluída") and the two lock pages; the
  live page; "Ver como aluno" (`?ver=aluno`) with its preview banner; the lesson form's sequence
  switch; the product page's "Libera o acesso a" list of communities, courses and lives, the
  generalised "Compra concluída", and the return to a locked course or live (`?curso=` / `?live=`).
- **No new environment variable or secret** on Vercel, Cloud Run or GitHub.
- **No notification, push or e-mail** about courses, lessons or lives (PR-6): the notifications
  module is unchanged by this phase.

### Order: migrations, then the API and the worker, then the web

1. **Migrations first, 08.3's, 08.4's and 08.5's together.** Production still lacks Phase 8's
   migrations ("Phase 8 release"), and every release from 08.2 on is still pending, so the chain is
   cumulative. `supabase migration list --linked` must list as pending only the earlier releases'
   files that have not shipped yet (08.2's, 08.3's six, 08.4's three) and these six. Anything else
   means stop and ask. Run the 08.4 rehearsal first (`bash scripts/rehearse-course-links-migration.sh`
   must print `rehearsal: PASS`). Then run `supabase db push --linked --include-roles --include-all`,
   by hand, with the brew CLI and the token exported in the shell only. This is the exception of
   "Phase 8 release" step 1: `deploy-api.yml` pushes without `--include-all`, and its `checks` job has
   never finished inside its time limit. Never use any other developer-machine push.
   **Why the running API keeps working** (EP-46). All six files are expand-only:
   - the new columns have a default or are nullable (`course_lesson_materials.deleted_at`);
   - the index and the eight functions are new (the WR-01/WR-03 file only re-creates three of
     them in place, same signatures);
   - the asset seam's stub answers `false`;
   - the policy change only narrows the progress writes, which no older API makes.

   An 08.4 API (or the older revision production really serves) never calls a new function. Its
   lesson inserts take the column's default.
   **Why the API must not go first.** The new media service calls `app.course_asset_hidden` on EVERY
   playback credential and EVERY `/original`, for every tenant, whether `courses` is on or not. An
   08.5 API in front of a database without that function would fail every video playback and every
   attachment download (T-08.5-35). The 08.3 release's "only `/v1/courses` breaks" does not hold here.
2. **The API, then the worker**, as in "Phase 8 release" step 3.
3. **The web last.** Vercel builds it from the same push.
   **The window between steps 2 and 3.** The store's product detail and purchase answer are strict
   on both sides: the 08.5 API always sends `unlockedCourses` / `unlockedLives` and `courses` /
   `lives`, which an older web refuses, and the 08.5 web requires them. In practice the 08.2 store
   ships in this same push, so no production tenant has a store to break yet. If the store has
   already shipped by the time this release goes out, its product page and purchase dialog fail for
   tenants with `store` on until the web is live. Close the window by releasing the web right after
   the API. The bootstrap is not strict (it strips unknown keys), so an older web shell keeps working:
   with `courses` on it would draw Cursos beside Reels, and no production tenant has `courses` on.
4. **Check the API is serving:**
   `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/courses/learn/courses`
   prints `401` (the route exists and asks for a Bearer before the module check). `404` means the
   08.5 revision is not serving.

### Turning it on

Nothing new: `courses` is still OFF for every tenant until a `super_admin` turns it on ("Phase 08.3
release", Turning it on). With it on, members get the Cursos tab and the whole school at once.
Without `store`, every published course and live is open to every member (D-405). With `store` on, a
course or live linked to a product is locked for whoever does not hold that product. Lessons marked
"Aula aberta" stay open, and staff are never locked.

### Smoke checks (member, on the homolog host once it serves this release)

Use a test tenant with `courses` and `store` on, one published course linked to a product with an
"Aula aberta" lesson and two paid lessons (the second with "Exige concluir a aula anterior"), and a live
linked to a product. Sign in as a member who does not hold the product:
- `/cursos` opens on the Cursos tab and Reels sits in the TopBar. The course card reads "Exclusivo".
- The course page lists every module and lesson title, with a padlock on the paid lessons, and offers
  the buy action and "Assistir à aula aberta".
- The free lesson plays, and "Marcar como concluída" completes it.
- A paid lesson opens the lock page, not the player. Its video id, replayed through
  `GET /v1/media/{id}/playback` with the member's token, answers 404.
- The live page shows the room link only from 15 minutes before the start until the end.
- After a purchase (or an admin grant), the first paid lesson plays. Completing it unlocks the
  second; before that, the second reads "Aula ainda bloqueada".

Remember that hml shares production's database ("Temporary: hml shares production's Supabase, Mux
and Resend"): this release must not reach the `homolog` branch before step 1 has run.

### Rollback limit

Roll back the web first, then the API, to an 08.4 revision (never to an 08.3 one, see "Phase 08.4
release", Rollback limit). The migrations stay. An 08.4 API never calls the member functions or the
asset seam, and the column default and the narrower progress policy change nothing it does. If a
tenant had `courses` on, members lose the school with the web rollback; their progress rows stay
and come back with the roll forward.

### Manual UAT (hosted)

Record each line in the 08.5 UAT (`/gsd-verify-work 08.5`). A line that is not run stays
`blocked — not run`. These are the VALIDATION "Manual-Only" rows:
- With the real Mux provider, a lesson resumes at the saved position after a reload, and watching
  past 90% completes it and unlocks the next lesson.
- On a real phone, the live page's join link appears inside the window and opens the room in a new
  tab.
- The member screens (catalogue, course page, player, lock pages, live page, product page) on a
  320 px and a 390 px phone, in light and dark, under the tenant's brand.

## Phase 08.6 release (member area)

**Every step below is run by the developer, by hand, in this order.** No plan has run any of them:
production is live, and auto mode blocks Claude from touching it. No command here prints a secret.
This release turns the member's school into an area: the Cursos tab opens Início (the hero, "Meus
cursos", "Sua trilha", the next live with its reminder, "Novas aulas da semana", "Explore por
categoria" and the study streak), and `/cursos` gets five chips (Início | Cursos | Trilhas | Lives |
Progresso). Members can turn on a live's reminder, and the school's publications reach the bell and
Web Push as six new notification kinds. The admin can reactivate a cancelled live. It ships together
with the Phase 08.3, 08.4 and 08.5 releases above, which have never reached production either.

### What ships

- **Six migrations, all expand-only, applied in timestamp order** (COURSE-52; the order
  `ls supabase/migrations` prints):
  1. `20261016171034_courses_member_area_functions.sql` (hand-written): `app.course_member_lessons()`
     (one row per live lesson of every published course of the caller's tenant, through the 08.5
     evaluator, with the caller's own completion, titles only) and `app.course_member_streak()`
     (consecutive local dates with a completion in `tenants.timezone`, anchored on today or
     yesterday; 0 for the `admin_tenant` claim).
  2. `20261016171547_courses_member_area.sql` (generated, create-only): the own-row table
     `course_live_reminders` (one row per membership and live), its index and three policies (select
     and delete own; insert own, refusing the `admin_tenant` claim and a locked live). No update
     policy.
  3. `20261016181946_courses_live_reminder_functions.sql` (hand-written):
     `app.course_live_reminder_user_ids(uuid, boolean)`, the opted-in live memberships of the caller's
     tenant (with or without the access re-check).
  4. `20261016184619_courses_live_notice_functions.sql` (hand-written): `app.course_notice_user_ids()`
     (every live member and support membership, the shop-window audience) and
     `app.live_replay_audience_user_ids(uuid)` (those who open the live door or the course door).
  5. `20261016190702_courses_notice_columns.sql` (generated): the nullable
     `course_lessons.announced_at` and `courses.published_notified_at`.
  6. `20261016190717_courses_course_notice_functions.sql` (hand-written): the idempotent backfill
     `announced_at = created_at` (so the first lessons batch never announces the back catalogue),
     `app.course_audience_user_ids(uuid)` (members and support for whom the course is open) and
     `app.course_lessons_claim_batch(uuid)` (the announcement watermark claim). It sorts after file 5,
     whose column it backfills and reads.

  Every function is `security definer set search_path = ''`, pinned to `app.tenant_id()`, EXECUTE to
  `authenticated` only. The "Phase 8 release" step 1 grep
  (`drop (table|column)|rename|set not null|alter column .* type`) prints nothing for these six
  files. `published_notified_at` stays NULL for existing courses, and a course that is already
  published makes no transition, so the deploy itself sends no notice.
- **The API and the worker** (same image, `ROLE=worker`):
  - the member reads `GET /v1/courses/learn/overview` (Início), `GET /v1/courses/learn/tracks`
    (Trilhas) and `GET /v1/courses/learn/progress` (Meu progresso), behind `requireAuth` and
    `requireModule('courses')` only, `Cache-Control: no-store`. The streak and every number are
    computed on the server, never accepted from the client;
  - the reminder `GET|PUT|DELETE /v1/courses/learn/lives/{liveId}/reminder` (`403 live_locked` for a
    locked live, `409 reminder_closed` for a cancelled or started live; the admin preview answers 204
    and writes nothing);
  - the admin routes `POST /v1/courses/lives/{liveId}/reactivate` (`courses.manage`; `409
    live_not_reactivatable` when the live is not cancelled or its start has passed) and
    `GET /v1/courses/lives/{liveId}/reactivation` (`{ reactivatable }`, decided by the database
    clock);
  - **two new pg-boss queues, worked by the worker**: `courses.live_reminder` (one deferred job per
    live and start, fired 15 minutes before the start, re-checked at fire time) and
    `courses.lessons_batch` (one deferred job per course, 30 minutes after the first new lesson of a
    published course, one grouped notice per batch);
  - **six notification kinds**, delivered in-app and by Web Push through the Phase 7 fan-out (which
    the worker also runs), each with its audience:

    | Kind | When | Who receives it |
    |---|---|---|
    | `courses.course_published` | a course goes `draft → published` (once per 24 h) | every member and support agent, with or without access (shop window); the admin who published is excluded |
    | `courses.lessons_added` | lessons added to a published course, grouped per 30-minute batch | members and support agents for whom the course is open |
    | `courses.live_scheduled` | a live is created with its start ahead, or reactivated ("Live reativada") | every member and support agent (shop window); the admin is excluded |
    | `courses.live_reminder` | 15 minutes before a live's start | members who turned the reminder on and can still open the live |
    | `courses.live_cancelled` | the first cancel of a live | members who turned the reminder on |
    | `courses.replay_available` | a replay lesson is set on a live that ended | those who can open the live or the replay lesson's course |

    Unpublishing or archiving a course retracts its course and lessons notices (keep-and-mark, the
    bell shows "Este conteúdo foi removido."). No notice names the streak.
- **The web:** the five-tab member area (Início, Cursos, Trilhas, Lives, Progresso; bare `/cursos`
  now means Início and the catalogue is `?aba=cursos`); the reminder toggle ("Ativar lembrete" /
  "Lembrete ativado") on Início's next-live card and on the live page before its window, disabled in
  "Ver como aluno"; the six bell rows with their glyphs and deep links; "Reativar live" in the
  cancelled state of the admin live form; the cancel dialog now says who is notified.
- **No new environment variable or secret** on Vercel, Cloud Run or GitHub. Web Push uses the Phase 7
  VAPID keys.

### Order: migrations, then the API and the worker together, then the web

1. **Migrations first, cumulative.** Production still lacks Phase 8's migrations ("Phase 8
   release"), and every release from 08.2 on is still pending. `supabase migration list --linked`
   must list as pending only the earlier releases' files that have not shipped yet (Phase 8's,
   08.2's, 08.3's six, 08.4's three, 08.5's seven) and these six. Anything else means stop and ask.
   Run the 08.4 rehearsal first (`bash scripts/rehearse-course-links-migration.sh` must print
   `rehearsal: PASS`). Then run `supabase db push --linked --include-roles --include-all`, by hand,
   with the brew CLI and the token exported in the shell only (the exception of "Phase 8 release"
   step 1: `deploy-api.yml` pushes without `--include-all`). Never use any other developer-machine
   push.
   **Why the running API keeps working.** All six files are expand-only: one new table, two nullable
   columns, seven new functions and a backfill of a column no older API reads. An 08.5 API (or the
   older revision production really serves) never calls a new function or touches the new table.
   **Why the API must not go first.** An 08.6 API in front of a database without these files fails
   Início (`app.course_member_lessons`), the reminder routes (`course_live_reminders`), every course
   publish and lesson create (`published_notified_at`, `announced_at`), and every live create,
   cancel and replay notice.
2. **The API and the worker together**, as in "Phase 8 release" step 3. The worker must ship in the
   same step: it works `courses.live_reminder` and `courses.lessons_batch`. The API creates the queues
   lazily and arms the jobs, but until the 08.6 worker serves, no reminder fires and no lessons batch
   runs (the jobs wait; a reminder that wakes more than 10 minutes late skips itself as `late`).
3. **The web last.** Vercel builds it from the same push.
   **The window between steps 2 and 3.** The older web keeps working against the 08.6 API: no read it
   makes changed shape. The six new kinds render as the bell's generic row (its
   `genericNotificationRenderer`) until the web ships. Close the window by releasing the web right after the API.
4. **Check the API is serving:**
   `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/courses/learn/overview`
   prints `401` (the route exists and asks for a Bearer before the module check). `404` means the
   08.6 revision is not serving.

### Turning it on

Nothing new: `courses` is still OFF for every tenant until a `super_admin` turns it on ("Phase 08.3
release", Turning it on). The notices also need the tenant's `notifications` module on (Phase 7);
push reaches only devices where the member enabled it.

### Smoke checks (member, on the homolog host once it serves this release)

Use a test tenant with `courses`, `store` and `notifications` on, one published course and a live
whose start is about an hour ahead. Sign in as a member:
- `/cursos` lands on Início (the five chips, the hero, "Bem-vindo de volta."); `?aba=cursos` is the
  catalogue.
- Turning on the live's reminder shows "Lembrete ativado"; the database holds one waiting
  `courses.live_reminder` job for the live
  (`select count(*) from pgboss.job where name = 'courses.live_reminder' and state = 'created'`).
- As the admin, publishing a draft course writes one `courses.course_published` notification per
  member and support agent, none for the admin
  (`select count(*) from notifications where kind = 'courses.course_published'`), and the member's
  bell shows "Novo curso: …".
- As the admin, cancel the live, then reactivate it from its form ("Reativar live"): the member gets
  "Live cancelada", then "Live reativada".

Remember that hml shares production's database ("Temporary: hml shares production's Supabase, Mux
and Resend"): this release must not reach the `homolog` branch before step 1 has run.

**Deferred to homolog (real device).** Phones cannot reach `*.localhost`, so real Web Push was never
checked locally. On homolog after the deploy: install the PWA on a phone, enable push, turn on the
reminder of a live starting in about 20 minutes and publish a course; both pushes arrive and open the
right `/cursos/...` page. Record it in the 08.6 UAT; until it is run it stays `blocked — not run`.

### Rollback limit

Roll back the web first, then the API and the worker, to an 08.5 revision (never to an 08.3 one, see
"Phase 08.4 release", Rollback limit). The migrations stay: an 08.5 API never reads the new table,
columns or functions. **Never keep the 08.6 web in front of an 08.5 API:** bare `/cursos` links now
mean Início, which reads `GET /v1/courses/learn/overview`, a route an 08.5 API does not have. Waiting
reminder and lessons-batch jobs left in the queue are harmless to an 08.5 worker, which does not work
those queues; they simply wait. Opt-ins stay; after the roll forward a reminder whose fire time
passed more than 10 minutes earlier skips itself as `late`, and the next opt-in or start change arms
a fresh one.

### Manual UAT (hosted)

Record each line in the 08.6 UAT (`/gsd-verify-work 08.6`). A line that is not run stays
`blocked — not run`. These are the VALIDATION "Manual-Only" rows:
- The live reminder and the new-content Web Push arrive on a real phone with the installed PWA, and
  open the right page (above).
- Início, Trilhas and Progresso on a 320 px and a 390 px phone, in light and dark, under the tenant's
  brand, match the UI-SPEC and sketch 011.

## Phase 08.7 release (real profile data)

**Every step below is run by the developer, by hand, in this order.** No plan has run any of them:
production is live, and auto mode blocks Claude from touching it. No command here prints a secret.
This release replaces the sample numbers of `/perfil` with the tenant's own: the admin's owner panel
(Visão geral, Membros, Conteúdo, Eventos, Financeiro, Atendimento) and the member's "Sua atividade"
read a snapshot the worker builds once a day per tenant, after the tenant's local midnight (D-464).
Every number the app cannot measure yet reads "Em breve" (D-455..D-458), and no runtime path draws a
fixture value any more (D-459). It ships together with the Phase 08.3, 08.4, 08.5 and 08.6 releases
above, which have never reached production either.

### What ships

- **Eleven migrations, all expand-only, applied in timestamp order** (INSIGHT-19, EP-64; the order
  `ls supabase/migrations` prints):
  1. `20261018215328_dashboard_snapshots.sql` (generated): the tables `dashboard_snapshots` (one row
     per tenant and local day, readable by the tenant's `admin_tenant` only) and
     `dashboard_member_snapshots` (one row per membership, latest build only, readable by the member
     and the tenant's `admin_tenant`), their indexes and their two select policies. No write policy,
     and the lane roles lose the insert/update/delete/truncate grants.
  2. `20261018215342_dashboard_functions.sql` (hand-written): `app.dashboard_build_snapshot(date)`
     (the builder; it runs only for the zero user of the system lane and refuses a day that is not
     complete yet) and `app.dashboard_area_overview(date)`.
  3. `20261018222400_feed_dashboard_indexes.sql` (generated): `feed_comments_tenant_created_idx` and
     `feed_likes_tenant_created_idx`.
  4. `20261018222405_dashboard_members_functions.sql` (hand-written):
     `app.dashboard_member_actions(date, date)` (the counted-action stream),
     `app.dashboard_member_rows(date)` and `app.dashboard_area_members(date)`.
  5. `20261018225848_dashboard_activity_functions.sql` (hand-written):
     `app.dashboard_member_activity(date)` (the member's own "Sua atividade" numbers).
  6. `20261019003131_dashboard_content_functions.sql` (hand-written): `app.dashboard_area_content(date)`.
  7. `20261019014815_dashboard_events_functions.sql` (hand-written): `app.dashboard_area_events(date)`.
  8. `20261019022113_store_dashboard_indexes.sql` (generated): `store_orders_tenant_paid_idx`.
  9. `20261019022117_dashboard_finance_functions.sql` (hand-written): `app.dashboard_area_finance(date)`.
  10. `20261019032741_dashboard_support_functions.sql` (hand-written): `app.dashboard_area_support(date)`.
  11. `20261019035403_dashboard_overview_functions.sql` (hand-written): the final builder (payload
      version 8), the final `app.dashboard_area_overview(date)` and `app.dashboard_snapshots_prune(int)`
      (the retention sweep: tenant rows older than 8 days before their tenant's local today, at most
      500 per call, executable by `service_role` only).

  Every `app.dashboard_*` function but the prune is `security definer set search_path = ''` and
  pinned to `app.tenant_id()`. The area and member functions are executable by no role; the builder
  is executable by `authenticated` but refuses every caller but the zero user of the worker's system
  lane (T-08.7-03), so a request can never trigger a build. The "Phase 8 release" step 1 grep
  (`drop (table|column)|rename|set not null|alter column .* type`) prints nothing for these eleven
  files. The three indexes are plain `create index` on `feed_comments`, `feed_likes` and
  `store_orders`: at the pilot's size each takes well under a second, during which writes to that
  table wait. The snapshot payloads hold ids and numbers only: no name, caption, comment text or
  message text is ever stored (PR-1); labels are joined live when the panel reads.
- **The API and the worker** (same image, `ROLE=worker`):
  - the owner reads under `/v1/dashboard/owner/*`: `overview`, `members`, `members/bands/{band}`,
    `members/{membershipId}`, `members/{membershipId}/lists/{list}`, `content`,
    `content/interactions`, `content/unanswered`, `content/items/{itemId}`,
    `content/items/{itemId}/people/{who}`, `events`, `finance`, `finance/products/{productId}`,
    `finance/buyers/{list}` and `support`. Every one is `GET`, behind `requireAuth`, the area's
    `requireModule` (`events`, `store`, `chat`) and `requireRole('admin_tenant')` (D-462: a member or
    a `support_tenant` gets 403, an id of another tenant a bare 404), `Cache-Control: no-store`. Every
    group under 5 people or orders leaves the server as "menos de 5" with no number (the floor);
  - the member read `GET /v1/dashboard/activity` (`requireRole('member')`, no user-id parameter: the
    caller's own row only, D-463);
  - **two new pg-boss queues, worked by the worker**: `kernel.daily-tenant-dispatch` (the kernel's
    once-a-day-per-tenant dispatcher: every hour it enqueues each active tenant's local yesterday,
    then re-arms itself) and `dashboard.snapshot-build` (one build per tenant and day, concurrency 1,
    a 120 s statement timeout, skipped when that day is already built at the current payload version);
  - **the sweep function `dashboard_snapshots_prune`**, run by the kernel's hourly sweeper
    (`kernel.media-sweep-orphans`) in the admin lane.
- **The web:** both panels on real data with the freshness line ("Números até ontem · atualizados
  hoje às …"), the preparing card until a snapshot exists, "Em breve" on every unmeasured card or
  line, "menos de 5" under the floor, and the areas gated by the tenant's modules (Eventos needs
  `events`, Financeiro `store`, Atendimento `chat`; a hidden `?area=` renders Visão geral, D-460).
  "Ver todos", "Responder" and the member and post links open the screens that exist; "Enviar push" to
  a group and "Recuperar quem está em risco" stay disabled with the "Em breve" pill (D-461).
- **No new environment variable or secret** on Vercel, Cloud Run or GitHub.

### Order: migrations, then the API and the worker together, then the web

1. **Migrations first, cumulative.** Production still lacks Phase 8's migrations ("Phase 8
   release"), and every release from 08.2 on is still pending. `supabase migration list --linked`
   must list as pending only the earlier releases' files that have not shipped yet (Phase 8's,
   08.2's, 08.3's six, 08.4's three, 08.5's seven, 08.6's six) and these eleven. Anything else means
   stop and ask. Run the 08.4 rehearsal first (`bash scripts/rehearse-course-links-migration.sh` must
   print `rehearsal: PASS`). Then run `supabase db push --linked --include-roles --include-all`, by
   hand, with the brew CLI and the token exported in the shell only (the exception of "Phase 8
   release" step 1: `deploy-api.yml` pushes without `--include-all`). Never use any other
   developer-machine push.
   **Why the running API keeps working.** All eleven files are expand-only: two new tables, three new
   indexes and new functions. An 08.6 API (or the older revision production really serves) never
   reads the new tables or calls a new function.
   **Why the API and the worker must not go first.** An 08.7 API in front of a database without
   these files answers every `/v1/dashboard/*` read with an error (`dashboard_snapshots` does not
   exist), and an 08.7 worker's first dispatch fails every build (`app.dashboard_build_snapshot`).
2. **The API and the worker together**, as in "Phase 8 release" step 3. The worker must ship in the
   same step: it works `kernel.daily-tenant-dispatch` and `dashboard.snapshot-build`, and **its first
   boot dispatches every active tenant at once** (a separate boot singleton), so every tenant's
   snapshot for yesterday is built within minutes, one tenant after another. Until a tenant's snapshot
   exists its panels show the preparing card ("Seus números estão sendo preparados" for the admin,
   "Sua atividade está sendo preparada" for the member), never a sample. The hourly re-arm then keeps
   the cadence: each tenant is rebuilt once after its local midnight.
3. **The web last.** Vercel builds it from the same push.
   **The window between steps 2 and 3.** The older web keeps drawing the sample panels; it calls none
   of the new routes. Close the window by releasing the web right after the API.
4. **Check the API is serving:**
   `curl -s -o /dev/null -w '%{http_code}' https://api-253040968821.southamerica-east1.run.app/v1/dashboard/owner/overview`
   prints `401` (the route exists and asks for a Bearer). `404` means the 08.7 revision is not
   serving.
5. **Check the first builds ran** (a few minutes after the worker revision serves, read-only, in the
   SQL editor): `select count(*), max(built_at) from dashboard_snapshots` counts one row per active
   tenant, and `select state, count(*) from pgboss.job where name = 'dashboard.snapshot-build' group
   by state` shows `completed` rows and no `failed` ones.

### Turning it on

Nothing to turn on: the panels are not a tenant module. The owner panel stays visible to
`admin_tenant` only and "Sua atividade" to `member` only, as before. Each area follows the tenant's
existing module flags (D-460).

### Smoke checks (on the homolog host once it serves this release)

- As a tenant's admin, `/perfil` → Visão geral shows "Números até ontem · atualizados hoje às …"
  after the first build, with real counts (the members card equals the tenant's active members).
- As a member, "Sua atividade" shows the member's own numbers with the same freshness line, and "Em
  breve" on the usage block (D-457).
- On a tenant with `store` and `chat` off, the admin sees four areas (Visão geral, Membros, Conteúdo,
  Eventos; the local lab tenant `rede-lab` is set up this way), and `?area=financeiro` renders Visão
  geral.
- `GET /v1/dashboard/owner/overview` with a member's session answers `403`.

Remember that hml shares production's database ("Temporary: hml shares production's Supabase, Mux
and Resend"): this release must not reach the `homolog` branch before step 1 has run.

### Connection budget

Two more queues on the worker, each at concurrency 1: the worker now works 14 queues
(`notifications.push-send` at 4, the other 13 at 1), so the theoretical worst case is 17 handlers in
a database phase against `DATABASE_POOL_MAX=10` (up to 7 wait briefly inside postgres.js; nothing
holds-and-waits), and 17 pg-boss pollers on the same `max: 2` session pool. The per-instance pooler
clients (6 per api, 13 per worker) and the formula in "Connection budget (Pro)" do not change. The
nightly build holds one connection for at most 120 s per tenant, one tenant at a time.

### Rollback limit

Roll back the web first, then the API and the worker, to an 08.6 revision. The migrations stay: an
08.6 API never reads the snapshot tables or calls a `dashboard_*` function, and the snapshot rows are
harmless (the prune stops with the 08.7 worker; they stay until the next roll forward prunes them).
**Never keep the 08.7 web in front of an 08.6 API:** every panel would read a route the older API
does not have and show its error card. Dispatch and build jobs left in the queue are harmless to an
08.6 worker, which does not work those queues; after the roll forward the boot dispatch rebuilds
every tenant.

### Manual UAT (hosted)

Record each line in the 08.7 UAT (`/gsd-verify-work 08.7`). A line that is not run stays
`blocked — not run`. These are the VALIDATION "Manual-Only" rows:
- The panels read correctly with "Em breve", the preparing card and the freshness line on a real
  tenant after one nightly build, as a member and as an admin, against the UI-SPEC.
- The privacy policy item of the "Production gate (D-12)" go-live list (D-462).

## Event schedule (quick 261007-n1g)

The event "Cronograma" (the programme typed in step 2 of the event form) moves out of the event
description into its own column, `events.schedule`. **Nothing here was applied anywhere but the
local stack** by the change that introduced it: the developer applies it with the usual push
("Phase 8 release", step 1), by hand.

What ships:
- One expand-only migration, `*_event_schedule.sql`: `alter table events add column schedule jsonb
  not null default '[]'` plus the CHECK `events_schedule_chk` (an array of at most 30 items, each with
  a day 1..31, a time `HH:MM` and a title of 1..80 characters). Every existing row takes the default,
  so the CHECK holds for all of them and the API revision still serving during `supabase db push`
  ignores the new column.
- The events routes accept `schedule` on create and edit and return it on the event detail and on the
  edit read (never on the list or on the write answers). The web form sends it as its own field and no
  longer writes the "Programação" lines into the description.

**Release order: migration, then web, then API.** The same reasoning as the Phase 8 release (read
"Why this order inverts Phase 7's API-first rule" above, it is not repeated here): the web parses every
API answer with strict schemas, and the new web declares the new response field `schedule`
`.optional()`, so it reads the OLD API's answers unchanged. The reverse order would put a key on the
event detail that an OLD web refuses. The migration goes first because both later steps assume the
column exists.

**What happens in the window between the web and the API releases.** The new web sends `schedule` ONLY
when the form has moments, so every save without a schedule keeps working against the old API. A save
WITH a schedule is refused by the old API with a 400 (its strict input schema does not know the key):
the form shows its generic save error and nothing is lost silently, because the old description path
is deliberately not kept. Close the window by releasing the API right after the web. A stale
installed PWA that still runs the pre-release form would, after the API release, save an event
WITHOUT the key, and the whole-event `PUT` clears a schedule that is absent: reload the app once after
the web release.

**hml shares production's database**, so one apply of the migration reaches both. Events written
before this change keep their schedule as text in the description: the web still reads that format when
the column is empty, and the first save of such an event from the form moves it into the column. There
is no bulk data migration.

**Rollback.** Revert the web and the API; the column stays and is ignored (an expand migration is
never rolled back). Events saved with the new web keep their schedule in the column, and an older web
would not show it.

**One read-only check after the migration** (a tenant is the organisation; nothing is tenant-specific
here):

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'events' and column_name = 'schedule';
-- expected: schedule | jsonb | NO | '[]'::jsonb
```

## Content Security Policy (Phase 8)

**What it is (08-08, D-346).** Every response the web app returns carries a per-request nonce
Content Security Policy. `apps/web/lib/csp.ts` builds it (`cspFor`) and `apps/web/proxy.ts` sets it,
with the nonce in `x-nonce`, on the forwarded request headers (Next reads the nonce there and stamps
it on its own scripts) and on EVERY response the proxy returns: the session-refresh rebuild, the
`/cadastro` rewrite, the 307/308 redirects and the service worker script (whose policy becomes the
worker's own). The policy:

| Directive | Value |
|---|---|
| `script-src` | `'self' 'nonce-…' 'strict-dynamic'` (`'unsafe-eval'` only under `next dev`) |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com`, deliberately with NO nonce (a nonce would disable every SSR `style=` attribute); Google's host is the tenant title font's stylesheet |
| `img-src` / `media-src` | `'self' data:`/`blob:`, the Supabase origin, `https://*.mux.com` (+ `https://*.litix.io` for images) |
| `connect-src` | `'self'`, the Supabase origin and its `wss:` twin (Realtime), `https://*.mux.com`, `https://*.litix.io`, `https://storage.googleapis.com` (Mux direct upload), `https://fonts.googleapis.com https://fonts.gstatic.com` (the title font as fetched by the service worker, whose policy is this same header) |
| `frame-src` | `https://www.youtube-nocookie.com https://player.vimeo.com` (the click-to-play players), `https://maps.google.com/maps https://www.google.com/maps/embed` (the event page's keyless map embed, which 301s from the first to the second) |
| others | `default-src 'self'`, `worker-src 'self' blob:`, `font-src 'self' https://fonts.gstatic.com` (the title font's files), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `report-uri /api/csp-report`, and `upgrade-insecure-requests` only on https requests |

The Supabase origins come from `NEXT_PUBLIC_SUPABASE_URL`, so production and hml need no extra
list. Adding a third-party host anywhere in the app means adding it in `cspFor` too, or it is
blocked once the policy enforces.

**The switch.** `CSP_MODE` (Vercel, server-only): `report-only` (the default when unset) sends
`Content-Security-Policy-Report-Only`, which blocks nothing and only reports; `enforce` sends
`Content-Security-Policy`. Every local and CI e2e run enforces (`apps/web/playwright.config.ts`),
and `apps/web/e2e/csp.spec.ts` walks every surface with a violation collector, so the policy is
proven before production ever enforces it.

**Rollout, run by the developer by hand:**

1. With the Phase 8 web deploy, set `CSP_MODE=report-only` on the production Vercel project
   (`vercel env add CSP_MODE production`, value `report-only`; leaving it unset is the same) and
   redeploy. Nothing can break: report-only blocks nothing.
2. Use the app on real devices (the 08-12 real-device pass: iPhone and Android, member and admin,
   the inline YouTube and Vimeo players, a video, an upload, chat, push) and read the violations.
   Every report becomes one `csp.violation` line in the Vercel function logs with only the
   effective directive, the blocked HOST (or `inline`/`eval`) and the document path:
   `vercel logs --project prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa --environment production --no-branch --json --no-follow`
   and filter the output for `csp.violation`. Browser extensions also report (their own hosts or
   `chrome-extension`); those are noise, not app defects.
3. Only when the real-device pass shows **zero** app violations, set `CSP_MODE=enforce` on
   production and redeploy. Repeat the smallest smoke (sign in, feed, a video, tap an inline player,
   open Suporte) on one phone after the flip.
4. **Rollback:** set `CSP_MODE=report-only` and redeploy. No code change, no migration, nothing to
   undo in the database.

The hml project follows the same steps with its own `CSP_MODE` (unset there means report-only).

**CORS: the API answers no browser.** `API_URL` is server-only and the web app is a BFF: the
browser never calls Cloud Run, so the API mounts no CORS middleware at all, and
`apps/api/tests/unit/cors.test.ts` fails the moment any `Access-Control-Allow-*` header appears on a
preflight or a simple request. The rule for any FUTURE browser-facing API route: allow only the
production origins (the platform host and the verified tenant domains), never `*`, never a
reflected `Origin`, and never with credentials for an origin outside that list.

## Production gate (D-12)

Three conditions must hold **on the same `master` SHA** before a single production migration runs:

1. `checks` — `deploy-api.yml` calls `./.github/workflows/ci.yml` as a job (`workflow_call`), so the
   lint (+ UI literal guard), typecheck/build/unit, build-output gate, boundary, lane-guard, pgTAP,
   integration, spike, the e2e specs the push affects (all of them when the change is shared or
   unmapped) and PWA e2e steps all pass for that exact commit, not for an earlier one.
2. `build` — the image for that SHA is in Artifact Registry.
3. `production` — one required reviewer approves the GitHub Environment (configured in 01-10).

`migrate-and-deploy-prod` declares `needs: [checks, build]`, so a **direct push to `master` by an
admin goes through the same `checks` job**; branch protection is a convenience, not the gate. Inside
the job the order is fixed: migrations → API → worker. `concurrency: deploy-<ref>` with
`cancel-in-progress: false` means two pushes queue instead of migrating in parallel.

If the GitHub plan blocks protected environments on a private repository (RESEARCH §Pitfall 5), use
the commented `workflow_dispatch` fallback in `deploy-api.yml`: the manual dispatch *is* the
approval, `needs: [checks, build]` stays. Not needed: the repository is public and `production` has
a required reviewer (Decisions 2026-09-28).

### Before the pilot go-live

Items that are not code and no CI job checks; each must be true before the pilot tenant's members are
invited:

- [ ] **The privacy policy describes the owner panel (D-462, Phase 08.7).** The tenant's privacy
  policy tells members that the tenant's admin (`admin_tenant`) sees each member's individual
  activity on the owner panel: the member's engagement band, their 30-day numbers, who liked or
  commented on a publication, a member's events and purchases, who bought and how much, and the text
  of comments waiting for an answer. It also states the "menos de 5" rule: every group of fewer than
  5 people or orders is shown without its number. The legal text is the tenant operator's (LGPD
  review, STATE blockers); support staff and other members never see this detail.

**Production is never a promoted preview.** `NEXT_PUBLIC_*` values are inlined at build time, so a
Preview build carries the Preview environment's values forever; promoting it would ship them to
production users. Production is always a fresh build of `master`.

## Runbook

**Production is paused (Supabase Free plan).** Free projects pause after a week of inactivity.
There is no keepalive workflow for production (the staging one was removed with staging); restore
it in the Supabase dashboard (`rede-social` → Restore).

**Rotate the `api_user` password.** Change `API_DB_PASSWORD` in the environment secrets, update the
matching `api-database-url-*` / `worker-database-url-*` Secret Manager versions, then re-run the
deploy workflow: the `alter role api_user with login password` step and the new secret version land
together. Never edit the role by hand in the dashboard without updating the secrets.

**Never seed production.** Production holds only the super_admin, created by hand on 2026-09-28
(Decisions 2026-09-28). `pnpm db:seed` creates the demo tenants and must never run against it;
tenants are created from the platform panel. Homolog may hold demo tenants, seeded by hand per the
"hml provisioning runbook".

**Roll back an API release.** `gcloud run services update-traffic api --to-revisions=<previous>=100
--region=southamerica-east1`. Migrations are not rolled back — write forward-compatible migrations.

**Migrations never run from a developer machine.** `supabase db push` against a remote project is a
workflow step only; locally use `pnpm db:reset`. The single exception is the one-time bootstrap of
2026-09-28 (the first `supabase db push --include-roles` and the `api_user` password, see
Decisions); every later migration goes through `deploy-api.yml` (production) or `deploy-hml.yml`
(homolog).

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
