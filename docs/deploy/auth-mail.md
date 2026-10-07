# Branded auth e-mail — Send Email Hook → API → transport

Plan 02-06 (TENANT-06, decisions D-37/D-38). This document records what ships, how the local stack
and CI keep working with no variables typed by hand, and every hosted value the Phase 01.1 runbook
must set. `docs/DEPLOY.md` links here (index entry added by 02-16).

## What ships (D-37, D-38)

- GoTrue no longer renders auth e-mails itself. For EVERY auth mail (recovery, invite, and the
  other `email_action_type`s) it calls the API's signed hook `POST /v1/hooks/auth/send-email`
  (`apps/api/src/routes/hooks.ts`, mounted without any auth middleware — the Standard Webhooks
  signature is its authentication).
- The API resolves the brand (`packages/core/server/tenancy/mail-tenant.ts`) from the community the
  flow **started on** (08.1-05, D-315/D-317). H is the tenant whose VERIFIED host is the `redirect_to`
  host, read uncached from `tenant_domains` (never the 60 s host cache). The pure table
  `decideMailTenant` takes the first row that matches:

  | # | Condition | Result |
  |---|---|---|
  | 1 | the identity is a platform admin | neutral platform mail |
  | 2 | H, and the identity has a non-deleted membership in H (any status) | H's brand (`via: membership`) |
  | 3 | H, and an open (`pending`/`sent`) invite FOR H to this e-mail or user | H's brand (`via: invite`) |
  | 4 | H, and the action type is `recovery` | H's brand (`via: redirect_host`, D-317) |
  | 5 | H, and any other link type (invite, signup, email, magiclink, email_change) | **refused** `redirect_host_not_member` |
  | 6 | H, and a non-link type (reauthentication code, `*_notification`) | neutral |
  | 6a | no H, the action type is `signup`, and the identity has exactly one non-deleted membership | that tenant's brand (`via: membership`) |
  | 7 | no H (platform fallback, localhost, unverified domain), a link type, and the identity has a membership or an open invite anywhere | **refused** `redirect_host_not_tenant` (D-23) |
  | 8 | no H, a non-link type | the brand of the identity's ONLY membership when it has exactly one, else neutral |
  | 9 | otherwise | neutral |

  Row 6a (quick 261007-gbk) exists because a new sign-up is unconfirmed and brand new: its only
  membership IS the community it signed up on, and without the row a sign-up on a generic host
  (`localhost:3000/cadastro/{slug}`, or GoTrue's `site_url` fallback) would hit row 7 and be
  refused, stranding the person. It is keyed on server rows, never on `user_metadata`, applies to
  `signup` only (a hostless `magiclink` with one membership is still refused by row 7) and needs
  exactly one membership (two stay refused). Every other row is unchanged.

  No row brands a mail by "the oldest membership" or "the newest invite": one identity may belong to
  several communities (V2-PLAT-07), and each mail wears the brand of the one whose page the person
  used. Recovery (row 4) is branded for a person who is not yet a member, so the "forgot my password
  while joining B" path returns to B's join screen; the `/esqueci-senha` answer is constant whether
  or not a mail went out (D-10), and the mail goes only to the address owner, so the brand reveals
  nothing to the requester. A refusal answers 500 and sends nothing — the host is never rewritten
  (T-02-26), so GoTrue reports the failure and the invite job retries.
- Templates (`packages/core/server/mail/templates/`, pt-BR, plain escaped HTML + text alternative):
  `recovery` ("Redefina sua senha — {tenant}"), `invite` ("Convite para administrar {tenant}"),
  `signup` ("Confirme seu e-mail — {tenant}", CTA "Confirmar e-mail") and a `neutral` fallback per
  action type. Logo as-is (`<img>`) or the display name as text (D-26),
  CTA in the persisted `colors.primary` / `colors.onPrimary`, footer "Enviado pela plataforma Rede Social",
  no Rede Social logo in the body.
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

## Sign-up confirmation (quick 261007-gbk)

Member sign-up requires a confirmed e-mail; this supersedes the Phase 1 D-04 autoconfirm ("no e-mail
confirmation in the pilot"). D-04's detail-less 409 for an existing e-mail is unchanged.

1. `POST /v1/public/signup/:slug` creates the GoTrue identity UNCONFIRMED (`email_confirm: false`)
   and, in the same admin-lane transaction as before, the membership, its profile and both consent
   rows (the compensation that deletes the identity on failure is intact). Membership and consents
   are written at sign-up, not at confirmation: the hook brands the mail from the membership
   (rows 2 and 6a) and the consent evidence belongs to the moment the person accepted. An
   unconfirmed identity has no session, so its membership is inert.
2. GoTrue sends NOTHING on an admin `createUser`, so the web action asks GoTrue for the mail with
   `supabase.auth.resend({ type: 'signup' })` (`apps/web/lib/signup-confirmation.ts`). The redirect
   origin is the validated `mailReturnOrigin` (`apps/web/lib/mail-return-origin.ts`, the same
   host-poisoning guard as `/esqueci-senha`): a tenant host, the platform host, or dev
   `localhost` / `*.localhost`. GoTrue's resend does not look at `[auth] enable_signup = false`, so
   the CR-02 lock on GoTrue's own public sign-up stays closed (`gotrue-signup-disabled.test.ts`).
3. The hook renders the `signup` template; its CTA is
   `{origin}/auth/confirm?next=/inicio&token_hash=…&type=signup`. `/auth/confirm` exchanges the hash
   (`verifyOtp`), which confirms the e-mail and signs the person in, and lands on `/inicio`.
4. The person is never auto-signed-in by the form. After submitting it lands on
   `/verifique-seu-email`; the address lives in the HttpOnly `pending_confirmation` cookie (one hour,
   never in a URL). A signup link that no longer exchanges lands on
   `/verifique-seu-email?erro=link-invalido`, where an e-mail can be typed to ask for a new one.
5. Resend (`/verifique-seu-email`): the answer after a send is ONE constant sentence whatever GoTrue
   replied (no account-existence oracle), and a 60 s cookie cooldown (mirrors the production
   `max_frequency`) short-circuits repeat clicks to a distinct wait notice that discloses nothing
   about the account.
6. An unconfirmed account that signs in with the RIGHT password lands on
   `/verifique-seu-email?erro=nao-confirmado` (a wrong password still shows the single generic
   credentials error: GoTrue checks the password before the confirmation state). The 08.1 "já tem
   conta" join sends an unconfirmed identity to the same screen.

Operational notes:

- Admin member lists show unconfirmed members until they confirm (they hold an `active` membership
  row). Filtering them or showing a badge is a follow-up.
- E-mail squatting (someone signs up with another person's address) gains nothing: the squatter can
  neither confirm nor sign in, and the real owner recovers through **Esqueci a senha**, whose link
  also confirms the e-mail (GoTrue marks it confirmed on a recovery exchange), then joins.
- Seeded, invited and admin-created users are unaffected (`email_confirm: true` or confirmed by
  their own link). Only the public sign-up path creates unconfirmed identities.
- Local: `[auth.email] enable_confirmations = true` with `max_frequency = "1s"` so e2e resends are not
  throttled. Restart the stack after editing it (`pnpm supabase stop && pnpm supabase start`; the
  database is kept). Check with `curl -s -H "apikey: x" http://127.0.0.1:54321/auth/v1/settings`:
  `"mailer_autoconfirm":false`.

## Shared password (D-312)

One identity has one password for every community of the platform. Changing it on one community
(`/redefinir-senha`, GoTrue `UpdatePassword`) signs the identity out of every OTHER origin at that
origin's next token refresh (≤ 1 h, the access-token lifetime): GoTrue revokes the other sessions'
refresh tokens (`LogoutAllExceptMe`). This is expected — it is the owner's own action, not a leak —
and the reset screen's notice "Sua senha é a mesma em todas as comunidades desta plataforma."
prepares the person for it. The manual UAT line in `08.1-VALIDATION.md` covers it.

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
  sends real mail.** Read a message: `curl "$MAILPIT_URL/api/v1/search?query=to:member@rede-demo.local"`
  then `curl "$MAILPIT_URL/api/v1/message/<ID>"`, or open `http://127.0.0.1:54324` in a browser.
- After editing the hook block: `pnpm supabase stop && pnpm supabase start` (the auth container
  reads the block as environment at start), then `pnpm db:reset`, `bash scripts/local-env.sh --write`,
  `pnpm db:seed`.
- `host.docker.internal:8787` must answer whenever GoTrue sends mail: `pnpm --filter @rede-social/api dev`
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

Every hosted `[remotes.<env>.auth.email]` table must also carry the sign-up confirmation pair (a
remote table inherits the base values, so omitting it would give the hosted project the LOCAL
`max_frequency = "1s"`):

```toml
[remotes.production.auth.email]
enable_confirmations = true
max_frequency = "60s"
```

Production already has it in `supabase/config.toml`; homolog must repeat the same two keys when its
remote table is created. The tenant host must also be in `additional_redirect_urls` (the
`/auth/confirm**` entry), exactly as for recovery. Nothing here is deployed by itself: production
receives the new auth settings on the next `supabase config push` (deploy-api.yml), and that push
must come AFTER the web release that ships `/verifique-seu-email`, otherwise a sign-up would end on
a page that does not exist yet.

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
| `mail.refused` reason `redirect_host_not_member` | API logs (500) | An invite or other link type (not `recovery`) started on a verified tenant host where the identity has no membership and no open invite; nothing is sent by design (D-315) |
| `mail.refused` reason `redirect_host_not_tenant` | API logs (500) | A link mail whose `redirect_to` is no verified tenant host (GoTrue fell back to `site_url` because the allow-list entry is missing, localhost, an unverified domain) for an identity that belongs somewhere; nothing is sent by design (D-23). Check the GoTrue redirect allow-list for the tenant host |
| `mail.refused` reason `no_recipient` / `invalid_redirect_to` / `invalid_payload` | API logs (500) | Malformed hook payload — GoTrue version drift; compare with `sendEmailHookPayloadSchema` |
| `mail.send_failed` | API logs (500) | Transport failure (Resend error, timeout, Mailpit down). Resend's `Idempotency-Key` = `webhook-id`, so a GoTrue retry cannot double-send |
| `mail.duplicate_suppressed` | API logs (200) | A GoTrue retry with a `webhook-id` already delivered — expected, nothing to do |
| No confirmation mail after sign-up on a Vercel Preview or other unregistered host; `signup_confirmation.origin_refused` in the web logs | Web logs | Same rule as recovery (`mailReturnOrigin`): only a registered tenant host, the platform host or dev `localhost` is honoured, so no mail is requested. Sign up on a registered tenant domain whose host is in the hosted `additional_redirect_urls` |
| An unconfirmed identity from community A tries to join community B and gets no mail; `mail.refused` reason `redirect_host_not_member` | API logs (500) | The hook refuses a `signup` mail on a host where the identity has no membership (row 5). The person confirms from community A's original mail, or uses **Esqueci a senha**, whose link also confirms the e-mail |
| `over_email_send_rate_limit` locally | GoTrue / web logs | `[auth.rate_limit] email_sent` (per hour) was exhausted by repeated sign-ups or resends in e2e; raise that key in `supabase/config.toml` and restart the stack |
| No mail at all, GoTrue template arrives instead | Mailbox | The hook block is disabled → GoTrue's SMTP fallback (`supabase/templates/recovery.html`, neutral platform). Enable the block and restart / `config push` |

Log lines (`event`): `mail.sent`, `mail.duplicate_suppressed`, `mail.refused`,
`mail.signature_rejected`, `mail.send_failed` — each carries `webhookId`, `actionType`, `tenantId`
(when resolved), `requestId` and a masked recipient; never the token, the token hash or the link.
