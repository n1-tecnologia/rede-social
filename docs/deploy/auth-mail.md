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
  row), and since quick 261007-gzu they wear a warning pill "E-mail não confirmado" on the Membros
  row and in the member sheet, for an active or blocked member whose address is unconfirmed. Nobody is
  hidden and no count, filter, order or page changes. The state reaches only callers holding
  `members.manage` or `moderation.manage`, as a boolean (`emailUnconfirmed` on the admin member row),
  read through `app.membership_email_unconfirmed(tenant, membership)`: scoped by tenant AND membership,
  executable by `service_role` only, because neither `api_user` nor the admin lane can read
  `auth.users`. The member-facing directory and profile never carry it. An INVITED row keeps only
  "Convite pendente" (the invite already says the address is unverified). Filtering or searching by
  this state, and an admin action to resend the confirmation mail, are not part of this change.
- E-mail squatting (someone signs up with another person's address) gains nothing: the squatter can
  neither confirm nor sign in, and the real owner recovers through **Esqueci a senha**, whose link
  also confirms the e-mail (GoTrue marks it confirmed on a recovery exchange), then joins.
- Seeded, invited and admin-created users are unaffected (`email_confirm: true` or confirmed by
  their own link). Only the public sign-up path creates unconfirmed identities.
- Local: `[auth.email] enable_confirmations = true` with `max_frequency = "1s"` so e2e resends are not
  throttled. Restart the stack after editing it (`pnpm supabase stop && pnpm supabase start`; the
  database is kept). Check with `curl -s -H "apikey: x" http://127.0.0.1:54321/auth/v1/settings`:
  `"mailer_autoconfirm":false`.

### Release order of `emailUnconfirmed`

The new response field follows the Phase 8 precedent in `docs/DEPLOY.md` (that file is not edited by
this change): the web parses every API answer with STRICT schemas, so an old web refuses an unknown key
from a new API. The new web declares `emailUnconfirmed` optional, so it reads the old API's answers
unchanged. Release order: migrations (the function `20261007152755_membership_email_unconfirmed.sql`,
expand-only), then the web, then the API.

## Existing accounts: one-time backfill

Switching `enable_confirmations` on makes GoTrue refuse password sign-in with `email_not_confirmed`
for any account whose `email_confirmed_at` is null. Accounts created under the old autoconfirm rule
(Phase 1 D-04), or by hand without Auto Confirm, must not be locked out. The migration
`20261007153044_confirm_existing_auth_emails.sql` is a one-time backfill that confirms them:

```sql
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email_confirmed_at is null
   and invited_at is null
   and created_at < timestamptz '2026-10-07 14:58:35+00';
```

Two guards keep it from ever confirming an address nobody verified:

- **Cutoff `2026-10-07 14:58:35+00`** is the commit instant of the sign-up confirmation code
  (`1bad76a`). Production creates unconfirmed identities only after that code ships, and every
  account created before it was autoconfirmed, so a legitimately pending sign-up is always newer than
  the cutoff and is never touched, however late or how often the file runs. No clock is read at run
  time.
- **`invited_at is null`**: a pending GoTrue invite is not an existing account that would be blocked;
  its invite link confirms it on acceptance regardless of the confirmations setting.

It is one-time: the Supabase CLI records it as applied, and because of the guards a later or repeated
run matches nothing new. It is idempotent and a data change with no schema effect, so rolling back the
API or the web needs nothing. A test (`apps/api/tests/integration/confirm-existing-emails.test.ts`)
executes the shipped file against the local database and proves a legacy account is confirmed while an
invited one, a post-cutoff pending sign-up and an already-confirmed account stay as they were, twice.

**Order.** Apply it before or with the config push that enables confirmations. In
`.github/workflows/deploy-api.yml` the `supabase db push` step precedes the `supabase config push`
step in the same job, so the normal deploy is already right. If the config is ever pushed by hand,
push the migration first.

**Pre-flight check.** On the target database, before the config push, list the accounts the backfill
would cover (and the ones it deliberately skips). After the migration the first query must return 0:

```sql
-- must be 0 after the backfill
select count(*) from auth.users
 where email_confirmed_at is null
   and invited_at is null
   and created_at < timestamptz '2026-10-07 14:58:35+00';

-- unconfirmed accounts the backfill leaves alone: review each (pending sign-up, pending invite, or an
-- account created by hand after the cutoff that the operator wants to confirm deliberately)
select id, email, created_at, invited_at from auth.users
 where email_confirmed_at is null
   and (invited_at is not null or created_at >= timestamptz '2026-10-07 14:58:35+00')
 order by created_at;
```

**Honest limit.** An account created by hand between the cutoff and the first production sign-up with
confirmations on is not covered, and neither is a hand-made account that carries an `invited_at`
value; the second query lists them. Confirm such a single account with a targeted one-off update, and
never by moving the cutoff. This file has NOT been applied to production or homolog; that is a human
step after the check above.

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
`SEND_EMAIL_HOOK_SECRETS` holding the SAME value as Secret Manager for that environment. Since
quick 261022-fku it also needs a second environment secret, `RESEND_SMTP_PASS` (next section). The
hosted `additional_redirect_urls` allow-list (02-09) is what bounds `redirect_to` upstream.

### Production e-mail rate limit (quick 261022-fku)

**Symptom and cause.** Production allowed only 2 auth e-mails per hour for the WHOLE Supabase
project: sign-up confirmation, recovery, invite and resend share one sum, across every tenant, and
a request counts even when the Send Email Hook then answers 500. The auth logs show it on
2026-10-20 22:14-22:43 (`/invite`: two 500s from the hook, then ten 429s) and on 2026-10-22
12:52-13:58 (`/recover`: two 500s, three 429s, one more 500): `429 over_email_send_rate_limit` on
password recovery, invites and confirmation resends. The value came from the base
`[auth.rate_limit] email_sent = 2` in `supabase/config.toml`, which `[remotes.production]`
inherited, so every `supabase config push` re-asserted it. Supabase lets a project change that
field only when it has its own SMTP server, even with the Send Email Hook enabled.

**What ships.** Two additive tables in `[remotes.production]`:

```toml
[remotes.production.auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_SMTP_PASS)"
admin_email = "no-reply@n1marketingdigital.com.br"
sender_name = "Rede Social"

[remotes.production.auth.rate_limit]
email_sent = 100
```

The Send Email Hook is still the ONLY sender. While it is enabled GoTrue never opens an SMTP
connection; every mail is still rendered and delivered by the API through the Resend HTTP API.
GoTrue would use the SMTP block only if the hook were ever disabled. The block exists solely so the
`email_sent` field becomes writable. The pinned `[remotes.production.auth.email.template.recovery]`
stays for the same reason: the hook renders every mail, so GoTrue's own template is never used.

**Why 100.** 30 is Supabase's own default once custom SMTP exists, and it is the floor: a lower
value is itself a denial of service for recovery, because one shared bucket serves every pilot
tenant and a single tenant inviting a batch, or a launch-hour burst of sign-up confirmations
(`enable_confirmations = true` makes every new member one mail), would use it up. A much higher
value removes the flood cap. 100 is about three times the floor and still a hard bound (at most
2,400 mails a day if sustained, visible in Resend usage and in `over_email_send_rate_limit` long
before it matters). Each address stays limited to one mail a minute by the per-user
`max_frequency = "60s"` in `[remotes.production.auth.email]`, which this change keeps. To change
the value, edit `email_sent` and push; the unit test
`apps/api/tests/unit/production-auth-config.test.ts` accepts 30 to 500. Confirm the Resend plan's
daily and monthly quota first: 100 per hour only makes sense on a plan that can carry it.

**The secret.** GitHub environment `production`, secret `RESEND_SMTP_PASS`: a dedicated Resend API
key (name `supabase-auth-smtp-prod`, Sending access, restricted to `n1marketingdigital.com.br`),
distinct from `resend-api-key-prod` so it can be revoked on its own. The password is never a
literal in git: `config.toml` holds only the `env()` reference and the workflow only
`secrets.RESEND_SMTP_PASS`. The first step of the production job, "Require the auth SMTP password",
fails the run before the migrations when the secret is empty (a secret that does not exist resolves
to an empty string). Rotation: create a new key, update the secret, run the deploy or the manual
push below, then revoke the old key in Resend.

**Sender identity.** `admin_email` is `no-reply@` + `MAIL_DOMAIN` (`n1marketingdigital.com.br` in
production), the mailbox the hook already uses. The unit test compares it with `MAIL_DOMAIN` in
`deploy-api.yml`, so change both together.

**Homolog.** A remote inherits the base `email_sent = 2`. A future `[remotes.homolog]` table must
repeat both tables above, and the `homolog` GitHub environment needs its own `RESEND_SMTP_PASS`.

**Rollback.** `config push` leaves properties the file does not declare unchanged. Removing
`[remotes.production.auth.rate_limit]` makes `email_sent` inherit the base 2 again at the next
push, but removing the SMTP table does NOT switch the remote SMTP off: set `enabled = false` in
`[remotes.production.auth.email.smtp]`, push, then revoke `supabase-auth-smtp-prod` in Resend.

**Offline validation limit.** The Supabase CLI loads the file with the new tables (and with
`RESEND_SMTP_PASS` unset, so no local, CI or homolog command needs it) and rejects a wrong value
type, but it silently accepts an unknown key or a missing `host` in a remote table; key names are
therefore checked against a fresh `supabase init` template and by the unit test. The remote
semantics are only validated by `supabase config diff` and `config push` against the project.

**Runbook for Igor.** The change itself never runs any of this; nothing below has been executed
against production.

```
1. Create the Resend key. Resend dashboard -> API Keys -> Create API Key. Name: supabase-auth-smtp-prod.
   Permission: Sending access. Domain: n1marketingdigital.com.br. Copy the key (it starts with re_) once.
   While there, note the account plan's daily and monthly quota: email_sent = 100 per hour only makes
   sense on a plan that can carry it.

2. Store it as the GitHub environment secret of the production environment (not a repository secret),
   from the repository directory:
     gh secret set RESEND_SMTP_PASS --env production
   Paste the key at the prompt, then check that the name is listed:
     gh secret list --env production

3. Preview the Supabase side (read-only). Use the brew CLI (the repo-pinned binary hangs on the macOS
   keychain). The hook secret must be the REAL production value so the hook block shows no diff, never the
   local throwaway:
     export SUPABASE_ACCESS_TOKEN="$(gcloud secrets versions access latest --secret=supabase-pat-prod --project=api-dere-social)"
     export SEND_EMAIL_HOOK_SECRETS="$(gcloud secrets versions access latest --secret=send-email-hook-secrets-prod --project=api-dere-social)"
     export RESEND_SMTP_PASS='<the key from step 1>'
     supabase config diff --project-ref qjjhtduxquvlfppybpqq
   Expected: only the SMTP keys (host, port, user, password, admin email, sender name, enabled) and the
   e-mail rate limit (2 -> 100). Anything else, above all the hook uri or hook secret: stop and compare
   before going on. A difference in the redirect URL list (uri_allow_list) means the push would drop
   runtime per-domain entries: read step 5 before shipping. Do not paste the diff output anywhere: it can
   carry secret-derived values.

4. Ship it, one of:
   a. Normal path: push master. Deploy API runs checks and build, then waits for the production
      environment's reviewer; approve it. The new first step fails fast if the secret is missing (create
      it, then "Re-run failed jobs"); then migrations, hook guard, config push, API, worker.
   b. Auth config only, without a release: with the same exports as step 3 run
        supabase config push --project-ref qjjhtduxquvlfppybpqq
      and answer yes to the SMTP and rate-limit changes only. Push master afterwards as in (a).

5. Re-check the redirect allow-list. supabase config push re-applies [remotes.production.auth]
   additional_redirect_urls from the file and drops the runtime per-domain entries that the API and the
   worker add (docs/DEPLOY.md, WR-09). Production's list was found holding ONLY the platform host's
   https://rede-social-woad.vercel.app/auth/confirm** on 2026-10-22 (none of the 5 verified tenant hosts;
   the cause is being investigated separately), and with a tenant host missing its redirect_to falls back
   to site_url, so the Send Email Hook refuses the mail with redirect_host_not_tenant (D-23) and answers
   500. After the push: open Dashboard -> Authentication -> URL Configuration -> Redirect URLs, confirm one
   https://<host>/auth/confirm** entry per verified tenant host, and re-add any that is missing; or roll
   the worker so reconcileAuthAllowList runs at boot. Do this before the smoke test in step 6. This
   change adds no tenant host to config.toml.

6. Verify:
     supabase config diff --project-ref qjjhtduxquvlfppybpqq --exit-code
   Exit 0 means production matches the file; after step 5 a difference that lists only the redirect URL
   list is expected (the runtime per-domain entries are not in the file). Dashboard -> Authentication ->
   Rate Limits shows 100 e-mails per hour. Smoke test on a TENANT host whose entry is in the allow-list
   (not the platform host: that is the separate redirect_host_not_tenant case): request a password
   recovery for a mailbox you own three times, 60+ seconds apart. No request answers 429, three mails
   arrive in the tenant's brand, the API logs show mail.sent three times, and Supabase Logs (auth) show no
   over_email_send_rate_limit.

7. Rollback: revert the commit and push; the remote rate-limit table is gone, so email_sent inherits 2
   again. The SMTP block is NOT removed by that push (config push leaves properties the file does not
   declare unchanged): to switch it off set enabled = false in the SMTP table and push, then revoke
   supabase-auth-smtp-prod in Resend.
```

### Resend

- Verify `mail.<platform-domain>` (SPF + DKIM records from the Resend dashboard) before switching
  `MAIL_TRANSPORT` to `resend`; the `From` address is `no-reply@` that subdomain.
- Production's `[remotes.production.auth.email.smtp]` points at `smtp.resend.com` port 465 (user
  `resend`; the password is a Resend API key held in the GitHub environment secret
  `RESEND_SMTP_PASS`) and exists only to unlock `[auth.rate_limit] email_sent`. While the hook is
  enabled every mail still leaves through the API and the Resend HTTP API; GoTrue would use the
  SMTP only if the hook were disabled.

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
| An account that existed before reports `email_not_confirmed` at sign-in after the config push | GoTrue / web | The backfill (`20261007153044_confirm_existing_auth_emails.sql`) was not applied, or the account is newer than its cutoff, or it is a pending invite. Apply the migration, or confirm that single account with a one-off targeted update; never remove the cutoff |
| `over_email_send_rate_limit` locally | GoTrue / web logs | `[auth.rate_limit] email_sent` (per hour) was exhausted by repeated sign-ups or resends in e2e; raise that key in `supabase/config.toml` and restart the stack |
| `429 over_email_send_rate_limit` in production on `/recover`, `/invite`, `/resend` or sign-up confirmation | Supabase auth logs / web | The project-wide hourly sum reached `[remotes.production.auth.rate_limit] email_sent`. The counter adds every tenant and every action type, and a request counts even when the hook then answers 500, so a burst of failing calls drains it too (a 500 `redirect_host_not_tenant` and a 429 often appear together, and the 500 still consumes quota). Wait for the hour to roll over, find what burned it in the auth logs (path and status per request), and raise the value only if the load is legitimate. At the old value 2 the whole project allowed two mails an hour |
| Dashboard still shows 2 e-mails an hour after a deploy, or `supabase config diff` still lists the SMTP and rate-limit keys | Dashboard / CLI | The push did not apply: the job stopped at "Require the auth SMTP password" because the secret is missing, or the production run was never approved. Create `RESEND_SMTP_PASS` and re-run the failed job |
| GoTrue logs an SMTP error (authentication failed or sender rejected) | Supabase auth logs | Possible only when the hook is disabled or bypassed: `RESEND_SMTP_PASS` was revoked, or `admin_email` is not on the verified Resend domain. The hook path is unaffected |
| No mail at all, GoTrue template arrives instead | Mailbox | The hook block is disabled → GoTrue's SMTP fallback (`supabase/templates/recovery.html`, neutral platform). Enable the block and restart / `config push`. In production the fallback sender is now the custom SMTP block with the pinned hosted default template, not the local neutral file |

Log lines (`event`): `mail.sent`, `mail.duplicate_suppressed`, `mail.refused`,
`mail.signature_rejected`, `mail.send_failed` — each carries `webhookId`, `actionType`, `tenantId`
(when resolved), `requestId` and a masked recipient; never the token, the token hash or the link.
