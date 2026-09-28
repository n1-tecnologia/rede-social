---
phase: 02-tenant-shell-branding-platform-panel
plan: 02
subsystem: shared UI package (@rede-social/ui) + Tailwind v4 wiring in apps/web
tags: [ui, design-system, tailwind, tokens, a11y, motion, vitest, happy-dom]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "the five fixed --brand-* variables (brandStyleVars) server-rendered on the (auth) <main> and the (app) [data-brand-root]; the @theme inline aliases bind to exactly those names"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "packages/ui placeholder package, packages/config vitest.base + tsconfig.base + biome.base, apps/web root layout with next-intl"
provides:
  - "@rede-social/ui: cn, Button, IconButton, Input, Badge, Chip, StatusPill, Card, SectionTitle, Avatar, Skeleton, EmptyState, Switch, Tabs (+TabPanel), PageHeader, FileDropZone, BottomSheet, ConfirmDialog, Toast/ToastProvider/useToast, PullToRefresh, SafeAreaWrapper, ScrollContainerContext/Provider/useScrollContainer, useMediaQuery, useDebounce, usePullToRefresh"
  - "@rede-social/ui/styles/tokens.css: two-layer token model (neutral --theme-* light/dark, --brand-* fallbacks + color-mix derivations, --brand-accent pair flipping in dark), @custom-variant dark, @theme inline aliases (--color-bg…, --color-brand: var(--brand-accent), status colours), --screen-*/--safe-*/--nav-height, .app-scroll, .glass-bar, .pb-safe/.pt-safe, shimmer keyframes"
  - "apps/web: Tailwind v4 via postcss.config.mjs + app/globals.css (@import tailwindcss + tokens, @source for packages/ui/src and packages/core/ui); Manrope --font-manrope on <html>, bg-bg text-text font-sans on <body>"
  - "Package-legitimacy approval for the whole phase: sharp@0.35.4, resend@6.28.0, standardwebhooks@1.1.1, lucide-react@1.46.0, tailwind-merge@3.7.0, motion@13.3.0 (approved by the user 2026-09-16; 02-03 must not re-ask)"
affects: [02-04 mockup, 02-06 e-mail templates (Button/Card language), 02-07 AppShell, 02-08 auth pages, 02-11 manifest/theme cookie, 02-12/02-14/02-15 platform panel, 02-13 suspended screen]

# Tech tracking
tech-stack:
  added:
    - "tailwindcss 4.3.3 + @tailwindcss/postcss 4.3.3 (apps/web)"
    - "lucide-react 1.46.0, clsx 2.1.1, tailwind-merge 3.7.0, motion 13.3.0 (@rede-social/ui + apps/web)"
    - "vitest 5.0.0 + happy-dom 20.14.5 + @testing-library/react 16.3.3 + @testing-library/jest-dom 7.0.1 + @vitejs/plugin-react 6.1.1 (@rede-social/ui dev)"
  patterns:
    - "Brand utilities are bound through `@theme inline`: `.bg-brand{background-color:var(--brand-accent)}` resolves on the element, so a per-tenant --brand-primary on any ancestor (and a nested [data-theme]) repaints with no alias re-declaration; the --color-* variables themselves are intentionally NOT emitted"
    - "tokens.css is the only file with hex literals; primitives carry tokenised classes only (grep gate: 0 hex in packages/ui/src/*.tsx)"
    - "Primitives are props-only: every string and aria label arrives as a prop, no next-intl, no imports from the contracts package (client-safe barrel)"
    - "Overlays share one useFocusTrap (first focusable on open, Tab cycles, Escape closes, focus restored) and read useReducedMotion() to fall back to instant opacity"
    - "Component tests: happy-dom + Testing Library, MotionGlobalConfig.skipAnimations = true in tests/setup.ts so springs mount/exit synchronously"

key-files:
  created:
    - packages/ui/vitest.config.ts
    - packages/ui/tests/setup.ts
    - packages/ui/tests/tokens.test.ts
    - packages/ui/tests/button.test.tsx
    - packages/ui/tests/overlays.test.tsx
    - packages/ui/src/cn.ts
    - packages/ui/src/styles/tokens.css
    - packages/ui/src/primitives/Button.tsx
    - packages/ui/src/primitives/IconButton.tsx
    - packages/ui/src/primitives/Input.tsx
    - packages/ui/src/primitives/Badge.tsx
    - packages/ui/src/primitives/Chip.tsx
    - packages/ui/src/primitives/StatusPill.tsx
    - packages/ui/src/primitives/Card.tsx
    - packages/ui/src/primitives/SectionTitle.tsx
    - packages/ui/src/primitives/Avatar.tsx
    - packages/ui/src/primitives/Skeleton.tsx
    - packages/ui/src/primitives/EmptyState.tsx
    - packages/ui/src/primitives/Switch.tsx
    - packages/ui/src/primitives/Tabs.tsx
    - packages/ui/src/primitives/PageHeader.tsx
    - packages/ui/src/primitives/FileDropZone.tsx
    - packages/ui/src/overlays/BottomSheet.tsx
    - packages/ui/src/overlays/ConfirmDialog.tsx
    - packages/ui/src/overlays/Toast.tsx
    - packages/ui/src/hooks/useMediaQuery.ts
    - packages/ui/src/hooks/useDebounce.ts
    - packages/ui/src/hooks/useFocusTrap.ts
    - packages/ui/src/hooks/usePullToRefresh.ts
    - packages/ui/src/layout/PullToRefresh.tsx
    - packages/ui/src/layout/SafeAreaWrapper.tsx
    - packages/ui/src/layout/ScrollContainerContext.tsx
    - apps/web/postcss.config.mjs
    - apps/web/app/globals.css
  modified:
    - packages/ui/package.json
    - packages/ui/tsconfig.json
    - packages/ui/src/index.ts
    - apps/web/package.json
    - apps/web/app/layout.tsx
    - biome.json
    - pnpm-lock.yaml

key-decisions:
  - "The --color-* aliases are declared with `@theme inline` and are not emitted as CSS variables (Tailwind prunes unused inline theme variables). The must-have truth ('bg-brand resolves to var(--brand-accent) on the element') is what the build verifies; emitting --color-brand at :root would reintroduce the root-resolution bug Pattern 2 exists to avoid. The literal acceptance line 'emitted CSS contains --color-brand' is therefore unmet by design — see Deviations."
  - "tokens.css is excluded from Biome's CSS formatter (linter stays on): the formatter quotes the @custom-variant attribute selectors and wraps the gradient, breaking the literal contract the tokens test and the plan pin. Tailwind directives are enabled for Biome's CSS parser repo-wide (css.parser.tailwindDirectives)."
  - "Reduced motion is handled per overlay with motion/react's useReducedMotion (instant opacity) plus `.animate-shimmer { animation: none }` in tokens.css — no blanket `!important` animation reset (Biome noImportantStyles, and it would fight consumers' own transitions)."
  - "ConfirmDialog.onConfirm returns a promise; the dialog closes when it settles (success or failure). An optional onError receives rejections; without it the error is rethrown so a missing handler is loud, not swallowed."
  - "Chip renders <a> with href, <button aria-pressed> with onClick, plain <span> otherwise (typed as a discriminated union); StatusPill shares the geometry constant and is never interactive."
  - "Input requires an explicit id (type-level), links the error through aria-describedby and marks aria-invalid; IconButton requires label; Avatar requires alt (role=img on the span variant, aria-label on the button variant)."
  - "useMediaQuery uses useSyncExternalStore with a false server snapshot (no hydration mismatch) instead of the prototype's setState-in-effect."
  - "Tabs implements roving tabindex with ArrowLeft/ArrowRight/Home/End and scrollIntoView({ inline: 'center' }) guarded for environments without it; TabPanel is exported as a small helper (role=tabpanel) beyond the plan's list."

patterns-established:
  - "Import surface for screens: `import { Button, … } from '@rede-social/ui'` and `@import \"@rede-social/ui/styles/tokens.css\"` from apps/web/app/globals.css"
  - "Sticky sub-headers use `stickyTop` (default `calc(var(--safe-top) + 3rem)`), the shell owns the scroll root and provides it through ScrollContainerProvider"

requirements-completed: [UI-01]

coverage:
  - id: D1
    description: "tokens.css carries the dark variant, the @theme inline aliases bound to --brand-accent/--brand-on-accent, the neutral fallback brand with its derivations on :root, the dark accent flip, the safe-area/scroll contract and none of the legacy aliases"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "packages/ui/tests/tokens.test.ts (6 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Brand-bearing primitives render the tenant-bound utilities and their a11y contract (aria-busy, aria-label, label/for, role=alert + aria-describedby, aria-pressed, focus-visible ring instead of outline removal)"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "packages/ui/tests/button.test.tsx (15 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Overlays and controls expose the UI-SPEC roles: dialog + aria-modal + Escape + focus on open, pending-disabled ConfirmDialog that closes on settle, single role=status toast replaced by a newer one, 200-char toast without fixed height, 3000 ms auto-dismiss, role=switch aria-checked, tablist/tab + arrow keys + href links, EmptyState card variant, Avatar span/button"
    requirement: UI-01
    verification:
      - kind: unit
        ref: "packages/ui/tests/overlays.test.tsx (12 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tailwind v4 compiles in apps/web with the token file: `.bg-brand{background-color:var(--brand-accent)}`, `.text-on-brand{color:var(--brand-on-accent)}`, dark flip of --brand-accent, Manrope @font-face and .animate-shimmer present in the emitted chunk"
    requirement: UI-01
    verification:
      - kind: other
        ref: "pnpm --filter @rede-social/web build → exit 0; grep on apps/web/.next/static/chunks/*.css"
        status: pass
    human_judgment: false
  - id: D5
    description: "The root layout change (globals.css, Manrope, bg-bg text-text) does not regress Phase 1 or the 02-01 tracer"
    requirement: UI-01
    verification:
      - kind: e2e
        ref: "apps/web: playwright test login.spec.ts session.spec.ts branding.spec.ts → 20 passed (mobile-chromium + desktop-chromium)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Grep gates: 0 hex outside tokens.css in packages/ui/src, 0 framer-motion imports, motion/react in every overlay, 0 mentions of the contracts package under packages/ui/src, 0 legacy aliases in tokens.css"
    requirement: UI-01
    verification:
      - kind: other
        ref: "grep gates from 02-02-PLAN.md acceptance criteria, run after the Task 3 commit"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual adequacy of the ported primitives against the prototype (geometry, weights, brand fills, dark mode) — no screen composes them yet"
    verification: []
    human_judgment: true
    rationale: "The end-of-phase verifier should eyeball the primitives once 02-04 (mockup) and 02-07/02-08 (shell, auth pages) render them; nothing in this plan changes a visible page beyond the body ground/text colour and Manrope"

# Metrics
duration: 185min
completed: 2026-09-16
status: complete
actuals:
  tokens: 23540
  tasks: 3
  commits: 4
plan_head_before: f4c791632480eba92180974d1e0a4afbf75db540
---

# Phase 02 Plan 02: Design System Port (@rede-social/ui + Tailwind v4) Summary

**The prototype's design tokens and 21 shared components live in `@rede-social/ui` with the brand bound through Tailwind v4 `@theme inline` (`bg-brand` → `var(--brand-accent)` on the element), every string/colour arriving as props/tokens, and the a11y contract pinned by 33 happy-dom tests; `apps/web` compiles Tailwind v4 with Manrope and the two-layer token file without regressing Phase 1.**

## Performance

- **Duration:** ~185 min wall-clock from the plan's base commit (includes the blocking-human checkpoint wait and two transient API interruptions; three executors)
- **Started:** 2026-09-16T15:20Z (base `f4c7916`)
- **Completed:** 2026-09-16T18:25Z
- **Tasks:** 3 (1 checkpoint + 2 TDD)
- **Files modified:** 41 (incl. pnpm-lock.yaml)

## Checkpoint outcome (Task 1 — package legitimacy, `gate="blocking-human"`)

**Approved by the user on 2026-09-16** ("approved": install exactly as pinned, no swaps or re-pins). The single approval covers **every** `SUS: too-new` package of the phase — `lucide-react@1.46.0`, `tailwind-merge@3.7.0`, `motion@13.3.0` (installed here) **and** `sharp@0.35.4`, `resend@6.28.0`, `standardwebhooks@1.1.1` (installed by 02-03). **02-03 must not re-ask.**

## Accomplishments

- `packages/ui/src/styles/tokens.css`: prototype neutrals verbatim (light `:root` / `[data-theme="dark"]`), neutral platform brand fallbacks (`#2e6fd0`/`#5b9cf8`, on-colours, dark pair), `color-mix` derivations (`--brand-primary-hover/-soft/-gradient`), `--brand-accent`/`--brand-on-accent` flipping to the dark pair, `@custom-variant dark`, `@theme inline` aliases (`--color-bg…-handle`, `--color-brand/-on-brand/-brand-soft/-brand-hover`, success/danger/warning/info, `--font-sans`, `--animate-shimmer`), `--screen-*`/`--safe-*`/`--nav-height`, `.app-scroll`, `.glass-bar` (+ `@supports` liquid-glass hook), `.pb-safe`/`.pt-safe`, reduced-motion shimmer off. No legacy aliases.
- Brand-bearing primitives (Task 2): `Button` (brand/secondary/outline/ghost/danger, sm/md/lg, loading → `aria-busy` + spinner, focus-visible ring), `IconButton` (44×44, required `label`, count `Badge` with `99+`), `Input` (explicit `id`, 16px text, leading icon `pl-10`, error → `border-danger` + `role="alert"` + `aria-describedby` + `aria-invalid`), `Badge`, `Chip` (a/button/span), `StatusPill` (5 tones), `Card`, `SectionTitle` (micro/group).
- Remaining primitives, overlays, hooks, layout (Task 3): `Avatar`, `Skeleton`, `EmptyState` (`variant="card"`), `Switch` (`role="switch"`, `busy`), `Tabs` + `TabPanel` (roving tabindex, arrow keys, links), `PageHeader` (sticky, back via `onBack`/`backHref` + required `backLabel`), `FileDropZone` (drag-over brand highlight, `accept`/`maxBytes` with `onReject`, progress bar, error slot, labels via props), `BottomSheet` (spring 28/300, drag dismiss, `desktopCard`), `ConfirmDialog` (max-w 300, pending state, spring 380/26), `Toast`/`ToastProvider`/`useToast` (single visible, newer replaces, 3000 ms, `role="status" aria-live="polite"`, desktop `md:max-w-[420px] md:right-6`), `useFocusTrap`, `useMediaQuery`, `useDebounce`, `usePullToRefresh` + `PullToRefresh` (mobile only, scroll root from `ScrollContainerContext`), `SafeAreaWrapper`.
- `apps/web`: `postcss.config.mjs`, `app/globals.css` (`@import "tailwindcss"`, `@import "@rede-social/ui/styles/tokens.css"`, `@source` for `packages/ui/src` and `packages/core/ui`), root layout with Manrope (`--font-manrope`) and `bg-bg font-sans text-text antialiased` on `<body>`. Build green; emitted CSS shows `.bg-brand{background-color:var(--brand-accent)}`.
- Tests: `tokens.test.ts` 6, `button.test.tsx` 15, `overlays.test.tsx` 12 → 33/33 under happy-dom; `pnpm --filter @rede-social/ui typecheck && lint` green; `apps/web` typecheck + build green; e2e `login/session/branding` 20/20.

## Task Commits

1. **Task 1: Checkpoint — package legitimacy** — no commit (approved by the user 2026-09-16)
2. **Task 2 RED: token + primitive contract tests, deps and vitest/happy-dom config** — `54bdd45` (test)
3. **Task 2 GREEN: Tailwind v4 in apps/web, tokens.css, cn, eight brand-bearing primitives** — `890766d` (feat)
4. **Task 3 RED: overlay/toast/switch/tabs/empty-state a11y tests** — `d384fd7` (test)
5. **Task 3 GREEN: overlays, remaining primitives, hooks, layout helpers** — `8cdb0d8` (feat)

**Plan metadata:** see the final `docs(02-02)` commit.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 2 | `54bdd45` (15 failing: components/tokens absent) | `890766d` (21/21) | — (none needed) | compliant |
| 3 | `d384fd7` (12 failing: overlays/controls absent) | `8cdb0d8` (33/33) | — (none needed) | compliant |

RED evidence was intentional both times: the imports of not-yet-existing modules failed (Task 2: "Element type is invalid"/missing file; Task 3: 12 named exports missing from the barrel).

## Files Created/Modified

- `packages/ui/package.json` — `./styles/tokens.css` export, `test: vitest run`, deps clsx/lucide-react/motion/tailwind-merge, peer react/react-dom `^19.3.0`, test devDeps
- `packages/ui/tsconfig.json`, `vitest.config.ts`, `tests/setup.ts` — jsx react-jsx + DOM libs; happy-dom + jest-dom + `MotionGlobalConfig.skipAnimations`
- `packages/ui/src/index.ts` — client-safe barrel (23 value exports + types)
- `packages/ui/src/cn.ts`, `src/styles/tokens.css`, `src/primitives/*` (15), `src/overlays/*` (3), `src/hooks/*` (4), `src/layout/*` (3) — see key-files
- `packages/ui/tests/{tokens,button,overlays}.test.*` — the contract suites
- `apps/web/package.json` — tailwindcss, @tailwindcss/postcss, lucide-react, clsx, tailwind-merge, motion, `@rede-social/ui`
- `apps/web/postcss.config.mjs`, `app/globals.css`, `app/layout.tsx` — Tailwind v4 entry, Manrope, body ground/text
- `biome.json` — `css.parser.tailwindDirectives: true`; `tokens.css` excluded from the formatter
- `pnpm-lock.yaml`

## Decisions Made

- **`@theme inline` and no emitted `--color-*` variables** — the utility carries the value (`var(--brand-accent)`), so tenant/theme overrides resolve on the element. Emitting `--color-brand` at `:root` would let custom CSS reference a root-resolved alias, the exact bug Pattern 2 avoids; the literal acceptance line is therefore not met on purpose (documented as a deviation below).
- **Biome: Tailwind directives on, `tokens.css` unformatted** — the CSS formatter rewrites `[data-theme=dark]` to `[data-theme="dark"]` inside `@custom-variant` and wraps the gradient; the test and the plan pin the literal strings, and hand-formatting a 220-line token file is the cheaper contract.
- **No blanket reduced-motion reset** — overlays consult `useReducedMotion()` and animate opacity only; the shimmer is switched off in CSS. Avoids `!important` and does not fight consumer transitions.
- **`ConfirmDialog` closes on settle, rethrows without `onError`** — matches E21 (caller shows the success/error toast) while keeping unhandled failures visible.
- **`useMediaQuery` via `useSyncExternalStore`** — `false` server snapshot, no set-state-in-effect, no hydration mismatch.
- **`TabPanel` and `ScrollContainerProvider`/`useScrollContainer` exported** beyond the plan's list — the roles contract asks for `tabpanel` and the shell needs a provider to hand the scroll root to `PullToRefresh`.
- **Task 2 lint fix applied repo-wide** — `biome.json` is a root config (`root: true`), so the Tailwind-directive switch is the only way `apps/web/app/globals.css` and `tokens.css` lint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome could not parse the Tailwind v4 directives and reformatted the token contract**
- **Found during:** Task 2 (running `pnpm --filter @rede-social/ui lint`, part of the task's verify)
- **Issue:** `@theme inline`, `@custom-variant`, `@source` are rejected by Biome's CSS parser by default ("Tailwind-specific syntax is disabled"); with the parser on, the formatter changed the literal selectors/gradient the tests pin
- **Fix:** `biome.json`: `css.parser.tailwindDirectives: true` + a formatter-off override for `packages/ui/src/styles/tokens.css` (linter stays on)
- **Files modified:** `biome.json`
- **Committed in:** `890766d`

**2. [Rule 1 - Bug] Token test helper matched selectors inside the file header comment**
- **Found during:** Task 2 GREEN
- **Issue:** `block(selector)` in `tokens.test.ts` takes the first occurrence of `:root`, `[data-theme="dark"]` and `@theme inline`; my header comment mentioned them before the rules, so the helper sliced the wrong block
- **Fix:** reworded the comment (the test is right: the first occurrence should be the rule); no test change
- **Files modified:** `packages/ui/src/styles/tokens.css`
- **Committed in:** `890766d`

**3. [Rule 1 - Bug] Toast auto-dismiss test needed the AnimatePresence exit microtask flushed**
- **Found during:** Task 3 GREEN
- **Issue:** with `skipAnimations`, `AnimatePresence` still unmounts on a microtask after the timer fires; the RED test asserted synchronously after `advanceTimersByTime(1)` and could never pass
- **Fix:** the final step became `await act(async () => { vi.advanceTimersByTime(1); await Promise.resolve(); })` — the 2999-vs-3000 ms boundary is unchanged
- **Files modified:** `packages/ui/tests/overlays.test.tsx`
- **Committed in:** `8cdb0d8`

**4. [Rule 2 - Missing critical] Biome a11y/correctness findings on the ported components**
- **Found during:** Task 3 GREEN lint
- **Issue:** drag handlers on a static `<div>` (FileDropZone), assignment-in-expression ref callback and `tabIndex` on a non-interactive tabpanel (Tabs), an ineffective suppression (Avatar)
- **Fix:** drop target is a labelled `<section>`, ref callback is a block, `TabPanel` has no tabIndex, suppression removed
- **Files modified:** `packages/ui/src/primitives/{FileDropZone,Tabs,Avatar}.tsx`
- **Committed in:** `8cdb0d8`

### Documented, not fixed

**5. Acceptance line "the emitted CSS under `apps/web/.next` contains `--color-brand`" is unmet by design.** Tailwind v4 does not emit inline theme variables that no utility references; the plan's must-have truth (`bg-brand`/`text-on-brand` resolve to `var(--brand-accent)`/`var(--brand-on-accent)` on the element) is verified in the emitted chunk instead. Switching to `@theme inline static` would emit the alias and invite `var(--color-brand)` in custom CSS, which resolves at `:root` — the failure Pattern 2 prevents. Flagged for the verifier.

**6. RED test files were reformatted by Biome (line wrapping only)** in `890766d`; `git diff -w` is empty for both files.

---

**Total deviations:** 4 auto-fixed (2 bugs, 1 blocking, 1 missing-critical), 2 documented. **Impact:** no scope change; the components match UI-SPEC and the plan's behaviour lists.

## Issues Encountered

- Two transient API interruptions (after the Task 2 RED commit and after "Now the three overlays"); each continuation resumed from the committed/on-disk state with no rework.
- `pnpm --filter @rede-social/web build` warned nothing; the `@source "../../../packages/core/ui"` directory does not exist yet (Tailwind ignores it, as the plan expected).

## Verification (plan-level)

- `pnpm --filter @rede-social/ui test` → 33 passed (3 files); `pnpm --filter @rede-social/ui typecheck` and `lint` → clean.
- `pnpm --filter @rede-social/web typecheck` → clean; `pnpm --filter @rede-social/web build` → exit 0; emitted CSS contains `.bg-brand{background-color:var(--brand-accent)}`, `.text-on-brand{color:var(--brand-on-accent)}`, `--brand-accent:var(--brand-primary-dark)` (dark), `@font-face{font-family:Manrope`, `.animate-shimmer`.
- `pnpm exec playwright test login.spec.ts session.spec.ts branding.spec.ts` (apps/web, against the running Supabase stack; Playwright started the API and web servers) → 20 passed on mobile-chromium + desktop-chromium.
- Grep gates: `grep -c "gold\|emerald\|brand-ig-mark" tokens.css` → 0; hex in `packages/ui/src/**/*.tsx` → 0; `framer-motion` → 0; `motion/react` in each overlay → 1; contracts-package mentions under `packages/ui/src` → 0.

## Human-check notes for the end-of-phase verifier

- No page composes the primitives yet; the only visible change is the Manrope typeface and the `#f5f7fb` ground / `#16233b` text on every page (compare `http://rede-demo.localhost:3000/entrar` before/after). Once 02-04/02-07/02-08 land, compare Button/Input/Chip/Card geometry against `reference/frontend-design` and toggle `data-theme="dark"` on `<html>` in devtools to see the accent flip to `--brand-primary-dark`.
- Deviation 5 (no `--color-brand` variable in the emitted CSS) is intentional — verify the utility output instead.

## Known Stubs

None — every component renders from props; `FileDropZone`, `PullToRefresh` and `Toast` have no data source by design (the callers wire them).

## Threat Flags

None — no new network endpoint, auth path or schema; `Avatar` renders `<img src>` from props only (T-02-06 accepted), `Toast`/`BottomSheet` timers and listeners are cleaned up in effects (T-02-07).

## Next Phase Readiness

- 02-04 (mockup) can import `@rede-social/ui` and `@rede-social/ui/styles/tokens.css`; 02-07 should wrap the shell's scroll root in `ScrollContainerProvider` and mount the `#liquid-glass` SVG filter for `.glass-bar`.
- 02-11 sets `data-theme` on `<html>` from the cookie — the dark layer and the `@custom-variant dark` are already in place.
- 02-03 installs `sharp`/`resend`/`standardwebhooks` under the approval recorded above.

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All 34 created files exist on disk; task commits 54bdd45, 890766d, d384fd7 and 8cdb0d8 are in history; commits measured from plan_head_before (4).
