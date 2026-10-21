---
phase: quick-261021-eks
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1 (the production workflow env wiring)
  - .github/workflows/deploy-api.yml
  # Task 2 (the deploy contract)
  - docs/DEPLOY.md
autonomous: true
requirements: [TENANT-07]
tags: [deploy, github-actions, cloud-run, custom-domains, vercel, supabase, production, quick]

user_setup:
  - service: gcp-secret-manager
    why: "Production api and worker will mount VERCEL_TOKEN and SUPABASE_PAT from Secret Manager. A secret the workflow references but that does not exist (or that the runtime service account cannot read) fails the Cloud Run revision. Claude cannot reach the production gcloud (its auth is expired); Igor checks this before anything is pushed."
    dashboard_config:
      - task: "Confirm secret vercel-token-prod exists (a Vercel team-scoped token for team n1-tecnologia) and that the runtime service account has roles/secretmanager.secretAccessor on it"
        location: "GCP Console -> Security -> Secret Manager, project api-dere-social (or: gcloud secrets describe vercel-token-prod --project=api-dere-social)"
      - task: "Confirm secret supabase-pat-prod exists (a DEDICATED Supabase personal access token with access to project qjjhtduxquvlfppybpqq, not the CI SUPABASE_ACCESS_TOKEN) and that the runtime service account has roles/secretmanager.secretAccessor on it"
        location: "GCP Console -> Security -> Secret Manager, project api-dere-social (or: gcloud secrets describe supabase-pat-prod --project=api-dere-social)"

estimate:
  tokens: 25000
  raw_tokens: 25000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "After this change, a push to master deploys api and worker with DOMAIN_PROVIDER=vercel, VERCEL_PROJECT_ID=prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa, VERCEL_TEAM_ID=team_Nf4Qex49TkN0pmqTt4iuKNGU, AUTH_ALLOW_LIST=supabase and SUPABASE_PROJECT_REF=qjjhtduxquvlfppybpqq, plus VERCEL_TOKEN and SUPABASE_PAT mounted from the Secret Manager secrets vercel-token-prod and supabase-pat-prod, so a tenant domain added in the production panel is attached to the production Vercel project and verified against real DNS instead of the fake adapter."
    - "Both deploy-cloudrun steps (api and worker) carry the same five env vars and the same two secrets; nothing else in deploy-api.yml changes (existing env vars, secrets, flags, instance caps, the migration and auth-config steps stay byte-identical in meaning)."
    - "No secret value is written anywhere: the two credentials appear only as Secret Manager names with :latest, and the Vercel project id in the file is production's, never the hml project's."
    - "docs/DEPLOY.md describes what the workflow now does: the production rows of the Custom domains variable table, the vercel-token-prod / supabase-pat-prod secret rows, and runbook item 'Attach a real customer domain end-to-end' step 1 no longer tell the operator to set the variables by hand."
    - "The deploy must not be pushed until vercel-token-prod and supabase-pat-prod are confirmed in api-dere-social Secret Manager and readable by the runtime service account (assertProductionEnv refuses to boot without them, and Cloud Run fails a revision whose secret is missing). This is recorded in the workflow comment, in docs/DEPLOY.md and in the SUMMARY."
    - "Nothing is pushed, deployed, or run against production: no gcloud, gh or vercel call, no network. Two path-scoped local commits, neither with a Claude co-author trailer."
  artifacts:
    - path: ".github/workflows/deploy-api.yml"
      provides: "the production api and worker deploy steps with the real domain provider and auth allow-list wiring"
      contains: "DOMAIN_PROVIDER=vercel"
    - path: "docs/DEPLOY.md"
      provides: "the production custom-domain contract that matches the workflow"
      contains: "quick 261021-eks"
  key_links:
    - from: ".github/workflows/deploy-api.yml (api and worker env_vars + secrets)"
      to: "packages/core/server/env.ts assertProductionEnv()"
      via: "DOMAIN_PROVIDER=vercel needs VERCEL_TOKEN/VERCEL_PROJECT_ID/VERCEL_TEAM_ID; AUTH_ALLOW_LIST=supabase needs SUPABASE_PAT/SUPABASE_PROJECT_REF; all seven must land together"
      pattern: "VERCEL_TOKEN"
    - from: ".github/workflows/deploy-api.yml secret names"
      to: "docs/DEPLOY.md 'GCP Secret Manager secrets (mounted into Cloud Run)' table"
      via: "vercel-token-prod and supabase-pat-prod are the names the table already lists"
      pattern: "vercel-token-prod"
    - from: "docs/DEPLOY.md Custom domains table"
      to: ".github/workflows/deploy-api.yml literals"
      via: "the same project id, team id and Supabase ref appear in both"
      pattern: "prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa"
---

<objective>
Production's domain provider is stuck on the fake adapter. The live `api` service has only `PLATFORM_HOST`
from this area (confirmed 2026-10-21 with `gcloud run services describe api --project=api-dere-social`),
so a tenant domain added in the production panel shows `CNAME -> fake.rede-social-dns.test`
(`packages/core/server/domains/fake.ts`) and "Verificar agora" would verify it with no real DNS and
nothing attached to Vercel. Cause: `.github/workflows/deploy-api.yml` never sets `DOMAIN_PROVIDER`,
`VERCEL_*`, `AUTH_ALLOW_LIST` or `SUPABASE_*` (`git log -S DOMAIN_PROVIDER` on that file is empty),
while `deploy-hml.yml` does, on both services. `docs/DEPLOY.md` already describes the intended
production values; the workflow never caught up.

Purpose: make the production deploy the single source of the production domain-provider wiring, the
same way `deploy-hml.yml` is for homolog (TENANT-07, D-34), and bring the deploy contract in line.

Output: one edited workflow (both `deploy-cloudrun@v3` steps, `api` and `worker`) and an updated
`docs/DEPLOY.md`, as two path-scoped local commits. Nothing is pushed or deployed.

**Shape.** Task 1 is the end-to-end slice: the only layer is the workflow, and the one real
end-to-end check (a production deploy) is forbidden here, so its proof is a structural comparison of
the edited workflow against the committed baseline. It is `type="auto"`, not `tracer`. Task 2 expands
it with the documentation.

**Decisions recorded here (planner, from live files read at planning time):**

- QD-01 Literals, not GitHub variables. `deploy-api.yml` already hardcodes every environment-specific
  id it passes to Cloud Run as a literal (`PLATFORM_HOST=rede-social-woad.vercel.app`,
  `API_PUBLIC_URL=https://api-253040968821.southamerica-east1.run.app`), and none of its `env_vars`
  reads a GitHub variable. Only the infrastructure identities (`WIF_PROVIDER`, `DEPLOY_SA`,
  `RUNTIME_SA`, `GCP_PROJECT_ID`) come from `vars.*`. `deploy-hml.yml` reads the three Vercel/Supabase
  ids from the `homolog` GitHub environment because the same names exist at repository level as
  production values and a missing environment value silently falls back to them, which is why it needs a
  preflight. Literals in a reviewed workflow have no fallback chain, and they add NO deploy prerequisite
  (no GitHub variable for Igor to create). The values are identifiers, not secrets: they already appear in
  `docs/DEPLOY.md` (lines ~108, ~222, ~491) and in the hml preflight.
- QD-02 No production preflight is added. The hml preflight (`deploy-hml.yml` ~108-134) refuses
  production's Vercel project id on hml. The mirror guard on production would only compare a literal in
  this same file with another literal in this same file. The protection that matters here, "production
  must never carry the hml Vercel project id", is enforced by Task 1's structural verify (the hml id must be
  absent from the file) and by the `production` environment's required reviewer. The hml preflight stays
  untouched and keeps refusing production's id.
- QD-03 Both services get the same five env vars and the same two secrets. The worker runs the
  `kernel.domain-verify` poller and the boot-time allow-list reconcile
  (`packages/core/server/platform/reconcile-allow-list.ts`); the API answers "Verificar agora". Both boot
  `assertProductionEnv()` (`packages/core/server/env.ts` ~150-187), which refuses
  `DOMAIN_PROVIDER=vercel` without `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID` and
  `AUTH_ALLOW_LIST=supabase` without `SUPABASE_PAT`/`SUPABASE_PROJECT_REF`. So the seven values must reach a
  service together or not at all.
- QD-04 `google-github-actions/deploy-cloudrun@v3` merges, it does not replace. Its
  `env_vars_update_strategy` and `secrets_update_strategy` inputs default to `merge`, so anything set by
  hand on the live service and not named in the step survives a deploy. Do NOT set either input to
  `overwrite`. (Read from the action's README on 2026-10-21; the action docs are silent on a missing
  secret, the failure is Cloud Run's: the revision does not become ready.)
- QD-05 The step order in the job is migrations -> auth hook guard -> `config push` -> api deploy ->
  worker deploy -> deep health check. A missing secret fails the `api` step AFTER the migrations and the
  auth configuration are already applied; the older revision keeps serving and the worker is not
  deployed. That is the failure mode to avoid by confirming the secrets first, and it is why the
  prerequisite goes in the workflow comment, the doc and the summary.
- QD-06 Pushing the workflow edit itself triggers `Deploy API` (`.github/workflows/deploy-api.yml` is in
  the `paths` filter), and the local `master` is about 160 commits ahead of `origin/master` (159 when this plan was written, all of them Phase 09.1).
  So the next push ships the whole Phase 09.1 release as well, which separately needs
  `payments-secret-key-prod` (docs/DEPLOY.md "Phase 09.1 release", step 1). The `production` environment's
  required reviewer is the second guard: do not approve the run before every secret exists.

**Known risk (record in the SUMMARY and in the final message):** `assertProductionEnv()` fails the boot of
a revision that sets `DOMAIN_PROVIDER=vercel` / `AUTH_ALLOW_LIST=supabase` without their credentials, and Cloud
Run fails a revision whose Secret Manager secret does not exist or is not readable by the runtime service
account. Therefore this must not be pushed until `vercel-token-prod` and `supabase-pat-prod` are confirmed in
`api-dere-social` Secret Manager and the runtime service account can access them. Igor checks this; Claude
cannot reach production gcloud (its auth is expired).

**Also record in the SUMMARY:** the already-created `testapp.triacompany.com.br` row holds fake records
(`CNAME -> fake.rede-social-dns.test`); after the deploy it must be removed from the platform panel
(Remover) and added again so it is registered with the real Vercel project and gets real DNS records.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.github/workflows/deploy-api.yml
@.github/workflows/deploy-hml.yml
@docs/DEPLOY.md
@packages/core/server/env.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Wire the real domain provider and auth allow-list into both production Cloud Run steps</name>
  <files>.github/workflows/deploy-api.yml</files>
  <read_first>
    .github/workflows/deploy-api.yml (the two `google-github-actions/deploy-cloudrun@v3` steps in job `migrate-and-deploy-prod`, and the comment block above the first one)
    .github/workflows/deploy-hml.yml (the `env_vars` and `secrets` of its `api` and `worker` steps, ~299-387, for the ordering to mirror)
    packages/core/server/env.ts (assertProductionEnv, ~145-190: which variable needs which credential)
  </read_first>
  <action>
Edit `.github/workflows/deploy-api.yml` only. Two changes plus one comment paragraph; touch nothing else
(no `flags`, no instance caps, no existing key, no other step, no `paths` filter). Per QD-01 and QD-03.

1. In the `env_vars` block of BOTH deploy-cloudrun steps (the one with `id: api`, then the `worker` one),
   insert these five lines directly after the existing `PUSH_TRANSPORT=webpush` line and before the
   existing `PAYMENTS_PROVIDERS=kiwify` line, in this order, at the same 12-space indent as their
   neighbours, as literals (never `${{ ... }}`): `DOMAIN_PROVIDER=vercel`,
   `VERCEL_PROJECT_ID=prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa`, `VERCEL_TEAM_ID=team_Nf4Qex49TkN0pmqTt4iuKNGU`,
   `AUTH_ALLOW_LIST=supabase`, `SUPABASE_PROJECT_REF=qjjhtduxquvlfppybpqq`. This is the order
   `deploy-hml.yml` uses. Cross-check the three ids against `docs/DEPLOY.md` (project id ~108, team id ~222,
   Supabase ref ~103/~491) before writing; if a value there differs, stop and report instead of guessing.

2. In the `secrets` block of BOTH steps, insert these two lines directly after the existing
   `SEND_EMAIL_HOOK_SECRETS=send-email-hook-secrets-prod:latest` line and before
   `PAYMENTS_SECRET_KEY=payments-secret-key-prod:latest`, same 12-space indent:
   `VERCEL_TOKEN=vercel-token-prod:latest` and `SUPABASE_PAT=supabase-pat-prod:latest`. They are Secret
   Manager names that `docs/DEPLOY.md` already lists; the token values are never written in this repo.
   Neither of the two credentials may appear in `env_vars`.

3. Do NOT put any `#` comment line inside the `env_vars` or `secrets` block scalars: a block scalar keeps
   every line at or above its indent as content, so a comment there would become part of the value
   (the existing comments sit at the 10-space indent between inputs, keep it that way).

4. Extend the existing comment paragraph that precedes the first deploy-cloudrun step (the Web Push and
   Payments notes, ~156-167) with one more paragraph in the same style (6-space indent, `#` lines, ending
   before the `- uses:` line). It must say: custom domains (TENANT-07, D-34, quick 261021-eks): both
   services run the real `vercel` domain adapter and the `supabase` auth allow-list adapter (the worker
   runs the verify poller and the boot-time allow-list reconcile, the API answers "Verificar agora"); the
   project id, team id and Supabase ref are literals here like `PLATFORM_HOST` and `API_PUBLIC_URL`
   (the hml workflow reads GitHub environment variables and needs a preflight because a missing value
   there falls back to a production value; a literal in this reviewed file has no fallback); the secrets
   `vercel-token-prod` and `supabase-pat-prod` must exist in `api-dere-social` and be readable by the
   runtime service account BEFORE the push that triggers this deploy, because `assertProductionEnv`
   refuses to boot without them and Cloud Run fails a revision whose secret is missing (and that failure
   lands after the migrations and the auth configuration are applied); `deploy-cloudrun` merges
   `env_vars` and `secrets` into the live service by default, so values set by hand survive; see
   docs/DEPLOY.md "Custom domains". Do not spell out the homolog Vercel project id or the GitHub-variable
   expression for the Vercel ids in this comment (the verify step asserts both are absent from the file).

5. Do not run the workflow, gcloud, gh or vercel; do not push. Run the verify command BEFORE committing. Its
   baseline `c6047a84` is the commit HEAD was at when this plan was written (the file is unchanged since
   513a45f5); if that sha no longer resolves because history was rewritten, substitute the last commit before
   this quick's commit. It parses the YAML, rebuilds the expected workflow as the baseline plus the five env
   vars and two secrets on both steps, and compares the whole document, so a changed flag, a dropped key, a
   credential placed in `env_vars`, the homolog Vercel project id or a GitHub-variable read of the Vercel ids
   all fail it. It does not grep comments, so comment text cannot invalidate it.

6. Then commit ONLY this file, path-scoped, with a message that carries no co-author trailer: stage with
   `git add -- .github/workflows/deploy-api.yml`, then
   `git commit -m "ci(deploy-api): run the real Vercel domain adapter and Supabase allow-list in production" -m "api and worker get DOMAIN_PROVIDER, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, AUTH_ALLOW_LIST and SUPABASE_PROJECT_REF as literals, plus VERCEL_TOKEN and SUPABASE_PAT from vercel-token-prod and supabase-pat-prod. Do not push before both secrets exist in api-dere-social and the runtime service account can read them." -- .github/workflows/deploy-api.yml`.
   Do not use `git add -A` or `git add .` (the working tree holds many unrelated untracked files). Do not
   commit the PLAN, SUMMARY or STATE files; the orchestrator commits them.

7. After the commit, check it: `git show --stat --format= HEAD` must list exactly one path,
   `.github/workflows/deploy-api.yml`, and `git log -1 --format=%B` must contain no `Co-Authored-By` line
   (`git log -1 --format=%B | grep -ci 'co-authored'` prints 0). `git status --short` must still show the same
   unrelated untracked files and nothing staged.
  </action>
  <verify>
    <automated>python3 -I -c '
import sys, subprocess, yaml, copy
text = open(sys.argv[1]).read()
new = yaml.safe_load(text)
base = yaml.safe_load(subprocess.check_output(["git", "show", "c6047a84:.github/workflows/deploy-api.yml"], text=True))
J = "migrate-and-deploy-prod"
def cr(d):
    return [s for s in d["jobs"][J]["steps"] if str(s.get("uses", "")).startswith("google-github-actions/deploy-cloudrun@")]
def kv(t):
    return dict(l.strip().split("=", 1) for l in t.splitlines() if l.strip() and not l.lstrip().startswith("#"))
ENV = {"DOMAIN_PROVIDER": "vercel", "VERCEL_PROJECT_ID": "prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa", "VERCEL_TEAM_ID": "team_Nf4Qex49TkN0pmqTt4iuKNGU", "AUTH_ALLOW_LIST": "supabase", "SUPABASE_PROJECT_REF": "qjjhtduxquvlfppybpqq"}
SEC = {"VERCEL_TOKEN": "vercel-token-prod:latest", "SUPABASE_PAT": "supabase-pat-prod:latest"}
assert len(cr(new)) == 2 and len(cr(base)) == 2
exp = copy.deepcopy(base)
for s in cr(exp):
    w = s["with"]
    w["env_vars"] = {**kv(w["env_vars"]), **ENV}
    w["secrets"] = {**kv(w["secrets"]), **SEC}
for s in cr(new):
    w = s["with"]
    w["env_vars"] = kv(w["env_vars"])
    w["secrets"] = kv(w["secrets"])
assert new == exp, "workflow differs from the baseline plus the 5 env vars and 2 secrets on api and worker"
for bad in ("prj_Z7qixvkp31z7r0j329MGMQTY5gev", "vars.VERCEL", "vars.SUPABASE_PROJECT_REF", "sbp_"):
    assert bad not in text, bad
print("OK: both steps carry the 5 env vars and 2 secrets, nothing else changed")
' .github/workflows/deploy-api.yml</automated>
  </verify>
  <done>Both `deploy-cloudrun@v3` steps in `deploy-api.yml` carry DOMAIN_PROVIDER=vercel, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, AUTH_ALLOW_LIST=supabase and SUPABASE_PROJECT_REF as literals, and mount VERCEL_TOKEN and SUPABASE_PAT from vercel-token-prod:latest and supabase-pat-prod:latest; the structural comparison against the baseline passes (nothing else changed, no hml project id, no secret value); the comment block carries the "secrets must exist before the push" rule; one path-scoped local commit exists with no co-author trailer; nothing was pushed or deployed.</done>
</task>

<task type="auto">
  <name>Task 2: Bring docs/DEPLOY.md in line with what the production workflow now does</name>
  <files>docs/DEPLOY.md</files>
  <read_first>
    docs/DEPLOY.md (the "GCP Secret Manager secrets (mounted into Cloud Run)" table ~245-266; "## Custom domains (TENANT-07, D-34)" ~466-498; "Phase 09.1 release" "Order" step 1 ~2371-2386; the runbook item "Attach a real customer domain end-to-end" ~2781-2795)
    .github/workflows/deploy-api.yml (as committed by Task 1: the doc must quote the same literals)
  </read_first>
  <action>
Edit `docs/DEPLOY.md` only, with scoped `Edit` calls (never rewrite the file). Keep every other section as is.
The doc already says production is `vercel` / `supabase`; what changes is WHO sets it (the workflow, no longer
the operator by hand) and the prerequisites. Per QD-01, QD-03, QD-04, QD-05.

1. Secret Manager table (production, ~255-256): in the Service cell of the `vercel-token-prod` and
   `supabase-pat-prod` rows, keep "`api`, `worker`" and the existing D-34 note, and add that `deploy-api.yml`
   mounts the secret and that it must exist before the push that deploys it (see "Custom domains"), in the same
   wording style as the `payments-secret-key-prod` row.

2. Custom domains variable table (~483-491): keep the five columns and the same number of `|` per row. In the
   production column state the real value for each of the five plain-env rows and make the Source column say
   they are set by `deploy-api.yml` (`env_vars` on both services). `DOMAIN_PROVIDER` = `vercel`;
   `VERCEL_PROJECT_ID` = `prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa` (the production Vercel project of `apps/web`, NOT the
   hml project listed in the homolog variables table); `VERCEL_TEAM_ID` = `team_Nf4Qex49TkN0pmqTt4iuKNGU` (team
   `n1-tecnologia`); `AUTH_ALLOW_LIST` = `supabase`; `SUPABASE_PROJECT_REF` = `qjjhtduxquvlfppybpqq`. The two
   secret rows (`VERCEL_TOKEN`, `SUPABASE_PAT`) keep their Secret Manager names and now say `deploy-api.yml`
   mounts them. Leave the `staging (not provisioned)` column and the `PLATFORM_HOST` row alone. Do not put a `|`
   character inside any cell text.

3. Immediately after the paragraph that starts "`assertProductionEnv()` (kernel `env.ts`) refuses"
   (~494-498), add a paragraph headed in bold "Production wiring (quick 261021-eks, 2026-10-21)." that states,
   in the doc's existing prose style and wrapped near 100 columns: (a) `deploy-api.yml` sets the five variables
   and mounts the two secrets on both `api` and `worker`; the ids are literals, like `PLATFORM_HOST` and
   `API_PUBLIC_URL`, whereas `deploy-hml.yml` reads them from the `homolog` GitHub environment variables and
   its preflight refuses production's Vercel project id; (b) before this, the workflow set none of them, so
   production ran the `fake` adapter (the kernel default): a domain added in the production panel showed
   `CNAME -> fake.rede-social-dns.test` and "Verificar agora" verified it with no real DNS and nothing attached to
   Vercel, so any domain row created while production was on `fake` holds fake records and must be removed in the
   platform panel (Remover) and added again after the deploy; (c) prerequisites BEFORE the push: both secrets
   exist in `api-dere-social` and the runtime service account has `roles/secretmanager.secretAccessor` on them,
   with the two check/grant commands written as developer-run commands that print no secret value
   (`gcloud secrets describe NAME --project=api-dere-social`, and the same `add-iam-policy-binding` form the
   "Phase 09.1 release" step 1 uses); the Supabase PAT must be a dedicated token with access to the project in
   `SUPABASE_PROJECT_REF`, not the CI `SUPABASE_ACCESS_TOKEN`; (d) why: `assertProductionEnv()` refuses to boot
   without them and Cloud Run fails a revision whose secret is missing, and in `deploy-api.yml` that failure
   lands after the migrations and the auth configuration are applied (the older revision keeps serving, the
   worker is not deployed); (e) `deploy-cloudrun` merges `env_vars` and `secrets` into the live service by
   default, so values set by hand survive, and the worker now reconciles the per-domain auth allow-list entries
   through the Management API at every boot; (f) a push that touches `deploy-api.yml` triggers `Deploy API`, so
   the `production` environment's reviewer approval must wait until the secrets are confirmed. Do not mention the
   `testapp.triacompany.com.br` host in the doc (it belongs to the SUMMARY).

4. Runbook item "Attach a real customer domain end-to-end" (~2781-2795): rewrite only step (1), leaving steps
   (2) to (6) and the closing detach sentence untouched. New step (1): create the team-scoped Vercel token and the
   dedicated Supabase PAT and store them as `vercel-token-prod` / `supabase-pat-prod` in `api-dere-social` with the
   runtime service account allowed to read them (see "Custom domains", Production wiring); `deploy-api.yml`
   already sets `DOMAIN_PROVIDER=vercel`, `AUTH_ALLOW_LIST=supabase`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` and
   `SUPABASE_PROJECT_REF` and mounts both secrets on `api` and `worker`, so the next approved `Deploy API` run
   redeploys both services with the real adapters; confirm the live `api` env shows `DOMAIN_PROVIDER=vercel`
   (`gcloud run services describe api --region=southamerica-east1 --project=api-dere-social
   --format='value(spec.template.spec.containers[0].env)'` prints no secret value) before step (2). The phrase
   "set `DOMAIN_PROVIDER=vercel`" must no longer appear in the item.

5. "Phase 09.1 release", "Order" step 1 (~2371-2386): append one short sentence at the end of step 1: the same
   push also mounts `vercel-token-prod` and `supabase-pat-prod` (quick 261021-eks, see "Custom domains"), so
   confirm both exist and are readable by the runtime service account before it, for the same reason. Nothing
   else in that section changes.

6. Run the verify command BEFORE committing (it reads the working-tree diff for the size guard). It
   cross-checks the three ids between workflow and doc, the table shape, the two secret rows, the rewritten
   runbook step 1 with steps 2-6 intact, the 09.1 release cross-reference, and that the diff stays a scoped
   edit (at most 80 added and 30 deleted lines).

7. Then commit ONLY this file, path-scoped, no co-author trailer: stage with `git add -- docs/DEPLOY.md`, then
   `git commit -m "docs(deploy): production custom-domain wiring now comes from deploy-api.yml" -m "The Custom domains table, the two secret rows and the Attach a real customer domain runbook step 1 now match deploy-api.yml; the before-the-push secret prerequisite is recorded." -- docs/DEPLOY.md`.
   No `git add -A`. Do not commit the PLAN, SUMMARY or STATE files. Do not push.

8. After the commit, check it: `git show --stat --format= HEAD` must list exactly one path, `docs/DEPLOY.md`;
   `git log -1 --format=%B | grep -ci 'co-authored'` prints 0; `git log -2 --format='%h %an %s'` shows this
   commit and Task 1's commit, both authored igor.vboas.
  </action>
  <verify>
    <automated>python3 -I -c '
import subprocess
doc = open("docs/DEPLOY.md").read()
wf = open(".github/workflows/deploy-api.yml").read()
for v in ("prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa", "team_Nf4Qex49TkN0pmqTt4iuKNGU", "qjjhtduxquvlfppybpqq"):
    assert v in wf and v in doc, v
a = doc.index("\n## Custom domains (TENANT-07, D-34)\n")
b = doc.index("\n## Video (MEDIA-03")
sec = doc[a:b]
for needle in ("deploy-api.yml", "vercel-token-prod", "supabase-pat-prod", "fake.rede-social-dns.test", "quick 261021-eks", "Remover", "prj_oPNJ2NKXw4j2RkAN4gtC8vbmqyZa"):
    assert needle in sec, needle
rows = [l for l in sec.splitlines() if l.startswith("|")]
assert len({l.count("|") for l in rows}) == 1, "Custom domains table rows have different cell counts"
for name in ("vercel-token-prod", "supabase-pat-prod"):
    row = [l for l in doc.splitlines() if l.startswith("| `" + name + "`")][0]
    assert "deploy-api.yml" in row, name
rb = doc[doc.index("**Attach a real customer domain end-to-end"):]
assert "deploy-api.yml" in rb and "vercel-token-prod" in rb and "supabase-pat-prod" in rb
assert "set `DOMAIN_PROVIDER=vercel`" not in rb, "step 1 still tells the operator to set the variables by hand"
assert "(6) record the outcome here" in rb, "steps 2-6 must stay"
r0 = doc.index("1. **Create the secret first**")
r1 = doc.index("2. **Migrations first, cumulative.**")
assert "vercel-token-prod" in doc[r0:r1] and "supabase-pat-prod" in doc[r0:r1], "09.1 release step 1 cross-reference missing"
assert "testapp.triacompany.com.br" not in doc, "the testapp host belongs in the SUMMARY only"
out = subprocess.check_output(["git", "diff", "--numstat", "--", "docs/DEPLOY.md"], text=True).split()
assert 80 >= int(out[0]) and 30 >= int(out[1]), ("diff too large for a scoped edit", out)
print("OK", out[:2])
'</automated>
  </verify>
  <done>docs/DEPLOY.md says the production domain-provider wiring comes from deploy-api.yml with the literal ids, the two Secret Manager rows say the workflow mounts them and that they must exist before the push, the Custom domains section carries the Production wiring paragraph (fake adapter history, remove-and-re-add rule, prerequisites and failure mode), runbook item "Attach a real customer domain end-to-end" step 1 no longer tells the operator to set the variables by hand, the Phase 09.1 release step 1 cross-references the two secrets; the diff is a scoped edit; one path-scoped local commit exists with no co-author trailer; nothing was pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| repository -> GitHub Actions -> Cloud Run | the workflow decides which credentials and which hosting-provider ids a production service boots with |
| Secret Manager -> Cloud Run runtime service account | the Vercel token and the Supabase PAT cross here and are never written in the repo |
| production api/worker -> Vercel project API and Supabase Management API | once wired, a tenant domain attach and verify call the real vendors with those credentials |
| platform panel operator -> tenant domain rows | a row created under the fake adapter holds records that no vendor knows about |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261021-01 | Information disclosure | deploy-api.yml `secrets` / DEPLOY.md | high | mitigate | The Vercel token and the Supabase PAT appear only as Secret Manager names with `:latest`, never as a value and never in `env_vars`; the Task 1 verify rebuilds the expected workflow and fails on any credential in `env_vars` and on the `sbp_` token prefix; the doc commands print no secret value. |
| T-261021-02 | Tampering | production `VERCEL_PROJECT_ID` | high | mitigate | Production carries its own project id as a literal in a reviewed file; the Task 1 verify fails if the homolog project id is present, so a copy-paste from `deploy-hml.yml` cannot attach production tenants to the hml project. The hml preflight keeps refusing production's id on the other side. |
| T-261021-03 | Spoofing | fake domain adapter in production (today) | high | mitigate | Today "Verificar agora" verifies a host with no real DNS, so an operator could mark an unowned host verified. Switching `DOMAIN_PROVIDER=vercel` removes it. Residual: rows created while on `fake` keep fake records until removed and re-added, documented in DEPLOY.md and the SUMMARY. |
| T-261021-04 | Denial of service | Cloud Run revision with a missing or unreadable secret | medium | mitigate | `assertProductionEnv()` already fails closed at boot (no half-configured revision serves), and the older revision keeps serving. The prerequisite (secrets exist, runtime service account can read them) is recorded in the workflow comment, DEPLOY.md and the SUMMARY, and the `production` environment reviewer gates the run. Residual: the failure lands after migrations and auth config are applied; accepted because the migrations are expand-only and the older revision is unaffected. |
| T-261021-05 | Elevation of privilege | `SUPABASE_PAT` scope | medium | accept | The adapter only reads and patches `uri_allow_list` of the project in `SUPABASE_PROJECT_REF`; DEPLOY.md already requires a dedicated token distinct from the CI `SUPABASE_ACCESS_TOKEN`. Creating or scoping the token is Igor's step (this plan creates no credential), so the exposure is a property of the token Igor issues. |
| T-261021-06 | Repudiation | tenant domain attach/detach in production | low | accept | Out of scope for a wiring change; the platform panel audit trail behaves as before. |

No package installs in this plan, so no package-legitimacy checkpoint is needed.
</threat_model>

<verification>
Static only; no network, no gcloud, no gh, no vercel, no push:

1. Task 1 verify: the edited `deploy-api.yml` parses as YAML and equals the committed baseline plus exactly the five env vars and two secrets on both `deploy-cloudrun@v3` steps (the `api` and the `worker`); the homolog Vercel project id, the GitHub-variable read of the Vercel ids and the `sbp_` token prefix are absent.
2. Task 2 verify: the doc's literals equal the workflow's, the Custom domains table keeps its shape, the two secret rows and the runbook step 1 are updated, steps 2-6 of the runbook and every unrelated section are untouched (diff size guard).
3. `git log -3 --format='%h %an %s'` shows the two new commits authored `igor.vboas`, each touching exactly one path, neither carrying a `Co-Authored-By` line; `git status --short` lists no staged file; `git rev-list --count origin/master..HEAD` has grown by exactly 2 compared with its value before Task 1 (nothing pushed).
4. `git show --stat --format= HEAD~1 HEAD` lists only `.github/workflows/deploy-api.yml` and `docs/DEPLOY.md`: no code, migration or config outside the two files was touched.
</verification>

<success_criteria>
- `deploy-api.yml`: api and worker both set DOMAIN_PROVIDER=vercel, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, AUTH_ALLOW_LIST=supabase, SUPABASE_PROJECT_REF (literals) and mount VERCEL_TOKEN and SUPABASE_PAT from vercel-token-prod:latest and supabase-pat-prod:latest; the comment block states the secrets-first rule; nothing else changed.
- `docs/DEPLOY.md` matches the workflow (variable table, secret rows, Production wiring paragraph, runbook step 1, 09.1 release cross-reference).
- Two local, path-scoped commits, authored igor.vboas, no Claude co-author trailer; nothing pushed, deployed or run against production.
- The SUMMARY records the known risk (do not push until `vercel-token-prod` and `supabase-pat-prod` are confirmed in `api-dere-social` and readable by the runtime service account) and the `testapp.triacompany.com.br` remove-and-re-add note.
</success_criteria>

<output>
Create `.planning/quick/261021-eks-wire-domain-provider-vercel-and-vercel-s/261021-eks-SUMMARY.md` when done. Do not commit it (nor the PLAN or STATE): the orchestrator does that in the docs commit. The SUMMARY must contain: the two commit shas and subjects; the final env/secret lists per service; the decisions QD-01..QD-06 as applied; the verify outputs; and these notes, verbatim in substance:

1. KNOWN RISK. `assertProductionEnv()` (packages/core/server/env.ts) refuses `DOMAIN_PROVIDER=vercel` and `AUTH_ALLOW_LIST=supabase` without `VERCEL_TOKEN`/`VERCEL_PROJECT_ID`/`VERCEL_TEAM_ID`/`SUPABASE_PAT`/`SUPABASE_PROJECT_REF` at boot, and Cloud Run fails the revision if a referenced Secret Manager secret does not exist or is not readable by the runtime service account. Do NOT push until `vercel-token-prod` and `supabase-pat-prod` are confirmed in `api-dere-social` Secret Manager and the runtime service account can access them. Igor checks this; Claude cannot reach production gcloud (auth expired). The failure lands after the migrations and the auth config push already ran in the same job.
2. The next push is not just this change: local master is about 160 commits ahead of origin/master (159 at planning time), all Phase 09.1, and editing deploy-api.yml is itself a `paths` trigger. The same push needs `payments-secret-key-prod` (docs/DEPLOY.md "Phase 09.1 release" step 1) and the production reviewer approval; do not approve the `production` environment run before all three secrets exist.
3. The already-created `testapp.triacompany.com.br` row holds fake records (`CNAME -> fake.rede-social-dns.test`); after the deploy, remove it in the platform panel (Remover) and add it again so it registers with the real Vercel project and shows real DNS records.
4. `packages/core/server/platform/reconcile-allow-list.ts` carries a comment saying the worker "already carries AUTH_ALLOW_LIST=supabase and SUPABASE_PAT"; that was not true of the deploy workflow until this change. No code change was made (out of scope); after the deploy the worker's boot reconcile will call the Supabase Management API once per verified host, so the PAT must have access to project qjjhtduxquvlfppybpqq.
5. Run order for Igor, nothing automated: confirm both secrets and the IAM binding; push; approve the production run; check `gcloud run services describe api` shows DOMAIN_PROVIDER=vercel; remove and re-add the test domain; run the runbook item "Attach a real customer domain end-to-end".
</output>
