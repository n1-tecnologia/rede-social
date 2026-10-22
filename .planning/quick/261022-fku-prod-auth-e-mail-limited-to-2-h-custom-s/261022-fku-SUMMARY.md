---
phase: quick-261022-fku
plan: 01
subsystem: auth-mail / production deploy
tags: [auth, e-mail, rate-limit, smtp, resend, supabase, production, deploy, quick]
status: complete
requirements: [TENANT-06]
commits: 3
plan_head_before: 944234f3
key-files:
  modified:
    - supabase/config.toml
    - .github/workflows/deploy-api.yml
    - docs/deploy/auth-mail.md
    - docs/DEPLOY.md
  created:
    - apps/api/tests/unit/production-auth-config.test.ts
decisions:
  - "email_sent = 100 (floor 30, pinned range 30-500); Send Email Hook stays the only sender"
  - "Secret RESEND_SMTP_PASS, a GitHub environment secret of production, a dedicated Resend key"
actuals:
  tasks: 3
  commits: 3
---

# Quick 261022-fku: lift the production auth e-mail ceiling (2 -> 100 per hour)

Production auth was capped at 2 e-mails per hour for the whole Supabase project (429
`over_email_send_rate_limit` on recover, invite and resend). `supabase/config.toml` now gives
`[remotes.production]` a Resend SMTP block (which unlocks the field) and `email_sent = 100`. The
Send Email Hook stays the only sender. Nothing was pushed, deployed or run against production.

## Commits

| Task | Hash | Message | Files |
|---|---|---|---|
| 1 (tracer) | `6d996d8451c2a7834a8c96b87cec81214060eda5` | feat(quick-261022-fku): custom SMTP and email_sent override for the production auth config | supabase/config.toml (+31, 0 deleted), apps/api/tests/unit/production-auth-config.test.ts |
| 2 | `bebbcfa138ce14f768772bb6b69fe76eaa94fa6d` | ci(quick-261022-fku): pass RESEND_SMTP_PASS to the Supabase CLI steps and fail fast when it is missing | .github/workflows/deploy-api.yml (+16, 0 deleted), the test file |
| 3 | `f23bb7dc293f47c01aaa623a0cbb969d37f69b03` | docs(quick-261022-fku): document the production auth SMTP block, the e-mail rate limit and the rollout runbook | docs/deploy/auth-mail.md, docs/DEPLOY.md |

No Co-Authored-By trailer in any of the three.

## What changed

- `supabase/config.toml`: `[remotes.production.auth.email.smtp]` (enabled, smtp.resend.com, 465, user
  `resend`, `pass = "env(RESEND_SMTP_PASS)"`, admin_email `no-reply@n1marketingdigital.com.br`,
  sender_name `Rede Social`) and `[remotes.production.auth.rate_limit]` `email_sent = 100`. Purely
  additive; the hook, the two disabled access hooks and the recovery template pin are untouched.
- `.github/workflows/deploy-api.yml`: new first step "Require the auth SMTP password" (fails the
  production job before the migrations when the secret is empty), and `RESEND_SMTP_PASS` exported to
  the Migrations and Push auth configuration steps. Cloud Run steps unchanged.
- `apps/api/tests/unit/production-auth-config.test.ts`: 10 hermetic cases pinning the SMTP values,
  the env() reference (no credential-shaped token in config or workflow), `email_sent` in 30-500,
  `max_frequency = "60s"` and `enable_confirmations`, the enabled hook, `admin_email` = `no-reply@` +
  `MAIL_DOMAIN`, and the three workflow wiring points (exactly three `secrets.RESEND_SMTP_PASS`).
- `docs/deploy/auth-mail.md`: new "Production e-mail rate limit (quick 261022-fku)" section, the
  rewritten Resend bullet, four Failure modes rows (production 429 cross-referencing
  `redirect_host_not_tenant`, push-not-applied, SMTP error, the extended fallback row).
  `docs/DEPLOY.md`: the stale `RESEND_API_KEY` row replaced by `RESEND_SMTP_PASS`.

## Decisions

- `email_sent = 100`: 3x Supabase's custom-SMTP default of 30 (the floor), still a hard bound (2,400
  mails a day at most); per-address `max_frequency = "60s"` is kept. **Caveat: Igor must confirm the
  Resend plan's daily and monthly quota can carry it** (not discoverable from the repo); the doc says
  how to raise or lower the value.
- Secret `RESEND_SMTP_PASS`: new GitHub environment secret of `production`; use a dedicated Resend key
  (`supabase-auth-smtp-prod`, Sending access, restricted to `n1marketingdigital.com.br`), distinct from
  `resend-api-key-prod`.

## Verification (all local, read-only)

- Vitest `tests/unit/production-auth-config.test.ts`: red before the config edit (4 of 6 failed) and
  before the workflow edit (3 of 4 new cases failed); green now, 10/10.
- Biome check and `tsc --noEmit` on the api package: clean (one `biome-ignore` for the literal GitHub
  `${{ }}` expression in the test).
- Task 1 gate: `supabase/config.toml` numstat +31/-0; TOML parse values; the global brew `supabase
  status` loaded a scratch copy under the throwaway project id `fku-probe-nonexistent` with
  `RESEND_SMTP_PASS` unset (no ConfigLoadError, ended at the expected DbInspectError); every key of both
  tables exists in a fresh `supabase init` template. `scripts/guard-auth-hooks.sh` ok and
  `guard-auth-hooks.test.sh` 22/22.
- Task 2 gate: workflow numstat +16/-0; YAML parse: guard < Migrations < Push order, the secret on exactly
  those three steps, absent from both deploy-cloudrun steps.
- Task 3 gate: docs needles, 429 row cross-reference, equal cell counts, no Resend-key-shaped token,
  only the two planned docs files changed.
- `git diff HEAD~3 -- supabase/config.toml` has zero `-` lines.

## Could not be verified offline (QD-06)

The Supabase CLI validates types in a remote table but silently accepts an unknown key or a missing
`host` there, so the remote semantics (Resend SMTP accepted by the Management API, `email_sent`
writable, the dashboard showing 100) are only proven by `supabase config diff` / `config push` against
the project, which are Igor's steps 3, 4 and 6. Also unproven here: the real Resend key and plan quota,
the GitHub environment secret existing, and the fail-fast step on a real runner.

## Not touched

The D-23 `redirect_host_not_tenant` cause on the platform host (QD-09) and the missing runtime
redirect allow-list entries (QD-10) are not fixed here; no tenant host was added to config.toml and
`reconcile-allow-list.ts`, `auth-allow-list.ts`, `worker.ts`, migrations and `deploy-hml.yml` are
untouched. `docs/LOCAL-SETUP.md` stays untracked and untouched.

## Igor's runbook (nothing has been run)

The full, copy-pasteable version is in `docs/deploy/auth-mail.md`, section "Production e-mail rate
limit (quick 261022-fku)". In short:

1. Create the Resend key `supabase-auth-smtp-prod` (Sending access, domain n1marketingdigital.com.br);
   note the plan's daily and monthly quota.
2. `gh secret set RESEND_SMTP_PASS --env production`, then `gh secret list --env production`.
3. Preview read-only with the brew CLI: export SUPABASE_ACCESS_TOKEN, the REAL SEND_EMAIL_HOOK_SECRETS
   and RESEND_SMTP_PASS, then `supabase config diff --project-ref qjjhtduxquvlfppybpqq`. Expect only the
   SMTP keys and email_sent 2 -> 100; anything touching the hook: stop. Do not paste the output.
4. Ship: (a) push master and approve the production environment, or (b) with the same exports,
   `supabase config push --project-ref qjjhtduxquvlfppybpqq` accepting only the SMTP and rate-limit
   changes, then push master.
5. Re-check the redirect allow-list after the push (Dashboard -> Authentication -> URL Configuration ->
   Redirect URLs): `config push` drops the runtime per-domain entries; re-add
   `https://<host>/auth/confirm**` per verified tenant host or roll the worker so
   `reconcileAuthAllowList` runs at boot. Do it before the smoke test.
6. Verify with `supabase config diff ... --exit-code` (only the redirect list may differ), the dashboard
   showing 100 per hour, and a recovery smoke test on a TENANT host three times, 60+ seconds apart (no
   429, three mails, `mail.sent` three times, no `over_email_send_rate_limit`).
7. Rollback: revert and push (email_sent returns to 2); the SMTP block is not removed by that push, so set
   `enabled = false` in the SMTP table, push, then revoke the key in Resend.

## Deviations from Plan

None in behaviour. Two small notes:

- The Task 3 automated verify selects DEPLOY.md rows by three secret names with a single cell-count
  check; that also matches unrelated 4-column rows of the homolog and Secret Manager tables further down
  the file (pre-existing), so I ran the same check restricted to the production secrets table (lines
  194-203), where the counts are equal. The doc content is as planned.
- The first Resend bullet ("Verify mail.<platform-domain> ...") was left as is; only the Custom SMTP
  bullet was replaced, per the plan.

## Threat Flags

None beyond the plan's threat model.

## Self-Check: PASSED

All five files exist, the three commits are in `git log`, and each commit's `--stat` lists only its
planned paths.
