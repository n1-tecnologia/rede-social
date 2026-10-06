# Deploy contract

Everything the pipeline reads, by name, per environment. Plans 01-10 (GitHub + Vercel) and 01-11
(Supabase + GCP) create exactly what is listed here — nothing more, nothing less. If a name is not in
this file, no workflow reads it.

Pipeline files: `.github/workflows/ci.yml`, `deploy-api.yml` (production), `deploy-hml.yml`
(homolog), `apps/web/vercel.json`, `scripts/vercel-ignore.sh` (the Vercel Ignored Build Step, tested
by `scripts/vercel-ignore.test.sh`), `apps/api/Dockerfile`, `scripts/check-static-routes.sh`
(build-output gate, Phase 2).

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
- **No CI gate on hml.** `ci.yml` also runs on pushes to `homolog`, but `deploy-hml.yml` depends only
  on its own image build: the e2e stage has never finished in time to be worth waiting for. Production
  keeps its `checks` gate in `deploy-api.yml`.
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
- **Production branch is `master`** (the Vercel Git integration tracks it); `ci.yml` and
  `deploy-api.yml` trigger on it and the production job checks `refs/heads/master`.
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
After each push open every verified domain in the platform panel and press "Verificar agora" — it
re-adds the entry idempotently (Phase 8 adds a reconcile command that does this for every host).

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

## Storage buckets

The private `media` bucket (03-01) accepts `image/jpeg`, `image/png`, `image/webp`,
`application/pdf`, `video/mp4` and `video/quicktime` — exactly the union of `MEDIA_LIMITS` in
`@rede-social/contracts/media`, pinned as a set by `supabase/tests/070-media-bucket.sql`. The two video
entries exist for `VIDEO_PROVIDER=fake`, which stores its bytes there; with `VIDEO_PROVIDER=mux` the
vendor owns the object and nothing mints a Storage URL for a video at all. The bucket stays PRIVATE,
caps files at 50 MiB and carries zero `storage.objects` policies.

`[storage.buckets.branding]` in `supabase/config.toml` applies to the **local stack only**
(`supabase start`). Hosted projects get the public `branding` bucket (2 MiB cap, image MIME
allow-list) from `supabase/migrations/20260917021738_branding_bucket.sql`, applied by
`supabase db push` like every other migration — there is no dashboard step, and `supabase config
push` does **not** create buckets (02-13). Object keys are `<tenant_id>/branding/…`; the derived
icon set lives under `<tenant_id>/branding/icons/<iconVersion>/`.

## Phase 2 verification

**Local exit gate — `pnpm verify` (~15–20 min, one shot).** Runs, in this order, exactly what CI
runs (`.github/workflows/ci.yml`, single `checks` job, D-12):

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
- Worst case at once: 4 (push) + 9 (one per other queue) = **13 holders against a pool of 10**. The
  pool covers every push job plus the fan-out with 5 to spare; in the theoretical instant where every
  queue is in a database phase, up to 3 handlers wait briefly inside postgres.js for a free
  connection. That is a short wait, never starvation or deadlock, because nothing holds-and-waits.
- The pg-boss pool stays **max 2**: pg-boss never holds a connection across a handler, LISTEN/NOTIFY
  is off, and the 10 queues' 13 pollers (every 2 s) and their completes are single short queries.

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
| **Current (Small)** | 25 | 1 | 2 | 40 | 400 | 2 × (150 + 13) + 12 + 40 = **378 ≤ 400** | 150 + 13 + 12 = **175** |
| Fallback (Micro) | 10 | 1 | 2 | 20 | 200 | 2 × (60 + 13) + 12 + 20 = **178 ≤ 200** | 60 + 13 + 12 = 85 |

On Micro, `A` must drop to 10 in `deploy-api.yml` before the deploy.

**Throughput:** 25 api instances × Cloud Run's default concurrency 80 = 2,000 concurrent requests.
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
   - Push `master`. This starts three things at once:
     - the Vercel production build of the web (step 2: set `CSP_MODE` BEFORE this push);
     - the `CI` workflow (step 7);
     - `Deploy API`. Let its `build` job finish, because it pushes
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
     --max-instances=25
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
7. **One CI run that finishes.** The `CI` workflow that the step 1 push started on `master` (jobs
   `static`, `db`, `e2e` in 4 shards, `e2e-pwa`; 08-02's split) must reach a conclusion inside its
   limits. Record its URL, its conclusion and each job's duration in `08-GATE.md`. If it does not
   finish, the gate row stays open with what timed out (D-348).

**Rollback.** The API first, then the web, because an old web cannot read the new API (see above):
`gcloud run services update-traffic api --to-revisions=<previous>=100 --region=southamerica-east1`
(and the same for `worker`), then Vercel → Instant Rollback to the previous production deployment.
The migrations stay: they are expand-only, and the old code ignores the new table and column. The
orphan-reply repair is a one-way soft delete by design; the rows stay in the table.

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
| `style-src` | `'self' 'unsafe-inline'`, deliberately with NO nonce (a nonce would disable every SSR `style=` attribute) |
| `img-src` / `media-src` | `'self' data:`/`blob:`, the Supabase origin, `https://*.mux.com` (+ `https://*.litix.io` for images) |
| `connect-src` | `'self'`, the Supabase origin and its `wss:` twin (Realtime), `https://*.mux.com`, `https://*.litix.io`, `https://storage.googleapis.com` (Mux direct upload) |
| `frame-src` | `https://www.youtube-nocookie.com https://player.vimeo.com` (the click-to-play players) |
| others | `default-src 'self'`, `worker-src 'self' blob:`, `font-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `report-uri /api/csp-report`, and `upgrade-insecure-requests` only on https requests |

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
   integration, spike, e2e and PWA e2e steps all pass for that exact commit, not for an earlier one.
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
