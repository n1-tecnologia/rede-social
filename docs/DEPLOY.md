# Deploy contract

Everything the pipeline reads, by name, per environment. Plans 01-10 (GitHub + Vercel) and 01-11
(Supabase + GCP) create exactly what is listed here — nothing more, nothing less. If a name is not in
this file, no workflow reads it.

Pipeline files: `.github/workflows/ci.yml`, `deploy-api.yml`, `apps/web/vercel.json`,
`apps/api/Dockerfile`, `scripts/check-static-routes.sh` (build-output gate, Phase 2).

## Decisions (2026-09-28)

These deviate from the Phase 01.1 roadmap text (two Supabase projects, staging on every pull
request, the old `main` default branch) and supersede the staging parts of D-11/D-15; the roadmap
itself is not edited here.

- **Production only, no staging.** No staging Supabase project, no `api-staging`/`worker-staging`
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

| | Local | Production |
|---|---|---|
| Trigger | `supabase start` + `pnpm dev` | push to `master` (after the `production` approval) |
| Web | `localhost:3000` | Vercel **Production** (`rede-social-woad.vercel.app`) |
| API | `localhost:8787` | Cloud Run `api` |
| Worker | same process (`ROLE=worker`) | Cloud Run `worker` |
| Database | Supabase CLI stack | Supabase `rede-social` (`qjjhtduxquvlfppybpqq`) |
| Seed | `pnpm db:seed` | none: super_admin only, created once by hand (Decisions 2026-09-28), never `pnpm db:seed` |
| GCP region | — | `southamerica-east1` |
| Supabase region | — | `sa-east-1` |

Pull requests run `ci.yml` only and get a Vercel Preview; there is no staging environment
(Decisions 2026-09-28).

One Artifact Registry repository, `rede-social`, in `southamerica-east1`; the image is
`southamerica-east1-docker.pkg.dev/<GCP_PROJECT_ID>/rede-social/api:<sha>` and serves both Cloud Run
services (`ROLE=api` / `ROLE=worker`, D-18).

## GitHub repository variables (not secret)

| Name | Example | Read by |
|---|---|---|
| `WIF_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/github/providers/repo` | `deploy-api.yml` (`google-github-actions/auth@v3`) |
| `DEPLOY_SA` | `rede-social-deploy@<project>.iam.gserviceaccount.com` | `deploy-api.yml` (the identity Actions impersonates) |
| `RUNTIME_SA` | `rede-social-runtime@<project>.iam.gserviceaccount.com` | `deploy-api.yml` — passed as `--service-account=` on **every** `deploy-cloudrun@v3` step. This is the account Cloud Run *runs as*; it holds `roles/secretmanager.secretAccessor`, so without it the mounted Secret Manager values are unreadable and the service crashes on boot. Created in 01-11. |
| `GCP_PROJECT_ID` | `rede-social-471200` | `deploy-api.yml` (image reference) |

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

`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `SEED_PASSWORD`, `SUPER_ADMIN_EMAIL` and
`SUPER_ADMIN_PASSWORD` were read only by the removed seed steps; the super_admin was created by hand
(Decisions 2026-09-28).

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

`DATABASE_URL` is always the **`api_user`** connection through the Supavisor **transaction** pooler
(port 6543); `BOSS_DATABASE_URL` is the same role through the **session** pooler (port 5432) because
pg-boss holds long-lived listeners. Never the `postgres` role, never the service-role key, for tenant
traffic. See `packages/core/db/README.md` for the URL shapes and the session-mode fallback.

## Vercel environment variables (web)

Root Directory `apps/web`; Build Command `turbo build`; Ignored Build Step
`npx turbo-ignore --fallback=HEAD^1` (committed as `apps/web/vercel.json`).

| Variable | Preview | Production |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | not provisioned (no staging project) | production project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | not provisioned (no staging project) | production publishable key |
| `API_URL` | not provisioned (no staging project) | `api` Cloud Run URL |
| `PLATFORM_HOST` | *(unset — every Preview host is a generic host, D-21)* | `rede-social-woad.vercel.app` |

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
tenants are created from the platform panel.

**Roll back an API release.** `gcloud run services update-traffic api --to-revisions=<previous>=100
--region=southamerica-east1`. Migrations are not rolled back — write forward-compatible migrations.

**Migrations never run from a developer machine.** `supabase db push` against a remote project is a
workflow step only; locally use `pnpm db:reset`. The single exception is the one-time bootstrap of
2026-09-28 (the first `supabase db push --include-roles` and the `api_user` password, see
Decisions); every later migration goes through `deploy-api.yml`.

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
