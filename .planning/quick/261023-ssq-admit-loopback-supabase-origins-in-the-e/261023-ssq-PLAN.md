---
phase: quick-261023-ssq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/web/lib/supabase-origin.ts
  - apps/web/lib/supabase-origin.test.ts
  - apps/web/lib/e2e-loopback-flag.test.ts
  - apps/web/playwright.pwa.config.ts
  - scripts/check-workflows.sh
  - docs/DEPLOY.md
autonomous: true
requirements: [DBT-39]
tags: [ci, e2e, pwa, supabase-origin, build-time-flag, deploy-guard, quick]

estimate:
  tokens: 40000
  raw_tokens: 40000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "With NODE_ENV production and the build-time flag NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS equal to the string '1', `isAllowedSupabaseOrigin` (apps/web/lib/supabase-origin.ts) admits http(s)://127.0.0.1 and http(s)://localhost, with or without a port, and nothing else outside the hosted rule. It still refuses http://evil.com, https://evil.com, http://127.0.0.1.evil.com, http://localhost.evil.com, userinfo (http://x@127.0.0.1, http://x:y@localhost:54321), a path (http://127.0.0.1:54321/path), a query, a fragment, a bare trailing `?` or `#`, a private address (192.168.0.5, 0.0.0.0, [::1]), a non-http scheme, and the look-alike https://x.supabase.co.evil.com."
    - "With the flag unset, '0', 'true' or anything other than the exact string '1', the function behaves exactly as before in every case: http://127.0.0.1:54321 is refused with production true and accepted with production false. For a corpus of non-loopback URLs (hosted, look-alike, foreign, malformed) the answer with allowLoopback true equals the answer with allowLoopback false, so production behaviour is provably unchanged."
    - "The flag is read with the DIRECT property access `process.env.NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS === '1'` (no bracket or dynamic access, so Next inlines it into the client bundle at build time), exposed as an optional `allowLoopback` option whose default is that read. The flag name contains neither NEXT_PUBLIC_SUPABASE_URL nor NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, so lib/no-build-time-supabase.test.ts stays green untouched."
    - "The exact call that failed in CI (apps/web/lib/upload.ts:139, `tusEndpointFor` for a signed URL on http://127.0.0.1:54321) returns http://127.0.0.1:54321/storage/v1/upload/resumable/sign when NODE_ENV is production and the flag is '1', and still throws 'upload: the signed URL origin is refused' when the flag is off."
    - "apps/web/playwright.pwa.config.ts puts the flag with the value '1' in the `env` of the ONE webServer entry whose command runs `next build && next start`, so the flag is present for the build (where Next inlines it) and for the start, for both the local `pnpm --filter @rede-social/web e2e:pwa` and CI, with no change to .github/workflows/ci.yml. The API webServer entry, the dev-server base config (apps/web/playwright.config.ts) and ci.yml carry no mention of the flag."
    - "`bash scripts/check-workflows.sh` (part of `pnpm guard:workflows`) fails, with a message that names the flag, when the flag appears anywhere in .github/workflows/deploy-api.yml or deploy-hml.yml, anywhere in a tracked vercel.json/vercel.ts, in an assignment or table-row form in a .env.example, or in an assignment or table-row form in docs/DEPLOY.md. A prose mention in docs/DEPLOY.md passes. Its --self-test proves each of those by mutation and proves the prose mention passes."
    - "docs/DEPLOY.md states, under the 'Vercel environment variables (web)' section, that the flag is e2e-only and must never be set on Vercel (production or homolog). The sentence is prose, not an assignment and not a table row, so the guard accepts it."
    - "The e2e itself was NOT run locally (disk at 98 percent; no web build, no next build, no turbo build, no playwright, no integration suite, no db reset). The proof that csp.spec.ts:215 now passes in the iPhone 14, Pixel 7 and desktop projects is the next CI run of the e2e-pwa job, and the SUMMARY says so plainly."
    - "Scope is exactly the six files in files_modified. Nothing under .planning/phases/, no .env* file read or named other than a tracked .env.example, no push. Each code commit stages its files by explicit path, carries no Co-Authored-By trailer and no tool or Claude attribution, and never stages .planning/ROADMAP.md or .planning/STATE.md."
  artifacts:
    - path: "apps/web/lib/supabase-origin.ts"
      provides: "isAllowedSupabaseOrigin with the allowLoopback option defaulting to the direct flag read"
      contains: "NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS"
    - path: "apps/web/lib/supabase-origin.test.ts"
      provides: "the flag-off, flag-on and unchanged-hosted-rule matrix of the predicate, plus the default env read"
      contains: "allowLoopback"
    - path: "apps/web/lib/e2e-loopback-flag.test.ts"
      provides: "the tusEndpointFor call that failed in CI, the PWA-config-carries-the-flag proof, and the no-deploy-surface-carries-it proof"
      contains: "playwright.pwa.config.ts"
    - path: "apps/web/playwright.pwa.config.ts"
      provides: "the flag in the env of the next build and next start webServer entry"
      contains: "NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS"
    - path: "scripts/check-workflows.sh"
      provides: "the e2e-flag scan over deploy workflows, vercel configs, .env.example files and DEPLOY.md, with self-test mutations"
      contains: "e2e-flag"
    - path: "docs/DEPLOY.md"
      provides: "the e2e-only, never-on-Vercel statement"
      contains: "NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS"
  key_links:
    - from: "apps/web/playwright.pwa.config.ts webServer env"
      to: "apps/web/lib/supabase-origin.ts isAllowedSupabaseOrigin default for allowLoopback"
      via: "Playwright merges webServer.env over process.env for the spawned shell; `next build` inlines the direct property access; `next start` inherits the same env"
      pattern: "NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS"
    - from: "apps/web/lib/supabase-origin.ts isAllowedSupabaseOrigin"
      to: "apps/web/lib/upload.ts tusEndpointFor line 139"
      via: "tusEndpointFor calls isAllowedSupabaseOrigin(origin) with no options, so the defaults (NODE_ENV and the flag) decide"
      pattern: "isAllowedSupabaseOrigin"
    - from: "scripts/check-workflows.sh e2e-flag scan"
      to: ".github/workflows/deploy-api.yml, deploy-hml.yml, apps/web/vercel.json, .env.example files, docs/DEPLOY.md"
      via: "the guard runs in the ci.yml static job as `pnpm guard:workflows`"
      pattern: "e2e-flag"
---

<objective>
Unblock the CI job "e2e PWA (production build - iPhone 14, Pixel 7, desktop)" (GitHub Actions run 40039284864: 3 failed, 61 passed, 5 skipped).

The three failures are one test, apps/web/e2e/csp.spec.ts:215 "csp walk - member surfaces, a real avatar upload, a video post and the inline players", failing at csp.spec.ts:274 (`Foto atualizada.` never appears; the page shows `Falha no envio. Tente novamente.`).

Root cause, established before planning and not re-investigated: apps/web/lib/upload.ts:139 throws 'upload: the signed URL origin is refused' because `isAllowedSupabaseOrigin` (apps/web/lib/supabase-origin.ts, 09.2-17, T-09.2-84) refuses http loopback when `process.env.NODE_ENV === 'production'`, and the PWA e2e is a production build (`next build` + `next start`) talking to the LOCAL Supabase stack at http://127.0.0.1:54321. In real production the origin is https://<ref>.supabase.co and is accepted, so production behaviour must NOT change.

Decided by the user: a build-time flag that is ON ONLY for the e2e PWA build and never in deploys. This plan implements the user's design (a) to (d) as written in the task statement:
- (a) the predicate admits the loopback hosts of the existing LOOPBACK_HOSTS set, and only those, when the flag is on in a production build;
- (b) the flag is set in ONE place, the webServer entry of the PWA Playwright config;
- (c) the workflow guard fails if the flag can reach a deploy, and docs/DEPLOY.md says it is e2e-only;
- (d) unit tests for the predicate matrix, for the config carrying the flag, and for no deploy surface carrying it.

Purpose: the next CI run of e2e-pwa goes green on the avatar upload without opening a hole in production's origin allow-list (T-09.2-84 stays enforced for every real deploy).
Output: six files edited or created (see files_modified), three commits, a SUMMARY that says plainly the e2e was not run locally.

Coverage audit (single plan, all items COVERED): GOAL (unblock csp walk upload) -> Task 1 (predicate, config, the tusEndpointFor test); REQ DBT-39 (the origin rule stays the single predicate shared by server and client) -> Task 1; user design (a) -> Task 1; (b) -> Task 1; (c) guard -> Task 2 and the docs line -> Task 3; (d) -> Task 1 (predicate matrix, config proof) and Task 3 (deploy-side proof). RESEARCH: none for a quick task. CONTEXT: none; the user's decisions are the task statement, quoted above.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.claude/CLAUDE.md
@apps/web/lib/supabase-origin.ts
@apps/web/lib/upload.ts
@apps/web/lib/supabase-coordinates.ts
@apps/web/lib/supabase-coordinates.test.ts
@apps/web/lib/no-build-time-supabase.test.ts
@apps/web/playwright.pwa.config.ts
@apps/web/playwright.config.ts
@scripts/check-workflows.sh

<interfaces>
Current signature (apps/web/lib/supabase-origin.ts, read at planning time):
- `isAllowedSupabaseOrigin(raw: unknown, { production = process.env.NODE_ENV === 'production' }: { production?: boolean } = {}): boolean`
- Order of checks: non-string -> false; `new URL` failure -> false; userinfo -> false; path/search/hash non-empty -> false; raw text contains `?` or `#` -> false; https + hosted host regex + empty port -> true; `production` -> false; otherwise http or https on a LOOPBACK_HOSTS member -> true.
- Callers: `tusEndpointFor` in apps/web/lib/upload.ts line 139 (no options), `getSupabaseCoordinates` and `coordinatesFromPair` in apps/web/lib/supabase-coordinates.ts (no options). None of them passes options, so the defaults are what the flag must reach.
- Existing tests that must stay green unmodified: apps/web/lib/supabase-coordinates.test.ts (describe 'isAllowedSupabaseOrigin', always passes explicit `{ production }`), apps/web/lib/upload.test.ts (stubs NODE_ENV production around tusEndpointFor), apps/web/lib/no-build-time-supabase.test.ts (textual scan for the two NEXT_PUBLIC_SUPABASE_* names only).

PWA config shape (apps/web/playwright.pwa.config.ts): `webServer` is an array of the API entry reused from the base config (url contains 8787) and one object with `command` (a template literal running `pnpm --filter @rede-social/web exec next build && pnpm --filter @rede-social/web exec next start -p ${PORT}`), `url`, `reuseExistingServer: false`, `timeout`, `cwd`. Playwright spawns a webServer with its own `env` merged over `process.env` (the base config's comments already rely on this inheritance), and the single shell command carries that environment to both `next build` and `next start`.

Guard shape (scripts/check-workflows.sh): `set -euo pipefail`; `ROOT`, `WF_DIR` (env `WORKFLOW_DIR`); a `--self-test` block at the top (helpers `fresh`, `run_guard`, `mutate`, a `failed` counter, final `echo "check-workflows self-test: ok (...)"`); then the guard proper with `err()`, `check_workflow` for deploy-api.yml and deploy-hml.yml, a homolog preflight check, and the `errors` summary. `package.json` `guard:workflows` runs the guard, then its self-test, then the release-env self-test. CI runs `pnpm guard:workflows` in the `static` job.

Tracked files that matter to the guard: `apps/web/vercel.json` (also `reference/frontend-design/vercel.json`), `.env.example`, `apps/web/.env.example`, `apps/api/.env.example`, `docs/DEPLOY.md` (section 'Vercel environment variables (web)' starts near line 332, its table ends near line 347, the paragraph 'No `SITE_URL` anywhere' follows).
</interfaces>

<execution_rules>
- Verification is limited to the commands named in each task and in `<verification>`. Do NOT run any web build, `next build`, turbo build, playwright, integration suite or `supabase db reset`. The disk is at 98 percent; do not create build output.
- Do not read, grep, cat or name any `.env*` file other than a tracked `.env.example` (a secret-read guard blocks `.env.local` and `.env.<suffix>`; never retry a variant of a blocked command). In Bash commands, never put `.env` followed by anything other than `.example`. Write file contents with the Write and Edit tools, not shell redirection.
- Do not touch anything under .planning/phases/. Do not stage .planning/ROADMAP.md or .planning/STATE.md.
- Commit rules (project rule, overrides any attribution reminder): no Co-Authored-By trailer and no tool or Claude attribution in any commit message (public repository, identity igor.vboas noreply). Stage ONLY the task's files by explicit path; never `git add -A` or `git add .` (many untracked personal files exist, for example docs/LOCAL-SETUP.md). Message style: `fix(quick-261023-ssq): ...`, `test(quick-261023-ssq): ...`, `docs(quick-261023-ssq): ...`. Do NOT push.
- Wording rule for the flag's explanation in code comments and docs: say why and where, never describe an alternative that would set it in a deploy.
</execution_rules>
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Flag-aware origin predicate, flag on in the PWA e2e config, and the unit proof of the call that failed in CI</name>
  <files>apps/web/lib/supabase-origin.ts, apps/web/playwright.pwa.config.ts, apps/web/lib/supabase-origin.test.ts, apps/web/lib/e2e-loopback-flag.test.ts</files>
  <action>
This is the tracer: it wires the one path from the flag in the e2e config, through the build-time environment, into the predicate, into the exact `tusEndpointFor` call that failed in CI, and proves it at unit level. Work test-first: write the two test files, run them and observe the flag-on cases fail (red), then change the predicate and the config, run again (green).

1. apps/web/lib/supabase-origin.ts, per the task statement (a). Extend the options object of `isAllowedSupabaseOrigin` with an optional boolean `allowLoopback` whose default is the direct property access `process.env.NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS === '1'` (exactly that expression: no bracket access, no helper function, no `env` module import, because Next inlines only the direct form and this file must stay free of any environment module). Keep `production` and its default untouched. Replace the single early return for production with a refusal that applies only when `production` is true and `allowLoopback` is false; when the flag is on in production the same final statement (http or https AND hostname in the existing LOOPBACK_HOSTS set) decides. Every structural check above that point stays where it is and runs first, so userinfo, path, query, fragment, bare `?`/`#`, look-alikes and unparseable input are refused with the flag on exactly as with it off; the hosted rule (https, single label under supabase.co, no port) is not touched. Update the doc comment of the function: say the flag exists only for the production-build PWA e2e against the local stack (T-09.2-84 keeps every real deploy on https and the hosted host), that it is inlined at build time and set in one place (apps/web/playwright.pwa.config.ts), and that docs/DEPLOY.md forbids it on Vercel. Do not add the flag to lib/env.ts (it must not reach the t3 env schema) and do not mention NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY anywhere in this file (lib/no-build-time-supabase.test.ts scans it).

2. apps/web/playwright.pwa.config.ts, per (b). Add an `env` property to the second `webServer` object (the one whose command runs `next build` then `next start`) with the single entry NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS set to the string '1'. Do not add it to the reused API entry, to `process.env` at module level, to the base config, or to .github/workflows/ci.yml: one place, so the build step (which inlines it) and the start step (which inherits it) always agree, locally and in CI. Extend the file's header comment with a short paragraph (written after the existing 08-08 paragraph): why the PWA run needs it (a production build talking to the local http stack would otherwise have its signed upload URL refused by `isAllowedSupabaseOrigin`), that Next inlines it at `next build`, and that it exists nowhere else. Keep the rest of the file byte-identical.

3. apps/web/lib/supabase-origin.test.ts (new, pure: no vi.mock, explicit `{ production, allowLoopback }` options so the matrix does not depend on process.env, plus one block for the default read). Cases, each with the URL as the assertion message so a failure names it:
   - flag off (allowLoopback false): http://127.0.0.1:54321 and http://localhost:54321 are refused with production true and accepted with production false.
   - flag on, production true, accepted: http://127.0.0.1:54321, http://localhost:54321, https://127.0.0.1:54321, https://localhost:54321, http://127.0.0.1 and http://localhost with no port.
   - flag on, production true, refused: http://evil.com, https://evil.com, http://127.0.0.1.evil.com, http://localhost.evil.com, http://x@127.0.0.1, http://x:y@localhost:54321, http://127.0.0.1:54321/path, http://127.0.0.1:54321?x=1, http://127.0.0.1:54321#f, http://127.0.0.1:54321? (bare trailing question mark), https://x.supabase.co.evil.com, http://192.168.0.5:54321, http://0.0.0.0:54321, http://[::1]:54321, ftp://127.0.0.1, an empty string, the text 'not a url', and the non-string values undefined and 42.
   - hosted rule unchanged: https://abcd.supabase.co and https://abcd.supabase.co/ accepted; http://abcd.supabase.co, https://abcd.supabase.co:8443, https://a.b.supabase.co, https://supabase.co refused. Then a differential test over a corpus holding every hosted, look-alike, foreign and malformed URL used in this file (loopback hosts excluded): for each, the answer with allowLoopback true equals the answer with allowLoopback false, for production true and for production false.
   - default read: with `vi.stubEnv` set NODE_ENV to production and the flag to '1', calling with NO options admits http://127.0.0.1:54321; with the flag stubbed to each of '0', 'true', 'yes', ' 1', '1 ' and '' (and again with it removed via `vi.stubEnv(name, undefined)`) it is refused. Use `afterEach(() => vi.unstubAllEnvs())`.

4. apps/web/lib/e2e-loopback-flag.test.ts (new; same file-reading style as lib/no-build-time-supabase.test.ts: locate apps/web from `import.meta.url`, repo root is three levels up from lib). First describe, 'the call that failed in CI': with NODE_ENV production and the flag '1' stubbed, `tusEndpointFor('http://127.0.0.1:54321/storage/v1/object/upload/sign/media/x?token=t')` (imported from '@/lib/upload') returns 'http://127.0.0.1:54321/storage/v1/upload/resumable/sign'; with the flag not set it throws 'upload: the signed URL origin is refused'; a hosted signed URL (https://abcd.supabase.co/storage/v1/object/upload/sign/media/x) resolves to the hosted TUS endpoint under both settings. Second describe, 'the PWA e2e config carries the flag and nothing else does': read apps/web/playwright.pwa.config.ts, strip comments with a local helper written like the one in no-build-time-supabase.test.ts, and assert with one regular expression that the webServer object whose command template literal contains `next build` and `next start` also has an `env` object whose NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS entry is the string '1'; assert that playwright.config.ts (base) and .github/workflows/ci.yml contain no occurrence of the flag name (raw text, comments included). Add a self-check that the regular expression rejects a config copy where the env sits on another object, so an empty match cannot hide a broken pattern.

Order of work and expected observations: after step 3 and 4 and before steps 1 and 2, the flag-on and default-read cases and the tusEndpointFor case fail (red) while the flag-off cases pass; after steps 1 and 2 all pass. Then run the verify command. Do not run typecheck of the whole app unless it is quick; if you try `pnpm --filter @rede-social/web exec tsc --noEmit --incremental false`, stop it if it takes more than about two minutes or reports errors in files this task did not touch, and say so in the SUMMARY.

Commit (explicit paths, no trailer, no push): `fix(quick-261023-ssq): admit loopback Supabase origins in a production build behind the e2e-only flag` staging exactly the four files of this task.
  </action>
  <verify>
    <automated>pnpm --filter @rede-social/web exec vitest run lib/supabase-origin.test.ts lib/e2e-loopback-flag.test.ts lib/supabase-coordinates.test.ts lib/upload.test.ts lib/no-build-time-supabase.test.ts && pnpm exec biome check apps/web/lib/supabase-origin.ts apps/web/lib/supabase-origin.test.ts apps/web/lib/e2e-loopback-flag.test.ts apps/web/playwright.pwa.config.ts</automated>
  </verify>
  <done>The five vitest files pass and Biome is clean on the four touched files. The failing `tusEndpointFor` call for a loopback signed URL succeeds with NODE_ENV production plus the flag '1' and still throws without the flag. The PWA config's `next build && next start` webServer entry carries the flag in its env; the base config and ci.yml do not. With the flag unset the predicate is unchanged in every case, proved by the differential corpus and by the untouched supabase-coordinates and upload tests staying green. One commit exists with the four files and no trailer.</done>
</task>

<task type="auto">
  <name>Task 2: Extend the workflow guard so the flag can never reach a deploy surface</name>
  <files>scripts/check-workflows.sh</files>
  <action>
Per the task statement (c). Read the whole script first (it was read at planning time: a `--self-test` block on top with helpers `fresh`, `run_guard`, `mutate`; then `err`, `check_workflow` for both deploy workflows, the homolog preflight check, and the error summary). Write the changes with the Edit tool.

Guard proper. Add a constant for the flag name and a function `check_e2e_loopback_flag`, called after the existing checks and before the `errors` summary. It scans, and calls `err` with a message that starts `e2e-flag:`, names the repository-relative file and names the flag, for each of these (a missing optional file is skipped, not an error; the two deploy workflows are already required by the existing checks):
  - `$WF_DIR/deploy-api.yml` and `$WF_DIR/deploy-hml.yml`: ANY occurrence of the flag name, comments included (a workflow has no legitimate reason to name it).
  - Every `vercel.json` and `vercel.ts` found under `${FLAG_SCAN_ROOT:-$ROOT}` by `find`, pruning node_modules, .git, .next and .turbo: ANY occurrence.
  - Every file named exactly `.env.example` found the same way (use `-name '.env.example'` only; do not write a wildcard variant of the name): an occurrence in assignment form, meaning the flag name followed by an optional quote or backtick, optional spaces, then `=` or `:`; commented lines count, because uncommenting is one character.
  - `docs/DEPLOY.md` under the same root: an occurrence in assignment form (same pattern) or as the first cell of a markdown table row (line starts with `|`, optional spaces, optional backtick, the flag name). A prose mention is allowed and is what Task 3 adds.
`FLAG_SCAN_ROOT` is a new optional environment variable documented in the header comment next to `WORKFLOW_DIR`; the default is the repository root, so CI and local runs scan the real repository. Add a `(e2e-flag)` bullet to the header list of offences, and extend the final success line so it mentions the flag scan.

Self-test. Add a helper that builds a fake scan root for a case: it creates `apps/web`, `apps/api` and `docs` under `$work/<case>-root` and copies into it the tracked files the real repository has at the same relative paths (`apps/web/vercel.json`, the three `.env.example` files, `docs/DEPLOY.md`; skip any that does not exist), and a variant of `run_guard` that sets both `WORKFLOW_DIR` and `FLAG_SCAN_ROOT`. Add cases, each of which must make the guard fail AND must have an output file that contains `e2e-flag:` (a failure for any other reason does not count and is reported as a self-test failure), using the existing `failed` counter and message style:
  - `flag_deploy_api`: the copied deploy-api.yml gets a final YAML comment line naming the flag (a comment is enough: any occurrence fails). Place it at the very end of the file so no step block the other checks parse changes shape.
  - `flag_deploy_hml`: the same on the copied deploy-hml.yml.
  - `flag_vercel`: the fake root's `apps/web/vercel.json` names the flag.
  - `flag_env_example`: the fake root's `.env.example` gains a line in assignment form with a value.
  - `flag_deploy_md_row`: the fake root's `docs/DEPLOY.md` gains a table row whose first cell is the flag.
  - `flag_deploy_md_assign`: the fake root's `docs/DEPLOY.md` gains a line in assignment form.
One case must PASS: `flag_doc_prose`, the fake root's `docs/DEPLOY.md` gains a prose sentence that names the flag in backticks followed by a space and a word (no equals sign, no colon right after the name, not a table row); if the guard fails on it the self-test reports a failure. The existing `valid` case keeps scanning the real repository and must still pass. Update the final self-test success line to state the real counts (the swap, the nine existing mutations, the six new ones, and the prose case passing); count them, do not guess.

Because the guard now reads the real docs/DEPLOY.md, it must pass before and after Task 3 adds its sentence; that is the proof the prose rule works on the real file.

Commit (explicit path, no trailer, no push): `test(quick-261023-ssq): fail the workflow guard when the e2e loopback flag reaches a deploy surface`.
  </action>
  <verify>
    <automated>bash -n scripts/check-workflows.sh && pnpm guard:workflows</automated>
  </verify>
  <done>`pnpm guard:workflows` exits 0: the guard on the real repository prints its ok line including the flag scan, the self-test reports the valid copy passing, the swap and all mutations (old and new) failing with `e2e-flag:` output for the six new ones, and the prose case passing, and the release-env self-test still passes. One commit exists with only scripts/check-workflows.sh and no trailer.</done>
</task>

<task type="auto">
  <name>Task 3: The e2e-only statement in docs/DEPLOY.md and the deploy-side unit proof</name>
  <files>docs/DEPLOY.md, apps/web/lib/e2e-loopback-flag.test.ts</files>
  <action>
Per the task statement (c) docs line and (d) last sentence.

1. docs/DEPLOY.md. Read the 'Vercel environment variables (web)' section (starts near line 332). Directly after its variables table, add one short paragraph headed in bold, for example 'E2E-only build flag.', saying, in plain English like the surrounding text: the build flag NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS is turned on only by apps/web/playwright.pwa.config.ts for the production-build PWA e2e, so that build may talk to the local Supabase stack over http loopback (T-09.2-84 otherwise keeps production on https and the hosted host); it is inlined at build time; it must never be set on Vercel, neither on the production project nor on `homolog`, and not in any deploy workflow or tracked env example; `pnpm guard:workflows` fails when it appears in deploy-api.yml, deploy-hml.yml or a Vercel config, or when a .env.example or this file gives it a value. Wording rule for the guard: name the flag in backticks followed by a space and a word; never put an equals sign or a colon right after the name and never start a table row with it, because the guard treats those forms as a value to set. Do not add a row to either Vercel variables table. Do not change any other line of the file.

2. apps/web/lib/e2e-loopback-flag.test.ts (created in Task 1; append a third describe, 'no deploy surface carries the e2e loopback flag'). Using the same repo-root location helper:
   - for .github/workflows/deploy-api.yml, .github/workflows/deploy-hml.yml and apps/web/vercel.json: the raw text has no occurrence of the flag name;
   - for .env.example, apps/web/.env.example and apps/api/.env.example (tracked templates only): no line matches the assignment form (flag name, optional quote or backtick, optional spaces, then `=` or `:`), commented lines included;
   - for docs/DEPLOY.md: no line matches the assignment form and no line starts a table row with the flag; AND the file does document the rule, meaning one paragraph (blank-line separated block) contains the flag name, the word Vercel and the word never. This is the documentation obligation of (c).
   - pattern self-check, like the pattern tests in lib/no-build-time-supabase.test.ts: the assignment-form and table-row patterns match samples such as an exported assignment, a YAML key with a quoted value, a backticked name followed by an equals sign and a table row, and ignore the prose sentence shape used in DEPLOY.md.
   Use the same two regular expressions as scripts/check-workflows.sh so the guard and the test agree; if you change one, change the other.

Run the verify command; it also proves the real DEPLOY.md passes the shell guard's prose rule.

Commit (explicit paths, no trailer, no push): `docs(quick-261023-ssq): state that the e2e loopback flag is never set on Vercel and prove no deploy surface carries it`, staging exactly docs/DEPLOY.md and apps/web/lib/e2e-loopback-flag.test.ts.
  </action>
  <verify>
    <automated>grep -q 'NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS' docs/DEPLOY.md && pnpm --filter @rede-social/web exec vitest run lib/e2e-loopback-flag.test.ts && pnpm guard:workflows && pnpm exec biome check apps/web/lib/e2e-loopback-flag.test.ts</automated>
  </verify>
  <done>docs/DEPLOY.md has the one paragraph under the web/Vercel environment section, in prose form. The third describe passes (no deploy workflow, no Vercel config, no env example assigns or names the flag; DEPLOY.md documents the rule). `pnpm guard:workflows` still exits 0 with the real DEPLOY.md, which shows the prose mention is accepted. One commit exists with exactly the two files and no trailer.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| tenant by-host answer to web | A tenant's `supabaseUrl` comes from the control plane's host answer and is checked by `isAllowedSupabaseOrigin` before any Auth, Realtime, CSP or upload use |
| API to browser (signed upload URL) | The browser sends file bytes and a signed token to the origin of a URL the API handed out; `tusEndpointFor` refuses an origin the predicate rejects |
| repository to deploy | Build-time `NEXT_PUBLIC_*` values set on Vercel or in a deploy workflow are inlined into the production bundle |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-ssq-01 | Spoofing / Information disclosure | `isAllowedSupabaseOrigin` with the flag accidentally on in a real deploy: a browser would send upload bytes and a signed token to an http loopback origin | high | mitigate | The flag is read only as the exact string '1' from a direct build-time property; it is set in one place (the PWA Playwright webServer env); `scripts/check-workflows.sh` fails on any mention in deploy-api.yml, deploy-hml.yml or a Vercel config and on a value in a .env.example or DEPLOY.md; the unit test repeats the same scan; DEPLOY.md forbids it on Vercel (production and homolog) |
| T-quick-ssq-02 | Spoofing | Look-alike or userinfo hosts admitted by the new branch (`127.0.0.1.evil.com`, `x@127.0.0.1`, `x.supabase.co.evil.com`) | high | mitigate | The new branch reuses the existing LOOPBACK_HOSTS set and runs after every structural check (userinfo, path, query, fragment, bare `?`/`#`, parse failure); the matrix test pins each look-alike as refused with the flag on, and the differential corpus proves non-loopback answers are identical with the flag on and off |
| T-quick-ssq-03 | Tampering | Flag leaking to the dev-server e2e or to CI jobs that build for production use (`static` job runs `turbo build`) | medium | mitigate | Only the PWA webServer entry carries it; the test asserts the base Playwright config and ci.yml do not mention it, so the `static` job and Vercel-style builds never inline it |
| T-quick-ssq-04 | Information disclosure | `NEXT_PUBLIC_` value visible in the client bundle of the e2e build | low | accept | The flag is a boolean with no secret value and exists only in a throwaway e2e build against a local stack |
| T-quick-ssq-05 | Repudiation / Denial of service | Guard false positive blocks CI (prose mention in DEPLOY.md flagged) or false negative lets a deploy mention through | low | mitigate | Two explicit forms are treated as a value to set (assignment and first table cell); a self-test case proves a prose mention passes and six cases prove each offence form fails with the `e2e-flag:` message |
</threat_model>

<verification>
Run once after the three tasks, nothing heavier than this (no build, no playwright, no integration, no db reset):

1. `pnpm --filter @rede-social/web exec vitest run lib/supabase-origin.test.ts lib/e2e-loopback-flag.test.ts lib/supabase-coordinates.test.ts lib/upload.test.ts lib/no-build-time-supabase.test.ts`
2. `pnpm exec biome check apps/web/lib/supabase-origin.ts apps/web/lib/supabase-origin.test.ts apps/web/lib/e2e-loopback-flag.test.ts apps/web/playwright.pwa.config.ts`
3. `pnpm guard:workflows`
4. `pnpm guard:lanes`
5. `pnpm boundaries`
6. `git status --short` shows only untracked personal files plus nothing staged or modified outside the six files; `git log --oneline -3` shows the three commits with no trailer (`git log -3 --format=%B` has no Co-Authored-By line); `git diff origin/master..HEAD --stat` is not needed and nothing is pushed.

Optional and only if quick: `pnpm --filter @rede-social/web exec tsc --noEmit --incremental false`; skip it if it exceeds about two minutes or writes output, and say which in the SUMMARY.
</verification>

<success_criteria>
- The predicate admits loopback origins in a production build only when NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS is exactly '1', and behaves identically to before in every other case (proved by the matrix, the differential corpus and the untouched existing tests).
- The PWA e2e config sets the flag in the env of its `next build && next start` entry, and no other file (base config, ci.yml, deploy workflows, Vercel config, env examples) carries it.
- The workflow guard and the unit test both fail when the flag reaches a deploy surface, and both accept the prose sentence in docs/DEPLOY.md.
- Three commits, explicit paths, no trailer, not pushed. SUMMARY states plainly: the e2e was NOT run locally; the next CI run of the e2e-pwa job (csp.spec.ts:215 in the iPhone 14, Pixel 7 and desktop projects) is the proof, and if csp.spec.ts fails later than line 274 that is a different defect to report, not part of this plan.
</success_criteria>

<output>
Create `.planning/quick/261023-ssq-admit-loopback-supabase-origins-in-the-e/261023-ssq-SUMMARY.md` when done. Commit it by explicit path in a final `docs(quick-261023-ssq): ...` commit (no trailer, no push) together with this PLAN.md if it is still untracked; do not stage STATE.md or ROADMAP.md.
</output>
