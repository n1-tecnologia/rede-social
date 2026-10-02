---
phase: 08-moderation-tenant-admin-panel-pilot-hardening
plan: 11
subsystem: testing
tags: [i18n, pt-br, lint, biome, noJsxLiterals, next-intl, catalog, gate, PWA-03]

requires:
  - phase: 08-moderation-tenant-admin-panel-pilot-hardening
    provides: "08-08's embed-player labels, 08-03/08-04's moderation and admin catalogs, and the existing scripts/check-ui-literals.sh inside pnpm lint"
provides:
  - "Biome style/noJsxLiterals at error for apps/web, packages/ui and packages/**/ui non-test .tsx, with a glyph-only allowedStrings list"
  - "check-ui-literals.sh canary that proves, on every full run, that the rule still rejects a word and multi-line JSX text and that the allow-list holds only glyphs"
  - "check-ui-literals.sh rule (d): user-facing attribute literals"
  - "apps/web/i18n/messages.test.ts 'every message compiles' (all 1274 pt-BR messages through next-intl createTranslator)"
  - "08-I18N-AUDIT.md: the dated zero-literals audit row for the 08-12 gate"
affects: [08-12 gate report, any future UI screen, catalog edits]

actuals:
  tokens: 6028
  tasks: 2
  commits: 2
plan_head_before: eabc19224ea2e80f6dab1781172466ff91ed6b50

tech-stack:
  added: []
  patterns:
    - "Lint-rule canary: copy the real biome.json and its base into a throwaway tree and lint probe files, so the gate proves its own rule still bites without writing into the repo"
    - "Glyph-only allow-lists are machine-checked (no \\p{L} or \\p{N} in any allowedStrings entry)"
    - "A separator glyph the formatter wraps onto its own line renders from a constant (MIDDOT), because noJsxLiterals compares raw, untrimmed text"

key-files:
  created:
    - .planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/08-I18N-AUDIT.md
  modified:
    - biome.json
    - scripts/check-ui-literals.sh
    - apps/web/i18n/messages.test.ts
    - apps/web/app/(app)/inicio/page.tsx
    - apps/web/messages/pt-BR/platform.json
    - packages/modules/feed/ui/PostHeader.tsx

key-decisions:
  - "The allowedStrings justification lives in check-ui-literals.sh, not in biome.json: Biome 2.5.13 reads biome.json as strict JSON, and a // comment there silently stopped it honouring files.includes (it linted .next/ and dist/)"
  - "The plan's biome lint --stdin-file-path probe is replaced by a canary in check-ui-literals.sh: stdin mode in 2.5.13 prints 'The contents aren't fixed' and exits 1 for every input, including clean code, so the probe passed for the wrong reason"
  - "The /inicio platform tenant row moves into the catalog as platform.tenantRow ({slug} — {name} ({modules})) instead of allow-listing whitespace-wrapped glyphs"
  - "next-intl AppConfig.Messages key typing stays deferred: 29 files merged at runtime and dynamic keys (kinds.${kind})"

patterns-established:
  - "Every new UI string goes through t(): JSX text (Biome), user-facing attributes (script rule d) and message syntax (catalog compile test) all fail the build"

requirements-completed: [ADMIN-01, ADMIN-02, ADMIN-03, MODER-03]

coverage:
  - id: D1
    description: "Biome noJsxLiterals at error on UI sources, repo clean against it (8 shipped punctuation hits resolved)"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "pnpm exec biome lint --only=style/noJsxLiterals --diagnostic-level=error apps packages (exit 0, 1020 files)"
        status: pass
      - kind: other
        ref: "pnpm lint (14/14 packages + check-ui-literals.sh OK)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Canary proves the rule bites (word and multi-line text fail, glyph and tests/ pass) and that the allow-list is glyph-only at error"
    verification:
      - kind: other
        ref: "bash scripts/check-ui-literals.sh (full run); mutation runs with 'Salvar' allow-listed and with the override narrowed to apps/api both FAILED as expected"
        status: pass
    human_judgment: false
  - id: D3
    description: "Script rule (d) rejects user-facing attribute literals (aria-label, placeholder, title, alt, label)"
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#08-11 rule (d): fails on a user-facing attribute literal, naming file:line"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#08-11 rule (d): passes on braced values, decorative alt, glyphs and look-alike attributes"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every pt-BR catalog message compiles through next-intl with a failing onError"
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#every message compiles"
        status: pass
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#a broken message is reported through onError (the check can fail)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Dated audit record for the 08-12 gate"
    verification:
      - kind: other
        ref: "test -f .planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/08-I18N-AUDIT.md"
        status: pass
    human_judgment: false
  - id: D6
    description: "/inicio platform tenant row reads the same after moving into the catalog (platform host only)"
    verification:
      - kind: other
        ref: "pnpm --filter @rede-social/web typecheck"
        status: pass
    human_judgment: true
    rationale: "No test renders the platform-host /inicio tenant list; the rendered row should be glanced at once on the platform host"

duration: 8min
completed: 2026-10-02
status: complete
---

# Phase 8 Plan 11: pt-BR literal audit gate Summary

**Biome `noJsxLiterals` at error on every UI `.tsx`, guarded by a canary that copies the real config into a throwaway tree. Script rule (d) rejects attribute literals, and a unit test compiles all 1274 pt-BR messages through next-intl. The dated zero-literals audit is recorded for the 08-12 gate.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-02T19:02:38Z
- **Completed:** 2026-10-02T19:10:42Z
- **Tasks:** 2
- **Files modified:** 7 (6 modified, 1 created)

## Accomplishments

- A JSX text literal in any non-test `.tsx` under `apps/web`, `packages/ui` or `packages/**/ui` now fails `pnpm lint`. This includes words without diacritics and text split across lines, which the old line regex could not see. The repo is clean against the rule.
- `scripts/check-ui-literals.sh` checks on every full run that the rule is at `error` and that every allow-listed entry is a pure glyph (T-08-55). It also lints the real `biome.json` against probe files in a temp tree to prove a word still fails.
- Rule (d) rejects `aria-label`, `placeholder`, `title`, `alt` and `label` values that hold a literal word. There were 0 hits today.
- The new "every message compiles" test formats all 1274 catalog messages with a sample for every argument, plural and `<b>` tag, and fails on any `onError` (T-08-56). A mutation that added an unbalanced plural to `admin.json` failed it as expected.
- `08-I18N-AUDIT.md` records nine checks for the 08-12 gate, each with its command and its before/after result.

## Task Commits

1. **Task 1: noJsxLiterals at error, glyph allow-list, fixes, proof it bites** - `abe097f` (feat)
2. **Task 2: script rule (d), catalog compile test, audit record** - `c23e912` (feat)

**Plan metadata:** see the docs(08-11) commit that adds this file.

No commit from the concurrent session landed between `eabc192` and these commits.

## Files Created/Modified

- `biome.json`: override enabling `style/noJsxLiterals` at error with `allowedStrings: ["/", "·", "—", "(", ")", "…"]`
- `scripts/check-ui-literals.sh`: rule (d), the glyph-only/level check and the noJsxLiterals canary. The header documents the allow-list
- `apps/web/i18n/messages.test.ts`: "every message compiles", the brace-parser self-test, a must-fail case and two rule (d) cases
- `apps/web/app/(app)/inicio/page.tsx`: the platform tenant row now renders `tp('tenantRow', …)`
- `apps/web/messages/pt-BR/platform.json`: new `platform.tenantRow`
- `packages/modules/feed/ui/PostHeader.tsx`: the middot separator renders from a `MIDDOT` constant
- `.planning/phases/08-moderation-tenant-admin-panel-pilot-hardening/08-I18N-AUDIT.md`: the audit record

## Decisions Made

- I kept every glyph the plan named in the allow-list, even though after the fixes only `/` and `·` occur as bare JSX text. All six are glyph-only, and the script enforces that.
- The canary runs only on a full run (no directory argument), because the script's own unit tests pass fixture directories and should not need Biome.
- `t.markup` is used for the compile walk, so messages with `<b>` tags format to a string with pass-through tag functions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The allow-list cannot be commented inside biome.json**
- **Found during:** Task 1
- **Issue:** The plan asked for a neighbouring comment on each allow-listed glyph. Biome 2.5.13 reads `biome.json` as strict JSON. With `//` comments it raised no error and silently ignored `files.includes`: it checked 3303 files instead of 1020 and linted `.next/` and `dist/`.
- **Fix:** I kept `biome.json` comment-free and moved the per-glyph justification into the `check-ui-literals.sh` header and the audit file. The script now also machine-checks that every entry is glyph-only.
- **Files modified:** biome.json, scripts/check-ui-literals.sh
- **Verification:** The file count is back to 1020, and `pnpm lint` is green.
- **Committed in:** abe097f

**2. [Rule 1 - Bug] The plan's stdin probe could not fail for the right reason**
- **Found during:** Task 1
- **Issue:** In 2.5.13, `biome lint --stdin-file-path` prints "The contents aren't fixed" and exits 1 for any input, including `export const P = 1;`. It never reports lint diagnostics, so the `! (… | biome lint --stdin-file-path …)` verify passed regardless of the rule.
- **Fix:** I added a canary to `check-ui-literals.sh`. It copies the real `biome.json`, `.gitignore` and `packages/config/biome.base.json` byte for byte into a `mktemp` tree, lints probe files with the repo's Biome, and asserts which files are reported. Nothing is written into the repo, and it runs inside `pnpm lint`.
- **Files modified:** scripts/check-ui-literals.sh
- **Verification:** The canary passes on the real config. Two mutations failed it as expected: allow-listing "Salvar", and narrowing the override to `apps/api`.
- **Committed in:** abe097f

**3. [Rule 1 - Bug] Biome compares raw, untrimmed JSX text against `allowedStrings`**
- **Found during:** Task 1
- **Issue:** With the glyphs allow-listed, 4 of the 8 shipped hits still failed: ` — `, ` (` plus newline, `)` plus newline on /inicio, and the formatter-wrapped `·` in PostHeader. The plan said to touch those files only for a non-glyph hit.
- **Fix:** The /inicio row moves into the catalog (`platform.tenantRow`). The PostHeader middot renders from a `MIDDOT` constant, because the formatter always breaks a multi-attribute span's text child onto its own line.
- **Files modified:** apps/web/app/(app)/inicio/page.tsx, apps/web/messages/pt-BR/platform.json, packages/modules/feed/ui/PostHeader.tsx
- **Verification:** The noJsxLiterals probe exits 0, the feed tests pass (215), and the web typecheck is clean.
- **Committed in:** abe097f

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bugs)
**Impact on plan:** The gate is stronger than planned. Its proof is real and runs in CI, and the allow-list is machine-checked. EventForm, TenantTable, PostCard and Textarea are unchanged. There is no new dependency and no scope creep.

## Issues Encountered

- Running `biome lint` against `apps packages` with the comment-bearing config reported parse and lint errors from `.next/` build output. It took a back-to-back config comparison to trace this to the comments, not to the new rule.

## Threat Flags

None. T-08-55 is mitigated: the allow-list is glyph-only and machine-checked. T-08-56 is mitigated: every message compiles in a unit test.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 08-12 can take row "pt-BR catalog audit: zero UI literals" directly from `08-I18N-AUDIT.md`.
- One glance item for UAT: the platform-host `/inicio` tenant list now renders through `platform.tenantRow` (coverage D6).

---
*Phase: 08-moderation-tenant-admin-panel-pilot-hardening*
*Completed: 2026-10-02*

## Self-Check: PASSED

- All 7 key files exist on disk. Commits `abe097f` and `c23e912` are present in `git log`.
- Acceptance re-run: `grep -c noJsxLiterals biome.json` = 1 and `allowedStrings` = 1. "user-facing attribute literal" in the script = 1, "every message compiles" in the test = 1, and noJsxLiterals in the audit = 2. The Task 2 verify chain printed VERIFY_OK, and `pnpm lint` is green.
