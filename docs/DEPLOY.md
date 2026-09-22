# Deploy contract

Everything the pipeline reads, by name, per environment. Plans 01-10 (GitHub + Vercel) and 01-11
(Supabase + GCP) create exactly what is listed here — nothing more, nothing less. If a name is not in
this file, no workflow reads it.

Pipeline files: `.github/workflows/ci.yml`, `deploy-api.yml`, `seed-prod.yml`,
`keepalive-staging.yml`, `apps/web/vercel.json`, `apps/api/Dockerfile`,
`scripts/check-static-routes.sh` (build-output gate, Phase 2).

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
the kernel env defaults) — nothing here is needed to develop or test. Locally and in CI the flow
runs against `DOMAIN_PROVIDER=fake` (`apps/web/e2e/phase2-smoke.spec.ts`,
`platform-domains.spec.ts`); aliases 308 to the primary (D-35) and only verified hosts resolve
(D-36). The real-provider proof is the runbook item "Attach a real customer domain end-to-end"
below (Phase 01.1).

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

| Variable | staging | production | Source |
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

## Supabase hosted auth settings (Phase 2)

**Email OTP Expiration = 86400** (24 h) on the hosted projects — Dashboard → Authentication →
Emails, or `[remotes.<env>.auth.email] otp_expiry = 86400` in `supabase/config.toml` pushed by
`supabase config push` — so a first `admin_tenant` can open the invite link within a day of the
domain verifying (02-10). The local stack keeps `otp_expiry = 3600` (`[auth.email]`), which the
e2e suite never approaches. The Send Email Hook values (secret, transport, rotation) live in
`docs/deploy/auth-mail.md`.

## Storage buckets

The private `media` bucket (03-01) accepts `image/jpeg`, `image/png`, `image/webp`,
`application/pdf`, `video/mp4` and `video/quicktime` — exactly the union of `MEDIA_LIMITS` in
`@tria/contracts/media`, pinned as a set by `supabase/tests/070-media-bucket.sql`. The two video
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
9. `pnpm --filter @tria/web e2e:pwa` — 02-11's suite against a **production build** on :3100
   (manifest per tenant, service worker, offline fallback, `display-mode` mirror).

**Smoke only — `pnpm verify:smoke` (~10 min).** `branding.spec.ts` (criterion 1 on the seed
tenants), `phase2-smoke.spec.ts` (criteria 2 and 4 on a panel-provisioned throwaway tenant:
create → attach + verify → invite mail → served brand → Marca rebrand through the worker → member
shell → alias 308 → suspend/reactivate → module toggle → branded recovery mail), `invite.spec.ts`,
`recovery.spec.ts`, then the `@tracer` half of the PWA suite. Use it after a change that touches
branding, the panel, the proxy or the mail path; `pnpm verify` before a phase seals or a PR opens.
Never filter Playwright through `pnpm e2e -- <spec>` — pnpm forwards the `--` and Playwright then
runs the whole suite; the scripts call `pnpm --filter @tria/web exec playwright test <spec>`.

**Prerequisites.** `pnpm supabase start` (pinned CLI, Docker), `pnpm db:reset`,
`bash scripts/local-env.sh --write` (writes `apps/api/.env.local` and `apps/web/.env.local` with
`MAIL_TRANSPORT=local`, `DOMAIN_PROVIDER=fake`, `AUTH_ALLOW_LIST=local`), `pnpm db:seed` (also
derives the seed tenants' icon sets), Chromium via
`pnpm --filter @tria/web exec playwright install chromium`. The smoke spawns its own
`ROLE=worker` on :8790 for icon derivation and stops it afterwards; a running one is reused. Mail
is read from Mailpit (`http://127.0.0.1:54324`). Expect ~60 s waits inside the smoke: the web
host cache (`apps/web/lib/tenant-host.ts`, 60 s TTL) is what a brand or status change has to
outlive before the served HTML follows; the spec polls and annotates the observed delay.

**Build-output gate — `scripts/check-static-routes.sh`** (`pnpm check:static-routes`, after
`pnpm --filter @tria/web build`). Reads `apps/web/.next/prerender-manifest.json` and
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
- Staging smoke on the TRIA-owned seed hosts (D-24: `TENANT_DEMO_HOST` / `TENANT_LAB_HOST`) with
  `PLAYWRIGHT_BASE_URL=https://<TENANT_DEMO_HOST>` (+ `PLAYWRIGHT_API_URL` for the by-host reads):
  `branding.spec.ts`'s remote-capable tests are the ones without `isRemote` skips.
- `otp_expiry = 86400` on the hosted projects (section above).

## Production gate (D-12)

Three conditions must hold **on the same `main` SHA** before a single production migration runs:

1. `checks` — `deploy-api.yml` calls `./.github/workflows/ci.yml` as a job (`workflow_call`), so the
   lint (+ UI literal guard), typecheck/build/unit, build-output gate, boundary, lane-guard, pgTAP,
   integration, spike, e2e and PWA e2e steps all pass for that exact commit, not for an earlier one.
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
