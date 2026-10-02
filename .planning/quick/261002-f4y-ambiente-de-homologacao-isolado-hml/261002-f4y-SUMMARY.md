---
phase: quick-261002-f4y
plan: 01
subsystem: deploy
status: complete
tags: [github-actions, cloud-run, vercel, supabase-cli, workload-identity, deploy, homolog, docs]
requires: []
provides:
  - ".github/workflows/deploy-hml.yml: push to homolog -> build (preflight + image) -> migrate-and-deploy-hml on environment homolog"
  - "scripts/vercel-ignore.sh: per-project Vercel Ignored Build Step keyed on DEPLOY_ENV + VERCEL_GIT_COMMIT_REF"
  - "docs/DEPLOY.md: homolog deploy contract and hml provisioning runbook"
affects: [deploy-api.yml (header comment only), ci.yml (push branches), apps/web/vercel.json]
tech-stack:
  added: []
  patterns: ["environment-scoped GitHub vars overriding repo-level production vars", "preflight refusal of production identifiers before any credential use", "Vercel ignore step routing two projects from one vercel.json"]
key-files:
  created:
    - .github/workflows/deploy-hml.yml
    - scripts/vercel-ignore.sh
    - scripts/vercel-ignore.test.sh
  modified:
    - .github/workflows/ci.yml
    - .github/workflows/deploy-api.yml
    - apps/web/vercel.json
    - docs/DEPLOY.md
decisions:
  - "Ignore-test output assertions for cases 14/15 match `warning.*DEPLOY_ENV` and `error.*staging` (case-insensitive) instead of the bare words, because the decision line always contains DEPLOY_ENV=<value> and would satisfy a bare match trivially"
  - "Preflight reads [remotes.homolog].project_id with a portable awk (match/RSTART/RLENGTH) that stops at the next `[` line, and matches the header with grep -E '^\\[remotes\\.homolog\\][[:space:]]*$'"
metrics:
  duration: "~5 min"
  completed: 2026-10-02
plan_head_before: 2154c530034d256ca2d09072614be4abb2ab1312
actuals:
  tokens: 10000
  tasks: 3
  commits: 4
---

# Quick 261002-f4y: Isolated homolog (hml) environment — repository side

A push to `homolog` now deploys `api` and `worker` into a separate GCP project via `deploy-hml.yml`, with no reviewer and no CI gate. A preflight refuses any production value or a missing `[remotes.homolog]`. `scripts/vercel-ignore.sh` makes each Vercel project build only its own branch. `docs/DEPLOY.md` carries the full hml contract and a provisioning runbook. Production behaviour is unchanged.

## Commits

| Task | Commit | Message |
|---|---|---|
| 1 (RED) | ec0dd7a | test(quick-261002-f4y): add the Vercel ignore-step routing test |
| 1 (GREEN) | e558069 | ci(quick-261002-f4y): route Vercel builds by branch through scripts/vercel-ignore.sh |
| 2 | aebb6e9 | ci(quick-261002-f4y): add the isolated homolog deploy workflow |
| 3 | f627129 | docs(quick-261002-f4y): document the isolated homolog environment and its provisioning runbook |

No commit carries a Co-Authored-By or Claude/Anthropic trailer (project rule).

## TDD evidence (Task 1)

RED (test committed before the script existed, vercel.json still `npx turbo-ignore --fallback=HEAD^1`), exit 1:

```
1..15
not ok 1 - hml project, ref homolog, production -> builds # no 'vercel-ignore:' decision line;
not ok 2 - hml project, ref homolog, turbo-ignore skip passes through # no 'vercel-ignore:' decision line;
not ok 3 - hml project, ref master preview -> skip # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line;
not ok 4 - hml project, ref feature/x preview -> skip # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line;
not ok 5 - hml project, ref unset -> skip # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line;
not ok 6 - production project, ref master production -> builds # no 'vercel-ignore:' decision line;
not ok 7 - production project, ref master, turbo-ignore skip passes through # no 'vercel-ignore:' decision line;
not ok 8 - production project, PR preview feature/x -> builds as today # no 'vercel-ignore:' decision line;
not ok 9 - production project, ref homolog preview -> skip # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line;
not ok 10 - production project, ref unset (CLI deploy) -> builds as today # no 'vercel-ignore:' decision line;
not ok 11 - DEPLOY_ENV=production, ref master -> builds # no 'vercel-ignore:' decision line;
not ok 12 - DEPLOY_ENV=production, ref homolog -> skip # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line;
not ok 13 - empty DEPLOY_ENV counts as unset, ref homolog preview -> skip # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line;
not ok 14 - DEPLOY_ENV unset, ref homolog production -> belt builds with a warning # no 'vercel-ignore:' decision line; output lacks 'warning.*DEPLOY_ENV';
not ok 15 - unknown DEPLOY_ENV fails closed and names the value # want exit 0, got 1; want delegated=no, got yes; no 'vercel-ignore:' decision line; output lacks 'error.*staging';
```

GREEN (after `scripts/vercel-ignore.sh` + vercel.json change):

```
1..15
ok 1 - hml project, ref homolog, production -> builds
ok 2 - hml project, ref homolog, turbo-ignore skip passes through
ok 3 - hml project, ref master preview -> skip
ok 4 - hml project, ref feature/x preview -> skip
ok 5 - hml project, ref unset -> skip
ok 6 - production project, ref master production -> builds
ok 7 - production project, ref master, turbo-ignore skip passes through
ok 8 - production project, PR preview feature/x -> builds as today
ok 9 - production project, ref homolog preview -> skip
ok 10 - production project, ref unset (CLI deploy) -> builds as today
ok 11 - DEPLOY_ENV=production, ref master -> builds
ok 12 - DEPLOY_ENV=production, ref homolog -> skip
ok 13 - empty DEPLOY_ENV counts as unset, ref homolog preview -> skip
ok 14 - DEPLOY_ENV unset, ref homolog production -> belt builds with a warning
ok 15 - unknown DEPLOY_ENV fails closed and names the value
TAP 15/15 OK
vercel.json OK
Checked 1 file in 1563µs. No fixes applied.
```

Tracer gate: the Task 1 `<verify>` was re-run end-to-end after the GREEN commit and passed before expansion.

## Verify outputs

- Task 1: `TAP 15/15 OK`, `vercel.json OK`, Biome `Checked 1 file ... No fixes applied.`
- Task 2: `workflows OK: deploy-api.yml behaviour unchanged, ci.yml +homolog, deploy-hml.yml structure + preflight (25 refusal cases)`
- Task 3: `DEPLOY.md OK: 238 added lines, hml sections present, 14 Secret Manager names match the workflow`
- Hygiene (filtered by the `quick-261002-f4y` id, so the concurrent 08-03 commits are excluded): `hygiene OK: 4 commits`. All four touch only the seven planned files, and `supabase/config.toml` is unchanged since BASE.
- `git log 963c018..HEAD -- .github` was empty before Task 2, so the BASE comparison for deploy-api.yml and ci.yml was valid.
- actionlint did NOT run (not installed; never installed per plan). Only the YAML structural checks ran.
- Extra check: the preflight run against the real `supabase/config.toml` under `/bin/bash` 3.2 exits 1 with the `[remotes.homolog]` error. Until the orchestrator adds that block, every hml deploy is refused, as intended (C-1).

## Deviations from Plan

None in behaviour. One test-strictness choice is recorded in decisions: cases 14 and 15 match `warning.*DEPLOY_ENV` / `error.*staging`, because the bare words always appear in the decision line.

## Threat Flags

None beyond the plan's threat model. The new surface (deploy-hml.yml OIDC/WIF, Supabase CLI against the hml ref, Vercel routing) is exactly T-f4y-01..09.

## Follow-ups (orchestrator / user)

- **`[remotes.homolog]` block in `supabase/config.toml`** once the hml Supabase ref arrives: project_id, `[remotes.homolog.auth]` site_url and the explicit `/auth/confirm**` redirect, otp_expiry 86400, the send_email hook uri on `api-<hml-gcp-project-number>`, and the Free-tier recovery-template pin if hml stays on Free. The preflight blocks every hml deploy until this lands.
- **User's hml provisioning runbook** (docs/DEPLOY.md "hml provisioning runbook", 18 checklist items): GCP project/APIs/AR/SAs/WIF, Supabase project + Realtime `private_only`, Mux HML, VAPID, Resend, 14 Secret Manager secrets, GitHub environment `homolog`, the `homolog` branch, the Vercel project with `DEPLOY_ENV=homolog` on all environments, and first-deploy checks.
- **Read and record the production WIF provider's attribute condition** (not recorded on 2026-09-28) and make sure it is restricted to `refs/heads/master`.
- Replace every `<hml-...>` placeholder in docs/DEPLOY.md once the values exist.

## Self-Check: PASSED

- FOUND: .github/workflows/deploy-hml.yml, scripts/vercel-ignore.sh, scripts/vercel-ignore.test.sh
- FOUND commits: ec0dd7a, e558069, aebb6e9, f627129
