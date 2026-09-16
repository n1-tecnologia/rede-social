---
phase: 02-tenant-shell-branding-platform-panel
plan: 04
subsystem: i18n catalog infrastructure (pt-BR namespaces, loader, literal guard) + D-33 design-review gate (static mockup of the [designed] screens)
tags: [i18n, next-intl, pt-bR, catalog, lint-guard, design-review, sketch, ui, tokens, vitest]

# Dependency graph
requires:
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 02
    provides: "@tria/ui tokens.css (two-layer neutrals + tenant brand), brand utilities via @theme inline, Biome tailwind directives, happy-dom test shape"
  - phase: 02-tenant-shell-branding-platform-panel
    plan: 01
    provides: "brandStyleVars()/deriveBrandColors and the contrast report the mockup's BrandPreview readout mirrors (D-41)"
  - phase: 01-foundation-kernel-tenancy-auth-ci-cd
    provides: "apps/web next-intl wiring (i18n/request.ts, single pt-BR.json), Playwright login/recovery specs, repo guard-script style (scripts/check-boundaries.sh)"
provides:
  - "apps/web/messages/pt-BR/<namespace>.json — the 12 Phase 1 namespaces split verbatim (common, login, signup, forgot, reset, suspended, hostMismatch, noCommunity, platform, app, example, legal); pt-BR.json removed; later plans add shell.json, home.json, settings.json, profile.json, invite.json, inviteExpired.json, unavailable.json, offline.json, install.json, platform.<tab>.json without touching a shared file"
  - "apps/web/i18n/messages.ts — loadMessages(dir?) memoized per directory over assembleMessages(entries): sorted filename order, pure deep-merge, root key must equal the filename prefix before the first dot, empty/non-object roots refused, duplicate leaf path throws `Duplicate message key \"<path>\" in <fileA> and <fileB>`"
  - "apps/web/i18n/request.ts — messages from the loader; onError throws outside production (missing key = failing render in dev/test) and getMessageFallback renders the dotted `namespace.key` in production"
  - "apps/web/next.config.ts — ./messages/pt-BR/** added to outputFileTracingIncludes so the Vercel function bundle carries the fs-read catalog"
  - "scripts/check-ui-literals.sh — fails `pnpm lint` on any .tsx under apps/** or packages/** (excluding reference/, public/, tests, *.test.tsx) containing a hex colour in a string/class, a legacy prototype brand class (text-gold, bg-gold, bg-emerald, text-emerald, btn-gold, brand-ig-mark, pill-, text-gradient-) or JSX text with pt-BR diacritics; also validates every catalog file parses and its root key matches the filename prefix; wired after `turbo run lint` in the root lint script"
  - "apps/web vitest 5 (node env, e2e/ and .next/ excluded) + `test` script; i18n/messages.test.ts (12 cases incl. guard fixtures)"
  - ".planning/sketches/001-phase-02-designed-screens/index.html — self-contained mockup of the 17 [designed] screens (desktop shell + rail, settings, tenant list + empty states, new tenant, tenant page x5 tabs, accept/expired invite, suspended, offline, install hint, panel on a phone, feedback surfaces) with tokens.css compiled to plain CSS variables, data-theme toggle and a --brand-* picker"
  - "D-33 review gate closed: README frontmatter approved: true / approved_by Igor Vilas Boas (product owner) / approved_at 2026-09-16 / status approved / approval_kind provisional; MANIFEST.md row updated"
  - "packages/ui/src/styles/tokens.css — derived brand tokens (--brand-accent/-on-accent/-hover/-soft/-gradient) re-evaluated per element (* and [data-theme=dark] *) so a nested [data-brand-root] scope recolours bg-brand and friends"
affects: [02-07 AppShell + shell/home/settings namespaces, 02-08 auth pages + invite/inviteExpired/unavailable namespaces, 02-10 accept-invite, 02-11 manifest/install namespace, 02-12 platform list/new, 02-13 suspended/offline screens, 02-14 tenant page tabs, 02-15 domains/admins, every later phase adding UI strings (Phase 8 PWA-03 audit)]

# Tech tracking
tech-stack:
  added:
    - "vitest 5.0.0 as an @tria/web devDependency (web unit tests; e2e stays on Playwright)"
  patterns:
    - "One catalog file per top-level namespace under apps/web/messages/pt-BR/; dotted filenames (platform.list.json) deep-merge into the parent namespace; the loader, not a human, detects collisions"
    - "next-intl fails loud: missing keys throw in dev/test, render as the dotted key in production"
    - "UI literals are a lint failure, not a review note: hex colours, legacy prototype classes and pt-BR text outside the catalog fail `pnpm lint` via scripts/check-ui-literals.sh"
    - "Design-review gate as a planning artifact: .planning/sketches/NNN-name/{index.html,README.md} with approval recorded in the README frontmatter before the screens are coded (D-33)"
    - "Derived brand tokens are declared on `*` (and `[data-theme=dark] *`), never only on :root, so per-scope --brand-* overrides propagate to the utilities"

key-files:
  created:
    - apps/web/messages/pt-BR/common.json
    - apps/web/messages/pt-BR/login.json
    - apps/web/messages/pt-BR/signup.json
    - apps/web/messages/pt-BR/forgot.json
    - apps/web/messages/pt-BR/reset.json
    - apps/web/messages/pt-BR/suspended.json
    - apps/web/messages/pt-BR/hostMismatch.json
    - apps/web/messages/pt-BR/noCommunity.json
    - apps/web/messages/pt-BR/platform.json
    - apps/web/messages/pt-BR/app.json
    - apps/web/messages/pt-BR/example.json
    - apps/web/messages/pt-BR/legal.json
    - apps/web/i18n/messages.ts
    - apps/web/i18n/messages.test.ts
    - apps/web/vitest.config.ts
    - scripts/check-ui-literals.sh
    - .planning/sketches/MANIFEST.md
    - .planning/sketches/001-phase-02-designed-screens/index.html
    - .planning/sketches/001-phase-02-designed-screens/README.md
  modified:
    - apps/web/i18n/request.ts
    - apps/web/next.config.ts
    - apps/web/package.json
    - apps/web/app/(app)/layout.tsx
    - package.json
    - pnpm-lock.yaml
    - packages/ui/src/styles/tokens.css
    - .planning/phases/02-tenant-shell-branding-platform-panel/deferred-items.md
  deleted:
    - apps/web/messages/pt-BR.json

key-decisions:
  - "D-33 review provisionally approved by the product owner (Igor Vilas Boas) on 2026-09-16 with no change list; the team's designer reviews the platform-panel screens later — designer deltas are a follow-up polish pass, not a blocker for coding the [designed] screens now"
  - "The catalog loader is split into a pure assembleMessages(entries) (sorted, deep-merge, conflict detection, unit-tested with injected listings) and a memoized loadMessages(dir) that reads the directory once per process — determinism is tested without touching the filesystem"
  - "check-ui-literals.sh scans with a small node script instead of rg/grep alternation so the three rules (hex in strings/classes, legacy classes, JSX diacritic text) and the catalog-file contract share one exclusion list and one report format"
  - "Derived brand tokens moved from :root-only var() indirections to a per-element rule: CSS custom properties resolve at declaration, so a nested [data-brand-root] scope could never recolour bg-brand otherwise (found by the mockup's brand picker, pre-existing from 02-02)"
  - "The Phase 1 interim `#ddd` hairline in (app)/layout.tsx became var(--theme-border) rather than an exclusion in the guard — the guard's first real hit was fixed, not allow-listed"
  - "Mockup uses only Copywriting Contract strings and placeholder tenant names (TRIA Demo etc.); no seed e-mails or env values (T-02-14)"

patterns-established:
  - "Namespace file per feature: `apps/web/messages/pt-BR/<namespace>.json` with `{ \"<namespace>\": {…} }` as its single root key"
  - "Guard scripts run after `turbo run lint` from the root `lint` script (check-boundaries → check-ui-literals)"
  - "Sketch approval record: README frontmatter approved/approved_by/approved_at/status + approval_kind + verbatim reply in the body"

requirements-completed: [PWA-03, UI-04]

coverage:
  - id: D1
    description: "Per-namespace pt-BR catalog with a deterministic, conflict-detecting loader wired into next-intl; Phase 1 strings still resolve after the split"
    requirement: PWA-03
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts (12 cases: union of root keys, dotted deep-merge, duplicate leaf error naming both files, prefix/empty/non-object refusals, sorted pure merge + memoization, literal accents/ICU untouched)"
        status: pass
      - kind: e2e
        ref: "pnpm e2e -- login.spec.ts (10/10 on both Playwright projects — strings resolve from the split catalog)"
        status: pass
      - kind: other
        ref: "pnpm --filter @tria/web typecheck && build (green, ./messages/pt-BR/** traced)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Hard-coded UI literals fail lint: scripts/check-ui-literals.sh rejects hex colours, legacy prototype classes and pt-BR JSX text outside the catalog, validates catalog files, and runs from the root `pnpm lint`"
    requirement: PWA-03
    verification:
      - kind: unit
        ref: "apps/web/i18n/messages.test.ts#check-ui-literals fixtures (hex, btn-gold, <p>Configurações</p> → exit 1; {t('title')}, .test.tsx, tokens.css → exit 0)"
        status: pass
      - kind: other
        ref: "bash scripts/check-ui-literals.sh → exit 0 on the repo; pnpm lint (turbo lint + guard) green"
        status: pass
    human_judgment: false
  - id: D3
    description: "next-intl fails loud on a missing key: onError throws outside production, getMessageFallback renders the dotted key in production"
    requirement: PWA-03
    verification:
      - kind: other
        ref: "grep onError / getMessageFallback apps/web/i18n/request.ts; web typecheck + build green"
        status: pass
    human_judgment: true
    rationale: "The behaviour is next-intl request-config, not covered by a unit test; the verifier should render a page with a deliberately missing key under `next dev` and confirm the throw, then under a production build confirm the dotted key renders"
  - id: D4
    description: "Static mockup of every [designed] screen (17 sections) rendered with the real tokens.css, light/dark toggle and a tenant brand picker, copy verbatim from the UI-SPEC Copywriting Contract"
    requirement: UI-04
    verification:
      - kind: other
        ref: "grep -c '<section id=' index.html → 17; grep data-theme / --brand-primary / 'Novo tenant' / 'Você foi convidado(a) a administrar' / 'Nenhum tenant ainda' / 'Aguardando DNS' / 'Tornar primário' / 'Comunidade indisponível' / 'Você está offline' / 'Adicione à Tela de Início' all present"
        status: pass
    human_judgment: true
    rationale: "Whether the screens read as the prototype's own language is a design judgment; the product owner approved provisionally, the team's designer has not reviewed yet"
  - id: D5
    description: "D-33 gate closed: the approval (reviewer, date, provisional kind, empty change list) is recorded in the sketch README before any [designed] screen is coded; 02-UI-SPEC.md carries no deltas section because none were requested"
    requirement: UI-04
    verification:
      - kind: other
        ref: "grep '^approved: true' / '^approved_by' / '^approved_at: \"2026-09-16\"' / '^status: approved' .planning/sketches/001-phase-02-designed-screens/README.md; grep -c 'Design review deltas' 02-UI-SPEC.md → 0"
        status: pass
    human_judgment: true
    rationale: "The approval is provisional (product owner, not the design team); the verifier should confirm the follow-up designer review is tracked and that no later plan treats it as a blocker"
  - id: D6
    description: "Derived brand tokens propagate into nested brand scopes (bg-brand recolours under [data-brand-root])"
    verification:
      - kind: unit
        ref: "packages/ui tests 33/33 (pinned token test untouched); headless probe: nested scope resolves the picked --brand-primary; web build emits the same .bg-brand utility"
        status: pass
    human_judgment: false

# Metrics
duration: 37min
completed: 2026-09-16
status: complete
actuals:
  tokens: 39444
  tasks: 3
  commits: 5
plan_head_before: 7d773a883ce98e913e419aa9da6d32e0b51cc8ab
---

# Phase 02 Plan 04: pt-BR Catalog Infrastructure and D-33 Design Review Gate Summary

**The pt-BR catalog split into 12 per-namespace files behind a deterministic, collision-detecting loader with loud-failing next-intl config and a `pnpm lint` guard that rejects hex colours, legacy prototype classes and pt-BR literals in TSX; plus the 17-screen static mockup of every prototype-less Phase 2 screen, rendered with the real tokens and provisionally approved by the product owner on 2026-09-16 — the wave-3 screen plans are unblocked.**

## Performance

- **Duration:** 37 min of execution (about 92 min wall clock: the plan waited roughly one hour at the D-33 human checkpoint between `161978f` and this continuation)
- **Started:** 2026-09-16T18:48:21Z (after 02-03 closed)
- **Completed:** 2026-09-16T20:20:00Z
- **Tasks:** 3 (Task 1 TDD: RED + GREEN; Task 2 auto; Task 3 checkpoint:human-action, blocking-human — resolved by the product owner)
- **Files modified:** 28 (incl. pnpm-lock.yaml; 1 deleted)

## Accomplishments

- **Catalog split (PWA-03):** `apps/web/messages/pt-BR.json` became 12 files under `messages/pt-BR/`, every key verbatim, UTF-8 with literal accents. `i18n/messages.ts` exposes `loadMessages()` (memoized per directory) over a pure `assembleMessages()` (sorted filename order, deep-merge, duplicate leaf path → error naming both files, filename-prefix/empty/non-object refusals). `i18n/request.ts` reads the loader, throws on a missing key outside production and renders the dotted key in production. `next.config.ts` traces `./messages/pt-BR/**` for Vercel.
- **Literal guard:** `scripts/check-ui-literals.sh` (node scanner) fails on hex colours in strings/classes, the legacy prototype brand classes, and JSX text with pt-BR diacritics, and validates every catalog file's root key; wired after `turbo run lint` in the root `lint` script. Its first real hit — the Phase 1 interim `#ddd` hairline — was fixed with `var(--theme-border)`.
- **Web vitest:** `apps/web/vitest.config.ts` (vitest 5, node env, `e2e/` and `.next/` excluded) + `"test": "vitest run"`; `i18n/messages.test.ts` 12/12 including the guard fixtures.
- **Mockup (UI-04):** `.planning/sketches/001-phase-02-designed-screens/index.html` — one self-contained file (tokens.css compiled to plain CSS variables, Manrope link, inline lucide sprite, no external JS) with 17 `<section id=…>` screens: desktop shell + rail, settings, tenant list (+ empty and search-empty), new tenant (ColorFields, BrandPreview light/dark mini-shells, contrast readout, module switches, admin e-mail), tenant page × 5 tabs (domain cards with DNS table and copy buttons, ConfirmDialogs open), accept-invite, expired-invite, suspended, offline, install-hint sheet on a phone frame, panel on a 390px frame, feedback surfaces. Toolbar: `data-theme` toggle mirrored by every Tema switch; primary/secondary picker + presets set the five `--brand-*` keys on `[data-brand-scope]` with the D-41 contrast warning.
- **D-33 gate closed:** README frontmatter `approved: true`, `approved_by: Igor Vilas Boas (product owner)`, `approved_at: 2026-09-16`, `status: approved`, `approval_kind: provisional`, `changes_requested: []`; MANIFEST row updated. No "Design review deltas" section was added to `02-UI-SPEC.md` because no changes were requested.
- **Token fix (pre-existing, 02-02):** derived brand tokens now re-evaluate per element so a nested brand scope actually recolours `bg-brand` — found by the mockup's brand picker.

## Task Commits

1. **Task 1 RED: pin the per-namespace catalog loader and the UI-literal guard** — `b87bbd0` (test)
2. **Task 1 GREEN: per-namespace pt-BR catalog, deterministic loader, strict next-intl errors, UI-literal guard** — `8c18bfa` (feat)
3. **Task 1 deviation: derived brand tokens re-evaluate on every element** — `2fa1960` (fix)
4. **Task 2: static mockup of the 17 Phase 2 [designed] screens** — `161978f` (docs)
5. **Task 3: record D-33 design review approval (provisional, product owner)** — `a0ce065` (docs)

**Plan metadata:** see the final `docs(02-04): complete …` commit.

## TDD Gate Compliance

| Task | RED | GREEN | REFACTOR | Status |
|------|-----|-------|----------|--------|
| 1 | `b87bbd0` (messages.test.ts: `loadMessages`/`assembleMessages` absent → import failures; guard fixtures: script absent → exit ≠ expected) | `8c18bfa` (12/12; guard exit 0 on the repo) | — (none needed) | compliant |

RED evidence was intentional: the test file imported `../i18n/messages` before it existed and spawned `scripts/check-ui-literals.sh` before it existed, so every case failed for the absence of the implementation, not for a wrong assertion.

## Checkpoint Outcome (Task 3 — D-33 design review)

- **Type:** `checkpoint:human-action`, `gate="blocking-human"` — never auto-approved; the previous executor stopped at `161978f` and returned the checkpoint.
- **Reply (product owner, pt-BR, verbatim):** "todo design dessa pagina de super_admin aprovado, nao estou preocupado muito aqui porque depois irá passar na mao do designer da equipe. Entao por agora está tudo ok e aprovado por mim".
- **Recorded as:** `approved: true`, `approved_by: Igor Vilas Boas (product owner)`, `approved_at: 2026-09-16`, `status: approved`, `approval_kind: provisional`, `changes_requested: []` in the sketch README (commit `a0ce065`), plus the MANIFEST row.
- **Provisional note:** the approval comes from the product owner, not the design team. The team's designer will review the platform-panel screens later. **Any future designer deltas are a follow-up polish pass, not a blocker for coding the [designed] screens now.** When they arrive: fill `changes_requested`, update `index.html`, and append "## Design review deltas" to `02-UI-SPEC.md`.

## Files Created/Modified

- `apps/web/messages/pt-BR/{common,login,signup,forgot,reset,suspended,hostMismatch,noCommunity,platform,app,example,legal}.json` — the split catalog (`pt-BR.json` deleted)
- `apps/web/i18n/messages.ts` — `loadMessages` / `assembleMessages`
- `apps/web/i18n/request.ts` — loader + `onError` + `getMessageFallback`
- `apps/web/i18n/messages.test.ts`, `apps/web/vitest.config.ts`, `apps/web/package.json` (`test` script, vitest devDep), `pnpm-lock.yaml`
- `apps/web/next.config.ts` — `./messages/pt-BR/**` traced
- `apps/web/app/(app)/layout.tsx` — `#ddd` → `var(--theme-border)` (guard hit)
- `scripts/check-ui-literals.sh`, root `package.json` (`lint` runs the guard after turbo)
- `packages/ui/src/styles/tokens.css` — per-element derived brand tokens (+ dark flip)
- `.planning/sketches/001-phase-02-designed-screens/{index.html,README.md}`, `.planning/sketches/MANIFEST.md`
- `.planning/phases/02-tenant-shell-branding-platform-panel/deferred-items.md` — recovery.spec.ts drift entry

## Decisions Made

See `key-decisions` in the frontmatter. In short: the D-33 review is closed provisionally by the product owner with the designer's review as a tracked follow-up; the loader is pure-core + memoized-shell; the guard is one node scanner with one exclusion list; the derived brand tokens live on `*` so nested scopes work; the guard's first hit was fixed, not allow-listed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The guard's first run failed on the Phase 1 interim `#ddd` hairline**
- **Found during:** Task 1 GREEN (`bash scripts/check-ui-literals.sh` on the repo)
- **Issue:** `apps/web/app/(app)/layout.tsx` carried the Phase 1 functional-minimal `borderBottom: '1px solid #ddd'`; the plan expected zero hits ("if one exists, move the string to the catalog / fix it in this task").
- **Fix:** `var(--theme-border)` (the 02-02 token), no guard exclusion added.
- **Files modified:** `apps/web/app/(app)/layout.tsx`
- **Verification:** guard exit 0; web typecheck/build; `login.spec.ts` 10/10
- **Committed in:** `8c18bfa`

**2. [Rule 1 - Bug, pre-existing from 02-02] Derived brand tokens never reached a nested brand scope**
- **Found during:** Task 2 (the mockup's brand picker: the nested `[data-brand-scope]` stayed TRIA blue `#2e6fd0` in a headless probe)
- **Issue:** `tokens.css` declared `--brand-accent`/`-on-accent`/`-hover`/`-soft`/`-gradient` as `var()` indirections on `:root` only; CSS custom properties resolve where declared, so they were computed once with the neutral brand and inherited resolved — a tenant's `--brand-*` on `[data-brand-root]` could never recolour `bg-brand` in the real app either.
- **Fix:** additive per-element rule (`*`, plus `[data-theme="dark"] *` for the dark flip) so each element derives from its inherited `--brand-*`; the `:root`/dark fallbacks and the pinned token test untouched.
- **Files modified:** `packages/ui/src/styles/tokens.css`
- **Verification:** `@tria/ui` 33/33; web build emits the same `.bg-brand` utility; headless probe resolves the picked colour in the nested scope
- **Committed in:** `2fa1960`

### Out of scope (logged, not fixed)

**3. `e2e/recovery.spec.ts` cases 3/5/7 fail on the local stack — environment drift, not caused by this plan**
- The running local Supabase serves GoTrue's default English recovery template (link to `/auth/v1/verify?…`) instead of `supabase/templates/recovery.html` (`/auth/confirm` link), so `e2e/mail.ts` never finds the confirm link. Mail delivery itself is fine (Mailpit within ~1 s). Cases 1, 2, 4 and 6 — the ones that read catalog strings — pass after the split, so the plan's verification intent (strings still resolve) holds.
- Logged in `deferred-items.md` with the fix (`pnpm supabase stop && … start` with the pinned CLI); 02-06 (mail hook + branded templates) touches this path anyway.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug) + 1 out-of-scope item deferred.
**Impact on plan:** Both fixes were required for the plan's own truths (a clean guard run; a mockup that proves per-tenant recolouring — which in turn exposed a real app bug). No scope creep.

## Issues Encountered

- The `recovery.spec.ts` template drift above: not resolved here (environment), tracked in `deferred-items.md`.
- The plan's Task 3 verification line "any `changes_requested` items are reflected in `index.html` and `02-UI-SPEC.md`" is vacuously satisfied: no changes were requested.

## Known Stubs

None — the mockup is a planning artifact by design (static HTML, placeholder tenant names), not app code; no app file renders empty or placeholder data.

## Human-check notes for the end-of-phase verifier

1. **Designer review is still open.** The D-33 approval is the product owner's, provisional. Confirm a follow-up exists for the team's designer to review the platform-panel screens (`.planning/sketches/001-phase-02-designed-screens/index.html`) and that no wave-3 plan is blocked on it.
2. **Missing-key behaviour (D3):** under `next dev`, render a page with a deliberately missing key → the render must throw; under `next build && next start` the dotted key must render instead.
3. **Recovery e2e:** after restarting the local stack with the pinned CLI, `pnpm --filter @tria/web exec playwright test recovery.spec.ts` should be 7/7 (cases 3/5/7 currently fail on template drift, unrelated to this plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PWA-03 infrastructure is in place: wave-3 plans (02-07, 02-08, 02-10, 02-11, 02-12, 02-13, 02-14, 02-15) add their namespace files under `apps/web/messages/pt-BR/` and the guard keeps literals out of TSX.
- UI-04's D-33 gate is closed (provisionally): the desktop shell, settings, accept-invite, suspended/offline pages, install hint and the platform panel may be coded against the mockup and `02-UI-SPEC.md`.
- Requirements PWA-03 and UI-04 are shared with unfinished sibling plans (02-07/08/10/11/12 and 02-12/14/15 respectively); per the shared-ID gate they stay `Pending` in REQUIREMENTS.md until the last declaring plan finishes.
- Ready for the next incomplete plan of Phase 02 (02-05).

---
*Phase: 02-tenant-shell-branding-platform-panel*
*Completed: 2026-09-16*

## Self-Check: PASSED

All 8 key files exist on disk (pt-BR.json confirmed removed); all 5 task commits (`b87bbd0`, `8c18bfa`, `2fa1960`, `161978f`, `a0ce065`) are in `git log`; `commits: 5` measured with `git rev-list --count 7d773a8..HEAD`.
