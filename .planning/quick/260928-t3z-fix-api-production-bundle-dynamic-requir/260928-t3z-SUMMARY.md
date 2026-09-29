---
phase: quick-260928-t3z
plan: 01
subsystem: api-build
status: complete
tags: [tsup, esbuild, esm, bundling, cloud-run, api, worker, sharp, undici]
requirements: [PWA-04]
requires: []
provides:
  - "apps/api dist/main.js that loads under Node 24 for ROLE=api and ROLE=worker"
affects:
  - "Phase 01.1 Cloud Run deploy (apps/api/Dockerfile CMD node dist/main.js)"
tech-stack:
  added: []
  patterns:
    - "tsup banner gives every ESM output file a module-scoped require via createRequire(import.meta.url)"
    - "Native-addon deps of bundled workspace packages are tsup externals and apps/api direct dependencies"
key-files:
  created: []
  modified:
    - apps/api/tsup.config.ts
    - apps/api/package.json
    - pnpm-lock.yaml
decisions:
  - "Bundled CommonJS deps get a real require through a createRequire banner (alias __rsCreateRequire)"
  - "sharp is external and an apps/api dependency pinned to 0.35.4 (same as packages/core); no new lockfile package"
  - "removeNodeProtocol: false so node:sqlite (undici lazy cache store) stays resolvable"
metrics:
  duration: "~10 min"
  completed: 2026-09-28
actuals:
  tokens: 2987
  tasks: 2
  commits: 1
plan_head_before: 58e045bbc9f5815ea5a246da25b1c46c57978823
---

# Quick 260928-t3z: Fix API production bundle dynamic require Summary

The apps/api tsup bundle now boots under Node 24 in both roles. A `createRequire` banner fixes undici's CommonJS `require('assert')` in the ESM output. sharp is external and a direct apps/api dependency, so its native addon resolves. `removeNodeProtocol: false` keeps `node:sqlite` resolvable.

## Commit

- `1f36d25` fix(quick-260928-t3z): make the API production bundle load under Node (apps/api/tsup.config.ts, apps/api/package.json, pnpm-lock.yaml; no trailer; not pushed)

## Baseline (red evidence, pre-fix bundle)

- V2: `API_BOOT_FAIL health=000`. First error line:
  `Error: Dynamic require of "assert" is not supported`, thrown from esbuild's shim in `dist/chunk-YKDJXFRS.js:11` while evaluating `undici@7.29.1/lib/dispatcher/client.js`.
- V5: `UNRESOLVABLE externals: [ 'require:sqlite', 'require:@img/sharp-libvips-dev/include', 'require:@img/sharp-libvips-dev/cplusplus' ]`

## Install mode

- The first Biome call (`pnpm --filter @rede-social/api exec biome check --write ...`) already ran an implicit install. pnpm 12 verifies deps before `exec` and saw the manifest change, and that install rewrote the lockfile. It is not recorded whether that implicit run used the network. No new package entered the lockfile (V6).
- The prescribed `pnpm install --offline --no-frozen-lockfile` then ran and reported `Already up to date`. The `--prefer-offline` fallback was not needed.
- The textual lockfile diff is larger than one entry (+54/-51). The same install re-sorted importer keys that were left unsorted by the earlier `@rede-social` rename, for example `@t3-oss/env-core`, `@supabase/*` and `@serwist/turbopack`. V6 compares parsed data and shows the only semantic change is `importers.apps/api.dependencies.sharp`.

## Verification (post-fix)

| Check | Output |
|-------|--------|
| V1 syntax, all dist/*.js | `SYNTAX_OK` |
| V2 API boot + health | `"api listening"` logged, `GET /v1/health` status 200, `API_BOOT_OK health=200` |
| V3 worker boot | pg-boss `Error: connect ECONNREFUSED 127.0.0.1:1`, `worker exit=1`, `WORKER_BOOT_OK` (no module error) |
| V4 all non-entry chunks | `ALL 10 CHUNKS LOADED` |
| V5 externals audit | `EXTERNALS OK` |
| V6 lockfile delta (vs saved HEAD lockfile, and again vs HEAD~1 after commit) | `LOCKFILE DELTA OK` (twice) |
| Gate 1 `pnpm install --frozen-lockfile --offline` | `Lockfile is up to date, resolution step is skipped`, rc=0 |
| Gate 2 `pnpm --filter @rede-social/api typecheck` | rc=0 |
| Gate 3 `pnpm --filter @rede-social/api lint` | `Checked 67 files in 90ms. No fixes applied.`, rc=0 |
| Gate 5 commit hygiene | HEAD files = exactly the 3; `NO_TRAILER`; `git status --porcelain --untracked-files=no` empty; no listener on 18998/18999 |

## Extra dependencies externalized under Task 1 Step 3

None. After the fix, V2 and V3 showed no new module-loading errors.

## Note for the orchestrator

These checks do not prove the Docker image works. That proof comes from the next Cloud Run deploy, or from a local `docker build -f apps/api/Dockerfile .` if wanted. Locally resolved packages stand in for the image. They are a good stand-in because V5 checks that every bare external left in dist/ is either a Node builtin or an apps/api direct dependency, and `pnpm deploy --filter=@rede-social/api --prod` ships exactly those. Out of scope and known: resend's lazy `import("@react-email/render")` is a dynamic import used only with the `react:` send option. Core sends `html`.

## Deviations from Plan

**1. [Rule 3 - Blocking/tooling] Implicit install by `pnpm exec`**
- **Found during:** Task 1 Step 1 (Biome formatting)
- **Issue:** pnpm 12 ran an install before `exec` because the manifest had changed. This rewrote the lockfile before the prescribed offline install, and it also re-sorted importer keys.
- **Fix:** No code change. I ran the prescribed offline install afterwards (`Already up to date`), and V6 confirmed the semantic delta is exactly the sharp importer entry.
- **Commit:** 1f36d25

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: apps/api/tsup.config.ts (banner, removeNodeProtocol: false, external: ['sharp'])
- FOUND: apps/api/package.json `"sharp": "0.35.4"`
- FOUND: commit 1f36d25
