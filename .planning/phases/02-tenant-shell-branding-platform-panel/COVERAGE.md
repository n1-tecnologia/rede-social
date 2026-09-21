# API Coverage — Phase 2 external integrations

> Full coverage by default. Opt-outs are explicit, reasoned decisions. One section per external
> service; each service starts from its own full-coverage baseline. Capability surfaces are taken
> from `02-RESEARCH.md` §Pattern 5 / §Pattern 6 / §Standard Stack and from the services' official
> documentation cited there. Plans that implement a surface reference this file: `02-06-PLAN.md`
> (Resend, Supabase Auth Send Email Hook), `02-09-PLAN.md` (Vercel Project Domains, Supabase
> Management API).

## Vercel REST API — Project Domains (`02-09-PLAN.md`, adapter `packages/core/server/domains/vercel.ts`)

| capability | decision | reason |
|---|---|---|
| `POST /v10/projects/{idOrName}/domains` (add domain to project) | INTEGRATE | |
| `GET /v9/projects/{idOrName}/domains/{domain}` (project domain status) | INTEGRATE | reads `verified` and `verification[]` |
| `GET /v6/domains/{domain}/config` (DNS instructions) | INTEGRATE | reads `configuredBy`, `misconfigured`, `recommendedCNAME`, `recommendedIPv4` |
| `POST /v9/projects/{idOrName}/domains/{domain}/verify` (TXT ownership challenge) | INTEGRATE | |
| `DELETE /v9/projects/{idOrName}/domains/{domain}` (detach from project) | INTEGRATE | |
| `GET /v9/projects/{idOrName}/domains` (list project domains) | OPT-OUT | not needed — `tenant_domains` is the source of truth; reconciliation against the provider list is a Phase 8 hardening item |
| `PATCH /v9/projects/{idOrName}/domains/{domain}` (redirect / gitBranch settings) | OPT-OUT | not needed — non-primary alias redirects are done in `proxy.ts` (D-35), never by the provider |
| `DELETE /v6/domains/{domain}` (delete the domain from the Vercel account) | OPT-OUT | explicitly out of scope — the customer owns the domain; the platform only detaches it from the project |
| `POST /v5/domains` / `POST /v4/domains/buy` (register or buy a domain) | OPT-OUT | explicitly out of scope — PROJECT.md: no DNS automation on the customer's behalf |
| `GET /v4/domains/{domain}/records` and DNS record CRUD | OPT-OUT | explicitly out of scope — covers `/v2/domains/{domain}/records` too; the platform shows the records the customer must create; it never writes the customer's DNS |
| `GET /v6/domains/{domain}` / `GET /v5/domains` (account-level domain info/list) | OPT-OUT | not needed — project-level status carries everything the panel shows |
| Webhooks (`domain.created` / verification events) | OPT-OUT | not needed yet — CONTEXT.md Deferred Ideas: "Vercel domain-verified webhook instead of polling — revisit if polling proves noisy" |

## Supabase Management API — Auth service config (`02-09-PLAN.md`, adapter `packages/core/server/domains/auth-allow-list.ts`)

| capability | decision | reason |
|---|---|---|
| `GET /v1/projects/{ref}/config/auth` (read `uri_allow_list`) | INTEGRATE | |
| `PATCH /v1/projects/{ref}/config/auth` — add host to `uri_allow_list` | INTEGRATE | read-modify-write; adds `https://<host>/auth/confirm**` |
| `PATCH /v1/projects/{ref}/config/auth` — remove host from `uri_allow_list` | INTEGRATE | read-modify-write; drops the host's entry on domain removal |
| `PATCH /v1/projects/{ref}/config/auth` — `site_url` | OPT-OUT | explicitly out of scope — D-22: no SITE_URL anywhere; every absolute URL is derived from the request origin |
| `PATCH /v1/projects/{ref}/config/auth` — `mailer_otp_exp` | OPT-OUT | invite/recovery link lifetime; not needed yet — the hosted "Email OTP Expiration = 86400" is a one-time `supabase config push` setting in the Phase 01.1 runbook (RESEARCH A4), not a runtime call |
| `PATCH /v1/projects/{ref}/config/auth` — Send Email Hook config | OPT-OUT | covers `hook_send_email_*` (enabled, uri, secrets); not needed — set once per environment via `supabase/config.toml` + `supabase config push` in the deploy workflow, never from application code |
| `PATCH /v1/projects/{ref}/config/auth` — SMTP / e-mail templates | OPT-OUT | not needed — branding travels through the Send Email Hook (D-37); Custom SMTP stays the static fallback |
| Other Management API resources | OPT-OUT | projects, secrets, storage config, database branches; explicitly out of scope — provisioning of projects/secrets is Phase 01.1 |

## Supabase Auth Hooks — Send Email Hook, inbound (`02-06-PLAN.md`, route `apps/api/src/routes/hooks.ts`)

| capability | decision | reason |
|---|---|---|
| `POST /v1/hooks/auth/send-email` (inbound, standard-webhooks signed) | INTEGRATE | receives `{ user, email_data }`; verifies `webhook-id`, `webhook-timestamp`, `webhook-signature` |
| `email_action_type = recovery` (branded pt-BR template) | INTEGRATE | |
| `email_action_type = invite` (branded pt-BR template) | INTEGRATE | |
| `email_action_type` — all remaining types (neutral fallback) | INTEGRATE | `signup`, `magiclink`, `email_change`, `email`, `reauthentication`, `password_changed_notification`, `email_changed_notification`; still branded with tenant name + colors when a tenant resolves |
| Secret rotation format `v1,whsec_<a>&#124;<b>` | INTEGRATE | verify against each secret |
| Error answer `{ error: { http_code, message } }` | INTEGRATE | status 500 on permanent failure; 401 on bad signature |
| Retry-able answers (429/503) | OPT-OUT | explicitly out of scope — RESEARCH Pitfall 6: GoTrue retries inside the same 5 s budget, so retry-able codes only produce duplicate sends |
| Other auth hooks (`custom_access_token`, `before_user_created`, …) | OPT-OUT | plus `send_sms`, `mfa_verification_attempt`, `password_verification_attempt`; not needed — no requirement in this phase uses them (custom access token is a later-phase concern per STACK.md) |

## Resend HTTP API (`02-06-PLAN.md`, transport `packages/core/server/mail/resend.ts`)

| capability | decision | reason |
|---|---|---|
| `emails.send({ from, to, subject, html, text, replyTo })` | INTEGRATE | |
| `Idempotency-Key` header on `emails.send` (keyed by GoTrue `webhook-id`) | INTEGRATE | RESEARCH A6 — falls back to the in-memory `webhook-id` LRU when the SDK/API rejects the header |
| `emails.get` / `emails.update` / `emails.cancel` | OPT-OUT | not needed — auth mail is fire-and-forget under the hook's 5 s budget |
| `emails.batch` | OPT-OUT | not needed yet — Phase 7 notification digests decide on batching |
| `domains.*` (create/verify sending domains) | OPT-OUT | explicitly out of scope — per-tenant sending domains are V2 (CONTEXT.md Deferred Ideas); the single TRIA mail subdomain is provisioned in Phase 01.1 |
| `audiences.*`, `contacts.*`, `broadcasts.*` | OPT-OUT | not needed — no marketing/newsletter surface in the product |
| `apiKeys.*` | OPT-OUT | explicitly out of scope — keys live in GCP Secret Manager, managed by the Phase 01.1 runbook |
| Inbound webhooks (`email.delivered`, `email.bounced`, …) | OPT-OUT | not needed yet — bounce handling is a Phase 7/8 item once notification mail exists |

## Local development stand-ins (not external integrations — recorded for completeness)

| stand-in | replaces | decision | reason |
|---|---|---|---|
| `packages/core/server/domains/fake.ts` (`DOMAIN_PROVIDER=fake`) | Vercel adapter | INTEGRATE | D-36: the whole attach → verify → invite flow is e2e-testable without Vercel |
| `packages/core/server/domains/auth-allow-list.ts` `local` implementation (no-op + in-memory ledger) | Supabase Management API | INTEGRATE | `supabase/config.toml` already allows `http://*.localhost:3000/**` |
| `packages/core/server/mail/local.ts` → Mailpit `POST /api/v1/send` (`MAIL_TRANSPORT=local`) | Resend | INTEGRATE | local dev never sends real mail (D-37); `apps/web/e2e/mail.ts` reads the same inbox |
