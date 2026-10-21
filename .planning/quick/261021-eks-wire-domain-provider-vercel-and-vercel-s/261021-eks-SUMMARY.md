---
phase: quick-261021-eks
plan: 01
subsystem: deploy
tags: [deploy, github-actions, cloud-run, custom-domains, vercel, supabase, production, quick]
requirements: [TENANT-07]
status: complete
key-files:
  modified:
    - .github/workflows/deploy-api.yml
    - docs/DEPLOY.md
decisions:
  - "QD-01 literals (not GitHub variables) for the Vercel project id, team id and Supabase ref in deploy-api.yml"
  - "QD-02 no production preflight added; the hml preflight keeps refusing production's Vercel project id"
  - "QD-03 api and worker get the same five env vars and two secrets"
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
plan_head_before: d701fe650bb682700d89421e4051e1f8746d6a3f
---

# Quick 261021-eks: production domain provider and auth allow-list wiring Summary

`deploy-api.yml` now deploys `api` and `worker` with the real `vercel` domain adapter and the `supabase` auth allow-list adapter (five literal env vars plus two Secret Manager secrets on both services), and `docs/DEPLOY.md` describes that contract. Nothing was pushed, deployed or run against production.

## Commits

| Task | Commit | Subject | Path |
|---|---|---|---|
| 1 | `81e9f5b0` | ci(deploy-api): run the real Vercel domain adapter and Supabase allow-list in production | `.github/workflows/deploy-api.yml` (+26) |
| 2 | `85b5dd4b` | docs(deploy): production custom-domain wiring now comes from deploy-api.yml | `docs/DEPLOY.md` (+42 -12) |

Both authored igor.vboas, one path each, no Co-Authored-By line. Local `master` is now 162 commits ahead of `origin/master`.

## Final wiring per service (api and worker, identical)

Added env vars (literals, between `PUSH_TRANSPORT` and `PAYMENTS_PROVIDERS`):

- `DOMAIN_PROVIDER=vercel`
- `VERCEL_PROJECT_ID=prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa`
- `VERCEL_TEAM_ID=team_Nf4Qex49TkN0pmqTt4iuKNGU`
- `AUTH_ALLOW_LIST=supabase`
- `SUPABASE_PROJECT_REF=qjjhtduxquvlfppybpqq`

Added secrets (between `SEND_EMAIL_HOOK_SECRETS` and `PAYMENTS_SECRET_KEY`):

- `VERCEL_TOKEN=vercel-token-prod:latest`
- `SUPABASE_PAT=supabase-pat-prod:latest`

## Decisions as applied

- QD-01: literals, consistent with `PLATFORM_HOST` and `API_PUBLIC_URL`; no new GitHub variable to create. The three ids were cross-checked against docs/DEPLOY.md before writing.
- QD-02: no production preflight; the hml project id is absent from the file (asserted by the verify).
- QD-03: same five vars and two secrets on both services, so the seven values reach each service together.
- QD-04: `env_vars_update_strategy` / `secrets_update_strategy` left at the default `merge`; hand-set values survive.
- QD-05: the failure order (migrations, auth hook guard, config push, api, worker) is documented in the workflow comment and the doc.
- QD-06: the next push also carries the Phase 09.1 release (see note 2).

## Verification

- Task 1: structural YAML comparison against baseline `c6047a84` plus the 5 env vars and 2 secrets on both steps: `OK: both steps carry the 5 env vars and 2 secrets, nothing else changed`. The hml project id, `vars.VERCEL`, `vars.SUPABASE_PROJECT_REF` and `sbp_` are absent.
- Task 2: ids match between workflow and doc, table shape intact, both secret rows updated, runbook step 1 rewritten with steps 2-6 intact, 09.1 step 1 cross-reference present, testapp host absent from the doc, diff size guard: `OK ['42', '12']`.
- `git show --stat` of the two commits lists only the two intended files; nothing staged afterwards.

## Deviations from Plan

None. The plan executed as written. The baseline sha `c6047a84` still resolved; `d701fe65` was HEAD at start.

## Notes for Igor

1. KNOWN RISK. `assertProductionEnv()` (`packages/core/server/env.ts`) refuses `DOMAIN_PROVIDER=vercel` and `AUTH_ALLOW_LIST=supabase` without `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` / `SUPABASE_PAT` / `SUPABASE_PROJECT_REF` at boot, and Cloud Run fails the revision if a referenced Secret Manager secret does not exist or is not readable by the runtime service account. Do NOT push until `vercel-token-prod` and `supabase-pat-prod` are confirmed in `api-dere-social` Secret Manager and the runtime service account can access them (`roles/secretmanager.secretAccessor`). Igor checks this; Claude cannot reach production gcloud (auth expired). The failure lands after the migrations and the auth config push already ran in the same job; the older revision keeps serving and the worker is not deployed.
2. The next push is not just this change: local master is about 160 commits ahead of origin/master (162 now), nearly all Phase 09.1, and editing `deploy-api.yml` is itself a `paths` trigger. The same push needs `payments-secret-key-prod` (docs/DEPLOY.md "Phase 09.1 release" step 1) and the production reviewer approval; do not approve the `production` environment run before all three secrets exist (`vercel-token-prod`, `supabase-pat-prod`, `payments-secret-key-prod`).
3. The already-created `testapp.triacompany.com.br` row holds fake records (`CNAME -> fake.rede-social-dns.test`); after the deploy, remove it in the platform panel (Remover) and add it again so it registers with the real Vercel project and shows real DNS records. (The host is deliberately not named in docs/DEPLOY.md.)
4. `packages/core/server/platform/reconcile-allow-list.ts` carries a comment saying the worker "already carries AUTH_ALLOW_LIST=supabase and SUPABASE_PAT"; that was not true of the deploy workflow until this change. No code change was made (out of scope). After the deploy the worker's boot reconcile will call the Supabase Management API once per verified host, so the PAT must have access to project `qjjhtduxquvlfppybpqq`.
5. Run order, nothing automated: confirm both secrets and the IAM binding; push; approve the production run; check `gcloud run services describe api` shows `DOMAIN_PROVIDER=vercel`; remove and re-add the test domain; run the runbook item "Attach a real customer domain end-to-end".

## Known Stubs

None.

## Threat Flags

None. No new endpoints or trust boundaries beyond the plan's threat model.

## Self-Check: PASSED

- `.github/workflows/deploy-api.yml` and `docs/DEPLOY.md` present and committed (`81e9f5b0`, `85b5dd4b` exist).
