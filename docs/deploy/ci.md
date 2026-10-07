# CI pipeline — which workflow runs when, and how the e2e is selected

Quick 261007-kbq (D-01 .. D-05). One definition of `checks` (`.github/workflows/ci.yml`), called the
same way for `master` and `homolog`, with a dev-server e2e that runs only the specs a change can
affect. `docs/DEPLOY.md` links here for the pipeline; secrets and per-environment values stay there.

> **Update (2026-10-07, at the user's request):** the dev-server e2e (`plan` + `e2e`, 25-30 min and
> flaky) is NO LONGER part of any gate. `checks` is `static`, `db` and `e2e-pwa` only, on pull
> requests, `master` and `homolog` alike. The whole suite runs only by hand, from `e2e-full.yml`
> (Actions tab -> E2E full (manual)). Wherever this file says the `e2e` job runs in `checks`, read it
> as "only in `e2e-full.yml`"; the selector and the map are kept for that manual run and for
> `--force-all` selection.

Terminology: a **tenant** is the organisation (its own host, brand and members); a **comunidade** is
a product feature inside a tenant (module `communities`, route `/comunidades`). The two never mean
the same thing in this file.

## 1. Which workflow runs on which event

| Event | Workflow | What runs |
|---|---|---|
| `pull_request` | `ci.yml` | `static`, `db`, `e2e-pwa` (`plan` and `e2e` are skipped) |
| push to `master`, touching a deploy `paths` entry | `deploy-api.yml` (Deploy API) | `checks` (= `ci.yml`) and `build` in parallel, then the production job behind the `production` reviewer |
| push to `homolog`, touching a deploy `paths` entry | `deploy-hml.yml` (Deploy homolog (hml)) | `checks` (= `ci.yml`) and `build` in parallel, then the hml job, no reviewer |
| manual, Actions tab | `e2e-full.yml` (E2E full (manual)) | `plan` (forced to `all`) and four `e2e` shards only |
| manual, Actions tab | `deploy-hml.yml` | the same as a push, but a dispatch has no push base, so `checks` run the full suite |

The deploy `paths` of both files are the same and unchanged: `apps/api/**`, `packages/**`,
`supabase/**`, `pnpm-lock.yaml` and the workflow file itself. `ci.yml` has **no push trigger**, so a
push never starts the suite twice. A push that touches only `apps/web` or docs matches no `paths` and
runs no workflow at all; Vercel builds the web app on its own (accepted: the web app has no
deploy gate of its own, and the pull request already ran the checks).

## 2. The jobs of `ci.yml`

The order inside each job is the order of the root `pnpm verify` script. `verify` still runs the whole
e2e locally; only CI selects.

| Job | What it proves | Stack |
|---|---|---|
| `static` | Biome + UI literal guard, `turbo typecheck build test`, the build-output gate (no authenticated route is static), module boundaries (and the negative fixture), the lane guard | none |
| `db` | pgTAP (RLS, tenant isolation), the seed, the API integration suite, the pooler spike | one local stack |
| `plan` | which e2e specs this change can affect: `none`, `some` or `all` (section 3) | none (plain `node` over `git diff`) |
| `e2e` | the dev-server suite (iPhone 14, Pixel 7, desktop): skipped on `none`, ONE job on `some`, four `--shard` jobs on `all` | one local stack per job |
| `e2e-pwa` | the production-build PWA run (service worker, manifest, offline, CSP): always runs | one local stack |

`checks` succeeds only when every job that ran succeeds; a skipped job (`plan`, `e2e`) counts as a success. With mode `none` or
`some` the number of parallel jobs that start a local stack drops from six (db, four shards, PWA) to
three (db, one e2e, PWA), or two on `none`.

## 3. The affected-e2e selector

Files: `apps/web/e2e/affected-map.json` (the versioned map), `apps/web/scripts/e2e-affected.ts` (the
selector, plain `node`, no dependency), `apps/web/scripts/e2e-affected.test.ts` (Vitest guard).

### Rules, in precedence order, for each changed path

1. **ignored** (`ignored` globs): skipped. Docs, `.planning`, unit tests (`**/*.test.ts`,
   `**/tests/**`), pgTAP files, Biome config, Dockerfile and similar cannot change an e2e run.
2. **shared** (`shared` globs): `all`. The kernel and UI package, contracts, config, the proxy, auth,
   the CSP, the shell, `supabase/**` (config and migrations), the lockfile, `.github/**`, the map and the
   selector themselves, and every file a root layout imports.
3. **under `apps/web/e2e`**: a changed `*.spec.ts` selects itself (a deleted one selects nothing); a
   helper `.ts` selects the specs that import it, transitively (a helper nobody imports is `all`); any
   other file (a media fixture) selects the specs and helpers whose source mentions its file name
   (nobody mentions it: `all`).
4. **map groups**: the union of the specs of every group whose globs match.
5. **unmapped**: nothing claims the path: `all`.

Then, for the whole change: an empty selection is `none`; a selection heavier than `maxSomeShare`
(0.4) of the suite is promoted to `all`; anything else is `some`. A forced `all` wins over everything.
Every doubt resolves to `all`, never to `none`.

The **weight valve** measures a spec by its line count. One non-sharded job running more than 40 % of
a 24.5k-line suite would risk its 60-minute limit, so such a selection is promoted to the four-shard
run. This keeps "a localized change runs ONE job" true for genuinely localized changes (a module, a
screen) and sends broad ones (a helper imported by 39 specs, a catalog used everywhere) to `all`.

### The map

```json
{
  "version": 1,
  "maxSomeShare": 0.4,
  "shared": ["glob", "..."],
  "ignored": ["glob", "..."],
  "groups": [
    { "id": "events", "why": "one sentence", "globs": ["glob"], "specs": ["events.spec.ts"] }
  ]
}
```

Spec names are bare file names. Glob semantics (hand-written matcher, unit-tested): `**` any depth,
including none; `*` inside one path segment; `?` one non-slash character; `{a,b}` alternatives; every
other character, including `( ) [ ]`, is literal, so `apps/web/app/(app)/inicio/**` and `[id]`
segments match as written, and dot-files match. Overlapping groups union their specs. Each feature has
a code group and a `catalog-*` group for its `messages/pt-BR/*.json`, whose specs also include every
spec that imports that catalog.

### Where the base comes from

| Event | Base | Head |
|---|---|---|
| `pull_request` | the pull request's base sha | the merge sha (`github.sha`) |
| `push` (a direct run or the deploy workflow's `checks`) | `github.event.before` | `github.sha` |
| `workflow_dispatch`, any other event, `suite: e2e-full` | none | `all` |
| empty base, forty zeros (new branch), unreachable sha (force push), malformed value, failing `git diff` | none | `all`, with the reason in the log |

The `plan` job checks out with `fetch-depth: 0`. Every value reaches the shell through `env:`; the CLI
validates the revisions against a strict pattern and runs git with an argument array (no shell).

### Running it locally

```bash
node apps/web/scripts/e2e-affected.ts --event push --base origin/master --head HEAD
```

The first line of stdout is JSON (`mode`, `specs`, `matrix`, `share`, `reasons`); the lines below are a
human report. To ask "what if I touch these files?" without a diff:

```bash
printf 'packages/modules/events/server/service.ts\ndocs/DEPLOY.md\n' > /tmp/files.txt
node apps/web/scripts/e2e-affected.ts --event push --base x --head y --files-from /tmp/files.txt
```

`--force-all` skips git and answers `all`. `--github-output <file>` appends `mode=`, `specs=` (space
separated `e2e/<name>.spec.ts`, empty unless `some`) and `matrix=` (one-line JSON);
`--summary-file <file>` appends the Markdown block the `plan` job posts to the run summary.

### Runbook: adding a spec or a feature module

- **A new `apps/web/e2e/*.spec.ts`**: add its file name to the `specs` of every group whose code it
  exercises (a spec that only signs in and lands on `/inicio` does not belong to the feed group).
  Until you do, `pnpm test` in `apps/web` fails: the guard names the missing file. Also make sure the
  name carries no whitespace (CI passes the list unquoted; the guard checks).
- **A new route, component or module directory**: add its glob to the right group in the map. If you
  forget, the files resolve to `all` (unmapped), which is slow but never wrong; a glob that matches no
  file fails the same Vitest file, so a rename that leaves a dead glob is caught.
- **A change that must always run everything**: add the glob to `shared`.
- Keep the `why` of a group to one sentence: what the code does and why those specs exercise it.

## 4. Composite actions

`.github/actions/setup-workspace` (pnpm, Node 24, frozen install) and `.github/actions/local-stack`
(CLI, ES256 keys, start with retry, reset, role, Realtime partition wait, optional pgTAP, env files,
seed). Plan 08-02 deliberately left four verbatim copies of the bring-up and added no composite action,
because nothing else needed to share them. That reasoning no longer holds: the `e2e` job is now one
matrix definition fed by `plan`, the Docker retry (section 5) must exist exactly once, and a drifted
copy would defeat the manual full run. `db`, `e2e` and `e2e-pwa` all call `local-stack`
(`pgtap: 'true'` only in `db`).

The ci-only credentials (`SEED_PASSWORD`, `SUPER_ADMIN_*`, `SEND_EMAIL_HOOK_SECRETS`) stay solely in
`ci.yml`'s workflow-level `env`. Composite steps inherit the job environment; the first run proves it
(the `db` seed and integration steps and the e2e seed see `SEED_PASSWORD`).

## 5. Docker rate limits

Jobs of one run start their local stacks at the same moment from the same runner address pool, so the
registry can answer `toomanyrequests`. `local-stack` retries `supabase start` up to three times, only
when the output names a transient registry or network error (`toomanyrequests`, `too many requests`,
`rate exceeded`, `rate limit`, `TLS handshake timeout`, `i/o timeout`, `connection reset`,
`unexpected EOF`), running `supabase stop --no-backup` and sleeping 30 s, then 60 s, in between. Each
retry emits a `supabase start failed (attempt N of 3)` warning annotation. Any other failure fails the
step at once. Running fewer stack-starting jobs on `none` and `some` also reduces the pressure.

What it cannot fix: a sustained limit longer than the two pauses. An authenticated Docker Hub login
would raise the limit, but it needs a repository secret and is deliberately not added; it is the
follow-up if the warnings keep appearing.

## 6. Known limits

- **The diff is against the previous branch head.** A red run followed by an unrelated push can hide
  the first push's affected specs: the second push's `plan` no longer sees them. Re-run the failed jobs
  (`gh run rerun --failed`), or dispatch **E2E full** before promoting.
- **A manual `deploy-hml.yml` dispatch runs the full suite**: no push base, so every spec.
- **A push touching only files outside the deploy `paths` runs no CI** (see section 1).
- **A skipped `e2e` counts as a success** for required checks, and renamed jobs change the check
  names: update the branch-protection required checks after the first run (section 7, item 6).
- **The dev-server e2e is still flaky.** A red affected `e2e` blocks both deploys; use
  `gh run rerun --failed` rather than pushing again (a new push moves the base, see the first point).
- **Hard-coded text.** A change to a `messages/pt-BR` catalog selects the specs that import it and the
  feature's own specs; a spec that hard-codes a string without importing the catalog is covered only
  through the feature group.

## 7. First-run checklist

Order matters: a workflow file changed by a pull request runs its own version on that pull request,
while a `master` push that touches only `.github/workflows/ci.yml` matches no deploy `paths`.

1. **Open a pull request.** With a docs-only change, `plan` prints `mode=none`, the `e2e` job is
   skipped, and `static`, `db` and `e2e-pwa` run. With a change under `apps/web/components/stories`,
   `plan` prints `some`, the stories group's specs, and exactly one e2e job named `e2e some 1/1`. Read
   the `plan` log for the resolved base and the step summary for the reasons. Confirm the `db` job's
   seed and integration steps see `SEED_PASSWORD` (composite steps inherit the job env).
2. **Push to `homolog` with a change under `apps/api`.** Exactly one run named Deploy homolog (hml),
   with jobs listed as `checks / ...` plus `build`, `migrate-and-deploy-hml` waiting for both, and no
   separate CI run. The `plan` log shows a real `before` sha, not zeros.
3. **Push to `master` with a change under `apps/api`.** The same on Deploy API, and the `production`
   approval appears only after `checks` and `build` are green.
4. **After the file reaches the default branch, dispatch E2E full once.** Four jobs `e2e all N/4`; no
   `static`, `db` or `e2e-pwa`.
5. **Look for `supabase start failed (attempt` annotations** when Docker is rate limited.
6. **Check branch protection** for the required-check names (`checks / ...` for the deploy workflows,
   the job names of `ci.yml` for pull requests).
7. **Record the durations** of `plan`, `e2e some` and `e2e all` to calibrate `maxSomeShare`.
