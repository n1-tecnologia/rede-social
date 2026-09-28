---
phase: quick-260928-s4y
plan: 01
subsystem: infra
tags: [supabase-cli, config-toml, github-actions, cloud-run, vercel, deploy, docs]
status: complete

requires: []
provides:
  - "supabase/config.toml [remotes.production] override (site_url, one explicit redirect entry, otp_expiry 86400, Send Email Hook disabled)"
  - "Production-only deploy-api.yml on master (checks + build + migrate-and-deploy-prod)"
  - "docs/DEPLOY.md Decisions (2026-09-28) section; staging/seed/keepalive text retired"
affects: [phase-01.1, deploy, auth-mail]

actuals:
  tokens: 8850
  tasks: 3
  commits: 3
plan_head_before: 9571ecce87346c6d5e413e62161e8ef9d5ff4bc9

tech-stack:
  added: []
  patterns:
    - "Hosted-only Supabase settings live in [remotes.<name>] blocks keyed by project ref; local values stay in the base tables"

key-files:
  created: []
  modified:
    - supabase/config.toml
    - .github/workflows/ci.yml
    - .github/workflows/deploy-api.yml
    - apps/api/src/routes/health.ts
    - docs/DEPLOY.md
  deleted:
    - .github/workflows/keepalive-staging.yml
    - .github/workflows/seed-prod.yml

key-decisions:
  - "Production-only pipeline on master: deploy-api.yml has no pull_request trigger and no staging job; the production gate (needs [checks, build] + environment production) is untouched"
  - "Send Email Hook disabled on the hosted project via [remotes.production.auth.hook.send_email] enabled = false while e-mail/Resend is deferred"
  - "Production is never seeded: seed-prod.yml removed; production holds only the hand-created super_admin"

requirements-completed: [PWA-04]

duration: 6min
completed: 2026-09-28
---

# Quick 260928-s4y: Adapt the deploy pipeline to production only — Summary

**Production-only pipeline on `master`: a `[remotes.production]` Supabase override (site URL, one explicit redirect, 24 h OTP, hook disabled), a push-only `deploy-api.yml` without the staging job, the keepalive and seed workflows deleted, and DEPLOY.md recording the 2026-09-28 decisions.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-09-28T23:30:24Z
- **Completed:** 2026-09-28T23:36Z
- **Tasks:** 3/3
- **Files modified:** 5 modified, 2 deleted

## Accomplishments

- `supabase/config.toml` ends with a 7-line comment header plus `[remotes.production]` (`project_id = "qjjhtduxquvlfppybpqq"`), `[remotes.production.auth]` (`site_url`, `additional_redirect_urls = ["https://rede-social-woad.vercel.app/auth/confirm**"]`), `[remotes.production.auth.email]` (`otp_expiry = 86400`) and `[remotes.production.auth.hook.send_email]` (`enabled = false` only). Every non-`remotes` key parses identical to BASE (tomllib).
- `ci.yml` pushes on `[master]`; `deploy-api.yml` triggers only on push to `master` (paths unchanged), has jobs `checks`, `build`, `migrate-and-deploy-prod`; the production job's `if` checks `refs/heads/master`, `environment.url` is `https://rede-social-woad.vercel.app`, and its steps are YAML-identical to BASE. The seed comment now forbids ever seeding production.
- `keepalive-staging.yml` and `seed-prod.yml` deleted (`git rm`); `health.ts` docblock now says the production deploy calls `?deep=1` as its post-deploy check.
- `docs/DEPLOY.md` opens with `## Decisions (2026-09-28)` (production only, `master`, `PLATFORM_HOST`, e-mail deferred, production gate, identifiers, the one-time bootstrap, GCP billing block); Environments table is `| | Local | Production |`; staging secrets/variables/Secret Manager rows removed; runbook says production is paused-able with no keepalive and must never be seeded.

## Task Commits

1. **Task 1: production remote override in config.toml** — `9412c11` (chore)
2. **Task 2: production-only workflows on master; delete keepalive and seed-prod** — `3cbf9d1` (ci)
3. **Task 3: record the 2026-09-28 decisions in DEPLOY.md** — `5ca701b` (docs)

No commit carries a Co-Authored-By or Anthropic trailer (verified).

## Supabase CLI facts (from the plan's CLI v2.117.0 source reading)

- The CLI merges a `[remotes.<name>]` block into the base config ONLY when `remotes.<name>.project_id` equals the project ref the command was given (`flags.ProjectRef`), which is parsed only by Management-API commands (`link`, `config push`, `db push` against the linked ref). Local `start` / `status` / `db reset` / `test db` never merge it, so the production override cannot leak into the local stack even though this machine's `supabase/.temp/project-ref` holds the production ref.
- Remote leaf keys replace base keys; arrays are replaced whole (the remote redirect list REPLACES the localhost list); a remote defaults `db.seed.enabled` to false.
- `project_id` of every remote is validated against `^[a-z]{20}$` on every command; `qjjhtduxquvlfppybpqq` matches.
- A disabled hook skips `uri`/`secrets` validation and the push sends only `enabled=false` — the hosted `config push` needs no `SEND_EMAIL_HOOK_SECRETS`, and hosted GoTrue never calls the local `host.docker.internal` hook URL.
- **CLI load result:** Homebrew `supabase` 2.118.0 `status` loaded the file with exit 0 and no config/hook error (it printed the local stack status). `status` does not merge remotes, so **the merge itself is proven only by the Python leaf-replace simulation** until the orchestrator's `supabase config push` shows its diff.

## Review before `config push`

`config push` also applies inherited base values the remote does not override (not changed here, informational):

- `[auth] enable_signup = false`, `jwt_expiry = 3600`, `minimum_password_length = 8`
- `[auth.email] enable_signup = true`, `enable_confirmations = false`, `secure_password_change = false`, `max_frequency = "1s"`, `otp_length = 6`
- `[auth.rate_limit] email_sent = 2`
- `[auth.email.template.recovery]` subject + `content_path` template

## Open questions for the developer (not acted on)

a. A production keepalive for the Free-plan project now that the staging one is gone (Free projects pause after a week idle; the runbook documents the manual restore).
b. Phase 01.1's staging-only proofs (Supavisor spike, remote smoke) — run against production, or stay open.
c. The `ci.yml` step name "Pooler lane spike (… staging proof is plan 01-12)" still mentions staging — left as is to keep the change proportionate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale "service key lives in … GitHub environment secrets" sentence in DEPLOY.md**
- **Found during:** Task 3
- **Issue:** The Vercel section said the service key lives in Secret Manager and GitHub environment secrets; with the seed rows removed, no GitHub environment secret holds it any more.
- **Fix:** Sentence now reads "lives in Secret Manager only" (inside the section item 8 already edits).
- **Files modified:** docs/DEPLOY.md
- **Commit:** 5ca701b

Otherwise the plan was executed as written. The `config.toml` comment header was rewrapped once to stay within the file's ~100-column width.

## Verification

- Task 1 tomllib check: `config.toml OK`; CLI load (Homebrew 2.118.0): exit 0, no config error.
- Task 2 YAML check: `workflows OK` (production steps identical to BASE; no tracked reference to the removed workflows outside `.planning/`, `.claude/`, DEPLOY.md Decisions).
- Task 3 check: `DEPLOY.md OK` (headings, Decisions tokens, no staging/old-branch tokens outside Decisions, Documents / Storage buckets / Phase 3 sections byte-identical).
- Secret scan of every added line since BASE: `no secrets added`; `no trailers`; `tree clean` for supabase/.github/docs/apps/api.
- No hosted command was run (no link, config push, db push, gh, gcloud, vercel, git push); no local stack restart.

## Threat Flags

None — no new network endpoint, auth path or schema change; the change narrows surface (staging job, seed workflow and its secrets removed).

## Self-Check: PASSED

- FOUND: supabase/config.toml, .github/workflows/ci.yml, .github/workflows/deploy-api.yml, apps/api/src/routes/health.ts, docs/DEPLOY.md
- DELETED as intended: .github/workflows/keepalive-staging.yml, .github/workflows/seed-prod.yml
- FOUND commits: 9412c11, 3cbf9d1, 5ca701b (`git rev-list --count 9571ecc..HEAD` = 3)
