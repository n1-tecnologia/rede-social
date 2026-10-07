---
phase: quick-261007-kbq
plan: 01
subsystem: ci
tags: [github-actions, ci, playwright, path-affected, composite-action, homolog, deploy, docs]
requires: []
provides:
  - "ci.yml as the single `checks` for pull_request, master, homolog and the manual full run"
  - "apps/web/scripts/e2e-affected.ts + apps/web/e2e/affected-map.json (path-affected e2e selection, Vitest-guarded)"
  - "composite actions local-stack and setup-workspace; e2e-full.yml (manual)"
  - "symmetric deploy gate: deploy-hml.yml now has `checks`, like deploy-api.yml"
affects: [deploy-api.yml, deploy-hml.yml, docs/DEPLOY.md, docs/deploy/ci.md]
tech-stack:
  added: []
  patterns:
    - "plain-node selector (Node 24 strips types), erasable TS, no dependency, no local import"
    - "composite actions inheriting the job env; reusable workflow with a `suite` input"
key-files:
  created:
    - apps/web/e2e/affected-map.json
    - apps/web/scripts/e2e-affected.ts
    - apps/web/scripts/e2e-affected.test.ts
    - .github/actions/local-stack/action.yml
    - .github/actions/setup-workspace/action.yml
    - .github/workflows/e2e-full.yml
    - docs/deploy/ci.md
  modified:
    - .github/workflows/ci.yml
    - .github/workflows/deploy-api.yml
    - .github/workflows/deploy-hml.yml
    - docs/DEPLOY.md
decisions:
  - "D-01..D-05 implemented as given by the user; see the discretion items below"
requirements: [PWA-04]
metrics:
  completed: 2026-10-07
status: complete
commits: 3
plan_head_before: 153eaba43636c281b5b611d273440ac7a27b9bc4
actuals:
  tokens: 27000
  tasks: 3
  commits: 3
---

# Phase quick-261007-kbq Plan 01: Symmetric CI pipeline with path-affected e2e Summary

`ci.yml` is now the one `checks` definition: no push trigger, called identically by `deploy-api.yml`
(master) and `deploy-hml.yml` (homolog), with a `plan` job that runs only the Playwright specs a change can
affect (none / one job / four shards) and a manual `e2e-full.yml` for the whole suite.

## What changed

- **Selector (Task 1, `da7a068`).** `apps/web/e2e/affected-map.json` (33 groups, 39 shared globs, 23 ignored
  globs, `maxSomeShare` 0.4) built from reading the specs and the code; `apps/web/scripts/e2e-affected.ts`
  (plain `node`, node built-ins only); `apps/web/scripts/e2e-affected.test.ts` (44 tests, including the
  negative control for the unmapped-spec guard).
- **Workflows (Task 2, `c674f59`).** `ci.yml` loses `push` and the ignore filter, gains `plan` and a single
  matrix `e2e`; `.github/actions/local-stack` (bring-up once, with the retry) and
  `.github/actions/setup-workspace`; `e2e-full.yml` with `workflow_dispatch` only.
- **Symmetric gate and docs (Task 3, `2425a9f`).** `deploy-hml.yml` gets `checks` (`uses: ./.github/workflows/ci.yml`,
  guarded by `github.ref == 'refs/heads/homolog'`) and `needs: [checks, build]`; `deploy-api.yml` changed in
  comments only; `docs/deploy/ci.md` written; `docs/DEPLOY.md` corrected.

## Selector hand runs (Task 1 step 6)

| Run | Result |
|---|---|
| (a) `--event push --base 0ced952 --head 153eaba` (41 changed files) | `all`. Forced by `.github/workflows/ci.yml`, `apps/web/app/(auth)/entrar/actions.ts`, `apps/web/app/auth/confirm/route.ts`, `apps/web/proxy.ts`, `packages/contracts/src/moderation.ts`, `packages/core/server/tenancy/admin-members.ts`, `supabase/migrations/*` and `supabase/migrations/meta/*` (all shared) |
| (b) web-only slice of `91a81d5` (`apps/web/components`, `apps/web/messages`, via `--files-from`) | `some`, share 0.1: admin-members, blocked, csp, members, phase8-smoke. Contains admin-members and phase8-smoke, not feed |
| (c) the whole `91a81d5~1..91a81d5` range | `all`: `apps/web/e2e/admin.ts` is imported (transitively) by 39 specs, selection is 92.9% of the suite (limit 40%) |
| (d) `--event workflow_dispatch`; and a base of forty zeros | both `all`, with reasons "event workflow_dispatch has no push base" and "the base is the all-zero sha (new branch)" |
| (e) docs-only slice (`docs/DEPLOY.md`, `.planning/STATE.md`, a unit test) | `none`; `--github-output` wrote exactly `mode=none`, `specs=`, `matrix=` and the matrix line parsed with `JSON.parse` |

Also proven: `playwright test --list e2e/members.spec.ts` lists only members.spec.ts (34 tests, none from
admin-members) and `e2e/branding.spec.ts` lists only branding.spec.ts (27 tests, none from admin-branding or
platform-branding), so the `e2e/` prefix anchors the regex.

## Validation that did run locally

- Vitest `scripts/e2e-affected.test.ts`: 44/44 pass. Biome clean on the new files; `pnpm --filter @rede-social/web typecheck` clean; `TURBO_CACHE=local:r pnpm lint` passes.
- **actionlint v1.7.12 ran**: downloaded with `gh release download` into an isolated scratchpad directory, SHA-256 checksum verified against the published `checksums.txt` before extraction, run on all four workflow files (ci, e2e-full, deploy-api, deploy-hml): no findings. shellcheck is not installed, so actionlint did not lint the `run` scripts with it.
- A scratchpad `check-workflows.mjs` (YAML parse with `yaml@2.9.0`) asserts the structure: triggers, five job ids, `fromJSON` matrix, no `${{` inside any `run`, composite actions (`using: composite`, `shell: bash` on every run step, no ci-only credential redeclared), e2e-full has only `workflow_dispatch`, both `checks` jobs and `needs: [checks, build]`, and `on.push.paths` of both deploy files equal to the ones in `HEAD` before Task 3. All pass.
- The retry loop of `local-stack` was run in bash against a fake `supabase` and a fake `sleep`: a transient `toomanyrequests` retries with a 30 s pause and the warning annotation, a persistent `TLS handshake timeout` stops after three attempts (30 s then 60 s pauses), a non-transient error fails at once.
- `deploy-api.yml`: filtered diff (comments and blank lines removed) is empty. `deploy-hml.yml`: filtered diff is only the new `checks` block and the `needs: [checks, build]` line.

## Discretion items (veto if you disagree)

1. **Weight valve**: a selection whose weight (sum of spec line counts) exceeds `maxSomeShare` = 0.4 is promoted to `all`, so "a localized change = ONE job" stays true and a single job cannot approach its 60-minute limit.
2. **`e2e-full.yml` reuses `ci.yml` by `workflow_call`** (`suite: e2e-full`) instead of copying steps, and two composite actions collapse the three remaining copies of the bring-up. This lifts the 08-02 "no composite" decision; the justification is in the `ci.yml` header and in `docs/deploy/ci.md`.
3. **Helpers under apps/web/e2e** resolve through the import graph (a changed helper selects exactly the specs that import it, transitively), not hand-written map rows. Media fixtures resolve by file name mention.
4. **A manual `workflow_dispatch` of deploy-hml.yml** has no push base, so its `checks` run the full suite.

Further choices made while deriving the map, worth a look: (a) `csp.spec.ts` walks every surface of the app, so it was added to every group whose pages the walk visits (it is not only in the `csp-report` group); (b) the broad `components/platform/**` glob of the draft was split into explicit branding and platform-panel component lists (a new unlisted component there resolves to `all`); (c) the feed code was split into `feed-web` (UI and routes) and `feed-module` (module, read by stories, reels and notifications through raw SQL) so a feed UI change stays localized; (d) `messages/pt-BR/*.json` each form a `catalog-*` group whose specs include every importer of that catalog; (e) `title-font*`, `bg-tone`, `google-fonts`, `manifest`, `platform`, `push*`, `continue-path`, `components/brand`, `components/pwa` and `apps/web/public/seed-logos` are in `shared` because a root layout, the shell or the proxy imports them (shell-importer check); (f) `apps/api/src/routes/me.ts`, `health.ts`, `public.ts` and `apps/web/app/api/me/counters` stay unmapped on purpose, so they resolve to `all`.

## Deviations from Plan

None - the plan was executed as written. Differences from the plan's draft map are the evidence-driven choices listed above (the plan asked for them: "follow the evidence"). The plan's draft pointed at `apps/web/messages/pt-BR/media.json`, which does not exist, so it was dropped; the helper fan-in is now 39 specs for `admin.ts` (the plan cited 36 at planning time).

## docs/DEPLOY.md

`git status --porcelain -- docs/DEPLOY.md` printed nothing when the edit started, so it was edited. Changed places (only these hunks): the pipeline file list (lines 7-10), the "No CI gate on hml" bullet (now "CI gates hml like production", noting it supersedes the earlier statement), the production-branch bullet (line 75), the Phase 2 `pnpm verify` paragraph (line 633), the Phase 8 release step 1 (line 950, including "three things" -> "two things"), release step 7 (lines 1023-1026), and the production gate item 1 (lines 1208-1210). `docs/LOCAL-SETUP.md` (untracked, the user's own) was never touched or staged.

## Known Stubs

None.

## Not verifiable locally

These only truly run on GitHub. The first-run checklist in `docs/deploy/ci.md` closes them:

- Execution of any workflow, and that `uses: ./.github/actions/...` resolves inside a `workflow_call`ed file.
- That composite steps inherit the workflow-level `env` (SEED_PASSWORD, SEND_EMAIL_HOOK_SECRETS, ...).
- That `github.event.before` and `github.event.pull_request.base.sha` arrive as expected inside the called `ci.yml`, and the real `plan` timings.
- The reusable-workflow job names (`checks / ...`), the concurrency groups in practice, and `gh run rerun --failed` on nested jobs.
- The Docker retry against a real registry limit (only the loop logic was exercised, with fakes).
- Branch-protection required-check names after the job set changed (`e2e` is now one matrix with a dynamic name; a skipped `e2e` counts as success).
- That `workflow_dispatch` of `e2e-full.yml` appears: it needs the file on the default branch.

## First-run checklist (also in docs/deploy/ci.md section 7)

1. Open a PR: docs-only gives `plan` mode none and a skipped `e2e` with `static`, `db`, `e2e-pwa` running; a change under `apps/web/components/stories` gives `some`, the stories specs and one job `e2e some 1/1`. Read the `plan` log (resolved base) and step summary; confirm the `db` seed and integration steps see `SEED_PASSWORD`.
2. Push to `homolog` with a change under `apps/api`: one run Deploy homolog (hml), `checks / ...` plus `build`, `migrate-and-deploy-hml` waiting for both, no separate CI run, a real `before` sha in the `plan` log.
3. Push to `master` with a change under `apps/api`: the same on Deploy API; the `production` approval appears only after `checks` and `build` are green.
4. After the file reaches the default branch, dispatch E2E full once: four jobs `e2e all N/4`, no `static`, `db` or `e2e-pwa`.
5. Look for `supabase start failed (attempt` annotations when Docker is rate limited.
6. Check branch protection for the required-check names.
7. Record the durations of `plan`, `e2e some` and `e2e all` to calibrate `maxSomeShare`.

## Threat Flags

None beyond the plan's register. Mitigations applied: expressions reach the shell only through `env:` (checked by the structure script), the selector validates revisions and spawns git with argument arrays, every error path resolves to `all`, `checks` has no secrets, environment, `with` or permissions override, no package was installed (the only download was the checksum-verified actionlint binary, kept in the scratchpad).

## Self-Check: PASSED

- Files exist: `apps/web/e2e/affected-map.json`, `apps/web/scripts/e2e-affected.ts`, `apps/web/scripts/e2e-affected.test.ts`, `.github/actions/local-stack/action.yml`, `.github/actions/setup-workspace/action.yml`, `.github/workflows/e2e-full.yml`, `docs/deploy/ci.md`.
- Commits exist: `da7a068`, `c674f59`, `2425a9f` (3 commits since `153eaba`, measured with `git rev-list`); none carries a Co-Authored-By trailer; nothing pushed.
