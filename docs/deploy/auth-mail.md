# Branded auth e-mail — Send Email Hook → API → transport

Plan 02-06 (TENANT-06, decisions D-37/D-38). This document records what ships, how the local stack
and CI keep working with no variables typed by hand, and every hosted value the Phase 01.1 runbook
must set. `docs/DEPLOY.md` links here (index entry added by 02-16).

## What ships (D-37, D-38)

- GoTrue no longer renders auth e-mails itself. For EVERY auth mail (recovery, invite, and the
  other `email_action_type`s) it calls the API's signed hook `POST /v1/hooks/auth/send-email`
  (`apps/api/src/routes/hooks.ts`, mounted without any auth middleware — the Standard Webhooks
  signature is its authentication).
- The API resolves the brand (`packages/core/server/tenancy/mail-tenant.ts`): the user's
  **membership** tenant first; without a membership, a `platform_admins` user gets the neutral TRIA
  mail; otherwise the VERIFIED tenant behind the `redirect_to` host (the first-admin invite, whose
  membership is inserted only after GoTrue returns); otherwise neutral TRIA. A membership tenant
  that differs from the verified tenant of the `redirect_to` host is **refused** (500, nothing
  sent) — a mail never carries the wrong brand.
- Templates (`packages/core/server/mail/templates/`, pt-BR, plain escaped HTML + text alternative):
  `recovery` ("Redefina sua senha — {tenant}"), `invite` ("Convite para administrar {tenant}") and
  a `neutral` fallback per action type. Logo as-is (`<img>`) or the display name as text (D-26),
  CTA in the persisted `colors.primary` / `colors.onPrimary`, footer "Enviado pela plataforma TRIA",
  no TRIA logo in the body.
- Sender: `"{displayName}" <no-reply@{MAIL_DOMAIN}>`.
- Transport (`packages/core/server/mail/`): `MAIL_TRANSPORT=local` (default) posts to Mailpit's
  HTTP API and can never reach a real mailbox; `MAIL_TRANSPORT=resend` uses the Resend SDK with the
  GoTrue `webhook-id` as `Idempotency-Key`. Both are bounded by a 3 s timeout inside GoTrue's 5 s
  hook budget. The route answers `200 {}`, `401 { error }` on a bad signature, `500 { error }` on
  anything else — never 429/503.
- Phase 1's `/esqueci-senha` action (`resetPasswordForEmail` through `@supabase/ssr`) is
  **unchanged**. The Custom SMTP recovery template (`[auth.email.template.recovery]`,
  `supabase/templates/recovery.html`, D-13) stays configured as the fallback for when the hook is
  disabled.

## Local stack

`supabase/config.toml`:

```toml
[auth.hook.send_email]
enabled = true
uri = "http://host.docker.internal:8787/v1/hooks/auth/send-email"
secrets = "env(SEND_EMAIL_HOOK_SECRETS)"
```

- Once this block is enabled, EVERY Supabase CLI command (`status` included) refuses to load the
  config unless `SEND_EMAIL_HOOK_SECRETS` is set and well-formed (`v1,whsec_<base64>`, ≥ 32 chars).
  `scripts/supabase.sh` (behind `pnpm supabase …` and `pnpm db:reset`) exports a local-only
  throwaway when the shell has none; `scripts/local-env.sh --write` writes the SAME constant into
  `apps/api/.env.local`, so GoTrue (container env) and the API share one secret. Override by
  exporting `SEND_EMAIL_HOOK_SECRETS` or `SEND_EMAIL_HOOK_SECRET_B64` before either script.
- `MAIL_TRANSPORT=local` → Mailpit at `MAILPIT_URL=http://127.0.0.1:54324`. **The local stack never
  sends real mail.** Read a message: `curl "$MAILPIT_URL/api/v1/search?query=to:member@tria-demo.local"`
  then `curl "$MAILPIT_URL/api/v1/message/<ID>"`, or open `http://127.0.0.1:54324` in a browser.
- After editing the hook block: `pnpm supabase stop && pnpm supabase start` (the auth container
  reads the block as environment at start), then `pnpm db:reset`, `bash scripts/local-env.sh --write`,
  `pnpm db:seed`.
- `host.docker.internal:8787` must answer whenever GoTrue sends mail: `pnpm --filter @tria/api dev`
  during development, and during `pnpm test:integration` the suite's own listener
  (`apps/api/tests/integration/global-setup.ts` serves the app in-process on `0.0.0.0:8787`, or
  reuses a dev server already on that port).

## Hosted values — Phase 01.1 runbook items

### API / worker (Cloud Run) — GCP Secret Manager, mounted as env

| Variable | Staging | Production | Notes |
|---|---|---|---|
| `SEND_EMAIL_HOOK_SECRETS` | generate `v1,whsec_$(openssl rand -base64 32)` | generate separately | Standard Webhooks secret shared with the Supabase project of the same environment; rotation below |
| `RESEND_API_KEY` | Resend API key (sending scope) | separate key | Only read when `MAIL_TRANSPORT=resend` |
| `MAIL_TRANSPORT` | `resend` | `resend` | `assertProductionEnv` refuses `resend` without `RESEND_API_KEY` at boot |
| `MAIL_DOMAIN` | `mail.staging.<platform-domain>` | `mail.<platform-domain>` (e.g. `mail.seusistema.com`) | The D-13 verified Resend sending subdomain; builds `no-reply@{MAIL_DOMAIN}` |
| `PUBLIC_WEB_SCHEME` | `https` | `https` | Logo URLs in mail are https-only under this setting |

Cloud Run: keep `min-instances 1` for the API service — the hook has a 5 s total budget including
GoTrue's retries, and a cold start would eat it.

### Supabase project — `supabase config push`

```toml
[remotes.staging.auth.hook.send_email]
enabled = true
uri = "https://<cloud-run-api-host>/v1/hooks/auth/send-email"
secrets = "env(SEND_EMAIL_HOOK_SECRETS)"

[remotes.production.auth.hook.send_email]
enabled = true
uri = "https://<cloud-run-api-host>/v1/hooks/auth/send-email"
secrets = "env(SEND_EMAIL_HOOK_SECRETS)"
```

The deploy workflow runs `supabase config push` with a GitHub environment secret named
`SEND_EMAIL_HOOK_SECRETS` holding the SAME value as Secret Manager for that environment. The
hosted `additional_redirect_urls` allow-list (02-09) is what bounds `redirect_to` upstream.

### Resend

- Verify `mail.<platform-domain>` (SPF + DKIM records from the Resend dashboard) before switching
  `MAIL_TRANSPORT` to `resend`; the `From` address is `no-reply@` that subdomain.
- Custom SMTP (D-13) may keep pointing at the same domain — it is only used when the hook is off.

## Rotation

1. Append the new segment to the API secret: `v1,whsec_<old>|v1,whsec_<new>` in Secret Manager,
   deploy — the route verifies against every segment.
2. `supabase config push` with the GitHub environment secret set to the same two-segment value
   (GoTrue signs with the first segment; both are accepted by the API).
3. Once every GoTrue instance uses the new value, remove the old segment from both places.

The local throwaway and the CI value are never rotated: they exist only inside a stack that lives
and dies with the machine or the job.

## Failure modes

| Symptom | Where | Meaning / fix |
|---|---|---|
| GoTrue "Error running hook" / auth request fails | Supabase auth logs | API unreachable at `uri`, or the hook took > 5 s (cold start, slow transport). Check Cloud Run min-instances and the API logs for the same `webhookId` |
| `mail.signature_rejected` | API logs (401 answered) | Secret mismatch between GoTrue (`config push` value) and the API (Secret Manager). Locally: `.env.local` regenerated with a different `SEND_EMAIL_HOOK_SECRETS` than the running stack — restart the stack or rewrite `.env.local` |
| `mail.refused` reason `tenant_host_mismatch` | API logs (500) | A member started a flow from another tenant's verified host; nothing is sent by design (D-23) |
| `mail.refused` reason `no_recipient` / `invalid_redirect_to` / `invalid_payload` | API logs (500) | Malformed hook payload — GoTrue version drift; compare with `sendEmailHookPayloadSchema` |
| `mail.send_failed` | API logs (500) | Transport failure (Resend error, timeout, Mailpit down). Resend's `Idempotency-Key` = `webhook-id`, so a GoTrue retry cannot double-send |
| `mail.duplicate_suppressed` | API logs (200) | A GoTrue retry with a `webhook-id` already delivered — expected, nothing to do |
| No mail at all, GoTrue template arrives instead | Mailbox | The hook block is disabled → GoTrue's SMTP fallback (`supabase/templates/recovery.html`, neutral TRIA). Enable the block and restart / `config push` |

Log lines (`event`): `mail.sent`, `mail.duplicate_suppressed`, `mail.refused`,
`mail.signature_rejected`, `mail.send_failed` — each carries `webhookId`, `actionType`, `tenantId`
(when resolved), `requestId` and a masked recipient; never the token, the token hash or the link.
