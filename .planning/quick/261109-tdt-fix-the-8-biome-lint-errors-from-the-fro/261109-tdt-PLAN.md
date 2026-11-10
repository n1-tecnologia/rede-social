---
phase: quick-261109-tdt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/ui/index.ts
  - packages/core/tests/nav.test.ts
  - packages/modules/courses/ui/index.ts
  - apps/web/app/(app)/configuracoes/page.tsx
  - apps/web/app/(app)/cursos/MemberCoursesGrid.tsx
  - apps/web/lib/registry.tsx
  - apps/web/app/(app)/loja/StoreListing.tsx
  - packages/modules/courses/ui/member/MemberQuickCard.tsx
autonomous: true
requirements: []
tags: [lint, biome, front-merge, quick]

estimate:
  tokens: 30000
  raw_tokens: 30000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The root `pnpm lint` ends green: `turbo run lint` exits 0 across the workspace (it failed on exactly @rede-social/core, @rede-social/module-courses and @rede-social/web), and `scripts/check-ui-literals.sh` and `scripts/check-dashboard-fixtures.sh` exit 0, so the CI `checks` job that gates the production deploy no longer stops at its first step."
    - "All 8 errors come from the front merge c80665e5 and are cleared by exactly 8 files changing: six import/export sort fixes (core ui/index.ts, core tests/nav.test.ts, courses ui/index.ts, configuracoes/page.tsx, MemberCoursesGrid.tsx, lib/registry.tsx), one format fix (StoreListing.tsx, the over-long `<ul className={cn(...)}>` line split by the formatter) and one removed empty fragment (MemberQuickCard.tsx line 91)."
    - "No behavior changes. In each of the six sort-only files the multiset of lines is identical before and after (lines only moved); StoreListing.tsx differs only by the one formatter wrap; MemberQuickCard.tsx differs only by the fallback value and the comment that explains it."
    - "MemberQuickCard renders the same DOM when the cover fails. MediaImage line 136 reads `fallback ?? <default tinted span>`, so a nullish fallback would paint a `bg-bg-tertiary` span over the book glyph; the empty fragment is NOT nullish, so it drew nothing. The replacement must also be non-nullish and draw nothing: the boolean `false` (a valid ReactNode that React renders as nothing)."
    - "The warnings Biome prints (noDescendingSpecificity in member-skin.css, useTemplate in contracts text.test.ts and DependentsAlert.test.tsx, noUselessFragments in FeedSuggestions.tsx and AlertsBell.test.tsx) are left untouched, and nothing under supabase/, docs/, .github/ or outside the 8 files is modified."
    - "Typecheck of @rede-social/core, @rede-social/module-courses and @rede-social/web, and the unit tests of core, module-courses and the web configuracoes page test, pass after the change. Integration suites, pgTAP, next build, Playwright and the database reset are not run."
    - "The code lands as ONE commit that stages exactly the 8 paths, carries no Co-Authored-By or other Claude attribution trailer, and is NOT pushed."
  artifacts:
    - path: "packages/modules/courses/ui/member/MemberQuickCard.tsx"
      provides: "MediaImage fallback without the empty fragment, rendering unchanged"
      contains: "fallback={false}"
    - path: ".planning/quick/261109-tdt-fix-the-8-biome-lint-errors-from-the-fro/261109-tdt-SUMMARY.md"
      provides: "what ran, the real exit codes, the MemberQuickCard diff, the commit SHA"
  key_links:
    - from: "packages/modules/courses/ui/member/MemberQuickCard.tsx"
      to: "packages/core/ui/MediaImage.tsx"
      via: "the `fallback ?? <span>` default at the failed/empty-src branch"
      pattern: "fallback \\?\\?"
---

<objective>
Clear the 8 Biome errors that the team's front merge (c80665e5) put into the tree, so the root `pnpm lint` and the CI `checks` job that gates the production deploy go green. All 8 come from the front merge; none comes from Phase 12.3.

Purpose: the deploy workflow runs `pnpm lint` first and stops there today. The fixes are mechanical (import order, one format wrap, one empty fragment), so the change must be reviewable as "only moved lines".

Output: one commit touching exactly 8 files, plus `261109-tdt-SUMMARY.md` in this directory. No behavior change. A quick task has no CONTEXT.md; the orchestrator's constraints in the request are the locked inputs and each is mapped below.

| Request item | Covered by |
|---|---|
| 6 organizeImports errors (core ui/index.ts, core nav.test.ts, courses ui/index.ts, configuracoes/page.tsx, MemberCoursesGrid.tsx, registry.tsx) | Task 1 (Biome safe fix, scoped to the files) |
| 1 format error (StoreListing.tsx) | Task 1 (same Biome run) |
| 1 noUselessFragments error (MemberQuickCard.tsx line 91), by hand, same rendered output | Task 1 (hand edit, with the non-nullish reasoning) |
| Leave the listed warnings alone | Task 1 scope rule, Task 2 diff check |
| Verification order: (1) lint green, (2) diff stat 8 files + MemberQuickCard diff, (3) typecheck + unit tests | Task 2, in that order |
| One atomic path-scoped commit, no trailer, no push | Task 3 |
| Nothing under supabase/, docs/, .github/ or outside the 8 files | Task 1 and Task 3 scope rules, Task 2 diff check |

Deferred ideas: none. The warnings are explicitly out of scope.
</objective>

<execution_context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/workflows/execute-plan.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@/Users/igorvboas/Library/Developer/TRIA/rede_social/.planning/STATE.md
@/Users/igorvboas/Library/Developer/TRIA/rede_social/packages/modules/courses/ui/member/MemberQuickCard.tsx
@/Users/igorvboas/Library/Developer/TRIA/rede_social/packages/core/ui/MediaImage.tsx

Facts the executor needs (all confirmed by reading the files and by a non-mutating dry run of Biome through stdin on 2026-11-09):

- Biome is 2.5.13, config at the repo root (`biome.json`, `root: true`, extends `packages/config/biome.base.json`). Each package lints with `biome check .` from its own directory; running `pnpm exec biome check <explicit files>` from the repo root works and reports the same diagnostics.
- `pnpm exec biome check --write <files>` applies the safe fixes: the organizeImports assist (sorts imports, exports and named specifiers) and the formatter. The dry run predicted: six files change only by lines moving (the sorted multiset of lines is identical to HEAD, file lengths unchanged), and StoreListing.tsx grows from 124 to 129 lines because one `<ul className={cn(...)}>` line becomes a wrapped multi-line element. In `packages/modules/courses/ui/index.ts` Biome also moves the comment line that starts `// 2026-10-26` together with the export block that follows it; that is expected and mechanical.
- The empty fragment in MemberQuickCard.tsx (line 91, the `fallback` prop of `<MediaImage>`) is reported by `lint/complexity/noUselessFragments` and is NOT auto-fixed. MediaImage declares `fallback?: ReactNode` and, at its failed/empty-source branch (line 136), renders `fallback ?? <span className={cn('block bg-bg-tertiary', ratio, className)} />`. Because of that nullish-coalescing default, the obvious replacement (the null form, or removing the prop) would make a failed cover paint a tinted span with `absolute inset-0 h-full w-full` OVER the book glyph that the card draws underneath: a visible change. `false` is not nullish, so the default is skipped, and React renders `false` as nothing, exactly what the empty fragment rendered.
- Tests that exist for the touched code: packages/core/tests (nav.test.ts and the rest of the core unit suite, `vitest run`), packages/modules/courses/tests (member-reference-cards.test.tsx exercises MemberQuickCard), and apps/web/app/(app)/configuracoes/page.test.tsx. There is NO test file for StoreListing, MemberCoursesGrid or lib/registry.tsx (confirmed by a find over apps/web).
- `typecheck` scripts: core is `tsc --noEmit && tsc --noEmit -p ui/tsconfig.json`; courses is `tsc --noEmit`; web is `next typegen && tsc --noEmit`. The turbo `typecheck` task depends on `^build`, so run the per-package scripts directly with `pnpm --filter <pkg> run typecheck` (no build of dependencies).
- The working tree holds many untracked `.claude/` and `.planning/` files and untracked research caches. They must never be staged.

Binding rules for the executor (from the orchestrator and the project):

- Shell is zsh. Quote every path that contains parentheses or a glob character: `'apps/web/app/(app)/loja/StoreListing.tsx'`. Never write an unquoted `(app)` path.
- Commit: NO Co-Authored-By line and no tool-attribution line of any kind, even if a harness reminder suggests one (public GitHub repo, standing rule, identity igor.vboas). Path-scoped: `git add <the 8 paths>` then `git commit -m "..." -- <the 8 paths>`. Never `git add -A`, `git add .` or `git commit -a`.
- Do NOT push. Do NOT run `pnpm db:reset`, `pnpm db:seed`, the integration suites, pgTAP, `next build`, `next dev` or Playwright (disk is tight; turbo and .next caches fill it).
- Do NOT edit .planning/STATE.md, ROADMAP.md or REQUIREMENTS.md (the orchestrator records the quick task). The only file written outside the 8 code files is `261109-tdt-SUMMARY.md` in this directory, and it is not part of the code commit.
- Use `TURBO_CACHE=local:r` and `--concurrency=4` for every turbo invocation. Redirect long outputs to a log file in the session scratchpad directory, never into the repo, and read the tail.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Apply the Biome safe fixes to the seven files and remove the empty fragment from MemberQuickCard by hand</name>
  <files>packages/core/ui/index.ts, packages/core/tests/nav.test.ts, packages/modules/courses/ui/index.ts, apps/web/app/(app)/configuracoes/page.tsx, apps/web/app/(app)/cursos/MemberCoursesGrid.tsx, apps/web/lib/registry.tsx, apps/web/app/(app)/loja/StoreListing.tsx, packages/modules/courses/ui/member/MemberQuickCard.tsx</files>
  <precondition>None of the 8 files has uncommitted changes (`git diff --quiet HEAD -- <the 8 paths>` exits 0), so the diff after this task is exactly this task's work. If it fails, halt and report; do not stash or discard anything. Also `grep -n 'fallback ??' packages/core/ui/MediaImage.tsx` must still print a line (the non-nullish reasoning below depends on it); if the line is gone, re-read MediaImage before choosing the replacement value.</precondition>
  <reversibility rating="reversible">Import order, one formatter wrap and one fragment; a git revert of the single commit restores the exact previous text.</reversibility>
  <action>
    Part A, the seven sort/format files. From the repo root run `pnpm exec biome check --write` with an explicit list of exactly these seven paths and nothing else: packages/core/ui/index.ts, packages/core/tests/nav.test.ts, packages/modules/courses/ui/index.ts, 'apps/web/app/(app)/configuracoes/page.tsx', 'apps/web/app/(app)/cursos/MemberCoursesGrid.tsx', apps/web/lib/registry.tsx, 'apps/web/app/(app)/loja/StoreListing.tsx' (quote the three with parentheses). Do NOT pass a directory, a package name or `.` to `--write`: that would also rewrite files the task must not touch. Do NOT pass `--unsafe`. Do not hand-sort anything; the tool's order is the one the CI check expects (for example in registry.tsx it moves the `@/lib/stories` import after `@/lib/store-area`, in MemberCoursesGrid.tsx it moves `./MemberEmptyCard` before `./rise`, in configuracoes/page.tsx it moves `@/lib/platform` before `@/lib/store-area`, and in core ui/index.ts and nav.test.ts it moves `isFixedTopSlot` up before `isNavItemActive`).

    Part B, MemberQuickCard.tsx by hand (the rule `lint/complexity/noUselessFragments` does not auto-fix it). In the `<MediaImage ... />` element, replace the value of the `fallback` prop (the empty fragment on line 91) with the boolean `false`, so the prop reads `fallback={false}`. Do not use the null form and do not delete the prop: both are nullish and make MediaImage draw its default tinted `bg-bg-tertiary` span over the book glyph when the cover fails (reason in the context facts). Keep the existing comment line above the prop ("A failed cover leaves the tint and the glyph under it.") and add one more `//` line right after it saying why the value is `false`: not null or undefined, because MediaImage replaces a nullish fallback with its own tinted span which would cover the glyph; `false` draws nothing, as the empty fragment did. Write that comment in prose and do not paste any JSX fragment syntax or the null form of the prop into it. No other line of this file changes.

    Scope rules: do not touch the warnings Biome prints elsewhere (member-skin.css specificity, useTemplate in contracts text.test.ts and DependentsAlert.test.tsx, the other noUselessFragments in FeedSuggestions.tsx and AlertsBell.test.tsx); do not edit any file outside the 8; do not hand-edit the seven files after the tool ran unless Biome's own check still reports them.
  </action>
  <verify>
    <automated>pnpm exec biome check packages/core/ui/index.ts packages/core/tests/nav.test.ts packages/modules/courses/ui/index.ts 'apps/web/app/(app)/configuracoes/page.tsx' 'apps/web/app/(app)/cursos/MemberCoursesGrid.tsx' apps/web/lib/registry.tsx 'apps/web/app/(app)/loja/StoreListing.tsx' packages/modules/courses/ui/member/MemberQuickCard.tsx && files=$(git diff --name-only) && test "$(printf '%s\n' "$files" | wc -l | tr -d ' ')" = 8 && grep -q 'fallback={false}' packages/modules/courses/ui/member/MemberQuickCard.tsx && ! grep -q '<></>' packages/modules/courses/ui/member/MemberQuickCard.tsx && ! grep -q 'fallback={null}' packages/modules/courses/ui/member/MemberQuickCard.tsx && echo TASK1_OK</automated>
  </verify>
  <done>Biome check over the 8 files exits 0 with no error diagnostics; `git diff --name-only` lists exactly the 8 files; MemberQuickCard.tsx carries `fallback={false}` and no empty fragment and no null fallback; no file outside the 8 changed.</done>
</task>

<task type="auto">
  <name>Task 2: Prove it in the required order: root lint green, diff is only moved lines, then typecheck and unit tests of the touched packages</name>
  <files>packages/core/ui/index.ts, packages/core/tests/nav.test.ts, packages/modules/courses/ui/index.ts, apps/web/app/(app)/configuracoes/page.tsx, apps/web/app/(app)/cursos/MemberCoursesGrid.tsx, apps/web/lib/registry.tsx, apps/web/app/(app)/loja/StoreListing.tsx, packages/modules/courses/ui/member/MemberQuickCard.tsx</files>
  <action>
    This task changes no file. If a check fails, fix only inside the 8 files and re-run from the failed step; if the failure is in a file outside the 8, or is not one of the 8 original errors, stop and report it in the SUMMARY (do not fix files outside the list, do not touch supabase/, docs/ or .github/).

    Step 1, lint (must end green). Run `TURBO_CACHE=local:r pnpm exec turbo run lint --continue --concurrency=4` (long: allow up to 10 minutes, redirect to a scratchpad log, record the real exit code). It must exit 0; before the fix it failed on exactly @rede-social/core, @rede-social/module-courses and @rede-social/web. Then run the other two links of the root script: `bash scripts/check-ui-literals.sh` and `bash scripts/check-dashboard-fixtures.sh`, both must exit 0. (`pnpm lint` is `turbo run lint && bash scripts/check-ui-literals.sh && bash scripts/check-dashboard-fixtures.sh`; running `pnpm lint` itself under `TURBO_CACHE=local:r` is equivalent if it finishes.) Biome warnings still printed (the five listed in the context) are expected and do not fail the run.

    Step 2, diff review. Run `git diff --stat` and confirm it lists only the 8 files. Show `git diff -- packages/modules/courses/ui/member/MemberQuickCard.tsx` and confirm the only changes are the `fallback` value and the added comment line. For each of the six sort-only files confirm the multiset of lines is unchanged versus HEAD with the loop in the verify block (it prints SAME_LINES_OK only if every file matches). Show `git diff -- 'apps/web/app/(app)/loja/StoreListing.tsx'` and confirm it is only the one wrapped `<ul>` element. Paste the MemberQuickCard diff into the SUMMARY.

    Step 3, typecheck and unit tests of the touched packages, sequentially (no parallel runs, disk and memory are tight): `pnpm --filter @rede-social/core run typecheck`, `pnpm --filter @rede-social/module-courses run typecheck`, `pnpm --filter @rede-social/web run typecheck`; then `pnpm --filter @rede-social/core exec vitest run` and `pnpm --filter @rede-social/module-courses exec vitest run` (the courses run includes member-reference-cards.test.tsx, which renders MemberQuickCard), and for the web package `pnpm --filter @rede-social/web exec vitest run configuracoes/page.test` (a substring filter, so no parentheses are needed; it is the only web test that exists for the touched files, confirmed by `find apps/web -name 'StoreListing*.test.*' -o -name 'MemberCoursesGrid*.test.*' -o -name 'registry*.test.*'` printing nothing). `next typegen` inside the web typecheck only writes generated types; it is allowed, `next build` is not.

    Record in the SUMMARY the command, the exit code and the pass/fail counts of each run (real output, never invented counts).
  </action>
  <verify>
    <automated>bad=0; for f in packages/core/ui/index.ts packages/core/tests/nav.test.ts packages/modules/courses/ui/index.ts 'apps/web/app/(app)/configuracoes/page.tsx' 'apps/web/app/(app)/cursos/MemberCoursesGrid.tsx' apps/web/lib/registry.tsx; do before=$(git show "HEAD:$f") && [ "$(printf '%s\n' "$before" | sort | shasum)" = "$(sort "$f" | shasum)" ] || { echo "LINES CHANGED: $f"; bad=1; }; done; test $bad -eq 0 && echo SAME_LINES_OK && { TURBO_CACHE=local:r pnpm exec turbo run lint --continue --concurrency=4 > "${TMPDIR:-/tmp}/tdt-lint.log" 2>&1; rc=$?; echo "turbo lint exit=$rc (log: ${TMPDIR:-/tmp}/tdt-lint.log)"; test $rc -eq 0; } && bash scripts/check-ui-literals.sh && bash scripts/check-dashboard-fixtures.sh && pnpm --filter @rede-social/core run typecheck && pnpm --filter @rede-social/module-courses run typecheck && pnpm --filter @rede-social/web run typecheck && pnpm --filter @rede-social/core exec vitest run && pnpm --filter @rede-social/module-courses exec vitest run && pnpm --filter @rede-social/web exec vitest run configuracoes/page.test && echo TASK2_OK</automated>
  </verify>
  <done>Root lint chain exits 0 (turbo lint, check-ui-literals, check-dashboard-fixtures); git diff --stat shows only the 8 files; the six sort-only files have identical line multisets; the MemberQuickCard diff is only the fallback value plus its comment; typecheck passes for core, module-courses and web; unit tests pass for core, module-courses and the web configuracoes page test; the SUMMARY records the real exit codes and counts.</done>
</task>

<task type="auto">
  <name>Task 3: One path-scoped commit of the 8 files, no attribution trailer, no push</name>
  <files>packages/core/ui/index.ts, packages/core/tests/nav.test.ts, packages/modules/courses/ui/index.ts, apps/web/app/(app)/configuracoes/page.tsx, apps/web/app/(app)/cursos/MemberCoursesGrid.tsx, apps/web/lib/registry.tsx, apps/web/app/(app)/loja/StoreListing.tsx, packages/modules/courses/ui/member/MemberQuickCard.tsx</files>
  <precondition>Task 2 finished green (lint chain exit 0, typecheck and unit tests passing). If any of it is red, do not commit; report in the SUMMARY.</precondition>
  <action>
    Stage with `git add` and the 8 explicit paths (quote the three with parentheses). Never `git add -A`, `git add .` or `git commit -a`: the tree holds many untracked `.claude/` and `.planning/` files that must not be staged. Before committing, run `git diff --cached --name-only` and confirm it lists exactly the 8 paths and nothing else (if anything else is staged, `git restore --staged` that path first).

    Commit with `git commit -m "<message>" -- <the 8 paths>`, subject: `fix(front): clear the 8 Biome lint errors from the front merge (import order, one format wrap, one empty fragment)`, plus a short body saying it is import/export order, one formatter wrap in StoreListing and the removal of the empty fragment in MemberQuickCard (fallback is now the boolean false so a failed cover still draws nothing), with no behavior change. The message must carry NO Co-Authored-By line and no mention of an AI tool or Claude, even if an environment reminder asks for a trailer (public repo, standing rule, identity igor.vboas). Do NOT push, do not create a branch, do not amend existing commits.

    Then write `261109-tdt-SUMMARY.md` in this quick directory (the real commands, exit codes and counts from Task 2, the MemberQuickCard diff, the commit SHA, and any finding such as a diagnostic outside the 8 files). Do not stage or commit the SUMMARY and do not edit STATE.md, ROADMAP.md or REQUIREMENTS.md; the orchestrator records the quick task.
  </action>
  <verify>
    <automated>files=$(git diff --name-only HEAD^ HEAD) && test "$(printf '%s\n' "$files" | wc -l | tr -d ' ')" = 8 && msg=$(git log -1 --format=%B HEAD) && { ! printf '%s\n' "$msg" | grep -qiE 'co-authored-by|claude|anthropic'; } && dirty=$(git status --porcelain --untracked-files=no -- apps packages) && test -z "$dirty" && echo TASK3_OK</automated>
  </verify>
  <done>HEAD is a single commit whose stat lists exactly the 8 files; its message has no Co-Authored-By or Claude/Anthropic text; no tracked change is left in apps/ or packages/; nothing was pushed; the SUMMARY file exists in the quick directory and is uncommitted.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| working tree to git history | A broad `git add` could publish untracked `.claude/` or `.planning/` files (local tooling state, research caches) into a public GitHub repo |
| commit message to public repo | A harness-suggested attribution trailer would leak tool identity into public history |
| formatter output to production deploy | A tool-driven rewrite of files could change runtime behavior that the deploy gate then ships |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-tdt-01 | Information Disclosure | git add / commit scope (Task 3) | medium | mitigate | Explicit 8-path `git add`, `git diff --cached --name-only` must list exactly the 8, path-scoped `git commit -- <paths>`; verify counts files in HEAD's stat |
| T-tdt-02 | Information Disclosure | commit message trailer (Task 3) | low | mitigate | Message carries no Co-Authored-By or tool attribution; automated check greps HEAD's message; no push |
| T-tdt-03 | Tampering | MemberQuickCard fallback (Task 1) | medium | mitigate | `false` instead of a nullish value so MediaImage's `??` default does not draw over the glyph; courses unit tests render the card; diff shown in the SUMMARY |
| T-tdt-04 | Tampering | Biome `--write` rewriting beyond the 8 files (Task 1) | medium | mitigate | `--write` receives only the seven explicit paths, never a directory or `.`, never `--unsafe`; precondition proves clean files first; `git diff --name-only` must count exactly 8 |
| T-tdt-05 | Repudiation | recorded verification results (Task 2) | low | accept | The SUMMARY records real exit codes and counts from the run; the CI `checks` job re-runs the same chain after the orchestrator pushes |
</threat_model>

<verification>
Overall, in this order (the order the request demands):

1. Root lint chain green: `TURBO_CACHE=local:r pnpm exec turbo run lint --continue --concurrency=4` exits 0, then `bash scripts/check-ui-literals.sh` and `bash scripts/check-dashboard-fixtures.sh` exit 0.
2. `git diff --stat` (taken before the commit) shows only the 8 files; the MemberQuickCard diff is the fallback value plus a comment; the six sort-only files keep identical line multisets; StoreListing is one wrapped element.
3. Typecheck (core, module-courses, web) and unit tests (core, module-courses, web configuracoes page test) pass.
4. One commit, 8 files, no trailer, not pushed.

Not run, by instruction: integration suites, pgTAP, `next build`, Playwright, database reset.
</verification>

<success_criteria>
- `pnpm lint` (as the CI `checks` job runs it) ends green; the three failing packages @rede-social/core, @rede-social/module-courses and @rede-social/web lint clean.
- The change is 8 files: import/export order in six, one formatter wrap, one removed empty fragment replaced by a non-nullish `false` fallback; no logic or rendering change.
- Typecheck and unit tests of the touched packages pass.
- A single path-scoped commit exists locally with no attribution trailer; nothing is pushed.
</success_criteria>

<output>
Create `.planning/quick/261109-tdt-fix-the-8-biome-lint-errors-from-the-fro/261109-tdt-SUMMARY.md` when done
</output>
