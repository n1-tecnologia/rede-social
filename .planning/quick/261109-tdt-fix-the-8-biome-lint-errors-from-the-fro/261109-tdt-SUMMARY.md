---
phase: quick-261109-tdt
plan: 01
subsystem: lint
tags: [lint, biome, front-merge, quick]
status: complete
commits: 1
plan_head_before: 301b0ecb
key-files:
  modified:
    - packages/core/ui/index.ts
    - packages/core/tests/nav.test.ts
    - packages/modules/courses/ui/index.ts
    - apps/web/app/(app)/configuracoes/page.tsx
    - apps/web/app/(app)/cursos/MemberCoursesGrid.tsx
    - apps/web/lib/registry.tsx
    - apps/web/app/(app)/loja/StoreListing.tsx
    - packages/modules/courses/ui/member/MemberQuickCard.tsx
decisions:
  - "MemberQuickCard fallback is the boolean false, not null: MediaImage renders `fallback ?? <tinted span>`, so a nullish value would paint over the book glyph."
metrics:
  completed: 2026-11-09
---

# Quick 261109-tdt: Clear the 8 Biome lint errors from the front merge

Six import/export sort fixes, one formatter wrap and one empty fragment replaced by `fallback={false}` clear all 8 Biome errors left by front merge c80665e5. No behavior change.

**Commit:** 66392292 (local only, not pushed). 8 files, +24/-16, no attribution trailer.

## What ran (real results)

| Check | Result |
|---|---|
| `pnpm exec biome check` on the 8 files | exit 0, no fixes applied |
| `TURBO_CACHE=local:r pnpm exec turbo run lint --continue --concurrency=4` | exit 0, 20/20 tasks successful |
| `bash scripts/check-ui-literals.sh` | exit 0 |
| `bash scripts/check-dashboard-fixtures.sh` | exit 0 |
| typecheck core / module-courses / web | exit 0 / 0 / 0 |
| vitest core | exit 0, 1766 passed (1766) |
| vitest module-courses | exit 0, 373 passed (373) |
| vitest web `configuracoes/page.test` | exit 0, 5 passed (5), 1 file |

Sort-only files (six): line multiset identical to HEAD (SAME_LINES_OK, bad=0). StoreListing differs only by the one wrapped `<ul>`.

## MemberQuickCard diff

```diff
             // A failed cover leaves the tint and the glyph under it.
-            fallback={<></>}
+            // The value is false, not null or undefined: MediaImage replaces a nullish
+            // fallback with its own tinted span, which would cover the glyph. False draws
+            // nothing, as the empty fragment did.
+            fallback={false}
```

## Deviations from Plan

None of substance. The explanatory comment is three `//` lines instead of the single line the plan suggested (kept within the formatter's line width).

## Notes

- Biome still prints the expected warnings/infos (noDescendingSpecificity, useTemplate, other noUselessFragments); left untouched by design.
- Integration suites, pgTAP, next build, Playwright and db reset were not run, by instruction. SUMMARY/STATE not committed (orchestrator handles docs).

## Self-Check: PASSED
