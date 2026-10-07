---
phase: quick-261007-kbq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/e2e/affected-map.json
  - apps/web/scripts/e2e-affected.ts
  - apps/web/scripts/e2e-affected.test.ts
  - .github/workflows/ci.yml
  - .github/actions/setup-workspace/action.yml
  - .github/actions/local-stack/action.yml
  - .github/workflows/e2e-full.yml
  - .github/workflows/deploy-api.yml
  - .github/workflows/deploy-hml.yml
  - docs/deploy/ci.md
  - docs/DEPLOY.md
autonomous: true
requirements: [PWA-04]
tags: [github-actions, ci, playwright, path-affected, composite-action, homolog, deploy, docs]

estimate:
  tokens: 100000
  raw_tokens: 100000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "ci.yml has no push trigger and no ignore filter on any trigger; it keeps pull_request and workflow_call. A push to master starts only Deploy API; a push to homolog starts only Deploy homolog (hml); neither push runs the suite twice (D-01)"
    - "deploy-api.yml and deploy-hml.yml each have a job `checks` that is `uses: ./.github/workflows/ci.yml`, and migrate-and-deploy-prod / migrate-and-deploy-hml both declare `needs: [checks, build]`. The `paths` blocks of both files, the hml preflight step, the `environment: homolog` / `production` blocks and every WIF line are unchanged (D-01)"
    - "The `checks` of a deploy run are static + db (pgTAP, seed, API integration, pooler spike) + e2e-pwa (production build) + plan + e2e. The 4-shard full dev-server run happens only when plan says `all` (shared path, unmapped code file, missing/zero/unreachable base, or selection over the weight valve) or when e2e-full.yml asks for it (D-02)"
    - "The selector prints `none` for docs/.planning/unit-test-only diffs, `all` for any change under packages/core, packages/ui, the proxy, auth, CSP, supabase/config.toml, pnpm-lock.yaml, .github/workflows, the map itself or any code file no group claims, `some` (one job, the chosen specs only) for a localized module change, and `all` when the base is empty, forty zeros, unreachable or the event is not push/pull_request (D-03)"
    - "A Vitest test in the web package fails when any `*.spec.ts` under apps/web/e2e is absent from affected-map.json, and a negative-control case proves the guard bites (D-03)"
    - "e2e-full.yml triggers only on workflow_dispatch and reuses ci.yml's e2e job through workflow_call (input `suite: e2e-full`), so the local-stack bring-up exists once, in .github/actions/local-stack, shared by db, e2e, e2e-pwa (D-04)"
    - "`supabase start` is retried (3 attempts, backoff, transient registry/network errors only) in the single composite bring-up; with mode none/some the number of parallel stack-starting jobs drops from six to three or four (D-05)"
    - "No e2e spec is modified, no flaky test is touched, nothing is pushed, no db push / config push / deploy is run, and docs/DEPLOY.md is edited only if it was clean (otherwise untouched and the stale lines are listed in the SUMMARY)"
  artifacts:
    - path: "apps/web/e2e/affected-map.json"
      provides: "versioned code-glob -> spec map, shared and ignored lists, weight valve"
      contains: "maxSomeShare"
    - path: "apps/web/scripts/e2e-affected.ts"
      provides: "pure selector + CLI that prints mode/specs/matrix and writes GITHUB_OUTPUT"
      contains: "planAffected"
    - path: "apps/web/scripts/e2e-affected.test.ts"
      provides: "Vitest guard: every spec mapped, selection rules, base fallbacks"
      contains: "affected-map.json"
    - path: ".github/actions/local-stack/action.yml"
      provides: "the single local Supabase bring-up (keys, start with retry, reset, role, realtime wait, optional pgTAP, env, seed)"
      contains: "using: composite"
    - path: ".github/actions/setup-workspace/action.yml"
      provides: "pnpm + Node 24 + frozen install, shared by every job"
      contains: "using: composite"
    - path: ".github/workflows/e2e-full.yml"
      provides: "manual full-suite run, 4 shards, no schedule"
      contains: "workflow_dispatch"
    - path: "docs/deploy/ci.md"
      provides: "pipeline description, adding-a-spec runbook, limits, first-run checklist"
  key_links:
    - from: ".github/workflows/ci.yml (plan job)"
      to: "apps/web/scripts/e2e-affected.ts"
      via: "node apps/web/scripts/e2e-affected.ts --github-output \"$GITHUB_OUTPUT\""
    - from: ".github/workflows/ci.yml (e2e job)"
      to: "plan outputs mode / specs / matrix"
      via: "needs.plan.outputs.* and strategy.matrix: fromJSON(needs.plan.outputs.matrix)"
    - from: "apps/web/scripts/e2e-affected.ts"
      to: "apps/web/e2e/affected-map.json"
      via: "fs read at run time (no local TS import: allowImportingTsExtensions is false)"
    - from: ".github/workflows/deploy-api.yml and deploy-hml.yml (checks)"
      to: ".github/workflows/ci.yml"
      via: "uses: ./.github/workflows/ci.yml; migrate jobs needs: [checks, build]"
    - from: ".github/workflows/e2e-full.yml"
      to: ".github/workflows/ci.yml"
      via: "uses + with: suite: e2e-full"
---

<objective>
Make the GitHub Actions pipeline symmetric for master and homolog and replace the 25-30 minute, flaky,
4-shard full dev-server e2e in the deploy gate with an e2e run limited to the specs a change can
affect.

The five user decisions are binding and are cited below as D-01..D-05:
- D-01 Symmetric pipeline: ci.yml loses its push trigger (and the ignore filter added earlier today);
  deploy-api.yml (master) and deploy-hml.yml (homolog) both call the SAME `checks`
  (`uses: ./.github/workflows/ci.yml`) and each deploy job `needs` it; header comments and the matching
  documentation are updated; both `paths` filters stay exactly as they are; no isolation guard weakens.
- D-02 `checks` = static + db + e2e-pwa + one path-affected e2e job. No full dev-server run by default.
- D-03 Versioned map of code globs -> Playwright specs, derived by reading the code, plus a selector
  script (unit-tested) and a Vitest guard that fails when a spec is missing from the map. Shared or
  unmapped code => all specs through the existing `--shard` fan-out; localized change => ONE job with
  the chosen specs; nothing relevant => skip e2e.
- D-04 No scheduled/nightly e2e. `e2e-full.yml` is workflow_dispatch only and reuses the bring-up with
  no divergent copy.
- D-05 Mitigate Docker `toomanyrequests` when several jobs run `supabase start` at once (retry with
  backoff, fewer parallel stack-starting jobs).

Purpose: a deploy gate that finishes in minutes for a localized change, never silently under-tests (every
doubt resolves to "all"), and is described once, in one place per concern.

Claude's-discretion choices (flag them in the SUMMARY so the user can veto):
1. Weight valve: a non-empty selection whose weight (sum of spec line counts) exceeds `maxSomeShare`
   (0.4) of the whole suite is promoted to `all`, because one non-sharded job would risk its 60-minute
   limit; this keeps "a localized change => ONE job" true for genuinely localized changes.
2. e2e-full.yml reuses ci.yml by `workflow_call` with an input (`suite: e2e-full`) rather than copying
   steps; two composite actions are added anyway to collapse the three remaining copies of the bring-up
   (db, e2e, e2e-pwa) and to host the retry once. Justification for lifting the 08-02 "no composite"
   decision: 08-02 left four copies because nothing else needed to share them; now the e2e job is one
   matrix definition, the retry (D-05) must exist exactly once, and a drifted copy would defeat D-04.
3. Changes under apps/web/e2e that are not specs are resolved by the helper import graph (a changed
   helper selects exactly the specs that import it, transitively), not by hand-written map rows.
4. A manual `workflow_dispatch` of deploy-hml.yml has no push base, so its `checks` run the full suite.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@.github/workflows/ci.yml
@.github/workflows/deploy-api.yml
@.github/workflows/deploy-hml.yml
@apps/web/playwright.config.ts
@apps/web/playwright.pwa.config.ts
@apps/web/vitest.config.ts
@docs/LOCAL-SETUP.md

Facts observed live at planning time (re-verify cheaply before relying on them):
- ci.yml today: triggers `pull_request`, `push` (master, homolog, with an ignore list mirroring deploy-api.yml's
  paths) and `workflow_call`; jobs `static`, `db`, `e2e` (matrix shard 1..4 of 4), `e2e-pwa`; the local-stack
  bring-up (setup-cli, ES256 keys, start, reset, db-local-role, Realtime partition wait, env files, seed) is
  copied into db, e2e and e2e-pwa; workflow-level env holds the ci-only SEED_PASSWORD, SUPER_ADMIN_PASSWORD,
  SUPER_ADMIN_EMAIL, SEND_EMAIL_HOOK_SECRETS; job-level concurrency groups are
  `ci-${{ github.workflow }}-${{ github.ref }}-<job id>` (+ `-<shard>` for e2e), cancel-in-progress true.
- deploy-api.yml already has `checks` (`if: github.event_name == 'push'`) and `migrate-and-deploy-prod`
  (`needs: [checks, build]`). deploy-hml.yml has NO `checks`; `migrate-and-deploy-hml` has `needs: build`
  and a header that says CI does not gate homolog. `.github/actions/` does not exist.
- In a called workflow, `github.workflow`, `github.ref`, `github.event_name`, `github.event.before` and
  `github.sha` are the CALLER's, so the existing per-job concurrency groups stay apart per caller. ci.yml's
  `permissions: contents: read` caps the called jobs (no id-token, no secrets): `checks` needs no cloud
  credentials and must not be given `secrets: inherit`, an `environment`, or `vars`.
- docs/DEPLOY.md is CLEAN in git right now (no tracked modification); docs/LOCAL-SETUP.md is UNTRACKED (the
  user's own file: never touch or stage it). Stale statements in DEPLOY.md: lines 7-10 (pipeline file list),
  30-32 ("No CI gate on hml"), 75-76 (ci.yml triggers on master), 632-633 ("single `checks` job"),
  950 and 1023-1026 (a separate `CI` run of 4 shards after the master push), 1208-1210 (production gate lists
  e2e).
- Tools: actionlint, shellcheck, yq, go are NOT installed; `gh`, `curl`, `jq`, Node 24.14.0, pnpm 12.4.1 are;
  `yaml@2.9.0` exists in node_modules/.pnpm (usable for a YAML parse). Node 24 runs `.ts` natively
  (verified at planning time with a probe that used parseArgs, import.meta.url and `export type`).
- apps/web/tsconfig inherits `allowImportingTsExtensions: false` (Bundler resolution), so a script run by
  plain `node` cannot import a sibling `.ts` and still typecheck: the selector has no local imports and
  reads the JSON map with fs. apps/web/vitest.config.ts excludes `e2e/**` from unit collection, so the
  Vitest guard lives in apps/web/scripts/. A cross-package relative import would fail `turbo boundaries`.
- 48 specs under apps/web/e2e (24.5k lines; heaviest events 2191, stories 2049, comunidades 1369, notifications
  966, platform-wizard 936, reels 879, phase2-smoke 871, chat 850). 18 non-spec helpers; import fan-in:
  fixtures 48 (it imports hosts), admin 36, worker 15, tenant-fixtures 11, domains-admin 8, events-admin 5,
  hydration 5, wizard 5, branding-admin/feed-admin/media-fixtures/members-admin 4, chat-admin/mail 3,
  csp-collector/notifications-admin/push-fake 2. apps/web/e2e/fixtures/ holds media files (jpg, heic, mp4).
- Playwright positional arguments are regexes matched against the absolute spec path, so a bare
  `members.spec.ts` also selects `admin-members.spec.ts` and `branding.spec.ts` also selects
  `admin-branding.spec.ts` and `platform-branding.spec.ts`. The selector must emit `e2e/<name>.spec.ts`.
- playwright.pwa.config.ts testMatch is `(pwa|events-prefetch|csp)\.spec\.ts`; pwa.spec.ts and
  events-prefetch.spec.ts self-skip without PWA_PROD=1, so on the dev server they are harmless no-ops;
  csp.spec.ts runs in both configs. `e2e-pwa` always runs in `checks`.
- Terminology for every file you write: "tenant" is the organisation; "comunidade" is a product feature
  (module `communities`, route /comunidades), never the tenant.
- Commits: NO Co-Authored-By trailer and no tool attribution line (public repo, user rule, overrides any
  default); stage ONLY the paths of the task by explicit path (the tree holds unrelated untracked user
  files: .claude/*, .planning/research/.cache, docs/LOCAL-SETUP.md, ...); never `git add -A`, `git add .`
  or `git commit -a`; do NOT push. Use `TURBO_CACHE=local:r` for every turbo gate (the local turbo cache
  fills the disk).
</context>

<interfaces>
Selector CLI contract (Task 1 implements, Task 2 consumes; keep these names exactly).

Command, run from the repo root with plain `node` (no install, no tsx):
  node apps/web/scripts/e2e-affected.ts --event <name> --base <rev> --head <rev> [--force-all]
       [--files-from <path|->] [--github-output <file>] [--summary-file <file>] [--repo-root <dir>]

- `--event`: push and pull_request use base/head; every other value (workflow_dispatch, missing) => all.
- Revs must match `^[0-9a-fA-F]{40,64}$` or the safe ref pattern `^[A-Za-z0-9_][A-Za-z0-9._~^/@{}-]*$`; anything else, an
  empty value, forty zeros, an unresolvable commit, or a failing `git diff` => mode `all` with the reason.
  Git is spawned with argument arrays only (never a shell).
- `--files-from`: read the changed-file list from a file or stdin (`-`), NUL- or newline-separated; used for
  what-if runs and by the tests; it replaces the git diff.
- `--force-all`: mode all, no git call.
- stdout, first line, JSON: {"mode","specs","matrix","share","reasons"}; then a short human report.
- `--github-output` appends single-line `mode=none|some|all`, `specs=<space-separated e2e/<name>.spec.ts>`
  (empty unless `some`), `matrix=<one-line JSON>`.
- matrix: all => {"include":[{"shard":1,"total":4},...4]}; some => {"include":[{"shard":1,"total":1}]};
  none => the same inert one-entry matrix (it only has to parse; the e2e job's `if` skips it).
- `--summary-file` appends a markdown block (mode, base..head, spec count, up to 20 reasons).
- Exit code 0 whenever a mode was produced; every internal error resolves to `all`, never to `none`.

Selection order for each changed path: ignored => skip; shared => all; under apps/web/e2e => derived rules;
map groups => union of every matching group's specs; otherwise unmapped => all. Then: empty set => none;
set weight over maxSomeShare of total weight => all; else some. Derived e2e rules: a spec file selects
itself; a non-spec .ts helper selects the specs that import it, transitively (regex over `from './x'` and
dynamic `import('./x')` in apps/web/e2e/*.ts; a helper nobody imports => all); any other file (fixtures/*.jpg,
*.mp4, ...) selects the specs/helpers whose source text contains its basename (none => all);
apps/web/e2e/affected-map.json itself is in `shared`.

Map schema (apps/web/e2e/affected-map.json): {"version":1,"maxSomeShare":0.4,"shared":[globs],"ignored":[globs],
"groups":[{"id","why","globs":[globs],"specs":["feed.spec.ts",...]}]}. Spec names are bare file names.
Glob semantics (hand-written matcher, unit-tested): `**` any depth including none, `*` within one segment,
`?` one non-slash char, `{a,b}` alternatives; every other regex metacharacter, including ( ) [ ], is literal,
so `apps/web/app/(app)/inicio/**` and `[id]` segments match literally; dot-files match.

Workflow wiring that Task 2 must produce (shape only; YAML details are in the task):

    on:
      pull_request:
      workflow_call:
        inputs:
          suite:
            description: "checks (default) runs every job; e2e-full runs only plan + e2e, every spec, 4 shards"
            type: string
            default: checks

    plan:   # outputs mode/specs/matrix from the step id `plan`; checkout with fetch-depth: 0; setup-node 24, no install
      env:
        EVENT_NAME: ${{ github.event_name }}
        BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}
        HEAD_SHA: ${{ github.sha }}
        SUITE: ${{ inputs.suite }}

    e2e:
      needs: plan
      if: needs.plan.outputs.mode != 'none'
      strategy:
        fail-fast: false
        matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}
      # run step: env E2E_MODE, E2E_SPECS, SHARD, TOTAL, PLAYWRIGHT_REPORT_DIR/OUTPUT_DIR (per shard as today);
      # mode all => playwright test --shard="$SHARD/$TOTAL"; otherwise playwright test $E2E_SPECS (unquoted on purpose)

Every value from a github.* / inputs.* expression reaches a shell only through `env:`, never interpolated
inside `run:`.

Draft affected map (starting point from planning-time reading; Task 1 verifies every row against the code and
adjusts). Spec names are shown without `.spec.ts`. Overlapping globs union their specs.

| group id | code globs (repo-root relative) | specs |
|---|---|---|
| feed | packages/modules/feed/**; apps/web/components/feed/**; apps/web/lib/feed*; apps/web/app/(app)/{inicio,post,criar}/**; apps/web/messages/pt-BR/feed.json | feed, feed-comments, feed-composer, feed-media, feed-share, phase4-smoke, comunidades, moderation, notifications, reels, phase7-smoke, phase8-smoke |
| stories | packages/modules/stories/**; apps/web/components/stories/**; apps/web/lib/{stories,story-view}.ts; apps/web/app/(app)/stories/**; apps/web/app/api/stories/**; messages stories.json | stories, phase5-smoke, phase52-smoke, comunidades, moderation, phase8-smoke |
| communities | packages/modules/communities/**; apps/web/components/communities/**; apps/web/lib/communities.ts; apps/web/app/(app)/{comunidades,criar}/**; messages communities.json | comunidades, stories, phase5-smoke, phase52-smoke, moderation, phase8-smoke |
| events | packages/modules/events/**; apps/web/components/events/**; apps/web/lib/event*; apps/web/lib/viacep.ts; apps/web/app/(app)/eventos/**; apps/web/app/api/cep/**; messages events.json | events, events-prefetch, phase6-smoke, phase8-smoke, notifications, phase7-smoke |
| reels | packages/modules/reels/**; apps/web/components/reels/**; apps/web/lib/reels*; apps/web/app/(app)/reels/**; messages reels.json | reels, moderation |
| notifications-push | packages/modules/notifications/**; apps/web/app/(app)/notificacoes/**; apps/web/app/api/{notifications,push}/**; apps/web/components/push/**; apps/web/lib/{notif*,push*,seen-batch.ts}; messages notifications.json | notifications, push, phase7-smoke, shell |
| chat | packages/modules/chat/**; apps/web/app/(app)/suporte/**; apps/web/app/api/chat/**; apps/web/lib/chat*; messages chat.json | chat, phase7-smoke, notifications |
| admin-members | apps/web/app/(app)/configuracoes/membros/**; apps/web/components/admin/**; apps/web/lib/admin-members.ts; apps/api/src/routes/admin/members.ts; messages admin.json, members.json | admin-members, phase8-smoke |
| members-profile | apps/web/app/(app)/{membros,perfil}/**; apps/web/components/profile/**; apps/web/lib/profile.ts; apps/api/src/routes/members.ts; messages profile.json | members, profile, phase3-smoke, media-upload, shell |
| moderation-admin | apps/web/app/(app)/configuracoes/moderacao/**; apps/web/lib/moderation*; apps/web/components/admin/ModerationLogRow.tsx; apps/api/src/routes/admin/moderation.ts; messages moderation.json | moderation, admin-members, phase8-smoke |
| community-rules | apps/web/app/(app)/configuracoes/regras/**; apps/web/components/rules/**; apps/api/src/routes/admin/rules.ts | admin-rules, signup, phase8-smoke |
| branding | apps/web/app/(app)/configuracoes/marca/**; apps/web/components/brand/**; apps/web/components/platform/{Brand*,ColorField*,Contrast*,DarkLogo*,Derived*,IconOverride*,LogoUpload*,useBrandingView*,preview/**}; apps/web/lib/{branding-view,branding-upload,bg-tone,contrast-ratio,title-font*,google-fonts,manifest}*; apps/web/app/m/**; apps/api/src/routes/{admin,platform}/branding.ts; messages platformBranding.json | admin-branding, platform-branding, branding, phase2-smoke, phase8-smoke, platform-wizard, pwa |
| platform-panel | apps/web/app/(platform)/**; apps/web/components/platform/**; apps/web/lib/{platform*,wizard-metadata,slugify,preview-modules}*; apps/api/src/routes/platform/**; apps/web/app/(auth)/{aceitar-convite,convite-expirado}/**; messages platform*.json, acceptInvite.json | platform, platform-tenants, platform-wizard, platform-domains, platform-branding, phase2-smoke, invite |
| auth-pages | apps/web/app/(auth)/{cadastro,esqueci-senha,redefinir-senha,verifique-seu-email,participar,escolher-comunidade,acesso-suspenso,sem-comunidade,endereco-invalido,comunidade-indisponivel,termos,privacidade}/**; apps/api/src/routes/{join,hooks}.ts; apps/web/lib/{signup-confirmation,pending-confirmation,join-draft,mail-return-origin,continue-path}.ts; messages signup, forgot, reset, join, hostMismatch, noCommunity, suspended, unavailable, verifyEmail, legal | signup, recovery, auth-pages, blocked, host-mismatch, multi-tenant-identity, login, logout, session, admin-rules, invite, platform, phase2-smoke, phase8-smoke |
| media | apps/web/components/media/**; apps/web/lib/{media,upload}.ts; apps/web/app/v1/media/**; apps/web/app/(app)/configuracoes/midia/**; apps/api/src/routes/media.ts; apps/api/src/routes/webhooks/mux.ts; messages media.json | media-upload, media-video, feed-media, feed-composer, phase3-smoke, profile, stories, phase52-smoke, reels |
| pwa | apps/web/components/pwa/**; apps/web/app/{sw.ts,serwist/**,~offline/**}; apps/web/public/**; apps/web/lib/push-sw.ts; messages pwa.json | pwa, push, phase7-smoke, branding, phase2-smoke, shell |
| csp-report | apps/web/app/api/csp-report/** | csp |

Draft `shared` (any match => all): .github/workflows/**, .github/actions/**, apps/web/e2e/affected-map.json,
apps/web/scripts/e2e-affected.ts, apps/web/playwright.config.ts, apps/web/playwright.pwa.config.ts, package.json,
pnpm-lock.yaml, pnpm-workspace.yaml, turbo.json, **/package.json, **/tsconfig*.json, **/turbo.json, .node-version,
.nvmrc, supabase/**, packages/core/**, packages/ui/**, packages/contracts/**, packages/config/**,
apps/api/src/{app,main,worker,env,app-type}.ts, apps/api/src/http/**, apps/api/src/modules/registry.ts,
apps/web/{proxy,next.config,instrumentation-client}.ts, apps/web/lib/csp.ts, apps/web/app/{layout.tsx,globals.css,
error.tsx,page.tsx}, apps/web/app/auth/**, apps/web/app/(auth)/entrar/**, apps/web/app/(auth)/*.tsx,
apps/web/app/(app)/{layout.tsx,actions.ts}, apps/web/app/(app)/configuracoes/{page.tsx,ActionToast.tsx},
apps/web/components/{shell,feedback,forms}/**, apps/web/components/profile/{ProfileNudge,RearmProfileNudge}*,
apps/web/lib/{profile-nudge,admin-icon,admin-icon-cookie,host-brand,brand-scope,api,env,bootstrap,tenant-host,
registry,revalidate-tenant,route-handlers.inventory,tab-dots,relative-time}.ts*, apps/web/lib/supabase/**,
apps/web/i18n/**, apps/web/messages/pt-BR/{app,common,login}.json, scripts/{seed.ts,local-env.sh,
db-local-role.sh,supabase.sh}.

Draft `ignored` (cannot change any e2e run; evaluated BEFORE shared): .planning/**, docs/**, reference/**,
.claude/**, .gsd/**, **/*.md, **/*.test.ts, **/*.test.tsx, **/tests/**, **/vitest*.ts, supabase/tests/**,
supabase/snippets/**, biome.json, packages/config/biome.base.json, scripts/{check-*.sh,guard-*.sh,
vercel-ignore*,rehearse-*,rehearsal/**,vitest.config.ts}, packages/reuse-fixture/**,
packages/boundary-fixture/**, apps/api/Dockerfile, .dockerignore, apps/web/vercel.json.
Anything else under apps/, packages/ or scripts/ that nothing claims is unmapped => all.
</interfaces>

<tasks>

<task type="tracer">
  <name>Task 1: Path-affected e2e selection, end to end - map, selector CLI and Vitest guard (D-03)</name>
  <files>apps/web/e2e/affected-map.json, apps/web/scripts/e2e-affected.ts, apps/web/scripts/e2e-affected.test.ts</files>
  <read_first>
    apps/web/playwright.config.ts, apps/web/playwright.pwa.config.ts, apps/web/vitest.config.ts,
    packages/config/tsconfig.base.json, packages/config/biome.base.json, apps/web/e2e/fixtures.ts (head),
    apps/web/e2e/admin.ts (head), the doc comment of each apps/web/e2e/*.spec.ts, apps/web/app/layout.tsx,
    apps/web/app/(app)/layout.tsx, apps/web/app/(auth)/layout.tsx, apps/web/components/shell/*.tsx, apps/web/proxy.ts
  </read_first>
  <behavior>
    - globToRegExp: `**` spans directories (and matches zero), `*` stops at `/`, `?` is one non-slash character, `{a,b}` alternates; `(app)` and `[id]` match literally; `apps/web/app/(app)/inicio/**` matches `apps/web/app/(app)/inicio/page.tsx` and not `apps/web/app/(app)/inicio-x/page.tsx`; `.github/**` matches `.github/workflows/ci.yml`.
    - Guard: the set of `*.spec.ts` files in apps/web/e2e minus the union of every group's `specs` is empty, and the failure message names the missing file and says to add it to affected-map.json; every group spec exists on disk; spec names contain no whitespace (the CI step passes them unquoted); every group glob matches at least one file from `git ls-files --cached --others --exclude-standard` (dead-glob check on group globs only, so the shared/ignored lists may name files a later task creates); no glob appears twice in one list. Negative control: `findUnmappedSpecs([...real specs, 'zz-new.spec.ts'], map)` returns `['zz-new.spec.ts']`.
    - planAffected on the real map and real inventory: `['docs/DEPLOY.md', '.planning/STATE.md']` => none; `['packages/core/tests/x.test.ts']` => none (unit test); `['.github/workflows/ci.yml']`, `['packages/core/server/auth/context.ts']`, `['packages/ui/src/index.ts']`, `['apps/web/proxy.ts']`, `['apps/web/lib/csp.ts']`, `['apps/web/app/(auth)/entrar/page.tsx']`, `['supabase/config.toml']`, `['supabase/migrations/20260101000000_x.sql']`, `['pnpm-lock.yaml']`, `['apps/web/e2e/affected-map.json']`, `['apps/web/scripts/e2e-affected.ts']` => each all; a code file no group claims (`['apps/web/lib/relative-time.ts']`, `['apps/api/src/routes/me.ts']`) => all; `['packages/modules/events/server/service.ts']` => some, contains events.spec.ts and phase6-smoke.spec.ts, does not contain feed.spec.ts; two groups together => the union; one doc plus one events file => same as the events file alone; the selected paths are `e2e/<name>.spec.ts`.
    - e2e-dir rules: `['apps/web/e2e/members.spec.ts']` => some with only that spec (and `e2e/members.spec.ts` never selects admin-members by regex substring); a helper such as `apps/web/e2e/chat-admin.ts` => exactly the specs that import it, transitively; `apps/web/e2e/fixtures.ts` and `apps/web/e2e/hosts.ts` => all specs (promoted to all); `apps/web/e2e/fixtures/sample.mp4` => the specs whose source mentions `sample.mp4`.
    - Weight valve: with a synthetic map/inventory, a selection above maxSomeShare returns all with a reason naming the share; at or below it returns some.
    - Fallbacks with real temporary git repos (os.tmpdir, `-c user.name=t -c user.email=t@t -c commit.gpgsign=false`, removed in afterAll): base empty, forty zeros, a well-formed but absent sha, a malformed value such as `;rm -rf`, event `workflow_dispatch`, and `--force-all` each => all with a reason and no throw; a valid base..head with one changed docs file => none; with one changed events file => some; a thrown error inside planning => all.
    - Matrix and output: all => four entries total 4; some and none => one entry total 1; `--github-output` writes exactly three single-line keys; `specs` is empty unless some.
  </behavior>
  <action>
    Build the whole selection chain once so Tasks 2 and 3 only consume it (per D-03).

    1. Evidence pass (derive, do not guess). In the scratchpad directory, never in the repo, write a throwaway node script that prints for every apps/web/e2e/*.spec.ts: its line count, the pt-BR message catalogs it imports with a usage count, the local helper modules it imports, and the route prefixes it navigates (goto, toHaveURL). Use it to confirm or correct each row of the draft table in the interfaces block. A cross-feature spec joins a group only when it exercises that group's code (deep catalog use, a route of the feature it drives, or that feature's admin helper), not when it merely signs in and lands on /inicio. When the evidence disagrees with the draft, follow the evidence and put the reason in the group's `why`.

    2. Shell-importer check. Read the import lists of apps/web/app/layout.tsx, apps/web/app/(app)/layout.tsx, apps/web/app/(auth)/layout.tsx, every file in apps/web/components/shell/ and apps/web/proxy.ts. Any file those import (one hop) that a group glob also matches renders on every page: move it from the group to `shared`. The draft already moves the profile nudge components, the admin-icon helpers, host-brand and brand-scope; confirm and extend the list.

    3. Write apps/web/e2e/affected-map.json to the schema in the interfaces block, starting from the corrected draft: every one of the 48 spec files appears in at least one group's `specs`; each group has an English one-sentence `why` that says what the group's code does and why those specs exercise it; "tenant" means the organisation and "comunidade" only the product feature. Keep `maxSomeShare` at 0.4. Do not edit any spec file.

    4. Write apps/web/scripts/e2e-affected.ts to the CLI contract in the interfaces block, honouring D-03 exactly. Constraints: erasable TypeScript only (no enums, namespaces or parameter properties) because CI runs it with plain `node`; no dependency except node: built-ins; no import of another local file; read the map and the e2e directory through fs relative to `--repo-root` (default: derived from import.meta.url); export the pure pieces (globToRegExp, loadInventory, planAffected, resolveChangedFiles, buildMatrix, findUnmappedSpecs, formatGithubOutput) so Vitest can import them extensionless; run main() only when the file is the process entry point (compare import.meta.url with the pathToFileURL of process.argv[1]); read changed paths with `git diff --name-only -z --no-renames <base> <head>` through execFileSync with an argument array after validating base and head (the safe patterns are in the interfaces block); wrap planning in a try/catch whose handler returns mode all with the error text as the reason. The selection order, the e2e-directory derived rules and the weight valve are specified in the interfaces block. A path that matches a shared glob must win over every group glob, and an ignored glob must win over shared (unit-test files under shared directories stay ignored).

    5. Write apps/web/scripts/e2e-affected.test.ts covering every bullet of <behavior>. Import the module extensionless.

    6. Format and gate: run `pnpm exec biome check --write` on the three files, then the verify command. Then run the CLI by hand and keep the results for the SUMMARY: (a) `--event push --base 0ced952 --head 153eaba` (the user's HEAD~9..HEAD as it was at planning time, pinned to explicit shas; expect all; cite the paths that forced it); (b) the web-only slice: write `git diff --name-only -z 91a81d5~1 91a81d5 -- apps/web/components apps/web/messages` into a scratchpad file (capture git's status first, no pipe) and pass it as `--files-from <file>` (expect some containing admin-members.spec.ts and phase8-smoke.spec.ts, not feed.spec.ts); (c) the whole `--base 91a81d5~1 --head 91a81d5` range (expect all, because apps/web/e2e/admin.ts is imported by 36 specs); (d) `--event workflow_dispatch` and a base of forty zeros (expect all with the fallback reason); (e) a docs-only slice (expect none). Also run it once with `--github-output` pointing at a scratchpad file and parse the `matrix=` line with JSON.parse to prove the workflow can read it.

    7. Anchored-filter proof: with SEED_PASSWORD=x exported, run `pnpm --filter @rede-social/web exec playwright test --list e2e/members.spec.ts` and confirm that no listed test belongs to admin-members.spec.ts; repeat with e2e/branding.spec.ts against admin-branding and platform-branding. `--list` does not start any web server.

    8. Run `pnpm --filter @rede-social/web typecheck` (the package script, `next typegen && tsc --noEmit`) to prove the new TypeScript files typecheck, then commit with `git add` on the three explicit paths only. Message: `ci(quick-261007-kbq): path-affected e2e selector with a versioned spec map and a guard test`. No trailer. Do not push.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social && TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run scripts/e2e-affected.test.ts && pnpm exec biome check apps/web/scripts apps/web/e2e/affected-map.json && node apps/web/scripts/e2e-affected.ts --event push --base 0ced952 --head 153eaba | head -1 | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));if(!['none','some','all'].includes(j.mode))process.exit(1)"</automated>
  </verify>
  <done>
    The Vitest file passes and fails (negative control) when a spec is unmapped; the CLI answers none/some/all correctly for the five hand runs, falls back to all on a zero/absent/malformed base; the three files are Biome-clean and typecheck; `playwright --list e2e/<name>.spec.ts` selects only the named spec; the three files are committed by explicit path and nothing else is staged.
  </done>
</task>

<task type="auto">
  <name>Task 2: ci.yml with plan + affected e2e, shared composite bring-up, manual e2e-full workflow (D-01, D-02, D-04, D-05)</name>
  <files>.github/workflows/ci.yml, .github/actions/setup-workspace/action.yml, .github/actions/local-stack/action.yml, .github/workflows/e2e-full.yml</files>
  <read_first>
    .github/workflows/ci.yml, .github/workflows/deploy-api.yml, apps/web/scripts/e2e-affected.ts (the CLI contract),
    scripts/db-local-role.sh, scripts/local-env.sh (header)
  </read_first>
  <action>
    Make ci.yml the single `checks` definition for pull requests, master, homolog and the manual full run (per D-01, D-02, D-04). Preserve every existing job semantic (env, concurrency per job and shard, seed and credentials handling, step order, timeouts, artifact uploads).

    1. Create .github/actions/setup-workspace/action.yml: a composite action with the three steps every job repeats today, in the same order: pnpm/action-setup@v6, actions/setup-node@v7 (node-version 24, cache pnpm), then `pnpm install --frozen-lockfile` with `shell: bash`. The job keeps its own `actions/checkout@v7` first, because a local action path resolves only after checkout.

    2. Create .github/actions/local-stack/action.yml: a composite action with one input `pgtap` (default 'false'). Its steps are today's db-job bring-up, one copy, in this order: supabase/setup-cli@v3 pinned to 2.117.0; generate the ES256 signing keys (keep the existing comment about the empty seed set and the CLI appending the key); start the stack; `supabase db reset`; `bash scripts/db-local-role.sh`; the Realtime partition wait (one copy of the loop, one comment that names every consumer: pgTAP 150/152, the notification and chat specs, the signed-in shell); `supabase test db` only when `inputs.pgtap == 'true'`, in that exact position (before the env files, because pgTAP must run before the seed); write apps/api/.env.local and apps/web/.env.local with scripts/local-env.sh; seed with `pnpm db:seed`. Every `run:` step declares `shell: bash`. Do NOT redeclare any ci-only credential in the composite: SEED_PASSWORD, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_EMAIL and SEND_EMAIL_HOOK_SECRETS stay solely in ci.yml's workflow-level env, which composite steps inherit as job environment (the run output of the db job's seed and integration steps proves it on the first run; say so in the docs).
       The start step implements D-05: capture the output with tee under `set -o pipefail`; attempt up to three times; retry only when the captured output matches a transient registry or network error (case-insensitive `toomanyrequests`, `too many requests`, `rate exceeded`, `rate limit`, `TLS handshake timeout`, `i/o timeout`, `connection reset`, `unexpected EOF`); between attempts run `supabase stop --no-backup` best effort, emit a `::warning::` annotation naming the attempt, and sleep 30 s then 60 s; any other failure, or the third failure, fails the step at once. Comment the reason: several jobs of one run pull the same images from the same runner address pool.

    3. Rewrite .github/workflows/ci.yml:
       - Header comment: replace the 08-02 paragraph. Describe the job set (static, db, plan, e2e, e2e-pwa), the two callers (deploy-api.yml and deploy-hml.yml, symmetric), the pull_request trigger, the `suite` input, the affected-e2e idea in two sentences with a pointer to docs/deploy/ci.md, and the justification for the composite actions (see the objective, discretion item 2). Keep the sentence that the file mirrors the root `verify` script and that a step is added here only when `verify` gains one, in the same position; add that `verify` still runs the whole e2e locally.
       - Triggers: pull_request; workflow_call with the `suite` input shown in the interfaces block. Remove the push trigger and the ignore filter entirely, together with their explanatory comment (D-01).
       - Keep the workflow-level `permissions: contents: read` and the whole workflow-level `env` block unchanged.
       - static: first steps become checkout + setup-workspace; every later step unchanged. db: checkout, setup-workspace, local-stack with `pgtap: 'true'`, then "API integration suite" and "Pooler lane spike" unchanged. e2e-pwa: checkout, setup-workspace, local-stack, Playwright Chromium install, the production-build run with its env, the artifact upload, all unchanged. Add `if: ${{ inputs.suite != 'e2e-full' }}` to static, db and e2e-pwa (empty on pull_request, so they run).
       - Add the `plan` job and the `e2e` job exactly as outlined in the interfaces block. plan: `runs-on: ubuntu-latest`, `timeout-minutes: 10`, job outputs mode, specs and matrix from the step id `plan`; steps: checkout with `fetch-depth: 0`, setup-node 24 (no cache, no install), then one step that runs the CLI with --event "$EVENT_NAME" --base "$BASE_SHA" --head "$HEAD_SHA", `--force-all` when `$SUITE` equals e2e-full, `--github-output "$GITHUB_OUTPUT"` and `--summary-file "$GITHUB_STEP_SUMMARY"`. e2e: name `e2e ${{ needs.plan.outputs.mode }} ${{ matrix.shard }}/${{ matrix.total }} (iPhone 14, Pixel 7, desktop - dev servers)`, `needs: plan`, the `if` from the interfaces block, `timeout-minutes: 60`, the concurrency group `ci-${{ github.workflow }}-${{ github.ref }}-e2e-${{ matrix.shard }}` with cancel-in-progress true, steps checkout, setup-workspace, local-stack, Chromium install, the run step (mode all => `--shard="$SHARD/$TOTAL"`, otherwise the unquoted `$E2E_SPECS` list; comment why it is unquoted: the names carry no whitespace and a Vitest guard enforces it), and the failure-only artifact upload with the per-shard names used today.
       - Keep the existing comment blocks that still apply (build-output gate, lane guard, UI literal guard, Playwright report folders) and drop only the ones the composite actions now hold.

    4. Create .github/workflows/e2e-full.yml: name "E2E full (manual)", trigger `workflow_dispatch` only (no cron, no push, no pull_request), `permissions: contents: read`, one job that is `uses: ./.github/workflows/ci.yml` with `with: suite: e2e-full`. A header comment states that the run is manual by decision (D-04), runs plan + e2e only with every spec in four shards, and that workflow_dispatch appears in the Actions UI only once the file is on the default branch.

    5. Validate (cannot be run on GitHub from here, so be rigorous locally). Download actionlint into its own new, empty scratchpad directory with `gh release download -R rhysd/actionlint` for the darwin_arm64 archive plus its checksums file, verify the checksum with shasum before extracting into a second new directory, and run it on all four workflow files plus the existing deploy files; actionlint does not read composite action metadata, so also parse both action.yml files and all workflows with the `yaml` package found under node_modules/.pnpm/yaml@2.9.0 and write a scratchpad script `check-workflows.mjs` (the verify command calls it as "$SCRATCH/check-workflows.mjs": export SCRATCH as your scratchpad directory in the same shell before running verify) that asserts: ci.yml has pull_request and workflow_call and no push or ignore filter outside comments; job ids static, db, plan, e2e, e2e-pwa exist; e2e `needs` plan and uses fromJSON on the matrix; every `run` that mentions a github or inputs expression is absent (values only through env); e2e-full has exactly one trigger, workflow_dispatch; both composite files declare `using: composite` and every run step declares `shell: bash`. If the actionlint download is blocked, say so in the SUMMARY and rely on the script plus a manual line-by-line review of the expression contexts (inputs is available in job-level `if`, `name` and `concurrency`; matrix and needs are available in the e2e `name`, `concurrency`, `strategy`).

    6. Commit with `git add` on the four explicit paths (the two action.yml files, ci.yml, e2e-full.yml). Message: `ci(quick-261007-kbq): plan + affected e2e jobs, shared composite bring-up, manual e2e-full workflow`. No trailer. Do not push.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social && node "$SCRATCH/check-workflows.mjs" && test "$(grep -vE '^[[:space:]]*#' .github/workflows/ci.yml | grep -cE '^[[:space:]]*(push|schedule):')" = 0 && test "$(grep -vE '^[[:space:]]*#' .github/workflows/e2e-full.yml | grep -cE '^[[:space:]]*(push|pull_request|schedule):')" = 0 && test -z "$(git status --porcelain -- .github)"</automated>
  </verify>
  <done>
    ci.yml triggers on pull_request and workflow_call only; its jobs are static, db, plan, e2e, e2e-pwa; the bring-up exists once in .github/actions/local-stack and once-per-job callers use it; the e2e job is a single matrix definition fed by plan; e2e-full.yml has workflow_dispatch only; actionlint (or the documented fallback) reports no error; the four paths are committed and nothing else is staged.
  </done>
</task>

<task type="auto">
  <name>Task 3: Symmetric deploy callers, pipeline documentation and the final gate (D-01, D-02, D-05)</name>
  <precondition>`git status --porcelain -- docs/DEPLOY.md` printed nothing when the DEPLOY.md edit starts (the file is edited only in that case; the user holds uncommitted local edits there at times)</precondition>
  <files>.github/workflows/deploy-api.yml, .github/workflows/deploy-hml.yml, docs/deploy/ci.md, docs/DEPLOY.md</files>
  <read_first>
    .github/workflows/ci.yml (as committed by Task 2), .github/workflows/deploy-api.yml, .github/workflows/deploy-hml.yml,
    docs/DEPLOY.md lines 1-40, 66-100, 628-660, 945-1030, 1198-1227, docs/deploy/auth-mail.md (style only)
  </read_first>
  <action>
    Wire homolog to the same gate as production and document the whole pipeline (per D-01, D-02, D-05).

    1. deploy-api.yml: comments only; no functional line changes. Rewrite the header so it says: a push to master (paths below, unchanged) runs this workflow only, ci.yml has no push trigger of its own so nothing runs twice; `checks` is ci.yml for THIS sha (static, db, plan -> affected e2e, e2e-pwa); `build` runs in parallel; the production job needs both and sits behind the `production` reviewer. Update the comment above the `checks` job the same way. The `on`, `paths`, `permissions`, `concurrency`, `env`, every job id, every `needs`, `if`, step and secret line stays byte-identical.

    2. deploy-hml.yml:
       - Header: delete the paragraph saying ci.yml does not gate homolog and replace it with the symmetric flow: `push to homolog -> checks (the same reusable ci.yml, for this sha) in parallel with build (preflight + image), then migrate-and-deploy-hml needs both`, plus a sentence that a manual workflow_dispatch has no push base and therefore runs the full suite. Keep the isolation-guards list and the Supabase-mode section as they are.
       - Add a job `checks` before `build`: `if: github.ref == 'refs/heads/homolog'` (same ref guard as build, so a dispatch from another branch is skipped, not failed) and `uses: ./.github/workflows/ci.yml` with no `with`, no `secrets`, no `environment`, no `permissions` override (it needs no cloud credential and must not get one).
       - Change `migrate-and-deploy-hml` to `needs: [checks, build]` and replace the comment above it ("Only the image build: ci.yml does not gate homolog ...") with a comment that matches deploy-api.yml's gate.
       - Do not touch the `on` block (paths and workflow_dispatch), `permissions`, `concurrency`, `env`, the `build` job (the preflight step and every WIF, docker and environment line), the `environment` block of the deploy job, or any step after it. Prove it: `git diff -U0 .github/workflows/deploy-hml.yml`, with comment lines and the new `checks` block removed, shows only the single `needs` line change.

    3. Create docs/deploy/ci.md (English, same register as docs/deploy/auth-mail.md). Sections: (a) which workflow runs on which event (table: pull_request -> ci.yml; push to master with a path match -> Deploy API; push to homolog with a path match -> Deploy homolog; manual -> E2E full; a push touching only apps/web or docs runs no workflow and is left to Vercel, accepted); (b) the jobs of ci.yml and what each proves, with the order inside each job kept from `pnpm verify`; (c) the affected-e2e selector: rules in precedence order, the map schema, the weight valve and its reason, the base resolution table (pull_request base sha, push `before`, everything else and every doubtful value => all), how to run it locally (the CLI line with --base/--head and the --files-from what-if form), and the runbook "adding a spec or a feature module" (add the spec to a group in affected-map.json or Vitest fails; add a new module directory to a group or its files resolve to all); (d) the composite actions and why they exist (the 08-02 reasoning and why it no longer holds); (e) the Docker rate-limit retry and what it cannot fix (mention a Docker Hub login as an optional follow-up that needs a repository secret and is deliberately not added); (f) known limits, stated plainly: the diff is against the previous branch head, so a red run followed by an unrelated push can hide the first push's affected specs (re-run the failed jobs, or dispatch E2E full before promoting); a manual hml dispatch runs the full suite; a push touching only files outside the deploy `paths` runs no CI; skipped e2e counts as success for required checks, and renamed jobs need the branch-protection check names updated; the dev-server e2e is still flaky and a red affected e2e blocks both deploys (use `gh run rerun --failed`); (g) the first-run checklist for the user (below). Use "tenant" for the organisation and "comunidade" for the feature.
       First-run checklist, in this order because a workflow file changed by a pull request runs its own version on that pull request, while a master push that touches only .github/workflows/ci.yml matches no deploy `paths`: (1) open a PR: with a docs-only change `plan` prints mode none and the e2e job is skipped while static, db and e2e-pwa run; with a change under apps/web/components/stories `plan` prints some, the stories group's specs, and exactly one e2e job named `e2e some 1/1`; read the `plan` log for the resolved base and the step summary for the reasons; confirm the db job's seed and integration steps see SEED_PASSWORD (composite steps inherit the job env); (2) push to homolog with a change under apps/api: exactly one run named Deploy homolog (hml), jobs listed as `checks / ...` plus `build`, `migrate-and-deploy-hml` waiting for both, and no separate CI run; the plan log shows a real `before` sha, not zeros; (3) push to master with a change under apps/api: the same on Deploy API, and the `production` approval appears only after `checks` and `build` are green; (4) after the file reaches the default branch, dispatch E2E full once: four jobs `e2e all N/4`, no static, db or e2e-pwa; (5) look for `supabase start failed (attempt` annotations when Docker is rate-limited; (6) check branch protection for required-check names; (7) record the durations of plan, e2e some and e2e all to calibrate `maxSomeShare`.

    4. docs/DEPLOY.md, only if the precondition holds. If `git status --porcelain -- docs/DEPLOY.md` prints anything, do not open the file for editing: list the seven stale places (lines given in the context block) in the SUMMARY for the user and stop this step. Otherwise edit only these places, each as a minimal replacement, and add nothing else: lines 7-10 (add `.github/actions/*`, `e2e-full.yml` and a pointer to docs/deploy/ci.md); lines 30-32 (the "No CI gate on hml" bullet becomes "CI gates hml like production": deploy-hml.yml calls the same ci.yml as `checks` and the deploy job needs it; note that it supersedes the earlier statement); lines 75-76 (ci.yml no longer triggers on master pushes; deploy-api.yml runs it as `checks`); lines 632-633 (not "a single `checks` job": point to docs/deploy/ci.md and say `pnpm verify` still runs the whole e2e locally while CI runs only the affected specs); line 950 and lines 1023-1026 (the master push no longer starts a separate `CI` workflow; the gate row 7 is the `checks` of the Deploy API run: jobs static, db, plan, e2e (affected or four shards), e2e-pwa); lines 1208-1210 (the e2e item of the production gate reads: the e2e specs the push affects, all of them when the change is shared or unmapped, plus the PWA e2e). Then `git diff --stat -- docs/DEPLOY.md` must show only those hunks.

    5. Final gate. Extend the scratchpad `check-workflows.mjs` with the deploy assertions (both deploy files contain a `checks` job with `uses: ./.github/workflows/ci.yml`; both deploy jobs declare `needs: [checks, build]`; the `on.push.paths` arrays of both files equal the arrays in `git show HEAD:<file>` taken before Task 3's first edit; no `checks` job declares `secrets`, `environment` or `with`). Run actionlint (or the fallback) on every workflow, then `TURBO_CACHE=local:r pnpm lint`, then `TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run scripts/e2e-affected.test.ts`, then confirm `git status --porcelain` lists only this task's paths among tracked changes and that the user's untracked files (docs/LOCAL-SETUP.md, .claude/*, .planning/research/.cache) were not staged. Do not run `pnpm verify`, `supabase db push`, `supabase config push`, any deploy command or any command that touches production or homolog.

    6. Commit with `git add` on the explicit paths actually changed (deploy-api.yml, deploy-hml.yml, docs/deploy/ci.md, and docs/DEPLOY.md only if edited). Message: `ci(quick-261007-kbq): symmetric master/homolog gate through the same checks, pipeline docs`. No trailer. Do not push. Write 261007-kbq-SUMMARY.md in the quick directory covering: what changed, the five hand-run selector results from Task 1, whether actionlint ran, the discretion items from the objective, whether DEPLOY.md was edited or left untouched (with the stale lines if untouched), and an explicit "not verifiable locally" list (workflow execution on GitHub, composite env inheritance, `github.event.before` inside workflow_call, the Docker retry, branch-protection names) followed by the first-run checklist.
  </action>
  <verify>
    <automated>cd /Users/igorvboas/Library/Developer/TRIA/rede_social && node "$SCRATCH/check-workflows.mjs" && TURBO_CACHE=local:r pnpm lint && TURBO_CACHE=local:r pnpm --filter @rede-social/web exec vitest run scripts/e2e-affected.test.ts && D="$(git diff -U0 153eaba HEAD -- .github/workflows/deploy-api.yml)" && test "$(printf '%s\n' "$D" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-][[:space:]]*#' | grep -vE '^[+-][[:space:]]*$' | wc -l | tr -d ' ')" = 0</automated>
  </verify>
  <done>
    deploy-hml.yml has a `checks` job calling ci.yml and its deploy job needs [checks, build] while every isolation line is unchanged; deploy-api.yml differs from before only in comments; docs/deploy/ci.md exists with the runbook and the first-run checklist; DEPLOY.md carries the seven corrections or is untouched with the stale lines recorded; `pnpm lint` and the selector tests pass; the SUMMARY states what could not be verified locally; commits are by explicit path, without a trailer, and nothing was pushed.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| pull request (fork or branch) -> ci.yml | untrusted code and file names reach the plan job; fork runs receive no secrets (plain `pull_request`, never `pull_request_target`) |
| github.* / inputs.* expressions -> shell | event-controlled strings (shas, event name, suite) could be injected into `run:` text |
| changed-file list -> e2e selection | a wrong "none"/"some" would let a regression reach a deploy |
| reusable `checks` -> deploy jobs | the gate must hold for the exact sha and must not gain cloud credentials |
| runner -> container registries | anonymous image pulls are rate limited |
| actionlint binary download (local only) | third-party release asset executed on the developer machine |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-kbq-01 | Tampering | plan step passing base/head/event/suite into the shell | high | mitigate | every expression reaches the shell via `env:` only; the CLI validates base/head against a strict pattern and spawns git with argument arrays (no shell); a malformed value resolves to mode all (tested with a `;rm -rf` value) |
| T-kbq-02 | Repudiation / Tampering | selector classifying a risky change as none/some (false green gate) | high | mitigate | precedence is ignored -> shared -> derived -> groups -> unmapped; unmapped, shared, errors, missing/zero/unreachable base, non push/pull_request events and over-weight selections all resolve to all; an error path can never produce none; Vitest guard fails when a spec is missing from the map; real-map rule tests cover each shared path the user named |
| T-kbq-03 | Elevation of Privilege | `checks` reusable job in deploy-hml.yml gaining credentials or weakening isolation | high | mitigate | `checks` has no `environment`, `with`, `secrets` or permissions override; ci.yml's `permissions: contents: read` caps it (no id-token); the hml preflight, WIF provider, `environment: homolog` and Supabase-mode lines are left byte-identical and proven by a filtered diff in Task 3 |
| T-kbq-04 | Information Disclosure | step summary and logs listing changed paths and shas | low | accept | repository is public; no secret value is printed; the hml preflight still never prints the Supabase ref |
| T-kbq-05 | Denial of Service | registry rate limit failing the stack start; retry loop hanging a job | medium | mitigate | bounded retry (3 attempts, 30 s and 60 s sleeps, transient-error match only) inside job `timeout-minutes`; fewer parallel stack starts in none/some modes; Docker Hub login left as a documented, secret-requiring follow-up |
| T-kbq-06 | Tampering | skipped or renamed required checks letting a PR merge without e2e | medium | accept | a skipped e2e means the selector found nothing relevant; documented in ci.md and the first-run checklist (branch-protection check names) |
| T-kbq-07 | Tampering | red run followed by an unrelated push hides the earlier push's affected specs | medium | accept | inherent to diffing against the previous branch head; documented as a known limit with the mitigation (re-run failed jobs, dispatch E2E full before promoting) |
| T-kbq-08 | Information Disclosure | composite action or workflow echoing ci-only credentials | low | mitigate | ci-only values stay solely in ci.yml's env block, are local-stack throwaways already public in the repo, and are not redeclared elsewhere |
| T-kbq-SC | Tampering | package/binary supply chain | high | mitigate | no npm/pip/cargo install is added (the selector uses node built-ins; no new dependency); the only download is the actionlint release asset into an isolated scratchpad directory with its published checksum verified before use, never run inside the repo directory |
</threat_model>

<verification>
Automated, local (run in Tasks 1-3):
- Vitest guard and selector tests (`scripts/e2e-affected.test.ts`) including the unmapped-spec negative control.
- Biome on the new TypeScript and JSON; `pnpm --filter @rede-social/web typecheck`; `TURBO_CACHE=local:r pnpm lint`.
- CLI hand runs against real diffs (HEAD~9..HEAD, a web-only slice of 91a81d5, the whole 91a81d5 range, a zero base, a docs-only slice) and a GITHUB_OUTPUT file whose matrix parses.
- `playwright test --list e2e/<name>.spec.ts` proves the anchored spec arguments select exactly one file.
- actionlint (checksum-verified binary) or, if the download is blocked, a YAML parse of every workflow and composite action plus the assertion script and a manual expression-context review.
- Structural greps with comment lines filtered out (no push trigger or ignore filter in ci.yml; no schedule in e2e-full.yml; deploy-api.yml functionally unchanged; hml isolation lines unchanged).

Cannot be verified locally (workflows only truly run on GitHub), and must be said so in the SUMMARY:
- That composite steps inherit the workflow-level env and that `uses: ./.github/actions/...` resolves inside a reusable workflow.
- That `github.event.before` and `github.event.pull_request.base.sha` arrive as expected inside the `workflow_call`ed file.
- The reusable-workflow job names, the concurrency groups in practice, and `gh run rerun --failed` on nested jobs.
- The Docker rate-limit retry, runner timings of plan / e2e some / e2e all, and branch-protection required-check names.
The first-run checklist in docs/deploy/ci.md (PR first, then homolog, then master) is how the user closes these.
</verification>

<success_criteria>
- D-01: ci.yml has no push trigger or ignore filter; deploy-api.yml and deploy-hml.yml both run the same `checks` and their deploy jobs need it; paths filters and isolation guards unchanged; headers and docs updated.
- D-02: `checks` = static + db + e2e-pwa + plan + affected e2e; the 4-shard run is no longer the default.
- D-03: affected-map.json + e2e-affected.ts + Vitest guard exist, are Biome/type clean, and the CLI answers none/some/all correctly on real diffs with safe fallbacks.
- D-04: e2e-full.yml is workflow_dispatch only, runs 4 shards through the same ci.yml jobs, with the bring-up defined once.
- D-05: `supabase start` retry with backoff exists once; stack-starting jobs drop to three or four in none/some modes.
- No spec edited; nothing pushed; nothing touched in production or homolog; DEPLOY.md handled per its precondition; every commit by explicit path without a trailer.
</success_criteria>

<source_audit>
SOURCE   | ID      | Feature/Requirement                                              | Plan Task | Status
-------- | ------- | ---------------------------------------------------------------- | --------- | -------
GOAL     | -       | Symmetric CI/CD, path-affected e2e instead of 4-shard full run   | 1, 2, 3   | COVERED
REQ      | PWA-04  | GitHub is the source of truth; pushes deploy web and API/worker  | 2, 3      | COVERED
RESEARCH | -       | none (no research phase for this quick task)                     | -         | n/a
CONTEXT  | D-01    | Symmetric pipeline, ci.yml without push, same checks, docs       | 2, 3      | COVERED
CONTEXT  | D-02    | checks = static + db + e2e-pwa + affected e2e                    | 2         | COVERED
CONTEXT  | D-03    | Versioned map + selector script + Vitest guard + plan job        | 1, 2      | COVERED
CONTEXT  | D-04    | No schedule; e2e-full.yml workflow_dispatch; shared bring-up     | 2         | COVERED
CONTEXT  | D-05    | Docker rate-limit mitigation (retry, fewer parallel starts)      | 2         | COVERED
No deferred ideas were given. Out of scope by user rule: editing specs, fixing flaky tests, scheduled e2e, pushing, any production or homolog change.
</source_audit>

<output>
Create `.planning/quick/261007-kbq-symmetric-ci-pipeline-with-path-affected/261007-kbq-SUMMARY.md` when done (committed together with PLAN.md and STATE.md by the orchestrator, as in earlier quick tasks).
</output>
