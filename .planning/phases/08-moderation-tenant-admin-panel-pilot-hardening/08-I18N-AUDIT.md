# Phase 8 — pt-BR catalog audit: zero UI literals (PWA-03, ROADMAP SC 4)

**Run:** 2026-10-02, local, Biome 2.5.13, next-intl 4.14.4, Node 24.
**Code under audit:** commit `abe097f` (08-11 Task 1) plus the 08-11 Task 2 changes committed together with this file.
**Input to:** the 08-12 go-live gate report, row "pt-BR catalog audit: zero UI literals".

Scope for the UI checks: every non-test `.tsx` under `apps/web`, `packages/ui` and `packages/**/ui`. That covers the Phase 8 admin and moderation screens (ADMIN-01..03, MODER-03) and every older screen. Test files, `tests/`, `e2e/` and fixtures are excluded.

| # | Check | Command | Before 08-11 | After 08-11 | Result |
|---|-------|---------|--------------|-------------|--------|
| 1 | Biome `style/noJsxLiterals` at `error` (AST: catches words without diacritics such as "Salvar", and multi-line JSX text). `allowedStrings` = `/ · — ( ) …`, pure glyphs only | `pnpm exec biome lint --only=style/noJsxLiterals --diagnostic-level=error apps packages` (and inside `pnpm lint` through `biome check .` in every package) | 8 non-test hits, all punctuation: EventForm 520, inicio 63 (×2) and 64, TenantTable 209, PostCard 246, PostHeader 106, Textarea 82. Once the glyphs were allow-listed, 4 remained, because Biome compares the raw text and these glyphs carried surrounding whitespace (inicio ×3, PostHeader ×1) | 0 (1020 files checked) | **pass** |
| 2 | noJsxLiterals canary: the real `biome.json` is copied into a throwaway tree. A one-line word and multi-line JSX text must fail, and an allow-listed glyph plus a word under `tests/` must pass. Every `allowedStrings` entry must have no letter or digit, and the level must be `error` | `bash scripts/check-ui-literals.sh` (full run, inside `pnpm lint`) | did not exist | word and split text reported, glyph and fixture not; allow-list glyph-only | **pass** |
| 3 | Script rule (a): hex colour literal | `bash scripts/check-ui-literals.sh` | 0 | 0 | **pass** |
| 4 | Script rule (b): legacy prototype brand class | same | 0 | 0 | **pass** |
| 5 | Script rule (c): JSX text with pt-BR diacritics | same | 0 | 0 | **pass** |
| 6 | Script rule (d): user-facing attribute literal (`aria-label`, `placeholder`, `title`, `alt`, `label` set to a quoted value with 2+ letters) | same | rule did not exist (RESEARCH probe: 0) | 0 | **pass** |
| 7 | Catalog shape: every `apps/web/messages/pt-BR/*.json` parses, and its root key equals the filename prefix | same, plus `apps/web/i18n/messages.test.ts` loader cases | 29 files valid | 29 files valid | **pass** |
| 8 | Catalog compile: every leaf message is formatted through next-intl `createTranslator` with a failing `onError`, using a sample value for each argument, plural and `<b>` tag | `pnpm --filter @rede-social/web exec vitest run i18n` (case "every message compiles") | not checked | 1274 messages, 0 failures (635 tests in the file pass). A mutation test that added an unbalanced plural to `admin.back` failed the run with `INVALID_MESSAGE: EXPECT_ARGUMENT_CLOSING_BRACE` | **pass** |
| 9 | Whole lint gate | `pnpm lint` (turbo `biome check .` ×14 packages, then `scripts/check-ui-literals.sh`) | — | 14/14 packages clean, script OK | **pass** |

## Fixes the audit drove

- `/inicio` platform tenant row: `{slug} — {name} ({count})` was JSX text that mixed glyphs with interpolations. It is now the catalog message `platform.tenantRow` (`{slug} — {name} ({modules})`), so a translator controls the punctuation order too.
- `PostHeader` middot: the formatter puts this span's child on its own line, so the allow-listed `·` reached Biome wrapped in whitespace. It now renders from a `MIDDOT` constant.

## Notes

- **Allow-list justification lives in `scripts/check-ui-literals.sh`, not in `biome.json`.** Biome 2.5.13 reads `biome.json` as strict JSON. A `//` comment there did not raise an error; Biome silently stopped honouring `files.includes` and linted `.next/` and `dist/`. The canary (row 2) also guards that silent-degrade path for the rule itself.
- **`biome lint --stdin-file-path` cannot prove the rule.** In 2.5.13 it prints "The contents aren't fixed" and exits 1 for any input, including clean code, and never reports lint diagnostics. The plan's stdin probe therefore passed for the wrong reason, and the canary in row 2 replaces it.
- **Deferred, not a gate requirement:** next-intl `AppConfig.Messages` key typing, which would make `t('missing.key')` a `tsc` error. The catalog is 29 JSON files merged at runtime (`apps/web/i18n/messages.ts`), and some keys are built dynamically (`kinds.${kind}`), so typed keys need a generated declaration file and casts at the dynamic call sites. This is recorded as a later improvement (08-RESEARCH Pattern 7).
