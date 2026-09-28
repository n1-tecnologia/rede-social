---
phase: 02-tenant-shell-branding-platform-panel
plan: 06
subsystem: auth mail (kernel mail transport + templates, Send Email Hook route, tenant resolution, local-stack/CI wiring)
tags: [mail, auth-hook, branding, resend, mailpit, standardwebhooks, kernel, hono, supabase-cli, vitest, tenant-06]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 03
    provides: "kernel env MAIL_TRANSPORT/RESEND_API_KEY/MAIL_DOMAIN/MAILPIT_URL/SEND_EMAIL_HOOK_SECRETS/PUBLIC_WEB_SCHEME+PORT, publicWebOrigin, assertProductionEnv; resend 6.28.0 + standardwebhooks 1.1.1 installed; scripts/local-env.sh emitting the local hook secret"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "@rede-social/contracts/branding (resolveBranding, deriveBrandColors, hexColorSchema, NEUTRAL_BRAND, LIGHT_BG, NAVY, absoluteBrandUrl), verified-only resolveTenantHost with primaryHost, createBoundedTtlCache/normalizeHost, seeded demo/lab brands with root-relative SVG logos"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 05
    provides: "sendPendingInvites → GoTrue inviteUserByEmail with redirectTo on the verified primary host (membership inserted AFTER GoTrue returns — the hook sees no membership for an invited admin)"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "membershipForUser, isPlatformAdmin, withAdminTx lane (Biome-restricted to tenancy/platform), moduleLogger/child-logger convention, /auth/confirm token_hash+type contract, supabase/templates/recovery.html SMTP fallback, integration setup.ts (api, adminSql, authAdmin, HOSTS), e2e mail.ts Mailpit reader"
provides:
  - "packages/core/server/mail/transport.ts — MailAddress, MailMessage, MailTransport { name: 'local'|'resend'; send(message, { signal }) }, MailTransportError, MAIL_SEND_TIMEOUT_MS = 3_000, formatMailbox (quoted display name, header-injection stripped, UTF-8 kept), maskEmail"
  - "packages/core/server/mail/local.ts — localTransport: Mailpit POST /api/v1/send with X-Rede-Action / X-Rede-Idempotency-Key headers; the fail-safe default, never a real MTA"
  - "packages/core/server/mail/resend.ts — resendTransport: lazy `new Resend(env.RESEND_API_KEY)` on first send, from = formatMailbox, `{ idempotencyKey: webhook-id }`, raced against the 3 s signal, `{ error }` → MailTransportError"
  - "packages/core/server/mail/hook-schema.ts (env-free) — sendEmailHookPayloadSchema/SendEmailHookPayload/HookEmailData, HOOK_HEADER_NAMES, HookSignatureError, HookPayloadError(reason), parseHookSecrets (both `v1,whsec_a|v1,whsec_b` and `v1,whsec_a|b`), verifyHookRequest (fail-closed, every secret, standardwebhooks timing-safe + 5-min tolerance, parse only after verification), buildActionLink (redirect_to kept VERBATIM + token_hash + type)"
  - "packages/core/server/mail/templates/layout.ts (env-free) — MailBrand, RenderedMail, escapeHtml, safeHttpUrl, renderLayout: table-based inline-styled 600 px card on LIGHT_BG, logo <img> as-is (re-filtered by safeHttpUrl) or display name <h1> (D-26), primary-colour top accent, CTA background=persisted primary / color=persisted onPrimary (invalid hex → neutral pair), copy-paste link line, optional code block, muted closing, 'Enviado pela plataforma Rede Social' footer, plain-text alternative opening with the brand name"
  - "templates/recovery.ts renderRecovery ('Redefina sua senha — {tenant}'), templates/invite.ts renderInvite ('Convite para administrar {tenant}', 'Você foi convidado(a) a administrar {tenant}'), templates/neutral.ts renderNeutral + LINK_ACTION_TYPES (pt-BR copy per GoTrue email_action_type: link / code / notice kinds, 'Aviso da sua conta — {tenant}' fallback)"
  - "packages/core/server/mail/index.ts — mailTransport (switch on env.MAIL_TRANSPORT), MailRefusedError(reason), toMailBrand (logo → absolute URL of primaryHost ?? redirectHost via publicWebOrigin, https-only unless PUBLIC_WEB_SCHEME=http; neutral = Rede Social/no logo/neutral pair), sendAuthMail({ payload, webhookId, logger }) → { outcome: 'sent'|'duplicate', tenantId, actionType } with a 5,000-entry / 15-min webhook-id LRU set BEFORE the send and cleared on transport failure; logs mail.sent with masked recipient, never token/token_hash/link"
  - "packages/core/server/tenancy/mail-tenant.ts — MailTenantResolution, redirectHostOf, resolveMailTenant: membership (one admin-lane select of tenant + verified primary host) → refuse 'tenant_host_mismatch' when redirect_to resolves to a VERIFIED host of another tenant → platform_admins → neutral → verified redirect host → tenant (via 'redirect_host') → neutral (via 'no_tenant')"
  - "apps/api/src/routes/hooks.ts — hookRoutes: plain `.post('/auth/send-email')` (no createRoute, no requireAuth, out of openapi.json), raw body, signature before parsing, GoTrue error shape (401 signature / 500 refused+failed, never 429/503), Cache-Control: no-store, log events mail.signature_rejected / mail.refused / mail.send_failed / mail.duplicate_suppressed; mounted `.route('/v1/hooks', hookRoutes)` between /v1/public and /v1/me"
  - "supabase/config.toml [auth.hook.send_email] enabled → http://host.docker.internal:8787/v1/hooks/auth/send-email, secrets = env(SEND_EMAIL_HOOK_SECRETS); [auth.email.template.recovery] kept as the D-13 fallback"
  - "scripts/supabase.sh — pinned-CLI wrapper (prefers node_modules/.bin/supabase) exporting the local throwaway SEND_EMAIL_HOOK_SECRETS; root `pnpm supabase` and `pnpm db:reset` route through it; scripts/local-env.sh emits the same constant and honours an exported value; ci.yml exports a ci-only value at job level"
  - "apps/api/tests/integration/global-setup.ts — serves the app in-process on 0.0.0.0:8787 during `pnpm test:integration` (reuses a dev server on EADDRINUSE), loads .env.local, closes server + kernel pool on teardown; vitest.config.ts attaches it only for integration runs and passes SEND_EMAIL_HOOK_SECRETS/MAIL_TRANSPORT/MAIL_DOMAIN/MAILPIT_URL through"
  - "docs/deploy/auth-mail.md — what ships, local stack, hosted values per environment (Secret Manager, [remotes.<env>.auth.hook.send_email] via supabase config push, Resend domain, Cloud Run min-instances 1), rotation, failure modes"
  - "Tests: packages/core/tests/mail-templates.test.ts (17), mail-hook.test.ts (11), apps/api/tests/integration/send-email-hook.test.ts (12 incl. the GoTrue-originated case)"
affects: [02-08 auth pages (invite/recovery mails now branded), 02-09 domains (sendPendingInvites on first verified host → branded invite), 02-10 accept-invite (consumes the invite link; resend-invite fallback reuses MailTransport/RenderedMail), 02-16 docs index (links docs/deploy/auth-mail.md), Phase 01.1 hosted runbook, Phase 7 notification mail (reuses layout + transport)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Auth mail pipeline: signed hook → resolveMailTenant (membership first, verified hosts only, mismatch refused) → pt-BR template in the resolved brand → MailTransport bounded by MAIL_SEND_TIMEOUT_MS"
    - "Webhook routes are plain Hono `.post` handlers (no zod-openapi, no envelope): raw body, signature verification before any parsing, the caller's own error shape, never retry-able statuses"
    - "Idempotency for provider retries: remember the caller's id BEFORE the side effect, forget it on failure, and forward it as the provider's Idempotency-Key"
    - "E-mail HTML: table layout, inline styles, escapeHtml on every interpolation, URLs through an http(s) allow-list at BOTH the brand mapper and the layout, hex through hexColorSchema, persisted derivations only (no color-mix)"
    - "Local-stack secrets that the Supabase CLI validates on every command live in a wrapper script + local-env.sh (same constant), CI job env, Secret Manager — never as a literal in config.toml"
    - "Integration suites that make an external service call back into the API start the app in-process from a Vitest globalSetup attached only to integration runs"

key-files:
  created:
    - packages/core/server/mail/transport.ts
    - packages/core/server/mail/local.ts
    - packages/core/server/mail/resend.ts
    - packages/core/server/mail/hook-schema.ts
    - packages/core/server/mail/index.ts
    - packages/core/server/mail/templates/layout.ts
    - packages/core/server/mail/templates/recovery.ts
    - packages/core/server/mail/templates/invite.ts
    - packages/core/server/mail/templates/neutral.ts
    - packages/core/server/tenancy/mail-tenant.ts
    - apps/api/src/routes/hooks.ts
    - apps/api/tests/integration/global-setup.ts
    - apps/api/tests/integration/send-email-hook.test.ts
    - packages/core/tests/mail-templates.test.ts
    - packages/core/tests/mail-hook.test.ts
    - scripts/supabase.sh
    - docs/deploy/auth-mail.md
  modified:
    - apps/api/src/app.ts
    - apps/api/vitest.config.ts
    - supabase/config.toml
    - scripts/local-env.sh
    - package.json
    - .github/workflows/ci.yml

key-decisions:
  - "buildActionLink keeps redirect_to VERBATIM and appends `token_hash`/`type` (the SMTP template's `{{ .RedirectTo }}&token_hash=…` shape) instead of URLSearchParams.set, which re-encoded the existing `next=/redefinir-senha` as `%2F` and broke the plan's own text-body assertion"
  - "The layout re-filters the logo through safeHttpUrl(…, true) even though toMailBrand already applied the scheme policy: defence in depth so no caller can ever emit a javascript:/data: src"
  - "A mail without a CTA (notifications) still shows the primary colour as a 4 px top accent on the card, so every auth mail is visibly branded; the plain-text alternative opens with the brand name as the header equivalent"
  - "scripts/supabase.sh prefers the repo's pinned node_modules/.bin/supabase over PATH: run directly (outside a pnpm script) the wrapper would otherwise hit the global 2.90.0 binary, which cannot even parse `[local_smtp]`"
  - "The local hook secret constant stays 02-03's `dHJpYS1sb2NhbC1zZW5kLWVtYWlsLWhvb2sta2V5MDE=` (the plan's text quoted a different placeholder); the plan's intent — one constant shared by scripts/supabase.sh and scripts/local-env.sh — is what matters"
  - "The Vitest globalSetup exports named `setup`/`teardown`; teardown also ends the kernel postgres pool the in-process app opened so the runner exits cleanly"
  - "[auth.rate_limit] email_sent = 2 was NOT raised: with each recovery e2e case on its own throwaway user GoTrue never throttled the hook path (14/14 on both projects)"

patterns-established:
  - "Kernel mail module (`packages/core/server/mail/*`) as the one place mail is rendered and sent; Phase 7 adds templates next to recovery/invite/neutral and keeps the transport"
  - "Webhook authentication = standard-webhooks signature over the raw body with rotation-aware secret parsing (`parseHookSecrets`)"
  - "Mailpit assertions in integration tests: search `to:<address>` then match the HTML marker (token_hash) or the `X-Rede-Idempotency-Key` header for link-less mails"

requirements-completed: [TENANT-06]

coverage:
  - id: D1
    description: "A signed recovery payload for a demo member produces a Mailpit message branded for Rede Demo: subject 'Redefina sua senha — Rede Demo', From 'Rede Demo' <no-reply@{MAIL_DOMAIN}>, CTA background #7c3aed / color #ffffff (persisted derivations), the seed logo as <img alt=\"Rede Demo\"> resolved to the primary host, plain-text alternative with the same link, 'Enviado pela plataforma Rede Social' footer, no lab hex; answered in < 1 s"
    requirement: TENANT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/send-email-hook.test.ts#1"
        status: pass
    human_judgment: false
  - id: D2
    description: "The hook authenticates GoTrue only: wrong secret, tampered body and missing headers answer 401 { error: { http_code: 401 } } and send nothing; both rotation spellings parse; the second secret verifies; a 10-minute-old timestamp and an empty secret list are rejected"
    requirement: TENANT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/send-email-hook.test.ts#2,3,4"
        status: pass
      - kind: unit
        ref: "packages/core/tests/mail-hook.test.ts (11 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tenant resolution is membership-first: member of a throwaway tenant → its brand; memberless user on that tenant's VERIFIED host → invite in its brand; memberless user on localhost → neutral platform with none of the seed/throwaway hexes; seeded super_admin on the platform host → neutral; demo member with redirect_to on the LAB host → 500 tenant_host_mismatch and nothing in Mailpit"
    requirement: TENANT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/send-email-hook.test.ts#5,6,7,8,9"
        status: pass
    human_judgment: false
  - id: D4
    description: "Edges: a tenant with no logoUrl renders its accented name as <h1> text and no <img>; Subject and From.Name equal 'Associação São José' after Mailpit's RFC 2047 round trip, HTML declares utf-8 and carries no &atilde;/&ccedil;; a notification type renders the neutral copy in the tenant brand without a link; a replayed webhook-id answers 200 twice and delivers exactly one message"
    requirement: TENANT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/send-email-hook.test.ts#5,10,11"
        status: pass
      - kind: unit
        ref: "packages/core/tests/mail-templates.test.ts (17 cases: escaping, UTF-8, logo allow-list, CTA colours, invalid hex fallback, footer/text, recovery/invite/neutral copy, doctype + charset)"
        status: pass
    human_judgment: false
  - id: D5
    description: "GoTrue itself triggers the branded mail on the local stack: resetPasswordForEmail → host.docker.internal:8787 (the integration-suite listener) → the route → Mailpit; Phase 1's recovery e2e (both Playwright projects) consumes the branded mail's CTA; 02-05's invite case still passes through the hook"
    requirement: TENANT-06
    verification:
      - kind: integration
        ref: "apps/api/tests/integration/send-email-hook.test.ts#12 (GoTrue-originated) and the whole suite 119/119 through the in-process listener"
        status: pass
      - kind: e2e
        ref: "apps/web/e2e/recovery.spec.ts — 14 passed (mobile-chromium + desktop-chromium)"
        status: pass
      - kind: other
        ref: "docker logs supabase_auth_rede-social: `Hook ran successfully` for each e2e recovery; `curl $MAILPIT_URL/api/v1/search?query=subject:\"Redefina sua senha — Rede Demo\"` → messages_count > 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "No variables typed by hand: `pnpm supabase status` / `pnpm db:reset` / `bash scripts/local-env.sh` work in a shell without SEND_EMAIL_HOOK_SECRETS (the pinned CLI alone refuses with LegacyStatusInvalidConfigError); config.toml holds no literal secret; CI exports a ci-only value; the hosted values are written down"
    requirement: TENANT-06
    verification:
      - kind: other
        ref: "env -u SEND_EMAIL_HOOK_SECRETS bash scripts/supabase.sh status → exit 0; ./node_modules/.bin/supabase status without the wrapper → LegacyStatusInvalidConfigError; `grep -v '^#' supabase/config.toml | grep -c 'v1,whsec_[A-Za-z0-9+/=]'` → 0; ci.yml YAML parses; docs/deploy/auth-mail.md 127 lines with every required term"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual adequacy of the branded mail (logo size, CTA contrast, layout in real clients) and the Resend transport against the real API"
    verification: []
    human_judgment: true
    rationale: "Mailpit renders the HTML but real clients (Gmail, Apple Mail, Outlook) differ; the Resend path type-checks and is unit-shaped but no key exists locally — the hosted Phase 01.1 runbook is the first real send"

# Metrics
duration: 21min
completed: 2026-09-16
status: complete
actuals:
  tokens: 24705
  tasks: 3
  commits: 4
plan_head_before: 1bbd076de1f29826200f82d4ad3f2e23eed8b678
---

# Phase 02 Plan 06: Branded Auth E-mail (Send Email Hook → API → Transport) Summary

**GoTrue on the local stack now delivers every auth e-mail through a standard-webhooks-signed hook to `POST /v1/hooks/auth/send-email`, where the kernel resolves the brand membership-first (verified `redirect_to` host for invites, neutral platform for platform staff and unresolved hosts, refusal on a host/membership mismatch), renders a pt-BR table-based template in the tenant's persisted colours with its logo as-is (or its name as text) and hands it to a `MailTransport` — Mailpit locally, Resend hosted with the `webhook-id` as idempotency key — inside GoTrue's 5 s budget; `pnpm supabase`, `pnpm db:reset`, `scripts/local-env.sh`, the integration suite (119/119 through an in-process listener) and CI keep working with no variables typed by hand, and Phase 1's recovery e2e passes 14/14 on the branded mail.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-16T22:53:39Z
- **Completed:** 2026-09-16T23:14:46Z
- **Tasks:** 3 (Task 1 tracer; Task 2 TDD RED + GREEN; Task 3 auto)
- **Files modified:** 23 (17 created, 6 modified)

## Accomplishments

- **Kernel mail module** (`packages/core/server/mail/`): transport contract with a 3 s budget, Mailpit `local` transport (the fail-safe default), lazy Resend transport with `idempotencyKey`, env-free hook schema (rotation-aware `parseHookSecrets`, fail-closed `verifyHookRequest`, verbatim-`redirect_to` `buildActionLink`), an escaped table-based layout (logo allow-listed twice, persisted CTA colours, top accent, footer, text alternative) and the recovery / invite / neutral templates with pt-BR copy for every GoTrue `email_action_type`.
- **Tenant resolution** (`tenancy/mail-tenant.ts`): membership → mismatch refusal → `platform_admins` → verified `redirect_to` host → neutral, in one admin-lane select plus the cached host resolver.
- **Hook route** (`apps/api/src/routes/hooks.ts`, mounted at `/v1/hooks` before `/v1/me`): raw body, signature before parsing, GoTrue's own error shape, `no-store`, structured `mail.*` events with a masked recipient; `sendAuthMail` remembers the `webhook-id` before sending (15-min bounded LRU) so a GoTrue retry never double-sends.
- **Local stack + CI wiring**: `[auth.hook.send_email]` enabled with `env(SEND_EMAIL_HOOK_SECRETS)`, `scripts/supabase.sh` (pinned CLI + local throwaway), `scripts/local-env.sh` sharing the constant and honouring exports, ci.yml job-level secret, Vitest `globalSetup` listener on 8787 for integration runs only, `docs/deploy/auth-mail.md` for the Phase 01.1 runbook.
- **Proof**: hook suite 12/12 (tracer, three 401s, empty logo + encoding, invite by host, neutral, platform admin, mismatch, notification, replay, GoTrue-originated); kernel unit 58/58 (28 new); whole integration suite 119/119 (107 before, incl. 02-05's invite case now travelling through the hook); `recovery.spec.ts` 14/14; monorepo typecheck 8/8, lint 7/7, test 6/6.

## Task Commits

1. **Task 1: End-to-end branded recovery tracer** — `71f905a` (feat)
2. **Task 2 RED: unit suites + edge integration cases** — `585463c` (test)
3. **Task 2 GREEN: invite/neutral templates, full resolution, replay guard, Resend transport** — `44ad791` (feat)
4. **Task 3: hook enabled locally and in CI, wrapper, listener, runbook, GoTrue-originated proof** — `6fdcf17` (feat)

**Plan metadata:** see the final `docs(02-06)` commit.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 2 | `585463c` — `mail-templates.test.ts` failed to import `templates/invite` + `templates/neutral`; integration cases 6 (invite → 500 `unsupported_action_type`), 9 (mismatch sent with the demo brand instead of 500), 10 (notification → 500) and 11 (two deliveries on replay) failed; cases 5/7/8 and `mail-hook.test.ts` passed in RED because they pin the tracer's behaviour (recorded, not driven) | `44ad791` (unit 58/58, hook suite 11/11) | — | compliant |

Two GREEN-phase adjustments were made to satisfy the RED tests as written: the text alternative now opens with the brand name and the layout re-filters the logo URL (see Decisions).

## Files Created/Modified

- `packages/core/server/mail/{transport,local,resend,hook-schema,index}.ts` — contract, transports, hook verification/link, pipeline
- `packages/core/server/mail/templates/{layout,recovery,invite,neutral}.ts` — layout engine and the three pt-BR templates
- `packages/core/server/tenancy/mail-tenant.ts` — brand resolution (admin lane)
- `apps/api/src/routes/hooks.ts`, `apps/api/src/app.ts` — the hook route and its mount
- `apps/api/tests/integration/{send-email-hook.test.ts,global-setup.ts}`, `apps/api/vitest.config.ts` — hook suite, listener, `globalSetup` + `KEYS`
- `packages/core/tests/{mail-templates,mail-hook}.test.ts` — hermetic unit suites
- `supabase/config.toml` — `[auth.hook.send_email]` block (only change)
- `scripts/supabase.sh` (new), `scripts/local-env.sh`, `package.json` — wrapper, shared secret, script routing
- `.github/workflows/ci.yml` — job-level `SEND_EMAIL_HOOK_SECRETS`
- `docs/deploy/auth-mail.md` — hosted runbook

## Decisions Made

See `key-decisions` in the frontmatter. Recorded per the plan's `<output>` request:

- **CLI behaviour with the hook block:** confirmed on CLI 2.117.0 — with `[auth.hook.send_email]` enabled and no `SEND_EMAIL_HOOK_SECRETS` in the shell, `./node_modules/.bin/supabase status` fails with `LegacyStatusInvalidConfigError: Invalid hook config: auth.hook.send_email.secrets must be formatted as "v1,whsec_<base64_encoded_secret>" with a minimum length of 32 characters.`; through `scripts/supabase.sh` the same command exits 0. `supabase stop && supabase start` picked the block up (`GOTRUE_HOOK_SEND_EMAIL_ENABLED=true`, `_URI`, `_SECRETS` in the auth container env); GoTrue logs `Hook ran successfully` per recovery.
- **`[auth.rate_limit] email_sent`:** not raised — no `over_email_send_rate_limit` appeared (the e2e uses one throwaway user per case).
- **Resend `idempotencyKey`:** `client.emails.send(payload, { idempotencyKey })` type-checks against `resend@6.28.0` (`CreateEmailRequestOptions extends PostOptions, IdempotentRequest`).
- **`apps/api/vitest.config.ts` changes:** `KEYS` += `'SEND_EMAIL_HOOK_SECRETS'`, `'MAIL_TRANSPORT'`, `'MAIL_DOMAIN'`, `'MAILPIT_URL'`; `globalSetup: integrationRun ? ['tests/integration/global-setup.ts'] : []` where `integrationRun = process.argv.some((arg) => arg.includes('tests/integration'))` — the unit script (`vitest run tests/unit`) stays hermetic (12/12 with no listener).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `buildActionLink` via `URLSearchParams.set` re-encoded the existing `next=/…`**
- **Found during:** Task 1 (first tracer run)
- **Issue:** `url.searchParams.set(...)` re-serialised `next=/redefinir-senha` as `next=%2Fredefinir-senha`; `/auth/confirm` would still decode it, but the plan's text-body assertion (and case 6's `next=/aceitar-convite`) expect the SMTP template's verbatim shape.
- **Fix:** validate with `new URL`, keep `redirect_to` verbatim (hash stripped) and append `token_hash`/`type` with the right separator.
- **Files modified:** `packages/core/server/mail/hook-schema.ts`
- **Verification:** unit `buildActionLink` cases; integration 1, 6, 12
- **Committed in:** `71f905a`

**2. [Rule 3 - Blocking] `scripts/supabase.sh` run directly resolved to the global CLI 2.90.0**
- **Found during:** Task 3 (`bash scripts/supabase.sh status` from the plan's verify chain)
- **Issue:** outside a pnpm script `node_modules/.bin` is not on PATH, so `exec supabase` hit the global 2.90.0 binary, which fails on `[local_smtp]` ("`'config.config' has invalid keys: local_smtp`").
- **Fix:** the wrapper prefers `$ROOT/node_modules/.bin/supabase` when present and falls back to PATH (CI's setup-cli).
- **Files modified:** `scripts/supabase.sh`
- **Verification:** `env -u SEND_EMAIL_HOOK_SECRETS bash scripts/supabase.sh status` exits 0
- **Committed in:** `6fdcf17`

**3. [Rule 2 - Missing critical] Layout re-filters the logo URL; brand accent without a CTA; brand name in the text alternative**
- **Found during:** Task 2 GREEN (RED tests for `renderLayout` with a `javascript:` logo, the accented name in `text`, and case 10's brand assertion)
- **Issue:** the plan put the http(s) allow-list only in `toMailBrand`, so a direct `renderLayout` caller could emit a `javascript:` `src`; a notification mail carried no brand colour at all; the plain-text alternative never named the tenant when no paragraph did.
- **Fix:** `renderHeader` applies `safeHttpUrl(logoUrl, true)`; the card gets `border-top: 4px solid {primary}`; the text alternative opens with `brand.displayName`.
- **Files modified:** `packages/core/server/mail/templates/layout.ts`
- **Verification:** `mail-templates.test.ts` 17/17; integration 5, 10
- **Committed in:** `44ad791`

### Documented, not fixed

- **Local hook secret constant:** kept 02-03's `dHJpYS1sb2NhbC1zZW5kLWVtYWlsLWhvb2sta2V5MDE=` in both scripts rather than the plan's quoted `bG9jYWwtb25seS1…` placeholder — the plan's stated requirement is "the SAME constant 02-03 wrote".
- **Acceptance literal `exec supabase "$@"`:** present as the PATH fallback; the preferred branch execs the pinned binary explicitly.

---

**Total deviations:** 3 auto-fixed (1 bug, 1 blocking, 1 missing critical) + 2 documented. **Impact on plan:** all inside the plan's files and scope; no new packages, no architectural change.

## Issues Encountered

- **Stale dev API on 8787:** an orphaned `pnpm --filter @rede-social/api dev` tree from 2026-09-12 (PPID 1, a leftover Playwright web server) owned the port; the first whole-suite run reused it (119/119). It was stopped to prove the in-process listener path (`[integration] API listening on 0.0.0.0:8787` → 119/119 again, clean exit). Playwright started and stopped its own servers for the e2e run afterwards; no port is left occupied.
- **02-04 environment drift resolved:** after the stack restart `recovery.spec.ts` cases 3/5/7 pass again — the mails now originate from GoTrue through the hook (the SMTP template path is only the fallback), so the "default English template" drift recorded in `deferred-items.md` is gone.
- **Secret-file guard:** `apps/api/.env.local` cannot be read by tooling in this session; its regeneration was verified by the generator's exit status and by the suites that consume it, not by inspection.
- **Seed env:** `pnpm db:seed` needs the seed credentials in the environment; they were sourced from `scripts/local-env.sh` output without printing them.

## Human-check notes (for `/gsd-verify-work`, `human_verify_mode: end-of-phase`)

- Open Mailpit at `http://127.0.0.1:54324`, filter `to:member@rede-demo.local` (or any `e2e-recovery-*@rede-demo.local`): newest "Redefina sua senha — Rede Demo" — purple top accent and CTA, the demo wordmark, "Enviado pela plataforma Rede Social" footer, plain-text tab with the same link.
- Filter `subject:"Convite para administrar"` — the throwaway "Associação São José" invite renders the accented name as text (no logo) with the amber CTA.
- The Resend transport has no local key; the first real send is the hosted runbook (docs/deploy/auth-mail.md).

## Known Stubs

None — every value in the mails comes from the database or the hook payload; the Resend transport is a complete implementation selected only by `MAIL_TRANSPORT=resend`.

## Threat Flags

None beyond the plan's register: the only new surface is `POST /v1/hooks/auth/send-email` (T-02-21..29, all mitigated as planned).

## User Setup Required

None locally — `pnpm supabase start` → `pnpm db:reset` → `bash scripts/local-env.sh --write` → `pnpm db:seed` is unchanged. Hosted values (Secret Manager `SEND_EMAIL_HOOK_SECRETS`, `RESEND_API_KEY`, `MAIL_TRANSPORT=resend`, `MAIL_DOMAIN`; `[remotes.<env>.auth.hook.send_email]` via `supabase config push`; Resend domain verification) are the Phase 01.1 runbook items listed in `docs/deploy/auth-mail.md`.

## Next Phase Readiness

- 02-08/02-10: invite and recovery mails are branded end to end; the invite CTA lands on `/auth/confirm?next=/aceitar-convite&token_hash=…&type=invite`; a resend-invite fallback can reuse `MailTransport` / `RenderedMail`.
- 02-09: `sendPendingInvites` on the first verified host now yields a branded invite mail through the hook.
- 02-16: link `docs/deploy/auth-mail.md` from the docs index.
- Watch item for later plans: any new integration case that makes GoTrue send mail depends on the `globalSetup` listener — keep `pnpm test:integration` (not a bare `vitest run <file>` outside the config) as the entry point, or run `pnpm --filter @rede-social/api exec vitest run tests/integration/<file>` (the argv check still attaches the listener).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All 17 created files exist on disk; task commits 71f905a, 585463c, 44ad791 and 6fdcf17 are in history; commits measured from plan_head_before 1bbd076 (4).
