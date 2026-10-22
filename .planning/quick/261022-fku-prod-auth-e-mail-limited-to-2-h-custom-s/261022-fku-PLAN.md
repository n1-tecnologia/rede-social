---
phase: quick-261022-fku
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (the production config blocks and their regression pin)
  - supabase/config.toml
  - apps/api/tests/unit/production-auth-config.test.ts
  # Task 2 (the deploy wiring of the new secret; the pin gains its workflow half)
  - .github/workflows/deploy-api.yml
  # Task 3 (the documentation and the operator runbook)
  - docs/deploy/auth-mail.md
  - docs/DEPLOY.md
autonomous: true
requirements: [TENANT-06]
tags: [auth, e-mail, rate-limit, smtp, resend, supabase, production, deploy, quick]

user_setup:
  - service: resend
    why: "Supabase Auth only lets a project change [auth.rate_limit] email_sent when it has its own SMTP server. The block added by this change authenticates to smtp.resend.com with a Resend API key used as the SMTP password. Claude cannot create vendor API keys or GitHub environment secrets, and no task may call production, so Igor does both before anything is pushed."
    env_vars:
      - name: RESEND_SMTP_PASS
        source: "Resend Dashboard -> API Keys -> Create API Key (name supabase-auth-smtp-prod, permission Sending access, domain n1marketingdigital.com.br); then `gh secret set RESEND_SMTP_PASS --env production` (GitHub environment secret of the production environment, NOT a repository secret)"
    dashboard_config:
      - task: "Note the Resend plan's daily and monthly send quota: email_sent = 100 per hour is only sustainable on a plan whose quota can carry it"
        location: "Resend Dashboard -> Settings / Usage"

estimate:
  tokens: 30000
  raw_tokens: 30000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "supabase/config.toml [remotes.production] gains exactly two tables: [remotes.production.auth.email.smtp] (enabled, smtp.resend.com, port 465, user resend, pass = env(RESEND_SMTP_PASS), admin_email no-reply@n1marketingdigital.com.br, sender_name Rede Social) and [remotes.production.auth.rate_limit] with email_sent = 100. The change is additive: zero deleted lines, so the Send Email Hook block, the two disabled access hooks and the pinned recovery template stay byte-identical."
    - "The Send Email Hook stays the only sender. The SMTP block exists only to unlock the email_sent field; the config comment, the docs and the regression test all say and pin that."
    - "The SMTP password is never a literal in git: the config holds only the env() reference, the workflow only secrets.RESEND_SMTP_PASS, and the docs only the secret's name. A unit test pins the env() reference and scans config.toml and the workflow for a Resend-key-shaped token."
    - "deploy-api.yml fails the production job BEFORE the migrations when the GitHub environment secret RESEND_SMTP_PASS is empty, and passes it to the two Supabase CLI steps (migrations/link and config push) next to SEND_EMAIL_HOOK_SECRETS. No Cloud Run env var or secret mapping changes."
    - "A hermetic Vitest file under apps/api/tests/unit (runs in pnpm turbo test and CI's static job, no database, no stack) pins: smtp table values, env() pass, email_sent between 30 and 500, max_frequency 60s and enable_confirmations kept, hook enabled with the Cloud Run https uri and env() secret, admin_email = no-reply@ + the MAIL_DOMAIN of deploy-api.yml, and the three workflow wiring points."
    - "docs/deploy/auth-mail.md documents the new block, the rate limit and its rationale, the secret, the rollback semantics and the ordered runbook for Igor; adds Failure modes rows for 429 over_email_send_rate_limit in production (project-wide sum, failed hook calls also count, cross-referencing the redirect_host_not_tenant row); warns in the runbook that supabase config push drops the runtime redirect allow-list entries and says how to re-check and restore them (QD-10); and the Resend subsection no longer says custom SMTP is only used when the hook is off. docs/DEPLOY.md's production GitHub secrets table names RESEND_SMTP_PASS instead of the stale RESEND_API_KEY row."
    - "Nothing is run against production or GitHub: no supabase config push/db push/link, no gcloud, gh or vercel call, no database. Verification is local and read-only (TOML parse, the global brew supabase CLI loading a scratch copy under a throwaway project id, Vitest, Biome, tsc). Three path-scoped local commits, none with a Claude co-author trailer."
  artifacts:
    - path: "supabase/config.toml"
      provides: "the production SMTP block and the email_sent override"
      contains: "[remotes.production.auth.rate_limit]"
    - path: "apps/api/tests/unit/production-auth-config.test.ts"
      provides: "the hermetic regression pin for the production auth e-mail config and its workflow wiring"
      contains: "RESEND_SMTP_PASS"
    - path: ".github/workflows/deploy-api.yml"
      provides: "the fail-fast secret guard and the secret reaching both Supabase CLI steps"
      contains: "Require the auth SMTP password"
    - path: "docs/deploy/auth-mail.md"
      provides: "the rationale, the failure modes and Igor's runbook"
      contains: "quick 261022-fku"
    - path: "docs/DEPLOY.md"
      provides: "the production GitHub environment secret inventory entry for RESEND_SMTP_PASS"
      contains: "RESEND_SMTP_PASS"
  key_links:
    - from: "supabase/config.toml [remotes.production.auth.email.smtp] pass = env(RESEND_SMTP_PASS)"
      to: ".github/workflows/deploy-api.yml env of the guard, Migrations and Push steps"
      via: "the same variable name; a mismatch would push an SMTP block with an empty password and say nothing"
      pattern: "RESEND_SMTP_PASS"
    - from: "supabase/config.toml admin_email"
      to: ".github/workflows/deploy-api.yml MAIL_DOMAIN (api and worker) and packages/core/server/mail/index.ts From"
      via: "no-reply@ + MAIL_DOMAIN is the sender the hook already uses; the SMTP identity must agree with it"
      pattern: "n1marketingdigital.com.br"
    - from: "docs/deploy/auth-mail.md runbook"
      to: "docs/DEPLOY.md production GitHub environment secrets table"
      via: "both name RESEND_SMTP_PASS as the secret Igor creates"
      pattern: "RESEND_SMTP_PASS"
---

<objective>
Production (Supabase project `qjjhtduxquvlfppybpqq`) allows only 2 auth e-mails per hour for the WHOLE
project: signup, recover, invite and resend are one shared sum, and a request counts even when the Send
Email Hook then answers 500. Evidence in the auth logs: 2026-10-20 22:14-22:43 (`/invite`: 2x 500 from the
hook, then 10x 429) and 2026-10-22 12:52-13:58 (`/recover`: 2x 500, 3x 429, 1x 500). That is
`429 over_email_send_rate_limit` on password recovery, invites and confirmation resends.

Cause (read from the live tree): `supabase/config.toml` base `[auth.rate_limit] email_sent = 2` (line ~262)
is inherited by `[remotes.production]`, which has no override, so every `supabase config push` re-asserts 2.
Supabase lets a project change that field only when it has its own SMTP server, even with the Send Email
Hook enabled.

Purpose: unlock and raise the ceiling without changing who sends the mail. The hook (API on Cloud Run ->
Resend HTTP API) stays the only sender; the new SMTP block is there solely so the rate-limit field becomes
writable.

Output: two additive tables in `supabase/config.toml`, a hermetic regression pin, the secret wired into
`deploy-api.yml` with a fail-fast guard, and the documentation plus an ordered runbook for Igor. Three
path-scoped local commits. Nothing is pushed, deployed or run against production.

**Shape.** Task 1 is the tracer (`type="tracer"`): the one path config.toml -> the Supabase CLI's own
loader -> the Vitest pin, production-quality, proven end to end offline. Task 2 expands it to the deploy
layer, Task 3 to the documentation.

**Decisions recorded here (planner, from live files read at planning time):**

- QD-01 `email_sent = 100`. Floor is 30 (Supabase's own default once custom SMTP exists). Too low is itself a
  denial of service for recovery (one shared bucket for ~7 pilot tenants), and 30 is exhausted by a single
  tenant importing or inviting a batch, or by a launch-hour burst of sign-up confirmations
  (`enable_confirmations = true` makes every new member one mail). Too high removes the flood cap. 100 is
  about 3x the floor, still a hard bound (at most 2,400 mails a day if sustained, visible in Resend usage
  and in `over_email_send_rate_limit` long before it matters), and each address stays limited to one mail a
  minute by the per-user `max_frequency = "60s"`, which this change keeps and pins. The Resend plan's quota
  is not discoverable from the repo: Igor confirms it (user_setup) and the doc says how to raise or lower the
  value.
- QD-02 Secret name `RESEND_SMTP_PASS`, a NEW GitHub environment secret of the `production` environment.
  The password is a Resend API key, and the recommendation is a dedicated key (name
  `supabase-auth-smtp-prod`, Sending access, restricted to `n1marketingdigital.com.br`) rather than the value of
  `resend-api-key-prod`: it is stored by GitHub and by Supabase's project config, so it should be revocable on
  its own without touching the API's key. `docs/DEPLOY.md` line ~201 lists `RESEND_API_KEY` as the GitHub secret
  for "Custom SMTP, D-13", but `deploy-api.yml` never read it (the row says it is not needed while e-mail was
  deferred); Task 3 replaces that stale row with `RESEND_SMTP_PASS`.
- QD-03 Sender identity. `MAIL_DOMAIN=n1marketingdigital.com.br` on both `api` and `worker` in
  `deploy-api.yml` (and `docs/DEPLOY.md` line ~86: the verified Resend sending domain, no `mail.` subdomain in
  production), so `admin_email = "no-reply@n1marketingdigital.com.br"`, the same mailbox the hook already
  uses (`packages/core/server/mail/index.ts` builds `no-reply@${env.MAIL_DOMAIN}`). `sender_name = "Rede Social"`
  is the platform name (the mail footer says "Enviado pela plataforma Rede Social"); the tenant's display name
  is applied by the hook, which is the sender. Nothing here is unknown, so nothing is flagged for Igor to
  confirm; a unit test compares `admin_email` with the workflow's `MAIL_DOMAIN` so they cannot drift.
- QD-04 Placement and immutability. The two tables are inserted after the access-hook blocks and before the
  pinned recovery-template comment, so the diff is purely additive. The hook block, the two disabled access
  hooks and the template pin are not edited; the verify gate requires zero deleted lines. The template pin's
  own comment says to drop it "when custom SMTP lands": the new block's comment explains why the pin stays
  (the hook renders every mail, GoTrue's template is never used, dropping it would only push a template diff).
- QD-05 Fail fast, in three places. (a) A new first step of the production job fails before the migrations
  when `secrets.RESEND_SMTP_PASS` is empty: a secret that does not exist resolves to an empty string, which
  would push an enabled SMTP block with no password. (b) The same variable is exported to the `Push auth
  configuration` step (required). (c) It is also exported to the `Migrations (roles included)` step as a
  precaution: that step links the project and runs `db push`, and the existing comment records that the CLI
  validates the hook block on every command; whether a linked CLI also resolves a remote table's `env()` there
  cannot be proven offline (probe below), and exporting it costs one line. The test counts the references so
  the secret cannot spread to Cloud Run.
- QD-06 What offline validation can and cannot prove (probed 2026-10-22 with the global brew CLI 2.118.0 and
  the repo-pinned 2.117.0, scratch config under a throwaway project id, never the live local stack): both
  load the file with the new tables and with `RESEND_SMTP_PASS` unset, so no local, CI or hml CLI command needs
  the variable; a wrong TYPE inside a remote table (port as a string) is rejected at load
  (`CliConfigParseError`); but an UNKNOWN KEY or a missing `host` in a remote table is silently accepted by
  `status`, even with a simulated link. So key names are checked against a fresh `supabase init` template
  (every key of both tables must exist there, commented keys included) and by the unit test. Real validation
  of the remote semantics happens only at `supabase config diff` / `push` against the remote, which are Igor's
  steps 3, 4 and 6. `config diff` is read-only but calls the Management API, so no task runs it.
- QD-07 Release path. `deploy-api.yml`'s `paths` filter contains `supabase/**` and the workflow itself, so a
  push of this change to master runs `Deploy API` (checks, build, then the `production` environment's
  reviewer). That is the normal path to apply it and it also redeploys the API and worker. Because the job also
  re-runs migrations and the hook guard, the runbook offers an auth-config-only manual push as a second path;
  both start with `config diff`.
- QD-08 Rollback semantics (from `supabase config push --help`: "Properties the file does not declare are left
  unchanged"). Removing `[remotes.production.auth.rate_limit]` makes `email_sent` inherit the base 2 again at
  the next push, but removing the SMTP table does NOT switch the remote SMTP off: set `enabled = false`
  explicitly, push, then revoke the Resend key. Documented in Task 3.
- QD-09 Out of scope: the second cause (the hook answering 500 on `/recover` from the platform host
  `rede-social-woad.vercel.app` through the D-23 `redirect_host_not_tenant` rule) is not touched; it waits for
  the Cloud Run logs to confirm it. The runbook's smoke test therefore uses a tenant host. Also out of scope:
  per-IP throttling of `/esqueci-senha`, a `[remotes.homolog]` table (one created later must repeat both new
  tables and its own `RESEND_SMTP_PASS`; documented), and editing `deploy-hml.yml` or `docs/LOCAL-SETUP.md`.
- QD-10 Redirect allow-list warning (coordinator addendum, documentation only). A read-only probe of
  `/auth/v1/verify` found production's `uri_allow_list` holding ONLY
  `https://rede-social-woad.vercel.app/auth/confirm**`; none of the 5 verified tenant hosts is in it, so a
  tenant-host `redirect_to` falls back to `site_url` and the hook refuses with `redirect_host_not_tenant`
  (D-23) and answers 500. The cause of the missing entries is investigated separately: this quick does NOT fix
  it, adds no tenant host to `config.toml`, and touches none of `reconcile-allow-list.ts`, `auth-allow-list.ts`
  or `worker.ts`. What it does change is the runbook and the docs: `config push` re-applies
  `[remotes.production.auth] additional_redirect_urls` and drops the runtime per-domain entries
  (`docs/DEPLOY.md`, WR-09, which already says the list must be reviewed after every push), so runbook step 5
  re-checks Dashboard -> Authentication -> URL Configuration -> Redirect URLs, re-adds
  `https://<host>/auth/confirm**` per verified tenant host or rolls the worker so `reconcileAuthAllowList` runs
  at boot, and runs before the smoke test. Step 6 expects a `config diff` that lists only the redirect URL list
  once the runtime entries are back. The new 429 Failure modes row cross-references the existing
  `redirect_host_not_tenant` row, because the hook's 500 still consumes quota and the two appear together.

**Request coverage (quick has no ROADMAP section, CONTEXT or RESEARCH to audit):**

| Request item | Covered by |
|---|---|
| `[remotes.production.auth.email.smtp]` Resend SMTP, pass via env(), identity coherent with MAIL_DOMAIN | Task 1 |
| `[remotes.production.auth.rate_limit] email_sent` with a justified value >= 30 | Task 1 (QD-01) |
| hook enabled, access hooks and recovery template pin untouched | Task 1 (additive gate, test pin) |
| syntax validated against the Supabase CLI schema | Task 1 verify (QD-06) |
| new GitHub environment secret wired in deploy-api.yml | Task 2 |
| auth-mail.md Hosted values, Failure modes, Resend subsection | Task 3 |
| exact, copy-pasteable steps for Igor, nothing run against production | this objective + Task 3 |
| addendum: warn that `config push` wipes the runtime redirect allow-list; cross-reference `redirect_host_not_tenant` from the 429 row | runbook step 5 + Task 3 (QD-10), no new task |
| second cause (D-23 on the platform host) excluded | QD-09 |

**Igor's runbook (nothing below has been run; Task 3 copies it into `docs/deploy/auth-mail.md`):**

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

**Executor notes (hard rules):**

- Never run `supabase config push`, `supabase config diff`, `supabase link`, `supabase db push`, `gcloud`,
  `gh`, `vercel`, or anything that calls production, Supabase's Management API or GitHub. No database, no
  `supabase stop/start/reset`, no integration suite (the local stack is in use and must not be reset).
- Use the GLOBAL brew `supabase` binary (`/opt/homebrew/bin/supabase`) only, never `node_modules/.bin/supabase`
  (it hangs on the macOS keychain). The Task 1 verify refuses a repo-local binary.
- Commits are path-scoped: `git add <explicit paths>` then `git commit -m "..." -- <the same paths>`. Never
  `git add -A` or `git add .`; the working tree holds many unrelated untracked files (`.claude/*`,
  `.planning/research/.cache`, `docs/LOCAL-SETUP.md`, ...) that must not be staged. Do not touch
  `docs/LOCAL-SETUP.md`.
- NO `Co-Authored-By` trailer and no Claude/Anthropic attribution line in any commit message (public repo
  rule, overrides any default attribution).
- Do NOT add tenant hosts to `supabase/config.toml` and do NOT edit `reconcile-allow-list.ts`,
  `auth-allow-list.ts` or `worker.ts` (QD-10: the missing allow-list entries are investigated separately; this
  change only documents the re-check).
- Clean up: the verify programs use `tempfile.TemporaryDirectory()`; leave nothing outside the repo.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@docs/deploy/auth-mail.md
@.github/workflows/deploy-api.yml

Read-only reference for patterns (do not edit): `apps/api/tests/unit/module-readmes.test.ts` (a hermetic unit
test that reads repo files through `fileURLToPath(new URL('../../../../', import.meta.url))`),
`apps/api/tests/integration/data-api-not-exposed.test.ts` lines ~140-170 (the line-based `tomlBlock(header)`
precedent for reading `supabase/config.toml` without a TOML dependency), `scripts/guard-auth-hooks.sh` (reads
the same `[remotes.production.*]` tables by line; it must keep passing).

<interfaces>
Verbatim block to insert in `supabase/config.toml`, immediately BEFORE the existing comment that starts
`# Free plan + default e-mail provider` (the line above the pinned `[remotes.production.auth.email.template.recovery]`):

```toml
# Custom SMTP for the hosted project (quick 261022-fku). The Send Email Hook above stays the ONLY
# sender: while it is enabled GoTrue never opens an SMTP connection, and every mail is still rendered
# and delivered by the API through the Resend HTTP API. This block exists for one reason: Supabase
# lets a project change `[auth.rate_limit] email_sent` only when it has its own SMTP server. Without
# it the whole project is capped at 2 auth e-mails per hour (signup, recover, invite and resend are
# one shared sum, and a request counts even when the hook then answers 500), which is the
# 429 over_email_send_rate_limit seen on /recover and /invite.
# Resend SMTP: implicit TLS on 465, the user is the literal `resend`, the password is a Resend API
# key (sending access, restricted to the verified domain) that lives ONLY in the GitHub environment
# secret RESEND_SMTP_PASS and reaches the CLI through env(): it is never written in this file.
# `admin_email` is the sender the hook already uses (`no-reply@` + MAIL_DOMAIN in deploy-api.yml);
# change both together (apps/api/tests/unit/production-auth-config.test.ts compares them).
# The pinned `auth.email.template.recovery` below stays: the hook renders every mail, so GoTrue's own
# template is never used and dropping the pin would only push a template diff for nothing.
[remotes.production.auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_SMTP_PASS)"
admin_email = "no-reply@n1marketingdigital.com.br"
sender_name = "Rede Social"

# Project-wide ceiling on auth e-mails per hour, summed over every tenant (docs/deploy/auth-mail.md
# "Production e-mail rate limit"). 100 instead of the inherited 2: room for a launch-hour burst of
# sign-up confirmations plus invites and recoveries across the pilot tenants, still a hard cap on a
# flood. Too low is itself a denial of service for recovery, so read that section before lowering it.
# The per-person floor stays `max_frequency = "60s"` in `[remotes.production.auth.email]`.
[remotes.production.auth.rate_limit]
email_sent = 100

```

Workflow edits for `.github/workflows/deploy-api.yml` (job `migrate-and-deploy-prod`; step list items are
indented 6 spaces, their keys 8, env entries 10):

1. A new step between `Empty signing-keys file for the CLI (config.toml references it)` and
   `Migrations (roles included)`, with its comment block above it:

```yaml
      # quick 261022-fku: [remotes.production.auth.email.smtp] in supabase/config.toml reads its password
      # through env(RESEND_SMTP_PASS). A GitHub secret that does not exist resolves to an empty string, which
      # would push an enabled SMTP block with no password, so fail here, before the migrations, instead.
      - name: Require the auth SMTP password
        env:
          RESEND_SMTP_PASS: ${{ secrets.RESEND_SMTP_PASS }}
        run: |
          if [ -z "$RESEND_SMTP_PASS" ]; then
            echo "::error::GitHub environment secret RESEND_SMTP_PASS is not set on the production environment. Create it, then re-run this job (docs/deploy/auth-mail.md, Production e-mail rate limit)."
            exit 1
          fi
```

2. In the `env:` of `Migrations (roles included)` and of `Push auth configuration (Send Email Hook -> API)`,
   directly after the `SEND_EMAIL_HOOK_SECRETS:` entry, add (the comment line is part of the addition):

```yaml
          # The production remote table reads its SMTP password through env() (quick 261022-fku).
          RESEND_SMTP_PASS: ${{ secrets.RESEND_SMTP_PASS }}
```

No existing line of the workflow is edited or removed.
</interfaces>
</context>

<tasks>

<task type="tracer">
  <name>Task 1: End-to-end "unlock the production e-mail ceiling" - config blocks, CLI load, regression pin</name>
  <precondition>python3 >= 3.11 (`python3 -c "import tomllib"` succeeds) and `command -v supabase` resolves to the global brew binary, not a path under the repository.</precondition>
  <files>supabase/config.toml, apps/api/tests/unit/production-auth-config.test.ts</files>
  <read_first>
    supabase/config.toml lines 255-330 (base [auth.rate_limit] / [auth.email], the sample smtp block) and 520-574 (the whole [remotes.production] area); .github/workflows/deploy-api.yml lines 185-266 (MAIL_DOMAIN on api and worker); apps/api/tests/unit/module-readmes.test.ts lines 1-30 (repo-file reading pattern); apps/api/tests/integration/data-api-not-exposed.test.ts lines 140-170 (tomlBlock precedent); packages/core/server/mail/index.ts line ~228 (the From address the hook builds).
  </read_first>
  <action>
    Write the regression pin first, watch it fail, then add the config; one commit holds both.

    1. Create apps/api/tests/unit/production-auth-config.test.ts, hermetic like module-readmes.test.ts: only
       `node:fs`, `node:url` and `vitest`, no app import, no database, no network. Resolve the repo root with
       `fileURLToPath(new URL('../../../../', import.meta.url))`, read `supabase/config.toml` and
       `.github/workflows/deploy-api.yml` as text. Add a small line-based helper `tomlTable(header)` (the
       data-api-not-exposed.test.ts `tomlBlock` precedent, no TOML dependency) that finds the exact header line
       and returns a record of key to raw value for the non-comment, non-blank lines up to the next line that
       starts a table, with a trailing ` # comment` stripped; it throws a message naming the missing header so a
       deleted table reads clearly. One top-level `describe` titled for the production hosted auth e-mail config
       (quick 261022-fku) with these cases:
       - the `[remotes.production.auth.email.smtp]` table is enabled, host `smtp.resend.com`, port 465, user
         `resend`, a non-empty `sender_name`, and `admin_email` equal to `no-reply@` plus the domain.
       - the `pass` value is exactly the env() reference to RESEND_SMTP_PASS in quotes; every non-comment `pass`
         assignment anywhere in config.toml starts with an env() reference; and neither config.toml nor the
         workflow contains a Resend-key-shaped token (the `re_` prefix followed by 16 or more word characters).
         This is the guard that the credential never lands in git.
       - `[remotes.production.auth.rate_limit]` `email_sent` parses to an integer within 30 and 500 inclusive (the
         floor stops a revert to the starving value, the ceiling stops a typo from removing the flood cap).
       - `[remotes.production.auth.email]` still has `max_frequency = "60s"` and `enable_confirmations = true`
         (the per-person floor that bounds mail to one victim stays).
       - the Send Email Hook is still the sender: `[remotes.production.auth.hook.send_email]` is enabled, its uri
         starts with https and ends with `/v1/hooks/auth/send-email`, its secrets value is the env() reference to
         SEND_EMAIL_HOOK_SECRETS; and the workflow sets `MAIL_TRANSPORT=resend` for both services.
       - `admin_email` agrees with the workflow: every `MAIL_DOMAIN=` line in deploy-api.yml (api and worker) has the
         same value, and `admin_email` is `no-reply@` plus that value.
       Run `pnpm --filter @rede-social/api exec vitest run tests/unit/production-auth-config.test.ts`: it must FAIL
       because the smtp table does not exist yet (this is the red state; do not proceed on a pass).

    2. Edit supabase/config.toml with the single Edit tool call: insert the verbatim block from `<interfaces>`
       (the comment lines, `[remotes.production.auth.email.smtp]` and `[remotes.production.auth.rate_limit]`)
       immediately before the comment line that begins `# Free plan + default e-mail provider`. Do not edit,
       reorder or reformat any existing line: the Send Email Hook block, the two disabled access-hook blocks and
       the pinned `[remotes.production.auth.email.template.recovery]` stay byte-identical. The value 100 follows
       QD-01 and the host, port, user and identity follow QD-03; the pass is the env() reference only, per QD-02.
       The Send Email Hook remains the sole sender (QD-04); the SMTP block only unlocks the rate-limit field.

    3. Re-run the Vitest file: it must now pass. Run `pnpm --filter @rede-social/api exec biome check
       tests/unit/production-auth-config.test.ts` and fix formatting with `biome check --write` on that single file
       if needed, then `pnpm --filter @rede-social/api typecheck`.

    4. Run the offline end-to-end verify below (TOML values, the global brew CLI loading a scratch copy, key-name
       check against a fresh `supabase init` template), the additive-diff gate and `bash scripts/guard-auth-hooks.sh`.

    5. Commit: `git add supabase/config.toml apps/api/tests/unit/production-auth-config.test.ts`, then
       `git commit -m "feat(quick-261022-fku): custom SMTP and email_sent override for the production auth config" -- supabase/config.toml apps/api/tests/unit/production-auth-config.test.ts`.
       No Co-Authored-By trailer. Do not stage anything else.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/api exec vitest run tests/unit/production-auth-config.test.ts && pnpm --filter @rede-social/api exec biome check tests/unit/production-auth-config.test.ts && pnpm --filter @rede-social/api typecheck && bash scripts/guard-auth-hooks.sh && python3 -I -c '
import os, re, shutil, subprocess, sys, tempfile, tomllib
CFG = "supabase/config.toml"
ns = subprocess.check_output(["git", "diff", "--numstat", "--", CFG], text=True).split()
assert ns and ns[1] == "0" and int(ns[0]) >= 25, ("config.toml change must be additive-only", ns)
cfg = tomllib.load(open(CFG, "rb"))
prod = cfg["remotes"]["production"]["auth"]
smtp, rl = prod["email"]["smtp"], prod["rate_limit"]
assert smtp["enabled"] is True and smtp["port"] == 465 and smtp["user"] == "resend", smtp
assert smtp["host"] == "smtp.resend.com" and smtp["pass"] == "env(RESEND_SMTP_PASS)", smtp
assert smtp["admin_email"] == "no-reply@n1marketingdigital.com.br" and smtp["sender_name"], smtp
assert isinstance(rl["email_sent"], int) and 30 <= rl["email_sent"] <= 500, rl
assert prod["hook"]["send_email"]["enabled"] is True, "send_email hook must stay enabled"
assert prod["email"]["max_frequency"] == "60s" and prod["email"]["enable_confirmations"] is True
sb = shutil.which("supabase")
assert sb and not os.path.realpath(sb).startswith(os.getcwd()), "use the global brew supabase, not node_modules: %s" % sb
text = open(CFG).read()
PID = "project_id = \"rede-social\"\n"
assert text.count(PID) == 1
with tempfile.TemporaryDirectory() as work:
    load = os.path.join(work, "load")
    os.makedirs(os.path.join(load, "supabase"))
    shutil.copytree("supabase/templates", os.path.join(load, "supabase", "templates"))
    open(os.path.join(load, "supabase", "config.toml"), "w").write(text.replace(PID, "project_id = \"fku-probe-nonexistent\"\n"))
    open(os.path.join(load, "supabase", "signing_keys.json"), "w").write("[]\n")
    open(os.path.join(load, "supabase", "seed.sql"), "w").close()
    env = dict(os.environ, SEND_EMAIL_HOOK_SECRETS="v1,whsec_dHJpYS1sb2NhbC1zZW5kLWVtYWlsLWhvb2sta2V5MDE=")
    env.pop("RESEND_SMTP_PASS", None)
    r = subprocess.run([sb, "status", "--workdir", load], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
    out = r.stdout + r.stderr
    assert not re.search(r"ConfigLoadError|CliConfigParseError|failed to (read|parse)", out), out
    assert "DbInspectError" in out, out
    tpl = os.path.join(work, "tpl")
    os.makedirs(tpl)
    subprocess.run([sb, "init", "--workdir", tpl, "--force"], stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=True)
    lines = open(os.path.join(tpl, "supabase", "config.toml")).read().splitlines()
    def template_keys(header):
        start = next(i for i, l in enumerate(lines) if re.sub(r"^#\s*", "", l).strip() == header)
        keys = set()
        for l in lines[start + 1:]:
            bare = re.sub(r"^#\s*", "", l).strip()
            if not l.strip() or bare.startswith("["):
                break
            m = re.match(r"([a-z_0-9]+)\s*=", bare)
            if m:
                keys.add(m.group(1))
        return keys
    for header, table in (("[auth.email.smtp]", smtp), ("[auth.rate_limit]", rl)):
        unknown = set(table) - template_keys(header)
        assert not unknown, "%s: keys the CLI template does not know: %s" % (header, unknown)
print("ALL OK: toml values, CLI load, key names; email_sent =", rl["email_sent"])
'</automated>
  </verify>
  <done>
    supabase/config.toml has the two new production tables and nothing else changed (the numstat gate shows zero
    deleted lines and at least 25 added, which also holds the comment text). The hermetic Vitest file passes, was
    seen failing before the config edit, and is Biome- and tsc-clean. The global brew CLI loads a scratch copy of the
    file with RESEND_SMTP_PASS unset (no local, CI or hml command needs the variable), and every key of both tables
    exists in a fresh `supabase init` template. guard-auth-hooks.sh still passes. One path-scoped commit exists,
    with no co-author trailer.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire RESEND_SMTP_PASS into the production deploy with a fail-fast guard</name>
  <files>.github/workflows/deploy-api.yml, apps/api/tests/unit/production-auth-config.test.ts</files>
  <read_first>
    .github/workflows/deploy-api.yml lines 100-146 (the signing-keys step, Migrations, Auth hook guard, Push auth configuration) and the `<interfaces>` block of this plan (the verbatim step and env lines); apps/api/tests/unit/production-auth-config.test.ts as committed by Task 1.
  </read_first>
  <action>
    Extend the pin first, watch it fail, then edit the workflow.

    1. In apps/api/tests/unit/production-auth-config.test.ts add a second `describe` for the deploy wiring of the
       SMTP password. Add a helper that slices the workflow text into steps of the job `migrate-and-deploy-prod`:
       a step starts at a line matching six spaces, a dash, a space, then `name:` or `uses:`, and runs to the next
       such line (comment lines directly above a step belong to the previous slice; assert on the step body only).
       Cases: (a) a step named `Require the auth SMTP password` exists, comes before the step whose name starts
       with `Migrations`, and its body reads `${{ secrets.RESEND_SMTP_PASS }}`; (b) the `Migrations` step and the
       step whose name starts with `Push auth configuration` each assign `RESEND_SMTP_PASS` from the same secret
       expression; (c) the text `secrets.RESEND_SMTP_PASS` occurs exactly three times in the whole file, so the
       credential cannot spread to another step; (d) no Cloud Run `env_vars` or `secrets` mapping line assigns
       RESEND_SMTP_PASS with an equals sign (the deploy-cloudrun steps keep their lists unchanged). Run the Vitest
       file: the new cases must FAIL (red) before the workflow edit.

    2. Edit .github/workflows/deploy-api.yml with Edit calls, applying exactly the two additions in `<interfaces>`
       (the new fail-fast step with its comment block, and the one comment line plus one env line after
       `SEND_EMAIL_HOOK_SECRETS` in the Migrations step and in the Push auth configuration step). This implements
       QD-05: the guard fails the job before any migration is applied when the secret is empty, the Push step gets
       the credential `config push` needs for `pass = env(RESEND_SMTP_PASS)`, and the Migrations step gets it as the
       documented precaution. Do not edit, move or remove any existing line, and do not touch the api or worker
       `deploy-cloudrun` steps: the SMTP password is read only by the Supabase CLI, never by Cloud Run. Use `secrets.`
       (the GitHub environment secret), not `vars.`.

    3. Re-run the Vitest file (green), Biome and tsc on the test file as in Task 1, then the YAML and
       additive-diff gates below.

    4. Commit: `git add .github/workflows/deploy-api.yml apps/api/tests/unit/production-auth-config.test.ts`, then
       `git commit -m "ci(quick-261022-fku): pass RESEND_SMTP_PASS to the Supabase CLI steps and fail fast when it is missing" -- .github/workflows/deploy-api.yml apps/api/tests/unit/production-auth-config.test.ts`.
       No Co-Authored-By trailer.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/api exec vitest run tests/unit/production-auth-config.test.ts && pnpm --filter @rede-social/api exec biome check tests/unit/production-auth-config.test.ts && pnpm --filter @rede-social/api typecheck && python3 -I -c '
import subprocess, yaml
WF = ".github/workflows/deploy-api.yml"
ns = subprocess.check_output(["git", "diff", "--numstat", "--", WF], text=True).split()
assert ns and ns[1] == "0" and int(ns[0]) >= 12, ("workflow change must be additive-only", ns)
d = yaml.safe_load(open(WF))
steps = d["jobs"]["migrate-and-deploy-prod"]["steps"]
names = [s.get("name", "") for s in steps]
g = names.index("Require the auth SMTP password")
m = next(i for i, n in enumerate(names) if n.startswith("Migrations"))
p = next(i for i, n in enumerate(names) if n.startswith("Push auth configuration"))
assert g < m < p, (g, m, p)
ref = "${{ secrets.RESEND_SMTP_PASS }}"
for i in (g, m, p):
    assert steps[i]["env"]["RESEND_SMTP_PASS"] == ref, names[i]
for s in steps:
    if str(s.get("uses", "")).startswith("google-github-actions/deploy-cloudrun@"):
        blob = str(s["with"].get("env_vars", "")) + str(s["with"].get("secrets", ""))
        assert "RESEND_SMTP_PASS" not in blob
print("workflow ok: guard, migrations and push carry the secret; cloud run untouched")
'</automated>
  </verify>
  <done>
    deploy-api.yml parses as YAML, the new "Require the auth SMTP password" step precedes the migrations, the
    secret reaches exactly three steps (guard, Migrations, Push auth configuration) and neither Cloud Run step
    mentions it. The diff against HEAD is additive only. The extended Vitest file was red before the edit and is
    green, Biome- and tsc-clean. One path-scoped commit exists, with no co-author trailer.
  </done>
</task>

<task type="auto">
  <name>Task 3: Document the SMTP block, the rate limit, the failure modes and Igor's runbook</name>
  <files>docs/deploy/auth-mail.md, docs/DEPLOY.md</files>
  <read_first>
    docs/deploy/auth-mail.md lines 222-308 (Hosted values, Resend, Rotation, Failure modes) and the objective of this plan (the QD decisions and the numbered runbook that is copied into the doc); docs/DEPLOY.md lines 186-203 (the production GitHub environment secrets table).
  </read_first>
  <action>
    Edit with scoped Edit calls only (no whole-file Write); English prose, the file's existing tone, no emoji.

    1. docs/deploy/auth-mail.md, Hosted values. In the paragraph that says the deploy workflow runs
       `supabase config push` with the GitHub environment secret `SEND_EMAIL_HOOK_SECRETS`, add that it also
       needs `RESEND_SMTP_PASS` (next section). Then insert a new `###` subsection titled
       `Production e-mail rate limit (quick 261022-fku)` between the "Supabase project" subsection and `### Resend`.
       It must contain: (a) the symptom and cause (project-wide 2 per hour, signup/recover/invite/resend one sum,
       failed hook calls count, the two evidence windows, the base `email_sent = 2` inherited by the remote table and
       re-pushed on every deploy, Supabase only letting the field change with custom SMTP); (b) the shipped
       production TOML for both tables (same values as supabase/config.toml, with the pass shown as the env()
       reference only); (c) a short statement that the Send Email Hook is still the only sender and the SMTP block
       is used by GoTrue only if the hook is ever disabled; (d) the reasoning for `email_sent = 100` from QD-01 in
       two or three sentences, including that a lower value starves recovery, that `max_frequency = "60s"` still
       bounds one address, and how to change it (edit the value, the unit test accepts 30 to 500); (e) the secret:
       GitHub environment `production` secret `RESEND_SMTP_PASS`, a dedicated Resend key with Sending access on
       `n1marketingdigital.com.br`, distinct from `resend-api-key-prod`, the fail-fast step, and its rotation (create a
       new key, update the secret, run the deploy or the manual push, then revoke the old key); (f) that
       `admin_email` is `no-reply@` + `MAIL_DOMAIN` (`n1marketingdigital.com.br` in production) and the unit test
       keeps them equal; (g) that a `[remotes.homolog]` table, when created, must repeat both new tables because a
       remote inherits the base `email_sent = 2`, and the `homolog` GitHub environment needs its own
       `RESEND_SMTP_PASS`; (h) the rollback semantics from QD-08; (i) the numbered runbook copied from the objective
       of this plan (steps 1 to 7, commands unchanged, including the step 5 warning that the config push drops the
       runtime redirect allow-list entries), introduced as steps for Igor that the change itself never
       runs; (j) the offline-validation limit from QD-06 in two sentences (what is checked locally, and that remote
       semantics are only checked by `config diff`).

    2. docs/deploy/auth-mail.md, Resend subsection. Replace the whole bullet that begins with the words
       "Custom SMTP" followed by "(D-13)" with a bullet that states the new purpose: production's
       `[remotes.production.auth.email.smtp]` points at `smtp.resend.com` port 465 (user `resend`, the password is a
       Resend API key held in the GitHub environment secret `RESEND_SMTP_PASS`) and exists only to unlock
       `[auth.rate_limit] email_sent`; while the hook is enabled every mail still leaves through the API and the
       Resend HTTP API, and GoTrue would use the SMTP only if the hook were disabled.

    3. docs/deploy/auth-mail.md, Failure modes table (keep the three-column `| Symptom | Where | Meaning / fix |`
       style, one line per row, no pipes inside cells). Add: (a) `429 over_email_send_rate_limit` in production on
       `/recover`, `/invite`, `/resend` or sign-up confirmation: the project-wide hourly sum reached
       `[remotes.production.auth.rate_limit] email_sent`; the counter adds every tenant and every action type and a
       request counts even when the hook then answers 500, so a burst of failing calls drains it too; wait for the hour
       to roll over, find what burned it in the auth logs (path and status per request), raise the value only if the
       load is legitimate; at the old value 2 the whole project allowed two mails an hour; and cross-reference the
       existing `redirect_host_not_tenant` row by name in this row's text: a 500 from the hook and a 429 often
       appear together, and the 500 still consumes quota (QD-10); (b) the dashboard still
       showing 2 e-mails an hour after a deploy, or `supabase config diff` still listing the SMTP and rate-limit keys:
       the push did not apply (the job stopped at "Require the auth SMTP password" because the secret is missing, or
       the production run was never approved); create the secret and re-run the failed job; (c) GoTrue logging an SMTP
       error (authentication failed or sender rejected): possible only when the hook is disabled or bypassed;
       `RESEND_SMTP_PASS` revoked, or `admin_email` not on the verified Resend domain; the hook path is unaffected.
       Then extend the existing row about "No mail at all, GoTrue template arrives instead" with one sentence: in
       production the fallback sender is now the custom SMTP block with the pinned hosted default template, not the
       local neutral file. Leave the existing local `over_email_send_rate_limit` row as it is.

    4. docs/DEPLOY.md. In the production GitHub environment secrets table (the two-column table that lists
       `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, ..., `SEND_EMAIL_HOOK_SECRETS`), replace the
       `RESEND_API_KEY` row, which claims the secret feeds a Custom SMTP block while e-mail was deferred, with a
       `RESEND_SMTP_PASS` row: used by the "Require the auth SMTP password" step and the two Supabase CLI steps of
       deploy-api.yml; the password of `[remotes.production.auth.email.smtp]`; a Resend API key with sending access
       on `n1marketingdigital.com.br`, separate from `resend-api-key-prod`; it only unlocks `email_sent`, mail still
       leaves through the Send Email Hook; see docs/deploy/auth-mail.md (quick 261022-fku). Keep two cells and no pipe
       inside the cell text. Change nothing else in DEPLOY.md.

    5. Commit: `git add docs/deploy/auth-mail.md docs/DEPLOY.md`, then
       `git commit -m "docs(quick-261022-fku): document the production auth SMTP block, the e-mail rate limit and the rollout runbook" -- docs/deploy/auth-mail.md docs/DEPLOY.md`.
       No Co-Authored-By trailer. Do not stage docs/LOCAL-SETUP.md or any untracked file.
  </action>
  <verify>
    <automated>python3 -I -c '
import re
doc = open("docs/deploy/auth-mail.md").read()
dep = open("docs/DEPLOY.md").read()
for needle in ("Production e-mail rate limit", "quick 261022-fku", "[remotes.production.auth.email.smtp]", "[remotes.production.auth.rate_limit]", "email_sent = 100", "RESEND_SMTP_PASS", "gh secret set RESEND_SMTP_PASS --env production", "supabase config diff --project-ref qjjhtduxquvlfppybpqq", "n1marketingdigital.com.br", "supabase-auth-smtp-prod", "enabled = false"):
    assert needle in doc, needle
assert doc.count("over_email_send_rate_limit") >= 4, doc.count("over_email_send_rate_limit")
assert "may keep pointing at the same domain" not in doc, "old Resend bullet still present"
for needle in ("URL Configuration", "reconcileAuthAllowList", "additional_redirect_urls", "https://<host>/auth/confirm**"):
    assert needle in doc, needle
r429 = [l for l in doc.splitlines() if l.startswith("|") and "429" in l and "over_email_send_rate_limit" in l and "production" in l]
assert r429 and all("redirect_host_not_tenant" in l for l in r429), "the production 429 row must cross-reference redirect_host_not_tenant"
fm = doc[doc.index("## Failure modes"):]
rows = [l for l in fm.splitlines() if l.startswith("|")]
assert len({l.count("|") for l in rows}) == 1, "Failure modes rows have different cell counts"
assert "RESEND_SMTP_PASS" in dep, "DEPLOY.md lacks the new secret row"
assert "not needed while e-mail is deferred" not in dep, "stale RESEND_API_KEY row still present"
tbl = [l for l in dep.splitlines() if l.startswith("|") and ("`SEND_EMAIL_HOOK_SECRETS` |" in l or "`RESEND_SMTP_PASS` |" in l or "`SUPABASE_ACCESS_TOKEN` |" in l)]
assert tbl and len({l.count("|") for l in tbl}) == 1, "secrets table rows have different cell counts"
for name, text in (("auth-mail.md", doc), ("DEPLOY.md", dep)):
    assert not re.search(r"\bre_[A-Za-z0-9]{16,}", text), name + " carries a Resend-key-shaped token"
import subprocess
changed = set(subprocess.check_output(["git", "diff", "--name-only", "--", "docs"], text=True).split())
assert changed == {"docs/DEPLOY.md", "docs/deploy/auth-mail.md"}, changed
print("docs ok")
'</automated>
  </verify>
  <done>
    auth-mail.md explains the SMTP block, the 100/hour ceiling and its rationale, the secret and its rotation, the
    rollback semantics, the homolog caveat and the seven-step runbook (with the redirect allow-list re-check after the
    push); its Failure modes table has the production 429
    row (project-wide sum, failed hook calls also count), the not-applied-push row and the SMTP-error row, with
    consistent cell counts; the Resend subsection explains the SMTP's real purpose. DEPLOY.md names RESEND_SMTP_PASS
    instead of the stale row. No secret-shaped token appears. One path-scoped commit exists, with no co-author
    trailer, and docs/LOCAL-SETUP.md is still untracked and untouched.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repository / GitHub Actions -> Supabase Management API | `supabase config push` carries the SMTP password (a send-scope Resend credential) and the e-mail rate limit from the repo and the `production` environment to the hosted project |
| anonymous internet -> `/recover`, `/resend`, `/invite` request paths | unauthenticated callers can make Supabase Auth attempt to send mail to any address; every attempt counts against the project-wide hourly ceiling |
| Supabase Auth -> Send Email Hook (Cloud Run API) -> Resend HTTP API | the only sender path; authenticated by the Standard Webhooks signature |
| Supabase Auth -> Resend SMTP (smtp.resend.com:465) | secondary path, used only if the hook is disabled; authenticated by the SMTP password |

ASVS level 1, blocking threshold `high`. No package is installed by this change, so no `T-fku-SC` supply-chain row applies.

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-fku-01 | Information disclosure | The Resend SMTP credential (config.toml `pass`, deploy-api.yml, docs, logs) | high | mitigate | config.toml holds only `env(RESEND_SMTP_PASS)`; the workflow holds only `secrets.RESEND_SMTP_PASS`; docs hold only the secret's name. The unit test pins the exact env() reference, requires every non-comment `pass` assignment to be an env() reference and scans config.toml and the workflow for a Resend-key-shaped token; the Task 3 verify scans the docs too. The secret is a GitHub environment secret of `production` (required reviewer; fork pull requests get none), a dedicated key restricted to the sending domain, revocable without touching `resend-api-key-prod`. The guard step prints only the secret's NAME, never its value; GitHub masks registered secrets in logs; the runbook tells Igor not to paste `config diff` output |
| T-fku-02 | Denial of service | The project-wide `email_sent` bucket (recovery, invites, confirmations starved) | medium | mitigate | Raise the ceiling from 2 to 100 so a handful of requests cannot starve every tenant (QD-01); the unit test pins 30 to 500 so a revert to the starving value fails CI; the failed-hook-calls-also-count behaviour and the response are documented as Failure modes rows; `over_email_send_rate_limit` in the auth logs is the signal |
| T-fku-03 | Denial of service / abuse | Email-bombing a victim or burning the Resend quota through `/recover`, `/resend`, `/invite` | medium | mitigate | The per-user `max_frequency = "60s"` in the production email table is kept and pinned by the unit test (at most one mail a minute to one address); the global ceiling of 100 bounds the Resend burn to 2,400 a day and keeps it visible; mail goes only to the owner of the address and its content and redirect target are server-controlled (hook templates, `mailReturnOrigin`, the redirect allow-list), so the attacker gains nothing beyond volume |
| T-fku-04 | Denial of service | Residual: one attacker sending at the per-address floor to a few addresses can still occupy most of the 100-per-hour pool | medium | accept | A global ceiling is Supabase's design; raising it further only raises the flood bound. Per-IP throttling of `/esqueci-senha` and per-address web cooldowns are not part of this change and are a candidate follow-up. Accepted because it is below the `high` threshold and strictly better than the current 2 |
| T-fku-05 | Spoofing / Tampering | A second sender path (the new SMTP block) bypassing the hook's tenant-resolution and refusal rules (D-23, `redirect_host_not_member`) if the hook were disabled | medium | mitigate | The Send Email Hook is pinned enabled in production with its https uri and env() secret by the unit test, and `scripts/guard-auth-hooks.sh` keeps running in the deploy; the config comment, the docs and the Failure modes row state that the SMTP is used only when the hook is off, and that the fallback is the pinned hosted default template. The hook, the two access hooks and the template pin are byte-identical (additive-diff gate) |
| T-fku-06 | Elevation of privilege | The secret exposed to an untrusted workflow run (fork pull request, other job) | medium | mitigate | `RESEND_SMTP_PASS` is an environment secret of `production`, readable only by jobs that declare `environment: production` (the master-push production job); the unit test counts exactly three references in deploy-api.yml and forbids it in any Cloud Run env or secret mapping |
| T-fku-08 | Denial of service | `config push` re-applies `additional_redirect_urls` and drops the runtime per-domain redirect allow-list entries, so tenant-host mails are refused (`redirect_host_not_tenant`, 500) and each refusal still consumes the e-mail quota | medium | mitigate | Runbook step 5 (and the docs section) require re-checking Dashboard -> Authentication -> URL Configuration -> Redirect URLs after the push and re-adding `https://<host>/auth/confirm**` per verified tenant host, or rolling the worker so `reconcileAuthAllowList` runs at boot; step 6 runs the smoke test only after that. The separate cause of the currently missing tenant entries is out of scope (QD-10) |
| T-fku-07 | Repudiation | An unreviewed change to the production e-mail ceiling or SMTP block | low | accept | Changes land as reviewed commits to a file with a pinning test; Igor runs `config diff` before and after the push; Supabase and GitHub keep their own audit trails |
</threat_model>

<verification>
Run after Task 3, all local and read-only:

- `pnpm --filter @rede-social/api exec vitest run tests/unit/production-auth-config.test.ts` passes (no database, no stack).
- `bash scripts/guard-auth-hooks.sh` and `bash scripts/guard-auth-hooks.test.sh` pass.
- `git log --oneline -3` shows three `quick-261022-fku` commits; `git show --stat HEAD~2 HEAD~1 HEAD` lists only the five planned paths; `git log -3 --format=%B | grep -ci 'co-authored-by'` prints 0.
- `git status --short docs/LOCAL-SETUP.md` still shows `??` (untracked, untouched).
- Nothing in the transcript calls `supabase config push|diff`, `supabase link`, `supabase db push`, `gcloud`, `gh` or `vercel`.
- `supabase/config.toml` `[remotes.production.auth.hook.send_email]`, the two disabled access hooks and `[remotes.production.auth.email.template.recovery]` appear in `git diff HEAD~3 -- supabase/config.toml` only as unchanged context, never as `-` lines.
</verification>

<success_criteria>
- The production config declares custom SMTP (Resend, 465, `resend`, `env(RESEND_SMTP_PASS)`, `no-reply@n1marketingdigital.com.br`) and `email_sent = 100`, additively, with the hook still the only sender.
- The credential is never a literal anywhere in git; a unit test, the guard step and the environment-scoped secret enforce it.
- A production deploy without the secret fails before touching the database; with it, `config push` carries the SMTP block and the new ceiling.
- The documentation explains the 429 `over_email_send_rate_limit` mode (project-wide sum, failed hook calls also count) and gives Igor an ordered, copy-pasteable runbook; nothing has been run against production.
</success_criteria>

<output>
Create `.planning/quick/261022-fku-prod-auth-e-mail-limited-to-2-h-custom-s/261022-fku-SUMMARY.md` when done.
The summary must repeat Igor's seven-step runbook (including step 5, the redirect allow-list re-check after the
config push), the chosen `email_sent = 100` with the confirm-the-Resend-plan
caveat, the secret name `RESEND_SMTP_PASS`, the QD-06 offline-validation limit (remote tables are not strictly
validated by the CLI until `config diff` / `push`), and that the D-23 platform-host cause (QD-09) is untouched.
</output>
